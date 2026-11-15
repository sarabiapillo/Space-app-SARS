"""Acquire required NASADEM tiles from an ROI, without a derived-data cache.

The local ZIP cache is trusted offline only after a CMR result has been matched
and the provider has verified the matching HGT. An old unrecorded ZIP needs a
one-time CMR lookup; its filename alone is not proof of provenance.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import tempfile
import zipfile

from .dem import _geometry, _tile_origin, required_nasadem_tiles
from .nasadem import NASADEMProvider, SHORT_NAME, VERSION, validate_hgt_zip


def _root(cache_dir):
    path = Path(cache_dir)
    if not path.is_dir() or any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError("cache_dir must be an existing real directory without symlink components")
    return path.resolve(strict=True)


def _checked_archive(root, tile, tile_size):
    target = root / f"{tile}.zip"
    if target.is_symlink():
        raise ValueError("refusing symlink NASADEM cache target")
    if not target.exists():
        return None
    if not target.is_file():
        raise ValueError("NASADEM cache target is not a regular file")
    try:
        with zipfile.ZipFile(target) as archive:
            members = [Path(info.filename).name.lower() for info in archive.infolist()
                       if not info.is_dir() and info.filename.lower().endswith(".hgt")]
        if members != [f"{tile}.hgt"]:
            raise ValueError("cached HGT tile identity mismatch")
        return validate_hgt_zip(target, expected_bytes=tile_size * tile_size * 2)
    except (ValueError, zipfile.BadZipFile, OSError) as exc:
        raise ValueError(f"invalid NASADEM cache ZIP for {tile}; refusing overwrite") from exc


def _trusted_cache(root, tile, tile_size):
    target = root / f"{tile}.zip"
    digest = _checked_archive(root, tile, tile_size)
    receipt = root / f".{tile}.cmr.json"
    if receipt.is_symlink():
        raise ValueError("refusing symlink NASADEM cache receipt")
    if not receipt.exists():
        return None
    try:
        stored = json.loads(receipt.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise ValueError(f"invalid NASADEM cache receipt for {tile}") from exc
    expected = {"short_name": SHORT_NAME, "version": VERSION,
                "granule_ur": f"NASADEM_HGT_{tile}", "hgt_sha256": digest}
    if stored != expected:
        raise ValueError(f"NASADEM cache receipt/ZIP mismatch for {tile}")
    return target


def _matching_result(results, tile):
    matches = []
    for result in results:
        umm = result.get("umm") if isinstance(result, dict) else None
        collection = umm.get("CollectionReference") if isinstance(umm, dict) else None
        if not isinstance(collection, dict) or collection.get("ShortName") != SHORT_NAME or str(collection.get("Version")) != VERSION:
            continue
        ur = umm.get("GranuleUR")
        if isinstance(ur, str) and re.fullmatch(r"NASADEM_HGT_([NS]\d{2}[EW]\d{3})", ur, re.IGNORECASE):
            if ur.lower() == f"nasadem_hgt_{tile}":
                matches.append(result)
    if len(matches) != 1:
        raise ValueError(f"missing or ambiguous NASADEM CMR granule for required tile {tile}")
    return matches[0]


def _attest(root, tile, tile_size, digest):
    receipt = root / f".{tile}.cmr.json"
    if receipt.is_symlink():
        raise ValueError("refusing symlink NASADEM cache receipt")
    record = {"short_name": SHORT_NAME, "version": VERSION,
              "granule_ur": f"NASADEM_HGT_{tile}", "hgt_sha256": digest}
    fd, temporary = tempfile.mkstemp(prefix=f".{tile}.", suffix=".tmp", dir=root)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, receipt)
        except FileExistsError:
            # Concurrent writers may only converge on exactly the same bytes.
            if _trusted_cache(root, tile, tile_size) is None:
                raise ValueError("cache receipt appeared without matching ZIP")
    finally:
        Path(temporary).unlink(missing_ok=True)


def acquire_roi_tiles(roi_geojson, cache_dir, *, provider=None, tile_size=3601,
                      max_pixels=30_000_000, max_tiles=16):
    """Return verified ZIP paths for required ROI tiles and already-cached halo.

    Preflight rejects unsupported geography/resources before CMR access. Halo
    tiles are optional and never trigger a remote search. The caller owns the
    Earthdata session; this function never requests credentials interactively.
    """
    required, halo = required_nasadem_tiles(roi_geojson, max_tiles=max_tiles)
    if isinstance(tile_size, bool) or not isinstance(tile_size, int) or tile_size < 2:
        raise ValueError("tile_size must be an integer >= 2")
    if isinstance(max_pixels, bool) or not isinstance(max_pixels, int) or max_pixels < tile_size * tile_size:
        raise ValueError("invalid source pixel resource limit")
    tile_pixels = tile_size * tile_size
    if len(required) * tile_pixels > max_pixels:
        raise ValueError("required ROI tiles exceed source pixel resource limit")
    # Match prepare_dem's conservative source mosaic preflight before any CMR
    # call; it is a separate allocation from the aggregate source tile count.
    west, south, east, north = _geometry(roi_geojson).bounds
    step = 1.0 / (tile_size - 1)
    width = math.ceil((east - west) / step) + 4
    height = math.ceil((north - south) / step) + 4
    if width * height > max_pixels:
        raise ValueError("ROI mosaic exceeds source pixel resource limit")
    root = _root(cache_dir)
    source = provider if provider is not None else NASADEMProvider(root)
    selected = {}
    for tile in required:
        cached = _trusted_cache(root, tile, tile_size)
        if cached is None:
            lon, lat = _tile_origin(tile)
            matched = _matching_result(source.search((lon, lat, lon + 1, lat + 1)), tile)
            returned = Path(source.acquire([matched]))
            target = root / f"{tile}.zip"
            if returned.is_symlink() or returned.resolve(strict=True) != target:
                raise ValueError("provider returned a ZIP outside the expected NASADEM cache target")
            digest = _checked_archive(root, tile, tile_size)
            if digest is None:
                raise ValueError("provider did not return a complete NASADEM ZIP")
            _attest(root, tile, tile_size, digest)
            cached = _trusted_cache(root, tile, tile_size)
        selected[tile.upper()] = cached
    # Optional cached neighbors improve derivatives; never fetch them just for halo.
    for tile in halo:
        if len(selected) >= max_tiles or (len(selected) + 1) * tile_pixels > max_pixels:
            break
        cached = _trusted_cache(root, tile, tile_size)
        if cached is not None:
            selected[tile.upper()] = cached
    return selected
