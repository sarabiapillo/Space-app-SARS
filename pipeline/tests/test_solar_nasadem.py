import io
from pathlib import Path
import zipfile
import threading
import time

import pytest

from pipeline.solar.nasadem import NASADEMProvider, validate_hgt_zip


def make_tile_zip(tile="N00E000"):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(f"hgt/{tile}.hgt", b"\x00" * (3601 * 3601 * 2))
    return stream.getvalue()


def cmr_umm_granule(tile="n00e000", version="001"):
    return {
        "meta": {"collection-concept-id": "C2763264762-LPCLOUD"},
        "umm": {
            "GranuleUR": f"NASADEM_HGT_{tile}",
            "CollectionReference": {"ShortName": "NASADEM_HGT", "Version": version},
            "RelatedUrls": [{"URL": f"https://example.invalid/NASADEM_HGT_{tile}.zip", "Type": "GET DATA"}],
        },
    }


def test_cmr_umm_granuleur_is_read(tmp_path, monkeypatch):
    result = cmr_umm_granule("n16w094")
    def download(results, local_path):
        path = Path(local_path) / "NASADEM_HGT_n16w094.zip"
        path.write_bytes(make_tile_zip("N16W094"))
        return [str(path)]
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", download)
    assert NASADEMProvider(tmp_path / "cache").acquire([result]).is_file()


def test_wrong_collection_is_rejected_before_download(tmp_path, monkeypatch):
    result = cmr_umm_granule()
    result["umm"]["CollectionReference"]["ShortName"] = "OTHER"
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("download called"))
    with pytest.raises(ValueError, match="collection"):
        NASADEMProvider(tmp_path / "cache").acquire([result])


def test_wrong_version_is_rejected_before_download(tmp_path, monkeypatch):
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("download called"))
    with pytest.raises(ValueError, match="collection"):
        NASADEMProvider(tmp_path / "cache").acquire([cmr_umm_granule(version="002")])


def test_wrong_tile_archive_is_rejected(tmp_path, monkeypatch):
    result = cmr_umm_granule("n16w094")
    def download(results, local_path):
        path = Path(local_path) / "NASADEM_HGT_n16w094.zip"
        path.write_bytes(make_tile_zip("N00E000"))
        return [str(path)]
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", download)
    with pytest.raises(ValueError, match="identity"):
        NASADEMProvider(tmp_path / "cache").acquire([result])


def test_valid_zip_promoted_and_reused_without_download(tmp_path, monkeypatch):
    payload = make_tile_zip()
    result = cmr_umm_granule()
    calls = []
    def download(results, local_path):
        calls.append(1)
        path = Path(local_path) / "NASADEM_HGT_n00e000.zip"
        path.write_bytes(payload)
        return [str(path)]
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", download)
    provider = NASADEMProvider(tmp_path / "cache")
    assert provider.acquire([result])
    assert provider.acquire([result])
    assert len(calls) == 1


def test_unverifiable_result_does_not_download(tmp_path, monkeypatch):
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("download called"))
    with pytest.raises(ValueError, match="identity"):
        NASADEMProvider(tmp_path / "cache").acquire([object()])


def test_concurrent_identical_requests_download_once(tmp_path, monkeypatch):
    result = cmr_umm_granule()
    calls = []
    def download(results, local_path):
        calls.append(1)
        time.sleep(0.1)
        path = Path(local_path) / "NASADEM_HGT_n00e000.zip"
        path.write_bytes(make_tile_zip())
        return [str(path)]
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", download)
    provider = NASADEMProvider(tmp_path / "cache")
    outputs, errors = [], []
    def run():
        try:
            outputs.append(provider.acquire([result]))
        except Exception as exc:
            errors.append(exc)
    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=10)
    assert not errors
    assert len(outputs) == 2
    assert len(calls) == 1


def test_unverifiable_granule_result_fails_closed(tmp_path):
    malformed = {"umm": {"GranuleUR": "../outside", "CollectionReference": {"ShortName": "NASADEM_HGT", "Version": "001"}}}
    with pytest.raises(ValueError, match="identity"):
        NASADEMProvider(tmp_path / "cache").acquire([malformed])


def test_download_return_outside_staging_rejected_without_moving(tmp_path, monkeypatch):
    outside = tmp_path / "user-owned.zip"
    outside.write_bytes(make_tile_zip())
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", lambda *a, **k: [str(outside)])
    with pytest.raises(ValueError):
        NASADEMProvider(tmp_path / "cache").acquire([cmr_umm_granule()])
    assert outside.is_file()


def test_symlink_cache_target_is_rejected(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    outside = tmp_path / "outside.zip"
    outside.write_bytes(make_tile_zip())
    (cache / "n00e000.zip").symlink_to(outside)
    with pytest.raises(ValueError, match="symlink"):
        NASADEMProvider(cache).acquire([cmr_umm_granule()])
    assert outside.is_file()


def test_corrupt_cache_is_not_overwritten_without_proven_ownership(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    cache.mkdir()
    target = cache / "n00e000.zip"
    target.write_bytes(b"unrelated corrupt bytes")
    monkeypatch.setattr("pipeline.solar.nasadem.earthaccess.download", lambda *a, **k: pytest.fail("must not overwrite"))
    with pytest.raises(ValueError, match="refusing unsafe recovery"):
        NASADEMProvider(cache).acquire([cmr_umm_granule()])
    assert target.read_bytes() == b"unrelated corrupt bytes"


def test_module_import_does_not_require_posix_fcntl():
    import subprocess
    import sys
    code = "import builtins; original = builtins.__import__; " \
           "builtins.__import__ = lambda name, *a, **k: (_ for _ in ()).throw(ImportError()) if name == 'fcntl' else original(name, *a, **k); " \
           "import pipeline.solar.nasadem"
    completed = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr


def test_truncated_or_wrong_shape_zip_is_not_cached():
    with pytest.raises(ValueError):
        validate_hgt_zip(b"not a zip")
    with pytest.raises(ValueError):
        validate_hgt_zip(b"", expected_bytes=2)
