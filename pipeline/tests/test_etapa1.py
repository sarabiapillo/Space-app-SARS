"""Pruebas de etapa1 (local y remoto) y de las capas web, con un GCOV SINTÉTICO (no son datos reales)."""
import json

import h5py
import numpy as np
import pytest
import rasterio

from pipeline import etapa1
from pipeline.tests.test_subset import ROI, make_gcov, scene

CONFIG_YAML = f"roi:\n  wkt: \"{ROI}\"\npaths:\n  catalog: data/catalog\n"


def add_radar_grid(path):
    """Cubo de incidencia mínimo (3 alturas) que cubre la malla sintética, y la fecha de inicio."""
    with h5py.File(path, "a") as f:
        g = f["science/LSAR/GCOV/grids/frequencyA"]
        x, y = g["xCoordinates"][()], g["yCoordinates"][()]
        r = f.create_group("science/LSAR/GCOV/metadata/radarGrid")
        r["heightAboveEllipsoid"] = np.array([0.0, 500.0, 1000.0])
        r["xCoordinates"] = np.linspace(x[0] - 500, x[-1] + 500, 15)
        r["yCoordinates"] = np.linspace(y[0] + 500, y[-1] - 500, 15)
        r["incidenceAngle"] = np.broadcast_to(np.linspace(30, 40, 15), (3, 15, 15)).astype(np.float32)
        r["incidenceAngle"].attrs["units"] = np.bytes_("degrees")
        f["science/LSAR/identification/zeroDopplerStartTime"] = np.bytes_("2026-06-18T00:40:48")


@pytest.fixture
def gcov(tmp_path):
    path, hh = make_gcov(tmp_path / "SYNTH_GCOV_T55_D1.h5")
    add_radar_grid(path)
    cfg = tmp_path / "config.yaml"
    cfg.write_text(CONFIG_YAML, encoding="utf-8")
    return path, cfg


def run(entrada, cfg, tmp_path, *extra):
    return etapa1.main([str(entrada), "--config", str(cfg), "--salida", str(tmp_path / "explore"),
                        "--sin-figuras", *extra])


def test_local_run_writes_web_layers(gcov, tmp_path):
    path, cfg = gcov
    out = run(path, cfg, tmp_path)
    meta = json.loads((out / "metadatos.json").read_text(encoding="utf-8"))
    assert meta["procedencia"]["modo"] == "local"
    assert meta["archivo_h5"]["bytes"] == path.stat().st_size

    man = json.loads((out / "web" / "capas.json").read_text(encoding="utf-8"))
    ids = {c["id"] for c in man["capas"]}
    assert ids == {"gamma0_HHHH_ml2_dB", "gamma0_HVHV_ml2_dB", "sigma0_HHHH_ml2_dB", "sigma0_HVHV_ml2_dB"}
    c = next(c for c in man["capas"] if c["id"] == "gamma0_HHHH_ml2_dB")

    # El COG guarda exactamente el dB con multilook que calcula etapa1 (mismo archivo que en geotiff/)
    with rasterio.open(out / "web" / "gamma0_HHHH_ml2_dB.tif") as cog, \
            rasterio.open(out / "geotiff" / "gamma0_HHHH_ml2_dB.tif") as ref:
        np.testing.assert_array_equal(cog.read(1), ref.read(1))
        assert cog.transform == ref.transform and cog.crs == ref.crs

    # El PNG está en Web Mercator: RGBA, transparente donde no hay dato
    with rasterio.open(out / "web" / "gamma0_HHHH_ml2_dB.png") as png:
        assert png.count == 4
        alpha = png.read(4)
    assert (alpha == 0).any() and (alpha == 255).any()          # la mitad oeste está fuera de la adquisición
    lons = [p[0] for p in c["esquinas_lonlat"]]
    lats = [p[1] for p in c["esquinas_lonlat"]]
    assert lons[0] == lons[3] and lons[1] == lons[2] and lons[0] < lons[1]     # sup-izq, sup-der, inf-der, inf-izq
    assert lats[0] == lats[1] and lats[2] == lats[3] and lats[0] > lats[2]
    assert -93.02 < lons[0] < -92.98 and 16.79 < lats[2] < 16.82
    assert c["escala"]["vmin_dB"] < c["escala"]["vmax_dB"]


def test_fixed_web_scale_is_recorded(gcov, tmp_path):
    path, cfg = gcov
    out = run(path, cfg, tmp_path, "--escala-web", "-25", "0")
    man = json.loads((out / "web" / "capas.json").read_text(encoding="utf-8"))
    assert all(c["escala"]["vmin_dB"] == -25 and c["escala"]["vmax_dB"] == 0 for c in man["capas"])
    assert all(c["escala"]["metodo"].startswith("fija") for c in man["capas"])


class FakeHTTPS:
    """Sustituye al sistema de archivos de Earthdata: 'descarga' la URL desde un archivo local."""

    def __init__(self, path):
        self.path, self.opened = path, []

    def open(self, url, mode="rb", **kw):
        self.opened.append((url, kw))
        return open(self.path, mode)


def write_catalog(tmp_path, s):
    cat = tmp_path / "catalog_20261114T000000Z.json"
    cat.write_text(json.dumps({"scenes": [s.to_dict()]}), encoding="utf-8")
    return cat


