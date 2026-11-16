"""Contrato común para cualquier fuente de datos NISAR.

Hoy la fuente es ASF (``asf.py``). En el hackatón se agregará otra fuente con los
recursos que den los organizadores. El resto del pipeline (compat, preprocess,
change, validate) solo depende de ``SceneMeta``, no de la fuente concreta.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class SceneMeta:
    """Metadatos normalizados de una escena, tal como los reporta la fuente.

    Ningún campo se rellena con suposiciones: si la fuente no lo informa, queda en None.
    """

    scene_id: str
    source: str                         # "asf", "event", ...
    product: str                        # GCOV, GSLC, GUNW, ...
    track: int | None
    frame: int | None
    direction: str | None               # ASCENDING | DESCENDING
    polarizations: tuple[str, ...]      # de Frequency A (banda L), leídas del catálogo
    crid: str | None                    # versión de procesamiento
    maturity: str | None                # BETA | PROVISIONAL | VALIDATED
    start_time: str                     # ISO 8601 UTC
    frame_coverage: str | None = None   # Full | Partial
    orbit_type: str | None = None       # p. ej. MOE, FOE
    product_version: str | None = None
    url: str | None = None
    size_bytes: int | None = None
    footprint: dict | None = None
    extra: dict = field(default_factory=dict)

    @property
    def date(self) -> str:
        return self.start_time[:10]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["polarizations"] = list(self.polarizations)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "SceneMeta":
        d = dict(d)
        d["polarizations"] = tuple(d.get("polarizations") or ())
        return cls(**d)


class DataSource(ABC):
    """Interfaz que debe implementar cada fuente de datos."""

    name: str

    @abstractmethod
    def search(
        self,
        roi_wkt: str,
        product: str,
        start: str | None = None,
        end: str | None = None,
    ) -> list[SceneMeta]:
        """Escenas que intersectan la ROI, con metadatos normalizados."""

    @abstractmethod
    def fetch_subset(self, scene: SceneMeta, roi_wkt: str, layer: str, out_dir: Path) -> Path:
        """Recorta ``layer`` (p. ej. HHHH) de la escena a la ROI y devuelve la ruta del GeoTIFF."""

    def fetch_subsets(
        self, scene: SceneMeta, roi_wkt: str, layers, out_dir: Path, local_h5: Path | None = None
    ) -> list[Path]:
        """Varias capas. Las fuentes pueden sobrescribirlo para abrir el archivo una sola vez."""
        if local_h5 is not None:
            raise NotImplementedError(f"La fuente {self.name!r} no admite archivos locales.")
        return [self.fetch_subset(scene, roi_wkt, layer, out_dir) for layer in layers]
