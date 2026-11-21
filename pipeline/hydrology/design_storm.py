"""Design storms anywhere in the world from PXR-4 return levels and an alternating-block hyetograph.

Dataset: Parametrized eXtreme Rain, PXR-4 v2.1.0 (Courty, Wilby, Hillier and Slater 2019,
"Intensity-duration-frequency curves at the global scale", Environ. Res. Lett. 14:084045). Zenodo
record DOI 10.5281/zenodo.3351812 (all versions: 10.5281/zenodo.1467858), file ``pxr4-2.1.0.nc``
(netCDF3, 299,027,580 bytes, md5 ab064e9a03be2035550a1bb3ad4c4717). Licence: ODC Open Database
License (ODbL) v1.0, which allows commercial use with attribution; a database derived from it and
made public must also be ODbL (share-alike on the database, not on produced works such as maps).
Source data: ERA5-HRES total precipitation 1979-2018, "Generated using Copernicus Climate Change
Service information [2019]" (Copernicus licence, commercial use allowed). Checked 2026-11-20 on the
Zenodo record and in the file's global attributes.

Why PXR-4 and not GPEX: GPEX v4 (DOI 10.4121/12764429.v4) is published as CC BY 4.0 but its readme
says it "contain[s] modified MSWEP-V2.2 data", and MSWEP is CC BY-NC 4.0 (excluded by the project's
open-licence rule), so its licence chain is unclear; it also starts at 3 h. PXR-4 is open, starts at
1 h and gives a continuous curve in duration, which the alternating-block method needs.

Method. On a 0.25° grid (cell centres, longitude 0-359.75 E) PXR-4 stores four parameters per cell.
The GEV location and scale of the annual-maximum intensity (mm/h) for a duration D in hours are
``mu = a * D**alpha`` and ``sigma = b * D**beta`` (a log-log regression over 19 durations, 1-360 h).
The shape is fixed for the whole dataset at ``GEV_SHAPE = -0.114`` (value and sign convention from
the authors' ``pxr_examples.py`` for v2.1.0, github.com/lrntct/pxr; negative is the heavy-tailed
Fréchet type). The return level for T years is ``mu + sigma * (1 - (-ln(1 - 1/T))**shape) / shape``
in mm/h, times D for the depth in mm. The nearest cell to the point is used, with no interpolation.
The authors state PXR-4 is within ±20 % of the per-duration fits (PXR-2) only for 2-360 h; between
1 and 2 h it is fitted data outside that range (``within_stated_accuracy`` false). Below 1 h the same
power law is extended beyond the fitted range and the result is flagged ``extrapolated``; there is
no sub-hourly data behind it.

Known bias (read before using a depth). Reanalysis- and satellite-based IDF curves smooth short
convective extremes: ERA5 is a ~28 km areal mean from a model that parameterises convection, so
1-3 h return levels are likely conservative (low) in tropical convective climates such as Chiapas,
and a cell average is lower than a point peak (areal reduction, more so for short durations). See
``research_notes/Fuentes para simulador de inundación/lluvia.md`` (design-storm and spatial
downscaling sections): these are inferences from those notes, not a validation, and no comparison of
PXR against Mexican pluviograph IDF curves was found. Where local IDF curves exist (in Mexico, the
SCT isoyetas), they should be preferred or compared. Any flood run forced by a design storm keeps
``hydraulic_accuracy_validated: false``.

Hyetograph: alternating-block method. The depths P(kΔt) for k = 1..n come from the curve above; the
increments P(kΔt) - P((k-1)Δt) are sorted from largest to smallest and placed at the centre block,
then alternately right and left. The blocks add up exactly to P(nΔt). Segments use the same
``{start_s, end_s, mm}`` format as observed rain (``rainfall.observed_rainfall_profile``).

Prepare the cache once (git-ignored, ~300 MB, public download, no account):
    python -m pipeline.hydrology.design_storm prepare
Look up a return level:
    python -m pipeline.hydrology.design_storm level <lon> <lat> <duration_h> <return_period_years>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from scipy.io import netcdf_file

from pipeline.hydrology.rainfall import MAX_INTERVALS

DATASET = "PXR-4"
VERSION = "2.1.0"
DOI = "10.5281/zenodo.3351812"
CONCEPT_DOI = "10.5281/zenodo.1467858"
LICENCE = "ODC Open Database License (ODbL) v1.0"
LICENCE_URL = "http://opendatacommons.org/licenses/odbl/1.0/"
ATTRIBUTION = ("PXR v2.1.0, Courty, L.G., Wilby, R.L., Hillier, J.K., Slater, L.J. (2019), Environ. Res. Lett. "
               "14:084045, doi:10.5281/zenodo.3351812, ODbL v1.0. Generated using Copernicus Climate Change "
               "Service information [2019] (ERA5 1979-2018).")
FILE_NAME = "pxr4-2.1.0.nc"
FILE_URL = "https://zenodo.org/api/records/3351812/files/pxr4-2.1.0.nc/content"
FILE_MD5 = "ab064e9a03be2035550a1bb3ad4c4717"
DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "reference" / "pxr" / FILE_NAME

GEV_SHAPE = -0.114  # fixed for the whole PXR v2.1.0 dataset
MIN_FITTED_H = 1.0
MAX_FITTED_H = 360.0
STATED_ACCURACY_H = (2.0, 360.0)  # PXR-4 within ±20 % of PXR-2 in this range


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} debe ser un número finito")
    return float(value)


def _check_point(lon, lat):
    lon, lat = _number(lon, "lon"), _number(lat, "lat")
    if not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise ValueError("lon debe estar en [-180, 180] y lat en [-90, 90]")
    return lon, lat


def _check_duration(duration_h):
    duration_h = _number(duration_h, "duration_h")
    if not 0 < duration_h <= MAX_FITTED_H:
        raise ValueError(f"duration_h debe estar en (0, {MAX_FITTED_H:g}] horas")
    return duration_h


def _check_period(return_period_years):
    period = _number(return_period_years, "return_period_years")
    # T = 1 year is the annual-maximum quantile with probability 0: it has no finite value.
    if period <= 1:
        raise ValueError("return_period_years debe ser mayor que 1 año")
    return period


def _reduced_variate(period):
    return (1 - (-math.log(1 - 1 / period)) ** GEV_SHAPE) / GEV_SHAPE


def _depth_mm(params, duration_h, period):
    location = params["a"] * duration_h ** params["alpha"]
    scale = params["b"] * duration_h ** params["beta"]
    return (location + scale * _reduced_variate(period)) * duration_h


class Pxr4Reader:
    """Reads the four PXR-4 parameters of the nearest cell from the cached netCDF3 file (memory-mapped)."""

    def __init__(self, path=DEFAULT_PATH):
        self.path = Path(path)

    def __call__(self, lon, lat):
        if not self.path.exists():
            raise FileNotFoundError(f"{self.path} no existe: ejecuta `python -m pipeline.hydrology.design_storm prepare`")
        with netcdf_file(self.path, "r", mmap=True) as f:
            lats = np.array(f.variables["latitude"][:], dtype=float)
            lons = np.array(f.variables["longitude"][:], dtype=float)
            lat_diff = np.abs(lats - lat)
            lon_diff = np.abs((lons - lon % 360 + 180) % 360 - 180)
            i, j = int(np.argmin(lat_diff)), int(np.argmin(lon_diff))
            for diff, axis in ((lat_diff, lats), (lon_diff, lons)):
                step = float(np.median(np.abs(np.diff(axis)))) if axis.size > 1 else 0.0
                if diff.min() > step / 2 + 1e-6:
                    raise ValueError("el punto está fuera de la malla PXR-4")
            values = {name: float(f.variables[name][i, j]) for name in ("a", "alpha", "b", "beta")}
            quality = {name: float(f.variables[name][i, j]) for name in ("location_r2", "scale_r2") if name in f.variables}
            cell = {"lat": float(lats[i]), "lon": float(lons[j]), "lat_index": i, "lon_index": j, **quality}
            del lats, lons
        if not all(math.isfinite(v) for v in values.values()):
            raise ValueError(f"la celda PXR-4 ({cell['lat']}, {cell['lon']}) está sin parámetros")
        return {**values, "cell": cell}


def _read(lon, lat, reader):
    found = (reader or Pxr4Reader())(lon, lat)
    params = {name: float(found[name]) for name in ("a", "alpha", "b", "beta")}
    return params, found["cell"]


def _provenance(params, cell, duration_h, period, extrapolated):
    method = (f"GEV quantile of annual-maximum intensity, shape {GEV_SHAPE} fixed, location a*D^alpha and "
              f"scale b*D^beta (mm/h, D in h), depth = intensity * D, nearest 0.25° ERA5 cell, no interpolation")
    if extrapolated:
        method += f"; duration below the {MIN_FITTED_H:g} h fitted minimum: PXR-4 power law extrapolated"
    return {"dataset": DATASET, "version": VERSION, "doi": DOI, "concept_doi": CONCEPT_DOI, "licence": LICENCE,
            "licence_url": LICENCE_URL, "attribution": ATTRIBUTION, "file": FILE_NAME, "file_md5": FILE_MD5,
            "cell": cell, "parameters": params, "gev_shape": GEV_SHAPE, "duration_h": duration_h,
            "return_period_years": period, "method": method}


def return_level(lon, lat, duration_h, return_period_years, *, reader=None):
    """Depth (mm) for a duration and return period at a point, with provenance and range flags.

    ``reader(lon, lat)`` returns ``{a, alpha, b, beta, cell}``; the default reads the PXR-4 cache.
    """
    lon, lat = _check_point(lon, lat)
    duration_h, period = _check_duration(duration_h), _check_period(return_period_years)
    params, cell = _read(lon, lat, reader)
    extrapolated = duration_h < MIN_FITTED_H
    return {"mm": _depth_mm(params, duration_h, period), "extrapolated": extrapolated,
            "within_stated_accuracy": STATED_ACCURACY_H[0] <= duration_h <= STATED_ACCURACY_H[1],
            "provenance": _provenance(params, cell, duration_h, period, extrapolated)}


def return_level_mm(lon, lat, duration_h, return_period_years, *, reader=None):
    """Return-level depth in mm (see ``return_level`` for the provenance)."""
    return return_level(lon, lat, duration_h, return_period_years, reader=reader)["mm"]


def alternating_block(cumulative_mm, step_s):
    """Alternating-block segments from cumulative depths P(Δt), P(2Δt), … P(nΔt) in mm."""
    increments = [b - a for a, b in zip([0.0, *cumulative_mm], cumulative_mm)]
    if any(x < 0 for x in increments):
        raise ValueError("la curva IDF no es monótona en la duración: no se puede armar el hietograma")
    n, centre = len(increments), (len(increments) - 1) // 2
    order = [centre]
    for k in range(1, n):
        order += [p for p in (centre + k, centre - k) if 0 <= p < n]
    depths = [0.0] * n
    for position, depth in zip(order, sorted(increments, reverse=True)):
        depths[position] = depth
    return [{"start_s": k * step_s, "end_s": (k + 1) * step_s, "mm": depths[k]} for k in range(n)]


def design_storm(lon, lat, duration_h, return_period_years, step_s, *, reader=None):
    """Alternating-block design storm of ``duration_h`` hours in blocks of ``step_s`` seconds.

    Returns ``segments`` ({start_s, end_s, mm}, contiguous from 0) for the observed-rain path, the
    total depth, the ``extrapolated`` flag (any block shorter than 1 h) and the provenance.
    """
    lon, lat = _check_point(lon, lat)
    duration_h, period = _check_duration(duration_h), _check_period(return_period_years)
    step = _number(step_s, "step_s")
    duration_s = duration_h * 3600
    if step <= 0 or step != int(step):
        raise ValueError("step_s debe ser un número entero positivo de segundos")
    step = int(step)
    blocks = round(duration_s / step)
    if blocks < 1 or not math.isclose(blocks * step, duration_s, rel_tol=0, abs_tol=1e-6):
        raise ValueError("step_s debe dividir exactamente la duración")
    if blocks > MAX_INTERVALS:
        raise ValueError(f"la tormenta tendría más de {MAX_INTERVALS} intervalos")
    params, cell = _read(lon, lat, reader)
    cumulative = [_depth_mm(params, k * step / 3600, period) for k in range(1, blocks + 1)]
    segments = alternating_block(cumulative, step)
    extrapolated = step / 3600 < MIN_FITTED_H
    return {"method": "alternating_block", "segments": segments, "total_mm": cumulative[-1],
            "duration_s": blocks * step, "step_s": step, "return_period_years": period,
            "extrapolated": extrapolated,
            "within_stated_accuracy": step / 3600 >= STATED_ACCURACY_H[0],
            "provenance": _provenance(params, cell, duration_h, period, extrapolated)}


def prepare(output=DEFAULT_PATH, *, url=FILE_URL, md5=FILE_MD5):
    """Download ``pxr4-2.1.0.nc`` once and check its md5 (an existing file is only checked)."""
    output = Path(output)

    def digest(path):
        h = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    if output.exists():
        if digest(output) != md5:
            raise ValueError(f"{output} existe pero su md5 no coincide con {md5}")
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as response, open(partial, "wb") as f:
        for chunk in iter(lambda: response.read(1 << 20), b""):
            f.write(chunk)
    if digest(partial) != md5:
        partial.unlink()
        raise ValueError(f"la descarga de {url} no coincide con el md5 {md5}")
    partial.replace(output)
    return output


def main():
    parser = argparse.ArgumentParser(description="PXR-4 design-storm return levels.")
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare", help="download pxr4-2.1.0.nc (~300 MB) and check its md5")
    prep.add_argument("--output", default=str(DEFAULT_PATH))
    level = sub.add_parser("level", help="print a return level as JSON")
    for name in ("lon", "lat", "duration_h", "return_period_years"):
        level.add_argument(name, type=float)
    args = parser.parse_args()
    if args.command == "prepare":
        print(prepare(args.output))
    else:
        print(json.dumps(return_level(args.lon, args.lat, args.duration_h, args.return_period_years), indent=2))


if __name__ == "__main__":
    main()
