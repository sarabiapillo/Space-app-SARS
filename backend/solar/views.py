"""Public hackathon API: opaque IDs are not private-data authorization."""
import math
import threading
from pathlib import Path

from django.http import FileResponse, JsonResponse
from django.urls import reverse
from pyproj import Transformer
import numpy as np
import rasterio
from rasterio.windows import Window
from rest_framework.decorators import api_view, authentication_classes, permission_classes, parser_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, NotFound

from . import services
from .analysis import ContourTooLarge, contour_geojson, summarize_incident
from .serializers import validate_request

# Bound simultaneous public scans per worker without blocking unrelated sample requests.
_ANALYSIS_SLOTS = threading.BoundedSemaphore(2)


def not_found(request):
    return JsonResponse({'error': 'Unknown solar route or layer', 'code': 'not_found'}, status=404)


def _links(request, run_id, manifest):
    base = reverse('solar-detail', kwargs={'run_id': run_id})
    return {**manifest, 'id': run_id, 'status': 'ready',
            'layers': {'incident': {'preview_url': base + '/preview/incident',
                                    'export_url': base + '/export/incident',
                                     'contours_url': base + '/contours'}},
            'sample_url': base + '/sample'}


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([JSONParser])
def create(request):
    data = validate_request(request.data)
    run_id, scientific = services.simulate(data)
    payload = _links(request, run_id, scientific)
    payload['request'] = {key: data.get(key) for key in ('roi', 'elevation_deg', 'azimuth_deg', 'intensity_percent')}
    payload['request']['pressure_hpa'] = scientific['position']['pressure_hpa']
    payload['request']['pressure_provenance'] = scientific['position']['pressure_provenance']
    payload['request']['reference_provenance'] = scientific['clear_sky'].get('reference_provenance')
    response = Response(payload, status=201)
    response['Location'] = reverse('solar-detail', kwargs={'run_id': run_id})
    return response


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def detail(request, run_id):
    return Response(_links(request, run_id, services.manifest(run_id)))


def _verified_artifact(run_id, filename):
    manifest = services.manifest(run_id)
    path = services.artifact(run_id, filename)
    try:
        services.verify_incident_integrity(manifest, path, filename)
    except (ValueError, OSError):
        raise NotFound() from None
    return path


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def preview(request, run_id):
    path = _verified_artifact(run_id, 'preview.png')
    return FileResponse(path.open('rb'), content_type='image/png')


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def export(request, run_id):
    path = _verified_artifact(run_id, 'incident.tif')
    return FileResponse(path.open('rb'), content_type='image/tiff', as_attachment=True, filename='incident.tif')


