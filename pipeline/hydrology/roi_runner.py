"""Trabajos privados ROI→terreno (NASADEM o Copernicus GLO-30)→DG2/FV1. Hipótesis sintéticas, no precisión hidráulica certificada.

Payload exacto: roi, domain (GeoJSON Polygon EPSG:4326); rainfall (contrato
normalize_request; null con tormenta de diseño, la calcula el servidor); rainfall_profile
{interval_count,seed,distribution} (sintética), {source:'observed',segments,provenance} (observada) o
{source:'design_storm',return_period_years,duration_h,step_s} (PXR-4 en el centroide del dominio, bloques
alternos); terrain {target_crs,resolution_m,resampling,source?} con source 'nasadem' (por defecto) o 'copernicus'
(NISAR_DEM v1.2 de ASF, elipsoidal); todas las alturas (terreno, level_m, agua en reposo) en EGM2008;
hydraulics {manning,initial_condition,boundary,infiltration,domain_nonurban} + opcionales
{atmospheric_pressure_hpa,lakes,antecedent_moisture,urban_drainage_mm_h}; simulation {duration_s,save_interval_s,
initial_tstep_s,dg2_depth_thresh_m,solver?}; solver 'dg2' (default) o 'fv1', con fallback
automático al otro si el intento falla tras la preparación. boundary: 'closed', 'free' u objeto por lado
(north/east/south/west: closed, free o fixed_level con level_m); initial_condition:
'dry_zero_velocity' o 'still_water_at_fixed_level'; manning: número (uniforme) o 'worldcover' (n por celda de
ESA WorldCover en manningfile, fpfric = mediana); infiltration: 'unsupported', 'runoff_coefficient' o
'curve_number' (lluvia neta SCS-CN por celda, WorldCover + HYSOGs250m; requiere antecedent_moisture 'auto'
(NISAR SME2 / SMAP L4) o 'I'|'II'|'III', y admite urban_drainage_mm_h >= 0); domain_nonurban: booleano declarado
(informativo: un dominio urbano se admite con aviso); atmospheric_pressure_hpa opcional (950-1040, eleva el nivel
del mar fijo y la marea). Un lado de boundary puede ser {type:'tide', mdt?} (marea astronómica EOT20 como serie HVAR
en boundary.bdy; mdt 'DTUUH22MDT' por defecto, un número de metros o null); todos los lados de marea comparten una
serie, calculada en el punto medio de esos lados; la ventana es [inicio, inicio + duration_s] con inicio =
provenance.start_utc (lluvia observada) o simulation.start_utc (obligatorio con lluvia sintética o de diseño).
terrain.bathymetry 'gebco' (opcional; 'none' por defecto) pone el fondo de GEBCO_2026 en las celdas de mar (DEM <= 0.5 m
conectadas a un lado de mar) en EGM2008 con la misma MDT. Ningún path ni binario procede del cliente. Un fallo al leer WorldCover, HYSOGs o la humedad del suelo
termina la corrida con un código propio (landcover_unavailable, soils_unavailable, soil_moisture_unavailable), sin
valores uniformes de reemplazo; sin datos PXR-4 la solicitud se rechaza con design_storm_unavailable; sin EOT20/MDT
la corrida termina con tide_unavailable y sin GEBCO con bathymetry_unavailable.
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import hashlib
import json
import math
import multiprocessing
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.warp import transform_bounds, reproject
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from shapely.geometry import shape, box, mapping
from shapely.ops import transform as project

from pipeline.elevation import copernicus
from pipeline.elevation.copernicus import CopernicusDEMProvider
from pipeline.elevation.nasadem import NASADEMProvider, _required_tiles
from pipeline.elevation.vertical_datum import DATUM, DEFAULT_GRID_DIR, GRIDS, load_grids
from .inputs import normalize_request, validate_roi
from . import design_storm as storms
from .curve_number import curve_number_grid, hsg_for_grid, net_rain_cube
from .landcover import BUILT_CLASS, landcover_for_grid, write_manning_file
from .soil_moisture import _utc as _parse_utc, antecedent_condition
from .dem_prepared import prepare_dem, _validate_crs
from .dem_dg2 import prepare_dg2_dem
from .rainfall import generate_rainfall_profile, observed_rainfall_profile
from .rainfall_netcdf import export_rainfall_cube_netcdf, export_rainfall_netcdf, roi_cell_mask
from .boundaries import SIDES, TIDE_MDT_DEFAULT, format_boundary, normalize_boundary
from . import bathymetry as seabed
from . import tides
from .initial_state import write_still_water_start
from .losses import barometric_surge_m, effective_rainfall, runoff_coefficient
from .roads import fetch_roads
from .lakes import CITATION as LAKES_CITATION, burn_lakes, lakes_in_bounds
from .results import URBAN_WARNING, NegativeDepthArtifacts, summarize_results, export_depth_cog

PROJECT = Path(__file__).resolve().parents[2]
_KEYS = {'roi', 'domain', 'rainfall', 'rainfall_profile', 'terrain', 'hydraulics', 'simulation'}
SOLVERS = ('dg2', 'fv1')
# Terrain sources: NASADEM (EGM96, 56 S-60 N) or NISAR_DEM / Copernicus GLO-30 (ellipsoidal, global).
TERRAIN_SOURCES = ('nasadem', 'copernicus')
_COVERAGE = {'nasadem': (-56, 60), 'copernicus': (-90, 90)}
INFILTRATION = ('unsupported', 'runoff_coefficient', 'curve_number')
ANTECEDENT_MOISTURE = ('auto', 'I', 'II', 'III')
MAX_URBAN_DRAINAGE_MM_H = 200.0
MAX_RETURN_PERIOD_YEARS = 1000.0
MAX_STORM_HOURS = 24.0
# Urban warning when the dominant class of some cell is built-up, or 1 % of the domain's 10 m pixels are built-up.
URBAN_FRACTION_WARNING = 0.01
HYSOGS_ATTRIBUTION = ('HYSOGs250m: Ross, C.W. et al. 2018, Global Hydrologic Soil Groups for Curve Number-Based '
                      'Runoff Modeling, ORNL DAAC, doi:10.3334/ORNLDAAC/1566')
_CONFIG = {'executable', 'binary_sha256', 'dem_executable', 'dem_sha256', 'timeout_s',
           'preparation_timeout_s', 'max_cells', 'max_rain_values', 'max_frames', 'max_tiles', 'code_version'}
_OPTIONAL_CONFIG = {'lakes_path', 'geoid_dir', 'pxr_path', 'eot20_dir', 'mdt_path'}
BATHYMETRY = ('none', 'gebco')
# Tide series step (s): at most 10 min (EOT20 tides change over hours), never longer than the run.
TIDE_STEP_S = 600.0
TIDE_YEARS = (1900, 2100)
GEBCO_ATTRIBUTION = 'GEBCO Compilation Group (2026) GEBCO 2026 Grid'
EOT20_ATTRIBUTION = 'EOT20 (Hart-Davis et al. 2021, DGFI-TUM), doi:10.17882/79489, CC BY 4.0'
MDT_ATTRIBUTION = 'DTUUH22MDT (DTU Space 2022), doi:10.11583/DTU.26947894, CC BY 4.0'
PYTMD_ATTRIBUTION = 'pyTMD 3.1.0 (MIT)'


class DatasetUnavailable(Exception):
    """An open dataset the request needs could not be read; ``code`` is the public error code."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _keys(obj, keys):
    if not isinstance(obj, dict) or set(obj) != keys:
        raise ValueError('campos desconocidos o faltantes')


