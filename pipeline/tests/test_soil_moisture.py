"""Antecedent soil moisture (NISAR SME2, fallback SMAP L4) -> Curve Number AMC. No network: search/reader injected."""
from datetime import datetime, timedelta, timezone

import h5py
import numpy as np
import pytest

from pipeline.hydrology import soil_moisture as sm

BOUNDS = (-93.12, 16.74, -93.11, 16.75)
EVENT = "2026-10-15T03:30:00Z"
EVENT_DT = datetime(2026, 10, 15, 3, 30, tzinfo=timezone.utc)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _sme2_granule(days_before, *, track="062"):
    begin = EVENT_DT - timedelta(days=days_before)
    stamp = begin.strftime("%Y%m%dT%H%M%S")
    gid = f"NISAR_L3_PR_SME2_033_{track}_A_010_4005_DHDH_A_{stamp}_{stamp}_P05023_N_F_J_001"
    return {"id": gid, "begin": _iso(begin), "end": _iso(begin + timedelta(seconds=35)), "url": f"https://x/{gid}.h5"}


def _smap_granule(hours_before_end):
    end = EVENT_DT - timedelta(hours=hours_before_end)
    begin = end - timedelta(hours=3)
    gid = f"SMAP_L4_SM_gph_{(begin + timedelta(minutes=90)).strftime('%Y%m%dT%H%M%S')}_Vv8013_001.h5"
    return {"id": gid, "begin": _iso(begin), "end": _iso(end), "url": f"https://x/{gid}"}


def _sme2_window(theta, quality=None):
    theta = np.asarray(theta, dtype=np.float32)
    quality = np.zeros(theta.shape, dtype=np.int16) if quality is None else np.asarray(quality, dtype=np.int16)
    return {"soil_moisture": theta, "quality": quality, "transform": None, "crs": "EPSG:6933",
            "attributes": {"crid": "P05023", "product_version": "1.0.11", "doi": "10.5067/NIL3SME2-P1"}}


def _smap_window(theta, wetness):
    return {"soil_moisture": np.asarray(theta, dtype=np.float32), "wetness": np.asarray(wetness, dtype=np.float32),
            "transform": None, "crs": "EPSG:6933", "attributes": {}}


class Fake:
    """Injected search/reader that records calls."""

    def __init__(self, granules, windows, *, fail=()):
        self.granules, self.windows, self.fail = granules, windows, set(fail)
        self.searched, self.read = [], []

    def search(self, short_name, bounds, start, end):
        self.searched.append((short_name, start, end))
        if short_name in self.fail:
            raise RuntimeError(f"search failed for {short_name}")
        return list(self.granules.get(short_name, []))

    def reader(self, short_name, granule, bounds):
        self.read.append(granule["id"])
        return self.windows[granule["id"]]


def _run(fake, **kwargs):
    return sm.antecedent_condition(BOUNDS, EVENT, search=fake.search, reader=fake.reader, **kwargs)


# --- granule choice -------------------------------------------------------------------------------------------

def test_picks_latest_sme2_granule_before_event_within_max_age():
    after = _sme2_granule(-1)          # acquired after the event: not antecedent
    recent = _sme2_granule(2)
    older = _sme2_granule(5)
    stale = _sme2_granule(20)          # beyond max_age_days
    fake = Fake({sm.SME2_SHORT_NAME: [older, after, stale, recent]},
                {g["id"]: _sme2_window([[0.2315, 0.2315]]) for g in (after, recent, older, stale)})
    result = _run(fake, max_age_days=12)
    assert result["source"] == "NISAR SME2"
    assert fake.read == [recent["id"]]
    prov = result["provenance"]
    assert prov["granule_id"] == recent["id"]
    assert prov["age_hours"] == pytest.approx(48.0)
    assert prov["acquisition_start_utc"] == recent["begin"]
    # The search window ends at the event and starts max_age_days before it.
    name, start, end = fake.searched[0]
    assert name == sm.SME2_SHORT_NAME and end == EVENT_DT and start == EVENT_DT - timedelta(days=12)


