"""Contrato público de lectura y exportación de profundidades DG2 offline."""
import json
import math
from pathlib import Path

import numpy as np
import pytest
import rasterio

from pipeline.hydrology.results import read_depth_ascii, read_signed_ascii, export_depth_cog, summarize_results, flow_arrows

SMOKE = Path(__file__).resolve().parents[2] / 'data/tools/lisflood-fp-8.0/runtime/smoke-t030/results'


def ascii_grid(path, body, *, header=None):
    path.write_text(header or 'ncols 2\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 5\nNODATA_value -9999\n' + body)
    return path


def test_smoke_real_outputs_without_rerun():
    result = summarize_results(SMOKE, save_interval_s=1)
    assert [f['frame_index'] for f in result['frames']] == [0, 1, 2]
    assert [f['scheduled_time_s'] for f in result['frames']] == [0, 1, 2]
    assert [f['time_s'] for f in result['frames']] == [None, None, None]
    assert result['time_axis'] == {'status': 'actual_times_unavailable', 'reason': 'DG2 ASCII frames do not record actual physical timestamps; scheduled_time_s is requested, not observed.'}
    assert result['maximum']['stats']['max_m'] == pytest.approx(.010)
    assert result['grid']['shape'] == [9, 9]
    assert result['grid']['crs'] is None
    assert result['synthetic'] is True and result['hydraulic_accuracy_validated'] is False
    # The smoke .mass reports Verror = -0.04 exactly when 0.04 m3 of rain enters: rain-inclusive error is zero.
    assert result['mass_balance']['rain_m3'] == pytest.approx(.08)
    assert result['mass_balance']['max_abs_interval_error_m3'] == pytest.approx(0, abs=1e-9)
    assert any(w.startswith('Balance de masa con lluvia incluida') for w in result['warnings'])
    assert not any('getfattr' in w for w in result['warnings'])
    assert result['flow'] is None  # the smoke run predates voutput
    json.dumps(result, allow_nan=False)


MASS_HEADER = 'Time         Tstep      MinTstep   NumTsteps    Area         Vol         Qin         Hds        Qout          Qerror       Verror       Rain-(Inf+Evap)\n'


def mass_row(time, vol, verror, rain):
    return f'{time} 1 1 1 0 {vol} 0 0 0 0 {verror} {rain}\n'


def minimal_outputs(directory):
    ascii_grid(directory / 'a-0000.wd', '0 0\n0 0\n')
    ascii_grid(directory / 'a.max', '0 0\n0 0\n')


def test_mass_balance_adds_back_rain_missing_from_swe_verror(tmp_path):
    minimal_outputs(tmp_path)
    (tmp_path / 'a.mass').write_text(MASS_HEADER + mass_row(100, 95, -95, 100) + mass_row(200, 190, -100, 200)
                                     + MASS_HEADER + mass_row(300, 190, -.5, 200))
    balance = summarize_results(tmp_path, save_interval_s=1)['mass_balance']
    assert balance['intervals'] == 3
    assert balance['rain_m3'] == pytest.approx(200)
    assert balance['final_volume_m3'] == pytest.approx(190)
    assert balance['max_abs_interval_error_m3'] == pytest.approx(5)
    assert balance['max_abs_interval_error_relative_to_rain'] == pytest.approx(.025)
    # Chart series: time, volume in the domain and cumulative rain, one point per .mass row.
    assert balance['series'] == [[100, 95, 100], [200, 190, 200], [300, 190, 200]]


