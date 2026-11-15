"""Preparación de ROI web. Sin Django; reutiliza Etapa 1 y la fuente ASF."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from datetime import datetime, timezone

from .compat import check_pair


class RoiPreparationError(ValueError):
    """Mensaje público controlado; no incluye detalles de la sesión remota."""


def validate_roi(value):
    from shapely.geometry import shape
    try:
        if not isinstance(value, dict) or value.get('type') != 'Polygon':
            raise ValueError()
        rings = value['coordinates']
        if len(rings) != 1 or not 4 <= len(rings[0]) <= 100:
            raise ValueError()
        for p in rings[0]:
            if len(p) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in p):
                raise ValueError()
            if not -180 <= p[0] <= 180 or not -85 <= p[1] <= 85:
                raise ValueError()
        if rings[0][0] != rings[0][-1]:
            raise ValueError()
        poly = shape(value)
        if poly.is_empty or not poly.is_valid or poly.area <= 0:
            raise ValueError()
        west, south, east, north = poly.bounds
        # Límite sobre la caja leída, no solo sobre el área del polígono.
        if east - west > 0.6 or north - south > 0.6:
            raise ValueError('La ROI admite como máximo 0.6 grados por lado.')
        return poly.wkt
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
    manifests = []
    for index, scene in enumerate(selected):
        progress(f'Leyendo bloques HTTPS del H5 y preparando capas ({index + 1}/{len(selected)})…')
        out = inspect_scene([scene.scene_id, '--catalogo', str(catalog), '--config', str(config),
                             '--salida', str(run_dir / 'layers'), '--sin-vista', '--sin-figuras',
                             '--escala-web', '-22', '0'])
        manifest = json.loads((out / 'web' / 'capas.json').read_text(encoding='utf-8'))
        if not any(layer['pct_pixeles_validos'] > 0 for layer in manifest['capas']):
            raise RoiPreparationError('La escena intersecta la ROI, pero no contiene píxeles válidos en ella.')
        manifests.append(manifest)
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
    write_json(run_dir / 'result.json', {'manifests': manifests, 'comparable': comparable,
        'message': 'Capas listas. Inspección exploratoria; no identifica causas.' if comparable else
        'Capas listas. No hay un par con malla comparable; deslizador deshabilitado.'})
    write_json(run_dir / 'status.json', {'status': 'ready', 'message': 'Capas listas.'})


if __name__ == '__main__':
    import sys
    try:
        prepare(sys.argv[1])
    except Exception as exc:
        # No publicar detalles de sesiones HTTPS, URLs firmadas ni credenciales.
        message = str(exc) if isinstance(exc, RoiPreparationError) else 'No se pudo preparar la ROI. Verifica acceso Earthdata, cobertura y conexión del servidor.'
        write_json(Path(sys.argv[1]) / 'status.json', {'status': 'error', 'message': message})
        sys.exit(1)
