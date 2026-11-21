"""Offline tests for the ESA WorldCover land-cover module (no network: readers are injected)."""
import math

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.hydrology import landcover as lc


# --- tile naming -------------------------------------------------------------------------------

@pytest.mark.parametrize("bounds, expected", [
    # Tuxtla Gutierrez, Chiapas: lon -93.12 lies in the tile whose SW corner is (-96, 15).
    ((-93.12, 16.74, -93.11, 16.75), ["N15W096"]),
    # Southern and eastern hemispheres (Lake Victoria shore, Uganda/Tanzania).
    ((33.0, -1.5, 33.1, -1.4), ["S03E033"]),
    # Exactly on the equator and prime meridian.
    ((-0.1, -0.1, 0.1, 0.1), ["N00E000", "N00W003", "S03E000", "S03W003"]),
    # Spanning a tile boundary in longitude (-93.0) only.
    ((-93.05, 16.0, -92.95, 16.1), ["N15W093", "N15W096"]),
    # Northern edge exactly on a tile boundary does not pull the next tile.
    ((10.0, 44.5, 10.5, 45.0), ["N42E009"]),
])
def test_tile_names_cover_bounds_in_every_hemisphere(bounds, expected):
    assert sorted(lc.worldcover_tiles(bounds)) == sorted(expected)


def test_tile_url_pattern_is_the_public_v200_2021_bucket():
    assert lc.worldcover_tile_url("N15W096") == (
        "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
        "ESA_WorldCover_10m_2021_v200_N15W096_Map.tif")


@pytest.mark.parametrize("bounds", [
    (170.0, 0.0, -170.0, 1.0),      # crosses the antimeridian (west > east)
    (-93.0, 16.0, -93.0, 16.1),     # empty
    (-181.0, 0.0, -179.0, 1.0),     # outside longitude range
    (0.0, -70.0, 1.0, -69.0),       # south of WorldCover coverage (-60)
    (0.0, 84.5, 1.0, 85.0),         # north of WorldCover coverage (84)
    (float("nan"), 0.0, 1.0, 1.0),
])
def test_invalid_or_antimeridian_bounds_are_rejected(bounds):
    with pytest.raises(ValueError):
        lc.worldcover_tiles(bounds)


# --- mosaic with injected reader ---------------------------------------------------------------

def _fake_reader(values_by_tile, calls):
    def reader(url, window):
        calls.append((url, window))
        tile = url.rsplit("_v200_", 1)[1].split("_Map")[0]
        if tile not in values_by_tile:
            return None  # tile does not exist (open ocean)
        col_off, row_off, width, height = window
        return np.full((height, width), values_by_tile[tile], dtype=np.uint8)
    return reader


def test_fetch_mosaics_two_tiles_and_fills_missing_ocean_tile_with_water():
    calls = []
    # Bounds straddle lon -93 (two tiles) and lat 15 (the tiles south of 15 are "missing").
    bounds = (-93.001, 14.999, -92.999, 15.001)
    reader = _fake_reader({"N15W096": 10, "N15W093": 40}, calls)
    result = lc.fetch_worldcover(bounds, reader=reader)
    classes, transform = result["classes"], result["transform"]
    step = 1 / 12000
    assert transform.a == pytest.approx(step) and transform.e == pytest.approx(-step)
    # Grid snapped outward to the native 10 m WorldCover grid.
    assert transform.c == pytest.approx(math.floor(-93.001 * 12000) / 12000)
    assert transform.f == pytest.approx(math.ceil(15.001 * 12000) / 12000)
    assert classes.shape == (24, 24)
    north, south = classes[:12], classes[12:]
    assert (north[:, :12] == 10).all() and (north[:, 12:] == 40).all()
    assert (south == lc.WATER_CLASS).all()
    prov = result["provenance"]
    assert set(prov["missing_tiles"]) == {"N12W096", "N12W093"}
    assert prov["outside_policy"] == "water"
    assert prov["licence"] == "CC BY 4.0"
    assert prov["attribution"] == ("© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data "
                                   "(2021) processed by ESA WorldCover consortium")
    assert all(url.startswith("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/")
               for url in prov["tile_urls"])
    # Windows requested are tile-relative and only cover the needed pixels.
    for url, (col_off, row_off, width, height) in calls:
        assert 0 <= col_off and 0 <= row_off and width <= 12 and height <= 12


def test_nodata_pixels_outside_observed_land_follow_the_outside_policy():
    def reader(url, window):
        data = np.full((window[3], window[2]), 40, dtype=np.uint8)
        data[:, :3] = 0  # open sea outside the Sentinel-2 land footprint is 0 inside existing tiles
        return data

    bounds = (-93.12, 16.74, -93.119, 16.741)
    as_water = lc.fetch_worldcover(bounds, reader=reader)
    assert (as_water["classes"][:, :3] == lc.WATER_CLASS).all() and (as_water["classes"][:, 3:] == 40).all()
    assert as_water["provenance"]["outside_land_pixels"] == 3 * as_water["classes"].shape[0]
    kept = lc.fetch_worldcover(bounds, reader=reader, outside_policy="unknown")
    assert (kept["classes"][:, :3] == 0).all()
    missing = lc.fetch_worldcover(bounds, reader=lambda url, window: None, outside_policy="unknown")
    assert (missing["classes"] == 0).all() and missing["provenance"]["missing_tiles"] == ["N15W096"]
    with pytest.raises(ValueError):
        lc.fetch_worldcover(bounds, reader=reader, outside_policy="land")


