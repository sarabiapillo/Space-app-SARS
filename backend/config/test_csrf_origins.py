"""Trusted CSRF origins: explicit list from the environment, Vite dev origins only in DEBUG."""
from django.test import SimpleTestCase

from config.settings import VITE_DEV_ORIGINS, csrf_trusted_origins


class CsrfTrustedOriginsTests(SimpleTestCase):
    def test_explicit_origins_win_and_are_trimmed(self):
        self.assertEqual(csrf_trusted_origins(' https://a.example , https://b.example ', debug=True),
                         ['https://a.example', 'https://b.example'])

    def test_debug_without_a_list_trusts_the_vite_dev_server(self):
        self.assertEqual(csrf_trusted_origins('', debug=True), list(VITE_DEV_ORIGINS))
        self.assertIn('http://localhost:5173', VITE_DEV_ORIGINS)

    def test_production_without_a_list_trusts_nothing_extra(self):
        self.assertEqual(csrf_trusted_origins('', debug=False), [])
