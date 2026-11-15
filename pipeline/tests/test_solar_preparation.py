import io
import zipfile

import numpy as np
import pytest

from pipeline.solar import preparation
from pipeline.solar.dem import prepare_dem
from pipeline.solar.terrain import compute_prepared_terrain


def make_zip(offset=0):
    stream = io.BytesIO()
    values = np.add.outer(np.arange(9, dtype=np.int16), np.arange(9, dtype=np.int16)) + offset
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("N00E000.hgt", values.astype(">i2").tobytes())
    return stream.getvalue()


ROI = {"type": "Polygon", "coordinates": [[[.2, .2], [.8, .2], [.8, .8], [.2, .8], [.2, .2]]]}


def test_identical_request_hits_l2_and_l3_without_recomputing(tmp_path, monkeypatch):
    sources = {"N00E000": make_zip()}
    first = preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    monkeypatch.setattr(preparation, "prepare_dem", lambda *a, **k: pytest.fail("L2 recomputed"))
    monkeypatch.setattr(preparation, "compute_prepared_terrain", lambda *a, **k: pytest.fail("L3 recomputed"))
    second = preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    assert first.l2_hit is False and first.l3_hit is False
    assert second.l2_hit is True and second.l3_hit is True
    assert np.array_equal(first.dem.valid_mask, second.dem.valid_mask)
    assert np.array_equal(first.terrain["normal"], second.terrain["normal"], equal_nan=True)


def test_changed_roi_and_source_content_invalidate_both_levels(tmp_path, monkeypatch):
    sources = {"N00E000": make_zip()}
    first = preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    calls = {"dem": 0, "terrain": 0}
    original_dem, original_terrain = prepare_dem, compute_prepared_terrain
    monkeypatch.setattr(preparation, "prepare_dem", lambda *a, **k: (calls.__setitem__("dem", calls["dem"] + 1) or original_dem(*a, **k)))
    monkeypatch.setattr(preparation, "compute_prepared_terrain", lambda *a, **k: (calls.__setitem__("terrain", calls["terrain"] + 1) or original_terrain(*a, **k)))
    moved = {"type": "Polygon", "coordinates": [[[.25, .2], [.8, .2], [.8, .8], [.25, .8], [.25, .2]]]}
    roi_result = preparation.prepare_cached_terrain(sources, moved, tmp_path / "cache", tile_size=9)
    changed = {"N00E000": make_zip(1)}
    source_result = preparation.prepare_cached_terrain(changed, ROI, tmp_path / "cache", tile_size=9)
    assert not roi_result.l2_hit and not roi_result.l3_hit
    assert not source_result.l2_hit and not source_result.l3_hit
    assert calls == {"dem": 2, "terrain": 2}


def test_l3_miss_reuses_validated_l2_without_recomputing_dem(tmp_path, monkeypatch):
    sources = {"N00E000": make_zip()}
    publish = preparation._publish_or_validate

    def stop_before_l3(path, metadata, arrays, max_bytes):
        if metadata["level"] == "L3":
            raise OSError("simulated L3 publication interruption")
        return publish(path, metadata, arrays, max_bytes)

    monkeypatch.setattr(preparation, "_publish_or_validate", stop_before_l3)
    with pytest.raises(OSError, match="publication interruption"):
        preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    monkeypatch.setattr(preparation, "_publish_or_validate", publish)
    monkeypatch.setattr(preparation, "prepare_dem", lambda *a, **k: pytest.fail("valid L2 recomputed"))
    result = preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    assert result.l2_hit is True and result.l3_hit is False


def test_corrupt_l3_fails_closed_without_recompute_or_overwrite(tmp_path, monkeypatch):
    sources = {"N00E000": make_zip()}
    preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    l3_path = preparation.cache_artifact_path(tmp_path / "cache", "L3")
    l3_path.write_bytes(b"corruption")
    monkeypatch.setattr(preparation, "compute_prepared_terrain", lambda *a, **k: pytest.fail("corrupt L3 silently recomputed"))
    with pytest.raises(ValueError, match="corrupt|invalid"):
        preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    assert l3_path.read_bytes() == b"corruption"


def test_corrupt_l2_fails_closed_without_recompute_or_overwrite(tmp_path, monkeypatch):
    sources = {"N00E000": make_zip()}
    preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    l2_path = preparation.cache_artifact_path(tmp_path / "cache", "L2")
    l2_path.write_bytes(b"corruption")
    monkeypatch.setattr(preparation, "prepare_dem", lambda *a, **k: pytest.fail("corrupt L2 silently recomputed"))
    with pytest.raises(ValueError, match="corrupt|invalid"):
        preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    assert l2_path.read_bytes() == b"corruption"


def test_resource_limits_are_part_of_cache_identity(tmp_path):
    sources = {"N00E000": make_zip()}
    preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9)
    changed = preparation.prepare_cached_terrain(sources, ROI, tmp_path / "cache", tile_size=9, max_pixels=100)
    assert not changed.l2_hit and not changed.l3_hit


def test_rejects_symlinked_cache_root_and_keeps_unrelated_files(tmp_path):
    root = tmp_path / "cache"
    root.mkdir()
    unrelated = root / "keep.txt"
    unrelated.write_text("keep")
    link = tmp_path / "alias"
    link.symlink_to(root, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink|cache root"):
        preparation.prepare_cached_terrain({"N00E000": make_zip()}, ROI, link, tile_size=9)
    assert unrelated.read_text() == "keep"


def test_zip_source_identity_and_canonical_roi_are_stable(tmp_path):
    source = make_zip()
    reordered = {"type": "Polygon", "coordinates": [[[.8, .8], [.8, .2], [.2, .2], [.2, .8], [.8, .8]]]}
    first = preparation.prepare_cached_terrain({"N00E000": source}, ROI, tmp_path / "cache", tile_size=9)
    second = preparation.prepare_cached_terrain({"N00E000": source}, reordered, tmp_path / "cache", tile_size=9)
    assert first.l2_hit is False
    assert second.l2_hit is True and second.l3_hit is True
