"""Etapa 1: inspección de un producto NISAR L2 (GCOV o GSLC) sobre la ROI.

Uso (desde la raíz del repo, entorno `nisar`):

    python -m pipeline.etapa1 "ruta/al/archivo.h5"
    python -m pipeline.etapa1 "ruta/al/archivo.h5" --sin-vista      # omite la vista general (lenta)
    python -m pipeline.etapa1 "ruta/al/archivo.h5" --sin-figuras    # solo datos (GeoTIFF, CSV, JSON)

No modifica el .h5. Escribe en data/explore/<granuleId>/:

    metadatos.json        escena, malla, ventana, parámetros del procesador, estadísticas, versión del código
    LEEME_validacion.txt  comprobaciones para hacer a mano, con los valores a comparar
    geotiff/              potencia lineal (resolución del producto) y dB tras multilook; máscara;
                          en GCOV también σ⁰, el factor γ⁰→σ⁰ y el número de looks
    figuras/              vista general, ROI en dB, histogramas, máscara, ángulo de incidencia
    control/              píxeles al azar y un bloque de multilook, para recalcular a mano
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import h5py
import numpy as np
import rasterio
import yaml
from rasterio.features import geometry_mask

from . import nisar_h5 as nh
from .catalog import code_version

ROOT = Path(__file__).resolve().parent.parent
HIST_EDGES = np.arange(-60.0, 30.0 + 0.1, 0.1)   # dB, bins de 0.1 dB
DEFAULT_MULTILOOK = {"GSLC": 4, "GCOV": 2}       # GCOV ya viene promediado (numberOfLooks)


def log(msg: str) -> None:
    # La consola de Windows (cp1252) no tiene todos los símbolos: se reemplazan en vez de fallar.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def g9(v) -> str:
    """9 cifras significativas: suficiente para float32 sin inventar precisión."""
    v = float(v)
    return "NaN" if not np.isfinite(v) else f"{v:.9g}"


def write_tif(path: Path, arr: np.ndarray, grid: nh.Grid, row0: int, col0: int, step: int, nodata, tags: dict):
    profile = dict(
        driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=arr.dtype,
        crs=f"EPSG:{grid.epsg}", transform=grid.transform(row0, col0, step), nodata=nodata,
        compress="LZW", tiled=True, blockxsize=512, blockysize=512, BIGTIFF="IF_SAFER",
    )
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(arr, 1)
        dst.update_tags(**{k: str(v) for k, v in tags.items()})
    return {"archivo": str(path.relative_to(ROOT)), "bytes": path.stat().st_size, "forma": list(arr.shape)}


def json_default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def pick_control_pixels(ok: np.ndarray, k: int, rng: np.random.Generator, max_tries: int = 100_000):
    """k posiciones (fila, col) válidas elegidas al azar con semilla fija (reproducible)."""
    picks, seen = [], set()
    for _ in range(max_tries):
        r, c = int(rng.integers(ok.shape[0])), int(rng.integers(ok.shape[1]))
        if ok[r, c] and (r, c) not in seen:
            picks.append((r, c))
            seen.add((r, c))
            if len(picks) == k:
                break
    return picks


def pick_full_block(ok: np.ndarray, n: int, rng: np.random.Generator):
    """Un bloque n×n de la malla del multilook con TODOS sus píxeles válidos."""
    h, w = (ok.shape[0] // n) * n, (ok.shape[1] // n) * n
    full = ok[:h, :w].reshape(h // n, n, w // n, n).all(axis=(1, 3))
    idx = np.flatnonzero(full)
    if idx.size == 0:
        return None
    i, j = np.unravel_index(int(rng.choice(idx)), full.shape)
    return int(i), int(j)


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="Etapa 1: inspección de un producto NISAR L2 sobre la ROI.")
    ap.add_argument("h5", help="ruta al archivo .h5")
    ap.add_argument("--config", default=str(ROOT / "pipeline" / "config.yaml"), help="de aquí se toma la ROI")
    ap.add_argument("--frecuencia", default="A")
    ap.add_argument("--multilook", type=int, default=None, help="n del multilook n×n (default: GCOV 2, GSLC 4)")
    ap.add_argument("--min-validos-multilook", type=float, default=0.5)
    ap.add_argument("--paso-vista", type=int, default=50, help="submuestreo de la vista general")
    ap.add_argument("--sin-vista", action="store_true", help="omitir la vista general (lee todo el archivo)")
    ap.add_argument("--sin-figuras", action="store_true", help="no generar PNG (solo datos)")
    ap.add_argument("--n-control", type=int, default=15)
    ap.add_argument("--semilla", type=int, default=0)
    ap.add_argument("--altura-incidencia", type=float, default=500.0,
                    help="capa de altura (m sobre el elipsoide) del ángulo de incidencia a graficar")
    ap.add_argument("--salida", default=str(ROOT / "data" / "explore"))
    args = ap.parse_args(argv)

    fig = None
    if not args.sin_figuras:
        from . import etapa1_figuras as fig  # matplotlib solo si se van a hacer figuras

    t_start = time.time()
    h5_path = Path(args.h5).resolve()
    roi_wkt = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))["roi"]["wkt"]
    rng = np.random.default_rng(args.semilla)

    with h5py.File(h5_path, "r") as f:
        # 1. Ficha, malla y parámetros del procesador ---------------------------------------
        ident = nh.read_identification(f)
        grid = nh.open_grid(f, args.frecuencia)
        g = f[grid.path]
        is_gcov = grid.product == "GCOV"
        q = grid.quantity                       # "gamma0" (GCOV) o "beta0" (GSLC)
        sym = nh.SYMBOL.get(q, q)
        n = args.multilook or DEFAULT_MULTILOOK[grid.product]
        proc = nh.processing_parameters(f, grid.product)
        log(ident["granuleId"])
        log(f"{grid.product} malla {grid.frequency}: {grid.shape[0]}x{grid.shape[1]} px de {grid.dx:g} m, "
            f"EPSG:{grid.epsg}, capas {', '.join(grid.layers)}, magnitud {q}")

        out = Path(args.salida) / ident["granuleId"]
        for sub in ("geotiff", "figuras", "control"):
            (out / sub).mkdir(parents=True, exist_ok=True)

        # 2. Ventana de la ROI ----------------------------------------------------------------
        win, roi_xy, clipped = nh.roi_window(grid, roi_wkt)
        log(f"Ventana ROI: filas {win.row0}-{win.row1}, columnas {win.col0}-{win.col1} "
            f"({win.shape[0]}x{win.shape[1]} px){' -- la ROI se sale de la escena' if clipped else ''}")
        in_roi = geometry_mask([roi_xy], out_shape=win.shape, transform=grid.transform(win.row0, win.col0),
                               invert=True)

        # 3. Máscara --------------------------------------------------------------------------
        mask_win = g["mask"][win.slices]
        ok = nh.valid_mask(mask_win) & in_roi
        total = mask_win.size
        mask_counts = {
            "valido": 100 * float(ok.sum()) / total,
            "no_valido": 100 * float(((mask_win == nh.MASK_INVALID) & in_roi).sum()) / total,
            "fuera_adquisicion": 100 * float(((mask_win == nh.MASK_OUTSIDE) & in_roi).sum()) / total,
            "fuera_poligono": 100 * float((~in_roi).sum()) / total,
        }
        valid_in_polygon = 100 * float(ok.sum()) / max(int(in_roi.sum()), 1)
        log(f"Pixeles validos dentro del poligono ROI: {valid_in_polygon:.3f} %")
        base_tags = {"fuente": ident["granuleId"], "frecuencia": grid.frequency, "codigo": code_version()}
        outputs = [write_tif(out / "geotiff" / "mascara.tif", mask_win, grid, win.row0, win.col0, 1, 255,
                             {**base_tags, "descripcion": "capa mask original (0 no válido, 255 fuera de adquisición)"})]

        # Capas auxiliares de GCOV (comunes a todas las polarizaciones)
        factor = nlooks = None
        if is_gcov:
            factor = nh.read_float(g["rtcGammaToSigmaFactor"], win)
            nlooks = nh.read_float(g["numberOfLooks"], win)
            factor[~ok] = np.nan
            nlooks[~ok] = np.nan
            outputs.append(write_tif(out / "geotiff" / "factor_gamma0_a_sigma0.tif", factor, grid, win.row0,
                                     win.col0, 1, np.nan, {**base_tags, "descripcion": "rtcGammaToSigmaFactor"}))
            outputs.append(write_tif(out / "geotiff" / "numero_de_looks.tif", nlooks, grid, win.row0, win.col0, 1,
                                     np.nan, {**base_tags, "descripcion": "numberOfLooks"}))

        control_px = pick_control_pixels(ok, args.n_control, rng)
        block = pick_full_block(ok, n, rng)

        # 4. Por capa: potencia, dB, multilook, estadísticas ---------------------------------
        quantities = [q, "sigma0"] if is_gcov else [q]
        stats, hist, ml_db, ctrl, block_rows, attrs_check = {}, {}, {}, {}, {}, {}
        for layer in grid.layers:
            t0 = time.time()
            ds = g[layer]
            pw = nh.read_power(ds, win)
            pw[~ok] = np.nan
            log(f"{layer}: {q} leido ({win.shape[0]}x{win.shape[1]}) en {time.time() - t0:.1f} s")
            arrays = {q: pw}
            if is_gcov:
                arrays["sigma0"] = pw * factor          # σ⁰ = γ⁰ · rtcGammaToSigmaFactor

            stats[layer], ml_db[layer] = {}, {}
            for name, arr in arrays.items():
                stats[layer][name] = nh.power_stats(arr)
                ml = nh.multilook(arr, n, args.min_validos_multilook)
                ml_db[layer][name] = nh.to_db(ml)
                tags = {**base_tags, "capa": layer, "magnitud": name}
                outputs.append(write_tif(out / "geotiff" / f"{name}_{layer}.tif", arr, grid, win.row0, win.col0, 1,
                                         np.nan, {**tags, "escala": "potencia lineal"}))
                outputs.append(write_tif(out / "geotiff" / f"{name}_{layer}_ml{n}_dB.tif", ml_db[layer][name], grid,
                                         win.row0, win.col0, n, np.nan,
                                         {**tags, "escala": f"10*log10(promedio lineal {n}x{n})"}))
                if name == q:
                    db_full = nh.to_db(arr)
                    hist[layer] = np.histogram(db_full[np.isfinite(db_full)], bins=HIST_EDGES)[0]
                    del db_full
                    if block:
                        i, j = block
                        block_rows[layer] = {"valores": arr[i * n:(i + 1) * n, j * n:(j + 1) * n],
                                             "ml": float(ml[i, j]), "ml_dB": float(ml_db[layer][name][i, j])}
                del ml

            # Píxeles de control: valores leídos DIRECTAMENTE del .h5 (independiente de read_power)
            ctrl[layer] = []
            for r, c in control_px:
                R, C = win.row0 + r, win.col0 + c
                rec = {"programa": {name: float(arr[r, c]) for name, arr in arrays.items()}}
                if is_gcov:
                    rec["h5_valor"] = float(ds[R, C])
                    rec["h5_factor"] = float(g["rtcGammaToSigmaFactor"][R, C])
                    rec["h5_looks"] = float(g["numberOfLooks"][R, C])
                else:
                    z = ds[R, C]
                    rec["h5_re"], rec["h5_im"] = float(z.real), float(z.imag)
                ctrl[layer].append(rec)

            a = nh.attrs_dict(ds)
            if "mean_value" in a:                                   # GCOV: media de la capa en la escena
                attrs_check[layer] = {"atributos": {k: a[k] for k in ("mean_value", "sample_stddev",
                                                                      "min_value", "max_value") if k in a},
                                      "media_escena": a["mean_value"],
                                      "dB": float(10 * np.log10(a["mean_value"]))}
            elif "sample_stddev_real" in a:                         # GSLC: E|z|² ≈ σ_Re² + σ_Im² + medias²
                est = (a["sample_stddev_real"] ** 2 + a["sample_stddev_imag"] ** 2
                       + a.get("mean_real_value", 0) ** 2 + a.get("mean_imag_value", 0) ** 2)
                attrs_check[layer] = {"atributos": {k: a[k] for k in a if "value" in k or "stddev" in k},
                                      "media_escena": est, "dB": float(10 * np.log10(est))}
            del pw, arrays

        # 5. Vista general (lee todos los chunks de una capa: lento) --------------------------
        overview_info = None
        if fig and not args.sin_vista:
            layer0 = grid.layers[0]
            log(f"Vista general {layer0}: 1 de cada {args.paso_vista} px de toda la escena "
                "(descomprime la capa completa; puede tardar varios minutos)...")
            t0 = time.time()
            pw_dec = nh.as_power(nh.decimate(g[layer0], args.paso_vista)).copy()
            m_dec = nh.decimate(g["mask"], args.paso_vista)
            pw_dec[~nh.valid_mask(m_dec, pw_dec)] = np.nan
            overview_info = fig.overview(out / "figuras" / f"A_vista_general_{layer0}.png", pw_dec, grid.extent(),
                                         roi_xy, grid.epsg, f"{grid.product}_L_{grid.frequency}_{layer0}", sym)
            overview_info["media_lineal_vista"] = float(np.nanmean(pw_dec))
            overview_info["paso"] = args.paso_vista
            log(f"Vista general lista en {time.time() - t0:.0f} s")

        # 6. Figuras de la ROI ----------------------------------------------------------------
        inc = nh.read_incidence(f, grid.product, roi_xy.bounds, args.altura_incidencia)
        roi_scale = None
        if fig:
            h_ml, w_ml = win.shape[0] // n, win.shape[1] // n
            t_ml = grid.transform(win.row0, win.col0, n)
            ext_ml = (t_ml.c, t_ml.c + t_ml.a * w_ml, t_ml.f + t_ml.e * h_ml, t_ml.f)
            t_w = grid.transform(win.row0, win.col0)
            ext_w = (t_w.c, t_w.c + t_w.a * win.shape[1], t_w.f + t_w.e * win.shape[0], t_w.f)
            roi_scale = fig.roi_db(out / "figuras" / f"B_roi_{q}_dB.png", {k: v[q] for k, v in ml_db.items()},
                                   ext_ml, roi_xy, grid.epsg, n, grid.dx, sym)
            if is_gcov:
                fig.roi_db(out / "figuras" / "B2_roi_sigma0_dB.png", {k: v["sigma0"] for k, v in ml_db.items()},
                           ext_ml, roi_xy, grid.epsg, n, grid.dx, nh.SYMBOL["sigma0"])
            fig.histograms(out / "figuras" / f"C_histogramas_{q}_dB.png", hist, HIST_EDGES,
                           {k: v[q] for k, v in stats.items()}, sym)
            fig.mask_map(out / "figuras" / "D_mascara.png", mask_win, in_roi, ext_w, roi_xy, grid.epsg, mask_counts)
            fig.incidence(out / "figuras" / "E_incidencia.png", inc, roi_xy, grid.epsg)
            log("Figuras listas")

        # 7. Control para validación a mano ---------------------------------------------------
        xs = grid.x[[win.col0 + c for _, c in control_px]]
        ys = grid.y[[win.row0 + r for r, _ in control_px]]
        lons, lats = nh.to_lonlat(grid.epsg, xs, ys)
        with open(out / "control" / "pixeles_control.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            head = ["id", "fila_escena", "col_escena", "x_utm_m", "y_utm_m", "lon", "lat"]
            for layer in grid.layers:
                if is_gcov:
                    head += [f"{layer}_{q}_h5", f"{layer}_factor_h5", f"{layer}_looks_h5",
                             f"{layer}_{q}_programa", f"{layer}_sigma0_programa",
                             f"{layer}_{q}_dB", f"{layer}_sigma0_dB"]
                else:
                    head += [f"{layer}_Re_h5", f"{layer}_Im_h5", f"{layer}_{q}_programa", f"{layer}_{q}_dB"]
            w.writerow(head)
            for k, (r, c) in enumerate(control_px):
                row = [k + 1, win.row0 + r, win.col0 + c, g9(xs[k]), g9(ys[k]), f"{lons[k]:.6f}", f"{lats[k]:.6f}"]
                for layer in grid.layers:
                    rec = ctrl[layer][k]
                    p = rec["programa"]
                    if is_gcov:
                        row += [g9(rec["h5_valor"]), g9(rec["h5_factor"]), g9(rec["h5_looks"]),
                                g9(p[q]), g9(p["sigma0"]), g9(nh.to_db(p[q])), g9(nh.to_db(p["sigma0"]))]
                    else:
                        row += [g9(rec["h5_re"]), g9(rec["h5_im"]), g9(p[q]), g9(nh.to_db(p[q]))]
                w.writerow(row)

        block_summary = {}
        if block:
            i, j = block
            for layer, b in block_rows.items():
                with open(out / "control" / f"bloque_multilook_{layer}.csv", "w", newline="", encoding="utf-8") as fh:
                    w = csv.writer(fh)
                    w.writerow(["fila_escena", "col_escena", f"{layer}_{q}"])
                    for a_ in range(n):
                        for b_ in range(n):
                            w.writerow([win.row0 + i * n + a_, win.col0 + j * n + b_, g9(b["valores"][a_, b_])])
                block_summary[layer] = {"bloque_fila_ml": i, "bloque_col_ml": j,
                                        "promedio_lineal_programa": b["ml"], "dB_programa": b["ml_dB"]}

    # 8. Metadatos -----------------------------------------------------------------------------
    warnings = [
        "Una sola fecha: sirve para inspección, no para un mapa de cambio.",
        "Las figuras son para ver; los números están en este JSON y en control/*.csv.",
    ]
    if is_gcov:
        if proc.get("noiseCorrectionApplied") == "False":
            warnings.append("Sin corrección de ruido (noiseCorrectionApplied=False): valores bajos, sobre todo en "
                            "HV, pueden estar cerca del piso de ruido.")
        if proc.get("shadowMaskingApplied") == "False":
            warnings.append("Sin máscara de sombra/layover (shadowMaskingApplied=False): hay que aplicarla aparte.")
        if proc.get("mantissa_nbits_capas_potencia"):
            warnings.append(f"Capas de potencia guardadas con mantissa de {proc['mantissa_nbits_capas_potencia']} "
                            "bits: ~5 cifras significativas; diferencias en la 6.ª cifra son del formato.")
    else:
        warnings.append("β⁰ de un solo look tiene moteado (speckle); usar el multilook para interpretar.")

    meta = {
        "etapa": "1 - inspección",
        "creado_utc": datetime.now(timezone.utc).isoformat(),
        "version_codigo": code_version(),
        "archivo_h5": {"nombre": h5_path.name, "bytes": h5_path.stat().st_size},
        "identificacion": ident,
        "malla": {"producto": grid.product, "frecuencia": grid.frequency, "epsg": grid.epsg,
                  "dx_m": grid.dx, "dy_m": grid.dy, "forma": list(grid.shape), "extension_m": grid.extent(),
                  "polarizaciones": list(grid.polarizations), "capas": list(grid.layers), "magnitud": q},
        "parametros_procesador": proc,
        "roi": {"wkt_4326": roi_wkt, "ventana": vars(win), "forma_ventana": list(win.shape),
                "se_sale_de_la_escena": clipped, "pct_validos_en_poligono": valid_in_polygon,
                "pct_mascara_en_ventana": mask_counts},
        "parametros": {"multilook": n, "min_validos_multilook": args.min_validos_multilook,
                       "paso_vista": args.paso_vista, "n_control": args.n_control, "semilla": args.semilla,
                       "altura_incidencia_m": inc["altura_m"], "bins_histograma_dB": 0.1},
        "formulas": {
            "potencia": "capa del producto (GCOV)" if is_gcov else "Re(z)^2 + Im(z)^2 (GSLC)",
            "sigma0": "gamma0 * rtcGammaToSigmaFactor" if is_gcov else None,
            "dB": "10*log10(x)",
            "multilook": "promedio lineal de n×n píxeles válidos, luego dB",
            "vista_general": "PowerNorm: t = ((v - p_bajo)/(p_alto - p_bajo))^gamma",
        },
        "estadisticas_roi": stats,
        "escala_figura_roi_dB": roi_scale,
        "vista_general": overview_info,
        "verificacion_atributos_escena": attrs_check,
        "control_multilook": block_summary,
        "incidencia": {"altura_m": inc["altura_m"], "media_en_roi_por_altura": inc["media_por_altura"],
                       "min": float(np.nanmin(inc["angulo"])), "max": float(np.nanmax(inc["angulo"]))},
        "salidas": outputs,
        "duracion_s": round(time.time() - t_start, 1),
        "advertencias": warnings,
    }
    (out / "metadatos.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=json_default),
                                        encoding="utf-8")
    write_readme(out, meta, grid)
    log(f"Listo en {meta['duracion_s']} s -> {out.relative_to(ROOT)}")
    return out


def write_readme(out: Path, meta: dict, grid: nh.Grid) -> None:
    q, is_gcov = grid.quantity, grid.product == "GCOV"
    sym = nh.SYMBOL.get(q, q)
    L = [
        f"VALIDACIÓN A MANO — Etapa 1 ({grid.product})",
        f"Escena: {meta['identificacion']['granuleId']}",
        f"Generado: {meta['creado_utc']} · código {meta['version_codigo']}\n",
        "Los números a comparar están en metadatos.json y en control/. Cifras con 9 dígitos significativos.",
    ]
    for wtxt in meta["advertencias"]:
        L.append(f"  - {wtxt}")
    L.append("")

    L.append("1) Píxeles de control (control/pixeles_control.csv)")
    if is_gcov:
        L.append(f"   Columnas *_h5: leídas directamente del .h5. Columnas *_programa: calculadas por el programa.")
        L.append(f"   a) {sym}_programa debe ser igual a {sym}_h5 (el GCOV ya entrega la potencia {sym}).")
        L.append(f"   b) σ⁰ = {sym} × factor   (factor = rtcGammaToSigmaFactor)")
        L.append(f"   c) X_dB = 10·log10(X)  para {sym} y σ⁰")
    else:
        L.append("   β⁰ = Re² + Im²   y   β⁰_dB = 10·log10(β⁰). Re e Im se leyeron directamente del .h5.")
    L.append("")

    if meta["control_multilook"]:
        n = meta["parametros"]["multilook"]
        L.append(f"2) Multilook (control/bloque_multilook_<CAPA>.csv): promediar los {n * n} valores {sym}, luego dB")
        for layer, b in meta["control_multilook"].items():
            L.append(f"   {layer}: el programa obtuvo promedio = {g9(b['promedio_lineal_programa'])}"
                     f"  ->  {g9(b['dB_programa'])} dB")
        L.append("")

    L.append("3) dB de la media vs. media de los dB (estadisticas_roi)")
    for layer, by_q in meta["estadisticas_roi"].items():
        for name, st in by_q.items():
            L.append(f"   {layer} {nh.SYMBOL.get(name, name)}: media lineal {g9(st['media_lineal'])} -> "
                     f"10·log10 = {g9(st['dB_de_la_media'])} dB; media de los dB = {g9(st['media_dB'])} dB "
                     "(debe ser menor)")
    L.append("")

    v = meta["vista_general"]
    if v:
        L.append("4) Barra de color de la vista general (figuras/A_vista_general_*.png)")
        L.append(f"   p_bajo = {g9(v['p_bajo'])}, p_alto = {g9(v['p_alto'])}, γ = {v['gamma']}")
        L.append("   marca(t) = p_bajo + (p_alto − p_bajo)·t^(1/γ), t = 0, 0.2, …, 1:")
        L.append("   " + ", ".join(f"{m:.4f}" for m in v["marcas_barra"]))
        L.append("")

    e, shape = meta["malla"]["extension_m"], meta["malla"]["forma"]
    L.append("5) Ejes (en km)")
    L.append(f"   X: {e[0] / 1e3:.4f} + {shape[1]} px × {grid.dx / 1e3:g} km = {e[1] / 1e3:.4f}")
    L.append(f"   Y: {e[3] / 1e3:.4f} − {shape[0]} px × {abs(grid.dy) / 1e3:g} km = {e[2] / 1e3:.4f}\n")

    if meta["verificacion_atributos_escena"]:
        L.append("6) Coherencia con los atributos que trae el propio .h5 (escena completa)")
        for layer, a in meta["verificacion_atributos_escena"].items():
            L.append(f"   {layer}: media de la escena ≈ {g9(a['media_escena'])} ({g9(a['dB'])} dB). "
                     f"Atributos: {a['atributos']}")
        if v:
            L.append(f"   Media lineal de la vista general submuestreada: {g9(v['media_lineal_vista'])}")
        L.append("   La ROI es una parte pequeña de la escena: su media puede diferir. Es una comprobación de orden"
                 " de magnitud, no de igualdad.")
    (out / "LEEME_validacion.txt").write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
