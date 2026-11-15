"""Vectorized terrain derivatives for north-up metric elevation rasters."""

from __future__ import annotations

import numpy as np


def compute_prepared_terrain(prepared):
    """Compute ROI-only terrain fields using the prepared DEM's one-cell halo.

    Halo samples support centered differences but never appear as valid ROI
    output. The CRS must be projected in meters; no caller-supplied units can
    silently reinterpret geographic degrees as distances.
    """
    if not prepared.crs.is_projected or not prepared.crs.axis_info or not np.isclose(
        prepared.crs.axis_info[0].unit_conversion_factor, 1.0
    ):
        raise ValueError("prepared DEM requires a projected metric CRS in meters")
    fields = compute_terrain(
        prepared.elevation, prepared.transform,
        prepared.valid_mask | prepared.halo_mask, units="m",
    )
    fields["valid"] &= prepared.valid_mask
    invalid = ~fields["valid"]
    for key in ("gradient_east", "gradient_north", "slope", "aspect", "normal"):
        fields[key][invalid] = np.nan
    return fields


def compute_terrain(elevation, transform, valid_mask, *, units: str):
    """Compute terrain fields using centered differences and a one-pixel masked edge.

    ``transform`` is the six-coefficient GDAL affine tuple. ``units`` must
    explicitly identify metric coordinates; rotated/sheared grids are rejected.
    Missing samples are never interpolated. Derivatives require all four
    cardinal neighbors and the center sample to be valid.
    """
    if units not in ("m", "metre", "meter", "metres", "meters"):
        raise ValueError("terrain gradients require metric CRS units (meters)")
    z = np.asarray(elevation, dtype=np.float64)
    mask = np.asarray(valid_mask, dtype=bool)
    if z.ndim != 2 or mask.shape != z.shape:
        raise ValueError("elevation and valid mask must have matching 2D shape")
    try:
        x0, pixel_x, rotation_x, y0, rotation_y, pixel_y = transform
    except (TypeError, ValueError):
        raise ValueError("transform must contain six affine coefficients") from None
    if rotation_x != 0 or rotation_y != 0 or pixel_x <= 0 or pixel_y >= 0:
        raise ValueError("transform must describe a north-up grid")
    if not np.isfinite([x0, pixel_x, rotation_x, y0, rotation_y, pixel_y]).all():
        raise ValueError("affine transform must be finite")

    valid_input = mask & np.isfinite(z)
    valid = np.zeros(z.shape, dtype=bool)
    if z.shape[0] >= 3 and z.shape[1] >= 3:
        valid[1:-1, 1:-1] = (
            valid_input[1:-1, 1:-1]
            & valid_input[1:-1, :-2]
            & valid_input[1:-1, 2:]
            & valid_input[:-2, 1:-1]
            & valid_input[2:, 1:-1]
        )
    east = np.full(z.shape, np.nan)
    north = np.full(z.shape, np.nan)
    slope = np.full(z.shape, np.nan)
    aspect = np.full(z.shape, np.nan)
    normal = np.full((*z.shape, 3), np.nan)
    east[valid] = ((z[1:-1, 2:] - z[1:-1, :-2]) / (2 * pixel_x))[valid[1:-1, 1:-1]]
    north[valid] = ((z[:-2, 1:-1] - z[2:, 1:-1]) / (2 * -pixel_y))[valid[1:-1, 1:-1]]
    magnitude = np.hypot(east[valid], north[valid])
    slope[valid] = np.arctan(magnitude)
    nonflat = valid & (np.hypot(east, north) > 0)
    aspect[nonflat] = np.degrees(np.arctan2(-east[nonflat], -north[nonflat])) % 360
    scale = np.sqrt(east[valid] ** 2 + north[valid] ** 2 + 1)
    normal[valid, 0] = -east[valid] / scale
    normal[valid, 1] = -north[valid] / scale
    normal[valid, 2] = 1 / scale
    return {"gradient_east": east, "gradient_north": north, "slope": slope,
            "aspect": aspect, "normal": normal, "valid": valid}
