"""Conversión estructural DG2: no valida precisión hidráulica."""
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.hydrology.dem_dg2 import prepare_dg2_dem

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / 'data/tools/lisflood-fp-8.0/runtime/build/generateDG2DEM'


def terrain(tmp_path, *, crs='EPSG:32615', nodata=False):
    path = tmp_path / 'terrain.tif'
    values = np.arange(16, dtype='float32').reshape(4, 4)
    if nodata:
        values[1, 1] = np.nan
    with rasterio.open(path, 'w', driver='GTiff', width=4, height=4, count=1,
                       dtype='float32', crs=crs, transform=from_origin(500000, 1800040, 10, 10),
                       nodata=float('nan')) as dst:
        dst.write(values, 1)
    return path


def test_official_helper_generates_geometry_and_coefficients_without_changing_source(tmp_path):
    src = terrain(tmp_path)
    before = src.read_bytes()
    result = prepare_dg2_dem(src, tmp_path / 'dg2', executable=HELPER,
                             vertical_datum='EGM96', code_version='test', timeout_s=10)
    assert src.read_bytes() == before
    assert result['hydraulic_ready'] is False
    assert result['grid']['shape'] == [4, 4]
    assert result['vertical_datum'] == 'EGM96'
    assert set(result['files']) == {'terrain.dem', 'terrain.dem1x', 'terrain.dem1y'}
    assert result['generator']['returncode'] == 0
    assert json.loads((tmp_path / 'dg2/manifest.json').read_text()) == result
    expected = {
        'terrain.dem': np.array([[2.5, 3.5, 4.5, 5],
                                 [6.5, 7.5, 8.5, 9],
                                 [10.5, 11.5, 12.5, 13],
                                 [12.5, 13.5, 14.5, 15]]),
        'terrain.dem1x': np.tile([1 / (2 * np.sqrt(3))] * 3 + [0], (4, 1)),
        'terrain.dem1y': np.array([[-2 / np.sqrt(3)] * 4] * 3 + [[0] * 4]),
    }
    for name, coefficients in expected.items():
        assert (tmp_path / 'dg2' / name).is_file()
        lines = (tmp_path / 'dg2' / name).read_text().splitlines()
        assert lines[0].split() == ['ncols', '4']
        np.testing.assert_allclose(np.loadtxt(tmp_path / 'dg2' / name, skiprows=6),
                                   coefficients, rtol=1e-6, atol=1e-6)
    assert 'nodata_elevation 10000000000' in (tmp_path / 'dg2/prepare.par').read_text()
    with pytest.raises(FileExistsError):
        prepare_dg2_dem(src, tmp_path / 'dg2', executable=HELPER,
                        vertical_datum='EGM96', code_version='test', timeout_s=10)


@pytest.mark.parametrize('case', ['nodata', 'geographic', 'missing_helper'])
def test_invalid_input_is_rejected_before_output_creation(tmp_path, case):
    src = terrain(tmp_path, crs='EPSG:4326' if case == 'geographic' else 'EPSG:32615',
                  nodata=case == 'nodata')
    before = src.read_bytes()
    with pytest.raises((ValueError, FileNotFoundError)):
        prepare_dg2_dem(src, tmp_path / 'dg2', executable=tmp_path / 'absent' if case == 'missing_helper' else HELPER,
                        vertical_datum='EGM96', code_version='test', timeout_s=10)
    assert not (tmp_path / 'dg2').exists()
    assert src.read_bytes() == before
