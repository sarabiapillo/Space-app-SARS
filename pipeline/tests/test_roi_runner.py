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

from pipeline.elevation import copernicus as cop, vertical_datum as vd
from pipeline.elevation.copernicus import CopernicusDEMProvider, CopernicusTile
from pipeline.elevation.nasadem import NASADEMGranule, NASADEMProvider, _required_tiles, _validated_geometry
from pipeline.hydrology.results import NegativeDepthArtifacts, summarize_results
from pipeline.hydrology.roi_runner import (validate_roi_run, validate_config, start_roi_run, run_roi_worker, get_roi_run,
                                           solver_parameter_file, terrain_provider)

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


def geoid_shift(source, lon=-92.9996, lat=16.80015):
    """EGM2008 shift the runner applies at the test domain: N96 - N08 (NASADEM) or -N08 (ellipsoidal NISAR_DEM)."""
    grids = vd.load_grids()
    n08 = vd.undulation([lon], [lat], grids['EGM2008'])[0]
    return float(vd.undulation([lon], [lat], grids['EGM96'])[0] - n08) if source == 'nasadem' else float(-n08)


def terrain_m():
    """Flat 100 m EGM96 NASADEM fixture after the runner converts it to EGM2008."""
    return 100 + geoid_shift('nasadem')


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
    lambda p: p['simulation'].update(solver='fv2'),
    lambda p: p['simulation'].update(solver=None),
    lambda p: p['simulation'].update(solver='FV1'),
    lambda p: p['simulation'].update(solver=True),
    lambda p: p['simulation'].update(solver='fv1', dg2_depth_thresh_m=.02),
    lambda p: p['terrain'].update(source='Copernicus'),
    lambda p: p['terrain'].update(source='srtm'),
    lambda p: p['terrain'].update(source=None),
    lambda p: p['terrain'].update(source=True),
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


def test_parameter_file_with_explicit_dg2_equals_a_payload_without_solver():
    explicit = payload(); explicit['simulation']['solver'] = 'dg2'
    assert solver_parameter_file(validate_roi_run(explicit, config())) == solver_parameter_file(validate_roi_run(payload(), config()))


def fv1(p=None):
    p = p or payload()
    p['simulation']['solver'] = 'fv1'
    return p


def test_parameter_file_uses_the_fv1_keyword_without_thin_depth_threshold():
    assert solver_parameter_file(validate_roi_run(fv1(), config())) == (
        'fv1\nvoutput\nDEMfile terrain.dem\ndirroot outputs\nresroot roi\n'
        'sim_time 2\nsaveint 1\ninitial_tstep 0.1\nfpfric 0.02\n'
        'dynamicrainfile rain.nc\nbcifile boundary.bci\n')


def test_fv1_rejects_a_thin_depth_threshold_with_a_clear_message(root):
    p = fv1(); p['simulation']['dg2_depth_thresh_m'] = .02
    with pytest.raises(ValueError, match='dg2_depth_thresh_m'):
        start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert not root.exists()


@pytest.mark.parametrize('body, solver', [(payload, 'dg2'), (fv1, 'fv1')])
def test_requested_solver_is_recorded_in_state_and_the_deadline_covers_two_attempts(root, body, solver):
    import time
    before = time.time()
    job = start_roi_run('alice', body(), root=root, config=config(), launch=False)
    assert (job['requested_solver'], job['solver'], job['solver_fallback'], job['solver_attempts']) == (solver, solver, None, [])
    cfg = config()
    assert job['deadline_epoch_s'] >= before + cfg['preparation_timeout_s'] + 2 * cfg['timeout_s']


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
    # The 100 m EGM96 terrain becomes 100 + N96 - N08 in EGM2008; the sea level 100.5 m is EGM2008.
    depth = 100.5 - terrain_m()
    first = state['result']['frames'][0]['stats']
    assert first['min_m'] == pytest.approx(depth, abs=5e-3) and first['max_m'] == pytest.approx(depth, abs=5e-3)
    last = state['result']['frames'][-1]['stats']
    assert last['max_m'] == pytest.approx(depth + .002, abs=.01)  # sea depth plus the 2 mm of rain inside the ROI
    assert state['result']['flow']['frames'][-1]['max_speed_m_s'] < .05


def test_native_fv1_fixed_level_starts_and_keeps_still_water(root):
    # FV1 reads only initial.wd from `startfile` (no DG2 slope coefficients) and the cell-average DEM.
    job = start_roi_run('alice', fv1(with_sea()), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    work = root / job['id'] / 'work'
    assert (work / 'roi.par').read_text().splitlines()[0] == 'fv1'
    assert 'initial.wd' in state['input_hashes'] and not {'initial.wd1x', 'initial.wd1y', 'terrain.dem1x'} & set(state['input_hashes'])
    depth = 100.5 - terrain_m()
    first = state['result']['frames'][0]['stats']
    assert first['min_m'] == pytest.approx(depth, abs=5e-3) and first['max_m'] == pytest.approx(depth, abs=5e-3)
    assert state['result']['frames'][-1]['stats']['max_m'] == pytest.approx(depth + .002, abs=.01)
    assert state['result']['flow']['frames'][-1]['max_speed_m_s'] < .05  # FV1 also writes Vx/Vy with voutput
    assert state['solver'] == state['result']['solver'] == state['provenance']['solver'] == 'fv1'
    assert state['solver_fallback'] is None and state['result']['solver_fallback'] is None
    assert state['result']['negative_depth']['status'] == 'none'


def failing_on(solver, error):
    """Summarizer that fails the attempt of ``solver`` (read from its parameter file) and runs the real one otherwise."""
    def summarize(outputs, **kwargs):
        if (Path(outputs).parent / 'roi.par').read_text().splitlines()[0] == solver:
            raise error
        return summarize_results(outputs, **kwargs)
    return summarize


def test_native_dg2_artifacts_fall_back_to_fv1_and_report_the_switch(root):
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           summarizer=failing_on('dg2', NegativeDepthArtifacts({})))
    assert state['state'] == 'succeeded', state
    fallback = {'from': 'dg2', 'to': 'fv1', 'reason': 'negative_depth_artifacts'}
    assert (state['requested_solver'], state['solver'], state['solver_fallback']) == ('dg2', 'fv1', fallback)
    assert state['result']['solver'] == 'fv1' and state['result']['requested_solver'] == 'dg2'
    assert state['result']['solver_fallback'] == fallback and state['provenance']['solver_fallback'] == fallback
    assert state['solver_attempts'] == [{'solver': 'dg2', 'outcome': 'failed', 'reason': 'negative_depth_artifacts'},
                                        {'solver': 'fv1', 'outcome': 'succeeded', 'reason': None}]
    run = root / job['id']
    # Each attempt has its own working directory; the shown results and hashes are the FV1 attempt's.
    assert (run / 'work/roi.par').read_text().startswith('dg2\n')
    assert (run / 'work-fallback/roi.par').read_text().startswith('fv1\n')
    assert state['input_hashes']['roi.par'] == sha(run / 'work-fallback/roi.par')
    assert state['artifacts'] and all((run / a['file']).is_file() for a in state['artifacts'])
    assert get_roi_run(root, job['id']) == state


