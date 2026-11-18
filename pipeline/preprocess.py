"""Preparación de un recorte GCOV (contrato C1) para el mapa de cambio (AGENTS.md §6, paso 5).

Entrada: ``data/raw/<scene_id>/`` con ``scene.json`` y un GeoTIFF por capa (potencia lineal tal
como viene en el producto, sin dB ni máscara; ver ``pipeline/download.py``).

Pasos, en este orden (cada uno se documenta en el JSON del resultado):

1. Máscara de calidad del producto: ``mask`` = 0 (no válido) o 255 (fuera de la adquisición) → NaN.
2. Magnitud: GCOV entrega γ⁰ (RTC, normalizado por terreno). Por defecto se usa γ⁰. Con
   ``magnitude="sigma0"`` se multiplica por ``rtcGammaToSigmaFactor`` (σ⁰ = γ⁰ · factor).
3. Polígono de la ROI: el recorte es el rectángulo que la contiene; fuera del polígono → NaN.
4. Reducción de speckle: multilook n×n como **promedio de potencia lineal** (nunca de dB).
   La malla de salida es n veces más gruesa (p. ej. 10 m → 50 m con n = 5).
5. dB: 10·log10(potencia). Valores ≤ 0 → NaN.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from shapely import wkt as shapely_wkt
from shapely.geometry import mapping

from . import nisar_h5 as nh
from .sources.base import SceneMeta

MAGNITUDES = ("gamma0", "sigma0")


@dataclass
class SceneData:
    """Recorte C1 en disco: metadatos y acceso a sus capas."""

    path: Path
    contract: dict
    meta: SceneMeta
    crs: str
    transform: Affine
    shape: tuple[int, int]

    @property
    def grid(self) -> dict:
        return self.contract["malla"]

    @property
    def magnitude(self) -> str:
        return self.grid.get("magnitud_potencia")

    def read(self, layer: str) -> np.ndarray:
        info = self.contract["capas"].get(layer)
        if info is None:
            raise KeyError(f"{self.path.name}: la capa {layer!r} no está en scene.json")
        with rasterio.open(self.path / info["archivo"]) as src:
            return src.read(1)


def load_scene(scene_dir: Path) -> SceneData:
    scene_dir = Path(scene_dir)
    f = scene_dir / "scene.json"
    if not f.exists():
        raise FileNotFoundError(f"No existe {f}: recortar primero con `python -m pipeline.download`.")
    contract = json.loads(f.read_text(encoding="utf-8"))
    g = contract["malla"]
    shape = tuple(g["forma_recorte"])
    return SceneData(
        path=scene_dir,
        contract=contract,
        meta=SceneMeta.from_dict(contract["scene"]),
        crs=f"EPSG:{g['epsg']}",
        transform=Affine(*g["transform_recorte"][:6]),
        shape=(int(shape[0]), int(shape[1])),
    )


def roi_mask(roi_wkt_4326: str, crs: str, transform: Affine, shape: tuple[int, int]) -> np.ndarray:
    """True en los píxeles cuyo centro cae dentro del polígono ROI (dado en EPSG:4326)."""
    geom = transform_geom("EPSG:4326", crs, mapping(shapely_wkt.loads(roi_wkt_4326)))
    return geometry_mask([geom], out_shape=shape, transform=transform, invert=True)


def prepare_layer(
    power: np.ndarray,
    mask: np.ndarray,
    *,
    looks: int,
    factor: np.ndarray | None = None,
    inside_roi: np.ndarray | None = None,
    min_valid_fraction: float = 0.5,
) -> np.ndarray:
    """Potencia lineal → dB enmascarado y con multilook (ver pasos en el docstring del módulo)."""
    p = np.asarray(power, dtype="float32").copy()
    p[~nh.valid_mask(mask, p)] = np.nan
    if factor is not None:
        p *= factor.astype("float32")
    if inside_roi is not None:
        p[~inside_roi] = np.nan
    return nh.to_db(nh.multilook(p, looks, min_valid_fraction))


def prepare_scene(
    scene: SceneData,
    pol: str,
    roi_wkt_4326: str,
    *,
    looks: int,
    magnitude: str = "gamma0",
    min_valid_fraction: float = 0.5,
) -> np.ndarray:
    """dB de una polarización (``HH`` o ``HV``) de un recorte C1."""
    if magnitude not in MAGNITUDES:
        raise ValueError(f"magnitud {magnitude!r}; usar una de {MAGNITUDES}")
    if scene.magnitude != "gamma0":
        raise ValueError(f"{scene.meta.scene_id}: se esperaba potencia gamma0, scene.json dice {scene.magnitude!r}")
    if pol not in scene.meta.polarizations:
        raise ValueError(f"{scene.meta.scene_id}: no tiene {pol} (tiene {scene.meta.polarizations})")
    factor = scene.read("rtcGammaToSigmaFactor") if magnitude == "sigma0" else None
    inside = roi_mask(roi_wkt_4326, scene.crs, scene.transform, scene.shape)
    if not inside.any():
        raise ValueError(f"{scene.meta.scene_id}: el polígono ROI no cubre ningún píxel del recorte")
    return prepare_layer(scene.read(pol + pol), scene.read("mask"), looks=looks, factor=factor,
                         inside_roi=inside, min_valid_fraction=min_valid_fraction)


def multilook_transform(transform: Affine, looks: int) -> Affine:
    return transform @ Affine.scale(looks)
