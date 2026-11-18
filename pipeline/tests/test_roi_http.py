"""Contrato HTTP aislado: no necesita PostGIS ni credenciales Earthdata."""
import json
import os
import signal
import subprocess
from pathlib import Path

import pytest
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
    write_json(path / 'result.json', {'manifests': [{'capas': [{'png': str(image), 'cog': str(image.with_suffix('.tif'))}]}]})
    with override_settings(ROI_OUTPUT_ROOT=tmp_path):
        response = Client().get(f'/roi-jobs/{key}')
        assert response.status_code == 200
        url = response.json()['manifests'][0]['capas'][0]['png']
        assert url == f'api/roi-jobs/{key}/assets/layers/scene/web/layer.png'
        download = Client().get(url.removeprefix('api'))
        assert b''.join(download.streaming_content) == b'png-fixture'
        download.close()


def test_ready_change_layers_rewritten_to_assets(tmp_path):
    key = 'c' * 64
    path = tmp_path / key
    image = path / 'layers' / 'cambio' / 'web' / 'delta.png'
    image.parent.mkdir(parents=True)
    image.write_bytes(b'delta-png')
    write_json(path / 'status.json', {'status': 'ready'})
    write_json(path / 'result.json', {'manifests': [], 'change': {
        'tipo': 'mapa_de_cambio', 'capas': [{'png': str(image), 'cog': str(image.with_suffix('.tif'))}]}})
    with override_settings(ROI_OUTPUT_ROOT=tmp_path):
        data = Client().get(f'/roi-jobs/{key}').json()
        assert data['change']['capas'][0]['png'] == f'api/roi-jobs/{key}/assets/layers/cambio/web/delta.png'
        download = Client().get(data['change']['capas'][0]['png'].removeprefix('api'))
        assert b''.join(download.streaming_content) == b'delta-png'
        download.close()


def test_ready_without_change_keeps_null(tmp_path):
    key = 'd' * 64
    path = tmp_path / key
    path.mkdir()
    write_json(path / 'status.json', {'status': 'ready'})
    write_json(path / 'result.json', {'manifests': [], 'change': None})
    with override_settings(ROI_OUTPUT_ROOT=tmp_path):
        assert Client().get(f'/roi-jobs/{key}').json()['change'] is None


def _make_run_job_fixture(tmp_path):
    key = 'b' * 64
    path = tmp_path / key
    path.mkdir()
    (path / 'reservation').mkdir()
    write_json(path / 'status.json', {'status': 'running', 'message': 'Procesando'})
    roi_views.ACTIVE.add(key)
    return path


@pytest.mark.parametrize('outcome', ['timeout', 'failure'])
def test_run_job_stops_scoped_process_tree_on_timeout_or_failure(tmp_path, monkeypatch, outcome):
    path = _make_run_job_fixture(tmp_path)
    observed = {'killpg': [], 'wait': [], 'startup_options': None}

    class Process:
        pid = 43210
        args = ['python', '-m', 'pipeline.roi_explore']
        returncode = 1
        def wait(self, timeout=None):
            observed['wait'].append(timeout)
            if outcome == 'timeout' and len(observed['wait']) == 1:
                raise subprocess.TimeoutExpired('coordinator', timeout)
            return self.returncode
    process = Process()
    def fake_popen(*args, **kwargs):
        observed['startup_options'] = kwargs
        return process
    monkeypatch.setattr(roi_views.subprocess, 'Popen', fake_popen)
    monkeypatch.setattr(os, 'killpg', lambda pid, sig: observed['killpg'].append((pid, sig)))
    # Bloquea la implementación anterior, que usa subprocess.run y no aísla el árbol.
    monkeypatch.setattr(roi_views.subprocess, 'run', lambda *a, **kw: (_ for _ in ()).throw(
        subprocess.TimeoutExpired('coordinator', kw.get('timeout')) if outcome == 'timeout' else
        subprocess.CalledProcessError(1, a[0])))

    roi_views.run_job(path)

    assert observed['killpg'] == [(process.pid, signal.SIGKILL)]
    assert len(observed['wait']) == 2
    assert observed['startup_options']['start_new_session'] is True
    status = json.loads((path / 'status.json').read_text(encoding='utf-8'))
    assert status['status'] == 'error'
    assert '30 minutos' in status['message']
    assert not (path / 'reservation').exists()
    assert path.name not in roi_views.ACTIVE


