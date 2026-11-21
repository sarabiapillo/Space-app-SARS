"""EGM2008 as the single vertical datum: conversions with NGA geoid grids (no network)."""
import hashlib
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.elevation import vertical_datum as vd

# Reference geoid heights from GeographicLib's test set GeoidHeights.dat
# (https://sourceforge.net/projects/geographiclib/files/testdata/GeoidHeights.dat.gz, described in
# https://geographiclib.sourceforge.io/C++/doc/geoid.html): NGA harmonic synthesis of each model.
# Columns there: lat, lon (0-360), EGM84, EGM96, EGM2008. Lines used:
#   16.744035 267.231521 -7.908195 -3.129443 -2.478182   (near Tuxtla Gutierrez, Chiapas)
#  -15.244804 168.747961 67.073604 65.225787 65.108852   (Vanuatu, southern hemisphere)
KNOWN = [(-92.768479, 16.744035, -3.129443, -2.478182), (168.747961, -15.244804, 65.225787, 65.108852)]
# Bilinear interpolation of the 15' (EGM96) and 2.5' (EGM2008) grids: GeographicLib reports RMS errors of
# 40 mm and 3.2 mm against the models; 5 cm bounds both points.
TOLERANCE_M = 0.05


def real_grids():
    try:
        return vd.load_grids(vd.DEFAULT_GRID_DIR)
    except (FileNotFoundError, ValueError):
        pytest.skip('geoid grids not installed: python -m pipeline.elevation.vertical_datum prepare')


def constant_grid(path, value):
    """A global 1-degree GeoTIFF with one constant undulation, in the layout of the PROJ grids."""
    data = np.full((181, 361), value, dtype='float32')
    with rasterio.open(path, 'w', driver='GTiff', width=361, height=181, count=1, dtype='float32',
                       crs='EPSG:4326', transform=from_origin(-180.5, 90.5, 1, 1)) as dst:
        dst.write(data, 1)
    return path


@pytest.fixture
def synthetic(tmp_path):
    return {'EGM96': constant_grid(tmp_path / 'egm96.tif', 2.0), 'EGM2008': constant_grid(tmp_path / 'egm08.tif', 0.5)}


@pytest.mark.parametrize('lon, lat, n96, n08', KNOWN)
def test_undulations_match_documented_geoid_heights(lon, lat, n96, n08):
    grids = real_grids()
    assert vd.undulation(np.array([lon]), np.array([lat]), grids['EGM96'])[0] == pytest.approx(n96, abs=TOLERANCE_M)
    assert vd.undulation(np.array([lon]), np.array([lat]), grids['EGM2008'])[0] == pytest.approx(n08, abs=TOLERANCE_M)


def test_a_flat_egm96_dem_is_shifted_by_the_geoid_difference():
    grids = real_grids()
    lon, lat = np.array([k[0] for k in KNOWN]), np.array([k[1] for k in KNOWN])
    converted, details = vd.to_egm2008(np.full(2, 100.0), lon, lat, 'EGM96', grids)
    expected = [100 + n96 - n08 for _, _, n96, n08 in KNOWN]  # 99.348739 and 100.116935
    assert converted == pytest.approx(expected, abs=TOLERANCE_M)
    assert details['from'] == 'EGM96' and details['to'] == 'EGM2008'
    assert details['formula'] == 'h_EGM2008 = h_EGM96 + N_EGM96 - N_EGM2008'


def test_ellipsoidal_heights_subtract_the_egm2008_undulation():
    grids = real_grids()
    lon, lat, _, n08 = KNOWN[0]
    converted, details = vd.to_egm2008(np.array([500.0]), np.array([lon]), np.array([lat]), 'WGS84_ellipsoid', grids)
    assert converted[0] == pytest.approx(500 - n08, abs=TOLERANCE_M)
    assert details['formula'] == 'H_EGM2008 = h_WGS84 - N_EGM2008'


def test_conversion_formulas_with_synthetic_constant_grids(synthetic):
    heights = np.array([[10.0, 20.0], [-5.0, 0.0]])
    lon, lat = np.array([[-93.0, -92.9], [151.2, 0.0]]), np.array([[16.7, 16.7], [-33.9, 0.0]])
    egm96, details = vd.to_egm2008(heights, lon, lat, 'EGM96', synthetic)
    np.testing.assert_allclose(egm96, heights + 1.5)
    assert details['shift_m'] == {'min': 1.5, 'max': 1.5, 'mean': 1.5}
    ellipsoid, _ = vd.to_egm2008(heights, lon, lat, 'WGS84_ellipsoid', synthetic)
    np.testing.assert_allclose(ellipsoid, heights - 0.5)
    same, details = vd.to_egm2008(heights, lon, lat, 'EGM2008', synthetic)
    np.testing.assert_array_equal(same, heights)
    assert details['formula'] is None and details['grids'] == []


def test_conversion_records_the_grids_used(synthetic):
    _, details = vd.to_egm2008(np.array([1.0]), np.array([0.0]), np.array([0.0]), 'EGM96', synthetic)
    names = [g['model'] for g in details['grids']]
    assert names == ['EGM96', 'EGM2008']
    assert details['grids'][0]['sha256'] == hashlib.sha256(Path(synthetic['EGM96']).read_bytes()).hexdigest()


def test_unknown_source_datum_is_rejected(synthetic):
    with pytest.raises(ValueError):
        vd.to_egm2008(np.array([1.0]), np.array([0.0]), np.array([0.0]), 'NAVD88', synthetic)


def test_load_grids_refuses_missing_or_altered_files(tmp_path):
    with pytest.raises(FileNotFoundError, match='prepare'):
        vd.load_grids(tmp_path)
    for spec in vd.GRIDS.values():
        (tmp_path / spec['file']).write_bytes(b'not the NGA grid')
    with pytest.raises(ValueError, match='SHA-256'):
        vd.load_grids(tmp_path)


def test_prepare_downloads_once_and_verifies_the_pinned_hash(tmp_path):
    payload = b'geoid grid bytes'
    specs = {'EGM96': {'file': 'g96.tif', 'url': 'https://cdn.proj.org/g96.tif',
                       'sha256': hashlib.sha256(payload).hexdigest()}}
    calls = []

    def fetch(url, destination):
        calls.append(url)
        Path(destination).write_bytes(payload)

    assert vd.prepare(tmp_path, fetch=fetch, specs=specs) == {'EGM96': tmp_path / 'g96.tif'}
    assert vd.prepare(tmp_path, fetch=fetch, specs=specs) == {'EGM96': tmp_path / 'g96.tif'}
    assert calls == ['https://cdn.proj.org/g96.tif']  # already present and verified: no second download


def test_prepare_rejects_a_download_with_the_wrong_hash_and_leaves_nothing(tmp_path):
    specs = {'EGM96': {'file': 'g96.tif', 'url': 'https://cdn.proj.org/g96.tif', 'sha256': '0' * 64}}
    with pytest.raises(ValueError, match='SHA-256'):
        vd.prepare(tmp_path, fetch=lambda url, destination: Path(destination).write_bytes(b'tampered'), specs=specs)
    assert list(tmp_path.iterdir()) == []


def test_pinned_grids_are_the_public_domain_nga_grids_from_proj():
    assert vd.GRIDS['EGM96']['file'] == 'us_nga_egm96_15.tif'
    assert vd.GRIDS['EGM2008']['file'] == 'us_nga_egm08_25.tif'
    assert all(spec['url'] == 'https://cdn.proj.org/' + spec['file'] for spec in vd.GRIDS.values())
    assert vd.DATUM == 'EGM2008'
