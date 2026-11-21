"""API privada para trabajos ROI DG2/FV1; nunca revela el job ni inicia red en HTTP."""
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

from pipeline.hydrology.roi_runner import DatasetUnavailable, get_roi_run, start_roi_run, validate_config
from .views import UniqueFieldsJSONParser


_FIELDS = ('id', 'state', 'stage', 'simulation_duration_s', 'save_interval_s',
           'synthetic', 'hydraulic_accuracy_validated')
_ERRORS = frozenset(('acquisition_failed', 'preparation_failed', 'preparation_or_output_invalid', 'negative_depth_artifacts',
                     'worker_stopped', 'worker_deadline', 'worker_launch_failed',
                     'preparation_timeout', 'solver_timeout',
                     # An open dataset the run needs could not be read (no uniform substitute is used).
                     'landcover_unavailable', 'soils_unavailable', 'soil_moisture_unavailable',
                     # EOT20 / DTUUH22MDT caches missing or no ocean near the tide point; GEBCO window unreadable.
                     'tide_unavailable', 'bathymetry_unavailable'))
# Start-time data errors: answered 503 with this code, the request itself was valid.
_DATASET_MESSAGES = {'design_storm_unavailable': 'Datos de tormenta de diseño (PXR-4) no disponibles en el servidor.'}


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
    # Solver choice with automatic fallback; runs created before it ran DG2 without fallback.
    result['requested_solver'] = run.get('requested_solver', 'dg2')
    result['solver'] = run.get('solver', 'dg2')
    result['solver_fallback'] = run.get('solver_fallback')  # {from, to, reason} or null
    result['solver_attempts'] = run.get('solver_attempts')  # [{solver, outcome, reason}]; null in older runs
    # Runs created before per-side boundaries existed report null; their request is in job.json.
    result['boundary'] = run.get('boundary')
    result['initial_condition'] = run.get('initial_condition')
    # Infiltration coefficient and barometric surge (null in runs created before they existed).
    result['losses'] = run.get('losses')
    result['lakes'] = run.get('lakes')  # 'none' or 'hydrolakes'; null in older runs
    result.update(_land_and_rain(run))
    result.update(_terrain(run))
    result.update(_coast(run))
    result.update(_urls(run['id']))
    if run['state'] in ('failed', 'timed_out'):
        result['error'] = run.get('error') if run.get('error') in _ERRORS else 'run_failed'
    return result


def _terrain(run):
    """Terrain source, vertical datum of every height and the licence notice the source requires.

    Runs created before the terrain choice used NASADEM heights in EGM96, without a required notice."""
    return {'terrain_source': run.get('terrain_source', 'nasadem'),
            'vertical_datum': run.get('vertical_datum', 'EGM96'),
            'terrain_attribution': run.get('terrain_attribution')}


def _coast(run):
    """Tide (EOT20 HVAR series: sides, window, node, levels, attribution) and GEBCO sea-cell summaries.

    Null when the run did not request them (and in runs created before they existed)."""
    return {'tide': run.get('tide'), 'bathymetry': run.get('bathymetry')}


def _land_and_rain(run):
    """Land surface (Manning, Curve Number, antecedent moisture, urban), rain source and design storm.

    Runs created before these options had no land data (null) and synthetic or observed rain."""
    return {'land_surface': run.get('land_surface'),
            'rainfall_source': run.get('rainfall_source', 'synthetic' if run.get('synthetic', True) else 'observed'),
            'design_storm': run.get('design_storm')}


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
        except DatasetUnavailable as exc:
            message = _DATASET_MESSAGES.get(exc.code, 'Datos requeridos no disponibles.')
            return Response({'errors': {'service': [message]}, 'error': exc.code if exc.code in _DATASET_MESSAGES else 'dataset_unavailable'}, status=503)
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            # Configuración inválida no debe diagnosticarse como entrada mala.
            try:
                validate_config(config)
            except (ValueError, TypeError, KeyError, OSError):
                return Response({'errors': {'service': ['Ejecución ROI DG2 no disponible.']}}, status=503)
            # The request validator's ValueError messages describe the payload (e.g. 'cuadros exceden max_frames'),
            # so they are shown to the user; other exception types stay generic.
            reason = str(exc).strip()[:300] if isinstance(exc, ValueError) else ''
            message = 'Solicitud ROI inválida o fuera de presupuesto' + (f': {reason}' if reason else '.')
            return Response({'errors': {'request': [message]}}, status=400)
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
            # Negative depths set to 0 and the volume they add (status none/minor/artifacts); older runs
            # carry the earlier tolerance-based summary, and null before that.
            result['negative_depth'] = run['result'].get('negative_depth')
            # Solver whose results these are and the automatic fallback, if any; older runs ran DG2.
            result['requested_solver'] = run['result'].get('requested_solver', 'dg2')
            result['solver'] = run['result'].get('solver', 'dg2')
            result['solver_fallback'] = run['result'].get('solver_fallback')
            # Terrain source and datum come from the run state (the summary does not repeat them).
            result.update(_terrain(run))
            result.update(_coast(run))
            result.update(_land_and_rain(run))
            result['rainfall_segments'] = _rainfall_segments(run)
            result['artifacts'] = [_artifact_metadata(item, str(run_id), result['grid']['nodata']) for item in run['artifacts']]
            return Response(result)
        except (KeyError, TypeError, ValueError):
            raise Http404 from None


def _rainfall_segments(run):
    """Hyetograph of the rain the solver received, in mm/h; null when it was not recorded.

    Uniform profiles (synthetic, observed, design storm; already x runoff coefficient when on) give their segments;
    Curve Number runs give the ROI-mean net rain per interval (rain.json ``method``)."""
    try:
        method = run['provenance']['rain'].get('method')
        if method is not None:
            edges = method['curve_number']['interval_edges_s']
            return [{'start_s': float(a), 'end_s': float(b), 'intensity_mm_h': float(mm) * 3600 / (float(b) - float(a))}
                    for a, b, mm in zip(edges[:-1], edges[1:], method['roi_mean_net_mm'], strict=True)]
        segments = run['provenance']['rain']['profile']['segments']
        return [{'start_s': float(item['start_s']), 'end_s': float(item['end_s']),
                 'intensity_mm_h': float(item['intensity_m_s']) * 3.6e6} for item in segments]
    except (KeyError, TypeError, ValueError, AttributeError, ZeroDivisionError):
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
_PREVIEW_PALETTE = 'depth-classes-blues-v3'
# Lower bound (m) and colour of each depth class, light to dark blue (ColorBrewer Blues); below 0.01 m is
# transparent. 0.01-0.03 m shows thin sheets of water. Keep in sync with DEPTH_CLASSES in
# web/src/utils/floodDg2.ts (the map legend) and DEPTH_CLASS_BOUNDS_M in pipeline/hydrology/results.py.
_DEPTH_CLASSES = [(.01, (222, 235, 247)), (.03, (198, 219, 239)), (.15, (107, 174, 214)), (.5, (33, 113, 181)),
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
                                          (depth >= _DEPTH_CLASSES[0][0]) & (depth != src.nodata), 255, 0)
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
