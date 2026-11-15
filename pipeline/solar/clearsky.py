"""Clear-sky direct normal irradiance using pvlib's Ineichen model.

The result is a climatological estimate, not a weather observation or forecast.
"""
from __future__ import annotations

import hashlib
import math
from numbers import Real
from pathlib import Path

import pandas as pd
import pvlib

from pipeline.solar.position import compute_solar_position

_MODEL = "Ineichen/Perez (pvlib.clearsky.ineichen; perez_enhancement=False)"
_LINKE_DATASET = "pvlib LinkeTurbidities.h5"
_LINKE_INTERPOLATION = "daily interpolation using UTC day of year"


def _finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{name} must be a finite real number")
    try:
        value = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite real number") from exc
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite real number")
    return value


def _scalar(value, name):
    """Extract one finite scalar from pvlib's one-timestamp Series/arrays."""
    if hasattr(value, "to_numpy"):
        array = value.to_numpy()
        if array.size != 1:
            raise ValueError(f"pvlib returned invalid {name}")
        value = array.reshape(-1)[0]
    elif hasattr(value, "__len__") and not isinstance(value, (str, bytes)):
        if len(value) != 1:
            raise ValueError(f"pvlib returned invalid {name}")
        value = value[0]
    return _finite_number(value, name)


def _linke_dataset_path_and_sha256():
    """Identify and hash pvlib's packaged LUT without exposing its path."""
    path = (Path(pvlib.clearsky.__file__).resolve().parent / "data" / "LinkeTurbidities.h5")
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ValueError("pvlib packaged Linke turbidity dataset is unavailable") from exc
    return path, digest.hexdigest()