def test_native_fv1_failure_falls_back_to_dg2(root):
    job = start_roi_run('alice', fv1(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           summarizer=failing_on('fv1', ValueError('bad output')))
    assert state['state'] == 'succeeded', state
    assert (state['requested_solver'], state['solver']) == ('fv1', 'dg2')
    assert state['solver_fallback'] == {'from': 'fv1', 'to': 'dg2', 'reason': 'output_invalid'}
    assert (root / job['id'] / 'work-fallback/roi.par').read_text().startswith('dg2\n')


def test_native_both_solvers_failing_keep_the_first_error_and_both_attempts(root):
    def summarize(outputs, **kwargs):
        first = Path(outputs).parent.name == 'work'
        raise NegativeDepthArtifacts({}) if first else ValueError('bad output')
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads, summarizer=summarize)
    assert state['state'] == 'failed' and state['error'] == 'negative_depth_artifacts'
    assert state['solver_fallback'] == {'from': 'dg2', 'to': 'fv1', 'reason': 'negative_depth_artifacts'}
    assert state['solver_attempts'] == [{'solver': 'dg2', 'outcome': 'failed', 'reason': 'negative_depth_artifacts'},
                                        {'solver': 'fv1', 'outcome': 'failed', 'reason': 'output_invalid'}]
    assert 'result' not in state and 'artifacts' not in state


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
    assert state['result']['frames'][0]['stats']['min_m'] == pytest.approx(100.5 - terrain_m() + surge, abs=5e-3)
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
    assert lake['hylak_id'] == 42 and lake['depth_avg_m'] == 2.0 and lake['cells'] > 0
    assert lake['surface_m'] == pytest.approx(terrain_m(), abs=1e-3)  # median of the EGM2008 terrain
    assert 'startfile initial.wd' in (root / job['id'] / 'work' / 'roi.par').read_text().splitlines()
    # Lake full from the first frame; a 2 x 2-cell lake with dug vertical walls loses ~1 % at the shore
    # in the first step (DG2 wet/dry adjustment, as with the sea).
    assert state['result']['frames'][0]['stats']['max_m'] == pytest.approx(2.0, rel=.05)
    assert 'HydroLAKES' in state['provenance']['lakes']['citation']


def flat_provider(root, run_id, height=100):
    class Provider:
        def acquire_roi(self, geometry):
            cache = root / run_id / 'cache'
            cache.mkdir(exist_ok=True)
            records = []
            for tile in _required_tiles(_validated_geometry(geometry)):
                path = cache / (tile + '.zip')
                with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(tile + '.hgt', np.full((3601,3601), height, dtype='>i2').tobytes())
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
    # Acquisition and preparation are shared by both solvers: no fallback attempt.
    assert state['solver_attempts'] == [] and state['solver_fallback'] is None
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
    # No fallback when the requested solver succeeds.
    assert (state['requested_solver'], state['solver'], state['solver_fallback']) == ('dg2', 'dg2', None)
    assert state['solver_attempts'] == [{'solver': 'dg2', 'outcome': 'succeeded', 'reason': None}]
    assert state['result']['solver'] == 'dg2' and not (root / run_id / 'work-fallback').exists()
    assert len(state['provenance']['terrain']['source']['records']) == 2
    # One vertical datum: the EGM96 NASADEM fixture reaches the solver converted to EGM2008.
    terrain = state['provenance']['terrain']
    assert terrain['vertical_datum'] == 'EGM2008' and terrain['vertical_conversion']['from'] == 'EGM96'
    assert state['provenance']['dg2']['vertical_datum'] == 'EGM2008'
    assert (state['terrain_source'], state['provenance']['terrain_source'], state['vertical_datum']) == ('nasadem', 'nasadem', 'EGM2008')
    with rasterio.open(root / run_id / 'prepared/solver-terrain.tif') as aligned:
        assert aligned.read(1) == pytest.approx(np.full((aligned.height, aligned.width), terrain_m()), abs=5e-3)
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


def observed(p=None, segments=None, amount=2, duration=2):
    p = p or payload()
    p['rainfall'] = {'amount': amount, 'unit': 'mm', 'duration': duration, 'duration_unit': 's'}
    p['rainfall_profile'] = {'source': 'observed', 'provenance': {'product': 'GPM_3IMERGHHL', 'granules': ['G0', 'G1']},
                             'segments': segments or [{'start_s': 0, 'end_s': 1, 'mm': 1.5}, {'start_s': 1, 'end_s': 2, 'mm': .5}]}
    return p


