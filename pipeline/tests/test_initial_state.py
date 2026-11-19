"""Still-water start for DG2 (`startfile`): sea cells begin at the fixed boundary level."""
import json

import numpy as np
import pytest

from pipeline.hydrology.initial_state import write_still_water_start

HEADER = 'ncols 4\nnrows 3\nxllcorner 500000\nyllcorner 1850000\ncellsize 30\nNODATA_value -9999\n'
SIDES_WEST = {'north': {'type': 'closed'}, 'east': {'type': 'free'}, 'south': {'type': 'closed'},
              'west': {'type': 'fixed_level', 'level_m': 1.0}}


def grid(path, rows):
    path.write_text(HEADER + ''.join(' '.join(str(v) for v in row) + '\n' for row in rows))


def read(path):
    lines = path.read_text().splitlines()
    assert '\n'.join(lines[:6]) + '\n' == HEADER
    return np.loadtxt(lines[6:], ndmin=2)


@pytest.fixture
def dg2(tmp_path):
    directory = tmp_path / 'dg2'
    directory.mkdir()
    # Row 0 is north. The 0 m cells on the east (column 3) lie below the level but are cut off
    # from the west sea by the 5 m ridge and the 2 m cell: they must stay dry.
    grid(directory / 'terrain.dem', [[0, 0, 5, 0], [0, 2, 5, .5], [0, 0, 5, 5]])
    grid(directory / 'terrain.dem1x', [[.1, .2, .3, .4], [.5, .6, .7, .8], [.9, 1, 1.1, 1.2]])
    grid(directory / 'terrain.dem1y', [[-.1, -.2, -.3, -.4], [-.5, -.6, -.7, -.8], [-.9, -1, -1.1, -1.2]])
    return directory


def test_cells_below_level_connected_to_the_fixed_side_start_as_still_water(dg2, tmp_path):
    summary = write_still_water_start(dg2, tmp_path / 'initial', SIDES_WEST)
    sea = np.array([[1, 1, 0, 0], [1, 0, 0, 0], [1, 1, 0, 0]], dtype=bool)
    depth = read(tmp_path / 'initial/initial.wd')
    np.testing.assert_allclose(depth, np.where(sea, 1.0, 0.0))
    # Flat free surface over a sloping bed: depth slopes cancel the bed slopes (eta1x = H1x + Z1x = 0).
    np.testing.assert_allclose(read(tmp_path / 'initial/initial.wd1x'), np.where(sea, -read(dg2 / 'terrain.dem1x'), 0))
    np.testing.assert_allclose(read(tmp_path / 'initial/initial.wd1y'), np.where(sea, -read(dg2 / 'terrain.dem1y'), 0))
    assert summary == {'level_m': 1.0, 'wet_cells': 5, 'volume_m3': pytest.approx(5 * 900)}
    manifest = json.loads((tmp_path / 'initial/manifest.json').read_text())
    assert manifest['summary'] == summary and manifest['sides'] == SIDES_WEST


def test_fixed_sides_must_share_one_level(dg2, tmp_path):
    sides = {**SIDES_WEST, 'north': {'type': 'fixed_level', 'level_m': 2.0}}
    with pytest.raises(ValueError, match='one level'):
        write_still_water_start(dg2, tmp_path / 'initial', sides)
    with pytest.raises(ValueError, match='fixed_level'):
        write_still_water_start(dg2, tmp_path / 'other', {s: {'type': 'free'} for s in SIDES_WEST})


def test_level_below_every_edge_cell_leaves_the_domain_dry(dg2, tmp_path):
    sides = {**SIDES_WEST, 'west': {'type': 'fixed_level', 'level_m': -1.0}}
    assert write_still_water_start(dg2, tmp_path / 'initial', sides)['wet_cells'] == 0
    assert not read(tmp_path / 'initial/initial.wd').any()