def _number(value, limit, *, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or (integer and not isinstance(value, int)):
        raise ValueError('número finito positivo requerido')
    try:
        n = float(value)
    except (ValueError, OverflowError):
        raise ValueError('número fuera de rango') from None
    if not math.isfinite(n) or n <= 0 or n > limit:
        raise ValueError('número fuera de presupuesto')
    return int(value) if integer else n


def _path(value):
    p = Path(value)
    if not p.is_absolute() or any(q.is_symlink() for q in (p, *p.parents)):
        raise ValueError('ruta de servidor no segura')
    resolved = p.resolve()
    if not resolved.is_relative_to(PROJECT / 'data'):
        raise ValueError('ruta fuera de datos del proyecto')
    return resolved


def _sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_config(config):
    """Configuración exclusivamente del servidor; hashes y límites obligatorios."""
    # lakes_path (HydroLAKES GeoPackage) is optional: without it the lakes option is refused.
    # geoid_dir (EGM96/EGM2008 grids) defaults to data/reference/geoid; every run needs both grids.
    # pxr_path (PXR-4 netCDF, python -m pipeline.hydrology.design_storm prepare) is optional: without the file
    # design-storm requests are refused with design_storm_unavailable.
    # eot20_dir (EOT20 ocean tides, python -m pipeline.hydrology.tides prepare-eot20) and mdt_path (DTUUH22MDT,
    # prepare-mdt) are optional and default to data/reference/; tide runs fail with tide_unavailable without them.
    if not isinstance(config, dict) or not _CONFIG <= set(config) <= _CONFIG | _OPTIONAL_CONFIG:
        raise ValueError('configuración: claves inválidas')
    result = dict(config)
    for name in ('lakes_path', 'pxr_path', 'eot20_dir', 'mdt_path'):
        if name in config:
            result[name] = str(_path(config[name]))
    geoid = _path(config.get('geoid_dir', str(DEFAULT_GRID_DIR)))
    if not all((geoid / spec['file']).is_file() for spec in GRIDS.values()):
        raise ValueError('rejillas del geoide no instaladas (python -m pipeline.elevation.vertical_datum prepare)')
    result['geoid_dir'] = str(geoid)
    for name, digest in (('executable', 'binary_sha256'), ('dem_executable', 'dem_sha256')):
        p = _path(config[name])
        if not p.is_file() or not os.access(p, os.X_OK) or _sha(p) != config[digest]:
            raise ValueError('binario de servidor no coincide con hash fijado')
        result[name] = str(p)
    for name in ('timeout_s', 'preparation_timeout_s'):
        result[name] = _number(config[name], 120 if name == 'timeout_s' else 600)
    for name in ('max_cells', 'max_rain_values', 'max_frames', 'max_tiles'):
        result[name] = _number(config[name], 50_000_000, integer=True)
    if not isinstance(config['code_version'], str) or not config['code_version'].strip() or len(config['code_version']) > 120:
        raise ValueError('code_version requerido')
    return result


def _tiles(source, geographic):
    if source == 'copernicus':
        return copernicus.required_tiles(mapping(geographic))
    return _required_tiles(geographic)


def terrain_provider(source, cache_dir):
    """Terrain provider for ``terrain.source``; NASADEM when the payload does not name one."""
    if source == 'nasadem':
        return NASADEMProvider(cache_dir)
    if source == 'copernicus':
        return CopernicusDEMProvider(cache_dir)
    raise ValueError('fuente de terreno desconocida')


def _geometry(payload, crs, resolution, budget, tiles, source='nasadem'):
    roi, domain = shape(payload['roi']), shape(payload['domain'])
    if not domain.covers(roi):
        raise ValueError('el dominio debe cubrir completamente la ROI')
    forward = Transformer.from_crs('EPSG:4326', crs, always_xy=True).transform
    reverse = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform
    domain_xy = project(forward, domain)
    roi_xy = project(forward, roi)
    if not domain_xy.is_valid or not domain_xy.covers(roi_xy):
        raise ValueError('proyección incompatible con ROI/dominio')
    left, bottom, right, top = domain_xy.bounds
    if not all(math.isfinite(v) for v in (left, bottom, right, top)):
        raise ValueError('proyección no finita')
    # Anclar malla métrica a múltiplos de resolución; expandir dos celdas para
    # que ningún centro computacional quede fuera tras reproyección/redondeo.
    left = math.floor(left / resolution) * resolution - 2 * resolution
    bottom = math.floor(bottom / resolution) * resolution - 2 * resolution
    right = math.ceil(right / resolution) * resolution + 2 * resolution
    top = math.ceil(top / resolution) * resolution + 2 * resolution
    width, height = round((right-left)/resolution), round((top-bottom)/resolution)
    if min(width, height) < 2 or width * height > budget:
        raise ValueError('malla excede max_cells')
    # Densificar borde de rectángulo antes de volver a EPSG:4326; la
    # reproyección de esquinas solas no acota las curvas de la inversa.
    edge = []
    for a, b in ((left,bottom),(right,bottom),(right,top),(left,top)):
        edge.append((a,b))
    points = [((1-t)*edge[i][0]+t*edge[(i+1)%4][0], (1-t)*edge[i][1]+t*edge[(i+1)%4][1])
              for i in range(4) for t in (j/64 for j in range(65))]
    geo = [reverse(x,y) for x,y in points]
    west, south, east, north = min(x for x,y in geo), min(y for x,y in geo), max(x for x,y in geo), max(y for x,y in geo)
    low, high = _COVERAGE[source]
    if not all(math.isfinite(v) for v in (west,south,east,north)) or west < -180 or east > 180 or south < low or north > high or east-west >= 180:
        raise ValueError('rectángulo computacional fuera de cobertura del terreno elegido')
    geographic = box(west-1e-9,south-1e-9,east+1e-9,north+1e-9)
    if len(_tiles(source, geographic)) > tiles:
        raise ValueError('dominio excede max_tiles')
    return mapping(geographic), [left,bottom,right,top], width, height


def validate_roi_run(payload, limits, *, design_storm_reader=None):
    """Normaliza JSON y comprueba presupuestos ANTES de crear estado/red.

    ``design_storm_reader(lon, lat)`` replaces the PXR-4 cache reader (tests); the cache path is ``pxr_path``."""
    _keys(payload, _KEYS)
    try:
        if len(json.dumps(payload, allow_nan=False)) > 100_000:
            raise ValueError('solicitud demasiado grande')
    except (TypeError, OverflowError):
        raise ValueError('JSON inválido') from None
    validate_roi(payload['roi']); validate_roi(payload['domain'])
    terrain_keys = {'target_crs','resolution_m','resampling'}
    if (not isinstance(payload['terrain'], dict) or not terrain_keys <= set(payload['terrain'])
            or not set(payload['terrain']) <= terrain_keys | {'source', 'bathymetry'}):
        raise ValueError('terrain: claves inválidas')
    # Terrain source: 'nasadem' when absent, so earlier payloads keep their provider; heights end in EGM2008.
    source = payload['terrain'].get('source', 'nasadem')
    if not isinstance(source, str) or source not in TERRAIN_SOURCES:
        raise ValueError("terrain.source debe ser 'nasadem' o 'copernicus'")
    bathymetry = payload['terrain'].get('bathymetry', 'none')
    if not isinstance(bathymetry, str) or bathymetry not in BATHYMETRY:
        raise ValueError("terrain.bathymetry debe ser 'none' o 'gebco'")
    kind = payload['rainfall_profile'].get('source') if isinstance(payload['rainfall_profile'], dict) else None
    observed, design = kind == 'observed', kind == 'design_storm'
    _keys(payload['rainfall_profile'], {'source','segments','provenance'} if observed else
          {'source','return_period_years','duration_h','step_s'} if design else {'interval_count','seed','distribution'})
    if observed and not isinstance(payload['rainfall_profile']['provenance'], dict):
        raise ValueError('lluvia observada requiere su procedencia')
    hydraulic_keys = {'manning','initial_condition','boundary','infiltration','domain_nonurban'}
    if (not isinstance(payload['hydraulics'], dict) or not hydraulic_keys <= set(payload['hydraulics'])
            or not set(payload['hydraulics']) <= hydraulic_keys | {'atmospheric_pressure_hpa', 'lakes',
                                                                   'antecedent_moisture', 'urban_drainage_mm_h'}):
        raise ValueError('hydraulics: claves inválidas')
    simulation_keys = {'duration_s','save_interval_s','initial_tstep_s','dg2_depth_thresh_m'}
    if (not isinstance(payload['simulation'], dict) or not simulation_keys <= set(payload['simulation'])
            or not set(payload['simulation']) <= simulation_keys | {'solver', 'start_utc'}):
        raise ValueError('simulation: claves inválidas')
    t, h, s, rp = (payload[k] for k in ('terrain','hydraulics','simulation','rainfall_profile'))
    crs = _validate_crs(t['target_crs'])
    resolution = _number(t['resolution_m'], 100_000)
    if t['resampling'] not in ('nearest','bilinear'):
        raise ValueError('resampling inválido')
    # domain_nonurban is a declaration, not a gate: urban domains run with a visible warning.
    if (h['initial_condition'] not in ('dry_zero_velocity','still_water_at_fixed_level') or
            h['infiltration'] not in INFILTRATION or not isinstance(h['domain_nonurban'], bool)):
        raise ValueError('hipótesis hidráulicas explícitas requeridas')
    sides = normalize_boundary(h['boundary'])
    tide_sides = [side for side in SIDES if sides[side]['type'] == 'tide']
    sea_sides = [side for side in SIDES if sides[side]['type'] in ('fixed_level', 'tide')]
    if h['initial_condition'] == 'still_water_at_fixed_level':
        levels = {spec['level_m'] for spec in sides.values() if spec['type'] == 'fixed_level'}
        if tide_sides:
            # The sea starts at the tide level of t = 0, unknown until the series is computed: no fixed side beside it.
            if levels:
                raise ValueError('agua en reposo con marea: todos los lados de mar deben ser de marea (sin nivel fijo)')
        elif len(levels) != 1:
            raise ValueError('agua en reposo requiere lados de nivel fijo con un único nivel')
    if bathymetry == 'gebco' and not sea_sides:
        raise ValueError('terrain.bathymetry gebco requiere un lado de mar (fixed_level o tide)')
    lakes = h.get('lakes', 'none')
    if lakes not in ('none', 'hydrolakes'):
        raise ValueError('lakes debe ser none o hydrolakes')
    if lakes == 'hydrolakes' and not (limits.get('lakes_path') and Path(limits['lakes_path']).is_file()):
        raise ValueError('HydroLAKES no está instalado en el servidor')
    pressure = h.get('atmospheric_pressure_hpa')
    surge = 0.0
    if pressure is not None:
        surge = barometric_surge_m(pressure)
        if not sea_sides:
            raise ValueError('la presión atmosférica solo eleva lados de mar (nivel fijo o marea)')
    # The sea level the solver sees: requested fixed level plus the inverse-barometer surge.
    solver_sides = {side: ({**spec, 'level_m': spec['level_m'] + surge} if spec['type'] == 'fixed_level' else spec)
                    for side, spec in sides.items()}
    worldcover = h['manning'] == 'worldcover'
    if not worldcover:
        _number(h['manning'], 1)
    curve = h['infiltration'] == 'curve_number'
    if curve != ('antecedent_moisture' in h) or (not curve and 'urban_drainage_mm_h' in h):
        raise ValueError('antecedent_moisture (obligatoria) y urban_drainage_mm_h solo con infiltration curve_number')
    if curve and (not isinstance(h['antecedent_moisture'], str) or h['antecedent_moisture'] not in ANTECEDENT_MOISTURE):
        raise ValueError("antecedent_moisture debe ser 'auto', 'I', 'II' o 'III'")
    drainage = h.get('urban_drainage_mm_h', 0)
    if (isinstance(drainage, bool) or not isinstance(drainage, (int, float)) or not math.isfinite(drainage)
            or not 0 <= drainage <= MAX_URBAN_DRAINAGE_MM_H):
        raise ValueError('urban_drainage_mm_h debe estar entre 0 y 200 mm/h')
    duration = _number(s['duration_s'], 86400)
    tide_window = _tide_window(s, rp, observed, tide_sides, duration)
    save = _number(s['save_interval_s'], duration)
    _number(s['initial_tstep_s'], duration)
    # DG2 thin-depth fallback (LISFLOOD-FP `dg2depththresh`): explicit choice, null = solver default (off).
    # It removes negative cell-average depths on thin films but changes the solution, so it is recorded.
    if s['dg2_depth_thresh_m'] is not None:
        _number(s['dg2_depth_thresh_m'], 1)
    # Solver: 'dg2' (default when absent, so earlier payloads keep working) or 'fv1'; same binary, other keyword.
    solver = s.get('solver', 'dg2')
    if not isinstance(solver, str) or solver not in SOLVERS:
        raise ValueError("simulation.solver debe ser 'dg2' o 'fv1'")
    if solver == 'fv1' and s['dg2_depth_thresh_m'] is not None:
        raise ValueError('simulation.dg2_depth_thresh_m solo aplica a DG2: con solver fv1 debe ser null')
    frames = math.floor(duration / save) + 2
    if frames > limits['max_frames']:
        raise ValueError('cuadros exceden max_frames')
    storm = None
    rainfall = payload['rainfall']
    if design:
        # The depth comes from the server's PXR-4 data, so the client sends rainfall null and the server fills it.
        if rainfall is not None:
            raise ValueError('con tormenta de diseño, rainfall debe ser null: el servidor la calcula')
        storm = _design_storm(payload['domain'], rp, limits, design_storm_reader)
        rainfall = {'amount': storm['total_mm'], 'unit': 'mm', 'duration': storm['duration_s'], 'duration_unit': 's'}
    normalized = normalize_request({'roi': payload['roi'], 'rainfall': rainfall})
    if normalized['rainfall']['duration_s'] > duration:
        raise ValueError('duración de lluvia supera simulación')
    coefficient = runoff_coefficient(normalized['rainfall']['duration_s']) if h['infiltration'] == 'runoff_coefficient' else None
    losses = {'infiltration': h['infiltration'], 'runoff_coefficient': coefficient,
              'atmospheric_pressure_hpa': pressure, 'barometric_surge_m': surge}
    if observed:
        count = len(rp['segments']) if isinstance(rp['segments'], list) else 0
    elif design:
        count = len(storm['segments'])
    else:
        if isinstance(rp['seed'], bool) or not isinstance(rp['seed'], int) or abs(rp['seed']) > 2**53:
            raise ValueError('seed fuera de rango')
        count = _number(rp['interval_count'], 10000, integer=True)
        if count < 2 or count % 2 or rp['distribution'] != 'uniform_balanced':
            raise ValueError('perfil no admitido')
    land = _land_surface_request(h, rp, observed, drainage)
    geography, extent, width, height = _geometry(payload, crs, resolution, limits['max_cells'], limits['max_tiles'], source)
    if (count + 2)*width*height > limits['max_rain_values'] or frames*width*height > limits['max_rain_values']:
        raise ValueError('presupuesto acumulado de datos excedido')
    computed = {'geographic_acquisition': geography, 'extent_m': extent,
                'width': width, 'height': height, 'frame_budget': frames,
                'boundary': sides, 'solver_boundary': solver_sides,
                'losses': losses, 'lakes': lakes, 'land_surface': land, 'design_storm': storm}
    # Coast options only when requested, so earlier payloads keep their exact job and state.
    if tide_sides:
        computed['tide'] = {**tide_window, 'sides': tide_sides, 'mdt': sides[tide_sides[0]]['mdt'],
                            'point': _side_midpoint(extent, crs, tide_sides)}
    if bathymetry == 'gebco':
        computed['bathymetry'] = {'source': 'gebco', 'sea_sides': sea_sides,
                                  'mdt': sides[tide_sides[0]]['mdt'] if tide_sides else TIDE_MDT_DEFAULT,
                                  'point': _side_midpoint(extent, crs, sea_sides)}
    request = {**payload, 'rainfall': rainfall, 'terrain': {**t, 'target_crs': crs.to_string(), 'source': source},
               'simulation': {**s, 'solver': solver}, 'computed': computed}
    # Construir perfil antes de cualquier escritura: evita solicitudes inconsistentes.
    _rain_profile(request, losses)
    return json.loads(json.dumps(request, allow_nan=False))


def _tide_window(s, rp, observed, tide_sides, duration):
    """Event window of the tide series: observed rain starts at its series start, other rain at simulation.start_utc.

    ``simulation.start_utc`` is only accepted with tide sides and without observed rain (one event time)."""
    if 'start_utc' in s and not tide_sides:
        raise ValueError('simulation.start_utc solo aplica con lados de marea')
    if not tide_sides:
        return None
    if observed:
        if 'start_utc' in s:
            raise ValueError('con lluvia observada la marea empieza en provenance.start_utc: no envíes simulation.start_utc')
        raw, basis = (rp['provenance'] or {}).get('start_utc'), 'rain_series_start'
        missing = 'marea con lluvia observada requiere provenance.start_utc'
    else:
        raw, basis = s.get('start_utc'), 'simulation_start'
        missing = 'los lados de marea requieren simulation.start_utc (lluvia sintética o de diseño)'
    if not isinstance(raw, str):
        raise ValueError(missing)
    try:
        start = _parse_utc(raw)
    except (TypeError, ValueError):
        raise ValueError(missing + ' (ISO 8601 con zona horaria)') from None
    if not TIDE_YEARS[0] <= start.year <= TIDE_YEARS[1]:
        raise ValueError('inicio de marea fuera de 1900-2100')
    step = min(TIDE_STEP_S, float(duration))
    end = start + dt.timedelta(seconds=math.ceil(duration / step - 1e-9) * step)
    iso = lambda moment: moment.isoformat().replace('+00:00', 'Z')
    return {'start_utc': iso(start), 'end_utc': iso(end), 'step_s': step, 'event_time_basis': basis}


def _side_midpoint(extent, crs, sides):
    """Mean of the midpoints of ``sides`` of the computational rectangle, as [lon, lat] (EPSG:4326)."""
    left, bottom, right, top = extent
    middle = {'north': ((left + right) / 2, top), 'south': ((left + right) / 2, bottom),
              'west': (left, (bottom + top) / 2), 'east': (right, (bottom + top) / 2)}
    x = sum(middle[side][0] for side in sides) / len(sides)
    y = sum(middle[side][1] for side in sides) / len(sides)
    lon, lat = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform(x, y)
    return [float(lon), float(lat)]


def _design_storm(domain, rp, limits, reader):
    """PXR-4 alternating-block storm at the domain centroid; request errors are ValueError, missing data is not."""
    period = rp['return_period_years']
    if (isinstance(period, bool) or not isinstance(period, (int, float)) or not math.isfinite(period)
            or not 1 < period <= MAX_RETURN_PERIOD_YEARS):
        raise ValueError('return_period_years debe estar en (1, 1000] años')
    hours = _number(rp['duration_h'], MAX_STORM_HOURS)
    step = rp['step_s']
    if isinstance(step, bool) or not isinstance(step, int) or step <= 0:
        raise ValueError('step_s debe ser un entero positivo de segundos')
    blocks = round(hours * 3600 / step)
    if blocks < 1 or not math.isclose(blocks * step, hours * 3600, rel_tol=0, abs_tol=1e-6) or blocks > 10_000:
        raise ValueError('step_s debe dividir exactamente la duración (como máximo 10 000 bloques)')
    centre = shape(domain).centroid
    if reader is None:
        reader = storms.Pxr4Reader(limits.get('pxr_path') or storms.DEFAULT_PATH)
    try:
        storm = storms.design_storm(centre.x, centre.y, hours, period, step, reader=reader)
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        # Missing cache, a cell without parameters or a non-monotonic curve: data, not the request.
        raise DatasetUnavailable('design_storm_unavailable') from None
    return {**storm, 'point': [centre.x, centre.y]}


def _land_surface_request(h, rp, observed, drainage):
    """Requested land-surface options; values found during preparation (fpfric, AMC, built-up) start as null."""
    curve = None
    if h['infiltration'] == 'curve_number':
        event, basis = None, None
        if h['antecedent_moisture'] == 'auto':
            if observed:
                # Observed rain: the soil before the series starts.
                try:
                    event = _parse_utc(rp['provenance']['start_utc'])
                except (KeyError, TypeError, ValueError):
                    raise ValueError('humedad previa auto con lluvia observada requiere provenance.start_utc') from None
                event, basis = rp['provenance']['start_utc'], 'rain_series_start'
            else:
                # Synthetic or design rain is hypothetical: the soil as it is when the run starts.
                event, basis = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'run_start'
        curve = {'antecedent_moisture': h['antecedent_moisture'], 'event_time_utc': event, 'event_time_basis': basis,
                 'urban_drainage_mm_h': float(drainage), 'amc': None if h['antecedent_moisture'] == 'auto' else h['antecedent_moisture'],
                 'amc_source': None if h['antecedent_moisture'] == 'auto' else 'request', 'relative_saturation': None,
                 'gross_rain_mm': None, 'mean_net_rain_mm': None, 'mean_runoff_coefficient': None, 'cn_mean': None}
    worldcover = h['manning'] == 'worldcover'
    return {'manning': 'worldcover' if worldcover else 'uniform', 'manning_value': None if worldcover else h['manning'],
            'manning_fpfric': None, 'infiltration': h['infiltration'], 'curve_number': curve,
            'urban': {'declared_nonurban': h['domain_nonurban'], 'built_up_fraction': None, 'built_up_cells': None,
                      'warning': not h['domain_nonurban']},
            'attribution': []}


def _directory(root, run_id):
    if str(uuid.UUID(str(run_id))) != str(run_id):
        raise ValueError('UUID inválido')
    directory = _path(root) / run_id
    if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
        raise ValueError('directorio de trabajo inseguro')
    return directory


def _save(directory, state):
    temp = directory / ('.state-' + str(uuid.uuid4()))
    with temp.open('x', encoding='utf-8') as output:
        json.dump(state, output, allow_nan=False)
        output.flush(); os.fsync(output.fileno())
    os.replace(temp, directory / 'state.json')


def get_roi_run(root, run_id):
    directory = _directory(root, run_id)
    with (directory / 'state.json').open() as stream:
        state = json.load(stream)
    if state['state'] in ('created','acquiring','preparing','running','results'):
        marker = directory / 'worker.pid'
        if marker.exists():
            try:
                pid = int(marker.read_text())
                if pid <= 0:
                    raise ValueError('PID inválido')
                os.kill(pid, 0)
                proc = Path('/proc') / str(pid) / 'stat'
                dead = proc.exists() and proc.read_text().split(') ',1)[1].startswith('Z ')
            except (ProcessLookupError, ValueError, IndexError):
                dead = True
            except PermissionError:
                dead = False
            if dead:
                with (directory / 'state.json').open() as stream:
                    state = json.load(stream)
                if state['state'] in ('created','acquiring','preparing','running','results'):
                    state.update(state='failed', error='worker_stopped'); _save(directory,state)
        elif time.time() > state['deadline_epoch_s']:
            state.update(state='timed_out', error='worker_deadline'); _save(directory,state)
    return state


def start_roi_run(owner, payload, *, root, config, launch=True, design_storm_reader=None):
    """Preflight sin efectos; crea carpeta 0700 privada y lanza worker desacoplado."""
    if not isinstance(owner, str) or not owner or len(owner) > 200:
        raise ValueError('owner requerido')
    root = _path(root)
    cfg = validate_config(config)
    request = validate_roi_run(payload, cfg, design_storm_reader=design_storm_reader)
    if root.exists() and (not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077):
        raise ValueError('root inseguro')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    run_id = str(uuid.uuid4()); directory = root / run_id
    directory.mkdir(mode=0o700)
    (directory / 'job.json').write_text(json.dumps({'payload':request,'config':cfg}, allow_nan=False), encoding='utf-8')
    state = {'id':run_id,'owner':owner,'case_id':'roi','state':'created','stage':'created',
             'synthetic':request['rainfall_profile'].get('source') != 'observed','hydraulic_accuracy_validated':False,
             'simulation_duration_s':request['simulation']['duration_s'],
             'save_interval_s':request['simulation']['save_interval_s'],
             'dg2_depth_thresh_m':request['simulation']['dg2_depth_thresh_m'],
             # solver = the one whose results are shown (or last tried); solver_fallback = {from,to,reason} or null.
             'requested_solver':request['simulation']['solver'],'solver':request['simulation']['solver'],
             'solver_fallback':None,'solver_attempts':[],
             'boundary':request['computed']['boundary'],
             'initial_condition':request['hydraulics']['initial_condition'],
             'losses':request['computed']['losses'],
             'lakes':request['computed']['lakes'],
             # Land surface (Manning, Curve Number, antecedent moisture, urban) and the rain source; values found
             # during preparation are filled in by the worker.
             'land_surface':request['computed']['land_surface'],
             'rainfall_source':request['rainfall_profile'].get('source','synthetic'),
             'design_storm':_storm_summary(request['computed']['design_storm']),
             # Terrain provider and the single vertical datum of every height (terrain, level_m, still water).
             'terrain_source':request['terrain']['source'],'vertical_datum':DATUM,
             'terrain_attribution':(copernicus.ATTRIBUTION + '. ' + copernicus.DISCLAIMER
                                    if request['terrain']['source'] == 'copernicus' else None),
             'input_hashes':{},'binary_sha256':cfg['binary_sha256'],
             **_coast_state(request['computed']),
             # Two solver attempts at most (requested solver, then the automatic fallback).
             'deadline_epoch_s':time.time()+cfg['preparation_timeout_s']+2*cfg['timeout_s']+30}
    _save(directory,state)
    if launch:
        try:
            proc = subprocess.Popen([sys.executable,'-m','pipeline.hydrology.roi_runner','--worker',run_id,'--root',str(root)],
                                    cwd=PROJECT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, start_new_session=True)
            (directory / 'worker.pid').write_text(str(proc.pid), encoding='ascii')
        except OSError:
            state.update(state='failed',error='worker_launch_failed'); _save(directory,state)
    return get_roi_run(root,run_id)


def _coast_state(computed):
    """Requested tide / GEBCO options for the state (values found during preparation start as null); absent
    keys when not requested, so earlier payloads keep their exact state."""
    state = {}
    tide = computed.get('tide')
    if tide:
        state['tide'] = {'model': 'EOT20', **{k: tide[k] for k in ('sides', 'mdt', 'start_utc', 'end_utc', 'step_s',
                                                                  'event_time_basis', 'point')},
                         'node': None, 'mdt_m': None, 'datum': None, 'barometric_surge_m': None,
                         'start_level_m': None, 'min_m': None, 'max_m': None, 'count': None, 'attribution': None}
    bathymetry = computed.get('bathymetry')
    if bathymetry:
        state['bathymetry'] = {'source': 'gebco', 'dataset': 'GEBCO_2026 Grid', 'sea_sides': bathymetry['sea_sides'],
                               'mdt': bathymetry['mdt'], 'mdt_m': None, 'datum': None, 'replaced_cells': None,
                               'min_elevation_m': None, 'attribution': GEBCO_ATTRIBUTION}
    return state


def _storm_summary(storm):
    """Design storm for status/results: no segments (they are in the rain provenance)."""
    if not storm:
        return None
    keys = ('total_mm', 'duration_s', 'step_s', 'return_period_years', 'extrapolated', 'within_stated_accuracy', 'point')
    return {**{key: storm[key] for key in keys}, 'method': storm['method'], 'dataset': storm['provenance']['dataset'],
            'version': storm['provenance']['version'], 'doi': storm['provenance']['doi'],
            'licence': storm['provenance']['licence'], 'attribution': storm['provenance']['attribution'],
            'cell': storm['provenance']['cell']}


def _prepare(directory, request, cfg, provider, stage, roads_fetcher=fetch_roads, datasets=None):
    geography = request['computed']['geographic_acquisition']
    records = provider.acquire_roi(geography)
    stage.write_text('preparation')
    if not records or len(records) > cfg['max_tiles']:
        raise ValueError('terrain tiles invalid')
    # Every height in EGM2008: NASADEM (EGM96) and NISAR_DEM (ellipsoidal) are converted with the pinned geoid grids.
    prepare_dem(geography, records, directory / 'prepared', target_crs=request['terrain']['target_crs'],
                resolution_m=request['terrain']['resolution_m'],resampling=request['terrain']['resampling'],
                max_cells=cfg['max_cells'],target_vertical_datum=DATUM,code_version=cfg['code_version'],
                geoid_grids=load_grids(cfg.get('geoid_dir', DEFAULT_GRID_DIR)))
    # prepare_dem masks the inverse geographic envelope, not an exact projected
    # rectangle. Sample its validated tiles onto the declared aligned solver grid;
    # reject ANY unknown centre rather than fill it with invented ground.
    dem = directory / 'prepared/solver-terrain.tif'
    left,bottom,right,top = request['computed']['extent_m']
    width,height = request['computed']['width'],request['computed']['height']
    cell = request['terrain']['resolution_m']
    transform = from_origin(left,top,cell,cell)
    with rasterio.open(directory/'prepared/terrain.tif') as src:
        if src.crs != rasterio.crs.CRS.from_user_input(request['terrain']['target_crs']):
            raise ValueError('unexpected source CRS')
        values = np.full((height,width),np.nan,dtype='float32')
        reproject(rasterio.band(src,1),values,src_transform=src.transform,src_crs=src.crs,
                  src_nodata=np.nan,dst_transform=transform,dst_crs=src.crs,dst_nodata=np.nan,
                  resampling=Resampling.nearest)
        if not np.isfinite(values).all():
            raise ValueError('terrain coverage missing on computational grid')
        profile = src.profile.copy()
    if request['computed'].get('bathymetry'):
        values = _apply_bathymetry(directory, request, cfg, values, transform, datasets or {})
    lake_depth = None
    if request['computed']['lakes'] == 'hydrolakes':
        # HydroLAKES bed dug into the aligned DEM before DG2 coefficients; recorded with the lakes used.
        found = lakes_in_bounds(cfg['lakes_path'],shape(geography).bounds)
        values,lake_depth,records = burn_lakes(values,transform,request['terrain']['target_crs'],found)
        values = values.astype('float32')
        (directory/'lakes').mkdir()
        np.save(directory/'lakes/lake-depth.npy',lake_depth)
        (directory/'lakes/manifest.json').write_text(json.dumps({'citation':LAKES_CITATION,'lakes':records,
            'method':'surface = median DEM of lake cells; depth grows with distance to shore, mean = Depth_avg; '
                      'terrain change from an estimated depth, not surveyed bathymetry'},allow_nan=False))
    profile.update(height=height,width=width,transform=transform,nodata=float('nan'))
    with rasterio.open(dem,'w',**profile) as dst:
        dst.write(values,1)
    actual = [left,bottom,right,top]
    prepare_dg2_dem(dem, directory / 'dg2', executable=cfg['dem_executable'],vertical_datum=DATUM,
                    code_version=cfg['code_version'],timeout_s=min(cfg['preparation_timeout_s'],120),max_cells=cfg['max_cells'])
    tide = _tide(directory, request, cfg, datasets or {}) if request['computed'].get('tide') else None
    if _has_boundary_file(request):
        format_boundary(dem,directory/'boundary',request['computed']['solver_boundary'],tide=tide)
    if _still_water(request) or (lake_depth is not None and lake_depth.any()):
        write_still_water_start(directory/'dg2',directory/'initial',
                                request['computed']['solver_boundary'] if _still_water(request) else None,
                                max_cells=cfg['max_cells'],lake_depth=lake_depth,
                                tide_level_m=tide[0][1] if tide and _still_water(request) else None)
    land = _land_surface(directory, request, dem, datasets or {})
    profile = _rain_profile(request, request['computed']['losses'])
    if land is not None and land.get('cn') is not None:
        _export_net_rain(directory, request, cfg, dem, profile, land)
    else:
        export_rainfall_netcdf(profile,dem,directory/'rain.nc',simulation_duration_s=request['simulation']['duration_s'],
                               max_values=cfg['max_rain_values'])
    # OpenStreetMap roads for road-cut indicators; optional: an Overpass failure never stops the run.
    try:
        roads = roads_fetcher(shape(request['computed']['geographic_acquisition']).bounds)
    except Exception:
        roads = {'roads': None, 'reason': 'unavailable'}
    (directory/'roads.json').write_text(json.dumps(roads, allow_nan=False))
    return actual


def _mdt_reader(cfg, datasets):
    return datasets.get('mdt_reader') or functools.partial(tides.mdt_offset_m, path=cfg.get('mdt_path', tides.DEFAULT_MDT_PATH))


def _tide_provider(cfg, datasets):
    """``tide_series`` injected (tests) or EOT20 + DTUUH22MDT from the server caches."""
    if datasets.get('tide_series'):
        return datasets['tide_series']
    constants = functools.partial(tides.eot20_constants, directory=cfg.get('eot20_dir', tides.DEFAULT_EOT20_DIR))
    return functools.partial(tides.tide_series, constants_reader=constants, mdt_reader=_mdt_reader(cfg, datasets))


def _tide(directory, request, cfg, datasets):
    """EOT20 tide at the tide sides' midpoint for the event window, plus the barometric surge: the HVAR series.

    Writes tide/manifest.json ({summary, provenance}); a missing cache or a point without ocean raises
    DatasetUnavailable('tide_unavailable')."""
    spec = request['computed']['tide']
    lon, lat = spec['point']
    try:
        found = _tide_provider(cfg, datasets)(lon, lat, spec['start_utc'], spec['end_utc'], spec['step_s'], mdt=spec['mdt'])
        series = [(float(t), float(level)) for t, level in found['series']]
        if not series or not all(math.isfinite(t) and math.isfinite(level) for t, level in series):
            raise ValueError('empty tide series')
    except Exception:
        raise DatasetUnavailable('tide_unavailable') from None
    provenance = dict(found.get('provenance') or {})
    surge = request['computed']['losses']['barometric_surge_m']
    series = [(t, level + surge) for t, level in series]
    levels = [level for _, level in series]
    sampling = provenance.get('sampling') or {}
    attribution = [EOT20_ATTRIBUTION, PYTMD_ATTRIBUTION]
    if spec['mdt'] == TIDE_MDT_DEFAULT:
        attribution.insert(1, MDT_ATTRIBUTION)
    summary = {'model': 'EOT20', **{k: spec[k] for k in ('sides', 'mdt', 'start_utc', 'end_utc', 'step_s',
                                                         'event_time_basis', 'point')},
               # Ocean node used: the point itself (bilinear) or the nearest EOT20 ocean node within 10 km.
               'node': sampling.get('node') or spec['point'], 'sampling': sampling.get('method'),
               'mdt_m': provenance.get('offset_m'), 'datum': provenance.get('datum'), 'barometric_surge_m': surge,
               # Levels the solver receives (tide + MDT + surge), metres on EGM2008.
               'start_level_m': levels[0], 'min_m': min(levels), 'max_m': max(levels), 'count': len(series),
               'attribution': attribution}
    out = directory / 'tide'
    out.mkdir(mode=0o700)
    (out / 'manifest.json').write_text(json.dumps({'summary': summary, 'provenance': provenance},
                                                  allow_nan=False, default=_json_default))
    return series


def _apply_bathymetry(directory, request, cfg, values, transform, datasets):
    """GEBCO_2026 sea floor (MSL + MDT = EGM2008) on the sea cells of the aligned DEM; writes bathymetry/manifest.json.

    Sea cells: GEBCO < 0, DEM <= 0.5 m and connected to a sea-side edge (bathymetry.sea_cell_elevations)."""
    spec = request['computed']['bathymetry']
    try:
        offset, record = spec['mdt'], None
        if spec['mdt'] == TIDE_MDT_DEFAULT:
            offset, record = _mdt_reader(cfg, datasets)(*spec['point'])
        reader = datasets.get('gebco_reader') or seabed.gebco_on_grid
        found = seabed.sea_cell_elevations(values, transform, request['terrain']['target_crs'], msl_offset_m=offset,
                                           gebco_reader=reader, sea_edges=spec['sea_sides'])
    except Exception:
        raise DatasetUnavailable('bathymetry_unavailable') from None
    replaced = found['sea'] & np.isfinite(found['elevation'])
    values = np.where(replaced, found['elevation'], values).astype('float32')
    datum = found['provenance']['datum']
    if spec['mdt'] == TIDE_MDT_DEFAULT:
        datum = 'EGM2008 (approx.: GEBCO on MSL + DTUUH22MDT on XGM2019e; XGM2019e - EGM2008 not applied)'
    summary = {'source': 'gebco', 'dataset': 'GEBCO_2026 Grid', 'sea_sides': spec['sea_sides'], 'mdt': spec['mdt'],
               'mdt_m': offset, 'datum': datum, 'replaced_cells': int(replaced.sum()),
               'min_elevation_m': float(values[replaced].min()) if replaced.any() else None,
               'attribution': GEBCO_ATTRIBUTION}
    out = directory / 'bathymetry'
    out.mkdir(mode=0o700)
    provenance = {**found['provenance'], 'mdt': record}
    (out / 'manifest.json').write_text(json.dumps({'summary': summary, 'provenance': provenance},
                                                  allow_nan=False, default=_json_default))
    return values


def _land_surface(directory, request, dem, datasets):
    """WorldCover classes / Manning file and, for Curve Number, HYSOGs groups, antecedent moisture and CN per cell.

    Returns None when the request needs no land data. Writes landcover/manifest.json (and manning.n,
    curve-number.npy); a dataset that cannot be read raises DatasetUnavailable, never a uniform substitute."""
    spec = request['computed']['land_surface']
    curve = spec['infiltration'] == 'curve_number'
    if spec['manning'] != 'worldcover' and not curve:
        return None
    out = directory / 'landcover'
    out.mkdir(mode=0o700)
    with rasterio.open(dem) as src:
        grid = ((src.height, src.width), src.transform, src.crs.to_string())
    try:
        land = landcover_for_grid(*grid, reader=datasets.get('landcover_reader'))
    except Exception:
        raise DatasetUnavailable('landcover_unavailable') from None
    classes, built = land['classes'], land['built_fraction']
    built_cells = int(np.count_nonzero(classes == BUILT_CLASS))
    fraction = float(np.nanmean(built)) if np.isfinite(built).any() else 0.0
    urban = {'declared_nonurban': spec['urban']['declared_nonurban'], 'built_up_fraction': fraction,
             'built_up_cells': built_cells,
             'warning': (not spec['urban']['declared_nonurban']) or built_cells > 0 or fraction >= URBAN_FRACTION_WARNING,
             'rule': f'warning when a cell is mostly built-up (WorldCover class 50) or >= {URBAN_FRACTION_WARNING:g} '
                     'of the domain 10 m pixels are built-up, or the domain is declared urban'}
    summary = {'urban': urban, 'attribution': [land['provenance']['attribution'] + ' (CC BY 4.0)'], 'manning_fpfric': None}
    manifest = {'landcover': land['provenance'], 'urban': urban}
    if spec['manning'] == 'worldcover':
        finite = land['manning'][np.isfinite(land['manning'])]
        # LISFLOOD-FP replaces NODATA cells of manningfile by fpfric: the median of the known cells.
        summary['manning_fpfric'] = round(float(np.median(finite)), 6)
        write_manning_file(out / 'manning.n', land['manning'], template_dem=directory / 'dg2/terrain.dem')
        manifest['manning'] = {'file': 'manning.n', 'fpfric': summary['manning_fpfric'],
                               'fpfric_rule': 'median of the per-cell Manning values (NODATA fallback)',
                               'nodata_cells': int(np.count_nonzero(~np.isfinite(land['manning']))),
                               'sha256': _sha(out / 'manning.n')}
    result = {'summary': summary, 'built_fraction': built, 'cn': None, 'amc': None}
    if curve:
        try:
            soils = hsg_for_grid(*grid, reader=datasets.get('soil_reader'))
        except Exception:
            raise DatasetUnavailable('soils_unavailable') from None
        moisture = _antecedent(request, spec['curve_number'], datasets.get('antecedent') or antecedent_condition)
        cn = curve_number_grid(classes, soils['hsg'], amc=moisture['amc'])
        np.save(out / 'curve-number.npy', cn)
        manifest.update(soils=soils['provenance'], antecedent_moisture=moisture['provenance'])
        summary['attribution'].append(HYSOGS_ATTRIBUTION)
        if moisture['source'] not in (None, 'request'):
            summary['attribution'].append(moisture['provenance'].get('citation') or moisture['source'])
        summary['curve_number'] = {'amc': moisture['amc'], 'amc_source': moisture['source'],
                                   'relative_saturation': moisture['relative_saturation'],
                                   'cn_mean': float(np.nanmean(cn)) if np.isfinite(cn).any() else None}
        result.update(cn=cn, amc=moisture['amc'])
    manifest['summary'] = summary
    (out / 'manifest.json').write_text(json.dumps(manifest, allow_nan=False, default=_json_default))
    return result


def _json_default(value):
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f'not JSON serialisable: {type(value).__name__}')


