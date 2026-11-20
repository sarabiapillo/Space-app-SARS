"""Antecedent soil moisture for a domain -> Curve Number antecedent moisture condition (AMC I, II or III).

The observation closest before the event is taken from NISAR L3 SME2 (primary) or SMAP L4 (fallback); with no
usable observation the result is AMC II (average) and says so. The AMC chosen here selects ``curve_number.convert_amc``
(Chow et al. 1988 or Hawkins et al. 1985 formulas) when the Curve Number grid is built.

Products (verified 2026-11-20 against CMR and the files themselves):
- NISAR L3 SME2, CMR short name ``NISAR_L3_SME2_PROVISIONAL_V1`` (ASF, C2854344945-ASF), DOI 10.5067/NIL3SME2-P1,
  free and open (NASA ESDIS data use policy). One HDF5 per GCOV frame (~120 MB). Variable
  ``science/LSAR/SME2/grids/soilMoisture`` (float32, m3/m3, _FillValue -9999) on the 200 m EASE-Grid 2.0
  (EPSG:6933, 1-D ``xCoordinates``/``yCoordinates``, HDF5 chunks 512 x 512, so a window read fetches few blocks).
  ``retrievalQualityFlag`` (int16, fill -9999): "The least significant bit indicates whether the retrieval is
  recommended (0 = recommended, 1 = not recommended)"; the other bits only say which algorithms (PMI, TSR, DSG)
  were applied. ``soilMoisture`` falls back to the average of all retrievals when none is recommended, so the
  default here keeps only recommended cells. ``surfaceQualityFlag`` has no bit description in the file and its
  table in the product specification (JPL D-107677) was not read: it is counted, not interpreted. No retrieval is
  provided over urban build-up, permanent snow/ice or permanent inland water (ASF NISAR docs, SME2 page): a city
  domain usually has no SME2 cells and falls back to SMAP. Maturity PROVISIONAL: "should not be considered fully
  calibrated" (ASF); no VALIDATED SME2 collection exists yet. Revisit 12 days per track, 6 with both directions.
- SMAP L4 ``SPL4SMGP`` v008 (NSIDC_CPRD, C3480440870-NSIDC_CPRD), DOI 10.5067/T5RUATAQREF8, free and open.
  Model + data assimilation, global, 3-hourly time averages, 9 km EASE-Grid 2.0 (EPSG:6933, 3856 x 1624).
  ``Geophysical_Data/sm_surface`` (0-5 cm, m3 m-3) and ``sm_surface_wetness`` (0-5 cm, "relative saturation
  between completely dry conditions and completely saturated conditions", dimensionless). Each field is one
  gzip chunk, so a read fetches the whole field (~30 s remote). Wetness uses the L4 model's own porosity, so it is
  used directly as relative saturation (porosity of the L4 land model can be far from a mineral-soil default).
  Access with the team's Earthdata login works without any extra NSIDC application authorization.

Relative saturation for SME2 = theta / porosity, clipped to [0, 1]. Default porosity 0.463 m3/m3 is the Rawls
loam value (saturated water content, Table 4-27 of the TxDOT Hydraulic Design Manual citing Rawls et al. 1993);
it is a texture default, not a per-cell soil map, and can be replaced with a domain value.

AMC cut-offs: ASSUMPTION, no published source for cut-offs on relative saturation (research notes). The
defaults follow the SWAT+ definitions (AMC I = wilting point, AMC III = field capacity) divided by a loam porosity
(Minnesota Stormwater Manual loam: porosity 0.47, field capacity 0.25-0.32, wilting point 0.09-0.15):
relative saturation < 0.30 -> AMC I, > 0.60 -> AMC III, otherwise AMC II. They are parameters, not calibrated.
"""
from __future__ import annotations

import math
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import numpy as np

SME2_SHORT_NAME = "NISAR_L3_SME2_PROVISIONAL_V1"
SME2_LABEL = "NISAR SME2"
SME2_GROUP = "science/LSAR/SME2/grids"
SMAP_SHORT_NAME = "SPL4SMGP"
SMAP_VERSION = "008"
SMAP_LABEL = "SMAP L4"
FILL_VALUE = -9999.0
EASE_CRS = "EPSG:6933"

