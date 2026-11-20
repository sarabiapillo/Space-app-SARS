"""Lumped rain losses and inverse-barometer surge, ported from the terrapulseai_v2.1 flood simulator.

Same formulas as ``backend/analyses/simulate.py`` there:
- Infiltration: a runoff coefficient that grows with the storm duration as the soil saturates
  (Horton-type, time constant 24 h): C = min(0.92, 0.65 + 0.27 (1 - exp(-D / 24 h))), with D the rain
  duration clamped to at least 0.5 h. DG2 then receives rain x C; the rest counts as infiltrated.
  It is a lumped coefficient, not a physical infiltration model.
- Atmospheric pressure: inverse barometer, surge = max(0, 1013.25 - p) x 100 / (rho g) with
  rho = 1000 kg/m3 and g = 9.81 m/s2 (about 1 cm per hPa). Here it raises only the fixed sea level:
  the inverse barometer acts on open water, so unlike that simulator it is not added to inland ponding.
"""
from __future__ import annotations

import math

RUNOFF_BASE = .65
RUNOFF_MAX = .92
SATURATION_TAU_H = 24.0
MIN_DURATION_H = .5
STANDARD_PRESSURE_HPA = 1013.25
PRESSURE_RANGE_HPA = (950.0, 1040.0)


def runoff_coefficient(duration_s):
    hours = max(MIN_DURATION_H, float(duration_s) / 3600)
    return min(RUNOFF_MAX, RUNOFF_BASE + (RUNOFF_MAX - RUNOFF_BASE) * (1 - math.exp(-hours / SATURATION_TAU_H)))


def barometric_surge_m(pressure_hpa):
    low, high = PRESSURE_RANGE_HPA
    if (isinstance(pressure_hpa, bool) or not isinstance(pressure_hpa, (int, float))
            or not math.isfinite(pressure_hpa) or not low <= pressure_hpa <= high):
        raise ValueError('atmospheric pressure must be a number between 950 and 1040 hPa')
    return max(0.0, STANDARD_PRESSURE_HPA - pressure_hpa) * 100 / (1000 * 9.81)


def effective_rainfall(rainfall, coefficient):
    """Copy of a rainfall request (amount or intensity mode) with the rain scaled by ``coefficient``."""
    key = 'amount' if 'amount' in rainfall else 'intensity'
    return {**rainfall, key: rainfall[key] * coefficient}
