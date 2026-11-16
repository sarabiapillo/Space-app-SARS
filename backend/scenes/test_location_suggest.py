import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class SuggestionTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    @patch("scenes.location_suggest.urllib.request.urlopen")
    def test_suggests_cities_municipalities_and_countries_without_touching_nominatim(self, urlopen):
        class Reply:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size=-1):
                return json.dumps({"features": [
                    {"properties": {"name": "Tuxtla Gutiérrez", "osm_key": "place", "osm_value": "city", "state": "Chiapas", "country": "México"}},
                    {"properties": {"name": "Tuxtla Chico", "osm_key": "boundary", "osm_value": "administrative", "type": "municipality", "state": "Chiapas", "country": "México"}},
                    {"properties": {"name": "México", "osm_key": "place", "osm_value": "country", "country": "México"}},
                    {"properties": {"name": "Chiapas", "osm_key": "boundary", "osm_value": "administrative", "type": "state"}},
                    {"properties": {"name": "Café", "osm_key": "amenity", "osm_value": "restaurant"}},
                ]}).encode()
        urlopen.return_value = Reply()
        with patch("scenes.geosearch.nominatim_search") as nominatim:
            response = self.client.get('/api/locations/suggest?q=Tuxtla')
            self.assertEqual(response.status_code, 200, response.content)
            first = response.json()
            second = self.client.get('/api/locations/suggest?q=Tuxtla').json()
        self.assertEqual(first, second)
        self.assertEqual([s['name'] for s in first['suggestions']], ['Tuxtla Gutiérrez', 'Tuxtla Chico', 'México'])
        self.assertEqual(first['suggestions'][0]['query'], 'Tuxtla Gutiérrez, Chiapas, México')
        self.assertEqual(urlopen.call_count, 1)
        nominatim.assert_not_called()

    @patch("scenes.location_suggest.urllib.request.urlopen")
    def test_rejects_short_or_invalid_queries_before_provider_call(self, urlopen):
        self.assertEqual(self.client.get('/api/locations/suggest?q=Tu').status_code, 400)
        self.assertEqual(self.client.get('/api/locations/suggest?q=' + 'a' * 201).status_code, 400)
        urlopen.assert_not_called()

    @patch("scenes.location_suggest.urllib.request.urlopen")
    def test_uncached_queries_are_rate_limited_server_side(self, urlopen):
        class Reply:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size=-1): return b'{"features": []}'
        urlopen.return_value = Reply()
        self.assertEqual(self.client.get('/api/locations/suggest?q=Tuxtla').status_code, 200)
        self.assertEqual(self.client.get('/api/locations/suggest?q=Mexico').status_code, 429)
        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(self.client.get('/api/locations/suggest?q=Tuxtla').status_code, 200)

    @patch("scenes.location_suggest.urllib.request.urlopen", side_effect=TimeoutError())
    def test_provider_unavailable_does_not_fabricate_suggestions(self, urlopen):
        self.assertEqual(self.client.get('/api/locations/suggest?q=Tuxtla').status_code, 503)