DEFAULT_MAX_AGE_DAYS = 12.0
DEFAULT_POROSITY = 0.463
POROSITY_SOURCE = ("Rawls loam saturated water content 0.463 m3/m3 (TxDOT Hydraulic Design Manual Table 4-27, "
                   "citing Rawls et al. 1993); texture default, not a per-cell soil map")
DEFAULT_THRESHOLDS = (0.30, 0.60)
THRESHOLDS_SOURCE = ("assumption, no published source for cut-offs on relative saturation: chosen near loam wilting "
                     "point / porosity (AMC I) and field capacity / porosity (AMC III) following the SWAT+ "
                     "definitions; loam values from the Minnesota Stormwater Manual (porosity 0.47, field capacity "
                     "0.25-0.32, wilting point 0.09-0.15)")
SME2_QUALITY_RULE = ("retrievalQualityFlag: the least significant bit marks a retrieval not recommended (1) and "
                     "is masked by default; fill -9999 is masked; surfaceQualityFlag is counted, not interpreted")
NO_DATA_NOTE = "no soil moisture observation usable within max_age_days before the event: AMC II (average) assumed"
CITATIONS = {
    SME2_SHORT_NAME: "NISAR Provisional Soil Moisture (Version 1), NASA ASF DAAC, https://doi.org/10.5067/NIL3SME2-P1",
    SMAP_SHORT_NAME: ("Reichle et al., SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture "
                      "Geophysical Data, Version 8, NSIDC DAAC, https://doi.org/10.5067/T5RUATAQREF8"),
}


def _utc(value):
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("times must be ISO 8601 with a UTC offset") from None
    if moment.tzinfo is None:
        raise ValueError("times must carry a UTC offset")
    return moment.astimezone(timezone.utc)


def _iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _validate_bounds(bounds):
    try:
        west, south, east, north = (float(v) for v in bounds)
    except (TypeError, ValueError):
        raise ValueError("bounds must be (west, south, east, north) in EPSG:4326 degrees") from None
    if not all(map(math.isfinite, (west, south, east, north))):
        raise ValueError("bounds must be finite")
    if not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
        raise ValueError("bounds must satisfy -180 <= west < east <= 180 and -85 <= south < north <= 85")
    return west, south, east, north


def _validate_thresholds(thresholds):
    try:
        dry, wet = (float(v) for v in thresholds)
    except (TypeError, ValueError):
        raise ValueError("thresholds must be (dry, wet) relative saturations") from None
    if not (0 <= dry < wet <= 1):
        raise ValueError("thresholds must satisfy 0 <= dry < wet <= 1")
    return dry, wet


def relative_saturation(theta, *, porosity=DEFAULT_POROSITY):
    """theta (m3/m3) / porosity, clipped to [0, 1]; NaN stays NaN."""
    porosity = float(porosity)
    if not math.isfinite(porosity) or not 0 < porosity <= 1:
        raise ValueError("porosity must be within (0, 1]")
    scalar = np.isscalar(theta)
    out = np.clip(np.asarray(theta, dtype=np.float64) / porosity, 0.0, 1.0)
    return float(out) if scalar else out


def classify_amc(saturation, *, thresholds=DEFAULT_THRESHOLDS):
    """Relative saturation -> AMC. Scalar: 'I' (< dry), 'III' (> wet) or 'II'. Array: uint8 1/2/3, 0 where NaN."""
    dry, wet = _validate_thresholds(thresholds)
    if np.isscalar(saturation):
        value = float(saturation)
        if not math.isfinite(value):
            raise ValueError("saturation must be finite")
        return "I" if value < dry else "III" if value > wet else "II"
    values = np.asarray(saturation, dtype=np.float64)
    out = np.zeros(values.shape, dtype=np.uint8)
    known = np.isfinite(values)
    out[known] = 2
    out[known & (values < dry)] = 1
    out[known & (values > wet)] = 3
    return out


# --- default search and reader (network) ----------------------------------------------------------------------

