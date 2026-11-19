"""HTTP contract tests, isolated from PostGIS and Earthdata."""
from unittest.mock import patch
from types import SimpleNamespace
from io import BytesIO
import hashlib
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
BODY = {'roi': ROI, 'elevation_deg': 45, 'azimuth_deg': 180, 'intensity_percent': 75}


def test_idealized_request_defaults_angles_and_rejects_temporal_fields():
    from backend.solar.serializers import validate_request
    result = validate_request({'roi': ROI})
    assert result['elevation_deg'] == 45.0
    assert result['azimuth_deg'] == 180.0
    for field in ('date', 'datetime_local', 'timezone'):
        import pytest
        with pytest.raises(Exception):
            validate_request({'roi': ROI, field: '2026-06-18'})



def post(body):
    return Client().post('/api/solar/simulations', data=json.dumps(body), content_type='application/json')


def test_invalid_request_preflight(tmp_path):
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs', SOLAR_NASADEM_CACHE=tmp_path / 'cache'):
        for changes, status in [({'albedo': 0.2}, 400), ({'intensity_percent': True}, 400),
                                ({'intensity_percent': '75'}, 400), ({'intensity_percent': 101}, 400),
                                ({'datetime_local': '2026-03-08T02:30:00'}, 400),
                                ({'elevation_deg': -0.1}, 400), ({'azimuth_deg': 360.1}, 400),
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
        code_hash = hashlib.sha256()
        for name in ('pipeline/solar/delivery.py', 'pipeline/solar/surface.py',
                     'pipeline/solar/dem.py', 'pipeline/solar/position.py',
                     'pipeline/solar/clearsky.py', 'pipeline/solar/time.py',
                     'pipeline/solar/radiation.py', 'pipeline/solar/terrain.py',
                     'pipeline/solar/nasadem.py', 'pipeline/elevation/nasadem.py',
                     'pipeline/solar/acquire.py',
                     'pipeline/solar/export.py', 'backend/solar/analysis.py',
                     'backend/solar/services.py', 'backend/solar/serializers.py'):
            code_hash.update(name.encode())
            code_hash.update(Path(name).read_bytes())
        assert payload['code_version'] == 'sha256:' + code_hash.hexdigest()
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
        run_path = tmp_path / 'runs' / run_id
        run_manifest = json.loads((run_path / 'run.json').read_text())
        persisted = run_manifest['analysis_summary']
        assert run_manifest['files']['incident.tif'] == hashlib.sha256((run_path / 'incident.tif').read_bytes()).hexdigest()
        with patch('solar.views.summarize_incident', side_effect=AssertionError('GET reread incident.tif')):
            analysis = client.get(base + '/analysis')
        assert analysis.status_code == 200
        assert analysis['X-Artifact-Integrity'] == 'sha256-verified'
        summary = analysis.json()
        assert {key: summary[key] for key in persisted} == persisted
        assert summary['units'] == 'W/m2'
        assert summary['valid_cells'] == 3
        assert summary['statistics'] == {'min': 0.0, 'max': 75.0,
                                         'mean': 100 / 3, 'median': 25.0}
        assert summary['dni_input_w_m2'] == 100
        assert np.isclose(summary['mean_incident_to_dni_ratio'], 1 / 3)
        assert summary['ratio_units'] == 'dimensionless'
        assert sum(summary['histogram']['counts']) == summary['valid_cells']
        assert summary['histogram']['bin_edges'][0] == 0.0
        assert summary['histogram']['bin_edges'][-1] == 75.0
        assert client.get(base + '/sample', {'lon': 0, 'lat': 0}).json()['status'] == 'outside_coverage'
        assert client.get(base + '/sample', {'lon': 'nan', 'lat': 0}).status_code == 400
        assert client.get(base + '/sample', {'lon': 180, 'lat': 90}).json()['status'] == 'outside_coverage'
        assert client.get(base + '/preview/other').json()['code'] == 'not_found'
        assert client.get('/api/solar/simulations/' + 'A' * 32).json()['code'] == 'not_found'
        assert client.get(base + '/sample', {'lon': 0, 'lat': 0, 'file': 'secret'}).status_code == 400
        assert sorted(p.name for p in (tmp_path / 'runs' / run_id).iterdir()) == ['incident.tif', 'preview.png', 'run.json']


def test_public_concave_roi_raster_and_sample_mask_outside_centers(tmp_path):
    import rasterio
    from pipeline.solar.dem import PreparedDEM
    from pyproj import CRS
    from rasterio.transform import Affine

    roi = {'type': 'Polygon', 'coordinates': [[
        [0.01, 0.01], [0.09, 0.01], [0.09, 0.09], [0.055, 0.09],
        [0.055, 0.035], [0.045, 0.035], [0.045, 0.09], [0.01, 0.09], [0.01, 0.01]
    ]]}
    shape = (100, 100)
    prepared = PreparedDEM(
        np.full(shape, 100, dtype='float32'), np.ones(shape, dtype=bool),
        np.zeros(shape, dtype=bool), (0, 1113.2, 0, 111320, 0, -1113.2),
        CRS.from_proj4('+proj=eqc +datum=WGS84 +units=m +no_defs'), ('synthetic',),
    )
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs', SOLAR_NASADEM_CACHE=tmp_path / 'cache'), \
         patch('pipeline.solar.nasadem.NASADEMProvider.acquire_roi', return_value=(SimpleNamespace(tile_id='synthetic', path=b'unused'),)), \
         patch('pipeline.solar.surface.prepare_dem', return_value=prepared):
        response = post({'roi': roi, 'elevation_deg': 45, 'azimuth_deg': 180})
    assert response.status_code == 201, response.content
    run_id = response.json()['id']
    tif_path = tmp_path / 'runs' / run_id / 'incident.tif'
    with rasterio.open(tif_path) as src:
        # A pixel center within the bbox but in the polygon's notch must be NoData.
        row, col = 40, 50
        pixel = src.read(1, window=((row, row + 1), (col, col + 1)), masked=True)
        assert bool(np.ma.getmaskarray(pixel)[0, 0])
        x, y = src.xy(row, col)
        lon, lat = Transformer.from_crs(src.crs, 'EPSG:4326', always_xy=True).transform(x, y)
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        sampled = Client().get(f'/api/solar/simulations/{run_id}/sample', {'lon': lon, 'lat': lat})
    assert sampled.status_code == 200
    assert sampled.json() == {'value_w_m2': None, 'status': 'nodata'}


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
        response = post({**BODY, 'roi': small_roi})
    assert response.status_code == 201, response.content
    assert response.json()['position']['altitude_m'] == 100
    assert response.json()['position']['elevation_deg'] == 45
    assert response.json()['position']['azimuth_deg'] == 180
    assert response.json()['position']['elevation_deg'] == 45
    assert 'datetime_utc' not in response.json()['position']
    assert response.json()['clear_sky']['dni_extra_w_m2'] == 1361.0
    assert response.json()['clear_sky']['linke_turbidity'] == 3.0
    assert 'no date' in response.json()['clear_sky']['reference_provenance']
    assert response.json()['request']['elevation_deg'] == 45
    assert response.json()['request']['azimuth_deg'] == 180
    assert not {'date', 'datetime_local', 'timezone'} & response.json()['request'].keys()
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


def test_public_artifact_routes_verify_hash_and_allow_legacy(tmp_path):
    run_id = 'e' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    # Reuse valid generated artifacts from a tiny valid GeoTIFF and PNG signature.
    import rasterio
    from rasterio.transform import from_origin
    tif = run / 'incident.tif'
    with rasterio.open(tif, 'w', driver='GTiff', height=1, width=1, count=1,
                       dtype='float32', crs='EPSG:32615', transform=from_origin(0, 1, 1, 1)) as dst:
        dst.write(np.array([[5]], dtype='float32'), 1)
    png = run / 'preview.png'
    png.write_bytes(b'\\x89PNG\\r\\n\\x1a\\nvalid-test-png')
    hashes = {'incident.tif': hashlib.sha256(tif.read_bytes()).hexdigest(),
              'preview.png': hashlib.sha256(png.read_bytes()).hexdigest()}
    manifest = run / 'run.json'
    client = Client()
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        for route, filename in (('export/incident', 'incident.tif'), ('sample?lon=0&lat=0', 'incident.tif'),
                                ('preview/incident', 'preview.png')):
            manifest.write_text(json.dumps({'files': hashes}))
            response = client.get(f'/api/solar/simulations/{run_id}/{route}')
            assert response.status_code == 200
            if getattr(response, 'streaming', False):
                b''.join(response.streaming_content)
            # Historical manifests without hashes remain readable and are not rewritten.
            manifest.write_text('{}')
            response = client.get(f'/api/solar/simulations/{run_id}/{route}')
            assert response.status_code == 200
            assert manifest.read_text() == '{}'
            # A new run with an analysis summary must not silently downgrade
            # when the hash for this particular artifact disappears.
            manifest.write_text(json.dumps({'analysis_summary': {}, 'files': {
                key: value for key, value in hashes.items() if key != filename}}))
            assert client.get(f'/api/solar/simulations/{run_id}/{route}').status_code == 404
            manifest.write_text(json.dumps({'files': hashes}))
            artifact = run / filename
            artifact.write_bytes(artifact.read_bytes() + b'altered')
            response = client.get(f'/api/solar/simulations/{run_id}/{route}')
            assert response.status_code == 404
            assert str(tmp_path) not in response.content.decode()
            artifact.write_bytes(tif.read_bytes() if filename == 'incident.tif' else b'\\x89PNG\\r\\n\\x1a\\nvalid-test-png')
            # Restore the TIFF through a fresh valid raster after mutation.
            if filename == 'incident.tif':
                with rasterio.open(artifact, 'w', driver='GTiff', height=1, width=1, count=1,
                                   dtype='float32', crs='EPSG:32615', transform=from_origin(0, 1, 1, 1)) as dst:
                    dst.write(np.array([[5]], dtype='float32'), 1)
            hashes[filename] = hashlib.sha256(artifact.read_bytes()).hexdigest()


def test_sample_unmasked_legacy_tiff_returns_valid_pixel_without_500(tmp_path):
    import rasterio
    run_id = '7' * 32
    run = tmp_path / 'runs' / run_id
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{}')  # historical file without hash or mask
    with rasterio.open(run / 'incident.tif', 'w', driver='GTiff', height=1, width=1,
                       count=1, dtype='float32', crs='EPSG:4326',
                       transform=from_origin(-102, 22, 0.01, 0.01)) as dst:
        dst.write(np.array([[5]], dtype='float32'), 1)
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        response = Client().get(f'/api/solar/simulations/{run_id}/sample',
                                {'lon': -101.995, 'lat': 21.995})
    assert response.status_code == 200
    assert response.json() == {'value_w_m2': 5.0, 'status': 'valid'}


def test_missing_run_and_malformed_id(tmp_path):
    with override_settings(SOLAR_OUTPUT_ROOT=tmp_path / 'runs'):
        assert Client().get('/api/solar/simulations/' + 'a' * 32).status_code == 404
        assert Client().get('/api/solar/simulations/not-an-id').status_code == 404
