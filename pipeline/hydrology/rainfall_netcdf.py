"""Export synthetic rainfall profiles to the native DG2 CPU NetCDF forcing layout."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.features import geometry_mask
from shapely.geometry import shape
from shapely.ops import transform as transform_geometry

from pipeline.hydrology.inputs import validate_roi


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_rainfall_netcdf(profile, dem_path, output_path, *, simulation_duration_s, max_values=50_000_000):
    """Write NetCDF3 64-bit-offset rainfall forcing and a JSON provenance manifest.

    Rainfall is uniform over centers within ``profile['roi']`` and zero elsewhere.
    ``simulation_duration_s`` is explicit, covers all rain, and can extend the dry tail.
    This only exports forcing; it does not prepare or run a hydraulic simulation.
    """
    if not isinstance(profile, dict) or profile.get("synthetic") is not True or profile.get("hydraulic_ready") is not False:
        raise ValueError("profile must be a synthetic, non-hydraulic-ready rainfall profile")
    roi = validate_roi(profile.get("roi"))
    if isinstance(simulation_duration_s, bool) or not isinstance(simulation_duration_s, (int, float)):
        raise ValueError("simulation_duration_s must be finite and positive")
    try:
        simulation_duration_s = float(simulation_duration_s)
    except (OverflowError, ValueError):
        raise ValueError("simulation_duration_s must be finite and positive") from None
    if not math.isfinite(simulation_duration_s) or simulation_duration_s <= 0:
        raise ValueError("simulation_duration_s must be finite and positive")
    if isinstance(max_values, bool) or not isinstance(max_values, int) or max_values <= 0:
        raise ValueError("max_values must be a positive integer")
    segments = profile.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError("profile must contain non-empty segments")
    parsed = []
    for segment in segments:
        if not isinstance(segment, dict):
            raise ValueError("invalid rainfall segment")
        try:
            start, end, rate = (float(segment[key]) for key in ("start_s", "end_s", "intensity_m_s"))
        except (KeyError, TypeError, ValueError, OverflowError):
            raise ValueError("invalid rainfall segment") from None
        if not all(map(math.isfinite, (start, end, rate))) or start < 0 or end <= start or rate < 0:
            raise ValueError("rainfall segment values must be finite, ordered, and nonnegative")
        parsed.append((start, end, rate))
    for previous, current in zip(parsed, parsed[1:]):
        if previous[1] != current[0]:
            raise ValueError("rainfall segments must be exactly contiguous")
    if parsed[0][0] != 0:
        raise ValueError("rainfall profile must start at exactly zero")
    rain_end = parsed[-1][1]
    if simulation_duration_s < rain_end:
        raise ValueError("simulation_duration_s must cover the complete rainfall profile")
    rainfall = profile.get("rainfall")
    try:
        expected_amount_m = float(rainfall["amount_m"])
    except (TypeError, KeyError, ValueError, OverflowError):
        raise ValueError("profile rainfall amount_m is required") from None
    try:
        declared_duration = float(rainfall["duration_s"])
    except (TypeError, KeyError, ValueError, OverflowError):
        raise ValueError("profile rainfall duration_s is required") from None
    if not math.isfinite(declared_duration) or declared_duration != rain_end:
        raise ValueError("profile rainfall duration_s must equal the final segment end")
    integrated = math.fsum(rate * (end - start) for start, end, rate in parsed)
    if not math.isfinite(expected_amount_m) or expected_amount_m < 0 or not math.isclose(integrated, expected_amount_m, rel_tol=1e-10, abs_tol=1e-15):
        raise ValueError("profile rainfall integral does not match declared amount")

    dem_path, output_path = Path(dem_path), Path(output_path)
    manifest_path = output_path.with_suffix(".json")
    if manifest_path == output_path:
        raise ValueError("output NetCDF path collides with its JSON manifest")
    if output_path.exists() or manifest_path.exists():
        raise FileExistsError("output NetCDF or manifest already exists; refusing overwrite")
    with rasterio.open(dem_path) as dem:
        if dem.count != 1 or dem.width < 2 or dem.height < 2:
            raise ValueError("DEM must be a single-band grid at least 2 by 2")
        crs = CRS.from_user_input(dem.crs)
        if not crs.is_projected or not crs.axis_info or any(axis.unit_name.lower() not in {"metre", "meter"} or axis.unit_conversion_factor != 1 for axis in crs.axis_info[:2]):
            raise ValueError("DEM CRS must be projected in metres")
        transform = dem.transform
        if (not all(math.isfinite(v) for v in transform[:6]) or transform.a <= 0 or transform.e >= 0
                or not math.isclose(transform.b, 0, abs_tol=1e-12) or not math.isclose(transform.d, 0, abs_tol=1e-12)
                or not math.isclose(transform.a, -transform.e, rel_tol=1e-10, abs_tol=1e-10)):
            raise ValueError("DEM must be an unrotated north-up square-cell grid")
        height, width = dem.height, dem.width
        frame_count = len(parsed) + 1 + (1 if simulation_duration_s > rain_end else 0)
        value_count = frame_count * height * width
        if value_count > max_values:
            raise ValueError(f"rainfall cube exceeds max_values budget ({value_count} > {max_values})")
        xs = transform.c + (np.arange(width, dtype=np.float64) + 0.5) * transform.a
        ys = transform.f + (np.arange(height, dtype=np.float64) + 0.5) * transform.e
        projector = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
        roi_projected = transform_geometry(projector, shape(roi))
        left, bottom, right, top = dem.bounds
        tolerance = max(transform.a, -transform.e) * 1e-9
        roi_left, roi_bottom, roi_right, roi_top = roi_projected.bounds
        if (roi_left < left - tolerance or roi_bottom < bottom - tolerance
                or roi_right > right + tolerance or roi_top > top + tolerance):
            raise ValueError("DEM grid must cover the complete projected ROI")
        selected = geometry_mask([roi_projected], out_shape=(height, width), transform=transform, all_touched=False, invert=True)
        if not selected.any():
            raise ValueError("ROI selects no DEM cell centers")
        dem_data = dem.read(1, masked=True)
        valid_dem = ~np.ma.getmaskarray(dem_data) & np.isfinite(np.asarray(dem_data.data))
        if np.any(selected & ~valid_dem):
            raise ValueError("DEM has nodata or unknown elevation at selected ROI centers")
        if not np.all(np.isfinite(xs)) or not np.all(np.isfinite(ys)) or np.any(np.diff(xs) <= 0) or np.any(np.diff(ys) >= 0):
            raise ValueError("DEM center coordinates must be finite, x-increasing, and y-decreasing")
        dem_crs = crs.to_string()
        dem_transform = list(transform)[:6]
        dem_digest = _sha256(dem_path)
    seconds = [item[0] for item in parsed] + [rain_end]
    if simulation_duration_s > rain_end:
        seconds.append(float(simulation_duration_s))
    hours = np.asarray(seconds, dtype=np.float64) / 3600.0
    if len(hours) < 2 or not np.all(np.isfinite(hours)) or np.any(np.diff(hours) <= 0):
        raise ValueError("time coordinates collapse or are not strictly increasing in native hours")
    if len(hours) != frame_count:
        raise ValueError("native time coordinate frame count does not match preflight")
    cube = np.zeros((len(hours), height, width), dtype=np.float64)
    for index, (start, end, rate) in enumerate(parsed):
        depth_mm = rate * (end - start) * 1000.0
        if not math.isfinite(depth_mm):
            raise ValueError("interval rainfall depth is not finite")
        cube[index, selected] = depth_mm
    profile_digest = hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    manifest = {"format": "NetCDF3 64-bit offset", "native_source_version": "8.0",
                "variables": {"rainfall_depth": "accumulated mm per interval", "time": "hours", "x": "m cell centers", "y": "m cell centers"},
                "roi": roi, "spatial_policy": "uniform over selected ROI cell centers; zero outside ROI",
                "rain_end_s": rain_end, "simulation_duration_s": float(simulation_duration_s),
                "profile_sha256": profile_digest, "profile": profile,
                "dem": {"path": dem_path.name, "sha256": dem_digest, "crs": dem_crs, "transform": dem_transform,
                        "width": width, "height": height, "mask_policy": "selected centers require finite DEM elevation"},
                "synthetic": True, "hydraulic_ready": False}

    try:
        from scipy.io import netcdf_file
    except ImportError as exc:
        raise RuntimeError("SciPy is required for optional NetCDF rainfall export") from exc
    with netcdf_file(output_path, "w", version=2) as nc:
        nc.createDimension("time", len(hours)); nc.createDimension("y", height); nc.createDimension("x", width)
        time_var = nc.createVariable("time", "d", ("time",)); y_var = nc.createVariable("y", "d", ("y",)); x_var = nc.createVariable("x", "d", ("x",))
        rain_var = nc.createVariable("rainfall_depth", "d", ("time", "y", "x"))
        time_var[:] = hours; y_var[:] = ys; x_var[:] = xs; rain_var[:] = cube
        time_var.units = "hours"; x_var.units = "m"; y_var.units = "m"
        rain_var.units = "mm"; rain_var.long_name = "rainfall depth accumulated over each following interval"
        nc.source_format_version = "8.0"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return manifest_path
