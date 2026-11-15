"""Offline writer for explicitly idealized LISFLOOD-FP FREE perimeter boundaries."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS


def format_free_boundary(dem_path, output_dir):
    """Write four FREE boundaries for every edge of a metric north-up DEM.

    This is a format aid, not a domain/outlet selector or a hydraulic-ready input.
    The caller explicitly chooses the computational DEM and destination.
    """
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

    bci = (f"N {coordinate(xmin)} {coordinate(xmax)} FREE\n"
           f"E {coordinate(ymin)} {coordinate(ymax)} FREE\n"
           f"S {coordinate(xmin)} {coordinate(xmax)} FREE\n"
           f"W {coordinate(ymin)} {coordinate(ymax)} FREE\n")
    # Verify this unique output target remains absent after raster validation.
    destination.mkdir(parents=False, exist_ok=False)
    (destination / "boundary.bci").write_text(bci, encoding="utf-8")
    manifest = {
        "source": {"path": str(source), "format": "single-band GeoTIFF"},
        "grid": grid,
        "method": "all four computational DEM edges; FREE without supplied slope",
        "semantics": "idealized FREE boundary per LISFLOOD-FP 8.0 CPU DG2; not an observed outlet; may permit inflow or outflow",
        "synthetic": True, "idealized": True, "hydraulic_ready": False,
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return destination
