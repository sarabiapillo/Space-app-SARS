"""API autenticada para casos sintéticos DG2 previamente registrados por el operador."""
from pathlib import Path
import hashlib
import os

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pipeline.hydrology.runner import get_run, start_run
from .views import UniqueFieldsJSONParser


def _root():
    root = getattr(settings, 'FLOOD_DG2_RUN_ROOT', None)
    if not root:
        raise ValueError('service unavailable')
    return root


def _owned(request, run_id):
    try:
        run = get_run(_root(), str(run_id))
        if run['owner'] != str(request.user.pk):
            raise Http404
        return run
    except (ValueError, OSError, KeyError, TypeError):
        raise Http404 from None


def _public(run):
    return {key: run[key] for key in ('id', 'case_id', 'state', 'synthetic', 'hydraulic_accuracy_validated', 'simulation_duration_s', 'save_interval_s', 'input_hashes', 'binary_sha256')}


class FloodRunStartView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [UniqueFieldsJSONParser]

    def post(self, request):
        body = request.data
        if not isinstance(body, dict) or set(body) != {'case_id', 'simulation_duration_s'} or not isinstance(body['case_id'], str):
            return Response({'errors': {'request': ['Se requieren exactamente case_id y simulation_duration_s.']}}, status=400)
        cases = getattr(settings, 'FLOOD_DG2_CASES', {})
        executable = getattr(settings, 'FLOOD_DG2_EXECUTABLE', None)
        expected = getattr(settings, 'FLOOD_DG2_BINARY_SHA256', None)
        timeout = getattr(settings, 'FLOOD_DG2_TIMEOUT_S', None)
        try:
            root = _root()
        except ValueError:
            return Response({'errors': {'service': ['Ejecución DG2 no disponible.']}}, status=503)
        if not cases or not executable or not expected or timeout is None:
            return Response({'errors': {'service': ['Ejecución DG2 no disponible.']}}, status=503)
        try:
            run = start_run(str(request.user.pk), body['case_id'], body['simulation_duration_s'], cases,
                            executable, expected, root, timeout)
        except (ValueError, OSError, TypeError, KeyError):
            return Response({'errors': {'request': ['Caso preparado no disponible o entradas inconsistentes.']}}, status=400)
        return Response(_public(run), status=202)


class FloodRunStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id):
        return Response(_public(_owned(request, run_id)))


class FloodRunResultsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id):
        run = _owned(request, run_id)
        if run['state'] != 'succeeded':
            return Response({'errors': {'result': ['Resultado no disponible.']}}, status=409)
        result = dict(run['result'])
        result['artifacts'] = [f'/api/flood-runs/{run_id}/artifacts/{name}/' for name in run['artifacts']]
        return Response(result)


class FloodRunArtifactView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id, artifact):
        run = _owned(request, run_id)
        if run['state'] != 'succeeded' or artifact not in run['artifacts'] or '/' in artifact or '\\' in artifact:
            raise Http404
        path = Path(_root()) / str(run_id) / 'outputs' / artifact
        expected = next((item['source_sha256'] for item in [*run['result']['frames'], run['result']['maximum']] if item['file'] == artifact), None)
        if not expected:
            raise Http404
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            stream = os.fdopen(fd, 'rb')
            if not path.is_file() or path.is_symlink() or not path.parent.is_dir() or path.parent.is_symlink() or hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                stream.close()
                raise Http404
            stream.seek(0)
        except OSError:
            raise Http404 from None
        return FileResponse(stream, as_attachment=True, filename=artifact, content_type='text/plain')
