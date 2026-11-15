import io
import zipfile

import numpy as np
import pytest

from pipeline.solar.dem import prepare_dem


def tile_zip(name, array):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"nested/{name}.hgt", np.asarray(array, dtype=">i2").tobytes())
    return stream.getvalue()


def roi(west, south, east, north, *, polygon=None):
    coordinates = polygon or [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [coordinates]}


def test_mosaics_adjacent_tiles_reprojects_and_keeps_roi_halo_and_mask():
    size = 5
    west = np.tile(np.arange(size, dtype=np.int16), (size, 1))
    east = np.tile(np.arange(size, dtype=np.int16) + 4, (size, 1))
    prepared = prepare_dem(
        {"N00E000": tile_zip("N00E000", west), "N00E001": tile_zip("N00E001", east)},
        roi(0.2, 0.2, 0.8, 0.8, polygon=[[0.2, 0.2], [0.8, 0.2], [0.45, 0.8], [0.2, 0.2]]),
        tile_size=size,
    )
    assert prepared.crs.is_projected
    assert prepared.crs.axis_info[0].unit_name.lower() in {"metre", "meter"}
    assert prepared.elevation.shape == prepared.valid_mask.shape
    assert prepared.valid_mask.any() and (~prepared.valid_mask).any()
    assert set(prepared.provenance) == {"N00E000", "N00E001"}
    assert prepared.halo_mask.any()


def test_rejects_roi_outside_supplied_tile_coverage():
    with pytest.raises(ValueError, match="coverage"):
        prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))}, roi(1.1, 0.1, 1.8, 0.8), tile_size=5)


def test_partial_tile_coverage_warns_and_stops_without_a_dem():
    with pytest.warns(RuntimeWarning, match="incomplete NASADEM coverage"):
        with pytest.raises(ValueError, match="coverage"):
            prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))},
                        roi(0.8, 0.2, 1.2, 0.8), tile_size=5)


def test_complete_tile_near_edge_keeps_all_roi_pixel_centers():
    import warnings
    from pyproj import Transformer
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine
    from shapely.geometry import mapping, shape
    from shapely.ops import transform

    geometry = roi(0.1, 0.1, 0.9, 0.9)
    with warnings.catch_warnings(record=True) as emitted:
        warnings.simplefilter("always", RuntimeWarning)
        prepared = prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))},
                               geometry, tile_size=5)
    projected = transform(Transformer.from_crs("EPSG:4326", prepared.crs, always_xy=True).transform,
                          shape(geometry))
    centers = geometry_mask([mapping(projected)], out_shape=prepared.elevation.shape,
                            transform=Affine.from_gdal(*prepared.transform), invert=True)
    assert centers.any()
    assert prepared.valid_mask[centers].all()
    assert not any(issubclass(item.category, RuntimeWarning) for item in emitted)


def test_mixed_nasadem_void_warns_and_stops_before_interpolation():
    values = np.full((5, 5), 100, dtype=np.int16)
    values[2, 2] = -32768
    with pytest.warns(RuntimeWarning, match="out-of-range NASADEM HGT elevation"):
        with pytest.raises(ValueError, match="out-of-range.*HGT"):
            prepare_dem({"N00E000": tile_zip("N00E000", values)},
                        roi(0.2, 0.2, 0.8, 0.8), tile_size=5)


def test_truncated_tile_warns_and_stops_without_a_dem():
    with pytest.warns(RuntimeWarning, match="incomplete NASADEM tile"):
        with pytest.raises(ValueError, match="size|dimension"):
            prepare_dem({"N00E000": tile_zip("N00E000", np.ones((4, 4)))},
                        roi(0.2, 0.2, 0.8, 0.8), tile_size=5)


@pytest.mark.parametrize("member", ["N00E001.hgt", "readme.txt"])
def test_valid_zip_with_wrong_identity_or_missing_hgt_warns_and_stops(member):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, np.ones((5, 5), dtype=">i2").tobytes())
    with pytest.warns(RuntimeWarning, match="incomplete NASADEM tile"):
        with pytest.raises(ValueError, match="identity|HGT"):
            prepare_dem({"N00E000": stream.getvalue()}, roi(.2, .2, .8, .8), tile_size=5)


def test_valid_partial_roi_of_complete_tile_needs_no_incomplete_warning():
    import warnings

    with warnings.catch_warnings(record=True) as emitted:
        warnings.simplefilter("always", RuntimeWarning)
        prepared = prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))},
                               roi(0.2, 0.2, 0.8, 0.8), tile_size=5)
    assert prepared.valid_mask.any()
    assert not any(issubclass(item.category, RuntimeWarning) for item in emitted)


