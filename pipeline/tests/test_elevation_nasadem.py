import hashlib
import json
from pathlib import Path
import zipfile

import pytest

from pipeline.elevation.nasadem import NASADEMProvider


def cmr(tile):
    return {"umm": {"GranuleUR": f"NASADEM_HGT_{tile}",
                    "CollectionReference": {"ShortName": "NASADEM_HGT", "Version": "001"}}}


def write_real_shape_zip(path, tile):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{tile}.hgt", b"\0" * (3601 * 3601 * 2))


def configure_roi_download(monkeypatch):
    calls = {"login": [], "search": [], "download": []}

    def login(*, strategy, persist):
        calls["login"].append((strategy, persist))
        return object()

    def search(*, short_name, version, bounding_box):
        calls["search"].append(bounding_box)
        lon, south, *_ = bounding_box
        tile = "n00w001" if lon < 0 else "n00e000"
        assert short_name == "NASADEM_HGT" and version == "001"
        return [cmr(tile)]

    def download(results, local_path):
        tile = results[0]["umm"]["GranuleUR"].removeprefix("NASADEM_HGT_").lower()
        calls["download"].append(tile)
        target = Path(local_path) / f"nasadem_hgt_{tile}.zip"
        write_real_shape_zip(target, tile)
        return [target]

    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", login)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", search)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", download)
    return calls


@pytest.mark.parametrize("roi,tiles", [
    ((-1.0, 0.0, 0.0, 1.0), ["n00w001"]),
    ((-0.25, 0.25, 0.25, 0.75), ["n00w001", "n00e000"]),
    ({"type": "Polygon", "coordinates": [[[-0.5, 0.2], [0.5, 0.2], [0.5, 0.8], [-0.5, 0.8], [-0.5, 0.2]]]}, ["n00w001", "n00e000"]),
])
def test_roi_selects_intersecting_tiles_and_degree_edges(roi, tiles, tmp_path, monkeypatch):
    provider = NASADEMProvider(tmp_path)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: object())
    searches = []
    monkeypatch.setattr(provider, "search", lambda bbox:  searches.append(tuple(bbox)) or [cmr("n00w001"), cmr("n00e000")])
    monkeypatch.setattr(provider, "acquire", lambda results: tmp_path / (results[0]["umm"]["GranuleUR"].lower() + ".zip"))
    records = provider.acquire_roi(roi)
    assert [record.tile_id for record in records] == tiles
    assert [record.granule_ur for record in records] == [f"NASADEM_HGT_{tile}" for tile in tiles]
    assert all(record.path.name.endswith(".zip") for record in records)
    assert len(searches) == len(tiles)


@pytest.mark.parametrize("roi", [
    (float("nan"), 0, 1, 1), (0, 0, 181, 1), (1, 0, -1, 1),
    (0, -57, 1, 0), (0, 0, 1, 61), (0, 0, 1),
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]},
    {"type": "Point", "coordinates": [0, 0]},
])
def test_invalid_roi_rejected_before_search(roi, tmp_path, monkeypatch):
    provider = NASADEMProvider(tmp_path)
    monkeypatch.setattr(provider, "search", lambda *_: pytest.fail("search called"))
    with pytest.raises(ValueError):
        provider.search_roi(roi)


def test_missing_or_ambiguous_cmr_granule_fails_closed(tmp_path, monkeypatch):
    provider = NASADEMProvider(tmp_path)
    monkeypatch.setattr(provider, "search", lambda *_: [])
    with pytest.raises(ValueError, match="missing or ambiguous"):
        provider.search_roi((0.1, 0.1, 0.2, 0.2))
    monkeypatch.setattr(provider, "search", lambda *_: [cmr("n00e000"), cmr("n00e000")])
    with pytest.raises(ValueError, match="missing or ambiguous"):
        provider.search_roi((0.1, 0.1, 0.2, 0.2))


