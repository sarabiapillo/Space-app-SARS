"""EOT20 tide boundary: prediction from constituents, MDT datum offset, .bdy format and data preparation."""
import datetime as dt
import gzip
import io
import math
import zipfile

import h5py
import numpy as np
import pytest

from pipeline.hydrology.tides import (EOT20_CONSTITUENTS, eot20_constants, mdt_offset_m, predict_tide, prepare_eot20,
                                      read_gravsoft_grid, tide_series, write_bdy)

UTC = dt.timezone.utc
START = dt.datetime(2026, 10, 15, tzinfo=UTC)
M2_PERIOD_S = 12.4206012 * 3600


def m2_only(amplitude=1.0, phase_deg=0.0):
    return {'M2': amplitude * complex(math.cos(math.radians(phase_deg)), -math.sin(math.radians(phase_deg)))}


def test_single_m2_constituent_gives_its_amplitude_and_period():
    series = predict_tide(m2_only(), START, START + dt.timedelta(days=3), step_s=60, infer_minor=False)
    times = np.array([t for t, _ in series])
    levels = np.array([h for _, h in series])
    assert times[0] == 0 and times[-1] == 3 * 86400 and np.all(np.diff(times) == 60)
    # The nodal factor f of M2 stays within 0.96-1.04, so the extremes are +-1 m within 5 %.
    assert 0.95 < levels.max() < 1.05 and -1.05 < levels.min() < -0.95
    assert levels.max() == pytest.approx(-levels.min(), rel=1e-3)
    up = times[1:][(levels[:-1] < 0) & (levels[1:] >= 0)]  # upward zero crossings
    assert np.diff(up).mean() == pytest.approx(M2_PERIOD_S, abs=120)


def test_m2_phase_lag_delays_the_high_water():
    base = predict_tide(m2_only(), START, START + dt.timedelta(hours=13), step_s=60, infer_minor=False)
    late = predict_tide(m2_only(phase_deg=90), START, START + dt.timedelta(hours=13), step_s=60, infer_minor=False)
    t_base = max(base, key=lambda p: p[1])[0]
    t_late = max(late, key=lambda p: p[1])[0]
    assert ((t_late - t_base) % M2_PERIOD_S) == pytest.approx(M2_PERIOD_S / 4, abs=120)


def test_predict_tide_rejects_naive_times_and_bad_windows():
    with pytest.raises(ValueError):
        predict_tide(m2_only(), dt.datetime(2026, 10, 15), dt.datetime(2026, 10, 16))
    with pytest.raises(ValueError):
        predict_tide(m2_only(), START, START)


def fake_reader(lon, lat):
    return {'constants': m2_only(0.5), 'corrections': 'FES', 'minor': None}


def test_tide_series_adds_the_mdt_at_the_point_and_records_it():
    calls = []

    def mdt(lon, lat):
        calls.append((lon, lat))
        return 0.7, {'source': 'test MDT', 'method': 'bilinear'}

    out = tide_series(-92.4, 14.68, START, START + dt.timedelta(hours=1), 600, constants_reader=fake_reader,
                      mdt_reader=mdt, infer_minor=False)
    plain = predict_tide(m2_only(0.5), START, START + dt.timedelta(hours=1), 600, infer_minor=False)
    assert calls == [(-92.4, 14.68)]
    assert [t for t, _ in out['series']] == [0, 600, 1200, 1800, 2400, 3000, 3600]
    np.testing.assert_allclose([h for _, h in out['series']], [h + 0.7 for _, h in plain])
    prov = out['provenance']
    assert prov['model'] == 'EOT20' and prov['licence'] == 'CC BY 4.0' and prov['offset_m'] == 0.7
    assert prov['mdt']['value_m'] == 0.7 and 'XGM2019e - EGM2008 not applied' in prov['datum']


