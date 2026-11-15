"""API privada para trabajos ROI DG2; nunca revela el job ni inicia red en HTTP."""
import hashlib
import os
from pathlib import Path
import stat

from django.conf import settings
from django.http import FileResponse, Http404
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
            result['artifacts'] = [_artifact_metadata(item, str(run_id), result['grid']['nodata']) for item in run['artifacts']]
            return Response(result)
        except (KeyError, TypeError, ValueError):
            raise Http404 from None


def _artifact_metadata(item, run_id, nodata=None):
    name = Path(item['file']).name
    if item['file'] != 'cogs/' + name or not name.endswith('.tif') or name in ('.', '..'):
        raise ValueError('invalid artifact')
    return {'name': name, 'url': _urls(run_id)['status_url'] + 'artifacts/' + name + '/',
            'sha256': item['sha256'], 'source_sha256': item['source_sha256'],
            'geographic_bounds': item['geographic_bounds'], 'frame_index': item['frame_index'],
            'time_s': None, 'scheduled_time_s': item['scheduled_time_s'], 'nodata': nodata,
            'units': 'm'}


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
