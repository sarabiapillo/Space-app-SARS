"""Offline writer for explicit LISFLOOD-FP perimeter boundaries: closed, FREE, fixed level (HFIX) or tide (HVAR)."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS

from .tides import write_bdy


SIDES = ("north", "east", "south", "west")
_TYPES = ("closed", "free", "fixed_level", "tide")
# Generous bound on a fixed water-surface elevation (metres on the DEM vertical datum).
MAX_ABS_LEVEL_M = 10_000
# Tide sides: the MDT that moves EOT20 levels (about mean sea level) to EGM2008. 'DTUUH22MDT' samples the DTU
# grid, a number is an explicit offset in metres, None leaves the levels on mean sea level.
TIDE_MDT_DEFAULT = "DTUUH22MDT"
MAX_ABS_MDT_M = 10
# Name of the one HVAR series every tide side reads from boundary.bdy.
TIDE_SERIES_NAME = "tide"


def _tide_mdt(side, spec):
    if not set(spec) <= {"type", "mdt"}:
        raise ValueError(f"{side}: tide takes only mdt")
    mdt = spec.get("mdt", TIDE_MDT_DEFAULT)
    if mdt is None or mdt == TIDE_MDT_DEFAULT:
        return mdt
    if (isinstance(mdt, bool) or not isinstance(mdt, (int, float)) or not math.isfinite(mdt)
            or abs(mdt) > MAX_ABS_MDT_M):
        raise ValueError(f"{side}: tide mdt must be 'DTUUH22MDT', a number of metres (|mdt| <= 10) or null")
    return float(mdt)


def normalize_boundary(value):
    """Canonical per-side boundary: ``{side: {"type": ...}}`` with ``level_m`` only for fixed_level.

    A string ``"closed"`` or ``"free"`` applies to all four sides (the original contract). A ``tide`` side
    (``{"type": "tide", "mdt": ...}``, mdt optional, 'DTUUH22MDT' by default) reads one shared time series,
    so every tide side of a boundary must name the same mdt.
    """
    if isinstance(value, str) and value in ("closed", "free"):
        return {side: {"type": value} for side in SIDES}
    if not isinstance(value, dict) or set(value) != set(SIDES):
        raise ValueError("boundary must be 'closed', 'free' or an object with north, east, south and west")
    sides = {}
    for side in SIDES:
        spec = value[side]
        if not isinstance(spec, dict) or spec.get("type") not in _TYPES:
            raise ValueError(f"{side}: type must be closed, free, fixed_level or tide")
        if spec["type"] == "tide":
            sides[side] = {"type": "tide", "mdt": _tide_mdt(side, spec)}
            continue
        if spec["type"] != "fixed_level":
            if set(spec) != {"type"}:
                raise ValueError(f"{side}: only fixed_level takes level_m")
            sides[side] = {"type": spec["type"]}
            continue
        level = spec.get("level_m")
        if (set(spec) != {"type", "level_m"} or isinstance(level, bool) or not isinstance(level, (int, float))
                or not math.isfinite(level) or abs(level) > MAX_ABS_LEVEL_M):
            raise ValueError(f"{side}: fixed_level needs a finite level_m in metres")
        sides[side] = {"type": "fixed_level", "level_m": float(level)}
    if len({repr(spec["mdt"]) for spec in sides.values() if spec["type"] == "tide"}) > 1:
        raise ValueError("tide sides share one series: give every tide side the same mdt")
    return sides


def format_free_boundary(dem_path, output_dir):
    """Write four FREE boundaries for every edge of a metric north-up DEM."""
    return format_boundary(dem_path, output_dir, {side: {"type": "free"} for side in SIDES})


def format_boundary(dem_path, output_dir, sides, tide=None):
    """Write one ``.bci`` line per non-closed side of a metric north-up DEM; closed sides are omitted.

    LISFLOOD-FP treats an edge without a line as a reflective wall. FREE is transmissive (DG2
    ignores a FREE slope) and HFIX imposes a water-surface elevation in metres on the DEM datum.
    A tide side is ``HVAR tide``: ``tide`` (``[(time_s, level_m), ...]``, levels on the DEM datum) is
    written to ``boundary.bdy`` beside the ``.bci``; the solver interpolates it linearly in time and
    holds its first and last values outside it. Every tide side reads the same series.
    This is a format aid, not a domain/outlet selector or a hydraulic-ready input.
    """
    sides = normalize_boundary(sides)
    has_tide = any(spec["type"] == "tide" for spec in sides.values())
    if has_tide != (tide is not None):
        raise ValueError("tide sides need a tide series, and a tide series needs a tide side")
    if has_tide:
        tide = [(float(t), float(level)) for t, level in tide]
        times = [t for t, _ in tide]
        if (not tide or any(not math.isfinite(level) or abs(level) > MAX_ABS_LEVEL_M for _, level in tide)
                or not all(math.isfinite(t) for t in times) or any(b <= a for a, b in zip(times, times[1:]))):
            raise ValueError("tide series needs finite levels in metres at strictly increasing times")
    if all(spec["type"] == "closed" for spec in sides.values()):
        raise ValueError("all sides closed: no boundary file is needed")
    if not isinstance(dem_path, (str, Path)) or not str(dem_path):
        raise ValueError("dem_path must identify a GeoTIFF")
    if not isinstance(output_dir, (str, Path)) or not str(output_dir):
        raise ValueError("output_dir must identify a new directory")
    source = Path(dem_path)
    destination = Path(output_dir)
    if destination.exists():
        raise FileExistsError("output directory already exists; refusing overwrite")

    with rasterio.open(source) as raster:
        if raster.count != 1 or raster.width < 2 or raster.height < 2:
            raise ValueError("DEM must have one band and at least two rows and columns")
        if raster.crs is None:
            raise ValueError("DEM must have a projected metre CRS")
        crs = CRS.from_user_input(raster.crs)
        if (not crs.is_projected or not crs.axis_info or any(
            axis.unit_name.lower() not in {"metre", "meter"} or axis.unit_conversion_factor != 1
            for axis in crs.axis_info[:2]
        )):
            raise ValueError("DEM must have a projected metre CRS")
        transform = raster.transform
        if transform.a <= 0 or transform.e >= 0 or transform.b != 0 or transform.d != 0:
            raise ValueError("DEM must be north-up with no rotation")
        if not math.isclose(transform.a, -transform.e, rel_tol=0, abs_tol=1e-9):
            raise ValueError("DEM must use square cells")
        bounds = raster.bounds
        if not all(math.isfinite(value) for value in bounds) or bounds.left >= bounds.right or bounds.bottom >= bounds.top:
            raise ValueError("DEM grid bounds must be finite and non-empty")
        values = raster.read(1)
        edge = np.concatenate((values[0, :], values[-1, :], values[1:-1, 0], values[1:-1, -1]))
        invalid = ~np.isfinite(edge)
        if raster.nodata is not None:
            invalid |= edge == raster.nodata
        if invalid.any():
            raise ValueError("DEM edge coverage must be finite and valid; nodata cannot be declared open")
        grid = {
            "width": raster.width, "height": raster.height,
            "cell_size_m": float(transform.a),
            "bounds_m": {"xmin": float(bounds.left), "ymin": float(bounds.bottom),
                         "xmax": float(bounds.right), "ymax": float(bounds.top)},
            "crs": crs.to_string(),
        }

    xmin, ymin = grid["bounds_m"]["xmin"], grid["bounds_m"]["ymin"]
    xmax, ymax = grid["bounds_m"]["xmax"], grid["bounds_m"]["ymax"]
    def coordinate(value):
        return str(int(value)) if float(value).is_integer() else format(value, ".15g")

    edges = (("north", "N", xmin, xmax), ("east", "E", ymin, ymax),
             ("south", "S", xmin, xmax), ("west", "W", ymin, ymax))
    lines, labels = [], []
    for side, tag, start, end in edges:
        spec = sides[side]
        if spec["type"] == "free":
            lines.append(f"{tag} {coordinate(start)} {coordinate(end)} FREE\n")
            labels.append(f"{tag}=FREE")
        elif spec["type"] == "fixed_level":
            level = format(spec["level_m"], ".15g")
            lines.append(f"{tag} {coordinate(start)} {coordinate(end)} HFIX {level}\n")
            labels.append(f"{tag}=HFIX {level} m")
        elif spec["type"] == "tide":
            lines.append(f"{tag} {coordinate(start)} {coordinate(end)} HVAR {TIDE_SERIES_NAME}\n")
            labels.append(f"{tag}=HVAR {TIDE_SERIES_NAME}")
        else:
            labels.append(f"{tag}=closed")
    bci = "".join(lines)
    all_free = all(spec["type"] == "free" for spec in sides.values())
    # Verify this unique output target remains absent after raster validation.
    destination.mkdir(parents=False, exist_ok=False)
    (destination / "boundary.bci").write_text(bci, encoding="utf-8")
    if has_tide:
        write_bdy(tide, destination / "boundary.bdy", TIDE_SERIES_NAME,
                  comment="LISFLOOD-FP HVAR tide series: level_m time_s (metres on the DEM vertical datum)")
    manifest = {
        "source": {"path": str(source), "format": "single-band GeoTIFF"},
        "grid": grid,
        "sides": sides,
        "method": ("all four computational DEM edges; FREE without supplied slope" if all_free
                   else "per-side computational DEM edges: " + ", ".join(labels)),
        "semantics": ("idealized FREE boundary per LISFLOOD-FP 8.0 CPU DG2; not an observed outlet; may permit inflow or outflow"
                      if all_free else
                      "LISFLOOD-FP 8.0 CPU DG2: FREE idealized transmissive (slope ignored); HFIX fixed water-surface "
                      "elevation in metres on the DEM vertical datum; closed sides omitted (reflective wall)"),
        "synthetic": True, "idealized": True, "hydraulic_ready": False,
    }
    if has_tide:
        levels = [level for _, level in tide]
        manifest["semantics"] += ("; HVAR time-varying water-surface elevation from boundary.bdy, linear in time, "
                                  "first and last values held outside the series")
        manifest["tide"] = {"file": "boundary.bdy", "name": TIDE_SERIES_NAME, "count": len(tide),
                            "start_s": tide[0][0], "end_s": tide[-1][0], "min_m": min(levels), "max_m": max(levels)}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return destination
