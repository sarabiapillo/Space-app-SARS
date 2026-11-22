# Recreate the Linux x86_64 conda environment, do not copy a developer's Conda prefix.
# The platform-specific digest pins the micromamba bootstrap image.
FROM mambaorg/micromamba@sha256:07f1a5db3a545a0b1b0b1c8835ba654b67a8479ec77513f2a236f45e6687629b

USER root
WORKDIR /app
COPY infra/solar/conda-linux-64.lock infra/solar/pip.lock /app/infra/solar/
RUN micromamba create -y -n nisar -f /app/infra/solar/conda-linux-64.lock \
    && micromamba run -n nisar python -m pip install --no-deps -r /app/infra/solar/pip.lock \
    && micromamba run -n nisar python -m pip check \
    && micromamba clean --all --yes
COPY backend/ /app/backend/
COPY pipeline/ /app/pipeline/
COPY infra/solar/verify_acapulco.py /app/infra/solar/verify_acapulco.py
# Source and environment are immutable at runtime; only explicit data mounts are writable.
RUN chmod -R a+rX /app
USER 1000:1000
ENV PYTHONPATH=/app:/app/backend \
    DJANGO_SETTINGS_MODULE=config.settings \
    PYTHONDONTWRITEBYTECODE=1 \
    SOLAR_NASADEM_CACHE=/solar-data/nasadem-cache \
    SOLAR_OUTPUT_ROOT=/solar-data/solar-runs
EXPOSE 8000
# Single process: the solar provider uses a filesystem flock and synchronous requests.
CMD ["micromamba", "run", "-n", "nisar", "gunicorn", "config.wsgi:application", "--chdir", "/app/backend", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "1", "--timeout", "180"]
