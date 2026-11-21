import math

import numpy as np
import pytest
from scipy.io import netcdf_file

from pipeline.hydrology import design_storm as ds
from pipeline.hydrology.rainfall import observed_rainfall_profile

# Synthetic PXR-4 parameters (intensity scaling i = a * D**alpha, mm/h with D in hours).
PARAMS = {"a": 20.0, "alpha": -0.7, "b": 6.0, "beta": -0.65}
CELL = {"lat": 16.75, "lon": 266.75, "lat_index": 293, "lon_index": 1067}


def fake_reader(lon, lat):
    return {**PARAMS, "cell": dict(CELL)}


def expected_mm(duration_h, t):
    y = (1 - (-math.log(1 - 1 / t)) ** ds.GEV_SHAPE) / ds.GEV_SHAPE
    intensity = PARAMS["a"] * duration_h ** PARAMS["alpha"] + PARAMS["b"] * duration_h ** PARAMS["beta"] * y
    return intensity * duration_h


def write_tiny_pxr4(path, *, nan_cell=None):
    lat = np.array([17.0, 16.75, 16.5], dtype="f4")
    lon = np.array([266.5, 266.75, 267.0, 359.75], dtype="f4")
    with netcdf_file(path, "w", version=2) as f:
        f.createDimension("latitude", lat.size)
        f.createDimension("longitude", lon.size)
        f.createVariable("latitude", "f4", ("latitude",))[:] = lat
        f.createVariable("longitude", "f4", ("longitude",))[:] = lon
        for name, base in PARAMS.items():
            grid = np.full((lat.size, lon.size), base, dtype="f4")
            grid[0, 3] = base * 2  # the cell at lon 359.75 (= -0.25) differs from the others
            if nan_cell is not None:
                grid[nan_cell] = np.nan
            f.createVariable(name, "f4", ("latitude", "longitude"))[:] = grid
        for name in ("location_r2", "scale_r2"):
            f.createVariable(name, "f4", ("latitude", "longitude"))[:] = np.full((lat.size, lon.size), 0.99, dtype="f4")


def test_return_level_from_injected_reader_matches_pxr4_formula_and_records_provenance():
    level = ds.return_level(-93.115, 16.745, 3, 25, reader=fake_reader)
    assert level["mm"] == pytest.approx(expected_mm(3, 25))
    assert ds.return_level_mm(-93.115, 16.745, 3, 25, reader=fake_reader) == pytest.approx(level["mm"])
    assert level["extrapolated"] is False
    prov = level["provenance"]
    assert prov["dataset"] == "PXR-4" and prov["version"] == "2.1.0"
    assert prov["doi"] == "10.5281/zenodo.3351812"
    assert "ODbL" in prov["licence"]
    assert prov["cell"] == CELL
    assert prov["parameters"] == PARAMS
    assert prov["gev_shape"] == ds.GEV_SHAPE
    assert prov["duration_h"] == 3 and prov["return_period_years"] == 25
    assert "GEV" in prov["method"]


def test_file_reader_picks_nearest_cell_including_longitude_wraparound(tmp_path):
    path = tmp_path / "pxr4.nc"
    write_tiny_pxr4(path)
    reader = ds.Pxr4Reader(path)
    near = reader(-93.2, 16.8)  # 266.8 E → cell (16.75, 266.75)
    assert near["cell"]["lat"] == pytest.approx(16.75) and near["cell"]["lon"] == pytest.approx(266.75)
    assert near["a"] == pytest.approx(PARAMS["a"]) and near["cell"]["location_r2"] == pytest.approx(0.99)
    wrapped = reader(-0.2, 17.0)  # -0.2 E is 359.8 E → the doubled cell
    assert wrapped["cell"]["lon"] == pytest.approx(359.75)
    assert wrapped["a"] == pytest.approx(2 * PARAMS["a"])
    level = ds.return_level(-93.2, 16.8, 3, 25, reader=reader)
    assert level["mm"] == pytest.approx(expected_mm(3, 25), rel=1e-5)


def test_file_reader_rejects_a_cell_without_parameters(tmp_path):
    path = tmp_path / "pxr4.nc"
    write_tiny_pxr4(path, nan_cell=(1, 1))
    with pytest.raises(ValueError, match="sin parámetros"):
        ds.Pxr4Reader(path)(-93.25, 16.75)


def test_missing_cache_explains_how_to_prepare_it(tmp_path):
    with pytest.raises(FileNotFoundError, match="prepare"):
        ds.return_level(-93.1, 16.7, 3, 25, reader=ds.Pxr4Reader(tmp_path / "missing.nc"))


def test_idf_grows_with_duration_and_return_period():
    durations = [0.25, 0.5, 1, 2, 3, 6, 12, 24, 48]
    periods = [2, 10, 25, 50, 100]
    table = {(d, t): ds.return_level_mm(-93.1, 16.7, d, t, reader=fake_reader) for d in durations for t in periods}
    for t in periods:
        depths = [table[d, t] for d in durations]
        assert all(b > a for a, b in zip(depths, depths[1:]))
    for d in durations:
        depths = [table[d, t] for t in periods]
        assert all(b > a for a, b in zip(depths, depths[1:]))


