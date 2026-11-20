"""ESA WorldCover 2021 v200 land cover -> per-cell Manning's n for LISFLOOD-FP (DG2 and FV1).

Data source (verified 2026-11-20):
- ESA WorldCover 10 m 2021 v200, Cloud-Optimized GeoTIFF, EPSG:4326, 3x3 degree tiles (2651 tiles) in the
  public AWS bucket ``esa-worldcover`` (eu-central-1), readable without an account:
  ``https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_<TILE>_Map.tif``.
  ``<TILE>`` is the south-west corner, multiples of 3 degrees, e.g. ``N15W096`` covers lon -96..-93, lat 15..18
  (grid index: ``v200/2021/esa_worldcover_grid.geojson`` in the same bucket). Tiles exist from S60 to N81
  (lat -60..84). Pixel size 1/12000 degree, tiled 1024x1024, deflate, nodata 0.
- Licence CC BY 4.0. Attribution (the tile metadata ``copyright`` tag and https://esa-worldcover.org/en/data-access):
  "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA
  WorldCover consortium". Citation: Zanaga, D. et al. (2022) ESA WorldCover 10 m 2021 v200,
  https://doi.org/10.5281/zenodo.7254221.

Outside observed land: "The WorldCover product is constrained to all land areas observed by Sentinel-2 in
either 2020 or 2021 except for areas in Antarctica" (Product User Manual v2.0, section 3.4.2). Only tiles touching
land exist (an absent tile returns HTTP 404, e.g. N00W141), and inside existing tiles the open sea beyond that
footprint is 0 (nodata; observed near the Galapagos, N00W093), while near-shore sea is 80 (observed offshore Puerto
Chiapas). ``outside_policy="water"`` (default) maps both missing tiles and 0 pixels to class 80 (permanent water),
so sea cells get water roughness and keep their rain; ``"unknown"`` keeps them as 0 (Manning NODATA -> LISFLOOD-FP
``fpfric``; no Curve Number). Both counts are recorded in the provenance.

How LISFLOOD-FP 8.0 reads ``manningfile`` (``data/tools/lisflood-fp-8.0/runtime/source``): ``pars.cpp:234`` maps
the keyword to ``Fnameptr->nfilename``; ``input.cpp:914-938`` (``LoadManningsn``) skips five header pairs, reads
the sixth as the NODATA value, then ``ysz`` rows of ``xsz`` values, first row = north row (same layout as the
DEM), replacing NODATA cells by ``fpfric``. ``lisflood.cpp:470`` loads it for every solver before dispatch, and
both ``swe/dg2/friction.cpp:22-23`` (DG2) and ``swe/fv1.cpp:138-139`` (FV1) use ``Arrptr->Manningsn[j*xsz+i]``
when it is loaded. The header values themselves are not checked by the solver, so this module copies the
6-line header of ``terrain.dem`` and checks the shape.
"""
from __future__ import annotations

import math
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window

WORLDCOVER_URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
                  "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif")
PIXELS_PER_DEGREE = 12000
TILE_DEGREES = 3
COVERAGE_LAT = (-60.0, 84.0)
NODATA_CLASS = 0
WATER_CLASS = 80
BUILT_CLASS = 50
OUTSIDE_POLICIES = ("water", "unknown")
ATTRIBUTION = ("© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) "
               "processed by ESA WorldCover consortium")
CLASS_NAMES = {10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up",
               60: "Bare / sparse vegetation", 70: "Snow and ice", 80: "Permanent water bodies",
               90: "Herbaceous wetland", 95: "Mangroves", 100: "Moss and lichen"}

