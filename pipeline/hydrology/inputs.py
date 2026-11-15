"""Django-independent validation for hypothetical flood-scenario inputs."""
from __future__ import annotations

import math
from collections.abc import Mapping

from shapely.geometry import shape


class InputValidationError(ValueError):
    def __init__(self, errors: dict[str, list[str]]):
        self.errors = errors
        super().__init__("Invalid flood-scenario input")


def _number(value, field, errors, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.setdefault(field, []).append("Debe ser un número JSON finito.")
        return None
    try:
        result = float(value)
    except (OverflowError, ValueError):
        result = math.inf
    if not math.isfinite(result):
        errors.setdefault(field, []).append("Debe ser un número JSON finito representable.")
        return None
    if result < 0 or (positive and result <= 0):
        errors.setdefault(field, []).append("Debe ser mayor que cero." if positive else "No puede ser negativo.")
        return None
    return result


def _scaled(value, factor, field, errors, *, allow_zero=True):
    result = value * factor
    if not math.isfinite(result):
        errors.setdefault(field, []).append("La conversión excede el rango numérico admitido.")
        return None
    if value > 0 and result == 0:
        errors.setdefault(field, []).append("La conversión produce un subdesbordamiento numérico.")
        return None
    if not allow_zero and result <= 0:
        errors.setdefault(field, []).append("La conversión debe ser mayor que cero.")
        return None
    return result


def _mean_intensity(amount_m, duration_s, errors):
    result = amount_m / duration_s
    if not math.isfinite(result):
        errors.setdefault("rainfall", []).append("La intensidad media excede el rango numérico admitido.")
        return None
    if amount_m > 0 and result == 0:
        errors.setdefault("rainfall", []).append("La intensidad media produce un subdesbordamiento numérico.")
        return None
    return result


def _rainfall(value, errors):
    if not isinstance(value, Mapping):
        errors["rainfall"] = ["Debe ser un objeto de lluvia."]
        return None
    fields = set(value)
    amount_mode = "amount" in fields
    intensity_mode = "intensity" in fields
    if amount_mode == intensity_mode:
        errors["rainfall"] = ["Indique cantidad o intensidad, siempre con duración; no combine modos."]
        return None
    allowed = ({"amount", "unit", "duration", "duration_unit"} if amount_mode else
               {"intensity", "intensity_unit", "duration", "duration_unit"})
    if fields != allowed:
        errors["rainfall"] = ["Campos de lluvia desconocidos o faltantes."]
        return None

    duration = _number(value["duration"], "rainfall.duration", errors, positive=True)
    time_factors = {"s": 1.0, "min": 60.0, "h": 3600.0}
    if not isinstance(value["duration_unit"], str) or value["duration_unit"] not in time_factors:
        errors["rainfall"] = ["Unidad de duración no admitida; use s, min o h."]
        return None
    if duration is None:
        return None
    duration_s = _scaled(duration, time_factors[value["duration_unit"]], "rainfall.duration", errors, allow_zero=False)
    if duration_s is None:
        return None

    if amount_mode:
        amount = _number(value["amount"], "rainfall.amount", errors)
        if value["unit"] != "mm":
            errors["rainfall"] = ["Unidad no admitida; use mm."]
        if amount is None or "rainfall" in errors:
            return None
        amount_m = _scaled(amount, 0.001, "rainfall.amount", errors)
        if amount_m is None:
            return None
        mean = _mean_intensity(amount_m, duration_s, errors)
        if mean is None:
            return None
        return {"mode": "amount", "input": dict(value), "amount_m": amount_m,
                "duration_s": duration_s, "mean_intensity_m_s": mean}

    intensity = _number(value["intensity"], "rainfall.intensity", errors)
    factors = {"mm/h": 0.001 / 3600, "mm/min": 0.001 / 60, "mm/s": 0.001}
    if not isinstance(value["intensity_unit"], str) or value["intensity_unit"] not in factors:
        errors["rainfall"] = ["Unidad no admitida; intensidad mm/h, mm/min o mm/s."]
        return None
    if intensity is None or "rainfall" in errors:
        return None
    intensity_si = _scaled(intensity, factors[value["intensity_unit"]], "rainfall.intensity", errors)
    if intensity_si is None:
        return None
    amount_m = _scaled(intensity_si, duration_s, "rainfall", errors)
    if amount_m is None:
        return None
    return {"mode": "intensity_duration", "input": dict(value), "amount_m": amount_m,
            "duration_s": duration_s, "mean_intensity_m_s": intensity_si}


def _finite_coordinate(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, int):
        return True
    return math.isfinite(value)


def _roi(value, errors):
    if not isinstance(value, Mapping) or set(value) != {"type", "coordinates"} or value.get("type") != "Polygon":
        errors["roi"] = ["Debe ser GeoJSON Polygon EPSG:4326 explícito, sin campos adicionales."]
        return None
    rings = value["coordinates"]
    if not isinstance(rings, list) or not rings:
        errors["roi"] = ["Las coordenadas deben ser anillos de pares numéricos finitos [longitud, latitud]."]
        return None
    for ring in rings:
        if not isinstance(ring, list) or len(ring) < 4:
            errors["roi"] = ["Cada anillo debe tener al menos cuatro posiciones y estar cerrado."]
            return None
        for point in ring:
            if (not isinstance(point, list) or len(point) != 2
                    or not all(_finite_coordinate(value) for value in point)):
                errors["roi"] = ["Las coordenadas deben ser anillos de pares numéricos finitos [longitud, latitud]."]
                return None
            lon, lat = point
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                errors["roi"] = ["Coordenadas fuera del rango geográfico EPSG:4326."]
                return None
        if ring[0] != ring[-1]:
            errors["roi"] = ["Cada anillo debe tener al menos cuatro posiciones y estar cerrado."]
            return None
        if any(abs(ring[i][0] - ring[i - 1][0]) > 180 for i in range(1, len(ring))):
            errors["roi"] = ["No se admiten anillos ambiguos que crucen el antimeridiano."]
            return None
    try:
        geometry = shape(value)
    except Exception:
        geometry = None
    if geometry is None or geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
        errors["roi"] = ["El polígono debe ser válido y tener área positiva."]
        return None
    return value


def validate_roi(value):
    """Validate and return a GeoJSON Polygon without altering its coordinates."""
    errors = {}
    roi = _roi(value, errors)
    if errors:
        raise InputValidationError(errors)
    return roi


def normalize_request(payload):
    errors = {}
    if not isinstance(payload, Mapping):
        raise InputValidationError({"non_field_errors": ["El cuerpo debe ser un objeto JSON."]})
    if set(payload) != {"rainfall", "roi"}:
        errors["request"] = ["Se requieren únicamente los campos rainfall y roi."]
    rainfall = _rainfall(payload.get("rainfall"), errors) if "rainfall" in payload else None
    roi = _roi(payload.get("roi"), errors) if "roi" in payload else None
    if errors:
        raise InputValidationError(errors)
    return {"rainfall": rainfall, "roi": roi}
