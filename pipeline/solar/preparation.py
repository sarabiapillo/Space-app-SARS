"""Validated, bounded L2/L3 derived cache for offline solar preparation."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
import zipfile

import numpy as np

from .dem import prepare_dem
from .terrain import compute_prepared_terrain

_CACHE_FORMAT = 1
_SPATIAL_VERSION = "nasadem-l2-metric-roi-halo-v1"
_TERRAIN_VERSION = "terrain-l3-centered-differences-v1"
_MAGIC = b"TP-SOLAR-CACHE\x00"


@dataclass(frozen=True)
class PreparedTerrainCache:
    dem: object
    terrain: dict
    l2_hit: bool
    l3_hit: bool


def cache_artifact_path(cache_dir, level):
    """Return the single deterministic artifact path for tests/diagnostics."""
    if level not in ("L2", "L3"):
        raise ValueError("level must be L2 or L3")
    matches = sorted(Path(cache_dir).glob(f"{level.lower()}-*.cache"))
    if len(matches) != 1:
        raise ValueError(f"expected one {level} artifact, found {len(matches)}")
    return matches[0]


def _canonical_roi(value):
    from shapely.geometry import mapping, shape

    geom = shape(value)
    if geom.is_empty or not geom.is_valid:
        raise ValueError("invalid ROI geometry")
    # Shapely normalize canonicalizes ring starts, ring winding and component order.
    normalized = geom.normalize()
    return json.dumps(mapping(normalized), sort_keys=True, separators=(",", ":"), allow_nan=False)


def _source_fingerprints(zip_paths):
    if not isinstance(zip_paths, dict) or not zip_paths:
        raise ValueError("zip_paths must be a non-empty tile mapping")
    items = []
    for tile, source in sorted(zip_paths.items()):
        if not isinstance(tile, str) or not tile.isascii():
            raise ValueError("invalid source tile identifier")
        if isinstance(source, bytes):
            digest = hashlib.sha256(source).hexdigest()
            identity = {"kind": "bytes", "sha256": digest}
        else:
            path = Path(source)
            if path.is_symlink() or not path.is_file():
                raise ValueError("source paths must be regular non-symlink files")
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            identity = {"kind": "file", "path": str(path.resolve()), "sha256": digest.hexdigest()}
        items.append({"tile": tile, **identity})
    return items


def _safe_root(path):
    path = Path(path)
    if path.exists() and (path.is_symlink() or not path.is_dir()):
        raise ValueError("cache root must be a real directory, not a symlink")
    # Create missing directory components one at a time, refusing symlinks.
    missing = []
    cursor = path
    while not cursor.exists():
        missing.append(cursor)
        parent = cursor.parent
        if parent == cursor:
            raise ValueError("invalid cache root")
        cursor = parent
    if cursor.is_symlink() or not cursor.is_dir():
        raise ValueError("cache root path contains a symlink or non-directory")
    for part in reversed(missing):
        part.mkdir()
        if part.is_symlink() or not part.is_dir():
            raise ValueError("cache root path contains a symlink")
    return path.resolve(strict=True)


def _key(metadata):
    encoded = json.dumps(metadata, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def _arrays_digest(arrays):
    digest = hashlib.sha256()
    for name in sorted(arrays):
        array = np.ascontiguousarray(arrays[name])
        digest.update(name.encode() + b"\0")
        digest.update(array.dtype.str.encode() + b"\0")
        digest.update(json.dumps(array.shape).encode() + b"\0")
        digest.update(array.tobytes())
    return digest.hexdigest()


def _write_artifact(path, metadata, arrays):
    # NPZ is non-pickle, and metadata + arrays + digest share one atomically
    # promoted file so readers can never observe a manifest/payload split.
    import io

    buffer = io.BytesIO()
    np.savez_compressed(buffer, **arrays)
    payload = buffer.getvalue()
    envelope = dict(metadata, payload_sha256=hashlib.sha256(payload).hexdigest(),
                    arrays_sha256=_arrays_digest(arrays),
                    arrays={name: {"shape": list(np.asarray(value).shape),
                                   "dtype": np.asarray(value).dtype.str}
                            for name, value in sorted(arrays.items())})
    header = json.dumps(envelope, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    data = _MAGIC + struct.pack(">Q", len(header)) + header + payload
    fd, staging_name = tempfile.mkstemp(prefix=".solar-stage-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # Hard-link publication is exclusive and does not replace an existing
        # artifact. A concurrent winner is accepted only after full validation.
        os.link(staging_name, path)
    finally:
        try:
            os.unlink(staging_name)
        except FileNotFoundError:
            pass


def _read_artifact(path, expected, max_bytes):
    if path.is_symlink() or not path.exists() or not path.is_file():
        raise ValueError("corrupt or invalid cache artifact path")
    try:
        if path.stat().st_size > max_bytes:
            raise ValueError
        data = path.read_bytes()
        if not data.startswith(_MAGIC):
            raise ValueError
        offset = len(_MAGIC)
        header_size = struct.unpack(">Q", data[offset:offset + 8])[0]
        start = offset + 8
        header = json.loads(data[start:start + header_size])
        payload = data[start + header_size:]
        if header_size <= 0 or not payload or any(header.get(key) != value for key, value in expected.items()):
            raise ValueError
        if hashlib.sha256(payload).hexdigest() != header["payload_sha256"]:
            raise ValueError
        import io
        with zipfile.ZipFile(io.BytesIO(payload)) as compressed:
            members = compressed.infolist()
            if not members or sum(item.file_size for item in members) > max_bytes:
                raise ValueError
        with np.load(io.BytesIO(payload), allow_pickle=False) as archive:
            arrays = {name: archive[name] for name in archive.files}
        if _arrays_digest(arrays) != header["arrays_sha256"]:
            raise ValueError
        definitions = header["arrays"]
        if set(definitions) != set(arrays):
            raise ValueError
        for name, array in arrays.items():
            if definitions[name] != {"shape": list(array.shape), "dtype": array.dtype.str}:
                raise ValueError
        return arrays, header
    except Exception as exc:
        raise ValueError(f"corrupt or invalid cache artifact: {path.name}") from exc


def _publish_or_validate(path, metadata, arrays, max_bytes):
    if path.exists() or path.is_symlink():
        _read_artifact(path, metadata, max_bytes)
        return
    try:
        _write_artifact(path, metadata, arrays)
    except FileExistsError:
        _read_artifact(path, metadata, max_bytes)


def _dem_arrays(dem):
    return {"elevation": np.asarray(dem.elevation), "valid_mask": np.asarray(dem.valid_mask, dtype=np.uint8),
            "halo_mask": np.asarray(dem.halo_mask, dtype=np.uint8), "transform": np.asarray(dem.transform, dtype=np.float64),
            "crs": np.asarray(dem.crs.to_wkt()), "provenance": np.asarray(json.dumps(list(dem.provenance), separators=(",", ":")))}


def _restore_dem(arrays):
    from pyproj import CRS
    from .dem import PreparedDEM

    elevation, valid, halo = arrays["elevation"], arrays["valid_mask"], arrays["halo_mask"]
    if elevation.ndim != 2 or valid.shape != elevation.shape or halo.shape != elevation.shape:
        raise ValueError("invalid L2 cache shape")
    if elevation.dtype != np.dtype("float32") or valid.dtype != np.dtype("uint8") or halo.dtype != np.dtype("uint8"):
        raise ValueError("invalid L2 cache types")
    if not np.isin(valid, (0, 1)).all() or not np.isin(halo, (0, 1)).all() or np.any((valid > 0) & (halo > 0)):
        raise ValueError("invalid L2 cache masks")
    if arrays["transform"].shape != (6,) or not np.isfinite(arrays["transform"]).all():
        raise ValueError("invalid L2 cache transform")
    if np.any(~np.isfinite(elevation[(valid > 0) | (halo > 0)])) or np.any(np.isfinite(elevation[(valid == 0) & (halo == 0)])):
        raise ValueError("invalid L2 cache content mask")
    crs = CRS.from_wkt(str(arrays["crs"].item()))
    provenance = tuple(json.loads(str(arrays["provenance"].item())))
    return PreparedDEM(elevation.copy(), valid.astype(bool), halo.astype(bool), tuple(arrays["transform"].tolist()), crs, provenance)


def _restore_terrain(arrays, expected_shape, dem_valid_mask):
    required = {"valid", "gradient_east", "gradient_north", "slope", "aspect", "normal"}
    if set(arrays) != required:
        raise ValueError("invalid L3 cache fields")
    valid = arrays["valid"]
    if valid.shape != expected_shape or valid.dtype != np.dtype("uint8") or not np.isin(valid, (0, 1)).all():
        raise ValueError("invalid L3 cache valid mask")
    result = {"valid": valid.astype(bool)}
    for key in required - {"valid"}:
        value = arrays[key]
        shape = (*expected_shape, 3) if key == "normal" else expected_shape
        if value.shape != shape or value.dtype != np.dtype("float64"):
            raise ValueError("invalid L3 cache field shape or type")
        selected = value[result["valid"]]
        if key == "aspect":
            # Aspect is mathematically undefined on exactly flat valid pixels.
            if np.any(np.isinf(selected)) or np.any(np.isfinite(value[~result["valid"]])):
                raise ValueError("invalid L3 cache aspect content mask")
        elif np.any(~np.isfinite(selected)) or np.any(np.isfinite(value[~result["valid"]])):
            raise ValueError("invalid L3 cache content mask")
        result[key] = value.copy()
    if np.any(result["valid"] & ~np.asarray(dem_valid_mask, dtype=bool)):
        raise ValueError("L3 cache exposes terrain outside valid ROI pixels")
    if not np.allclose(np.linalg.norm(result["normal"][result["valid"]], axis=-1), 1.0, rtol=1e-10, atol=1e-10):
        raise ValueError("invalid L3 cache normal vectors")
    return result


def prepare_cached_terrain(zip_paths, roi_geojson, cache_dir, *, tile_size=3601, max_tiles=16,
                           max_pixels=30_000_000, max_memory_bytes=1_000_000_000):
    """Return cached DEM and ROI terrain fields; never fetches data remotely.

    Cache files are integrity checked and fail closed. Atomic publication uses
    same-directory hard links; cross-process coordination and Windows support
    are not guaranteed by this API (see limitations in the handoff).
    """
    root = _safe_root(cache_dir)
    canonical_roi = _canonical_roi(roi_geojson)
    sources = _source_fingerprints(zip_paths)
    limits = {"tile_size": tile_size, "max_tiles": max_tiles, "max_pixels": max_pixels,
              "max_memory_bytes": max_memory_bytes}
    common = {"format": _CACHE_FORMAT, "spatial_algorithm": _SPATIAL_VERSION,
              "roi": canonical_roi, "sources": sources, "limits": limits}
    l2_key = _key(common)
    l2_meta = dict(common, level="L2", key=l2_key)
    l2_path = root / f"l2-{l2_key}.cache"
    l2_hit = l2_path.exists() or l2_path.is_symlink()
    if l2_hit:
        l2_arrays, _ = _read_artifact(l2_path, l2_meta, max_memory_bytes)
        dem = _restore_dem(l2_arrays)
    else:
        dem = prepare_dem(zip_paths, roi_geojson, tile_size=tile_size, max_tiles=max_tiles,
                          max_pixels=max_pixels, max_memory_bytes=max_memory_bytes)
        _publish_or_validate(l2_path, l2_meta, _dem_arrays(dem), max_memory_bytes)
        # Validate the just-published bytes before they become trusted output.
        l2_arrays, _ = _read_artifact(l2_path, l2_meta, max_memory_bytes)
        dem = _restore_dem(l2_arrays)
    l3_common = {"format": _CACHE_FORMAT, "terrain_algorithm": _TERRAIN_VERSION,
                 "l2_key": l2_key, "shape": list(dem.elevation.shape), "crs": dem.crs.to_wkt(),
                 "transform": list(dem.transform), "limits": limits}
    l3_key = _key(l3_common)
    l3_meta = dict(l3_common, level="L3", key=l3_key)
    l3_path = root / f"l3-{l3_key}.cache"
    l3_hit = l3_path.exists() or l3_path.is_symlink()
    if l3_hit:
        l3_arrays, _ = _read_artifact(l3_path, l3_meta, max_memory_bytes)
        terrain = _restore_terrain(l3_arrays, dem.elevation.shape, dem.valid_mask)
    else:
        terrain = compute_prepared_terrain(dem)
        arrays = {key: (np.asarray(value, dtype=np.uint8) if key == "valid" else np.asarray(value))
                  for key, value in terrain.items()}
        if set(arrays) != {"valid", "gradient_east", "gradient_north", "slope", "aspect", "normal"}:
            raise ValueError("terrain processor returned unexpected fields")
        _publish_or_validate(l3_path, l3_meta, arrays, max_memory_bytes)
        l3_arrays, _ = _read_artifact(l3_path, l3_meta, max_memory_bytes)
        terrain = _restore_terrain(l3_arrays, dem.elevation.shape, dem.valid_mask)
    return PreparedTerrainCache(dem, terrain, l2_hit, l3_hit)
