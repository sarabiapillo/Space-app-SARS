"""Pruebas de preprocess.py con rasters sintéticos (no son datos reales)."""
import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline import preprocess as pp

CRS = "EPSG:32615"
T = from_origin(500000, 1850000, 10, 10)


def test_prepare_layer_masks_invalid_and_outside_pixels():
    power = np.full((4, 4), 0.1, dtype="float32")
    mask = np.full((4, 4), 1, dtype="uint8")
    mask[0, 0] = 0      # no válido
    mask[0, 1] = 255    # fuera de la adquisición
    db = pp.prepare_layer(power, mask, looks=1)
    assert np.isnan(db[0, 0]) and np.isnan(db[0, 1])
    assert db[1, 1] == pytest.approx(-10.0)


def test_prepare_layer_applies_gamma_to_sigma_factor_before_db():
    power = np.full((2, 2), 0.1, dtype="float32")
    factor = np.full((2, 2), 0.5, dtype="float32")
    db = pp.prepare_layer(power, np.ones((2, 2), "uint8"), factor=factor, looks=1)
    assert db[0, 0] == pytest.approx(10 * np.log10(0.05), abs=1e-5)


def test_prepare_layer_multilooks_in_linear_power_not_in_db():
    power = np.array([[1.0, 0.01], [1.0, 0.01]], dtype="float32")
    db = pp.prepare_layer(power, np.ones((2, 2), "uint8"), looks=2)
    assert db.shape == (1, 1)
    assert db[0, 0] == pytest.approx(10 * np.log10(0.505), abs=1e-5)   # no la media de los dB (−10)


def test_prepare_layer_outside_roi_is_nan():
    power = np.full((2, 2), 0.1, dtype="float32")
    inside = np.array([[True, False], [True, True]])
    db = pp.prepare_layer(power, np.ones((2, 2), "uint8"), looks=1, inside_roi=inside)
    assert np.isnan(db[0, 1]) and np.isfinite(db[0, 0])


def test_roi_mask_uses_polygon_in_lonlat():
    t = from_origin(-93.5, 17.0, 0.1, 0.1)
    wkt = "POLYGON((-93.3 16.7,-93.1 16.7,-93.1 16.9,-93.3 16.9,-93.3 16.7))"
    inside = pp.roi_mask(wkt, "EPSG:4326", t, (10, 10))
    assert inside.sum() == 4
    assert inside[1:3, 2:4].all()


def write_scene(d, power_hh, power_hv, mask, extra=None):
    """Escena sintética con el contrato C1 (scene.json + GeoTIFF por capa)."""
    d.mkdir(parents=True)
    prof = dict(driver="GTiff", height=mask.shape[0], width=mask.shape[1], count=1, crs=CRS, transform=T)
    for name, arr in (("HHHH", power_hh), ("HVHV", power_hv), ("mask", mask),
                      ("rtcGammaToSigmaFactor", np.ones(mask.shape, "float32"))):
        with rasterio.open(d / f"{name}.tif", "w", dtype=arr.dtype, **prof) as dst:
            dst.write(arr, 1)
    scene = {
        "contrato": "C1",
        "scene": {"scene_id": d.name, "source": "test", "product": "GCOV", "track": 62, "frame": 10,
                  "direction": "ASCENDING", "polarizations": ["HH", "HV"], "crid": "P00000",
                  "maturity": "PROVISIONAL", "start_time": (extra or {}).get("start", "2026-01-01T00:00:00Z"),
                  "frame_coverage": "Full", "orbit_type": "MOE", "product_version": "1.0.0"},
        "malla": {"epsg": 32615, "dx_m": 10.0, "dy_m": -10.0, "magnitud_potencia": "gamma0",
                  "ventana": {"fila0": 0, "fila1": mask.shape[0], "col0": 0, "col1": mask.shape[1]},
                  "forma_recorte": list(mask.shape), "transform_recorte": list(T)[:6]},
        "capas": {"HHHH": {"archivo": "HHHH.tif"}, "HVHV": {"archivo": "HVHV.tif"},
                  "mask": {"archivo": "mask.tif"},
                  "rtcGammaToSigmaFactor": {"archivo": "rtcGammaToSigmaFactor.tif"}},
    }
    (d / "scene.json").write_text(json.dumps(scene), encoding="utf-8")
    return d


def test_load_scene_reads_c1_contract(tmp_path):
    shape = (4, 6)
    d = write_scene(tmp_path / "S1", np.full(shape, 0.1, "float32"), np.full(shape, 0.01, "float32"),
                    np.ones(shape, "uint8"))
    s = pp.load_scene(d)
    assert s.meta.scene_id == "S1" and s.meta.polarizations == ("HH", "HV")
    assert s.crs == CRS and s.transform == T and s.shape == shape
    assert s.magnitude == "gamma0"
    assert s.read("HHHH")[0, 0] == pytest.approx(0.1)


def test_load_scene_without_contract_fails(tmp_path):
    with pytest.raises(FileNotFoundError):
        pp.load_scene(tmp_path)
