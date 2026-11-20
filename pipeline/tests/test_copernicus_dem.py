"""NISAR_DEM (Copernicus GLO-30, ellipsoidal) provider: tile layout, CMR identity, window cache (no network)."""
import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.elevation import copernicus as cop


@pytest.mark.parametrize('lon, lat, tile, path', [
    (-93.12, 16.74, 'N16_00_W094_00', 'N10/N10_W100/DEM_N16_00_W094_00_C01.tif'),    # Tuxtla Gutierrez
    (151.205, -33.875, 'S34_00_E151_00', 'S40/S40_E140/DEM_S34_00_E151_00_C01.tif'),  # Sydney
    (36.815, -1.295, 'S02_00_E036_00', 'S10/S10_E020/DEM_S02_00_E036_00_C01.tif'),    # Nairobi
    (-30.45, -20.45, 'S21_00_W031_00', 'S30/S30_W040/DEM_S21_00_W031_00_C01.tif'),    # Atlantic (geoid-filled)
    (10.705, 59.905, 'N59_00_E010_00', 'N50/N50_E000/DEM_N59_00_E010_00_C01.tif'),    # Oslo
    (179.95, 10.15, 'N10_00_E179_00', 'N10/N10_E160/DEM_N10_00_E179_00_C01.tif'),
])
def test_tile_names_and_paths_follow_the_asf_layout(lon, lat, tile, path):
    # Layout verified against CMR granules of C3803703055-ASF (2026-11-20).
    assert cop.tile_for(lon, lat) == tile
    assert cop.tile_relative_path(tile, 'C01') == path


@pytest.mark.parametrize('bounds, tiles', [
    ((-93.12, 16.74, -93.11, 16.75), ['N16_00_W094_00']),
    ((-93.01, 16.79, -92.99, 16.81), ['N16_00_W094_00', 'N16_00_W093_00']),
    ((-0.01, -0.01, 0.01, 0.01), ['S01_00_W001_00', 'S01_00_E000_00', 'N00_00_W001_00', 'N00_00_E000_00']),
    ((151.2, -33.88, 151.21, -33.87), ['S34_00_E151_00']),
])
def test_required_tiles_cover_the_roi_in_both_hemispheres(bounds, tiles):
    assert [t.tile_id for t in cop.required_tiles(bounds)] == tiles


def test_coverage_is_global_unlike_nasadem():
    assert [t.tile_id for t in cop.required_tiles((10.0, 70.2, 10.1, 70.3))] == ['N70_00_E010_00']
    with pytest.raises(ValueError):
        cop.required_tiles((10.0, 16.0, 9.0, 17.0))


def granule(tile, suffix='C01', short_name='NISAR_DEM', version='1', url=None):
    relative = cop.tile_relative_path(tile, suffix)
    ur = 'v1-2-EPSG4326-' + relative.rsplit('/', 1)[0].replace('/', '-') + f'-DEM_{tile}_{suffix}-tif'
    return {'umm': {'GranuleUR': ur, 'CollectionReference': {'ShortName': short_name, 'Version': version},
                    'RelatedUrls': [{'Type': 'GET DATA', 'URL': url or cop.BASE_URL + relative},
                                    {'Type': 'GET DATA VIA DIRECT ACCESS', 'URL': 's3://bucket/' + relative}]}}


