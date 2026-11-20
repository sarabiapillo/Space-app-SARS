"""Offline tests for the Curve Number module (HYSOGs250m decoding, CN lookup, SCS-CN net rain)."""
import math

import numpy as np
import pytest
from rasterio.transform import from_origin

from pipeline.hydrology import curve_number as cnm


# --- HYSOGs decoding ---------------------------------------------------------------------------

def test_hsg_decoding_single_and_dual_groups():
    raw = np.array([[1, 2, 3, 4], [11, 12, 13, 14], [255, 0, 7, 1]], dtype=np.uint8)
    undrained = cnm.decode_hsg(raw)  # default: dual groups are undrained -> D (as GCN250)
    np.testing.assert_array_equal(undrained, [[1, 2, 3, 4], [4, 4, 4, 4], [0, 0, 0, 1]])
    drained = cnm.decode_hsg(raw, dual="drained")
    np.testing.assert_array_equal(drained, [[1, 2, 3, 4], [1, 2, 3, 4], [0, 0, 0, 1]])
    with pytest.raises(ValueError):
        cnm.decode_hsg(raw, dual="maybe")


def test_hysogs_window_is_read_through_injected_reader():
    seen = []

    def reader(bounds):
        seen.append(bounds)
        return {"values": np.array([[3, 13], [4, 255]], dtype=np.uint8),
                "transform": from_origin(-93.125, 16.75, 1 / 480, 1 / 480), "crs": "EPSG:4326",
                "source": "fake"}

    out = cnm.fetch_hysogs((-93.12, 16.745, -93.118, 16.748), reader=reader)
    assert seen == [(-93.12, 16.745, -93.118, 16.748)]
    assert out["values"].dtype == np.uint8 and out["provenance"]["short_name"] == "Global_Hydrologic_Soil_Group_1566"
    assert out["provenance"]["doi"] == "10.3334/ORNLDAAC/1566"


@pytest.mark.parametrize("bounds", [(0, -57, 1, -56.5), (170, 0, -170, 1), (0, 0, 0, 1)])
def test_hysogs_rejects_bounds_outside_coverage_or_crossing_antimeridian(bounds):
    with pytest.raises(ValueError):
        cnm.fetch_hysogs(bounds, reader=lambda b: None)


# --- CN lookup ---------------------------------------------------------------------------------

def test_cn_lookup_per_worldcover_class_and_hsg():
    classes = np.array([[10, 40, 50, 80], [60, 90, 95, 0]], dtype=np.uint8)
    hsg = np.array([[1, 2, 3, 4], [4, 3, 2, 2]], dtype=np.uint8)
    cn = cnm.curve_number_grid(classes, hsg)
    # Tree (ESA CCI 60 row) A=35, Cropland rainfed (CCI 10) B=68, Urban (CCI 190) C=88, water=100,
    # Bare (CCI 200) D=94, Herbaceous wetland (CCI 180) C=82, Mangrove (CCI 170) B=65, nodata -> nan.
    assert cn[0, :4].tolist() == [35, 68, 88, 100]
    assert cn[1, :3].tolist() == [94, 82, 65]
    assert math.isnan(cn[1, 3])
    for code, entry in cnm.CN_TABLE.items():
        assert len(entry["cn"]) == 4 and entry["source"]


def test_missing_hsg_uses_documented_fill_group():
    classes = np.array([[30, 30]], dtype=np.uint8)
    hsg = np.array([[0, 2]], dtype=np.uint8)
    assert cnm.curve_number_grid(classes, hsg).tolist() == [[86.0, 71.0]]  # grassland D=86, B=71
    assert cnm.curve_number_grid(classes, hsg, missing_hsg="B").tolist() == [[71.0, 71.0]]
    with pytest.raises(ValueError):
        cnm.curve_number_grid(classes, hsg, missing_hsg=None)


# --- AMC conversion ----------------------------------------------------------------------------

def test_amc_conversions_chow_and_hawkins():
    """Chow, Maidment & Mays (1988): CN(I) = 4.2 CN / (10 - 0.058 CN); CN(III) = 23 CN / (10 + 0.13 CN).

    For CN(II) = 78: CN(I) = 327.6 / 5.476 = 59.82; CN(III) = 1794 / 20.14 = 89.08.
    Hawkins et al. (1985): CN(I) = CN / (2.281 - 0.01281 CN) = 60.85; CN(III) = CN / (0.427 + 0.00573 CN) = 89.251.
    """
    assert cnm.convert_amc(78, "I") == pytest.approx(59.825, abs=1e-3)
    assert cnm.convert_amc(78, "III") == pytest.approx(89.076, abs=1e-3)
    assert cnm.convert_amc(78, "II") == 78
    assert cnm.convert_amc(78, "I", method="hawkins") == pytest.approx(60.851, abs=1e-3)
    assert cnm.convert_amc(78, "III", method="hawkins") == pytest.approx(89.251, abs=1e-3)
    assert cnm.convert_amc(100, "I") == pytest.approx(100) and cnm.convert_amc(100, "III") == pytest.approx(100)
    grid = cnm.convert_amc(np.array([60.0, np.nan]), "III")
    assert grid[0] > 60 and math.isnan(grid[1])
    with pytest.raises(ValueError):
        cnm.convert_amc(78, "IV")