_AZZAM = "Azzam WorldCover table in GRASS r.manning (min/normal/max)"
_HECRAS = "HEC-RAS 2D User's Manual 6.6 NLCD deep-flow table (via GRASS r.manning)"
# Proposal from research_notes/Fuentes para simulador de inundación/suelo_cobertura_infiltracion.md (table
# "Tabla propuesta para el simulador"), derived from the deep-flow tables cited there; not a calibration.
# Sources: https://raw.githubusercontent.com/OSGeo/grass-addons/grass8/src/raster/r.manning/r.manning.py
MANNING_TABLE = {
    10: {"n": 0.10, "low": 0.07, "high": 0.14, "source": f"{_AZZAM} 0.094; {_HECRAS} forest 0.12-0.14"},
    20: {"n": 0.07, "low": 0.045, "high": 0.10, "source": f"{_AZZAM} 0.066; {_HECRAS} shrub 0.10"},
    30: {"n": 0.035, "low": 0.025, "high": 0.05, "source": f"{_AZZAM} 0.033; {_HECRAS} grassland 0.035"},
    40: {"n": 0.035, "low": 0.02, "high": 0.05, "source": f"{_AZZAM} 0.035; {_HECRAS} cultivated 0.030"},
    50: {"n": 0.10, "low": 0.06, "high": 0.16,
         "source": f"{_HECRAS} developed low-medium intensity 0.085-0.10 (block roughness: 30 m DSMs such as "
                   "NASADEM/Copernicus do not resolve individual buildings)"},
    60: {"n": 0.025, "low": 0.011, "high": 0.035, "source": f"{_AZZAM} 0.023; {_HECRAS} barren 0.030"},
    70: {"n": 0.02, "low": 0.010, "high": 0.030, "source": _AZZAM},
    80: {"n": 0.035, "low": 0.025, "high": 0.045, "source": f"{_AZZAM} / {_HECRAS} open water 0.035"},
    90: {"n": 0.07, "low": 0.05, "high": 0.12, "source": f"{_HECRAS} emergent herbaceous wetland 0.06; {_AZZAM} 0.09"},
    95: {"n": 0.15, "low": 0.10, "high": 0.30, "source": f"{_AZZAM} 0.225 (0.15-0.30); {_HECRAS} woody wetland 0.10"},
    100: {"n": 0.06, "low": 0.040, "high": 0.080, "source": _AZZAM},
}
# Alternative built-up branch, only valid when buildings are represented in the DEM (bare-earth DEM with
# buildings burnt in as obstacles): asphalt/concrete roughness.
BUILT_IN_DEM = {"n": 0.018, "low": 0.013, "high": 0.025, "source": f"{_AZZAM} built-up 0.018 (pavement)"}
URBAN_BRANCHES = ("buildings_not_in_dem", "buildings_in_dem")
SCENARIOS = {"normal": "n", "low": "low", "high": "high"}


def _validate_bounds(bounds, coverage_lat):
    try:
        west, south, east, north = (float(v) for v in bounds)
    except (TypeError, ValueError):
        raise ValueError("bounds must be (west, south, east, north) in EPSG:4326 degrees") from None
    if not all(map(math.isfinite, (west, south, east, north))):
        raise ValueError("bounds must be finite")
    if not (-180 <= west < east <= 180):
        raise ValueError("bounds must satisfy -180 <= west < east <= 180; crossing the antimeridian is not supported")
    if not (coverage_lat[0] <= south < north <= coverage_lat[1]):
        raise ValueError(f"bounds latitude must lie within dataset coverage {coverage_lat} with south < north")
    return west, south, east, north


def _tile_name(lat0, lon0):
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}"


def _tile_origins(bounds):
    west, south, east, north = _validate_bounds(bounds, COVERAGE_LAT)
    lats = range(math.floor(south / TILE_DEGREES) * TILE_DEGREES, math.ceil(north / TILE_DEGREES) * TILE_DEGREES,
                 TILE_DEGREES)
    lons = range(math.floor(west / TILE_DEGREES) * TILE_DEGREES, math.ceil(east / TILE_DEGREES) * TILE_DEGREES,
                 TILE_DEGREES)
    return [(lat0, lon0) for lat0 in lats for lon0 in lons]


def worldcover_tiles(bounds):
    """Names of the 3x3 degree WorldCover tiles intersecting EPSG:4326 ``bounds`` (west, south, east, north)."""
    return [_tile_name(lat0, lon0) for lat0, lon0 in _tile_origins(bounds)]


def worldcover_tile_url(tile):
    return WORLDCOVER_URL.format(tile=tile)