def test_run_job_success_runs_copy_after_reaping_coordinator(tmp_path, monkeypatch):
    path = _make_run_job_fixture(tmp_path)
    observed = {'waited': False, 'copied': False}
    class Process:
        pid = 43211
        args = ['python', '-m', 'pipeline.roi_explore']
        def wait(self, timeout=None):
            observed['waited'] = True
            return 0
    process = Process()
    monkeypatch.setattr(roi_views.subprocess, 'Popen', lambda *a, **kw: process)
    monkeypatch.setattr(roi_views, 'copy_to_database', lambda _: observed.update(copied=observed['waited']))
    from django.db import connection
    monkeypatch.setattr(connection, 'close', lambda: None)

    roi_views.run_job(path)

    assert observed == {'waited': True, 'copied': True}
    assert path.name not in roi_views.ACTIVE


def test_recompute_change_endpoint_validates_and_rewrites_assets(tmp_path):
    from pipeline import roi_explore
    key = 'e' * 64
    path = tmp_path / key
    image = path / 'layers' / 'cambio' / 'ml2_u1.5' / 'web' / 'delta.png'
    image.parent.mkdir(parents=True)
    image.write_bytes(b'delta-ml2')
    write_json(path / 'status.json', {'status': 'ready'})
    manifest = {'tipo': 'mapa_de_cambio', 'multilook': 2, 'umbral_dB': 1.5,
                'capas': [{'png': str(image), 'cog': str(image.with_suffix('.tif'))}]}
    calls = []

    def fake(run_dir, looks, threshold):
        calls.append((Path(run_dir), looks, threshold))
        roi_explore.change_params(looks, threshold)
        return json.loads(json.dumps(manifest))

    url = f'/roi-jobs/{key}/change'
    with override_settings(ROI_OUTPUT_ROOT=tmp_path), patch.object(roi_views, 'recompute_change', fake):
        client = Client()
        response = client.post(url, json.dumps({'multilook': 2, 'umbral_dB': 1.5}), content_type='application/json')
        assert response.status_code == 200
        assert calls == [(path, 2, 1.5)]
        png = response.json()['capas'][0]['png']
        assert png == f'api/roi-jobs/{key}/assets/layers/cambio/ml2_u1.5/web/delta.png'
        download = client.get(png.removeprefix('api'))
        assert b''.join(download.streaming_content) == b'delta-ml2'
        download.close()
        for body in ({'multilook': 3, 'umbral_dB': 3}, {'multilook': 5}, [], {'multilook': 5, 'umbral_dB': 'x'}):
            assert client.post(url, json.dumps(body), content_type='application/json').status_code == 400
        assert client.post(f'/roi-jobs/{"f" * 64}/change', json.dumps({'multilook': 5, 'umbral_dB': 3}),
                           content_type='application/json').status_code == 404


def test_recompute_change_endpoint_busy_and_not_ready(tmp_path):
    from pipeline.roi_explore import ChangeBusy
    key = '1' * 64
    path = tmp_path / key
    path.mkdir()
    write_json(path / 'status.json', {'status': 'running', 'message': 'Procesando'})
    body = json.dumps({'multilook': 5, 'umbral_dB': 3})
    url = f'/roi-jobs/{key}/change'

    def busy(*_):
        raise ChangeBusy('ocupado')
    with override_settings(ROI_OUTPUT_ROOT=tmp_path), patch.object(roi_views, 'recompute_change', busy):
        assert Client().post(url, body, content_type='application/json').status_code == 409
        write_json(path / 'status.json', {'status': 'ready'})
        response = Client().post(url, body, content_type='application/json')
        assert response.status_code == 409 and response.json()['detail'] == 'ocupado'
