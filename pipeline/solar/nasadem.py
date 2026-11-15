"""Compatibility facade for the shared NASADEM provider."""
from pipeline.elevation.nasadem import (
    EXPECTED_HGT_BYTES,
    SHORT_NAME,
    VERSION,
    NASADEMGranule,
    NASADEMProvider,
    earthaccess,
    validate_hgt_zip,
)

__all__ = ["EXPECTED_HGT_BYTES", "SHORT_NAME", "VERSION", "NASADEMGranule", "NASADEMProvider", "earthaccess", "validate_hgt_zip"]
