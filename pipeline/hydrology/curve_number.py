"""Curve Number (SCS-CN) per cell from ESA WorldCover + HYSOGs250m, and incremental net rain per cell.

LISFLOOD-FP 8.0 DG2/FV1 do not run infiltration (rain is added to depth without losses), so losses enter as
net rain per cell in the NetCDF forcing (see research_notes/.../suelo_cobertura_infiltracion.md).

Hydrologic soil groups (verified 2026-11-20):
- HYSOGs250m, Ross et al. (2018), ORNL DAAC, https://doi.org/10.3334/ORNLDAAC/1566. NASA Earthdata (CMR) short
  name ``Global_Hydrologic_Soil_Group_1566`` v1, provider ``ORNL_CLOUD`` (collection C2216864285-ORNL_CLOUD).
  One GeoTIFF ``HYSOGs250m.tif`` (571.8 MB; uint8; EPSG:4326; 1/480 degree; 172800 x 67200 px; tiled 128x128,
  LZW; lat -56..84). Protected URL (Earthdata Login):
  https://data.ornldaac.earthdata.nasa.gov/protected/global_soil/Global_Hydrologic_Soil_Group/data/HYSOGs250m.tif
- Coding (user guide, section 2): 1 A, 2 B, 3 C, 4 D, 11 A/D, 12 B/D, 13 C/D, 14 D/D; nodata 255. Dual groups
  mark a water table within 60 cm: high runoff potential unless drained.
- Dual-group rule (default ``undrained``): dual groups use D, as GCN250 did ("Zones that have dual hydrological
  soil groups were assumed to be undrained", Jaafar et al. 2019). ``drained`` uses the first letter.
- Missing HSG (nodata, e.g. water bodies or outside coverage) is filled with ``missing_hsg`` (default ``D``,
  the conservative, highest-runoff group) and counted in the summary.
- Remote reads: open the protected URL with the authenticated earthaccess session to get the signed CloudFront
  URL (HTTP 303), then let GDAL range-read only the window over ``/vsicurl/`` (~7 s per window). A local copy can
  be used instead via ``local_path``.

Curve Numbers (AMC/ARC II, Ia = 0.2 S): GCN250 "Online-only Table 1" (Jaafar, Ahmad & El Beyrouthy 2019,
Scientific Data 6:145, https://doi.org/10.1038/s41597-019-0155-x, CC BY 4.0), built from USDA NEH-630 tables.
WorldCover classes are cross-walked to the closest ESA CCI-LC class rows of that table; the crosswalk is this
project's assumption and is recorded in ``CN_TABLE``.

AMC conversion: Chow, Maidment & Mays (1988), Applied Hydrology, eqs. 5.5.4-5.5.5 (default) and Hawkins et al.
(1985) approximation of NEH-4 Table 10.1; both recorded as formulas, not calibrated for any region.

Initial abstraction ratio (default lambda = Ia/S = 0.05, option 0.2). The tabulated CNs above (and the AMC
conversion) assume lambda = 0.2. Hawkins et al. (2002) and Woodward et al. (2003) refitted rainfall-runoff event
data of US small watersheds and found lambda = 0.05 fits better; with it the retention must be converted:
``S0.05 = 1.33 S0.20^1.15`` with S in inches, i.e. ``S0.05 = 1.33 * 25.4^-0.15 * S0.20^1.15 = 0.8187 S0.20^1.15``
with S in mm, equivalently ``CN0.05 = 100 / (1.879 (100/CN0.20 - 1)^1.15 + 1)`` (1.879 = 1.33 * 10^0.15).
Order: tabulated CN (lambda 0.2) -> AMC condition (on the lambda 0.2 basis) -> S conversion to lambda 0.05.
Effect: runoff starts earlier (Ia = 0.05 S0.05 is smaller) and small and short storms give more runoff; for large
depths the converted S is larger, so lambda 0.05 can give somewhat less (CN 78.6: about equal at P = 60 mm).
The fit is not calibrated for any region of this project. References:
- Hawkins, R.H., Jiang, R., Woodward, D.E., Hjelmfelt, A.T., Van Mullem, J.A. (2002). Runoff curve number method:
  examination of the initial abstraction ratio. Proceedings of the Second Federal Interagency Hydrologic Modeling
  Conference, Las Vegas, NV.
- Woodward, D.E., Hawkins, R.H., Jiang, R., Hjelmfelt, A.T., Van Mullem, J.A., Quan, Q.D. (2003). Runoff curve
  number method: examination of the initial abstraction ratio. World Water & Environmental Resources Congress
  2003, ASCE, https://doi.org/10.1061/40685(2003)308.
The conversion form S0.05 = 1.33 S0.20^1.15 (inches) was checked 2026-11-20 on the Wikipedia article "Runoff curve
number" (section on the initial abstraction ratio), which cites Hawkins et al. (2002).
"""
from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds

