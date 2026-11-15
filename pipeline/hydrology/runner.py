"""Ejecución DG2 de casos sintéticos preaprobados; CLI: python -m pipeline.hydrology.runner --help."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

from .results import summarize_results

PROJECT = Path(__file__).resolve().parents[2]
_NAME = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}\Z')
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_REQUIRED = {'dg2', 'DEMfile', 'dirroot', 'resroot', 'sim_time', 'saveint', 'fpfric', 'initial_tstep'}


def _hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _inside(path, parent):
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(parent.resolve()) or resolved == parent.resolve():
        raise ValueError('path outside approved project directory')
    return resolved


def _regular(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('expected regular file without symlinks')
    return path


def _number(value, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 or (maximum is not None and value > maximum):
        raise ValueError('expected finite positive bounded number')
    return float(value)


def _name(value):
    if not isinstance(value, str) or not _NAME.fullmatch(value) or value in {'.', '..'} or value.startswith('.'):
        raise ValueError('unsafe file or case name')
    return value


def _state(directory, state):
    temporary = directory / f'.state-{uuid.uuid4()}.json'
    temporary.write_text(json.dumps(state, allow_nan=False), encoding='utf-8')
    os.replace(temporary, directory / 'state.json')


def get_run(root, run_id):
    if str(uuid.UUID(str(run_id))) != str(run_id):
        raise ValueError('invalid run id')
    directory = _inside(Path(root) / str(run_id), Path(root))
    state = json.loads(_regular(directory / 'state.json').read_text(encoding='utf-8'))
    marker = directory / 'worker.pid'
    if state['state'] in ('created', 'running') and marker.is_file() and not marker.is_symlink():
        try:
            pid = int(marker.read_text(encoding='ascii'))
            if pid <= 0:
                raise ValueError('invalid worker PID')
            os.kill(pid, 0)
            # En Linux un hijo zombi no puede avanzar el estado; tratarlo como caído.
            proc = Path('/proc') / str(pid) / 'stat'
            dead = proc.exists() and proc.read_text().split(') ', 1)[1].startswith('Z ')
        except (ProcessLookupError, ValueError, IndexError):
            dead = True
        except PermissionError:
            dead = False
        if dead:
            # El worker puede haber publicado éxito entre la primera lectura y el PID check.
            state = json.loads(_regular(directory / 'state.json').read_text(encoding='utf-8'))
            if state['state'] in ('created', 'running'):
                state['state'] = 'failed'
                state['error'] = 'worker_stopped'
                _state(directory, state)
    return state


def start_run(owner, case_id, duration, cases, executable, binary_sha256, root, timeout_s, *, launch=True):
    """Preflight completo antes de crear estado; no acepta rutas ni opciones del cliente."""
    if not isinstance(owner, str) or not owner:
        raise ValueError('owner required')
    _name(case_id)
    if not isinstance(cases, dict) or case_id not in cases:
        raise ValueError('case unavailable')
    case = cases[case_id]
    keys = {'source_dir', 'files', 'parameter_file', 'simulation_duration_s', 'save_interval_s', 'initial_condition', 'boundary', 'manning', 'infiltration', 'rainfall', 'domain_nonurban', 'synthetic', 'hydraulic_accuracy_validated'}
    if not isinstance(case, dict) or set(case) != keys:
        raise ValueError('incomplete or unsupported case configuration')
    if (case['initial_condition'] != 'dry_zero_velocity' or case['boundary'] != 'closed' or case['rainfall'] != 'none' or case['infiltration'] != 'unsupported' or case['domain_nonurban'] is not True or case['synthetic'] is not True or case['hydraulic_accuracy_validated'] is not False):
        raise ValueError('only explicitly declared synthetic dry closed cases supported')
    requested = _number(duration)
    if requested != _number(case['simulation_duration_s']) or _number(case['save_interval_s']) > requested:
        raise ValueError('simulation duration and save interval must match prepared case')
    _number(case['manning'])
    _number(timeout_s, 120)
    root = _inside(root, PROJECT)
    source = _inside(case['source_dir'], PROJECT)
    if not source.is_dir() or source.is_symlink() or not isinstance(case['files'], dict) or not case['files']:
        raise ValueError('invalid prepared source')
    parameter = _name(case['parameter_file'])
    if parameter not in case['files']:
        raise ValueError('parameter file not registered')
    files = {}
    for name, expected in case['files'].items():
        _name(name)
        if not isinstance(expected, str) or not _HASH.fullmatch(expected):
            raise ValueError('invalid input hash')
        path = _regular(source / name)
        if _hash(path) != expected:
            raise ValueError('prepared input hash mismatch')
        files[name] = path
    directives = {}
    for line in files[parameter].read_text(encoding='utf-8').splitlines():
        parts = line.split()
        if not parts or parts[0].startswith('#'):
            continue
        if parts[0] in directives or parts[0] not in _REQUIRED or len(parts) != (1 if parts[0] == 'dg2' else 2):
            raise ValueError('unsupported parameter directive')
        directives[parts[0]] = parts[1] if len(parts) == 2 else True
    if not _REQUIRED.issubset(directives) or set(directives) - _REQUIRED or directives['DEMfile'] not in files or directives['DEMfile'] == parameter or directives['dirroot'] != 'outputs' or directives['resroot'] != 'synthetic':
        raise ValueError('unsafe or incomplete DG2 parameters')
    for key, value in (('sim_time', requested), ('saveint', case['save_interval_s']), ('fpfric', case['manning'])):
        try:
            actual = float(directives[key])
        except ValueError as exc:
            raise ValueError('invalid DG2 numeric parameter') from exc
        if not math.isfinite(actual) or actual != float(value):
            raise ValueError('DG2 parameter differs from registered case')
    try:
        initial_step = float(directives['initial_tstep'])
    except ValueError as exc:
        raise ValueError('invalid initial timestep') from exc
    if not math.isfinite(initial_step) or not 0 < initial_step <= requested:
        raise ValueError('invalid initial timestep')
    dem = directives['DEMfile']
    if set(files) != {parameter, dem, dem + '1x', dem + '1y'}:
        raise ValueError('DEM and both DG2 coefficient files must be registered')
    binary = _regular(_inside(executable, PROJECT))
    if not isinstance(binary_sha256, str) or not _HASH.fullmatch(binary_sha256) or _hash(binary) != binary_sha256 or not os.access(binary, os.X_OK):
        raise ValueError('solver executable hash or permission mismatch')
    if root.exists() and (root.is_symlink() or not root.is_dir()):
        raise ValueError('unsafe run root')
    root.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid.uuid4())
    directory = root / run_id
    directory.mkdir(mode=0o700)
    for name, path in files.items():
        shutil.copyfile(path, directory / name, follow_symlinks=False)
        if _hash(directory / name) != case['files'][name]:
            raise ValueError('copied input differs from registered input')
    shutil.copyfile(binary, directory / 'solver', follow_symlinks=False)
    (directory / 'solver').chmod(0o700)
    if _hash(directory / 'solver') != binary_sha256:
        raise ValueError('copied executable differs from pinned hash')
    state = {'id': run_id, 'owner': owner, 'case_id': case_id, 'state': 'created', 'synthetic': True,
             'hydraulic_accuracy_validated': False, 'simulation_duration_s': requested,
             'save_interval_s': float(case['save_interval_s']), 'parameter_file': parameter,
             'input_hashes': case['files'], 'binary_sha256': binary_sha256, 'timeout_s': float(timeout_s)}
    _state(directory, state)
    if launch:
        env = {key: os.environ[key] for key in ('PATH', 'LD_LIBRARY_PATH', 'CONDA_PREFIX', 'SYSTEMROOT') if key in os.environ}
        try:
            worker = subprocess.Popen([sys.executable, '-m', 'pipeline.hydrology.runner', '--worker', run_id, '--root', str(root)],
                                      cwd=PROJECT, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, start_new_session=True)
            (directory / 'worker.pid').write_text(str(worker.pid), encoding='ascii')
        except OSError:
            state['state'] = 'failed'
            state['error'] = 'worker_launch_failed'
            _state(directory, state)
    return get_run(root, run_id)


def run_worker(root, run_id):
    root = _inside(root, PROJECT)
    state = get_run(root, run_id)
    if state['state'] != 'created':
        raise ValueError('run is not in created state')
    directory = root / run_id
    state['state'] = 'running'
    _state(directory, state)
    try:
        env = {key: os.environ[key] for key in ('PATH', 'LD_LIBRARY_PATH', 'CONDA_PREFIX', 'SYSTEMROOT') if key in os.environ}
        with (directory / 'solver.log').open('wb') as log:
            result = subprocess.run([str(directory / 'solver'), state['parameter_file']], cwd=directory, env=env,
                                    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                    timeout=state['timeout_s'], check=False)
        state['solver_returncode'] = result.returncode
        if result.returncode:
            raise RuntimeError('solver_failed')
        outputs = directory / 'outputs'
        if not outputs.is_dir() or outputs.is_symlink() or any(p.is_symlink() or not p.is_file() for p in outputs.iterdir()):
            raise RuntimeError('invalid_output')
        summary = summarize_results(outputs, save_interval_s=state['save_interval_s'])
        state['result'] = summary
        state['artifacts'] = [frame['file'] for frame in summary['frames']] + [summary['maximum']['file']]
        state['state'] = 'succeeded'
    except subprocess.TimeoutExpired:
        state['state'] = 'timed_out'
        state['error'] = 'solver_timeout'
    except (OSError, ValueError, RuntimeError, KeyError):
        state['state'] = 'failed'
        state['error'] = 'solver_or_output_invalid'
    _state(directory, state)
    return state


def main():
    parser = argparse.ArgumentParser(description='Worker interno para casos DG2 sintéticos registrados; no usar con rutas de clientes.')
    parser.add_argument('--worker', required=True, help='UUID del trabajo creado previamente por el servidor')
    parser.add_argument('--root', required=True, help='Directorio de trabajos dentro del proyecto')
    args = parser.parse_args()
    run_worker(args.root, args.worker)


if __name__ == '__main__':
    main()
