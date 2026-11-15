"""Offline GeoTIFF export of modeled direct solar irradiance."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile

import numpy as np
import rasterio
from rasterio.transform import Affine

_PARAMETERS = {"irradiance_w_m2": (0, None), "azimuth_deg": (0, 360),
               "elevation_deg": (0, 90), "albedo": (0, 1)}
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _validated_inputs(result, prepared_dem, parameters, source_hgt_sha256, code_version):
    if not isinstance(parameters, dict) or set(parameters) != set(_PARAMETERS):
        raise ValueError("solar parameters are incomplete")
    values = {}
    for name, (minimum, maximum) in _PARAMETERS.items():
        original = parameters[name]
        if isinstance(original, (bool, np.bool_)):
            raise ValueError("solar parameter must be a finite number")
        try:
            value = float(original)
        except (ValueError, TypeError, OverflowError) as exc:
            raise ValueError("solar parameter must be a finite number") from exc
        if not math.isfinite(value) or value < minimum or (maximum is not None and value > maximum):
            raise ValueError("solar parameter outside physical range")
        values[name] = value
    if not isinstance(code_version, str) or not code_version.strip():
        raise ValueError("a nonempty code version is required")
    provenance = tuple(prepared_dem.provenance)
    if not provenance or not isinstance(source_hgt_sha256, dict) or set(source_hgt_sha256) != set(provenance):
        raise ValueError("source HGT hashes must match DEM provenance")
    if any(not isinstance(digest, str) or not _SHA256.fullmatch(digest) for digest in source_hgt_sha256.values()):
        raise ValueError("source HGT hashes must be lowercase SHA-256")

    if not isinstance(result, dict) or set(result) != {"incident", "absorbed", "valid"}:
        raise ValueError("both irradiance layers and their mask are required")
    valid = np.asarray(result["valid"])
    dem_mask = np.asarray(prepared_dem.valid_mask)
    if valid.ndim != 2 or valid.dtype != np.dtype("bool") or dem_mask.shape != valid.shape or not np.all(valid <= dem_mask):
        raise ValueError("irradiance mask must be within the DEM ROI")
    incident, absorbed = (np.asarray(result[name], dtype=np.float64) for name in ("incident", "absorbed"))
    if incident.shape != valid.shape or absorbed.shape != valid.shape or not valid.any():
        raise ValueError("irradiance rasters must match a nonempty ROI mask")
    if not np.isfinite(incident[valid]).all() or not np.isfinite(absorbed[valid]).all():
        raise ValueError("valid irradiance must be finite")
    if not np.isnan(incident[~valid]).all() or not np.isnan(absorbed[~valid]).all():
        raise ValueError("invalid irradiance cells must be NoData")
    if (np.any(incident[valid] < 0) or np.any(incident[valid] > values["irradiance_w_m2"])
            or np.any(absorbed[valid] < 0) or not np.allclose(
                absorbed[valid], (1 - values["albedo"]) * incident[valid], rtol=1e-6, atol=1e-7
            )):
        raise ValueError("irradiance violates direct incidence or albedo bounds")
    if np.any(incident[valid] > np.finfo("float32").max) or np.any(absorbed[valid] > np.finfo("float32").max):
        raise ValueError("irradiance exceeds GeoTIFF float32 range")
    transform = tuple(prepared_dem.transform)
    if len(transform) != 6 or not np.isfinite(transform).all() or transform[1] <= 0 or transform[5] >= 0 or transform[2] != 0 or transform[4] != 0:
        raise ValueError("DEM affine must be finite and north-up")
    crs = prepared_dem.crs
    if not crs.is_projected or not crs.axis_info or not np.isclose(crs.axis_info[0].unit_conversion_factor, 1):
        raise ValueError("DEM CRS must be projected in meters")
    return values, valid, incident, absorbed, transform, crs, provenance


def _write_layer(path, layer, values, valid, transform, crs):
    with rasterio.open(path, "w", driver="GTiff", height=valid.shape[0], width=valid.shape[1],
                       count=1, dtype="float32", crs=crs, transform=Affine.from_gdal(*transform),
                       nodata=np.nan) as dataset:
        dataset.write(values.astype("float32"), 1)
        dataset.write_mask(valid.astype("uint8") * 255)
        dataset.update_tags(units="W/m2", model="direct-geometric-v1", layer=layer)
    with rasterio.open(path) as dataset:
        if (dataset.crs != crs or dataset.transform != Affine.from_gdal(*transform)
                or not np.array_equal(dataset.dataset_mask() > 0, valid)
                or not np.allclose(dataset.read(1)[valid], values[valid], rtol=1e-6, atol=1e-5)):
            raise ValueError("GeoTIFF readback did not preserve modeled data")


def export_radiation(result, prepared_dem, parameters, source_hgt_sha256, code_version, output_dir):
    """Write two GeoTIFFs and a manifest, exposing only one complete run directory.

    Caller supplies verified HGT hashes and a meaningful code version; this
    exporter does not revalidate the original ZIP or call Earthdata. The parent
    directory must already exist and the destination must be new.
    """
    values, valid, incident, absorbed, transform, crs, provenance = _validated_inputs(
        result, prepared_dem, parameters, source_hgt_sha256, code_version
    )
    destination = Path(output_dir)
    if not destination.name or not destination.parent.is_dir() or any(
        parent.is_symlink() for parent in (destination.parent, *destination.parent.parents)
    ):
        raise ValueError("output parent must be an existing real directory")
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("refusing to overwrite an existing solar run")
    lock_path = destination.with_name(destination.name + ".lock")
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(lock_fd)
    staging = None
    try:
        if destination.exists() or destination.is_symlink():
            raise FileExistsError("solar run appeared while preparing export")
        staging = Path(tempfile.mkdtemp(prefix=".solar-stage-", dir=destination.parent))
        files = {}
        for layer, data in (("incident", incident), ("absorbed", absorbed)):
            name = f"{layer}.tif"
            path = staging / name
            _write_layer(path, layer, data, valid, transform, crs)
            files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest = {
            "model": "direct-geometric-v1", "units": "W/m2", "code_version": code_version,
            "parameters": values, "sources": dict(sorted(source_hgt_sha256.items())),
            "source_hash_basis": "caller-provided HGT SHA-256; original ZIP must be checked separately",
            "provenance": list(provenance), "crs": crs.to_string(),
            "transform": list(transform), "valid_pixels": int(valid.sum()), "files": files,
            "limitations": "no atmosphere, terrain shadows or diffuse radiation; not observed sunlight",
        }
        (staging / "run.json").write_text(json.dumps(manifest, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
        if destination.exists() or destination.is_symlink():
            raise FileExistsError("solar run appeared while preparing export")
        os.rename(staging, destination)
        staging = None
        return manifest
    finally:
        if staging is not None:
            shutil.rmtree(staging)
        lock_path.unlink()