def test_wide_valid_bbox_reaches_cmr_instead_of_artificial_size_rejection(tmp_path, monkeypatch):
    provider = NASADEMProvider(tmp_path)
    searches = []
    monkeypatch.setattr(provider, "search", lambda bbox: searches.append(tuple(bbox)) or [])
    with pytest.raises(ValueError, match="missing or ambiguous"):
        provider.search_roi({"type": "Polygon", "coordinates": [[
            [-120, 0.1], [80, 0.1], [80, 0.2], [-120, 0.2], [-120, 0.1]
        ]]})
    assert searches == [(-120, 0, -119, 1)]
    searches.clear()
    with pytest.raises(ValueError, match="missing or ambiguous"):
        provider.search_roi((-180, -56, 180, 60))
    assert searches == [(-180, -56, -179, -55)]


def test_search_failure_is_clear_without_exception_secrets(tmp_path, monkeypatch):
    provider = NASADEMProvider(tmp_path)
    monkeypatch.setattr(provider, "search", lambda *_: (_ for _ in ()).throw(RuntimeError("password=secret")))
    with pytest.raises(RuntimeError, match="authentication or network") as error:
        provider.search_roi((0.1, 0.1, 0.2, 0.2))
    assert "secret" not in str(error.value)


def test_acquire_roi_authenticates_downloads_all_tiles_and_offline_reuses_cache(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    calls = configure_roi_download(monkeypatch)
    provider = NASADEMProvider(cache)
    roi = (-0.25, 0.25, 0.25, 0.75)

    records = provider.acquire_roi(roi)
    assert [record.tile_id for record in records] == ["n00w001", "n00e000"]
    assert [record.granule_ur for record in records] == ["NASADEM_HGT_n00w001", "NASADEM_HGT_n00e000"]
    assert all(record.path.parent == cache.resolve() and record.path.is_file() for record in records)
    assert calls["login"] == [("environment", False)]
    assert len(calls["search"]) == len(calls["download"]) == 2

    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: pytest.fail("offline cache hit must not authenticate"))
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", lambda **_: pytest.fail("offline cache hit must not search"))
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("cache hit must not download"))
    reused = provider.acquire_roi(roi)
    assert [record.path for record in reused] == [record.path for record in records]


def test_acquire_roi_incomplete_later_tile_fails_without_escaping_cache(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    calls = configure_roi_download(monkeypatch)
    real_download = __import__("pipeline.elevation.nasadem", fromlist=["earthaccess"]).earthaccess.download

    def incomplete(results, local_path):
        if results[0]["umm"]["GranuleUR"].endswith("n00e000"):
            calls["download"].append("incomplete")
            return []
        return real_download(results, local_path)

    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", incomplete)
    with pytest.raises(ValueError, match="complete NASADEM ZIP"):
        NASADEMProvider(cache).acquire_roi((-0.25, 0.25, 0.25, 0.75))
    assert (cache / "n00w001.zip").is_file()
    assert not (cache / "n00e000.zip").exists()
    assert all(path.parent == cache.resolve() for path in cache.glob("*.zip"))


def test_acquire_roi_rejects_download_path_outside_cache_staging(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    outside = tmp_path / "user-owned.zip"
    outside.write_bytes(b"user data")
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: object())
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", lambda **_: [cmr("n00e000")])
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", lambda *a, **k: [outside])
    with pytest.raises(ValueError, match="outside staging"):
        NASADEMProvider(cache).acquire_roi((0.1, 0.1, 0.2, 0.2))
    assert outside.read_bytes() == b"user data"
    assert not (cache / "n00e000.zip").exists()


def seed_unrecorded_zip(cache, tile="n00e000"):
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{tile}.zip"
    write_real_shape_zip(path, tile)
    return path


def test_unrecorded_cache_requires_unique_cmr_match(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    seed_unrecorded_zip(cache)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: object())
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", lambda **_: [])
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("must not download cache hit"))
    with pytest.raises(ValueError, match="missing or ambiguous"):
        NASADEMProvider(cache).acquire_roi((0.1, 0.1, 0.2, 0.2))
    assert not (cache / ".n00e000.cmr.json").exists()