@pytest.mark.parametrize('change', [
    lambda p: p['rainfall'].update(amount=3),  # does not match the series total
    lambda p: p['rainfall'].update(duration=1.5),  # does not match the series end
    lambda p: p['rainfall_profile'].update(seed=7),  # mixes synthetic and observed keys
    lambda p: p['rainfall_profile'].update(provenance='IMERG'),
    lambda p: p['rainfall_profile']['segments'][1].update(start_s=1.2),
    lambda p: p['rainfall_profile'].update(source='radar'),
])
def test_observed_rain_must_match_the_declared_total_and_be_a_valid_series(root, change):
    p = observed(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert not root.exists()


def test_observed_rain_run_is_not_synthetic(root):
    job = start_roi_run('alice', observed(), root=root, config=config(), launch=False)
    assert job['synthetic'] is False and not job['hydraulic_accuracy_validated']
    assert start_roi_run('alice', payload(), root=root, config=config(), launch=False)['synthetic'] is True


def test_native_observed_rain_reaches_the_solver_interval_by_interval(root):
    p = observed(); p['hydraulics'].update(infiltration='runoff_coefficient')
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    coefficient = job['losses']['runoff_coefficient']
    with netcdf_file(root / job['id'] / 'rain.nc', 'r', mmap=False) as nc:
        rain = nc.variables['rainfall_depth'][:].copy()
    assert rain[0].max() == pytest.approx(1.5 * coefficient) and rain[1].max() == pytest.approx(.5 * coefficient)
    rain_source = state['provenance']['rain']
    assert rain_source['observed'] is True and rain_source['synthetic'] is False
    assert rain_source['profile']['source']['product'] == 'GPM_3IMERGHHL'


def copernicus_payload(p=None):
    p = p or payload()
    p['terrain']['source'] = 'copernicus'
    return p


def test_terrain_source_defaults_to_nasadem_and_is_recorded(root):
    legacy = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    assert (legacy['terrain_source'], legacy['vertical_datum'], legacy['terrain_attribution']) == ('nasadem', 'EGM2008', None)
    job = json.loads((root / legacy['id'] / 'job.json').read_text())
    assert job['payload']['terrain']['source'] == 'nasadem'
    chosen = start_roi_run('alice', copernicus_payload(), root=root, config=config(), launch=False)
    assert (chosen['terrain_source'], chosen['vertical_datum']) == ('copernicus', 'EGM2008')
    assert 'Copernicus WorldDEM-30' in chosen['terrain_attribution']
    assert get_roi_run(root, chosen['id'])['terrain_source'] == 'copernicus'


def test_a_payload_without_terrain_source_uses_nasadem_as_before(tmp_path):
    assert isinstance(terrain_provider('nasadem', tmp_path), NASADEMProvider)
    assert isinstance(terrain_provider('copernicus', tmp_path), CopernicusDEMProvider)
    with pytest.raises(ValueError):
        terrain_provider('srtm', tmp_path)
    # Without the key the validated request names NASADEM; nothing else changes.
    request = validate_roi_run(payload(), config())
    assert request['terrain']['source'] == 'nasadem'
    explicit = validate_roi_run({**payload(), 'terrain': {**payload()['terrain'], 'source': 'nasadem'}}, config())
    assert solver_parameter_file(explicit) == solver_parameter_file(request) and explicit == request


def test_copernicus_covers_latitudes_outside_nasadem(root):
    north = payload()
    north['roi'] = polygon(10.7001, 61.0001, 10.7004, 61.0004)
    north['domain'] = polygon(10.7, 61.0, 10.7006, 61.0006)
    north['terrain']['target_crs'] = 'EPSG:32632'
    with pytest.raises(ValueError):
        start_roi_run('alice', north, root=root, config=config(), launch=False)
    assert start_roi_run('alice', copernicus_payload(north), root=root, config=config(), launch=False)['state'] == 'created'


def test_missing_geoid_grids_make_the_service_unavailable():
    empty = BASE / f'geoid-{uuid.uuid4()}'
    empty.mkdir(parents=True)
    try:
        with pytest.raises(ValueError, match='geoide'):
            validate_config({**config(), 'geoid_dir': str(empty)})
    finally:
        empty.rmdir()


def copernicus_provider(root, run_id, height=100.0):
    """Flat ellipsoidal NISAR_DEM clips covering the requested geometry, one per tile."""
    class Provider:
        def acquire_roi(self, geometry):
            cache = root / run_id / 'cache'
            cache.mkdir(exist_ok=True)
            west, south, east, north = cop._geometry(geometry).bounds
            records = []
            for tile in cop.required_tiles(geometry):
                w, s = max(west, tile.lon) - .001, max(south, tile.lat) - .001
                e, n = min(east, tile.lon + 1) + .001, min(north, tile.lat + 1) + .001
                width, height_px = math.ceil((e - w) * 3600), math.ceil((n - s) * 3600)
                path = cache / f'DEM_{tile.tile_id}.tif'
                with rasterio.open(path, 'w', driver='GTiff', width=width, height=height_px, count=1, dtype='float32',
                                   crs='EPSG:4326', transform=rasterio.transform.from_origin(w, n, 1 / 3600, 1 / 3600)) as dst:
                    dst.write(np.full((height_px, width), height, dtype='float32'), 1)
                records.append(CopernicusTile(tile.tile_id, f'v1-2-EPSG4326-x-DEM_{tile.tile_id}_C01-tif', 'NISAR_DEM', '1.2',
                                              cop.BASE_URL + cop.tile_relative_path(tile.tile_id), (0, 0, width, height_px),
                                              path, sha(path)))
            return records
    return Provider()


def test_native_copernicus_terrain_is_converted_from_the_ellipsoid_to_egm2008(root):
    job = start_roi_run('alice', copernicus_payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=copernicus_provider(root, job['id']), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    terrain = state['provenance']['terrain']
    assert terrain['source']['product'] == 'NISAR_DEM' and terrain['source']['vertical_datum'] == 'WGS84_ellipsoid'
    assert terrain['vertical_datum'] == 'EGM2008' and terrain['vertical_conversion']['formula'] == 'H_EGM2008 = h_WGS84 - N_EGM2008'
    assert 'Copernicus WorldDEM-30' in terrain['source']['attribution']
    assert state['provenance']['terrain_source'] == 'copernicus'
    with rasterio.open(root / job['id'] / 'prepared/solver-terrain.tif') as aligned:
        expected = 100 + geoid_shift('copernicus')
        assert aligned.read(1) == pytest.approx(np.full((aligned.height, aligned.width), expected), abs=5e-3)


# --- Land surface (WorldCover Manning, Curve Number net rain, antecedent moisture), design storms, urban ---------

from rasterio.transform import from_origin as _from_origin

from pipeline.hydrology import roi_runner as rr
from pipeline.hydrology.curve_number import convert_amc, scs_runoff_mm
from pipeline.hydrology.results import URBAN_WARNING


def worldcover_reader(code=30):
    """Fake WorldCover tile reader: every 10 m pixel of the requested window has class ``code``."""
    def read(url, window):
        return np.full((window[3], window[2]), code, dtype=np.uint8)
    return read


def soil_reader(west_code=1, east_code=4, split=-92.9996):
    """Fake HYSOGs reader on a 0.0001 degree grid: one hydrologic soil group west of ``split``, another east."""
    def read(bounds):
        west, south, east, north = bounds
        x0, y0, step = west - .001, north + .001, .0001
        width, height = math.ceil((east - west + .002) / step), math.ceil((north - south + .002) / step)
        lon = x0 + (np.arange(width) + .5) * step
        values = np.where(lon < split, west_code, east_code).astype(np.uint8)[None, :].repeat(height, axis=0)
        return {'values': values, 'transform': _from_origin(x0, y0, step, step), 'crs': 'EPSG:4326', 'source': 'test'}
    return read


def moisture(amc='III', source='SMAP L4', tried=None):
    def antecedent(bounds, event_time_utc, **kwargs):
        return {'amc': amc, 'relative_saturation': .7 if source else None, 'source': source, 'grid': None,
                'provenance': {'event_time_utc': str(event_time_utc), 'bounds': list(bounds),
                               'tried': tried or [{'source': source, 'outcome': 'used'}]}}
    return antecedent


def boom(*args, **kwargs):
    raise AssertionError('must not be called')


def cn_payload(p=None, amc='auto', amount=30):
    p = p or payload()
    p['rainfall'] = {'amount': amount, 'unit': 'mm', 'duration': 1, 'duration_unit': 's'}
    p['hydraulics'].update(infiltration='curve_number', antecedent_moisture=amc)
    return p


def pxr_reader(lon, lat):
    return {'a': 30.0, 'alpha': -.6, 'b': 10.0, 'beta': -.6, 'cell': {'lat': round(lat * 4) / 4, 'lon': round(lon * 4) / 4 % 360}}


def design(p=None, period=10, duration_h=2 / 3600, step_s=1):
    p = p or payload()
    p['rainfall'] = None
    p['rainfall_profile'] = {'source': 'design_storm', 'return_period_years': period, 'duration_h': duration_h, 'step_s': step_s}
    return p


def test_existing_payload_keeps_its_parameter_file_and_rain_exactly(root):
    # Pin: without the new options nothing reads land cover or soils and the solver gets the same files.
    request = validate_roi_run(payload(), config())
    assert solver_parameter_file(request) == ('dg2\nvoutput\nDEMfile terrain.dem\ndirroot outputs\nresroot roi\n'
                                              'sim_time 2\nsaveint 1\ninitial_tstep 0.1\nfpfric 0.02\n'
                                              'dynamicrainfile rain.nc\nbcifile boundary.bci\n')
    assert request['rainfall'] == payload()['rainfall'] and request['computed']['losses']['runoff_coefficient'] is None
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    assert job['land_surface']['manning'] == 'uniform' and job['land_surface']['curve_number'] is None
    assert job['rainfall_source'] == 'synthetic' and job['design_storm'] is None
    assert not {'tide', 'bathymetry'} & set(job) and not {'tide', 'bathymetry'} & set(validate_roi_run(payload(), config())['computed'])
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           landcover_reader=boom, soil_reader=boom, antecedent=boom, tide_series=boom, gebco_reader=boom,
                           mdt_reader=boom)
    assert state['state'] == 'succeeded', state
    run = root / job['id']
    assert not (run / 'landcover').exists() and not (run / 'work/manning.n').exists()
    assert not (run / 'tide').exists() and not (run / 'bathymetry').exists() and not (run / 'work/boundary.bdy').exists()
    assert not {'tide', 'bathymetry'} & set(state) and 'boundary.bdy' not in state['input_hashes']
    assert 'profile' in state['provenance']['rain'] and 'method' not in state['provenance']['rain']
    with netcdf_file(run / 'rain.nc', 'r', mmap=False) as nc:
        rain = nc.variables['rainfall_depth'][:].copy()
    segments = state['provenance']['rain']['profile']['segments']
    assert rain[0].max() == pytest.approx(segments[0]['intensity_m_s'] * .5 * 1000)
    assert URBAN_WARNING not in state['result']['warnings']


@pytest.mark.parametrize('change', [
    lambda p: p['hydraulics'].update(manning='WorldCover'),
    lambda p: p['hydraulics'].update(manning='uniform'),
    lambda p: p['hydraulics'].update(infiltration='curve_number'),  # antecedent moisture is required with CN
    lambda p: p['hydraulics'].update(infiltration='curve_number', antecedent_moisture='IV'),
    lambda p: p['hydraulics'].update(infiltration='runoff_coefficient', antecedent_moisture='auto'),
    lambda p: p['hydraulics'].update(urban_drainage_mm_h=12),  # only with curve_number
    lambda p: p['hydraulics'].update(infiltration='curve_number', antecedent_moisture='II', urban_drainage_mm_h=-1),
    lambda p: p['hydraulics'].update(infiltration='curve_number', antecedent_moisture='II', urban_drainage_mm_h=True),
    lambda p: p['hydraulics'].update(domain_nonurban='no'),
    lambda p: p['hydraulics'].update(domain_nonurban=None),
])
def test_land_surface_options_are_validated(root, change):
    p = payload(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert not root.exists()


def test_urban_domains_are_allowed_and_declared_urban_is_recorded(root):
    p = payload(); p['hydraulics']['domain_nonurban'] = False
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert job['land_surface']['urban'] == {'declared_nonurban': False, 'built_up_fraction': None,
                                            'built_up_cells': None, 'warning': True}


def test_native_worldcover_manning_file_is_written_and_referenced_with_fpfric_kept(root):
    p = payload(); p['hydraulics']['manning'] = 'worldcover'
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert job['land_surface']['manning'] == 'worldcover' and job['land_surface']['manning_fpfric'] is None
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           landcover_reader=worldcover_reader(50), soil_reader=boom, antecedent=boom)
    assert state['state'] == 'succeeded', state
    work = root / job['id'] / 'work'
    par = (work / 'roi.par').read_text().splitlines()
    assert 'manningfile manning.n' in par and 'fpfric 0.1' in par  # built-up 0.10 is the median and the NODATA fallback
    grid = np.loadtxt(work / 'manning.n', skiprows=6)
    header = (work / 'manning.n').read_text().splitlines()[:6]
    assert header == (work / 'terrain.dem').read_text().splitlines()[:6]
    with rasterio.open(root / job['id'] / 'prepared/solver-terrain.tif') as dem:
        assert grid.shape == (dem.height, dem.width) and np.allclose(grid, .1)
    assert state['input_hashes']['manning.n'] == sha(work / 'manning.n')
    land = state['land_surface']
    assert land['manning_fpfric'] == pytest.approx(.1)
    assert land['urban']['built_up_cells'] == grid.size and land['urban']['built_up_fraction'] == pytest.approx(1.0)
    assert land['urban']['warning'] is True and URBAN_WARNING in state['result']['warnings']
    assert any('ESA WorldCover' in a for a in land['attribution'])
    provenance = state['provenance']['land_surface']['landcover']
    assert provenance['class_counts'] == {'50': grid.size} and provenance['manning']['values']['50'] == .1


def test_native_curve_number_net_rain_per_cell_with_auto_moisture(root):
    job = start_roi_run('alice', cn_payload(), root=root, config=config(), launch=False)
    assert job['land_surface']['curve_number']['antecedent_moisture'] == 'auto'
    assert job['land_surface']['curve_number']['event_time_basis'] == 'run_start'
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           landcover_reader=worldcover_reader(30), soil_reader=soil_reader(), antecedent=moisture('III'))
    assert state['state'] == 'succeeded', state
    run = root / job['id']
    with netcdf_file(run / 'rain.nc', 'r', mmap=False) as nc:
        rain = nc.variables['rainfall_depth'][:].copy()
    cn = np.load(run / 'landcover/curve-number.npy')
    total = rain.sum(axis=0)
    assert (rain >= 0).all()
    roi = total > 0
    # Grassland, HSG A (west) and D (east) under AMC III: net rain of each cell is its own SCS-CN runoff.
    expected = scs_runoff_mm(30.0, cn)
    assert total[roi] == pytest.approx(expected[roi])
    assert len(np.unique(np.round(cn[roi], 6))) == 2
    assert set(np.round(cn[roi], 3)) == {round(convert_amc(54.0, 'III'), 3), round(convert_amc(86.0, 'III'), 3)}
    cnls = state['land_surface']['curve_number']
    assert (cnls['amc'], cnls['amc_source']) == ('III', 'SMAP L4')
    assert 0 < cnls['mean_runoff_coefficient'] < 1 and cnls['gross_rain_mm'] == pytest.approx(30)
    assert cnls['mean_net_rain_mm'] == pytest.approx(total[roi].mean())
    assert state['losses']['runoff_coefficient'] is None and state['losses']['infiltration'] == 'curve_number'
    method = state['provenance']['rain']['method']
    assert method['roi_mean_net_mm'] == pytest.approx([rain[k][roi].mean() for k in range(len(method['roi_mean_net_mm']))])
    assert any('HYSOGs250m' in a for a in state['land_surface']['attribution'])
    assert state['provenance']['land_surface']['antecedent_moisture']['source'] == 'SMAP L4'


