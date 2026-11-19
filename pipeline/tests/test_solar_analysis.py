"""Behavior tests for bounded solar raster analysis and public route."""
import os
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_origin

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'solar.test_settings')
import django
django.setup()
from django.test import Client, override_settings

from backend.solar.analysis import contour_geojson, summarize_incident, MAX_PIXELS
from solar import views
import pytest


def write_raster(path, values, nodata=-9999):
    with rasterio.open(path, 'w', driver='GTiff', height=values.shape[0], width=values.shape[1],
                       count=1, dtype='float32', nodata=nodata, crs='EPSG:32615',
                       transform=from_origin(100, 200, 10, 20)) as dst:
        dst.write(values.astype('float32'), 1)


def test_statistics_histogram_exclude_nodata_and_nonfinite(tmp_path):
    path = tmp_path / 'incident.tif'
    write_raster(path, np.array([[1, 2, -9999], [3, np.nan, np.inf]]))
    result = summarize_incident(path)
    assert result['statistics'] == {'min': 1, 'max': 3, 'mean': 2, 'median': 2}
    assert result['valid_cells'] == 3
    assert sum(result['histogram']['counts']) == 3
    assert len(result['histogram']['bin_edges']) == len(result['histogram']['counts']) + 1
    assert result['units'] == 'W/m2'
    assert result['resolution'] == [10, 20]
    assert result['cell_area'] == 200


def test_contours_are_geojson_from_float_raster_and_respect_nodata(tmp_path):
    path = tmp_path / 'incident.tif'
    write_raster(path, np.array([[0, 0, 0, 0], [0, 10, 10, 0],
                                 [0, 10, 10, 0], [0, 0, 0, -9999]], dtype='float32'))
    result = contour_geojson(path, levels=[5])
    assert result['type'] == 'FeatureCollection'
    assert result['features']
    feature = result['features'][0]
    assert feature['geometry']['type'] == 'MultiLineString'
    assert feature['properties'] == {'value_w_m2': 5.0, 'units': 'W/m2'}
    assert all(len(point) == 2 for line in feature['geometry']['coordinates'] for point in line)


def test_raster_above_simulation_budget_is_rejected_before_read(tmp_path):
    path = tmp_path / 'incident.tif'
    write_raster(path, np.zeros((501, 1000), dtype='float32'))
    assert MAX_PIXELS == 500_000
    with pytest.raises(ValueError, match='pixel limit'):
        summarize_incident(path)


def test_public_contours_concurrency_fails_closed_with_429(tmp_path):
    run_id = '7' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{}')
    write_raster(run / 'incident.tif', np.array([[0, 10], [10, 0]], dtype='float32'))
    assert views._ANALYSIS_SLOTS.acquire(blocking=False)
    assert views._ANALYSIS_SLOTS.acquire(blocking=False)
    try:
        with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
            response = Client().get(f'/api/solar/simulations/{run_id}/contours?levels=1,2')
        assert response.status_code == 429
    finally:
        views._ANALYSIS_SLOTS.release()
        views._ANALYSIS_SLOTS.release()


def test_public_contours_rejects_level_pixel_complexity_before_contouring(tmp_path, monkeypatch):
    run_id = '6' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{}')
    path = run / 'incident.tif'
    alternating = np.indices((100, 100)).sum(axis=0) % 2 * 100
    write_raster(path, alternating.astype('float32'))
    monkeypatch.setattr('solar.analysis.MAX_CONTOUR_WORK', 100_000)
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'), \
         patch('solar.analysis._extract_contours', side_effect=AssertionError('must reject before contour work')) as extract:
        response = Client().get(f'/api/solar/simulations/{run_id}/contours?levels=' + ','.join(str(i) for i in range(1, 21)))
    assert response.status_code == 413
    extract.assert_not_called()


@pytest.mark.parametrize(('limit_name', 'limit_value'), [
    ('MAX_CONTOUR_VERTICES', 1), ('MAX_GEOJSON_BYTES', 10),
])
def test_public_contours_bounds_geojson_vertices_and_bytes(tmp_path, monkeypatch, limit_name, limit_value):
    run_id = '5' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{}')
    path = run / 'incident.tif'
    write_raster(path, np.array([[0, 10, 0], [10, 0, 10], [0, 10, 0]], dtype='float32'))
    monkeypatch.setattr(f'solar.analysis.{limit_name}', limit_value)
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/contours?levels=5')
    assert response.status_code == 413
    assert response['Content-Type'].startswith('application/json')


