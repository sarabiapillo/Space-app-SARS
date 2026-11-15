"""Composition helpers for explicitly requested flood-scenario options."""
from collections.abc import Mapping

from pipeline.hydrology.inputs import InputValidationError, normalize_request
from pipeline.hydrology.rainfall import generate_rainfall_profile

_PROFILE_FIELDS = {"interval_count", "seed", "distribution"}


def prepare_rainfall_profile(payload):
    """Normalize the legacy scenario and add an explicitly configured profile."""
    if not isinstance(payload, Mapping):
        # Preserve the established body-type validation and field identity.
        normalize_request(payload)
    if set(payload) - {"rainfall", "roi", "rainfall_profile"}:
        raise InputValidationError({"request": ["Se requieren únicamente los campos rainfall, roi y rainfall_profile."]})

    options = payload.get("rainfall_profile")
    if not isinstance(options, Mapping):
        raise InputValidationError({"rainfall_profile": [
            "Debe ser un objeto con exactamente interval_count, seed y distribution."
        ]})
    if set(options) != _PROFILE_FIELDS:
        raise InputValidationError({"rainfall_profile": [
            "Debe contener exactamente interval_count, seed y distribution."
        ]})

    base_payload = {key: payload[key] for key in ("rainfall", "roi") if key in payload}
    normalized = normalize_request(base_payload)
    try:
        profile = generate_rainfall_profile(
            base_payload,
            interval_count=options["interval_count"],
            seed=options["seed"],
            distribution=options["distribution"],
        )
    except InputValidationError:
        raise
    except ValueError as exc:
        raise InputValidationError({"rainfall_profile": [str(exc)]}) from exc
    return normalized, profile
