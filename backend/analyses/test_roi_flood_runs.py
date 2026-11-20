"""Contrato HTTP ROI: sin red ni nueva ejecución nativa."""
import hashlib
import json
from pathlib import Path
import shutil
from types import SimpleNamespace
from unittest.mock import patch
import uuid

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from pipeline.tests.test_roi_runner import payload, config

BASE = Path(__file__).resolve().parents[2] / 'data/test-runs'
PROOF = BASE / 'roi-dg2-136934da-7370-4113-b337-36ebc0bcafcc/6c5b38f4-9d14-4c71-912b-04ed7629d94a'


class RoiHttpTests(SimpleTestCase):
    def setUp(self):
        self.root = BASE / f'roi-api-{uuid.uuid4()}'
        self.jobs = self.root / 'jobs'
        self.settings_patch = override_settings(FLOOD_ROI_DG2_RUN_ROOT=str(self.jobs), FLOOD_ROI_DG2_CONFIG=config())
        self.settings_patch.enable()
        self.addCleanup(self.settings_patch.disable)
        self.alice = APIClient(); self.alice.force_authenticate(user=SimpleNamespace(pk=1, is_authenticated=True))
        self.bob = APIClient(); self.bob.force_authenticate(user=SimpleNamespace(pk=2, is_authenticated=True))
        self.anon = APIClient()
        self.start = '/api/flood-scenarios/roi/start/'

    def seed(self):
        run_id = PROOF.name
        directory = self.jobs / run_id
        (directory / 'cogs').mkdir(parents=True)
        state = json.loads((PROOF / 'state.json').read_text())
        state['owner'] = '1'
        (directory / 'state.json').write_text(json.dumps(state))
        for item in state['artifacts']:
            shutil.copyfile(PROOF / item['file'], directory / item['file'])
        return run_id, state, directory

    def test_start_detaches_and_whitelists_without_legacy_case(self):
        self.assertIn(self.anon.post(self.start, payload(), format='json').status_code, (401, 403))
        with patch('analyses.roi_flood_runs.start_roi_run', wraps=__import__('pipeline.hydrology.roi_runner', fromlist=['start_roi_run']).start_roi_run) as start:
            # The real preflight/state writer runs, while process launch is disabled only in this test.
            from pipeline.hydrology.roi_runner import start_roi_run
            start.side_effect = lambda *args, **kwargs: start_roi_run(*args, **{**kwargs, 'launch': False})
            response = self.alice.post(self.start, payload(), format='json')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(start.call_args.args, ('1', payload()))
        self.assertEqual(set(response.json()), {'id','state','stage','simulation_duration_s','save_interval_s','dg2_depth_thresh_m','requested_solver','solver','solver_fallback','solver_attempts','boundary','initial_condition','losses','lakes','synthetic','hydraulic_accuracy_validated','status_url','results_url'})
        self.assertIsNone(response.json()['dg2_depth_thresh_m'])
        # A payload without `solver` runs DG2; no fallback and no attempt yet.
        self.assertEqual([response.json()[k] for k in ('requested_solver', 'solver', 'solver_fallback', 'solver_attempts')], ['dg2', 'dg2', None, []])
        self.assertEqual(response.json()['boundary'], {s: {'type': 'free'} for s in ('north', 'east', 'south', 'west')})
        self.assertEqual(response.json()['initial_condition'], 'dry_zero_velocity')
        self.assertEqual(response.json()['lakes'], 'none')
        self.assertEqual(response.json()['losses'], {'infiltration': 'unsupported', 'runoff_coefficient': None, 'atmospheric_pressure_hpa': None, 'barometric_surge_m': 0.0})
        self.assertEqual(response.json()['state'], 'created')
        self.assertEqual(self.alice.get(response.json()['results_url']).status_code, 409)
        self.assertEqual(self.bob.get(response.json()['status_url']).status_code, 404)

    def test_start_echoes_explicit_thin_depth_threshold(self):
        body = payload(); body['simulation']['dg2_depth_thresh_m'] = .02
        with patch('analyses.roi_flood_runs.start_roi_run') as start:
            from pipeline.hydrology.roi_runner import start_roi_run
            start.side_effect = lambda *args, **kwargs: start_roi_run(*args, **{**kwargs, 'launch': False})
            response = self.alice.post(self.start, body, format='json')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()['dg2_depth_thresh_m'], .02)
        self.assertEqual(self.alice.get(response.json()['status_url']).json()['dg2_depth_thresh_m'], .02)

    def test_rejections_leave_no_jobs(self):
        examples = [dict(payload(), extra='path'), {k:v for k,v in payload().items() if k != 'domain'}]
        bad_domain = payload(); bad_domain['domain'] = bad_domain['roi']; bad_domain['roi'] = payload()['domain']; examples.append(bad_domain)
        budget = payload(); budget['simulation']['save_interval_s'] = .000001; examples.append(budget)
        for body in examples:
            response = self.alice.post(self.start, body, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertEqual(set(response.json()), {'errors'})
        duplicate = self.alice.generic('POST', self.start, json.dumps(payload()).replace('"roi":', '"roi": {}, "roi":', 1), content_type='application/json')
        self.assertEqual(duplicate.status_code, 400)
        with override_settings(FLOOD_ROI_DG2_CONFIG=None):
            self.assertEqual(self.alice.post(self.start, payload(), format='json').status_code, 503)
        self.assertFalse(self.jobs.exists())

    def test_owner_result_artifact_and_tamper(self):
        run_id, state, directory = self.seed()
        status = f'/api/flood-roi-runs/{run_id}/'
        results = status + 'results/'
        name = Path(state['artifacts'][0]['file']).name
        download = status + f'artifacts/{name}/'
        for client in (self.bob, self.anon):
            self.assertNotEqual(client.get(status).status_code, 200)
            self.assertNotEqual(client.get(results).status_code, 200)
            self.assertNotEqual(client.get(download).status_code, 200)
        # Runs recorded before the threshold existed ran with the solver default (off): reported as null.
        self.assertEqual(set(self.alice.get(status).json()), {'id','state','stage','simulation_duration_s','save_interval_s','dg2_depth_thresh_m','requested_solver','solver','solver_fallback','solver_attempts','boundary','initial_condition','losses','lakes','synthetic','hydraulic_accuracy_validated','status_url','results_url'})
        self.assertIsNone(self.alice.get(status).json()['dg2_depth_thresh_m'])
        self.assertIsNone(self.alice.get(status).json()['boundary'])  # seeded run predates per-side boundaries
        # Runs recorded before the solver choice ran DG2 without fallback.
        self.assertEqual([self.alice.get(status).json()[k] for k in ('requested_solver', 'solver', 'solver_fallback', 'solver_attempts')], ['dg2', 'dg2', None, None])
        result = self.alice.get(results)
        self.assertEqual(result.status_code, 200)
        body = result.json()
        self.assertEqual(body['time_axis']['status'], 'actual_times_unavailable')
        self.assertIn('mass_balance', body)
        self.assertIsNone(body['mass_balance'])  # seeded run predates the rain-inclusive balance
        self.assertIn('flow', body)
        self.assertIsNone(body['flow'])  # seeded run predates voutput flow arrows
        # Chart inputs: synthetic rain segments in mm/h from the run provenance, and the depth class bounds.
        self.assertEqual(body['rainfall_segments'], [{'start_s': 0.0, 'end_s': 0.5, 'intensity_mm_h': 0.002000978706862038 * 3.6e6},
                                                     {'start_s': 0.5, 'end_s': 1.0, 'intensity_mm_h': 0.001999021293137962 * 3.6e6}])
        self.assertIsNone(body['depth_classes_m'])  # seeded run predates depth classes
        self.assertIsNone(body['froude'])
        self.assertIsNone(body['time_of_concentration'])
        self.assertIsNone(body['negative_depth'])
        self.assertEqual([body['requested_solver'], body['solver'], body['solver_fallback']], ['dg2', 'dg2', None])
        self.assertIsNone(body['roads'])
        self.assertIsNone(body['lakes'])
        self.assertEqual(len(body['artifacts']), 4)
        self.assertTrue(all('file' not in item and item['url'].startswith(status) and item['nodata'] == body['grid']['nodata'] for item in body['artifacts']))
        self.assertTrue(all(frame['time_s'] is None for frame in body['frames']))
        self.assertNotIn(str(self.root), json.dumps(body))
        response = self.alice.get(download)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/tiff')
        self.assertEqual(hashlib.sha256(b''.join(response.streaming_content)).hexdigest(), state['artifacts'][0]['sha256'])
        self.assertEqual(self.alice.get(status + 'artifacts/state.json/').status_code, 404)
        (directory / state['artifacts'][0]['file']).write_bytes(b'tampered')
        self.assertEqual(self.alice.get(download).status_code, 404)
        self.assertEqual(self.alice.get('/api/flood-roi-runs/not-a-uuid/').status_code, 404)

    def test_safe_failure_and_symlink_directory(self):
        run_id, state, directory = self.seed()
        state.update(state='failed', stage='failed', error='acquisition_failed')
        (directory / 'state.json').write_text(json.dumps(state))
        url = f'/api/flood-roi-runs/{run_id}/'
        self.assertEqual(self.alice.get(url).json()['error'], 'acquisition_failed')
        self.assertEqual(self.alice.get(url + 'results/').status_code, 409)
        state['error'] = 'private traceback /secret'
        (directory / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.alice.get(url).json()['error'], 'run_failed')
        # No seguir un directorio UUID convertido en enlace, incluso hacia otro trabajo.
        other = self.jobs / str(uuid.uuid4())
        other.symlink_to(directory, target_is_directory=True)
        self.assertEqual(self.alice.get(f'/api/flood-roi-runs/{other.name}/').status_code, 404)

    def test_status_and_results_echo_the_automatic_solver_fallback(self):
        run_id, state, directory = self.seed()
        fallback = {'from': 'dg2', 'to': 'fv1', 'reason': 'negative_depth_artifacts'}
        attempts = [{'solver': 'dg2', 'outcome': 'failed', 'reason': 'negative_depth_artifacts'},
                    {'solver': 'fv1', 'outcome': 'succeeded', 'reason': None}]
        state.update(requested_solver='dg2', solver='fv1', solver_fallback=fallback, solver_attempts=attempts)
        state['result'].update(requested_solver='dg2', solver='fv1', solver_fallback=fallback)
        (directory / 'state.json').write_text(json.dumps(state))
        url = f'/api/flood-roi-runs/{run_id}/'
        status = self.alice.get(url).json()
        self.assertEqual([status['requested_solver'], status['solver'], status['solver_fallback'], status['solver_attempts']], ['dg2', 'fv1', fallback, attempts])
        body = self.alice.get(url + 'results/').json()
        self.assertEqual([body['requested_solver'], body['solver'], body['solver_fallback']], ['dg2', 'fv1', fallback])

    def test_failed_run_reports_negative_depth_artifacts_and_both_attempts(self):
        run_id, state, directory = self.seed()
        attempts = [{'solver': 'dg2', 'outcome': 'failed', 'reason': 'negative_depth_artifacts'},
                    {'solver': 'fv1', 'outcome': 'failed', 'reason': 'output_invalid'}]
        state.update(state='failed', stage='results', error='negative_depth_artifacts', solver='fv1', solver_attempts=attempts)
        (directory / 'state.json').write_text(json.dumps(state))
        status = self.alice.get(f'/api/flood-roi-runs/{run_id}/').json()
        self.assertEqual(status['error'], 'negative_depth_artifacts')
        self.assertEqual(status['solver_attempts'], attempts)

    def test_start_rejects_fv1_with_a_thin_depth_threshold_and_echoes_fv1(self):
        body = payload(); body['simulation'].update(solver='fv1', dg2_depth_thresh_m=.02)
        self.assertEqual(self.alice.post(self.start, body, format='json').status_code, 400)
        body['simulation']['dg2_depth_thresh_m'] = None
        with patch('analyses.roi_flood_runs.start_roi_run') as start:
            from pipeline.hydrology.roi_runner import start_roi_run
            start.side_effect = lambda *args, **kwargs: start_roi_run(*args, **{**kwargs, 'launch': False})
            response = self.alice.post(self.start, body, format='json')
        self.assertEqual(response.status_code, 202)
        self.assertEqual([response.json()['requested_solver'], response.json()['solver']], ['fv1', 'fv1'])

    def test_preview_palette_uses_the_pipeline_depth_classes(self):
        from analyses.roi_flood_runs import _DEPTH_CLASSES
        from pipeline.hydrology.results import DEPTH_CLASS_BOUNDS_M
        self.assertEqual(tuple(lower for lower, _ in _DEPTH_CLASSES), DEPTH_CLASS_BOUNDS_M)