def _antecedent(request, spec, lookup):
    """Antecedent moisture condition: the requested class, or NISAR SME2 / SMAP L4 before the event (``auto``).

    'auto' falls back to AMC II only when the services answered without a usable observation (recorded);
    when every source failed to answer, the run stops with soil_moisture_unavailable."""
    if spec['antecedent_moisture'] != 'auto':
        return {'amc': spec['antecedent_moisture'], 'source': 'request', 'relative_saturation': None,
                'provenance': {'method': 'antecedent moisture condition given in the request'}}
    bounds = shape(request['computed']['geographic_acquisition']).bounds
    try:
        found = lookup(bounds, spec['event_time_utc'])
    except Exception:
        raise DatasetUnavailable('soil_moisture_unavailable') from None
    tried = (found.get('provenance') or {}).get('tried') or []
    if found.get('source') is None and tried and all(item.get('outcome') == 'error' for item in tried):
        raise DatasetUnavailable('soil_moisture_unavailable')
    if found.get('amc') not in ('I', 'II', 'III'):
        raise DatasetUnavailable('soil_moisture_unavailable')
    provenance = dict(found.get('provenance') or {})
    # Error reasons may carry service URLs or messages: keep only what was tried and its outcome.
    provenance['tried'] = [{k: v for k, v in item.items() if k != 'reason' or item.get('outcome') != 'error'}
                           for item in tried]
    provenance['source'] = found.get('source')
    return {'amc': found['amc'], 'source': found.get('source'), 'relative_saturation': found.get('relative_saturation'),
            'provenance': provenance}


