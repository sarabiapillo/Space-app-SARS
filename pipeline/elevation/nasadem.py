"""Minimal NASADEM_HGT V001 original-ZIP provider.

Acquisition and cache writes are supported for one local process at a time;
there is no multiprocess lock or remote checksum authenticity guarantee.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading
import zipfile

import earthaccess
from shapely.geometry import box, shape

SHORT_NAME = "NASADEM_HGT"
VERSION = "001"
EXPECTED_HGT_BYTES = 3601 * 3601 * 2
_TILE_LOCKS: dict[Path, threading.Lock] = {}
_TILE_LOCKS_GUARD = threading.Lock()


@dataclass(frozen=True)
class NASADEMGranule:
    """Immutable metadata and cache path for one original NASADEM ZIP."""
    tile_id: str
    granule_ur: str
    short_name: str
    version: str
    path: Path


def _tile_lock(path: Path) -> threading.Lock:
    with _TILE_LOCKS_GUARD:
        return _TILE_LOCKS.setdefault(path, threading.Lock())


def validate_hgt_zip(source: bytes | str | os.PathLike[str], *, expected_bytes: int = EXPECTED_HGT_BYTES) -> str:
    """Validate ZIP structure and a 3601-square int16 HGT member."""
    try:
        archive = zipfile.ZipFile(source if not isinstance(source, bytes) else __import__("io").BytesIO(source))
        with archive:
            candidates = [i for i in archive.infolist() if not i.is_dir() and Path(i.filename).name.lower().endswith(".hgt")]
            if len(candidates) != 1:
                raise ValueError("expected exactly one HGT member")
            digest = hashlib.sha256()
            size = 0
            with archive.open(candidates[0]) as member:
                while chunk := member.read(1024 * 1024):
                    size += len(chunk)
                    if size > expected_bytes:
                        raise ValueError("HGT exceeds expected dimensions")
                    digest.update(chunk)
            if size != expected_bytes:
                raise ValueError("HGT size does not match 3601x3601 signed 16-bit samples")
            return digest.hexdigest()
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise ValueError("invalid or corrupt NASADEM ZIP") from exc


def _identity(result):
    umm = result.get("umm") if isinstance(result, dict) else None
    collection = umm.get("CollectionReference") if isinstance(umm, dict) else None
    if not isinstance(collection, dict) or collection.get("ShortName") != SHORT_NAME or str(collection.get("Version")) != VERSION:
        raise ValueError("CMR collection identity mismatch")
    granule_ur = umm.get("GranuleUR")
    match = re.fullmatch(r"NASADEM_HGT_([NS]\d{2}[EW]\d{3})", granule_ur or "", re.IGNORECASE)
    if not match:
        raise ValueError("granule identity cannot be verified from CMR result")
    return match.group(1).lower(), granule_ur


def _safe_identity(result, expected_tile):
    try:
        return _identity(result)[0] == expected_tile
    except ValueError:
        return False


def _validated_geometry(roi):
    if isinstance(roi, (tuple, list)):
        if len(roi) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in roi):
            raise ValueError("bbox must contain four finite coordinates")
        west, south, east, north = map(float, roi)
        if west < -180 or east > 180 or south < -56 or north > 60 or west >= east or south >= north:
            raise ValueError("bbox is invalid, antimeridian-crossing, or outside NASADEM coverage")
        geometry = box(west, south, east, north)
    else:
        try:
            geometry = shape(roi)
        except Exception as exc:
            raise ValueError("ROI must be a valid GeoJSON Polygon or MultiPolygon") from exc
        if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
            raise ValueError("ROI must be a valid non-empty Polygon or MultiPolygon")
        west, south, east, north = geometry.bounds
        if not all(math.isfinite(v) for v in (west, south, east, north)) or west < -180 or east > 180 or south < -56 or north > 60:
            raise ValueError("ROI is outside NASADEM coverage")
    if geometry.bounds[0] >= geometry.bounds[2] or geometry.bounds[1] >= geometry.bounds[3]:
        raise ValueError("ROI has no geographic extent")
    return geometry


def _required_tiles(geometry):
    west, south, east, north = geometry.bounds
    x0, x1 = math.floor(west), math.ceil(east) - 1
    y0, y1 = max(-56, math.floor(south)), min(59, math.ceil(north) - 1)
    selected = []
    for lat in range(y0, y1 + 1):
        for lon in range(x0, x1 + 1):
            tile_box = box(lon, lat, lon + 1, lat + 1)
            if geometry.intersection(tile_box).area > 0:
                ns = f"n{lat:02d}" if lat >= 0 else f"s{-lat:02d}"
                ew = f"e{lon:03d}" if lon >= 0 else f"w{-lon:03d}"
                selected.append(ns + ew)
    if not selected:
        raise ValueError("ROI does not intersect NASADEM coverage")
    return selected


class NASADEMProvider:
    """Acquire verified original NASADEM ZIPs; local single-process use only."""
    def __init__(self, cache_dir: str | os.PathLike[str]):
        self.cache_dir = Path(cache_dir)

    @staticmethod
    def search(bbox):
        """Legacy single-tile CMR search by bbox, retained for solar callers."""
        return earthaccess.search_data(short_name=SHORT_NAME, version=VERSION, bounding_box=tuple(bbox))

    def search_roi(self, roi):
        """Search and uniquely resolve all granules intersecting a Polygon/MultiPolygon or bbox."""
        geometry = _validated_geometry(roi)
        matches = []
        for tile in _required_tiles(geometry):
            lat = int(tile[1:3]) * (-1 if tile.startswith("s") else 1)
            lon = int(tile[4:7]) * (-1 if tile[3] == "w" else 1)
            try:
                found = self.search((lon, lat, lon + 1, lat + 1))
            except Exception:
                raise RuntimeError("NASADEM search failed (authentication or network error)") from None
            candidates = []
            for result in found:
                try:
                    identity = _identity(result)
                except ValueError:
                    continue
                if identity[0] == tile:
                    candidates.append(result)
            if len(candidates) != 1:
                raise ValueError(f"missing or ambiguous NASADEM CMR granule for required tile {tile}")
            matches.append(candidates[0])
        return matches

    @staticmethod
    def _authenticate_noninteractive():
        """Try environment credentials, then netrc, without prompts or persistence."""
        for strategy in ("environment", "netrc"):
            try:
                auth = earthaccess.login(strategy=strategy, persist=False)
            except Exception:
                continue
            if auth is not None:
                return
        raise RuntimeError(
            "Earthdata authentication unavailable; configure EARTHDATA_TOKEN, "
            "EARTHDATA_USERNAME/EARTHDATA_PASSWORD, or a .netrc file"
        ) from None

    def _cache_root(self):
        absolute = self.cache_dir.expanduser().absolute()
        for component in (absolute, *absolute.parents):
            if component.is_symlink():
                raise ValueError("cache root contains a symlink component")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        return self.cache_dir.resolve(strict=True)

    @staticmethod
    def _receipt_record(tile, digest):
        return {"short_name": SHORT_NAME, "version": VERSION,
                "granule_ur": f"NASADEM_HGT_{tile}", "hgt_sha256": digest}

    @staticmethod
    def _cached_tile(cache_root, tile):
        target = cache_root / f"{tile}.zip"
        receipt_path = cache_root / f".{tile}.cmr.json"
        if target.is_symlink() or receipt_path.is_symlink():
            raise ValueError("refusing symlink NASADEM cache file")
        if not target.exists():
            if receipt_path.exists():
                raise ValueError("NASADEM cache receipt exists without its ZIP")
            return None
        if not target.is_file():
            raise ValueError("cache target is not a regular file")
        try:
            digest = validate_hgt_zip(target)
            with zipfile.ZipFile(target) as archive:
                members = [Path(i.filename).name.lower() for i in archive.infolist()
                           if not i.is_dir() and i.filename.lower().endswith(".hgt")]
            if members != [f"{tile}.hgt"]:
                raise ValueError("cached HGT tile identity mismatch")
        except (ValueError, OSError, zipfile.BadZipFile) as exc:
            raise ValueError("corrupt or mismatched cached target; refusing unsafe recovery") from exc
        if not receipt_path.exists():
            return target, digest, False
        try:
            stored = json.loads(receipt_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ValueError) as exc:
            raise ValueError("invalid NASADEM cache receipt") from exc
        if stored != NASADEMProvider._receipt_record(tile, digest):
            raise ValueError("NASADEM cache receipt/ZIP identity mismatch")
        return target, digest, True

    @classmethod
    def _write_receipt(cls, cache_root, tile, digest):
        receipt = cache_root / f".{tile}.cmr.json"
        if receipt.is_symlink():
            raise ValueError("refusing symlink NASADEM cache receipt")
        record = cls._receipt_record(tile, digest)
        if receipt.exists():
            try:
                stored = json.loads(receipt.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, ValueError) as exc:
                raise ValueError("invalid existing NASADEM cache receipt; refusing overwrite") from exc
            if stored != record:
                raise ValueError("existing NASADEM cache receipt mismatches CMR/ZIP; refusing overwrite")
            return
        fd, temporary = tempfile.mkstemp(prefix=f".{tile}.", suffix=".tmp", dir=cache_root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(record, handle, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, receipt)
            except FileExistsError:
                try:
                    stored = json.loads(receipt.read_text(encoding="utf-8"))
                except (OSError, UnicodeError, ValueError) as exc:
                    raise ValueError("NASADEM cache receipt appeared unexpectedly") from exc
                if stored != record:
                    raise ValueError("NASADEM cache receipt appeared with mismatched identity")
        finally:
            Path(temporary).unlink(missing_ok=True)

    def acquire_roi(self, roi):
        """Fetch ROI ZIPs, using valid local cache before noninteractive login."""
        geometry = _validated_geometry(roi)
        tiles = _required_tiles(geometry)
        cache_root = self._cache_root()
        records_by_tile = {}
        missing = []
        for tile in tiles:
            cached = self._cached_tile(cache_root, tile)
            if cached is None or not cached[2]:
                # A structurally valid but unrecorded ZIP needs fresh CMR identity corroboration.
                missing.append(tile)
            else:
                ur = f"NASADEM_HGT_{tile}"
                records_by_tile[tile] = NASADEMGranule(tile, ur, SHORT_NAME, VERSION, cached[0])

        if missing:
            self._authenticate_noninteractive()
            for tile in missing:
                lat = int(tile[1:3]) * (-1 if tile.startswith("s") else 1)
                lon = int(tile[4:7]) * (-1 if tile[3] == "w" else 1)
                try:
                    candidates = [result for result in self.search((lon, lat, lon + 1, lat + 1))
                                  if _safe_identity(result, tile)]
                except Exception:
                    raise RuntimeError("NASADEM search failed (authentication or network error)") from None
                if len(candidates) != 1:
                    raise ValueError(f"missing or ambiguous NASADEM CMR granule for required tile {tile}")
                granule = candidates[0]
                _, ur = _identity(granule)
                path = self.acquire([granule])
                records_by_tile[tile] = NASADEMGranule(tile, ur, SHORT_NAME, VERSION, path)
        return tuple(records_by_tile[tile] for tile in tiles)

    def acquire(self, results) -> Path:
        """Acquire one CMR result after verifying its identity and ZIP contents."""
        if not isinstance(results, (list, tuple)) or len(results) != 1:
            raise ValueError("granule identity requires exactly one CMR result")
        result = results[0]
        tile, _ = _identity(result)
        expected_zip = f"nasadem_hgt_{tile}.zip"
        # Reject symlinks in every existing cache-root component before creating it.
        absolute = self.cache_dir.expanduser().absolute()
        for component in (absolute, *absolute.parents):
            if component.is_symlink():
                raise ValueError("cache root contains a symlink component")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_root = self.cache_dir.resolve(strict=True)
        target = cache_root / f"{tile}.zip"
        with _tile_lock(target):
            cached = self._cached_tile(cache_root, tile)
            if cached is not None:
                # The supplied and already-validated CMR result corroborates an unrecorded cache.
                self._write_receipt(cache_root, tile, cached[1])
                return cached[0]
            with tempfile.TemporaryDirectory(dir=cache_root) as staging:
                staging_root = Path(staging).resolve(strict=True)
                try:
                    downloaded = earthaccess.download(results, local_path=str(staging_root))
                except Exception:
                    # Avoid propagating exception text which can include auth material.
                    raise RuntimeError("NASADEM download failed (authentication or network error)") from None
                valid = []
                for returned in downloaded or []:
                    path = Path(returned)
                    if path.is_symlink():
                        raise ValueError("download returned a symlink")
                    try:
                        resolved = path.resolve(strict=True)
                    except OSError:
                        continue
                    if not resolved.is_relative_to(staging_root):
                        raise ValueError("download returned a path outside staging")
                    if resolved.is_file():
                        try:
                            with zipfile.ZipFile(resolved) as archive:
                                names = [Path(i.filename).name.lower() for i in archive.infolist() if not i.is_dir() and i.filename.lower().endswith(".hgt")]
                            if resolved.name.lower() != expected_zip or names != [f"{tile}.hgt"]:
                                continue
                            validate_hgt_zip(resolved)
                            valid.append(resolved)
                        except (ValueError, zipfile.BadZipFile):
                            continue
                if len(valid) != 1:
                    raise ValueError("download did not produce exactly one identity-matched complete NASADEM ZIP")
                try:
                    os.link(valid[0], target)
                except FileExistsError:
                    raise ValueError("cache target appeared during acquisition; refusing overwrite")
                digest = validate_hgt_zip(target)
                self._write_receipt(cache_root, tile, digest)
            return target
