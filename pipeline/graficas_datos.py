"""Datos de las gráficas de la Etapa 1 en JSON, para dibujarlas en la web (Chart.js) y cargarlas en la base.

Las figuras PNG de ``figuras/`` (matplotlib) se siguen generando igual. Este módulo guarda los
**números** de las gráficas que son series (no mapas) en ``data/explore/<granuleId>/graficas.json``:

- ``histograma_<magnitud>_dB``: conteo de píxeles por bin de dB, por polarización (figura C).
- ``mascara_roi``: porcentaje de la ventana de la ROI en cada categoría de la máscara (números de la figura D).
- ``incidencia_por_altura``: ángulo de incidencia medio en la ROI por capa de altura del cubo (metadatos de E).

Los mapas (figuras A, B, D y E) no van aquí: son rásteres y en la web se muestran como capas
(``web/``), no como gráficas.

El formato es independiente de la librería: ejes con unidad, series con nombre y valores, y
estadísticas para anotar. No lleva colores ni opciones de Chart.js, que decide el frontend.
Los valores son exactamente los que usa la figura PNG: no se recalculan ni se suavizan.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

VERSION = "graficas-etapa1-1"

MASK_LABELS = {
    "valido": "válido (subfranja)",
    "no_valido": "no válido (0)",
    "fuera_adquisicion": "fuera de la adquisición (255)",
    "fuera_poligono": "fuera del polígono ROI",
}
STAT_KEYS = ("n_validos", "media_dB", "mediana_dB", "dB_de_la_media", "desv_std_dB", "p5_dB", "p95_dB")


def _trim(counts: np.ndarray) -> tuple[int, int]:
    """Índices [i0, i1) del primer al último bin con conteo > 0 (vacío si no hay ninguno)."""
    nz = np.flatnonzero(counts)
    return (int(nz[0]), int(nz[-1]) + 1) if nz.size else (0, 0)


def histogram_chart(quantity: str, symbol: str, hist_by_pol: dict, edges: np.ndarray, stats_by_pol: dict,
                    out_of_range: dict | None = None) -> dict:
    """Histograma en dB por polarización, recortado a los bins con datos (sin perder ningún conteo)."""
    width = float(round(edges[1] - edges[0], 9))
    series = []
    for pol, counts in hist_by_pol.items():
        counts = np.asarray(counts, dtype=np.int64)
        i0, i1 = _trim(counts)
        s = stats_by_pol[pol]
        series.append({
            "nombre": pol,
            "bin_inicio_dB": float(round(edges[i0], 9)),   # borde izquierdo del primer bin
            "conteos": counts[i0:i1].tolist(),
            "total_en_rango": int(counts.sum()),
            "fuera_de_rango": int((out_of_range or {}).get(pol, 0)),
            "estadisticas": {k: s.get(k) for k in STAT_KEYS},
        })
    return {
        "id": f"histograma_{quantity}_dB",
        "figura_png": f"C_histogramas_{quantity}_dB.png",
        "tipo_sugerido": "bar",
        "titulo": f"Histograma de {symbol} en dB sobre la ROI (resolución del producto)",
        "eje_x": {"etiqueta": f"{symbol}", "unidad": "dB", "ancho_bin": width,
                  "rango_bins": [float(edges[0]), float(edges[-1])]},
        "eje_y": {"etiqueta": "píxeles", "unidad": "conteo"},
        "como_leer": ("El bin k de una serie va de bin_inicio_dB + k·ancho_bin a bin_inicio_dB + (k+1)·ancho_bin. "
                      "Porcentaje = conteo / total_en_rango · 100 (así está la figura PNG). "
                      "fuera_de_rango = píxeles válidos con dB fuera de rango_bins (no están en conteos)."),
        "series": series,
    }


def mask_chart(pct_by_category: dict, pct_valid_in_polygon: float) -> dict:
    keys = [k for k in MASK_LABELS if k in pct_by_category]
    return {
        "id": "mascara_roi",
        "figura_png": "D_mascara.png",
        "tipo_sugerido": "bar",
        "titulo": "Categorías de la máscara en la ventana de la ROI (todos los píxeles)",
        "eje_x": {"etiqueta": "categoría", "unidad": None},
        "eje_y": {"etiqueta": "% de la ventana", "unidad": "%"},
        "categorias": keys,
        "etiquetas": [MASK_LABELS[k] for k in keys],
        "series": [{"nombre": "porcentaje", "valores": [float(pct_by_category[k]) for k in keys]}],
        "pct_validos_en_poligono": float(pct_valid_in_polygon),
        "como_leer": ("Porcentajes sobre el rectángulo de la ventana (suman 100). pct_validos_en_poligono es "
                      "otro denominador: solo los píxeles dentro del polígono ROI."),
    }


def incidence_chart(mean_by_height: dict, units: str, chosen_height_m: float) -> dict:
    heights = sorted(float(h) for h in mean_by_height)
    return {
        "id": "incidencia_por_altura",
        "figura_png": "E_incidencia.png",
        "tipo_sugerido": "line",
        "titulo": "Ángulo de incidencia medio en la ROI por capa de altura (metadata/radarGrid)",
        "eje_x": {"etiqueta": "altura sobre el elipsoide WGS84", "unidad": "m"},
        "eje_y": {"etiqueta": "ángulo de incidencia medio", "unidad": units or None},
        "x": heights,
        "series": [{"nombre": "media en la ROI", "valores": [float(mean_by_height[h]) for h in heights]}],
        "altura_figura_m": float(chosen_height_m),
        "como_leer": "Cada punto es la media del cubo de incidencia en la ROI a esa altura; el mapa E usa altura_figura_m.",
    }


def build(scene: dict, code_version: str, charts: list[dict], source_files: dict) -> dict:
    return {
        "version": VERSION,
        "tipo": "graficas_inspeccion_una_fecha",
        "creado_utc": datetime.now(timezone.utc).isoformat(),
        "version_codigo": code_version,
        "escena": scene,
        "fuentes": source_files,
        "graficas": charts,
        "advertencias": [
            "Una sola fecha: describe la escena, no un cambio.",
            "Datos de inspección: los histogramas son de la ROI a resolución completa, sin máscara de sombra/layover.",
        ],
    }


def write(path: Path, data: dict) -> Path:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return path
