"""Trabajos locales de ROI: estado en disco y proceso aislado con tiempo límite."""
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from django.conf import settings
from django.http import FileResponse
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import NotFound, ValidationError

from pipeline.roi_explore import validate_roi, cache_key, write_json, recompute_change, ChangeBusy
from pipeline.catalog import code_version

ROOT = Path(__file__).resolve().parents[2]
POOL = ThreadPoolExecutor(max_workers=1)
LOCK = threading.Lock()
ACTIVE = set()


def base_dir():
    return Path(getattr(settings, 'ROI_OUTPUT_ROOT', ROOT / 'data' / 'roi-runs'))


def job_dir(job_id):
    if not re.fullmatch(r'[a-f0-9]{64}', job_id):
        raise NotFound()
    path = base_dir() / job_id
    if not path.is_dir():
        raise NotFound()
    return path


def copy_to_database(path):
    """Carga en PostGIS la copia de disco de las gráficas de la ROI (mismo código que load_explore).

    Si la base no está disponible, lo deja anotado en copia.json; el trabajo y la copia en disco
    siguen siendo válidos.
    """
    from scenes.management.commands.load_explore import Command as LoadExplore

    result = json.loads((path / 'result.json').read_text(encoding='utf-8'))
    copy_dir = ROOT / result['copia_disco'] if result.get('copia_disco') else None
    loaded, errors = [], []
    folders = sorted(p for p in copy_dir.iterdir() if p.is_dir()) if copy_dir and copy_dir.is_dir() else []
    for folder in folders:
        try:
            insp, n_charts, _ = LoadExplore().load(folder, f'roi-{path.name[:12]}')
            loaded.append({'granuleId': folder.name, 'code_version': insp.code_version,
                           'roi_id': str(insp.roi_id), 'graficas': n_charts})
        except Exception as exc:  # base apagada, credenciales, etc.: no exponer detalles
            errors.append(f'{folder.name}: {type(exc).__name__}')
    write_json(path / 'copia.json', {
        'disco': result.get('copia_disco'),
        'base_datos': 'ok' if loaded and not errors else ('parcial' if loaded else 'no disponible'),
        'escenas': loaded, 'errores': errors,
    })