def test_tide_series_without_mdt_stays_on_msl_and_says_so():
    out = tide_series(-92.4, 14.68, START, START + dt.timedelta(hours=1), 600, mdt=None,
                      constants_reader=fake_reader, infer_minor=False)
    plain = predict_tide(m2_only(0.5), START, START + dt.timedelta(hours=1), 600, infer_minor=False)
    assert out['series'] == plain
    assert out['provenance']['datum'] == 'mean sea level (MDT not applied)' and out['provenance']['offset_m'] == 0


def test_tide_series_explicit_offset_and_geoid_difference():
    explicit = tide_series(0, 0, START, START + dt.timedelta(hours=1), 3600, mdt=0.25, constants_reader=fake_reader,
                           infer_minor=False)
    assert explicit['provenance']['mdt']['source'] == 'explicit offset given by the caller'
    assert explicit['provenance']['offset_m'] == 0.25
    full = tide_series(0, 0, START, START + dt.timedelta(hours=1), 3600, constants_reader=fake_reader,
                       mdt_reader=lambda lon, lat: (0.5, {}), geoid_difference=lambda lon, lat: -0.1,
                       infer_minor=False)
    assert full['provenance']['offset_m'] == pytest.approx(0.4)
    assert full['provenance']['geoid_difference_m'] == -0.1
    with pytest.raises(ValueError):
        tide_series(0, 0, START, START + dt.timedelta(hours=1), 3600, mdt='TPXO', constants_reader=fake_reader)


def gravsoft(tmp_path, rows, header='10 12 -94 -92 1 1'):
    path = tmp_path / 'mdt.grd.gz'
    with gzip.open(path, 'wt') as handle:
        handle.write(header + '\n' + '\n'.join(' '.join(str(v) for v in row) for row in rows) + '\n')
    return path


def test_read_gravsoft_grid_orders_rows_north_to_south_and_masks_9999(tmp_path):
    path = gravsoft(tmp_path, [[1, 2, 3], [4, 9999, 6], [7, 8, 9]])
    lats, lons, values = read_gravsoft_grid(path)
    np.testing.assert_array_equal(lats, [12, 11, 10])
    np.testing.assert_array_equal(lons, [-94, -93, -92])
    assert values[0, 0] == 1 and values[2, 2] == 9 and np.isnan(values[1, 1])


def test_mdt_offset_is_bilinear_and_falls_back_to_the_nearest_valid_node(tmp_path):
    # A plane 0.1 * lon_index + 0.01 * row on a 0.125-like grid; grid longitudes 0..360 like DTU.
    lats = np.array([16.0, 15.0, 14.0])
    lons = np.array([266.0, 267.0, 268.0])
    plane = np.array([[0.0, 0.1, 0.2], [0.01, 0.11, 0.21], [0.02, 0.12, 0.22]])
    value, record = mdt_offset_m(-93.5, 15.5, reader=lambda path: (lats, lons, plane))  # -93.5 == 266.5
    assert value == pytest.approx(0.055) and record['method'] == 'bilinear'
    masked = plane.copy()
    masked[0:2, 0:2] = np.nan
    value, record = mdt_offset_m(-93.6, 15.6, reader=lambda path: (lats, lons, masked))
    assert record['method'] == 'nearest valid node' and value == pytest.approx(0.2)  # node (268E, 16N)
    with pytest.raises(ValueError):
        mdt_offset_m(-93.5, 15.5, reader=lambda path: (lats, lons, np.full((3, 3), np.nan)))


def test_write_bdy_uses_the_lisflood_layout(tmp_path):
    path = write_bdy([(0, 0.71234), (600, 0.8), (1200.5, -0.25)], tmp_path / 'tide.bdy', 'tide_south')
    assert path.read_text() == ('LISFLOOD-FP boundary time series\n'
                                'tide_south\n'
                                '3 seconds\n'
                                '0.7123 0.0\n'
                                '0.8000 600.0\n'
                                '-0.2500 1200.5\n')


