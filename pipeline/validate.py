"""Validation metrics: a predicted water extent against an independent observed water mask.

Precision = TP / (TP + FP), recall = TP / (TP + FN), F1 = 2PR / (P + R), IoU = TP / (TP + FP + FN),
counted only on cells marked valid in both sources. A score whose denominator is zero is ``None``,
never zero: "nothing to compare" is not "wrong".
"""
from __future__ import annotations

import numpy as np
from rasterio.warp import Resampling, reproject


def _ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def compare_masks(predicted, observed, valid=None):
    predicted, observed = np.asarray(predicted, bool), np.asarray(observed, bool)
    valid = np.ones(predicted.shape, bool) if valid is None else np.asarray(valid, bool)
    if not predicted.shape == observed.shape == valid.shape:
        raise ValueError('predicted, observed and valid masks must share one grid')
    tp = int(np.count_nonzero(predicted & observed & valid))
    fp = int(np.count_nonzero(predicted & ~observed & valid))
    fn = int(np.count_nonzero(~predicted & observed & valid))
    tn = int(np.count_nonzero(~predicted & ~observed & valid))
    precision, recall = _ratio(tp, tp + fp), _ratio(tp, tp + fn)
    f1 = None if precision is None or recall is None else _ratio(2 * precision * recall, precision + recall)
    return {'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn, 'valid_cells': int(valid.sum()),
            'precision': precision, 'recall': recall, 'f1': f1, 'iou': _ratio(tp, tp + fp + fn)}


def mask_on_grid(mask, transform, crs, shape, dst_transform, dst_crs, *, valid=None, min_fraction=.5):
    """Water fraction of a fine mask on a coarser grid (area average) and the mask where it is >= ``min_fraction``.

    Cells of ``mask`` outside ``valid`` do not count; target cells with no valid source stay NaN and False.
    """
    source = np.asarray(mask, 'float32')
    if valid is not None:
        source = np.where(np.asarray(valid, bool), source, np.nan)
    fraction = np.full(shape, np.nan, 'float32')
    reproject(source, fraction, src_transform=transform, src_crs=crs, dst_transform=dst_transform, dst_crs=dst_crs,
              src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.average)
    return np.nan_to_num(fraction, nan=0) >= min_fraction, fraction
