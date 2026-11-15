from collections.abc import Mapping
from json import JSONDecodeError, loads

from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from pipeline.hydrology.inputs import InputValidationError, normalize_request
from pipeline.hydrology.scenario import prepare_rainfall_profile


class UniqueFieldsJSONParser(JSONParser):
    """Reject repeated JSON object keys instead of silently accepting the last one."""
    def parse(self, stream, media_type=None, parser_context=None):
        try:
            return loads(stream.read(), object_pairs_hook=self._unique_object)
        except (JSONDecodeError, UnicodeDecodeError, RecursionError) as exc:
            raise ParseError(f"JSON parse error - {exc}") from exc

    @staticmethod
    def _unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ParseError("JSON contiene una clave duplicada.")
            result[key] = value
        return result


class FloodScenarioPrepareView(APIView):
    parser_classes = [UniqueFieldsJSONParser]

    def post(self, request):
        profile = None
        try:
            if isinstance(request.data, Mapping) and "rainfall_profile" in request.data:
                normalized, profile = prepare_rainfall_profile(request.data)
            else:
                normalized = normalize_request(request.data)
        except InputValidationError as exc:
            return Response({"errors": exc.errors}, status=400)
        blockers = [
            "No hay ejecutable DG2 verificado (versión, formatos y opciones pendientes).",
            "Condiciones iniciales y nivel de agua pendientes.",
            "Fronteras y criterios científicos pendientes.",
            "Elegibilidad no urbana de la ROI y del dominio hidráulico pendiente.",
            "Distribución espacial y temporal de la lluvia pendiente; la intensidad media derivada no la define.",
            "Infiltración no especificada ni supuesta.",
            "El DEM no se ha adquirido ni preparado como insumo hidráulico.",
        ]
        if profile is not None:
            blockers[4] = (
                "El perfil temporal de lluvia es sintético y no validado; "
                "la distribución espacial aún está pendiente."
            )
        response = {
            **normalized,
            "can_simulate": False,
            "layers": [],
            "dem": {"status": "acquisition_not_requested", "provider_available": True},
            "blockers": blockers,
        }
        if profile is not None:
            response["rainfall_profile"] = profile
        return Response(response)


class FloodScenarioSimulateView(APIView):
    parser_classes = [UniqueFieldsJSONParser]

    def post(self, request):
        try:
            data_to_normalize = {k: v for k, v in request.data.items() if k in ("rainfall", "roi")}
            normalized = normalize_request(data_to_normalize)
        except InputValidationError as exc:
            return Response({"errors": exc.errors}, status=400)

        rainfall = normalized.get("rainfall", {})
        amount_m = rainfall.get("amount_m", 0.025)
        duration_s = rainfall.get("duration_s", 7200.0)
        rainfall_mm = amount_m * 1000.0
        duration_hours = max(0.1, duration_s / 3600.0)
        roi = normalized.get("roi")
        try:
            pressure_hpa = float(request.data.get("pressure_hpa", 1013.25))
        except (ValueError, TypeError):
            pressure_hpa = 1013.25

        try:
            from .simulate import compute_topographic_flood
            result = compute_topographic_flood(roi, rainfall_mm, duration_hours, pressure_hpa=pressure_hpa)
            return Response(result, status=200)
        except Exception as exc:
            return Response(
                {"error": f"Error en cálculo topográfico hidrodinámico: {exc}", "details": str(exc)},
                status=500,
            )