def _export_net_rain(directory, request, cfg, dem, profile, land):
    """SCS-CN net rain per cell (zero outside the ROI cells, as the uniform profile) to rain.nc and rain.json."""
    spec = request['computed']['land_surface']['curve_number']
    mask = roi_cell_mask(request['roi'], dem)
    cube, summary = net_rain_cube(profile['segments'], land['cn'], built_fraction=land['built_fraction'],
                                  urban_drainage_mm_h=spec['urban_drainage_mm_h'])
    cube = cube * mask[None]
    gross = float(summary['total_rain_mm'])
    net = cube.sum(axis=0)[mask]
    method = {'method': 'scs_curve_number_incremental', 'curve_number': summary, 'gross_profile': profile,
              'roi_cells': int(mask.sum()),
              'roi_mean_net_mm': [float(v) for v in cube[:, mask].mean(axis=1)],
              'roi_gross_mm': [float(v) for v in summary['interval_rain_mm']],
              'roi_mean_net_total_mm': float(net.mean()), 'gross_total_mm': gross,
              'roi_mean_runoff_coefficient': float(net.mean() / gross) if gross > 0 else 0.0,
              'amc': land['amc'],
              'spatial_policy': 'net rain per ROI cell centre; zero outside the ROI, as the uniform profile'}
    export_rainfall_cube_netcdf(cube, summary['interval_edges_s'], dem, directory / 'rain.nc',
                                simulation_duration_s=request['simulation']['duration_s'], method=method,
                                synthetic=profile['synthetic'] is True, observed=profile.get('observed', False) is True,
                                max_values=cfg['max_rain_values'])