def earthaccess_search(short_name, bounds, start, end):
    """CMR search through earthaccess; returns [{'id', 'begin', 'end', 'url'}] (the .h5 data link)."""
    import earthaccess

    kwargs = {"version": SMAP_VERSION} if short_name == SMAP_SHORT_NAME else {}
    found = earthaccess.search_data(short_name=short_name, bounding_box=tuple(bounds),
                                    temporal=(_iso(start), _iso(end)), **kwargs)
    granules = []
    for granule in found:
        extent = granule["umm"]["TemporalExtent"]["RangeDateTime"]
        links = [u for u in granule.data_links(access="external") if u.endswith(".h5") and "QA_STATS" not in u]
        granules.append({"id": granule["meta"]["native-id"], "begin": extent["BeginningDateTime"],
                         "end": extent.get("EndingDateTime", extent["BeginningDateTime"]),
                         "url": links[0] if links else None})
    return granules


@contextmanager
def _open_h5(granule, block_size):
    import h5py

    if granule.get("path"):
        with h5py.File(granule["path"], "r") as handle:
            yield handle
        return
    if not granule.get("url"):
        raise ValueError(f"granule {granule.get('id')} has no data URL")
    from pipeline.sources.asf import earthdata_https_fs
    fs = earthdata_https_fs()
    with fs.open(granule["url"], "rb", block_size=block_size, cache_type="blockcache") as fobj:
        with h5py.File(fobj, "r") as handle:
            yield handle


def _text(dataset):
    value = dataset[()]
    return value.decode() if isinstance(value, bytes) else str(value)


def _window(x, y, bounds):
    """Row/column slices of EASE-Grid 2.0 cells (centers x ascending, y descending) overlapping EPSG:4326 bounds."""
    from rasterio.warp import transform
    west, south, east, north = bounds
    xs, ys = transform("EPSG:4326", EASE_CRS, [west, east], [south, north])
    x, y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    half_x, half_y = abs(x[1] - x[0]) / 2, abs(y[1] - y[0]) / 2
    cols = np.where((x - half_x < xs[1]) & (x + half_x > xs[0]))[0]
    rows = np.where((y - half_y < ys[1]) & (y + half_y > ys[0]))[0]
    if not cols.size or not rows.size:
        return None
    from rasterio.transform import Affine
    dx, dy = x[1] - x[0], y[1] - y[0]
    affine = Affine(dx, 0.0, x[cols[0]] - dx / 2, 0.0, dy, y[rows[0]] - dy / 2)
    return slice(rows[0], rows[-1] + 1), slice(cols[0], cols[-1] + 1), affine


def read_granule(short_name, granule, bounds):
    """Default reader: only the cells overlapping ``bounds`` from a local (``path``) or remote (``url``) HDF5."""
    if short_name == SMAP_SHORT_NAME:
        with _open_h5(granule, 4 * 1024 * 1024) as f:
            window = _window(f["x"][:], f["y"][:], bounds)
            if window is None:
                return None
            rows, cols, affine = window
            data = f["Geophysical_Data"]
            return {"soil_moisture": data["sm_surface"][rows, cols], "wetness": data["sm_surface_wetness"][rows, cols],
                    "transform": affine, "crs": EASE_CRS, "attributes": {}}
    with _open_h5(granule, 2 * 1024 * 1024) as f:
        ident = f["science/LSAR/identification"]
        found = _text(ident["granuleId"]) if "granuleId" in ident else None
        if found is None or not str(granule["id"]).startswith(found.removesuffix(".h5")):
            raise ValueError(f"file granuleId {found!r} does not match catalog granule {granule['id']!r}")
        grids = f[SME2_GROUP]
        window = _window(grids["xCoordinates"][:], grids["yCoordinates"][:], bounds)
        if window is None:
            return None
        rows, cols, affine = window
        attributes = {key: _text(ident[name]) for key, name in
                      (("crid", "compositeReleaseId"), ("product_version", "productVersion"), ("doi", "productDoi"))
                      if name in ident}
        out = {"soil_moisture": grids["soilMoisture"][rows, cols], "quality": grids["retrievalQualityFlag"][rows, cols],
               "transform": affine, "crs": EASE_CRS, "attributes": attributes}
        if "surfaceQualityFlag" in grids:
            out["surface_quality"] = grids["surfaceQualityFlag"][rows, cols]
        return out


# --- selection and conversion ---------------------------------------------------------------------------------

def _candidates(granules, event, start, *, by):
    """Granules whose reference time (``by``: 'begin' for SME2, 'end' for SMAP) lies in [start, event], newest first."""
    chosen = []
    for granule in granules:
        moment = _utc(granule[by])
        if start <= moment <= event:
            chosen.append((moment, granule))
    chosen.sort(key=lambda item: item[0], reverse=True)
    return chosen


