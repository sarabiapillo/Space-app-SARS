from __future__ import annotations

import io
import math
import zipfile
from dataclasses import replace

import numpy as np
import pytest
from pyproj import CRS
from rasterio.transform import from_origin

from pipeline.solar import surface
from pipeline.solar.dem import PreparedDEM


def _zip_hgt(tile, array):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{tile}.hgt", np.asarray(array, dtype=">i2").tobytes())
    return buffer.getvalue()


class _Granule:
    def __init__(self, tile_id, path):
        self.tile_id = tile_id
        self.path = path


class _Provider:
    def __init__(self, paths):
        self.paths = paths
        self.calls = 0

    def acquire_roi(self, roi):
        self.calls += 1
        self.roi = roi
        return tuple(_Granule(tid, p) for tid, p in self.paths.items())


class _NoIOProvider:
    def acquire_roi(self, roi):
        raise AssertionError("provider must not be called for invalid input")


_CONCAVE = {"type": "Polygon", "coordinates": [[
    [0.10, 0.10], [0.90, 0.10], [0.90, 0.90], [0.55, 0.90],
    [0.55, 0.35], [0.45, 0.35], [0.45, 0.90], [0.10, 0.90], [0.10, 0.10]
]]}


def _small_dem(monkeypatch, paths):
    from pipeline.solar import dem, surface
    real_prepare = dem.prepare_dem
    monkeypatch.setattr(
        surface, "prepare_dem",
        lambda p, roi: real_prepare(p, roi, tile_size=9, max_pixels=1000, max_memory_bytes=10_000_000),
    )
    return _Provider(paths)


def _prepared_plane(shape, *, slope_north, slope_east=0.0, base=100.0):
    rows, cols = shape
    # Equidistant cylindrical projection: 1 degree lon/lat maps to ~111320 m,
    # so a [0,0]-[1,1] degree ROI projects onto the raster footprint.
    crs = CRS.from_proj4("+proj=eqc +datum=WGS84 +units=m +no_defs")
    pixel_x = 111320.0 / cols
    pixel_y = 111320.0 / rows
    y = np.arange(rows) * pixel_y
    y = y[::-1]  # north-up: row 0 is northernmost
    x = np.arange(cols) * pixel_x
    y_grid, x_grid = np.meshgrid(y, x, indexing="ij")
    elevation = base + slope_north * y_grid + slope_east * x_grid
    gdal_transform = (0.0, pixel_x, 0.0, float(rows) * pixel_y, 0.0, -pixel_y)
    valid = np.ones(shape, dtype=bool)
    halo = np.zeros(shape, dtype=bool)
    return PreparedDEM(
        elevation.astype(np.float32), valid, halo,
        gdal_transform, crs, ("synthetic",),
    )


def test_final_surface_mask_excludes_pixel_centers_outside_concave_roi(monkeypatch):
    prepared = _prepared_plane((20, 20), slope_north=0.0)
    monkeypatch.setattr(surface, 'prepare_dem', lambda paths, roi: prepared)
    result = surface.compute_incident_irradiance(
        roi=_CONCAVE, provider=_Provider({'synthetic': object()}),
        elevation_deg=45, azimuth_deg=180)
    # (col=10,row=5) is inside the ROI bbox but in the concave notch.
    assert not result['valid_mask'][5, 10]
    assert np.isnan(result['incident_w_m2'][5, 10])


def test_idealized_geometry_recalculates_dni_and_azimuth_projection_without_time(monkeypatch):
    prepared = _prepared_plane((20, 20), slope_north=0.0, slope_east=0.001)
    monkeypatch.setattr(surface, 'prepare_dem', lambda paths, roi: prepared)
    provider = _Provider({'synthetic': object()})
    east = surface.compute_incident_irradiance(
        roi=_CONCAVE, provider=provider, elevation_deg=45, azimuth_deg=90)
    west = surface.compute_incident_irradiance(
        roi=_CONCAVE, provider=provider, elevation_deg=45, azimuth_deg=270)
    high = surface.compute_incident_irradiance(
        roi=_CONCAVE, provider=provider, elevation_deg=60, azimuth_deg=90)
    assert east['clear_sky']['dni_adjusted_w_m2'] == west['clear_sky']['dni_adjusted_w_m2']
    assert high['clear_sky']['dni_adjusted_w_m2'] != east['clear_sky']['dni_adjusted_w_m2']
    assert not np.allclose(east['incident_w_m2'][east['valid_mask']],
                           west['incident_w_m2'][west['valid_mask']])
    assert 'datetime_utc' not in east['position']
    assert east['position']['elevation_deg'] == 45
    assert east['position']['azimuth_deg'] == 90


