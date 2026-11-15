"""Atomic, incident-only offline delivery of a phase-C solar surface result."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import tempfile

import matplotlib
from matplotlib import colormaps
import numpy as np
from PIL import Image
from pyproj import CRS
import rasterio
from rasterio.transform import Affine, array_bounds
from rasterio.warp import calculate_default_transform, reproject, Resampling

from pipeline.solar.export import _write_layer

_MAX_SOURCE_PIXELS = 10_000_000
_MAX_PREVIEW_PIXELS = 1_000_000


def _metadata(value):
    """Serialize scientific metadata without private filesystem paths or nonfinite JSON."""
    if isinstance(value, dict):
        return {str(key): _metadata(item) for key, item in value.items()
                if not any(word in str(key).lower() for word in ("path", "filename", "directory"))}
    if isinstance(value, (tuple, list)):
        return [_metadata(item) for item in value]
    if isinstance(value, Path):
        return None
    if isinstance(value, (np.integer, np.floating, np.bool_)):
        value = value.item()
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("metadata contains a non-finite number")
        return value
    if isinstance(value, str):
        if value.startswith(("/", "file://")) or "\\" in value:
            raise ValueError("metadata contains an internal path")
        return value
    if value is None or isinstance(value, (int, bool)):
        return value
    raise ValueError("unsupported simulation metadata type")


def _validate(result, limit):
    if not isinstance(result, dict) or not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= _MAX_PREVIEW_PIXELS:
        raise ValueError("invalid surface result or preview pixel budget")
    try:
        valid = np.asarray(result["valid_mask"])
        values = np.asarray(result["incident_w_m2"])
        transform = tuple(result["transform"])
        crs = CRS.from_user_input(result["crs"])
        position = _metadata(result["position"])
        clear_sky = _metadata(result["clear_sky"])
    except (KeyError, TypeError, OverflowError) as exc:
        raise ValueError("incomplete incident surface result") from exc
    if valid.ndim != 2 or valid.dtype != np.dtype("bool") or values.shape != valid.shape or not valid.any():
        raise ValueError("incident and boolean nonempty mask shapes must match")
    if valid.size > _MAX_SOURCE_PIXELS or not np.issubdtype(values.dtype, np.number) or np.iscomplexobj(values):
        raise ValueError("incident input exceeds budget or is not real numeric")
    values = values.astype("float64")
    upper = clear_sky.get("dni_adjusted_w_m2") if isinstance(clear_sky, dict) else None
    if (isinstance(upper, bool) or not isinstance(upper, (int, float))
            or not math.isfinite(upper) or upper < 0 or upper > np.finfo("float32").max):
        raise ValueError("adjusted DNI must be finite and representable")
    if (not np.isfinite(values[valid]).all() or not np.isnan(values[~valid]).all()
            or np.any(values[valid] < 0) or np.any(values[valid] > upper)
            or np.any(values[valid] > np.finfo("float32").max)):
        raise ValueError("incident values violate mask or DNI bounds")
    if (len(transform) != 6 or not np.isfinite(transform).all() or transform[1] <= 0
            or transform[5] >= 0 or transform[2] != 0 or transform[4] != 0):
        raise ValueError("incident affine must be finite metric north-up")
    if not crs.is_projected or not crs.axis_info or any(
        not math.isclose(axis.unit_conversion_factor, 1.0, abs_tol=1e-12)
        for axis in crs.axis_info[:2]
    ):
        raise ValueError("incident CRS must be metric projected")
    if result.get("model") != "direct-geometric-v1" or result.get("units") != "W/m2":
        raise ValueError("unexpected incident model or units")
    return valid, values, transform, crs, float(upper), position, clear_sky


def _preview(values, valid, transform, crs, upper, limit):
    height, width = valid.shape
    source = Affine.from_gdal(*transform)
    west, south, east, north = array_bounds(height, width, source)
    target, dest_width, dest_height = calculate_default_transform(
        crs, "EPSG:4326", width, height, west, south, east, north
    )
    if dest_width < 1 or dest_height < 1 or not all(math.isfinite(x) for x in target[:6]):
        raise ValueError("invalid geographic preview grid")
    if dest_width * dest_height > limit:
        scale = math.sqrt(limit / (dest_width * dest_height))
        # Floor both dimensions, preserving the complete geographic extent.
        new_width = max(1, math.floor(dest_width * scale))
        new_height = max(1, math.floor(dest_height * scale))
        target = target * Affine.scale(dest_width / new_width, dest_height / new_height)
        dest_width, dest_height = new_width, new_height
    projected = np.zeros((dest_height, dest_width), dtype="float32")
    mask = np.zeros((dest_height, dest_width), dtype="uint8")
    options = dict(src_transform=source, src_crs=crs, dst_transform=target,
                   dst_crs="EPSG:4326", resampling=Resampling.nearest)
    reproject(source=np.where(valid, values, 0).astype("float32"), destination=projected, **options)
    reproject(source=valid.astype("uint8"), destination=mask, **options)
    # Matplotlib's standard 256-entry Inferno LUT (not a perceptual approximation).
    # Normalize to [0,1], LUT quantization via matplotlib, then round channels to uint8.
    normalized = np.clip(projected / upper, 0, 1) if upper else np.zeros_like(projected)
    rgba = np.rint(colormaps["inferno"](normalized) * 255).astype("uint8")
    rgba[mask == 0] = 0
    bounds = array_bounds(dest_height, dest_width, target)
    if not all(math.isfinite(x) for x in bounds):
        raise ValueError("invalid preview bounds")
    return rgba, target, bounds


def _save_preview(path, rgba):
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG")
    with Image.open(path) as image:
        image.load()
        if image.mode != "RGBA" or image.size != (rgba.shape[1], rgba.shape[0]):
            raise ValueError("PNG readback failed")


def _write_manifest(path, manifest):
    path.write_text(json.dumps(manifest, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    if json.loads(path.read_text(encoding="utf-8")) != manifest:
        raise ValueError("manifest readback failed")


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_incident(surface_result, output_dir, *, code_version="uncommitted", max_preview_pixels=1_000_000):
    """Publish exactly three files to a new run directory; never replace an existing run.

    ``code_version`` defaults to 'uncommitted' rather than claiming a Git revision.
    The caller may provide its actual version. Parent directory must exist.
    """
    valid, values, transform, crs, upper, position, clear_sky = _validate(surface_result, max_preview_pixels)
    if not isinstance(code_version, str) or not code_version.strip():
        raise ValueError("code_version must be nonempty")
    code_version = _metadata(code_version)
    dest = Path(output_dir)
    if (not dest.name or not dest.parent.is_dir() or
            any(part.is_symlink() for part in (dest.parent, *dest.parent.parents))):
        raise ValueError("output parent must be an existing real directory")
    if dest.exists() or dest.is_symlink():
        raise FileExistsError("refusing to replace solar run")
    # Exclusive lock blocks other cooperating writers; staging is private in the same parent.
    lock = dest.with_name(dest.name + ".lock")
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    staging = None
    try:
        if dest.exists() or dest.is_symlink():
            raise FileExistsError("solar run appeared during export")
        staging = Path(tempfile.mkdtemp(prefix=".solar-incident-", dir=dest.parent))
        tif = staging / "incident.tif"
        _write_layer(tif, "incident", values, valid, transform, rasterio.crs.CRS.from_user_input(crs))
        rgba, preview_transform, bounds = _preview(values, valid, transform, crs, upper, max_preview_pixels)
        png = staging / "preview.png"
        _save_preview(png, rgba)
        height, width = valid.shape
        manifest = {
            "model": "direct-geometric-v1", "units": "W/m2", "code_version": code_version,
            "position": position, "clear_sky": clear_sky, "night": bool(surface_result.get("night")),
            "raster": {"crs": crs.to_string(), "transform_gdal": list(transform),
                       "width": width, "height": height, "bounds_native": list(array_bounds(height, width, Affine.from_gdal(*transform))),
                       "resolution_m": [transform[1], -transform[5]], "units": "W/m2",
                       "valid_pixels": int(valid.sum())},
            "preview": {"crs": "EPSG:4326", "transform_gdal": list(preview_transform.to_gdal()),
                        "bounds_lonlat": list(bounds), "width": rgba.shape[1], "height": rgba.shape[0],
                        "palette": "inferno", "palette_source": {
                            "library": "matplotlib", "matplotlib_version": matplotlib.__version__,
                            "license": "Matplotlib License (BSD-compatible); bundled standard Inferno LUT"},
                        "range_w_m2": [0., upper], "zero_range": upper == 0,
                        "quantization": "normalize [0,DNI_adjusted] to [0,1] (zero range -> 0); matplotlib 256-entry Inferno LUT; round RGBA*255 to uint8; invalid alpha=0; nearest-neighbor geographic reprojection"},
            "files": {"incident.tif": _sha256(tif), "preview.png": _sha256(png)},
            "limitations": "Modeled direct incident irradiance, not measured; no terrain shadows, diffuse radiation or material absorption; HGT tile IDs do not certify source hashes",
        }
        _write_manifest(staging / "run.json", manifest)
        if dest.exists() or dest.is_symlink():
            raise FileExistsError("solar run appeared during export")
        os.rename(staging, dest)
        staging = None
        return manifest
    finally:
        if staging is not None:
            shutil.rmtree(staging)
        lock.unlink()
