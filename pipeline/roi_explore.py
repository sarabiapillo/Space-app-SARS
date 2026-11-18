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
    # roi-web-3: `change` por defecto a multilook 5×5 desde potencia lineal, con ruido de referencia y
    # opciones de recálculo; no reutilizar trabajos de formatos anteriores.
    return hashlib.sha256(f'roi-web-3|{version}|{wkt}'.encode()).hexdigest()


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
    deadline = time.monotonic() + 1500
    scenes = get_source('asf').search(wkt, 'GCOV')
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
    if len(selected) == 1:
        scene = selected[0]
        progress('Leyendo bloques HTTPS del H5 y preparando capas (1/1)…')
        out = inspect_scene([scene.scene_id, '--catalogo', str(catalog), '--config', str(config),
                             '--salida', str(run_dir / 'layers'), '--sin-vista', '--sin-figuras',
                             '--escala-web', '-22', '0'])
        manifests.append(json.loads((out / 'web' / 'capas.json').read_text(encoding='utf-8')))
        charts_file = out / 'graficas.json'
        if charts_file.is_file():
            manifest = manifests[0]
            charts.append({'granuleId': manifest['escena']['granuleId'],
                           'fecha': str(manifest['escena'].get('fecha_inicio', ''))[:10],
                           'manifest': json.loads(charts_file.read_text(encoding='utf-8'))})
    else:
        progress('Leyendo y preparando las dos escenas…')
        try:
            results = _run_scene_children(run_dir, selected, deadline)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError):
            raise RoiPreparationError('No se pudo preparar una escena; puedes reintentar.') from None
        for result in results:
            manifests.append(result['manifest'])
            if result['charts'] is not None:
                charts.append(result['charts'])
    for manifest in manifests:
        if not any(layer['pct_pixeles_validos'] > 0 for layer in manifest['capas']):
            raise RoiPreparationError('La escena intersecta la ROI, pero no contiene píxeles válidos en ella.')
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
    change = None
    if comparable:
        progress('Calculando el mapa de cambio t2 − t1…')
        change = build_change(run_dir, manifests, wkt)
    progress('Guardando copia de las gráficas de la ROI…')
    copy_dir = save_chart_copy(run_dir, wkt, [run_dir / 'layers' / m['escena']['granuleId'] for m in manifests])
    write_json(run_dir / 'result.json', {'manifests': manifests, 'comparable': comparable, 'change': change,
        'charts': charts, 'copia_disco': copy_dir,
        'message': 'Capas listas. Inspección exploratoria; no identifica causas.' if comparable else
        'Capas listas. No hay un par con malla comparable; deslizador deshabilitado.'})
    write_json(run_dir / 'status.json', {'status': 'ready', 'message': 'Capas listas.'})


CHANGE_MAGNITUDE = 'gamma0'
# Combinaciones que la web puede pedir (ver docs/api-roi-jobs.md). Se limitan para acotar el costo
# por petición y el disco por ROI. Multilook n×n sobre la resolución del producto (GCOV: 10 m).
CHANGE_LOOKS = (2, 5, 10)
CHANGE_THRESHOLDS_DB = (1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0)
CHANGE_DEFAULT = (5, 3.0)
CHANGE_WEB_SCALE_DB = 6.0          # misma escala de color para cualquier umbral: solo cambian las cifras
CHANGE_CACHE_KEEP = 4              # combinaciones extra guardadas por ROI, además de la de por defecto
CHANGE_LOCK_SECONDS = 300


class ChangeBusy(RuntimeError):
    """Otra petición está calculando esa misma combinación."""


def change_options():
    return {'multilook': list(CHANGE_LOOKS), 'umbral_dB': list(CHANGE_THRESHOLDS_DB)}


def change_params(looks, threshold):
    """Valida multilook y umbral contra las opciones permitidas; devuelve (int, float)."""
    try:
        if isinstance(looks, bool) or isinstance(threshold, bool):
            raise ValueError()
        n, t = int(looks), float(threshold)
        if n != float(looks):
            raise ValueError()
    except (TypeError, ValueError):
        raise ValueError('Multilook y umbral deben ser números.') from None
    if n not in CHANGE_LOOKS:
        raise ValueError(f'Multilook no permitido; usa uno de {list(CHANGE_LOOKS)}.')
    match = next((v for v in CHANGE_THRESHOLDS_DB if math.isclose(v, t)), None)
    if match is None:
        raise ValueError(f'Umbral no permitido; usa uno de {list(CHANGE_THRESHOLDS_DB)} dB.')
    return n, match


def change_dirname(looks, threshold):
    return f'ml{looks}_u{threshold:g}'


def _load_change(out):
    manifest = json.loads((out / 'web' / 'capas.json').read_text(encoding='utf-8'))
    manifest['opciones'] = change_options()
    return manifest