def test_flat_horizontal_incident_matches_sine_elevation(monkeypatch):
    provider = _small_dem(monkeypatch, {"n00e000": _zip_hgt("n00e000", np.full((9, 9), 100, dtype=np.int16))})
    result = surface.compute_incident_irradiance(
        roi=_CONCAVE, datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=provider, intensity_percent=75,
    )
    valid = result["valid_mask"]
    assert valid.any()
    dni = result["clear_sky"]["dni_adjusted_w_m2"]
    elevation = math.radians(result["position"]["apparent_elevation_deg"])
    expected = dni * math.sin(elevation)
    assert np.allclose(result["incident_w_m2"][valid], expected, rtol=1e-10)
    assert np.all(np.isnan(result["incident_w_m2"][~valid]))
    assert result["night"] is False
    assert result["units"] == "W/m2"
    assert result["model"] == "direct-geometric-v1"
    assert result["transform"] == tuple(result["transform"])


def test_tilted_plane_facing_sun_matches_analytic_dot_product(monkeypatch):
    from pipeline.solar import surface as surf
    slope = 0.5
    prepared = _prepared_plane((24, 24), slope_north=slope)
    monkeypatch.setattr(surf, "prepare_dem", lambda _p, _roi: prepared)
    provider = _Provider({"synthetic": b"unused"})

    result = surface.compute_incident_irradiance(
        roi={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=provider, intensity_percent=100,
    )
    valid = result["valid_mask"]
    dni = result["clear_sky"]["dni_adjusted_w_m2"]
    azimuth = math.radians(result["position"]["azimuth_deg"])
    elevation = math.radians(result["position"]["apparent_elevation_deg"])
    sun = np.array([
        math.cos(elevation) * math.sin(azimuth),
        math.cos(elevation) * math.cos(azimuth),
        math.sin(elevation),
    ])
    normal = np.array([0.0, -slope, 1.0]) / math.sqrt(1.0 + slope * slope)
    expected = dni * max(0.0, float(np.dot(normal, sun)))
    assert expected > 0
    core = valid.copy()
    core[:2, :] = False
    core[-2:, :] = False
    core[:, :2] = False
    core[:, -2:] = False
    assert np.allclose(result["incident_w_m2"][core], expected, rtol=1e-6)


def test_tilted_plane_facing_away_returns_exactly_zero(monkeypatch):
    from pipeline.solar import surface as surf, position
    slope = 2.0
    prepared = _prepared_plane((24, 24), slope_north=slope)
    monkeypatch.setattr(surf, "prepare_dem", lambda _p, _roi: prepared)

    synthetic_position = {
        "azimuth_deg": 0.0,
        "apparent_elevation_deg": 45.0,
        "apparent_zenith_deg": 45.0,
        "geometric_elevation_deg": 45.0,
        "geometric_zenith_deg": 45.0,
        "night": False,
        "representative_point_lonlat": [0.0, 0.0],
        "altitude_m": 0.0,
        "altitude_datum": "EGM96",
        "altitude_interpretation": "synthetic",
        "pressure_pa": 101325.0,
        "pressure_hpa": 1013.25,
        "pressure_provenance": "synthetic",
        "temperature_c": 12.0,
        "temperature_provenance": "synthetic",
        "datetime_utc": "2024-06-01T12:00:00+00:00",
        "datetime_local": "2024-06-01T12:00:00",
        "timezone": "UTC",
        "utc_offset": "+00:00",
        "pvlib_version": "0.16.1",
        "spa_method": "synthetic",
        "spa_delta_t": "synthetic",
        "point_method": "synthetic",
        "row": 0,
        "col": 0,
        "dem_tile_ids": ["synthetic"],
    }
    monkeypatch.setattr(
        surf, "solar_position_from_prepared", lambda *a, **k: synthetic_position
    )

    result = surface.compute_incident_irradiance(
        roi={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=_Provider({"synthetic": b"unused"}), intensity_percent=100,
    )
    valid = result["valid_mask"]
    # Sun from north, plane slopes north, dot product is negative.
    assert result["clear_sky"]["dni_adjusted_w_m2"] > 0
    assert np.all(result["incident_w_m2"][valid] == 0.0)
    assert np.all(np.isnan(result["incident_w_m2"][~valid]))


def test_east_slope_with_off_meridian_sun_matches_analytic_dot_product(monkeypatch):
    """Discriminates an east-axis mirror or azimuth-handedness flip.

    The plane slopes east (nonzero n_E) and the Sun sits off-meridian at 135°,
    so both horizontal components of the sun vector are exercised.
    """
    from pipeline.solar import surface as surf
    slope = 0.4
    prepared = _prepared_plane((24, 24), slope_north=0.0, slope_east=slope)
    monkeypatch.setattr(surf, "prepare_dem", lambda _p, _roi: prepared)

    synthetic_position = {
        "azimuth_deg": 135.0,
        "apparent_elevation_deg": 45.0,
        "apparent_zenith_deg": 45.0,
        "geometric_elevation_deg": 45.0,
        "geometric_zenith_deg": 45.0,
        "night": False,
        "representative_point_lonlat": [0.5, 0.5],
        "altitude_m": 100.0,
        "altitude_datum": "EGM96",
        "altitude_interpretation": "synthetic",
        "pressure_pa": 101325.0,
        "pressure_hpa": 1013.25,
        "pressure_provenance": "synthetic",
        "temperature_c": 12.0,
        "temperature_provenance": "synthetic",
        "datetime_utc": "2024-06-01T12:00:00+00:00",
        "datetime_local": "2024-06-01T12:00:00",
        "timezone": "UTC",
        "utc_offset": "+00:00",
        "pvlib_version": "0.16.1",
        "spa_method": "synthetic",
        "spa_delta_t": "synthetic",
        "point_method": "synthetic",
        "row": 0,
        "col": 0,
        "dem_tile_ids": ["synthetic"],
    }
    monkeypatch.setattr(
        surf, "solar_position_from_prepared", lambda *a, **k: synthetic_position
    )

    result = surface.compute_incident_irradiance(
        roi={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=_Provider({"synthetic": b"unused"}), intensity_percent=100,
    )
    valid = result["valid_mask"]
    dni = result["clear_sky"]["dni_adjusted_w_m2"]
    azimuth = math.radians(synthetic_position["azimuth_deg"])
    elevation = math.radians(synthetic_position["apparent_elevation_deg"])
    sun = np.array([
        math.cos(elevation) * math.sin(azimuth),
        math.cos(elevation) * math.cos(azimuth),
        math.sin(elevation),
    ])
    normal = np.array([-slope, 0.0, 1.0]) / math.sqrt(1.0 + slope * slope)
    expected = dni * max(0.0, float(np.dot(normal, sun)))
    assert expected > 0
    core = valid.copy()
    core[:2, :] = False
    core[-2:, :] = False
    core[:, :2] = False
    core[:, -2:] = False
    assert np.allclose(result["incident_w_m2"][core], expected, rtol=1e-6)


def test_geometric_night_zeros_incident_with_apparent_sun_above_horizon(monkeypatch):
    provider = _small_dem(monkeypatch, {"n00e000": _zip_hgt("n00e000", np.full((9, 9), 100, dtype=np.int16))})
    original = surface.solar_position_from_prepared

    def refracted_position(*args, **kwargs):
        position = original(*args, **kwargs)
        return {**position, "geometric_elevation_deg": -0.2,
                "apparent_elevation_deg": 0.1, "apparent_zenith_deg": 89.9,
                "night": False}

    monkeypatch.setattr(surface, "solar_position_from_prepared", refracted_position)
    result = surface.compute_incident_irradiance(
        roi=_CONCAVE, datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=provider, intensity_percent=100,
    )
    assert result["valid_mask"].any()
    assert result["position"]["apparent_elevation_deg"] > 0
    assert result["night"] is True
    assert result["clear_sky"]["dni_adjusted_w_m2"] == 0
    assert np.all(result["incident_w_m2"][result["valid_mask"]] == 0)


def test_night_zeros_valid_pixels_and_preserves_negative_elevation(monkeypatch):
    provider = _small_dem(monkeypatch, {"n00e000": _zip_hgt("n00e000", np.full((9, 9), 100, dtype=np.int16))})
    result = surface.compute_incident_irradiance(
        roi=_CONCAVE, datetime_local="2024-06-01T00:00:00", timezone_name="UTC",
        provider=provider, intensity_percent=100,
    )
    valid = result["valid_mask"]
    assert valid.any()
    assert result["night"] is True
    assert result["position"]["apparent_elevation_deg"] <= 0.0
    assert result["clear_sky"]["night"] is True
    assert np.all(result["incident_w_m2"][valid] == 0.0)
    assert np.all(np.isnan(result["incident_w_m2"][~valid]))


def test_provider_acquire_roi_called_exactly_once(monkeypatch):
    from pipeline.solar import surface as surf
    prepared = _prepared_plane((10, 10), slope_north=0.0)
    monkeypatch.setattr(surf, "prepare_dem", lambda _p, _roi: prepared)
    provider = _Provider({"synthetic": b"unused"})
    surface.compute_incident_irradiance(
        roi={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=provider, intensity_percent=50,
    )
    assert provider.calls == 1


def test_spa_python_called_exactly_once_per_simulation(monkeypatch):
    from pipeline.solar import surface as surf, position
    import pvlib
    prepared = _prepared_plane((10, 10), slope_north=0.0)
    monkeypatch.setattr(surf, "prepare_dem", lambda _p, _roi: prepared)
    original_spa = pvlib.solarposition.spa_python
    calls = []

    def counting_spa(*args, **kwargs):
        calls.append(None)
        return original_spa(*args, **kwargs)

    monkeypatch.setattr(position.pvlib.solarposition, "spa_python", counting_spa)
    surface.compute_incident_irradiance(
        roi={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=_Provider({"synthetic": b"unused"}), intensity_percent=50,
    )
    assert len(calls) == 1


def test_linke_lookup_called_exactly_once_per_simulation(monkeypatch):
    from pipeline.solar import surface as surf, clearsky
    import pvlib
    prepared = _prepared_plane((10, 10), slope_north=0.0)
    monkeypatch.setattr(surf, "prepare_dem", lambda _p, _roi: prepared)
    original_lookup = pvlib.clearsky.lookup_linke_turbidity
    calls = []

    def counting_lookup(*args, **kwargs):
        calls.append(None)
        return original_lookup(*args, **kwargs)

    monkeypatch.setattr(clearsky.pvlib.clearsky, "lookup_linke_turbidity", counting_lookup)
    surface.compute_incident_irradiance(
        roi={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
        datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=_Provider({"synthetic": b"unused"}), intensity_percent=50,
    )
    assert len(calls) == 1


@pytest.mark.parametrize("percent", [True, -1, 100.1, float("nan"), 10**1000])
def test_invalid_percent_rejected_before_provider_io(percent):
    with pytest.raises(ValueError, match="intensity_percent"):
        surface.compute_incident_irradiance(
            roi=_CONCAVE, datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
            provider=_NoIOProvider(), intensity_percent=percent,
        )


def test_invalid_time_rejected_before_provider_io():
    with pytest.raises(ValueError, match="datetime_local|calendar"):
        surface.compute_incident_irradiance(
            roi=_CONCAVE, datetime_local="2024-06-01T25:00:00", timezone_name="UTC",
            provider=_NoIOProvider(), intensity_percent=50,
        )


def test_invalid_timezone_rejected_before_provider_io():
    with pytest.raises(ValueError, match="timezone"):
        surface.compute_incident_irradiance(
            roi=_CONCAVE, datetime_local="2024-06-01T12:00:00", timezone_name="Mars/Olympus",
            provider=_NoIOProvider(), intensity_percent=50,
        )


def test_nodata_outside_valid_is_nan_not_zero(monkeypatch):
    provider = _small_dem(monkeypatch, {"n00e000": _zip_hgt("n00e000", np.full((9, 9), 100, dtype=np.int16))})
    result = surface.compute_incident_irradiance(
        roi=_CONCAVE, datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
        provider=provider, intensity_percent=100,
    )
    valid = result["valid_mask"]
    assert valid.any()
    assert (~valid).any()
    assert np.all(np.isnan(result["incident_w_m2"][~valid]))
    assert not np.any(result["incident_w_m2"][~valid] == 0.0)


def test_rejects_non_unit_normals(monkeypatch):
    from pipeline.solar import surface as surf, terrain
    prepared = _prepared_plane((10, 10), slope_north=0.0)
    fields = terrain.compute_prepared_terrain(prepared)
    fields["normal"][fields["valid"]] *= 2.0
    monkeypatch.setattr(surf, "compute_prepared_terrain", lambda _p: fields)
    monkeypatch.setattr(surf, "prepare_dem", lambda _p, _roi: prepared)
    with pytest.raises(ValueError, match="unit"):
        surface.compute_incident_irradiance(
            roi={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
            datetime_local="2024-06-01T12:00:00", timezone_name="UTC",
            provider=_Provider({"synthetic": b"unused"}), intensity_percent=50,
        )
