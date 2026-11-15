from pathlib import Path
import zipfile

import numpy as np
import pytest
from rasterio.crs import CRS

from pipeline.elevation.nasadem import NASADEMGranule
from pipeline.hydrology.dem_prepared import prepare_dem


@pytest.fixture(scope="module")
def hgt_zip(tmp_path_factory):
    path = tmp_path_factory.mktemp("synthetic-nasadem") / "n00e000.zip"
    # A structurally sized test fixture; values are synthetic and not NASA data.
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("n00e000.hgt", np.full((3601, 3601), 123, dtype=">i2").tobytes())
    return path


@pytest.fixture(scope="module")
def adjacent_hgt_zips(tmp_path_factory):
    root = tmp_path_factory.mktemp("synthetic-adjacent")
    columns = np.arange(3601, dtype=np.int16)
    west = np.broadcast_to((100 + columns).astype(">i2"), (3601, 3601)).copy()
    east = np.broadcast_to((8000 + columns).astype(">i2"), (3601, 3601)).copy()
    west_path, east_path = root / "west.zip", root / "east.zip"
    for path, member, samples in ((west_path, "n00e000.hgt", west), (east_path, "n00e001.hgt", east)):
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(member, samples.tobytes())
    return west_path, east_path


@pytest.fixture(scope="module")
def nodata_hgt_zip(tmp_path_factory):
    path = tmp_path_factory.mktemp("synthetic-void") / "n00e000-void.zip"
    samples = np.full((3601, 3601), 123, dtype=">i2")
    samples[1799:1802, 1799:1802] = -32768
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("n00e000.hgt", samples.tobytes())
    return path


def record(path, tile="n00e000"):
    return NASADEMGranule(tile, f"NASADEM_HGT_{tile}", "NASADEM_HGT", "001", Path(path))


def polygon(west=0.2, south=0.2, east=0.8, north=0.8):
    return {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}


def test_prepare_dem_writes_clipped_geotiff_and_traceable_manifest(hgt_zip, tmp_path):
    destination = tmp_path / "prepared"
    result = prepare_dem(
        polygon(), [record(hgt_zip)], destination,
        target_crs="EPSG:32631", resolution_m=1000, resampling="nearest",
        max_cells=10000, target_vertical_datum="EGM96", code_version="test-1",
    )
    assert result == destination
    import rasterio
    with rasterio.open(destination / "terrain.tif") as raster:
        assert raster.crs == CRS.from_epsg(32631)
        assert raster.count == 1 and raster.dtypes == ("float32",)
        assert raster.nodata is not None
        assert raster.transform.a == 1000 and raster.transform.e == -1000
        values = raster.read(1, masked=True)
        assert values.count() > 0
        assert np.allclose(values.compressed(), 123)
    import json
    manifest = json.loads((destination / "manifest.json").read_text())
    assert manifest["source"]["product"] == "NASADEM_HGT"
    assert manifest["source"]["vertical_datum"] == manifest["target_vertical_datum"] == "EGM96"
    import hashlib
    with zipfile.ZipFile(hgt_zip) as archive:
        expected_digest = hashlib.sha256(archive.read("n00e000.hgt")).hexdigest()
    assert manifest["source"]["records"][0]["hgt_sha256"] == expected_digest
    assert manifest["geometry"] == {"crs": "EPSG:4326", "geojson": polygon()}
    assert manifest["hydraulic_ready"] is False
    assert manifest["coverage"]["missing_selected_cells"] == 0


def test_rejects_mismatched_vertical_datum_without_creating_output(hgt_zip, tmp_path):
    destination = tmp_path / "not-created"
    with pytest.raises(ValueError, match="vertical datum"):
        prepare_dem(polygon(), [record(hgt_zip)], destination, target_crs="EPSG:32631",
                    resolution_m=1000, resampling="nearest", max_cells=1000,
                    target_vertical_datum="WGS84", code_version="test")
    assert not destination.exists()