def test_native_explicit_moisture_skips_the_soil_moisture_lookup(root):
    job = start_roi_run('alice', cn_payload(amc='II'), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           landcover_reader=worldcover_reader(30), soil_reader=soil_reader(4, 4), antecedent=boom)
    assert state['state'] == 'succeeded', state
    cnls = state['land_surface']['curve_number']
    assert (cnls['amc'], cnls['amc_source']) == ('II', 'request')
    with netcdf_file(root / job['id'] / 'rain.nc', 'r', mmap=False) as nc:
        total = nc.variables['rainfall_depth'][:].sum(axis=0)
    assert total.max() == pytest.approx(scs_runoff_mm(30.0, 86.0))


@pytest.mark.parametrize('kwargs, code', [
    ({'landcover_reader': 'fail'}, 'landcover_unavailable'),
    ({'soil_reader': 'fail'}, 'soils_unavailable'),
    ({'antecedent': moisture(amc='II', source=None, tried=[{'source': 'NISAR SME2', 'outcome': 'error'},
                                                          {'source': 'SMAP L4', 'outcome': 'error'}])}, 'soil_moisture_unavailable'),
    ({'antecedent': 'fail'}, 'soil_moisture_unavailable'),
])
def test_dataset_failures_give_a_specific_error_and_no_uniform_fallback(root, kwargs, code):
    def fail(*args, **kw):
        raise OSError('network down secret=private')
    readers = {'landcover_reader': worldcover_reader(30), 'soil_reader': soil_reader(), 'antecedent': moisture('II')}
    readers.update({k: (fail if v == 'fail' else v) for k, v in kwargs.items()})
    job = start_roi_run('alice', cn_payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads, **readers)
    assert state['state'] == 'failed' and state['error'] == code
    assert state['solver_attempts'] == [] and 'private' not in json.dumps(state)


