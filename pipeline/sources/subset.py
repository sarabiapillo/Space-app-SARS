"""Recorte de un producto NISAR L2 (HDF5) a la ROI, independiente de la fuente.

Cada fuente (ASF hoy, la del evento después) solo tiene que abrir el ``.h5`` como un
``h5py.File`` (local o remoto) y llamar a :func:`write_subset`. Se lee únicamente la
ventana rectangular que contiene la ROI (``nisar_h5.roi_window``), así que con un archivo
remoto solo se descargan los bloques (chunks) de esa ventana, no los ~7 GB del producto.

Salida (contrato C1, docs/plan-de-trabajo.md §3):

    <out_dir>/<scene_id>/<capa>.tif   GeoTIFF en el CRS de la escena, valores tal como vienen
                                      en el producto (sin dB, sin máscara aplicada)
    <out_dir>/<scene_id>/scene.json   SceneMeta + identificación leída del archivo + malla,
                                      ventana, capas, cobertura de la ROI y procedencia

Nada se aplica aquí: ni máscara, ni conversión a dB, ni multilook. Eso le toca a
preprocess.py / masks.py (P2). Así el recorte es un espejo fiel de lo que trae el producto.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import h5py
import numpy as np
import rasterio
from rasterio.features import geometry_mask

from .. import nisar_h5 as nh
from .base import SceneMeta

# Capas auxiliares de la malla que se pueden recortar además de las de potencia.
AUX_LAYERS = ("mask", "numberOfLooks", "rtcGammaToSigmaFactor")
LAYER_DESCRIPTION = {
    "mask": "capa mask original (0 = no válido, 255 = fuera de la adquisición, otro = subfranja válida)",
    "numberOfLooks": "numberOfLooks del producto",
    "rtcGammaToSigmaFactor": "rtcGammaToSigmaFactor: σ⁰ = γ⁰ · factor",
}
# Campos de identification que se contrastan con el catálogo (h5 -> atributo de SceneMeta).
IDENTITY_CHECKS = {
    "granuleId": "scene_id",
    "compositeReleaseId": "crid",
    "trackNumber": "track",
    "frameNumber": "frame",
    "orbitPassDirection": "direction",
}
IDENTITY_KEEP = (
    "granuleId", "productType", "compositeReleaseId", "trackNumber", "frameNumber",
    "orbitPassDirection", "absoluteOrbitNumber", "zeroDopplerStartTime", "zeroDopplerEndTime",
    "productVersion", "isFullFrame", "listOfFrequencies",
)


def _norm(v):
    return str(v).strip().upper() if v is not None else None


def check_identity(f: h5py.File, scene: SceneMeta) -> dict:
    """Lee identification del archivo y verifica que coincide con lo que dijo el catálogo.

    Si el archivo contradice al catálogo, se detiene: un recorte con la identidad equivocada
    rompe la trazabilidad (AGENTS.md §2.3).
    """
    ident = nh.read_identification(f)
    mismatches = []
    for h5_key, attr in IDENTITY_CHECKS.items():
        file_val, cat_val = ident.get(h5_key), getattr(scene, attr)
        if file_val is None or cat_val is None:
            continue
        if _norm(file_val) != _norm(cat_val):
            mismatches.append(f"{h5_key}: archivo={file_val!r} catálogo={cat_val!r}")
    if mismatches:
        raise ValueError("El archivo no coincide con la escena del catálogo: " + "; ".join(mismatches))
    return {k: ident[k] for k in IDENTITY_KEEP if k in ident}


def available_layers(f: h5py.File, frequency: str = "A") -> tuple[str, ...]:
    grid = nh.open_grid(f, frequency)
    g = f[grid.path]
    return grid.layers + tuple(a for a in AUX_LAYERS if a in g)


def roi_coverage(mask_win: np.ndarray, roi_xy, grid: nh.Grid, win: nh.Window) -> dict:
    """% de píxeles válidos (según la capa mask) dentro del polígono de la ROI."""
    in_roi = geometry_mask([roi_xy], out_shape=win.shape, transform=grid.transform(win.row0, win.col0), invert=True)
    n_roi = int(in_roi.sum())
    ok = nh.valid_mask(mask_win) & in_roi
    pct = lambda n: 100.0 * n / n_roi if n_roi else 0.0  # noqa: E731
    return {
        "pixeles_en_poligono": n_roi,
        "pct_valido": pct(int(ok.sum())),
        "pct_no_valido": pct(int(((mask_win == nh.MASK_INVALID) & in_roi).sum())),
        "pct_fuera_adquisicion": pct(int(((mask_win == nh.MASK_OUTSIDE) & in_roi).sum())),
        "nota": "Calculado con la capa mask del producto sobre el polígono ROI (no sobre el rectángulo).",
    }


def grid_info(grid: nh.Grid, win: nh.Window, clipped: bool) -> dict:
    """Lo necesario para confirmar que dos fechas comparten la misma malla."""
    return {
        "frecuencia": grid.frequency,
        "epsg": grid.epsg,
        "dx_m": grid.dx,
        "dy_m": grid.dy,
        "forma_malla_completa": list(grid.shape),
        "magnitud_potencia": grid.quantity,
        "polarizaciones": list(grid.polarizations),
        "capas_potencia": list(grid.layers),
        "ventana": {"fila0": win.row0, "fila1": win.row1, "col0": win.col0, "col1": win.col1},
        "forma_recorte": list(win.shape),
        "transform_recorte": list(grid.transform(win.row0, win.col0))[:6],
        "roi_se_sale_de_la_escena": clipped,
    }


def _write_tif(path: Path, arr: np.ndarray, grid: nh.Grid, win: nh.Window, nodata, tags: dict) -> None:
    profile = dict(
        driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=arr.dtype,
        crs=f"EPSG:{grid.epsg}", transform=grid.transform(win.row0, win.col0), nodata=nodata,
        compress="LZW", tiled=True, blockxsize=512, blockysize=512, BIGTIFF="IF_SAFER",
    )
    tmp = path.with_suffix(".tif.part")
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write(arr, 1)
        dst.update_tags(**{k: str(v) for k, v in tags.items()})
    tmp.replace(path)   # no deja un .tif a medias si la descarga se corta


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_subset(
    f: h5py.File,
    scene: SceneMeta,
    roi_wkt: str,
    layers: list[str] | tuple[str, ...],
    out_dir: Path,
    provenance: dict,
    frequency: str = "A",
    code_version: str | None = None,
) -> list[Path]:
    """Recorta ``layers`` de un .h5 ya abierto a la ROI y actualiza ``scene.json``.

    ``provenance`` describe cómo se obtuvo el archivo (fuente, URL o ruta local, método).
    """
    if code_version is None:
        from ..catalog import code_version as _cv   # import diferido: evita ciclo sources <-> catalog
        code_version = _cv()

    ident = check_identity(f, scene)
    grid = nh.open_grid(f, frequency)
    g = f[grid.path]
    allowed = grid.layers + tuple(a for a in AUX_LAYERS if a in g)
    unknown = [lay for lay in layers if lay not in allowed]
    if unknown:
        raise ValueError(f"Capas no disponibles en el archivo: {unknown}. Disponibles: {list(allowed)}")

    win, roi_xy, clipped = nh.roi_window(grid, roi_wkt)
    info = grid_info(grid, win, clipped)

    scene_dir = Path(out_dir) / scene.scene_id
    scene_dir.mkdir(parents=True, exist_ok=True)
    meta_path = scene_dir / "scene.json"
    meta = _load_json(meta_path)
    if meta.get("malla") and meta["malla"] != info:
        raise ValueError(f"{meta_path} ya tiene otra malla/ventana (¿cambió la ROI?). Bórralo para recortar de nuevo.")

    now = datetime.now(timezone.utc).isoformat()
    tags = {"fuente": scene.scene_id, "frecuencia": frequency, "codigo": code_version, "roi_wkt": roi_wkt}
    capas = meta.get("capas", {})
    coverage = meta.get("cobertura_roi")
    written = []
    for layer in layers:
        ds = g[layer]
        if layer == "mask":
            arr = ds[win.slices]
            nodata = None   # 0 y 255 tienen significado propio: se interpretan con la descripción
            coverage = roi_coverage(arr, roi_xy, grid, win)
        else:
            arr = nh.read_float(ds, win)
            nodata = np.nan
        desc = LAYER_DESCRIPTION.get(layer, f"{layer}: potencia lineal {grid.quantity} (sin dB, sin máscara)")
        path = scene_dir / f"{layer}.tif"
        _write_tif(path, arr, grid, win, nodata, {**tags, "capa": layer, "descripcion": desc})
        capas[layer] = {
            "archivo": path.name,
            "descripcion": desc,
            "dtype": str(arr.dtype),
            "nodata": "NaN" if nodata is not None else None,
            "unidades": nh.to_text(ds.attrs.get("units")),
            "creado_utc": now,
        }
        written.append(path)

    meta.update({
        "contrato": "C1",
        "scene": scene.to_dict(),
        "identificacion_h5": ident,
        "roi": {"wkt": roi_wkt, "crs": "EPSG:4326"},
        "malla": info,
        "capas": capas,
        "cobertura_roi": coverage,
        "procedencia": provenance,
        "code_version": code_version,
        "actualizado_utc": now,
        "advertencias": [
            "Valores tal como vienen en el producto: sin dB, sin máscara, sin multilook.",
            "El recorte es el rectángulo que contiene la ROI; aplicar el polígono en el procesamiento.",
        ],
    })
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return written


def compare_grids(a: dict, b: dict) -> list[str]:
    """Diferencias de malla entre dos scene.json. Lista vacía = misma malla y misma ventana."""
    diffs = []
    for k in ("frecuencia", "epsg", "dx_m", "dy_m", "transform_recorte", "forma_recorte", "magnitud_potencia"):
        if a["malla"].get(k) != b["malla"].get(k):
            diffs.append(f"{k}: {a['malla'].get(k)} vs {b['malla'].get(k)}")
    return diffs
