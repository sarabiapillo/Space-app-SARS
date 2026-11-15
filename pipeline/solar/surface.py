"""Geospatial direct incident irradiance layer (W/m²) over NASADEM terrain.

Phase C integrates the clear-sky DNI from phase B with terrain normals derived
from NASADEM. It reuses ``simulate_radiation`` for the geometric projection and
produces a single incident-irradiance raster; the absorbed layer and material
balance are out of scope.
"""
from __future__ import annotations

import math
from numbers import Real

import numpy as np

from pipeline.solar.clearsky import compute_clear_sky_dni
from pipeline.solar.dem import prepare_dem
from pipeline.solar.position import acquire_provider_tile_paths, solar_position_from_prepared
from pipeline.solar.radiation import simulate_radiation
from pipeline.solar.terrain import compute_prepared_terrain
from pipeline.solar.time import resolve_solar_inputs

_MODEL_TAG = "direct-geometric-v1"


def _finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number")
    return number


def _validate_percent(value):
    number = _finite_number(value, "intensity_percent")
    if not 0.0 <= number <= 100.0:
        raise ValueError("intensity_percent must be within [0, 100]")
    return number


def _sun_vector(azimuth_deg, elevation_deg):
    """Unit vector toward the Sun in east-north-up axes.

    Azimuth is clockwise from north; elevation is above the horizon.
    """
    azimuth = math.radians(azimuth_deg)
    elevation = math.radians(elevation_deg)
    return np.array([
        math.cos(elevation) * math.sin(azimuth),
        math.cos(elevation) * math.cos(azimuth),
        math.sin(elevation),
    ], dtype=np.float64)


def _validate_prepared_crs(crs):
    crs = getattr(crs, "to_epsg", lambda: None)() or crs
    from pyproj import CRS as _CRS
    crs = _CRS.from_user_input(crs)
    if not crs.is_projected or not crs.axis_info or any(
        not math.isclose(axis.unit_conversion_factor, 1.0, rel_tol=0.0, abs_tol=1e-12)
        for axis in crs.axis_info[:2]
    ):
        raise ValueError("prepared DEM CRS must be projected in meters")
    return crs


def compute_incident_irradiance(
    *, roi, datetime_local, timezone_name, provider, intensity_percent,
    temperature_c=None, pressure_hpa=None,
):
    """Return a geospatial layer of direct incident irradiance (W/m²).

    The function acquires NASADEM tiles once, prepares a metric DEM, selects a
    representative ROI pixel for solar position, estimates clear-sky DNI, and
    projects that DNI onto the terrain normals. At night the incident irradiance
    is zero on valid pixels and NaN outside the valid mask; the real negative
    apparent elevation is preserved in the returned metadata.

    No material absorption, reflection, transmission, shadows or diffuse
    radiation are computed.
    """
    if not isinstance(roi, dict):
        raise ValueError("roi must be a GeoJSON Polygon or MultiPolygon")
    percent = _validate_percent(intensity_percent)
    # Validate time/atmosphere before any provider I/O; the placeholder altitude
    # is discarded because pressure is recomputed from the selected NASADEM pixel.
    resolve_solar_inputs(
        datetime_local, timezone_name, altitude_m=0.0,
        temperature_c=temperature_c, pressure_hpa=pressure_hpa,
    )

    # Single acquisition of NASADEM tiles for this simulation.
    zip_paths = acquire_provider_tile_paths(provider, roi)
    prepared = prepare_dem(zip_paths, roi)
    _validate_prepared_crs(prepared.crs)

    position = solar_position_from_prepared(
        prepared, roi=roi, datetime_local=datetime_local,
        timezone_name=timezone_name, temperature_c=temperature_c,
        pressure_hpa=pressure_hpa,
    )

    # Reuse the phase-A position so SPA and the DEM acquisition are not repeated.
    clear_sky = compute_clear_sky_dni(
        roi=roi, datetime_local=datetime_local, timezone_name=timezone_name,
        provider=provider, intensity_percent=percent,
        temperature_c=temperature_c, pressure_hpa=pressure_hpa,
        position=position,
    )

    fields = compute_prepared_terrain(prepared)
    valid = np.asarray(fields["valid"], dtype=bool)
    normals = np.asarray(fields["normal"], dtype=np.float64)

    # Consistency checks on terrain normals and solar direction.
    if normals.ndim != 3 or normals.shape[-1] != 3 or normals.shape[:2] != valid.shape:
        raise ValueError("prepared terrain normals have an incompatible shape")
    selected_normals = normals[valid]
    if not np.isfinite(selected_normals).all():
        raise ValueError("valid terrain normals must be finite")
    if not np.allclose(np.linalg.norm(selected_normals, axis=-1), 1.0, atol=1e-6, rtol=1e-6):
        raise ValueError("valid terrain normals must be unit vectors")
    if np.any(selected_normals[:, 2] < 0):
        raise ValueError("valid terrain normals must point upward")

    azimuth = _finite_number(position.get("azimuth_deg"), "azimuth_deg")
    apparent_elevation = _finite_number(position.get("apparent_elevation_deg"), "apparent_elevation_deg")
    apparent_zenith = _finite_number(position.get("apparent_zenith_deg"), "apparent_zenith_deg")
    if not 0.0 <= azimuth <= 360.0:
        raise ValueError("solar azimuth must be in [0, 360]")
    if not -90.0 <= apparent_elevation <= 90.0:
        raise ValueError("solar apparent elevation must be in [-90, 90]")
    if not math.isclose(apparent_elevation + apparent_zenith, 90.0, abs_tol=1e-6):
        raise ValueError("solar apparent elevation and zenith are inconsistent")

    sun = _sun_vector(azimuth, apparent_elevation)
    if not np.allclose(np.linalg.norm(sun), 1.0, atol=1e-9, rtol=1e-9):
        raise ValueError("sun vector is not unit length")

    dni_adjusted = _finite_number(clear_sky.get("dni_adjusted_w_m2"), "dni_adjusted_w_m2")
    if dni_adjusted < 0.0:
        raise ValueError("adjusted DNI must be non-negative")

    night = apparent_elevation <= 0.0
    incident = np.full(valid.shape, np.nan, dtype=np.float64)

    if night:
        # simulate_radiation rejects negative elevations, so produce the physical
        # zero directly while keeping the real apparent elevation in metadata.
        incident[valid] = 0.0
    else:
        radiation = simulate_radiation(
            normals=normals,
            valid_mask=valid,
            irradiance_w_m2=dni_adjusted,
            azimuth_deg=azimuth,
            elevation_deg=apparent_elevation,
            albedo=0.0,
        )
        incident = radiation["incident"]
        valid = radiation["valid"]
        if not np.all(np.isfinite(incident[valid])):
            raise ValueError("incident irradiance contains non-finite values on valid pixels")
        if np.any(incident[valid] < 0.0) or np.any(incident[valid] > dni_adjusted):
            raise ValueError("incident irradiance is outside [0, dni_adjusted] on valid pixels")

    return {
        "incident_w_m2": incident,
        "valid_mask": valid.copy(),
        "shape": incident.shape,
        "transform": tuple(prepared.transform),
        "crs": prepared.crs,
        "night": night,
        "model": _MODEL_TAG,
        "units": "W/m2",
        "position": position,
        "clear_sky": clear_sky,
    }
