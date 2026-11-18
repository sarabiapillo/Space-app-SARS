"""Pruebas de change.py con escenas sintéticas (no son datos reales)."""
import json

import numpy as np
import pytest
import rasterio

from pipeline import change as ch
from pipeline.tests.test_preprocess import write_scene

# Cubre toda la malla sintética (UTM 15N, x 500000–500200, y 1849800–1850000 ≈ lon −93, lat 16.73).
ROI_ALL = "POLYGON((-93.1 16.6,-92.9 16.6,-92.9 16.9,-93.1 16.9,-93.1 16.6))"
ROI_ELSEWHERE = "POLYGON((-90.1 16.6,-89.9 16.6,-89.9 16.9,-90.1 16.9,-90.1 16.6))"


def test_delta_is_t2_minus_t1_and_nan_propagates():
    t1 = np.array([[-10.0, -12.0, np.nan]], "float32")
    t2 = np.array([[-13.0, -9.0, -5.0]], "float32")
    d = ch.delta_db(t1, t2)
    assert d[0, 0] == pytest.approx(-3.0) and d[0, 1] == pytest.approx(3.0)
    assert np.isnan(d[0, 2])


def test_delta_rejects_different_shapes():
    with pytest.raises(ValueError):
        ch.delta_db(np.zeros((2, 2)), np.zeros((2, 3)))


def test_robust_zscore_uses_median_and_mad():
    d = np.array([0.0, 1.0, -1.0, 2.0, -2.0, np.nan], "float32")
    z = ch.robust_zscore(d)
    mad = 1.4826 * 1.0
    assert z[3] == pytest.approx(2.0 / mad, rel=1e-4)
    assert np.isnan(z[5])


def test_classify_with_threshold():
    d = np.array([-4.0, -3.0, -1.0, 0.0, 2.9, 3.5, np.nan], "float32")
    c = ch.classify(d, 3.0)
    assert c.tolist() == [-1, -1, 0, 0, 0, 1, ch.CLASS_NODATA]


def test_summarize_reports_areas_in_km2():
    d = np.array([[-5.0, -5.0], [0.0, 4.0]], "float32")
    s = ch.summarize(d, ch.classify(d, 3.0), pixel_area_m2=1_000_000)
    assert s["pixeles_validos"] == 4
    assert s["area_disminucion_km2"] == pytest.approx(2.0)
    assert s["area_aumento_km2"] == pytest.approx(1.0)
    assert s["area_estable_km2"] == pytest.approx(1.0)
    assert s["pct_disminucion"] == pytest.approx(50.0)
    assert s["mediana_dB"] == pytest.approx(-2.5)


def test_same_grid_check_rejects_different_window():
    a = {"epsg": 32615, "dx_m": 10.0, "dy_m": -10.0, "ventana": {"fila0": 0}, "forma_recorte": [2, 2]}
    b = dict(a, ventana={"fila0": 1})
    ch.check_same_grid(a, dict(a))
    with pytest.raises(ValueError, match="ventana"):
        ch.check_same_grid(a, b)


def test_run_end_to_end_on_synthetic_pair(tmp_path):
    shape = (20, 20)
    ones = np.ones(shape, "uint8")
    hh1 = np.full(shape, 0.1, "float32")
    hh2 = hh1.copy()
    hh2[:10, :10] = 0.01                      # −10 dB en un cuarto de la escena (100 px de 10 m)
    hv = np.full(shape, 0.02, "float32")
    s1 = write_scene(tmp_path / "raw" / "T1", hh1, hv, ones, {"start": "2026-06-18T00:00:00Z"})
    s2 = write_scene(tmp_path / "raw" / "T2", hh2, hv, ones, {"start": "2026-10-16T00:00:00Z"})

    out = ch.run(s1, s2, ROI_ALL, tmp_path / "processed", looks=2, threshold_db=3.0, web=False)

    meta = json.loads((out / "change.json").read_text(encoding="utf-8"))
    assert meta["comparabilidad"]["comparable"] is True
    assert meta["escenas"]["t1"]["scene_id"] == "T1" and meta["escenas"]["t2"]["fecha"] == "2026-10-16"
    assert meta["parametros"]["umbral_dB"] == 3.0 and meta["parametros"]["multilook"] == 2
    hh = meta["metricas"]["HH"]
    assert hh["area_disminucion_km2"] == pytest.approx(0.01)    # 100 px × 100 m²
    assert hh["area_aumento_km2"] == 0
    assert meta["metricas"]["HV"]["area_disminucion_km2"] == 0
    with rasterio.open(out / "delta_HH_dB.tif") as src:
        d = src.read(1)
        assert src.crs.to_epsg() == 32615 and src.res == (20.0, 20.0)
    assert d[0, 0] == pytest.approx(-10.0, abs=1e-4) and d[-1, -1] == pytest.approx(0.0, abs=1e-4)
    with rasterio.open(out / "cambio_HH.tif") as src:
        assert src.read(1)[0, 0] == -1


