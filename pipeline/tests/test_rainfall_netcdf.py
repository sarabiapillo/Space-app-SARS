import hashlib
import json

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from scipy.io import netcdf_file
from shapely.geometry import Polygon
from shapely.ops import transform as transform_geometry

from pipeline.hydrology.rainfall import generate_rainfall_profile
from pipeline.hydrology.rainfall_netcdf import export_rainfall_netcdf

ROI = {"type": "Polygon", "coordinates": [[[-93.0, 16.8], [-92.999, 16.8], [-92.999, 16.801], [-93.0, 16.801], [-93.0, 16.8]]]}


@pytest.fixture
def dem(tmp_path):
    project = Transformer.from_crs(4326, 32615, always_xy=True).transform
    roi_xy = transform_geometry(project, Polygon(ROI["coordinates"][0]))
    left, bottom, right, top = roi_xy.bounds
    # Derive the full enclosing raster dimensions from the projected ROI, with a cell margin.
    x0 = np.floor(left / 20) * 20 - 20
    y0 = np.ceil(top / 20) * 20 + 20
    width = int(np.ceil((right - x0) / 20)) + 1
    height = int(np.ceil((y0 - bottom) / 20)) + 1
    path = tmp_path / "terrain.tif"
    values = np.full((height, width), 30, dtype="float32")
    with rasterio.open(path, "w", driver="GTiff", width=width, height=height, count=1,
                       dtype="float32", crs="EPSG:32615", transform=from_origin(x0, y0, 20, 20),
                       nodata=np.nan) as dst:
        dst.write(values, 1)
    return path


def profile():
    return generate_rainfall_profile({"rainfall": {"amount": 12, "unit": "mm", "duration": 2,
            "duration_unit": "h"}, "roi": ROI}, interval_count=4, seed=27,
            distribution="uniform_balanced")


