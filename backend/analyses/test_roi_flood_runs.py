"""Contrato HTTP ROI: sin red ni nueva ejecución nativa."""
import hashlib
import io
import json
from pathlib import Path
import shutil
from types import SimpleNamespace
from unittest.mock import patch
import uuid

from django.test import SimpleTestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from pipeline.tests.test_roi_runner import payload, config

BASE = Path(__file__).resolve().parents[2] / 'data/test-runs'
STATUS_KEYS = {'id','state','stage','progress','simulation_duration_s','save_interval_s','dg2_depth_thresh_m','requested_solver','solver','solver_fallback','solver_attempts','boundary','initial_condition','losses','lakes','land_surface','rainfall_source','design_storm','terrain_source','vertical_datum','terrain_attribution','tide','bathymetry','synthetic','hydraulic_accuracy_validated','status_url','results_url'}
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
        self.assertEqual(set(response.json()), STATUS_KEYS)
        self.assertIsNone(response.json()['dg2_depth_thresh_m'])
        # A payload without `solver` runs DG2; no fallback and no attempt yet.
        self.assertEqual([response.json()[k] for k in ('requested_solver', 'solver', 'solver_fallback', 'solver_attempts')], ['dg2', 'dg2', None, []])
        self.assertEqual(response.json()['boundary'], {s: {'type': 'free'} for s in ('north', 'east', 'south', 'west')})
        self.assertEqual(response.json()['initial_condition'], 'dry_zero_velocity')
        self.assertEqual(response.json()['lakes'], 'none')
        self.assertEqual(response.json()['losses'], {'infiltration': 'unsupported', 'runoff_coefficient': None, 'atmospheric_pressure_hpa': None, 'barometric_surge_m': 0.0})
        # A payload without terrain.source keeps NASADEM; every height is EGM2008.
        self.assertEqual([response.json()[k] for k in ('terrain_source', 'vertical_datum', 'terrain_attribution')], ['nasadem', 'EGM2008', None])
        # A payload without the land-surface options keeps uniform Manning and synthetic rain.
        self.assertEqual([response.json()['land_surface']['manning'], response.json()['land_surface']['manning_value'],
                          response.json()['land_surface']['curve_number'], response.json()['rainfall_source'], response.json()['design_storm']],
                         ['uniform', .02, None, 'synthetic', None])
        # Without tide sides or GEBCO the coast summaries are null.
        self.assertEqual([response.json()['tide'], response.json()['bathymetry']], [None, None])
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

    def test_a_rejected_request_says_why(self):
        budget = payload(); budget['simulation']['save_interval_s'] = .000001
        message = self.alice.post(self.start, budget, format='json').json()['errors']['request'][0]
        self.assertIn('max_frames', message)
        self.assertTrue(message.startswith('Solicitud ROI inválida o fuera de presupuesto'))

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
        self.assertEqual(set(self.alice.get(status).json()), STATUS_KEYS)
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
        # Runs recorded before the terrain choice used NASADEM heights in EGM96.
        self.assertEqual([body['terrain_source'], body['vertical_datum'], body['terrain_attribution']], ['nasadem', 'EGM96', None])
        self.assertEqual([self.alice.get(status).json()[k] for k in ('terrain_source', 'vertical_datum')], ['nasadem', 'EGM96'])
        self.assertIsNone(body['roads'])
        self.assertIsNone(body['lakes'])
        # Runs recorded before the land-surface options: no land data, synthetic rain.
        self.assertEqual([body['land_surface'], body['rainfall_source'], body['design_storm']], [None, 'synthetic', None])
        self.assertEqual([self.alice.get(status).json()[k] for k in ('land_surface', 'rainfall_source', 'design_storm')], [None, 'synthetic', None])
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

    def test_start_and_results_echo_the_copernicus_terrain_and_its_attribution(self):
        body = payload(); body['terrain']['source'] = 'copernicus'
        with patch('analyses.roi_flood_runs.start_roi_run') as start:
            from pipeline.hydrology.roi_runner import start_roi_run
            start.side_effect = lambda *args, **kwargs: start_roi_run(*args, **{**kwargs, 'launch': False})
            response = self.alice.post(self.start, body, format='json')
        self.assertEqual(response.status_code, 202)
        self.assertEqual([response.json()['terrain_source'], response.json()['vertical_datum']], ['copernicus', 'EGM2008'])
        self.assertIn('Copernicus WorldDEM-30', response.json()['terrain_attribution'])
        bad = payload(); bad['terrain']['source'] = 'srtm'
        self.assertEqual(self.alice.post(self.start, bad, format='json').status_code, 400)
        run_id, state, directory = self.seed()
        state.update(terrain_source='copernicus', vertical_datum='EGM2008', terrain_attribution='produced using Copernicus WorldDEM-30')
        (directory / 'state.json').write_text(json.dumps(state))
        result = self.alice.get(f'/api/flood-roi-runs/{run_id}/results/').json()
        self.assertEqual([result['terrain_source'], result['vertical_datum'], result['terrain_attribution']],
                         ['copernicus', 'EGM2008', 'produced using Copernicus WorldDEM-30'])

    def test_preview_palette_uses_the_pipeline_depth_classes(self):
        from analyses.roi_flood_runs import _DEPTH_CLASSES, _DEPTH_CLASS_ALPHA
        from pipeline.hydrology.results import DEPTH_CLASS_BOUNDS_M
        self.assertEqual(tuple(lower for lower, _ in _DEPTH_CLASSES), DEPTH_CLASS_BOUNDS_M)
        # The 0.002-0.01 m runoff-sheet class is the lightest and the only semi-transparent one; 0.01-0.03 m follows.
        self.assertEqual(_DEPTH_CLASSES[:2], [(.002, (236, 245, 253)), (.01, (222, 235, 247))])
        self.assertEqual(_DEPTH_CLASS_ALPHA, {.002: 140})

    def running(self, frames=(), fallback=True):
        """Seeded run put back to `running` in its FV1 fallback attempt, with the given frame files written so far."""
        import time
        run_id, state, directory = self.seed()
        state.update(state='running', stage='running', solver='fv1', simulation_duration_s=1200, save_interval_s=300,
                     deadline_epoch_s=time.time() + 3600,
                     solver_fallback={'from': 'dg2', 'to': 'fv1', 'reason': 'negative_depth_artifacts'} if fallback else None)
        state.pop('result'); state.pop('artifacts')
        (directory / 'state.json').write_text(json.dumps(state))
        outputs = directory / ('work-fallback' if fallback else 'work') / 'outputs'
        outputs.mkdir(parents=True)
        header = 'ncols 2\nnrows 2\nxllcorner 499960\nyllcorner 1857360\ncellsize 20\nNODATA_value -9999\n'
        for name, body in frames:
            (outputs / name).write_text(header + body)
        return run_id, state, directory, outputs

    def test_status_reports_the_solver_progress_while_running(self):
        run_id, state, directory, outputs = self.running(frames=[('roi-0000.wd', '.005 .02\n-9999 1.5\n'), ('roi-0001.wd', '.1 .2\n.3')])
        progress = self.alice.get(f'/api/flood-roi-runs/{run_id}/').json()['progress']
        # Only the complete frame counts; the FV1 fallback restarted from zero and says so.
        self.assertEqual({k: progress[k] for k in ('stage', 'solver', 'attempt', 'restarted_from', 'simulated_s', 'duration_s', 'fraction',
                                                   'frames_available', 'latest_frame_index', 'latest_frame_time_s')},
                         {'stage': 'running', 'solver': 'fv1', 'attempt': 2, 'restarted_from': 'dg2', 'simulated_s': 0, 'duration_s': 1200,
                          'fraction': 0, 'frames_available': 1, 'latest_frame_index': 0, 'latest_frame_time_s': 0})
        self.assertEqual(progress['latest_frame_url'], f'/api/flood-roi-runs/{run_id}/live/0/preview/')
        # Gross rain at the simulated time (the seeded synthetic profile has no losses: 0.002 m/s in its first half second).
        self.assertAlmostEqual(progress['rain_mm_h'], 0.002000978706862038 * 3.6e6)
        # Terminal runs and runs not yet started carry no progress.
        state.update(state='failed', stage='failed', error='solver_timeout')
        (directory / 'state.json').write_text(json.dumps(state))
        self.assertIsNone(self.alice.get(f'/api/flood-roi-runs/{run_id}/').json()['progress'])

    def test_live_preview_serves_only_complete_frames_of_the_owner(self):
        run_id, state, directory, outputs = self.running()
        url = f'/api/flood-roi-runs/{run_id}/live/0/preview/'
        self.assertEqual(self.alice.get(url).status_code, 404)  # before the first frame
        header = 'ncols 2\nnrows 2\nxllcorner 499960\nyllcorner 1857360\ncellsize 20\nNODATA_value -9999\n'
        (outputs / 'roi-0000.wd').write_text(header + '.005 .02\n-9999')  # being written
        self.assertEqual(self.alice.get(url).status_code, 404)
        (outputs / 'roi-0000.wd').write_text(header + '.005 .02\n-9999 1.5\n')
        self.assertIn(self.anon.get(url).status_code, (401, 403))
        self.assertEqual(self.bob.get(url).status_code, 404)
        response = self.alice.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([response['Content-Type'], response['X-Preview-CRS'], response['X-Preview-Units'], response['Cache-Control']],
                         ['image/png', 'EPSG:3857', 'm', 'no-store'])
        self.assertEqual(response['X-Preview-Classes'], '0.002,0.01,0.03,0.15,0.5,1,2')
        bounds = [float(v) for v in response['X-Preview-Bounds'].split(',')]
        self.assertTrue(-93.1 < bounds[0] < bounds[2] < -92.9 and 16.7 < bounds[1] < bounds[3] < 16.9)
        image = Image.open(io.BytesIO(response.content))
        alphas = sorted({pixel[3] for pixel in image.convert('RGBA').getdata()})
        self.assertEqual(alphas, [0, 140, 255])  # nodata, the 2-10 mm sheet, deeper water
        self.assertEqual(self.alice.get(f'/api/flood-roi-runs/{run_id}/live/7/preview/').status_code, 404)
        # A symlinked output directory is never followed; a finished run uses the stored previews instead.
        shutil.move(outputs, directory / 'elsewhere'); outputs.symlink_to(directory / 'elsewhere')
        self.assertEqual(self.alice.get(url).status_code, 404)
        outputs.unlink(); shutil.move(directory / 'elsewhere', outputs)
        self.assertEqual(self.alice.get(url).status_code, 200)
        state.update(state='succeeded', stage='succeeded')
        (directory / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.alice.get(url).status_code, 404)

    def test_results_carry_the_gross_rain_and_where_the_rain_went(self):
        run_id, state, directory = self.seed()
        url = f'/api/flood-roi-runs/{run_id}/results/'
        # Seeded run: no losses and no .mass, so the gross hyetograph is the net one and there is no budget.
        body = self.alice.get(url).json()
        self.assertEqual(body['rainfall_gross_segments'], body['rainfall_segments'])
        self.assertIsNone(body['water_budget'])
        # Curve Number: the gross ROI-mean rain per interval as mm/h, beside the net one the solver received.
        state['provenance']['rain'] = {'method': {'method': 'scs_curve_number_incremental', 'roi_mean_net_mm': [1.0, 3.0],
                                                  'roi_gross_mm': [2.0, 6.0], 'gross_total_mm': 8.0, 'roi_cells': 10,
                                                  'curve_number': {'interval_edges_s': [0, 600, 1200]}}}
        # An older summary with a .mass but no stored budget: computed on the fly, without the last-frame split.
        state['result']['mass_balance'] = {'rain_m3': 1.6, 'final_volume_m3': 1.2, 'series': [[0, 0, 0], [1200, 1.2, 1.6]]}
        (directory / 'state.json').write_text(json.dumps(state))
        body = self.alice.get(url).json()
        self.assertEqual(body['rainfall_gross_segments'], [{'start_s': 0.0, 'end_s': 600.0, 'intensity_mm_h': 12.0},
                                                           {'start_s': 600.0, 'end_s': 1200.0, 'intensity_mm_h': 36.0}])
        budget = body['water_budget']
        cell = state['result']['grid']['cellsize_m']
        self.assertAlmostEqual(budget['gross_rain_m3'], 8.0 / 1000 * 10 * cell ** 2)
        self.assertAlmostEqual(budget['infiltrated_m3'], 8.0 / 1000 * 10 * cell ** 2 - 1.6)
        self.assertEqual([budget['net_rain_m3'], budget['final_water_m3'], budget['gross_source'], budget['sheet_m3']],
                         [1.6, 1.2, 'curve_number', None])
        self.assertAlmostEqual(budget['boundary_outflow_m3'], .4)
        # Runoff coefficient: the uniform profile is net rain, gross = net / C. A stored budget is echoed as it is.
        state['provenance']['rain'] = json.loads((PROOF / 'state.json').read_text())['provenance']['rain']
        state['losses'] = {'infiltration': 'runoff_coefficient', 'runoff_coefficient': .5}
        state['result']['water_budget'] = {'units': 'm3', 'gross_rain_m3': 3.2}
        (directory / 'state.json').write_text(json.dumps(state))
        body = self.alice.get(url).json()
        self.assertEqual([round(s['intensity_mm_h'], 6) for s in body['rainfall_gross_segments']],
                         [round(s['intensity_mm_h'] * 2, 6) for s in body['rainfall_segments']])
        self.assertEqual(body['water_budget'], {'units': 'm3', 'gross_rain_m3': 3.2})

    def test_results_echo_each_run_own_depth_classes(self):
        # Runs made before the 0.01 m class keep their five bounds; the UI reads them from the run.
        run_id, state, directory = self.seed()
        state['result']['depth_classes_m'] = [.03, .15, .5, 1, 2]
        (directory / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.alice.get(f'/api/flood-roi-runs/{run_id}/results/').json()['depth_classes_m'], [.03, .15, .5, 1, 2])

    def test_curve_number_run_echoes_land_surface_and_charts_the_net_rain(self):
        run_id, state, directory = self.seed()
        land = {'manning': 'worldcover', 'manning_value': None, 'manning_fpfric': .035, 'infiltration': 'curve_number',
                'curve_number': {'antecedent_moisture': 'auto', 'amc': 'III', 'amc_source': 'SMAP L4', 'mean_runoff_coefficient': .4},
                'urban': {'declared_nonurban': False, 'built_up_fraction': .3, 'built_up_cells': 4, 'warning': True},
                'attribution': ['ESA WorldCover']}
        state.update(land_surface=land, rainfall_source='design_storm',
                     design_storm={'return_period_years': 10, 'total_mm': 61.2, 'extrapolated': True})
        state['provenance']['rain'] = {'method': {'method': 'scs_curve_number_incremental', 'roi_mean_net_mm': [1.0, 3.0],
                                                  'curve_number': {'interval_edges_s': [0, 600, 1200]}}}
        (directory / 'state.json').write_text(json.dumps(state))
        url = f'/api/flood-roi-runs/{run_id}/'
        status = self.alice.get(url).json()
        self.assertEqual([status['land_surface'], status['rainfall_source'], status['design_storm']['total_mm']], [land, 'design_storm', 61.2])
        body = self.alice.get(url + 'results/').json()
        self.assertEqual(body['land_surface'], land)
        self.assertEqual(body['design_storm']['return_period_years'], 10)
        # The hyetograph is the net rain the solver received: ROI-mean mm per interval as mm/h.
        self.assertEqual(body['rainfall_segments'], [{'start_s': 0.0, 'end_s': 600.0, 'intensity_mm_h': 6.0},
                                                     {'start_s': 600.0, 'end_s': 1200.0, 'intensity_mm_h': 18.0}])

    def test_dataset_errors_are_public_codes(self):
        run_id, state, directory = self.seed()
        for code in ('landcover_unavailable', 'soils_unavailable', 'soil_moisture_unavailable', 'tide_unavailable',
                     'bathymetry_unavailable'):
            state.update(state='failed', stage='failed', error=code)
            (directory / 'state.json').write_text(json.dumps(state))
            self.assertEqual(self.alice.get(f'/api/flood-roi-runs/{run_id}/').json()['error'], code)

    def test_missing_design_storm_data_is_a_service_error_with_its_code(self):
        body = payload(); body['rainfall'] = None
        body['rainfall_profile'] = {'source': 'design_storm', 'return_period_years': 10, 'duration_h': 1, 'step_s': 600}
        missing = dict(config(), pxr_path=str(BASE.parent / 'reference/pxr/missing-pxr.nc'))
        with override_settings(FLOOD_ROI_DG2_CONFIG=missing):
            response = self.alice.post(self.start, body, format='json')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error'], 'design_storm_unavailable')
        self.assertFalse(self.jobs.exists())

    def test_start_status_and_results_echo_the_tide_and_gebco_options(self):
        body = payload()
        body['hydraulics'].update(boundary={'north': {'type': 'closed'}, 'east': {'type': 'free'}, 'south': {'type': 'closed'},
                                            'west': {'type': 'tide'}}, initial_condition='still_water_at_fixed_level')
        body['terrain']['bathymetry'] = 'gebco'
        # Synthetic rain: the tide window needs an explicit start time.
        self.assertEqual(self.alice.post(self.start, body, format='json').status_code, 400)
        body['simulation']['start_utc'] = '2026-10-16T12:00:00Z'
        with patch('analyses.roi_flood_runs.start_roi_run') as start:
            from pipeline.hydrology.roi_runner import start_roi_run
            start.side_effect = lambda *args, **kwargs: start_roi_run(*args, **{**kwargs, 'launch': False})
            response = self.alice.post(self.start, body, format='json')
        self.assertEqual(response.status_code, 202)
        tide = response.json()['tide']
        self.assertEqual([tide['model'], tide['sides'], tide['mdt'], tide['start_utc'], tide['end_utc'], tide['event_time_basis']],
                         ['EOT20', ['west'], 'DTUUH22MDT', '2026-10-16T12:00:00Z', '2026-10-16T12:00:02Z', 'simulation_start'])
        self.assertEqual(response.json()['boundary']['west'], {'type': 'tide', 'mdt': 'DTUUH22MDT'})
        self.assertEqual([response.json()['bathymetry']['sea_sides'], response.json()['bathymetry']['replaced_cells']], [['west'], None])
        run_id, state, directory = self.seed()
        found = {**tide, 'min_m': .41, 'max_m': .87, 'node': [-92.3, 14.6], 'attribution': ['EOT20']}
        gebco = {'source': 'gebco', 'replaced_cells': 12, 'attribution': 'GEBCO Compilation Group (2026) GEBCO 2026 Grid'}
        state.update(tide=found, bathymetry=gebco)
        (directory / 'state.json').write_text(json.dumps(state))
        url = f'/api/flood-roi-runs/{run_id}/'
        self.assertEqual([self.alice.get(url).json()[k] for k in ('tide', 'bathymetry')], [found, gebco])
        result = self.alice.get(url + 'results/').json()
        self.assertEqual([result['tide'], result['bathymetry']], [found, gebco])
