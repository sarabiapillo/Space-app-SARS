"""Contrato público de ejecución aislada sintética; nunca usa T030."""
import hashlib
from pathlib import Path
import sys
import time
import uuid

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from unittest.mock import patch

from pipeline.hydrology.dem_dg2 import prepare_dg2_dem
from pipeline.hydrology.runner import start_run, get_run, run_worker

ROOT = Path(__file__).resolve().parents[2]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def prepared():
    base = ROOT / 'data/test-runs' / f'api-dg2-{uuid.uuid4()}'
    source = base / 'prepared'
    source.mkdir(parents=True)
    grid = 'ncols 2\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 5\nNODATA_value -9999\n0 0\n0 0\n'
    for name in ('terrain.dem', 'terrain.dem1x', 'terrain.dem1y'):
        (source / name).write_text(grid)
    (source / 'case.par').write_text('dg2\nDEMfile terrain.dem\ndirroot outputs\nresroot synthetic\nsim_time 2\ninitial_tstep 0.1\nsaveint 1\nfpfric 0.02\n')
    binary = source / 'solver'
    binary.write_text('#!' + sys.executable + '\nimport pathlib,sys,time\np=pathlib.Path("outputs"); p.mkdir(exist_ok=True)\nif "missing" not in sys.argv: (p/"synthetic-0000.wd").write_text(' + repr(grid) + '); (p/"synthetic.max").write_text(' + repr(grid) + ')\nif "error" in sys.argv: sys.exit(3)\nif "timeout" in sys.argv: time.sleep(2)\n')
    binary.chmod(0o700)
    config = dict(source_dir=str(source), files={name: sha(source / name) for name in ('terrain.dem', 'terrain.dem1x', 'terrain.dem1y', 'case.par')}, parameter_file='case.par', simulation_duration_s=2, save_interval_s=1, initial_condition='dry_zero_velocity', boundary='closed', manning=0.02, infiltration='unsupported', rainfall='none', domain_nonurban=True, synthetic=True, hydraulic_accuracy_validated=False)
    return base, config, binary


def test_public_success_and_persistent_state(prepared):
    base, config, binary = prepared
    run = start_run('alice', 'case', 2, {'case': config}, binary, sha(binary), base / 'jobs', 3, launch=False)
    assert run['state'] == 'created' and run['owner'] == 'alice'
    run_worker(base / 'jobs', run['id'])
    persisted = get_run(base / 'jobs', run['id'])
    assert persisted['state'] == 'succeeded'
    assert persisted['result']['frames'][0]['time_s'] is None
    assert persisted['result']['frames'][0]['frame_index'] == 0
    assert persisted['result']['frames'][0]['scheduled_time_s'] == 0
    assert persisted['result']['time_axis']['status'] == 'actual_times_unavailable'
    assert persisted['result']['grid']['crs'] is None
    assert persisted['input_hashes']['case.par'] == sha(base / 'prepared/case.par')
    assert persisted['binary_sha256'] == sha(binary)
    assert (base / 'jobs' / run['id'] / 'solver.log').is_file()
    assert (base / 'jobs' / run['id'] / 'outputs/synthetic.max').is_file()


@pytest.mark.parametrize('mode,expected', [('error', 'failed'), ('missing', 'failed'), ('timeout', 'timed_out')])
def test_solver_failure_is_terminal(prepared, mode, expected):
    base, config, binary = prepared
    config['solver_args'] = [mode]  # forbidden even for trusted cases
    with pytest.raises(ValueError):
        start_run('alice', 'case', 2, {'case': config}, binary, sha(binary), base / 'jobs', 1, launch=False)
    assert not (base / 'jobs').exists()
    config.pop('solver_args')
    binary.write_text(binary.read_text().replace('"missing" not in sys.argv', repr(mode) + ' != "missing"').replace('"error" in sys.argv', repr(mode) + ' == "error"').replace('"timeout" in sys.argv', repr(mode) + ' == "timeout"'))
    run = start_run('alice', 'case', 2, {'case': config}, binary, sha(binary), base / 'jobs', .1 if mode == 'timeout' else 3, launch=False)
    run_worker(base / 'jobs', run['id'])
    persisted = get_run(base / 'jobs', run['id'])
    assert persisted['state'] == expected and 'result' not in persisted


def test_detached_worker_completes_without_request_process(prepared):
    base, config, binary = prepared
    run = start_run('alice', 'case', 2, {'case': config}, binary, sha(binary), base / 'jobs', 3)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = get_run(base / 'jobs', run['id'])
        if state['state'] not in ('created', 'running'):
            break
        time.sleep(.05)
    assert state['state'] == 'succeeded'
    assert state['result']['maximum']['stats']['max_m'] == 0


def test_dead_worker_is_terminal_without_result(prepared):
    base, config, binary = prepared
    run = start_run('alice', 'case', 2, {'case': config}, binary, sha(binary), base / 'jobs', 3, launch=False)
    (base / 'jobs' / run['id'] / 'worker.pid').write_text('999999999')
    state = get_run(base / 'jobs', run['id'])
    assert state['state'] == 'failed' and 'result' not in state


