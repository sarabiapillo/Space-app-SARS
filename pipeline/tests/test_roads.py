"""OpenStreetMap roads (Overpass) and their exposure to DG2 water depth; no network."""
import json

import numpy as np
import pytest
from pyproj import Transformer

from pipeline.hydrology.roads import fetch_roads, overpass_query, parse_overpass, road_exposure

PAYLOAD = {
    'osm3s': {'timestamp_osm_base': '2026-11-20T00:30:16Z',
              'copyright': 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.'},
    'elements': [
        {'type': 'way', 'id': 7, 'tags': {'highway': 'residential'},
         'geometry': [{'lat': 16.0, 'lon': -93.0}, {'lat': 16.001, 'lon': -93.0}]},
        {'type': 'way', 'id': 8, 'tags': {'highway': 'track'}, 'geometry': [{'lat': 16.0, 'lon': -93.0}]},  # one point: no length
        {'type': 'node', 'id': 9},
    ],
}


def test_overpass_query_asks_only_vehicular_roads_inside_the_bounds():
    query = overpass_query((-93.3, 16.67, -93.29, 16.68))
    assert query.startswith('[out:json]')
    assert '(16.67,-93.3,16.68,-93.29)' in query and 'out geom' in query
    assert 'residential' in query and 'track' in query and 'footway' not in query and 'cycleway' not in query
    with pytest.raises(ValueError):
        overpass_query((-93.29, 16.67, -93.3, 16.68))


def test_parse_keeps_ways_with_a_line_and_the_odbl_provenance():
    parsed = parse_overpass(PAYLOAD)
    assert parsed['roads'] == [{'id': 7, 'highway': 'residential', 'coords': [[-93.0, 16.0], [-93.0, 16.001]]}]
    assert parsed['provenance']['osm_timestamp'] == '2026-11-20T00:30:16Z'
    assert 'ODbL' in parsed['provenance']['license']


def test_fetch_posts_the_query_and_parses_the_answer():
    sent = {}

    def post(url, query, timeout_s):
        sent.update(url=url, query=query, timeout_s=timeout_s)
        return json.dumps(PAYLOAD).encode()
    parsed = fetch_roads((-93.3, 16.67, -93.29, 16.68), post=post)
    assert sent['url'].startswith('https://overpass-api.de/') and sent['query'] == overpass_query((-93.3, 16.67, -93.29, 16.68))
    assert [road['id'] for road in parsed['roads']] == [7]


def test_road_exposure_measures_road_length_by_water_depth_class():
    # 30 m cells; row 0 (north) holds 0.5 m (cut) and 0.2 m (caution); row 1 is dry.
    depth = {'values': np.array([[.5, .2], [0, 0]]), 'nodata': -9999.0,
             'grid': {'shape': [2, 2], 'cellsize_m': 30.0, 'xllcorner': 500000.0, 'yllcorner': 1850000.0}}
    to_lonlat = Transformer.from_crs('EPSG:32615', 'EPSG:4326', always_xy=True)
    along_row0 = [list(to_lonlat.transform(x, 1850045)) for x in (500000, 500060)]
    along_row1 = [list(to_lonlat.transform(x, 1850015)) for x in (500000, 500060)]
    exposure = road_exposure([{'id': 1, 'highway': 'primary', 'coords': along_row0},
                              {'id': 2, 'highway': 'primary', 'coords': along_row1}], depth, 'EPSG:32615')
    assert exposure['total_km'] == pytest.approx(.12, abs=1e-4)
    assert exposure['cut_km'] == pytest.approx(.03, abs=1e-4)
    assert exposure['caution_km'] == pytest.approx(.03, abs=1e-4)