HYSOGS_SHORT_NAME = "Global_Hydrologic_Soil_Group_1566"
HYSOGS_URL = ("https://data.ornldaac.earthdata.nasa.gov/protected/global_soil/Global_Hydrologic_Soil_Group/data/"
              "HYSOGs250m.tif")
HYSOGS_COVERAGE_LAT = (-56.0, 84.0)
HYSOGS_NODATA = 255
HSG_CODES = {1: "A", 2: "B", 3: "C", 4: "D", 11: "A/D", 12: "B/D", 13: "C/D", 14: "D/D"}
HSG_INDEX = {"A": 1, "B": 2, "C": 3, "D": 4}
DUAL_RULES = ("undrained", "drained")

_GCN = "GCN250 Online-only Table 1 (Jaafar et al. 2019), ESA CCI-LC"
CN_TABLE = {
    10: {"cn": (35, 59, 72, 79), "source": f"{_GCN} 60 tree cover broadleaved deciduous (other tree rows: "
                                           "A 31-44, B 56-64, C 70-76, D 77-82)"},
    20: {"cn": (48, 66, 77, 83), "source": f"{_GCN} 120 shrubland"},
    30: {"cn": (54, 71, 81, 86), "source": f"{_GCN} 130 grassland"},
    40: {"cn": (57, 68, 75, 78), "source": f"{_GCN} 10 cropland rainfed"},
    50: {"cn": (70, 82, 88, 91), "source": f"{_GCN} 190 urban areas"},
    60: {"cn": (77, 86, 91, 94), "source": f"{_GCN} 200 bare areas"},
    70: {"cn": (100, 100, 100, 100), "source": "assumption: snow/ice treated as impervious (no GCN250 value)"},
    80: {"cn": (100, 100, 100, 100), "source": "GCN250 Table 1 PFT 'Water' CN 100 (rain on water is not lost)"},
    90: {"cn": (57, 72, 82, 86), "source": f"{_GCN} 180 shrub or herbaceous cover, flooded"},
    95: {"cn": (46, 65, 76, 82), "source": f"{_GCN} 170 tree cover, flooded, saline water"},
    100: {"cn": (54, 71, 81, 86), "source": f"{_GCN} 140 lichens and mosses"},
}
AMC_METHODS = ("chow", "hawkins")
# Initial abstraction ratio lambda = Ia / S: 0.05 (default, converted S) or 0.2 (the tabulated CN basis).
LAMBDA_OPTIONS = (0.05, 0.2)
DEFAULT_LAMBDA = 0.05
TABULATED_LAMBDA = 0.2
# S0.05 = 1.33 S0.20^1.15 with S in inches -> the coefficient for S in mm.
S005_COEFFICIENT_MM = 1.33 * 25.4 ** -0.15
S005_EXPONENT = 1.15
LAMBDA_CITATION = ("Hawkins, Jiang, Woodward, Hjelmfelt and Van Mullem (2002), Runoff curve number method: examination "
                   "of the initial abstraction ratio, 2nd Federal Interagency Hydrologic Modeling Conference; Woodward "
                   "et al. (2003), World Water & Environmental Resources Congress, ASCE, doi:10.1061/40685(2003)308")
URBAN_DRAINAGE_REFERENCE_MM_H = 12.0  # Environment Agency (England) national surface-water map drainage rate.


def decode_hsg(values, *, dual="undrained"):
    """HYSOGs codes -> HSG index 1..4 (A..D); 0 where nodata or unknown."""
    if dual not in DUAL_RULES:
        raise ValueError(f"dual must be one of {DUAL_RULES}")
    values = np.asarray(values)
    out = np.zeros(values.shape, dtype=np.uint8)
    for code in (1, 2, 3, 4):
        out[values == code] = code
    for code in (11, 12, 13, 14):
        out[values == code] = 4 if dual == "undrained" else code - 10
    return out


