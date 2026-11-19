import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.hydrology.boundaries import format_free_boundary


def make_dem(path, *, crs="EPSG:32615", transform=None, nodata=-9999, edge_nodata=False):
    data = np.arange(20, dtype="float32").reshape(4, 5)
    if edge_nodata:
        data[0, 0] = nodata
    with rasterio.open(path, "w", driver="GTiff", width=5, height=4, count=1,
                       dtype="float32", crs=crs,
                       transform=transform or from_origin(500000, 2200000, 10, 10),
                       nodata=nodata) as dataset:
        dataset.write(data, 1)
    return data


def test_writes_idealized_free_lines_and_manifest_from_real_dem(tmp_path):
    dem = tmp_path / "terrain.tif"
    make_dem(dem)
    target = tmp_path / "boundary"

    result = format_free_boundary(dem, target)

    assert result == target
    assert (target / "boundary.bci").read_text() == (
        "N 500000 500050 FREE\n"
        "E 2199960 2200000 FREE\n"
        "S 500000 500050 FREE\n"
        "W 2199960 2200000 FREE\n"
    )
    manifest = json.loads((target / "manifest.json").read_text())
    assert manifest["source"]["path"] == str(dem)
    assert manifest["grid"] == {
        "width": 5, "height": 4, "cell_size_m": 10,
        "bounds_m": {"xmin": 500000, "ymin": 2199960, "xmax": 500050, "ymax": 2200000},
        "crs": "EPSG:32615",
    }
    assert manifest["method"] == "all four computational DEM edges; FREE without supplied slope"
    assert manifest["semantics"] == "idealized FREE boundary per LISFLOOD-FP 8.0 CPU DG2; not an observed outlet; may permit inflow or outflow"
    assert manifest["synthetic"] is True
    assert manifest["idealized"] is True
    assert manifest["hydraulic_ready"] is False


def test_invalid_geometry_and_nodata_edge_fail_without_output_or_source_change(tmp_path):
    dem = tmp_path / "terrain.tif"
    data = make_dem(dem)
    target = tmp_path / "boundary"
    nonsquare = tmp_path / "nonsquare.tif"
    make_dem(nonsquare, transform=from_origin(0, 40, 10, 9))
    with pytest.raises(ValueError, match="square cells"):
        format_free_boundary(nonsquare, target)
    assert not target.exists()
    with rasterio.open(dem, "r+") as dataset:
        data[0, 0] = dataset.nodata
        dataset.write(data, 1)
    before_nodata = dem.read_bytes()
    with pytest.raises(ValueError, match="edge coverage"):
        format_free_boundary(dem, target)
    assert not target.exists()
    assert dem.read_bytes() == before_nodata


def test_rejects_nonprojected_rotated_and_existing_destination(tmp_path):
    dem = tmp_path / "terrain.tif"
    make_dem(dem)
    target = tmp_path / "boundary"
    unprojected = tmp_path / "unprojected.tif"
    make_dem(unprojected, crs="EPSG:4326")
    with pytest.raises(ValueError, match="projected metre"):
        format_free_boundary(unprojected, target)
    assert not target.exists()
    rotated = tmp_path / "rotated.tif"
    make_dem(rotated, transform=from_origin(0, 40, 10, 10) * rasterio.Affine.rotation(1))
    with pytest.raises(ValueError, match="north-up"):
        format_free_boundary(rotated, target)
    assert not target.exists()
    target.mkdir()
    sentinel = target / "keep"
    sentinel.write_text("unchanged")
    with pytest.raises(FileExistsError):
        format_free_boundary(dem, target)
    assert sentinel.read_text() == "unchanged"


def test_writes_per_side_fixed_level_and_free_lines_and_omits_closed_sides(tmp_path):
    from pipeline.hydrology.boundaries import format_boundary
    dem = tmp_path / "terrain.tif"
    make_dem(dem)
    sides = {"north": {"type": "fixed_level", "level_m": 0.5}, "east": {"type": "free"},
             "south": {"type": "closed"}, "west": {"type": "closed"}}
    target = format_boundary(dem, tmp_path / "boundary", sides)
    assert (target / "boundary.bci").read_text() == "N 500000 500050 HFIX 0.5\nE 2199960 2200000 FREE\n"
    manifest = json.loads((target / "manifest.json").read_text())
    assert manifest["sides"] == sides
    assert manifest["method"] == "per-side computational DEM edges: N=HFIX 0.5 m, E=FREE, S=closed, W=closed"


def test_all_closed_sides_need_no_boundary_file(tmp_path):
    from pipeline.hydrology.boundaries import format_boundary
    dem = tmp_path / "terrain.tif"
    make_dem(dem)
    with pytest.raises(ValueError, match="closed"):
        format_boundary(dem, tmp_path / "boundary", {s: {"type": "closed"} for s in ("north", "east", "south", "west")})
    assert not (tmp_path / "boundary").exists()


def test_normalize_boundary_accepts_legacy_strings_and_per_side_objects():
    from pipeline.hydrology.boundaries import normalize_boundary
    assert normalize_boundary("free") == {s: {"type": "free"} for s in ("north", "east", "south", "west")}
    assert normalize_boundary("closed") == {s: {"type": "closed"} for s in ("north", "east", "south", "west")}
    sides = {"north": {"type": "closed"}, "east": {"type": "free"}, "south": {"type": "fixed_level", "level_m": -1},
             "west": {"type": "fixed_level", "level_m": 0}}
    assert normalize_boundary(sides) == {**sides, "south": {"type": "fixed_level", "level_m": -1.0},
                                         "west": {"type": "fixed_level", "level_m": 0.0}}


@pytest.mark.parametrize("value", [
    "open", None, {"north": {"type": "free"}},
    {s: {"type": "free"} for s in ("north", "east", "south", "west", "up")},
    {**{s: {"type": "free"} for s in ("east", "south", "west")}, "north": {"type": "wall"}},
    {**{s: {"type": "free"} for s in ("east", "south", "west")}, "north": {"type": "fixed_level"}},
    {**{s: {"type": "free"} for s in ("east", "south", "west")}, "north": {"type": "fixed_level", "level_m": True}},
    {**{s: {"type": "free"} for s in ("east", "south", "west")}, "north": {"type": "fixed_level", "level_m": float("nan")}},
    {**{s: {"type": "free"} for s in ("east", "south", "west")}, "north": {"type": "fixed_level", "level_m": 20000}},
    {**{s: {"type": "free"} for s in ("east", "south", "west")}, "north": {"type": "free", "level_m": 1}},
])
def test_normalize_boundary_rejects_ambiguous_sides(value):
    from pipeline.hydrology.boundaries import normalize_boundary
    with pytest.raises(ValueError):
        normalize_boundary(value)
