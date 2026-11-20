"""Trabajos privados ROI→NASADEM→DG2. Hipótesis sintéticas, no precisión hidráulica certificada.

Payload exacto: roi, domain (GeoJSON Polygon EPSG:4326); rainfall (contrato
normalize_request); rainfall_profile {interval_count,seed,distribution}; terrain
{target_crs,resolution_m,resampling}; hydraulics {manning,initial_condition,
boundary,infiltration,domain_nonurban}; simulation {duration_s,save_interval_s,
initial_tstep_s,dg2_depth_thresh_m}. boundary: 'closed', 'free' u objeto por lado
(north/east/south/west: closed, free o fixed_level con level_m); initial_condition:
'dry_zero_velocity' o 'still_water_at_fixed_level'; infiltration: 'unsupported' o
'runoff_coefficient'; atmospheric_pressure_hpa opcional (950-1040, eleva el nivel del mar fijo).
Ningún path ni binario procede del cliente.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import multiprocessing
import os
from pathlib import Path
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

from pipeline.elevation.nasadem import NASADEMProvider, _required_tiles
from .inputs import normalize_request, validate_roi
from .dem_prepared import prepare_dem, _validate_crs
from .dem_dg2 import prepare_dg2_dem
from .rainfall import generate_rainfall_profile
from .rainfall_netcdf import export_rainfall_netcdf
from .boundaries import format_boundary, normalize_boundary
from .initial_state import write_still_water_start
from .losses import barometric_surge_m, effective_rainfall, runoff_coefficient
from .roads import fetch_roads
from .lakes import CITATION as LAKES_CITATION, burn_lakes, lakes_in_bounds
from .results import summarize_results, export_depth_cog

PROJECT = Path(__file__).resolve().parents[2]
_KEYS = {'roi', 'domain', 'rainfall', 'rainfall_profile', 'terrain', 'hydraulics', 'simulation'}
_CONFIG = {'executable', 'binary_sha256', 'dem_executable', 'dem_sha256', 'timeout_s',
           'preparation_timeout_s', 'max_cells', 'max_rain_values', 'max_frames', 'max_tiles', 'code_version'}


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
    if not isinstance(config, dict) or set(config) not in (_CONFIG, _CONFIG | {'lakes_path'}):
        raise ValueError('configuración: claves inválidas')
    result = dict(config)
    if 'lakes_path' in config:
        result['lakes_path'] = str(_path(config['lakes_path']))
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


def _geometry(payload, crs, resolution, budget, tiles):
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
    if not all(math.isfinite(v) for v in (west,south,east,north)) or west < -180 or east > 180 or south < -56 or north > 60 or east-west >= 180:
        raise ValueError('rectángulo computacional fuera de cobertura NASADEM')
    geographic = box(west-1e-9,south-1e-9,east+1e-9,north+1e-9)
    if len(_required_tiles(geographic)) > tiles:
        raise ValueError('dominio excede max_tiles')
    return mapping(geographic), [left,bottom,right,top], width, height


def validate_roi_run(payload, limits):
    """Normaliza JSON y comprueba presupuestos ANTES de crear estado/red."""
    _keys(payload, _KEYS)
    try:
        if len(json.dumps(payload, allow_nan=False)) > 100_000:
            raise ValueError('solicitud demasiado grande')
    except (TypeError, OverflowError):
        raise ValueError('JSON inválido') from None
    validate_roi(payload['roi']); validate_roi(payload['domain'])
    _keys(payload['terrain'], {'target_crs','resolution_m','resampling'})
    _keys(payload['rainfall_profile'], {'interval_count','seed','distribution'})
    hydraulic_keys = {'manning','initial_condition','boundary','infiltration','domain_nonurban'}
    if (not isinstance(payload['hydraulics'], dict) or not hydraulic_keys <= set(payload['hydraulics'])
            or not set(payload['hydraulics']) <= hydraulic_keys | {'atmospheric_pressure_hpa', 'lakes'}):
        raise ValueError('hydraulics: claves inválidas')
    _keys(payload['simulation'], {'duration_s','save_interval_s','initial_tstep_s','dg2_depth_thresh_m'})
    t, h, s, rp = (payload[k] for k in ('terrain','hydraulics','simulation','rainfall_profile'))
    crs = _validate_crs(t['target_crs'])
    resolution = _number(t['resolution_m'], 100_000)
    if t['resampling'] not in ('nearest','bilinear'):
        raise ValueError('resampling inválido')
    if (h['initial_condition'] not in ('dry_zero_velocity','still_water_at_fixed_level') or
            h['infiltration'] not in ('unsupported','runoff_coefficient') or h['domain_nonurban'] is not True):
        raise ValueError('hipótesis hidráulicas explícitas requeridas')
    sides = normalize_boundary(h['boundary'])
    if h['initial_condition'] == 'still_water_at_fixed_level':
        levels = {spec['level_m'] for spec in sides.values() if spec['type'] == 'fixed_level'}
        if len(levels) != 1:
            raise ValueError('agua en reposo requiere lados de nivel fijo con un único nivel')
    lakes = h.get('lakes', 'none')
    if lakes not in ('none', 'hydrolakes'):
        raise ValueError('lakes debe ser none o hydrolakes')
    if lakes == 'hydrolakes' and not (limits.get('lakes_path') and Path(limits['lakes_path']).is_file()):
        raise ValueError('HydroLAKES no está instalado en el servidor')
    pressure = h.get('atmospheric_pressure_hpa')
    surge = 0.0
    if pressure is not None:
        surge = barometric_surge_m(pressure)
        if not any(spec['type'] == 'fixed_level' for spec in sides.values()):
            raise ValueError('la presión atmosférica solo eleva lados de nivel fijo (mar)')
    # The sea level the solver sees: requested fixed level plus the inverse-barometer surge.
    solver_sides = {side: ({**spec, 'level_m': spec['level_m'] + surge} if spec['type'] == 'fixed_level' else spec)
                    for side, spec in sides.items()}
    _number(h['manning'], 1)
    duration = _number(s['duration_s'], 86400)
    save = _number(s['save_interval_s'], duration)
    _number(s['initial_tstep_s'], duration)
    # DG2 thin-depth fallback (LISFLOOD-FP `dg2depththresh`): explicit choice, null = solver default (off).
    # It removes negative cell-average depths on thin films but changes the solution, so it is recorded.
    if s['dg2_depth_thresh_m'] is not None:
        _number(s['dg2_depth_thresh_m'], 1)
    frames = math.floor(duration / save) + 2
    if frames > limits['max_frames']:
        raise ValueError('cuadros exceden max_frames')
    normalized = normalize_request({'roi': payload['roi'], 'rainfall': payload['rainfall']})
    if normalized['rainfall']['duration_s'] > duration:
        raise ValueError('duración de lluvia supera simulación')
    coefficient = runoff_coefficient(normalized['rainfall']['duration_s']) if h['infiltration'] == 'runoff_coefficient' else None
    losses = {'infiltration': h['infiltration'], 'runoff_coefficient': coefficient,
              'atmospheric_pressure_hpa': pressure, 'barometric_surge_m': surge}
    if isinstance(rp['seed'], bool) or not isinstance(rp['seed'], int) or abs(rp['seed']) > 2**53:
        raise ValueError('seed fuera de rango')
    count = _number(rp['interval_count'], 10000, integer=True)
    if count < 2 or count % 2 or rp['distribution'] != 'uniform_balanced':
        raise ValueError('perfil no admitido')
    geography, extent, width, height = _geometry(payload, crs, resolution, limits['max_cells'], limits['max_tiles'])
    if (count + 2)*width*height > limits['max_rain_values'] or frames*width*height > limits['max_rain_values']:
        raise ValueError('presupuesto acumulado de datos excedido')
    # Construir perfil antes de cualquier escritura: evita solicitudes inconsistentes.
    generate_rainfall_profile({'roi': payload['roi'], 'rainfall': _solver_rainfall(payload['rainfall'], losses)}, **rp)
    return json.loads(json.dumps({**payload, 'terrain': {**t, 'target_crs': crs.to_string()},
                                  'computed': {'geographic_acquisition': geography, 'extent_m': extent,
                                               'width': width, 'height': height, 'frame_budget': frames,
                                               'boundary': sides, 'solver_boundary': solver_sides,
                                               'losses': losses, 'lakes': lakes}}, allow_nan=False))


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


def start_roi_run(owner, payload, *, root, config, launch=True):
    """Preflight sin efectos; crea carpeta 0700 privada y lanza worker desacoplado."""
    if not isinstance(owner, str) or not owner or len(owner) > 200:
        raise ValueError('owner requerido')
    root = _path(root)
    cfg = validate_config(config)
    request = validate_roi_run(payload, cfg)
    if root.exists() and (not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077):
        raise ValueError('root inseguro')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    run_id = str(uuid.uuid4()); directory = root / run_id
    directory.mkdir(mode=0o700)
    (directory / 'job.json').write_text(json.dumps({'payload':request,'config':cfg}, allow_nan=False), encoding='utf-8')
    state = {'id':run_id,'owner':owner,'case_id':'roi','state':'created','stage':'created',
             'synthetic':True,'hydraulic_accuracy_validated':False,
             'simulation_duration_s':request['simulation']['duration_s'],
             'save_interval_s':request['simulation']['save_interval_s'],
             'dg2_depth_thresh_m':request['simulation']['dg2_depth_thresh_m'],
             'boundary':request['computed']['boundary'],
             'initial_condition':request['hydraulics']['initial_condition'],
             'losses':request['computed']['losses'],
             'lakes':request['computed']['lakes'],
             'input_hashes':{},'binary_sha256':cfg['binary_sha256'],
             'deadline_epoch_s':time.time()+cfg['preparation_timeout_s']+cfg['timeout_s']+30}
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


def _prepare(directory, request, cfg, provider, stage, roads_fetcher=fetch_roads):
    geography = request['computed']['geographic_acquisition']
    records = provider.acquire_roi(geography)
    stage.write_text('preparation')
    if not records or len(records) > cfg['max_tiles']:
        raise ValueError('NASADEM tiles invalid')
    prepare_dem(geography, records, directory / 'prepared', target_crs=request['terrain']['target_crs'],
                resolution_m=request['terrain']['resolution_m'],resampling=request['terrain']['resampling'],
                max_cells=cfg['max_cells'],target_vertical_datum='EGM96',code_version=cfg['code_version'])
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
            raise ValueError('NASADEM coverage missing on computational grid')
        profile = src.profile.copy()
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
    prepare_dg2_dem(dem, directory / 'dg2', executable=cfg['dem_executable'],vertical_datum='EGM96',
                    code_version=cfg['code_version'],timeout_s=min(cfg['preparation_timeout_s'],120),max_cells=cfg['max_cells'])
    if _has_boundary_file(request):
        format_boundary(dem,directory/'boundary',request['computed']['solver_boundary'])
    if _still_water(request) or (lake_depth is not None and lake_depth.any()):
        write_still_water_start(directory/'dg2',directory/'initial',
                                request['computed']['solver_boundary'] if _still_water(request) else None,
                                max_cells=cfg['max_cells'],lake_depth=lake_depth)
    rainfall = _solver_rainfall(request['rainfall'],request['computed']['losses'])
    profile = generate_rainfall_profile({'roi':request['roi'],'rainfall':rainfall},**request['rainfall_profile'])
    export_rainfall_netcdf(profile,dem,directory/'rain.nc',simulation_duration_s=request['simulation']['duration_s'],
                           max_values=cfg['max_rain_values'])
    # OpenStreetMap roads for road-cut indicators; optional: an Overpass failure never stops the run.
    try:
        roads = roads_fetcher(shape(request['computed']['geographic_acquisition']).bounds)
    except Exception:
        roads = {'roads': None, 'reason': 'unavailable'}
    (directory/'roads.json').write_text(json.dumps(roads, allow_nan=False))
    return actual


def _solver_rainfall(rainfall, losses):
    """Rain the solver receives: the request, or rain x runoff coefficient when infiltration is on."""
    return rainfall if losses['runoff_coefficient'] is None else effective_rainfall(rainfall, losses['runoff_coefficient'])


def _has_boundary_file(request):
    return any(spec['type'] != 'closed' for spec in request['computed']['boundary'].values())


def _still_water(request):
    return request['hydraulics']['initial_condition'] == 'still_water_at_fixed_level'


def solver_parameter_file(request, start=None):
    """LISFLOOD-FP .par text from a validated request. All file names are constant;
    only validated numbers are interpolated, so no untrusted directive can be injected."""
    s, h = request['simulation'], request['hydraulics']
    parameter = 'dg2\n'
    if s['dg2_depth_thresh_m'] is not None:
        # Must follow `dg2`, which resets DG2DepthThresh to its default.
        parameter += f'dg2depththresh {s["dg2_depth_thresh_m"]}\n'
    # Velocity frames (.Vx/.Vy = HU/H) for flow arrows; they do not change the depth solution.
    parameter += 'voutput\n'
    parameter += ('DEMfile terrain.dem\ndirroot outputs\nresroot roi\n'
                  f'sim_time {s["duration_s"]}\nsaveint {s["save_interval_s"]}\n'
                  f'initial_tstep {s["initial_tstep_s"]}\nfpfric {h["manning"]}\n'
                  'dynamicrainfile rain.nc\n')
    if _has_boundary_file(request):
        parameter += 'bcifile boundary.bci\n'
    if _still_water(request) if start is None else start:
        # Sea and/or lakes full at start. DG2 also reads initial.wd1x / initial.wd1y (depth slope coefficients).
        parameter += 'startfile initial.wd\n'
    return parameter


def _preparation_child(directory, request, cfg, provider, stage, roads_fetcher=fetch_roads):
    os.setsid()
    try:
        stage.write_text('acquisition')
        actual = _prepare(directory,request,cfg,provider,stage,roads_fetcher)
        stage.write_text(json.dumps({'extent_m':actual}))
    except Exception as exc:
        # No exception messages or traceback: may contain credential/path data.
        stage.write_text('acquisition_failed' if stage.read_text()=='acquisition' else 'preparation_failed')
        os._exit(1)


def run_roi_worker(root, run_id, *, provider=None, roads_fetcher=fetch_roads):
    """Claim exclusivo; preparación en grupo de proceso con deadline; estado terminal."""
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
        provider = NASADEMProvider(directory/'cache')
    state.update(state='acquiring',stage='acquiring'); _save(directory,state)
    stage = directory/'preparation.stage'
    try:
        context = multiprocessing.get_context('fork')
        child = context.Process(target=_preparation_child,args=(directory,request,cfg,provider,stage,roads_fetcher))
        child.start(); child.join(cfg['preparation_timeout_s'])
        if child.is_alive():
            os.killpg(child.pid,signal.SIGKILL); child.join()
            state.update(state='timed_out',error='preparation_timeout'); return state
        if child.exitcode:
            state.update(state='failed',error=stage.read_text() if stage.exists() else 'preparation_failed'); return state
        actual = json.loads(stage.read_text())['extent_m']
        state.update(state='preparing',stage='preparing',computed_extent_m=actual); _save(directory,state)
        s,h = request['simulation'],request['hydraulics']
        started = (directory/'initial/initial.wd').is_file()
        parameter = solver_parameter_file(request,start=started)
        work = directory/'work'; work.mkdir(mode=0o700)
        sources = [('terrain.dem',directory/'dg2/terrain.dem'),('terrain.dem1x',directory/'dg2/terrain.dem1x'),
                   ('terrain.dem1y',directory/'dg2/terrain.dem1y'),('rain.nc',directory/'rain.nc')]
        if _has_boundary_file(request):
            sources.append(('boundary.bci',directory/'boundary/boundary.bci'))
        if started:
            sources += [(name,directory/'initial'/name) for name in ('initial.wd','initial.wd1x','initial.wd1y')]
        for name,source in sources:
            if source.is_symlink() or not source.is_file():
                raise ValueError('invalid prepared source')
            (work/name).write_bytes(source.read_bytes())
        (work/'roi.par').write_text(parameter)
        names = [name for name,_ in sources]+['roi.par']
        state['input_hashes'] = {name:_sha(work/name) for name in names}
        lakes_manifest = directory/'lakes/manifest.json'
        state['provenance'] = {'lakes':json.loads(lakes_manifest.read_text()) if lakes_manifest.is_file() else None,
                               'terrain':json.loads((directory/'prepared/manifest.json').read_text()),
                               'aligned_terrain_sha256':_sha(directory/'prepared/solver-terrain.tif'),
                               'aligned_extent_m':actual,
                               'dg2':json.loads((directory/'dg2/manifest.json').read_text()),
                               'rain':json.loads((directory/'rain.json').read_text()),
                               'helper_sha256':cfg['dem_sha256'], 'code_version':cfg['code_version']}
        state.update(state='running',stage='running'); _save(directory,state)
        with (directory/'solver.log').open('wb') as log:
            try:
                result = subprocess.run([cfg['executable'],'roi.par'],cwd=work,stdin=subprocess.DEVNULL,
                                        stdout=log,stderr=subprocess.STDOUT,timeout=cfg['timeout_s'],check=False)
            except subprocess.TimeoutExpired:
                state.update(state='timed_out',error='solver_timeout'); return state
        state['solver_returncode'] = result.returncode
        if result.returncode:
            raise RuntimeError('solver_failed')
        outputs = work/'outputs'
        if not outputs.is_dir() or outputs.is_symlink() or any(p.is_symlink() or not p.is_file() for p in outputs.iterdir()):
            raise ValueError('invalid solver output')
        state.update(state='results',stage='results'); _save(directory,state)
        summary = summarize_results(outputs,save_interval_s=s['save_interval_s'],crs=request['terrain']['target_crs'],max_cells=cfg['max_cells'],
                                    initial_depth=work/'initial.wd' if started else None,
                                    roads=json.loads((directory/'roads.json').read_text()) if (directory/'roads.json').is_file() else None)
        summary['lakes'] = state['provenance']['lakes']['lakes'] if state['provenance']['lakes'] else None
        if len(summary['frames'])>cfg['max_frames'] or len(summary['frames'])*request['computed']['width']*request['computed']['height']>cfg['max_rain_values']:
            raise ValueError('output budget exceeded')
        artifacts=[]
        (directory/'cogs').mkdir(mode=0o700)
        for item in [*summary['frames'],summary['maximum']]:
            source=outputs/item['file']
            if source.is_symlink():
                raise ValueError('invalid output symlink')
            target=directory/'cogs'/(item['file']+'.tif')
            info=export_depth_cog(source,target,crs=request['terrain']['target_crs'],code_version=cfg['code_version'],max_cells=cfg['max_cells'])
            with rasterio.open(target) as cog:
                geographic=transform_bounds(cog.crs,'EPSG:4326',*cog.bounds,densify_pts=21)
            artifacts.append({'file':'cogs/'+target.name,'sha256':info['output_sha256'],
                              'source_sha256':info['source_sha256'],'geographic_bounds':list(geographic),
                              'frame_index':item.get('frame_index'),'time_s':None,
                              'scheduled_time_s':item.get('scheduled_time_s')})
        state.update(state='succeeded',stage='succeeded',result=summary,artifacts=artifacts)
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