def test_unrecorded_cache_rejects_ambiguous_cmr_match(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    seed_unrecorded_zip(cache)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: object())
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", lambda **_: [cmr("n00e000"), cmr("n00e000")])
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("must not download cache hit"))
    with pytest.raises(ValueError, match="missing or ambiguous"):
        NASADEMProvider(cache).acquire_roi((0.1, 0.1, 0.2, 0.2))


def test_unrecorded_cache_is_cmr_corroborated_then_attested_for_offline_hit(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    zip_path = seed_unrecorded_zip(cache)
    calls = {"search": 0}
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: object())
    def search(**_):
        calls["search"] += 1
        return [cmr("n00e000")]
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", search)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("must not download cache hit"))

    record, = NASADEMProvider(cache).acquire_roi((0.1, 0.1, 0.2, 0.2))
    receipt_path = cache / ".n00e000.cmr.json"
    receipt = json.loads(receipt_path.read_text())
    with zipfile.ZipFile(zip_path) as archive:
        expected_digest = hashlib.sha256(archive.read("n00e000.hgt")).hexdigest()
    assert receipt == {
        "short_name": "NASADEM_HGT", "version": "001",
        "granule_ur": "NASADEM_HGT_n00e000",
        "hgt_sha256": expected_digest,
    }
    assert record.path == zip_path and calls["search"] == 1
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: pytest.fail("verified hit must be offline"))
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", lambda **_: pytest.fail("verified hit must be offline"))
    assert NASADEMProvider(cache).acquire_roi((0.1, 0.1, 0.2, 0.2))[0].path == zip_path


@pytest.mark.parametrize("mutation", ["receipt", "zip"])
def test_verified_cache_fails_closed_after_receipt_or_zip_tamper(tmp_path, monkeypatch, mutation):
    cache = tmp_path / "cache"
    calls = configure_roi_download(monkeypatch)
    NASADEMProvider(cache).acquire_roi((0.1, 0.1, 0.2, 0.2))
    receipt_path = cache / ".n00e000.cmr.json"
    zip_path = cache / "n00e000.zip"
    if mutation == "receipt":
        receipt_path.write_text("{}")
    else:
        zip_path.write_bytes(b"corrupt")
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", lambda **_: pytest.fail("tamper must fail offline"))
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", lambda **_: pytest.fail("tamper must fail offline"))
    with pytest.raises(ValueError, match="corrupt|receipt|cache"):
        NASADEMProvider(cache).acquire_roi((0.1, 0.1, 0.2, 0.2))


def test_acquire_roi_reports_sanitized_noninteractive_auth_failure(tmp_path, monkeypatch):
    calls = []
    def login(*, strategy, persist):
        calls.append((strategy, persist))
        raise RuntimeError("credential=private")
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.login", login)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.search_data", lambda **_: pytest.fail("search after failed auth"))
    with pytest.raises(RuntimeError, match="Earthdata authentication") as error:
        NASADEMProvider(tmp_path / "cache").acquire_roi((0.1, 0.1, 0.2, 0.2))
    assert calls == [("environment", False), ("netrc", False)]
    assert "private" not in str(error.value)


def test_cache_root_symlink_component_is_rejected(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(real, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        NASADEMProvider(alias).acquire([cmr("n00e000")])


def test_earthaccess_failure_is_clear_and_does_not_leak_exception(tmp_path, monkeypatch):
    provider = NASADEMProvider(tmp_path)
    monkeypatch.setattr("pipeline.elevation.nasadem.earthaccess.download", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("token=secret")))
    with pytest.raises(RuntimeError, match="authentication or network") as error:
        provider.acquire([cmr("n00e000")])
    assert "secret" not in str(error.value)