def _valid_summary(summary, dni_adjusted=None):
    if not isinstance(summary, dict):
        return False
    stats, histogram = summary.get('statistics'), summary.get('histogram')
    if not isinstance(stats, dict) or not isinstance(histogram, dict):
        return False
    if not {'cell_area', 'cell_area_units'} <= summary.keys():
        return False
    if not {'min', 'max', 'mean', 'median'} <= stats.keys():
        return False
    if summary.get('units') != 'W/m2' or type(summary.get('valid_cells')) is not int or summary['valid_cells'] < 0:
        return False
    def finite_number(value):
        return type(value) in (int, float) and math.isfinite(value)
    if not isinstance(summary.get('resolution'), list) or len(summary['resolution']) != 2 or not all(
            finite_number(value) and value > 0 for value in summary['resolution']):
        return False
    if summary.get('resolution_units') != 'map_units':
        return False
    area = summary.get('cell_area')
    if area is not None and (not finite_number(area) or area <= 0):
        return False
    if summary.get('cell_area_units') not in ('map_units^2', None):
        return False
    values = [stats.get(key) for key in ('min', 'max', 'mean', 'median')]
    if summary['valid_cells'] == 0:
        if any(value is not None for value in values):
            return False
    elif not all(finite_number(value) for value in values) or values[0] > values[1]:
        return False
    if summary['valid_cells'] and (values[0] < 0 or values[1] < 0):
        return False
    if dni_adjusted is not None and (not finite_number(dni_adjusted) or dni_adjusted < 0):
        return False
    if dni_adjusted is not None and summary['valid_cells'] and values[1] > dni_adjusted:
        return False
    edges, counts = histogram.get('bin_edges'), histogram.get('counts')
    if not isinstance(edges, list) or len(edges) != 21 or not all(finite_number(v) for v in edges):
        return False
    if not isinstance(counts, list) or len(counts) != 20 or any(type(v) is not int or v < 0 for v in counts):
        return False
    if any(left > right for left, right in zip(edges, edges[1:])) or sum(counts) != summary['valid_cells']:
        return False
    return True


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def analysis(request, run_id):
    manifest = services.manifest(run_id)
    path = services.artifact(run_id, 'incident.tif')
    if not _ANALYSIS_SLOTS.acquire(blocking=False):
        return Response({'detail': 'Solar analysis busy'}, status=429)
    try:
        try:
            integrity_verified = services.verify_incident_integrity(manifest, path)
        except (ValueError, OSError):
            raise NotFound() from None
        summary = manifest.get('analysis_summary')
        if summary is not None:
            # A plain manifest is not signed: schema/range checks reject implausible data,
            # but cannot authenticate a plausible summary if an attacker rewrites the manifest.
            clear_sky = manifest.get('clear_sky')
            dni_adjusted = clear_sky.get('dni_adjusted_w_m2') if isinstance(clear_sky, dict) else None
            if not _valid_summary(summary, dni_adjusted):
                raise ValidationError('Persisted analysis summary is invalid')
            result = {
                'units': summary['units'], 'valid_cells': summary['valid_cells'],
                'resolution': summary['resolution'], 'resolution_units': summary['resolution_units'],
                'cell_area': summary['cell_area'], 'cell_area_units': summary['cell_area_units'],
                'statistics': {key: summary['statistics'][key] for key in ('min', 'max', 'mean', 'median')},
                'histogram': {key: summary['histogram'][key] for key in ('bin_edges', 'counts')},
            }
        else:
            try:
                result = summarize_incident(path)
            except ValueError:
                raise ValidationError('Raster exceeds analysis limits or is invalid') from None
            except (OSError, rasterio.errors.RasterioError):
                raise NotFound() from None
        clear_sky = manifest.get('clear_sky', {})
        dni_input = clear_sky.get('dni_adjusted_w_m2') if isinstance(clear_sky, dict) else None
        incident_mean = result.get('statistics', {}).get('mean')
        result['dni_clear_sky_w_m2'] = clear_sky.get('dni_clear_sky_w_m2') if isinstance(clear_sky, dict) else None
        result['dni_input_w_m2'] = dni_input
        result['mean_incident_to_dni_ratio'] = (
            incident_mean / dni_input if isinstance(incident_mean, (int, float))
            and isinstance(dni_input, (int, float)) and dni_input > 0 else None
        )
        result['ratio_units'] = 'dimensionless'
        response = Response(result)
        response['X-Artifact-Integrity'] = 'sha256-verified' if integrity_verified else 'unverifiable-legacy'
        return response
    finally:
        _ANALYSIS_SLOTS.release()


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def contours(request, run_id):
    """Return bounded equal-irradiance GeoJSON isolines from the Float32 raster."""
    if not _ANALYSIS_SLOTS.acquire(blocking=False):
        return Response({'detail': 'Solar analysis busy'}, status=429)
    try:
        path = _verified_artifact(run_id, 'incident.tif')
        if set(request.query_params) - {'levels'} or len(request.query_params.getlist('levels')) > 1:
            raise ValidationError('Only one optional levels parameter is supported')
        raw_levels = request.query_params.get('levels')
        levels = None
        if raw_levels is not None:
            try:
                levels = [float(value) for value in raw_levels.split(',')]
            except (TypeError, ValueError):
                raise ValidationError('levels must be comma-separated finite values') from None
            if not 1 <= len(levels) <= 20 or not all(math.isfinite(value) and value >= 0 for value in levels):
                raise ValidationError('levels must contain 1–20 finite nonnegative values')
        try:
            return Response(contour_geojson(path, levels=levels))
        except ContourTooLarge as exc:
            return Response({'detail': str(exc)}, status=413)
        except ValueError as exc:
            raise ValidationError(str(exc)) from None
        except (OSError, rasterio.errors.RasterioError):
            raise NotFound() from None
    finally:
        _ANALYSIS_SLOTS.release()


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def sample(request, run_id):
    path = _verified_artifact(run_id, 'incident.tif')
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
            if bool(np.ma.getmaskarray(pixel)[0, 0]) or not math.isfinite(float(pixel[0, 0])):
                return Response({'value_w_m2': None, 'status': 'nodata'})
            return Response({'value_w_m2': float(pixel[0, 0]), 'status': 'valid'})
    except (OSError, ValueError, OverflowError, rasterio.errors.RasterioError):
        raise NotFound() from None
