"""Figuras de la Etapa 1 (inspección del dato original).

Las figuras son para VER. Ningún cálculo se hace sobre los PNG (AGENTS.md §5):
todos los números salen del .h5 y quedan en metadatos.json y en control/*.csv.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import BoundaryNorm, ListedColormap, PowerNorm  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

DPI = 150


def _roi_outline(ax, roi_xy, color="red"):
    xs, ys = roi_xy.exterior.xy
    ax.plot(np.asarray(xs) / 1e3, np.asarray(ys) / 1e3, color=color, lw=1.2, label="ROI")


def _axes_km(ax, epsg):
    ax.set_xlabel(f"X, EPSG:{epsg} (km)")
    ax.set_ylabel(f"Y, EPSG:{epsg} (km)")


def _display_step(shape, max_px=2000):
    return max(1, int(np.ceil(max(shape) / max_px)))


def overview(path: Path, pw_dec, extent_m, roi_xy, epsg, label, symbol="β⁰",
             p_low=5.0, p_high=95.0, gamma=0.5) -> dict:
    """Vista general estilo reporte QA: potencia lineal, recorte a percentiles y corrección γ.

    Normalización (matplotlib PowerNorm): t = ((v − p_low)/(p_high − p_low))^γ.
    Por eso las marcas de la barra, equiespaciadas en t, valen v = p_low + (p_high − p_low)·t^(1/γ).
    """
    vmin, vmax = (float(v) for v in np.nanpercentile(pw_dec, [p_low, p_high]))
    ticks = vmin + (vmax - vmin) * np.linspace(0, 1, 6) ** (1 / gamma)
    cmap = plt.get_cmap("gray").copy()
    cmap.set_bad("blue")

    fig, ax = plt.subplots(figsize=(7.5, 7))
    ext_km = [e / 1e3 for e in extent_m]
    im = ax.imshow(
        np.ma.masked_invalid(pw_dec),
        cmap=cmap,
        norm=PowerNorm(gamma=gamma, vmin=vmin, vmax=vmax, clip=True),
        extent=ext_km,
        interpolation="nearest",
    )
    _roi_outline(ax, roi_xy)
    ax.legend(loc="upper right", fontsize=8)
    cb = fig.colorbar(im, ax=ax, ticks=ticks, fraction=0.046, pad=0.04)
    cb.ax.set_yticklabels([f"{t:.3f}" for t in ticks])
    cb.set_label(f"{symbol} (lineal, adimensional)")
    fig.suptitle(f"Coeficiente de retrodispersión {symbol}\n{label}", fontsize=12)
    ax.set_title(
        f"recorte a percentiles [{p_low:g}, {p_high:g}] · escala lineal · corrección γ = {gamma:g}\n"
        "azul = sin dato · percentiles calculados sobre la vista submuestreada",
        fontsize=8,
    )
    _axes_km(ax, epsg)
    ax.tick_params(axis="x", labelrotation=45)
    fig.tight_layout()
    fig.savefig(path, dpi=DPI)
    plt.close(fig)
    return {"p_bajo": vmin, "p_alto": vmax, "gamma": gamma, "marcas_barra": ticks.tolist()}


def roi_db(path: Path, db_by_pol: dict, extent_m, roi_xy, epsg, ml: int, pixel_m: float, symbol="β⁰") -> dict:
    """Las polarizaciones en dB (multilook) con la MISMA escala de color, para poder compararlas."""
    allv = np.concatenate([d[np.isfinite(d)].ravel() for d in db_by_pol.values()])
    vmin, vmax = (float(v) for v in np.percentile(allv, [2, 98]))
    n = len(db_by_pol)
    fig, axes = plt.subplots(1, n, figsize=(6.5 * n, 4.6), squeeze=False)
    ext_km = [e / 1e3 for e in extent_m]
    for ax, (pol, d) in zip(axes[0], db_by_pol.items()):
        im = ax.imshow(d, cmap="gray", vmin=vmin, vmax=vmax, extent=ext_km, interpolation="nearest")
        _roi_outline(ax, roi_xy)
        ax.set_title(f"{symbol} {pol} [dB]")
        _axes_km(ax, epsg)
    fig.colorbar(im, ax=axes[0].tolist(), label=f"{symbol} [dB]", shrink=0.85)
    fig.suptitle(
        f"ROI · multilook {ml}×{ml} (píxel de {ml * pixel_m:g} m) · escala común percentiles 2–98: "
        f"{vmin:.2f} a {vmax:.2f} dB",
        fontsize=10,
    )
    fig.savefig(path, dpi=DPI, bbox_inches="tight")
    plt.close(fig)
    return {"vmin_dB": vmin, "vmax_dB": vmax}


def histograms(path: Path, hist_by_pol: dict, bin_edges: np.ndarray, stats_by_pol: dict, symbol="β⁰") -> None:
    """Histogramas en dB (resolución completa del producto) con las estadísticas anotadas."""
    n = len(hist_by_pol)
    fig, axes = plt.subplots(1, n, figsize=(6 * n, 4.2), squeeze=False)
    centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    for ax, (pol, counts) in zip(axes[0], hist_by_pol.items()):
        s = stats_by_pol[pol]
        cdf = np.cumsum(counts) / counts.sum()
        lo = centers[np.searchsorted(cdf, 0.002)]
        hi = centers[min(np.searchsorted(cdf, 0.998), centers.size - 1)]
        ax.step(centers, counts / counts.sum() * 100, where="mid", color="k", lw=1)
        for key, style, lab in [
            ("media_dB", "-", "media de los dB"),
            ("mediana_dB", "--", "mediana"),
            ("dB_de_la_media", ":", "dB de la media lineal"),
        ]:
            ax.axvline(s[key], ls=style, color="tab:red", lw=1, label=f"{lab}: {s[key]:.3f}")
        ax.axvspan(s["p5_dB"], s["p95_dB"], color="tab:blue", alpha=0.08,
                   label=f"p5–p95: {s['p5_dB']:.2f} a {s['p95_dB']:.2f}")
        ax.set_xlim(lo, hi)
        ax.set_xlabel(f"{symbol} {pol} [dB]")
        ax.set_ylabel(f"% de píxeles (bin {bin_edges[1] - bin_edges[0]:g} dB)")
        ax.set_title(f"{pol} · n = {s['n_validos']:,} píxeles válidos en la ROI")
        ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(path, dpi=DPI)
    plt.close(fig)


def mask_map(path: Path, mask_win, in_roi, extent_m, roi_xy, epsg, counts: dict) -> None:
    """Categorías de la máscara. Porcentajes calculados con TODOS los píxeles; la imagen está submuestreada."""
    cat = np.full(mask_win.shape, 1, dtype=np.uint8)          # válido
    cat[mask_win == 0] = 0                                    # no válido
    cat[mask_win == 255] = 2                                  # fuera de la adquisición
    cat[~in_roi] = 3                                          # fuera del polígono ROI
    s = _display_step(cat.shape)
    colors = ["tab:red", "tab:green", "blue", "lightgray"]
    names = ["no válido (0)", "válido (subfranja)", "fuera de la adquisición (255)", "fuera del polígono ROI"]
    fig, ax = plt.subplots(figsize=(8, 4.8))
    ax.imshow(cat[::s, ::s], cmap=ListedColormap(colors), norm=BoundaryNorm([0, 1, 2, 3, 4], 4),
              extent=[e / 1e3 for e in extent_m], interpolation="nearest")
    _roi_outline(ax, roi_xy, color="black")
    handles = [Patch(color=c, label=f"{nm}: {counts[k]:.3f} %") for c, nm, k in
               zip(colors, names, ["no_valido", "valido", "fuera_adquisicion", "fuera_poligono"])]
    ax.legend(handles=handles, fontsize=7, loc="upper left", bbox_to_anchor=(1.01, 1))
    ax.set_title(f"Máscara en la ventana de la ROI (vista 1 de cada {s} píxeles; % con todos)", fontsize=9)
    _axes_km(ax, epsg)
    fig.tight_layout()
    fig.savefig(path, dpi=DPI)
    plt.close(fig)


def incidence(path: Path, inc: dict, roi_xy, epsg) -> None:
    x, y = inc["x"], inc["y"]
    dx, dy = abs(x[1] - x[0]), abs(y[1] - y[0])
    ext = [(x[0] - dx / 2) / 1e3, (x[-1] + dx / 2) / 1e3, (y[-1] - dy / 2) / 1e3, (y[0] + dy / 2) / 1e3]
    fig, ax = plt.subplots(figsize=(8, 4.8))
    im = ax.imshow(inc["angulo"], cmap="viridis", extent=ext, interpolation="nearest")
    _roi_outline(ax, roi_xy)
    fig.colorbar(im, ax=ax, label=f"ángulo de incidencia ({inc['unidades']})")
    ax.set_title(
        f"Ángulo de incidencia (metadata/radarGrid, malla de {dx:g} m)\n"
        f"capa de altura {inc['altura_m']:g} m sobre el elipsoide (parámetro --altura-incidencia)",
        fontsize=9,
    )
    _axes_km(ax, epsg)
    fig.tight_layout()
    fig.savefig(path, dpi=DPI)
    plt.close(fig)