def test_netcdf_native_layout_roi_uniform_interval_depth_and_dry_tail(tmp_path, dem):
    destination = tmp_path / "forcing.nc"
    manifest = export_rainfall_netcdf(profile(), dem, destination,
                                      simulation_duration_s=10800, max_values=1000)
    assert destination.is_file() and manifest.is_file()
    assert destination.read_bytes()[:4] == b"CDF\x02"
    metadata = json.loads(manifest.read_text())
    assert metadata["synthetic"] is True and metadata["hydraulic_ready"] is False
    assert metadata["simulation_duration_s"] == 10800
    expected_profile_hash = hashlib.sha256(json.dumps(profile(), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    assert metadata["profile_sha256"] == expected_profile_hash
    assert metadata["dem"]["sha256"] == hashlib.sha256(dem.read_bytes()).hexdigest()
    with netcdf_file(destination, "r", mmap=False) as nc:
        assert set(nc.dimensions) == {"native_header_anchor", "time", "y", "x"}
        assert nc.dimensions["native_header_anchor"] == 1
        assert set(nc.variables) == {"time", "y", "x", "rainfall_depth"}
        # file_tool.cpp usa IDs de variable como IDs de dimensión: exigir
        # correspondencia en el orden físico de la cabecera NetCDF.
        dimension_ids = list(nc.dimensions)
        variable_ids = list(nc.variables)
        assert dimension_ids.index("native_header_anchor") == variable_ids.index("rainfall_depth")
        assert all(dimension_ids.index(axis) == variable_ids.index(axis) for axis in ("time", "x", "y"))
        rain = nc.variables["rainfall_depth"]
        assert rain.units.decode() == "mm"
        assert nc.variables["time"].units.decode() == "hours"
        assert nc.variables["x"].units.decode() == "m" and nc.variables["y"].units.decode() == "m"
        x, y, t = nc.variables["x"][:].copy(), nc.variables["y"][:].copy(), nc.variables["time"][:].copy()
        values = rain[:].copy()
    with rasterio.open(dem) as raster:
        transform = raster.transform
        expected_x = transform.c + (np.arange(raster.width) + 0.5) * transform.a
        expected_y = transform.f + (np.arange(raster.height) + 0.5) * transform.e
        left, bottom, right, top = raster.bounds
    np.testing.assert_array_equal(x, expected_x)
    np.testing.assert_array_equal(y, expected_y)
    assert x[0] > left and x[-1] < right and y[0] < top and y[-1] > bottom
    assert np.all(np.diff(x) > 0) and np.all(np.diff(y) < 0)
    np.testing.assert_allclose(t, [0, .5, 1, 1.5, 2, 3])
    project = Transformer.from_crs(4326, 32615, always_xy=True).transform
    geom = transform_geometry(project, Polygon(ROI["coordinates"][0]))
    selected = np.array([[geom.contains(__import__("shapely").geometry.Point(xx, yy)) or geom.touches(__import__("shapely").geometry.Point(xx, yy)) for xx in x] for yy in y])
    assert selected.any() and (~selected).any()
    for i, segment in enumerate(profile()["segments"]):
        expected = segment["intensity_m_s"] * (segment["end_s"] - segment["start_s"]) * 1000
        np.testing.assert_allclose(values[i][selected], expected, rtol=1e-12, atol=1e-12)
        assert np.all(values[i][~selected] == 0)
    assert np.all(values[-2:] == 0)
    np.testing.assert_allclose(values[:-2, selected].sum(axis=0), 12, atol=1e-10)


def test_invalid_duration_budget_nodata_and_existing_target_do_not_write(tmp_path, dem):
    target = tmp_path / "bad.nc"
    with pytest.raises(ValueError):
        export_rainfall_netcdf(profile(), dem, target, simulation_duration_s=1, max_values=1000)
    assert not target.exists()
    with pytest.raises(ValueError):
        export_rainfall_netcdf(profile(), dem, target, simulation_duration_s=7200, max_values=1)
    assert not target.exists()
    # Selected DEM elevation is mandatory; reject nodata before creating output.
    with rasterio.open(dem, "r+") as raster:
        raster.write(np.full((raster.height, raster.width), np.nan, dtype="float32"), 1)
    with pytest.raises(ValueError, match="nodata"):
        export_rainfall_netcdf(profile(), dem, target, simulation_duration_s=7200, max_values=1000)
    assert not target.exists()
    target.touch()
    before = target.read_bytes()
    with pytest.raises(FileExistsError):
        export_rainfall_netcdf(profile(), dem, target, simulation_duration_s=7200, max_values=1000)
    assert target.read_bytes() == before


@pytest.mark.parametrize("mutation", ["nonzero_start", "gap", "overlap", "declared_duration"])
def test_rejects_profile_timeline_inconsistency_without_output(tmp_path, dem, mutation):
    data = profile()
    if mutation == "nonzero_start":
        data["segments"][0]["start_s"] = 1e-13
    elif mutation == "gap":
        data["segments"][1]["start_s"] += 1e-6
    elif mutation == "overlap":
        data["segments"][1]["start_s"] -= 1e-6
    else:
        data["rainfall"]["duration_s"] += 1
    target = tmp_path / f"{mutation}.nc"
    with pytest.raises(ValueError):
        export_rainfall_netcdf(data, dem, target, simulation_duration_s=8000, max_values=100000)
    assert not target.exists() and not target.with_suffix(".json").exists()


@pytest.mark.parametrize("grid", ["geographic", "rotated"])
def test_rejects_incompatible_grid_without_outputs(tmp_path, dem, grid):
    target = tmp_path / f"{grid}.nc"
    with rasterio.open(dem) as src:
        data = src.read(1)
        transform = src.transform
        crs = src.crs
    if grid == "geographic":
        crs = "EPSG:4326"
    else:
        transform = rasterio.Affine(transform.a, 1, transform.c, 0, transform.e, transform.f)
    with rasterio.open(target.with_suffix(".tif"), "w", driver="GTiff", width=data.shape[1], height=data.shape[0],
                       count=1, dtype="float32", crs=crs, transform=transform) as dst:
        dst.write(data, 1)
    with pytest.raises(ValueError):
        export_rainfall_netcdf(profile(), target.with_suffix(".tif"), target,
                               simulation_duration_s=7200, max_values=100000)
    assert not target.exists() and not target.with_suffix(".json").exists()


def test_rejects_roi_not_covered_by_grid(tmp_path):
    path = tmp_path / "small.tif"
    projected = Transformer.from_crs(4326, 32615, always_xy=True).transform
    roi_xy = transform_geometry(projected, Polygon(ROI["coordinates"][0]))
    left, bottom, right, top = roi_xy.bounds
    # A 2x2 grid covers only a small corner of the ROI.
    with rasterio.open(path, "w", driver="GTiff", width=2, height=2, count=1, dtype="float32",
                       crs="EPSG:32615", transform=from_origin(left, top, 20, 20)) as dst:
        dst.write(np.ones((2, 2), dtype="float32"), 1)
    target = tmp_path / "truncated.nc"
    with pytest.raises(ValueError, match="cover"):
        export_rainfall_netcdf(profile(), path, target, simulation_duration_s=7200, max_values=1000)
    assert not target.exists() and not target.with_suffix(".json").exists()


def test_rejects_manifest_name_collision_without_outputs(tmp_path, dem):
    target = tmp_path / "forcing.json"
    with pytest.raises(ValueError, match="collid"):
        export_rainfall_netcdf(profile(), dem, target, simulation_duration_s=7200, max_values=100000)
    assert not target.exists()


def test_budget_preflight_does_not_read_dem(monkeypatch, tmp_path, dem):
    import pipeline.hydrology.rainfall_netcdf as exporter
    original_open = exporter.rasterio.open

    class NoRead:
        def __init__(self, dataset):
            self.dataset = dataset

        def __enter__(self):
            self.dataset.__enter__()
            return self

        def __exit__(self, *args):
            return self.dataset.__exit__(*args)

        def __getattr__(self, name):
            return getattr(self.dataset, name)

        def read(self, *args, **kwargs):
            raise AssertionError("DEM read happened before budget rejection")

    monkeypatch.setattr(exporter.rasterio, "open", lambda *args, **kwargs: NoRead(original_open(*args, **kwargs)))
    target = tmp_path / "budget.nc"
    with pytest.raises(ValueError, match="budget"):
        export_rainfall_netcdf(profile(), dem, target, simulation_duration_s=7200, max_values=1)
    assert not target.exists() and not target.with_suffix(".json").exists()


def test_duration_overflow_is_value_error(tmp_path, dem):
    with pytest.raises(ValueError):
        export_rainfall_netcdf(profile(), dem, tmp_path / "overflow.nc",
                               simulation_duration_s=10**10000, max_values=100000)


def test_observed_profile_exports_each_interval_and_is_marked_observed(dem, tmp_path):
    from pipeline.hydrology.rainfall import observed_rainfall_profile
    observed = observed_rainfall_profile(ROI, [{"start_s": 0, "end_s": 1800, "mm": 3.0},
                                               {"start_s": 1800, "end_s": 3600, "mm": 7.5}], {"product": "GPM_3IMERGHHL"})
    manifest = json.loads(export_rainfall_netcdf(observed, dem, tmp_path / "rain.nc", simulation_duration_s=3600).read_text())
    assert manifest["synthetic"] is False and manifest["observed"] is True
    with netcdf_file(tmp_path / "rain.nc", "r", mmap=False) as nc:
        rain = nc.variables["rainfall_depth"][:].copy()
    assert rain[0].max() == pytest.approx(3.0) and rain[1].max() == pytest.approx(7.5)


def test_a_profile_neither_synthetic_nor_observed_is_still_rejected(dem, tmp_path):
    unflagged = {**profile(), "synthetic": False}
    with pytest.raises(ValueError):
        export_rainfall_netcdf(unflagged, dem, tmp_path / "rain.nc", simulation_duration_s=7200)


# --- per-cell rain cube export (net rain from Curve Number, etc.) ------------------------------

def _cube_for(dem_path, intervals=3):
    from pipeline.hydrology.rainfall_netcdf import export_rainfall_cube_netcdf  # noqa: F401
    with rasterio.open(dem_path) as raster:
        height, width = raster.height, raster.width
    rng = np.random.default_rng(5)
    return rng.uniform(0.0, 4.0, size=(intervals, height, width))


def test_cube_export_round_trip_keeps_native_layout_and_per_cell_values(tmp_path, dem):
    from pipeline.hydrology.rainfall_netcdf import export_rainfall_cube_netcdf
    cube = _cube_for(dem)
    edges = [0.0, 1800.0, 3600.0, 5400.0]
    method = {"name": "scs_curve_number_incremental", "initial_abstraction_ratio": 0.2}
    destination = tmp_path / "net.nc"
    manifest_path = export_rainfall_cube_netcdf(cube, edges, dem, destination, simulation_duration_s=7200,
                                                method=method, synthetic=True, max_values=10_000)
    assert destination.read_bytes()[:4] == b"CDF\x02"
    metadata = json.loads(manifest_path.read_text())
    assert metadata["spatial_policy"].startswith("per-cell")
    assert metadata["method"] == method
    assert metadata["synthetic"] is True and metadata["hydraulic_ready"] is False
    assert metadata["cube_sha256"] == hashlib.sha256(np.ascontiguousarray(cube, dtype="<f8").tobytes()).hexdigest()
    assert metadata["interval_mean_mm"] == pytest.approx(cube.mean(axis=(1, 2)).tolist())
    with netcdf_file(destination, "r", mmap=False) as nc:
        dimension_ids = list(nc.dimensions)
        variable_ids = list(nc.variables)
        assert dimension_ids.index("native_header_anchor") == variable_ids.index("rainfall_depth")
        assert all(dimension_ids.index(axis) == variable_ids.index(axis) for axis in ("time", "x", "y"))
        t = nc.variables["time"][:].copy()
        values = nc.variables["rainfall_depth"][:].copy()
    np.testing.assert_allclose(t, [0.0, 0.5, 1.0, 1.5, 2.0])
    np.testing.assert_array_equal(values[:3], cube)
    assert np.all(values[3:] == 0)


def test_cube_export_rejects_bad_shapes_values_and_overwrite(tmp_path, dem):
    from pipeline.hydrology.rainfall_netcdf import export_rainfall_cube_netcdf
    cube = _cube_for(dem)
    edges = [0.0, 1800.0, 3600.0, 5400.0]
    kwargs = dict(simulation_duration_s=5400, method={"name": "x"}, synthetic=True)
    with pytest.raises(ValueError):
        export_rainfall_cube_netcdf(cube[:, :-1], edges, dem, tmp_path / "a.nc", **kwargs)
    with pytest.raises(ValueError):
        export_rainfall_cube_netcdf(cube, edges[:-1], dem, tmp_path / "b.nc", **kwargs)
    negative = cube.copy(); negative[0, 0, 0] = -1
    with pytest.raises(ValueError):
        export_rainfall_cube_netcdf(negative, edges, dem, tmp_path / "c.nc", **kwargs)
    with pytest.raises(ValueError):
        export_rainfall_cube_netcdf(cube, [0.0, 1800.0, 1800.0, 5400.0], dem, tmp_path / "d.nc", **kwargs)
    with pytest.raises(ValueError, match="budget"):
        export_rainfall_cube_netcdf(cube, edges, dem, tmp_path / "e.nc", max_values=1, **kwargs)
    with pytest.raises(ValueError):
        export_rainfall_cube_netcdf(cube, edges, dem, tmp_path / "f.nc", simulation_duration_s=5400,
                                    method={"name": "x"}, synthetic=False)
    for name in "abcdef":
        assert not (tmp_path / f"{name}.nc").exists()
    export_rainfall_cube_netcdf(cube, edges, dem, tmp_path / "ok.nc", **kwargs)
    with pytest.raises(FileExistsError):
        export_rainfall_cube_netcdf(cube, edges, dem, tmp_path / "ok.nc", **kwargs)
