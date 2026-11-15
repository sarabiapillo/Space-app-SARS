"""Standalone solar HTTP test settings: no secrets file, PostGIS or sessions."""
SECRET_KEY = 'test-only-not-for-deployment'
DEBUG = False
ALLOWED_HOSTS = ['testserver']
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.gis',
    'rest_framework',
    'scenes',
    'solar',
]
MIDDLEWARE = []
ROOT_URLCONF = 'config.urls'
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
REST_FRAMEWORK = {'UNAUTHENTICATED_USER': None}

# En Windows (conda) GeoDjango no encuentra GDAL/GEOS solo; igual que config/settings.py.
import os as _os
import sys as _sys
if _os.name == 'nt':
    GDAL_LIBRARY_PATH = _os.path.join(_sys.prefix, 'Library', 'bin', 'gdal.dll')
    GEOS_LIBRARY_PATH = _os.path.join(_sys.prefix, 'Library', 'bin', 'geos_c.dll')
