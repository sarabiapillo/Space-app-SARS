"""Capas listas para la interfaz web (Explorador / Comparador) a partir de un raster en dB.

Por cada capa escribe dos archivos y una entrada del manifiesto ``capas.json``:

- ``<id>.tif``: Cloud Optimized GeoTIFF (COG) en la proyección del producto (UTM), float32 en dB,
  NaN como nodata. Es el archivo que debe servir TiTiler (contrato C5) y del que se leen valores.
- ``<id>.png``: imagen RGBA en EPSG:3857 (la proyección de MapLibre), gris con la escala del
  manifiesto y transparencia donde no hay dato. Se usa como fuente ``image`` de MapLibre con las
  cuatro esquinas de ``esquinas_lonlat``. Al estar ya en Web Mercator, no se deforma en el mapa.

Los PNG son solo para ver: **nunca** se calculan diferencias sobre ellos (AGENTS.md §5). Los
números están en el COG.

Escala: para comparar dos fechas con el deslizador antes/después, ambas imágenes deben usar la
MISMA escala en dB. Por defecto se usan los percentiles 2–98 de la escena (común a todas las
polarizaciones de una magnitud); para un par, fijarla con ``--escala-web VMIN VMAX``.
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import rasterio
import rasterio.errors
from rasterio import shutil as rio_shutil
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform as warp_transform

WEB_CRS = "EPSG:3857"
MANIFEST_VERSION = "explore-web-1"


def _rel(p: Path, root: Path) -> str:
    p = Path(p).resolve()
    return p.relative_to(root).as_posix() if p.is_relative_to(root) else p.as_posix()


def percentile_scale(arrays: list[np.ndarray], lo: float = 2, hi: float = 98) -> tuple[float, float]:
    vals = np.concatenate([a[np.isfinite(a)].ravel() for a in arrays])
    if vals.size == 0:
        raise ValueError("No hay píxeles válidos para calcular la escala.")
    vmin, vmax = (float(v) for v in np.percentile(vals, [lo, hi]))
    return vmin, vmax


def write_cog(path: Path, arr: np.ndarray, crs: str, transform, tags: dict) -> None:
    """COG float32 con nodata NaN. Las vistas reducidas usan vecino más cercano: no promedian dB."""
    profile = dict(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype="float32",
                   crs=crs, transform=transform, nodata=np.nan)
    with MemoryFile() as mem:
        with mem.open(**profile) as tmp:
            tmp.write(arr.astype("float32"), 1)
            tmp.update_tags(**{k: str(v) for k, v in tags.items()})
        with mem.open() as src:
            rio_shutil.copy(src, path, driver="COG", compress="DEFLATE", predictor=3, blocksize=512,
                            overview_resampling="nearest")


def to_web_mercator(arr: np.ndarray, crs: str, transform) -> tuple[np.ndarray, object]:
    """Reproyecta a EPSG:3857 por vecino más cercano (no inventa valores intermedios)."""
    h, w = arr.shape
    left, top = transform @ (0, 0)
    right, bottom = transform @ (w, h)
    dst_t, dw, dh = calculate_default_transform(crs, WEB_CRS, w, h, left=left, bottom=bottom, right=right, top=top)
    out = np.full((dh, dw), np.nan, dtype="float32")
    reproject(arr.astype("float32"), out, src_transform=transform, src_crs=crs, src_nodata=np.nan,
              dst_transform=dst_t, dst_crs=WEB_CRS, dst_nodata=np.nan, resampling=Resampling.nearest)
    return out, dst_t


def corners_lonlat(transform, shape) -> list[list[float]]:
    """Esquinas en el orden de MapLibre (``image`` source): sup-izq, sup-der, inf-der, inf-izq."""
    h, w = shape
    xs, ys = zip(*(transform @ (c, r) for c, r in ((0, 0), (w, 0), (w, h), (0, h))))
    lons, lats = warp_transform(WEB_CRS, "EPSG:4326", list(xs), list(ys))
    return [[round(lo, 7), round(la, 7)] for lo, la in zip(lons, lats)]


def write_png(path: Path, arr: np.ndarray, vmin: float, vmax: float) -> None:
    """Gris lineal en dB entre vmin y vmax (recortado), alfa 0 donde no hay dato."""
    ok = np.isfinite(arr)
    t = np.clip((np.where(ok, arr, vmin) - vmin) / (vmax - vmin), 0, 1)
    gray = np.round(t * 255).astype("uint8")
    alpha = np.where(ok, 255, 0).astype("uint8")
    with warnings.catch_warnings(), MemoryFile() as mem:
        # El PNG no lleva georreferencia: su ubicación son las esquinas del manifiesto.
        warnings.simplefilter("ignore", rasterio.errors.NotGeoreferencedWarning)
        with mem.open(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=4, dtype="uint8") as tmp:
            tmp.write(np.stack([gray, gray, gray, alpha]))
        with mem.open() as src:
            rio_shutil.copy(src, path, driver="PNG")
    aux = Path(str(path) + ".aux.xml")          # GDAL a veces deja un .aux.xml; no le sirve a la web
    if aux.exists():
        aux.unlink()


def export_layer(out_dir: Path, layer_id: str, arr_db: np.ndarray, crs: str, transform, vmin: float, vmax: float,
                 tags: dict, root: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    cog = out_dir / f"{layer_id}.tif"
    png = out_dir / f"{layer_id}.png"
    write_cog(cog, arr_db, crs, transform, tags)
    merc, merc_t = to_web_mercator(arr_db, crs, transform)
    write_png(png, merc, vmin, vmax)
    finite = arr_db[np.isfinite(arr_db)]
    return {
        "id": layer_id,
        "cog": _rel(cog, root),
        "png": _rel(png, root),
        "crs_cog": crs,
        "crs_png": WEB_CRS,
        "forma_cog": list(arr_db.shape),
        "forma_png": list(merc.shape),
        "esquinas_lonlat": corners_lonlat(merc_t, merc.shape),
        "unidades": "dB",
        "escala": {"vmin_dB": vmin, "vmax_dB": vmax, "colormap": "gray"},
        "rango_datos_dB": [float(finite.min()), float(finite.max())] if finite.size else None,
        "pct_pixeles_validos": 100 * float(finite.size) / arr_db.size,
    }


def write_manifest(path: Path, manifest: dict) -> None:
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
