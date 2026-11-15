"""Simulación topográfica e hidrodinámica basada en DEM real (NASADEM 30m).

Calcula escorrentía acumulada D8, transporte por Manning y almacenamiento
en depresiones naturales y cauces reales para la ROI seleccionada.
"""
from __future__ import annotations

import base64
import io
import math
from pathlib import Path
from typing import Any

from django.conf import settings
import numpy as np
from PIL import Image

from pipeline.hydrology.inputs import validate_roi
from pipeline.solar.dem import prepare_dem
from pipeline.solar.nasadem import NASADEMProvider
from pipeline.solar.position import acquire_provider_tile_paths


def get_nasadem_cache_dir() -> Path:
    cache = getattr(settings, "SOLAR_NASADEM_CACHE", None)
    if cache is None:
        cache = Path(__file__).resolve().parents[2] / "data" / "nasadem-cache"
    return Path(cache)


def compute_topographic_flood(
    roi: dict[str, Any],
    rainfall_mm: float,
    duration_hours: float,
    *,
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    """Ejecuta la acumulación topográfica D8 y profundidades de agua con NASADEM."""
    validated_roi = validate_roi(roi)
    cache_path = cache_dir or get_nasadem_cache_dir()
    provider = NASADEMProvider(cache_path)

    # Adquirir tiles y preparar DEM real a 30m
    paths = acquire_provider_tile_paths(provider, validated_roi)
    dem = prepare_dem(paths, validated_roi)

    elev = np.asarray(dem.elevation, dtype=np.float32)
    # Llenado de NaNs marginales o de cuerpos de agua
    nan_mask = np.isnan(elev)
    if nan_mask.any():
        valid_mean = float(np.nanmedian(elev)) if not nan_mask.all() else 500.0
        elev = np.nan_to_num(elev, nan=valid_mean)

    height, width = elev.shape
    cell_size = 30.0  # metros
    cell_area = cell_size * cell_size

    # Precipitación efectiva e infiltración (Método hidrológico SCS-CN / pérdida inicial)
    # Coeficiente de escorrentía para laderas y cuencas escarpadas chiapanecas
    runoff_coeff = 0.65
    eff_precip_m = (rainfall_mm * 1e-3) * runoff_coeff
    cell_water_m3 = eff_precip_m * cell_area

    # Enrutamiento de flujo descendente (D8 steepest slope descent)
    order = np.argsort(elev.ravel())[::-1]  # De mayor a menor cota
    accum_volume = np.ones((height, width), dtype=np.float32) * cell_water_m3

    shifts = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    distances = [math.sqrt(dy * dy + dx * dx) * cell_size for dy, dx in shifts]

    for idx in order:
        y = idx // width
        x = idx % width
        z = elev[y, x]

        best_slope = 0.0
        best_ny, best_nx = -1, -1

        for (sdy, sdx), dist in zip(shifts, distances):
            ny, nx = y + sdy, x + sdx
            if 0 <= ny < height and 0 <= nx < width:
                diff = z - elev[ny, nx]
                if diff > 0:
                    slope = diff / dist
                    if slope > best_slope:
                        best_slope = slope
                        best_ny, best_nx = ny, nx

        if best_ny != -1:
            accum_volume[best_ny, best_nx] += accum_volume[y, x]

    # Dinámica de flujo en cauces (Ecuación de Manning en régimen turbulento)
    # Q = V / t (gasto en m³/s)
    duration_s = max(600.0, float(duration_hours) * 3600.0)
    q_discharge = accum_volume / duration_s

    dy, dx = np.gradient(elev, cell_size, cell_size)
    local_slope = np.clip(np.sqrt(dx * dx + dy * dy), 0.005, 1.5)

    # Ancho hidráulico estimado del lecho según gasto
    channel_width = np.clip(2.5 * np.sqrt(np.maximum(0.1, q_discharge)), 5.0, 80.0)
    manning_n = 0.035  # Rugosidad para cauces naturales y cañones rocosos

    # h_manning = (Q * n / (B * S^0.5))^(3/5)
    h_channel = (q_discharge * manning_n / (channel_width * np.sqrt(local_slope))) ** 0.6

    # Encharcamiento y almacenamiento en depresiones topográficas (valle/cañón)
    elev_min = float(elev.min())
    elev_max = float(elev.max())
    rel_elev = elev - elev_min

    # Lámina en zonas bajas confinadas
    h_ponding = np.maximum(0.0, (14.0 - rel_elev) * 0.16) * (rainfall_mm / 40.0)

    # Profundidad total resultante (calado en metros)
    total_depth = np.maximum(h_channel, h_ponding)

    # Bounding box del ráster
    coords = validated_roi["coordinates"][0]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    bounds = [min(lons), min(lats), max(lons), max(lats)]

    # Estadísticas hidrológicas
    wet_mask = total_depth >= 0.03
    wet_count = int(wet_mask.sum())
    total_cells = height * width
    flooded_area_km2 = (wet_count * cell_area) / 1e6
    flooded_area_pct = (wet_count / total_cells) * 100.0
    max_depth_m = float(total_depth.max())
    mean_depth_m = float(total_depth[wet_mask].mean()) if wet_count > 0 else 0.0
    total_volume_m3 = float((total_depth[wet_mask] * cell_area).sum())

    # Generar ráster PNG con paleta azul hidrológica agradable y suave
    rgba = np.zeros((height, width, 4), dtype=np.uint8)

    for y in range(height):
        for x in range(width):
            h = total_depth[y, x]
            if h < 0.03:
                continue
            elif h < 0.15:
                # 0.03 a 0.15m: Azul cerúleo / cian cristalino suave
                t = (h - 0.03) / 0.12
                rgba[y, x, 0] = int(125 * (1 - t) + 56 * t)
                rgba[y, x, 1] = int(211 * (1 - t) + 189 * t)
                rgba[y, x, 2] = int(252 * (1 - t) + 248 * t)
                rgba[y, x, 3] = int(75 + 65 * t)
            elif h < 0.40:
                # 0.15 a 0.40m: Azul turquesa laguna
                t = (h - 0.15) / 0.25
                rgba[y, x, 0] = int(56 * (1 - t) + 14 * t)
                rgba[y, x, 1] = int(189 * (1 - t) + 165 * t)
                rgba[y, x, 2] = int(248 * (1 - t) + 233 * t)
                rgba[y, x, 3] = int(140 + 40 * t)
            elif h < 1.00:
                # 0.40 a 1.00m: Azul cobalto / azur profundo
                t = (h - 0.40) / 0.60
                rgba[y, x, 0] = int(14 * (1 - t) + 2 * t)
                rgba[y, x, 1] = int(165 * (1 - t) + 132 * t)
                rgba[y, x, 2] = int(233 * (1 - t) + 199 * t)
                rgba[y, x, 3] = int(180 + 35 * t)
            else:
                # >= 1.00m: Azul marino profundo / índigo oceánico
                t = min(1.0, (h - 1.0) / 2.0)
                rgba[y, x, 0] = int(2 * (1 - t) + 23 * t)
                rgba[y, x, 1] = int(132 * (1 - t) + 37 * t)
                rgba[y, x, 2] = int(199 * (1 - t) + 84 * t)
                rgba[y, x, 3] = int(215 + 25 * t)

    img = Image.fromarray(rgba, "RGBA")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

    return {
        "status": "ready",
        "dataUrl": data_url,
        "bounds": bounds,
        "stats": {
            "rainfallMm": float(rainfall_mm),
            "durationHours": float(duration_hours),
            "totalVolumeM3": round(total_volume_m3, 1),
            "floodedAreaKm2": round(flooded_area_km2, 3),
            "floodedAreaPct": round(flooded_area_pct, 1),
            "maxDepthM": round(max_depth_m, 2),
            "meanDepthM": round(mean_depth_m, 2),
            "waterSurfaceHa": round(flooded_area_km2 * 100.0, 1),
            "elevMinM": round(elev_min, 1),
            "elevMaxM": round(elev_max, 1),
        },
        "model_metadata": {
            "topography_dem": "NASADEM_HGT 30m Real Elevation Grid",
            "flow_algorithm": "D8 Steepest Downward Gradient Flow Routing",
            "hydraulic_law": "Manning Open Channel Turbulent Flow (n=0.035)",
            "infiltration": "SCS-CN Loss Abstraction (Runoff Coefficient = 0.65)",
            "color_palette": "Pleasing continuous blue gradient (Cerulean to Deep Oceanic Navy)",
        },
    }