def _rain_profile(request, losses):
    """Rain profile the solver receives: synthetic from ``rainfall``, or an observed series (e.g. IMERG).

    An observed series must add up to the declared ``rainfall`` amount over the declared duration.
    """
    rp = request['rainfall_profile']
    if rp.get('source') == 'design_storm':
        # Hypothetical storm: synthetic, served through the same per-interval path as an observed series.
        storm = request['computed']['design_storm']
        profile = observed_rainfall_profile(request['roi'], storm['segments'], storm['provenance'],
                                            scale=losses['runoff_coefficient'] or 1.0)
        return {**profile, 'synthetic': True, 'observed': False, 'design_storm': True}
    if rp.get('source') != 'observed':
        return generate_rainfall_profile({'roi': request['roi'], 'rainfall': _solver_rainfall(request['rainfall'], losses)}, **rp)
    declared = normalize_request({'roi': request['roi'], 'rainfall': request['rainfall']})['rainfall']
    series = observed_rainfall_profile(request['roi'], rp['segments'], rp['provenance'])['rainfall']
    if (not math.isclose(series['amount_m'], declared['amount_m'], rel_tol=1e-9, abs_tol=1e-12)
            or not math.isclose(series['duration_s'], declared['duration_s'], rel_tol=1e-12)):
        raise ValueError('rainfall debe coincidir con el total y la duración de la serie observada')
    return observed_rainfall_profile(request['roi'], rp['segments'], rp['provenance'],
                                     scale=losses['runoff_coefficient'] or 1.0)


