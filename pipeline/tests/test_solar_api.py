"""HTTP contract tests, isolated from PostGIS and Earthdata."""
from unittest.mock import patch
from types import SimpleNamespace
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import numpy as np
from pyproj import Transformer
from rasterio.transform import from_origin
import json
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'solar.test_settings')
import django
django.setup()
from django.test import Client, override_settings

ROI = {'type': 'Polygon', 'coordinates': [[[-92.01, 16], [-92.005, 16], [-92.005, 16.005], [-92.01, 16.005], [-92.01, 16]]]}
BODY = {'roi': ROI, 'datetime_local': '2026-06-18T12:00:00', 'timezone': 'America/Mexico_City', 'intensity_percent': 75}


def post(body):
    return Client().post('/api/solar/simulations', data=json.dumps(body), content_type='application/json')


def test_invalid_request_preflight(tmp_path):
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs', SOLAR_NASADEM_CACHE=tmp_path / 'cache'):
        for changes, status in [({'albedo': 0.2}, 400), ({'intensity_percent': True}, 400),
                                ({'intensity_percent': '75'}, 400), ({'intensity_percent': 101}, 400),
                                ({'datetime_local': '2026-03-08T02:30:00', 'timezone': 'America/New_York'}, 400),
                                ({'roi': {'type': 'Polygon', 'coordinates': [[[-90, 10], [-89, 10], [-89, 11], [-90, 11], [-90, 10]]]}}, 413)]:
            response = post({**BODY, **changes})
            assert response.status_code == status, response.content
            assert response.json()
        for change in ({'intensity_percent': 10**400},
                       {'roi': {'type': 'Polygon', 'coordinates': [[[10**400, 0], [0, 0], [1, 1], [10**400, 0]]]}}):
            assert post({**BODY, **change}).status_code == 400
        malformed_roi = {'type': 'Polygon', 'coordinates': ROI['coordinates'][0]}
        with patch('pipeline.solar.nasadem.NASADEMProvider.acquire_roi') as provider:
            response = post({**BODY, 'roi': malformed_roi})
            assert response.status_code == 400
            assert response['Content-Type'].startswith('application/json')
            assert response.json()['code'] == 'invalid_request'
            provider.assert_not_called()
        assert not (tmp_path / 'runs').exists()
        assert not (tmp_path / 'cache').exists()


def test_real_delivery_http_and_samples(tmp_path):
    x, y = Transformer.from_crs('EPSG:4326', 'EPSG:32615', always_xy=True).transform(-92.0075, 16.0025)
    transform = from_origin(x - 30, y + 30, 30, 30)
    values = np.array([[np.nan, 0], [25, 75]], dtype=float)
    surface = {'incident_w_m2': values, 'valid_mask': np.isfinite(values),
               'transform': transform.to_gdal(), 'crs': 'EPSG:32615',
               'position': {'azimuth_deg': 180, 'pressure_hpa': 900, 'pressure_provenance': 'synthetic test'},  'clear_sky': {'dni_adjusted_w_m2': 100},
               'model': 'direct-geometric-v1', 'units': 'W/m2', 'night': False}
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs', SOLAR_NASADEM_CACHE=tmp_path / 'cache'):
        with patch('pipeline.solar.surface.compute_incident_irradiance', return_value=surface):
            response = post(BODY)
        assert response.status_code == 201, response.content
        payload = response.json()
        run_id = payload['id']
        assert response['Location'] == '/api/solar/simulations/' + run_id
        assert payload['raster']['units'] == 'W/m2'
        assert payload['preview']['palette'] == 'inferno'
        base = response['Location']
        client = Client()
        detail = client.get(base).json()
        assert detail['status'] == 'ready'
        assert detail['request'] == payload['request']  # ROI and effective inputs survive GET/restart
        assert b''.join(client.get(base + '/preview/incident').streaming_content).startswith(b'\x89PNG')
        assert b''.join(client.get(base + '/export/incident').streaming_content)[:4] in (b'II*\x00', b'MM\x00*')
        def at(col, row):
            lon, lat = Transformer.from_crs('EPSG:32615', 'EPSG:4326', always_xy=True).transform(* (transform * (col + .5, row + .5)))
            return client.get(base + '/sample', {'lon': lon, 'lat': lat}).json()
        assert at(1, 0) == {'value_w_m2': 0.0, 'status': 'valid'}
        assert at(0, 0) == {'value_w_m2': None, 'status': 'nodata'}
        assert at(1, 1) == {'value_w_m2': 75.0, 'status': 'valid'}
        assert client.get(base + '/sample', {'lon': 0, 'lat': 0}).json()['status'] == 'outside_coverage'
        assert client.get(base + '/sample', {'lon': 'nan', 'lat': 0}).status_code == 400
        assert client.get(base + '/sample', {'lon': 180, 'lat': 90}).json()['status'] == 'outside_coverage'
        assert client.get(base + '/preview/other').json()['code'] == 'not_found'
        assert client.get('/api/solar/simulations/' + 'A' * 32).json()['code'] == 'not_found'
        assert client.get(base + '/sample', {'lon': 0, 'lat': 0, 'file': 'secret'}).status_code == 400
        assert sorted(p.name for p in (tmp_path / 'runs' / run_id).iterdir()) == ['incident.tif', 'preview.png', 'run.json']