def test_default_full_size_adjacent_tiles_fit_pixel_budget_for_narrow_roi():
    size = 3601
    zeros = np.zeros((size, size), dtype=">i2")
    tiles = {name: tile_zip(name, zeros) for name in ("N00W001", "N00E000")}
    prepared = prepare_dem(tiles, roi(-0.0005, 0.4, 0.0005, 0.4005), max_pixels=30_000_000)
    assert prepared.elevation.size < 20_000_000
    assert prepared.crs.is_projected


def test_pixel_centers_match_hgt_post_coordinates():
    from pyproj import Transformer

    values = np.tile(np.arange(5, dtype=np.int16), (5, 1))
    prepared = prepare_dem({"N00E000": tile_zip("N00E000", values)}, roi(0.1, 0.1, 0.8, 0.8), tile_size=5)
    x0, dx, _, y0, _, dy = prepared.transform
    inverse = Transformer.from_crs(prepared.crs, "EPSG:4326", always_xy=True)
    rows, cols = np.nonzero(prepared.valid_mask)
    lon, _ = inverse.transform(x0 + (cols + 0.5) * dx, y0 + (rows + 0.5) * dy)
    assert np.allclose(prepared.elevation[rows, cols], np.asarray(lon) * 4, atol=0.15)


def test_missing_tile_is_nan_and_not_marked_valid():
    with pytest.raises(ValueError, match="coverage"):
        prepare_dem({"N00W001": tile_zip("N00W001", np.ones((5, 5)))}, roi(-0.1, 0.2, 0.1, 0.8), tile_size=5)


def test_rejects_missing_roi_coverage_even_when_other_roi_tile_exists():
    geometry = {"type": "MultiPolygon", "coordinates": [
        [[[0.1, .1], [.2, .1], [.2, .2], [.1, .2], [.1, .1]]],
        [[[2.1, .1], [2.2, .1], [2.2, .2], [2.1, .2], [2.1, .1]]],
    ]}
    with pytest.raises(ValueError, match="coverage"):
        prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))}, geometry, tile_size=5)


def test_resource_cap_is_checked_before_tile_payload_read(monkeypatch):
    import pipeline.solar.dem as dem
    monkeypatch.setattr(dem, "_read_hgt", lambda *args: pytest.fail("tile payload read before resource cap"))
    with pytest.raises(ValueError, match="pixel|resource"):
        prepare_dem({"N00E000": b"not read"}, roi(.1, .1, .8, .8), tile_size=5, max_pixels=1)


def test_missing_neighbor_keeps_derivative_halo_explicitly_invalid():
    prepared = prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))}, roi(.1, .1, .9, .9), tile_size=5)
    assert prepared.valid_mask.any()
    assert np.all(np.isnan(prepared.elevation[~(prepared.valid_mask | prepared.halo_mask)]))


def test_aggregate_source_pixel_budget_is_checked_before_reading_any_tile(monkeypatch):
    import pipeline.solar.dem as dem

    reads = []
    monkeypatch.setattr(dem, "_read_hgt", lambda *args: reads.append(args) or np.ones((5, 5)))
    with pytest.raises(ValueError, match="pixel|resource"):
        prepare_dem({"N00E000": b"unread", "N00E001": b"unread"}, roi(.2, .2, .8, .8), tile_size=5, max_tiles=2, max_pixels=40)
    assert reads == []


def test_rejects_mismatched_shared_tile_posts():
    first = np.zeros((5, 5), dtype=np.int16)
    second = np.zeros((5, 5), dtype=np.int16)
    second[:, 0] = 9
    with pytest.raises(ValueError, match="seam|shared|post"):
        prepare_dem({"N00E000": tile_zip("N00E000", first), "N00E001": tile_zip("N00E001", second)}, roi(.2, .2, .8, .8), tile_size=5)


@pytest.mark.parametrize("bounds", [(.05, .2, .4, .8), (.6, .2, .95, .8), (.2, .05, .8, .4), (.2, .6, .8, .95)])
def test_each_roi_edge_has_source_halo_or_explicit_invalid_derivative(bounds):
    from pipeline.solar.terrain import compute_terrain
    values = np.tile(np.arange(5, dtype=np.int16), (5, 1))
    prepared = prepare_dem({"N00E000": tile_zip("N00E000", values)}, roi(*bounds), tile_size=5)
    terrain = compute_terrain(prepared.elevation, prepared.transform, prepared.valid_mask | prepared.halo_mask, units="m")
    assert np.all(np.isfinite(prepared.elevation[prepared.valid_mask]))
    assert prepared.halo_mask.any()
    assert np.any(terrain["valid"] & prepared.valid_mask)


