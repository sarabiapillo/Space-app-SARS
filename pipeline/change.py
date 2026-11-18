"""Mapa de cambio entre dos fechas comparables (AGENTS.md §6, paso 5 del plan).

    Δσ⁰_dB(x, y) = dB_t2(x, y) − dB_t1(x, y)

Por defecto la magnitud es γ⁰ (la que entrega GCOV, normalizada por terreno); con
``--magnitud sigma0`` se usa σ⁰ = γ⁰ · rtcGammaToSigmaFactor. El símbolo Δσ⁰ del plan se
conserva en la documentación, pero los archivos dicen qué magnitud se usó.

Salidas en ``data/processed/<carpeta del par>/``:

- ``delta_<pol>_dB.tif``: diferencia en dB (float32, NaN = sin dato), malla UTM del producto
  tras el multilook.
- ``zscore_<pol>.tif``: z robusto de la diferencia respecto a la propia ROI (mediana y MAD).
- ``cambio_<pol>.tif``: clase por umbral fijo (int8): −1 disminuye ≥ umbral, 0 estable,
  +1 aumenta ≥ umbral, −128 sin dato.
- ``change.json``: escenas, fechas, comparabilidad, parámetros, métricas y versión del código.
- ``web/``: COG + PNG azul–blanco–rojo en EPSG:3857 y ``capas.json`` para la interfaz.

Lo que esto NO es: un mapa de inundación ni de causas. Un cambio en dB describe un cambio en la
respuesta del radar. Sin validación independiente, el resultado es **exploratorio**.

Uso (desde la raíz del repo; por defecto, el par de ``config.yaml → pair``):

    python -m pipeline.change
    python -m pipeline.change --multilook 5 --umbral 3 --magnitud gamma0
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
import yaml

from . import nisar_h5 as nh
from . import preprocess as pp
from . import web_export as wx
from .catalog import code_version
from .compat import check_pair

ROOT = Path(__file__).resolve().parent.parent
VERSION = "change-1"
CLASS_NODATA = -128
MAD_TO_SIGMA = 1.4826
GRID_KEYS = ("epsg", "dx_m", "dy_m", "ventana", "forma_recorte", "transform_recorte")
POLS = ("HH", "HV")
# El umbral se considera "cerca del ruido" si es menor que NOISE_FACTOR × ruido de la propia ROI.
NOISE_FACTOR = 3.0


def delta_db(db_t1: np.ndarray, db_t2: np.ndarray) -> np.ndarray:
    """t2 − t1 en dB. NaN si falta cualquiera de las dos fechas."""
    if db_t1.shape != db_t2.shape:
        raise ValueError(f"formas distintas: {db_t1.shape} vs {db_t2.shape}")
    return (db_t2.astype("float32") - db_t1.astype("float32")).astype("float32")


def robust_zscore(delta: np.ndarray) -> np.ndarray:
    """(Δ − mediana) / (1.4826 · MAD), con mediana y MAD de los píxeles válidos."""
    v = delta[np.isfinite(delta)]
    if v.size == 0:
        return np.full(delta.shape, np.nan, "float32")
    med = np.median(v)
    mad = MAD_TO_SIGMA * np.median(np.abs(v - med))
    if mad == 0:
        return np.full(delta.shape, np.nan, "float32")
    return ((delta - med) / mad).astype("float32")


def classify(delta: np.ndarray, threshold_db: float) -> np.ndarray:
    """−1 si Δ ≤ −umbral, +1 si Δ ≥ +umbral, 0 en otro caso; CLASS_NODATA sin dato."""
    c = np.zeros(delta.shape, "int8")
    ok = np.isfinite(delta)
    c[ok & (delta <= -threshold_db)] = -1
    c[ok & (delta >= threshold_db)] = 1
    c[~ok] = CLASS_NODATA
    return c


def summarize(delta: np.ndarray, classes: np.ndarray, pixel_area_m2: float) -> dict:
    v = delta[np.isfinite(delta)].astype("float64")
    n = int(v.size)
    if n == 0:
        return {"pixeles_validos": 0}
    km2 = pixel_area_m2 / 1e6
    n_dec, n_inc = int((classes == -1).sum()), int((classes == 1).sum())
    n_st = n - n_dec - n_inc
    med = float(np.median(v))
    p2, p98 = (float(x) for x in np.percentile(v, [2, 98]))
    return {
        "pixeles_validos": n,
        "area_valida_km2": n * km2,
        "media_dB": float(v.mean()),
        "mediana_dB": med,
        "desv_estandar_dB": float(v.std()),
        "mad_robusta_dB": MAD_TO_SIGMA * float(np.median(np.abs(v - med))),
        "p2_dB": p2,
        "p98_dB": p98,
        "area_disminucion_km2": n_dec * km2,
        "area_aumento_km2": n_inc * km2,
        "area_estable_km2": n_st * km2,
        "pct_disminucion": 100 * n_dec / n,
        "pct_aumento": 100 * n_inc / n,
        "pct_estable": 100 * n_st / n,
    }


def noise_reference(delta: np.ndarray, z: np.ndarray, threshold_db: float) -> dict:
    """Ruido de la ROI (1.4826·MAD del Δ) frente al umbral, y % de píxeles con |z| > 3.

    Sirve para saber qué tan confiable es el umbral fijo en esta ROI: con el mismo umbral en dB,
    una ROI ruidosa marca más falsas alarmas. Es una referencia, no una exactitud.
    """
    v = delta[np.isfinite(delta)].astype("float64")
    zv = z[np.isfinite(z)]
    if v.size == 0:
        return {"ruido_dB": None, "umbral_sobre_ruido": None, "umbral_cerca_del_ruido": None,
                "pct_abs_z_mayor_3": None}
    noise = MAD_TO_SIGMA * float(np.median(np.abs(v - np.median(v))))
    ratio = threshold_db / noise if noise > 0 else None
    return {
        "ruido_dB": noise,
        "umbral_sobre_ruido": ratio,
        "umbral_cerca_del_ruido": bool(ratio is not None and ratio < NOISE_FACTOR),
        "pct_abs_z_mayor_3": 100 * float((np.abs(zv) > 3).sum()) / v.size,
    }


def check_same_grid(g1: dict, g2: dict) -> None:
    """Las dos fechas deben estar en la misma malla, píxel a píxel (sin remuestrear)."""
    diff = [k for k in GRID_KEYS if (k in g1 or k in g2) and g1.get(k) != g2.get(k)]
    if diff:
        raise ValueError("mallas distintas en: " + ", ".join(diff) + " (no se remuestrea para comparar)")


def _write_tif(path: Path, arr: np.ndarray, crs: str, transform, nodata, tags: dict) -> None:
    prof = dict(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=arr.dtype.name,
                crs=crs, transform=transform, nodata=nodata, compress="DEFLATE", tiled=True)
    with rasterio.open(path, "w", **prof) as dst:
        dst.write(arr, 1)
        dst.update_tags(**{k: str(v) for k, v in tags.items()})


def _rel(p: Path) -> str:
    p = Path(p).resolve()
    return p.relative_to(ROOT).as_posix() if p.is_relative_to(ROOT) else p.as_posix()


ADVERTENCIAS = [
    "Exploratorio: sin validación independiente todavía (paso 6 del plan).",
    "Un cambio en dB describe la respuesta del radar; no identifica por sí solo la causa física.",
    "Sin máscara de sombra/layover ni de pendiente (DEM) todavía.",
    "El umbral es fijo y global; el speckle residual puede superar el umbral en píxeles aislados.",
]


def _write_outputs(out: Path, db_pairs: dict, crs: str, transform, *, t1_id: str, t2_id: str, magnitude: str,
                   looks: int, threshold_db: float, roi_wkt: str, web: bool, web_scale_db: float | None,
                   vcode: str) -> tuple[dict, dict, dict | None]:
    """Δ, z y clases por polarización (``db_pairs[pol] = (dB_t1, dB_t2)``, misma malla) → GeoTIFF y web.

    Devuelve (métricas, archivos, manifiesto web o None).
    """
    out.mkdir(parents=True, exist_ok=True)
    pixel_area = abs(transform.a * transform.e)
    tags = {"t1": t1_id, "t2": t2_id, "magnitud": magnitude, "multilook": looks, "codigo": vcode}
    metrics, files, deltas = {}, {}, {}
    for pol, (db1, db2) in db_pairs.items():
        d = delta_db(db1, db2)
        z = robust_zscore(d)
        c = classify(d, threshold_db)
        names = {"delta": f"delta_{pol}_dB.tif", "zscore": f"zscore_{pol}.tif", "cambio": f"cambio_{pol}.tif"}
        _write_tif(out / names["delta"], d, crs, transform, np.nan,
                   dict(tags, formula=f"10*log10({magnitude}_t2) - 10*log10({magnitude}_t1)", unidades="dB"))
        _write_tif(out / names["zscore"], z, crs, transform, np.nan,
                   dict(tags, formula="(delta - mediana) / (1.4826 * MAD), sobre la ROI"))
        _write_tif(out / names["cambio"], c, crs, transform, CLASS_NODATA,
                   dict(tags, clases=f"-1: delta <= -{threshold_db} dB; 0: estable; 1: delta >= {threshold_db} dB; "
                                     f"{CLASS_NODATA}: sin dato"))
        m = summarize(d, c, pixel_area)
        m["pixeles_abs_z_mayor_3"] = int((np.abs(z) > 3).sum())
        m.update(noise_reference(d, z, threshold_db))
        metrics[pol] = m
        files[pol] = {k: _rel(out / v) for k, v in names.items()}
        deltas[pol] = d

    if not web:
        return metrics, files, None
    noisy = [pol for pol, m in metrics.items() if m.get("umbral_cerca_del_ruido")]
    scale = web_scale_db or 2 * threshold_db
    layers = []
    for pol, d in deltas.items():
        entry = wx.export_layer(out / "web", f"delta_{magnitude}_{pol}_ml{looks}_dB", d, crs, transform,
                                -scale, scale, dict(tags, formula="t2 - t1 (dB)"), ROOT, colormap="rdbu")
        entry.update({"capa": f"{pol}{pol}", "magnitud": f"delta_{magnitude}", "simbolo": f"Δ{_symbol(magnitude)}",
                      "multilook": looks, "pixel_m": abs(transform.a)})
        entry["escala"]["metodo"] = f"simétrica ±{scale} dB (0 = blanco)"
        layers.append(entry)
    manifest = {
        "version": wx.MANIFEST_VERSION,
        "tipo": "mapa_de_cambio",
        "creado_utc": datetime.now(timezone.utc).isoformat(),
        "version_codigo": vcode,
        "t1": t1_id,
        "t2": t2_id,
        "roi_wkt_4326": roi_wkt,
        "umbral_dB": threshold_db,
        "multilook": looks,
        "pixel_m": abs(transform.a),
        "capas": layers,
        "metricas": metrics,
        "metadatos": _rel(out / "change.json"),
        "advertencias": [
            "Azul: regresa menos señal en t2; rojo: regresa más. No identifica la causa.",
            "Los PNG son solo para ver; los valores en dB están en los COG (.tif).",
            ADVERTENCIAS[0],
            *([f"En {', '.join(noisy)}, el umbral de {threshold_db:g} dB es menor que {NOISE_FACTOR:g} veces el "
               "ruido de esta ROI: parte de lo marcado puede ser speckle. Usa más multilook o un umbral mayor."]
              if noisy else []),
        ],
    }
    wx.write_manifest(out / "web" / "capas.json", manifest)
    return metrics, files, manifest


def _symbol(magnitude: str) -> str:
    return {"gamma0": "γ⁰", "sigma0": "σ⁰"}.get(magnitude, magnitude)


def _read_pairs(cog_pairs: dict) -> tuple[dict, str, object]:
    """Lee ``cog_pairs[pol] = (t1, t2)`` exigiendo la misma malla (CRS, transform y forma), sin remuestrear."""
    arrays, crs, transform = {}, None, None
    for pol, (p1, p2) in cog_pairs.items():
        with rasterio.open(p1) as a, rasterio.open(p2) as b:
            if a.crs != b.crs or a.transform != b.transform or a.shape != b.shape:
                raise ValueError(f"{pol}: la malla de t1 y t2 no coincide (CRS, transform o forma)")
            if crs is not None and (a.crs.to_string() != crs or a.transform != transform):
                raise ValueError(f"{pol}: malla distinta a la de las otras polarizaciones")
            crs, transform = a.crs.to_string(), a.transform
            arrays[pol] = (a.read(1).astype("float32"), b.read(1).astype("float32"))
    if not arrays:
        raise ValueError("no hay capas para comparar")
    return arrays, crs, transform


def _change_from_db_arrays(db_pairs: dict, crs: str, transform, out: Path, *, cog_pairs: dict, t1_id: str,
                           t2_id: str, magnitude: str, looks: int, threshold_db: float, roi_wkt: str,
                           web_scale_db: float | None, input_desc: dict) -> dict:
    vcode = code_version()
    out = Path(out)
    metrics, files, manifest = _write_outputs(
        out, db_pairs, crs, transform, t1_id=t1_id, t2_id=t2_id, magnitude=magnitude, looks=looks,
        threshold_db=threshold_db, roi_wkt=roi_wkt, web=True, web_scale_db=web_scale_db, vcode=vcode)
    meta = {
        "version": VERSION,
        "creado_utc": datetime.now(timezone.utc).isoformat(),
        "version_codigo": vcode,
        "escenas": {"t1": t1_id, "t2": t2_id},
        "roi_wkt_4326": roi_wkt,
        "parametros": {
            "magnitud": magnitude,
            "formula": f"delta = 10*log10({magnitude}_t2) - 10*log10({magnitude}_t1)",
            "entrada": {pol: [_rel(Path(p)) for p in ps] for pol, ps in cog_pairs.items()},
            "mascara": "la de las capas de entrada (mask del producto + ROI)",
            **input_desc,
            "multilook": looks,
            "pixel_m": abs(transform.a),
            "umbral_dB": threshold_db,
            "zscore": "robusto: (delta - mediana) / (1.4826 * MAD) sobre la ROI",
            "ruido": f"1.4826 * MAD del delta en la ROI; umbral cerca del ruido si umbral < {NOISE_FACTOR:g} * ruido",
        },
        "metricas": metrics,
        "archivos": files,
        "advertencias": ADVERTENCIAS,
    }
    (out / "change.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def change_from_db_cogs(cog_pairs: dict, out: Path, *, t1_id: str, t2_id: str, magnitude: str, looks: int,
                        threshold_db: float, roi_wkt: str, web_scale_db: float | None = None) -> dict:
    """Mapa de cambio a partir de COG en dB ya enmascarados y con multilook (p. ej. los de ``etapa1``).

    ``cog_pairs[pol] = (ruta_t1, ruta_t2)``. Ambas fechas deben tener el mismo CRS, transform y forma:
    no se remuestrea. Devuelve el manifiesto web (con métricas) y escribe ``change.json``.
    """
    db_pairs, crs, transform = _read_pairs(cog_pairs)
    return _change_from_db_arrays(db_pairs, crs, transform, out, cog_pairs=cog_pairs, t1_id=t1_id, t2_id=t2_id,
                                  magnitude=magnitude, looks=looks, threshold_db=threshold_db, roi_wkt=roi_wkt,
                                  web_scale_db=web_scale_db, input_desc={"entrada_escala": "dB con multilook"})


def change_from_linear_cogs(cog_pairs: dict, out: Path, *, t1_id: str, t2_id: str, magnitude: str, looks: int,
                            threshold_db: float, roi_wkt: str, min_valid_fraction: float = 0.5,
                            web_scale_db: float | None = None) -> dict:
    """Mapa de cambio desde la potencia lineal enmascarada a la resolución del producto (``etapa1/geotiff``).

    El multilook n×n se hace aquí, promediando potencia lineal antes del dB (nunca dB), con el mismo
    criterio que ``etapa1``: los bloques empiezan en la esquina superior izquierda del recorte.
    """
    lin_pairs, crs, transform = _read_pairs(cog_pairs)
    db_pairs = {pol: tuple(nh.to_db(nh.multilook(p, looks, min_valid_fraction)) for p in pair)
                for pol, pair in lin_pairs.items()}
    t_ml = pp.multilook_transform(transform, looks)
    return _change_from_db_arrays(db_pairs, crs, t_ml, out, cog_pairs=cog_pairs, t1_id=t1_id, t2_id=t2_id,
                                  magnitude=magnitude, looks=looks, threshold_db=threshold_db, roi_wkt=roi_wkt,
                                  web_scale_db=web_scale_db,
                                  input_desc={"entrada_escala": "potencia lineal (resolución del producto)",
                                              "multilook_metodo": "promedio de potencia lineal n×n antes del dB",
                                              "min_validos_multilook": min_valid_fraction})


def pair_dirname(s1: pp.SceneData, s2: pp.SceneData, magnitude: str) -> str:
    m = s1.meta
    return (f"cambio_{m.product}_T{m.track:03d}_F{m.frame:03d}_{m.crid}_"
            f"{s1.meta.date.replace('-', '')}_{s2.meta.date.replace('-', '')}_{magnitude}")


def run(
    t1_dir: Path,
    t2_dir: Path,
    roi_wkt: str,
    out_root: Path,
    *,
    looks: int,
    threshold_db: float,
    magnitude: str = "gamma0",
    min_valid_fraction: float = 0.5,
    web: bool = True,
    web_scale_db: float | None = None,
) -> Path:
    s1, s2 = pp.load_scene(t1_dir), pp.load_scene(t2_dir)

    compat = check_pair(s1.meta, s2.meta)
    if not compat.comparable:
        raise ValueError("par no comparable: " + "; ".join(compat.errors))
    if s1.meta.start_time >= s2.meta.start_time:
        raise ValueError(f"t1 ({s1.meta.start_time}) debe ser anterior a t2 ({s2.meta.start_time})")
    check_same_grid(s1.grid, s2.grid)

    out = Path(out_root) / pair_dirname(s1, s2, magnitude)
    t_ml = pp.multilook_transform(s1.transform, looks)
    vcode = code_version()
    pols = [p for p in POLS if p in s1.meta.polarizations]
    db_pairs = {
        pol: tuple(pp.prepare_scene(s, pol, roi_wkt, looks=looks, magnitude=magnitude,
                                    min_valid_fraction=min_valid_fraction) for s in (s1, s2))
        for pol in pols
    }
    metrics, files, manifest = _write_outputs(
        out, db_pairs, s1.crs, t_ml, t1_id=s1.meta.scene_id, t2_id=s2.meta.scene_id, magnitude=magnitude,
        looks=looks, threshold_db=threshold_db, roi_wkt=roi_wkt, web=web, web_scale_db=web_scale_db, vcode=vcode)
    pixel_m = abs(t_ml.a)
    web_info = ({"manifiesto": _rel(out / "web" / "capas.json"), "capas": [e["id"] for e in manifest["capas"]]}
                if manifest else None)

    meta = {
        "version": VERSION,
        "creado_utc": datetime.now(timezone.utc).isoformat(),
        "version_codigo": vcode,
        "escenas": {
            k: {"scene_id": s.meta.scene_id, "fecha": s.meta.date, "inicio": s.meta.start_time,
                "crid": s.meta.crid, "madurez": s.meta.maturity, "scene_json": _rel(s.path / "scene.json")}
            for k, s in (("t1", s1), ("t2", s2))
        },
        "intervalo_dias": (datetime.fromisoformat(s2.meta.date) - datetime.fromisoformat(s1.meta.date)).days,
        "roi_wkt_4326": roi_wkt,
        "comparabilidad": dict(compat.to_dict(), malla="idéntica (epsg, espaciado, ventana y transform)"),
        "parametros": {
            "magnitud": magnitude,
            "formula": f"delta = 10*log10({magnitude}_t2) - 10*log10({magnitude}_t1)",
            "mascara": "capa mask del producto (0 y 255 fuera) + polígono ROI (centro del píxel)",
            "multilook": looks,
            "multilook_metodo": "promedio de potencia lineal n×n antes del dB",
            "min_validos_multilook": min_valid_fraction,
            "pixel_m": pixel_m,
            "umbral_dB": threshold_db,
            "zscore": "robusto: (delta - mediana) / (1.4826 * MAD) sobre la ROI",
            "polarizaciones": pols,
        },
        "metricas": metrics,
        "archivos": files,
        "web": web_info,
        "advertencias": [
            "Exploratorio: sin validación independiente todavía (paso 6 del plan).",
            "Un cambio en dB describe la respuesta del radar; no identifica por sí solo la causa física.",
            f"Productos {s1.meta.maturity}: calibrados y parcialmente validados.",
            "Sin máscara de sombra/layover ni de pendiente (DEM) todavía.",
            "El umbral es fijo y global; el speckle residual puede superar el umbral en píxeles aislados.",
        ],
    }
    (out / "change.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="Mapa de cambio (dB) entre dos recortes C1 comparables.")
    ap.add_argument("t1", nargs="?", help="scene_id de t1 (default: config.yaml → pair.t1)")
    ap.add_argument("t2", nargs="?", help="scene_id de t2 (default: config.yaml → pair.t2)")
    ap.add_argument("--config", default=str(ROOT / "pipeline" / "config.yaml"))
    ap.add_argument("--multilook", type=int, default=5, help="n del multilook n×n (default 5: 10 m → 50 m)")
    ap.add_argument("--min-validos-multilook", type=float, default=0.5)
    ap.add_argument("--umbral", type=float, default=3.0, help="umbral |Δ| en dB (default 3)")
    ap.add_argument("--magnitud", choices=pp.MAGNITUDES, default="gamma0")
    ap.add_argument("--escala-web", type=float, default=None, help="escala simétrica ±dB del PNG (default 2·umbral)")
    ap.add_argument("--sin-web", action="store_true", help="no generar COG/PNG para la web")
    args = ap.parse_args(argv)

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    t1 = args.t1 or cfg["pair"]["t1"]["scene_id"]
    t2 = args.t2 or cfg["pair"]["t2"]["scene_id"]
    raw, processed = ROOT / cfg["paths"]["raw"], ROOT / cfg["paths"]["processed"]
    out = run(raw / t1, raw / t2, cfg["roi"]["wkt"], processed, looks=args.multilook,
              threshold_db=args.umbral, magnitude=args.magnitud, min_valid_fraction=args.min_validos_multilook,
              web=not args.sin_web, web_scale_db=args.escala_web)
    meta = json.loads((out / "change.json").read_text(encoding="utf-8"))
    print(f"Salida: {_rel(out)}")
    for pol, m in meta["metricas"].items():
        print(f"  {pol}: mediana {m['mediana_dB']:+.2f} dB | baja ≥{args.umbral} dB: {m['area_disminucion_km2']:.2f} km² "
              f"({m['pct_disminucion']:.2f} %) | sube ≥{args.umbral} dB: {m['area_aumento_km2']:.2f} km² "
              f"({m['pct_aumento']:.2f} %) | válido: {m['area_valida_km2']:.1f} km²")
    return out


if __name__ == "__main__":
    main()
