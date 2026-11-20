"""GEBCO bathymetry for sea cells: window read, reprojection to the DEM grid and sea-cell selection."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.hydrology.bathymetry import gebco_on_grid, prepare_gebco, read_gebco_window, sea_cell_elevations


def gebco_file(tmp_path, values, west=-93.0, north=16.0, step=1 / 240):
    """A tiny GEBCO-like GeoTIFF (EPSG:4326, int16 metres about MSL, 15 arc-second cells)."""
    path = tmp_path / 'gebco.tif'
    values = np.asarray(values, dtype='int16')
    with rasterio.open(path, 'w', driver='GTiff', width=values.shape[1], height=values.shape[0], count=1,
                       dtype='int16', crs='EPSG:4326', transform=from_origin(west, north, step, step)) as dst:
        dst.write(values, 1)
    return path


def test_read_gebco_window_returns_only_the_cells_inside_the_bounds(tmp_path):
    values = np.arange(100, dtype='int16').reshape(10, 10) - 50
    path = gebco_file(tmp_path, values)
    step = 1 / 240
    bounds = (-93.0 + 2 * step, 16.0 - 6 * step, -93.0 + 5 * step, 16.0 - 3 * step)  # cols 2-4, rows 3-5
    elevation, transform, crs = read_gebco_window(bounds, source=path)
    assert elevation.dtype == np.float64
    np.testing.assert_array_equal(elevation, values[3:6, 2:5])
    assert transform.c == pytest.approx(-93.0 + 2 * step) and transform.f == pytest.approx(16.0 - 3 * step)
    assert crs.to_epsg() == 4326


def test_prepare_gebco_caches_a_window_as_geotiff(tmp_path):
    values = np.arange(100, dtype='int16').reshape(10, 10) - 50
    path = gebco_file(tmp_path, values)
    step = 1 / 240
    out = prepare_gebco((-93.0 + 2 * step, 16.0 - 6 * step, -93.0 + 5 * step, 16.0 - 3 * step),
                        tmp_path / 'cache' / 'window.tif', source=path)
    with rasterio.open(out) as cached:
        np.testing.assert_array_equal(cached.read(1), values[3:6, 2:5])
        assert cached.crs.to_epsg() == 4326


def test_gebco_on_grid_reprojects_to_the_metric_dem_grid(tmp_path):
    # Constant -25 m sea everywhere: any resampling onto a UTM grid inside it must give -25 m.
    path = gebco_file(tmp_path, np.full((60, 60), -25))
    transform = from_origin(505000, 1765000, 30, 30)  # UTM 15N, inside the synthetic tile near (-92.95, 15.96)
    elevation = gebco_on_grid(transform, 'EPSG:32615', (20, 20), source=path)
    assert elevation.shape == (20, 20)
    np.testing.assert_allclose(elevation, -25.0)


def test_sea_cells_need_gebco_below_msl_low_dem_and_a_path_to_the_edge():
    # DEM: land on the left (5 m), sea on the right (0 m); an isolated low pit inside the land.
    dem = np.full((6, 8), 5.0)
    dem[:, 5:] = 0.0
    dem[2, 1] = 0.0
    gebco = np.full((6, 8), 3.0)
    gebco[:, 4:] = -12.0
    gebco[2, 1] = -2.0  # GEBCO also below MSL at the pit (coarse grid), but it does not reach the sea
    transform = from_origin(500000, 1769000, 30, 30)
    result = sea_cell_elevations(dem, transform, 'EPSG:32615', gebco_reader=lambda *a, **k: gebco)
    expected = np.zeros((6, 8), bool)
    expected[:, 5:] = True  # column 4 has GEBCO < 0 but DEM 5 m: land on the DEM, not sea
    np.testing.assert_array_equal(result['sea'], expected)
    np.testing.assert_allclose(result['elevation'][expected], -12.0)
    assert np.isnan(result['elevation'][~expected]).all()
    assert result['provenance']['datum'] == 'mean sea level (GEBCO; MDT not applied)'
    assert result['provenance']['sea_cells'] == 18


def test_sea_cells_add_an_explicit_msl_offset_and_record_it():
    dem = np.zeros((3, 3))
    gebco = np.full((3, 3), -4.0)
    result = sea_cell_elevations(dem, from_origin(500000, 1769000, 30, 30), 'EPSG:32615', msl_offset_m=0.7,
                                 gebco_reader=lambda *a, **k: gebco)
    np.testing.assert_allclose(result['elevation'], -3.3)
    assert result['provenance']['msl_offset_m'] == 0.7
    assert 'EGM2008' in result['provenance']['datum']


def test_sea_cells_use_a_given_mask_instead_of_the_rule():
    dem = np.full((3, 3), 9.0)
    gebco = np.full((3, 3), -4.0)
    mask = np.zeros((3, 3), bool)
    mask[0, 0] = True
    result = sea_cell_elevations(dem, from_origin(500000, 1769000, 30, 30), 'EPSG:32615', sea_mask=mask,
                                 gebco_reader=lambda *a, **k: gebco)
    np.testing.assert_array_equal(result['sea'], mask)
    assert result['elevation'][0, 0] == -4.0 and np.isnan(result['elevation'][1:, :]).all()