def test_projected_roi_edges_are_densified_before_bounds_and_mask():
    # A long diagonal edge is curved under UTM; projected endpoints alone
    # underestimate its envelope. The prepared mask must cover the projected
    # curved boundary rather than only the four projected corners.
    geometry = roi(-2.8, 10.0, 2.8, 15.0, polygon=[[-2.8, 10], [2.8, 10], [2.8, 15], [-2.8, 10]])
    arrays = {f"N{lat:02d}{'W' if lon < 0 else 'E'}{abs(lon):03d}": np.zeros((9, 9), dtype=np.int16)
              for lat in range(10, 15) for lon in range(-3, 3)}
    prepared = prepare_dem({name: tile_zip(name, values) for name, values in arrays.items()}, geometry, tile_size=9, max_tiles=40, max_pixels=10000, max_memory_bytes=10_000_000)
    from pyproj import Transformer
    projected = Transformer.from_crs("EPSG:4326", prepared.crs, always_xy=True)
    # Sample the long edge densely and require every sample to fall within
    # the raster footprint (not just the projected endpoint chord).
    lons = np.linspace(-2.8, 2.8, 501)
    xs, ys = projected.transform(lons, 10 + (lons + 2.8) * (5 / 5.6))
    x0, dx, _, y0, _, dy = prepared.transform
    assert np.all((xs >= x0) & (xs <= x0 + prepared.elevation.shape[1] * dx))
    assert np.all((ys <= y0) & (ys >= y0 + prepared.elevation.shape[0] * dy))


def test_two_full_default_tiles_fit_safe_default_budget(monkeypatch):
    import pipeline.solar.dem as dem
    size = 3601
    monkeypatch.setattr(dem, "_read_hgt", lambda source, tile, tile_size: np.zeros((tile_size, tile_size), dtype=np.float32))
    prepared = prepare_dem({"N00W001": b"validated", "N00E000": b"validated"}, roi(-0.0005, .4, .0005, .4005))
    assert prepared.valid_mask.any()


def test_peak_memory_budget_is_preflighted_before_tile_read(monkeypatch):
    import pipeline.solar.dem as dem
    monkeypatch.setattr(dem, "_read_hgt", lambda *args: pytest.fail("tile read before memory preflight"))
    with pytest.raises(ValueError, match="memory|resource"):
        prepare_dem({"N00E000": b"unread"}, roi(.1, .1, .8, .8), tile_size=5, max_memory_bytes=1)


def test_final_roi_halo_provenance_excludes_unused_tiles_and_includes_seam_contributors():
    size = 5
    west = np.tile(np.arange(size, dtype=np.int16), (size, 1))
    east = west + size - 1  # the shared post matches; east contributes across the seam
    tiles = {name: tile_zip(name, data) for name, data in (
        ("N00E000", west), ("N00E001", east), ("N00E003", np.full((size, size), 99)))}
    inside = prepare_dem(tiles, roi(.2, .2, .8, .8), tile_size=size, max_tiles=4)
    assert inside.valid_mask.any() and inside.halo_mask.any()
    assert inside.provenance == ("N00E000", "N00E001"), "east tile has positive bilinear weight in final ROI/halo"
    across = prepare_dem(tiles, roi(.8, .2, 1.2, .8), tile_size=size, max_tiles=4)
    assert across.valid_mask.any() and across.halo_mask.any()
    assert across.provenance == ("N00E000", "N00E001")


def test_provenance_includes_every_positive_bilinear_source_at_roi_halo_seam():
    size = 9
    west = np.tile(np.arange(size, dtype=np.int16), (size, 1))
    east = np.full((size, size), 100, dtype=np.int16)
    east[:, 0] = west[:, -1]  # matching shared posts; large interior values expose any positive blend
    tiles = {
        "N00E000": tile_zip("N00E000", west),
        "N00E001": tile_zip("N00E001", east),
        "N00E003": tile_zip("N00E003", np.full((size, size), 99)),
    }
    geometry = roi(.8, .2, 1.2, .8)
    prepared = prepare_dem(tiles, geometry, tile_size=size, max_tiles=4)
    final = (prepared.valid_mask | prepared.halo_mask) & np.isfinite(prepared.elevation)
    assert prepared.valid_mask.any() and prepared.halo_mask.any()
    assert np.any((prepared.elevation[final] > size - 1) & (prepared.elevation[final] < 100)), "final raster must contain a positive bilinear blend across the seam"
    assert prepared.provenance == ("N00E000", "N00E001")