def test_public_contours_endpoint_returns_geojson(tmp_path):
    run_id = '8' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{}')
    write_raster(run / 'incident.tif', np.array([[0, 0, 0, 0], [0, 10, 10, 0],
                                                [0, 10, 10, 0], [0, 0, 0, -9999]], dtype='float32'))
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/contours?levels=5')
    assert response.status_code == 200
    assert response.json()['type'] == 'FeatureCollection'
    assert response.json()['features'][0]['properties']['value_w_m2'] == 5


def test_public_analysis_route_reads_incident_and_hides_paths(tmp_path):
    run_id = 'a' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{}')
    write_raster(run / 'incident.tif', np.array([[4, 8]], dtype='float32'))
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/analysis')
    assert response.status_code == 200
    assert response['X-Artifact-Integrity'] == 'unverifiable-legacy'
    body = response.json()
    assert body['statistics'] == {'min': 4, 'max': 8, 'mean': 6, 'median': 6}
    assert str(tmp_path) not in response.content.decode()


def test_public_analysis_rejects_malformed_persisted_summary(tmp_path):
    run_id = 'c' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    write_raster(run / 'incident.tif', np.array([[4, 8]], dtype='float32'))
    import hashlib
    import json
    tif = run / 'incident.tif'
    (run / 'run.json').write_text(json.dumps({
        'analysis_summary': {'statistics': [], 'histogram': {}},
        'files': {'incident.tif': hashlib.sha256(tif.read_bytes()).hexdigest()},
    }))
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/analysis')
    assert response.status_code == 400
    assert response['Content-Type'].startswith('application/json')


@pytest.mark.parametrize('missing', ['cell_area', 'cell_area_units', 'min', 'max', 'mean', 'median'])
def test_public_analysis_rejects_missing_summary_fields_without_500(tmp_path, missing):
    import json
    run_id = 'e' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    path = run / 'incident.tif'
    write_raster(path, np.array([[0, 8]], dtype='float32'))
    summary = summarize_incident(path)
    if missing in summary:
        del summary[missing]
    elif missing in summary['statistics']:
        del summary['statistics'][missing]
    else:
        raise AssertionError('expected summary key')
    import hashlib
    (run / 'run.json').write_text(json.dumps({
        'analysis_summary': summary,
        'files': {'incident.tif': hashlib.sha256(path.read_bytes()).hexdigest()},
    }))
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/analysis')
    assert response.status_code == 400
    assert response['Content-Type'].startswith('application/json')


def test_empty_analysis_still_requires_explicit_statistics_keys(tmp_path):
    import hashlib
    import json
    run_id = '9' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    path = run / 'incident.tif'
    write_raster(path, np.array([[-9999, -9999]], dtype='float32'))
    summary = summarize_incident(path)
    assert summary['valid_cells'] == 0
    del summary['statistics']['min']
    (run / 'run.json').write_text(json.dumps({
        'analysis_summary': summary,
        'files': {'incident.tif': hashlib.sha256(path.read_bytes()).hexdigest()},
    }))
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/analysis')
    assert response.status_code == 400
    assert response['Content-Type'].startswith('application/json')


def test_new_summary_without_incident_hash_cannot_downgrade_to_legacy(tmp_path):
    import json
    run_id = 'f' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    path = run / 'incident.tif'
    write_raster(path, np.array([[2, 8]], dtype='float32'))
    (run / 'run.json').write_text(json.dumps({'analysis_summary': summarize_incident(path), 'files': {}}))
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/analysis')
    assert response.status_code == 404
    assert response['Content-Type'].startswith('application/json')


def test_public_analysis_rejects_tiff_changed_since_manifest_hash(tmp_path):
    import hashlib
    import json
    run_id = 'd' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    path = run / 'incident.tif'
    write_raster(path, np.array([[4, 8]], dtype='float32'))
    (run / 'run.json').write_text(json.dumps({'files': {'incident.tif': hashlib.sha256(path.read_bytes()).hexdigest()}}))
    with path.open('ab') as stream:
        stream.write(b'changed')
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/analysis')
    assert response.status_code == 404
    assert response['Content-Type'].startswith('application/json')


def test_public_analysis_limits_concurrent_scans(tmp_path):
    run_id = 'b' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{}')
    write_raster(run / 'incident.tif', np.array([[4]], dtype='float32'))
    assert views._ANALYSIS_SLOTS.acquire(blocking=False)
    assert views._ANALYSIS_SLOTS.acquire(blocking=False)
    try:
        with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'), \
             patch('solar.services.verify_incident_integrity', side_effect=AssertionError('hash must be semaphore-bounded')) as verify:
            response = Client().get(f'/api/solar/simulations/{run_id}/analysis')
        assert response.status_code == 429
        verify.assert_not_called()
        assert str(tmp_path) not in response.content.decode()
    finally:
        views._ANALYSIS_SLOTS.release()
        views._ANALYSIS_SLOTS.release()
