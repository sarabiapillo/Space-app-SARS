import numpy as np
import pytest

from pipeline.solar.radiation import simulate_radiation


@pytest.mark.parametrize("elevation,expected", [(0, 0), (30, 500), (90, 1000)])
def test_horizontal_lambert_in_watts_per_square_meter(elevation, expected):
    normals = np.array([[[0.0, 0.0, 1.0]]])
    result = simulate_radiation(normals, np.array([[True]]), 1000, 90, elevation, 0)
    assert result["valid"].tolist() == [[True]]
    assert result["incident"][0, 0] == pytest.approx(expected)
    assert result["absorbed"][0, 0] == pytest.approx(expected)


@pytest.mark.parametrize("azimuth,expected", [(0, 0), (90, 200 / np.sqrt(2)),
                                               (180, 0), (270, 0), (360, 0)])
def test_azimuth_from_north_clockwise_and_no_negative_incidence(azimuth, expected):
    normals = np.array([[[1.0, 0.0, 1.0]]]) / np.sqrt(2)
    result = simulate_radiation(normals, np.array([[True]]), 200, azimuth, 0, 0)
    assert result["incident"][0, 0] == pytest.approx(expected)
    assert result["absorbed"][0, 0] == pytest.approx(expected)


def test_albedo_boundaries_zero_irradiance_and_nodata_without_mutating_normals():
    normals = np.array([[[0.0, 0.0, 1.0], [np.nan, np.nan, np.nan]]])
    before = normals.copy()
    mask = np.array([[True, False]])
    for irradiance, albedo, expected in [(200, 0, 200), (200, .25, 150),
                                           (200, 1, 0), (0, .25, 0)]:
        result = simulate_radiation(normals, mask, irradiance, 0, 90, albedo)
        assert result["valid"].tolist() == [[True, False]]
        assert result["incident"][0, 0] == pytest.approx(irradiance)
        assert result["absorbed"][0, 0] == pytest.approx(expected)
        assert np.isnan(result["incident"][0, 1])
        assert np.isnan(result["absorbed"][0, 1])
    assert np.array_equal(normals, before, equal_nan=True)
    assert mask.tolist() == [[True, False]]


@pytest.mark.parametrize("irradiance,azimuth,elevation,albedo", [
    (-1, 0, 30, 0), (np.inf, 0, 30, 0), (1, -1, 30, 0),
    (1, 361, 30, 0), (1, 0, -1, 0), (1, 0, 91, 0),
    (1, 0, 30, -.1), (1, 0, 30, 1.1), (1, 0, 30, np.nan),
])
def test_rejects_invalid_physical_parameters(irradiance, azimuth, elevation, albedo):
    normals = np.array([[[0.0, 0.0, 1.0]]])
    with pytest.raises(ValueError):
        simulate_radiation(normals, np.array([[True]]), irradiance, azimuth, elevation, albedo)
    assert normals.tolist() == [[[0.0, 0.0, 1.0]]]


def test_rejects_invalid_shape_or_nonunit_valid_normal():
    normals = np.array([[[0.0, 0.0, 2.0]]])
    with pytest.raises(ValueError, match="normal"):
        simulate_radiation(normals, np.array([[True]]), 100, 0, 45, .2)
    with pytest.raises(ValueError, match="shape"):
        simulate_radiation(normals, np.ones((2, 2), dtype=bool), 100, 0, 45, .2)
