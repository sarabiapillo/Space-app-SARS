from django.urls import path

from .views import FloodScenarioPrepareView
from .flood_runs import FloodRunStartView, FloodRunStatusView, FloodRunResultsView, FloodRunArtifactView
from .roi_flood_runs import RoiRunStartView, RoiRunStatusView, RoiRunResultsView, RoiRunArtifactView

urlpatterns = [
    path("flood-scenarios/roi/start/", RoiRunStartView.as_view(), name="flood-roi-start"),
    path("flood-roi-runs/<uuid:run_id>/", RoiRunStatusView.as_view(), name="flood-roi-status"),
    path("flood-roi-runs/<uuid:run_id>/results/", RoiRunResultsView.as_view(), name="flood-roi-results"),
    path("flood-roi-runs/<uuid:run_id>/artifacts/<str:artifact>/", RoiRunArtifactView.as_view(), name="flood-roi-artifact"),
    path("flood-scenarios/prepare/", FloodScenarioPrepareView.as_view(), name="flood-scenario-prepare"),
    path("flood-scenarios/start/", FloodRunStartView.as_view(), name="flood-run-start"),
    path("flood-runs/<uuid:run_id>/", FloodRunStatusView.as_view(), name="flood-run-status"),
    path("flood-runs/<uuid:run_id>/results/", FloodRunResultsView.as_view(), name="flood-run-results"),
    path("flood-runs/<uuid:run_id>/artifacts/<str:artifact>/", FloodRunArtifactView.as_view(), name="flood-run-artifact"),
]