def test_frames_count_cells_per_depth_class_for_charts(tmp_path):
    # A 0.5-2 mm "wet surface" class shows that it rained on the whole area, a 2-10 mm class the runoff sheets during
    # the rain and a 1-3 cm class the thin sheets of water: [0.0005, 0.002), [0.002, 0.01), [0.01, 0.03), ... >= 2 m.
    ascii_grid(tmp_path / 'a-0000.wd', '0 .1\n.6 2.5\n')
    ascii_grid(tmp_path / 'a.max', '.02 .15\n1 2\n')
    result = summarize_results(tmp_path, save_interval_s=1)
    assert result['depth_classes_m'] == [.0005, .002, .01, .03, .15, .5, 1, 2]
    assert result['frames'][0]['stats']['depth_class_cells'] == [0, 0, 0, 1, 0, 1, 0, 1]
    assert result['maximum']['stats']['depth_class_cells'] == [0, 0, 1, 0, 1, 0, 1, 1]
    ascii_grid(tmp_path / 'a-0000.wd', '.009 .01\n.0299 .03\n')  # bounds are inclusive below, exclusive above
    assert summarize_results(tmp_path, save_interval_s=1)['frames'][0]['stats']['depth_class_cells'] == [0, 1, 2, 1, 0, 0, 0, 0]
    ascii_grid(tmp_path / 'a-0000.wd', '.0019 .002\n.005 0\n')  # 1.9 mm is a wet surface, 2 mm a runoff sheet
    assert summarize_results(tmp_path, save_interval_s=1)['frames'][0]['stats']['depth_class_cells'] == [1, 2, 0, 0, 0, 0, 0, 0]
    ascii_grid(tmp_path / 'a-0000.wd', '.0004 .0005\n.001 0\n')  # a film of 0.5 mm or more is wet, thinner is not
    assert summarize_results(tmp_path, save_interval_s=1)['frames'][0]['stats']['depth_class_cells'] == [2, 0, 0, 0, 0, 0, 0, 0]


def test_frames_split_their_water_into_sheets_and_ponded_volume(tmp_path):
    # Cells of 5 m (25 m2): sheets are thinner than 0.03 m (the flooded-area threshold), ponded water is 0.03 m or more.
    ascii_grid(tmp_path / 'a-0000.wd', '.002 .02\n.03 1\n')
    ascii_grid(tmp_path / 'a-0001.wd', '-9999 0\n0 0\n')
    ascii_grid(tmp_path / 'a.max', '.002 .02\n.03 1\n')
    result = summarize_results(tmp_path, save_interval_s=1)
    first, dry = result['frames'][0]['stats'], result['frames'][1]['stats']
    assert first['sheet_volume_m3'] == pytest.approx((.002 + .02) * 25)
    assert first['ponded_volume_m3'] == pytest.approx((.03 + 1) * 25)
    assert first['volume_m3'] == pytest.approx((.002 + .02 + .03 + 1) * 25)
    assert [dry['volume_m3'], dry['sheet_volume_m3'], dry['ponded_volume_m3']] == [0, 0, 0]  # nodata is never water
    assert 'volume_m3' not in result['maximum']['stats']  # the maximum is not one instant, its sum is no volume


