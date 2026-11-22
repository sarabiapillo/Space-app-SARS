from __future__ import annotations

import hashlib
import io
import json
import math
from pathlib import Path
from types import SimpleNamespace
import zipfile

import pandas as pd
import pytest

from pipeline.solar import clearsky


_POSITION = {
    "azimuth_deg": 194.34,
    "geometric_elevation_deg": 39.8,
    "apparent_elevation_deg": 40.0,
    "apparent_zenith_deg": 50.0,
    "geometric_zenith_deg": 50.2,
    "night": False,
    "datetime_local": "2024-06-01T12:00:00",
    "timezone": "UTC",
    "utc_offset": "+00:00",
    "datetime_utc": pd.Timestamp("2024-06-01T12:00:00Z"),
    "representative_point_lonlat": [-105.1786, 39.742476],
    "altitude_m": 1830.14,
    "altitude_datum": "EGM96",
    "pressure_hpa": 820.0,
    "pressure_pa": 82000.0,
    "pressure_provenance": "input: caller-supplied hPa",
    "temperature_c": 11.0,
    "temperature_provenance": "input: caller-supplied Celsius",
    "pvlib_version": "0.16.1",
    "spa_method": "NREL SPA (pvlib.solarposition.spa_python)",
}


def _invoke(monkeypatch, *, percent=50, position=None):
    calls = []
    monkeypatch.setattr(clearsky, "compute_solar_position", lambda **kwargs: calls.append(kwargs) or dict(position or _POSITION))
    result = clearsky.compute_clear_sky_dni(
        roi={"type": "Polygon", "coordinates": []},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=object(), intensity_percent=percent,
        temperature_c=11.0, pressure_hpa=820.0,
    )
    return result, calls


def test_daytime_matches_independent_pvlib_composition_and_keeps_phase_a_pressure(monkeypatch):
    pvlib = pytest.importorskip("pvlib")
    result, calls = _invoke(monkeypatch, percent=50)
    times = pd.DatetimeIndex([pd.Timestamp(_POSITION["datetime_utc"]).tz_convert("UTC")])
    lat, lon = _POSITION["representative_point_lonlat"][1], _POSITION["representative_point_lonlat"][0]
    linke = pvlib.clearsky.lookup_linke_turbidity(times, lat, lon, interp_turbidity=True)
    relative = pvlib.atmosphere.get_relative_airmass(50.0, model="kastenyoung1989")
    absolute = pvlib.atmosphere.get_absolute_airmass(relative, pressure=82000.0)
    extra = pvlib.irradiance.get_extra_radiation(times, method="spencer")
    expected = pvlib.clearsky.ineichen(
        50.0, absolute, linke, altitude=1830.14, dni_extra=extra,
        perez_enhancement=False,
    )["dni"]
    assert len(calls) == 1
    assert result["dni_clear_sky_w_m2"] == pytest.approx(float(expected.iloc[0]))
    assert result["dni_adjusted_w_m2"] == pytest.approx(float(expected.iloc[0]) * 0.5)
    assert result["airmass_relative"] == pytest.approx(float(relative))
    assert result["airmass_absolute"] == pytest.approx(float(absolute))
    assert result["pressure_pa"] == 82000.0
    assert result["representative_point_lonlat"] == _POSITION["representative_point_lonlat"]
    assert result["datetime_utc"] == _POSITION["datetime_utc"]
    assert result["atmospheric_provenance"]["linke_interpolation"] == "daily interpolation using UTC day of year"
    assert result["atmospheric_provenance"]["linke_dataset"] == "pvlib LinkeTurbidities.h5"
    assert result["atmospheric_provenance"]["linke_dataset_sha256"] == hashlib.sha256(
        (Path(pvlib.clearsky.__file__).parent / "data" / "LinkeTurbidities.h5").read_bytes()
    ).hexdigest()
    json.dumps(result, allow_nan=False, default=str)


