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


def observed_rainfall_profile(roi, segments, source, *, scale=1.0):
    """Profile from an observed rain series (e.g. IMERG): one segment per interval, uniform over the ROI.

    ``segments`` are ``{start_s, end_s, mm}``: contiguous, starting at 0, at most 10,000. ``scale``
    multiplies the rain the solver receives (the runoff coefficient when infiltration is on).
    """
    if not isinstance(segments, list) or not segments or len(segments) > MAX_INTERVALS:
        raise ValueError(f"la serie observada necesita entre 1 y {MAX_INTERVALS} intervalos")
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 0 < scale <= 1:
        raise ValueError("scale debe estar en (0, 1]")
    parsed, previous_end = [], 0.0
    for segment in segments:
        if not isinstance(segment, dict) or set(segment) != {"start_s", "end_s", "mm"}:
            raise ValueError("intervalo observado inválido")
        values = [segment[key] for key in ("start_s", "end_s", "mm")]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
            raise ValueError("intervalo observado inválido")
        start, end, mm = (float(v) for v in values)
        if start != previous_end or end <= start or mm < 0:
            raise ValueError("la serie observada debe empezar en 0, ser contigua y no negativa")
        parsed.append((start, end, mm * scale / 1000.0))
        previous_end = end
    amount = math.fsum(depth for _, _, depth in parsed)
    return {
        "rainfall": {"mode": "observed", "amount_m": amount, "duration_s": previous_end,
                     "mean_intensity_m_s": amount / previous_end},
        "roi": roi,
        "segments": [{"start_s": start, "end_s": end, "intensity_m_s": depth / (end - start)} for start, end, depth in parsed],
        "source": source,
        "scale": float(scale),
        "synthetic": False,
        "observed": True,
        "hydraulic_ready": False,
    }