def test_unselected_supplied_zip_is_never_read(monkeypatch):
    import pipeline.solar.dem as dem
    original = dem._read_hgt
    read = []
    def tracking(source, tile, tile_size):
        read.append(tile)
        if tile == "N00E003":
            pytest.fail("unselected ZIP read")
        return original(source, tile, tile_size)
    monkeypatch.setattr(dem, "_read_hgt", tracking)
    prepare_dem({name: tile_zip(name, np.ones((5, 5))) for name in ("N00E000", "N00E003")}, roi(.2, .2, .8, .8), tile_size=5)
    assert read == ["N00E000"]


def test_raw_roi_vertex_count_is_rejected_before_shapely_shape(monkeypatch):
    import pipeline.solar.dem as dem
    ring = [[.1 + i * 1e-8, .1] for i in range(100_002)]
    ring[-1] = ring[0]
    geometry = {"type": "Polygon", "coordinates": [ring]}
    monkeypatch.setattr(dem, "shape", lambda value: pytest.fail("complex geometry materialized before vertex cap"))
    with pytest.raises(ValueError, match="vertex|complexity"):
        prepare_dem({}, geometry, tile_size=5)


def test_segmentized_vertex_count_is_bounded_before_projection(monkeypatch):
    import pipeline.solar.dem as dem
    geom = dem.shape(roi(0, 0, 1, 1))
    monkeypatch.setattr(dem, "_MAX_ROI_VERTICES", 1000)
    monkeypatch.setattr(dem, "_geometry", lambda _: geom)
    monkeypatch.setattr(dem, "transform_geometry", lambda *args: pytest.fail("unbounded densification reached projection"))
    with pytest.raises(ValueError, match="vertex|complexity"):
        prepare_dem({"N00E000": b"unused"}, roi(0, 0, 1, 1), tile_size=3601)


def test_continuous_shared_tile_posts_are_accepted():
    size = 5
    west = np.tile(np.arange(size, dtype=np.int16), (size, 1))
    east = np.tile(np.arange(size, dtype=np.int16) + 4, (size, 1))
    prepared = prepare_dem({"N00E000": tile_zip("N00E000", west), "N00E001": tile_zip("N00E001", east)}, roi(.8, .2, 1.2, .8), tile_size=size, max_pixels=100)
    assert prepared.valid_mask.any()


def test_halo_neighbors_can_support_gradient_at_roi_edge():
    from pipeline.solar.terrain import compute_terrain
    array = np.tile(np.arange(5, dtype=np.int16), (5, 1))
    prepared = prepare_dem({"N00E000": tile_zip("N00E000", array)}, roi(.2, .2, .8, .8), tile_size=5)
    result = compute_terrain(prepared.elevation, prepared.transform, prepared.valid_mask | prepared.halo_mask, units="m")
    assert np.any(result["valid"] & prepared.valid_mask)


def test_rejects_zip_decompression_bomb_before_reading_member():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("N00E000.hgt", b"0" * (3601 * 3601 * 2 + 1))
    with pytest.raises(ValueError, match="size|dimension|limit"):
        prepare_dem({"N00E000": stream.getvalue()}, roi(0.1, 0.1, 0.8, 0.8))


def test_nonintersecting_bbox_tiles_are_not_required_for_multipolygon():
    geometry = {"type": "MultiPolygon", "coordinates": [
        [[[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2], [0.1, 0.1]]],
        [[[2.1, 0.1], [2.2, 0.1], [2.2, 0.2], [2.1, 0.2], [2.1, 0.1]]],
    ]}
    prepared = prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5))), "N00E002": tile_zip("N00E002", np.ones((5, 5)))}, geometry, tile_size=5)
    assert prepared.valid_mask.any()


def test_rejects_invalid_geometry_and_resource_limits():
    with pytest.raises(ValueError, match="geometry"):
        prepare_dem({}, {"type": "Polygon", "coordinates": []}, tile_size=5)
    with pytest.raises(ValueError, match="pixel"):
        prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))}, roi(0.1, 0.1, 0.8, 0.8), tile_size=5, max_pixels=1)


