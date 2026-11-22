import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'solar.test_settings')
import django
django.setup()
from django.test import Client

from backend.solar.timezone_lookup import _timezone_geometry, resolve_timezone

ROI = {'type': 'Polygon', 'coordinates': [[[-92.01, 16], [-92.005, 16], [-92.005, 16.005], [-92.01, 16.005], [-92.01, 16]]]}


def rectangle(west, south, east, north):
    return [[ [west, south], [east, south], [east, north], [west, north], [west, south] ]]


class FakeFinder:
    timezone_names = ['America/New_York', 'Etc/UTC']

    def get_geometry(self, tz_name, coords_as_pairs=True):
        if tz_name == 'Etc/UTC':
            return rectangle(-93, 15, -92, 17)
        return rectangle(-80, 30, -70, 40)


def test_resolves_zone_that_covers_roi_and_returns_date_offset():
    with patch('backend.solar.timezone_lookup._timezonefinder', return_value=FakeFinder()):
        result = resolve_timezone(ROI, '2026-06-18')
    assert result == {'status': 'resolved', 'timezone': 'Etc/UTC', 'utc_offset': '+00:00'}


def test_partial_multizone_coverage_is_ambiguous():
    crossing = {'type': 'Polygon', 'coordinates': rectangle(-93, 16, -92.8, 16.2)}

    class CrossingFinder:
        timezone_names = ['Zone/A', 'Zone/B']

        def get_geometry(self, tz_name, coords_as_pairs=True):
            if tz_name == 'Zone/A':
                return rectangle(-94, 15, -92.9, 18)
            return rectangle(-92.9, 15, -91, 18)

    with patch('backend.solar.timezone_lookup._timezonefinder', return_value=CrossingFinder()):
        result = resolve_timezone(crossing, '2026-06-18')
    assert result == {'status': 'ambiguous', 'timezone': None}


def test_zone_offset_depends_on_simulation_date():
    roi = {'type': 'Polygon', 'coordinates': rectangle(-74, 40, -73.9, 40.1)}
    with patch('backend.solar.timezone_lookup._timezonefinder', return_value=SingleZoneFinder()):
        winter = resolve_timezone(roi, '2026-01-15')
        summer = resolve_timezone(roi, '2026-07-15')
    assert winter == {'status': 'resolved', 'timezone': 'America/New_York', 'utc_offset': '-05:00'}
    assert summer == {'status': 'resolved', 'timezone': 'America/New_York', 'utc_offset': '-04:00'}


class SingleZoneFinder:
    timezone_names = ['America/New_York']

    def get_geometry(self, tz_name, coords_as_pairs=True):
        return rectangle(-75, 39, -72, 42)


def test_timezonefinder_ring_arrays_convert_polygon_and_multipolygon():
    from shapely.geometry import MultiPolygon, Polygon
    first = rectangle(-10, 0, -9, 1)
    second = rectangle(-8, 0, -7, 1)
    assert isinstance(_timezone_geometry(first), Polygon)
    combined = _timezone_geometry([first, second])
    assert isinstance(combined, MultiPolygon)
    assert len(combined.geoms) == 2


def test_manual_override_and_invalid_date():
    overridden = resolve_timezone(ROI, '2026-06-18', 'America/New_York')
    assert overridden == {'status': 'manual_override', 'timezone': 'America/New_York', 'utc_offset': '-04:00'}
    assert resolve_timezone(ROI, 'not-a-date') == {'status': 'unavailable', 'timezone': None}


def test_simulation_timezone_route_is_removed_but_legacy_lookup_utility_remains():
    assert Client().post('/api/solar/timezone').status_code == 404
    assert callable(resolve_timezone)
