"""Contrato público mínimo del flujo ROI (sin credenciales ni descargas reales)."""
import hashlib
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


def test_acquisition_failure_is_terminal_and_sanitized(root):
    class Failed:
        def acquire_roi(self, geometry):
            raise RuntimeError('authentication secret=private')
    job = start_roi_run('alice', payload(), root=root, config=config(), launch=False)
    state = run_roi_worker(root, job['id'], provider=Failed())
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
    state = run_roi_worker(root, run_id, provider=Provider())
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
