"""Observed rain for a DG2 domain from GPM IMERG half-hourly precipitation (NASA GES DISC).

IMERG v07 gives precipitation in mm/hr on a global 0.1 degree grid every 30 minutes. A DG2 domain is
usually smaller than one IMERG cell, so the rain is one series, uniform over the domain: the mean of
the cells whose 0.1 degree box overlaps the domain bounds. IMERG Final (gauge-adjusted) arrives
about 3.5 months late; for recent events only the Late run exists (``GPM_3IMERGHHL``), which is not
gauge-adjusted. Access needs an Earthdata login with the GES DISC application authorized.

    python -m pipeline.hydrology.imerg <west> <south> <east> <north> <start_utc> <end_utc> <output.json>
"""
from __future__ import annotations

import argparse
import json
import math
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HALF_HOUR = timedelta(minutes=30)
CELL_DEG = .1
NOTES = {
    'GPM_3IMERGHHL': 'IMERG Late run: satellite-only, not gauge-adjusted.',
    'GPM_3IMERGHH': 'IMERG Final run: gauge-adjusted.',
}


def _utc(text):
    value = datetime.fromisoformat(str(text).replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('times must carry a UTC offset')
    return value.astimezone(timezone.utc)


def _iso(value):
    return value.strftime('%Y-%m-%dT%H:%M:%SZ')


def _earthaccess_search(product, bounds, start, end):
    import earthaccess

    from pipeline.elevation.nasadem import NASADEMProvider
    NASADEMProvider._authenticate_noninteractive()
    # CMR temporal search is inclusive: drop the granule that only starts at ``end``.
    found = earthaccess.search_data(short_name=product, bounding_box=tuple(bounds),
                                    temporal=(_iso(start), _iso(end - timedelta(seconds=1))))
    return [{'id': g['meta']['native-id'], 'begin': g['umm']['TemporalExtent']['RangeDateTime']['BeginningDateTime'],
             'handle': g} for g in found]


@contextmanager
def read_imerg_file(source):
    """Open an IMERG HDF5/netCDF4 file; half-hourly files keep their fields in the ``Grid`` group."""
    import h5py
    with h5py.File(source, 'r') as handle:
        yield handle['Grid'] if 'Grid' in handle else handle


@contextmanager
def _earthaccess_open(granule):
    import earthaccess
    with read_imerg_file(earthaccess.open([granule], show_progress=False)[0]) as data:
        yield data


def imerg_rainfall(bounds, start_utc, end_utc, *, product='GPM_3IMERGHHL', search=None, open_granule=None):
    """Rain in mm per half hour over ``bounds`` (west, south, east, north, EPSG:4326) from start to end.

    Returns ``{'segments': [{start_s, end_s, mm}], 'provenance': {...}}`` with ``start_s`` counted
    from ``start_utc``. Every half hour must be present once, with no missing values.
    """
    west, south, east, north = (float(v) for v in bounds)
    if not all(map(math.isfinite, (west, south, east, north))) or west >= east or south >= north:
        raise ValueError('bounds must be finite (west, south, east, north)')
    start, end = _utc(start_utc), _utc(end_utc)
    if end <= start or start.minute % 30 or end.minute % 30 or start.second or end.second:
        raise ValueError('start and end must be ordered and on half-hour boundaries')
    found = (search or _earthaccess_search)(product, (west, south, east, north), start, end)
    by_time = {}
    for granule in found:
        begin = _utc(granule['begin'])
        if start <= begin < end:
            if begin in by_time:
                raise ValueError(f'duplicated IMERG half hour {_iso(begin)}')
            by_time[begin] = granule
    expected = [start + i * HALF_HOUR for i in range(int((end - start) / HALF_HOUR))]
    missing = [_iso(t) for t in expected if t not in by_time]
    if missing:
        raise ValueError(f'IMERG half hours missing: {missing[:5]}')
    segments, cells = [], None
    for index, begin in enumerate(expected):
        with (open_granule or _earthaccess_open)(by_time[begin]['handle']) as data:
            lon, lat = np.asarray(data['lon'][:], dtype='float64'), np.asarray(data['lat'][:], dtype='float64')
            i = np.where((lon - CELL_DEG / 2 < east - 1e-9) & (lon + CELL_DEG / 2 > west + 1e-9))[0]
            j = np.where((lat - CELL_DEG / 2 < north - 1e-9) & (lat + CELL_DEG / 2 > south + 1e-9))[0]
            if not i.size or not j.size:
                raise ValueError('domain outside the IMERG grid')
            rate = np.asarray(data['precipitation'][0, i[0]:i[-1] + 1, j[0]:j[-1] + 1], dtype='float64')
        if not np.isfinite(rate).all() or (rate < 0).any():
            raise ValueError(f'missing IMERG values at {_iso(begin)}')
        if cells is None:
            cells = [[round(float(x), 4), round(float(y), 4)] for x in lon[i] for y in lat[j]]
        segments.append({'start_s': index * 1800.0, 'end_s': (index + 1) * 1800.0, 'mm': float(rate.mean()) * .5})
    return {'segments': segments, 'provenance': {
        'product': product, 'variable': 'precipitation (mm/hr)', 'start_utc': _iso(start), 'end_utc': _iso(end),
        'granules': [by_time[t]['id'] for t in expected], 'cells': cells,
        'method': 'mean of the 0.1 degree IMERG cells overlapping the domain bounds; mm per 30 min = rate x 0.5 h',
        'note': NOTES.get(product, ''), 'citation': 'Huffman et al., GPM IMERG V07, NASA GES DISC'}}


def main():
    parser = argparse.ArgumentParser(description='Observed IMERG rain series for a DG2 domain.')
    for name in ('west', 'south', 'east', 'north'):
        parser.add_argument(name, type=float)
    parser.add_argument('start_utc'); parser.add_argument('end_utc'); parser.add_argument('output')
    parser.add_argument('--product', default='GPM_3IMERGHHL')
    args = parser.parse_args()
    result = imerg_rainfall((args.west, args.south, args.east, args.north), args.start_utc, args.end_utc, product=args.product)
    Path(args.output).write_text(json.dumps(result, indent=1, allow_nan=False) + '\n', encoding='utf-8')
    print(args.output, len(result['segments']), 'half hours', round(sum(s['mm'] for s in result['segments']), 2), 'mm')


if __name__ == '__main__':
    main()
