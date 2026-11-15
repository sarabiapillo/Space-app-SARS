"""Endpoints de solo lectura (contrato C4). Documentados en docs/api.md."""
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ROI, Scene, SceneChart, SceneInspection
from .serializers import ChartSerializer, InspectionSummarySerializer, ROISerializer, SceneDetailSerializer, SceneSerializer

MATURITIES = {"BETA", "PROVISIONAL", "VALIDATED"}


class ROIList(generics.ListAPIView):
    """GET /api/rois"""
    queryset = ROI.objects.order_by("pk")
    serializer_class = ROISerializer


class SceneList(generics.ListAPIView):
    """GET /api/scenes?roi=&track=&frame=&direction=&maturity=&crid="""
    serializer_class = SceneSerializer

    def get_queryset(self):
        qs = Scene.objects.all()
        p = self.request.query_params
        if p.get("roi"):
            roi = ROI.objects.filter(pk=p["roi"]).first() if p["roi"].isdigit() else None
            if roi is None:
                raise ValidationError({"roi": f"No existe la ROI {p['roi']!r} (ver /api/rois)"})
            qs = qs.filter(footprint__intersects=roi.geom)
        for param, field in (("track", "track"), ("frame", "frame")):
            if p.get(param):
                if not p[param].isdigit():
                    raise ValidationError({param: "Debe ser un número entero"})
                qs = qs.filter(**{field: int(p[param])})
        if p.get("maturity"):
            m = p["maturity"].upper()
            if m not in MATURITIES:
                raise ValidationError({"maturity": f"Valores válidos: {sorted(MATURITIES)}"})
            qs = qs.filter(maturity=m)
        if p.get("direction"):
            qs = qs.filter(direction=p["direction"].upper())
        if p.get("crid"):
            qs = qs.filter(crid=p["crid"].upper())
        return qs


class SceneDetail(generics.RetrieveAPIView):
    """GET /api/scenes/{scene_id}"""
    serializer_class = SceneDetailSerializer
    lookup_field = "name"
    lookup_url_kwarg = "scene_id"
    queryset = Scene.objects.prefetch_related(
        Prefetch("inspections", queryset=SceneInspection.objects.select_related("roi").prefetch_related("charts")))


def pick_inspection(scene: Scene, code_version: str | None) -> SceneInspection:
    """La inspección más reciente de la escena, o la de ``code_version`` si se pide."""
    qs = scene.inspections.select_related("roi")
    insp = qs.filter(code_version=code_version).first() if code_version else qs.first()   # ordering: -created_utc
    if insp is None:
        if code_version:
            raise NotFound(f"La escena no tiene una inspección con code_version={code_version!r}")
        raise NotFound("La escena no tiene inspecciones cargadas (python manage.py load_explore)")
    return insp


class SceneCharts(APIView):
    """GET /api/scenes/{scene_id}/charts[?code_version=]"""

    def get(self, request, scene_id):
        scene = get_object_or_404(Scene, name=scene_id)
        insp = pick_inspection(scene, request.query_params.get("code_version"))
        return Response({
            "scene_id": scene.name,
            "inspection": InspectionSummarySerializer(insp).data,
            "charts": ChartSerializer(insp.charts.all(), many=True).data,
        })


class SceneChartDetail(APIView):
    """GET /api/scenes/{scene_id}/charts/{chart_id}[?code_version=]"""

    def get(self, request, scene_id, chart_id):
        scene = get_object_or_404(Scene, name=scene_id)
        insp = pick_inspection(scene, request.query_params.get("code_version"))
        chart = SceneChart.objects.filter(inspection=insp, chart_id=chart_id).first()
        if chart is None:
            raise NotFound(f"No hay gráfica {chart_id!r} en la inspección {insp.code_version}")
        return Response({
            "scene_id": scene.name,
            "code_version": insp.code_version,
            "created_utc": insp.created_utc,
            "warnings": insp.warnings,
            **ChartSerializer(chart).data,
        })
