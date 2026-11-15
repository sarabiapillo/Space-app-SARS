"""Contrato público de lectura y exportación de profundidades DG2 offline."""
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio

from pipeline.hydrology.results import read_depth_ascii, export_depth_cog, summarize_results

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
    assert any('Qerror/Verror' in w for w in result['warnings'])
    assert any('getfattr' in w for w in result['warnings'])
    json.dumps(result, allow_nan=False)


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
