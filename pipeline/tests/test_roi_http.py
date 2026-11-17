"""Contrato HTTP aislado: no necesita PostGIS ni credenciales Earthdata."""
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'scenes.roi_test_settings')
import django
django.setup()
from django.test import Client, override_settings
from pipeline.roi_explore import write_json
from scenes import roi_views

ROI = {'type': 'Polygon', 'coordinates': [[[-93, 16], [-92.9, 16], [-92.9, 16.1], [-93, 16.1], [-93, 16]]]}


def test_reject_bad_request_before_any_work(tmp_path):
    with override_settings(ROI_OUTPUT_ROOT=tmp_path), patch.object(roi_views.POOL, 'submit') as submit:
        for body in ({}, [], {'roi': {'type': 'Point', 'coordinates': [0, 0]}}):
            assert Client().post('/roi-jobs', json.dumps(body), content_type='application/json').status_code == 400
        submit.assert_not_called()


def test_job_dedup_status_and_asset_boundary(tmp_path):
    with override_settings(ROI_OUTPUT_ROOT=tmp_path), patch.object(roi_views.POOL, 'submit') as submit:
        roi_views.ACTIVE.clear()
        client = Client()
        response = client.post('/roi-jobs', json.dumps({'roi': ROI}), content_type='application/json')
        assert response.status_code == 202
        key = response.json()['id']
        path = tmp_path / key
        again = client.post('/roi-jobs', json.dumps({'roi': ROI}), content_type='application/json')
        assert again.json()['id'] == key
        assert submit.call_count == 1
        assert client.get(f'/roi-jobs/{key}').json()['status'] == 'queued'
        write_json(path / 'status.json', {'status': 'error', 'message': 'Sin cobertura'})
        assert client.get(f'/roi-jobs/{key}').json()['message'] == 'Sin cobertura'
        assert client.get(f'/roi-jobs/{key}/assets/request.json').status_code == 404
        assert client.get('/roi-jobs/invalid').status_code == 404
        roi_views.ACTIVE.clear()


def test_ready_assets_rewritten_without_exposing_files(tmp_path):
    key = 'a' * 64
    path = tmp_path / key
    image = path / 'layers' / 'scene' / 'web' / 'layer.png'
    image.parent.mkdir(parents=True)
    image.write_bytes(b'png-fixture')
    write_json(path / 'status.json', {'status': 'ready'})
    write_json(path / 'result.json', {'manifests': [{'capas': [{'png': str(image), 'cog': str(image.with_suffix('.tif'))}]}],
                                    'timings': {'search_asf_seconds': 0.25, 'scene_processing_seconds': [1.5],
                                                'grid_compare_seconds': 0.1, 'chart_copy_seconds': 0.05,
                                                'server_prepare_total_seconds': 2.0}})
    with override_settings(ROI_OUTPUT_ROOT=tmp_path):
        response = Client().get(f'/roi-jobs/{key}')
        assert response.status_code == 200
        assert response.json()['timings']['server_prepare_total_seconds'] == 2.0
        url = response.json()['manifests'][0]['capas'][0]['png']
        assert url == f'api/roi-jobs/{key}/assets/layers/scene/web/layer.png'
        download = Client().get(url.removeprefix('api'))
        assert b''.join(download.streaming_content) == b'png-fixture'
        download.close()
