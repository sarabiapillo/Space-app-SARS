"""Offline, read-only Acapulco replay from the exact ROI and solar inputs in a manifest.

The caller supplies the expected SHA-256 of the *local* NASADEM archive. A tile ID
is not sufficient provenance; do not treat a match here as proof of production DEM identity.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio

from pipeline.solar.surface import compute_incident_irradiance


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--tile', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--incident', type=Path, help='optional read-only production TIFF comparison')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    expected = args.expected_sha256.lower()
    actual = sha256(args.tile)
    if len(expected) != 64 or actual != expected:
        parser.error('local NASADEM archive SHA-256 mismatch; refusing simulation')
    tile_ids = manifest['position']['dem_tile_ids']
    if tile_ids != ['n16w100'] or args.tile.name != 'n16w100.zip':
        parser.error('Acapulco manifest/tile mismatch; refusing substitution')

    class Granule:
        tile_id = 'n16w100'
        path = args.tile

    class CachedProvider:
        def acquire_roi(self, roi):
            return [Granule()]

    request = manifest['request']
    result = compute_incident_irradiance(
        roi=request['roi'], provider=CachedProvider(),
        elevation_deg=request['elevation_deg'], azimuth_deg=request['azimuth_deg'],
        intensity_percent=request['intensity_percent'],
    )
    values = np.asarray(result['incident_w_m2'], dtype='float32')
    mask = np.asarray(result['valid_mask'], dtype=bool)
    valid = values[mask].astype('float64')
    report = {
        'nasadem_sha256': actual, 'tile_id': 'n16w100',
        'crs': str(result['crs']), 'transform_gdal': list(result['transform']),
        'shape': list(values.shape), 'valid_cells': int(mask.sum()),
        'mask_sha256': hashlib.sha256(mask.tobytes()).hexdigest(),
        'incident_float32_sha256': hashlib.sha256(values.tobytes()).hexdigest(),
        'representative_altitude_m': float(result['position']['altitude_m']),
        'dni_adjusted_w_m2': float(result['clear_sky']['dni_adjusted_w_m2']),
        'min': float(valid.min()), 'p2': float(np.percentile(valid, 2)),
        'median': float(np.median(valid)), 'p98': float(np.percentile(valid, 98)),
        'max': float(valid.max()), 'mean': float(valid.mean()),
    }
    if args.incident:
        with rasterio.open(args.incident) as dataset:
            original = dataset.read(1, masked=True)
            if original.shape != values.shape:
                parser.error('production TIFF shape differs from local replay')
            common = mask & ~np.ma.getmaskarray(original)
            difference = np.abs(values[common].astype('float64') - original.data[common])
            report['production_comparison'] = {
                'production_mask_different_cells': int(np.count_nonzero(mask ^ ~np.ma.getmaskarray(original))),
                'max_absolute_difference_w_m2': float(difference.max()),
                'mean_absolute_difference_w_m2': float(difference.mean()),
            }
    print(json.dumps(report, sort_keys=True, allow_nan=False))


if __name__ == '__main__':
    main()
