"""Explicit, local NASADEM acquisition adapter; never called by the HTTP endpoint."""
from __future__ import annotations

from pathlib import Path

from pipeline.elevation.nasadem import NASADEMProvider
from pipeline.hydrology.inputs import validate_roi


def get_dem_provider(*, cache_dir: str | Path | None = None, provider=None):
    """Return an injected provider or construct NASADEM for an explicit Python call."""
    if provider is not None:
        return provider
    if cache_dir is None:
        raise ValueError("cache_dir must be supplied for explicit NASADEM acquisition")
    return NASADEMProvider(cache_dir=cache_dir)


def acquire_dem(roi, *, provider=None, cache_dir: str | Path | None = None):
    """Validate the ROI, then acquire its original HGT ZIP records explicitly."""
    validated_roi = validate_roi(roi)
    return get_dem_provider(cache_dir=cache_dir, provider=provider).acquire_roi(validated_roi)
