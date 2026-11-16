import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from pipeline.roi_explore import validate_roi

POLYGON = {"type": "Polygon", "coordinates": [[[0, 0], [.2, 0], [.2, .2], [0, .2], [0, 0]]]}


class RoiValidationTests(SimpleTestCase):
    def test_accepts_multipolygon_within_roi_limit(self):
        value = {"type": "MultiPolygon", "coordinates": [[[[0, 0], [.1, 0], [.1, .1], [0, .1], [0, 0]]]]}
        self.assertTrue(validate_roi(value))

    def test_rejects_geometry_over_six_tenths_degree(self):
        value = {"type": "Polygon", "coordinates": [[[0, 0], [.7, 0], [.7, .1], [0, .1], [0, 0]]]}
        with self.assertRaises(ValueError):
            validate_roi(value)


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class GeosearchApiTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    @patch("scenes.geosearch._rate_limit")
    @patch("scenes.geosearch.urllib.request.urlopen")
    def test_search_is_explicit_cached_and_returns_point_as_point(self, urlopen, rate_limit):
        class Reply:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return json.dumps({"features": [{"geometry": {"type": "Point", "coordinates": [-93, 16.7]},
                    "properties": {"display_name": "Example", "place_id": 1, "address": {}}}]}).encode()
        urlopen.return_value = Reply()
        a = self.client.get("/api/locations?q=Tuxtla").json()
        b = self.client.get("/api/locations?q=Tuxtla").json()
        self.assertEqual(a, b)
        self.assertEqual(a["results"][0]["geometry"]["type"], "Point")
        self.assertEqual(urlopen.call_count, 1)
        self.assertIn("TerraPulseAI", urlopen.call_args.args[0].header_items()[0][1])
        self.assertIn("OpenStreetMap", a["attribution"])

    @patch("scenes.geosearch.nominatim_search", return_value=[
        {"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
         "properties": {"display_name": "Invalid boundary"}},
        {"geometry": {"type": "Point", "coordinates": [float("nan"), 0]},
         "properties": {"display_name": "Invalid point"}},
    ])
    def test_invalid_provider_geometries_are_not_returned(self, search):
        response = self.client.get("/api/locations?q=Somewhere")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"], [])

    @patch("scenes.geosearch.nominatim_search", return_value=[
        {"geometry": {"type": "Point", "coordinates": [1, 2]}, "properties": []},
        {"geometry": {"type": "Point", "coordinates": [1, 2]}, "properties": {"display_name": [], "address": "unsafe"}},
        None,
    ])
    def test_malformed_features_and_properties_are_skipped(self, search):
        response = self.client.get("/api/locations?q=Somewhere")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"], [])

    def test_rejects_missing_or_long_query(self):
        self.assertEqual(self.client.get("/api/locations").status_code, 400)
        self.assertEqual(self.client.get("/api/locations?q=" + "x" * 300).status_code, 400)

    @patch("scenes.geosearch.nominatim_search")
    def test_administrative_boundary_replaces_same_identity_point_only(self, search):
        boundary = {"type": "Polygon", "coordinates": [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]]}
        search.return_value = [
            {"geometry": {"type": "Point", "coordinates": [0.05, 0.05]}, "properties": {
                "display_name": "  San José, Municipio X ", "place_id": 9, "osm_type": "relation", "osm_id": 4,
                "category": "place", "type": "city", "address": {"municipality": "Municipio X"}}},
            {"geometry": boundary, "properties": {
                "display_name": "San José, Municipio X", "place_id": 10, "osm_type": "relation", "osm_id": 4,
                "category": "boundary", "type": "administrative", "address": {"municipality": "Municipio X"}}},
            {"geometry": {"type": "Point", "coordinates": [2, 2]}, "properties": {
                "display_name": "San José, Otro municipio", "place_id": 11, "category": "place", "type": "city", "address": {"municipality": "Otro municipio"}}},
        ]
        response = self.client.get("/api/locations?q=San+Jos%C3%A9")
        results = response.json()["results"]
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["geometry"]["type"], "Polygon")
        self.assertEqual(results[0]["name"], "San José, Municipio X")
        self.assertEqual(results[1]["address"]["municipality"], "Otro municipio")

    def _post_roi(self, feature, radius_km=5):
        with patch("scenes.geosearch.nominatim_search", return_value=[feature]):
            return self.client.post("/api/locations/roi", {
                "place_id": feature["properties"]["place_id"], "query": "Lugar", "radius_km": radius_km}, format="json")

    def test_small_administrative_roi_preserves_original_geometry(self):
        boundary = {"type": "Polygon", "coordinates": [[[0, 0], [.001, 0], [.0015, .0008], [0, .001], [0, 0]]]}
        feature = {"geometry": boundary, "properties": {"display_name": "Small", "place_id": 1}}
        response = self._post_roi(feature)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["geometry"]["type"], "Polygon")
        self.assertEqual(data["geometry"]["coordinates"], boundary["coordinates"])
        self.assertEqual(data["original_geometry"]["coordinates"], boundary["coordinates"])
        self.assertEqual(data["metadata"]["generation"], "administrative_original")
        self.assertEqual(data["metadata"]["applied_radius_km"], 5.0)

    def test_multipolygon_administrative_roi_preserves_original_when_it_fits(self):
        multipolygon = {"type": "MultiPolygon", "coordinates": [
            [[[0, 0], [.001, 0], [.001, .001], [0, .001], [0, 0]]],
            [[[.002, 0], [.003, 0], [.003, .001], [.002, .001], [.002, 0]]]]}
        feature = {"geometry": multipolygon, "properties": {"display_name": "Islands", "place_id": 3}}
        response = self._post_roi(feature, radius_km=1)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["geometry"]["type"], "MultiPolygon")
        self.assertEqual(data["geometry"]["coordinates"], multipolygon["coordinates"])
        self.assertEqual(data["metadata"]["generation"], "administrative_original")

    def test_large_administrative_roi_is_a_geodesic_rectangle_at_interior_point(self):
        boundary = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
        feature = {"geometry": boundary, "properties": {"display_name": "Large", "place_id": 2}}
        response = self._post_roi(feature)
        self.assertEqual(response.status_code, 200, response.content)
        from shapely.geometry import shape
        data = response.json()
        effective = shape(data["geometry"])
        self.assertEqual(effective.geom_type, "Polygon")
        self.assertEqual(len(effective.exterior.coords), 5)
        west, south, east, north = effective.bounds
        self.assertLessEqual(east - west, 0.6)
        self.assertLessEqual(north - south, 0.6)
        self.assertEqual(data["metadata"]["generation"], "administrative_rectangle")
        self.assertIsNotNone(data["original_geometry"])

    def test_large_admin_rectangle_is_covered_including_holes_and_islands(self):
        from shapely.geometry import shape
        boundary = {"type": "Polygon", "coordinates": [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
            [[.45, .45], [.55, .45], [.55, .55], [.45, .55], [.45, .45]]]}
        response = self._post_roi({"geometry": boundary, "properties": {"display_name": "Hole", "place_id": 32}})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(shape(boundary).covers(shape(response.json()["geometry"])))

    def test_concave_boundary_chooses_larger_contained_rectangle(self):
        from shapely.geometry import shape
        # The representative point falls in a narrow corridor; the eastern lobe
        # fits a larger rectangle and must be preferred without crossing the notch.
        boundary = {"type": "Polygon", "coordinates": [[
            [0, 0], [0.6, 0], [0.6, 0.6], [0.2, 0.6],
            [0.2, 0.04], [0, 0.04], [0, 0]]]}
        response = self._post_roi({"geometry": boundary, "properties": {"display_name": "Concave", "place_id": 59}}, 5)
        self.assertEqual(response.status_code, 200, response.content)
        effective = shape(response.json()["geometry"])
        self.assertTrue(shape(boundary).covers(effective))
        self.assertEqual(len(effective.exterior.coords), 5)
        self.assertGreater(effective.area, 0)
        self.assertLessEqual(effective.bounds[2] - effective.bounds[0], .6)
        self.assertLessEqual(effective.bounds[3] - effective.bounds[1], .6)

    def test_large_multipolygon_rectangle_stays_on_one_island(self):
        from shapely.geometry import shape
        boundary = {"type": "MultiPolygon", "coordinates": [
            [[[0, 0], [.3, 0], [.3, .3], [0, .3], [0, 0]]],
            [[[1, 0], [1.1, 0], [1.1, .1], [1, .1], [1, 0]]]]}
        response = self._post_roi({"geometry": boundary, "properties": {"display_name": "Islands", "place_id": 60}})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(shape(boundary).covers(shape(response.json()["geometry"])))
        self.assertEqual(response.json()["original_geometry"], boundary)

    def test_no_interior_rectangle_reports_manual_draw_without_point_fallback(self):
        # A valid but sub-nanometre-wide strip is beyond the resolution of the
        # finite rectangular search. Never invent a point-centered square.
        strip = {"type": "Polygon", "coordinates": [[[0, 0], [1e-14, 0], [1e-14, 1], [0, 1], [0, 0]]]}
        response = self._post_roi({"geometry": strip, "properties": {"display_name": "Strip", "place_id": 61}})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("dibuja manualmente", str(response.json()))

    def test_administrative_original_uses_radius_window_and_bbox_limits(self):
        boundary = {"type": "Polygon", "coordinates": [[[0, 0], [.2, 0], [.2, .2], [0, .2], [0, 0]]]}
        feature = {"geometry": boundary, "properties": {"display_name": "Medium", "place_id": 31}}
        five_km = self._post_roi(feature, 5)
        fifteen_km = self._post_roi(feature, 15)
        self.assertEqual(five_km.status_code, 200, five_km.content)
        self.assertEqual(five_km.json()["metadata"]["generation"], "administrative_rectangle")
        self.assertNotEqual(five_km.json()["geometry"], boundary)
        self.assertEqual(fifteen_km.status_code, 200, fifteen_km.content)
        self.assertEqual(fifteen_km.json()["metadata"]["generation"], "administrative_original")
        self.assertEqual(fifteen_km.json()["geometry"]["coordinates"], boundary["coordinates"])

    def test_tiny_administrative_region_preserves_original_geometry(self):
        narrow = {"type": "Polygon", "coordinates": [[[0, 0], [.000001, 0], [.000001, .00003], [0, .00003], [0, 0]]]}
        feature = {"geometry": narrow, "properties": {"display_name": "Narrow", "place_id": 30}}
        response = self._post_roi(feature)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["metadata"]["generation"], "administrative_original")
        self.assertEqual(response.json()["geometry"]["type"], "Polygon")

    def test_radius_changes_roi_and_invalid_ranges_are_rejected(self):
        point = {"type": "Point", "coordinates": [0, 0]}
        feature = {"geometry": point, "properties": {"display_name": "Point", "place_id": 4}}
        small, large = self._post_roi(feature, 1), self._post_roi(feature, 10)
        self.assertEqual(small.status_code, 200)
        self.assertEqual(large.status_code, 200)
        self.assertNotEqual(small.json()["geometry"], large.json()["geometry"])
        self.assertEqual(self._post_roi(feature, 16).status_code, 400)

    @patch("scenes.geosearch.nominatim_search")
    def test_identity_dedup_normalizes_diacritics_but_keeps_distinct_names(self, search):
        address = {"country": "México", "state": "Chiapas", "county": "Centro", "municipality": "San Jose"}
        search.return_value = [
            {"geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {
                "display_name": "San José, México", "place_id": 21, "osm_type": "node", "osm_id": 101,
                "category": "place", "type": "town", "address": address}},
            {"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [.1, 0], [.1, .1], [0, .1], [0, 0]]]},
             "properties": {"display_name": "San Jose, México", "place_id": 22, "osm_type": "relation", "osm_id": 202,
                            "category": "boundary", "type": "administrative", "address": address}},
            {"geometry": {"type": "Point", "coordinates": [.01, .01]}, "properties": {
                "display_name": "San José del Rincón, México", "place_id": 23, "category": "place", "type": "city",
                "address": {"country": "México", "state": "Chiapas", "county": "Centro", "municipality": "Otro"}}},
        ]
        result = self.client.get("/api/locations?q=San+Jose").json()["results"]
        # Same normalized primary name (san jose) -> point 21 dropped.
        # Different primary name (san jose del rincon) -> point 23 kept.
        self.assertEqual([item["place_id"] for item in result], [22, 23])
        self.assertNotIn("_properties", result[0])

    @patch("scenes.geosearch.nominatim_search")
    def test_same_place_city_point_and_municipality_boundary_drops_point(self, search):
        """Tuxtla Gutiérrez-like case: city point + municipality boundary, different address keys."""
        boundary = {"type": "Polygon", "coordinates": [[[-93.4, 16.65], [-92.8, 16.65], [-92.8, 16.9], [-93.4, 16.9], [-93.4, 16.65]]]}
        search.return_value = [
            {"geometry": {"type": "Point", "coordinates": [-93.12, 16.75]}, "properties": {
                "display_name": "Tuxtla Gutiérrez, Chiapas, México", "place_id": 71, "osm_type": "node", "osm_id": 1001,
                "category": "place", "type": "city", "address": {"country": "México", "state": "Chiapas", "city": "Tuxtla Gutiérrez"}}},
            {"geometry": boundary, "properties": {
                "display_name": "Tuxtla Gutiérrez, Chiapas, México", "place_id": 72, "osm_type": "relation", "osm_id": 1002,
                "category": "boundary", "type": "administrative", "address": {"country": "México", "state": "Chiapas", "municipality": "Tuxtla Gutiérrez"}}},
        ]
        result = self.client.get("/api/locations?q=Tuxtla+Gutierrez").json()["results"]
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["place_id"], 72)
        self.assertEqual(result[0]["geometry"]["type"], "Polygon")

    @patch("scenes.geosearch.nominatim_search")
    def test_distinct_places_with_similar_names_are_not_merged(self, search):
        """Same normalized primary name but different state or point outside boundary."""
        boundary = {"type": "Polygon", "coordinates": [[[0, 0], [.1, 0], [.1, .1], [0, .1], [0, 0]]]}
        search.return_value = [
            {"geometry": {"type": "Point", "coordinates": [.5, .5]}, "properties": {
                "display_name": "San José, Oaxaca, México", "place_id": 81,
                "category": "place", "type": "city", "address": {"country": "México", "state": "Oaxaca", "city": "San José"}}},
            {"geometry": boundary, "properties": {
                "display_name": "San José, Chiapas, México", "place_id": 82,
                "category": "boundary", "type": "administrative", "address": {"country": "México", "state": "Chiapas", "municipality": "San José"}}},
            {"geometry": {"type": "Point", "coordinates": [.05, .05]}, "properties": {
                "display_name": "San José, Chiapas, México", "place_id": 83,
                "category": "place", "type": "city", "address": {"country": "México", "state": "Chiapas", "city": "San José"}}},
        ]
        result = self.client.get("/api/locations?q=San+Jose").json()["results"]
        place_ids = [item["place_id"] for item in result]
        # Oaxaca point is a different entity (different state) and must remain.
        # Chiapas point is inside the Chiapas boundary and must be dropped.
        self.assertIn(81, place_ids)
        self.assertIn(82, place_ids)
        self.assertNotIn(83, place_ids)
        self.assertEqual(len(result), 2)

    def test_high_latitude_15km_point_roi_is_accepted_by_all_backend_validators(self):
        from scenes.gcov_views import search_gcov

        feature = {"geometry": {"type": "Point", "coordinates": [20, 80]},
                   "properties": {"display_name": "High latitude", "place_id": 50}}
        response = self._post_roi(feature, 15)
        self.assertEqual(response.status_code, 200, response.content)
        geometry = response.json()["geometry"]
        self.assertEqual(geometry["type"], "Polygon")
        self.assertEqual(response.json()["metadata"]["radius_km"], 15.0)
        self.assertLess(response.json()["metadata"]["applied_radius_km"], 15.0)
        roi_wkt = validate_roi(geometry)
        self.assertTrue(roi_wkt)
        with patch("scenes.gcov_views.ASFSource.search", return_value=[]) as asf_search:
            self.assertEqual(search_gcov(geometry), [])
        asf_search.assert_called_once()
        # Both GCOV HTTP entry points and ROI jobs use the same common validator.
        with patch("scenes.gcov_views.search_gcov", return_value=[]):
            self.assertEqual(self.client.post("/api/gcov/search", {"roi": geometry}, format="json").status_code, 200)
        with tempfile.TemporaryDirectory() as temp, \
             patch("scenes.gcov_views.ASFSource.search", return_value=[]), \
             patch("scenes.gcov_views.POOL.submit"), \
             patch("scenes.roi_views.POOL.submit"), \
             override_settings(ROI_GCOV_OUTPUT_ROOT=Path(temp) / "gcov-jobs",
                               NISAR_RAW_ROOT=Path(temp) / "raw",
                               ROI_OUTPUT_ROOT=Path(temp) / "roi-jobs"):
            download = self.client.post("/api/gcov/downloads", {"scene_id": "SYNTH", "roi": geometry}, format="json")
            self.assertEqual(download.status_code, 404)
            roi_job = self.client.post("/api/roi-jobs", {"roi": geometry}, format="json")
            self.assertEqual(roi_job.status_code, 202)

    def test_administrative_original_and_rectangle_rois_pass_gco_validators(self):
        from scenes.gcov_views import search_gcov

        original_admin = {"type": "Polygon", "coordinates": [[[0, 0], [.001, 0], [.0015, .0008], [0, .001], [0, 0]]]}
        feature = {"geometry": original_admin, "properties": {"display_name": "Original admin", "place_id": 90}}
        response = self._post_roi(feature)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["metadata"]["generation"], "administrative_original")
        geometry = data["geometry"]
        self.assertTrue(validate_roi(geometry))
        with patch("scenes.gcov_views.ASFSource.search", return_value=[]) as asf_search:
            self.assertEqual(search_gcov(geometry), [])
        asf_search.assert_called_once()
        with patch("scenes.gcov_views.search_gcov", return_value=[]):
            self.assertEqual(self.client.post("/api/gcov/search", {"roi": geometry}, format="json").status_code, 200)
        with tempfile.TemporaryDirectory() as temp, \
             patch("scenes.gcov_views.ASFSource.search", return_value=[]), \
             patch("scenes.gcov_views.POOL.submit"), \
             patch("scenes.roi_views.POOL.submit"), \
             override_settings(ROI_GCOV_OUTPUT_ROOT=Path(temp) / "gcov-jobs",
                               NISAR_RAW_ROOT=Path(temp) / "raw",
                               ROI_OUTPUT_ROOT=Path(temp) / "roi-jobs"):
            roi_job = self.client.post("/api/roi-jobs", {"roi": geometry}, format="json")
            self.assertEqual(roi_job.status_code, 202)

        # Alternative rectangle generation must also pass downstream validators.
        large_feature = {"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
                         "properties": {"display_name": "Large admin", "place_id": 91}}
        rect_response = self._post_roi(large_feature)
        self.assertEqual(rect_response.status_code, 200, rect_response.content)
        rect_geometry = rect_response.json()["geometry"]
        self.assertTrue(validate_roi(rect_geometry))
        self.assertEqual(rect_response.json()["metadata"]["generation"], "administrative_rectangle")

    def test_missing_osm_ids_do_not_collapse_distinct_point_and_boundary(self):
        point = {"geometry": {"type": "Point", "coordinates": [0.05, 0.05]}, "_properties": {
            "display_name": "Same Place", "place_id": 51, "osm_type": "relation", "category": "place",
            "type": "city", "address": {}}}
        boundary = {"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [.1, 0], [.1, .1], [0, .1], [0, 0]]]},
            "_properties": {"display_name": "Same Place", "place_id": 52, "osm_type": "relation",
                          "category": "boundary", "type": "administrative", "address": {}}}
        from scenes.geosearch import _deduplicate
        results = _deduplicate([point, boundary])
        self.assertEqual(len(results), 2)

    def test_antimeridian_and_high_latitude_are_controlled_errors(self):
        crossing = {"type": "Polygon", "coordinates": [[[170, 10], [-170, 10], [-170, 11], [170, 11], [170, 10]]]}
        polar = {"type": "Point", "coordinates": [0, 86]}
        self.assertEqual(self._post_roi({"geometry": crossing, "properties": {"display_name": "Cross", "place_id": 5}}).status_code, 400)
        self.assertEqual(self._post_roi({"geometry": polar, "properties": {"display_name": "Pole", "place_id": 6}}, 15).status_code, 400)

    def test_rejects_arbitrary_geometry_and_unknown_provider_selection(self):
        response = self.client.post("/api/locations/roi", {"query": "Lugar", "place_id": 999,
            "geometry": POLYGON}, format="json")
        self.assertEqual(response.status_code, 400)
        feature = {"geometry": {"type": "Point", "coordinates": [0, 0]},
                   "properties": {"display_name": "Trusted", "place_id": 44}}
        with patch("scenes.geosearch.nominatim_search", return_value=[feature]):
            accepted = self.client.post("/api/locations/roi", {"query": "Lugar", "place_id": 44,
                "radius_km": 1, "geometry": POLYGON}, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.json()["original_geometry"], None)
