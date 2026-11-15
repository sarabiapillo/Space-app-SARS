from django.urls import include, path

from . import views

# scene_id es el granuleId completo (solo letras, números y "_"), por eso basta con <str:…>.
urlpatterns = [
    path('', include('scenes.roi_urls')),
    path("rois", views.ROIList.as_view(), name="roi-list"),
    path("scenes", views.SceneList.as_view(), name="scene-list"),
    path("scenes/<str:scene_id>", views.SceneDetail.as_view(), name="scene-detail"),
    path("scenes/<str:scene_id>/charts", views.SceneCharts.as_view(), name="scene-charts"),
    path("scenes/<str:scene_id>/charts/<str:chart_id>", views.SceneChartDetail.as_view(), name="scene-chart-detail"),
]