def _evaluate(short_name, window, *, porosity, include_not_recommended):
    theta = np.asarray(window["soil_moisture"], dtype=np.float64)
    fill = ~np.isfinite(theta) | (theta == FILL_VALUE) | (theta < 0)
    stats = {"cells_total": int(theta.size)}
    if short_name == SMAP_SHORT_NAME:
        wetness = np.asarray(window["wetness"], dtype=np.float64)
        fill |= ~np.isfinite(wetness) | (wetness < 0) | (wetness > 1)
        valid = ~fill
        saturation = np.where(valid, wetness, np.nan)
        stats.update(cells_fill=int(fill.sum()), cells_masked_quality=0, cells_clipped=0)
    else:
        quality = np.asarray(window["quality"], dtype=np.int64)
        fill |= quality == int(FILL_VALUE)
        not_recommended = ~fill & ((quality & 1) == 1)
        valid = ~fill & (np.ones_like(fill) if include_not_recommended else ~not_recommended)
        raw = np.where(valid, theta / porosity, np.nan)
        saturation = np.clip(raw, 0.0, 1.0)
        stats.update(cells_fill=int(fill.sum()),
                     cells_masked_quality=0 if include_not_recommended else int(not_recommended.sum()),
                     cells_clipped=int(np.count_nonzero(np.nan_to_num(raw) > 1)))
        if "surface_quality" in window:
            values, counts = np.unique(np.asarray(window["surface_quality"]), return_counts=True)
            stats["surface_quality_flag_counts"] = {str(int(v)): int(c) for v, c in zip(values, counts)}
    stats["cells_valid"] = int(valid.sum())
    if valid.any():
        stats["soil_moisture_mean_m3m3"] = float(theta[valid].mean())
    return saturation, valid, stats


def antecedent_condition(bounds, event_time_utc, *, max_age_days=DEFAULT_MAX_AGE_DAYS, search=None, reader=None,
                         porosity=DEFAULT_POROSITY, thresholds=DEFAULT_THRESHOLDS, include_not_recommended=False):
    """Antecedent moisture condition for a domain from the observation closest before ``event_time_utc``.

    Tries NISAR SME2 (granules acquired within ``max_age_days`` before the event, newest first, until one has
    usable cells), then SMAP L4 (3-hourly averages ending before the event), else AMC II. ``search(short_name,
    bounds, start, end)`` and ``reader(short_name, granule, bounds)`` are injectable.

    Returns {'amc', 'relative_saturation' (domain mean of usable cells or None), 'source', 'grid' (per cell
    relative saturation and AMC 1/2/3, 0 = no data, on the product grid, or None), 'provenance'}.
    """
    west, south, east, north = _validate_bounds(bounds)
    event = _utc(event_time_utc)
    max_age_days = float(max_age_days)
    if not math.isfinite(max_age_days) or max_age_days <= 0:
        raise ValueError("max_age_days must be finite and positive")
    dry, wet = _validate_thresholds(thresholds)
    relative_saturation(0.0, porosity=porosity)  # validates porosity
    start = event - timedelta(days=max_age_days)
    search, reader = search or earthaccess_search, reader or read_granule
    common = {
        "event_time_utc": _iso(event), "bounds": [west, south, east, north], "max_age_days": max_age_days,
        "thresholds": {"dry": dry, "wet": wet, "rule": "relative saturation < dry -> AMC I, > wet -> AMC III, "
                       "otherwise AMC II", "source": THRESHOLDS_SOURCE},
        "hydraulic_accuracy_validated": False, "tried": [],
    }
    tried = common["tried"]
    for short_name, label, by in ((SME2_SHORT_NAME, SME2_LABEL, "begin"), (SMAP_SHORT_NAME, SMAP_LABEL, "end")):
        try:
            found = search(short_name, (west, south, east, north), start, event)
        except Exception as exc:  # noqa: BLE001 - a failed source falls back to the next one, recorded
            tried.append({"source": label, "short_name": short_name, "outcome": "error", "reason": str(exc)})
            continue
        candidates = _candidates(found or [], event, start, by=by)
        if not candidates:
            tried.append({"source": label, "short_name": short_name, "outcome": "no_granule",
                          "reason": f"no granule within {max_age_days:g} days before the event"})
            continue
        for moment, granule in candidates:
            try:
                window = reader(short_name, granule, (west, south, east, north))
            except Exception as exc:  # noqa: BLE001 - try the next granule, recorded
                tried.append({"source": label, "granule_id": granule["id"], "outcome": "error", "reason": str(exc)})
                continue
            if window is None:
                tried.append({"source": label, "granule_id": granule["id"], "outcome": "outside_grid",
                              "reason": "domain outside the product grid"})
                continue
            saturation, valid, stats = _evaluate(short_name, window, porosity=float(porosity),
                                                 include_not_recommended=include_not_recommended)
            if not valid.any():
                tried.append({"source": label, "granule_id": granule["id"], "outcome": "no_valid_cells",
                              "reason": "every cell over the domain is fill or masked by quality"})
                continue
            mean = float(np.nanmean(saturation))
            tried.append({"source": label, "granule_id": granule["id"], "outcome": "used"})
            return {"amc": classify_amc(mean, thresholds=(dry, wet)), "relative_saturation": mean, "source": label,
                    "grid": {"relative_saturation": saturation,
                             "amc": classify_amc(saturation, thresholds=(dry, wet)),
                             "transform": window.get("transform"), "crs": window.get("crs")},
                    "provenance": _provenance(common, short_name, granule, moment, event, window, stats,
                                              porosity=float(porosity),
                                              include_not_recommended=include_not_recommended)}
    return {"amc": "II", "relative_saturation": None, "source": None, "grid": None,
            "provenance": dict(common, note=NO_DATA_NOTE, method="none: no observation, AMC II assumed")}