def test_sme2_granule_without_valid_cells_tries_the_next_older_one():
    recent, older = _sme2_granule(1), _sme2_granule(4)
    fake = Fake({sm.SME2_SHORT_NAME: [recent, older]},
                {recent["id"]: _sme2_window([[-9999.0, -9999.0]]), older["id"]: _sme2_window([[0.3]])})
    result = _run(fake)
    assert result["source"] == "NISAR SME2"
    assert result["provenance"]["granule_id"] == older["id"]
    skipped = [t for t in result["provenance"]["tried"] if t.get("granule_id") == recent["id"]]
    assert skipped and skipped[0]["outcome"] == "no_valid_cells"


def test_falls_back_to_smap_when_sme2_has_no_valid_cells():
    sme2 = _sme2_granule(3)
    smap_late = _smap_granule(-2.5)    # ends after the event: excluded
    smap_ok = _smap_granule(0.5)       # 00:00-03:00 for a 03:30 event
    smap_old = _smap_granule(3.5)
    fake = Fake({sm.SME2_SHORT_NAME: [sme2], sm.SMAP_SHORT_NAME: [smap_old, smap_late, smap_ok]},
                {sme2["id"]: _sme2_window([[-9999.0]]),
                 smap_ok["id"]: _smap_window([[0.35]], [[0.7]]),
                 smap_old["id"]: _smap_window([[0.1]], [[0.2]]),
                 smap_late["id"]: _smap_window([[0.1]], [[0.2]])})
    result = _run(fake)
    assert result["source"] == "SMAP L4"
    assert fake.read == [sme2["id"], smap_ok["id"]]
    assert result["relative_saturation"] == pytest.approx(0.7)
    assert result["amc"] == "III"
    prov = result["provenance"]
    assert prov["short_name"] == sm.SMAP_SHORT_NAME and prov["version"] == sm.SMAP_VERSION
    assert prov["granule_id"] == smap_ok["id"]
    assert prov["granule_file"] == smap_ok["url"].rsplit("/", 1)[-1]
    assert prov["age_hours"] == pytest.approx(0.5)
    assert prov["saturation_variable"] == "sm_surface_wetness"
    assert prov["tried"][0]["source"] == "NISAR SME2" and prov["tried"][0]["outcome"] == "no_valid_cells"


def test_falls_back_to_smap_when_sme2_search_fails():
    smap_ok = _smap_granule(1)
    fake = Fake({sm.SMAP_SHORT_NAME: [smap_ok]}, {smap_ok["id"]: _smap_window([[0.2]], [[0.45]])},
                fail={sm.SME2_SHORT_NAME})
    result = _run(fake)
    assert result["source"] == "SMAP L4"
    assert result["amc"] == "II"
    first = result["provenance"]["tried"][0]
    assert first["outcome"] == "error" and "search failed" in first["reason"]


def test_no_observation_returns_amc_ii_and_says_so():
    fake = Fake({}, {})
    result = _run(fake)
    assert result["amc"] == "II"
    assert result["source"] is None
    assert result["relative_saturation"] is None
    prov = result["provenance"]
    assert "AMC II" in prov["note"] and "no soil moisture" in prov["note"]
    assert [t["source"] for t in prov["tried"]] == ["NISAR SME2", "SMAP L4"]
    assert all(t["outcome"] == "no_granule" for t in prov["tried"])


def test_observations_older_than_max_age_are_ignored():
    stale_sme2 = _sme2_granule(3)
    stale_smap = _smap_granule(30)
    fake = Fake({sm.SME2_SHORT_NAME: [stale_sme2], sm.SMAP_SHORT_NAME: [stale_smap]},
                {stale_sme2["id"]: _sme2_window([[0.4]]), stale_smap["id"]: _smap_window([[0.4]], [[0.9]])})
    result = _run(fake, max_age_days=1)
    assert result["source"] is None and result["amc"] == "II"
    assert fake.read == []


# --- saturation, thresholds and quality -----------------------------------------------------------------------

def test_relative_saturation_divides_by_porosity_and_clips():
    rs = sm.relative_saturation(np.array([0.2315, 0.6, np.nan]), porosity=0.463)
    assert rs[0] == pytest.approx(0.5)
    assert rs[1] == 1.0
    assert np.isnan(rs[2])
    with pytest.raises(ValueError):
        sm.relative_saturation(0.2, porosity=0.0)


