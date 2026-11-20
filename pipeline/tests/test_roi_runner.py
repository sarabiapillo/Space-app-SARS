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
