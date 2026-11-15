"""Public incident-only delivery contract, using offline synthetic surface results."""
import hashlib
import json

import matplotlib
from matplotlib import colormaps
import numpy as np
from PIL import Image
import pytest
import rasterio
from rasterio.transform import Affine
from rasterio.warp import transform as project_points

from pipeline.solar.delivery import export_incident


def sample(upper=100., shape=(2, 3)):
    mask = np.array([[True, True, False], [True, False, True]])
    values = np.array([[0., upper / 2, np.nan], [upper, np.nan, 0.]])
    return {
        "incident_w_m2": values, "valid_mask": mask,
        "transform": (500000., 30., 0., 1800000., 0., -30.),
        "crs": "EPSG:32615", "model": "direct-geometric-v1", "units": "W/m2",
        "night": upper == 0,
        "position": {"datetime_utc": "2026-11-15T18:00:00+00:00", "dem_tile_ids": ["N16W094"],
                     "altitude_datum": "EGM96", "azimuth_deg": 180., "representative_point_lonlat": [-93., 16.]},
        "clear_sky": {"dni_adjusted_w_m2": upper, "atmospheric_provenance": {"pressure": "standard"},
                      "linke_dataset_sha256": None},
    }


def test_real_tiff_png_manifest_and_geographic_grid(tmp_path):
    result = sample()
    target = tmp_path / "run"
    manifest = export_incident(result, target, code_version="test-uncommitted")
    assert sorted(p.name for p in target.iterdir()) == ["incident.tif", "preview.png", "run.json"]
    assert manifest == json.loads((target / "run.json").read_text())
    assert manifest["code_version"] == "test-uncommitted"
    assert manifest["position"] == result["position"]
    assert manifest["clear_sky"] == result["clear_sky"]
    for name in ("incident.tif", "preview.png"):
        with (target / name).open("rb") as stream:
            assert manifest["files"][name] == hashlib.sha256(stream.read()).hexdigest()
    with rasterio.open(target / "incident.tif") as src:
        assert src.count == 1 and src.dtypes == ("float32",)
        assert src.crs.to_string() == manifest["raster"]["crs"] == "EPSG:32615"
        assert src.transform == Affine.from_gdal(*manifest["raster"]["transform_gdal"])
        assert src.tags()["units"] == "W/m2" and src.tags()["model"] == "direct-geometric-v1"
        assert src.dataset_mask().tolist() == (result["valid_mask"] * 255).tolist()
        assert np.isnan(src.read(1)[~result["valid_mask"]]).all()
        assert src.read(1)[0, 0] == 0
        assert manifest["raster"]["resolution_m"] == [30., 30.]
    with Image.open(target / "preview.png") as img:
        rgba = np.array(img.convert("RGBA"))
        assert img.mode == "RGBA"
    preview = manifest["preview"]
    assert rgba.shape == (preview["height"], preview["width"], 4)
    assert preview["crs"] == "EPSG:4326" and preview["palette"] == "inferno"
    assert preview["range_w_m2"] == [0., 100.] and not preview["zero_range"]
    assert preview["palette_source"]["matplotlib_version"] == matplotlib.__version__
    # Compare at projected pixel centers, allowing nearest-neighbor reprojection boundary shifts.
    affine = Affine.from_gdal(*preview["transform_gdal"])
    xs, ys = [], []
    for row, col in ((0, 0), (0, 1), (1, 0)):
        x, y = Affine.from_gdal(*result["transform"]) * (col + .5, row + .5)
        lon, lat = project_points("EPSG:32615", "EPSG:4326", [x], [y])
        pixel_col, pixel_row = ~affine * (lon[0], lat[0])
        assert abs(pixel_col - (round(pixel_col - .5) + .5)) <= .5
        r, c = round(pixel_row - .5), round(pixel_col - .5)
        assert 0 <= r < rgba.shape[0] and 0 <= c < rgba.shape[1]
        if rgba[r, c, 3]:
            xs.append((row, col, r, c))
    assert xs
    # The final PNG corners, not the source metric bbox, define geographic overlay bounds.
    west, south, east, north = preview["bounds_lonlat"]
    assert np.allclose([west, north], affine * (0, 0))
    assert np.allclose([east, south], affine * (preview["width"], preview["height"]))
    cmap = colormaps["inferno"]
    colors = np.rint(cmap(np.array([0., .5, 1.])) * 255).astype("uint8")
    # Source centers will be represented unless reprojection resamples away narrow pixels.
    opaque = rgba[rgba[:, :, 3] == 255]
    for color in colors:
        assert np.any(np.all(opaque == color, axis=1))
    assert np.any(rgba[:, :, 3] == 0)


def test_night_zero_is_opaque_minimum_not_nodata(tmp_path):
    result = sample(0.)
    result["incident_w_m2"][result["valid_mask"]] = 0
    manifest = export_incident(result, tmp_path / "night")
    assert manifest["preview"]["zero_range"] is True
    with Image.open(tmp_path / "night" / "preview.png") as img:
        rgba = np.array(img)
    minimum = np.rint(np.array(colormaps["inferno"](0.0)) * 255).astype("uint8")
    assert np.any(np.all(rgba == minimum, axis=2))
    assert np.any(rgba[:, :, 3] == 0)


@pytest.mark.parametrize("mutate", [
    lambda r: r.update(valid_mask=r["valid_mask"].astype("uint8")),
    lambda r: r.update(valid_mask=r["valid_mask"][:, :1]),
    lambda r: r["incident_w_m2"].__setitem__((0, 0), -1),
    lambda r: r["incident_w_m2"].__setitem__((0, 1), 101),
    lambda r: r["incident_w_m2"].__setitem__((0, 0), np.nan),
    lambda r: r["incident_w_m2"].__setitem__((0, 2), 0),
    lambda r: r.update(crs="EPSG:4326"),
])
def test_reject_malformed_input_before_publication(tmp_path, mutate):
    result = sample()
    mutate(result)
    with pytest.raises(ValueError):
        export_incident(result, tmp_path / "bad")
    assert not (tmp_path / "bad").exists()


def test_failure_during_png_or_manifest_cleans_only_own_staging(tmp_path, monkeypatch):
    import pipeline.solar.delivery as delivery
    for name in ("_save_preview", "_write_manifest"):
        with monkeypatch.context() as patch:
            def fail(*args, **kwargs):
                raise OSError("synthetic failure")
            patch.setattr(delivery, name, fail)
            with pytest.raises(OSError, match="synthetic failure"):
                export_incident(sample(), tmp_path / name)
            assert not (tmp_path / name).exists()
            assert not list(tmp_path.glob(".solar-incident-*"))


def test_bounded_preview_and_existing_destination(tmp_path):
    result = sample()
    export_incident(result, tmp_path / "run", max_preview_pixels=1)
    with Image.open(tmp_path / "run" / "preview.png") as img:
        assert img.width * img.height <= 1
    with pytest.raises(FileExistsError):
        export_incident(result, tmp_path / "run")
    assert sorted(p.name for p in (tmp_path / "run").iterdir()) == ["incident.tif", "preview.png", "run.json"]
