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
