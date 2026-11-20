"""prepare_dem in the single EGM2008 datum: NASADEM (EGM96) and NISAR_DEM (ellipsoidal) sources."""
import hashlib
import json
from pathlib import Path
import zipfile

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.elevation.copernicus import CopernicusTile
from pipeline.elevation.nasadem import NASADEMGranule
from pipeline.hydrology.dem_prepared import prepare_dem


def constant_grid(path, value):
    with rasterio.open(path, 'w', driver='GTiff', width=361, height=181, count=1, dtype='float32',
                       crs='EPSG:4326', transform=from_origin(-180.5, 90.5, 1, 1)) as dst:
        dst.write(np.full((181, 361), value, dtype='float32'), 1)
    return path


@pytest.fixture
def grids(tmp_path):
    # Synthetic constant undulations: N_EGM96 = 2.0 m, N_EGM2008 = 0.5 m.
    return {'EGM96': constant_grid(tmp_path / 'g96.tif', 2.0), 'EGM2008': constant_grid(tmp_path / 'g08.tif', 0.5)}


@pytest.fixture(scope='module')
def hgt_zip(tmp_path_factory):
    path = tmp_path_factory.mktemp('flat-nasadem') / 'n00e000.zip'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('n00e000.hgt', np.full((3601, 3601), 100, dtype='>i2').tobytes())
    return path


def copernicus_clip(tmp_path, value=100.0):
    path = tmp_path / 'DEM_N00_00_E000_00_clip.tif'
    with rasterio.open(path, 'w', driver='GTiff', width=40, height=40, count=1, dtype='float32', crs='EPSG:4326',
                       transform=from_origin(0.1, 0.9, 0.02, 0.02), nodata=float('nan')) as dst:
        dst.write(np.full((40, 40), value, dtype='float32'), 1)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return CopernicusTile('N00_00_E000_00', 'v1-2-EPSG4326-N00-N00_E000-DEM_N00_00_E000_00_C01-tif', 'NISAR_DEM', '1.2',
                          'https://nisar.asf.earthdatacloud.nasa.gov/NISAR/DEM/v1.2/EPSG4326/N00/N00_E000/DEM_N00_00_E000_00_C01.tif',
                          (0, 0, 40, 40), path, digest)


def polygon(west=0.2, south=0.2, east=0.8, north=0.8):
    return {'type': 'Polygon', 'coordinates': [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}


def prepare(records, destination, datum, grids):
    return prepare_dem(polygon(), records, destination, target_crs='EPSG:32631', resolution_m=1000, resampling='nearest',
                       max_cells=10000, target_vertical_datum=datum, code_version='test', geoid_grids=grids)


def values(destination):
    with rasterio.open(destination / 'terrain.tif') as raster:
        return raster.read(1, masked=True).compressed()


def test_flat_egm96_nasadem_becomes_egm2008_shifted_by_n96_minus_n08(hgt_zip, tmp_path, grids):
    destination = prepare([NASADEMGranule('n00e000', 'NASADEM_HGT_n00e000', 'NASADEM_HGT', '001', hgt_zip)],
                          tmp_path / 'out', 'EGM2008', grids)
    assert np.allclose(values(destination), 101.5)
    manifest = json.loads((destination / 'manifest.json').read_text())
    assert manifest['vertical_datum'] == manifest['target_vertical_datum'] == 'EGM2008'
    assert manifest['source']['vertical_datum'] == 'EGM96'
    conversion = manifest['vertical_conversion']
    assert conversion['from'] == 'EGM96' and conversion['formula'] == 'h_EGM2008 = h_EGM96 + N_EGM96 - N_EGM2008'
    assert [g['model'] for g in conversion['grids']] == ['EGM96', 'EGM2008']
    assert conversion['shift_m'] == pytest.approx({'min': 1.5, 'max': 1.5, 'mean': 1.5})


def test_ellipsoidal_copernicus_heights_subtract_n_egm2008(tmp_path, grids):
    destination = prepare([copernicus_clip(tmp_path)], tmp_path / 'out', 'EGM2008', grids)
    assert np.allclose(values(destination), 99.5)
    manifest = json.loads((destination / 'manifest.json').read_text())
    assert manifest['vertical_datum'] == 'EGM2008'
    assert manifest['source']['product'] == 'NISAR_DEM' and manifest['source']['version'] == '1.2'
    assert manifest['source']['vertical_datum'] == 'WGS84_ellipsoid'
    assert manifest['source']['records'][0]['granule_ur'].endswith('DEM_N00_00_E000_00_C01-tif')
    assert 'Copernicus WorldDEM-30' in manifest['source']['attribution']
    assert manifest['vertical_conversion']['formula'] == 'H_EGM2008 = h_WGS84 - N_EGM2008'


def test_copernicus_clips_are_never_kept_ellipsoidal(tmp_path, grids):
    with pytest.raises(ValueError):
        prepare([copernicus_clip(tmp_path)], tmp_path / 'out', 'EGM96', grids)
    assert not (tmp_path / 'out').exists()


def test_a_copernicus_clip_altered_after_acquisition_is_rejected(tmp_path, grids):
    record = copernicus_clip(tmp_path)
    Path(record.path).write_bytes(Path(record.path).read_bytes() + b'x')
    with pytest.raises(ValueError):
        prepare([record], tmp_path / 'out', 'EGM2008', grids)


def test_mixed_sources_are_rejected(hgt_zip, tmp_path, grids):
    nasadem = NASADEMGranule('n00e000', 'NASADEM_HGT_n00e000', 'NASADEM_HGT', '001', hgt_zip)
    with pytest.raises(ValueError):
        prepare([nasadem, copernicus_clip(tmp_path)], tmp_path / 'out', 'EGM2008', grids)


def test_egm96_target_keeps_nasadem_unchanged_without_grids(hgt_zip, tmp_path):
    destination = prepare([NASADEMGranule('n00e000', 'NASADEM_HGT_n00e000', 'NASADEM_HGT', '001', hgt_zip)],
                          tmp_path / 'out', 'EGM96', None)
    assert np.allclose(values(destination), 100)
    manifest = json.loads((destination / 'manifest.json').read_text())
    assert manifest['vertical_datum'] == 'EGM96' and manifest['vertical_conversion'] is None
