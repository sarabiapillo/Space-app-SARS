"""Spatial NISAR GCOV discovery and explicitly requested ROI subset jobs."""
import json
import os
import re
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from django.conf import settings
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from pipeline.roi_explore import validate_roi, write_json
from pipeline.sources.asf import ASFSource

ROOT = Path(__file__).resolve().parents[2]
POOL = ThreadPoolExecutor(max_workers=2)
LOCK = threading.Lock()
ACTIVE = set()
SCENE_ID = re.compile(r"^[A-Za-z0-9_]{1,200}$")
MAX_AREA_DEG2 = 0.36
MIN_FREE_BYTES = 2 * 1024**3
DEFAULT_MAX_STORAGE_BYTES = 20 * 1024**3
DEFAULT_MAX_SUBSET_BYTES = 2 * 1024**3


def output_root():
    return Path(getattr(settings, "ROI_GCOV_OUTPUT_ROOT", ROOT / "data" / "gcov-downloads"))


def raw_root():
    return Path(getattr(settings, "NISAR_RAW_ROOT", ROOT / "data" / "raw"))


def _scene_dict(scene, roi_wkt):
    from pyproj import Transformer
    from shapely import wkt
    from shapely.geometry import shape, mapping
    from shapely.ops import transform

    roi = wkt.loads(roi_wkt)
    footprint = scene.footprint
    coverage = None
    intersection = None
    if footprint:
        try:
            geom = shape(footprint)
            if geom.is_valid and not geom.is_empty:
                intersection = geom.intersection(roi)
                projection = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True).transform
                roi_area = transform(projection, roi).area
                coverage = max(0.0, min(100.0, transform(projection, intersection).area / roi_area * 100)) if roi_area else None
        except Exception:
            # Catalog footprints are untrusted; one malformed geometry must not fail the search.
            footprint = None
    return {"scene_id": scene.scene_id, "product": scene.product, "start_time": scene.start_time,
            "date": scene.date, "track": scene.track, "frame": scene.frame,
            "direction": scene.direction, "polarizations": list(scene.polarizations),
            "crid": scene.crid, "maturity": scene.maturity, "size_bytes": scene.size_bytes,
            "frame_coverage": scene.frame_coverage, "footprint": footprint,
            "roi_intersection": mapping(intersection) if intersection and not intersection.is_empty else None,
            "coverage_pct": coverage,
            "coverage_source": "catalog_footprint_estimate_equal_area" if coverage is not None else None}


def _expected_layers(scene):
    polarizations = scene.get("polarizations", ()) if isinstance(scene, dict) else getattr(scene, "polarizations", ())
    return {"HHHH" if pol == "HH" else "HVHV" for pol in (polarizations or ()) if pol in ("HH", "HV")}


def _local_subset_available(scene_id, roi_wkt, scene=None):
    """Cheap local-availability check: C1 identity/ROI and declared file presence only."""
    if not isinstance(scene_id, str) or not SCENE_ID.fullmatch(scene_id):
        return False
    from shapely import wkt

    requested = wkt.loads(roi_wkt)
    candidates = (raw_root() / scene_id, _roi_directory(scene_id, roi_wkt))
    for directory in candidates:
        metadata_path = directory / "scene.json"
        try:
            if not metadata_path.is_file():
                continue
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not _has_c1_metadata(metadata):
                continue
            if (metadata.get("scene") or {}).get("scene_id") != scene_id:
                continue
            roi_meta = metadata.get("roi") or {}
            if roi_meta.get("crs") != "EPSG:4326" or not roi_meta.get("wkt"):
                continue
            if not wkt.loads(roi_meta["wkt"]).equals(requested):
                continue
            layers = metadata.get("capas")
            expected = _expected_layers(scene) if scene is not None else set()
            if not isinstance(layers, dict) or not layers or (expected and (not expected.issubset(layers) or (set(layers) & {"HHHH", "HVHV"}) != expected)):
                continue
            valid = True
            import rasterio
            declared_shape = (metadata.get("malla") or {}).get("forma_recorte")
            for layer in layers.values():
                name = (layer or {}).get("archivo")
                if not isinstance(name, str) or Path(name).name != name or not name.endswith(".tif") or not (directory / name).is_file():
                    valid = False
                    break
                try:
                    with rasterio.open(directory / name) as raster:
                        if raster.count != 1 or (declared_shape and [raster.height, raster.width] != declared_shape):
                            valid = False
                            break
                except Exception:
                    valid = False
                    break
            if valid:
                return True
        except (OSError, ValueError, TypeError, AttributeError, json.JSONDecodeError):
            continue
    return False


