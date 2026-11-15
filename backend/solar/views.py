"""Public hackathon API: opaque IDs are not private-data authorization."""
import math
from pathlib import Path

from django.http import FileResponse, JsonResponse
from django.urls import reverse
from pyproj import Transformer
import rasterio
from rasterio.windows import Window
from rest_framework.decorators import api_view, authentication_classes, permission_classes, parser_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, NotFound

from . import services
from .serializers import validate_request


def not_found(request):
    return JsonResponse({'error': 'Unknown solar route or layer', 'code': 'not_found'}, status=404)


def _links(request, run_id, manifest):
    base = reverse('solar-detail', kwargs={'run_id': run_id})
    return {**manifest, 'id': run_id, 'status': 'ready',
            'layers': {'incident': {'preview_url': base + '/preview/incident',
                                    'export_url': base + '/export/incident'}},
            'sample_url': base + '/sample'}


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([JSONParser])
def create(request):
    data = validate_request(request.data)
    run_id, scientific = services.simulate(data)
    payload = _links(request, run_id, scientific)
    payload['request'] = {key: data.get(key) for key in ('roi', 'datetime_local', 'timezone', 'intensity_percent', 'temperature_c', 'pressure_hpa')}
    payload['request']['pressure_hpa'] = scientific['position']['pressure_hpa']
    payload['request']['pressure_provenance'] = scientific['position']['pressure_provenance']
    response = Response(payload, status=201)
    response['Location'] = reverse('solar-detail', kwargs={'run_id': run_id})
    return response


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def detail(request, run_id):
    return Response(_links(request, run_id, services.manifest(run_id)))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def preview(request, run_id):
    services.artifact(run_id, 'run.json')
    path = services.artifact(run_id, 'preview.png')
    return FileResponse(path.open('rb'), content_type='image/png')


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def export(request, run_id):
    services.artifact(run_id, 'run.json')
    path = services.artifact(run_id, 'incident.tif')
    return FileResponse(path.open('rb'), content_type='image/tiff', as_attachment=True, filename='incident.tif')


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def sample(request, run_id):
    services.artifact(run_id, 'run.json')
    path = services.artifact(run_id, 'incident.tif')
    if set(request.query_params) != {'lon', 'lat'} or any(len(request.query_params.getlist(k)) != 1 for k in ('lon', 'lat')):
        raise ValidationError('Expected one lon and one lat')
    try:
        lon, lat = (float(request.query_params[key]) for key in ('lon', 'lat'))
    except (TypeError, ValueError, OverflowError):
        raise ValidationError('Invalid lon or lat') from None
    if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise ValidationError('Invalid WGS84 lon or lat')
    try:
        with rasterio.open(path) as src:
            x, y = Transformer.from_crs('EPSG:4326', src.crs, always_xy=True).transform(lon, lat)
            if not math.isfinite(x) or not math.isfinite(y):
                return Response({'value_w_m2': None, 'status': 'outside_coverage'})
            row, col = src.index(x, y)
            if not (0 <= row < src.height and 0 <= col < src.width):
                return Response({'value_w_m2': None, 'status': 'outside_coverage'})
            pixel = src.read(1, window=Window(col, row, 1, 1), masked=True)
            if bool(pixel.mask[0, 0]) or not math.isfinite(float(pixel[0, 0])):
                return Response({'value_w_m2': None, 'status': 'nodata'})
            return Response({'value_w_m2': float(pixel[0, 0]), 'status': 'valid'})
    except (OSError, ValueError, OverflowError, rasterio.errors.RasterioError):
        raise NotFound() from None