@pytest.mark.parametrize('series, name', [([(0, 1.0), (0, 2.0)], 'tide'), ([(0, 1.0), (60, float('nan'))], 'tide'),
                                          ([], 'tide'), ([(0, 1.0)], 'two words')])
def test_write_bdy_rejects_series_lisflood_would_refuse(tmp_path, series, name):
    with pytest.raises(ValueError):
        write_bdy(series, tmp_path / 'x.bdy', name)


def test_prepare_eot20_extracts_ocean_tides_from_the_seanoe_archive(tmp_path):
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, 'w') as archive:
        archive.writestr('ocean_tides/M2_ocean_eot20.nc', b'm2')
        archive.writestr('ocean_tides/K1_ocean_eot20.nc', b'k1')
        archive.writestr('ocean_tides/readme.txt', b'x')
    outer = tmp_path / '85762.zip'
    with zipfile.ZipFile(outer, 'w') as archive:
        archive.writestr('ocean_tides.zip', inner.getvalue())
        archive.writestr('load_tides.zip', b'not needed')
    target = prepare_eot20(tmp_path / 'eot20', source=outer)
    assert target == tmp_path / 'eot20' / 'EOT20' / 'ocean_tides'
    assert sorted(p.name for p in target.iterdir()) == ['K1_ocean_eot20.nc', 'M2_ocean_eot20.nc']
    assert (target / 'M2_ocean_eot20.nc').read_bytes() == b'm2'


def eot20_dir(tmp_path, land_cols=()):
    """17 tiny EOT20-like files on a 1 degree grid (lon 0..360 with the repeated meridian, lat -10..10).

    M2 is 50 cm with a 30 degree lag; the other constituents are ocean with zero amplitude (phase 1).
    Columns in ``land_cols`` are land (amplitude and phase 0).
    """
    folder = tmp_path / 'EOT20' / 'ocean_tides'
    folder.mkdir(parents=True)
    lats, lons = np.arange(-10.0, 10.5, 1.0), np.arange(0.0, 360.5, 1.0)
    for name in EOT20_CONSTITUENTS:
        amplitude = np.full((lats.size, lons.size), 50.0 if name == 'M2' else 0.0)
        phase = np.full_like(amplitude, 30.0 if name == 'M2' else 1.0)
        for col in land_cols:
            amplitude[:, col] = phase[:, col] = 0.0
        with h5py.File(folder / f'{name}_ocean_eot20.nc', 'w') as handle:
            handle['lat'], handle['lon'] = lats, lons
            for key, data in (('amplitude', amplitude), ('phase', phase)):
                handle[key] = data
                handle[key].attrs['units'] = b'cm' if key == 'amplitude' else b'degrees'
    return tmp_path


def test_eot20_constants_read_metres_and_cross_the_0_360_seam(tmp_path):
    model = eot20_constants(-0.3, 0.5, directory=eot20_dir(tmp_path))
    assert model['corrections'] == 'FES' and sorted(model['constants']) == sorted(EOT20_CONSTITUENTS)
    expected = 0.5 * complex(math.cos(math.radians(30)), -math.sin(math.radians(30)))
    assert model['constants']['M2'] == pytest.approx(expected)
    assert model['sampling'] == {'method': 'bilinear'}


def test_eot20_constants_take_the_nearest_ocean_node_only_within_the_cutoff(tmp_path):
    directory = eot20_dir(tmp_path, land_cols=range(98, 103))  # land from 98 E to 102 E
    with pytest.raises(ValueError):
        eot20_constants(100.0, 0.0, directory=directory, cutoff_km=100)
    model = eot20_constants(100.0, 0.0, directory=directory, cutoff_km=400)
    assert model['sampling']['method'] == 'nearest valid node'
    assert model['sampling']['distance_km'] == pytest.approx(3 * 111.32)
    assert abs(model['constants']['M2']) == pytest.approx(0.5)