def _provenance(common, short_name, granule, moment, event, window, stats, *, porosity, include_not_recommended):
    attributes = window.get("attributes") or {}
    prov = dict(common, **stats)
    prov.update({
        "short_name": short_name, "granule_id": granule["id"], "url": granule.get("url"),
        "granule_file": str(granule.get("url") or granule.get("path") or "").replace("\\", "/").rsplit("/", 1)[-1]
        or None,
        "acquisition_start_utc": _iso(_utc(granule["begin"])), "acquisition_end_utc": _iso(_utc(granule["end"])),
        "age_hours": round((event - moment).total_seconds() / 3600.0, 3), "citation": CITATIONS[short_name],
        "aggregation": "unweighted mean of the usable product cells overlapping the domain bounds",
    })
    if short_name == SME2_SHORT_NAME:
        prov.update({
            "version": "1", "maturity": "PROVISIONAL", "crid": attributes.get("crid"),
            "product_version": attributes.get("product_version"), "doi": attributes.get("doi", "10.5067/NIL3SME2-P1"),
            "variable": f"{SME2_GROUP}/soilMoisture", "units": "m3/m3", "grid": "EASE-Grid 2.0 200 m (EPSG:6933)",
            "age_reference": "acquisition start",
            "porosity": {"value": porosity, "source": POROSITY_SOURCE if porosity == DEFAULT_POROSITY
                         else "value given by the caller"},
            "quality_rule": SME2_QUALITY_RULE if not include_not_recommended else
            SME2_QUALITY_RULE.replace("is masked by default", "is kept (include_not_recommended=True)"),
            "method": "relative saturation = soilMoisture / porosity, clipped to [0, 1]; AMC by thresholds",
            "warnings": ["SME2 PROVISIONAL is not fully calibrated (ASF); accuracy goal 0.06 m3/m3 only where "
                         "vegetation water content < 5 kg/m2",
                         "SME2 has no retrieval over urban build-up, permanent snow/ice or inland water"],
        })
    else:
        prov.update({
            "version": SMAP_VERSION, "maturity": "SMAP L4 v008 (model + data assimilation)",
            "variable": "Geophysical_Data/sm_surface", "units": "m3/m3",
            "saturation_variable": "sm_surface_wetness", "grid": "EASE-Grid 2.0 9 km (EPSG:6933)",
            "age_reference": "end of the 3-hourly averaging period",
            "method": "relative saturation = sm_surface_wetness (0-5 cm, L4 model porosity); AMC by thresholds",
            "warnings": ["SMAP L4 is a 9 km model analysis: one value usually covers the whole domain"],
        })
    return prov
