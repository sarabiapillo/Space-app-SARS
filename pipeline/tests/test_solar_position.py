from __future__ import annotations

import io
import zipfile

import numpy as np
import pytest
from shapely.geometry import Point, shape

from pipeline.solar.position import _spa_position, compute_solar_position


def test_spa_matches_nrel_reference_a5():
    """NREL SPA A.5 (https://docs.nlr.gov/docs/fy08osti/34302.pdf).

    Fixed MST (-07), pressure 820 hPa, temperature 11 C; 0.0002-degree
    tolerances accommodate published rounding and implementation precision.
    """
    row = _spa_position(
        "2003-10-17T19:30:30+00:00", longitude_deg=-105.1786,
        latitude_deg=39.742476, altitude_m=1830.14, pressure_pa=82000.0,
        temperature_c=11.0,
    )
    assert row["azimuth"] == pytest.approx(194.34024, abs=0.0002)
    assert row["apparent_zenith"] == pytest.approx(50.11162, abs=0.0002)


def _zip_hgt(tile, array):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{tile}.hgt", np.asarray(array, dtype=">i2").tobytes())
    return buffer.getvalue()


class _Granule:
    tile_id = "n00e000"

    def __init__(self, path):
        self.path = path


class _Provider:
    def __init__(self, path):
        self.path = path

    def acquire_roi(self, roi):
        self.roi = roi
        return (_Granule(self.path),)


def _small_pixels(monkeypatch):
    from pipeline.solar import dem
    real_prepare = dem.prepare_dem
    monkeypatch.setattr(dem, "prepare_dem", lambda paths, roi: real_prepare(
        paths, roi, tile_size=5, max_pixels=1000, max_memory_bytes=10_000_000
    ))


_CONCAVE = {"type": "Polygon", "coordinates": [[
    [0.10, 0.10], [0.90, 0.10], [0.90, 0.90], [0.55, 0.90],
    [0.55, 0.35], [0.45, 0.35], [0.45, 0.90], [0.10, 0.90], [0.10, 0.10]
]]}


def test_roi_pipeline_selects_nearest_interior_valid_pixel(monkeypatch):
    _small_pixels(monkeypatch)
    provider = _Provider(_zip_hgt("n00e000", np.full((5, 5), 100, dtype=np.int16)))
    result = compute_solar_position(
        roi=_CONCAVE, datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=provider, pressure_hpa=820.0, temperature_c=11.0,
    )
    assert result["point_method"] == "nearest valid prepared pixel center to projected shapely representative_point; row/col tie-break"
    assert result["row"] >= 0 and result["col"] >= 0
    assert result["altitude_m"] == pytest.approx(100.0)
    assert result["altitude_datum"] == "EGM96"
    assert "no ellipsoidal conversion" in result["altitude_interpretation"]
    assert result["dem_tile_ids"] == ["n00e000"]
    assert result["pressure_hpa"] == 820.0
    assert result["pressure_pa"] == 82000.0
    assert result["temperature_c"] == 11.0
    assert shape(_CONCAVE).contains(Point(*result["representative_point_lonlat"]))
    assert result["apparent_elevation_deg"] + result["apparent_zenith_deg"] == pytest.approx(90.0, abs=1e-8)
    assert result["night"] is False
    assert result["pvlib_version"] == "0.16.1"
    assert result["spa_method"] == "NREL SPA (pvlib.solarposition.spa_python)"
    assert result["pressure_provenance"] == "input: caller-supplied hPa"


def test_negative_dem_elevation_and_standard_pressure_provenance(monkeypatch):
    _small_pixels(monkeypatch)
    provider = _Provider(_zip_hgt("n00e000", np.full((5, 5), -20, dtype=np.int16)))
    result = compute_solar_position(
        roi={"type": "Polygon", "coordinates": [[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]]},
        datetime_local="2024-06-01T00:00:00", timezone_name="UTC", provider=provider,
    )
    assert result["altitude_m"] == pytest.approx(-20.0)
    assert result["night"] is True
    assert result["temperature_c"] == 12.0
    assert result["pressure_hpa"] > 1013.25
    assert result["pressure_pa"] == pytest.approx(result["pressure_hpa"] * 100)
    assert "dry standard atmosphere" in result["pressure_provenance"]
    assert "NASADEM EGM96" in result["pressure_provenance"]


def test_no_valid_interior_pixel_fails_closed(monkeypatch):
    from dataclasses import replace
    from pipeline.solar import dem
    real_prepare = dem.prepare_dem
    def no_valid(paths, roi):
        prepared = real_prepare(paths, roi, tile_size=5, max_pixels=1000, max_memory_bytes=10_000_000)
        return replace(prepared, valid_mask=np.zeros_like(prepared.valid_mask))
    monkeypatch.setattr(dem, "prepare_dem", no_valid)
    provider = _Provider(_zip_hgt("n00e000", np.full((5, 5), 100, dtype=np.int16)))
    roi = {"type": "Polygon", "coordinates": [[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]]}
    with pytest.raises(ValueError, match="valid.*interior|interior.*valid"):
        compute_solar_position(roi=roi, datetime_local="2024-06-01T12:00:00", timezone_name="UTC", provider=provider)


def test_mixed_nasadem_void_fails_closed_before_spa(monkeypatch):
    _small_pixels(monkeypatch)
    values = np.full((5, 5), 100, dtype=np.int16)
    values[2, 2] = -32768
    provider = _Provider(_zip_hgt("n00e000", values))
    roi = {"type": "Polygon", "coordinates": [[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]]}
    with pytest.warns(RuntimeWarning, match="out-of-range NASADEM HGT elevation"):
        with pytest.raises(ValueError, match="out-of-range.*HGT"):
            compute_solar_position(roi=roi, datetime_local="2024-06-01T12:00:00", timezone_name="UTC", provider=provider)


def test_all_nasadem_void_fails_closed_with_explicit_warning(monkeypatch):
    _small_pixels(monkeypatch)
    provider = _Provider(_zip_hgt("n00e000", np.full((5, 5), -32768, dtype=np.int16)))
    roi = {"type": "Polygon", "coordinates": [[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]]}
    with pytest.warns(RuntimeWarning, match="out-of-range NASADEM HGT elevation"):
        with pytest.raises(ValueError, match="out-of-range.*HGT"):
            compute_solar_position(roi=roi, datetime_local="2024-06-01T12:00:00", timezone_name="UTC", provider=provider)


def test_invalid_time_and_atmosphere_inputs_fail_before_any_provider_io():
    class NoIO:
        def acquire_roi(self, roi):
            raise AssertionError("provider must not be called for invalid input")
    roi = _CONCAVE
    with pytest.raises(ValueError, match="timezone"):
        compute_solar_position(roi=roi, datetime_local="2024-06-01T12:00:00", timezone_name="Mars/Olympus", provider=NoIO())
    with pytest.raises(ValueError, match="pressure_hpa"):
        compute_solar_position(roi=roi, datetime_local="2024-06-01T12:00:00", timezone_name="UTC", provider=NoIO(), pressure_hpa=0)
    with pytest.raises(ValueError, match="ambiguous"):
        compute_solar_position(roi=roi, datetime_local="2024-11-03T01:30:00", timezone_name="America/Denver", provider=NoIO())


def test_provider_empty_results_fail_closed():
    class Empty:
        def acquire_roi(self, roi):
            return ()
    with pytest.raises(ValueError, match="granule|tile|DEM"):
        compute_solar_position(roi=_CONCAVE, datetime_local="2024-06-01T12:00:00", timezone_name="UTC", provider=Empty())