def test_thresholds_map_saturation_to_amc():
    assert sm.classify_amc(0.10) == "I"
    assert sm.classify_amc(0.45) == "II"
    assert sm.classify_amc(0.90) == "III"
    dry, wet = sm.DEFAULT_THRESHOLDS
    assert sm.classify_amc(dry) == "II" and sm.classify_amc(wet) == "II"
    assert sm.classify_amc(0.45, thresholds=(0.5, 0.8)) == "I"
    grid = sm.classify_amc(np.array([[0.1, 0.45], [0.9, np.nan]]))
    assert grid.dtype == np.uint8 and grid.tolist() == [[1, 2], [3, 0]]
    for bad in ((0.6, 0.3), (-0.1, 0.5), (0.3, 1.2), (0.3,)):
        with pytest.raises(ValueError):
            sm.classify_amc(0.5, thresholds=bad)


def test_custom_thresholds_and_porosity_reach_the_result():
    g = _sme2_granule(1)
    fake = Fake({sm.SME2_SHORT_NAME: [g]}, {g["id"]: _sme2_window([[0.2]])})
    result = _run(fake, porosity=0.4, thresholds=(0.55, 0.9))
    assert result["relative_saturation"] == pytest.approx(0.5)
    assert result["amc"] == "I"
    assert result["provenance"]["thresholds"]["dry"] == 0.55
    assert result["provenance"]["porosity"]["value"] == 0.4


def test_quality_flag_masks_not_recommended_and_fill_cells():
    # bit 0 = 1 -> not recommended; -9999 -> fill; 2, 12, 14 are recommended (algorithm bits only).
    theta = [[0.2315, 0.4630, 0.4630, 0.2315], [0.2315, -9999.0, 0.2315, 0.2315]]
    quality = [[2, 15, -9999, 12], [14, -9999, 3, 0]]
    g = _sme2_granule(1)
    fake = Fake({sm.SME2_SHORT_NAME: [g]}, {g["id"]: _sme2_window(theta, quality)})
    result = _run(fake)
    prov = result["provenance"]
    assert result["relative_saturation"] == pytest.approx(0.5)     # only the 0.2315 recommended cells count
    assert prov["cells_total"] == 8
    assert prov["cells_valid"] == 4
    assert prov["cells_masked_quality"] == 2                          # flags 15 and 3
    assert prov["cells_fill"] == 2
    assert "least significant bit" in prov["quality_rule"]
    grid = result["grid"]
    assert grid["amc"].tolist() == [[2, 0, 0, 2], [2, 0, 0, 2]]
    loose = sm.antecedent_condition(BOUNDS, EVENT, search=fake.search, reader=fake.reader,
                                    include_not_recommended=True)
    assert loose["provenance"]["cells_valid"] == 6
    assert loose["provenance"]["cells_masked_quality"] == 0


def test_provenance_records_granule_time_age_maturity_and_method():
    g = _sme2_granule(2.5)
    fake = Fake({sm.SME2_SHORT_NAME: [g]}, {g["id"]: _sme2_window([[0.1]])})
    result = _run(fake)
    assert result["amc"] == "I"
    prov = result["provenance"]
    assert prov["short_name"] == sm.SME2_SHORT_NAME
    assert prov["maturity"] == "PROVISIONAL"
    assert prov["crid"] == "P05023"
    assert prov["doi"] == "10.5067/NIL3SME2-P1"
    assert prov["age_hours"] == pytest.approx(60.0)
    assert prov["event_time_utc"] == "2026-10-15T03:30:00Z"
    assert prov["variable"] == "science/LSAR/SME2/grids/soilMoisture"
    assert prov["units"] == "m3/m3"
    assert "Rawls" in prov["porosity"]["source"]
    assert "no published source" in prov["thresholds"]["source"]
    assert "relative saturation" in prov["method"]
    assert prov["hydraulic_accuracy_validated"] is False
    assert any("urban" in w for w in prov["warnings"])


# --- input validation -----------------------------------------------------------------------------------------

def test_rejects_naive_event_time_and_bad_bounds():
    fake = Fake({}, {})
    with pytest.raises(ValueError):
        sm.antecedent_condition(BOUNDS, "2026-10-15T03:30:00", search=fake.search, reader=fake.reader)
    with pytest.raises(ValueError):
        sm.antecedent_condition((-93.11, 16.74, -93.12, 16.75), EVENT, search=fake.search, reader=fake.reader)
    with pytest.raises(ValueError):
        sm.antecedent_condition(BOUNDS, EVENT, max_age_days=0, search=fake.search, reader=fake.reader)


