from django.urls import include, path

from . import views
from .geosearch import LocationSearch, LocationRoi
from .location_suggest import LocationSuggestions
from .gcov_views import GcovSearch, GcovDownload, GcovDownloadStatus

# scene_id es el granuleId completo (solo letras, números y "_"), por eso basta con <str:…>.
urlpatterns = [
    path("locations", LocationSearch.as_view(), name="location-search"),
    path("locations/suggest", LocationSuggestions.as_view(), name="location-suggest"),
    path("locations/roi", LocationRoi.as_view(), name="location-roi"),
    path("gcov/search", GcovSearch.as_view(), name="gcov-search"),
    path("gcov/downloads", GcovDownload.as_view(), name="gcov-download"),
    path("gcov/downloads/<str:job_id>", GcovDownloadStatus.as_view(), name="gcov-download-status"),
    path('', include('scenes.roi_urls')),
    path("rois", views.ROIList.as_view(), name="roi-list"),
    path("scenes", views.SceneList.as_view(), name="scene-list"),
    path("scenes/<str:scene_id>", views.SceneDetail.as_view(), name="scene-detail"),
    path("scenes/<str:scene_id>/charts", views.SceneCharts.as_view(), name="scene-charts"),
    path("scenes/<str:scene_id>/charts/<str:chart_id>", views.SceneChartDetail.as_view(), name="scene-chart-detail"),
]