def test_durations_below_one_hour_are_flagged_as_extrapolated():
    short = ds.return_level(-93.1, 16.7, 0.5, 10, reader=fake_reader)
    assert short["extrapolated"] is True
    assert short["mm"] == pytest.approx(expected_mm(0.5, 10))
    assert "extrapol" in short["provenance"]["method"].lower()
    assert ds.return_level(-93.1, 16.7, 1, 10, reader=fake_reader)["extrapolated"] is False
    # Between 1 and 2 h it is fitted data but outside PXR-4's stated ±20 % range (2–360 h).
    assert ds.return_level(-93.1, 16.7, 1.5, 10, reader=fake_reader)["within_stated_accuracy"] is False
    assert ds.return_level(-93.1, 16.7, 3, 10, reader=fake_reader)["within_stated_accuracy"] is True


@pytest.mark.parametrize("lon, lat, duration_h, period", [
    (-93.1, 16.7, 3, 0.5),        # return period < 1
    (-93.1, 16.7, 3, 1),          # T = 1 year has no finite annual-maximum quantile
    (-93.1, 16.7, 0, 25),         # duration ≤ 0
    (-93.1, 16.7, -1, 25),
    (-93.1, 16.7, 361, 25),       # beyond the 360 h fitted range
    (-181, 16.7, 3, 25),          # longitude out of range
    (181, 16.7, 3, 25),
    (-93.1, 91, 3, 25),           # latitude out of range
    (-93.1, -90.5, 3, 25),
    (float("nan"), 16.7, 3, 25),
    (-93.1, 16.7, float("inf"), 25),
    (-93.1, 16.7, True, 25),
])
def test_invalid_inputs_are_rejected(lon, lat, duration_h, period):
    with pytest.raises(ValueError):
        ds.return_level_mm(lon, lat, duration_h, period, reader=fake_reader)


@pytest.mark.parametrize("duration_h, step_s", [(3, 600), (2, 1800), (1, 300), (6, 3600)])
def test_alternating_block_sums_to_the_total_depth_with_the_peak_in_the_middle(duration_h, step_s):
    storm = ds.design_storm(-93.1, 16.7, duration_h, 25, step_s, reader=fake_reader)
    segments = storm["segments"]
    n = round(duration_h * 3600 / step_s)
    assert len(segments) == n
    assert segments[0]["start_s"] == 0 and segments[-1]["end_s"] == duration_h * 3600
    assert all(s["end_s"] - s["start_s"] == step_s for s in segments)
    assert all(a["end_s"] == b["start_s"] for a, b in zip(segments, segments[1:]))
    assert all(s["mm"] >= 0 for s in segments)
    total = expected_mm(duration_h, 25)
    assert math.fsum(s["mm"] for s in segments) == pytest.approx(total, rel=1e-12)
    assert storm["total_mm"] == pytest.approx(total)
    depths = [s["mm"] for s in segments]
    peak = depths.index(max(depths))
    assert peak == (n - 1) // 2
    # Blocks decrease away from the peak on both sides.
    assert all(depths[i] <= depths[i + 1] for i in range(peak))
    assert all(depths[i] >= depths[i + 1] for i in range(peak, n - 1))
    # The largest block is the depth of a single step from the IDF curve.
    assert max(depths) == pytest.approx(expected_mm(step_s / 3600, 25))
    assert storm["method"] == "alternating_block"
    assert storm["provenance"]["dataset"] == "PXR-4"
    assert storm["extrapolated"] is (step_s < 3600)


def test_design_storm_segments_feed_the_observed_rain_path_unchanged():
    storm = ds.design_storm(-93.1, 16.7, 3, 100, 900, reader=fake_reader)
    profile = observed_rainfall_profile({"type": "Polygon", "coordinates": []}, storm["segments"], "design-storm")
    assert profile["rainfall"]["amount_m"] == pytest.approx(storm["total_mm"] / 1000)
    assert profile["rainfall"]["duration_s"] == 3 * 3600


@pytest.mark.parametrize("duration_h, step_s", [(3, 0), (3, -60), (3, 7), (1, 7200), (3, 1.5)])
def test_design_storm_rejects_steps_that_do_not_divide_the_duration(duration_h, step_s):
    with pytest.raises(ValueError):
        ds.design_storm(-93.1, 16.7, duration_h, 25, step_s, reader=fake_reader)


def test_design_storm_rejects_a_curve_that_would_give_negative_blocks():
    def decreasing(lon, lat):  # depth falls with duration: not a valid IDF curve
        return {"a": 10.0, "alpha": -1.5, "b": 1.0, "beta": -1.5, "cell": dict(CELL)}
    with pytest.raises(ValueError, match="monótona"):
        ds.design_storm(-93.1, 16.7, 3, 25, 900, reader=decreasing)
