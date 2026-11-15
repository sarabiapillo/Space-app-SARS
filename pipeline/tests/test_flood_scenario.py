"""Pure-Python tests for flood-scenario composition, independent of Django."""
import json

import pytest

from pipeline.hydrology.inputs import InputValidationError
from pipeline.hydrology.scenario import prepare_rainfall_profile

ROI = {"type": "Polygon", "coordinates": [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]]}
RAIN = {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"}
OPTIONS = {"interval_count": 8, "seed": 27, "distribution": "uniform_balanced"}


def test_composition_returns_normalized_base_and_explicit_synthetic_profile():
    payload = {"rainfall": dict(RAIN), "roi": json.loads(json.dumps(ROI)), "rainfall_profile": dict(OPTIONS)}
    original = json.loads(json.dumps(payload))
    normalized, profile = prepare_rainfall_profile(payload)

    assert normalized["rainfall"]["amount_m"] == pytest.approx(0.012)
    assert normalized["rainfall"]["duration_s"] == 7200
    assert profile["rainfall"] == normalized["rainfall"]
    assert profile["roi"] == ROI
    assert len(profile["segments"]) == OPTIONS["interval_count"]
    assert profile["distribution"]["name"] == OPTIONS["distribution"]
    assert profile["distribution"]["seed"] == OPTIONS["seed"]
    assert profile["distribution"]["interval_count"] == OPTIONS["interval_count"]
    assert profile["synthetic"] is True and profile["hydraulic_ready"] is False
    assert payload == original


def test_invalid_profile_envelopes_are_validation_errors_and_leave_input_unchanged():
    cases = [
        (None, "Debe ser un objeto con exactamente interval_count, seed y distribution."),
        (True, "Debe ser un objeto con exactamente interval_count, seed y distribution."),
        ([], "Debe ser un objeto con exactamente interval_count, seed y distribution."),
        ({"seed": 1, "distribution": "uniform_balanced"}, "Debe contener exactamente interval_count, seed y distribution."),
        ({**OPTIONS, "extra": 1}, "Debe contener exactamente interval_count, seed y distribution."),
        ({"interval_count": True, "seed": 1, "distribution": "uniform_balanced"}, "interval_count debe ser par entre 2 y 10000."),
        ({"interval_count": 3, "seed": 1, "distribution": "uniform_balanced"}, "interval_count debe ser par entre 2 y 10000."),
        ({"interval_count": 2, "seed": True, "distribution": "uniform_balanced"}, "seed debe ser un entero."),
        ({"interval_count": 2, "seed": 1, "distribution": "normal"}, "distribution debe ser 'uniform_balanced'."),
    ]
    for options, message in cases:
        payload = {"rainfall": dict(RAIN), "roi": json.loads(json.dumps(ROI)), "rainfall_profile": options}
        original = json.loads(json.dumps(payload))
        with pytest.raises(InputValidationError) as exc:
            prepare_rainfall_profile(payload)
        assert exc.value.errors == {"rainfall_profile": [message]}
        assert payload == original


def test_invalid_base_request_keeps_legacy_field_identity_and_does_not_mutate():
    payload = {
        "rainfall": {"amount": 12, "unit": "cm", "duration": 2, "duration_unit": "h"},
        "roi": json.loads(json.dumps(ROI)),
        "rainfall_profile": dict(OPTIONS),
    }
    original = json.loads(json.dumps(payload))
    with pytest.raises(InputValidationError) as exc:
        prepare_rainfall_profile(payload)
    assert exc.value.errors == {"rainfall": ["Unidad no admitida; use mm."]}
    assert payload == original
