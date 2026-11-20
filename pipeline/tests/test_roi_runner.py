"""Contrato público mínimo del flujo ROI (sin credenciales ni descargas reales)."""
import hashlib
import math
import json
from pathlib import Path
import uuid
import zipfile

import numpy as np
import pytest
import rasterio
from scipy.io import netcdf_file

from pipeline.elevation.nasadem import NASADEMGranule, _required_tiles, _validated_geometry
from pipeline.hydrology.roi_runner import validate_roi_run, start_roi_run, run_roi_worker, get_roi_run, solver_parameter_file

BASE = Path(__file__).resolve().parents[2] / 'data/test-runs'
BIN = Path(__file__).resolve().parents[2] / 'data/tools/lisflood-fp-8.0/runtime/build'


def polygon(x0, y0, x1, y1):
    return {'type': 'Polygon', 'coordinates': [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}


def payload():
    return {'roi': polygon(-92.9998, 16.8, -92.9995, 16.8003),
            'domain': polygon(-92.9999,16.7998,-92.9993,16.8005),
            'rainfall': {'amount': 2, 'unit': 'mm', 'duration': 1, 'duration_unit': 's'},
            'rainfall_profile': {'interval_count': 2, 'seed': 7, 'distribution': 'uniform_balanced'},
            'terrain': {'target_crs': 'EPSG:32615', 'resolution_m': 20, 'resampling': 'nearest'},
            'hydraulics': {'manning': .02, 'initial_condition': 'dry_zero_velocity', 'boundary': 'free', 'infiltration': 'unsupported', 'domain_nonurban': True},
            'simulation': {'duration_s': 2, 'save_interval_s': 1, 'initial_tstep_s': .1, 'dg2_depth_thresh_m': None}}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def config():
    return {'executable': str(BIN / 'lisflood'), 'binary_sha256': sha(BIN / 'lisflood'),
            'dem_executable': str(BIN / 'generateDG2DEM'), 'dem_sha256': sha(BIN / 'generateDG2DEM'),
            'timeout_s': 15, 'preparation_timeout_s': 25, 'max_cells': 1000,
            'max_rain_values': 5000, 'max_frames': 5, 'max_tiles': 2, 'code_version': 'roi-seam-test'}


@pytest.fixture
def root():
    return BASE / f'roi-dg2-{uuid.uuid4()}'


@pytest.mark.parametrize('change', [
    lambda p: p.pop('domain'),
    lambda p: p['terrain'].update(resolution_m=True),
    lambda p: p['rainfall'].update(amount=float('inf')),
    lambda p: p['domain'].update(coordinates=polygon(-94,16.8,-93.9,16.9)['coordinates']),
    lambda p: p['simulation'].update(save_interval_s=.000001),
    lambda p: p['hydraulics'].update(infiltration='yes'),
    lambda p: p.update(extra='ignored'),
    lambda p: p['simulation'].pop('dg2_depth_thresh_m'),
    lambda p: p['simulation'].update(dg2_depth_thresh_m=0),
    lambda p: p['simulation'].update(dg2_depth_thresh_m=-.02),
    lambda p: p['simulation'].update(dg2_depth_thresh_m=1.5),
    lambda p: p['simulation'].update(dg2_depth_thresh_m=True),
    lambda p: p['simulation'].update(dg2_depth_thresh_m='0.02'),
    lambda p: p['simulation'].update(dg2_depth_thresh_m=float('nan')),
])
def test_bad_input_never_creates_jobs(root, change):
    p = payload(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert not root.exists()


@pytest.mark.parametrize('threshold', [None, .02])
def test_thin_depth_threshold_is_recorded_in_state(root, threshold):
    p = payload(); p['simulation']['dg2_depth_thresh_m'] = threshold
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert job['dg2_depth_thresh_m'] == threshold
    assert get_roi_run(root, job['id'])['dg2_depth_thresh_m'] == threshold


def test_parameter_file_enables_thin_depth_threshold_right_after_dg2():
    request = validate_roi_run({**payload(), 'simulation': {**payload()['simulation'], 'dg2_depth_thresh_m': .02}}, config())
    lines = solver_parameter_file(request).splitlines()
    assert lines[:2] == ['dg2', 'dg2depththresh 0.02']
    assert lines.count('dg2depththresh 0.02') == 1


def test_parameter_file_without_threshold_keeps_previous_directives():
    request = validate_roi_run(payload(), config())
    assert solver_parameter_file(request) == ('dg2\nvoutput\nDEMfile terrain.dem\ndirroot outputs\nresroot roi\n'
                                              'sim_time 2\nsaveint 1\ninitial_tstep 0.1\nfpfric 0.02\n'
                                              'dynamicrainfile rain.nc\nbcifile boundary.bci\n')


def test_parameter_file_requests_velocity_output_for_flow_arrows():
    request = validate_roi_run({**payload(), 'simulation': {**payload()['simulation'], 'dg2_depth_thresh_m': .02}}, config())
    assert solver_parameter_file(request).splitlines()[:3] == ['dg2', 'dg2depththresh 0.02', 'voutput']


SEA_WEST = {'north': {'type': 'closed'}, 'east': {'type': 'free'}, 'south': {'type': 'closed'},
            'west': {'type': 'fixed_level', 'level_m': 100.5}}


def with_sea(initial='still_water_at_fixed_level', sides=SEA_WEST):
    p = payload()
    p['hydraulics'].update(boundary=sides, initial_condition=initial)
    return p


@pytest.mark.parametrize('change', [
    lambda p: p['hydraulics'].update(boundary='open'),
    lambda p: p['hydraulics'].update(initial_condition='still_water_at_fixed_level'),
    lambda p: p['hydraulics'].update(boundary={**SEA_WEST, 'north': {'type': 'fixed_level', 'level_m': 3}},
                                     initial_condition='still_water_at_fixed_level'),
    lambda p: p['hydraulics'].update(initial_condition='wet'),
])
def test_boundary_and_initial_condition_must_be_consistent(root, change):
    p = payload(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert not root.exists()


def test_boundary_sides_and_initial_condition_are_recorded_in_state(root):
    job = start_roi_run('alice', with_sea(), root=root, config=config(), launch=False)
    assert job['boundary'] == SEA_WEST and job['initial_condition'] == 'still_water_at_fixed_level'
    legacy = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    assert legacy['boundary'] == {s: {'type': 'free'} for s in ('north', 'east', 'south', 'west')}
    assert legacy['initial_condition'] == 'dry_zero_velocity'


def test_parameter_file_boundary_and_start_directives():
    closed = payload(); closed['hydraulics']['boundary'] = 'closed'
    assert 'bcifile' not in solver_parameter_file(validate_roi_run(closed, config()))
    lines = solver_parameter_file(validate_roi_run(with_sea(), config())).splitlines()
    assert 'bcifile boundary.bci' in lines and 'startfile initial.wd' in lines
    assert 'startfile initial.wd' not in solver_parameter_file(validate_roi_run(with_sea('dry_zero_velocity'), config()))


def test_native_fixed_level_starts_and_keeps_still_water(root):
    # Flat 100 m terrain with a west sea at 100.5 m: the whole domain starts 0.5 m deep and must stay at rest.
    job = start_roi_run('alice', with_sea(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    work = root / job['id'] / 'work'
    bci = (work / 'boundary.bci').read_text().splitlines()
    assert [line.split()[0] for line in bci] == ['E', 'W'] and bci[1].endswith('HFIX 100.5')
    assert {'initial.wd', 'initial.wd1x', 'initial.wd1y'} <= set(state['input_hashes'])
    first = state['result']['frames'][0]['stats']
    assert first['min_m'] == pytest.approx(.5, abs=1e-3) and first['max_m'] == pytest.approx(.5, abs=1e-3)
    last = state['result']['frames'][-1]['stats']
    assert last['max_m'] == pytest.approx(.502, abs=.01)  # 0.5 m sea plus the 2 mm of rain inside the ROI
    assert state['result']['flow']['frames'][-1]['max_speed_m_s'] < .05


@pytest.mark.parametrize('change', [
    lambda p: p['hydraulics'].update(infiltration='green_ampt'),
    lambda p: p['hydraulics'].update(atmospheric_pressure_hpa=1000),  # no fixed-level side to raise
    lambda p: p['hydraulics'].update(boundary=SEA_WEST, atmospheric_pressure_hpa=900),
    lambda p: p['hydraulics'].update(boundary=SEA_WEST, atmospheric_pressure_hpa='1000'),
])
def test_losses_and_pressure_reject_invalid_or_ineffective_values(root, change):
    p = payload(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert not root.exists()


def test_losses_and_pressure_are_recorded_in_state(root):
    p = with_sea(); p['hydraulics'].update(infiltration='runoff_coefficient', atmospheric_pressure_hpa=1003.25)
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    losses = job['losses']
    assert losses['infiltration'] == 'runoff_coefficient' and losses['atmospheric_pressure_hpa'] == 1003.25
    assert losses['runoff_coefficient'] == pytest.approx(.65 + .27 * (1 - math.exp(-.5 / 24)))
    assert losses['barometric_surge_m'] == pytest.approx(1000 / 9810)
    legacy = start_roi_run('alice', payload(), root=root, config=config(), launch=False)['losses']
    assert legacy == {'infiltration': 'unsupported', 'runoff_coefficient': None,
                      'atmospheric_pressure_hpa': None, 'barometric_surge_m': 0.0}


def test_native_pressure_raises_the_sea_and_infiltration_reduces_the_rain(root):
    p = with_sea(); p['hydraulics'].update(infiltration='runoff_coefficient', atmospheric_pressure_hpa=1003.25)
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    surge, coefficient = 1000 / 9810, job['losses']['runoff_coefficient']
    bci = (root / job['id'] / 'work' / 'boundary.bci').read_text().splitlines()
    assert float(bci[1].split()[-1]) == pytest.approx(100.5 + surge)
    assert state['result']['frames'][0]['stats']['min_m'] == pytest.approx(.5 + surge, abs=1e-3)
    rain = state['provenance']['rain']['profile']['rainfall']['amount_m']
    assert rain == pytest.approx(.002 * coefficient)


def no_roads(bounds):
    return {'roads': [], 'provenance': {'attribution': '© OpenStreetMap contributors', 'osm_timestamp': 'test'}}


def test_native_roads_are_fetched_for_the_domain_and_a_failure_does_not_stop_the_run(root):
    # The fetcher runs in the forked preparation process: it reports the bounds it got through its result.
    def fetch(bounds):
        return {'roads': [], 'provenance': {'bounds': list(bounds)}}
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=fetch)
    assert state['state'] == 'succeeded', state
    west, south, east, north = state['result']['roads']['bounds']
    assert west <= -92.9999 and east >= -92.9993 and south <= 16.7998 and north >= 16.8005  # covers the domain
    assert state['result']['roads']['available'] and state['result']['roads']['total_km'] == 0

    def broken(bounds):
        raise OSError('Overpass down')
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=broken)
    assert state['state'] == 'succeeded', state
    assert state['result']['roads'] == {'available': False, 'reason': 'unavailable'}


def lake_config(tmp_path, depth=2.0):
    import geopandas as gpd
    from shapely.geometry import box
    # Server paths must live under the project data/ directory (validate_config).
    path = BASE / f'lakes-{uuid.uuid4()}.gpkg'
    gpd.GeoDataFrame([{'Hylak_id': 42, 'Lake_name': 'Test lake', 'Lake_area': .002, 'Depth_avg': depth,
                       'Vol_total': 0.0, 'Elevation': 100}],
                     geometry=[box(-92.99985, 16.79995, -92.99945, 16.80035)], crs='EPSG:4326').to_file(path, layer='lakes', driver='GPKG')
    return {**config(), 'lakes_path': str(path)}


@pytest.mark.parametrize('lakes, with_dataset', [('hydrolakes', False), ('glwd', True)])
def test_lakes_option_needs_a_known_source_installed_on_the_server(root, tmp_path, lakes, with_dataset):
    p = payload(); p['hydraulics']['lakes'] = lakes
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=lake_config(tmp_path) if with_dataset else config(), launch=False)
    assert not root.exists()


def test_native_hydrolakes_lake_starts_full_over_a_burned_bed(root, tmp_path):
    p = payload(); p['hydraulics']['lakes'] = 'hydrolakes'
    job = start_roi_run('alice', p, root=root, config=lake_config(tmp_path), launch=False)
    assert job['lakes'] == 'hydrolakes'
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    [lake] = state['result']['lakes']
    assert lake['hylak_id'] == 42 and lake['depth_avg_m'] == 2.0 and lake['cells'] > 0 and lake['surface_m'] == 100
    assert 'startfile initial.wd' in (root / job['id'] / 'work' / 'roi.par').read_text().splitlines()
    # Lake full from the first frame; a 2 x 2-cell lake with dug vertical walls loses ~1 % at the shore
    # in the first step (DG2 wet/dry adjustment, as with the sea).
    assert state['result']['frames'][0]['stats']['max_m'] == pytest.approx(2.0, rel=.05)
    assert 'HydroLAKES' in state['provenance']['lakes']['citation']


def flat_provider(root, run_id):
    class Provider:
        def acquire_roi(self, geometry):
            cache = root / run_id / 'cache'
            cache.mkdir(exist_ok=True)
            records = []
            for tile in _required_tiles(_validated_geometry(geometry)):
                path = cache / (tile + '.zip')
                with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(tile + '.hgt', np.full((3601,3601), 100, dtype='>i2').tobytes())
                records.append(NASADEMGranule(tile, 'NASADEM_HGT_' + tile, 'NASADEM_HGT', '001', path))
            return records
    return Provider()


def test_acquisition_failure_is_terminal_and_sanitized(root):
    class Failed:
        def acquire_roi(self, geometry):
            raise RuntimeError('authentication secret=private')
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=Failed(), roads_fetcher=no_roads)
    assert state['state'] == 'failed' and state['error'] == 'acquisition_failed'
    assert 'private' not in json.dumps(state) and get_roi_run(root, job['id']) == state


def test_native_roi_dem_rain_and_depth_cogs(root):
    class Provider:
        def acquire_roi(self, geometry):
            cache = root / run_id / 'cache'
            cache.mkdir(exist_ok=True)
            # Cubrir TODAS las teselas del rectángulo computacional real; el
            # dominio a caballo del meridiano −93 necesita ambas, no una.
            tiles = _required_tiles(_validated_geometry(geometry))
            assert tiles == ['n16w094', 'n16w093']
            records = []
            for tile in tiles:
                path = cache / (tile + '.zip')
                with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(tile + '.hgt', np.full((3601,3601), 100, dtype='>i2').tobytes())
                records.append(NASADEMGranule(tile, 'NASADEM_HGT_' + tile, 'NASADEM_HGT', '001', path))
            return records
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    run_id = job['id']
    state = run_roi_worker(root, run_id, provider=Provider(), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    assert state['synthetic'] and not state['hydraulic_accuracy_validated']
    assert state['solver_returncode'] == 0
    assert len(state['provenance']['terrain']['source']['records']) == 2
    assert state['provenance']['aligned_terrain_sha256'] == sha(root / run_id / 'prepared/solver-terrain.tif')
    assert state['result']['time_axis']['status'] == 'actual_times_unavailable'
    assert all(f['time_s'] is None for f in state['result']['frames'])
    work = root / run_id
    # El raster intermedio de prepare_dem enmascara el exterior de su bbox
    # geográfica. El DEM computacional efectivo es el alineado, no aquel.
    with rasterio.open(work / 'prepared/solver-terrain.tif') as aligned:
        assert np.isfinite(aligned.read(1)).all()
        assert aligned.width * aligned.height <= 1000
        assert [aligned.bounds.left, aligned.bounds.bottom, aligned.bounds.right, aligned.bounds.top] == state['computed_extent_m']
    with netcdf_file(work / 'rain.nc', 'r', mmap=False) as nc:
        rain = nc.variables['rainfall_depth'][:].copy()
        assert (rain[0] > 0).any() and (rain[0] == 0).any()
    for artifact in state['artifacts']:
        path = work / artifact['file']
        assert sha(path) == artifact['sha256']
        with rasterio.open(path) as cog:
            assert cog.driver == 'GTiff' and cog.crs.to_epsg() == 32615
            assert np.isfinite(cog.read(1, masked=True).compressed()).all()
        assert len(artifact['geographic_bounds']) == 4
    assert state['input_hashes']['rain.nc'] == sha(work / 'rain.nc')
    assert get_roi_run(root, run_id) == state