def test_no_soil_moisture_observation_uses_amc_ii_and_says_so(root):
    none = moisture(amc='II', source=None, tried=[{'source': 'NISAR SME2', 'outcome': 'no_granule'},
                                                  {'source': 'SMAP L4', 'outcome': 'no_valid_cells'}])
    job = start_roi_run('alice', cn_payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           landcover_reader=worldcover_reader(30), soil_reader=soil_reader(), antecedent=none)
    assert state['state'] == 'succeeded', state
    assert (state['land_surface']['curve_number']['amc'], state['land_surface']['curve_number']['amc_source']) == ('II', None)


def test_observed_rain_auto_moisture_uses_the_series_start(root):
    p = observed(); p['hydraulics'].update(infiltration='curve_number', antecedent_moisture='auto')
    p['rainfall_profile']['provenance']['start_utc'] = '2026-10-01T06:00:00Z'
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    cnls = job['land_surface']['curve_number']
    assert (cnls['event_time_utc'], cnls['event_time_basis']) == ('2026-10-01T06:00:00Z', 'rain_series_start')
    del p['rainfall_profile']['provenance']['start_utc']
    with pytest.raises(ValueError, match='start_utc'):
        validate_roi_run(p, config())


def test_design_storm_is_computed_at_the_domain_centroid_and_fills_rainfall(root):
    request = validate_roi_run(design(), config(), design_storm_reader=pxr_reader)
    storm = request['computed']['design_storm']
    assert storm['point'] == pytest.approx([-92.9996, 16.80015], abs=1e-6)
    assert [s['end_s'] for s in storm['segments']] == [1, 2] and storm['extrapolated'] is True
    assert storm['within_stated_accuracy'] is False and storm['provenance']['dataset'] == 'PXR-4'
    assert request['rainfall'] == {'amount': storm['total_mm'], 'unit': 'mm', 'duration': 2, 'duration_unit': 's'}
    job = start_roi_run('alice', design(), root=root, config=config(), launch=False, design_storm_reader=pxr_reader)
    assert job['synthetic'] is True and job['rainfall_source'] == 'design_storm'
    assert job['design_storm']['return_period_years'] == 10 and job['design_storm']['total_mm'] == pytest.approx(storm['total_mm'])
    assert 'ODbL' in job['design_storm']['attribution'] and 'segments' not in job['design_storm']