def search_gcov(roi, start=None, end=None):
    roi_wkt = validate_roi(roi)
    # An arbitrary product cap could omit the second acquisition date, products
    # on that date, or matching results from an explicitly requested date range.
    source = ASFSource(max_results=None)
    scenes = source.search(roi_wkt, "GCOV", start=start, end=end)
    gcov_scenes = [scene for scene in scenes if scene.product == "GCOV"]
    if start is None and end is None:
        # Acquisition date (not product count/scene ID) is the unit of default recency.
        latest_dates = sorted({scene.date for scene in gcov_scenes}, reverse=True)[:2]
        latest_dates = set(latest_dates)
        gcov_scenes = [scene for scene in gcov_scenes if scene.date in latest_dates]
    results = [_scene_dict(s, roi_wkt) for s in gcov_scenes]
    return sorted(results, key=lambda x: (x["coverage_pct"] is not None, x["coverage_pct"] or -1,
                                          x["start_time"]), reverse=True)


def _try_lock(path):
    """Cross-process advisory lock; the OS releases it on process exit (no age-based theft)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except (OSError, BlockingIOError):
        handle.close()
        return None


def _unlock(handle):
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


def _status_path(job_id):
    if not re.fullmatch(r"[a-f0-9]{64}", job_id):
        raise NotFound()
    path = output_root() / job_id
    if not path.is_dir():
        raise NotFound()
    return path


def _has_c1_metadata(metadata):
    """Return whether metadata contains the complete C1 writer contract."""
    if not isinstance(metadata, dict) or metadata.get("contrato") != "C1":
        return False
    required = ("scene", "identificacion_h5", "roi", "malla", "capas", "procedencia", "code_version")
    if any(not isinstance(metadata.get(key), dict) for key in required if key != "code_version"):
        return False
    if not isinstance(metadata.get("code_version"), str) or not metadata["code_version"]:
        return False
    grid = metadata["malla"]
    return (isinstance(grid.get("forma_recorte"), list) and len(grid["forma_recorte"]) == 2
            and grid.get("epsg") is not None
            and isinstance(grid.get("transform_recorte"), list) and len(grid["transform_recorte"]) >= 6)


def _validated_subset(directory, scene_id, roi_wkt, scene=None):
    """Validate C1 identity, requested ROI, and readable GeoTIFF files before publication."""
    from shapely import wkt

    directory = Path(directory)
    metadata_path = directory / "scene.json"
    if not metadata_path.is_file():
        raise ValueError("Falta scene.json del contrato C1.")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if not _has_c1_metadata(metadata):
        raise ValueError("scene.json no cumple el contrato C1 completo.")
    if (metadata.get("scene") or {}).get("scene_id") != scene_id:
        raise ValueError("La identidad del recorte no coincide.")
    roi_meta = metadata.get("roi") or {}
    if roi_meta.get("crs") != "EPSG:4326" or not roi_meta.get("wkt") or not wkt.loads(roi_meta["wkt"]).equals(wkt.loads(roi_wkt)):
        raise ValueError("La ROI del recorte no coincide con la solicitud.")
    layers = metadata.get("capas")
    if not isinstance(layers, dict) or not layers:
        raise ValueError("El recorte no declara capas C1.")
    expected = _expected_layers(scene) if scene is not None else set()
    if expected and (not expected.issubset(layers) or (set(layers) & {"HHHH", "HVHV"}) != expected):
        raise ValueError("Las capas de polarización C1 no coinciden con las declaradas por ASF.")
    files = ["scene.json"]
    import rasterio
    grid = metadata.get("malla") or {}
    declared_shape = grid.get("forma_recorte")
    reference = None
    for layer in sorted(layers):
        name = (layers[layer] or {}).get("archivo")
        if not isinstance(name, str) or Path(name).name != name or not name.endswith(".tif"):
            raise ValueError("Nombre de capa C1 inválido.")
        raster_path = directory / name
        if not raster_path.is_file() or raster_path.resolve().parent != directory.resolve():
            raise ValueError("Falta un GeoTIFF declarado por C1.")
        with rasterio.open(raster_path) as raster:
            if raster.count != 1 or raster.width < 1 or raster.height < 1 or raster.crs is None:
                raise ValueError("GeoTIFF incompleto o inválido.")
            signature = (raster.width, raster.height, raster.crs, raster.transform)
            if reference is not None and signature != reference:
                raise ValueError("Las capas C1 no comparten la misma malla raster.")
            reference = signature
            if declared_shape and [raster.height, raster.width] != declared_shape:
                raise ValueError("La malla raster no coincide con forma_recorte de C1.")
            if grid.get("epsg") and raster.crs.to_epsg() != grid["epsg"]:
                raise ValueError("El CRS raster no coincide con epsg de C1.")
            declared_transform = grid.get("transform_recorte")
            if declared_transform and any(abs(float(a) - float(b)) > 1e-8 for a, b in zip(tuple(raster.transform)[:6], declared_transform)):
                raise ValueError("La transformación raster no coincide con transform_recorte de C1.")
            # Read every stored block so a truncated/corrupt TIFF cannot be published as ready.
            windows = [window for _, window in raster.block_windows(1)]
            if not windows:
                raise ValueError("GeoTIFF sin bloques de datos.")
            for window in windows:
                raster.read(1, window=window)
        files.append(name)
    return files


def _roi_directory(scene_id, roi_wkt):
    import hashlib
    digest = hashlib.sha256(roi_wkt.encode("utf-8")).hexdigest()[:16]
    return raw_root() / scene_id / f"roi-{digest}"


def _public_status(directory, scene_id, files, already_present=False):
    try:
        relative = Path(directory).resolve().relative_to(raw_root().resolve()).as_posix()
    except ValueError:
        raise ValueError("La ruta del recorte está fuera del almacenamiento permitido.") from None
    return {"status": "ready", "progress": "Recorte verificado y disponible.",
            "scene_id": scene_id, "path": f"data/raw/{relative}", "files": files,
            "already_present": already_present}


def _run_download(path, scene, roi, job_lock, slot_lock):
    stage = raw_root() / ".gcov-staging" / path.name
    raw = raw_root()
    try:
        roi_wkt = validate_roi(roi)
        write_json(path / "status.json", {"status": "running", "progress": "Verificando archivos locales…"})
        legacy_dir = raw / scene.scene_id
        if legacy_dir.exists():
            try:
                files = _validated_subset(legacy_dir, scene.scene_id, roi_wkt, scene)
            except (ValueError, OSError, json.JSONDecodeError):
                files = None
            if files is not None:
                write_json(path / "status.json", _public_status(legacy_dir, scene.scene_id, files, already_present=True))
                return
        final_dir = _roi_directory(scene.scene_id, roi_wkt)
        if final_dir.exists():
            try:
                files = _validated_subset(final_dir, scene.scene_id, roi_wkt, scene)
            except (ValueError, OSError, json.JSONDecodeError):
                write_json(path / "status.json", {"status": "recovery_required", "progress": "El destino existente está dañado; recupéralo manualmente. No se modificaron ni eliminaron archivos."})
                return
            write_json(path / "status.json", _public_status(final_dir, scene.scene_id, files, already_present=True))
            return
        write_json(path / "status.json", {"status": "running", "progress": "Preparando el recorte de la ROI…"})
        stage.parent.mkdir(parents=True, exist_ok=True)
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(parents=True)
        from pipeline.download import download_roi_scene
        write_json(path / "status.json", {"status": "running", "progress": "Leyendo bloques de la escena para la ROI…"})
        download_roi_scene(scene, roi, stage)
        staged_scene = stage / scene.scene_id
        files = _validated_subset(staged_scene, scene.scene_id, roi_wkt, scene)
        write_json(path / "status.json", {"status": "running", "progress": "Publicando el recorte verificado…"})
        final_dir.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.replace(staged_scene, final_dir)
            already_present = False
        except OSError:
            # A concurrent request may have atomically published this exact scene/ROI pair.
            files = _validated_subset(final_dir, scene.scene_id, roi_wkt, scene)
            already_present = True
        write_json(path / "status.json", _public_status(final_dir, scene.scene_id, files, already_present))
    except Exception:
        write_json(path / "status.json", {"status": "error", "progress": "El recorte no se pudo verificar; no se publicó."})
    finally:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
        try:
            stage.parent.rmdir()
        except OSError:
            pass
        with LOCK:
            ACTIVE.discard(path.name)
        _unlock(slot_lock)
        _unlock(job_lock)


class GcovSearch(APIView):
    def post(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError({"detail": "Se requiere un objeto JSON con roi."})
        try:
            roi_wkt = validate_roi(request.data.get("roi"))
            from shapely import wkt
            if wkt.loads(roi_wkt).area > MAX_AREA_DEG2:
                raise ValueError("El área excede el máximo permitido para buscar escenas.")
            start, end = request.data.get("start"), request.data.get("end")
            from datetime import date
            if start:
                if not isinstance(start, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
                    raise ValueError("start debe tener formato YYYY-MM-DD.")
                date.fromisoformat(start)
            if end:
                if not isinstance(end, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
                    raise ValueError("end debe tener formato YYYY-MM-DD.")
                date.fromisoformat(end)
            if start and end and start > end:
                raise ValueError("start no puede ser posterior a end.")
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from None
        try:
            scenes = search_gcov(request.data["roi"], start, end)
        except Exception as exc:
            if isinstance(exc, ValidationError):
                raise
            from rest_framework.exceptions import APIException
            raise APIException("No se pudo consultar el catálogo ASF.") from exc
        for scene in scenes:
            scene["downloaded"] = _local_subset_available(scene.get("scene_id"), roi_wkt, scene)
        return Response({"scenes": scenes, "count": len(scenes),
                         "coverage_note": "La cobertura es una estimación de huellas de catálogo, no de píxeles válidos."})


class GcovDownload(APIView):
    def post(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError({"detail": "Se requiere scene_id y roi."})
        scene_id = request.data.get("scene_id")
        if not isinstance(scene_id, str) or not SCENE_ID.fullmatch(scene_id):
            raise ValidationError({"detail": "scene_id inválido."})
        try:
            roi_wkt = validate_roi(request.data.get("roi"))
            from shapely import wkt
            if wkt.loads(roi_wkt).area > MAX_AREA_DEG2:
                raise ValueError("El área excede el máximo permitido para descargar un recorte.")
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from None
        try:
            matches = [s for s in ASFSource().search(roi_wkt, "GCOV")
                       if s.scene_id == scene_id and s.product == "GCOV"]
        except Exception as exc:
            from rest_framework.exceptions import APIException
            raise APIException("No se pudo validar la escena en el catálogo ASF.") from exc
        if len(matches) != 1:
            raise NotFound("La escena GCOV no existe o no intersecta la ROI.")
        scene = matches[0]
        root = output_root()
        root.mkdir(parents=True, exist_ok=True)
        raw = raw_root()
        raw.mkdir(parents=True, exist_ok=True)
        max_storage = int(getattr(settings, "ROI_GCOV_MAX_STORAGE_BYTES", DEFAULT_MAX_STORAGE_BYTES))
        max_subset = int(getattr(settings, "ROI_GCOV_MAX_SUBSET_BYTES", DEFAULT_MAX_SUBSET_BYTES))
        free_margin = int(getattr(settings, "ROI_GCOV_MIN_FREE_BYTES", MIN_FREE_BYTES))
        used = sum(f.stat().st_size for f in raw.rglob("*") if f.is_file() and ".gcov-staging" not in f.parts)
        if used + 2 * max_subset > max_storage or shutil.disk_usage(raw).free < free_margin + 2 * max_subset:
            return Response({"detail": "Límite de almacenamiento o margen de espacio insuficiente para reservar dos recortes."}, status=507)
        import hashlib
        job_id = hashlib.sha256(f"{scene_id}|{roi_wkt}".encode()).hexdigest()
        path = root / job_id
        path.mkdir(parents=True, exist_ok=True)
        job_lock = _try_lock(path / "reservation.lock")
        if job_lock is None:
            return Response({"job_id": job_id}, status=202)
        with LOCK:
            if job_id in ACTIVE:
                _unlock(job_lock)
                return Response({"job_id": job_id}, status=202)
            slots = root / ".active-downloads"
            slot_lock = None
            for index in range(2):
                slot_lock = _try_lock(slots / f"{index}.lock")
                if slot_lock is not None:
                    break
            if slot_lock is None:
                _unlock(job_lock)
                return Response({"detail": "Ya hay dos recortes en curso; reintenta más tarde."}, status=429)
            ACTIVE.add(job_id)
            try:
                write_json(path / "status.json", {"status": "queued", "progress": "En espera para iniciar el recorte…"})
                POOL.submit(_run_download, path, scene, request.data["roi"], job_lock, slot_lock)
            except Exception:
                ACTIVE.discard(job_id)
                _unlock(slot_lock)
                _unlock(job_lock)
                raise
        return Response({"job_id": job_id}, status=202)


class GcovDownloadStatus(APIView):
    def get(self, request, job_id):
        path = _status_path(job_id)
        status = path / "status.json"
        data = json.loads(status.read_text(encoding="utf-8")) if status.is_file() else {
            "status": "queued", "progress": "Registrando el trabajo…"}
        if data.get("status") in ("queued", "running"):
            # Same-process flock semantics vary; an in-memory active marker is authoritative here.
            with LOCK:
                active_here = job_id in ACTIVE
            lock = None if active_here else _try_lock(path / "reservation.lock")
            if lock is not None:
                _unlock(lock)
                data = {"status": "error", "progress": "El trabajo fue interrumpido; puedes solicitarlo de nuevo.",
                        "resubmittable": True}
                write_json(status, data)
        return Response(data)