def test_fetch_window_offsets_inside_one_tile():
    calls = []
    lc.fetch_worldcover((-93.12, 16.74, -93.11, 16.75), reader=_fake_reader({"N15W096": 50}, calls))
    assert len(calls) == 1
    col_off, row_off, width, height = calls[0][1]
    assert col_off == math.floor(round((-93.12 + 96) * 12000, 6))
    assert row_off == math.floor(round((18 - 16.75) * 12000, 6))
    assert width == 120 and height == 120


def test_fetch_refuses_oversized_requests():
    with pytest.raises(ValueError, match="max_pixels"):
        lc.fetch_worldcover((-93.5, 16.5, -93.0, 17.0), reader=_fake_reader({}, []), max_pixels=1000)


# --- resampling --------------------------------------------------------------------------------

def test_mode_resampling_and_built_fraction_on_a_metric_grid():
    # 6x6 source at 10 m -> 2x2 target at 30 m. Each 3x3 block has a strict majority.
    src = np.array([
        [10, 10, 50, 40, 40, 40],
        [10, 10, 50, 40, 40, 30],
        [10, 50, 50, 40, 30, 30],
        [50, 50, 50, 80, 80, 80],
        [50, 50, 10, 80, 80, 80],
        [50, 10, 10, 80, 80, 0],
    ], dtype=np.uint8)
    src_t = from_origin(500000, 1850000, 10, 10)
    dst_t = from_origin(500000, 1850000, 30, 30)
    out = lc.resample_classes(src, src_t, "EPSG:32615", (2, 2), dst_t, "EPSG:32615")
    np.testing.assert_array_equal(out["classes"], [[10, 40], [50, 80]])
    np.testing.assert_allclose(out["built_fraction"], [[4 / 9, 0.0], [6 / 9, 0.0]])


# --- Manning -----------------------------------------------------------------------------------

def test_manning_table_has_citations_and_ranges_for_every_worldcover_class():
    for code in (10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100):
        entry = lc.MANNING_TABLE[code]
        assert entry["low"] <= entry["n"] <= entry["high"]
        assert entry["source"]
    built = lc.MANNING_TABLE[50]
    assert (built["n"], built["low"], built["high"]) == (0.10, 0.06, 0.16)


def test_manning_grid_maps_classes_and_leaves_nodata_as_nan():
    classes = np.array([[10, 50], [80, 0]], dtype=np.uint8)
    grid = lc.manning_grid(classes)
    assert grid[0, 0] == pytest.approx(0.10) and grid[0, 1] == pytest.approx(0.10)
    assert grid[1, 0] == pytest.approx(0.035) and math.isnan(grid[1, 1])
    low = lc.manning_grid(classes, scenario="low")
    high = lc.manning_grid(classes, scenario="high")
    assert low[0, 1] == pytest.approx(0.06) and high[0, 1] == pytest.approx(0.16)
    bare = lc.manning_grid(classes, urban_branch="buildings_in_dem")
    assert bare[0, 1] == pytest.approx(0.018)
    with pytest.raises(ValueError):
        lc.manning_grid(np.array([[11]], dtype=np.uint8))


def test_manning_file_matches_terrain_header_and_values(tmp_path):
    terrain = tmp_path / "terrain.dem"
    header = ("ncols 3\nnrows 2\nxllcorner 500000\nyllcorner 1849940\ncellsize 30\nNODATA_value -9999\n")
    terrain.write_text(header + "1 2 3\n4 5 6\n", encoding="ascii")
    manning = np.array([[0.1, 0.035, np.nan], [0.07, 0.15, 0.025]])
    out = lc.write_manning_file(tmp_path / "manning.asc", manning, template_dem=terrain)
    lines = out.read_text(encoding="ascii").splitlines()
    assert "\n".join(lines[:6]) + "\n" == header
    rows = [[float(v) for v in line.split()] for line in lines[6:]]
    assert rows == [[0.1, 0.035, -9999.0], [0.07, 0.15, 0.025]]
    with pytest.raises(FileExistsError):
        lc.write_manning_file(tmp_path / "manning.asc", manning, template_dem=terrain)
    with pytest.raises(ValueError):
        lc.write_manning_file(tmp_path / "bad.asc", manning[:, :2], template_dem=terrain)
    with pytest.raises(ValueError):
        lc.write_manning_file(tmp_path / "neg.asc", -manning, template_dem=terrain)


def test_manning_file_header_from_transform(tmp_path):
    out = lc.write_manning_file(tmp_path / "m.asc", np.full((2, 2), 0.05),
                                transform=from_origin(500000, 1850000, 30, 30))
    lines = out.read_text(encoding="ascii").splitlines()
    assert lines[:6] == ["ncols 2", "nrows 2", "xllcorner 500000", "yllcorner 1849940",
                         "cellsize 30", "NODATA_value -9999"]


def test_landcover_for_grid_end_to_end_with_injected_reader(tmp_path):
    # Target UTM 15N grid of 3x3 cells of 30 m around Tuxtla; reader returns built-up everywhere.
    from pyproj import Transformer
    x, y = Transformer.from_crs(4326, 32615, always_xy=True).transform(-93.115, 16.745)
    dst_t = from_origin(round(x) - 45, round(y) + 45, 30, 30)
    calls = []
    result = lc.landcover_for_grid((3, 3), dst_t, "EPSG:32615", reader=_fake_reader({"N15W096": 50}, calls))
    assert (result["classes"] == 50).all()
    np.testing.assert_allclose(result["built_fraction"], 1.0)
    np.testing.assert_allclose(result["manning"], 0.10)
    assert result["provenance"]["tiles"] == ["N15W096"]
    assert result["provenance"]["resampling"]["classes"] == "mode"
