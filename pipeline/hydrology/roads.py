"""Vehicular roads from OpenStreetMap (Overpass API) and their exposure to DG2 water depth.

OpenStreetMap is global and open (ODbL): show "© OpenStreetMap contributors" wherever results
appear. Depth thresholds are those of the terrapulseai_v2.1 flood simulator: 0.35 m and above
cuts the road, 0.15-0.35 m calls for caution. That simulator assumed 2.2 km of road per km2 of
flooded flat land; here the length is measured on the real road lines inside the domain.
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request

import numpy as np
from pyproj import Transformer

OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
# Generic client name: no personal contact data goes to the public API.
USER_AGENT = 'TerraPulse-AI flood simulation (open source)'
VEHICULAR = ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
             'service', 'living_street', 'track', 'motorway_link', 'trunk_link', 'primary_link',
             'secondary_link', 'tertiary_link')
CAUTION_M, CUT_M = .15, .35
MAX_RESPONSE_BYTES = 20_000_000


def overpass_query(bounds):
    """Overpass QL for vehicular ways inside ``(west, south, east, north)`` in EPSG:4326, with geometry."""
    west, south, east, north = (float(v) for v in bounds)
    if not all(math.isfinite(v) for v in bounds) or west >= east or south >= north:
        raise ValueError('bounds must be finite (west, south, east, north)')
    pattern = '^(' + '|'.join(VEHICULAR) + ')$'
    return f'[out:json][timeout:60];way["highway"~"{pattern}"]({south:g},{west:g},{north:g},{east:g});out geom tags;'


def parse_overpass(payload):
    """Keep ways with at least two points; record the OSM snapshot time and the license."""
    roads = []
    for element in payload.get('elements', []):
        points = element.get('geometry') or []
        if element.get('type') != 'way' or len(points) < 2:
            continue
        roads.append({'id': element['id'], 'highway': element.get('tags', {}).get('highway'),
                      'coords': [[float(p['lon']), float(p['lat'])] for p in points]})
    meta = payload.get('osm3s', {})
    return {'roads': roads, 'provenance': {
        'source': 'OpenStreetMap via Overpass API', 'attribution': '© OpenStreetMap contributors',
        'license': meta.get('copyright') or 'ODbL', 'osm_timestamp': meta.get('timestamp_osm_base')}}


def _post(url, query, timeout_s):
    request = urllib.request.Request(url, data=urllib.parse.urlencode({'data': query}).encode(),
                                     headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310 (fixed https URL)
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError('Overpass response too large')
    return body


def fetch_roads(bounds, *, timeout_s=90, post=None):
    query = overpass_query(bounds)
    body = (post or _post)(OVERPASS_URL, query, timeout_s)
    parsed = parse_overpass(json.loads(body))
    parsed['provenance']['query'] = query
    return parsed


def road_exposure(roads, depth, crs):
    """Road length (km) inside the depth grid, and the part under caution (0.15-0.35 m) or cut (>= 0.35 m).

    Each segment is split into pieces of at most a quarter cell; a piece takes the depth of the cell
    holding its midpoint. Pieces outside the grid or on nodata cells are not counted.
    """
    grid, values, nodata = depth['grid'], depth['values'], depth['nodata']
    rows, cols = values.shape
    cell = grid['cellsize_m']
    top = grid['yllcorner'] + rows * cell
    to_metric = Transformer.from_crs('EPSG:4326', crs, always_xy=True)
    total = caution = cut = 0.0
    for road in roads:
        x, y = to_metric.transform(*np.asarray(road['coords'], dtype='float64').T)
        for x0, y0, x1, y1 in zip(x[:-1], y[:-1], x[1:], y[1:]):
            length = math.hypot(x1 - x0, y1 - y0)
            if not length:
                continue
            pieces = max(1, math.ceil(length / (cell / 4)))
            t = (np.arange(pieces) + .5) / pieces
            col = np.floor((x0 + t * (x1 - x0) - grid['xllcorner']) / cell).astype(int)
            row = np.floor((top - (y0 + t * (y1 - y0))) / cell).astype(int)
            inside = (row >= 0) & (row < rows) & (col >= 0) & (col < cols)
            h = values[row[inside], col[inside]]
            h = h[h != nodata]
            piece = length / pieces
            total += piece * h.size
            cut += piece * np.count_nonzero(h >= CUT_M)
            caution += piece * np.count_nonzero((h >= CAUTION_M) & (h < CUT_M))
    return {'total_km': total / 1000, 'caution_km': caution / 1000, 'cut_km': cut / 1000}