def test_water_budget_says_where_the_rain_went(tmp_path):
    from pipeline.hydrology.results import water_budget
    # Hand-computed: 10 ROI cells of 5 m (250 m2) receive 40 mm of gross rain = 10 m3; the Curve Number leaves
    # 16 mm net = 4 m3 (the solver's .mass); 3 m3 stay in the domain and 1 m3 leaves through the boundaries.
    ascii_grid(tmp_path / 'a-0000.wd', '0 0\n0 0\n')
    ascii_grid(tmp_path / 'a-0001.wd', '.02 .02\n.04 .04\n')  # last frame: 1 m3 of sheets, 2 m3 ponded (cells of 25 m2)
    ascii_grid(tmp_path / 'a.max', '.02 .02\n.04 .04\n')
    (tmp_path / 'a.mass').write_text(MASS_HEADER + mass_row(0, 0, 0, 0) + mass_row(100, 3.5, -4, 4) + mass_row(200, 3, 0, 4))
    summary = summarize_results(tmp_path, save_interval_s=1)
    rain = {'method': {'method': 'scs_curve_number_incremental', 'gross_total_mm': 40, 'roi_cells': 10, 'roi_mean_net_total_mm': 16}}
    budget = water_budget(summary, rain=rain)
    assert budget == {'units': 'm3', 'gross_source': 'curve_number', 'gross_rain_m3': pytest.approx(10),
                      'infiltrated_m3': pytest.approx(6), 'net_rain_m3': pytest.approx(4), 'initial_water_m3': 0,
                      'final_water_m3': pytest.approx(3), 'boundary_outflow_m3': pytest.approx(1), 'boundary_inflow_m3': 0,
                      'last_frame_water_m3': pytest.approx(3), 'sheet_m3': pytest.approx(1), 'ponded_m3': pytest.approx(2),
                      'ponded_min_depth_m': .03, 'last_frame_time_s': 1,
                      'method': budget['method']}
    assert 'gross - net' in budget['method']
    json.dumps(budget, allow_nan=False)
    # Runoff coefficient C = 0.4: the solver got rain x C, so the gross rain is net / C. Without losses gross = net.
    assert water_budget(summary, runoff_coefficient=.4)['gross_rain_m3'] == pytest.approx(10)
    plain = water_budget(summary)
    assert [plain['gross_source'], plain['gross_rain_m3'], plain['infiltrated_m3']] == ['no_losses', pytest.approx(4), 0]
    # A sea or a lake full at the start is initial water; more water at the end than rain plus start = inflow.
    (tmp_path / 'a.mass').write_text(MASS_HEADER + mass_row(0, 50, 0, 0) + mass_row(200, 60, 0, 4))
    sea = water_budget(summarize_results(tmp_path, save_interval_s=1))
    assert [sea['initial_water_m3'], sea['boundary_outflow_m3'], sea['boundary_inflow_m3']] == [50, 0, pytest.approx(6)]
    # Older summaries (no per-frame volumes) keep the totals without the split; no .mass gives no budget.
    older = {**summary, 'frames': [{**f, 'stats': {k: v for k, v in f['stats'].items() if 'volume' not in k}} for f in summary['frames']]}
    assert [water_budget(older)['sheet_m3'], water_budget(older)['ponded_m3']] == [None, None]
    assert water_budget({**summary, 'mass_balance': None}) is None


def test_missing_mass_file_keeps_explicit_warning(tmp_path):
    minimal_outputs(tmp_path)
    result = summarize_results(tmp_path, save_interval_s=1)
    assert result['mass_balance'] is None
    assert result['warnings'] == ['Archivo .mass ausente; balance de masa no disponible.']


@pytest.mark.parametrize('body', ['', MASS_HEADER, MASS_HEADER + '1 2 3\n', MASS_HEADER + mass_row(1, 'nan', 0, 0)])
def test_unreadable_mass_file_warns_without_failing(tmp_path, body):
    minimal_outputs(tmp_path)
    (tmp_path / 'a.mass').write_text(body)
    result = summarize_results(tmp_path, save_interval_s=1)
    assert result['mass_balance'] is None
    assert result['warnings'] == ['Archivo .mass ilegible; balance de masa no disponible.']


UTM_HEADER = 'ncols 2\nnrows 2\nxllcorner 500000\nyllcorner 1850000\ncellsize 30\nNODATA_value -9999\n'


def velocity_outputs(directory, depth, vx, vy):
    ascii_grid(directory / 'a-0000.wd', '', header=UTM_HEADER + '0 0\n0 0\n')
    ascii_grid(directory / 'a-0000.Vx', '', header=UTM_HEADER + '0 0\n0 0\n')
    ascii_grid(directory / 'a-0000.Vy', '', header=UTM_HEADER + '0 0\n0 0\n')
    ascii_grid(directory / 'a-0001.wd', '', header=UTM_HEADER + depth)
    ascii_grid(directory / 'a-0001.Vx', '', header=UTM_HEADER + vx)
    ascii_grid(directory / 'a-0001.Vy', '', header=UTM_HEADER + vy)
    ascii_grid(directory / 'a.max', '', header=UTM_HEADER + depth)
    # Solver DEM: 4 cells of 900 m2 drain far less than 0.12 km2, so no cell is a channel.
    ascii_grid(directory / 'a.dem', '', header=UTM_HEADER + '10 10\n10 10\n')


@pytest.mark.parametrize('vx, vy, bearing', [('2 2\n2 2\n', '0 0\n0 0\n', 90), ('0 0\n0 0\n', '2 2\n2 2\n', 0),
                                             ('0 0\n0 0\n', '-2 -2\n-2 -2\n', 180), ('-2 -2\n-2 -2\n', '0 0\n0 0\n', 270)])
