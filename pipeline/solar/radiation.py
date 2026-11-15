"""Direct geometric solar irradiance, independent of data acquisition."""

from __future__ import annotations

import math

import numpy as np


def _finite_parameter(value, name, lower, upper=None):
    if isinstance(value, (bool, np.bool_)):
        raise ValueError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(number) or number < lower or (upper is not None and number > upper):
        raise ValueError(f"{name} must be finite and within its physical range")
    return number


def simulate_radiation(normals, valid_mask, irradiance_w_m2, azimuth_deg, elevation_deg, albedo):
    """Return direct incident/absorbed W/m² for valid terrain normals only.

    Azimuth is clockwise from north; elevation is above the horizon. This
    geometric model has no atmosphere, terrain shadows or diffuse radiation.
    Invalid cells remain NaN, distinct from physical zero irradiance.
    """
    source = _finite_parameter(irradiance_w_m2, "irradiance_w_m2", 0)
    azimuth = math.radians(_finite_parameter(azimuth_deg, "azimuth_deg", 0, 360))
    elevation = math.radians(_finite_parameter(elevation_deg, "elevation_deg", 0, 90))
    reflectance = _finite_parameter(albedo, "albedo", 0, 1)

    n = np.asarray(normals, dtype=np.float64)
    valid = np.asarray(valid_mask, dtype=bool)
    if n.ndim != 3 or n.shape[-1] != 3 or n.shape[:2] != valid.shape:
        raise ValueError("normal and valid mask shape must match a 2D terrain raster")
    selected = n[valid]
    if not np.isfinite(selected).all() or not np.allclose(
        np.linalg.norm(selected, axis=-1), 1.0, atol=1e-6, rtol=1e-6
    ):
        raise ValueError("valid normal vectors must be finite and unit length")

    sun = np.array([math.cos(elevation) * math.sin(azimuth),
                    math.cos(elevation) * math.cos(azimuth), math.sin(elevation)])
    incident = np.full(valid.shape, np.nan, dtype=np.float64)
    absorbed = np.full(valid.shape, np.nan, dtype=np.float64)
    incident[valid] = source * np.clip(selected @ sun, 0, 1)
    absorbed[valid] = (1 - reflectance) * incident[valid]
    return {"incident": incident, "absorbed": absorbed, "valid": valid.copy()}
