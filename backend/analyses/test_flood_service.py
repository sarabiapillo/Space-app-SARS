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
        self.assertEqual(config['binary_sha256'], '777d50f8d6a926260baa31b4c8ca3ecc0b3ae710494bebb2d4699ccf8c39775c')
        self.assertEqual(build_flood_service_settings(PROJECT, {'FLOOD_ROI_DG2_ENABLED': 'false'})[2], None)
        for name, value in [('FLOOD_ROI_DG2_MAX_CELLS', '-1'), ('FLOOD_ROI_DG2_MAX_TILES', '999999999'),
                            ('FLOOD_ROI_DG2_ENABLED', 'secret-value'), ('FLOOD_ROI_DG2_EXECUTABLE', '/tmp/executable')]:
            with self.subTest(name=name), self.assertRaises(ValueError) as error:
                build_flood_service_settings(PROJECT, {name: value})
            self.assertNotIn(value, str(error.exception))

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
