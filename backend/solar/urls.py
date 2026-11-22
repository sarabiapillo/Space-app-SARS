from django.urls import path, re_path
from . import views

urlpatterns = [
    path('simulations', views.create, name='solar-create'),
    re_path(r'^simulations/(?P<run_id>[0-9a-f]{32})$', views.detail, name='solar-detail'),
    re_path(r'^simulations/(?P<run_id>[0-9a-f]{32})/preview/incident$', views.preview, name='solar-preview'),
    re_path(r'^simulations/(?P<run_id>[0-9a-f]{32})/export/incident$', views.export, name='solar-export'),
    re_path(r'^simulations/(?P<run_id>[0-9a-f]{32})/sample$', views.sample, name='solar-sample'),
    re_path(r'^simulations/(?P<run_id>[0-9a-f]{32})/analysis$', views.analysis, name='solar-analysis'),
    re_path(r'^simulations/(?P<run_id>[0-9a-f]{32})/contours$', views.contours, name='solar-contours'),
    re_path(r'^.*$', views.not_found, name='solar-unknown'),
]