def test_native_official_helper_and_pinned_solver_without_t030():
    base = ROOT / 'data/test-runs' / f'api-dg2-{uuid.uuid4()}'
    base.mkdir(parents=True)
    tif = base / 'new-synthetic-terrain.tif'
    with rasterio.open(tif, 'w', driver='GTiff', width=4, height=4, count=1, dtype='float32', crs='EPSG:32615', transform=from_origin(500000, 1800040, 10, 10)) as dst:
        dst.write(np.arange(16, dtype='float32').reshape(4, 4), 1)
    helper = ROOT / 'data/tools/lisflood-fp-8.0/runtime/build/generateDG2DEM'
    binary = ROOT / 'data/tools/lisflood-fp-8.0/runtime/build/lisflood'
    manifest = prepare_dg2_dem(tif, base / 'prepared', executable=helper, vertical_datum='synthetic_local', code_version='native-seam-test', timeout_s=10)
    source = base / 'prepared'
    (source / 'case.par').write_text('dg2\nDEMfile terrain.dem\ndirroot outputs\nresroot synthetic\nsim_time 2\ninitial_tstep 0.1\nsaveint 1\nfpfric 0.02\n')
    names = ('terrain.dem', 'terrain.dem1x', 'terrain.dem1y', 'case.par')
    config = dict(source_dir=str(source), files={name: sha(source / name) for name in names}, parameter_file='case.par', simulation_duration_s=2, save_interval_s=1, initial_condition='dry_zero_velocity', boundary='closed', manning=.02, infiltration='unsupported', rainfall='none', domain_nonurban=True, synthetic=True, hydraulic_accuracy_validated=False)
    assert set(manifest['files']) == set(names) - {'case.par'}
    expected = '777d50f8d6a926260baa31b4c8ca3ecc0b3ae710494bebb2d4699ccf8c39775c'
    assert sha(binary) == expected
    run = start_run('alice', 'new-synthetic', 2, {'new-synthetic': config}, binary, expected, base / 'jobs', 10, launch=False)
    result = run_worker(base / 'jobs', run['id'])
    assert result['state'] == 'succeeded', (result['state'], (base / 'jobs' / run['id'] / 'solver.log').read_text())
    assert result['solver_returncode'] == 0
    assert [frame['frame_index'] for frame in result['result']['frames']] == [0, 1, 2]
    assert [frame['scheduled_time_s'] for frame in result['result']['frames']] == [0, 1, 2]
    assert [frame['time_s'] for frame in result['result']['frames']] == [None, None, None]
    assert result['result']['time_axis']['status'] == 'actual_times_unavailable'
    assert result['result']['maximum']['source_sha256']
    assert result['result']['grid']['shape'] == [4, 4]
    assert result['result']['synthetic'] and not result['result']['hydraulic_accuracy_validated']
    assert get_run(base / 'jobs', run['id']) == result


def test_dead_worker_does_not_clobber_success_published_during_pid_check(prepared):
    base, config, binary = prepared
    run = start_run('alice', 'case', 2, {'case': config}, binary, sha(binary), base / 'jobs', 3, launch=False)
    directory = base / 'jobs' / run['id']
    (directory / 'worker.pid').write_text('999999999')
    def publish_then_die(pid, signal):
        published = {**run, 'state': 'succeeded', 'result': {'marker': 'published'}}
        (directory / 'state.json').write_text(__import__('json').dumps(published))
        raise ProcessLookupError
    with patch('pipeline.hydrology.runner.os.kill', side_effect=publish_then_die):
        current = get_run(base / 'jobs', run['id'])
    assert current['state'] == 'succeeded' and current['result'] == {'marker': 'published'}
    assert get_run(base / 'jobs', run['id']) == current


@pytest.mark.parametrize('step', [None, '0', '-1', 'nan', 'inf', '3', 'bad'])
def test_initial_tstep_required_before_creating_jobs(prepared, step):
    base, config, binary = prepared
    par = base / 'prepared/case.par'
    par.write_text(par.read_text().replace('initial_tstep 0.1\n', '' if step is None else f'initial_tstep {step}\n'))
    config['files']['case.par'] = sha(par)
    before = {p.name: p.read_bytes() for p in (base / 'prepared').iterdir()}
    with pytest.raises(ValueError, match='initial timestep|incomplete DG2'):
        start_run('alice', 'case', 2, {'case': config}, binary, sha(binary), base / 'jobs', 3, launch=False)
    assert not (base / 'jobs').exists()
    assert {p.name: p.read_bytes() for p in (base / 'prepared').iterdir()} == before


def test_invalid_case_does_not_create_jobs(prepared):
    base, config, binary = prepared
    for change in ({'initial_condition': None}, {'rainfall': 'dynamic'}, {'domain_nonurban': False}, {'simulation_duration_s': 3}, {'files': {'../escape': 'a' * 64}}, {'manning': 0.1}):
        invalid = {**config, **change}
        with pytest.raises(ValueError):
            start_run('alice', 'case', 2, {'case': invalid}, binary, sha(binary), base / 'jobs', 3, launch=False)
        assert not (base / 'jobs').exists()
    with pytest.raises(ValueError):
        start_run('alice', 'case', 2, {'case': config}, binary, '0' * 64, base / 'jobs', 3, launch=False)
    assert not (base / 'jobs').exists()