def _stop_coordinator_tree(process):
    """Detiene solo el árbol aislado del coordinador y recoge su proceso raíz."""
    if os.name == 'posix':
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            process.kill()  # respaldo limitado al coordinador si no se puede señalizar el grupo
    elif os.name == 'nt':
        try:
            result = subprocess.run(
                ['taskkill', '/T', '/F', '/PID', str(process.pid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=False)
            if result.returncode != 0:
                process.kill()  # taskkill no confirmó la terminación del árbol
        except (OSError, subprocess.SubprocessError):
            process.kill()      # respaldo limitado al coordinador; descendientes no garantizados
    else:
        process.kill()          # plataforma no contemplada: solo raíz
    process.wait()


def run_job(path):
    process = None
    tree_stopped = False
    try:
        options = {'cwd': ROOT, 'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL}
        if os.name == 'posix':
            options['start_new_session'] = True
        process = subprocess.Popen([sys.executable, '-m', 'pipeline.roi_explore', str(path)], **options)
        try:
            returncode = process.wait(timeout=1800)
        except subprocess.TimeoutExpired:
            _stop_coordinator_tree(process)
            tree_stopped = True
            raise
        if returncode != 0:
            _stop_coordinator_tree(process)
            tree_stopped = True
            raise subprocess.CalledProcessError(returncode, process.args)
        try:
            copy_to_database(path)
        except Exception:  # la copia en base nunca invalida un trabajo terminado
            write_json(path / 'copia.json', {'base_datos': 'no disponible', 'escenas': [], 'errores': []})
        finally:
            from django.db import connection
            connection.close()   # este hilo del pool no debe dejar conexiones abiertas
    except (OSError, subprocess.SubprocessError):
        if process is not None and not tree_stopped:
            _stop_coordinator_tree(process)
        status = json.loads((path / 'status.json').read_text(encoding='utf-8'))
        if status['status'] != 'error':
            write_json(path / 'status.json', {'status': 'error', 'message': 'La preparación falló o excedió 30 minutos. Puedes reintentar.'})
    finally:
        try:
            (path / 'reservation').rmdir()
        except FileNotFoundError:
            pass
        with LOCK:
            ACTIVE.discard(path.name)


class RoiPrepare(APIView):
    def post(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError({'detail': 'Se requiere un objeto JSON con roi.'})
        try:
            wkt = validate_roi(request.data.get('roi'))
        except ValueError as exc:
            raise ValidationError({'detail': str(exc)})
        key = cache_key(wkt, code_version() + datetime.now(timezone.utc).date().isoformat())
        path = base_dir() / key
        with LOCK:
            if (path / 'result.json').exists() or key in ACTIVE:
                return Response({'id': key}, status=202)
            if len(ACTIVE) >= 3:
                return Response({'detail': 'Servidor ocupado; reintenta en unos minutos.'}, status=429)
            # Reserva atómica compartida entre procesos (VPS con varios workers).
            # Un trabajo interrumpido puede retomarse después de 35 minutos.
            path.mkdir(parents=True, exist_ok=True)
            reservation = path / 'reservation'
            try:
                reservation.mkdir()
            except FileExistsError:
                if time.time() - reservation.stat().st_mtime < 2100:
                    return Response({'id': key}, status=202)
                try:
                    reservation.rmdir()
                    reservation.mkdir()
                except (FileNotFoundError, FileExistsError):
                    return Response({'id': key}, status=202)
            write_json(path / 'request.json', {'roi': request.data['roi']})
            write_json(path / 'status.json', {'status': 'queued', 'message': 'ROI en espera…'})
            ACTIVE.add(key)
            POOL.submit(run_job, path)
        return Response({'id': key}, status=202)


def asset_urls(manifest, path, job_id):
    """Cambia las rutas png/cog del manifiesto por URLs de RoiAsset (sin exponer rutas del servidor)."""
    for layer in manifest['capas']:
        for kind in ('png', 'cog'):
            relative = (ROOT / layer[kind]).resolve().relative_to(path.resolve()).as_posix()
            layer[kind] = f'api/roi-jobs/{job_id}/assets/{relative}'
    return manifest


class RoiStatus(APIView):
    def get(self, request, job_id):
        path = job_dir(job_id)
        if not (path / 'status.json').exists():
            return Response({'status': 'queued', 'message': 'Registrando ROI…'})
        data = json.loads((path / 'status.json').read_text(encoding='utf-8'))
        if data['status'] in ('queued', 'running') and time.time() - (path / 'status.json').stat().st_mtime > 2100:
            data = {'status': 'error', 'message': 'El trabajo fue interrumpido. Puedes reintentar.'}
        if data['status'] == 'ready':
            result = json.loads((path / 'result.json').read_text(encoding='utf-8'))
            # Capas de cada fecha y, si hay par comparable, las del mapa de cambio (layers/cambio/).
            for manifest in [*result['manifests'], *([result['change']] if result.get('change') else [])]:
                asset_urls(manifest, path, job_id)
            data.update(result)
            copia = path / 'copia.json'
            data['copia'] = (json.loads(copia.read_text(encoding='utf-8')) if copia.is_file()
                             else {'disco': result.get('copia_disco'), 'base_datos': 'guardando'})
        return Response(data)


class RoiAsset(APIView):
    def get(self, request, job_id, asset):
        root = (job_dir(job_id) / 'layers').resolve()
        path = (job_dir(job_id) / asset).resolve()
        if not path.is_relative_to(root) or path.suffix not in ('.png', '.tif') or not path.is_file():
            raise NotFound()
        return FileResponse(path.open('rb'))


class RoiChange(APIView):
    """Recalcula el mapa de cambio de una ROI lista con otro multilook o umbral (ver docs/api-roi-jobs.md)."""

    def post(self, request, job_id):
        path = job_dir(job_id)
        status = path / 'status.json'
        if not status.is_file() or json.loads(status.read_text(encoding='utf-8')).get('status') != 'ready':
            return Response({'detail': 'La ROI todavía no está lista.'}, status=409)
        if not isinstance(request.data, dict) or 'multilook' not in request.data or 'umbral_dB' not in request.data:
            raise ValidationError({'detail': 'Se requiere un objeto JSON con multilook y umbral_dB.'})
        try:
            manifest = recompute_change(path, request.data['multilook'], request.data['umbral_dB'])
        except ChangeBusy as exc:
            return Response({'detail': str(exc)}, status=409)
        except ValueError as exc:
            raise ValidationError({'detail': str(exc)})
        return Response(asset_urls(manifest, path, job_id))