def _is_missing_object(url):
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=30):
            return False
    except urllib.error.HTTPError as exc:
        return exc.code in (403, 404)


def read_tile_window(url, window):
    """Default reader: HTTP range reads of only the blocks in ``window`` (col_off, row_off, width, height).

    Returns ``None`` when the tile object does not exist (HTTP 403/404 from the public bucket).
    """
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_USE_HEAD": "NO", "GDAL_HTTP_MAX_RETRY": "3",
           "GDAL_HTTP_RETRY_DELAY": "2"}
    try:
        with rasterio.Env(**env), rasterio.open("/vsicurl/" + url) as src:
            if src.count != 1 or src.width != TILE_DEGREES * PIXELS_PER_DEGREE or src.height != src.width:
                raise ValueError(f"unexpected WorldCover tile geometry: {url}")
            return src.read(1, window=Window(*window))
    except rasterio.errors.RasterioIOError:
        if _is_missing_object(url):
            return None
        raise


def _snap(value, fn):
    return fn(round(value * PIXELS_PER_DEGREE, 6))


def fetch_worldcover(bounds, *, reader=None, max_pixels=40_000_000, outside_policy="water"):
    """Mosaic WorldCover classes on the native 10 m grid covering ``bounds`` (snapped outward).

    ``reader(url, window)`` returns a uint8 array for the tile-relative window or ``None`` for a missing tile;
    the default reads only the needed blocks over HTTPS.
    """
    if outside_policy not in OUTSIDE_POLICIES:
        raise ValueError(f"outside_policy must be one of {OUTSIDE_POLICIES}")
    reader = reader or read_tile_window
    origins = _tile_origins(bounds)
    west, south, east, north = (float(v) for v in bounds)
    west_px, east_px = _snap(west, math.floor), _snap(east, math.ceil)
    south_px, north_px = _snap(south, math.floor), _snap(north, math.ceil)
    height, width = north_px - south_px, east_px - west_px
    if height * width > max_pixels:
        raise ValueError(f"WorldCover request of {height * width} pixels exceeds max_pixels ({max_pixels})")
    mosaic = np.zeros((height, width), dtype=np.uint8)
    used, missing, urls = [], [], []
    for lat0, lon0 in origins:
        tile = _tile_name(lat0, lon0)
        tile_west, tile_top = lon0 * PIXELS_PER_DEGREE, (lat0 + TILE_DEGREES) * PIXELS_PER_DEGREE
        x0, x1 = max(west_px, tile_west), min(east_px, tile_west + TILE_DEGREES * PIXELS_PER_DEGREE)
        y_top, y_bottom = min(north_px, tile_top), max(south_px, lat0 * PIXELS_PER_DEGREE)
        if x1 <= x0 or y_top <= y_bottom:
            continue
        window = (x0 - tile_west, tile_top - y_top, x1 - x0, y_top - y_bottom)
        url = worldcover_tile_url(tile)
        data = reader(url, window)
        rows = slice(north_px - y_top, north_px - y_bottom)
        cols = slice(x0 - west_px, x1 - west_px)
        if data is None:
            missing.append(tile)
            continue
        data = np.asarray(data)
        if data.shape != (window[3], window[2]):
            raise ValueError(f"WorldCover reader returned shape {data.shape} for window {window}")
        mosaic[rows, cols] = data
        used.append(tile)
        urls.append(url)
    missing_pixels = 0
    for tile in missing:
        lat0 = (-1 if tile[0] == "S" else 1) * int(tile[1:3])
        lon0 = (-1 if tile[3] == "W" else 1) * int(tile[4:7])
        x0 = max(west_px, lon0 * PIXELS_PER_DEGREE) - west_px
        x1 = min(east_px, (lon0 + TILE_DEGREES) * PIXELS_PER_DEGREE) - west_px
        y0 = north_px - min(north_px, (lat0 + TILE_DEGREES) * PIXELS_PER_DEGREE)
        y1 = north_px - max(south_px, lat0 * PIXELS_PER_DEGREE)
        missing_pixels += (x1 - x0) * (y1 - y0)
    outside = int(np.count_nonzero(mosaic == NODATA_CLASS)) - missing_pixels
    if outside_policy == "water":
        mosaic[mosaic == NODATA_CLASS] = WATER_CLASS
    step = 1.0 / PIXELS_PER_DEGREE
    transform = from_origin(west_px * step, north_px * step, step, step)
    provenance = {
        "dataset": "ESA WorldCover 10 m 2021 v200", "version": "v200", "year": 2021,
        "doi": "10.5281/zenodo.7254221", "licence": "CC BY 4.0", "attribution": ATTRIBUTION,
        "tiles": used, "tile_urls": urls, "missing_tiles": missing,
        "missing_tile_pixels": missing_pixels, "outside_land_pixels": outside, "outside_policy": outside_policy,
        "outside_policy_note": ("missing tiles and value-0 pixels lie outside the Sentinel-2 observed land area "
                                "(PUM v2.0 s3.4.2); 'water' maps them to class 80, 'unknown' keeps 0"),
        "bounds_requested": [west, south, east, north],
        "grid": {"crs": "EPSG:4326", "transform": list(transform)[:6], "shape": [height, width]},
    }
    return {"classes": mosaic, "transform": transform, "crs": "EPSG:4326", "provenance": provenance}