def test_subpixel_roi_gap_is_rejected_without_area_tolerance():
    tiny = 1e-8
    geom = roi(.1, .1, 1 + tiny, .8)
    with pytest.raises(ValueError, match="coverage"):
        prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))}, geom, tile_size=5)


def test_incomplete_reprojected_support_warns_and_stops(monkeypatch):
    import pipeline.solar.dem as dem

    original = dem.reproject

    def partial_support(source, destination, **kwargs):
        original(source, destination, **kwargs)
        if kwargs.get("src_nodata") is None and source.dtype == np.float32:
            destination[:] = 0.5

    monkeypatch.setattr(dem, "reproject", partial_support)
    with pytest.warns(RuntimeWarning, match="incomplete NASADEM coverage"):
        with pytest.raises(ValueError, match="coverage"):
            prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))},
                        roi(0.2, 0.2, 0.8, 0.8), tile_size=5)


def test_roi_pixels_without_reprojected_source_are_rejected(monkeypatch):
    import pipeline.solar.dem as dem
    original = dem.reproject

    def drop_validity(source, destination, **kwargs):
        original(source, destination, **kwargs)
        if source.dtype == np.uint8:
            destination[:] = 0

    monkeypatch.setattr(dem, "reproject", drop_validity)
    with pytest.raises(ValueError, match="coverage|valid"):
        prepare_dem({"N00E000": tile_zip("N00E000", np.ones((5, 5)))}, roi(.1, .1, .8, .8), tile_size=5)


def test_projected_output_limit_precedes_any_hgt_read(monkeypatch):
    import pipeline.solar.dem as dem
    monkeypatch.setattr(dem, "_read_hgt", lambda *args: pytest.fail("HGT read before output budget check"))
    with pytest.raises(ValueError, match="pixel|resource"):
        prepare_dem({"N00E000": b"unread"}, roi(.1, .1, .8, .8), tile_size=5, max_pixels=26)


def test_dispersed_multipolygon_mosaic_limit_precedes_any_hgt_read(monkeypatch):
    import pipeline.solar.dem as dem
    geom = {"type": "MultiPolygon", "coordinates": [
        [[[.1, .1], [.2, .1], [.2, .2], [.1, .2], [.1, .1]]],
        [[[2.1, .1], [2.2, .1], [2.2, .2], [2.1, .2], [2.1, .1]]],
    ]}
    monkeypatch.setattr(dem, "_read_hgt", lambda *args: pytest.fail("mosaic allocation bound checked after HGT read"))
    with pytest.raises(ValueError, match="pixel|resource"):
        prepare_dem({"N00E000": b"unread", "N00E002": b"unread"}, geom, tile_size=5, max_pixels=60)


def test_cardinal_edge_pixels_have_support_only_when_matching_neighbor_exists():
    from pipeline.solar.terrain import compute_terrain
    from pyproj import Transformer
    size = 5
    base = np.tile(np.arange(size, dtype=np.int16), (size, 1))
    cases = [
        ((.8, .2, 1.0, .8), "N00E001", base + size - 1, "east"),
        ((0.0, .2, .2, .8), "N00W001", base - (size - 1), "west"),
        ((.2, .8, .8, 1.0), "N01E000", base.copy(), "north"),
        ((.2, .0, .8, .2), "S01E000", base.copy(), "south"),
    ]
    expected_east = 1.0 / (111320.0 * (1 / (size - 1)))
    tolerance = expected_east * .5
    for bounds, neighbor, neighbor_data, direction in cases:
        sources = {"N00E000": tile_zip("N00E000", base), neighbor: tile_zip(neighbor, neighbor_data)}
        with_neighbor = prepare_dem(sources, roi(*bounds), tile_size=size)
        without_neighbor = prepare_dem({"N00E000": sources["N00E000"]}, roi(*bounds), tile_size=size)
        assert with_neighbor.elevation.shape == without_neighbor.elevation.shape
        assert with_neighbor.transform == without_neighbor.transform
        rows, cols = np.nonzero(with_neighbor.valid_mask)
        x0, dx, _, y0, _, dy = with_neighbor.transform
        inverse = Transformer.from_crs(with_neighbor.crs, "EPSG:4326", always_xy=True)
        lon, lat = inverse.transform(x0 + (cols + .5) * dx, y0 + (rows + .5) * dy)
        coord = np.asarray(lon if direction in ("east", "west") else lat)
        orthogonal = np.asarray(lat if direction in ("east", "west") else lon)
        edge = bounds[2] if direction == "east" else bounds[0] if direction == "west" else bounds[3] if direction == "north" else bounds[1]
        low, high = (bounds[1], bounds[3]) if direction in ("east", "west") else (bounds[0], bounds[2])
        middle = np.flatnonzero((orthogonal >= low + (high - low) * .25) & (orthogonal <= high - (high - low) * .25))
        selected = middle[np.argsort(np.abs(coord[middle] - edge))]
        edge_rows, edge_cols = rows[selected], cols[selected]
        assert selected.size > 0, f"no {direction} ROI-edge pixels selected"

        supported_terrain = compute_terrain(with_neighbor.elevation, with_neighbor.transform,
                                            with_neighbor.valid_mask | with_neighbor.halo_mask, units="m")
        missing_terrain = compute_terrain(without_neighbor.elevation, without_neighbor.transform,
                                          without_neighbor.valid_mask | without_neighbor.halo_mask, units="m")
        missing_support = ~missing_terrain["valid"][edge_rows, edge_cols]
        assert missing_support.any(), f"no geometrically matching {direction} edge pixel requires the missing tile"
        edge_rows, edge_cols = edge_rows[missing_support], edge_cols[missing_support]
        assert np.all(supported_terrain["valid"][edge_rows, edge_cols]), f"neighbor must support same {direction} edge pixels"
        east_values = supported_terrain["gradient_east"][edge_rows, edge_cols]
        north_values = supported_terrain["gradient_north"][edge_rows, edge_cols]
        assert np.all(np.abs(east_values - expected_east) < tolerance)
        assert np.all(np.abs(north_values) < tolerance)
        assert np.all(~missing_terrain["valid"][edge_rows, edge_cols]), f"missing neighbor must invalidate same {direction} edge pixels"
        assert np.all(np.isnan(missing_terrain["gradient_east"][edge_rows, edge_cols]))
        assert np.all(np.isnan(missing_terrain["gradient_north"][edge_rows, edge_cols]))


