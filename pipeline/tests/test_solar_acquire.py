import io
import zipfile

import numpy as np
import pytest

from pipeline.solar.acquire import acquire_roi_tiles
from pipeline.solar.dem import prepare_dem


def roi(west, south, east, north):
    return {"type": "Polygon", "coordinates": [[
        [west, south], [east, south], [east, north], [west, north], [west, south]
    ]]}


def granule(tile):
    return {"umm": {"GranuleUR": f"NASADEM_HGT_{tile}",
                    "CollectionReference": {"ShortName": "NASADEM_HGT", "Version": "001"}}}


def tile_zip(tile):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(f"{tile}.hgt", np.ones((5, 5), dtype=">i2").tobytes())
    return stream.getvalue()


class FakeProvider:
    def __init__(self, root, *, missing=()):
        self.root = root
        self.missing = set(missing)
        self.searches = []
        self.downloads = []

    def search(self, bbox):
        self.searches.append(tuple(bbox))
        west, south, _, _ = bbox
        tile = f"{'n' if south >= 0 else 's'}{abs(south):02d}{'e' if west >= 0 else 'w'}{abs(west):03d}"
        return [] if tile in self.missing else [granule(tile)]

    def acquire(self, results):
        assert len(results) == 1
        tile = results[0]["umm"]["GranuleUR"].removeprefix("NASADEM_HGT_")
        self.downloads.append(tile)
        path = self.root / f"{tile}.zip"
        if not path.exists():
            path.write_bytes(tile_zip(tile))
        return path


def test_roi_cache_hit_skips_cmr_and_download_after_first_attestation(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    provider = FakeProvider(cache)
    geometry = roi(1.2, .2, 1.8, .8)
    first = acquire_roi_tiles(geometry, cache, provider=provider, tile_size=5, max_pixels=64)
    assert list(first) == ["N00E001"]
    assert provider.searches == [(1, 0, 2, 1)] and provider.downloads == ["n00e001"]
    assert (cache / ".n00e001.cmr.json").is_file()
    provider.search = lambda *args: pytest.fail("CMR searched on verified cache hit")
    provider.acquire = lambda *args: pytest.fail("download on verified cache hit")
    second = acquire_roi_tiles(geometry, cache, provider=provider, tile_size=5, max_pixels=64)
    assert second == first
    assert prepare_dem(second, geometry, tile_size=5, max_pixels=1000).valid_mask.any()


def test_multitile_roi_acquires_only_required_tiles_and_rejects_missing(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    geometry = roi(.9, .2, 1.1, .8)
    provider = FakeProvider(cache)
    selected = acquire_roi_tiles(geometry, cache, provider=provider, tile_size=5, max_pixels=50)
    assert sorted(selected) == ["N00E000", "N00E001"]
    assert provider.downloads == ["n00e000", "n00e001"]
    assert prepare_dem(selected, geometry, tile_size=5, max_pixels=50).valid_mask.any()
    other = tmp_path / "other"
    other.mkdir()
    absent = FakeProvider(other, missing={"n00e001"})
    with pytest.raises(ValueError, match="granule|coverage"):
        acquire_roi_tiles(geometry, other, provider=absent, tile_size=5, max_pixels=50)
    assert absent.downloads == ["n00e000"] and not (other / "n00e001.zip").exists()


def test_preflight_rejects_unsupported_roi_before_search(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    provider = FakeProvider(cache)
    with pytest.raises(ValueError, match="pixel|resource|tile"):
        acquire_roi_tiles(roi(.9, .2, 1.1, .8), cache, provider=provider, tile_size=5, max_pixels=25)
    with pytest.raises(ValueError, match="coverage"):
        acquire_roi_tiles(roi(1.2, 60, 1.8, 60.1), cache, provider=provider, tile_size=5)
    assert provider.searches == [] and provider.downloads == []


def test_single_tile_mosaic_budget_rejects_before_search(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    provider = FakeProvider(cache)
    with pytest.raises(ValueError, match="mosaic|resource"):
        acquire_roi_tiles(roi(1.1, .1, 1.9, .9), cache, provider=provider,
                          tile_size=5, max_pixels=25)
    assert provider.searches == []


def test_cached_attested_halo_adds_no_extra_search(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    provider = FakeProvider(cache)
    acquire_roi_tiles(roi(2.2, .2, 2.8, .8), cache, provider=provider,
                      tile_size=5, max_pixels=64)
    provider.searches.clear()
    selected = acquire_roi_tiles(roi(1.2, .2, 1.8, .8), cache, provider=provider,
                                 tile_size=5, max_pixels=64)
    assert list(selected) == ["N00E001", "N00E002"]
    assert provider.searches == [(1, 0, 2, 1)]


def test_unattested_local_zip_requires_cmr_once_then_hit(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "n00e001.zip").write_bytes(tile_zip("n00e001"))
    provider = FakeProvider(cache)
    selected = acquire_roi_tiles(roi(1.2, .2, 1.8, .8), cache, provider=provider, tile_size=5, max_pixels=64)
    assert list(selected) == ["N00E001"] and len(provider.searches) == 1
    assert provider.downloads == ["n00e001"]  # provider revalidates the cached ZIP; no overwrite
    assert (cache / ".n00e001.cmr.json").is_file()


def test_corrupt_attested_zip_fails_closed_without_search_or_overwrite(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    provider = FakeProvider(cache)
    geometry = roi(1.2, .2, 1.8, .8)
    acquire_roi_tiles(geometry, cache, provider=provider, tile_size=5, max_pixels=64)
    target = cache / "n00e001.zip"
    target.write_bytes(b"corrupt")
    provider.search = lambda *args: pytest.fail("searched instead of rejecting corrupt cache")
    with pytest.raises(ValueError, match="cache|ZIP|HGT"):
        acquire_roi_tiles(geometry, cache, provider=provider, tile_size=5, max_pixels=64)
    assert target.read_bytes() == b"corrupt"
