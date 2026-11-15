"""Opt-in client for watershed suggestions from mghydro.com."""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from shapely.errors import GEOSException
from shapely.geometry import shape


_ENDPOINT = "https://mghydro.com/app/watershed_api"
_MAX_RESPONSE_BYTES = 2_000_000
_MAX_TIMEOUT_SECONDS = 300


class WatershedError(Exception):
    """The optional watershed service failed or returned invalid GeoJSON."""


@dataclass(frozen=True)
class WatershedSuggestion:
    source: str
    query: dict
    geojson: dict
    suggested_only: bool = True
    hydraulic_ready: bool = False


def _validate_point(value: object, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (OverflowError, ValueError):
        raise ValueError(f"{name} must be a finite number") from None
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError(f"{name} must be finite and between {minimum} and {maximum}")
    return number


def _validate_geojson(data: object) -> dict:
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise ValueError("expected a GeoJSON FeatureCollection")
    features = data.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("FeatureCollection must contain features")
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("invalid GeoJSON feature")
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError("watershed feature must have Polygon or MultiPolygon geometry")
        try:
            parsed = shape(geometry)
            if parsed.is_empty or not parsed.is_valid:
                raise ValueError("invalid or empty polygon geometry")
            for point in parsed.coords if parsed.geom_type == "LineString" else _coordinates(geometry["coordinates"]):
                if len(point) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point):
                    raise ValueError("coordinates must be finite geographic 2D positions")
                lon, lat = point
                if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                    raise ValueError("coordinates are outside geographic bounds")
        except (GEOSException, KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError("invalid GeoJSON polygon geometry") from exc
        if not isinstance(feature.get("properties"), (dict, type(None))):
            raise ValueError("invalid GeoJSON feature properties")
    return data


def _coordinates(value):
    if isinstance(value, (list, tuple)) and value and all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value):
        yield value
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _coordinates(item)
    else:
        raise ValueError("invalid coordinate nesting")


def suggest_watershed(latitude, longitude, *, precision="high", timeout=30):
    """Fetch an explicit watershed suggestion for a caller-selected WGS84 point."""
    latitude = _validate_point(latitude, "latitude", -90, 90)
    longitude = _validate_point(longitude, "longitude", -180, 180)
    if not isinstance(precision, str) or precision not in {"high", "low"}:
        raise ValueError("precision must be 'high' or 'low'")
    timeout = _validate_point(timeout, "timeout", 0, _MAX_TIMEOUT_SECONDS)
    if timeout == 0:
        raise ValueError("timeout must be positive")

    query = {"latitude": latitude, "longitude": longitude, "precision": precision}
    url = f"{_ENDPOINT}?{urlencode({'lat': latitude, 'lng': longitude, 'precision': precision})}"
    request = Request(url, headers={"Accept": "application/geo+json, application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise WatershedError("watershed service request failed") from exc
    if len(raw) > _MAX_RESPONSE_BYTES:
        raise WatershedError("watershed service response exceeded size limit")
    try:
        data = json.loads(raw)
        _validate_geojson(data)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError, TypeError) as exc:
        raise WatershedError("watershed service returned invalid GeoJSON") from exc
    return WatershedSuggestion(source=_ENDPOINT, query=query, geojson=data)