def test_run_refuses_non_comparable_pair(tmp_path):
    shape = (4, 4)
    p = np.full(shape, 0.1, "float32")
    s1 = write_scene(tmp_path / "T1", p, p, np.ones(shape, "uint8"), {"start": "2026-06-18T00:00:00Z"})
    s2 = write_scene(tmp_path / "T2", p, p, np.ones(shape, "uint8"), {"start": "2026-06-18T00:00:00Z"})
    with pytest.raises(ValueError, match="no comparable"):
        ch.run(s1, s2, ROI_ALL, tmp_path / "out", looks=1, threshold_db=3.0, web=False)


def test_run_writes_web_layers_with_diverging_scale(tmp_path):
    shape = (8, 8)
    p = np.full(shape, 0.1, "float32")
    s1 = write_scene(tmp_path / "T1", p, p, np.ones(shape, "uint8"), {"start": "2026-06-18T00:00:00Z"})
    s2 = write_scene(tmp_path / "T2", p * 0.5, p, np.ones(shape, "uint8"), {"start": "2026-10-16T00:00:00Z"})
    out = ch.run(s1, s2, ROI_ALL, tmp_path / "out", looks=2, threshold_db=3.0, web=True)
    manifest = json.loads((out / "web" / "capas.json").read_text(encoding="utf-8"))
    assert manifest["tipo"] == "mapa_de_cambio"
    hh = manifest["capas"][0]
    assert hh["escala"]["colormap"] == "rdbu"
    assert (hh["escala"]["vmin_dB"], hh["escala"]["vmax_dB"]) == (-6.0, 6.0)
    assert (out / "web" / f"{hh['id']}.png").exists()


def test_run_fails_when_roi_does_not_cover_the_scene(tmp_path):
    shape = (4, 4)
    p = np.full(shape, 0.1, "float32")
    s1 = write_scene(tmp_path / "T1", p, p, np.ones(shape, "uint8"), {"start": "2026-06-18T00:00:00Z"})
    s2 = write_scene(tmp_path / "T2", p, p, np.ones(shape, "uint8"), {"start": "2026-10-16T00:00:00Z"})
    with pytest.raises(ValueError, match="ROI"):
        ch.run(s1, s2, ROI_ELSEWHERE, tmp_path / "out", looks=1, threshold_db=3.0, web=False)


def _db_cog(path, arr, transform):
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
                       dtype="float32", crs="EPSG:32615", transform=transform, nodata=np.nan) as dst:
        dst.write(arr.astype("float32"), 1)
    return path


def test_change_from_db_cogs_writes_layers_and_metrics(tmp_path):
    from rasterio.transform import from_origin
    t = from_origin(500000, 1850000, 20, 20)
    a = np.full((6, 6), -10.0, "float32")
    b = a.copy()
    b[:3, :3] = -15.0                                       # 9 px de 400 m² bajan 5 dB
    pairs = {"HH": (_db_cog(tmp_path / "hh1.tif", a, t), _db_cog(tmp_path / "hh2.tif", b, t))}
    info = ch.change_from_db_cogs(pairs, tmp_path / "cambio", t1_id="A", t2_id="B", magnitude="gamma0",
                                  looks=2, threshold_db=3.0, roi_wkt=ROI_ALL)
    assert info["tipo"] == "mapa_de_cambio" and info["t1"] == "A"
    assert info["metricas"]["HH"]["area_disminucion_km2"] == pytest.approx(9 * 400 / 1e6)
    assert info["capas"][0]["capa"] == "HHHH" and (tmp_path / "cambio" / "change.json").is_file()


def test_change_from_db_cogs_rejects_different_grids(tmp_path):
    from rasterio.transform import from_origin
    a = np.zeros((4, 4), "float32")
    pairs = {"HH": (_db_cog(tmp_path / "1.tif", a, from_origin(500000, 1850000, 20, 20)),
                    _db_cog(tmp_path / "2.tif", a, from_origin(500020, 1850000, 20, 20)))}
    with pytest.raises(ValueError, match="malla"):
        ch.change_from_db_cogs(pairs, tmp_path / "c", t1_id="A", t2_id="B", magnitude="gamma0",
                               looks=2, threshold_db=3.0, roi_wkt=ROI_ALL)


def test_diverging_png_colors(tmp_path):
    from pipeline import web_export as web
    arr = np.array([[-5.0, 0.0, 5.0, np.nan]], "float32")
    png = tmp_path / "d.png"
    web.write_png(png, arr, -5.0, 5.0, colormap="rdbu")
    with rasterio.open(png) as src:
        r, g, b, a = src.read()
    assert b[0, 0] > r[0, 0]                       # negativo → azul
    assert r[0, 1] > 240 and g[0, 1] > 240 and b[0, 1] > 240   # cero → blanco
    assert r[0, 2] > b[0, 2]                       # positivo → rojo
    assert a[0, 3] == 0