@pytest.mark.parametrize("crs", ["EPSG:4326", "EPSG:2263", "not-a-crs"])
def test_rejects_nonmetric_or_invalid_crs_before_output(hgt_zip, tmp_path, crs):
    destination = tmp_path / "not-created"
    with pytest.raises(ValueError, match="projected.*metre"):
        prepare_dem(polygon(), [record(hgt_zip)], destination, target_crs=crs,
                    resolution_m=1000, resampling="nearest", max_cells=1000,
                    target_vertical_datum="EGM96", code_version="test")
    assert not destination.exists()


@pytest.mark.parametrize("changes", [
    {"resolution_m": 0}, {"resolution_m": float("nan")}, {"resolution_m": 10 ** 1000},
    {"max_cells": 0}, {"max_cells": "many"}, {"target_vertical_datum": "WGS84"},
    {"resampling": "cubic"}, {"resampling": []}, {"code_version": ""},
])
def test_rejects_invalid_explicit_configuration_before_output(hgt_zip, tmp_path, changes):
    options = {"target_crs": "EPSG:32631", "resolution_m": 1000,
               "resampling": "nearest", "max_cells": 10000,
               "target_vertical_datum": "EGM96", "code_version": "test"}
    options.update(changes)
    destination = tmp_path / "not-created"
    with pytest.raises(ValueError):
        prepare_dem(polygon(), [record(hgt_zip)], destination, **options)
    assert not destination.exists()


def test_target_cell_budget_and_missing_source_coverage_reject_without_output(hgt_zip, tmp_path):
    destination = tmp_path / "not-created"
    options = {"target_crs": "EPSG:32631", "resolution_m": 100,
               "resampling": "nearest", "max_cells": 2,
               "target_vertical_datum": "EGM96", "code_version": "test"}
    with pytest.raises(ValueError, match="max_cells"):
        prepare_dem(polygon(), [record(hgt_zip)], destination, **options)
    assert not destination.exists()
    options["max_cells"] = 10000
    options["resolution_m"] = 1000
    with pytest.raises(ValueError, match="coverage missing"):
        prepare_dem(polygon(1.2, 0.2, 1.8, 0.8), [record(hgt_zip)], destination, **options)
    assert not destination.exists()


def test_manifest_geometry_matches_mask_and_nonrectangular_hole(hgt_zip, tmp_path):
    geometry = {"type": "Polygon", "coordinates": [
        [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]],
        [[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]],
    ]}
    destination = tmp_path / "hole"
    prepare_dem(geometry, [record(hgt_zip)], destination, target_crs="EPSG:4087",
                resolution_m=1000, resampling="nearest", max_cells=10000,
                target_vertical_datum="EGM96", code_version="test")
    import json
    import rasterio
    from rasterio.warp import transform
    manifest = json.loads((destination / "manifest.json").read_text())
    with rasterio.open(destination / "terrain.tif") as raster:
        data = raster.read(1)
        assert manifest["geometry"] == {"crs": "EPSG:4326", "geojson": geometry}
        assert manifest["coverage"]["selected_cell_centers"] == int(np.count_nonzero(np.isfinite(data)))
        x, y = transform("EPSG:4326", raster.crs, [0.5], [0.5])
        row, col = raster.index(x[0], y[0])
        assert np.isnan(data[row, col])
        assert np.any(np.isfinite(data)) and np.any(np.isnan(data))