def resample_classes(classes, src_transform, src_crs, dst_shape, dst_transform, dst_crs):
    """Mode-resample classes to the target grid and compute the built-up (class 50) fraction per cell.

    The fraction is the share of valid (non-zero) source pixels of class 50 inside each target cell.
    """
    classes = np.asarray(classes, dtype=np.uint8)
    out = np.zeros(dst_shape, dtype=np.uint8)
    reproject(classes, out, src_transform=src_transform, src_crs=CRS.from_user_input(src_crs),
              dst_transform=dst_transform, dst_crs=CRS.from_user_input(dst_crs), src_nodata=NODATA_CLASS,
              dst_nodata=NODATA_CLASS, resampling=Resampling.mode)
    built = np.where(classes == NODATA_CLASS, np.nan, (classes == BUILT_CLASS).astype(np.float64))
    fraction = np.full(dst_shape, np.nan, dtype=np.float64)
    reproject(built, fraction, src_transform=src_transform, src_crs=CRS.from_user_input(src_crs),
              dst_transform=dst_transform, dst_crs=CRS.from_user_input(dst_crs), src_nodata=np.nan,
              dst_nodata=np.nan, resampling=Resampling.average)
    return {"classes": out, "built_fraction": fraction}


def manning_entry(code, *, urban_branch="buildings_not_in_dem"):
    if urban_branch not in URBAN_BRANCHES:
        raise ValueError(f"urban_branch must be one of {URBAN_BRANCHES}")
    if code == BUILT_CLASS and urban_branch == "buildings_in_dem":
        return BUILT_IN_DEM
    return MANNING_TABLE[code]


def manning_grid(classes, *, scenario="normal", urban_branch="buildings_not_in_dem"):
    """Per-cell Manning's n (s m^-1/3); NaN where the class is 0 (unknown)."""
    if scenario not in SCENARIOS:
        raise ValueError(f"scenario must be one of {tuple(SCENARIOS)}")
    classes = np.asarray(classes)
    unknown = set(np.unique(classes).tolist()) - set(MANNING_TABLE) - {NODATA_CLASS}
    if unknown:
        raise ValueError(f"unknown WorldCover classes: {sorted(unknown)}")
    grid = np.full(classes.shape, np.nan, dtype=np.float64)
    for code in MANNING_TABLE:
        grid[classes == code] = manning_entry(code, urban_branch=urban_branch)[SCENARIOS[scenario]]
    return grid


def _header_from_transform(shape, transform):
    if transform.b != 0 or transform.d != 0 or transform.a <= 0 or not math.isclose(transform.a, -transform.e):
        raise ValueError("transform must be an unrotated north-up square-cell grid")
    height, width = shape
    yll = transform.f + height * transform.e
    return (f"ncols {width}\nnrows {height}\nxllcorner {transform.c:.17g}\nyllcorner {yll:.17g}\n"
            f"cellsize {transform.a:.17g}\nNODATA_value -9999\n")


