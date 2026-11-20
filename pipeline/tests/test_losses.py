"""Lumped rain losses and inverse-barometer surge, as in the terrapulseai_v2.1 flood simulator."""
import math

import pytest

from pipeline.hydrology.losses import barometric_surge_m, effective_rainfall, runoff_coefficient


@pytest.mark.parametrize('duration_s, expected', [
    (600, .65 + .27 * (1 - math.exp(-.5 / 24))),       # shorter than 0.5 h is clamped to 0.5 h
    (24 * 3600, .65 + .27 * (1 - math.exp(-1))),
    (72 * 3600, .65 + .27 * (1 - math.exp(-3))),
    (1e7, .92),                                        # saturates at 0.92
])
def test_runoff_coefficient_matches_the_v2_horton_saturation(duration_s, expected):
    assert runoff_coefficient(duration_s) == pytest.approx(expected)


@pytest.mark.parametrize('pressure, surge', [(1003.25, 1000 / 9810), (950, 6325 / 9810), (1013.25, 0), (1040, 0)])
def test_barometric_surge_is_one_centimetre_per_hectopascal_below_standard(pressure, surge):
    assert barometric_surge_m(pressure) == pytest.approx(surge)


@pytest.mark.parametrize('pressure', [949.9, 1040.1, True, float('nan'), '1000', None])
def test_barometric_surge_rejects_pressure_outside_950_1040_hpa(pressure):
    with pytest.raises(ValueError):
        barometric_surge_m(pressure)


def test_effective_rainfall_scales_amount_or_intensity_and_keeps_the_rest():
    assert effective_rainfall({'amount': 20, 'unit': 'mm', 'duration': 600, 'duration_unit': 's'}, .5) == \
        {'amount': 10, 'unit': 'mm', 'duration': 600, 'duration_unit': 's'}
    assert effective_rainfall({'intensity': 40, 'intensity_unit': 'mm/h', 'duration': 1, 'duration_unit': 'h'}, .25) == \
        {'intensity': 10, 'intensity_unit': 'mm/h', 'duration': 1, 'duration_unit': 'h'}
