from django.urls import path
from .roi_views import RoiPrepare, RoiStatus, RoiAsset, RoiChange

urlpatterns = [
    path('roi-jobs', RoiPrepare.as_view()),
    path('roi-jobs/<str:job_id>', RoiStatus.as_view()),
    path('roi-jobs/<str:job_id>/change', RoiChange.as_view()),
    path('roi-jobs/<str:job_id>/assets/<path:asset>', RoiAsset.as_view()),
]
