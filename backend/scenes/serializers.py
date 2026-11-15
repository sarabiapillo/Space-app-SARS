"""Serializers de la API (contrato C4). Los nombres de campo siguen los tipos C4 del frontend
(``web/src/mocks/c4CatalogMocks.ts``) donde hay dato real; no se inventan los que no existen."""
import json

from rest_framework import serializers

from .models import ROI, Scene, SceneChart, SceneInspection


def geojson(geom):
    return json.loads(geom.geojson) if geom else None


class ROISerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="pk")
    wkt = serializers.SerializerMethodField()
    srid = serializers.IntegerField(source="geom.srid")
    geometry = serializers.SerializerMethodField()

    class Meta:
        model = ROI
        fields = ["id", "name", "wkt", "srid", "geometry"]

    def get_wkt(self, obj):
        return obj.geom.wkt

    def get_geometry(self, obj):
        return geojson(obj.geom)


class InspectionSummarySerializer(serializers.ModelSerializer):
    roi_id = serializers.CharField(source="roi.pk")
    charts = serializers.SerializerMethodField()

    class Meta:
        model = SceneInspection
        fields = ["code_version", "created_utc", "roi_id", "pct_valid_in_roi", "source_dir", "warnings", "charts"]

    def get_charts(self, obj):
        return [c.chart_id for c in obj.charts.all()]


class SceneSerializer(serializers.ModelSerializer):
    scene_id = serializers.CharField(source="name")
    stackId = serializers.SerializerMethodField()
    polarizations = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    has_inspection = serializers.SerializerMethodField()

    class Meta:
        model = Scene
        fields = ["scene_id", "product", "track", "frame", "stackId", "direction", "polarizations", "frequency",
                  "band", "epsg", "crid", "maturity", "start_time", "date", "has_inspection"]

    def get_stackId(self, obj):
        return f"T{obj.track}/F{obj.frame}"

    def get_polarizations(self, obj):
        return [p for p in obj.polarization.split("+") if p]

    def get_date(self, obj):
        return obj.start_time.date().isoformat()

    def get_has_inspection(self, obj):
        return obj.inspections.exists()


class SceneDetailSerializer(SceneSerializer):
    footprint = serializers.SerializerMethodField()
    inspections = InspectionSummarySerializer(many=True, read_only=True)

    class Meta(SceneSerializer.Meta):
        fields = SceneSerializer.Meta.fields + ["footprint", "inspections"]

    def get_footprint(self, obj):
        return geojson(obj.footprint)


class ChartSerializer(serializers.ModelSerializer):
    class Meta:
        model = SceneChart
        fields = ["chart_id", "format_version", "source_file", "data"]
