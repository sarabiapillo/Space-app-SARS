"""Bounded, offline NASADEM HGT preparation for a GeoJSON ROI."""
from __future__ import annotations

from dataclasses import dataclass
import io
import math
import re
import warnings
import zipfile

import numpy as np
from pyproj import CRS, Transformer
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from shapely.ops import transform as transform_geometry

_MAX_ROI_VERTICES = 100_000
_TILE = re.compile(r"^([NS])(\d{2})([EW])(\d{3})$", re.IGNORECASE)


@dataclass(frozen=True)
class PreparedDEM:
    elevation: np.ndarray
    valid_mask: np.ndarray  # ROI pixels with source data
    halo_mask: np.ndarray  # source neighbors outside ROI, for terrain derivatives
    transform: object
    crs: CRS
    provenance: tuple[str, ...]


def _tile_origin(tile):
    match = _TILE.fullmatch(tile)
    if not match:
        raise ValueError(f"invalid NASADEM tile coordinate: {tile!r}")
    ns, lat, ew, lon = match.groups()
    return int(lon) * (1 if ew.upper() == "E" else -1), int(lat) * (1 if ns.upper() == "N" else -1)


def required_nasadem_tiles(roi_geojson, *, max_tiles=16):
    """Return required ROI tiles and optional neighboring halo candidates.

    Tiles use their southwest 1-degree origin. A boundary shared with another
    tile does not require that tile unless the ROI occupies positive area in it.
    Unsupported coverage, metric extent and tile counts fail before any I/O.
    """
    if isinstance(max_tiles, bool) or not isinstance(max_tiles, int) or max_tiles < 1:
        raise ValueError("max_tiles must be a positive integer")
    geom = _geometry(roi_geojson)
    west, south, east, north = geom.bounds
    if east - west >= 6 or north - south >= 8:
        raise ValueError("ROI exceeds bounded metric preparation extent")

    def name(lon, lat):
        return f"{'n' if lat >= 0 else 's'}{abs(lat):02d}{'e' if lon >= 0 else 'w'}{abs(lon):03d}"

    origins = set()
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            if geom.intersection(box(lon, lat, lon + 1, lat + 1)).area > 0:
                origins.add((lon, lat))
                if len(origins) > max_tiles:
                    raise ValueError("ROI exceeds NASADEM tile limit")
    if not origins:
        raise ValueError("ROI has no NASADEM tile coverage")
    halo = {(lon + dx, lat + dy) for lon, lat in origins
            for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - origins
    halo = {(lon, lat) for lon, lat in halo if -180 <= lon < 180 and -56 <= lat < 60}
    return (tuple(sorted(name(*origin) for origin in origins)),
            tuple(sorted(name(*origin) for origin in halo)))


def _raw_vertex_count(value, limit):
    count = 0
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, (list, tuple)):
            if len(item) >= 2 and all(isinstance(part, (int, float)) for part in item[:2]):
                count += 1
                if count > limit:
                    return count
            else:
                stack.extend(item)
    return count


def _geometry(geojson):
    try:
        if not isinstance(geojson, dict) or geojson.get("type") not in ("Polygon", "MultiPolygon"):
            raise ValueError
        if _raw_vertex_count(geojson.get("coordinates"), _MAX_ROI_VERTICES) > _MAX_ROI_VERTICES:
            raise ValueError("ROI vertex complexity limit exceeded")
        geom = shape(geojson)
        if geom.is_empty or not geom.is_valid or geom.area <= 0:
            raise ValueError
        west, south, east, north = geom.bounds
        if west < -180 or east > 180 or south < -90 or north > 90 or west >= east:
            raise ValueError
        if south < -56 or north > 60:
            raise ValueError
        return geom
    except ValueError as exc:
        if "complexity" in str(exc):
            raise
        raise ValueError("invalid EPSG:4326 polygon geometry or outside NASADEM coverage") from exc
    except Exception as exc:
        raise ValueError("invalid EPSG:4326 polygon geometry or outside NASADEM coverage") from exc