def build_change(run_dir, manifests, wkt, looks=CHANGE_DEFAULT[0], threshold=CHANGE_DEFAULT[1]):
    """Mapa de cambio t2 − t1 (γ⁰ dB) → layers/cambio/ml<n>_u<umbral>/.

    Parte de la potencia lineal ya enmascarada (mask del producto + ROI) que etapa1 deja en
    ``layers/<granuleId>/geotiff/`` y hace aquí el multilook n×n (promedio lineal antes del dB). Solo
    se llama si las dos fechas son comparables y comparten malla. Devuelve el manifiesto web.
    """
    from .change import change_from_linear_cogs
    run_dir = Path(run_dir)
    t1, t2 = manifests
    pairs = {}
    for layer in t1['capas']:
        if layer.get('magnitud') != CHANGE_MAGNITUDE or not any(c['id'] == layer['id'] for c in t2['capas']):
            continue
        name = f"{CHANGE_MAGNITUDE}_{layer['capa']}.tif"
        paths = [run_dir / 'layers' / m['escena']['granuleId'] / 'geotiff' / name for m in manifests]
        if all(path.is_file() for path in paths):
            pairs[layer['capa'][:2]] = tuple(paths)
    if not pairs:
        return None
    out = run_dir / 'layers' / 'cambio' / change_dirname(looks, threshold)
    change_from_linear_cogs(pairs, out, t1_id=t1['escena']['granuleId'], t2_id=t2['escena']['granuleId'],
                            magnitude=CHANGE_MAGNITUDE, looks=looks, threshold_db=threshold, roi_wkt=wkt,
                            web_scale_db=CHANGE_WEB_SCALE_DB)
    return _load_change(out)


def recompute_change(run_dir, looks, threshold):
    """Mapa de cambio de una ROI ya preparada con otro multilook o umbral (sin volver a ASF).

    Cada combinación queda en su carpeta y se reutiliza; se guardan la de por defecto y las
    CHANGE_CACHE_KEEP más recientes.
    """
    looks, threshold = change_params(looks, threshold)
    run_dir = Path(run_dir)
    result_file = run_dir / 'result.json'
    if not result_file.is_file():
        raise ValueError('La ROI todavía no está lista.')
    result = json.loads(result_file.read_text(encoding='utf-8'))
    if not result.get('comparable') or len(result.get('manifests', [])) != 2 or not result.get('change'):
        raise ValueError('La ROI no tiene un par comparable con mapa de cambio.')
    base = run_dir / 'layers' / 'cambio'
    out = base / change_dirname(looks, threshold)
    if (out / 'web' / 'capas.json').is_file():
        return _load_change(out)
    base.mkdir(parents=True, exist_ok=True)
    lock = base / f'{out.name}.lock'
    try:
        lock.mkdir()
    except FileExistsError:
        if time.time() - lock.stat().st_mtime < CHANGE_LOCK_SECONDS:
            raise ChangeBusy('Ese mapa de cambio se está calculando; reintenta en unos segundos.') from None
        lock.touch()
    try:
        if (out / 'web' / 'capas.json').is_file():            # otra petición terminó mientras tanto
            return _load_change(out)
        if out.exists():
            shutil.rmtree(out)                                 # resto de un cálculo interrumpido
        manifest = build_change(run_dir, result['manifests'], result['change']['roi_wkt_4326'], looks, threshold)
        if manifest is None:
            raise ValueError('No se encontraron las capas lineales de las dos fechas.')
        prune_change_cache(base, CHANGE_CACHE_KEEP)
        return manifest
    finally:
        shutil.rmtree(lock, ignore_errors=True)


def prune_change_cache(base, keep):
    """Borra las combinaciones más antiguas; nunca la de por defecto ni carpetas que no sean ml<n>_u<umbral>."""
    import re
    default = change_dirname(*CHANGE_DEFAULT)
    dirs = [d for d in Path(base).iterdir()
            if d.is_dir() and d.name != default and re.fullmatch(r'ml\d+_u[\d.]+', d.name)]
    for old in sorted(dirs, key=lambda d: d.stat().st_mtime, reverse=True)[keep:]:
        shutil.rmtree(old, ignore_errors=True)


def _run_scene_children(run_dir, selected, deadline):
    children = []
    try:
        for index, scene in enumerate(selected):
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired('scene preparation', 0)
            children.append(subprocess.Popen(
                [sys.executable, '-m', 'pipeline.roi_explore', '--scene-worker', str(run_dir), scene.scene_id, str(index)],
                cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        while True:
            states = [child.poll() for child in children]
            if any(code not in (None, 0) for code in states):
                raise subprocess.CalledProcessError(next(code for code in states if code not in (None, 0)), 'scene worker')
            if all(code == 0 for code in states):
                for child in children:
                    child.wait()
                return [json.loads((Path(run_dir) / f'scene-result-{i}.json').read_text(encoding='utf-8'))
                        for i in range(len(selected))]
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired('scene preparation', 1500)
            time.sleep(min(0.1, remaining))
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


def _scene_worker(run_dir, scene_id, index):
    from .etapa1 import main as inspect_scene
    from .sources.base import SceneMeta
    run_dir = Path(run_dir)
    catalog = run_dir / 'catalog.json'
    entry = next((s for s in json.loads(catalog.read_text(encoding='utf-8'))['scenes'] if s['scene_id'] == scene_id), None)
    if entry is None:
        raise ValueError('Escena seleccionada ausente del catálogo.')
    scene = SceneMeta.from_dict(entry)
    out = inspect_scene([scene.extra.get('local_h5') or scene.scene_id, '--catalogo', str(catalog),
                         '--config', str(run_dir / 'config.yaml'), '--salida', str(run_dir / 'layers'),
                         '--sin-vista', '--sin-figuras', '--escala-web', '-22', '0'])
    manifest = json.loads((out / 'web' / 'capas.json').read_text(encoding='utf-8'))
    charts_file = out / 'graficas.json'
    charts = ({'granuleId': manifest['escena']['granuleId'],
               'fecha': str(manifest['escena'].get('fecha_inicio', ''))[:10],
               'manifest': json.loads(charts_file.read_text(encoding='utf-8'))} if charts_file.is_file() else None)
    write_json(run_dir / f'scene-result-{index}.json', {'manifest': manifest, 'charts': charts})


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
