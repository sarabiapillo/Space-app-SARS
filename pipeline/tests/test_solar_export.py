import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import CRS
from rasterio.transform import Affine

from pipeline.solar.dem import PreparedDEM
from pipeline.solar.export import export_radiation
from pipeline.solar.radiation import simulate_radiation


PARAMETERS = {"irradiance_w_m2": 1000, "azimuth_deg": 180,
              "elevation_deg": 30, "albedo": .2}
SOURCES = {"N16W094": "a" * 64}


def sample():
    mask = np.array([[True, False], [True, True]])
    normals = np.repeat(np.array([[[0., 0., 1.]]]), 4, axis=1).reshape(2, 2, 3)
    normals[0, 1] = np.nan
    result = simulate_radiation(normals, mask, **PARAMETERS)
    dem = PreparedDEM(np.where(mask, 30., np.nan).astype("float32"), mask,
                      np.zeros_like(mask), (500000., 30., 0., 1800000., 0., -30.),
                      CRS.from_epsg(32615), ("N16W094",))
    return result, dem


def test_exports_both_rasters_with_georeferencing_mask_and_provenance(tmp_path):
    result, dem = sample()
    output = tmp_path / "run"
    manifest = export_radiation(result, dem, PARAMETERS, SOURCES, "test-revision", output)
    assert sorted(p.name for p in output.iterdir()) == ["absorbed.tif", "incident.tif", "run.json"]
    assert manifest == json.loads((output / "run.json").read_text())
    assert manifest["sources"] == SOURCES
    assert manifest["parameters"] == PARAMETERS
    assert manifest["code_version"] == "test-revision"
    assert manifest["provenance"] == ["N16W094"]
    for layer, filename in (("incident", "incident.tif"), ("absorbed", "absorbed.tif")):
        with rasterio.open(output / filename) as raster:
            assert raster.count == 1 and raster.crs == dem.crs
            assert raster.transform == Affine.from_gdal(*dem.transform)
            assert raster.nodata is not None and np.isnan(raster.nodata)
            assert raster.tags()["units"] == "W/m2"
            assert raster.dataset_mask().tolist() == (dem.valid_mask.astype("uint8") * 255).tolist()
            assert np.allclose(raster.read(1)[dem.valid_mask], result[layer][dem.valid_mask])
        assert manifest["files"][filename] == hashlib.sha256((output / filename).read_bytes()).hexdigest()


def test_invalid_result_or_existing_destination_does_not_publish_partial_run(tmp_path):
    result, dem = sample()
    output = tmp_path / "run"
    bad = {**result, "absorbed": result["absorbed"].copy()}
    bad["absorbed"][0, 0] = 999
    with pytest.raises(ValueError):
        export_radiation(bad, dem, PARAMETERS, SOURCES, "test-revision", output)
    assert not output.exists()
    output.mkdir()
    sentinel = output / "keep.txt"
    sentinel.write_text("unrelated")
    with pytest.raises((ValueError, FileExistsError)):
        export_radiation(result, dem, PARAMETERS, SOURCES, "test-revision", output)
    assert sentinel.read_text() == "unrelated"
    assert [p.name for p in output.iterdir()] == ["keep.txt"]


def test_failure_writing_second_raster_never_exposes_half_result(tmp_path, monkeypatch):
    result, dem = sample()
    original = rasterio.open

    def fail_absorbed(path, mode="r", **kwargs):
        if Path(path).name == "absorbed.tif" and mode == "w":
            raise OSError("synthetic write failure")
        return original(path, mode, **kwargs)

    monkeypatch.setattr(rasterio, "open", fail_absorbed)
    output = tmp_path / "run"
    with pytest.raises(OSError, match="synthetic write failure"):
        export_radiation(result, dem, PARAMETERS, SOURCES, "test-revision", output)
    assert not output.exists()
    assert not list(tmp_path.glob(".solar-stage-*"))
