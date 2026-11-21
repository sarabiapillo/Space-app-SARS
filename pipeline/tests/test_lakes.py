"""HydroLAKES lakes for DG2: selection by bounds, burned bed and still water at the lake surface."""
import geopandas as gpd
import numpy as np
import pytest
from rasterio.transform import from_origin
from shapely.geometry import box

from pipeline.hydrology.lakes import burn_lakes, lakes_in_bounds

CRS = 'EPSG:32615'


def lake_file(tmp_path, polygons):
    """A tiny HydroLAKES-like GeoPackage (EPSG:4326) with the attributes the pipeline reads."""
    frame = gpd.GeoDataFrame(
        [{'Hylak_id': i + 1, 'Lake_name': f'Lake {i + 1}', 'Lake_area': geom.area / 1e6, 'Depth_avg': depth,
          'Vol_total': 0.0, 'Elevation': 0} for i, (geom, depth) in enumerate(polygons)],
        geometry=[geom for geom, _ in polygons], crs=CRS).to_crs('EPSG:4326')
    path = tmp_path / 'lakes.gpkg'
    frame.to_file(path, layer='lakes', driver='GPKG')
    return path


def test_lakes_in_bounds_reads_only_lakes_touching_the_domain(tmp_path):
    path = lake_file(tmp_path, [(box(500060, 1849880, 500120, 1849940), 3.0), (box(600000, 1849880, 600060, 1849940), 9.0)])
    inside = gpd.GeoDataFrame(geometry=[box(500000, 1849820, 500180, 1850000)], crs=CRS).to_crs('EPSG:4326').total_bounds
    lakes = lakes_in_bounds(path, tuple(inside))
    assert list(lakes['Hylak_id']) == [1] and lakes.crs.to_epsg() == 4326


def test_burn_lakes_digs_the_bed_to_the_mean_depth_and_fills_to_the_surface(tmp_path):
    # 6 x 6 cells of 30 m at 100 m; a 4 x 4 cell lake (120 m) with HydroLAKES mean depth 3 m.
    dem = np.full((6, 6), 100.0)
    transform = from_origin(500000, 1850000, 30, 30)
    path = lake_file(tmp_path, [(box(500030, 1849850, 500150, 1849970), 3.0)])
    lakes = lakes_in_bounds(path, (-180, -90, 180, 90))
    burned, depth, records = burn_lakes(dem, transform, CRS, lakes)
    lake = depth > 0
    assert lake.sum() == 16 and lake[1:5, 1:5].all()
    assert depth[lake].mean() == pytest.approx(3.0)
    assert depth[2, 2] > depth[1, 1]  # deeper away from the shore
    np.testing.assert_allclose(burned[lake] + depth[lake], 100.0)  # flat surface at the lake level
    assert (burned[~lake] == 100).all()
    [record] = records
    assert record['hylak_id'] == 1 and record['cells'] == 16 and record['surface_m'] == 100
    assert record['depth_avg_m'] == 3.0 and record['volume_m3'] == pytest.approx(3.0 * 16 * 900)


def test_burn_lakes_skips_lakes_without_a_mean_depth_or_cells(tmp_path):
    dem = np.full((6, 6), 100.0)
    path = lake_file(tmp_path, [(box(500030, 1849850, 500150, 1849970), float('nan')), (box(500000, 1849820, 500010, 1849825), 2.0)])
    burned, depth, records = burn_lakes(dem, from_origin(500000, 1850000, 30, 30), CRS, lakes_in_bounds(path, (-180, -90, 180, 90)))
    assert records == [] and not depth.any() and (burned == 100).all()


def test_lake_level_never_spills_over_the_lowest_cell_just_outside(tmp_path):
    # Lake surface 100 m, but the cell right outside its west shore sits at 99 m (an outlet).
    dem = np.full((6, 6), 100.0)
    dem[2, 0] = 99.0
    path = lake_file(tmp_path, [(box(500030, 1849850, 500150, 1849970), 3.0)])
    burned, depth, [record] = burn_lakes(dem, from_origin(500000, 1850000, 30, 30), CRS, lakes_in_bounds(path, (-180, -90, 180, 90)))
    assert record['surface_m'] == 99.0
    lake = depth > 0
    np.testing.assert_allclose(burned[lake] + depth[lake], 99.0)
    assert depth[lake].max() <= 3 * 3.0


def test_lakes_cut_by_the_domain_edge_are_skipped_and_recorded(tmp_path):
    dem = np.full((6, 6), 100.0)
    path = lake_file(tmp_path, [(box(499990, 1849850, 500090, 1849970), 3.0)])  # crosses the west edge
    burned, depth, records = burn_lakes(dem, from_origin(500000, 1850000, 30, 30), CRS, lakes_in_bounds(path, (-180, -90, 180, 90)))
    assert records == [{'hylak_id': 1, 'name': 'Lake 1', 'skipped': 'cut by the domain edge'}]
    assert not depth.any() and (burned == 100).all()