@pytest.mark.parametrize("resampling", ["nearest", "bilinear"])
def test_internal_invalid_height_rejects_selected_cell_without_writes(nodata_hgt_zip, tmp_path, resampling):
    spacing = 111319.49079327358 / 3600
    center = 0.5 * 111319.49079327358
    geometry = polygon((center - spacing / 2) / 111319.49079327358,
                       (center - spacing / 2) / 111319.49079327358,
                       (center + spacing / 2) / 111319.49079327358,
                       (center + spacing / 2) / 111319.49079327358)
    before = nodata_hgt_zip.read_bytes()
    destination = tmp_path / f"void-{resampling}"
    with pytest.raises(ValueError, match="coverage missing"):
        prepare_dem(geometry, [record(nodata_hgt_zip)], destination, target_crs="EPSG:4087",
                    resolution_m=spacing, resampling=resampling, max_cells=4,
                    target_vertical_datum="EGM96", code_version="test")
    assert not destination.exists()
    assert nodata_hgt_zip.read_bytes() == before


def test_invalid_height_outside_geometry_does_not_remove_valid_terrain(nodata_hgt_zip, tmp_path):
    geometry = polygon(0.69, 0.69, 0.71, 0.71)
    destination = tmp_path / "valid-away-from-gap"
    prepare_dem(geometry, [record(nodata_hgt_zip)], destination, target_crs="EPSG:4087",
                resolution_m=100, resampling="bilinear", max_cells=1000,
                target_vertical_datum="EGM96", code_version="test")
    import rasterio
    with rasterio.open(destination / "terrain.tif") as raster:
        values = raster.read(1, masked=True)
        assert values.count() > 0
        assert np.allclose(values.compressed(), 123)
        assert np.any(np.ma.getmaskarray(values))


def test_adjacent_tiles_have_stable_first_valid_seam_and_point_registration(adjacent_hgt_zips, tmp_path):
    west, east = adjacent_hgt_zips
    radius = 111319.49079327358
    spacing = radius / 3600
    geometry = polygon(0.99 - spacing / radius / 2, 0.499,
                       1.01 + spacing / radius / 2, 0.501)
    outputs = []
    manifests = []
    for name, records in (("forward", [record(west), record(east, "n00e001")]),
                          ("reverse", [record(east, "n00e001"), record(west)])):
        destination = tmp_path / name
        prepare_dem(geometry, records, destination, target_crs="EPSG:4087",
                    resolution_m=spacing, resampling="nearest", max_cells=1000,
                    target_vertical_datum="EGM96", code_version="test")
        import json
        import rasterio
        with rasterio.open(destination / "terrain.tif") as raster:
            outputs.append(raster.read(1))
            transform = raster.transform
            rows, cols = np.indices(outputs[-1].shape)
            longitudes = (transform.c + (cols + 0.5) * transform.a) / radius
            valid = np.isfinite(outputs[-1])
            left = valid & (longitudes < 1.0)
            seam = valid & np.isclose(longitudes, 1.0, atol=1e-9)
            right = valid & (longitudes > 1.0)
            assert np.any(left) and np.any(seam) and np.any(right)
            assert outputs[-1][seam][0] == 3700  # west tile wins its shared edge
            assert np.all(outputs[-1][left] == 100 + np.rint(longitudes[left] * 3600))
            assert np.all(outputs[-1][right] == 8000 + np.rint((longitudes[right] - 1) * 3600))
        manifests.append(json.loads((destination / "manifest.json").read_text()))
    assert np.array_equal(outputs[0], outputs[1], equal_nan=True)
    assert [item["tile_id"] for item in manifests[0]["source"]["records"]] == ["n00e000", "n00e001"]
    assert manifests[0]["source"]["records"] == manifests[1]["source"]["records"]


def test_rejects_existing_destination_without_overwrite(hgt_zip, tmp_path):
    destination = tmp_path / "existing"
    destination.mkdir()
    sentinel = destination / "keep.txt"
    sentinel.write_text("untouched")
    with pytest.raises(FileExistsError):
        prepare_dem(polygon(), [record(hgt_zip)], destination, target_crs="EPSG:32631",
                    resolution_m=1000, resampling="nearest", max_cells=1000,
                    target_vertical_datum="EGM96", code_version="test")
    assert sentinel.read_text() == "untouched"
