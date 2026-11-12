"""Pruebas de compat.py con escenas sintéticas (no son datos reales)."""
from dataclasses import replace

import pytest

from pipeline.compat import check_pair, stack_key
from pipeline.sources.base import SceneMeta


@pytest.fixture
def scene():
    return SceneMeta(
        scene_id="SYNTH_T1",
        source="test",
        product="GCOV",
        track=55,
        frame=80,
        direction="DESCENDING",
        polarizations=("HH", "HV"),
        crid="P00000",
        maturity="PROVISIONAL",
        start_time="2026-01-01T00:00:00Z",
        frame_coverage="Full",
        orbit_type="MOE",
        product_version="1.0.0",
    )


def later(s, **changes):
    return replace(s, scene_id="SYNTH_T2", start_time="2026-01-13T00:00:00Z", **changes)


def test_identical_stack_is_comparable(scene):
    r = check_pair(scene, later(scene))
    assert r.comparable and r.errors == []


def test_polarization_order_does_not_matter(scene):
    assert check_pair(scene, later(scene, polarizations=("HV", "HH"))).comparable


@pytest.mark.parametrize(
    "field,value",
    [
        ("product", "GSLC"),
        ("track", 62),
        ("frame", 10),
        ("direction", "ASCENDING"),
        ("polarizations", ("HV",)),
        ("crid", "P99999"),
        ("maturity", "BETA"),
    ],
)
def test_any_strict_mismatch_blocks(scene, field, value):
    r = check_pair(scene, later(scene, **{field: value}))
    assert not r.comparable
    assert any(e.startswith(field) for e in r.errors)


@pytest.mark.parametrize("field", ["crid", "maturity", "track"])
def test_unknown_value_blocks(scene, field):
    r = check_pair(scene, later(scene, **{field: None}))
    assert not r.comparable


def test_empty_polarizations_block(scene):
    assert not check_pair(scene, later(scene, polarizations=())).comparable


def test_same_acquisition_blocks(scene):
    r = check_pair(scene, replace(scene, scene_id="SYNTH_DUP"))
    assert not r.comparable
    assert any("misma adquisición" in e for e in r.errors)


def test_partial_coverage_and_orbit_type_are_warnings(scene):
    r = check_pair(scene, later(scene, frame_coverage="Partial", orbit_type="FOE"))
    assert r.comparable
    assert any("cobertura" in w for w in r.warnings)
    assert any("órbita" in w for w in r.warnings)


def test_stack_key_groups_by_strict_fields(scene):
    assert stack_key(scene) == stack_key(later(scene, polarizations=("HV", "HH")))
    assert stack_key(scene) != stack_key(later(scene, crid="P99999"))