@pytest.mark.parametrize("percent", [0, 50, 100])
def test_intensity_scaling_and_bounds(monkeypatch, percent):
    result, _ = _invoke(monkeypatch, percent=percent)
    assert result["dni_adjusted_w_m2"] == pytest.approx(result["dni_clear_sky_w_m2"] * percent / 100)
    assert 0 <= result["dni_adjusted_w_m2"] <= result["dni_clear_sky_w_m2"]
    assert result["intensity_percent"] == percent


def test_idealized_reference_dni_is_date_free_reproducible_and_horizon_is_zero():
    from pipeline.solar.clearsky import compute_reference_dni
    horizon = compute_reference_dni(elevation_deg=0, altitude_m=100, pressure_pa=100000,
                                   intensity_percent=100)
    assert horizon['dni_adjusted_w_m2'] == 0
    assert horizon['night'] is True
    assert horizon['airmass_relative'] is None
    first = compute_reference_dni(elevation_deg=45, altitude_m=100, pressure_pa=100000,
                                  intensity_percent=100)
    second = compute_reference_dni(elevation_deg=45, altitude_m=100, pressure_pa=100000,
                                   intensity_percent=100)
    assert first == second
    assert first['dni_adjusted_w_m2'] > 0
    assert first['dni_extra_w_m2'] == 1361.0
    assert first['linke_turbidity'] == 3.0
    assert 'no date' in first['reference_provenance']


@pytest.mark.parametrize("percent", [True, False, "50", float("nan"), float("inf"), -1, 100.1, 10**1000])
def test_invalid_intensity_rejected_before_phase_a(percent):
    def forbidden(**kwargs):
        raise AssertionError("phase A/provider IO must not run for invalid percentage")
    original = clearsky.compute_solar_position
    clearsky.compute_solar_position = forbidden
    try:
        with pytest.raises(ValueError, match="intensity_percent"):
            clearsky.compute_clear_sky_dni(
                roi={}, datetime_local="invalid", timezone_name="UTC", provider=object(),
                intensity_percent=percent,
            )
    finally:
        clearsky.compute_solar_position = original


def test_geometrically_below_horizon_returns_zero_despite_positive_refraction(monkeypatch):
    position = dict(
        _POSITION,
        geometric_elevation_deg=-0.2,
        apparent_elevation_deg=0.1,
        apparent_zenith_deg=89.9,
        night=False,
    )
    result, _ = _invoke(monkeypatch, percent=100, position=position)
    assert result["night"] is True
    assert result["dni_clear_sky_w_m2"] == 0.0
    assert result["dni_adjusted_w_m2"] == 0.0


def test_night_and_horizon_return_zero_without_linke_lookup(monkeypatch):
    for elevation in (-12.0, 0.0):
        position = dict(_POSITION, geometric_elevation_deg=elevation, apparent_elevation_deg=elevation,
                        apparent_zenith_deg=90.0-elevation, night=True)
        monkeypatch.setattr(clearsky, "compute_solar_position", lambda **kwargs: dict(position))
        monkeypatch.setattr(clearsky.pvlib.clearsky, "lookup_linke_turbidity", lambda *a, **k: pytest.fail("night must skip Linke LUT"))
        result = clearsky.compute_clear_sky_dni(
            roi={}, datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
            provider=object(), intensity_percent=100,
        )
        assert result["dni_clear_sky_w_m2"] == 0
        assert result["dni_adjusted_w_m2"] == 0
        assert result["linke_turbidity"] is None
        assert result["airmass_relative"] is None
        assert result["airmass_absolute"] is None
        assert result["dni_extra_w_m2"] is None
        assert result["atmospheric_provenance"]["night_evaluation"] == "not evaluated at night"
        json.dumps(result, allow_nan=False, default=str)