def compute_clear_sky_dni(
    *, roi, datetime_local, timezone_name, provider, intensity_percent,
    temperature_c=None, pressure_hpa=None, position=None,
):
    """Estimate clear-sky DNI and apply the experimental intensity percentage.

    Phase A owns ROI acquisition, timestamp resolution, representative location,
    SPA and effective atmospheric inputs. By default this function calls it
    exactly once and uses its UTC instant, apparent zenith, EGM96 altitude and
    pressure in Pa. If ``position`` is supplied, that call is skipped and the
    provided phase-A dictionary is reused instead; this avoids recomputing SPA
    or reacquiring the DEM when the caller already has a position.
    """
    percent = _finite_number(intensity_percent, "intensity_percent")
    if not 0.0 <= percent <= 100.0:
        raise ValueError("intensity_percent must be within [0, 100]")

    if position is None:
        position = compute_solar_position(
            roi=roi, datetime_local=datetime_local, timezone_name=timezone_name,
            provider=provider, temperature_c=temperature_c, pressure_hpa=pressure_hpa,
        )
    if not isinstance(position, dict):
        raise ValueError("phase A returned invalid solar-position provenance")

    apparent_zenith = _finite_number(position.get("apparent_zenith_deg"), "apparent zenith")
    apparent_elevation = _finite_number(position.get("apparent_elevation_deg"), "apparent elevation")
    altitude_m = _finite_number(position.get("altitude_m"), "altitude_m")
    pressure_pa = _finite_number(position.get("pressure_pa"), "pressure_pa")
    temperature = _finite_number(position.get("temperature_c"), "temperature_c")
    point = position.get("representative_point_lonlat")
    if not isinstance(point, (list, tuple)) or len(point) != 2:
        raise ValueError("phase A returned invalid representative point")
    longitude, latitude = (_finite_number(point[0], "longitude"), _finite_number(point[1], "latitude"))
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90 or pressure_pa <= 0:
        raise ValueError("phase A returned invalid location or pressure")
    instant = pd.Timestamp(position.get("datetime_utc"))
    if instant.tzinfo is None:
        raise ValueError("phase A datetime_utc must be timezone-aware")
    times = pd.DatetimeIndex([instant.tz_convert("UTC")])
    night = apparent_elevation <= 0.0
    common = {
        **position,
        "model": _MODEL,
        "pvlib_version": pvlib.__version__,
        "intensity_percent": percent,
        "dni_units": "W/m2",
        "airmass_units": "dimensionless",
        "pressure_pa": pressure_pa,
        "temperature_c": temperature,
        "atmospheric_provenance": {
            "pressure": position.get("pressure_provenance"),
            "temperature": position.get("temperature_provenance"),
            "altitude": position.get("altitude_interpretation", "NASADEM elevation; datum recorded in phase A"),
            "linke_dataset": _LINKE_DATASET,
            "linke_dataset_version": f"pvlib {pvlib.__version__} packaged climatology",
            "linke_interpolation": _LINKE_INTERPOLATION,
        },
    }
    if night:
        common.update({
            "night": True,
            "dni_clear_sky_w_m2": 0.0,
            "dni_adjusted_w_m2": 0.0,
            "linke_turbidity": None,
            "airmass_relative": None,
            "airmass_absolute": None,
            "dni_extra_w_m2": None,
            "linke_dataset_sha256": None,
            "atmospheric_provenance": {
                **common["atmospheric_provenance"],
                "night_evaluation": "not evaluated at night",
                "linke_lookup": "not evaluated at night",
                "airmass": "not evaluated at night",
                "dni_extra": "not evaluated at night",
            },
        })
        return common

    try:
        relative = pvlib.atmosphere.get_relative_airmass(
            apparent_zenith, model="kastenyoung1989"
        )
        relative_value = _scalar(relative, "relative air mass")
        absolute = pvlib.atmosphere.get_absolute_airmass(relative, pressure=pressure_pa)
        absolute_value = _scalar(absolute, "absolute air mass")
        if relative_value <= 0 or absolute_value <= 0:
            raise ValueError("pvlib returned invalid air mass")

        linke_path, linke_sha256 = _linke_dataset_path_and_sha256()
        linke_series = pvlib.clearsky.lookup_linke_turbidity(
            times, latitude, longitude, filepath=str(linke_path),
            interp_turbidity=True,
        )
        linke_value = _scalar(linke_series, "Linke turbidity")
        if linke_value <= 0:
            raise ValueError("pvlib returned invalid Linke turbidity")
        extra = pvlib.irradiance.get_extra_radiation(times, method="spencer")
        extra_value = _scalar(extra, "extraterrestrial DNI")
        if extra_value <= 0:
            raise ValueError("pvlib returned invalid extraterrestrial DNI")
        dni_result = pvlib.clearsky.ineichen(
            apparent_zenith, absolute, linke_series, altitude=altitude_m,
            dni_extra=extra, perez_enhancement=False,
        )
        dni_value = _scalar(dni_result["dni"], "clear-sky DNI")
    except (KeyError, IndexError, TypeError, OSError) as exc:
        raise ValueError("pvlib clear-sky calculation or Linke dataset failed") from exc
    if dni_value < 0:
        raise ValueError("pvlib returned negative clear-sky DNI")
    adjusted = dni_value * (percent / 100.0)
    if not math.isfinite(adjusted) or not 0.0 <= adjusted <= dni_value:
        raise ValueError("adjusted clear-sky DNI is invalid")

    common.update({
        "night": False,
        "dni_clear_sky_w_m2": dni_value,
        "dni_adjusted_w_m2": adjusted,
        "linke_turbidity": linke_value,
        "airmass_relative": relative_value,
        "airmass_absolute": absolute_value,
        "dni_extra_w_m2": extra_value,
        "linke_dataset_sha256": linke_sha256,
        "atmospheric_provenance": {
            **common["atmospheric_provenance"],
            "night_evaluation": "evaluated for daylight",
            "linke_lookup": "pvlib packaged lookup; no external or fabricated fallback",
            "linke_dataset_sha256": linke_sha256,
            "airmass_method": "kastenyoung1989; absolute mass uses phase A pressure_pa",
            "dni_extra_method": "Spencer",
            "dni_method": "pvlib.clearsky.ineichen; perez_enhancement=False",
        },
    })
    return common
