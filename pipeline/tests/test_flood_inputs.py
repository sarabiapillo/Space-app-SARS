import pytest

from pipeline.hydrology.inputs import InputValidationError, normalize_request


ROI = {"type": "Polygon", "coordinates": [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]]}


def request(rainfall=None, roi=None):
    return {"rainfall": {"amount": 12, "unit": "mm", "duration": 1, "duration_unit": "h"} if rainfall is None else rainfall, "roi": ROI if roi is None else roi}


def test_normalizes_amount_and_preserves_original_input():
    entered = {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"}
    result = normalize_request(request(entered))
    assert result["rainfall"] == {
        "mode": "amount", "input": entered, "amount_m": 0.012,
        "duration_s": 7200.0, "mean_intensity_m_s": pytest.approx(0.012 / 7200),
    }
    assert result["roi"] == ROI


def test_amount_without_duration_is_rejected():
    with pytest.raises(InputValidationError) as caught:
        normalize_request(request({"amount": 12, "unit": "mm"}))
    assert caught.value.errors == {"rainfall": ["Campos de lluvia desconocidos o faltantes."]}


def test_normalizes_intensity_and_equivalent_units():
    a = normalize_request(request({"intensity": 36, "intensity_unit": "mm/h", "duration": 2, "duration_unit": "h"}))
    assert a["rainfall"]["duration_s"] == 7200.0
    b = normalize_request(request({"intensity": 0.6, "intensity_unit": "mm/min", "duration": 120, "duration_unit": "min"}))
    c = normalize_request(request({"intensity": 0.01, "intensity_unit": "mm/s", "duration": 7200, "duration_unit": "s"}))
    assert a["rainfall"]["mean_intensity_m_s"] == pytest.approx(1e-5)
    assert a["rainfall"]["amount_m"] == pytest.approx(0.072)
    for equivalent in (b, c):
        assert equivalent["rainfall"]["amount_m"] == pytest.approx(a["rainfall"]["amount_m"])
        assert equivalent["rainfall"]["mean_intensity_m_s"] == pytest.approx(a["rainfall"]["mean_intensity_m_s"])


@pytest.mark.parametrize("rain", [
    {"amount": 0, "unit": "mm", "duration": 1, "duration_unit": "h"},
    {"intensity": 0, "intensity_unit": "mm/h", "duration": 1, "duration_unit": "h"},
])
def test_zero_rain_is_valid(rain):
    assert normalize_request(request(rain))["rainfall"]["amount_m"] == 0


@pytest.mark.parametrize("rain", [
    {}, {"amount": 1}, {"amount": 1, "unit": "mm", "duration": 1},
    {"intensity": 1, "intensity_unit": "mm/h"},
    {"amount": 1, "unit": "mm", "intensity": 1, "intensity_unit": "mm/h", "duration": 1, "duration_unit": "h"},
    {"amount": True, "unit": "mm"}, {"amount": "1", "unit": "mm"},
    {"amount": float("nan"), "unit": "mm"}, {"amount": float("inf"), "unit": "mm"},
    {"amount": -1, "unit": "mm"}, {"amount": 1, "unit": "cm"},
    {"intensity": 1, "intensity_unit": "mm/day", "duration": 1, "duration_unit": "h"},
    {"intensity": 1, "intensity_unit": [], "duration": 1, "duration_unit": "h"},
    {"intensity": 1, "intensity_unit": "mm/h", "duration": 0, "duration_unit": "h"},
    {"intensity": 1, "intensity_unit": "mm/h", "duration": 1, "duration_unit": "day"},
    {"intensity": 1e308, "intensity_unit": "mm/h", "duration": 1e308, "duration_unit": "h"},
    {"intensity": 1e-320, "intensity_unit": "mm/h", "duration": 1, "duration_unit": "h"},
    {"amount": 1, "unit": "mm", "duration": 1, "duration_unit": "s", "extra": 1},
    {"amount": 1, "unit": "mm", "duration": 10**400, "duration_unit": "s"},
    {"amount": 1e308, "unit": "mm", "duration": 1e-320, "duration_unit": "s"},
    {"amount": 5e-321, "unit": "mm", "duration": 1e308, "duration_unit": "s"},
])
def test_invalid_rainfall_has_field_errors(rain):
    with pytest.raises(InputValidationError) as caught:
        normalize_request(request(rain))
    assert any(key == "rainfall" or key.startswith("rainfall.") for key in caught.value.errors)
    assert all(isinstance(messages, list) and messages for messages in caught.value.errors.values())


@pytest.mark.parametrize("roi", [
    {"type": "Point", "coordinates": [0, 0]},
    {"type": "Polygon", "coordinates": []},
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]},
    {"type": "Polygon", "coordinates": [[[-181, 0], [0, 0], [0, 1], [-181, 1], [-181, 0]]]},
    {"type": "Polygon", "coordinates": [[[-1, -91], [0, -91], [0, 1], [-1, 1], [-1, -91]]]},
    {"type": "Polygon", "coordinates": [[[-170, 0], [170, 0], [170, 1], [-170, 1], [-170, 0]]]},
    {"type": "Polygon", "coordinates": [[[-1, 0], [0, 0], [0, 1, 2], [-1, 1], [-1, 0]]]},
    {"type": "Polygon", "coordinates": [[[10**400, 0], [0, 0], [0, 1], [-1, 1], [10**400, 0]]]},
    {"type": "Polygon", "coordinates": [[[[0, 0]], [[1, 0]], [[1, 1]], [[0, 1]], [[0, 0]]]]},
    {"type": "Polygon", "coordinates": [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]], "crs": "EPSG:3857"},
])
def test_invalid_roi_is_rejected(roi):
    with pytest.raises(InputValidationError) as caught:
        normalize_request(request(roi=roi))
    assert "roi" in caught.value.errors


def test_dem_adapter_forwards_validated_roi_and_reports_coverage_errors():
    from pipeline.hydrology.dem import acquire_dem
    class FakeProvider:
        def __init__(self):
            self.received = None
        def acquire_roi(self, roi):
            self.received = roi
            return ("original zip record",)
    provider = FakeProvider()
    assert acquire_dem(ROI, provider=provider) == ("original zip record",)
    assert provider.received == ROI
    class MissingCoverage:
        def acquire_roi(self, roi):
            raise ValueError("outside NASADEM coverage")
    with pytest.raises(ValueError, match="outside NASADEM coverage"):
        acquire_dem(ROI, provider=MissingCoverage())
    invalid_provider = FakeProvider()
    with pytest.raises(InputValidationError):
        acquire_dem({"type": "Polygon", "coordinates": []}, provider=invalid_provider)
    assert invalid_provider.received is None


def test_standalone_roi_validation_is_shared_with_the_dem_adapter():
    from pipeline.hydrology.inputs import validate_roi
    assert validate_roi(ROI) == ROI


def test_provider_factory_accepts_injection_without_acquisition():
    from pipeline.hydrology.dem import get_dem_provider
    sentinel = object()
    assert get_dem_provider(provider=sentinel) is sentinel