@pytest.mark.parametrize('change', [
    lambda p: p.update(rainfall={'amount': 2, 'unit': 'mm', 'duration': 2, 'duration_unit': 's'}),
    lambda p: p['rainfall_profile'].update(return_period_years=1),
    lambda p: p['rainfall_profile'].update(return_period_years='10'),
    lambda p: p['rainfall_profile'].update(step_s=.5),
    lambda p: p['rainfall_profile'].update(step_s=3),  # does not divide 2 s
    lambda p: p['rainfall_profile'].update(seed=7),
    lambda p: p['rainfall_profile'].update(duration_h=25),
])
def test_design_storm_requests_are_validated(root, change):
    p = design(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False, design_storm_reader=pxr_reader)
    assert not root.exists()


def test_missing_design_storm_data_is_a_specific_unavailable_error(root, tmp_path):
    cfg = config(); cfg['pxr_path'] = str(BASE.parent / 'reference/pxr/missing-pxr.nc')
    with pytest.raises(rr.DatasetUnavailable) as error:
        start_roi_run('alice', design(), root=root, config=cfg, launch=False)
    assert error.value.code == 'design_storm_unavailable' and not root.exists()


def test_native_design_storm_segments_reach_the_solver(root):
    job = start_roi_run('alice', design(), root=root, config=config(), launch=False, design_storm_reader=pxr_reader)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads)
    assert state['state'] == 'succeeded', state
    storm = json.loads((root / job['id'] / 'job.json').read_text())['payload']['computed']['design_storm']
    with netcdf_file(root / job['id'] / 'rain.nc', 'r', mmap=False) as nc:
        rain = nc.variables['rainfall_depth'][:].copy()
    assert [rain[k].max() for k in range(2)] == pytest.approx([s['mm'] for s in storm['segments']])
    assert state['provenance']['rain']['profile']['design_storm'] is True
    assert state['provenance']['rain']['synthetic'] is True


def test_worldcover_manning_file_is_read_by_both_solvers_and_needs_the_prepared_fpfric():
    p = payload(); p['hydraulics']['manning'] = 'worldcover'
    request = validate_roi_run(p, config())
    for solver in ('dg2', 'fv1'):
        lines = solver_parameter_file(request, solver=solver, fpfric=.035).splitlines()
        assert lines[0] == solver and 'fpfric 0.035' in lines and 'manningfile manning.n' in lines
    with pytest.raises(ValueError, match='fpfric'):
        solver_parameter_file(request)


# ---------------------------------------------------------------------------------- coast: tide (HVAR) and GEBCO
TIDE_WEST = {'north': {'type': 'closed'}, 'east': {'type': 'closed'}, 'south': {'type': 'closed'},
             'west': {'type': 'tide', 'mdt': 'DTUUH22MDT'}}
START = '2026-10-16T12:00:00Z'


def tide_payload(p=None, sides=TIDE_WEST, initial='still_water_at_fixed_level', start=START, duration=120, save=40):
    p = p or payload()
    p['hydraulics'].update(boundary=sides, initial_condition=initial)
    p['simulation'].update(duration_s=duration, save_interval_s=save, initial_tstep_s=1)
    if start is not None:
        p['simulation']['start_utc'] = start
    return p


