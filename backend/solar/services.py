"""Local synchronous simulation runs. IDs are public capabilities, not access control.

One shared filesystem and POSIX flock are required across all worker processes. No
background job, durable queue, authentication or distributed lock is provided.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import threading
from uuid import uuid4

from django.conf import settings
from rest_framework.exceptions import APIException, NotFound

_RUN = re.compile(r'[0-9a-f]{32}\Z')
_GUARD = threading.Lock()


class Busy(APIException):
    status_code = 429
    default_detail = 'Another simulation is running'
    default_code = 'busy'


class Unavailable(APIException):
    status_code = 503
    default_detail = 'Simulation provider unavailable'
    default_code = 'unavailable'


def _safe_path(path):
    path = Path(os.path.abspath(path))
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise Unavailable()
    return path


def root():
    return _safe_path(settings.SOLAR_OUTPUT_ROOT)


def _regular(path):
    if path.is_symlink():
        raise NotFound()
    try:
        mode = path.stat().st_mode
    except OSError:
        raise NotFound() from None
    if not stat.S_ISREG(mode):
        raise NotFound()
    return path


def artifact(run_id, filename):
    if not _RUN.fullmatch(run_id) or filename not in ('run.json', 'incident.tif', 'preview.png'):
        raise NotFound()
    directory = root() / run_id
    if directory.is_symlink() or not directory.is_dir():
        raise NotFound()
    # Never follow symlinks in storage ancestors or artifact files.
    return _regular(directory / filename)


def manifest(run_id):
    path = artifact(run_id, 'run.json')
    try:
        with path.open('r', encoding='utf-8') as handle:
            result = json.load(handle)
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (OSError, ValueError):
        raise NotFound() from None


def _version():
    # Hash actual installed source bytes; no misleading claim that git HEAD is clean.
    base = Path(__file__).resolve().parents[2]
    digest = hashlib.sha256()
    for name in ('pipeline/solar/delivery.py', 'pipeline/solar/surface.py',
                 'pipeline/solar/dem.py', 'pipeline/solar/position.py', 'pipeline/solar/clearsky.py'):
        digest.update(name.encode()); digest.update((base / name).read_bytes())
    return 'sha256:' + digest.hexdigest()


def simulate(data):
    if not _GUARD.acquire(blocking=False):
        raise Busy()
    try:
        target = root()
        # Check all ancestors before making either root or cache directories.
        _safe_path(settings.SOLAR_NASADEM_CACHE)
        target.mkdir(parents=True, exist_ok=True)
        lock_path = target / '.provider.lock'
        if lock_path.is_symlink():
            raise Unavailable()
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Busy() from None
            run_id = uuid4().hex
            staging = target / ('.pending-' + run_id)
            # We own only this newly created directory; never replace an existing run.
            if staging.exists() or staging.is_symlink() or (target / run_id).exists():
                raise Unavailable()
            try:
                from pipeline.solar.nasadem import NASADEMProvider
                from pipeline.solar.surface import compute_incident_irradiance
                from pipeline.solar.delivery import export_incident
                result = compute_incident_irradiance(
                    roi=data['roi'], datetime_local=data['datetime_local'], timezone_name=data['timezone'],
                    intensity_percent=data['intensity_percent'],
                    # Preserve omission so phase A records the approved default as an assumption.
                    temperature_c=data.get('_temperature_c_input', data['temperature_c']),
                    pressure_hpa=data.get('pressure_hpa'), provider=NASADEMProvider(settings.SOLAR_NASADEM_CACHE),
                )
                exported = export_incident(result, staging, code_version=_version())
                if not isinstance(exported, dict):
                    raise ValueError('invalid export manifest')
                for name in ('run.json', 'incident.tif', 'preview.png'):
                    _regular(staging / name)
                # Persist ROI and effective input parameters before the final public rename.
                # POST and later GET must describe the same reproducible simulation.
                effective_request = {key: data.get(key) for key in (
                    'roi', 'datetime_local', 'timezone', 'intensity_percent', 'temperature_c', 'pressure_hpa')}
                effective_request['pressure_hpa'] = exported['position']['pressure_hpa']
                effective_request['pressure_provenance'] = exported['position']['pressure_provenance']
                exported = {**exported, 'request': effective_request}
                manifest_path = staging / 'run.json'
                manifest_path.write_text(json.dumps(exported, sort_keys=True, allow_nan=False) + '\n', encoding='utf-8')
                if json.loads(manifest_path.read_text(encoding='utf-8')) != exported:
                    raise ValueError('simulation manifest readback failed')
                if (target / run_id).exists() or (target / run_id).is_symlink():
                    raise Unavailable()
                os.rename(staging, target / run_id)
                return run_id, exported
            except Exception:
                if staging.is_dir() and not staging.is_symlink():
                    shutil.rmtree(staging)
                raise
        finally:
            os.close(fd)  # flock released on crash or normal exit
    except (Busy, Unavailable):
        raise
    except Exception:
        # Provider, filesystem and export errors are not leaked to public clients.
        raise Unavailable() from None
    finally:
        _GUARD.release()