# --- SCS-CN runoff -----------------------------------------------------------------------------

def test_scs_runoff_hand_computed_example():
    """P = 100 mm, CN = 78, lambda = 0.2.

    S = 25400/78 - 254 = 71.641 mm; Ia = 0.2 S = 14.328 mm;
    Q = (100 - 14.328)^2 / (100 - 14.328 + 71.641) = 7339.67 / 157.313 = 46.656 mm.
    """
    assert cnm.scs_runoff_mm(100.0, 78.0) == pytest.approx(46.656, abs=1e-3)
    assert cnm.scs_runoff_mm(10.0, 78.0) == 0.0          # P below Ia
    assert cnm.scs_runoff_mm(50.0, 100.0) == pytest.approx(50.0)  # impervious / water
    # lambda = 0.05: Ia = 3.582 mm, Q = 96.418^2 / (96.418 + 71.641) = 55.316 mm
    assert cnm.scs_runoff_mm(100.0, 78.0, initial_abstraction_ratio=0.05) == pytest.approx(55.316, abs=1e-3)


SEGMENTS = [{"start_s": 0, "end_s": 1800, "mm": 10.0}, {"start_s": 1800, "end_s": 3600, "mm": 40.0},
            {"start_s": 3600, "end_s": 5400, "mm": 30.0}, {"start_s": 5400, "end_s": 7200, "mm": 20.0}]


def test_incremental_net_rain_is_nonnegative_and_sums_to_total_runoff():
    cn = np.array([[78.0, 62.0], [90.0, np.nan]])
    cube, summary = cnm.net_rain_cube(SEGMENTS, cn)
    assert cube.shape == (4, 2, 2)
    assert np.all(cube[:, :, :][~np.isnan(cube)] >= 0)
    np.testing.assert_allclose(cube[:, 0, 0].sum(), cnm.scs_runoff_mm(100.0, 78.0), rtol=1e-12)
    np.testing.assert_allclose(cube[:, 0, 1].sum(), cnm.scs_runoff_mm(100.0, 62.0), rtol=1e-12)
    np.testing.assert_allclose(cube[:, 1, 0].sum(), cnm.scs_runoff_mm(100.0, 90.0), rtol=1e-12)
    # First interval (10 mm) is below Ia for CN 78 (14.3 mm): no runoff yet.
    assert cube[0, 0, 0] == 0.0
    # Cells without CN (nodata) receive zero net rain, never NaN in the cube.
    assert np.all(cube[:, 1, 1] == 0.0)
    assert summary["total_rain_mm"] == pytest.approx(100.0)
    assert summary["cells_with_cn"] == 3
    expected_c = np.mean([cnm.scs_runoff_mm(100.0, v) for v in (78.0, 62.0, 90.0)]) / 100.0
    assert summary["mean_runoff_coefficient"] == pytest.approx(expected_c)
    assert summary["initial_abstraction_ratio"] == 0.2


def test_segments_accept_intensity_forms_and_must_be_contiguous():
    as_rate = [{"start_s": 0, "end_s": 3600, "intensity_mm_h": 50.0},
               {"start_s": 3600, "end_s": 7200, "intensity_m_s": 50.0 / 1000 / 3600}]
    cube, summary = cnm.net_rain_cube(as_rate, np.array([[78.0]]))
    assert summary["total_rain_mm"] == pytest.approx(100.0)
    assert cube.sum() == pytest.approx(cnm.scs_runoff_mm(100.0, 78.0))
    with pytest.raises(ValueError):
        cnm.net_rain_cube([{"start_s": 0, "end_s": 10, "mm": 1}, {"start_s": 20, "end_s": 30, "mm": 1}],
                          np.array([[78.0]]))
    with pytest.raises(ValueError):
        cnm.net_rain_cube([{"start_s": 0, "end_s": 10, "mm": -1}], np.array([[78.0]]))


def test_urban_drainage_removes_constant_rate_only_in_built_cells():
    cn = np.array([[98.0, 98.0]])
    built = np.array([[1.0, 0.0]])
    plain, _ = cnm.net_rain_cube(SEGMENTS, cn)
    drained, summary = cnm.net_rain_cube(SEGMENTS, cn, built_fraction=built, urban_drainage_mm_h=12.0)
    # 30-minute intervals: up to 6 mm removed per interval in the built cell, never below zero.
    np.testing.assert_allclose(drained[:, 0, 1], plain[:, 0, 1])
    np.testing.assert_allclose(drained[:, 0, 0], np.maximum(0.0, plain[:, 0, 0] - 6.0))
    assert np.all(drained >= 0)
    assert summary["urban_drainage_mm_h"] == 12.0
    assert summary["mean_drainage_removed_mm"] > 0
    default, _ = cnm.net_rain_cube(SEGMENTS, cn, built_fraction=built)
    np.testing.assert_allclose(default, plain)  # default drainage rate is 0 mm/h
