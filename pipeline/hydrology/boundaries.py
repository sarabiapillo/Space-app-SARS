"""Offline writer for explicit LISFLOOD-FP perimeter boundaries: closed, FREE or fixed level (HFIX)."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS


SIDES = ("north", "east", "south", "west")
_TYPES = ("closed", "free", "fixed_level")
# Generous bound on a fixed water-surface elevation (metres on the DEM vertical datum).
MAX_ABS_LEVEL_M = 10_000


def normalize_boundary(value):
    """Canonical per-side boundary: ``{side: {"type": ...}}`` with ``level_m`` only for fixed_level.

    A string ``"closed"`` or ``"free"`` applies to all four sides (the original contract).
    """
    if isinstance(value, str) and value in ("closed", "free"):
        return {side: {"type": value} for side in SIDES}
    if not isinstance(value, dict) or set(value) != set(SIDES):
        raise ValueError("boundary must be 'closed', 'free' or an object with north, east, south and west")
    sides = {}
    for side in SIDES:
        spec = value[side]
        if not isinstance(spec, dict) or spec.get("type") not in _TYPES:
            raise ValueError(f"{side}: type must be closed, free or fixed_level")
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
    return sides


def format_free_boundary(dem_path, output_dir):
    """Write four FREE boundaries for every edge of a metric north-up DEM."""
    return format_boundary(dem_path, output_dir, {side: {"type": "free"} for side in SIDES})


def format_boundary(dem_path, output_dir, sides):
    """Write one ``.bci`` line per non-closed side of a metric north-up DEM; closed sides are omitted.

    LISFLOOD-FP treats an edge without a line as a reflective wall. FREE is transmissive (DG2
    ignores a FREE slope) and HFIX imposes a water-surface elevation in metres on the DEM datum.
    This is a format aid, not a domain/outlet selector or a hydraulic-ready input.
    """
    sides = normalize_boundary(sides)
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
        else:
            labels.append(f"{tag}=closed")
    bci = "".join(lines)
    all_free = all(spec["type"] == "free" for spec in sides.values())
    # Verify this unique output target remains absent after raster validation.
    destination.mkdir(parents=False, exist_ok=False)
    (destination / "boundary.bci").write_text(bci, encoding="utf-8")
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
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return destination
