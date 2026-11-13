"""Pruebas de nisar_h5 con un HDF5 SINTÉTICO que imita la estructura de un GSLC (no son datos reales)."""
import h5py
import numpy as np
import pytest
from pyproj import Transformer

from pipeline import nisar_h5 as nh

EPSG = 32615
ROI = "POLYGON((-93.01 16.80,-92.99 16.80,-92.99 16.81,-93.01 16.81,-93.01 16.80))"


@pytest.fixture
def synthetic_h5(tmp_path):
    """Malla de 100 m alrededor de la ROI de prueba, con HH/HV complejos y máscara."""
    t = Transformer.from_crs(4326, EPSG, always_xy=True)
    cx, cy = t.transform(-93.0, 16.805)
    x = np.round(cx) - 3000 + 50 + 100 * np.arange(60)       # centros de píxel
    y = np.round(cy) + 3000 - 50 - 100 * np.arange(60)
    rng = np.random.default_rng(1)
    hh = (rng.normal(size=(60, 60)) + 1j * rng.normal(size=(60, 60))).astype(np.complex64)
    hh[0, 0] = np.complex64(complex(np.nan, np.nan))          # relleno
    mask = np.ones((60, 60), dtype=np.uint8)
    mask[:, :5] = 255
    mask[10, 10] = 0
    path = tmp_path / "synthetic_gslc.h5"
    with h5py.File(path, "w") as f:
        f["science/LSAR/identification/productType"] = np.bytes_("GSLC")
        f["science/LSAR/identification/granuleId"] = np.bytes_("SYNTHETIC")
        g = f.create_group("science/LSAR/GSLC/grids/frequencyA")
        g.create_dataset("HH", data=hh, chunks=(16, 16), compression="gzip")
        g.create_dataset("HV", data=hh * np.complex64(0.5), chunks=(16, 16), compression="gzip")
        g["mask"] = mask
        g["xCoordinates"], g["yCoordinates"] = x, y
        g["xCoordinateSpacing"], g["yCoordinateSpacing"] = 100.0, -100.0
        g["listOfPolarizations"] = np.array([b"HH", b"HV"])
        g["projection"] = np.uint32(EPSG)
        g["projection"].attrs["epsg_code"] = EPSG
    return path, hh, mask


def test_open_grid_reads_structure(synthetic_h5):
    path, _, _ = synthetic_h5
    with h5py.File(path, "r") as f:
        grid = nh.open_grid(f)
        assert grid.product == "GSLC" and grid.epsg == EPSG
        assert grid.polarizations == ("HH", "HV")
        assert grid.shape == (60, 60) and grid.dy == -100.0


def test_other_products_are_rejected(tmp_path):
    p = tmp_path / "gunw.h5"
    with h5py.File(p, "w") as f:
        f["science/LSAR/identification/productType"] = np.bytes_("GUNW")
    with h5py.File(p, "r") as f, pytest.raises(ValueError, match="GCOV y GSLC"):
        nh.open_grid(f)


def make_gcov(path, expression="Linear power"):
    """GCOV SINTÉTICO mínimo: términos diagonales y uno fuera de la diagonal, parámetros de RTC."""
    with h5py.File(path, "w") as f:
        f["science/LSAR/identification/productType"] = np.bytes_("GCOV")
        g = f.create_group("science/LSAR/GCOV/grids/frequencyA")
        g["HHHH"] = np.full((8, 8), 0.2, dtype=np.float32)
        g["HVHV"] = np.full((8, 8), 0.02, dtype=np.float32)
        g["mask"] = np.ones((8, 8), dtype=np.uint8)
        g["xCoordinates"], g["yCoordinates"] = 500005.0 + 10 * np.arange(8), 1858005.0 - 10 * np.arange(8)
        g["xCoordinateSpacing"], g["yCoordinateSpacing"] = 10.0, -10.0
        g["listOfPolarizations"] = np.array([b"HH", b"HV"])
        g["listOfCovarianceTerms"] = np.array([b"HHHH", b"HHHV", b"HVHV"])
        g["projection"] = np.uint32(EPSG)
        g["projection"].attrs["epsg_code"] = EPSG
        p = f.create_group("science/LSAR/GCOV/metadata/processingInformation/parameters")
        p["rtc/outputBackscatterExpressionConvention"] = np.bytes_(expression)
        p["rtc/outputBackscatterNormalizationConvention"] = np.bytes_("gamma0")
        p["noiseCorrectionApplied"] = np.bytes_("False")
        p["runConfigurationContents"] = np.bytes_("output_gcov_terms:\n    mantissa_nbits: 16\n")


def test_gcov_grid_uses_diagonal_terms_and_declared_quantity(tmp_path):
    path = tmp_path / "gcov.h5"
    make_gcov(path)
    with h5py.File(path, "r") as f:
        grid = nh.open_grid(f)
        proc = nh.processing_parameters(f, "GCOV")
    assert grid.product == "GCOV"
    assert grid.layers == ("HHHH", "HVHV")          # HHHV (fuera de la diagonal) no es una potencia
    assert grid.quantity == "gamma0"
    assert proc["noiseCorrectionApplied"] == "False"
    assert proc["mantissa_nbits_capas_potencia"] == 16


def test_gcov_non_linear_power_is_rejected(tmp_path):
    path = tmp_path / "gcov_db.h5"
    make_gcov(path, expression="dB")
    with h5py.File(path, "r") as f, pytest.raises(ValueError, match="Linear power"):
        nh.open_grid(f)


