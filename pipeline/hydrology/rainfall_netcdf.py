"""Export synthetic or observed rainfall profiles to the native DG2 CPU NetCDF forcing layout."""
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


def _validated_dem_grid(dem):
    """Shared DEM grid checks: one band, projected metric CRS, unrotated north-up square cells."""
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
    return crs, transform


def _write_native_netcdf(output_path, hours, ys, xs, cube):
    """Write the native LISFLOOD-FP 8.0 rainfall NetCDF3 layout (shared by both exporters)."""
    height, width = len(ys), len(xs)
    try:
        from scipy.io import netcdf_file
    except ImportError as exc:
        raise RuntimeError("SciPy is required for optional NetCDF rainfall export") from exc
    with netcdf_file(output_path, "w", version=2) as nc:
        # file_tool.cpp pasa IDs de variable a nc_inq_dimlen/nc_get_vara.
        # SciPy ordena variables por _shape (tupla lexicográfica), estable
        # en empates: rain 3D puede aparecer entre los ejes 1D. Declarar
        # dimensiones en el orden físico resultante, con un eje sin uso en
        # la posición de rain, conserva los IDs de time/x/y exactamente.
        specs = [("time", (len(hours),)), ("y", (height,)), ("x", (width,)),
                 ("rainfall_depth", (len(hours), height, width))]
        for name, dimensions in sorted(specs, key=lambda entry: entry[1], reverse=True):
            nc.createDimension("native_header_anchor" if name == "rainfall_depth" else name,
                               1 if name == "rainfall_depth" else dimensions[0])
        time_var = nc.createVariable("time", "d", ("time",))
        y_var = nc.createVariable("y", "d", ("y",))
        x_var = nc.createVariable("x", "d", ("x",))
        rain_var = nc.createVariable("rainfall_depth", "d", ("time", "y", "x"))
        time_var[:] = hours; y_var[:] = ys; x_var[:] = xs; rain_var[:] = cube
        time_var.units = "hours"; x_var.units = "m"; y_var.units = "m"
        rain_var.units = "mm"; rain_var.long_name = "rainfall depth accumulated over each following interval"
        nc.source_format_version = "8.0"


def export_rainfall_netcdf(profile, dem_path, output_path, *, simulation_duration_s, max_values=50_000_000):
    """Write NetCDF3 64-bit-offset rainfall forcing and a JSON provenance manifest.

    Rainfall is uniform over centers within ``profile['roi']`` and zero elsewhere.
    ``simulation_duration_s`` is explicit, covers all rain, and can extend the dry tail.
    This only exports forcing; it does not prepare or run a hydraulic simulation.
    """
    if (not isinstance(profile, dict) or profile.get("hydraulic_ready") is not False
            or not (profile.get("synthetic") is True or (profile.get("synthetic") is False and profile.get("observed") is True))):
        raise ValueError("profile must be a synthetic or observed, non-hydraulic-ready rainfall profile")
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
        crs, transform = _validated_dem_grid(dem)
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
                "synthetic": profile["synthetic"], "observed": profile.get("observed", False), "hydraulic_ready": False}

    _write_native_netcdf(output_path, hours, ys, xs, cube)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return manifest_path


def roi_cell_mask(roi, dem_path):
    """Cells of the DEM grid whose centres fall inside the ROI: the cells ``export_rainfall_netcdf`` rains on.

    Same rule as that exporter (projected ROI, cell centres, ``all_touched=False``), so a per-cell cube multiplied
    by this mask rains on exactly the same cells as the uniform profile.
    """
    roi = validate_roi(roi)
    with rasterio.open(dem_path) as dem:
        crs, transform = _validated_dem_grid(dem)
        projector = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
        selected = geometry_mask([transform_geometry(projector, shape(roi))], out_shape=(dem.height, dem.width),
                                 transform=transform, all_touched=False, invert=True)
    if not selected.any():
        raise ValueError("ROI selects no DEM cell centers")
    return selected


