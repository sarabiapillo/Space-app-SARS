"""API privada para trabajos ROI DG2; nunca revela el job ni inicia red en HTTP."""
import hashlib
import io
import os
from pathlib import Path
import stat

import numpy as np
from PIL import Image
import rasterio
from rasterio.errors import RasterioError
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_bounds

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pipeline.hydrology.roi_runner import get_roi_run, start_roi_run, validate_config
from .views import UniqueFieldsJSONParser


_FIELDS = ('id', 'state', 'stage', 'simulation_duration_s', 'save_interval_s',
           'synthetic', 'hydraulic_accuracy_validated')
_ERRORS = frozenset(('acquisition_failed', 'preparation_failed', 'preparation_or_output_invalid',
                     'worker_stopped', 'worker_deadline', 'worker_launch_failed',
                     'preparation_timeout', 'solver_timeout'))


def _root():
    root = getattr(settings, 'FLOOD_ROI_DG2_RUN_ROOT', None)
    if not root:
        raise ValueError('service unavailable')
    return root


def _urls(run_id):
    base = f'/api/flood-roi-runs/{run_id}/'
    return {'status_url': base, 'results_url': base + 'results/'}


def _public(run):
    result = {key: run[key] for key in _FIELDS}
    # Runs created before this field existed used the solver default (thin-depth fallback off).
    result['dg2_depth_thresh_m'] = run.get('dg2_depth_thresh_m')
    # Runs created before per-side boundaries existed report null; their request is in job.json.
    result['boundary'] = run.get('boundary')
    result['initial_condition'] = run.get('initial_condition')
    # Infiltration coefficient and barometric surge (null in runs created before they existed).
    result['losses'] = run.get('losses')
    result['lakes'] = run.get('lakes')  # 'none' or 'hydrolakes'; null in older runs
    result.update(_urls(run['id']))
    if run['state'] in ('failed', 'timed_out'):
        result['error'] = run.get('error') if run.get('error') in _ERRORS else 'run_failed'
    return result


def _owned(request, run_id):
    try:
        run = get_roi_run(_root(), str(run_id))
        if run['owner'] != str(request.user.pk) or run['id'] != str(run_id):
            raise Http404
        return run
    except (ValueError, OSError, KeyError, TypeError):
        raise Http404 from None


class RoiRunStartView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [UniqueFieldsJSONParser]

    def post(self, request):
        config = getattr(settings, 'FLOOD_ROI_DG2_CONFIG', None)
        try:
            root = _root()
        except ValueError:
            return Response({'errors': {'service': ['Ejecución ROI DG2 no disponible.']}}, status=503)
        if not config:
            return Response({'errors': {'service': ['Ejecución ROI DG2 no disponible.']}}, status=503)
        try:
            run = start_roi_run(str(request.user.pk), request.data, root=root, config=config)
        except (ValueError, TypeError, KeyError, OverflowError):
            # Configuración inválida no debe diagnosticarse como entrada mala.
            try:
                validate_config(config)
            except (ValueError, TypeError, KeyError, OSError):
                return Response({'errors': {'service': ['Ejecución ROI DG2 no disponible.']}}, status=503)
            return Response({'errors': {'request': ['Solicitud ROI inválida o fuera de presupuesto.']}}, status=400)
        except OSError:
            return Response({'errors': {'service': ['Ejecución ROI DG2 no disponible.']}}, status=503)
        return Response(_public(run), status=202)


class RoiRunStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id):
        return Response(_public(_owned(request, run_id)))


class RoiRunResultsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id):
        run = _owned(request, run_id)
        if run['state'] != 'succeeded':
            return Response({'errors': {'result': ['Resultado no disponible.']}}, status=409)
        try:
            result = {key: run['result'][key] for key in ('grid', 'units', 'frames', 'maximum',
                      'time_axis', 'synthetic', 'hydraulic_accuracy_validated', 'warnings')}
            result['frames'] = [{k: v for k, v in frame.items() if k != 'file'} for frame in result['frames']]
            result['maximum'] = {k: v for k, v in result['maximum'].items() if k != 'file'}
            # Rain-inclusive conservation check; absent (null) for runs summarized before it existed.
            result['mass_balance'] = run['result'].get('mass_balance')
            # Solver-velocity flow arrows (lon, lat, m/s, bearing); null for runs without voutput.
            result['flow'] = run['result'].get('flow')
            # Hydraulic indicators (null in older runs): Froude per frame and Kirpich time of concentration.
            result['froude'] = run['result'].get('froude')
            result['time_of_concentration'] = run['result'].get('time_of_concentration')
            # Road exposure on OpenStreetMap roads (© OpenStreetMap contributors, ODbL); null in older runs.
            result['roads'] = run['result'].get('roads')
            # HydroLAKES lakes started full in this run (HydroLAKES v1.0, CC BY 4.0); null when none.
            result['lakes'] = run['result'].get('lakes')
            # Chart inputs; null for runs summarized before depth classes existed.
            result['depth_classes_m'] = run['result'].get('depth_classes_m')
            # DG2 depths slightly below 0 set to 0 (tolerance, count, frames, minimum); null in older runs.
            result['negative_depth'] = run['result'].get('negative_depth')
            result['rainfall_segments'] = _rainfall_segments(run)
            result['artifacts'] = [_artifact_metadata(item, str(run_id), result['grid']['nodata']) for item in run['artifacts']]
            return Response(result)
        except (KeyError, TypeError, ValueError):
            raise Http404 from None


def _rainfall_segments(run):
    """Synthetic hyetograph from the run provenance, in mm/h; null when it was not recorded."""
    try:
        segments = run['provenance']['rain']['profile']['segments']
        return [{'start_s': float(item['start_s']), 'end_s': float(item['end_s']),
                 'intensity_mm_h': float(item['intensity_m_s']) * 3.6e6} for item in segments]
    except (KeyError, TypeError, ValueError):
        return None


def _artifact_metadata(item, run_id, nodata=None):
    name = Path(item['file']).name
    if item['file'] != 'cogs/' + name or not name.endswith('.tif') or name in ('.', '..'):
        raise ValueError('invalid artifact')
    return {'name': name, 'url': _urls(run_id)['status_url'] + 'artifacts/' + name + '/',
            'sha256': item['sha256'], 'source_sha256': item['source_sha256'],
            'geographic_bounds': item['geographic_bounds'], 'frame_index': item['frame_index'],
            'time_s': None, 'scheduled_time_s': item['scheduled_time_s'], 'nodata': nodata,
            'units': 'm'}


# Límites fijos: no aceptar tamaño o resolución controlados por la petición.
_PREVIEW_MAX_BYTES = 128 * 1024 * 1024
_PREVIEW_MAX_SOURCE_CELLS = 8_000_000
_PREVIEW_MAX_EDGE = 2048
_PREVIEW_MAX_CELLS = 4_000_000
_PREVIEW_PALETTE = 'depth-classes-blues-v2'
# Lower bound (m) and colour of each depth class, light to dark blue; below 0.03 m is transparent.
# Keep in sync with DEPTH_CLASSES in web/src/utils/floodDg2.ts (the map legend).
_DEPTH_CLASSES = [(.03, (198, 219, 239)), (.15, (107, 174, 214)), (.5, (33, 113, 181)),
                  (1.0, (8, 81, 156)), (2.0, (8, 48, 107))]


class RoiRunPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id, artifact):
        run = _owned(request, run_id)
        if run['state'] != 'succeeded' or artifact in ('.', '..') or '/' in artifact or '\\' in artifact:
            raise Http404
        try:
            entry = next(item for item in run['artifacts'] if _artifact_metadata(item, str(run_id))['name'] == artifact)
            path = Path(_root()) / str(run_id) / 'cogs' / artifact
            if path.parent.is_symlink() or path.is_symlink():
                raise Http404
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                details = os.fstat(stream.fileno())
                if not stat.S_ISREG(details.st_mode) or details.st_size > _PREVIEW_MAX_BYTES:
                    raise Http404
                if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                    raise Http404
                stream.seek(0)
                data = stream.read()
        except (StopIteration, OSError, ValueError, KeyError, TypeError):
            raise Http404 from None

        try:
            with MemoryFile(data) as memory, memory.open() as src:
                if (src.count != 1 or src.width < 1 or src.height < 1 or
                    src.width * src.height > _PREVIEW_MAX_SOURCE_CELLS or
                    src.crs is None or src.nodata is None or
                    src.width != run['result']['grid']['shape'][1] or
                    src.height != run['result']['grid']['shape'][0] or
                    str(src.crs) != run['result']['grid']['crs'] or
                    src.nodata != run['result']['grid']['nodata']):
                    raise ValueError('invalid raster')
                transform, source_width, source_height = calculate_default_transform(
                    src.crs, 'EPSG:3857', src.width, src.height, *src.bounds)
                if source_width < 1 or source_height < 1:
                    raise ValueError('invalid dimensions')
                scale = min(1., _PREVIEW_MAX_EDGE / source_width, _PREVIEW_MAX_EDGE / source_height,
                            (_PREVIEW_MAX_CELLS / (source_width * source_height)) ** .5)
                width = max(1, int(source_width * scale))
                height = max(1, int(source_height * scale))
                from affine import Affine
                transform = transform * Affine.scale(source_width / width, source_height / height)
                depth = np.full((height, width), src.nodata, dtype='float32')
                reproject(rasterio.band(src, 1), depth, src_transform=src.transform,
                          src_crs=src.crs, src_nodata=src.nodata, dst_transform=transform,
                          dst_crs='EPSG:3857', dst_nodata=src.nodata, resampling=Resampling.nearest)
                valid = np.zeros((height, width), dtype='uint8')
                reproject(src.read_masks(1), valid, src_transform=src.transform,
                          src_crs=src.crs, dst_transform=transform, dst_crs='EPSG:3857',
                          resampling=Resampling.nearest)
                left, bottom, right, top = rasterio.transform.array_bounds(height, width, transform)
                bounds = transform_bounds('EPSG:3857', 'EPSG:4326', left, bottom, right, top)
                if not all(np.isfinite(bounds)):
                    raise ValueError('invalid bounds')
                rgba = np.zeros((height, width, 4), dtype='uint8')
                for lower, colour in _DEPTH_CLASSES:
                    rgba[depth >= lower, :3] = colour
                rgba[:, :, 3] = np.where((valid > 0) & np.isfinite(depth) &
                                          (depth >= .03) & (depth != src.nodata), 255, 0)
                output = io.BytesIO()
                Image.fromarray(rgba, 'RGBA').save(output, format='PNG')
        except (RasterioError, ValueError, TypeError, KeyError, OverflowError, MemoryError):
            return Response({'errors': {'preview': ['Raster inválido para vista previa.']}}, status=400)
        response = HttpResponse(output.getvalue(), content_type='image/png')
        response['X-Preview-CRS'] = 'EPSG:3857'
        response['X-Preview-Bounds'] = ','.join(str(value) for value in bounds)
        response['X-Preview-Units'] = 'm'
        response['X-Preview-Classes'] = ','.join(format(lower, 'g') for lower, _ in _DEPTH_CLASSES)
        response['Cache-Control'] = 'private, max-age=3600'
        response['ETag'] = '"' + hashlib.sha256((entry['sha256'] + ':' + _PREVIEW_PALETTE).encode()).hexdigest() + '"'
        return response


class RoiRunArtifactView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id, artifact):
        run = _owned(request, run_id)
        if run['state'] != 'succeeded' or artifact in ('.', '..') or '/' in artifact or '\\' in artifact:
            raise Http404
        try:
            entry = next(item for item in run['artifacts'] if _artifact_metadata(item, str(run_id))['name'] == artifact)
            path = Path(_root()) / str(run_id) / 'cogs' / artifact
            if path.parent.is_symlink() or path.is_symlink():
                raise Http404
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            stream = os.fdopen(fd, 'rb')
            details = os.fstat(fd)
            if not stat.S_ISREG(details.st_mode) or hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                stream.close()
                raise Http404
            stream.seek(0)
        except (StopIteration, OSError, ValueError, KeyError, TypeError):
            raise Http404 from None
        response = FileResponse(stream, as_attachment=True, filename=artifact, content_type='image/tiff')
        response['ETag'] = '"' + entry['sha256'] + '"'
        response['Content-Length'] = details.st_size
        return response
