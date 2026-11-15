SECRET_KEY = 'only-for-roi-unit-tests'
INSTALLED_APPS = ['rest_framework']
ROOT_URLCONF = 'scenes.roi_urls'
REST_FRAMEWORK = {'UNAUTHENTICATED_USER': None}
ALLOWED_HOSTS = ['testserver']
