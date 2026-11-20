"""Copernicus GLO-30 terrain from NASA Earthdata: ASF collection ``NISAR_DEM`` v1.2 (COG tiles).

Verified 2026-11-20 against CMR and the ASF README (NISAR_DEM_v1.2_EPSG4326_README.txt):

- Collection ``NISAR_DEM`` (CMR version "1", concept C3803703055-ASF, DOI 10.5067/NIDEM-1), product
  version 1.2: "based on the Copernicus DEM 30-m (2023_1), referenced to the WGS84 ellipsoid".
- 1 x 1 degree float32 COG tiles named by their south-west corner, ``DEM_N16_00_W094_00_C01.tif``, grouped
  in 10-degree latitude bands and 20-degree longitude groups: ``EPSG4326/N10/N10_W100/<tile>.tif``.
  Ocean tiles exist ("filled with the EGM2008 geoid model"), so coverage is global.
- Heights are ellipsoidal (WGS84); the simulator converts them to EGM2008 (H = h - N_EGM2008, see
  ``pipeline.elevation.vertical_datum``), which puts the geoid-filled ocean at about 0 m.

Only the windows that cover the ROI are read over HTTPS (GDAL /vsicurl on the short-lived signed URL the
Earthdata redirect returns); each clip is cached as a GeoTIFF with a receipt (CMR identity, window, SHA-256).
The remote file's MD5 published in CMR covers the whole tile, so it cannot verify a window; identity is
checked through the CMR granule and the COG's own GRANULE_ID tag. One local process at a time.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile

import numpy as np
import rasterio
from shapely.geometry import box, shape

SHORT_NAME = 'NISAR_DEM'
CMR_VERSION = '1'
VERSION = '1.2'
CONCEPT_ID = 'C3803703055-ASF'
DOI = '10.5067/NIDEM-1'
SOURCE_VERTICAL_DATUM = 'WGS84_ellipsoid'
BASE_URL = 'https://nisar.asf.earthdatacloud.nasa.gov/NISAR/DEM/v1.2/EPSG4326/'
README_URL = 'https://cumulus.asf.earthdatacloud.nasa.gov/PUBLIC/DATA/NISAR/NISAR_DEM_v1.2_EPSG4326_README.txt'
LICENCE_URL = 'https://doi.org/10.5270/ESA-c5d3d65'
# Copernicus DEM licence (COP-DEM-GLO-30-F): free reproduction, distribution and adaptation, with this
# notice for adapted data and the disclaimer below (wording as in the NISAR_DEM README and CMR record).
ATTRIBUTION = ('produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH '
               '2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved')
DISCLAIMER = ('The organizations in charge of the NISAR mission or the Copernicus programme by law or by delegation '
              'do not incur any liability for any use of the Copernicus WorldDEM-30.')
CITATION = ('Copernicus DEM for NISAR v1.2 (EPSG 4326), NASA JPL / ASF, DOI 10.5067/NIDEM-1, from Copernicus DEM 30-m '
            'GLO-30 COP-DEM_GLO-30-DGED/2023_1, DOI 10.5270/ESA-c5d3d65')
_PAD_PIXELS = 2


@dataclass(frozen=True)
class Tile:
    tile_id: str
    lon: int
    lat: int


@dataclass(frozen=True)
class CopernicusTile:
    """One cached window of a NISAR_DEM tile (ellipsoidal heights) and its identity."""
    tile_id: str
    granule_ur: str
    short_name: str
    version: str
    url: str
    window: tuple
    path: Path
    sha256: str


def _ns(value, width):
    return ('N' if value >= 0 else 'S') + format(abs(value), f'0{width}d')


def _ew(value):
    return ('E' if value >= 0 else 'W') + format(abs(value), '03d')


def tile_for(lon, lat):
    """Tile id containing a point, named by its south-west corner (``N16_00_W094_00``)."""
    west, south = math.floor(lon), math.floor(lat)
    return f'{_ns(south, 2)}_00_{_ew(west)}_00'


def _corner(tile_id):
    match = re.fullmatch(r'([NS])(\d{2})_00_([EW])(\d{3})_00', tile_id)
    if not match:
        raise ValueError('invalid NISAR_DEM tile id')
    lat = int(match.group(2)) * (1 if match.group(1) == 'N' else -1)
    lon = int(match.group(4)) * (1 if match.group(3) == 'E' else -1)
    return lon, lat


def tile_relative_path(tile_id, suffix='C01'):
    """Path under ``BASE_URL``: 10-degree latitude band / 20-degree longitude group / tile."""
    lon, lat = _corner(tile_id)
    band, group = math.floor(lat / 10) * 10, math.floor(lon / 20) * 20
    return f'{_ns(band, 2)}/{_ns(band, 2)}_{_ew(group)}/DEM_{tile_id}_{suffix}.tif'


def _granule_ur(tile_id, suffix):
    folder = tile_relative_path(tile_id, suffix).rsplit('/', 1)[0].replace('/', '-')
    return f'v1-2-EPSG4326-{folder}-DEM_{tile_id}_{suffix}-tif'


def _geometry(roi):
    if isinstance(roi, (tuple, list)):
        if len(roi) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in roi):
            raise ValueError('bbox must contain four finite coordinates')
        west, south, east, north = map(float, roi)
        if west < -180 or east > 180 or south < -90 or north > 90 or west >= east or south >= north:
            raise ValueError('bbox is invalid or crosses the antimeridian')
        return box(west, south, east, north)
    try:
        geometry = shape(roi)
    except Exception as exc:
        raise ValueError('ROI must be a valid GeoJSON Polygon or MultiPolygon') from exc
    if geometry.geom_type not in ('Polygon', 'MultiPolygon') or geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
        raise ValueError('ROI must be a valid non-empty Polygon or MultiPolygon')
    west, south, east, north = geometry.bounds
    if west < -180 or east > 180 or south < -90 or north > 90:
        raise ValueError('ROI is outside geographic bounds')
    return geometry


def required_tiles(roi):
    """Tiles whose area intersects the ROI, south to north then west to east. Global coverage."""
    geometry = _geometry(roi)
    west, south, east, north = geometry.bounds
    tiles = []
    for lat in range(math.floor(south), min(89, math.ceil(north) - 1) + 1):
        for lon in range(math.floor(west), min(179, math.ceil(east) - 1) + 1):
            if geometry.intersection(box(lon, lat, lon + 1, lat + 1)).area > 0:
                tiles.append(Tile(tile_for(lon + .5, lat + .5), lon, lat))
    if not tiles:
        raise ValueError('ROI does not intersect any NISAR_DEM tile')
    return tiles


def _sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _cmr_search(bbox):
    import earthaccess
    return earthaccess.search_data(concept_id=CONCEPT_ID, bounding_box=tuple(bbox))


def _authenticate():
    from pipeline.elevation.nasadem import NASADEMProvider
    NASADEMProvider._authenticate_noninteractive()


def _remote_window(url, bounds):
    """Read the window covering ``bounds`` (plus two pixels) from the remote COG; nothing else is fetched."""
    import earthaccess
    from rasterio.windows import Window, from_bounds
    session = earthaccess.get_requests_https_session()
    response = session.get(url, headers={'Range': 'bytes=0-0'}, allow_redirects=True, timeout=60)
    if response.status_code not in (200, 206) or not response.url.startswith('https://'):
        raise RuntimeError('signed URL unavailable')
    signed = response.url
    response.close()
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
                      GDAL_HTTP_MAX_RETRY='3', GDAL_HTTP_RETRY_DELAY='2'):
        with rasterio.open('/vsicurl/' + signed) as dataset:
            if dataset.count != 1 or dataset.dtypes[0] != 'float32' or dataset.crs is None or dataset.crs.to_epsg() != 4326:
                raise ValueError('unexpected NISAR_DEM raster structure')
            window = from_bounds(*bounds, transform=dataset.transform)
            col0 = max(0, math.floor(window.col_off) - _PAD_PIXELS)
            row0 = max(0, math.floor(window.row_off) - _PAD_PIXELS)
            col1 = min(dataset.width, math.ceil(window.col_off + window.width) + _PAD_PIXELS)
            row1 = min(dataset.height, math.ceil(window.row_off + window.height) + _PAD_PIXELS)
            read = Window(col0, row0, col1 - col0, row1 - row0)
            values = dataset.read(1, window=read)
            return {'values': values, 'transform': dataset.window_transform(read), 'window': [col0, row0, col1 - col0, row1 - row0],
                    'granule_id': dataset.tags().get('GRANULE_ID'), 'crs': 'EPSG:4326',
                    'nodata': dataset.nodata}


class CopernicusDEMProvider:
    """Acquire NISAR_DEM windows over a ROI with cache and receipts; mirrors NASADEMProvider.acquire_roi."""

    def __init__(self, cache_dir, *, search=None, open_window=None, authenticate=None):
        self.cache_dir = Path(cache_dir)
        self._search = search or _cmr_search
        self._open_window = open_window or _remote_window
        self._authenticate = authenticate or _authenticate

    def _cache_root(self):
        absolute = self.cache_dir.expanduser().absolute()
        if any(part.is_symlink() for part in (absolute, *absolute.parents)):
            raise ValueError('cache root contains a symlink component')
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        return self.cache_dir.resolve(strict=True)

    @staticmethod
    def _bounds(geometry, tile):
        west, south, east, north = geometry.bounds
        return (max(west, tile.lon), max(south, tile.lat), min(east, tile.lon + 1), min(north, tile.lat + 1))

    @staticmethod
    def _key(tile, bounds):
        digest = hashlib.sha256(json.dumps([round(v, 9) for v in bounds]).encode()).hexdigest()[:12]
        return f'DEM_{tile.tile_id}_{digest}.tif'

    @staticmethod
    def _cached(cache_root, name, tile, bounds):
        path, receipt = cache_root / name, cache_root / f'.{name}.json'
        if path.is_symlink() or receipt.is_symlink():
            raise ValueError('refusing symlink NISAR_DEM cache file')
        if not path.exists() and not receipt.exists():
            return None
        if not path.is_file() or not receipt.is_file():
            raise ValueError('NISAR_DEM cache clip and receipt must both exist; refusing unsafe recovery')
        try:
            stored = json.loads(receipt.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, ValueError) as exc:
            raise ValueError('invalid NISAR_DEM cache receipt') from exc
        if (stored.get('tile_id') != tile.tile_id or stored.get('request_bounds') != [round(v, 9) for v in bounds]
                or stored.get('clip_sha256') != _sha256(path) or stored.get('short_name') != SHORT_NAME):
            raise ValueError('NISAR_DEM cache receipt does not match its clip')
        return CopernicusTile(tile.tile_id, stored['granule_ur'], SHORT_NAME, VERSION, stored['url'],
                              tuple(stored['window']), path, stored['clip_sha256'])

    def _resolve(self, tile):
        try:
            found = self._search((tile.lon + .25, tile.lat + .25, tile.lon + .75, tile.lat + .75))
        except Exception:
            raise RuntimeError('NISAR_DEM search failed (authentication or network error)') from None
        candidates = []
        for result in found or []:
            umm = result.get('umm') if isinstance(result, dict) else None
            collection = umm.get('CollectionReference') if isinstance(umm, dict) else None
            if not isinstance(collection, dict) or collection.get('ShortName') != SHORT_NAME or str(collection.get('Version')) != CMR_VERSION:
                continue
            match = re.fullmatch(r'v1-2-EPSG4326-.+-DEM_(.+)_(C\d{2})-tif', str(umm.get('GranuleUR', '')))
            if not match or match.group(1) != tile.tile_id or umm['GranuleUR'] != _granule_ur(tile.tile_id, match.group(2)):
                continue
            expected = BASE_URL + tile_relative_path(tile.tile_id, match.group(2))
            urls = [u.get('URL') for u in umm.get('RelatedUrls', []) if isinstance(u, dict) and u.get('Type') == 'GET DATA']
            if expected in urls:
                candidates.append((umm['GranuleUR'], expected, match.group(2)))
        if len(candidates) != 1:
            raise ValueError(f'missing or ambiguous NISAR_DEM CMR granule for tile {tile.tile_id}')
        return candidates[0]

    def _write(self, cache_root, name, tile, bounds, granule_ur, url, suffix):
        try:
            clip = self._open_window(url, bounds)
        except ValueError:
            raise
        except Exception:
            # Exception text may carry a signed URL or credentials.
            raise RuntimeError('NISAR_DEM window read failed (authentication or network error)') from None
        if clip.get('granule_id') != f'DEM_{tile.tile_id}_{suffix}':
            raise ValueError('NISAR_DEM remote file identity mismatch')
        values = np.asarray(clip['values'], dtype='float32')
        if values.ndim != 2 or values.size == 0 or clip.get('crs') != 'EPSG:4326':
            raise ValueError('unexpected NISAR_DEM window')
        if clip.get('nodata') is not None:
            values = np.where(values == np.float32(clip['nodata']), np.nan, values).astype('float32')
        fd, temporary = tempfile.mkstemp(prefix='.clip-', suffix='.tif', dir=cache_root)
        os.close(fd)
        target, receipt = cache_root / name, cache_root / f'.{name}.json'
        try:
            with rasterio.open(temporary, 'w', driver='GTiff', width=values.shape[1], height=values.shape[0], count=1,
                               dtype='float32', crs='EPSG:4326', transform=clip['transform'], nodata=float('nan'),
                               compress='deflate') as output:
                output.write(values, 1)
                output.update_tags(GRANULE_ID=clip['granule_id'], SOURCE_URL=url,
                                   VERTICAL_DATUM=SOURCE_VERTICAL_DATUM, ATTRIBUTION=ATTRIBUTION)
            digest = _sha256(temporary)
            record = {'short_name': SHORT_NAME, 'collection_concept_id': CONCEPT_ID, 'version': VERSION,
                      'granule_ur': granule_ur, 'url': url, 'tile_id': tile.tile_id,
                      'request_bounds': [round(v, 9) for v in bounds], 'window': list(clip['window']),
                      'clip_sha256': digest, 'source_vertical_datum': SOURCE_VERTICAL_DATUM}
            try:
                os.link(temporary, target)
            except FileExistsError:
                raise ValueError('NISAR_DEM cache clip appeared during acquisition; refusing overwrite') from None
            receipt.write_text(json.dumps(record, sort_keys=True), encoding='utf-8')
        finally:
            Path(temporary).unlink(missing_ok=True)
        return CopernicusTile(tile.tile_id, granule_ur, SHORT_NAME, VERSION, url, tuple(clip['window']), target, digest)

    def acquire_roi(self, roi):
        """Clips covering the ROI, one per intersecting tile; cache first, then noninteractive login."""
        geometry = _geometry(roi)
        tiles = required_tiles(roi)
        cache_root = self._cache_root()
        records, missing = {}, []
        for tile in tiles:
            bounds = self._bounds(geometry, tile)
            cached = self._cached(cache_root, self._key(tile, bounds), tile, bounds)
            if cached is None:
                missing.append((tile, bounds))
            else:
                records[tile.tile_id] = cached
        if missing:
            self._authenticate()
            for tile, bounds in missing:
                granule_ur, url, suffix = self._resolve(tile)
                records[tile.tile_id] = self._write(cache_root, self._key(tile, bounds), tile, bounds, granule_ur, url, suffix)
        return tuple(records[tile.tile_id] for tile in tiles)