def _validate_bounds(bounds):
    try:
        west, south, east, north = (float(v) for v in bounds)
    except (TypeError, ValueError):
        raise ValueError("bounds must be (west, south, east, north) in EPSG:4326 degrees") from None
    if not all(map(math.isfinite, (west, south, east, north))):
        raise ValueError("bounds must be finite")
    if not -180 <= west < east <= 180:
        raise ValueError("bounds must satisfy -180 <= west < east <= 180; crossing the antimeridian is not supported")
    if not HYSOGS_COVERAGE_LAT[0] <= south < north <= HYSOGS_COVERAGE_LAT[1]:
        raise ValueError(f"bounds latitude must lie within HYSOGs250m coverage {HYSOGS_COVERAGE_LAT}")
    return west, south, east, north


def _authenticated_session():
    import earthaccess
    for strategy in ("environment", "netrc"):
        try:
            auth = earthaccess.login(strategy=strategy, persist=False)
        except Exception:  # noqa: BLE001 - try the next non-interactive strategy
            continue
        if auth is not None and getattr(auth, "authenticated", False):
            return earthaccess.get_requests_https_session()
    raise RuntimeError("Earthdata login failed (EARTHDATA_USERNAME/EARTHDATA_PASSWORD or .netrc required)")


def _signed_url(url):
    session = _authenticated_session()
    response = session.get(url, headers={"Range": "bytes=0-0"}, stream=True, timeout=60)
    try:
        if response.status_code not in (200, 206):
            raise RuntimeError(f"HYSOGs250m request failed with HTTP {response.status_code}")
        return response.url
    finally:
        response.close()


def _read_window(path, bounds):
    with rasterio.open(path) as src:
        window = from_bounds(*bounds, transform=src.transform).round_offsets(op="floor").round_lengths(op="ceil")
        col_off, row_off = max(0, int(window.col_off) - 1), max(0, int(window.row_off) - 1)
        width = min(src.width - col_off, int(window.width) + 3)
        height = min(src.height - row_off, int(window.height) + 3)
        window = rasterio.windows.Window(col_off, row_off, width, height)
        return {"values": src.read(1, window=window), "transform": src.window_transform(window),
                "crs": src.crs.to_string()}


def read_hysogs_window(bounds, *, local_path=None):
    """Default reader: local copy if given (or ``HYSOGS_LOCAL_PATH``), else a windowed remote read."""
    local_path = local_path or os.environ.get("HYSOGS_LOCAL_PATH")
    if local_path and Path(local_path).is_file():
        result = _read_window(local_path, bounds)
        result["source"] = f"local copy {Path(local_path).name}"
        return result
    signed = _signed_url(HYSOGS_URL)
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_USE_HEAD": "NO", "GDAL_HTTP_MAX_RETRY": "3",
           "GDAL_HTTP_RETRY_DELAY": "2"}
    with rasterio.Env(**env):
        result = _read_window("/vsicurl/" + signed, bounds)
    result["source"] = HYSOGS_URL
    return result


def fetch_hysogs(bounds, *, reader=None):
    """Raw HYSOGs250m codes for EPSG:4326 ``bounds`` (padded by one pixel). ``reader(bounds)`` is injectable."""
    bounds = _validate_bounds(bounds)
    result = (reader or read_hysogs_window)(bounds)
    if result is None:
        raise RuntimeError("HYSOGs250m reader returned no data")
    provenance = {"dataset": "HYSOGs250m (Ross et al. 2018)", "short_name": HYSOGS_SHORT_NAME, "version": "1",
                  "provider": "ORNL_CLOUD (NASA Earthdata)", "doi": "10.3334/ORNLDAAC/1566",
                  "url": HYSOGS_URL, "source": result.get("source"), "bounds_requested": list(bounds),
                  "coding": {str(k): v for k, v in HSG_CODES.items()}, "nodata": HYSOGS_NODATA,
                  "citation": "Ross, C.W. et al. 2018. Global Hydrologic Soil Groups (HYSOGs250m) for Curve "
                              "Number-Based Runoff Modeling. ORNL DAAC. https://doi.org/10.3334/ORNLDAAC/1566"}
    return {"values": np.asarray(result["values"], dtype=np.uint8), "transform": result["transform"],
            "crs": result["crs"], "provenance": provenance}


