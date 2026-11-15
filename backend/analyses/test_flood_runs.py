"""Permisos y contrato HTTP del runner sintético, sin ejecutar T030."""
import hashlib
from pathlib import Path
import sys
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FloodRunApiTests(SimpleTestCase):
    def setUp(self):
        self.root = ROOT / 'data/test-runs' / f'api-dg2-{uuid.uuid4()}'
        source = self.root / 'prepared'
        source.mkdir(parents=True)
        grid = 'ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\nNODATA_value -9999\n0 0\n0 0\n'
        for name in ('terrain.dem', 'terrain.dem1x', 'terrain.dem1y'):
            (source / name).write_text(grid)
        (source / 'case.par').write_text('dg2\nDEMfile terrain.dem\ndirroot outputs\nresroot synthetic\nsim_time 2\ninitial_tstep 0.1\nsaveint 1\nfpfric 0.02\n')
        solver = source / 'solver'
        solver.write_text('#!' + sys.executable + '\nfrom pathlib import Path\np=Path("outputs");p.mkdir();(p/"synthetic-0000.wd").write_text(' + repr(grid) + ');(p/"synthetic.max").write_text(' + repr(grid) + ')\n')
        solver.chmod(0o700)
        case = dict(source_dir=str(source), files={n: digest(source / n) for n in ('terrain.dem', 'terrain.dem1x', 'terrain.dem1y', 'case.par')}, parameter_file='case.par', simulation_duration_s=2, save_interval_s=1, initial_condition='dry_zero_velocity', boundary='closed', manning=.02, infiltration='unsupported', rainfall='none', domain_nonurban=True, synthetic=True, hydraulic_accuracy_validated=False)
        self.settings_patch = override_settings(FLOOD_DG2_CASES={'demo': case}, FLOOD_DG2_EXECUTABLE=str(solver), FLOOD_DG2_BINARY_SHA256=digest(solver), FLOOD_DG2_RUN_ROOT=str(self.root / 'jobs'), FLOOD_DG2_TIMEOUT_S=3)
        self.settings_patch.enable()
        self.addCleanup(self.settings_patch.disable)
        self.alice = APIClient()
        self.alice.force_authenticate(user=SimpleNamespace(pk=1, is_authenticated=True))
        self.bob = APIClient()
        self.bob.force_authenticate(user=SimpleNamespace(pk=2, is_authenticated=True))
        self.anonymous = APIClient()
        self.start = '/api/flood-scenarios/start/'

    def test_auth_invalid_input_and_missing_settings_create_no_jobs(self):
        self.assertIn(self.anonymous.post(self.start, {'case_id': 'demo', 'simulation_duration_s': 2}, format='json').status_code, (401, 403))
        for payload in ({'case_id': 'demo'}, {'case_id': 'demo', 'simulation_duration_s': 3}, {'case_id': '../demo', 'simulation_duration_s': 2}, {'case_id': 'demo', 'simulation_duration_s': 2, 'executable': '/bin/true'}):
            response = self.alice.post(self.start, payload, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertEqual(set(response.json()), {'errors'})
        self.assertFalse((self.root / 'jobs').exists())
        with override_settings(FLOOD_DG2_CASES={}):
            self.assertEqual(self.alice.post(self.start, {'case_id': 'demo', 'simulation_duration_s': 2}, format='json').status_code, 503)
        self.assertFalse((self.root / 'jobs').exists())

    def test_owner_status_result_and_download(self):
        from pipeline.hydrology.runner import start_run, run_worker
        with patch('analyses.flood_runs.start_run', side_effect=lambda *args, **kwargs: start_run(*args, **kwargs, launch=False)):
            response = self.alice.post(self.start, {'case_id': 'demo', 'simulation_duration_s': 2}, format='json')
        self.assertEqual(response.status_code, 202)
        run_id = response.json()['id']
        pending = self.alice.get(f'/api/flood-runs/{run_id}/results/')
        self.assertEqual(pending.status_code, 409)
        run_worker(self.root / 'jobs', run_id)
        status_url = f'/api/flood-runs/{run_id}/'
        results_url = f'/api/flood-runs/{run_id}/results/'
        self.assertEqual(self.alice.get(status_url).status_code, 200)
        self.assertEqual(self.bob.get(status_url).status_code, 404)
        self.assertEqual(self.bob.get(results_url).status_code, 404)
        self.assertEqual(self.anonymous.get(results_url).status_code in (401, 403), True)
        self.assertEqual(self.alice.get(results_url).status_code, 200)
        result = self.alice.get(results_url).json()
        self.assertEqual(result['grid']['crs'], None)
        self.assertEqual(result['time_axis']['status'], 'actual_times_unavailable')
        self.assertEqual([(f['frame_index'], f['time_s'], f['scheduled_time_s']) for f in result['frames']], [(0, None, 0)])
        download = self.alice.get(f'/api/flood-runs/{run_id}/artifacts/synthetic.max/')
        self.assertEqual(download.status_code, 200)
        self.assertIn(b'ncols 2', b''.join(download.streaming_content))
        self.assertEqual(self.bob.get(f'/api/flood-runs/{run_id}/artifacts/synthetic.max/').status_code, 404)
        self.assertEqual(self.alice.get(f'/api/flood-runs/{run_id}/artifacts/solver/').status_code, 404)
        self.assertEqual(self.alice.get('/api/flood-runs/not-a-uuid/').status_code, 404)
        (self.root / 'jobs' / run_id / 'outputs' / 'synthetic.max').write_text('tampered')
        self.assertEqual(self.alice.get(f'/api/flood-runs/{run_id}/artifacts/synthetic.max/').status_code, 404)

    def test_missing_or_invalid_timestep_rejected_before_job(self):
        from django.conf import settings
        par = self.root / 'prepared/case.par'
        original = par.read_text()
        for value in (None, '0', 'nan', '3'):
            par.write_text(original.replace('initial_tstep 0.1\n', '' if value is None else f'initial_tstep {value}\n'))
            case = {**settings.FLOOD_DG2_CASES['demo'], 'files': {**settings.FLOOD_DG2_CASES['demo']['files'], 'case.par': digest(par)}}
            with override_settings(FLOOD_DG2_CASES={'demo': case}):
                response = self.alice.post(self.start, {'case_id': 'demo', 'simulation_duration_s': 2}, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertEqual(set(response.json()), {'errors'})
            self.assertFalse((self.root / 'jobs').exists())
        par.write_text(original)

    def test_reject_duplicate_json_and_no_registered_case(self):
        duplicate = self.alice.generic('POST', self.start, data='{"case_id":"demo","case_id":"demo","simulation_duration_s":2}', content_type='application/json')
        self.assertEqual(duplicate.status_code, 400)
        with override_settings(FLOOD_DG2_CASES={'other': {}}):
            unknown = self.alice.post(self.start, {'case_id': 'demo', 'simulation_duration_s': 2}, format='json')
        self.assertEqual(unknown.status_code, 400)
        self.assertFalse((self.root / 'jobs').exists())
