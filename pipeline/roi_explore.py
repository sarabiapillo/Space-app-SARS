"""Preparación de ROI web. Sin Django; reutiliza Etapa 1 y la fuente ASF."""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

from .compat import check_pair


# Copia de las gráficas de cada ROI: data/graficas-roi/<id del trabajo>/<granuleId>/ (ver docs/api-roi-jobs.md).
COPY_ROOT = Path(__file__).resolve().parents[1] / 'data' / 'graficas-roi'


class RoiPreparationError(ValueError):
    """Mensaje público controlado; no incluye detalles de la sesión remota."""


def validate_roi(value):
    from shapely.geometry import shape
    try:
        if not isinstance(value, dict) or value.get('type') not in ('Polygon', 'MultiPolygon'):
            raise ValueError()
        geometry = shape(value)
        polygons = list(geometry.geoms) if geometry.geom_type == 'MultiPolygon' else [geometry]
        if not polygons or len(polygons) > 100:
            raise ValueError()
        for polygon in polygons:
            if len(polygon.exterior.coords) > 1000 or any(len(ring.coords) > 1000 for ring in polygon.interiors):
                raise ValueError()
            for ring in [polygon.exterior, *polygon.interiors]:
                for p in ring.coords:
                    if len(p) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in p):
                        raise ValueError()
                    if not -180 <= p[0] <= 180 or not -85 <= p[1] <= 85:
                        raise ValueError()
        if geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
            raise ValueError()
        west, south, east, north = geometry.bounds
        # Límite sobre la caja leída, no solo sobre el área del polígono.
        if east - west > 0.6 or north - south > 0.6:
            raise ValueError('La ROI admite como máximo 0.6 grados por lado.')
        return geometry.wkt
    except (KeyError, TypeError, IndexError, OverflowError):
        raise ValueError('Geometría Polygon inválida en EPSG:4326.') from None
    except ValueError as exc:
        raise ValueError(str(exc) or 'Geometría Polygon inválida en EPSG:4326.') from None


def cache_key(wkt, version):
    return hashlib.sha256(f'roi-web-1|{version}|{wkt}'.encode()).hexdigest()


def select_scenes(scenes):
    usable = sorted((s for s in scenes if s.product == 'GCOV' and s.maturity is not None),
                    key=lambda s: (s.start_time, s.scene_id), reverse=True)
    for latest in usable:
        for earlier in usable:
            if earlier.start_time < latest.start_time and check_pair(earlier, latest).comparable:
                return [earlier, latest]
    return usable[:1]