def test_flow_arrows_follow_solver_velocity_east_and_north(tmp_path, vx, vy, bearing):
    # LISFLOOD-FP voutput: Vx positive east, Vy positive north (checked against downhill flow in a real DG2 run).
    velocity_outputs(tmp_path, '.5 .5\n.5 .5\n', vx, vy)
    flow = summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615')['flow']
    assert flow['units'] == 'm/s' and flow['min_depth_m'] == .15 and flow['channel_min_upslope_km2'] == .12
    assert [f['frame_index'] for f in flow['frames']] == [0, 1]
    assert flow['frames'][0]['arrows'] == [] and flow['frames'][0]['max_speed_m_s'] == 0
    arrows = flow['frames'][1]['arrows']
    assert len(arrows) == 4 and flow['frames'][1]['max_speed_m_s'] == pytest.approx(2)
    for lon, lat, speed, direction in arrows:
        assert speed == pytest.approx(2)
        assert min(abs(direction - bearing), 360 - abs(direction - bearing)) < .5
        assert -93.01 < lon < -92.99 and 16.7 < lat < 16.8


def test_flow_arrows_ignore_shallow_water(tmp_path):
    # The 0.01 m cell carries a spurious 9 m/s thin-film speed; arrows use only cells at least 0.15 m deep.
    velocity_outputs(tmp_path, '.01 .2\n.6 0\n', '9 1\n3 0\n', '0 0\n0 0\n')
    arrows = summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615')['flow']['frames'][1]['arrows']
    assert sorted(a[2] for a in arrows) == [1, 3]


def test_flow_block_arrow_is_depth_weighted_and_capped(tmp_path):
    depth = read_depth_ascii(ascii_grid(tmp_path / 'd.wd', '', header=UTM_HEADER + '.01 .2\n.6 0\n'))
    vx, vy = np.array([[9., 1.], [3., 0.]]), np.zeros((2, 2))
    [[lon, lat, speed, direction]] = flow_arrows(depth, vx, vy, crs='EPSG:32615', max_arrows=1)
    assert speed == pytest.approx((.2 * 1 + .6 * 3) / .8)
    assert min(direction, 360 - direction) == pytest.approx(90, abs=.5)


CHANNEL_HEADER = 'ncols 3\nnrows 3\nxllcorner 500000\nyllcorner 1850000\ncellsize 200\nNODATA_value -9999\n'
# D8 on 200 m cells (0.04 km2 each): the centre drains 6 cells (0.24 km2) and the bottom-centre all 9
# (0.36 km2), so both are channels; every other cell drains only itself.
CHANNEL_DEM = '9 8 9\n8 5 8\n7 2 7\n'


def channel_outputs(directory, initial=None):
    for name, body in (('a-0000.wd', '0 0 0\n0 0 0\n0 0 0\n'), ('a-0000.Vx', '0 0 0\n0 0 0\n0 0 0\n'),
                       ('a-0000.Vy', '0 0 0\n0 0 0\n0 0 0\n'), ('a-0001.wd', '.5 .5 .5\n.5 .5 .5\n.5 .5 .5\n'),
                       ('a-0001.Vx', '1 1 1\n1 1 1\n1 1 1\n'), ('a-0001.Vy', '0 0 0\n0 0 0\n0 0 0\n'),
                       ('a.max', '.5 .5 .5\n.5 .5 .5\n.5 .5 .5\n'), ('a.dem', CHANNEL_DEM)):
        ascii_grid(directory / name, '', header=CHANNEL_HEADER + body)
    if initial:
        ascii_grid(directory.parent / 'initial.wd', '', header=CHANNEL_HEADER + initial)
        return directory.parent / 'initial.wd'