def export_rainfall_cube_netcdf(cube_mm, interval_edges_s, dem_path, output_path, *, simulation_duration_s,
                                method, synthetic, observed=False, max_values=50_000_000):
    """Write a per-cell rain cube (intervals x rows x cols, mm per interval) in the native DG2 layout.

    Used for net rain per cell (e.g. Curve Number losses). ``interval_edges_s`` has intervals + 1 strictly
    increasing values starting at 0; the cube must match the DEM grid. A zero frame closes the rain and, when
    ``simulation_duration_s`` exceeds the last edge, a dry-tail frame is added, as in ``export_rainfall_netcdf``.
    ``method`` (JSON-serialisable dict) records how the cube was produced in the manifest.
    """
    if synthetic is not True and not (synthetic is False and observed is True):
        raise ValueError("cube must be marked synthetic, or observed")
    if not isinstance(method, dict) or not method:
        raise ValueError("method must be a non-empty dict describing the per-cell computation")
    cube = np.asarray(cube_mm, dtype=np.float64)
    if cube.ndim != 3 or cube.shape[0] < 1:
        raise ValueError("cube must have shape (intervals, rows, cols)")
    if not np.all(np.isfinite(cube)) or np.any(cube < 0):
        raise ValueError("cube values must be finite and nonnegative")
    try:
        edges = [float(v) for v in interval_edges_s]
    except (TypeError, ValueError, OverflowError):
        raise ValueError("interval_edges_s must be numbers") from None
    if (len(edges) != cube.shape[0] + 1 or not all(map(math.isfinite, edges)) or edges[0] != 0
            or any(b <= a for a, b in zip(edges, edges[1:]))):
        raise ValueError("interval_edges_s must hold intervals + 1 strictly increasing values starting at 0")
    if isinstance(simulation_duration_s, bool) or not isinstance(simulation_duration_s, (int, float)):
        raise ValueError("simulation_duration_s must be finite and positive")
    simulation_duration_s = float(simulation_duration_s)
    if not math.isfinite(simulation_duration_s) or simulation_duration_s < edges[-1]:
        raise ValueError("simulation_duration_s must cover the complete rainfall cube")
    if isinstance(max_values, bool) or not isinstance(max_values, int) or max_values <= 0:
        raise ValueError("max_values must be a positive integer")
    dem_path, output_path = Path(dem_path), Path(output_path)
    manifest_path = output_path.with_suffix(".json")
    if manifest_path == output_path:
        raise ValueError("output NetCDF path collides with its JSON manifest")
    if output_path.exists() or manifest_path.exists():
        raise FileExistsError("output NetCDF or manifest already exists; refusing overwrite")
    rain_end = edges[-1]
    seconds = edges + ([simulation_duration_s] if simulation_duration_s > rain_end else [])
    frame_count = len(seconds)
    with rasterio.open(dem_path) as dem:
        crs, transform = _validated_dem_grid(dem)
        height, width = dem.height, dem.width
        if frame_count * height * width > max_values:
            raise ValueError(f"rainfall cube exceeds max_values budget ({frame_count * height * width} > {max_values})")
        if cube.shape[1:] != (height, width):
            raise ValueError(f"cube grid {cube.shape[1:]} differs from DEM grid {(height, width)}")
        dem_data = dem.read(1, masked=True)
        valid_dem = ~np.ma.getmaskarray(dem_data) & np.isfinite(np.asarray(dem_data.data))
        if np.any((cube.sum(axis=0) > 0) & ~valid_dem):
            raise ValueError("cube puts rain on DEM nodata cells")
        dem_digest = _sha256(dem_path)
    xs = transform.c + (np.arange(width, dtype=np.float64) + 0.5) * transform.a
    ys = transform.f + (np.arange(height, dtype=np.float64) + 0.5) * transform.e
    hours = np.asarray(seconds, dtype=np.float64) / 3600.0
    if not np.all(np.diff(hours) > 0):
        raise ValueError("time coordinates collapse or are not strictly increasing in native hours")
    frames = np.zeros((frame_count, height, width), dtype=np.float64)
    frames[:cube.shape[0]] = cube
    manifest = {"format": "NetCDF3 64-bit offset", "native_source_version": "8.0",
                "variables": {"rainfall_depth": "accumulated mm per interval", "time": "hours", "x": "m cell centers",
                              "y": "m cell centers"},
                "spatial_policy": "per-cell rain cube (mm per interval), e.g. net rain after losses",
                "method": method, "interval_edges_s": edges, "rain_end_s": rain_end,
                "simulation_duration_s": simulation_duration_s,
                "cube_sha256": hashlib.sha256(np.ascontiguousarray(cube, dtype="<f8").tobytes()).hexdigest(),
                "interval_mean_mm": cube.mean(axis=(1, 2)).tolist(), "interval_max_mm": cube.max(axis=(1, 2)).tolist(),
                "total_mean_mm": float(cube.sum(axis=0).mean()),
                "dem": {"path": dem_path.name, "sha256": dem_digest, "crs": crs.to_string(),
                        "transform": list(transform)[:6], "width": width, "height": height,
                        "mask_policy": "cells with rain require finite DEM elevation"},
                "synthetic": synthetic, "observed": bool(observed), "hydraulic_ready": False}
    _write_native_netcdf(output_path, hours, ys, xs, frames)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return manifest_path