def test_real_surface_and_export_with_offline_tile(tmp_path):
    from pipeline.solar.dem import prepare_dem
    from pipeline.solar.nasadem import NASADEMProvider
    tile = tmp_path / 'n00e000.zip'
    with ZipFile(tile, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('n00e000.hgt', np.full((401, 401), 100, dtype='>i2').tobytes())
    small_roi = {'type': 'Polygon', 'coordinates': [[[.2, .2], [.22, .2], [.22, .22], [.2, .22], [.2, .2]]]}
    def prepared(paths, roi):
        return prepare_dem(paths, roi, tile_size=401)
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs', SOLAR_NASADEM_CACHE=tmp_path / 'cache'), \
         patch.object(NASADEMProvider, 'acquire_roi', return_value=(SimpleNamespace(tile_id='n00e000', path=tile),)), \
         patch('pipeline.solar.surface.prepare_dem', side_effect=prepared):
        response = post({**BODY, 'roi': small_roi, 'timezone': 'UTC', 'datetime_local': '2026-06-18T12:00:00'})
    assert response.status_code == 201, response.content
    assert response.json()['position']['altitude_m'] == 100
    assert response.json()['position']['temperature_c'] == 12
    assert response.json()['position']['temperature_provenance'].startswith('default:')
    assert response.json()['request']['temperature_c'] == 12
    assert response.json()['raster']['valid_pixels'] > 0
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        assert Client().get(response['Location']).status_code == 200


def test_symlinks_and_busy_do_not_serve_or_publish(tmp_path):
    from solar import services
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs', SOLAR_NASADEM_CACHE=tmp_path / 'cache'):
        assert services._GUARD.acquire(False)
        try:
            assert post(BODY).status_code == 429
            assert not (tmp_path / 'runs').exists()
        finally:
            services._GUARD.release()
        root = tmp_path / 'runs'
        root.mkdir()
        run_id = 'b' * 32
        (root / run_id).symlink_to(tmp_path, target_is_directory=True)
        assert Client().get('/api/solar/simulations/' + run_id).status_code == 404
        (root / run_id).unlink()
        (root / run_id).mkdir()
        (root / run_id / 'run.json').symlink_to(tmp_path / 'outside.json')
        assert Client().get('/api/solar/simulations/' + run_id).status_code == 404
        assert Client().get('/api/solar/simulations/' + run_id + '/preview/incident').status_code == 404


def test_missing_run_and_malformed_id(tmp_path):
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        assert Client().get('/api/solar/simulations/' + 'a' * 32).status_code == 404
        assert Client().get('/api/solar/simulations/not-an-id').status_code == 404