def _solver_rainfall(rainfall, losses):
    """Rain the solver receives: the request, or rain x runoff coefficient when infiltration is on."""
    return rainfall if losses['runoff_coefficient'] is None else effective_rainfall(rainfall, losses['runoff_coefficient'])


def _has_boundary_file(request):
    return any(spec['type'] != 'closed' for spec in request['computed']['boundary'].values())


def _still_water(request):
    return request['hydraulics']['initial_condition'] == 'still_water_at_fixed_level'


def solver_parameter_file(request, start=None, solver=None, fpfric=None):
    """LISFLOOD-FP .par text from a validated request. All file names are constant;
    only validated numbers are interpolated, so no untrusted directive can be injected.

    ``solver`` overrides the requested one (automatic fallback); the same 8.0.3 binary takes `dg2` or `fv1`.
    With ``manning: 'worldcover'`` the per-cell ``manningfile manning.n`` is read by both solvers and ``fpfric``
    (the median found during preparation) fills its NODATA cells."""
    s, h = request['simulation'], request['hydraulics']
    worldcover = h['manning'] == 'worldcover'
    if worldcover and (isinstance(fpfric, bool) or not isinstance(fpfric, (int, float)) or not 0 < fpfric < 1):
        raise ValueError('Manning por cobertura requiere fpfric de la preparación')
    solver = solver or s.get('solver', 'dg2')
    if solver not in SOLVERS:
        raise ValueError('solver inválido')
    parameter = f'{solver}\n'
    if solver == 'dg2' and s['dg2_depth_thresh_m'] is not None:
        # Must follow `dg2`, which resets DG2DepthThresh to its default.
        parameter += f'dg2depththresh {s["dg2_depth_thresh_m"]}\n'
    # Velocity frames (.Vx/.Vy = HU/H) for flow arrows; they do not change the depth solution.
    parameter += 'voutput\n'
    parameter += ('DEMfile terrain.dem\ndirroot outputs\nresroot roi\n'
                  f'sim_time {s["duration_s"]}\nsaveint {s["save_interval_s"]}\n'
                  f'initial_tstep {s["initial_tstep_s"]}\nfpfric {fpfric if worldcover else h["manning"]}\n'
                  'dynamicrainfile rain.nc\n')
    if worldcover:
        parameter += 'manningfile manning.n\n'
    if _has_boundary_file(request):
        parameter += 'bcifile boundary.bci\n'
    if request['computed'].get('tide'):
        # HVAR series of the tide sides (LISFLOOD-FP `bdyfile`, input.cpp:1949).
        parameter += 'bdyfile boundary.bdy\n'
    if _still_water(request) if start is None else start:
        # Sea and/or lakes full at start. DG2 also reads initial.wd1x / initial.wd1y (depth slope coefficients); FV1 only initial.wd.
        parameter += 'startfile initial.wd\n'
    return parameter


