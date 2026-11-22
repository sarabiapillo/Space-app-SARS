"""Local synchronous simulation runs. IDs are public capabilities, not access control.

One shared filesystem and a file lock are required across all worker processes: POSIX flock
on Linux (servidor) and msvcrt.locking on Windows (desarrollo local). No background job,
durable queue, authentication or distributed lock is provided.
"""
import hashlib
import hmac
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

try:                                    # Linux / macOS (servidor)
    import fcntl

    def _try_lock(fd):
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)   # BlockingIOError si otro proceso lo tiene

    def _unlock(fd):
        pass                                             # se libera al cerrar el descriptor
except ImportError:                     # Windows (desarrollo local): fcntl no existe
    import msvcrt

    def _try_lock(fd):
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            raise BlockingIOError() from None

    def _unlock(fd):
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass


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


def _sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_incident_integrity(manifest_data, path, filename='incident.tif'):
    """Check SHA-256 against stored bytes in O(file size) I/O and 1 MiB memory.

    This detects accidental changes, not hostile replacement: without a signed manifest,
    an attacker able to replace both the TIFF and its manifest hash can forge consistency.
    Legacy manifests lacking this hash remain usable but are explicitly unverifiable.
    """
    files = manifest_data.get('files')
    if not isinstance(files, dict) or filename not in files:
        if 'analysis_summary' in manifest_data:
            raise ValueError('new solar run is missing its artifact hash')
        return False
    expected = files[filename]
    if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('invalid incident hash')
    if not hmac.compare_digest(_sha256_file(path), expected):
        raise ValueError('incident hash mismatch')
    return True


def _version():
    # Hash actual installed source bytes; no misleading claim that git HEAD is clean.
    base = Path(__file__).resolve().parents[2]
    digest = hashlib.sha256()
    for name in ('pipeline/solar/delivery.py', 'pipeline/solar/surface.py',
                 'pipeline/solar/dem.py', 'pipeline/solar/position.py',
                 'pipeline/solar/clearsky.py', 'pipeline/solar/time.py',
                 'pipeline/solar/radiation.py', 'pipeline/solar/terrain.py',
                 'pipeline/solar/nasadem.py', 'pipeline/elevation/nasadem.py',
                 'pipeline/solar/acquire.py',
                 'pipeline/solar/export.py', 'backend/solar/analysis.py',
                 'backend/solar/services.py', 'backend/solar/serializers.py'):
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
        # O_NOFOLLOW no existe en Windows; ahí el is_symlink() de arriba es la protección.
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        locked = False
        try:
            try:
                _try_lock(fd)
                locked = True
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
                    roi=data['roi'], elevation_deg=data['elevation_deg'],
                    azimuth_deg=data['azimuth_deg'], intensity_percent=data['intensity_percent'],
                    pressure_hpa=None, provider=NASADEMProvider(settings.SOLAR_NASADEM_CACHE),
                )
                exported = export_incident(result, staging, code_version=_version())
                if not isinstance(exported, dict):
                    raise ValueError('invalid export manifest')
                for name in ('run.json', 'incident.tif', 'preview.png'):
                    _regular(staging / name)
                from .analysis import summarize_incident
                exported['analysis_summary'] = summarize_incident(staging / 'incident.tif')
                # Bind persisted statistics to the exact numerical raster bytes.
                exported.setdefault('files', {})['incident.tif'] = _sha256_file(staging / 'incident.tif')
                # Persist ROI and effective input parameters before the final public rename.
                # POST and later GET must describe the same reproducible simulation.
                effective_request = {key: data.get(key) for key in (
                    'roi', 'elevation_deg', 'azimuth_deg', 'intensity_percent')}
                effective_request['pressure_hpa'] = exported['position']['pressure_hpa']
                effective_request['pressure_provenance'] = exported['position']['pressure_provenance']
                effective_request['reference_provenance'] = exported['clear_sky'].get('reference_provenance')
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
            if locked:
                _unlock(fd)
            os.close(fd)  # flock released on crash or normal exit
    except (Busy, Unavailable):
        raise
    except Exception:
        # Provider, filesystem and export errors are not leaked to public clients.
        raise Unavailable() from None
    finally:
        _GUARD.release()