# --- default reader on local HDF5 copies (same layout as the real products) -----------------------------------

def _ease_coords(n, origin, step):
    return origin + step * np.arange(n, dtype=np.float64)


def _ease_xy(lon, lat):
    from rasterio.warp import transform
    xs, ys = transform("EPSG:4326", "EPSG:6933", [lon], [lat])
    return xs[0], ys[0]


def test_default_reader_reads_only_the_sme2_window_from_a_local_file(tmp_path):
    cx, cy = _ease_xy(-93.115, 16.745)
    step = 200.179
    x = _ease_coords(40, cx - 20 * step, step)
    y = _ease_coords(40, cy + 20 * step, -step)
    theta = np.full((40, 40), 0.1, dtype=np.float32)
    theta[14:27, 14:27] = 0.2315        # the domain window (about 5 x 7 cells) lies inside this block
    quality = np.zeros((40, 40), dtype=np.int16)
    g = _sme2_granule(1)
    path = tmp_path / "sme2.h5"
    with h5py.File(path, "w") as f:
        grids = f.create_group("science/LSAR/SME2/grids")
        grids["xCoordinates"], grids["yCoordinates"] = x, y
        grids["soilMoisture"], grids["retrievalQualityFlag"] = theta, quality
        grids["surfaceQualityFlag"] = np.zeros((40, 40), dtype=np.int16)
        ident = f.create_group("science/LSAR/identification")
        ident["granuleId"] = np.bytes_(g["id"])
        ident["compositeReleaseId"] = np.bytes_("P05023")
        ident["productVersion"] = np.bytes_("1.0.11")
        ident["productDoi"] = np.bytes_("10.5067/NIL3SME2-P1")
    g["path"] = str(path)
    window = sm.read_granule(sm.SME2_SHORT_NAME, g, BOUNDS)
    # 0.01 deg (~1.07 km x 1.11 km) over 200 m cells: about 5 x 7 cells (EASE y is stretched), all inside the 0.2315 block.
    assert 4 <= window["soil_moisture"].shape[0] <= 8 and 4 <= window["soil_moisture"].shape[1] <= 8
    assert np.allclose(window["soil_moisture"], 0.2315)
    assert window["attributes"]["crid"] == "P05023"
    assert window["crs"] == "EPSG:6933"
    result = sm.antecedent_condition(BOUNDS, EVENT, search=lambda *a: [g] if a[0] == sm.SME2_SHORT_NAME else [])
    assert result["source"] == "NISAR SME2" and result["relative_saturation"] == pytest.approx(0.5)


def test_default_reader_refuses_a_file_that_is_not_the_catalog_granule(tmp_path):
    g = _sme2_granule(1)
    path = tmp_path / "other.h5"
    with h5py.File(path, "w") as f:
        f.create_group("science/LSAR/identification")["granuleId"] = np.bytes_("SOMETHING_ELSE")
    g["path"] = str(path)
    with pytest.raises(ValueError, match="granule"):
        sm.read_granule(sm.SME2_SHORT_NAME, g, BOUNDS)


def test_default_reader_reads_smap_wetness_window_from_a_local_file(tmp_path):
    cx, cy = _ease_xy(-93.115, 16.745)
    step = 9008.055
    x = _ease_coords(10, cx - 5 * step, step)
    y = _ease_coords(10, cy + 5 * step, -step)
    g = _smap_granule(1)
    path = tmp_path / "smap.h5"
    with h5py.File(path, "w") as f:
        f["x"], f["y"] = x, y
        data = f.create_group("Geophysical_Data")
        data["sm_surface"] = np.full((10, 10), 0.3, dtype=np.float32)
        data["sm_surface_wetness"] = np.full((10, 10), 0.65, dtype=np.float32)
    g["path"] = str(path)
    window = sm.read_granule(sm.SMAP_SHORT_NAME, g, BOUNDS)
    assert window["wetness"].shape == (1, 1)
    assert float(window["wetness"][0, 0]) == pytest.approx(0.65)
