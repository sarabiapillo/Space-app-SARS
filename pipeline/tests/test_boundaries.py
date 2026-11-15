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