def tide_provider(first, last):
    """Synthetic EOT20 stand-in: a linear tide from ``first`` to ``last`` metres (EGM2008) over the window."""
    def provide(lon, lat, start, end, step_s, *, mdt):
        import datetime as dt
        parse = lambda v: dt.datetime.fromisoformat(v.replace('Z', '+00:00'))
        span = (parse(end) - parse(start)).total_seconds()
        times = [k * step_s for k in range(int(round(span / step_s)) + 1)]
        series = [(t, first + (last - first) * t / span) for t in times]
        return {'series': series, 'provenance': {'model': 'EOT20 (test)', 'point': [lon, lat], 'start_utc': start,
                                                 'end_utc': end, 'step_s': step_s, 'mdt_requested': mdt,
                                                 'offset_m': 0.25, 'datum': 'EGM2008 (test)',
                                                 'sampling': {'method': 'nearest valid node', 'node': [-93.1, 16.7],
                                                              'distance_km': 3.0}}}
    return provide


@pytest.mark.parametrize('change', [
    lambda p: p['simulation'].pop('start_utc'),  # synthetic rain: the tide needs an explicit start time
    lambda p: p['simulation'].update(start_utc='2026-10-16T12:00:00'),  # no UTC offset
    lambda p: p['simulation'].update(start_utc='1850-01-01T00:00:00Z'),
    lambda p: p['simulation'].update(start_utc=1792152000),
    lambda p: p['hydraulics'].update(boundary={**TIDE_WEST, 'north': {'type': 'fixed_level', 'level_m': 1}}),  # still water
    lambda p: p['hydraulics'].update(boundary={**TIDE_WEST, 'west': {'type': 'tide', 'mdt': 'TPXO'}}),
    lambda p: p['terrain'].update(bathymetry='srtm15'),
])
def test_tide_sides_are_validated_and_need_a_start_time(root, change):
    p = tide_payload(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert not root.exists()


def test_design_storm_with_a_tide_side_needs_simulation_start_utc(root):
    with pytest.raises(ValueError, match='start_utc'):
        validate_roi_run(design(tide_payload(start=None)), config(), design_storm_reader=pxr_reader)
    request = validate_roi_run(design(tide_payload()), config(), design_storm_reader=pxr_reader)
    assert request['computed']['tide']['event_time_basis'] == 'simulation_start'


@pytest.mark.parametrize('change', [
    lambda p: p['simulation'].update(start_utc=START),  # no tide side
    lambda p: p['terrain'].update(bathymetry='gebco'),  # no sea side
])
def test_start_time_and_gebco_need_a_coast(root, change):
    p = payload(); change(p)
    with pytest.raises(ValueError):
        start_roi_run('alice', p, root=root, config=config(), launch=False)


def test_observed_rain_sets_the_tide_window_from_its_series_start(root):
    p = observed(tide_payload(start=None, duration=2, save=1))
    p['rainfall_profile']['provenance']['start_utc'] = '2026-06-18T11:30:00+00:00'
    tide = validate_roi_run(p, config())['computed']['tide']
    assert (tide['start_utc'], tide['end_utc'], tide['step_s']) == ('2026-06-18T11:30:00Z', '2026-06-18T11:30:02Z', 2.0)
    assert tide['event_time_basis'] == 'rain_series_start'
    p['simulation']['start_utc'] = START  # a second event time is refused
    with pytest.raises(ValueError, match='provenance.start_utc'):
        validate_roi_run(p, config())


def test_tide_request_is_recorded_in_state_with_one_point_on_the_tide_sides(root):
    p = tide_payload(sides={**TIDE_WEST, 'south': {'type': 'tide'}}, duration=1500, save=500)
    job = start_roi_run('alice', p, root=root, config={**config(), 'max_frames': 5}, launch=False)
    tide = job['tide']
    # 1500 s in 600 s steps: the window is rounded up so the last level covers the end of the run.
    assert (tide['start_utc'], tide['end_utc'], tide['step_s']) == (START, '2026-10-16T12:30:00Z', 600.0)
    assert tide['sides'] == ['south', 'west'] and tide['mdt'] == 'DTUUH22MDT' and tide['model'] == 'EOT20'
    assert tide['event_time_basis'] == 'simulation_start' and tide['min_m'] is None
    # One series for both sides, at the mean of their midpoints: south-west quarter of the computational rectangle.
    lon, lat = tide['point']
    assert -93.0001 < lon < -92.9996 and 16.7995 < lat < 16.8002
    assert job['boundary']['south'] == {'type': 'tide', 'mdt': 'DTUUH22MDT'} and 'bathymetry' not in job


def test_parameter_file_reads_the_tide_series_after_the_boundary_file():
    lines = solver_parameter_file(validate_roi_run(tide_payload(), config())).splitlines()
    assert lines[lines.index('bcifile boundary.bci') + 1] == 'bdyfile boundary.bdy'
    assert 'startfile initial.wd' in lines


def edge_depths(run, state):
    """West-column depth of every frame COG: {scheduled_time_s: (min, max)}."""
    found = {}
    for artifact in state['artifacts']:
        if artifact['frame_index'] is None:
            continue
        with rasterio.open(run / artifact['file']) as cog:
            column = cog.read(1)[:, 0]
        found[artifact['scheduled_time_s']] = (float(column.min()), float(column.max()))
    return found


@pytest.mark.parametrize('solver', ['dg2', 'fv1'])
def test_native_tide_side_follows_the_series_from_a_still_sea_with_the_pressure_surge(root, solver):
    # A slow tide (0.1 m in 20 min) so the closed basin behind the west side keeps up with it.
    p = tide_payload(duration=1200, save=400)
    p['hydraulics']['atmospheric_pressure_hpa'] = 1003.25
    if solver == 'fv1':
        p = fv1(p)
    # LISFLOOD-FP uses every core: a larger solver budget keeps this test stable when other suites run.
    job = start_roi_run('alice', p, root=root, config={**config(), 'timeout_s': 60}, launch=False)
    first, last = 100.5, 100.6  # EGM2008 tide levels at t = 0 and t = 1200 s (flat terrain at ~100 m)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads,
                           tide_series=tide_provider(first, last))
    assert state['state'] == 'succeeded', state
    assert state['solver'] == solver and state['solver_fallback'] is None
    run, surge = root / job['id'], 1000 / 9810
    work = run / 'work'
    bci = (work / 'boundary.bci').read_text().splitlines()
    assert len(bci) == 1 and bci[0].startswith('W ') and bci[0].endswith(' HVAR tide')
    assert (work / 'boundary.bdy').read_text() == (
        'LISFLOOD-FP HVAR tide series: level_m time_s (metres on the DEM vertical datum)\ntide\n3 seconds\n'
        f'{first + surge:.4f} 0.0\n{(first + last) / 2 + surge:.4f} 600.0\n{last + surge:.4f} 1200.0\n')
    assert state['input_hashes']['boundary.bdy'] == sha(work / 'boundary.bdy')
    assert 'bdyfile boundary.bdy' in (work / 'roi.par').read_text().splitlines()
    # Still-water start at the t = 0 tide level (plus surge), then the west edge follows the series.
    level = lambda t: first + (last - first) * t / 1200 + surge
    depths = edge_depths(run, state)
    assert sorted(depths) == [0, 400, 800, 1200]
    for t, (low, high) in depths.items():
        assert low == pytest.approx(level(t) - terrain_m(), abs=5e-3), t
        assert high == pytest.approx(level(t) - terrain_m(), abs=5e-3), t
    assert state['result']['frames'][0]['stats']['min_m'] == pytest.approx(level(0) - terrain_m(), abs=5e-3)
    tide = state['tide']
    assert tide['start_level_m'] == pytest.approx(first + surge) and tide['max_m'] == pytest.approx(last + surge)
    assert tide['min_m'] == pytest.approx(first + surge) and tide['count'] == 3 and tide['barometric_surge_m'] == pytest.approx(surge)
    assert tide['node'] == [-93.1, 16.7] and tide['sampling'] == 'nearest valid node' and tide['mdt_m'] == 0.25
    assert tide['attribution'] == [rr.EOT20_ATTRIBUTION, rr.MDT_ATTRIBUTION, rr.PYTMD_ATTRIBUTION]
    provenance = state['provenance']['tide']['provenance']
    assert provenance['start_utc'] == START and provenance['end_utc'] == '2026-10-16T12:20:00Z'
    assert provenance['mdt_requested'] == 'DTUUH22MDT' and provenance['point'] == job['tide']['point']
    assert get_roi_run(root, job['id']) == state