class Fake:
    """CMR search and remote window read without network; heights 500 m (ellipsoidal)."""

    def __init__(self, granules=None, granule_id=None):
        self.granules, self.granule_id = granules, granule_id
        self.searches, self.reads, self.logins = [], [], 0

    def search(self, bbox):
        self.searches.append(bbox)
        tile = cop.tile_for((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
        return self.granules(tile) if self.granules else [granule(tile)]

    def open_window(self, url, bounds):
        self.reads.append((url, bounds))
        stem = url.rsplit('/', 1)[1][:-4]
        west, north = bounds[0] - 1 / 7200, bounds[3] + 1 / 7200
        return {'values': np.full((4, 5), 500.0, dtype='float32'), 'transform': from_origin(west, north, 1 / 3600, 1 / 3600),
                'window': [10, 20, 5, 4], 'granule_id': self.granule_id or stem, 'crs': 'EPSG:4326'}

    def authenticate(self):
        self.logins += 1


def provider(tmp_path, fake):
    return cop.CopernicusDEMProvider(tmp_path / 'cache', search=fake.search, open_window=fake.open_window,
                                     authenticate=fake.authenticate)


def test_acquire_reads_only_roi_windows_and_writes_receipts(tmp_path):
    fake = Fake()
    records = provider(tmp_path, fake).acquire_roi((-93.01, 16.79, -92.99, 16.81))
    assert [r.tile_id for r in records] == ['N16_00_W094_00', 'N16_00_W093_00']
    assert fake.logins == 1 and len(fake.reads) == 2
    first = records[0]
    assert first.url == cop.BASE_URL + 'N10/N10_W100/DEM_N16_00_W094_00_C01.tif'
    assert first.granule_ur == 'v1-2-EPSG4326-N10-N10_W100-DEM_N16_00_W094_00_C01-tif'
    assert (first.short_name, first.version) == ('NISAR_DEM', '1.2')
    # Each read covers only the part of the ROI inside its tile.
    assert fake.reads[0][1] == pytest.approx((-93.01, 16.79, -93.0, 16.81))
    with rasterio.open(first.path) as clip:
        assert clip.crs.to_epsg() == 4326 and clip.read(1).mean() == 500.0
    receipt = json.loads(first.path.with_name('.' + first.path.name + '.json').read_text())
    assert receipt['granule_ur'] == first.granule_ur and receipt['clip_sha256'] == first.sha256
    assert receipt['source_vertical_datum'] == 'WGS84_ellipsoid' and receipt['window'] == [10, 20, 5, 4]


def test_a_second_acquisition_reuses_the_cache_without_login_or_network(tmp_path):
    provider(tmp_path, Fake()).acquire_roi((-93.12, 16.74, -93.11, 16.75))
    again = Fake()  # any search or remote read below would raise ZeroDivisionError
    records = cop.CopernicusDEMProvider(tmp_path / 'cache', search=lambda b: 1 / 0, open_window=lambda u, b: 1 / 0,
                                        authenticate=again.authenticate).acquire_roi((-93.12, 16.74, -93.11, 16.75))
    assert again.logins == 0 and len(records) == 1


def test_a_tampered_cached_clip_is_refused(tmp_path):
    record = provider(tmp_path, Fake()).acquire_roi((-93.12, 16.74, -93.11, 16.75))[0]
    record.path.write_bytes(record.path.read_bytes() + b'x')
    with pytest.raises(ValueError, match='receipt'):
        provider(tmp_path, Fake()).acquire_roi((-93.12, 16.74, -93.11, 16.75))


@pytest.mark.parametrize('granules', [
    lambda tile: [],
    lambda tile: [granule(tile), granule(tile, 'C02')],
    lambda tile: [granule('N17_00_W094_00')],
    lambda tile: [granule(tile, short_name='NASADEM_HGT')],
    lambda tile: [granule(tile, url='https://example.org/DEM_' + tile + '_C01.tif')],
])
def test_missing_ambiguous_or_foreign_granules_are_rejected(tmp_path, granules):
    with pytest.raises(ValueError):
        provider(tmp_path, Fake(granules)).acquire_roi((-93.12, 16.74, -93.11, 16.75))
    assert not list((tmp_path / 'cache').glob('*.tif'))


def test_a_remote_file_with_another_identity_is_rejected(tmp_path):
    with pytest.raises(ValueError, match='identity'):
        provider(tmp_path, Fake(granule_id='DEM_N17_00_W094_00_C01')).acquire_roi((-93.12, 16.74, -93.11, 16.75))


def test_network_errors_are_sanitized(tmp_path):
    def search(bbox):
        raise RuntimeError('token=secret-value')
    with pytest.raises(RuntimeError) as error:
        cop.CopernicusDEMProvider(tmp_path / 'cache', search=search, open_window=Fake().open_window,
                                  authenticate=lambda: None).acquire_roi((-93.12, 16.74, -93.11, 16.75))
    assert 'secret' not in str(error.value)


def test_licence_notice_and_disclaimer_are_quoted_for_provenance():
    assert 'Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018' in cop.ATTRIBUTION
    assert 'do not incur any liability' in cop.DISCLAIMER
    assert cop.CONCEPT_ID == 'C3803703055-ASF' and cop.DOI == '10.5067/NIDEM-1'
