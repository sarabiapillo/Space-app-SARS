"""Pruebas del recorte a la ROI (sources/subset.py) con un GCOV SINTÉTICO (no son datos reales)."""
import json

import h5py
import numpy as np
import pytest
import rasterio
from pyproj import Transformer

from pipeline.sources import SceneMeta
from pipeline.sources.asf import ASFSource
from pipeline.sources.subset import compare_grids, write_subset

EPSG = 32615
ROI = "POLYGON((-93.01 16.80,-92.99 16.80,-92.99 16.81,-93.01 16.81,-93.01 16.80))"
N = 60


def scene(scene_id="SYNTH_GCOV_T55_D1", **kw):
    base = dict(scene_id=scene_id, source="asf", product="GCOV", track=55, frame=80, direction="DESCENDING",
                polarizations=("HH", "HV"), crid="P05023", maturity="PROVISIONAL",
                start_time="2026-06-18T00:40:48Z", url=None)
    base.update(kw)
    return SceneMeta(**base)


def make_gcov(path, granule="SYNTH_GCOV_T55_D1", track=55, x_shift=0.0):
    t = Transformer.from_crs(4326, EPSG, always_xy=True)
    cx, cy = t.transform(-93.0, 16.805)
    x = np.round(cx) - 3000 + 50 + 100 * np.arange(N) + x_shift
    y = np.round(cy) + 3000 - 50 - 100 * np.arange(N)
    hh = np.arange(N * N, dtype=np.float32).reshape(N, N) + 1
    hh[20, 20] = np.nan
    mask = np.ones((N, N), dtype=np.uint8)
    mask[:, :30] = 255                      # mitad oeste fuera de la adquisición
    with h5py.File(path, "w") as f:
        i = f.create_group("science/LSAR/identification")
        i["productType"] = np.bytes_("GCOV")
        i["granuleId"] = np.bytes_(granule)
        i["compositeReleaseId"] = np.bytes_("P05023")
        i["trackNumber"] = np.int64(track)
        i["frameNumber"] = np.int64(80)
        i["orbitPassDirection"] = np.bytes_("Descending")
        g = f.create_group("science/LSAR/GCOV/grids/frequencyA")
        g.create_dataset("HHHH", data=hh, chunks=(16, 16), compression="gzip")
        g.create_dataset("HVHV", data=hh / 10, chunks=(16, 16), compression="gzip")
        g["HHHH"].attrs["units"] = np.bytes_("1")
        g["mask"] = mask
        g["numberOfLooks"] = np.full((N, N), 4.0, dtype=np.float32)
        g["rtcGammaToSigmaFactor"] = np.full((N, N), 0.8, dtype=np.float32)
        g["xCoordinates"], g["yCoordinates"] = x, y
        g["xCoordinateSpacing"], g["yCoordinateSpacing"] = 100.0, -100.0
        g["listOfPolarizations"] = np.array([b"HH", b"HV"])
        g["listOfCovarianceTerms"] = np.array([b"HHHH", b"HHHV", b"HVHV"])
        g["projection"] = np.uint32(EPSG)
        g["projection"].attrs["epsg_code"] = EPSG
        p = f.create_group("science/LSAR/GCOV/metadata/processingInformation/parameters")
        p["rtc/outputBackscatterExpressionConvention"] = np.bytes_("Linear power")
        p["rtc/outputBackscatterNormalizationConvention"] = np.bytes_("gamma0")
    return path, hh


PROV = {"fuente": "test", "metodo": "sintético"}


