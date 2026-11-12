"""Pruebas de normalización de metadatos (sin red)."""
from types import SimpleNamespace

from pipeline.sources.asf import product_to_scene
from pipeline.sources.base import SceneMeta


def fake_asf_product(**overrides):
    props = {
        "sceneName": "SYNTH_SCENE",
        "processingLevel": "GCOV",
        "pathNumber": 55,
        "frameNumber": 80,
        "flightDirection": "DESCENDING",
        "mainBandPolarization": ["HH", "HV"],
        "crid": "P00000",
        "startTime": "2026-01-01T00:00:00Z",
        "frameCoverage": "Full",
        "orbitType": "MOE",
        "url": "https://example.invalid/SYNTH_SCENE.h5",
        "fileName": "SYNTH_SCENE.h5",
        "bytes": {"SYNTH_SCENE.h5": {"bytes": 123, "format": "HDF5"}},
    }
    props.update(overrides)
    umm = {"AdditionalAttributes": [{"Name": "PRODUCT_VERSION", "Values": ["1.0.0"]}]}
    return SimpleNamespace(properties=props, umm=umm)


def test_product_to_scene_maps_fields():
    s = product_to_scene(fake_asf_product(), "PROVISIONAL")
    assert (s.product, s.track, s.frame, s.direction) == ("GCOV", 55, 80, "DESCENDING")
    assert s.polarizations == ("HH", "HV")
    assert (s.crid, s.maturity, s.product_version, s.size_bytes) == ("P00000", "PROVISIONAL", "1.0.0", 123)
    assert s.source == "asf" and s.date == "2026-01-01"


def test_umm_polarization_takes_precedence():
    p = fake_asf_product()
    p.umm["AdditionalAttributes"].append({"Name": "FREQUENCY_A_POLARIZATION", "Values": ["HV"]})
    assert product_to_scene(p, None).polarizations == ("HV",)


def test_missing_fields_stay_none():
    p = fake_asf_product(crid=None, frameNumber=None, mainBandPolarization=None)
    p.umm = {}
    s = product_to_scene(p, None)
    assert s.crid is None and s.frame is None and s.maturity is None
    assert s.polarizations == () and s.product_version is None


def test_scene_meta_roundtrip():
    s = product_to_scene(fake_asf_product(), "PROVISIONAL")
    assert SceneMeta.from_dict(s.to_dict()) == s