@pytest.mark.parametrize('kwargs, code', [({'tide_series': boom}, 'tide_unavailable'),
                                          ({'gebco_reader': boom}, 'bathymetry_unavailable')])
def test_tide_and_gebco_failures_give_a_specific_error(root, kwargs, code):
    p = tide_payload(); p['terrain']['bathymetry'] = 'gebco'
    readers = {'tide_series': tide_provider(100.5, 100.6), 'gebco_reader': lambda *a, **k: np.full(a[2], np.nan),
               'mdt_reader': lambda lon, lat: (0.3, {'source': 'test'}), **kwargs}
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id']), roads_fetcher=no_roads, **readers)
    assert state['state'] == 'failed' and state['error'] == code and state['solver_attempts'] == []


def test_native_gebco_replaces_the_sea_cells_connected_to_the_sea_side(root):
    # Terrain at 0 m (sea surface): GEBCO says sea (-5 m) on the three western columns and land elsewhere.
    p = with_sea(sides={**SEA_WEST, 'east': {'type': 'closed'}, 'west': {'type': 'fixed_level', 'level_m': 0.5}})
    p['terrain']['bathymetry'] = 'gebco'
    p = fv1(p)
    job = start_roi_run('alice', p, root=root, config=config(), launch=False)
    assert job['bathymetry']['sea_sides'] == ['west'] and job['bathymetry']['mdt'] == 'DTUUH22MDT'

    def gebco(transform, crs, shape, **kwargs):
        values = np.full(shape, 2.0)
        values[:, :3] = -5.0
        return values
    state = run_roi_worker(root, job['id'], provider=flat_provider(root, job['id'], height=0), roads_fetcher=no_roads,
                           gebco_reader=gebco, mdt_reader=lambda lon, lat: (0.3, {'source': 'test MDT'}))
    assert state['state'] == 'succeeded', state
    with rasterio.open(root / job['id'] / 'prepared/solver-terrain.tif') as aligned:
        values = aligned.read(1)
    rows = values.shape[0]
    np.testing.assert_allclose(values[:, :3], -4.7, atol=1e-5)  # GEBCO -5 m on MSL + 0.3 m MDT = EGM2008
    assert np.all(values[:, 3:] > -1)  # land on GEBCO: the DEM is kept
    bathymetry = state['bathymetry']
    assert bathymetry['replaced_cells'] == 3 * rows and bathymetry['mdt_m'] == 0.3 and 'DTUUH22MDT' in bathymetry['datum']
    assert bathymetry['min_elevation_m'] == pytest.approx(-4.7, abs=1e-5)
    assert bathymetry['attribution'] == 'GEBCO Compilation Group (2026) GEBCO 2026 Grid'
    assert 'a sea-side edge (west)' in state['provenance']['bathymetry']['provenance']['sea_rule']
    assert state['provenance']['bathymetry']['provenance']['mdt'] == {'source': 'test MDT'}
    # The still sea fills the GEBCO floor up to the fixed level.
    assert state['result']['frames'][0]['stats']['max_m'] == pytest.approx(0.5 + 4.7, abs=.01)


def test_server_config_accepts_the_eot20_and_mdt_cache_paths_inside_data():
    data = Path(__file__).resolve().parents[2] / 'data'
    checked = validate_config({**config(), 'eot20_dir': str(data / 'reference/eot20'),
                               'mdt_path': str(data / 'reference/dtu22mdt/dtuuh22mdt.grd.gz')})
    assert checked['eot20_dir'] == str(data / 'reference/eot20')
    with pytest.raises(ValueError):
        validate_config({**config(), 'eot20_dir': '/tmp/eot20'})