def _local_crs(geom):
    west, south, east, north = geom.bounds
    if east - west >= 6 or north - south >= 8:
        raise ValueError("ROI exceeds single local UTM preparation extent")
    lon, lat = geom.centroid.x, geom.centroid.y
    zones = {int((x + 180) // 6) + 1 for x in (west, east - 1e-10)}
    if -80 <= lat <= 84 and len(zones) == 1:
        return CRS.from_epsg((32600 if lat >= 0 else 32700) + next(iter(zones)))
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs")


def _read_hgt(source, tile, tile_size):
    expected_bytes = tile_size * tile_size * 2
    try:
        stream = io.BytesIO(source) if isinstance(source, bytes) else source
        with zipfile.ZipFile(stream) as archive:
            members = [info for info in archive.infolist() if not info.is_dir() and info.filename.lower().endswith(".hgt")]
            if len(members) != 1 or members[0].filename.rsplit("/", 1)[-1].lower() != f"{tile.lower()}.hgt":
                warnings.warn("incomplete NASADEM tile: missing or mismatched HGT identity", RuntimeWarning, stacklevel=2)
                raise ValueError("ZIP HGT identity mismatch")
            info = members[0]
            # Check declared expansion size before any decompression or allocation.
            if info.file_size != expected_bytes:
                warnings.warn("incomplete NASADEM tile: HGT dimensions/size mismatch", RuntimeWarning, stacklevel=2)
                raise ValueError("HGT dimensions/size mismatch")
            payload = bytearray()
            with archive.open(info) as member:
                while chunk := member.read(min(1024 * 1024, expected_bytes + 1 - len(payload))):
                    payload.extend(chunk)
                    if len(payload) > expected_bytes:
                        warnings.warn("incomplete NASADEM tile: HGT exceeds declared dimensions", RuntimeWarning, stacklevel=2)
                        raise ValueError("HGT exceeds declared dimensions")
            if len(payload) != expected_bytes:
                warnings.warn("incomplete NASADEM tile: HGT dimensions/size mismatch", RuntimeWarning, stacklevel=2)
                raise ValueError("HGT dimensions/size mismatch")
            raw = np.frombuffer(payload, dtype=">i2").reshape(tile_size, tile_size)
            # NASADEM_HGT User Guide v1.3 Table 1 defines valid elevations as
            # [-32767, 32767]; -32768 falls outside that range. The guide
            # lists NoData as N/A; it does not designate -32768 as a void code.
            # Reject before float conversion/resampling so interpolation cannot
            # turn a void post into a plausible-looking finite elevation.
            if np.any((raw < -32767) | (raw > 32767)):
                warnings.warn(
                    "out-of-range NASADEM HGT elevation: N/A/invalid sample encountered",
                    RuntimeWarning,
                    stacklevel=2,
                )
                raise ValueError("out-of-range NASADEM HGT elevation")
            return raw.astype(np.float32)
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        warnings.warn(f"incomplete NASADEM tile: invalid ZIP for {tile}", RuntimeWarning, stacklevel=2)
        raise ValueError(f"invalid NASADEM ZIP for {tile}") from exc


def prepare_dem(zip_paths, roi_geojson, *, tile_size=3601, max_tiles=16, max_pixels=30_000_000, max_memory_bytes=1_000_000_000):
    """Prepare a bounded ROI raster; warn and reject incomplete ROI coverage.

    ``tile_size`` is injectable for small synthetic tests; production defaults to 3601.
    Input maps NASADEMProvider-validated tile IDs to ZIP paths or ZIP bytes.
    """
    if not isinstance(tile_size, int) or (tile_size != 3601 and tile_size < 2):
        raise ValueError("tile_size must be >= 2 (production default is 3601)")
    geom = _geometry(roi_geojson)
    if not isinstance(zip_paths, dict) or not zip_paths or len(zip_paths) > max_tiles:
        raise ValueError("tile count exceeds limit or no validated tiles supplied")
    # Bound aggregate source allocation before opening/decompressing any tile payload.
    if len(zip_paths) * tile_size * tile_size > max_pixels:
        raise ValueError("aggregate source tile pixels exceed resource limit")
    tile_boxes = {}
    for tile in zip_paths:
        lon, lat = _tile_origin(tile)
        tile_boxes[tile] = box(lon, lat, lon + 1, lat + 1)
    coverage = unary_union(list(tile_boxes.values()))
    if geom.difference(coverage).area > 0:
        warnings.warn("incomplete NASADEM coverage: ROI extends beyond supplied tiles", RuntimeWarning, stacklevel=2)
        raise ValueError("supplied tiles do not provide complete ROI coverage")

    # Preflight both raster allocations from geometry alone, before opening any ZIP.
    step = 1.0 / (tile_size - 1)
    west, south, east, north = geom.bounds
    mosaic_width = math.ceil((east - west) / step) + 4
    mosaic_height = math.ceil((north - south) / step) + 4
    if mosaic_width <= 0 or mosaic_height <= 0 or mosaic_width * mosaic_height > max_pixels:
        raise ValueError("mosaic exceeds pixel resource limit")
    dst_crs = _local_crs(geom)
    project = Transformer.from_crs(CRS.from_epsg(4326), dst_crs, always_xy=True).transform
    # Tie geographic edge sampling to the output pixel scale. Estimate the
    # densified vertex count from perimeter before constructing the expanded geometry.
    max_segment_degrees = step * 10
    estimated_vertices = _raw_vertex_count(roi_geojson.get("coordinates"), _MAX_ROI_VERTICES) + math.ceil(geom.length / max_segment_degrees)
    if estimated_vertices > _MAX_ROI_VERTICES:
        raise ValueError("densified ROI vertex complexity limit exceeded")
    projected_roi = transform_geometry(project, geom.segmentize(max_segment_degrees))
    resolution = 111320.0 * step
    left, bottom, right, top = projected_roi.bounds
    left -= resolution; right += resolution; bottom -= resolution; top += resolution
    out_width, out_height = math.ceil((right - left) / resolution), math.ceil((top - bottom) / resolution)
    if out_width <= 0 or out_height <= 0 or out_width * out_height > max_pixels:
        raise ValueError("reprojected DEM exceeds pixel resource limit")
    step = 1.0 / (tile_size - 1)
    source_rows = math.ceil((north - south) / step) + 4
    source_cols = math.ceil((east - west) / step) + 4
    # One reusable float32 source/destination pair is allocated for per-tile
    # bilinear ownership weights and full-support coverage. Include its peak
    # transient footprint in the pre-read memory budget.
    per_tile_transient_bytes = 4 * ((source_rows + 2) * (source_cols + 2) + out_width * out_height)
    estimated_peak = 8 * sum(tile_size * tile_size for _ in zip_paths) + 32 * (
        source_rows * source_cols + out_width * out_height
    ) + per_tile_transient_bytes
    if not isinstance(max_memory_bytes, int) or max_memory_bytes <= 0 or estimated_peak > max_memory_bytes:
        raise ValueError("estimated peak memory exceeds resource limit")

    # Choose ROI and immediate halo tiles from validated IDs before opening any ZIP.
    origins = {name: _tile_origin(name) for name in zip_paths}
    intersecting = {name for name, (lon, lat) in origins.items()
                    if geom.intersects(box(lon, lat, lon + 1, lat + 1))}
    if not intersecting:
        raise ValueError("ROI is outside supplied tile coverage")
    roi_origins = {origins[name] for name in intersecting}
    halo_origins = {(x + dx, y + dy) for x, y in roi_origins
                    for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    selected_sources = {name: source for name, source in zip_paths.items() if origins[name] in halo_origins}
    selected = {name: (*origins[name], _read_hgt(source, name, tile_size))
                for name, source in selected_sources.items()}

    # Use common sample grid and crop to ROI bbox plus one HGT post.
    grid_west = min(lon for lon, _, _ in selected.values())
    grid_north = max(lat + 1 for _, lat, _ in selected.values())
    grid_cols = (max(lon for lon, _, _ in selected.values()) - grid_west + 1) * (tile_size - 1) + 1
    grid_rows = (grid_north - min(lat for _, lat, _ in selected.values()) + 1) * (tile_size - 1) + 1
    c0 = max(0, math.floor((west - grid_west) / step) - 1)
    c1 = min(grid_cols, math.ceil((east - grid_west) / step) + 2)
    r0 = max(0, math.floor((grid_north - north) / step) - 1)
    r1 = min(grid_rows, math.ceil((grid_north - south) / step) + 2)
    width, height = c1 - c0, r1 - r0
    if width <= 0 or height <= 0 or width * height > max_pixels:
        raise ValueError("cropped DEM exceeds pixel limit")
    mosaic = np.full((height, width), np.nan, dtype=np.float32)
    source_valid = np.zeros((height, width), dtype=np.uint8)
    source_owner = np.zeros((height, width), dtype=np.uint8)
    # Shared HGT posts must agree wherever supplied tiles overlap. A mismatch is
    # rejected rather than hidden by whichever tile happens to be mosaicked first.
    for first_name, (first_lon, first_lat, first_data) in selected.items():
        for second_name, (second_lon, second_lat, second_data) in selected.items():
            if second_name <= first_name:
                continue
            col_offset = (second_lon - first_lon) * (tile_size - 1)
            row_offset = (first_lat - second_lat) * (tile_size - 1)
            x0, x1 = max(0, col_offset), min(tile_size, col_offset + tile_size)
            y0, y1 = max(0, row_offset), min(tile_size, row_offset + tile_size)
            if x0 < x1 and y0 < y1:
                first_overlap = first_data[y0:y1, x0:x1]
                second_overlap = second_data[y0 - row_offset:y1 - row_offset,
                                             x0 - col_offset:x1 - col_offset]
                if not np.array_equal(first_overlap, second_overlap):
                    raise ValueError(f"mismatched shared posts at tile seam: {first_name}, {second_name}")

    tile_ids = {tile: index for index, tile in enumerate(selected, start=1)}
    for tile, (lon, lat, data) in selected.items():
        col = (lon - grid_west) * (tile_size - 1) - c0
        row = (grid_north - (lat + 1)) * (tile_size - 1) - r0
        x0, x1 = max(0, col), min(width, col + tile_size)
        y0, y1 = max(0, row), min(height, row + tile_size)
        if x0 >= x1 or y0 >= y1:
            continue
        # Prefer real tile data at shared posts; source pixels are not assigned a sentinel.
        target = mosaic[y0:y1, x0:x1]
        incoming = data[y0 - row:y1 - row, x0 - col:x1 - col]
        take = ~np.isfinite(target)
        target[take] = incoming[take]
        source_valid[y0:y1, x0:x1][take] = 1
        source_owner[y0:y1, x0:x1][take] = tile_ids[tile]

    # HGT posts lie on tile bounds; GDAL pixel centers therefore need half-post offset.
    src_transform = from_origin(grid_west + c0 * step - step / 2,
                                grid_north - r0 * step + step / 2, step, step)
    src_crs = CRS.from_epsg(4326)
    dst_transform = from_origin(left, top, resolution, resolution)
    destination = np.full((out_height, out_width), np.nan, dtype=np.float32)
    reproject(mosaic, destination, src_transform=src_transform, src_crs=src_crs,
              src_nodata=np.nan, dst_transform=dst_transform, dst_crs=dst_crs,
              dst_nodata=np.nan, resampling=Resampling.bilinear)
    dst_valid = np.zeros(destination.shape, dtype=np.uint8)
    reproject(source_valid, dst_valid, src_transform=src_transform, src_crs=src_crs,
              dst_transform=dst_transform, dst_crs=dst_crs, src_nodata=0,
              dst_nodata=0, resampling=Resampling.nearest)
    owner_source = np.zeros((source_valid.shape[0] + 2, source_valid.shape[1] + 2), dtype=np.float32)
    owner_weights = np.empty(destination.shape, dtype=np.float32)
    owner_source[1:-1, 1:-1] = source_valid
    padded_src_transform = from_origin(src_transform.c - step, src_transform.f + step, step, step)
    reproject(owner_source, owner_weights, src_transform=padded_src_transform, src_crs=src_crs,
              dst_transform=dst_transform, dst_crs=dst_crs, src_nodata=None,
              dst_nodata=0, resampling=Resampling.bilinear)
    full_source_support = owner_weights >= (1.0 - 1e-6)
    roi_geometries = [mapping(projected_roi)]
    roi_mask = geometry_mask(roi_geometries, out_shape=destination.shape,
                             transform=dst_transform, invert=True, all_touched=True)
    # all_touched includes fringe cells whose centers fall outside the ROI. Only
    # centers within the polygon require complete source support; fringe cells
    # without support remain NoData rather than causing a false coverage failure.
    coverage_mask = geometry_mask(roi_geometries, out_shape=destination.shape,
                                  transform=dst_transform, invert=True, all_touched=False)
    data_mask = (dst_valid > 0) & np.isfinite(destination)
    if np.any(coverage_mask & ~(data_mask & full_source_support)):
        warnings.warn("incomplete NASADEM coverage: ROI has pixels without full source support", RuntimeWarning, stacklevel=2)
        raise ValueError("reprojected DEM has invalid pixels inside the ROI coverage")
    valid_mask = data_mask & full_source_support & roi_mask
    # One-cell halo only: grow ROI mask by its eight neighbors, retaining valid data.
    padded = np.pad(roi_mask, 1)
    expanded = np.zeros_like(roi_mask)
    for dy in range(3):
        for dx in range(3):
            expanded |= padded[dy:dy + roi_mask.shape[0], dx:dx + roi_mask.shape[1]]
    halo_mask = data_mask & full_source_support & expanded & ~roi_mask
    destination[~(valid_mask | halo_mask)] = np.nan
    # Provenance follows positive bilinear source weights at final ROI/halo
    # pixels, matching the elevation resampling kernel rather than nearest owner.
    final_pixels = valid_mask | halo_mask
    contributing = []
    for tile, owner in tile_ids.items():
        owner_source.fill(0)
        np.equal(source_owner, owner, out=owner_source[1:-1, 1:-1])
        reproject(owner_source, owner_weights, src_transform=padded_src_transform, src_crs=src_crs,
                  dst_transform=dst_transform, dst_crs=dst_crs, src_nodata=None,
                  dst_nodata=0, resampling=Resampling.bilinear)
        if np.any((owner_weights > 0) & final_pixels):
            contributing.append(tile)
    contributing = tuple(sorted(contributing))
    # Six GDAL affine coefficients are the terrain processor's public contract.
    affine = dst_transform
    gdal_transform = (affine.c, affine.a, affine.b, affine.f, affine.d, affine.e)
    return PreparedDEM(destination, valid_mask, halo_mask, gdal_transform, dst_crs, contributing)