def test_remote_run_by_scene_id(gcov, tmp_path, monkeypatch):
    path, cfg = gcov
    s = scene(url="https://ejemplo.invalid/SYNTH_GCOV_T55_D1.h5", size_bytes=123)
    cat = write_catalog(tmp_path, s)
    fake = FakeHTTPS(path)
    monkeypatch.setattr("pipeline.sources.asf.earthdata_https_fs", lambda: fake)

    out = run(s.scene_id, cfg, tmp_path, "--catalogo", str(cat))
    assert fake.opened[0][0] == s.url
    assert fake.opened[0][1]["cache_type"] == "blockcache"
    meta = json.loads((out / "metadatos.json").read_text(encoding="utf-8"))
    proc = meta["procedencia"]
    assert proc["modo"] == "remoto" and proc["url"] == s.url and proc["identidad_verificada_contra_catalogo"]
    assert meta["archivo_h5"] == {"nombre": "SYNTH_GCOV_T55_D1.h5", "bytes": 123}
    man = json.loads((out / "web" / "capas.json").read_text(encoding="utf-8"))
    assert man["escena"]["madurez_catalogo"] == "PROVISIONAL"

    # Mismos valores que leyendo el archivo local
    local = run(path, cfg, tmp_path / "local")
    with rasterio.open(out / "geotiff" / "gamma0_HVHV.tif") as a, rasterio.open(local / "geotiff" / "gamma0_HVHV.tif") as b:
        np.testing.assert_array_equal(a.read(1), b.read(1))


def test_remote_identity_mismatch_stops(gcov, tmp_path, monkeypatch):
    path, cfg = gcov
    s = scene(url="https://ejemplo.invalid/x.h5", track=62)          # el catálogo dice T62; el archivo es T55
    cat = write_catalog(tmp_path, s)
    monkeypatch.setattr("pipeline.sources.asf.earthdata_https_fs", lambda: FakeHTTPS(path))
    with pytest.raises(ValueError, match="trackNumber"):
        run(s.scene_id, cfg, tmp_path, "--catalogo", str(cat))


def test_missing_h5_path_is_an_error(gcov, tmp_path):
    _, cfg = gcov
    with pytest.raises(FileNotFoundError):
        run(tmp_path / "no_existe.h5", cfg, tmp_path)


def test_chart_data_matches_figure_inputs(gcov, tmp_path):
    """graficas.json guarda los mismos números que usan las figuras, sin perder conteos."""
    path, cfg = gcov
    out = run(path, cfg, tmp_path)
    meta = json.loads((out / "metadatos.json").read_text(encoding="utf-8"))
    data = json.loads((out / "graficas.json").read_text(encoding="utf-8"))
    assert meta["graficas"].endswith("graficas.json")
    assert data["escena"]["granuleId"] == meta["identificacion"]["granuleId"]
    assert data["version_codigo"] == meta["version_codigo"]
    charts = {c["id"]: c for c in data["graficas"]}
    assert set(charts) == {"histograma_gamma0_dB", "mascara_roi", "incidencia_por_altura"}

    h = charts["histograma_gamma0_dB"]
    assert h["eje_x"]["unidad"] == "dB" and h["eje_x"]["ancho_bin"] == pytest.approx(0.1)
    for s in h["series"]:
        st = meta["estadisticas_roi"][s["nombre"]]["gamma0"]
        # cada píxel válido con γ⁰ > 0 cae en un bin o en fuera_de_rango
        assert sum(s["conteos"]) == s["total_en_rango"]
        assert s["total_en_rango"] + s["fuera_de_rango"] == st["n_validos"] - st["n_ceros"]
        if s["total_en_rango"]:
            assert s["conteos"][0] > 0 and s["conteos"][-1] > 0      # recortado a bins con datos
        else:
            assert s["conteos"] == []                                 # el GCOV sintético queda > 30 dB
        assert s["estadisticas"]["media_dB"] == st["media_dB"]

    m = charts["mascara_roi"]
    pct = meta["roi"]["pct_mascara_en_ventana"]
    assert dict(zip(m["categorias"], m["series"][0]["valores"])) == pct
    assert sum(m["series"][0]["valores"]) == pytest.approx(100)

    inc = charts["incidencia_por_altura"]
    by_h = meta["incidencia"]["media_en_roi_por_altura"]
    assert inc["x"] == [0.0, 500.0, 1000.0]
    assert inc["series"][0]["valores"] == [by_h[str(h)] if str(h) in by_h else by_h[h] for h in inc["x"]]
    assert inc["eje_y"]["unidad"] == "degrees"

    man = json.loads((out / "web" / "capas.json").read_text(encoding="utf-8"))
    assert man["graficas"] == meta["graficas"]


def test_histogram_chart_keeps_out_of_range_and_trims():
    from pipeline import graficas_datos as gd
    edges = np.arange(-2.0, 2.0 + 0.5, 0.5)                     # 8 bins
    counts = np.array([0, 0, 3, 0, 5, 1, 0, 0])
    c = gd.histogram_chart("gamma0", "γ⁰", {"HHHH": counts}, edges, {"HHHH": {"media_dB": -1.0}}, {"HHHH": 2})
    s = c["series"][0]
    assert s["bin_inicio_dB"] == -1.0 and s["conteos"] == [3, 0, 5, 1]
    assert s["total_en_rango"] == 9 and s["fuera_de_rango"] == 2
    vacio = gd.histogram_chart("gamma0", "γ⁰", {"HHHH": np.zeros(8, int)}, edges, {"HHHH": {}}, {"HHHH": 4})
    assert vacio["series"][0]["conteos"] == [] and vacio["series"][0]["fuera_de_rango"] == 4