# --- Ruido de referencia y Δ desde potencia lineal (ROI con multilook y umbral configurables) ---

def test_noise_reference_flags_threshold_close_to_noise():
    rng = np.random.default_rng(0)
    d = rng.normal(0.0, 1.2, 10_000).astype("float32")      # ruido ~1.2 dB: 3 dB < 3 × ruido
    ref = ch.noise_reference(d, ch.robust_zscore(d), threshold_db=3.0)
    assert ref["ruido_dB"] == pytest.approx(1.2, rel=0.05)
    assert ref["umbral_sobre_ruido"] == pytest.approx(3.0 / ref["ruido_dB"])
    assert ref["umbral_cerca_del_ruido"] is True
    assert 0 < ref["pct_abs_z_mayor_3"] < 1                  # ~0.27 % de una normal
    quiet = d * 0.25                                         # ~0.3 dB: 3 dB ≈ 10 × ruido
    assert ch.noise_reference(quiet, ch.robust_zscore(quiet), threshold_db=3.0)["umbral_cerca_del_ruido"] is False


def test_noise_reference_without_valid_pixels():
    d = np.full((2, 2), np.nan, "float32")
    ref = ch.noise_reference(d, d, threshold_db=3.0)
    assert ref["ruido_dB"] is None and ref["umbral_cerca_del_ruido"] is None


def _lin_cog(path, arr, transform):
    return _db_cog(path, arr, transform)


def test_change_from_linear_cogs_multilooks_power_before_db(tmp_path):
    from rasterio.transform import from_origin
    t = from_origin(500000, 1850000, 10, 10)
    a = np.full((10, 10), 0.1, "float32")
    b = a.copy()
    b[:5, :5] = 0.01                                        # un bloque 5×5 baja 10 dB
    b[9, 9] = np.nan                                        # 1 de 25 sin dato: el bloque sigue válido
    pairs = {"HH": (_lin_cog(tmp_path / "h1.tif", a, t), _lin_cog(tmp_path / "h2.tif", b, t))}
    info = ch.change_from_linear_cogs(pairs, tmp_path / "c", t1_id="A", t2_id="B", magnitude="gamma0",
                                      looks=5, threshold_db=3.0, roi_wkt=ROI_ALL, web_scale_db=6.0)
    assert info["multilook"] == 5 and info["pixel_m"] == 50.0
    assert info["capas"][0]["pixel_m"] == 50.0
    with rasterio.open(tmp_path / "c" / "delta_HH_dB.tif") as src:
        d = src.read(1)
        assert src.res == (50.0, 50.0) and d.shape == (2, 2)
    assert d[0, 0] == pytest.approx(-10.0, abs=1e-4) and d[1, 1] == pytest.approx(0.0, abs=1e-4)
    m = info["metricas"]["HH"]
    assert m["area_disminucion_km2"] == pytest.approx(2500 / 1e6)
    assert "ruido_dB" in m and "pct_abs_z_mayor_3" in m and "umbral_cerca_del_ruido" in m
    meta = json.loads((tmp_path / "c" / "change.json").read_text(encoding="utf-8"))
    assert meta["parametros"]["multilook_metodo"] == "promedio de potencia lineal n×n antes del dB"
    assert meta["parametros"]["pixel_m"] == 50.0


def test_change_from_linear_cogs_rejects_different_grids(tmp_path):
    from rasterio.transform import from_origin
    a = np.ones((4, 4), "float32")
    pairs = {"HH": (_lin_cog(tmp_path / "1.tif", a, from_origin(500000, 1850000, 10, 10)),
                    _lin_cog(tmp_path / "2.tif", a, from_origin(500010, 1850000, 10, 10)))}
    with pytest.raises(ValueError, match="malla"):
        ch.change_from_linear_cogs(pairs, tmp_path / "c", t1_id="A", t2_id="B", magnitude="gamma0",
                                   looks=2, threshold_db=3.0, roi_wkt=ROI_ALL)


def test_manifest_warns_when_threshold_is_close_to_noise(tmp_path):
    from rasterio.transform import from_origin
    t = from_origin(500000, 1850000, 10, 10)
    rng = np.random.default_rng(1)
    a = np.full((40, 40), 0.1, "float32")
    b = (a * 10 ** (rng.normal(0, 2.0, a.shape) / 10)).astype("float32")   # ~2 dB de ruido por píxel
    pairs = {"HH": (_lin_cog(tmp_path / "1.tif", a, t), _lin_cog(tmp_path / "2.tif", b, t))}
    info = ch.change_from_linear_cogs(pairs, tmp_path / "c", t1_id="A", t2_id="B", magnitude="gamma0",
                                      looks=1, threshold_db=3.0, roi_wkt=ROI_ALL)
    assert info["metricas"]["HH"]["umbral_cerca_del_ruido"] is True
    assert any("ruido" in w for w in info["advertencias"])
