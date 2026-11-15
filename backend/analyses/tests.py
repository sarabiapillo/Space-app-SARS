import json
import random
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

ROI = {"type": "Polygon", "coordinates": [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]]}
BLOCKERS = [
    "No hay ejecutable DG2 verificado (versión, formatos y opciones pendientes).",
    "Condiciones iniciales y nivel de agua pendientes.",
    "Fronteras y criterios científicos pendientes.",
    "Elegibilidad no urbana de la ROI y del dominio hidráulico pendiente.",
    "Distribución espacial y temporal de la lluvia pendiente; la intensidad media derivada no la define.",
    "Infiltración no especificada ni supuesta.",
    "El DEM no se ha adquirido ni preparado como insumo hidráulico.",
]


class FloodPrepareApiTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.endpoint = "/api/flood-scenarios/prepare/"
        self.payload = {"rainfall": {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"}, "roi": ROI}

    def test_success_is_stateless_and_has_no_hydraulic_layers(self):
        with patch("pipeline.elevation.nasadem.NASADEMProvider.acquire_roi", side_effect=AssertionError("HTTP must not acquire DEM")):
            first = self.client.post(self.endpoint, self.payload, format="json")
            second = self.client.post(self.endpoint, self.payload, format="json")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(first.json(), {
            "rainfall": {
                "mode": "amount",
                "input": {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"},
                "amount_m": 0.012, "duration_s": 7200.0,
                "mean_intensity_m_s": 0.012 / 7200,
            },
            "roi": ROI,
            "can_simulate": False,
            "layers": [],
            "dem": {"status": "acquisition_not_requested", "provider_available": True},
            "blockers": BLOCKERS,
        })

    def test_invalid_request_is_400_without_state_or_provider_activity(self):
        original = json.loads(json.dumps(self.payload))
        self.payload["rainfall"] = {"amount": 1, "unit": "cm", "duration": 1, "duration_unit": "h"}
        response = self.client.post(self.endpoint, self.payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"errors": {"rainfall": ["Unidad no admitida; use mm."]}})
        self.assertEqual(self.payload["roi"], original["roi"])
        self.assertEqual(self.payload["rainfall"], {"amount": 1, "unit": "cm", "duration": 1, "duration_unit": "h"})

    def test_malformed_json_duplicate_keys_media_type_and_method_use_drf_responses(self):
        malformed = self.client.generic("POST", self.endpoint, data="{", content_type="application/json")
        duplicate = self.client.generic("POST", self.endpoint, data='{"roi":{},"roi":{}}', content_type="application/json")
        unsupported = self.client.generic("POST", self.endpoint, data="{}", content_type="text/plain")
        wrong_method = self.client.get(self.endpoint)
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(unsupported.status_code, 415)
        self.assertEqual(wrong_method.status_code, 405)

    def test_intensity_request_returns_mean_interval_intensity_not_a_result(self):
        self.payload["rainfall"] = {"intensity": 36, "intensity_unit": "mm/h", "duration": 2, "duration_unit": "h"}
        response = self.client.post(self.endpoint, self.payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "rainfall": {
                "mode": "intensity_duration",
                "input": {"intensity": 36, "intensity_unit": "mm/h", "duration": 2, "duration_unit": "h"},
                "amount_m": 0.072, "duration_s": 7200.0,
                "mean_intensity_m_s": 36 * (0.001 / 3600),
            },
            "roi": ROI, "can_simulate": False, "layers": [],
            "dem": {"status": "acquisition_not_requested", "provider_available": True},
            "blockers": BLOCKERS,
        })

    def test_missing_amount_duration_returns_exact_400_contract(self):
        self.payload["rainfall"] = {"amount": 12, "unit": "mm"}
        response = self.client.post(self.endpoint, self.payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"errors": {"rainfall": ["Campos de lluvia desconocidos o faltantes."]}})

    def test_invalid_geojson_numbers_and_structure_return_exact_400_without_acquisition(self):
        cases = [
            ({"type": "Polygon", "coordinates": [[[10**400, 0], [0, 0], [0, 1], [-1, 1], [10**400, 0]]]},
             "Coordenadas fuera del rango geográfico EPSG:4326."),
            ({"type": "Polygon", "coordinates": [[[[0, 0]], [[1, 0]], [[1, 1]], [[0, 1]], [[0, 0]]]]},
             "Las coordenadas deben ser anillos de pares numéricos finitos [longitud, latitud]."),
        ]
        with patch("pipeline.elevation.nasadem.NASADEMProvider.acquire_roi", side_effect=AssertionError("invalid ROI must not acquire DEM")):
            for roi, expected_error in cases:
                self.payload["roi"] = roi
                response = self.client.post(self.endpoint, self.payload, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"errors": {"roi": [expected_error]}})

    def test_extremely_nested_json_is_a_400_parse_error(self):
        nested = "[0,0]"
        for _ in range(600):
            nested = f"[{nested}]"
        body = (
            '{"rainfall":{"amount":1,"unit":"mm","duration":1,"duration_unit":"h"},'
            '"roi":{"type":"Polygon","coordinates":[['
            + ",".join([nested] * 4)
            + "]]}}"
        )
        with patch("pipeline.elevation.nasadem.NASADEMProvider.acquire_roi", side_effect=AssertionError("invalid JSON must not acquire DEM")):
            response = self.client.generic("POST", self.endpoint, data=body, content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"errors": {"roi": ["Las coordenadas deben ser anillos de pares numéricos finitos [longitud, latitud]."]}})

    def test_admin_route_still_resolves(self):
        response = self.client.get("/admin/login/")
        self.assertEqual(response.status_code, 200)


class FloodScenarioProfileApiTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.endpoint = "/api/flood-scenarios/prepare/"
        self.rainfall = {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"}
        self.payload = {"rainfall": dict(self.rainfall), "roi": json.loads(json.dumps(ROI))}
        self.options = {"interval_count": 8, "seed": 27, "distribution": "uniform_balanced"}

    def test_explicit_profile_returns_plottable_synthetic_time_series_and_stays_unready(self):
        body = {**self.payload, "rainfall_profile": dict(self.options)}
        random.seed(312)
        rng_before = random.getstate()
        with patch("pipeline.elevation.nasadem.NASADEMProvider.acquire_roi", side_effect=AssertionError("HTTP must not acquire DEM")), patch("pipeline.elevation.nasadem.NASADEMProvider", side_effect=AssertionError("HTTP must not create provider")):
            response = self.client.post(self.endpoint, body, format="json")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(set(result), {"rainfall", "roi", "can_simulate", "layers", "dem", "blockers", "rainfall_profile"})
        profile = result["rainfall_profile"]
        self.assertEqual(set(profile), {"rainfall", "roi", "segments", "distribution", "synthetic", "hydraulic_ready"})
        self.assertTrue(profile["synthetic"])
        self.assertFalse(profile["hydraulic_ready"])
        self.assertEqual(profile["distribution"]["seed"], self.options["seed"])
        self.assertEqual(profile["distribution"]["interval_count"], self.options["interval_count"])
        self.assertEqual(profile["distribution"]["name"], self.options["distribution"])
        self.assertEqual(profile["distribution"]["requested_bound_m_s"] * 3_600_000, 10)
        self.assertAlmostEqual(profile["distribution"]["effective_bound_m_s"] * 3_600_000, 6)
        self.assertEqual(profile["rainfall"]["duration_s"], 7200)
        self.assertEqual(len(profile["segments"]), 8)
        segments = profile["segments"]
        self.assertEqual(segments[0]["start_s"], 0)
        self.assertEqual(segments[-1]["end_s"], 7200)
        self.assertTrue(all(a["end_s"] == b["start_s"] for a, b in zip(segments, segments[1:])))
        mean = result["rainfall"]["mean_intensity_m_s"]
        self.assertTrue(all(0 <= segment["intensity_m_s"] for segment in segments))
        self.assertTrue(all(abs(segment["intensity_m_s"] - mean) * 3_600_000 <= 10 + 1e-10 for segment in segments))
        total = sum(segment["intensity_m_s"] * (segment["end_s"] - segment["start_s"]) for segment in segments)
        self.assertAlmostEqual(total, result["rainfall"]["amount_m"], places=14)
        self.assertFalse(result["can_simulate"])
        self.assertEqual(result["layers"], [])
        self.assertEqual(result["dem"], {"status": "acquisition_not_requested", "provider_available": True})
        self.assertEqual(random.getstate(), rng_before)
        blockers = result["blockers"]
        self.assertEqual(len(blockers), 7)
        self.assertEqual(blockers[0], "No hay ejecutable DG2 verificado (versión, formatos y opciones pendientes).")
        self.assertEqual(blockers[1], "Condiciones iniciales y nivel de agua pendientes.")
        self.assertEqual(blockers[2], "Fronteras y criterios científicos pendientes.")
        self.assertIn("sintético", blockers[4])
        self.assertIn("validado", blockers[4])
        self.assertIn("espacial", blockers[4])
        self.assertEqual(blockers[5], "Infiltración no especificada ni supuesta.")
        self.assertEqual(blockers[6], "El DEM no se ha adquirido ni preparado como insumo hidráulico.")

    def test_low_mean_reduces_effective_bound_without_negative_rainfall(self):
        body = {
            **self.payload,
            "rainfall": {"amount": 0.001, "unit": "mm", "duration": 1, "duration_unit": "h"},
            "rainfall_profile": dict(self.options),
        }
        response = self.client.post(self.endpoint, body, format="json")
        self.assertEqual(response.status_code, 200)
        profile = response.json()["rainfall_profile"]
        mean = profile["rainfall"]["mean_intensity_m_s"]
        self.assertAlmostEqual(profile["distribution"]["effective_bound_m_s"], mean)
        self.assertTrue(all(segment["intensity_m_s"] >= 0 for segment in profile["segments"]))
        integral = sum(segment["intensity_m_s"] * (segment["end_s"] - segment["start_s"]) for segment in profile["segments"])
        self.assertAlmostEqual(integral, profile["rainfall"]["amount_m"], places=16)

    def test_invalid_profile_envelopes_are_prefixed_400_and_leave_input_unchanged(self):
        cases = [
            (None, "Debe ser un objeto con exactamente interval_count, seed y distribution."),
            (True, "Debe ser un objeto con exactamente interval_count, seed y distribution."),
            ([], "Debe ser un objeto con exactamente interval_count, seed y distribution."),
            ({"seed": 1, "distribution": "uniform_balanced"}, "Debe contener exactamente interval_count, seed y distribution."),
            ({**self.options, "extra": 1}, "Debe contener exactamente interval_count, seed y distribution."),
            ({"interval_count": True, "seed": 1, "distribution": "uniform_balanced"}, "interval_count debe ser par entre 2 y 10000."),
            ({"interval_count": 3, "seed": 1, "distribution": "uniform_balanced"}, "interval_count debe ser par entre 2 y 10000."),
            ({"interval_count": 2, "seed": True, "distribution": "uniform_balanced"}, "seed debe ser un entero."),
            ({"interval_count": 2, "seed": 1, "distribution": "normal"}, "distribution debe ser 'uniform_balanced'."),
        ]
        for options, message in cases:
            with self.subTest(options=options):
                original = {**self.payload, "rainfall_profile": options}
                before = json.loads(json.dumps(original))
                response = self.client.post(self.endpoint, original, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"errors": {"rainfall_profile": [message]}})
                self.assertEqual(original, before)
