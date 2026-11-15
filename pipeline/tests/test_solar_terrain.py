import io
import zipfile

import numpy as np
import pytest

from pipeline.solar.dem import prepare_dem
from pipeline.solar.terrain import compute_terrain


TRANSFORM = (100.0, 2.0, 0.0, 200.0, 0.0, -3.0)


def test_flat_outputs_and_undefined_aspect():
    z = np.full((5, 5), 12.0)
    result = compute_terrain(z, TRANSFORM, np.ones_like(z, dtype=bool), units="m")
    assert np.all(result["valid"][1:-1, 1:-1])
    assert not result["valid"][0].any() and not result["valid"][-1].any()
    assert np.allclose(result["gradient_east"][1:-1, 1:-1], 0)
    assert np.allclose(result["gradient_north"][1:-1, 1:-1], 0)
    assert np.allclose(result["slope"][1:-1, 1:-1], 0)
    assert np.isnan(result["aspect"][1:-1, 1:-1]).all()
    assert np.allclose(result["normal"][1:-1, 1:-1], [0, 0, 1])


@pytest.mark.parametrize("axis,sign,expected", [("east", 1, 270), ("east", -1, 90), ("north", 1, 180), ("north", -1, 0)])
def test_cardinal_planes(axis, sign, expected):
    rows, cols = np.indices((5, 5))
    z = sign * (cols * 2 if axis == "east" else -rows * 3).astype(float)
    result = compute_terrain(z, TRANSFORM, np.ones_like(z, dtype=bool), units="m")
    core = (slice(1, -1), slice(1, -1))
    gx, gy = result["gradient_east"][core], result["gradient_north"][core]
    assert np.allclose(gx, sign if axis == "east" else 0)
    assert np.allclose(gy, sign if axis == "north" else 0)
    assert np.allclose(result["slope"][core], np.pi / 4)
    assert np.allclose(result["aspect"][core], expected)
    assert np.allclose(np.linalg.norm(result["normal"][core], axis=-1), 1)
    assert np.allclose(result["normal"][2, 2], np.array([-gx[0, 0], -gy[0, 0], 1]) / np.sqrt(2))


def test_nodata_invalid_neighbor_and_border_are_masked_without_filling():
    z = np.arange(49, dtype=float).reshape(7, 7)
    valid = np.ones_like(z, dtype=bool)
    valid[3, 3] = False
    result = compute_terrain(z, TRANSFORM, valid, units="m")
    assert not result["valid"][3, 3]
    assert not result["valid"][2, 3] and not result["valid"][4, 3]
    assert not result["valid"][3, 2] and not result["valid"][3, 4]
    assert result["valid"][1, 1]
    assert np.isnan(result["normal"][3, 3]).all()
    assert np.isnan(result["gradient_east"][3, 3])
    assert not result["valid"][0, :].any()


def test_prepared_terrain_uses_halo_but_exposes_normals_only_inside_roi():
    from pipeline.solar.terrain import compute_prepared_terrain

    samples = np.full((9, 9), 20, dtype=">i2")
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w") as archive:
        archive.writestr("n00e000.hgt", samples.tobytes())
    roi = {"type": "Polygon", "coordinates": [[[.2, .2], [.8, .2], [.8, .8], [.2, .8], [.2, .2]]]}
    prepared = prepare_dem({"N00E000": archive_bytes.getvalue()}, roi, tile_size=9)

    result = compute_prepared_terrain(prepared)
    without_halo = compute_terrain(prepared.elevation, prepared.transform, prepared.valid_mask, units="m")
    assert np.any(result["valid"] & ~without_halo["valid"])
    assert np.any(result["valid"])
    assert not np.any(result["valid"] & ~prepared.valid_mask)
    assert np.allclose(result["normal"][result["valid"]], [0, 0, 1])
    assert np.isnan(result["normal"][~result["valid"]]).all()
    assert np.isnan(result["gradient_east"][~result["valid"]]).all()


def test_rejects_nonmetric_rotated_and_bad_inputs():
    z = np.ones((3, 3))
    mask = np.ones_like(z, dtype=bool)
    with pytest.raises(ValueError, match="metric"):
        compute_terrain(z, TRANSFORM, mask, units="degree")
    with pytest.raises(ValueError, match="north-up"):
        compute_terrain(z, (0, 1, .1, 0, 0, -1), mask, units="m")
    with pytest.raises(ValueError, match="shape"):
        compute_terrain(z, TRANSFORM, mask[:2], units="m")
