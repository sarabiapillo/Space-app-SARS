"""Pure temporal and atmospheric input preparation for solar calculations.

This module deliberately does not calculate solar position or irradiance.
"""
from __future__ import annotations

from datetime import datetime, timezone
import math
from numbers import Real
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


_LOCAL_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
_STANDARD_PRESSURE_PA = 101325.0
_STANDARD_TEMPERATURE_K = 288.15
_TEMPERATURE_LAPSE_K_PER_M = 0.0065
_DRY_AIR_GAS_CONSTANT = 287.053
_GRAVITY_M_PER_S2 = 9.80665


def _finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number")
    return number


def _resolve_local_time(datetime_local, timezone_name):
    if not isinstance(datetime_local, str) or not _LOCAL_DATETIME.fullmatch(datetime_local):
        raise ValueError("datetime_local must be ISO local time with seconds and no UTC offset")
    try:
        local = datetime.fromisoformat(datetime_local)
    except ValueError as exc:
        raise ValueError("datetime_local is not a valid calendar datetime") from exc
    if not isinstance(timezone_name, str) or not timezone_name or timezone_name.startswith(("+", "-")):
        raise ValueError("timezone must be a valid IANA time-zone name")
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise ValueError("timezone must be a valid IANA time-zone name") from exc

    candidates = []
    for fold in (0, 1):
        aware = local.replace(tzinfo=zone, fold=fold)
        round_trip = aware.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
        if round_trip == local:
            candidates.append(aware)
    if not candidates:
        raise ValueError("datetime_local is nonexistent in the specified timezone")
    offsets = {candidate.utcoffset() for candidate in candidates}
    if len(offsets) > 1:
        raise ValueError("datetime_local is ambiguous in the specified timezone")

    selected = candidates[0]
    offset = selected.utcoffset()
    total_seconds = int(offset.total_seconds())
    sign = "+" if total_seconds >= 0 else "-"
    absolute_seconds = abs(total_seconds)
    offset_text = f"{sign}{absolute_seconds // 3600:02d}:{(absolute_seconds % 3600) // 60:02d}"
    utc = selected.astimezone(timezone.utc).isoformat(timespec="seconds")
    return utc, offset_text


def _standard_pressure_hpa(altitude_m):
    base = 1.0 - _TEMPERATURE_LAPSE_K_PER_M * altitude_m / _STANDARD_TEMPERATURE_K
    if not math.isfinite(base) or base <= 0:
        raise ValueError("altitude_m is outside the dry standard atmosphere model domain")
    exponent = _GRAVITY_M_PER_S2 / (_DRY_AIR_GAS_CONSTANT * _TEMPERATURE_LAPSE_K_PER_M)
    pressure_hpa = (_STANDARD_PRESSURE_PA * base**exponent) / 100.0
    if not math.isfinite(pressure_hpa) or pressure_hpa <= 0:
        raise ValueError("altitude_m produces invalid standard-atmosphere pressure")
    return pressure_hpa


def resolve_solar_inputs(
    datetime_local,
    timezone_name,
    *,
    altitude_m,
    temperature_c=None,
    pressure_hpa=None,
):
    """Resolve local time and effective atmospheric inputs with provenance.

    ``altitude_m`` must be a caller-supplied elevation; its NASADEM origin
    is not verified here. No point or altitude is inferred. Temperature
    defaults to the approved 12 °C assumption; pressure defaults to the dry
    standard-atmosphere formula evaluated at the supplied altitude.
    """
    datetime_utc, utc_offset = _resolve_local_time(datetime_local, timezone_name)
    altitude = _finite_number(altitude_m, "altitude_m")
    if temperature_c is None:
        temperature = 12.0
        temperature_source = "default: 12 °C (assumption, not measurement)"
    else:
        temperature = _finite_number(temperature_c, "temperature_c")
        if temperature + 273.15 <= 0:
            raise ValueError("temperature_c must correspond to a positive Kelvin temperature")
        temperature_source = "input: caller-supplied °C"
    if pressure_hpa is None:
        pressure = _standard_pressure_hpa(altitude)
        pressure_source = "calculated: dry standard atmosphere from caller-provided altitude (NASADEM origin unverified)"
    else:
        pressure = _finite_number(pressure_hpa, "pressure_hpa")
        if pressure <= 0:
            raise ValueError("pressure_hpa must be positive")
        pressure_source = "input: caller-supplied hPa"

    return {
        "datetime_local": datetime_local,
        "timezone": timezone_name,
        "utc_offset": utc_offset,
        "datetime_utc": datetime_utc,
        "altitude_m": altitude,
        "temperature_c": temperature,
        "temperature_provenance": temperature_source,
        "pressure_hpa": pressure,
        "pressure_provenance": pressure_source,
    }