def resample_hsg(values, src_transform, src_crs, dst_shape, dst_transform, dst_crs):
    """Nearest-neighbour resampling of raw HYSOGs codes (categorical) to the target grid; 255 = nodata."""
    out = np.full(dst_shape, HYSOGS_NODATA, dtype=np.uint8)
    reproject(np.asarray(values, dtype=np.uint8), out, src_transform=src_transform,
              src_crs=CRS.from_user_input(src_crs), dst_transform=dst_transform, dst_crs=CRS.from_user_input(dst_crs),
              src_nodata=HYSOGS_NODATA, dst_nodata=HYSOGS_NODATA, resampling=Resampling.nearest)
    return out


def hsg_for_grid(dst_shape, dst_transform, dst_crs, *, reader=None, dual="undrained"):
    """Fetch HYSOGs over a metric grid; return HSG index (1..4, 0 unknown) and provenance."""
    height, width = dst_shape
    left, top = dst_transform.c, dst_transform.f
    right, bottom = left + width * dst_transform.a, top + height * dst_transform.e
    west, south, east, north = transform_bounds(CRS.from_user_input(dst_crs), "EPSG:4326", left, bottom, right, top,
                                                densify_pts=21)
    fetched = fetch_hysogs((west, south, east, north), reader=reader)
    raw = resample_hsg(fetched["values"], fetched["transform"], fetched["crs"], dst_shape, dst_transform, dst_crs)
    provenance = dict(fetched["provenance"], dual_rule=dual, resampling="nearest",
                      nodata_cells=int(np.count_nonzero(raw == HYSOGS_NODATA)))
    return {"hsg": decode_hsg(raw, dual=dual), "raw": raw, "provenance": provenance}


def convert_amc(cn, to, *, method="chow"):
    """Convert CN(II) to antecedent moisture condition ``to`` in {"I", "II", "III"}.

    chow (Chow et al. 1988): CN(I) = 4.2 CN / (10 - 0.058 CN); CN(III) = 23 CN / (10 + 0.13 CN).
    hawkins (Hawkins et al. 1985): CN(I) = CN / (2.281 - 0.01281 CN); CN(III) = CN / (0.427 + 0.00573 CN).
    """
    if to not in ("I", "II", "III"):
        raise ValueError("to must be 'I', 'II' or 'III'")
    if method not in AMC_METHODS:
        raise ValueError(f"method must be one of {AMC_METHODS}")
    scalar = np.isscalar(cn)
    cn = np.asarray(cn, dtype=np.float64)
    if to == "II":
        out = cn.copy()
    elif method == "chow":
        out = 4.2 * cn / (10 - 0.058 * cn) if to == "I" else 23 * cn / (10 + 0.13 * cn)
    else:
        out = cn / (2.281 - 0.01281 * cn) if to == "I" else cn / (0.427 + 0.00573 * cn)
    out = np.minimum(out, 100.0)
    return float(out) if scalar else out


def curve_number_grid(classes, hsg, *, missing_hsg="D", amc="II", amc_method="chow"):
    """CN per cell from WorldCover classes and HSG index (1..4, 0 unknown). NaN where the class is unknown."""
    if missing_hsg not in HSG_INDEX:
        raise ValueError("missing_hsg must be one of 'A', 'B', 'C', 'D'")
    classes, hsg = np.asarray(classes), np.asarray(hsg)
    if classes.shape != hsg.shape:
        raise ValueError("classes and hsg must have the same shape")
    unknown = set(np.unique(classes).tolist()) - set(CN_TABLE) - {0}
    if unknown:
        raise ValueError(f"unknown WorldCover classes: {sorted(unknown)}")
    groups = np.where(np.isin(hsg, (1, 2, 3, 4)), hsg, HSG_INDEX[missing_hsg]).astype(np.int64)
    cn = np.full(classes.shape, np.nan, dtype=np.float64)
    for code, entry in CN_TABLE.items():
        selected = classes == code
        cn[selected] = np.asarray(entry["cn"], dtype=np.float64)[groups[selected] - 1]
    return convert_amc(cn, amc, method=amc_method) if amc != "II" else cn


def _check_lambda(initial_abstraction_ratio):
    if initial_abstraction_ratio not in LAMBDA_OPTIONS:
        raise ValueError(f"initial_abstraction_ratio must be one of {LAMBDA_OPTIONS}")


