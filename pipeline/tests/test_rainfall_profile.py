import math
import random

import pytest

from pipeline.hydrology.inputs import InputValidationError
from pipeline.hydrology.rainfall import generate_rainfall_profile

ROI = {"type": "Polygon", "coordinates": [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]]}


def payload(rainfall=None):
    return {"rainfall": rainfall or {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"}, "roi": ROI}


def test_profiles_are_bounded_conserved_and_reproducible_for_both_input_modes():
    amount = payload()
    intensity = payload({"intensity": 6, "intensity_unit": "mm/h", "duration": 2, "duration_unit": "h"})
    a = generate_rainfall_profile(amount, interval_count=8, seed=27, distribution="uniform_balanced")
    b = generate_rainfall_profile(intensity, interval_count=8, seed=27, distribution="uniform_balanced")
    assert a["segments"] == b["segments"]
    assert a["rainfall"]["amount_m"] == b["rainfall"]["amount_m"]
    assert a["rainfall"]["duration_s"] == b["rainfall"]["duration_s"]
    assert a["synthetic"] and not a["hydraulic_ready"]
    assert a["rainfall"]["amount_m"] == pytest.approx(.012)
    assert a["distribution"]["name"] == "uniform_balanced"
    assert a["distribution"]["requested_bound_m_s"] == 10 / 1000 / 3600
    segments = a["segments"]
    assert segments[0]["start_s"] == 0 and segments[-1]["end_s"] == 7200
    assert all(x["end_s"] == y["start_s"] for x, y in zip(segments, segments[1:]))
    rates = [x["intensity_m_s"] for x in segments]
    mean = .012 / 7200
    bound = 10e-3 / 3600
    assert all(0 <= x and abs(x - mean) <= bound for x in rates)
    assert sum(x * (s["end_s"] - s["start_s"]) for x, s in zip(rates, segments)) == pytest.approx(.012, abs=1e-15)
    assert a == generate_rainfall_profile(amount, interval_count=8, seed=27, distribution="uniform_balanced")
    assert a != generate_rainfall_profile(amount, interval_count=8, seed=28, distribution="uniform_balanced")


def test_rng_input_immutability_and_low_or_zero_mean():
    data = payload({"amount": 0.001, "unit": "mm", "duration": 1, "duration_unit": "h"})
    original = repr(data)
    random.seed(9)
    state = random.getstate()
    profile = generate_rainfall_profile(data, interval_count=4, seed=1, distribution="uniform_balanced")
    assert random.getstate() == state and repr(data) == original
    assert profile["distribution"]["requested_bound_m_s"] * 1000 * 3600 == pytest.approx(10)
    assert profile["distribution"]["effective_bound_m_s"] == pytest.approx(profile["rainfall"]["mean_intensity_m_s"])
    low = generate_rainfall_profile(payload({"intensity": 6, "intensity_unit": "mm/h", "duration": 1, "duration_unit": "h"}), interval_count=8, seed=27, distribution="uniform_balanced")
    assert low["distribution"]["effective_bound_m_s"] == pytest.approx(6 / 1000 / 3600)
    high = generate_rainfall_profile(payload({"intensity": 50, "intensity_unit": "mm/h", "duration": 1, "duration_unit": "h"}), interval_count=8, seed=27, distribution="uniform_balanced")
    assert high["distribution"]["effective_bound_m_s"] == pytest.approx(10 / 1000 / 3600)
    high_mean = high["rainfall"]["mean_intensity_m_s"]
    assert max(abs(s["intensity_m_s"] - high_mean) for s in high["segments"]) * 1000 * 3600 > 1
    zero = generate_rainfall_profile(payload({"amount": 0, "unit": "mm", "duration": 1, "duration_unit": "h"}), interval_count=2, seed=1, distribution="uniform_balanced")
    assert all(s["intensity_m_s"] == 0 for s in zero["segments"])


@pytest.mark.parametrize("count", [True, 0, 1, 3, 10001, 1.5])
def test_rejects_invalid_counts(count):
    with pytest.raises(ValueError):
        generate_rainfall_profile(payload(), interval_count=count, seed=1, distribution="uniform_balanced")


@pytest.mark.parametrize("seed", [True, 1.5, "1"])
def test_rejects_invalid_seed(seed):
    with pytest.raises(ValueError):
        generate_rainfall_profile(payload(), interval_count=2, seed=seed, distribution="uniform_balanced")


def test_rejects_unknown_distribution_and_bad_input():
    with pytest.raises(ValueError):
        generate_rainfall_profile(payload(), interval_count=2, seed=1, distribution="normal")
    with pytest.raises(InputValidationError):
        generate_rainfall_profile(payload({"amount": 1, "unit": "cm", "duration": 1, "duration_unit": "h"}), interval_count=2, seed=1, distribution="uniform_balanced")


def test_accepts_fractional_interval_duration_without_gaps_or_integral_drift():
    data = payload({"amount": 1, "unit": "mm", "duration": 1, "duration_unit": "s"})
    profile = generate_rainfall_profile(data, interval_count=98, seed=1, distribution="uniform_balanced")
    segments = profile["segments"]
    assert segments[0]["start_s"] == 0 and segments[-1]["end_s"] == 1
    assert all(math.isfinite(s["start_s"]) and math.isfinite(s["end_s"]) and s["end_s"] > s["start_s"] for s in segments)
    assert all(a["end_s"] == b["start_s"] for a, b in zip(segments, segments[1:]))
    integral = sum(s["intensity_m_s"] * (s["end_s"] - s["start_s"]) for s in segments)
    assert integral == pytest.approx(.001, rel=1e-12, abs=1e-15)


def test_rejects_actual_interval_underflow():
    tiny = payload({"intensity": 1e300, "intensity_unit": "mm/s", "duration": 1e-320, "duration_unit": "s"})
    with pytest.raises(ValueError):
        generate_rainfall_profile(tiny, interval_count=10000, seed=1, distribution="uniform_balanced")
