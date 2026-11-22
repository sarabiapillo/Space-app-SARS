import json
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box, mapping

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

ROI = {"type": "Polygon", "coordinates": [[[0, 0], [.1, 0], [.1, .1], [0, .1], [0, 0]]]}


@override_settings(ROI_GCOV_OUTPUT_ROOT="/virtual/terrapulse-gcov-test")
class GcovApiTests(SimpleTestCase):
    def test_coverage_uses_area_not_degrees_at_high_latitudes(self):
        from scenes.gcov_views import _scene_dict
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="SYNTH_GCOV", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                          start_time="2026-01-01", footprint=mapping(box(0, 60, .1, 70)))
        result = _scene_dict(scene, "POLYGON ((0 60, 0.1 60, 0.1 80, 0 80, 0 60))")
        self.assertGreater(result["coverage_pct"], 55.0)
        self.assertLess(result["coverage_pct"], 75.0)

    def test_filesystem_slot_lock_is_not_stolen_after_elapsed_time(self):
        import os
        from scenes.gcov_views import _try_lock, _unlock
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "slot.lock"
            first = _try_lock(path)
            self.assertIsNotNone(first)
            os.utime(path, (1, 1))
            self.assertIsNone(_try_lock(path))
            _unlock(first)
            second = _try_lock(path)
            self.assertIsNotNone(second)
            _unlock(second)

    def test_coverage_is_catalog_footprint_estimate_not_pixel_coverage(self):
        from scenes.gcov_views import _scene_dict
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="SYNTH_GCOV", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                          start_time="2026-01-01", footprint=mapping(box(0, 0, .05, .1)))
        result = _scene_dict(scene, "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))")
        self.assertEqual(result["coverage_pct"], 50.0)
        self.assertEqual(result["coverage_source"], "catalog_footprint_estimate_equal_area")

    def setUp(self):
        self.client = APIClient()
        self.worker_threads = []

    @patch("scenes.gcov_views._scene_dict")
    @patch("scenes.gcov_views.ASFSource.search")
    def test_default_search_keeps_all_products_from_two_latest_acquisition_dates(self, search, scene_dict):
        from pipeline.sources.base import SceneMeta
        scenes = [
            SceneMeta(scene_id="old", source="asf", product="GCOV", track=1, frame=1,
                      direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                      start_time="2026-01-01T01:00:00Z"),
            SceneMeta(scene_id="recent-a", source="asf", product="GCOV", track=1, frame=1,
                      direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                      start_time="2026-01-03T01:00:00Z"),
            SceneMeta(scene_id="recent-b", source="asf", product="GCOV", track=2, frame=1,
                      direction="DESCENDING", polarizations=(), crid=None, maturity=None,
                      start_time="2026-01-03T12:00:00Z"),
            SceneMeta(scene_id="second-date", source="asf", product="GCOV", track=1, frame=2,
                      direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                      start_time="2026-01-02T01:00:00Z"),
        ]
        search.return_value = scenes
        scene_dict.side_effect = lambda scene, roi: {"scene_id": scene.scene_id,
            "start_time": scene.start_time, "coverage_pct": None}
        from scenes.gcov_views import search_gcov
        result = search_gcov(ROI)
        self.assertEqual({item["scene_id"] for item in result}, {"recent-a", "recent-b", "second-date"})
        search.assert_called_once_with(__import__("pipeline.roi_explore", fromlist=["validate_roi"]).validate_roi(ROI),
                                       "GCOV", start=None, end=None)

    @patch("scenes.gcov_views.ASFSource")
    def test_default_search_does_not_cap_products_before_date_selection(self, source):
        from scenes.gcov_views import search_gcov
        source.return_value.search.return_value = []
        self.assertEqual(search_gcov(ROI), [])
        source.assert_called_once_with(max_results=None)
        source.return_value.search.assert_called_once()
        source.reset_mock()
        self.assertEqual(search_gcov(ROI, start="2026-01-01"), [])
        source.assert_called_once_with(max_results=None)

    @patch("scenes.gcov_views._scene_dict")
    @patch("scenes.gcov_views.ASFSource.search")
    def test_explicit_date_search_is_not_truncated(self, search, scene_dict):
        from pipeline.sources.base import SceneMeta
        scenes = [SceneMeta(scene_id=f"scene-{i}", source="asf", product="GCOV", track=1, frame=1,
                    direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                    start_time=f"2026-01-{i:02d}T01:00:00Z") for i in range(1, 5)]
        search.return_value = scenes
        scene_dict.side_effect = lambda scene, roi: {"scene_id": scene.scene_id,
            "start_time": scene.start_time, "coverage_pct": None}
        from scenes.gcov_views import search_gcov
        result = search_gcov(ROI, start="2026-01-01", end="2026-01-04")
        self.assertEqual(len(result), 4)
        search.assert_called_once_with(__import__("pipeline.roi_explore", fromlist=["validate_roi"]).validate_roi(ROI),
                                       "GCOV", start="2026-01-01", end="2026-01-04")

    @patch("scenes.gcov_views.search_gcov")
    def test_search_returns_metadata_and_intersection_coverage(self, search):
        search.return_value = [{"scene_id": "NISAR_GCOV_TEST", "footprint": ROI, "coverage_pct": 100.0}]
        response = self.client.post("/api/gcov/search", {"roi": ROI}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()["scenes"][0]
        self.assertEqual(result["scene_id"], "NISAR_GCOV_TEST")
        self.assertEqual(result["coverage_pct"], 100.0)
        self.assertFalse(result["downloaded"])

    @patch("scenes.gcov_views.search_gcov")
    def test_search_marks_only_matching_local_roi_and_identity_downloaded(self, search):
        search.return_value = [
            {"scene_id": "LOCAL_SCENE", "footprint": ROI, "polarizations": ["HH"]},
            {"scene_id": "REMOTE_SCENE", "footprint": ROI, "polarizations": ["HH"]},
        ]
        with tempfile.TemporaryDirectory() as temp, override_settings(NISAR_RAW_ROOT=temp):
            from pipeline.sources.base import SceneMeta
            from scenes.gcov_views import _roi_directory
            scene = SceneMeta(scene_id="LOCAL_SCENE", source="asf", product="GCOV", track=1, frame=1,
                              direction="ASCENDING", polarizations=("HH",), crid=None, maturity=None,
                              start_time="2026-01-01")
            subset = _roi_directory(scene.scene_id, "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))")
            subset.parent.mkdir(parents=True)
            self._fake_subset(scene, ROI, Path(temp) / "stage")
            Path(temp, "stage", scene.scene_id).rename(subset)
            response = self.client.post("/api/gcov/search", {"roi": ROI}, format="json")
            results = {item["scene_id"]: item for item in response.json()["scenes"]}
            self.assertTrue(results["LOCAL_SCENE"]["downloaded"])
            self.assertFalse(results["REMOTE_SCENE"]["downloaded"])
            self.assertNotIn("path", results["LOCAL_SCENE"])

    @patch("scenes.gcov_views.search_gcov")
    def test_search_requires_matching_roi_and_handles_malformed_local_metadata(self, search):
        search.return_value = [{"scene_id": "LOCAL_SCENE", "footprint": ROI}]
        with tempfile.TemporaryDirectory() as temp, override_settings(NISAR_RAW_ROOT=temp):
            legacy = Path(temp, "LOCAL_SCENE")
            legacy.mkdir()
            (legacy / "scene.json").write_text("not json", encoding="utf-8")
            response = self.client.post("/api/gcov/search", {"roi": ROI}, format="json")
            self.assertFalse(response.json()["scenes"][0]["downloaded"])

    @patch("pipeline.download.get_source")
    def test_download_pipeline_uses_already_validated_scene_for_roi_subset(self, get_source):
        from pipeline.download import download_roi_scene
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="NISAR_GCOV_TEST", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=("HH", "HV"), crid=None, maturity=None,
                          start_time="2026-01-01")
        source = get_source.return_value
        source.fetch_subsets.return_value = ["subset.tif"]
        self.assertEqual(download_roi_scene(scene, ROI, Path("safe-output")), ["subset.tif"])
        source.search.assert_not_called()
        source.fetch_subsets.assert_called_once()
        self.assertEqual(source.fetch_subsets.call_args.args[2], ("HHHH", "HVHV", "mask", "numberOfLooks", "rtcGammaToSigmaFactor"))
        bad_scene = SceneMeta(scene_id="bad", source="asf", product="GSLC", track=1, frame=1,
                              direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                              start_time="2026-01-01")
        with self.assertRaises(ValueError):
            download_roi_scene(bad_scene, ROI, Path("safe-output"))
        no_pols = SceneMeta(scene_id="empty", source="asf", product="GCOV", track=1, frame=1,
                            direction="ASCENDING", polarizations=(), crid=None, maturity=None,
                            start_time="2026-01-01")
        with self.assertRaisesRegex(ValueError, "no informa polarizaciones"):
            download_roi_scene(no_pols, ROI, Path("safe-output"))

    def _run_worker_thread(self, fn, *args):
        thread = threading.Thread(target=fn, args=args)
        self.worker_threads.append(thread)
        thread.start()
        return thread

    def _join_workers(self):
        for thread in self.worker_threads:
            thread.join(timeout=10)
            if thread.is_alive():
                self.fail("download worker did not finish")

    def _fake_subset(self, scene, roi, out_dir, valid=True):
        folder = Path(out_dir) / scene.scene_id
        folder.mkdir(parents=True)
        if valid:
            layer = "HHHH" if scene.polarizations == ("HH",) else "HVHV" if scene.polarizations == ("HV",) else "HHHH"
            with rasterio.open(folder / f"{layer}.tif", "w", driver="GTiff", height=1, width=1,
                               count=1, dtype="uint8", crs="EPSG:4326", transform=from_origin(0, .1, .1, .1)) as raster:
                raster.write(np.ones((1, 1), dtype="uint8"), 1)
            metadata = {"contrato": "C1", "scene": {"scene_id": scene.scene_id},
                        "identificacion_h5": {"granuleId": scene.scene_id},
                        "roi": {"wkt": "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))", "crs": "EPSG:4326"},
                        "malla": {"forma_recorte": [1, 1], "epsg": 4326,
                                  "transform_recorte": [0.1, 0.0, 0.0, 0.0, -0.1, 0.1]},
                        "capas": {layer: {"archivo": f"{layer}.tif"}},
                        "procedencia": {"fuente": "synthetic"}, "code_version": "test"}
            (folder / "scene.json").write_text(json.dumps(metadata), encoding="utf-8")
        return [folder / f"{layer}.tif"]

    def test_validation_rejects_incomplete_c1_metadata(self):
        from scenes.gcov_views import _local_subset_available, _validated_subset
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="SYNTH_GCOV", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=("HH",), crid=None, maturity=None,
                          start_time="2026-01-01")
        with tempfile.TemporaryDirectory() as temp, override_settings(NISAR_RAW_ROOT=temp):
            folder = Path(self._fake_subset(scene, ROI, temp)[0]).parent
            metadata_path = folder / "scene.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata.pop("procedencia")
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "C1"):
                _validated_subset(folder, scene.scene_id,
                    "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))", scene)
            self.assertFalse(_local_subset_available(scene.scene_id,
                "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))", scene))

    def test_validation_requires_only_declared_scene_polarizations(self):
        from scenes.gcov_views import _validated_subset
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="SYNTH_GCOV", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=("HH",), crid=None, maturity=None,
                          start_time="2026-01-01")
        with tempfile.TemporaryDirectory() as temp:
            self._fake_subset(scene, ROI, temp)
            self.assertEqual(_validated_subset(Path(temp) / scene.scene_id, scene.scene_id,
                "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))", scene), ["scene.json", "HHHH.tif"])
            with self.assertRaisesRegex(ValueError, "polarización"):
                _validated_subset(Path(temp) / scene.scene_id, scene.scene_id,
                    "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))", SceneMeta(scene_id="SYNTH_GCOV", source="asf", product="GCOV", track=1, frame=1,
                    direction="ASCENDING", polarizations=("HV",), crid=None, maturity=None, start_time="2026-01-01"))

    def test_download_job_publishes_verified_roi_subset_and_reuses_it(self):
        from scenes.gcov_views import _validated_subset
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="NISAR_GCOV_TEST", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=("HH",), crid="P1", maturity="PROVISIONAL",
                          start_time="2026-01-01")
        with tempfile.TemporaryDirectory() as temp:
            jobs, raw = Path(temp) / "jobs", Path(temp) / "raw"
            probe = raw / "probe"
            self._fake_subset(scene, ROI, probe)
            self.assertEqual(_validated_subset(probe / scene.scene_id, scene.scene_id,
                                               "POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))"),
                             ["scene.json", "HHHH.tif"])
            with override_settings(ROI_GCOV_OUTPUT_ROOT=jobs, NISAR_RAW_ROOT=raw), \
                 patch("scenes.gcov_views.ASFSource.search", return_value=[scene]) as search, \
                 patch("pipeline.download.download_roi_scene", side_effect=self._fake_subset) as download, \
                 patch("scenes.gcov_views.POOL.submit", side_effect=self._run_worker_thread):
                accepted = self.client.post("/api/gcov/downloads", {"scene_id": scene.scene_id, "roi": ROI}, format="json")
                job_id = accepted.json()["job_id"]
                self._join_workers()
                status = self.client.get(f"/api/gcov/downloads/{job_id}").json()
                self.assertEqual(status["status"], "ready")
                self.assertTrue(status["path"].startswith(f"data/raw/{scene.scene_id}/roi-"))
                self.assertEqual(status["files"], ["scene.json", "HHHH.tif"])
                self.assertTrue((raw / status["path"].removeprefix("data/raw/") / "HHHH.tif").is_file())
                self.assertFalse((raw / ".gcov-staging" / job_id).exists())
                self.assertEqual(download.call_count, 1)
                self.assertEqual(search.call_count, 1)
                again = self.client.post("/api/gcov/downloads", {"scene_id": scene.scene_id, "roi": ROI}, format="json")
                self.assertEqual(again.json()["job_id"], job_id)
                self._join_workers()
                status = self.client.get(f"/api/gcov/downloads/{job_id}").json()
                self.assertTrue(status["already_present"])
                self.assertEqual(download.call_count, 1)
                self.assertEqual(search.call_count, 2)

    def test_incomplete_subset_never_becomes_ready_and_staging_is_cleaned(self):
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="NISAR_GCOV_TEST", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=("HH",), crid="P1", maturity="PROVISIONAL",
                          start_time="2026-01-01")
        with tempfile.TemporaryDirectory() as temp:
            jobs, raw = Path(temp) / "jobs", Path(temp) / "raw"
            with override_settings(ROI_GCOV_OUTPUT_ROOT=jobs, NISAR_RAW_ROOT=raw), \
                 patch("scenes.gcov_views.ASFSource.search", return_value=[scene]), \
                 patch("pipeline.download.download_roi_scene", side_effect=lambda s, r, p: self._fake_subset(s, r, p, valid=False)), \
                 patch("scenes.gcov_views.POOL.submit", side_effect=self._run_worker_thread):
                accepted = self.client.post("/api/gcov/downloads", {"scene_id": scene.scene_id, "roi": ROI}, format="json")
                self._join_workers()
                status = self.client.get(f"/api/gcov/downloads/{accepted.json()['job_id']}").json()
                self.assertEqual(status["status"], "error")
                self.assertNotIn("path", status)
                self.assertFalse((raw / scene.scene_id).exists())
                self.assertFalse((raw / ".gcov-staging" / accepted.json()["job_id"]).exists())

    def test_status_write_failure_releases_reservations_and_active_marker(self):
        import hashlib
        from scenes.gcov_views import ACTIVE, LOCK, _try_lock, _unlock
        from pipeline.roi_explore import validate_roi
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="NISAR_GCOV_TEST", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=("HH",), crid="P1", maturity="PROVISIONAL",
                          start_time="2026-01-01")
        with tempfile.TemporaryDirectory() as temp, \
             override_settings(ROI_GCOV_OUTPUT_ROOT=Path(temp) / "jobs", NISAR_RAW_ROOT=Path(temp) / "raw"), \
             patch("scenes.gcov_views.ASFSource.search", return_value=[scene]), \
             patch("scenes.gcov_views.write_json", side_effect=OSError("injected status write failure")):
            job_id = hashlib.sha256(f"{scene.scene_id}|{validate_roi(ROI)}".encode()).hexdigest()
            with self.assertRaises(OSError):
                self.client.post("/api/gcov/downloads", {"scene_id": scene.scene_id, "roi": ROI}, format="json")
            with LOCK:
                self.assertNotIn(job_id, ACTIVE)
            job_lock = _try_lock(Path(temp) / "jobs" / job_id / "reservation.lock")
            slot_lock = _try_lock(Path(temp) / "jobs" / ".active-downloads" / "0.lock")
            self.assertIsNotNone(job_lock)
            self.assertIsNotNone(slot_lock)
            _unlock(job_lock)
            _unlock(slot_lock)

    def test_download_keeps_legacy_scene_and_publishes_roi_scoped_subset(self):
        from pipeline.sources.base import SceneMeta
        scene = SceneMeta(scene_id="NISAR_GCOV_TEST", source="asf", product="GCOV", track=1, frame=1,
                          direction="ASCENDING", polarizations=("HV",), crid="P1", maturity="PROVISIONAL",
                          start_time="2026-01-01")
        with tempfile.TemporaryDirectory() as temp:
            jobs, raw = Path(temp) / "jobs", Path(temp) / "raw"
            legacy = raw / scene.scene_id
            self._fake_subset(scene, ROI, raw / "legacy")
            (raw / "legacy" / scene.scene_id).rename(legacy)
            metadata_path = legacy / "scene.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["roi"]["wkt"] = "POLYGON ((0.2 0, 0.3 0, 0.3 0.1, 0.2 0.1, 0.2 0))"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            original = metadata_path.read_bytes()
            with override_settings(ROI_GCOV_OUTPUT_ROOT=jobs, NISAR_RAW_ROOT=raw), patch("scenes.gcov_views.ASFSource.search", return_value=[scene]), patch("pipeline.download.download_roi_scene", side_effect=self._fake_subset) as download, patch("scenes.gcov_views.POOL.submit", side_effect=self._run_worker_thread):
                accepted = self.client.post("/api/gcov/downloads", {"scene_id": scene.scene_id, "roi": ROI}, format="json")
                self._join_workers()
                status = self.client.get(f"/api/gcov/downloads/{accepted.json()['job_id']}").json()
                self.assertEqual(status["status"], "ready")
                self.assertTrue(status["path"].startswith(f"data/raw/{scene.scene_id}/roi-"))
                self.assertEqual((legacy / "scene.json").read_bytes(), original)
                self.assertTrue((raw / status["path"].removeprefix("data/raw/") / "scene.json").is_file())
                self.assertEqual(download.call_args.args[0].polarizations, ("HV",))

    def test_status_does_not_interrupt_job_marked_active_in_this_process_with_real_lock(self):
        import hashlib
        from scenes.gcov_views import ACTIVE, _try_lock, _unlock
        from pipeline.roi_explore import validate_roi
        with tempfile.TemporaryDirectory() as temp, override_settings(ROI_GCOV_OUTPUT_ROOT=temp):
            job_id = hashlib.sha256(f"NISAR_GCOV_TEST|{validate_roi(ROI)}".encode()).hexdigest()
            job = Path(temp) / job_id
            job.mkdir()
            (job / "status.json").write_text(json.dumps({"status": "running", "progress": "working"}))
            held = _try_lock(job / "reservation.lock")
            self.assertIsNotNone(held)
            with __import__("scenes.gcov_views", fromlist=["LOCK"]).LOCK:
                ACTIVE.add(job_id)
            try:
                response = self.client.get(f"/api/gcov/downloads/{job_id}")
                self.assertEqual(response.json()["status"], "running")
            finally:
                with __import__("scenes.gcov_views", fromlist=["LOCK"]).LOCK:
                    ACTIVE.discard(job_id)
                _unlock(held)

    def test_orphaned_queued_job_is_terminal_and_resubmittable(self):
        from scenes.gcov_views import _try_lock, _unlock
        with tempfile.TemporaryDirectory() as temp, override_settings(ROI_GCOV_OUTPUT_ROOT=temp):
            import hashlib
            from shapely.geometry import shape
            from pipeline.roi_explore import validate_roi
            roi_wkt = validate_roi(ROI)
            job_id = hashlib.sha256(f"NISAR_GCOV_TEST|{roi_wkt}".encode()).hexdigest()
            job = Path(temp) / job_id
            job.mkdir()
            (job / "status.json").write_text(json.dumps({"status": "queued", "progress": "queued"}))
            held = _try_lock(job / "reservation.lock")
            _unlock(held)
            status = self.client.get(f"/api/gcov/downloads/{job_id}").json()
            self.assertEqual(status["status"], "error")
            self.assertTrue(status["resubmittable"])

    @patch("scenes.gcov_views.search_gcov", return_value=[])
    def test_empty_search_is_valid_and_calendar_dates_are_strict(self, search):
        response = self.client.post("/api/gcov/search", {"roi": ROI, "start": "2026-02-30"}, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/gcov/search", {"roi": ROI, "start": "2026-02-28"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["scenes"], [])

    def test_large_roi_is_rejected(self):
        large = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
        response = self.client.post("/api/gcov/search", {"roi": large}, format="json")
        self.assertEqual(response.status_code, 400)

    @patch("scenes.gcov_views.ASFSource.search")
    def test_download_rejects_an_identifier_not_returned_by_exact_asf_search(self, search):
        from pipeline.sources.base import SceneMeta
        search.return_value = [SceneMeta(scene_id="NISAR_GCOV_TEST", source="asf", product="GCOV",
            track=1, frame=1, direction="ASCENDING", polarizations=(), crid=None,
            maturity=None, start_time="2026-01-01")]
        response = self.client.post("/api/gcov/downloads", {"scene_id": "FAKE", "roi": ROI}, format="json")
        self.assertEqual(response.status_code, 404)
