"""Validation metrics of a simulated flood extent against an observed water mask."""
import numpy as np
import pytest
from rasterio.transform import from_origin

from pipeline.validate import compare_masks, mask_on_grid


def test_scores_count_hits_misses_and_false_alarms_on_valid_cells_only():
    predicted = np.array([[1, 1, 0], [0, 1, 0]], bool)
    observed = np.array([[1, 0, 0], [1, 1, 1]], bool)
    valid = np.array([[1, 1, 1], [1, 1, 0]], bool)  # last cell (observed water) is not comparable
    result = compare_masks(predicted, observed, valid)
    assert (result['tp'], result['fp'], result['fn'], result['tn']) == (2, 1, 1, 1)
    assert result['precision'] == pytest.approx(2 / 3) and result['recall'] == pytest.approx(2 / 3)
    assert result['f1'] == pytest.approx(2 / 3) and result['iou'] == pytest.approx(.5)
    assert result['valid_cells'] == 5


def test_undefined_scores_are_none_not_zero():
    nothing = np.zeros((2, 2), bool)
    result = compare_masks(nothing, nothing)
    assert result['precision'] is None and result['recall'] is None and result['f1'] is None and result['iou'] is None


def test_shapes_must_match():
    with pytest.raises(ValueError):
        compare_masks(np.zeros((2, 2), bool), np.zeros((2, 3), bool))


def test_fine_mask_becomes_water_where_at_least_half_of_the_coarse_cell_is_water():
    fine = np.zeros((6, 6), bool)
    fine[:3, :3] = True          # whole top-left 30 m cell
    fine[3:, 3:5] = True         # 6 of 9 fine cells of the bottom-right cell
    fine[0, 3] = True            # 1 of 9 of the top-right cell
    coarse, fraction = mask_on_grid(fine, from_origin(500000, 1850000, 10, 10), 'EPSG:32615',
                                    (2, 2), from_origin(500000, 1850000, 30, 30), 'EPSG:32615')
    assert coarse.tolist() == [[True, False], [False, True]]
    assert fraction[1, 1] == pytest.approx(6 / 9)
