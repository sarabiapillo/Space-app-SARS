import copy
import json
from urllib.error import HTTPError, URLError
from unittest.mock import patch

import pytest
from shapely.errors import GEOSException

from pipeline.hydrology.watersheds import WatershedError, suggest_watershed


POLYGON = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
MULTI = {"type": "MultiPolygon", "coordinates": [[[[0, 0], [1, 0], [1, 1], [0, 0]]]]}


class Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, limit):
        return self.body[:limit]


def body(geometry=POLYGON, properties=None):
    return json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": geometry,
         "properties": properties if properties is not None else {"area_km2": "6,430"}}
    ]}).encode()


def test_explicit_request_encodes_point_precision_timeout_and_preserves_provider_data():
    with patch("pipeline.hydrology.watersheds.urlopen", return_value=Response(body())) as request:
        result = suggest_watershed(43.253, -77.609, precision="high", timeout=4)
    req, timeout = request.call_args.args[0], request.call_args.kwargs["timeout"]
    assert req.full_url == "https://mghydro.com/app/watershed_api?lat=43.253&lng=-77.609&precision=high"
    assert timeout == 4
    assert result.geojson["features"][0]["properties"] == {"area_km2": "6,430"}
    assert result.query == {"latitude": 43.253, "longitude": -77.609, "precision": "high"}
    assert result.suggested_only is True and result.hydraulic_ready is False
    assert result.source == "https://mghydro.com/app/watershed_api"


@pytest.mark.parametrize("geometry", [POLYGON, MULTI])
def test_accepts_polygonal_geometry_without_changing_it(geometry):
    original = copy.deepcopy(geometry)
    with patch("pipeline.hydrology.watersheds.urlopen", return_value=Response(body(geometry))):
        result = suggest_watershed(0, 0, precision="low")
    assert result.geojson["features"][0]["geometry"] == original
    assert geometry == original


@pytest.mark.parametrize("args", [
    (True, 0, "high", 5), ("1", 0, "high", 5), (91, 0, "high", 5),
    (0, 181, "high", 5), (float("nan"), 0, "high", 5),
    (0, 0, "medium", 5), (0, 0, "high", 0), (0, 0, "high", float("inf")),
    (0, 0, "high", 301), (0, 0, [], 5), (0, 0, {}, 5),
])
def test_invalid_parameters_do_not_make_request(args):
    with patch("pipeline.hydrology.watersheds.urlopen") as request:
        with pytest.raises(ValueError):
            suggest_watershed(args[0], args[1], precision=args[2], timeout=args[3])
    request.assert_not_called()


@pytest.mark.parametrize("failure", [
    URLError("offline"), TimeoutError("late"),
    HTTPError("https://mghydro.com", 503, "unavailable", {}, None),
])
def test_transport_failures_are_explicit(failure):
    with patch("pipeline.hydrology.watersheds.urlopen", side_effect=failure):
        with pytest.raises(WatershedError):
            suggest_watershed(0, 0)


@pytest.mark.parametrize("payload", [b"", b"not json", b'{"type":"FeatureCollection","features":[]}',
    json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}}]}).encode(),
    json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [2, 2], [0, 0]]]}, "properties": {}}]}).encode(),
    json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1]]]}, "properties": {}}]}).encode(),
    b"[" * 1100 + b"0" + b"]" * 1100,
])
def test_invalid_service_responses_fail_without_fallback(payload):
    with patch("pipeline.hydrology.watersheds.urlopen", return_value=Response(payload)):
        with pytest.raises(WatershedError):
            suggest_watershed(0, 0)


def test_geos_geometry_failure_is_a_typed_service_error():
    with patch("pipeline.hydrology.watersheds.shape", side_effect=GEOSException("invalid ring")):
        with patch("pipeline.hydrology.watersheds.urlopen", return_value=Response(body())):
            with pytest.raises(WatershedError):
                suggest_watershed(0, 0)


def test_oversized_response_is_rejected():
    with patch("pipeline.hydrology.watersheds.urlopen", return_value=Response(b" " * (2_000_001))):
        with pytest.raises(WatershedError):
            suggest_watershed(0, 0)
