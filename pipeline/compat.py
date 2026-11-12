"""Control de comparabilidad entre dos escenas (AGENTS.md §5).

Dos escenas solo se comparan si coinciden en producto, trayectoria, marco, dirección,
polarización, CRID y madurez. Un campo desconocido (None) cuenta como NO comparable:
no se puede afirmar que coincide lo que no se conoce.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .sources.base import SceneMeta

STRICT_FIELDS = ("product", "track", "frame", "direction", "polarizations", "crid", "maturity")


@dataclass
class CompatReport:
    comparable: bool
    errors: list[str] = field(default_factory=list)     # impiden la comparación
    warnings: list[str] = field(default_factory=list)   # no la impiden, pero se documentan

    def to_dict(self) -> dict:
        return {"comparable": self.comparable, "errors": self.errors, "warnings": self.warnings}


def check_pair(a: SceneMeta, b: SceneMeta) -> CompatReport:
    errors: list[str] = []
    warnings: list[str] = []

    for name in STRICT_FIELDS:
        va, vb = getattr(a, name), getattr(b, name)
        if name == "polarizations":
            va, vb = tuple(sorted(va)), tuple(sorted(vb))
            if not va or not vb:
                errors.append("polarizations: desconocidas en al menos una escena")
                continue
        if va is None or vb is None:
            errors.append(f"{name}: desconocido en al menos una escena ({va!r} vs {vb!r})")
        elif va != vb:
            errors.append(f"{name}: {va!r} vs {vb!r}")

    if a.start_time == b.start_time:
        errors.append("misma adquisición: no hay intervalo temporal que comparar")

    for s in (a, b):
        if s.frame_coverage and s.frame_coverage.lower() != "full":
            warnings.append(f"{s.scene_id}: cobertura de marco {s.frame_coverage}; revisar que cubra la ROI")
    if a.orbit_type != b.orbit_type:
        warnings.append(f"tipo de órbita distinto: {a.orbit_type!r} vs {b.orbit_type!r}")
    if a.product_version != b.product_version:
        warnings.append(f"versión de producto distinta: {a.product_version!r} vs {b.product_version!r}")
    warnings.append("resolución/espaciado de malla no verificado en catálogo: comprobar en el .h5")

    return CompatReport(comparable=not errors, errors=errors, warnings=warnings)


def stack_key(s: SceneMeta) -> tuple:
    """Clave que agrupa escenas potencialmente comparables entre sí."""
    return (s.product, s.track, s.frame, s.direction, tuple(sorted(s.polarizations)), s.crid, s.maturity)