def write_json(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def prepare(run_dir):
    import yaml
    import rasterio
    from .sources import get_source
    from .catalog import code_version
    from .etapa1 import main as inspect_scene

    run_dir = Path(run_dir)
    request = json.loads((run_dir / 'request.json').read_text(encoding='utf-8'))
    wkt = validate_roi(request['roi'])
    def progress(message):
        write_json(run_dir / 'status.json', {'status': 'running', 'message': message})
    progress('Consultando escenas GCOV disponibles en ASF…')
    timings = {}
    total_started = time.monotonic()
    deadline = total_started + 1500  # 25 min desde el inicio; reserva 5 min del límite del proceso padre.
    phase_started = time.monotonic()
    scenes = get_source('asf').search(wkt, 'GCOV')
    timings['search_asf_seconds'] = float(time.monotonic() - phase_started)
    selected = select_scenes(scenes)
    if not selected:
        raise RoiPreparationError('No hay escenas GCOV con madurez conocida para esta ROI.')
    catalog = run_dir / 'catalog.json'
    write_json(catalog, {'created_utc': datetime.now(timezone.utc).isoformat(),
                         'code_version': code_version(), 'source': 'asf',
                         'query': {'roi_wkt': wkt, 'product': 'GCOV'},
                         'scenes': [s.to_dict() for s in scenes]})
    config = run_dir / 'config.yaml'
    config.write_text(yaml.safe_dump({'roi': {'wkt': wkt}, 'source': 'asf'}), encoding='utf-8')
    manifests, charts = [], []
    scene_timings = []
    progress(f'Leyendo y preparando {len(selected)} escena(s)…')
    if len(selected) == 1:
        scene = selected[0]
        started = time.monotonic()
        out = inspect_scene([scene.scene_id, '--catalogo', str(catalog), '--config', str(config),
                             '--salida', str(run_dir / 'layers'), '--sin-vista', '--sin-figuras',
                             '--escala-web', '-22', '0'])
        manifest = json.loads((out / 'web' / 'capas.json').read_text(encoding='utf-8'))
        manifests.append(manifest)
        charts_file = out / 'graficas.json'
        if charts_file.is_file():
            manifest = manifests[0]
            charts.append({'granuleId': manifest['escena']['granuleId'],
                           'fecha': str(manifest['escena'].get('fecha_inicio', ''))[:10],
                           'manifest': json.loads(charts_file.read_text(encoding='utf-8'))})
        scene_timings.append(float(time.monotonic() - started))
    else:
        try:
            results = _run_scene_children(run_dir, selected, deadline)
            for data in results:
                manifests.append(data['manifest'])
                scene_timings.append(data['seconds'])
                if data['charts'] is not None:
                    charts.append(data['charts'])
        except (OSError, subprocess.SubprocessError, KeyError, ValueError) as exc:
            raise RoiPreparationError('No se pudo preparar una escena; puedes reintentar.') from exc
    for manifest in manifests:
        if not any(layer['pct_pixeles_validos'] > 0 for layer in manifest['capas']):
            raise RoiPreparationError('La escena intersecta la ROI, pero no contiene píxeles válidos en ella.')
    timings['scene_processing_seconds'] = scene_timings
    phase_started = time.monotonic()
    comparable = False
    if len(manifests) == 2:
        a, b = manifests
        common = set(c['id'] for c in a['capas']) & set(c['id'] for c in b['capas'])
        comparable = bool(common)
        root = Path(__file__).resolve().parents[1]
        for layer_id in common:
            paths = [next(c['cog'] for c in m['capas'] if c['id'] == layer_id) for m in manifests]
            with rasterio.open(root / paths[0]) as x, rasterio.open(root / paths[1]) as y:
                comparable &= (x.crs == y.crs and x.transform == y.transform and x.shape == y.shape)
    timings['grid_compare_seconds'] = float(time.monotonic() - phase_started)
    progress('Guardando copia de las gráficas de la ROI…')
    phase_started = time.monotonic()
    copy_dir = save_chart_copy(run_dir, wkt, [run_dir / 'layers' / m['escena']['granuleId'] for m in manifests])
    timings['chart_copy_seconds'] = float(time.monotonic() - phase_started)
    timings['server_prepare_total_seconds'] = float(time.monotonic() - total_started)
    write_json(run_dir / 'result.json', {'manifests': manifests, 'comparable': comparable,
        'charts': charts, 'copia_disco': copy_dir, 'timings': timings,
        'message': 'Capas listas. Inspección exploratoria; no identifica causas.' if comparable else
        'Capas listas. No hay un par con malla comparable; deslizador deshabilitado.'})
    write_json(run_dir / 'status.json', {'status': 'ready', 'message': 'Capas listas.'})


def _run_scene_children(run_dir, selected, deadline):
    children = []
    try:
        for index, scene in enumerate(selected):
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired('scene preparation', max(0, deadline - time.monotonic()))
            children.append(subprocess.Popen(
                [sys.executable, '-m', 'pipeline.roi_explore', '--scene-worker', str(run_dir), scene.scene_id, str(index)],
                cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        while True:
            states = [child.poll() for child in children]
            for child, code in zip(children, states):
                if code not in (None, 0):
                    raise subprocess.CalledProcessError(code, child.args)
            if all(code == 0 for code in states):
                for child in children:
                    child.wait()
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired('scene preparation', 1500)
            time.sleep(min(0.1, remaining))
        return [json.loads((Path(run_dir) / f'scene-result-{i}.json').read_text(encoding='utf-8'))
                for i in range(len(selected))]
    except BaseException:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        raise


def save_chart_copy(run_dir, wkt, scene_dirs):
    """Copia graficas.json y metadatos.json de cada escena a COPY_ROOT/<id>/ más un resumen roi.json.

    Es la copia que se conserva aunque se limpie data/roi-runs/ (caché). Devuelve la ruta relativa
    al repo, o la absoluta si COPY_ROOT está fuera de él.
    """
    from .catalog import code_version
    dest = COPY_ROOT / Path(run_dir).name
    scenes = []
    for src in scene_dirs:
        if not (src / 'graficas.json').is_file():
            continue
        target = dest / src.name
        target.mkdir(parents=True, exist_ok=True)
        for name in ('graficas.json', 'metadatos.json'):
            if (src / name).is_file():
                shutil.copy2(src / name, target / name)
        scenes.append(src.name)
    dest.mkdir(parents=True, exist_ok=True)
    write_json(dest / 'roi.json', {'id': Path(run_dir).name, 'roi_wkt_4326': wkt, 'escenas': scenes,
                                   'creado_utc': datetime.now(timezone.utc).isoformat(),
                                   'version_codigo': code_version()})
    root = Path(__file__).resolve().parents[1]
    resolved = dest.resolve()
    return resolved.relative_to(root).as_posix() if resolved.is_relative_to(root) else resolved.as_posix()


def _scene_worker(run_dir, scene_id, index):
    from .etapa1 import main as inspect_scene

    run_dir = Path(run_dir)
    catalog = run_dir / 'catalog.json'
    scenes = json.loads(catalog.read_text(encoding='utf-8'))['scenes']
    from .sources.base import SceneMeta
    match = next((item for item in scenes if item['scene_id'] == scene_id), None)
    if match is None:
        raise ValueError('Escena seleccionada ausente del catálogo de trabajo.')
    scene = SceneMeta.from_dict(match)
    started = time.monotonic()
    entrada = scene.extra.get('local_h5') or scene.scene_id
    out = inspect_scene([entrada, '--catalogo', str(catalog), '--config', str(run_dir / 'config.yaml'),
                         '--salida', str(run_dir / 'layers'), '--sin-vista', '--sin-figuras',
                         '--escala-web', '-22', '0'])
    manifest = json.loads((out / 'web' / 'capas.json').read_text(encoding='utf-8'))
    charts_file = out / 'graficas.json'
    charts = ({'granuleId': manifest['escena']['granuleId'],
               'fecha': str(manifest['escena'].get('fecha_inicio', ''))[:10],
               'manifest': json.loads(charts_file.read_text(encoding='utf-8'))} if charts_file.is_file() else None)
    write_json(run_dir / f'scene-result-{index}.json', {
        'manifest': manifest, 'charts': charts, 'seconds': float(time.monotonic() - started)})


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--scene-worker':
        _scene_worker(sys.argv[2], sys.argv[3], int(sys.argv[4]))
        sys.exit(0)
    try:
        prepare(sys.argv[1])
    except Exception as exc:
        # No publicar detalles de sesiones HTTPS, URLs firmadas ni credenciales.
        message = str(exc) if isinstance(exc, RoiPreparationError) else 'No se pudo preparar la ROI. Verifica acceso Earthdata, cobertura y conexión del servidor.'
        write_json(Path(sys.argv[1]) / 'status.json', {'status': 'error', 'message': message})
        sys.exit(1)