def test_as_power_passes_real_layers_through():
    real = np.array([[0.2, np.nan]], dtype=np.float32)
    out = nh.as_power(real)
    assert out[0, 0] == pytest.approx(0.2) and np.isnan(out[0, 1])


def test_read_power_on_gcov_layer_returns_values(tmp_path):
    path = tmp_path / "gcov.h5"
    make_gcov(path)
    with h5py.File(path, "r") as f:
        got = nh.read_power(f["science/LSAR/GCOV/grids/frequencyA/HVHV"], nh.Window(1, 7, 2, 5))
    assert got.shape == (6, 3) and np.allclose(got, 0.02)


def test_roi_window_contains_roi_and_transform_edges(synthetic_h5):
    path, _, _ = synthetic_h5
    with h5py.File(path, "r") as f:
        grid = nh.open_grid(f)
    win, roi, clipped = nh.roi_window(grid, ROI)
    xmin, ymin, xmax, ymax = roi.bounds
    assert not clipped
    assert grid.x[win.col0] >= xmin and grid.x[win.col1 - 1] <= xmax
    assert grid.x[win.col0 - 1] < xmin and grid.x[win.col1] > xmax      # ventana mínima
    assert grid.y[win.row0] <= ymax and grid.y[win.row1 - 1] >= ymin
    tr = grid.transform(win.row0, win.col0)
    assert tr.c == grid.x[win.col0] - 50 and tr.f == grid.y[win.row0] + 50  # esquina = centro ± medio píxel


def test_roi_outside_scene_raises(synthetic_h5):
    path, _, _ = synthetic_h5
    with h5py.File(path, "r") as f:
        grid = nh.open_grid(f)
    far = "POLYGON((-90 10,-89.9 10,-89.9 10.1,-90 10.1,-90 10))"
    with pytest.raises(ValueError):
        nh.roi_window(grid, far)


def test_power_is_re2_plus_im2_and_fill_is_nan():
    z = np.array([0.3 + 0.4j, complex(np.nan, np.nan)], dtype=np.complex64)
    p = nh.power(z)
    assert p[0] == pytest.approx(0.25, rel=1e-6)
    assert np.isnan(p[1])


def test_read_power_by_strips_equals_direct(synthetic_h5):
    path, hh, _ = synthetic_h5
    win = nh.Window(3, 50, 7, 41)
    with h5py.File(path, "r") as f:
        got = nh.read_power(f["science/LSAR/GSLC/grids/frequencyA/HH"], win, chunk_rows=16)
    expected = nh.power(hh[3:50, 7:41])
    np.testing.assert_array_equal(np.isnan(got), np.isnan(expected))
    np.testing.assert_allclose(got[~np.isnan(got)], expected[~np.isnan(expected)])


def test_strips_align_to_chunks():
    assert nh._strips(3, 50, 16) == [(3, 16), (16, 32), (32, 48), (48, 50)]
    assert nh._strips(16, 32, 16) == [(16, 32)]


def test_valid_mask_rules():
    mask = np.array([[0, 1, 2, 255]], dtype=np.uint8)
    pw = np.array([[1.0, 1.0, np.nan, 1.0]], dtype=np.float32)
    assert nh.valid_mask(mask).tolist() == [[False, True, True, False]]
    assert nh.valid_mask(mask, pw).tolist() == [[False, True, False, False]]


def test_db_conversion():
    assert nh.to_db(0.1) == pytest.approx(-10.0)
    assert nh.to_db(0.25) == pytest.approx(-6.0206, abs=1e-4)
    out = nh.to_db(np.array([1.0, 0.0, -1.0, np.nan], dtype=np.float32))
    assert out[0] == 0.0 and np.isnan(out[1:]).all()


def test_multilook_is_linear_mean_and_respects_min_valid():
    a = np.array([[1, 3, 0.5, np.nan],
                  [1, 3, np.nan, np.nan]], dtype=np.float32)
    ml = nh.multilook(a, 2, min_valid_fraction=0.5)
    assert ml.shape == (1, 2)
    assert ml[0, 0] == pytest.approx(2.0)          # (1+3+1+3)/4
    assert np.isnan(ml[0, 1])                      # 1 de 4 válidos < 50 %
    assert nh.multilook(a, 2, min_valid_fraction=0.25)[0, 1] == pytest.approx(0.5)


def test_multilook_drops_incomplete_edge():
    assert nh.multilook(np.ones((5, 7), dtype=np.float32), 2).shape == (2, 3)


def test_stats_db_of_mean_vs_mean_of_db():
    s = nh.power_stats(np.array([0.1, 1.0, np.nan], dtype=np.float32))
    assert s["n_validos"] == 2
    assert s["media_lineal"] == pytest.approx(0.55)
    assert s["dB_de_la_media"] == pytest.approx(10 * np.log10(0.55))
    assert s["media_dB"] == pytest.approx(-5.0)    # (−10 + 0)/2
    assert s["media_dB"] < s["dB_de_la_media"]


def test_decimate_takes_every_nth(synthetic_h5):
    path, hh, _ = synthetic_h5
    with h5py.File(path, "r") as f:
        d = nh.decimate(f["science/LSAR/GSLC/grids/frequencyA/HH"], 7)
    np.testing.assert_array_equal(np.isnan(d), np.isnan(hh[::7, ::7]))