def test_valid_seam_has_analytic_east_and_north_gradients_on_both_sides_inside_roi():
    from pipeline.solar.terrain import compute_terrain
    size = 9
    values = np.add.outer(np.arange(size - 1, -1, -1, dtype=np.int16), np.arange(size, dtype=np.int16))
    east = values + (size - 1)
    prepared = prepare_dem({"N00E000": tile_zip("N00E000", values), "N00E001": tile_zip("N00E001", east)}, roi(.8, .2, 1.2, .8), tile_size=size, max_pixels=200)
    terrain = compute_terrain(prepared.elevation, prepared.transform, prepared.valid_mask | prepared.halo_mask, units="m")
    x0, dx, _, y0, _, dy = prepared.transform
    from pyproj import Transformer
    inverse = Transformer.from_crs(prepared.crs, "EPSG:4326", always_xy=True)
    rows, cols = np.nonzero(prepared.valid_mask)
    lon, _ = inverse.transform(x0 + (cols + .5) * dx, y0 + (rows + .5) * dy)
    left = prepared.valid_mask[rows, cols] & (np.asarray(lon) < 1)
    right = prepared.valid_mask[rows, cols] & (np.asarray(lon) >= 1)
    assert left.any() and right.any()
    assert np.all(np.isfinite(terrain["gradient_east"][rows[left], cols[left]]))
    assert np.all(np.isfinite(terrain["gradient_east"][rows[right], cols[right]]))
    expected_east = 1.0 / (111320.0 * (1 / (size - 1)))
    assert 0 < expected_east
    tolerance = expected_east * 0.25
    for side in (left, right):
        assert np.all(np.abs(terrain["gradient_east"][rows[side], cols[side]] - expected_east) < tolerance)
        assert np.all(np.abs(terrain["gradient_north"][rows[side], cols[side]] - expected_east) < tolerance)
        assert np.all(terrain["gradient_east"][rows[side], cols[side]] > expected_east - tolerance)
        assert np.all(terrain["gradient_north"][rows[side], cols[side]] > expected_east - tolerance)
        assert np.all(np.isfinite(prepared.elevation[rows[side], cols[side]]))
    _, lat = inverse.transform(x0 + (cols + .5) * dx, y0 + (rows + .5) * dy)
    height_left = prepared.elevation[rows[left], cols[left]].mean()
    height_right = prepared.elevation[rows[right], cols[right]].mean()
    expected_height_delta = (np.asarray(lon)[right].mean() - np.asarray(lon)[left].mean() +
                             np.asarray(lat)[right].mean() - np.asarray(lat)[left].mean()) * (size - 1)
    assert abs((height_right - height_left) - expected_height_delta) < 0.5