def test_subset_copies_window_values_exactly(tmp_path):
    path, hh = make_gcov(tmp_path / "a.h5")
    with h5py.File(path, "r") as f:
        out = write_subset(f, scene(), ROI, ["HHHH", "mask"], tmp_path / "raw", PROV, code_version="test")
    meta = json.loads((tmp_path / "raw" / "SYNTH_GCOV_T55_D1" / "scene.json").read_text(encoding="utf-8"))
    w = meta["malla"]["ventana"]
    with rasterio.open(out[0]) as src:
        arr = src.read(1)
        assert src.crs.to_epsg() == EPSG
        assert np.isnan(src.nodata)
        # el píxel (0,0) del recorte cae en el centro de la columna/fila col0/fila0 de la malla
        x0, y0 = src.xy(0, 0)
    expected = hh[w["fila0"]:w["fila1"], w["col0"]:w["col1"]]
    np.testing.assert_array_equal(arr, expected)      # sin dB, sin máscara: copia fiel (NaN incluido)
    with h5py.File(path, "r") as f:
        g = f["science/LSAR/GCOV/grids/frequencyA"]
        assert x0 == pytest.approx(g["xCoordinates"][w["col0"]])
        assert y0 == pytest.approx(g["yCoordinates"][w["fila0"]])
    assert meta["contrato"] == "C1"
    assert meta["capas"]["HHHH"]["unidades"] == "1"
    assert meta["identificacion_h5"]["granuleId"] == "SYNTH_GCOV_T55_D1"


def test_coverage_counts_only_polygon_pixels(tmp_path):
    path, _ = make_gcov(tmp_path / "a.h5")
    with h5py.File(path, "r") as f:
        write_subset(f, scene(), ROI, ["mask"], tmp_path / "raw", PROV, code_version="test")
    cov = json.loads((tmp_path / "raw" / "SYNTH_GCOV_T55_D1" / "scene.json").read_text(encoding="utf-8"))["cobertura_roi"]
    assert cov["pixeles_en_poligono"] > 0
    assert 0 < cov["pct_valido"] < 100        # la mitad oeste está fuera de la adquisición
    assert cov["pct_valido"] + cov["pct_fuera_adquisicion"] + cov["pct_no_valido"] == pytest.approx(100)


def test_identity_mismatch_is_rejected(tmp_path):
    path, _ = make_gcov(tmp_path / "a.h5", track=62)
    with h5py.File(path, "r") as f, pytest.raises(ValueError, match="trackNumber"):
        write_subset(f, scene(), ROI, ["HHHH"], tmp_path / "raw", PROV, code_version="test")


def test_unknown_layer_is_rejected(tmp_path):
    path, _ = make_gcov(tmp_path / "a.h5")
    with h5py.File(path, "r") as f, pytest.raises(ValueError, match="no disponibles"):
        write_subset(f, scene(), ROI, ["VVVV"], tmp_path / "raw", PROV, code_version="test")


def test_layers_accumulate_in_scene_json(tmp_path):
    path, _ = make_gcov(tmp_path / "a.h5")
    for layer in ("HHHH", "HVHV"):
        with h5py.File(path, "r") as f:
            write_subset(f, scene(), ROI, [layer], tmp_path / "raw", PROV, code_version="test")
    meta = json.loads((tmp_path / "raw" / "SYNTH_GCOV_T55_D1" / "scene.json").read_text(encoding="utf-8"))
    assert set(meta["capas"]) == {"HHHH", "HVHV"}


def test_compare_grids_detects_shifted_grid(tmp_path):
    p1, _ = make_gcov(tmp_path / "a.h5", granule="A")
    p2, _ = make_gcov(tmp_path / "b.h5", granule="B")
    p3, _ = make_gcov(tmp_path / "c.h5", granule="C", x_shift=30.0)
    metas = []
    for p, sid in ((p1, "A"), (p2, "B"), (p3, "C")):
        with h5py.File(p, "r") as f:
            write_subset(f, scene(sid), ROI, ["mask"], tmp_path / "raw", PROV, code_version="test")
        metas.append(json.loads((tmp_path / "raw" / sid / "scene.json").read_text(encoding="utf-8")))
    assert compare_grids(metas[0], metas[1]) == []
    assert any("transform" in d for d in compare_grids(metas[0], metas[2]))


def test_asf_local_h5_path(tmp_path):
    path, _ = make_gcov(tmp_path / "a.h5")
    out = ASFSource().fetch_subsets(scene(), ROI, ["HHHH"], tmp_path / "raw", local_h5=path)
    meta = json.loads((out[0].parent / "scene.json").read_text(encoding="utf-8"))
    assert meta["procedencia"]["metodo"] == "h5py, archivo local"