def write_manning_file(path, manning, *, template_dem=None, transform=None, nodata=-9999):
    """Write an ESRI ASCII ``manningfile`` on the solver grid. NaN cells become NODATA (solver uses fpfric).

    With ``template_dem`` (e.g. ``terrain.dem``) its first six header lines are copied verbatim; otherwise the
    header is built from ``transform`` exactly as ``dem_dg2.py`` writes ``terrain.dem``.
    """
    path = Path(path)
    manning = np.asarray(manning, dtype=np.float64)
    if manning.ndim != 2:
        raise ValueError("manning must be a 2-D grid")
    finite = manning[np.isfinite(manning)]
    if np.isinf(manning).any() or finite.size == 0 or np.any(finite <= 0) or np.any(finite >= 1):
        raise ValueError("Manning's n must be finite, 0 < n < 1, with at least one known cell")
    if template_dem is not None:
        lines = Path(template_dem).read_text(encoding="ascii").splitlines(keepends=True)[:6]
        fields = {line.split()[0].lower(): line.split()[1] for line in lines}
        if int(fields["ncols"]) != manning.shape[1] or int(fields["nrows"]) != manning.shape[0]:
            raise ValueError("Manning grid shape differs from the template DEM header")
        header = "".join(lines)
        nodata_text = fields.get("nodata_value", str(nodata))
    elif transform is not None:
        header = _header_from_transform(manning.shape, transform)
        nodata_text = str(nodata)
    else:
        raise ValueError("template_dem or transform is required")
    if path.exists():
        raise FileExistsError("Manning file already exists; refusing overwrite")
    values = np.where(np.isfinite(manning), manning, float(nodata_text))
    body = "\n".join(" ".join(f"{v:.6g}" for v in row) for row in values) + "\n"
    path.write_text(header + body, encoding="ascii")
    return path


def landcover_for_grid(dst_shape, dst_transform, dst_crs, *, reader=None, scenario="normal",
                       urban_branch="buildings_not_in_dem", max_pixels=40_000_000, outside_policy="water"):
    """Fetch WorldCover over a metric solver grid and return mode classes, built-up fraction and Manning."""
    height, width = dst_shape
    left, top = dst_transform.c, dst_transform.f
    right, bottom = left + width * dst_transform.a, top + height * dst_transform.e
    west, south, east, north = transform_bounds(CRS.from_user_input(dst_crs), "EPSG:4326", left, bottom, right, top,
                                                densify_pts=21)
    pad = 2.0 / PIXELS_PER_DEGREE
    fetched = fetch_worldcover((max(-180.0, west - pad), max(COVERAGE_LAT[0], south - pad),
                                min(180.0, east + pad), min(COVERAGE_LAT[1], north + pad)),
                               reader=reader, max_pixels=max_pixels, outside_policy=outside_policy)
    resampled = resample_classes(fetched["classes"], fetched["transform"], fetched["crs"], dst_shape,
                                 dst_transform, dst_crs)
    manning = manning_grid(resampled["classes"], scenario=scenario, urban_branch=urban_branch)
    provenance = dict(fetched["provenance"])
    provenance.update({
        "resampling": {"classes": "mode", "built_fraction": "average of class-50 indicator over valid pixels"},
        "target_grid": {"crs": CRS.from_user_input(dst_crs).to_string(), "transform": list(dst_transform)[:6],
                        "shape": list(dst_shape)},
        "manning": {"table": "WorldCover deep-flow proposal (research notes 2026-11-20), not calibrated",
                    "scenario": scenario, "urban_branch": urban_branch,
                    "values": {str(code): manning_entry(code, urban_branch=urban_branch)[SCENARIOS[scenario]]
                               for code in MANNING_TABLE}},
        "class_counts": {str(int(k)): int(v) for k, v in zip(*np.unique(resampled["classes"], return_counts=True))},
    })
    return {"classes": resampled["classes"], "built_fraction": resampled["built_fraction"], "manning": manning,
            "provenance": provenance}
