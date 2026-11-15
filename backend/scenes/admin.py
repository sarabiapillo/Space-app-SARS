from django.contrib.gis import admin

from .models import ROI, Scene, SceneChart, SceneInspection


@admin.register(ROI)
class ROIAdmin(admin.GISModelAdmin):
    list_display = ("name", "created_at")


@admin.register(Scene)
class SceneAdmin(admin.GISModelAdmin):
    list_display = ("name", "start_time", "track", "frame", "direction", "polarization", "crid", "maturity")
    list_filter = ("track", "direction", "crid", "maturity")
    search_fields = ("name",)


class SceneChartInline(admin.TabularInline):
    model = SceneChart
    fields = ("chart_id", "format_version", "source_file")
    readonly_fields = fields
    extra = 0
    can_delete = False


@admin.register(SceneInspection)
class SceneInspectionAdmin(admin.ModelAdmin):
    list_display = ("scene", "code_version", "created_utc", "pct_valid_in_roi", "loaded_at")
    list_filter = ("code_version",)
    inlines = [SceneChartInline]
