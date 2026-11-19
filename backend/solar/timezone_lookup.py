"""Conservative timezone lookup for confirmed WGS84 ROI GeoJSON."""
from datetime import date, datetime, time
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.strtree import STRtree


@lru_cache(maxsize=1)
def _timezonefinder():
    from timezonefinder import TimezoneFinder
    return TimezoneFinder(in_memory=True)


def resolve_timezone(geojson, simulation_date=None, timezone_override=None):
    """Resolve a single IANA zone only when its polygon unambiguously covers the ROI."""
    try:
        if not isinstance(geojson, dict) or geojson.get('type') not in ('Polygon', 'MultiPolygon'):
            raise ValueError
        coordinates = geojson['coordinates']
        _validate_coordinates(coordinates)
        geom = shape(geojson)
        if geom.is_empty or not geom.is_valid or geom.area <= 0:
            raise ValueError
        minx, miny, maxx, maxy = geom.bounds
        if not (-180 <= minx < maxx <= 180 and -90 <= miny < maxy <= 90):
            raise ValueError
        if maxx - minx > .25 or maxy - miny > .25:
            raise ValueError
        if simulation_date is not None:
            date.fromisoformat(simulation_date)
        if timezone_override is not None:
            zone = ZoneInfo(timezone_override)
            status = 'manual_override'
        else:
            finder = _timezonefinder()
            names, geometries, tree = _zone_index(finder)
            touching = [(names[int(index)], geometries[int(index)]) for index in tree.query(geom)
                        if geometries[int(index)].intersects(geom)]
            # Require precisely one intersecting polygon and exact ROI coverage.
            if len(touching) != 1 or not geom.difference(touching[0][1]).is_empty:
                return {'status': 'ambiguous', 'timezone': None}
            zone = ZoneInfo(touching[0][0])
            status = 'resolved'
        local_date = date.fromisoformat(simulation_date) if simulation_date else date.today()
        offset = datetime.combine(local_date, time(12), tzinfo=zone).utcoffset()
        return {'status': status, 'timezone': zone.key, 'utc_offset': _format_offset(offset)}
    except (ValueError, TypeError, KeyError, AttributeError, ZoneInfoNotFoundError, ImportError):
        return {'status': 'unavailable', 'timezone': None}


@lru_cache(maxsize=2)
def _zone_index(finder):
    """Index immutable boundary polygons once per worker, never by ROI samples."""
    all_names = finder.timezone_names
    all_names = all_names() if callable(all_names) else all_names
    names, geometries = [], []
    for name in all_names:
        raw = finder.get_geometry(tz_name=name, coords_as_pairs=True)
        if raw:
            names.append(name)
            geometries.append(_timezone_geometry(raw))
    return names, geometries, STRtree(geometries)


def _validate_coordinates(coordinates):
    """Bound nesting and vertex count before passing untrusted ROI to Shapely."""
    stack = [(coordinates, 0)]
    vertices = 0
    while stack:
        node, depth = stack.pop()
        if depth > 5 or not isinstance(node, (list, tuple)) or not node or len(node) > 1000:
            raise ValueError('invalid or oversized ROI coordinates')
        if len(node) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in node):
            lon, lat = node
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError('ROI coordinate outside WGS84 bounds')
            vertices += 1
            if vertices > 1000:
                raise ValueError('ROI has too many vertices')
        else:
            stack.extend((child, depth + 1) for child in node)
    if vertices < 4:
        raise ValueError('ROI needs polygon vertices')


def _timezone_geometry(raw):
    """Convert timezonefinder's coordinates-as-pairs rings to Shapely polygons."""
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ValueError('empty timezone geometry')
    first = raw[0]
    # A Polygon is [rings], where rings are [coordinate pairs]. A MultiPolygon
    # is [polygons], where each polygon is [rings].
    if first and isinstance(first[0], (list, tuple)) and len(first[0]) == 2 and all(
            isinstance(value, (int, float)) for value in first[0]):
        return Polygon(first, holes=raw[1:])
    polygons = [Polygon(rings[0], holes=rings[1:]) for rings in raw]
    return MultiPolygon(polygons)


def _format_offset(offset):
    seconds = int(offset.total_seconds())
    sign = '+' if seconds >= 0 else '-'
    seconds = abs(seconds)
    return f'{sign}{seconds // 3600:02d}:{seconds % 3600 // 60:02d}'
