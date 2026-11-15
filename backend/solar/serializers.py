"""Strict, inexpensive preflight before NASADEM access or output allocation."""
import math
from numbers import Real

from pyproj import Geod
from rest_framework.exceptions import ValidationError, APIException
from shapely.geometry import shape

from pipeline.solar.dem import required_nasadem_tiles
from pipeline.solar.time import resolve_solar_inputs


def _invalid(message):
    raise ValidationError({'error': message, 'code': 'invalid_request'})


def _finite(value):
    if isinstance(value, bool) or not isinstance(value, Real):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


class TooLarge(APIException):
    status_code = 413
    default_detail = 'ROI exceeds simulation resource limits'
    default_code = 'too_large'


def validate_request(data):
    keys = {'roi', 'datetime_local', 'timezone', 'intensity_percent', 'temperature_c', 'pressure_hpa'}
    if not isinstance(data, dict) or set(data) - keys or not {'roi', 'datetime_local', 'timezone', 'intensity_percent'} <= set(data):
        _invalid('Expected roi, datetime_local, timezone, intensity_percent; unknown keys forbidden')
    numbers = {'intensity_percent': (0, 100), 'temperature_c': (-273.14, None), 'pressure_hpa': (0, None)}
    for key, (minimum, maximum) in numbers.items():
        value = data.get(key)
        if value is None and key != 'intensity_percent':
            continue
        if not _finite(value):
            _invalid(f'{key} must be a finite JSON number')
        if (minimum is not None and value < minimum) or (maximum is not None and value > maximum) or (key == 'pressure_hpa' and value == 0):
            _invalid(f'{key} outside supported range')
    roi = data['roi']
    if not isinstance(roi, dict) or set(roi) != {'type', 'coordinates'} or roi['type'] not in ('Polygon', 'MultiPolygon'):
        _invalid('roi must be a GeoJSON Polygon or MultiPolygon')
    # Bound and validate raw nesting and vertex count before Shapely or tile intersection.
    stack = [(roi['coordinates'], 0)]
    count = 0
    xs, ys = [], []
    while stack:
        node, depth = stack.pop()
        if depth > 5 or not isinstance(node, (list, tuple)):
            _invalid('Invalid ROI coordinates')
        if len(node) == 2 and all(isinstance(v, Real) for v in node):
            if any(not _finite(v) for v in node):
                _invalid('Invalid ROI coordinates')
            lon, lat = map(float, node)
            if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                _invalid('Coordinates outside EPSG:4326')
            xs.append(lon); ys.append(lat)
            count += 1
            if count > 1000:
                raise TooLarge()
        else:
            if len(node) > 1000 or not node:
                raise TooLarge()
            stack.extend((child, depth + 1) for child in node)
    if count < 4:
        _invalid('ROI requires polygon vertices')
    west, east, south, north = min(xs), max(xs), min(ys), max(ys)
    if west >= east or south >= north:
        _invalid('ROI has no area')
    # Reject huge bboxes before expensive geometry construction, including disconnected multipolygons.
    if east - west > 0.2 or north - south > 0.2:
        raise TooLarge()
    geod = Geod(ellps='WGS84')
    width = max(geod.inv(west, lat, east, lat)[2] for lat in (south, north))
    height = max(geod.inv(lon, south, lon, north)[2] for lon in (west, east))
    diagonal = max(geod.inv(west, south, east, north)[2], geod.inv(west, north, east, south)[2])
    if diagonal > 10000 or ((width + 100) / 30) * ((height + 100) / 30) > 150000:
        raise TooLarge()
    try:
        geom = shape(roi)
        if geom.is_empty or not geom.is_valid or geom.area <= 0:
            raise ValueError('invalid geometry')
        tiles, _ = required_nasadem_tiles(roi, max_tiles=2)
        if len(tiles) * 3601**2 > 30_000_000:
            raise TooLarge()
        effective = resolve_solar_inputs(data['datetime_local'], data['timezone'], altitude_m=0,
                                         temperature_c=data.get('temperature_c'), pressure_hpa=data.get('pressure_hpa'))
    except (ValueError, TypeError, IndexError):
        _invalid('Invalid ROI, time, timezone or atmospheric inputs')
    return {**data, 'roi': roi, 'intensity_percent': float(data['intensity_percent']),
            'temperature_c': effective['temperature_c'],
            '_temperature_c_input': data.get('temperature_c'),
            'pressure_hpa': float(data['pressure_hpa']) if data.get('pressure_hpa') is not None else None}
