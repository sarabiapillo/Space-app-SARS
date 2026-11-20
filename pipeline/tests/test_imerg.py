"""IMERG half-hourly rain over a DG2 domain as an observed rainfall series; no network."""
from contextlib import contextmanager

import numpy as np
import pytest

from pipeline.hydrology.imerg import imerg_rainfall

LON = np.round(np.arange(-93.95, -92.0, .1), 2)
LAT = np.round(np.arange(16.05, 17.5, .1), 2)
# Straddles the IMERG cells centred at lon -93.05 and -92.95, inside the cell centred at lat 16.75.
BOUNDS = (-93.02, 16.76, -92.98, 16.78)


def grid(cell_a, cell_b, rest=50.0):
    values = np.full((1, LON.size, LAT.size), rest, dtype='float32')
    j = int(np.argmin(abs(LAT - 16.75)))
    values[0, int(np.argmin(abs(LON + 93.05))), j] = cell_a
    values[0, int(np.argmin(abs(LON + 92.95))), j] = cell_b
    return {'lon': LON, 'lat': LAT, 'precipitation': values}


def fake(granules):
    found = [{'id': f'G{i}', 'begin': begin, 'handle': i} for i, (begin, _) in enumerate(granules)]

    def search(product, bounds, start, end):
        search.args = (product, bounds, start, end)
        return found

    @contextmanager
    def open_granule(handle):
        yield granules[handle][1]
    return search, open_granule


def test_series_is_the_mean_rain_of_the_cells_touching_the_domain_per_half_hour():
    search, open_granule = fake([('2026-10-03T00:00:00Z', grid(4, 8)), ('2026-10-03T00:30:00Z', grid(0, 2))])
    result = imerg_rainfall(BOUNDS, '2026-10-03T00:00:00Z', '2026-10-03T01:00:00Z', search=search, open_granule=open_granule)
    assert result['segments'] == [{'start_s': 0.0, 'end_s': 1800.0, 'mm': pytest.approx(3.0)},
                                  {'start_s': 1800.0, 'end_s': 3600.0, 'mm': pytest.approx(.5)}]
    source = result['provenance']
    assert search.args[0] == 'GPM_3IMERGHHL' and source['product'] == 'GPM_3IMERGHHL'
    assert source['granules'] == ['G0', 'G1'] and source['cells'] == [[-93.05, 16.75], [-92.95, 16.75]]
    assert source['start_utc'] == '2026-10-03T00:00:00Z' and source['end_utc'] == '2026-10-03T01:00:00Z'
    assert 'Late' in source['note']


@pytest.mark.parametrize('granules, start', [
    ([('2026-10-03T00:00:00Z', grid(4, 8))], '2026-10-03T00:00:00Z'),  # second half-hour missing
    ([('2026-10-03T00:00:00Z', grid(4, 8)), ('2026-10-03T00:30:00Z', grid(-9999.9, 2))], '2026-10-03T00:00:00Z'),
    ([('2026-10-03T00:00:00Z', grid(4, 8)), ('2026-10-03T00:00:00Z', grid(4, 8)),
      ('2026-10-03T00:30:00Z', grid(0, 2))], '2026-10-03T00:00:00Z'),  # duplicated half-hour
    ([('2026-10-03T00:00:00Z', grid(4, 8)), ('2026-10-03T00:30:00Z', grid(0, 2))], '2026-10-03T00:10:00Z'),
])
def test_gaps_missing_values_duplicates_or_unaligned_times_are_rejected(granules, start):
    search, open_granule = fake(granules)
    with pytest.raises(ValueError):
        imerg_rainfall(BOUNDS, start, '2026-10-03T01:00:00Z', search=search, open_granule=open_granule)


def test_half_hourly_files_are_read_from_their_grid_group(tmp_path):
    import h5py

    from pipeline.hydrology.imerg import read_imerg_file
    values = grid(4, 8)
    with h5py.File(tmp_path / 'hh.HDF5', 'w') as handle:
        group = handle.create_group('Grid')
        for name, array in values.items():
            group[name] = array

    def search(product, bounds, start, end):
        return [{'id': 'G0', 'begin': '2026-10-03T00:00:00Z', 'handle': tmp_path / 'hh.HDF5'}]
    result = imerg_rainfall(BOUNDS, '2026-10-03T00:00:00Z', '2026-10-03T00:30:00Z', search=search, open_granule=read_imerg_file)
    assert result['segments'][0]['mm'] == pytest.approx(3.0)
