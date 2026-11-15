"""Offline structural preparation of NASADEM HGT into a clipped terrain raster.

This module prepares elevations only; its output is not certified for hydraulic use.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import re
import zipfile

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
from pyproj import CRS

from pipeline.elevation.nasadem import NASADEMGranule, validate_hgt_zip
from pipeline.hydrology.inputs import validate_roi

_SOURCE_PRODUCT = "NASADEM_HGT"
_SOURCE_VERSION = "001"
_SOURCE_DATUM = "EGM96"
_VALID_MIN, _VALID_MAX = -32767, 32767
_TILE = re.compile(r"([ns])(\d{2})([ew])(\d{3})\.hgt$", re.IGNORECASE)


def _validate_crs(value):
    try:
        crs = CRS.from_user_input(value)
    except Exception as exc:
        raise ValueError("target_crs must be a valid projected CRS with metre units") from exc
    if not crs.is_projected or not crs.axis_info or any(
        axis.unit_name.lower() not in {"metre", "meter"} or axis.unit_conversion_factor != 1
        for axis in crs.axis_info[:2]
    ):
        raise ValueError("target_crs must be projected with metre units")
    return crs


def _validate_parameters(geometry, records, output_dir, target_crs, resolution_m,
                         resampling, max_cells, target_vertical_datum, code_version):
    validated = validate_roi(geometry)
    if isinstance(resolution_m, bool) or not isinstance(resolution_m, (int, float)):
        raise ValueError("resolution_m must be a finite positive number")
    try:
        resolution = float(resolution_m)
    except (OverflowError, ValueError):
        raise ValueError("resolution_m must be a finite positive number") from None
    if not math.isfinite(resolution) or resolution <= 0:
        raise ValueError("resolution_m must be a finite positive number")
    if isinstance(max_cells, bool) or not isinstance(max_cells, int) or max_cells <= 0:
        raise ValueError("max_cells must be a positive integer")
    if not isinstance(resampling, str) or resampling not in {"nearest", "bilinear"}:
        raise ValueError("resampling must be explicitly nearest or bilinear")
    if target_vertical_datum != _SOURCE_DATUM:
        raise ValueError("target vertical datum must equal source vertical datum EGM96")
    if not isinstance(code_version, str) or not code_version.strip():
        raise ValueError("code_version must be a non-empty declared string")
    if not isinstance(output_dir, (str, Path)) or not str(output_dir):
        raise ValueError("output_dir must be a new directory path")
    destination = Path(output_dir)
    if destination.exists():
        raise FileExistsError("output directory already exists; refusing overwrite")
    crs = _validate_crs(target_crs)
    if not isinstance(records, (tuple, list)) or not records:
        raise ValueError("records must be a non-empty collection of NASADEMGranule")
    return validated, destination, crs, resolution


def _tile_identity(record):
    if not isinstance(record, NASADEMGranule):
        raise ValueError("every record must be a NASADEMGranule")
    if record.short_name != _SOURCE_PRODUCT or str(record.version) != _SOURCE_VERSION:
        raise ValueError("record collection identity must be NASADEM_HGT version 001")
    if not isinstance(record.tile_id, str):
        raise ValueError("record tile_id must be a NASADEM tile string")
    tile = record.tile_id.lower()
    match = re.fullmatch(r"([ns])(\d{2})([ew])(\d{3})", tile)
    if not match or record.granule_ur != f"NASADEM_HGT_{tile}":
        raise ValueError("record tile and granule identity mismatch")
    lat = int(match.group(2)) * (-1 if match.group(1) == "s" else 1)
    lon = int(match.group(4)) * (-1 if match.group(3) == "w" else 1)
    if not -56 <= lat <= 59 or not -180 <= lon <= 179:
        raise ValueError("record tile is outside NASADEM coverage")
    return tile, lon, lat


def _inspect_records(records):
    validated = []
    seen = set()
    for record in records:
        tile, lon, lat = _tile_identity(record)
        if tile in seen:
            raise ValueError(f"duplicate NASADEM tile {tile}")
        seen.add(tile)
        path = Path(record.path)
        digest = validate_hgt_zip(path)
        with zipfile.ZipFile(path) as archive:
            members = [item.filename for item in archive.infolist() if not item.is_dir() and item.filename.lower().endswith(".hgt")]
        if len(members) != 1 or Path(members[0]).name.lower() != f"{tile}.hgt":
            raise ValueError(f"HGT member identity mismatch for tile {tile}")
        validated.append({"record": record, "tile": tile, "lon": lon, "lat": lat,
                          "member": members[0], "sha256": digest})
    return sorted(validated, key=lambda item: (item["lat"], item["lon"], item["tile"]))


def _target_grid(geometry, source_crs, resolution, max_cells):
    projected = transform_geom("EPSG:4326", source_crs, geometry, precision=-1)
    xs = [point[0] for ring in projected["coordinates"] for point in ring]
    ys = [point[1] for ring in projected["coordinates"] for point in ring]
    bounds = (min(xs), min(ys), max(xs), max(ys))
    if not all(math.isfinite(value) for value in bounds) or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
        raise ValueError("projected geometry has invalid bounds")
    width = math.ceil((bounds[2] - bounds[0]) / resolution)
    height = math.ceil((bounds[3] - bounds[1]) / resolution)
    if width <= 0 or height <= 0 or width * height > max_cells:
        raise ValueError("target grid exceeds max_cells budget")
    transform = from_origin(bounds[0], bounds[3], resolution, resolution)
    if not all(math.isfinite(value) for value in transform[:6]):
        raise ValueError("target transform is not finite")
    return projected, transform, width, height


def _open_hgt(info):
    path = Path(info["record"].path).resolve(strict=True)
    uri = f"/vsizip/{path.as_posix()}/{info['member']}"
    dataset = rasterio.open(uri)
    if dataset.width != 3601 or dataset.height != 3601 or dataset.count != 1:
        dataset.close()
        raise ValueError("validated HGT has unexpected dimensions")
    # GDAL's SRTMHGT driver defines 3601 postings across one degree, preserving
    # point registration (not a 3601-cell area grid or an added half-pixel shift).
    return dataset


def _warp_tile(dataset, transform, crs, width, height, method):
    from rasterio.warp import reproject
    source = dataset.read(1, masked=False)
    validity = (source >= _VALID_MIN) & (source <= _VALID_MAX)
    # Reproject values and an independent nearest-neighbour validity mask. The
    # latter prevents bilinear interpolation over voids becoming valid ground.
    source_float = source.astype(np.float32)
    source_float[~validity] = np.nan
    destination = np.full((height, width), np.nan, dtype=np.float32)
    reproject(source_float, destination, src_transform=dataset.transform, src_crs=dataset.crs,
              dst_transform=transform, dst_crs=crs, src_nodata=np.nan, dst_nodata=np.nan,
              resampling=Resampling[method])
    valid_target = np.zeros((height, width), dtype=np.uint8)
    reproject(validity.astype(np.uint8), valid_target, src_transform=dataset.transform,
              src_crs=dataset.crs, dst_transform=transform, dst_crs=crs,
              src_nodata=0, dst_nodata=0, resampling=Resampling.nearest)
    return destination, valid_target.astype(bool) & np.isfinite(destination)


def prepare_dem(geometry, records, output_dir, *, target_crs, resolution_m,
                resampling, max_cells, target_vertical_datum, code_version):
    """Prepare caller geometry from already-acquired NASADEM granules, offline.

    Selected pixel centers define coverage and geometry masking. Missing any
    selected center is an error. Overlaps use first-valid in stable tile order.
    No filling, sink treatment, channel carving, or vertical conversion occurs.
    """
    geometry, destination, target_crs_obj, resolution = _validate_parameters(
        geometry, records, output_dir, target_crs, resolution_m, resampling,
        max_cells, target_vertical_datum, code_version)
    inspected = _inspect_records(records)
    projected, transform, width, height = _target_grid(geometry, target_crs_obj,
                                                        resolution, max_cells)
    selected = geometry_mask([projected], out_shape=(height, width), transform=transform,
                             all_touched=False, invert=True)
    selected_count = int(np.count_nonzero(selected))
    if selected_count == 0:
        raise ValueError("geometry selects no target cell centers")
    output = np.full((height, width), np.nan, dtype=np.float32)
    assigned = np.zeros((height, width), dtype=bool)
    for info in inspected:
        dataset = _open_hgt(info)
        try:
            warped, valid = _warp_tile(dataset, transform, target_crs_obj, width, height, resampling)
        finally:
            dataset.close()
        use = selected & valid & ~assigned
        output[use] = warped[use]
        assigned[use] = True
    missing = selected & ~assigned
    missing_count = int(np.count_nonzero(missing))
    if missing_count:
        raise ValueError(f"NASADEM coverage missing for {missing_count} selected cell centers")

    # All source/config/coverage checks precede the first destination write.
    destination.mkdir(parents=False, exist_ok=False)
    raster_path = destination / "terrain.tif"
    profile = {"driver": "GTiff", "height": height, "width": width, "count": 1,
               "dtype": "float32", "crs": target_crs_obj, "transform": transform,
               "nodata": float("nan"), "compress": "deflate"}
    with rasterio.open(raster_path, "w", **profile) as raster:
        raster.write(output, 1)
    manifest = {
        "geometry": {"crs": "EPSG:4326", "geojson": geometry},
        "source": {"product": _SOURCE_PRODUCT, "version": _SOURCE_VERSION,
                   "vertical_datum": _SOURCE_DATUM,
                   "records": [{"tile_id": item["tile"], "granule_ur": item["record"].granule_ur,
                                "member": item["member"], "hgt_sha256": item["sha256"]}
                               for item in inspected]},
        "source_horizontal_crs": "EPSG:4326 geographic tile grid",
        "destination_horizontal_crs": target_crs_obj.to_string(),
        "target_vertical_datum": target_vertical_datum,
        "grid": {"width": width, "height": height, "resolution_m": resolution,
                 "transform": list(transform)[:6], "nodata": "NaN",
                 "geometry_mask": "selected pixel centers only; outside geometry is nodata"},
        "resampling": resampling,
        "overlap_policy": "first valid sample in stable ascending (latitude, longitude, tile_id) order; no averaging",
        "coverage": {"selected_cell_centers": selected_count,
                     "covered_selected_cells": selected_count,
                     "missing_selected_cells": 0,
                     "interpretation": "discrete structural coverage only; not proof of continuous-area or hydrologic coverage"},
        "height_policy": "HGT valid range -32767..32767 metres; -32768 excluded (not labeled official nodata); no fill or terrain surgery",
        "vertical_operation": "horizontal reprojection only; EGM96 elevations unchanged except explicit resampling",
        "code_version": code_version,
        "hydraulic_ready": False,
        "blockers": ["scientific domain and boundary conditions pending", "topographic suitability and DG2 preparation pending"],
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return destination
