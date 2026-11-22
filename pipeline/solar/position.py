"""Solar position from SPA at a NASADEM-supported representative ROI pixel.

The point approximation is spatially uniform within the ROI and is not a
pixelwise or calibrated atmospheric/solar solution.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pvlib
from pyproj import CRS, Transformer
from rasterio.transform import Affine
from shapely.geometry import Point, shape
from shapely.ops import transform as transform_geometry

from pipeline.solar import dem
from pipeline.solar.time import resolve_solar_inputs

_POINT_METHOD = (
    "nearest valid prepared pixel center to projected shapely representative_point; row/col tie-break"
)
_SPA_METHOD = "NREL SPA (pvlib.solarposition.spa_python)"


def _spa_position(datetime_utc, *, longitude_deg, latitude_deg, altitude_m,
                  pressure_pa, temperature_c):
    """Evaluate the pinned pvlib SPA implementation for a timezone-aware instant."""
    timestamp = pd.Timestamp(datetime_utc)
    if timestamp.tzinfo is None:
        raise ValueError("SPA datetime must be timezone-aware UTC")
    timestamp = timestamp.tz_convert("UTC")
    times = pd.DatetimeIndex([timestamp])
    result = pvlib.solarposition.spa_python(
        times,
        latitude=float(latitude_deg),
        longitude=float(longitude_deg),
        altitude=float(altitude_m),
        pressure=float(pressure_pa),
        temperature=float(temperature_c),
        delta_t=None,
    ).iloc[0]
    values = {
        "azimuth": float(result["azimuth"]),
        "geometric_elevation": float(result["elevation"]),
        "apparent_elevation": float(result["apparent_elevation"]),
        "apparent_zenith": float(result["apparent_zenith"]),
        "geometric_zenith": float(result["zenith"]),
    }
    if not all(math.isfinite(value) for value in values.values()):
        raise ValueError("SPA returned non-finite solar position")
    if not math.isclose(values["apparent_elevation"] + values["apparent_zenith"], 90.0, abs_tol=1e-7):
        raise ValueError("SPA apparent elevation and zenith are inconsistent")
    if not 0 <= values["azimuth"] <= 360 or not 0 <= values["apparent_zenith"] <= 180:
        raise ValueError("SPA returned solar angles outside physical ranges")
    return values


def _validate_metric_crs(crs):
    crs = CRS.from_user_input(crs)
    if not crs.is_projected or not crs.axis_info or any(
        not math.isclose(axis.unit_conversion_factor, 1.0, rel_tol=0.0, abs_tol=1e-12)
        for axis in crs.axis_info[:2]
    ):
        raise ValueError("prepared DEM CRS must be projected in meters")
    return crs


def _representative_pixel(prepared, roi):
    crs = _validate_metric_crs(prepared.crs)
    roi_geom = shape(roi)
    to_metric = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    to_lonlat = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
    projected_roi = transform_geometry(to_metric, roi_geom)
    representative = projected_roi.representative_point()
    affine = Affine.from_gdal(*prepared.transform)
    mask = np.asarray(prepared.valid_mask, dtype=bool)
    elevation = np.asarray(prepared.elevation)
    if mask.shape != elevation.shape or mask.ndim != 2:
        raise ValueError("prepared DEM elevation and valid mask have incompatible shapes")

    candidates = []
    # prepare_dem rejects HGT samples outside the documented valid range
    # [-32767, 32767] before interpolation; this remains a defensive check.
    usable = mask & np.isfinite(elevation) & (elevation != -32768)
    for row, col in zip(*np.nonzero(usable)):
        x, y = affine * (int(col) + 0.5, int(row) + 0.5)
        center = Point(x, y)
        if projected_roi.contains(center):
            distance_squared = (x - representative.x) ** 2 + (y - representative.y) ** 2
            candidates.append((distance_squared, int(row), int(col), x, y))
    if not candidates:
        raise ValueError("ROI has no valid DEM pixel center in its interior")
    _, row, col, x, y = min(candidates, key=lambda candidate: candidate[:3])
    longitude, latitude = to_lonlat(x, y)
    altitude = float(elevation[row, col])
    if not all(math.isfinite(value) for value in (longitude, latitude, altitude)):
        raise ValueError("selected NASADEM pixel has non-finite coordinates or elevation")
    return row, col, longitude, latitude, altitude


def acquire_provider_tile_paths(provider, roi):
    """Call ``provider.acquire_roi`` once and map granules to ``{tile_id: path}``.

    ``roi`` is the GeoJSON geometry passed to the provider; this helper only
    validates the returned granule contract (string tile_id, usable path, no
    duplicates). It exists so callers that already acquired the DEM can reuse
    the same mapping without copying the validation logic.
    """
    if provider is None or not callable(getattr(provider, "acquire_roi", None)):
        raise ValueError("provider must implement acquire_roi(roi)")
    granules = provider.acquire_roi(roi)
    try:
        granules = tuple(granules)
    except TypeError as exc:
        raise ValueError("provider acquire_roi must return granules") from exc
    if not granules:
        raise ValueError("provider returned no NASADEM granules")
    zip_paths = {}
    for granule in granules:
        tile_id = getattr(granule, "tile_id", None)
        path = getattr(granule, "path", None)
        if not isinstance(tile_id, str) or path is None or tile_id in zip_paths:
            raise ValueError("provider returned invalid or duplicate NASADEM granule")
        zip_paths[tile_id] = path
    return zip_paths


def idealized_position_from_prepared(prepared, *, roi, elevation_deg=45.0,
                                     azimuth_deg=180.0, pressure_hpa=None):
    """Build date-free geometry and representative-point atmospheric provenance."""
    if not isinstance(roi, dict):
        raise ValueError("roi must be a GeoJSON Polygon or MultiPolygon")
    elevation = float(elevation_deg)
    azimuth = float(azimuth_deg)
    if not math.isfinite(elevation) or not 0 <= elevation <= 90:
        raise ValueError("elevation_deg must be within [0, 90]")
    if not math.isfinite(azimuth) or not 0 <= azimuth <= 360:
        raise ValueError("azimuth_deg must be within [0, 360]")
    row, col, longitude, latitude, altitude = _representative_pixel(prepared, roi)
    if pressure_hpa is None:
        pressure = 1013.25 * max(1.0 - 2.25577e-5 * altitude, 1e-6) ** 5.25588
        provenance = ("dry standard atmosphere: p=1013.25*(max(1-2.25577e-5*h,1e-6)^5.25588) hPa; "
                      "h is NASADEM EGM96 orthometric elevation in meters")
    else:
        pressure = float(pressure_hpa)
        if not math.isfinite(pressure) or pressure <= 0:
            raise ValueError("pressure_hpa must be finite and positive")
        provenance = "caller-supplied reference pressure"
    return {
        "azimuth_deg": azimuth, "elevation_deg": elevation,
        "geometric_elevation_deg": elevation, "geometric_zenith_deg": 90.0-elevation,
        "night": elevation == 0.0, "point_method": _POINT_METHOD,
        "row": row, "col": col,
        "representative_point_lonlat": [float(longitude), float(latitude)],
        "altitude_m": altitude, "altitude_datum": "EGM96",
        "altitude_interpretation": "NASADEM HGT orthometric elevation in meters; no ellipsoidal conversion applied",
        "dem_tile_ids": list(prepared.provenance), "pressure_hpa": pressure,
        "pressure_pa": pressure*100.0, "pressure_provenance": provenance,
        "geometry_model": "user-configured idealized solar geometry; no date or time",
    }


def solar_position_from_prepared(
    prepared, *, roi, datetime_local, timezone_name, temperature_c=None,
    pressure_hpa=None,
):
    """Calculate NREL SPA apparent solar position from an already-prepared DEM.

    The DEM must be a ``PreparedDEM`` (metric CRS, elevation, masks, transform,
    provenance). The representative pixel is selected inside the ROI using the
    same criterion as ``compute_solar_position``. This function performs no I/O.
    """
    if not isinstance(roi, dict):
        raise ValueError("roi must be a GeoJSON Polygon or MultiPolygon")
    row, col, longitude, latitude, altitude = _representative_pixel(prepared, roi)
    inputs = resolve_solar_inputs(
        datetime_local, timezone_name, altitude_m=altitude,
        temperature_c=temperature_c, pressure_hpa=pressure_hpa,
    )
    position = _spa_position(
        inputs["datetime_utc"], longitude_deg=longitude, latitude_deg=latitude,
        altitude_m=altitude, pressure_pa=inputs["pressure_hpa"] * 100.0,
        temperature_c=inputs["temperature_c"],
    )
    return {
        **position,
        "azimuth_deg": position["azimuth"],
        "geometric_elevation_deg": position["geometric_elevation"],
        "apparent_elevation_deg": position["apparent_elevation"],
        "apparent_zenith_deg": position["apparent_zenith"],
        "geometric_zenith_deg": position["geometric_zenith"],
        "night": position["geometric_elevation"] <= 0.0,
        "point_method": _POINT_METHOD,
        "row": row,
        "col": col,
        "representative_point_lonlat": [float(longitude), float(latitude)],
        "altitude_m": altitude,
        "altitude_datum": "EGM96",
        "altitude_interpretation": "NASADEM HGT orthometric elevation in meters; no ellipsoidal conversion applied",
        "dem_tile_ids": list(prepared.provenance),
        "datetime_local": inputs["datetime_local"],
        "timezone": inputs["timezone"],
        "utc_offset": inputs["utc_offset"],
        "datetime_utc": inputs["datetime_utc"],
        "pressure_hpa": inputs["pressure_hpa"],
        "pressure_pa": inputs["pressure_hpa"] * 100.0,
        "pressure_provenance": (
            "calculated: dry standard atmosphere from selected NASADEM EGM96 elevation"
            if pressure_hpa is None else inputs["pressure_provenance"]
        ),
        "temperature_c": inputs["temperature_c"],
        "temperature_provenance": inputs["temperature_provenance"],
        "pvlib_version": pvlib.__version__,
        "spa_method": _SPA_METHOD,
        "spa_delta_t": "pvlib SPA delta_t=None (calculated from year/month)",
    }


def compute_solar_position(
    *, roi, datetime_local, timezone_name, provider, temperature_c=None,
    pressure_hpa=None,
):
    """Acquire/prepare ROI DEM and calculate NREL SPA apparent solar position.

    ``provider`` must implement the existing ``acquire_roi(roi)`` contract.
    The method records NASADEM HGT elevations in meters, referenced to EGM96;
    no ellipsoidal-height conversion is performed. Pressure input is hPa and
    is converted to Pa for pvlib. No user-provided solar angles are accepted.
    """
    if not isinstance(roi, dict):
        raise ValueError("roi must be a GeoJSON Polygon or MultiPolygon")
    # Validate caller-controlled time/atmosphere before any acquisition. The
    # placeholder altitude is discarded; automatic pressure is recomputed from
    # the selected NASADEM pixel below.
    resolve_solar_inputs(
        datetime_local, timezone_name, altitude_m=0.0,
        temperature_c=temperature_c, pressure_hpa=pressure_hpa,
    )
    zip_paths = acquire_provider_tile_paths(provider, roi)
    prepared = dem.prepare_dem(zip_paths, roi)
    return solar_position_from_prepared(
        prepared, roi=roi, datetime_local=datetime_local,
        timezone_name=timezone_name, temperature_c=temperature_c,
        pressure_hpa=pressure_hpa,
    )
