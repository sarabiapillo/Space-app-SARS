import io
import zipfile

import numpy as np
import pytest

from pipeline.solar.dem import prepare_dem, required_nasadem_tiles


def roi(west, south, east, north):
    return {"type": "Polygon", "coordinates": [[
        [west, south], [east, south], [east, north], [west, north], [west, south]
    ]]}


@pytest.mark.parametrize("bounds,expected", [
    ((-93.3919, 16.6539, -92.8757, 16.8964), ("n16w093", "n16w094")),
    ((-71.9, -33.5, -71.5, -33.2), ("s34w072",)),
    ((1.0, 16.0, 2.0, 17.0), ("n16e001",)),
    ((-.5, .2, .2, .8), ("n00e000", "n00w001")),
])
def test_variable_roi_uses_southwest_tile_origin_without_extra_border_tiles(bounds, expected):
    selected, _ = required_nasadem_tiles(roi(*bounds))
    assert selected == expected


def test_halo_is_optional_and_stays_inside_nasadem_latitude_band():
    selected, halo = required_nasadem_tiles(roi(1.2, 59.2, 1.8, 60.0))
    assert selected == ("n59e001",)
    assert "n60e001" not in halo
    assert "n58e001" in halo
    assert len(halo) == 5
    middle, neighbors = required_nasadem_tiles(roi(1.2, 16.2, 1.8, 16.8))
    assert middle == ("n16e001",)
    assert len(neighbors) == 8 and middle[0] not in neighbors


def test_multipolygon_skips_bbox_tiles_not_intersecting_actual_roi():
    geometry = {"type": "MultiPolygon", "coordinates": [
        [[[.1, .1], [.2, .1], [.2, .2], [.1, .2], [.1, .1]]],
        [[[2.1, .1], [2.2, .1], [2.2, .2], [2.1, .2], [2.1, .1]]],
    ]}
    selected, _ = required_nasadem_tiles(geometry)
    assert selected == ("n00e000", "n00e002")


@pytest.mark.parametrize("bounds", [
    (1.1, 59.5, 1.8, 60.1), (1.1, -56.1, 1.8, -55.5),
    (-179.8, 0.2, 179.8, .8),
])
def test_rejects_outside_coverage_or_unrepresentable_extent(bounds):
    with pytest.raises(ValueError, match="coverage|extent|limit"):
        required_nasadem_tiles(roi(*bounds))


def test_two_selected_tiles_prepare_another_roi_without_chiapas_constants():
    geometry = roi(.9, .2, 1.1, .8)
    selected, _ = required_nasadem_tiles(geometry)
    assert selected == ("n00e000", "n00e001")
    sources = {}
    for tile in selected:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr(f"{tile}.hgt", np.ones((5, 5), dtype=">i2").tobytes())
        sources[tile.upper()] = stream.getvalue()
    prepared = prepare_dem(sources, geometry, tile_size=5, max_pixels=1000)
    assert prepared.valid_mask.any()
    assert set(prepared.provenance) == {tile.upper() for tile in selected}


def test_rejects_roi_exceeding_tile_budget_before_fetch():
    with pytest.raises(ValueError, match="tile|limit"):
        required_nasadem_tiles(roi(1.2, 16.2, 3.8, 16.8), max_tiles=2)