def _preparation_child(directory, request, cfg, provider, stage, roads_fetcher=fetch_roads, datasets=None):
    os.setsid()
    try:
        stage.write_text('acquisition')
        actual = _prepare(directory,request,cfg,provider,stage,roads_fetcher,datasets)
        stage.write_text(json.dumps({'extent_m':actual}))
    except DatasetUnavailable as exc:
        # Public code only (landcover_unavailable, soils_unavailable, soil_moisture_unavailable).
        stage.write_text(exc.code)
        os._exit(1)
    except Exception as exc:
        # No exception messages or traceback: may contain credential/path data.
        stage.write_text('acquisition_failed' if stage.read_text()=='acquisition' else 'preparation_failed')
        os._exit(1)


class _AttemptFailed(Exception):
    """One solver attempt failed after preparation; ``reason`` is a public code."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def other_solver(solver):
    """The automatic fallback: DG2 -> FV1 and FV1 -> DG2."""
    return 'fv1' if solver == 'dg2' else 'dg2'


def _solver_inputs(directory, request, solver, started):
    """Prepared files the solver reads. FV1 reads neither the DG2 slope coefficients of the DEM (.dem1x/.dem1y)
    nor those of the start depth (initial.wd1x/.wd1y): only DG2 loads them (swe/dg2new.cpp)."""
    sources = [('terrain.dem',directory/'dg2/terrain.dem')]
    if solver == 'dg2':
        sources += [('terrain.dem1x',directory/'dg2/terrain.dem1x'),('terrain.dem1y',directory/'dg2/terrain.dem1y')]
    sources.append(('rain.nc',directory/'rain.nc'))
    if request['hydraulics']['manning'] == 'worldcover':
        sources.append(('manning.n',directory/'landcover/manning.n'))
    if _has_boundary_file(request):
        sources.append(('boundary.bci',directory/'boundary/boundary.bci'))
    if request['computed'].get('tide'):
        sources.append(('boundary.bdy',directory/'boundary/boundary.bdy'))
    if started:
        sources += [(name,directory/'initial'/name) for name in
                    (('initial.wd','initial.wd1x','initial.wd1y') if solver == 'dg2' else ('initial.wd',))]
    return sources


def _attempt(directory, request, cfg, state, solver, name, started, summarizer):
    """Run one solver in its own directory and summarize it; raises _AttemptFailed on a solver or output failure.

    Staging errors (missing prepared files) are not solver failures: they propagate and fail the run."""
    work = directory/name; work.mkdir(mode=0o700)
    sources = _solver_inputs(directory,request,solver,started)
    for file_name,source in sources:
        if source.is_symlink() or not source.is_file():
            raise ValueError('invalid prepared source')
        (work/file_name).write_bytes(source.read_bytes())
    fpfric = (state.get('land_surface') or {}).get('manning_fpfric')
    (work/'roi.par').write_text(solver_parameter_file(request,start=started,solver=solver,fpfric=fpfric))
    state['input_hashes'] = {file_name:_sha(work/file_name) for file_name in [n for n,_ in sources]+['roi.par']}
    state.update(state='running',stage='running'); _save(directory,state)
    with (directory/('solver.log' if name == 'work' else 'solver-fallback.log')).open('wb') as log:
        try:
            result = subprocess.run([cfg['executable'],'roi.par'],cwd=work,stdin=subprocess.DEVNULL,
                                    stdout=log,stderr=subprocess.STDOUT,timeout=cfg['timeout_s'],check=False)
        except subprocess.TimeoutExpired:
            raise _AttemptFailed('solver_timeout') from None
    state['solver_returncode'] = result.returncode
    if result.returncode:
        raise _AttemptFailed('solver_failed')
    cogs = directory/'cogs'
    try:
        outputs = work/'outputs'
        if not outputs.is_dir() or outputs.is_symlink() or any(p.is_symlink() or not p.is_file() for p in outputs.iterdir()):
            raise ValueError('invalid solver output')
        state.update(state='results',stage='results'); _save(directory,state)
        summary = summarizer(outputs,save_interval_s=request['simulation']['save_interval_s'],crs=request['terrain']['target_crs'],
                             max_cells=cfg['max_cells'],initial_depth=work/'initial.wd' if started else None,
                             roads=json.loads((directory/'roads.json').read_text()) if (directory/'roads.json').is_file() else None)
        summary['lakes'] = state['provenance']['lakes']['lakes'] if state['provenance']['lakes'] else None
        if ((state.get('land_surface') or {}).get('urban') or {}).get('warning'):
            summary['warnings'] = [*summary.get('warnings', []), URBAN_WARNING]
        if len(summary['frames'])>cfg['max_frames'] or len(summary['frames'])*request['computed']['width']*request['computed']['height']>cfg['max_rain_values']:
            raise ValueError('output budget exceeded')
        artifacts=[]
        cogs.mkdir(mode=0o700)
        for item in [*summary['frames'],summary['maximum']]:
            source=outputs/item['file']
            if source.is_symlink():
                raise ValueError('invalid output symlink')
            target=cogs/(item['file']+'.tif')
            info=export_depth_cog(source,target,crs=request['terrain']['target_crs'],code_version=cfg['code_version'],
                                  max_cells=cfg['max_cells'],clip_negative=True)
            with rasterio.open(target) as cog:
                geographic=transform_bounds(cog.crs,'EPSG:4326',*cog.bounds,densify_pts=21)
            artifacts.append({'file':'cogs/'+target.name,'sha256':info['output_sha256'],
                              'source_sha256':info['source_sha256'],'geographic_bounds':list(geographic),
                              'frame_index':item.get('frame_index'),'time_s':None,
                              'scheduled_time_s':item.get('scheduled_time_s')})
        return {'summary':summary,'artifacts':artifacts}
    except Exception as exc:
        # A failed attempt leaves no partial COGs behind for the next one.
        if cogs.is_dir() and not cogs.is_symlink():
            shutil.rmtree(cogs)
        raise _AttemptFailed('negative_depth_artifacts' if isinstance(exc, NegativeDepthArtifacts) else 'output_invalid') from None


def _record_land_surface(state, manifest):
    """Values found during preparation into the public land_surface summary; full provenance stays private."""
    summary = manifest['summary']
    land = state.setdefault('land_surface', {})
    land.update(manning_fpfric=summary['manning_fpfric'], urban={**land.get('urban', {}), **summary['urban']},
                attribution=summary['attribution'])
    if summary.get('curve_number') and land.get('curve_number') is not None:
        land['curve_number'].update(summary['curve_number'])
        rain = state['provenance']['rain'].get('method') or {}
        land['curve_number'].update(gross_rain_mm=rain.get('gross_total_mm'), mean_net_rain_mm=rain.get('roi_mean_net_total_mm'),
                                    mean_runoff_coefficient=rain.get('roi_mean_runoff_coefficient'))
    state['provenance']['land_surface'] = manifest


def run_roi_worker(root, run_id, *, provider=None, roads_fetcher=fetch_roads, summarizer=summarize_results,
                   landcover_reader=None, soil_reader=None, antecedent=None, tide_series=None, gebco_reader=None,
                   mdt_reader=None):
    """Claim exclusivo; preparación en grupo de proceso con deadline; estado terminal.

    ``landcover_reader`` (WorldCover tile window), ``soil_reader`` (HYSOGs window), ``antecedent``
    (soil_moisture.antecedent_condition), ``tide_series`` (tides.tide_series), ``gebco_reader``
    (bathymetry.gebco_on_grid) and ``mdt_reader`` (tides.mdt_offset_m) replace the data readers in tests."""
    datasets = {'landcover_reader': landcover_reader, 'soil_reader': soil_reader, 'antecedent': antecedent,
                'tide_series': tide_series, 'gebco_reader': gebco_reader, 'mdt_reader': mdt_reader}
    directory = _directory(root,run_id)
    try:
        fd = os.open(directory/'worker.claim',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        os.close(fd)
    except FileExistsError:
        raise ValueError('worker already claimed')
    state = get_roi_run(root,run_id)
    if state['state'] != 'created':
        raise ValueError('run not created')
    job = json.loads((directory/'job.json').read_text())
    request,cfg = job['payload'],validate_config(job['config'])
    if provider is None:
        # Jobs created before the terrain choice used NASADEM.
        provider = terrain_provider(request['terrain'].get('source','nasadem'), directory/'cache')
    state.update(state='acquiring',stage='acquiring'); _save(directory,state)
    stage = directory/'preparation.stage'
    try:
        context = multiprocessing.get_context('fork')
        child = context.Process(target=_preparation_child,args=(directory,request,cfg,provider,stage,roads_fetcher,datasets))
        child.start(); child.join(cfg['preparation_timeout_s'])
        if child.is_alive():
            os.killpg(child.pid,signal.SIGKILL); child.join()
            state.update(state='timed_out',error='preparation_timeout'); return state
        if child.exitcode:
            state.update(state='failed',error=stage.read_text() if stage.exists() else 'preparation_failed'); return state
        actual = json.loads(stage.read_text())['extent_m']
        state.update(state='preparing',stage='preparing',computed_extent_m=actual); _save(directory,state)
        started = (directory/'initial/initial.wd').is_file()
        lakes_manifest = directory/'lakes/manifest.json'
        requested = request['simulation'].get('solver','dg2')  # jobs created before the solver choice ran DG2
        state.setdefault('solver_attempts',[]); state.setdefault('solver_fallback',None)
        state['provenance'] = {'lakes':json.loads(lakes_manifest.read_text()) if lakes_manifest.is_file() else None,
                               'terrain':json.loads((directory/'prepared/manifest.json').read_text()),
                               'aligned_terrain_sha256':_sha(directory/'prepared/solver-terrain.tif'),
                               'aligned_extent_m':actual,
                               'dg2':json.loads((directory/'dg2/manifest.json').read_text()),
                               'rain':json.loads((directory/'rain.json').read_text()),
                               'helper_sha256':cfg['dem_sha256'], 'code_version':cfg['code_version'],
                               'terrain_source':request['terrain'].get('source','nasadem'),
                               'requested_solver':requested,'solver':requested,'solver_fallback':None}
        land_manifest = directory/'landcover/manifest.json'
        if land_manifest.is_file():
            _record_land_surface(state, json.loads(land_manifest.read_text()))
        for name in ('tide', 'bathymetry'):
            manifest = directory/name/'manifest.json'
            if manifest.is_file():
                # Public summary in the state; the full provenance (EOT20 sampling, MDT record, GEBCO rule) stays private.
                found = json.loads(manifest.read_text())
                state[name] = found['summary']; state['provenance'][name] = found
        # Requested solver first; if its attempt fails after preparation, the other solver runs once on the same
        # prepared inputs in its own directory. Preparation failures never reach here (both would fail alike).
        failure = None
        for solver,name in ((requested,'work'),(other_solver(requested),'work-fallback')):
            if failure is not None:
                state['solver_fallback'] = state['provenance']['solver_fallback'] = {'from':requested,'to':solver,'reason':failure}
            state['solver'] = state['provenance']['solver'] = solver
            try:
                outcome = _attempt(directory,request,cfg,state,solver,name,started,summarizer)
            except _AttemptFailed as exc:
                state['solver_attempts'].append({'solver':solver,'outcome':'failed','reason':exc.reason})
                failure = failure or exc.reason
                continue
            state['solver_attempts'].append({'solver':solver,'outcome':'succeeded','reason':None})
            summary = {**outcome['summary'],'requested_solver':requested,'solver':solver,'solver_fallback':state['solver_fallback']}
            state.update(state='succeeded',stage='succeeded',result=summary,artifacts=outcome['artifacts'])
            return state
        # Both attempts failed: the run reports the first attempt's error; solver_attempts lists both.
        if failure == 'solver_timeout':
            state.update(state='timed_out',error='solver_timeout')
        else:
            state.update(state='failed',error=failure if failure == 'negative_depth_artifacts' else 'preparation_or_output_invalid')
    except Exception:
        state.update(state='failed',error='preparation_or_output_invalid')
    finally:
        _save(directory,state)
    return state


def main():
    parser=argparse.ArgumentParser(description='Worker interno ROI DG2; solo trabajos creados por servidor.')
    parser.add_argument('--worker',required=True,help='UUID interno')
    parser.add_argument('--root',required=True,help='Directorio privado del servidor')
    args=parser.parse_args()
    run_roi_worker(args.root,args.worker)


if __name__=='__main__':
    main()
