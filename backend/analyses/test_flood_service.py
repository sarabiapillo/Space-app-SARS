"""Comprobaciones locales, sin credenciales ni red."""
import io
import json
import os
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, override_settings

from config.flood_service import build_flood_service_settings

PROJECT = Path(__file__).resolve().parents[2]


class ServiceSetupTests(SimpleTestCase):
    def test_defaults_disable_and_reject_unsafe_configuration(self):
        enabled, root, config = build_flood_service_settings(PROJECT, {})
        self.assertTrue(enabled)
        self.assertEqual(root, str(PROJECT / 'data/roi-dg2-jobs'))
        self.assertEqual(config['max_tiles'], 2)
        self.assertTrue(config['lakes_path'].endswith('data/reference/hydrolakes/HydroLAKES_polys_v10.gpkg'))
        # EGM96/EGM2008 geoid grids (python -m pipeline.elevation.vertical_datum prepare); every run needs them.
        self.assertEqual(config['geoid_dir'], str(PROJECT / 'data/reference/geoid'))
        self.assertEqual(config['binary_sha256'], '777d50f8d6a926260baa31b4c8ca3ecc0b3ae710494bebb2d4699ccf8c39775c')
        self.assertEqual(build_flood_service_settings(PROJECT, {'FLOOD_ROI_DG2_ENABLED': 'false'})[2], None)
        for name, value in [('FLOOD_ROI_DG2_MAX_CELLS', '-1'), ('FLOOD_ROI_DG2_MAX_TILES', '999999999'),
                            ('FLOOD_ROI_DG2_ENABLED', 'secret-value'), ('FLOOD_ROI_DG2_EXECUTABLE', '/tmp/executable'),
                            ('FLOOD_ROI_DG2_GEOID_DIR', '/tmp/geoid')]:
            with self.subTest(name=name), self.assertRaises(ValueError) as error:
                build_flood_service_settings(PROJECT, {name: value})
            self.assertNotIn(value, str(error.exception))

    def test_default_budgets_fit_a_small_real_nasadem_dg2_run(self):
        # Measured: 1680 cells x 900 s simulated took 59-69 s of solver wall time (2026-11-19).
        config = build_flood_service_settings(PROJECT, {})[2]
        self.assertEqual({key: config[key] for key in ('timeout_s', 'preparation_timeout_s', 'max_cells',
                                                      'max_rain_values', 'max_frames', 'max_tiles')},
                         {'timeout_s': 120.0, 'preparation_timeout_s': 600.0, 'max_cells': 3000,
                          'max_rain_values': 100_000, 'max_frames': 20, 'max_tiles': 2})

    def test_environment_still_overrides_default_budgets(self):
        config = build_flood_service_settings(PROJECT, {'FLOOD_ROI_DG2_MAX_CELLS': '1000', 'FLOOD_ROI_DG2_TIMEOUT_S': '15'})[2]
        self.assertEqual((config['max_cells'], config['timeout_s']), (1000, 15.0))

    def test_local_check_never_calls_provider_or_creates_files(self):
        output = io.StringIO()
        config = build_flood_service_settings(PROJECT, {})[2]
        with override_settings(FLOOD_ROI_DG2_CONFIG=config), patch('analyses.management.commands.check_flood_service.validate_config') as verified, patch('pipeline.elevation.nasadem.NASADEMProvider.acquire_roi') as acquire:
            call_command('check_flood_service', stdout=output)
            verified.assert_called_once_with(config)
            acquire.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['earthdata'], 'not_checked')
        output = io.StringIO()
        with override_settings(FLOOD_ROI_DG2_CONFIG=None):
            with self.assertRaises(Exception):
                call_command('check_flood_service', stdout=output)
        self.assertEqual(json.loads(output.getvalue())['reason'], 'configuration_invalid')

    def test_missing_environment_credentials_stops_before_network_and_writes(self):
        output = io.StringIO()
        config = build_flood_service_settings(PROJECT, {})[2]
        with override_settings(FLOOD_ROI_DG2_CONFIG=config), patch.dict(os.environ, {'EARTHDATA_TOKEN': '', 'EARTHDATA_USERNAME': '', 'EARTHDATA_PASSWORD': ''}):
            with patch('pipeline.elevation.nasadem.NASADEMProvider.acquire_roi') as acquire:
                with self.assertRaises(Exception):
                    call_command('check_flood_service', earthdata=True, stdout=output)
                acquire.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['reason'], 'missing_environment_credentials')