def arrow_cells(arrows):
    # Arrow centroids back to (row, col) on the 200 m test grid.
    from pyproj import Transformer
    to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:32615', always_xy=True)
    cells = set()
    for lon, lat, *_ in arrows:
        x, y = to_utm.transform(lon, lat)
        cells.add((int((1850600 - y) // 200), int((x - 500000) // 200)))
    return cells


def test_flow_arrows_only_where_water_overflows_outside_the_channel_network(tmp_path):
    outputs = tmp_path / 'outputs'; outputs.mkdir()
    channel_outputs(outputs)
    arrows = summarize_results(outputs, save_interval_s=1, crs='EPSG:32615')['flow']['frames'][1]['arrows']
    assert arrow_cells(arrows) == {(0, 0), (0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 2)}


def test_channel_network_fills_pits_so_flow_continues_downstream(tmp_path):
    # The 1 m centre is a pit: raw D8 stops there and the 4 m outlet below drains only itself.
    # Filled to its 4 m spill level (plus a tiny gradient), the pit passes all 9 cells to the outlet.
    from pipeline.hydrology.results import channel_network
    dem = read_signed_ascii(ascii_grid(tmp_path / 'pit.dem', '', header=CHANNEL_HEADER + '9 8 9\n8 1 8\n9 4 9\n'))
    assert channel_network(dem).tolist() == [[False] * 3, [False, True, False], [False, True, False]]


def test_flow_arrows_skip_the_initial_sea(tmp_path):
    outputs = tmp_path / 'outputs'; outputs.mkdir()
    initial = channel_outputs(outputs, initial='0 0 0\n0 0 0\n1 0 1\n')
    arrows = summarize_results(outputs, save_interval_s=1, crs='EPSG:32615', initial_depth=initial)['flow']['frames'][1]['arrows']
    assert arrow_cells(arrows) == {(0, 0), (0, 1), (0, 2), (1, 0), (1, 2)}


def test_froude_number_per_frame_from_solver_velocity_and_depth(tmp_path):
    velocity_outputs(tmp_path, '.5 .5\n.5 .5\n', '3 3\n1 1\n', '0 0\n0 0\n')
    froude = summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615')['froude']
    assert froude['min_depth_m'] == .15
    assert froude['frames'][0] == {'frame_index': 0, 'cells': 0, 'max': None, 'mean': None, 'supercritical_cells': 0}
    fast, slow = 3 / math.sqrt(9.81 * .5), 1 / math.sqrt(9.81 * .5)
    assert froude['frames'][1] == {'frame_index': 1, 'cells': 4, 'max': pytest.approx(fast),
                                   'mean': pytest.approx((fast + slow) / 2), 'supercritical_cells': 2}


def test_kirpich_time_of_concentration_on_the_longest_flow_path_to_the_main_outlet(tmp_path):
    outputs = tmp_path / 'outputs'; outputs.mkdir()
    channel_outputs(outputs)
    tc = summarize_results(outputs, save_interval_s=1, crs='EPSG:32615')['time_of_concentration']
    # Main outlet: bottom-centre (2 m, drains all 9 cells). Longest path: a 9 m corner, diagonal to the
    # 5 m centre, then down to the outlet: 200*sqrt(2) + 200 m.
    length = 200 * math.sqrt(2) + 200
    slope = (9 - 2) / length
    assert tc['flow_length_m'] == pytest.approx(length) and tc['slope_m_m'] == pytest.approx(slope)
    assert tc['minutes'] == pytest.approx(.0195 * length ** .77 * slope ** -.385)
    assert tc['upslope_area_km2'] == pytest.approx(.36)


def test_road_exposure_per_frame_and_maximum_with_osm_provenance(tmp_path):
    from pyproj import Transformer
    velocity_outputs(tmp_path, '.5 .2\n0 0\n', '0 0\n0 0\n', '0 0\n0 0\n')
    to_lonlat = Transformer.from_crs('EPSG:32615', 'EPSG:4326', always_xy=True)
    road = {'id': 1, 'highway': 'primary', 'coords': [list(to_lonlat.transform(x, 1850045)) for x in (500000, 500060)]}
    roads = {'roads': [road], 'provenance': {'attribution': '© OpenStreetMap contributors', 'osm_timestamp': 't'}}
    result = summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615', roads=roads)['roads']
    assert result['available'] and result['attribution'] == '© OpenStreetMap contributors'
    assert result['thresholds_m'] == {'caution': .15, 'cut': .35} and result['total_km'] == pytest.approx(.06, abs=1e-4)
    assert [f['frame_index'] for f in result['frames']] == [0, 1]
    assert result['frames'][0]['cut_km'] == 0
    assert result['frames'][1]['cut_km'] == pytest.approx(.03, abs=1e-4) and result['frames'][1]['caution_km'] == pytest.approx(.03, abs=1e-4)
    assert result['maximum']['cut_km'] == pytest.approx(.03, abs=1e-4)
    unavailable = summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615', roads={'roads': None, 'reason': 'unavailable'})
    assert unavailable['roads'] == {'available': False, 'reason': 'unavailable'}
    assert summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615')['roads'] is None


def test_flow_is_null_without_velocity_files_or_crs(tmp_path):
    minimal_outputs(tmp_path)
    assert summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615')['flow'] is None
    velocity_outputs(tmp_path, '.5 .5\n.5 .5\n', '1 1\n1 1\n', '0 0\n0 0\n')
    assert summarize_results(tmp_path, save_interval_s=1)['flow'] is None


def test_flow_rejects_velocity_grid_mismatch(tmp_path):
    velocity_outputs(tmp_path, '.5 .5\n.5 .5\n', '1 1\n1 1\n', '0 0\n0 0\n')
    ascii_grid(tmp_path / 'a-0001.Vy', '0 0\n0 0\n')
    with pytest.raises(ValueError, match='velocity grid'):
        summarize_results(tmp_path, save_interval_s=1, crs='EPSG:32615')


def test_sample_frame_indices_are_not_physical_times(tmp_path):
    ascii_grid(tmp_path / 'a-0002.wd', '0 0\n0 0\n')
    ascii_grid(tmp_path / 'a-0000.wd', '0 0\n0 0\n')
    ascii_grid(tmp_path / 'a.max', '0 0\n0 0\n')
    result = summarize_results(tmp_path, save_interval_s=1)
    assert [(f['frame_index'], f['time_s'], f['scheduled_time_s']) for f in result['frames']] == [(0, None, 0), (2, None, 2)]
    assert result['time_axis']['status'] == 'actual_times_unavailable'
    assert sorted(p.name for p in tmp_path.iterdir()) == ['a-0000.wd', 'a-0002.wd', 'a.max']


def test_nodata_statistics_and_cog(tmp_path):
    source = ascii_grid(tmp_path / 'sample.max', '0 -9999\n1.25 0\n')
    grid = read_depth_ascii(source)
    assert grid['values'][0, 1] == -9999
    assert grid['stats'] == {'valid_cells': 3, 'nodata_cells': 1, 'wet_cells': 1, 'min_m': 0.0, 'max_m': 1.25}
    assert grid['bounds'] == [100, 200, 110, 210]
    target = tmp_path / 'depth.tif'
    with pytest.raises(ValueError, match='CRS'):
        export_depth_cog(source, target, crs=None, code_version='test')
    assert not target.exists() and source.read_bytes()
    info = export_depth_cog(source, target, crs='EPSG:32615', code_version='test')
    assert info['source_sha256'] and info['code_version'] == 'test'
    with rasterio.open(target) as dataset:
        assert dataset.driver == 'GTiff'
        assert dataset.tags(ns='IMAGE_STRUCTURE')['LAYOUT'] == 'COG'
        assert dataset.crs.to_epsg() == 32615
        assert dataset.nodata == -9999
        np.testing.assert_array_equal(dataset.read(1), grid['values'])
        assert dataset.transform.c == 100 and dataset.transform.f == 210
    before = target.read_bytes()
    with pytest.raises(FileExistsError):
        export_depth_cog(source, target, crs='EPSG:32615', code_version='test')
    assert target.read_bytes() == before


@pytest.mark.parametrize('body', ['0 1\n2\n', '0 1 2\n3 4 5\n', '0 -1\n2 3\n', '0 nan\n2 3\n'])
def test_reject_bad_data_without_changing_source(tmp_path, body):
    source = ascii_grid(tmp_path / 'bad.wd', body)
    before = source.read_bytes()
    with pytest.raises(ValueError):
        read_depth_ascii(source)
    assert source.read_bytes() == before


@pytest.mark.parametrize('line', ['ncols 0', 'ncols 2.5', 'cellsize -1', 'xllcorner nan', 'NODATA_value nan'])
def test_invalid_headers(tmp_path, line):
    path = ascii_grid(tmp_path / 'bad.max', '0 0\n0 0\n')
    path.write_text(path.read_text().replace(line.split()[0] + ' ' + {'ncols': '2', 'cellsize': '5', 'xllcorner': '100', 'NODATA_value': '-9999'}[line.split()[0]], line))
    with pytest.raises(ValueError):
        read_depth_ascii(path)


def test_budget_and_mixed_grids_and_interval(tmp_path):
    source = ascii_grid(tmp_path / 'a-0000.wd', '0 0\n0 0\n')
    with pytest.raises(ValueError):
        read_depth_ascii(source, max_cells=3)
    ascii_grid(tmp_path / 'a-0001.wd', '0 0\n0 0\n', header='ncols 2\nnrows 2\nxllcorner 101\nyllcorner 200\ncellsize 5\nNODATA_value -9999\n0 0\n0 0\n')
    ascii_grid(tmp_path / 'a.max', '0 0\n0 0\n')
    with pytest.raises(ValueError, match='grid'):
        summarize_results(tmp_path, save_interval_s=2)
    with pytest.raises(ValueError, match='save_interval_s'):
        summarize_results(tmp_path, save_interval_s=0)


def test_refuse_nonmetric_crs_and_preserve_source(tmp_path):
    source = ascii_grid(tmp_path / 'a.max', '0 0\n0 0\n')
    before = source.read_bytes()
    for crs in ('EPSG:4326', 'not-a-crs'):
        with pytest.raises(ValueError):
            export_depth_cog(source, tmp_path / 'out.tif', crs=crs, code_version='v1')
    assert not (tmp_path / 'out.tif').exists() and source.read_bytes() == before


ARTIFACTS_WARNING = 'artefactos numéricos en terreno muy empinado; profundidades poco confiables, la dirección del flujo sí vale'
THRESHOLDS = {'warning': .01, 'fail': .10}


def test_negative_depths_below_one_percent_of_the_water_are_set_to_zero_without_warning(tmp_path):
    # 5 m cells: frame 1 holds 0.6 m x 25 m2 = 15 m3 of water; clipping -0.001 m adds 0.025 m3 (0.17 %).
    ascii_grid(tmp_path / 'a-0000.wd', '0 .1\n.2 .3\n')
    ascii_grid(tmp_path / 'a-0001.wd', '-.001 .1\n.2 .3\n')
    ascii_grid(tmp_path / 'a.max', '.05 .1\n.2 .3\n')
    result = summarize_results(tmp_path, save_interval_s=1)
    assert result['negative_depth'] == {'clipped_cell_frames': 1, 'frames': [1], 'min_m': -.001,
                                        'max_added_volume_ratio': pytest.approx(.001 / .6),
                                        'status': 'minor', 'thresholds': THRESHOLDS}
    assert result['frames'][1]['stats']['min_m'] == 0
    assert not any(ARTIFACTS_WARNING in w for w in result['warnings'])
    clean = tmp_path / 'clean'
    clean.mkdir()
    minimal_outputs(clean)
    assert summarize_results(clean, save_interval_s=1)['negative_depth'] == {
        'clipped_cell_frames': 0, 'frames': [], 'min_m': None, 'max_added_volume_ratio': 0.0,
        'status': 'none', 'thresholds': THRESHOLDS}


def test_negative_depths_between_one_and_ten_percent_keep_the_result_with_a_visible_warning(tmp_path):
    # Frame 1: -0.033 m in one cell against 0.6 m of water left = 5.5 % of the water volume.
    ascii_grid(tmp_path / 'a-0000.wd', '0 .1\n.2 .3\n')
    ascii_grid(tmp_path / 'a-0001.wd', '-.033 .1\n.2 .3\n')
    ascii_grid(tmp_path / 'a.max', '.05 .1\n.2 .3\n')
    result = summarize_results(tmp_path, save_interval_s=1)
    negative = result['negative_depth']
    assert negative['status'] == 'artifacts' and negative['frames'] == [1] and negative['min_m'] == -.033
    assert negative['max_added_volume_ratio'] == pytest.approx(.033 / .6)
    assert ARTIFACTS_WARNING in result['warnings']
    assert result['frames'][1]['stats']['min_m'] == 0


@pytest.mark.parametrize('frame', ['-.07 .1\n.2 .3\n',  # 0.07 / 0.6 = 11.7 % of the water
                                   '-.001 0\n0 0\n'])   # water was added to a dry frame
def test_negative_depths_above_ten_percent_fail_with_a_specific_error(tmp_path, frame):
    from pipeline.hydrology.results import NegativeDepthArtifacts
    ascii_grid(tmp_path / 'a-0000.wd', frame)
    ascii_grid(tmp_path / 'a.max', '.05 .1\n.2 .3\n')
    with pytest.raises(NegativeDepthArtifacts) as error:
        summarize_results(tmp_path, save_interval_s=1)
    assert error.value.code == 'negative_depth_artifacts'


def test_strict_reader_by_default_and_clipping_reader_measures_the_added_volume(tmp_path):
    path = ascii_grid(tmp_path / 'a-0000.wd', '-.03 .1\n.2 .3\n')
    with pytest.raises(ValueError, match='nonnegative'):
        read_depth_ascii(path)  # default stays strict (initial depth and every other reader)
    grid = read_depth_ascii(path, clip_negative=True)
    assert grid['values'][0, 0] == 0
    assert grid['clipped'] == {'cells': 1, 'min_m': -.03, 'added_m3': pytest.approx(.03 * 25),
                               'water_m3': pytest.approx(.6 * 25)}
    with pytest.raises(ValueError, match='nonnegative'):
        export_depth_cog(path, tmp_path / 'strict.tif', crs='EPSG:32615', code_version='test')
    export_depth_cog(path, tmp_path / 'a.tif', crs='EPSG:32615', code_version='test', clip_negative=True)
    with rasterio.open(tmp_path / 'a.tif') as cog:
        assert cog.read(1)[0, 0] == 0


def test_complete_frames_never_include_a_frame_still_being_written(tmp_path):
    from pipeline.hydrology.results import complete_depth_frames
    assert complete_depth_frames(tmp_path) == []
    ascii_grid(tmp_path / 'roi-0000.wd', '0 0\n0 0\n')
    # Newest frame half written (one of two rows): incomplete until it has nrows + 6 newline-terminated lines.
    (tmp_path / 'roi-0001.wd').write_text('ncols 2\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 5\nNODATA_value -9999\n.1 .2\n.3')
    assert [index for index, _ in complete_depth_frames(tmp_path)] == [0]
    (tmp_path / 'roi-0001.wd').write_text('ncols 2\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 5\nNODATA_value -9999\n.1 .2\n.3 .4\n')
    assert [index for index, _ in complete_depth_frames(tmp_path)] == [0, 1]
    # A frame followed by a later one is complete; symlinks, other names and the maximum are ignored.
    (tmp_path / 'roi-0002.wd').write_text('ncols 2\nnrows 2\n')
    (tmp_path / 'roi-0003.wd').symlink_to(tmp_path / 'roi-0000.wd')
    ascii_grid(tmp_path / 'roi.max', '0 0\n0 0\n')
    (tmp_path / 'roi-0001.Vx').write_text('x')
    assert [index for index, _ in complete_depth_frames(tmp_path)] == [0, 1]
    assert complete_depth_frames(tmp_path / 'missing') == []


def test_depth_text_reader_matches_the_file_reader(tmp_path):
    from pipeline.hydrology.results import read_depth_ascii_text
    text = 'ncols 2\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 5\nNODATA_value -9999\n.1 -9999\n-.002 .3\n'
    path = ascii_grid(tmp_path / 'a.wd', '', header=text)
    by_text, by_file = read_depth_ascii_text(text, clip_negative=True), read_depth_ascii(path, clip_negative=True)
    assert by_text['grid'] == by_file['grid'] and by_text['stats'] == by_file['stats']
    assert np.array_equal(by_text['values'], by_file['values'])
    with pytest.raises(ValueError):
        read_depth_ascii_text(text.rsplit('\n', 2)[0])  # a missing row is refused