def retention_mm(cn, *, initial_abstraction_ratio=DEFAULT_LAMBDA):
    """Potential retention S (mm) for a tabulated CN (lambda 0.2 basis) and the chosen lambda.

    S0.20 = 25400/CN - 254; with lambda 0.05, S0.05 = 0.8187 S0.20^1.15 (Hawkins et al. 2002, S0.05 = 1.33
    S0.20^1.15 in inches). CN 100 gives S = 0 for both.
    """
    _check_lambda(initial_abstraction_ratio)
    scalar = np.isscalar(cn)
    cn = np.asarray(cn, dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.maximum(25400.0 / cn - 254.0, 0.0)
        if initial_abstraction_ratio != TABULATED_LAMBDA:
            s = S005_COEFFICIENT_MM * s ** S005_EXPONENT
    return float(s) if scalar else s


def curve_number_for_lambda(cn, *, initial_abstraction_ratio=DEFAULT_LAMBDA):
    """CN that gives ``retention_mm`` with the usual S = 25400/CN - 254 (CN0.05 for lambda 0.05)."""
    s = retention_mm(cn, initial_abstraction_ratio=initial_abstraction_ratio)
    out = 25400.0 / (254.0 + np.asarray(s, dtype=np.float64))
    return float(out) if np.isscalar(cn) else out


def initial_abstraction_provenance(initial_abstraction_ratio=DEFAULT_LAMBDA):
    """Record of lambda and, for 0.05, the S conversion applied to the tabulated CNs."""
    _check_lambda(initial_abstraction_ratio)
    converted = initial_abstraction_ratio != TABULATED_LAMBDA
    return {"initial_abstraction_ratio": initial_abstraction_ratio, "tabulated_cn_ratio": TABULATED_LAMBDA,
            "conversion": ("S0.05 = 1.33 S0.20^1.15 (S in inches) = 0.8187 S0.20^1.15 (S in mm); "
                           "CN0.05 = 100 / (1.879 (100/CN0.20 - 1)^1.15 + 1); applied after the AMC conversion")
            if converted else None,
            "citation": LAMBDA_CITATION if converted else "SCS (1956) / USDA NEH-630 chapter 10: Ia = 0.2 S"}


def scs_runoff_mm(rain_mm, cn, *, initial_abstraction_ratio=DEFAULT_LAMBDA):
    """Cumulative SCS-CN direct runoff Q (mm) for cumulative rain P (mm) and a tabulated CN (lambda 0.2 basis).

    S from ``retention_mm`` (converted for lambda 0.05), Ia = lambda S, Q = (P - Ia)^2 / (P - Ia + S) for P > Ia,
    else 0. lambda is 0.05 (default) or 0.2 (the tabulated CN as is).
    """
    scalar = np.isscalar(rain_mm) and np.isscalar(cn)
    p = np.asarray(rain_mm, dtype=np.float64)
    cn = np.asarray(cn, dtype=np.float64)
    s = retention_mm(cn, initial_abstraction_ratio=initial_abstraction_ratio)
    with np.errstate(divide="ignore", invalid="ignore"):
        ia = initial_abstraction_ratio * s
        excess = np.maximum(p - ia, 0.0)
        denominator = excess + s
        q = np.where(excess > 0, excess * excess / np.where(denominator > 0, denominator, 1.0), 0.0)
    q = np.where(cn >= 100, p, q)
    q = np.where(np.isnan(cn), np.nan, np.minimum(q, p))
    return float(q) if scalar else q


def _segment_depths(segments):
    if not isinstance(segments, (list, tuple)) or not segments:
        raise ValueError("segments must be a non-empty list")
    edges, depths = [], []
    for segment in segments:
        try:
            start, end = float(segment["start_s"]), float(segment["end_s"])
            hours = (end - start) / 3600.0
            if "mm" in segment:
                depth = float(segment["mm"])
            elif "intensity_mm_h" in segment:
                depth = float(segment["intensity_mm_h"]) * hours
            else:
                depth = float(segment["intensity_m_s"]) * (end - start) * 1000.0
        except (KeyError, TypeError, ValueError, OverflowError):
            raise ValueError("invalid rainfall segment") from None
        if not all(map(math.isfinite, (start, end, depth))) or start < 0 or end <= start or depth < 0:
            raise ValueError("rainfall segments must be finite, ordered and nonnegative")
        if edges and edges[-1] != start:
            raise ValueError("rainfall segments must be exactly contiguous")
        if not edges:
            if start != 0:
                raise ValueError("rainfall segments must start at zero")
            edges.append(start)
        edges.append(end)
        depths.append(depth)
    return np.asarray(edges), np.asarray(depths)


def net_rain_cube(segments, cn_grid, *, initial_abstraction_ratio=DEFAULT_LAMBDA, built_fraction=None,
                  urban_drainage_mm_h=0.0):
    """Incremental SCS-CN runoff per interval and cell (mm), shape (intervals, rows, cols).

    Uniform rain from ``segments`` ({start_s, end_s} plus mm, intensity_mm_h or intensity_m_s) is accumulated;
    net_k = Q(P_k) - Q(P_k-1), never negative. Urban drainage (default 0 mm/h; 12 mm/h is the England national
    reference, a borrowed assumption) removes up to rate x interval hours of that interval's runoff in the built
    share f of each cell: net_k -= f * min(net_k, rate * dt_h); unused capacity is not carried over.
    Cells without CN get zero net rain. ``cn_grid`` holds tabulated CNs (lambda 0.2 basis, AMC applied);
    with lambda 0.05 the retention is converted (see ``retention_mm``).
    """
    _check_lambda(initial_abstraction_ratio)
    edges, depths = _segment_depths(segments)
    cn_grid = np.asarray(cn_grid, dtype=np.float64)
    if cn_grid.ndim != 2:
        raise ValueError("cn_grid must be 2-D")
    known = np.isfinite(cn_grid)
    if np.any((cn_grid[known] <= 0) | (cn_grid[known] > 100)):
        raise ValueError("CN must be within (0, 100]")
    if not math.isfinite(urban_drainage_mm_h) or urban_drainage_mm_h < 0:
        raise ValueError("urban_drainage_mm_h must be finite and nonnegative")
    fraction = np.zeros(cn_grid.shape) if built_fraction is None else np.nan_to_num(
        np.asarray(built_fraction, dtype=np.float64), nan=0.0)
    if fraction.shape != cn_grid.shape or np.any((fraction < 0) | (fraction > 1)):
        raise ValueError("built_fraction must match cn_grid and lie within [0, 1]")
    cumulative = np.concatenate(([0.0], np.cumsum(depths)))
    cn_safe = np.where(known, cn_grid, 100.0)
    q = np.stack([scs_runoff_mm(p, cn_safe, initial_abstraction_ratio=initial_abstraction_ratio) for p in cumulative])
    increments = np.maximum(np.diff(q, axis=0), 0.0)
    capacity = urban_drainage_mm_h * np.diff(edges) / 3600.0
    removed = fraction[None] * np.minimum(increments, capacity[:, None, None])
    cube = np.maximum(increments - removed, 0.0)
    cube[:, ~known] = 0.0
    removed[:, ~known] = 0.0
    total = float(cumulative[-1])
    runoff = cube.sum(axis=0)[known]
    summary = {
        "method": "scs_curve_number_incremental", "intervals": int(len(depths)), "total_rain_mm": total,
        "cells": int(cn_grid.size), "cells_with_cn": int(known.sum()),
        "initial_abstraction_ratio": float(initial_abstraction_ratio), "tabulated_cn_ratio": TABULATED_LAMBDA,
        "urban_drainage_mm_h": float(urban_drainage_mm_h),
        "mean_runoff_mm": float(runoff.mean()) if runoff.size else 0.0,
        "mean_runoff_coefficient": float(runoff.mean() / total) if runoff.size and total > 0 else 0.0,
        "mean_drainage_removed_mm": float(removed.sum(axis=0)[known].mean()) if runoff.size else 0.0,
        "cn_min": float(np.nanmin(cn_grid)) if known.any() else None,
        "cn_max": float(np.nanmax(cn_grid)) if known.any() else None,
        "cn_mean": float(np.nanmean(cn_grid)) if known.any() else None,
        "cn_mean_effective": float(np.mean(curve_number_for_lambda(cn_grid[known],
                                                                   initial_abstraction_ratio=initial_abstraction_ratio)))
        if known.any() else None,
        "interval_edges_s": edges.tolist(), "interval_rain_mm": depths.tolist(),
    }
    return cube, summary
