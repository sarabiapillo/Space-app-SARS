"""Optional synthetic rainfall profile generator; not a hydraulic model."""
from __future__ import annotations

import math
import random

from pipeline.hydrology.inputs import normalize_request

MAX_INTERVALS = 10_000
_MM_PER_HOUR_TO_M_PER_S = 10.0 / 1000.0 / 3600.0


def generate_rainfall_profile(payload, *, interval_count, seed, distribution):
    """Generate a reproducible, balanced profile across the full requested duration.

    The only supported law is ``uniform_balanced``. Its paired contributions
    preserve the input mean; ``interval_count`` is even and at most 10,000.
    """
    if isinstance(interval_count, bool) or not isinstance(interval_count, int) or interval_count < 2 or interval_count % 2 or interval_count > MAX_INTERVALS:
        raise ValueError(f"interval_count debe ser par entre 2 y {MAX_INTERVALS}.")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed debe ser un entero.")
    if distribution != "uniform_balanced":
        raise ValueError("distribution debe ser 'uniform_balanced'.")

    normalized = normalize_request(payload)
    rainfall = normalized["rainfall"]
    duration = rainfall["duration_s"]
    mean = rainfall["mean_intensity_m_s"]
    step = duration / interval_count
    if not math.isfinite(step) or step <= 0:
        raise ValueError("La duración no puede dividirse en intervalos finitos consistentes.")

    requested_bound = _MM_PER_HOUR_TO_M_PER_S
    bound = min(requested_bound, mean)
    rng = random.Random(seed)
    half = interval_count // 2
    deviations = [rng.uniform(-bound, bound) for _ in range(half)]
    contributions = deviations + [-value for value in deviations]
    rng.shuffle(contributions)
    intensities = [mean + value for value in contributions]
    if any(not math.isfinite(value) or value < 0 for value in intensities):
        raise ValueError("El perfil no produce intensidades finitas y no negativas.")

    segments = []
    for index, intensity in enumerate(intensities):
        start = index * step
        end = duration if index == interval_count - 1 else (index + 1) * step
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            raise ValueError("Los límites temporales no son representables.")
        segments.append({"start_s": start, "end_s": end, "intensity_m_s": intensity})

    return {
        "rainfall": dict(rainfall),
        "roi": normalized["roi"],
        "segments": segments,
        "distribution": {
            "name": distribution,
            "seed": seed,
            "interval_count": interval_count,
            "requested_bound_m_s": requested_bound,
            "effective_bound_m_s": bound,
            "density": "uniform perturbation on [-effective_bound, +effective_bound]; paired opposite contributions",
        },
        "synthetic": True,
        "hydraulic_ready": False,
    }