def test_invalid_linke_and_dni_fail_closed(monkeypatch):
    monkeypatch.setattr(clearsky, "compute_solar_position", lambda **kwargs: dict(_POSITION))
    monkeypatch.setattr(clearsky.pvlib.clearsky, "lookup_linke_turbidity", lambda *a, **k: pd.Series([float("nan")], index=[pd.Timestamp(_POSITION["datetime_utc"])]))
    with pytest.raises(ValueError, match="Linke"):
        clearsky.compute_clear_sky_dni(roi={}, datetime_local="x", timezone_name="UTC", provider=object(), intensity_percent=50)

    monkeypatch.setattr(clearsky.pvlib.clearsky, "lookup_linke_turbidity", lambda *a, **k: pd.Series([3.0], index=[pd.Timestamp(_POSITION["datetime_utc"])]))
    monkeypatch.setattr(clearsky.pvlib.clearsky, "ineichen", lambda *a, **k: pd.DataFrame({"dni": [float("inf")]}, index=[pd.Timestamp(_POSITION["datetime_utc"])]))
    with pytest.raises(ValueError, match="DNI"):
        clearsky.compute_clear_sky_dni(roi={}, datetime_local="x", timezone_name="UTC", provider=object(), intensity_percent=50)


@pytest.mark.parametrize("bad_stage", ["relative", "absolute", "extra"])
def test_invalid_airmass_or_extraterrestrial_irradiance_fails_closed(monkeypatch, bad_stage):
    monkeypatch.setattr(clearsky, "compute_solar_position", lambda **kwargs: dict(_POSITION))
    if bad_stage == "relative":
        monkeypatch.setattr(clearsky.pvlib.atmosphere, "get_relative_airmass", lambda *a, **k: float("nan"))
    elif bad_stage == "absolute":
        monkeypatch.setattr(clearsky.pvlib.atmosphere, "get_absolute_airmass", lambda *a, **k: -1.0)
    else:
        monkeypatch.setattr(clearsky.pvlib.irradiance, "get_extra_radiation", lambda *a, **k: 0.0)
    with pytest.raises(ValueError, match="air mass|airmass|extraterrestrial"):
        clearsky.compute_clear_sky_dni(
            roi={}, datetime_local="x", timezone_name="UTC", provider=object(), intensity_percent=50
        )


def test_missing_linke_dataset_fails_closed(monkeypatch):
    monkeypatch.setattr(clearsky, "compute_solar_position", lambda **kwargs: dict(_POSITION))
    monkeypatch.setattr(clearsky.pvlib.clearsky, "lookup_linke_turbidity", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("missing LUT")))
    with pytest.raises(ValueError, match="Linke|dataset"):
        clearsky.compute_clear_sky_dni(roi={}, datetime_local="x", timezone_name="UTC", provider=object(), intensity_percent=50)


def test_public_phase_a_to_b_pipeline_uses_synthetic_nasadem(monkeypatch):
    from pipeline.solar import dem

    real_prepare = dem.prepare_dem
    monkeypatch.setattr(dem, "prepare_dem", lambda paths, roi: real_prepare(paths, roi, tile_size=5))
    import numpy as np
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("n00e000.hgt", np.full((5, 5), 100, dtype=">i2").tobytes())

    class OfflineProvider:
        def acquire_roi(self, roi):
            return (SimpleNamespace(tile_id="n00e000", path=data.getvalue()),)

    result = clearsky.compute_clear_sky_dni(
        roi={"type": "Polygon", "coordinates": [[[0.1, 0.1], [0.9, 0.1],
              [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]]},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=OfflineProvider(), intensity_percent=50, pressure_hpa=820,
    )
    assert result["dem_tile_ids"] == ["n00e000"]
    assert result["altitude_m"] == pytest.approx(100)
    assert result["altitude_datum"] == "EGM96"
    assert result["pressure_pa"] == 82000
    assert result["dni_clear_sky_w_m2"] > 0
    assert result["dni_adjusted_w_m2"] == pytest.approx(result["dni_clear_sky_w_m2"] / 2)
    assert result["linke_dataset_sha256"] is not None
    json.dumps(result, allow_nan=False)


def test_phase_a_standalone_reference_remains_unchanged():
    from pipeline.solar.position import _spa_position
    result = _spa_position(
        "2003-10-17T19:30:30+00:00", longitude_deg=-105.1786,
        latitude_deg=39.742476, altitude_m=1830.14, pressure_pa=82000.0,
        temperature_c=11.0,
    )
    assert result["azimuth"] == pytest.approx(194.34024, abs=0.0002)
    assert result["apparent_zenith"] == pytest.approx(50.11162, abs=0.0002)
