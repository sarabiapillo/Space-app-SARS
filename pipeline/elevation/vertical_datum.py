"""EGM2008: the single vertical datum of every height the flood simulator uses.

Terrain, fixed sea levels (HFIX ``level_m``) and still-water levels are heights over the EGM2008 geoid.
Sources in another datum are converted explicitly with the NGA geoid undulation grids N:

- NASADEM (EGM96 heights):         h_EGM2008 = h_EGM96 + N_EGM96 - N_EGM2008
- NISAR_DEM / Copernicus GLO-30 (WGS84 ellipsoidal heights):  H_EGM2008 = h_WGS84 - N_EGM2008

The grids are PROJ-data's copies of the NGA grids (public domain), downloaded once with
``python -m pipeline.elevation.vertical_datum prepare`` into ``data/reference/geoid/`` (git-ignored) and
pinned by SHA-256. PROJ's ``vgridshift`` reads them from their absolute path with bilinear interpolation,
so no conversion depends on PROJ's network access or on a grid found elsewhere: a CRS-based transform
(EPSG:4326+5773 -> EPSG:4326+3855) without the grids installed silently falls back to a "ballpark"
zero shift, which this module never uses.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import tempfile
import threading

import numpy as np
from pyproj import Transformer

DATUM = 'EGM2008'
SOURCE_DATUMS = ('EGM2008', 'EGM96', 'WGS84_ellipsoid')
PROJECT = Path(__file__).resolve().parents[2]
DEFAULT_GRID_DIR = PROJECT / 'data/reference/geoid'
LICENCE = 'Public Domain (NGA geoid grids as redistributed by PROJ-data, us_nga_README.txt)'
GRIDS = {
    'EGM96': {'file': 'us_nga_egm96_15.tif', 'url': 'https://cdn.proj.org/us_nga_egm96_15.tif',
              'sha256': 'db493027562c9b004d7220fa881f5603adada4e1c5029b933fa7de4547b0e78d',
              'description': 'NGA EGM96 15-minute worldwide geoid undulation grid'},
    'EGM2008': {'file': 'us_nga_egm08_25.tif', 'url': 'https://cdn.proj.org/us_nga_egm08_25.tif',
                'sha256': '4191d471eefebf24091b56dbc604353cb3b8cf8cc70e448bb9ae56a272bef17a',
                'description': 'NGA EGM2008 2.5-minute worldwide geoid undulation grid'},
}
_FORMULAS = {'EGM2008': None, 'EGM96': 'h_EGM2008 = h_EGM96 + N_EGM96 - N_EGM2008',
             'WGS84_ellipsoid': 'H_EGM2008 = h_WGS84 - N_EGM2008'}
_VERIFIED: dict[tuple, str] = {}
_VERIFIED_GUARD = threading.Lock()


def _sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _digest(path):
    """SHA-256 of a grid, memoized per (path, size, mtime) so each process hashes an unchanged file once."""
    info = Path(path).stat()
    key = (str(Path(path).resolve()), info.st_size, info.st_mtime_ns)
    with _VERIFIED_GUARD:
        if key in _VERIFIED:
            return _VERIFIED[key]
    digest = _sha256(path)
    with _VERIFIED_GUARD:
        _VERIFIED[key] = digest
    return digest


def load_grids(directory=DEFAULT_GRID_DIR):
    """Paths of the installed EGM96 and EGM2008 grids after checking their pinned SHA-256."""
    directory = Path(directory)
    grids = {}
    for model, spec in GRIDS.items():
        path = directory / spec['file']
        if path.is_symlink() or not path.is_file():
            raise FileNotFoundError(f'geoid grid {spec["file"]} not installed; run '
                                    'python -m pipeline.elevation.vertical_datum prepare')
        if _digest(path) != spec['sha256']:
            raise ValueError(f'geoid grid {spec["file"]} does not match its pinned SHA-256')
        grids[model] = path
    return grids


def undulation(lon, lat, grid_path):
    """Geoid undulation N (metres above the WGS84 ellipsoid) at lon/lat degrees, bilinear from the grid."""
    path = Path(grid_path).resolve(strict=True)
    if not re.fullmatch(r'[A-Za-z0-9_./\-]+', path.as_posix()):
        raise ValueError('geoid grid path must not contain spaces or PROJ control characters')
    lon, lat = np.asarray(lon, dtype='float64'), np.asarray(lat, dtype='float64')
    if lon.shape != lat.shape:
        raise ValueError('lon and lat must have the same shape')
    # vgridshift with multiplier=1 adds N to the input height: with z = 0 the output is N itself.
    transformer = Transformer.from_pipeline(
        '+proj=pipeline +step +proj=unitconvert +xy_in=deg +xy_out=rad '
        f'+step +proj=vgridshift +grids={path.as_posix()} +multiplier=1 '
        '+step +proj=unitconvert +xy_in=rad +xy_out=deg')
    _, _, values = transformer.transform(lon.ravel(), lat.ravel(), np.zeros(lon.size), errcheck=True)
    values = np.asarray(values, dtype='float64').reshape(lon.shape)
    if not np.isfinite(values).all() or np.abs(values).max(initial=0) > 200:
        raise ValueError('geoid undulation unavailable at some points')
    return values


def to_egm2008(heights, lon, lat, source_datum, grids):
    """Heights in ``source_datum`` converted to EGM2008 at lon/lat; returns (heights, details).

    ``grids`` maps 'EGM96' and 'EGM2008' to grid paths (``load_grids``). Details record the formula,
    the grids (file name and SHA-256) and the applied shift (min/max/mean metres)."""
    if source_datum not in SOURCE_DATUMS:
        raise ValueError(f'unknown source vertical datum {source_datum!r}')
    heights = np.asarray(heights, dtype='float64')
    if source_datum == 'EGM2008':
        shift, used = np.zeros_like(heights), []
    else:
        used = ['EGM96', 'EGM2008'] if source_datum == 'EGM96' else ['EGM2008']
        n08 = undulation(lon, lat, grids['EGM2008'])
        shift = (undulation(lon, lat, grids['EGM96']) - n08) if source_datum == 'EGM96' else -n08
        if shift.shape != heights.shape:
            raise ValueError('heights and coordinates must have the same shape')
    details = {'from': source_datum, 'to': DATUM, 'formula': _FORMULAS[source_datum],
               'grids': [{'model': model, 'file': Path(grids[model]).name, 'sha256': _digest(grids[model]),
                          'source': GRIDS[model]['url'], 'licence': LICENCE} for model in used],
               'interpolation': 'bilinear (PROJ vgridshift)' if used else None,
               'shift_m': ({'min': float(shift.min()), 'max': float(shift.max()), 'mean': float(shift.mean())}
                           if shift.size else None)}
    return heights + shift, details


def _download(url, destination):
    import requests
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with Path(destination).open('wb') as output:
            for chunk in response.iter_content(1024 * 1024):
                output.write(chunk)


def prepare(directory=DEFAULT_GRID_DIR, *, fetch=_download, specs=None):
    """Download each missing grid once, keep it only if its SHA-256 matches the pin; return their paths."""
    directory = Path(directory)
    if any(part.is_symlink() for part in (directory, *directory.parents)):
        raise ValueError('geoid grid directory contains a symlink')
    directory.mkdir(parents=True, exist_ok=True)
    paths = {}
    for model, spec in (specs or GRIDS).items():
        target = directory / spec['file']
        if target.is_file() and not target.is_symlink():
            if _sha256(target) != spec['sha256']:
                raise ValueError(f'existing {spec["file"]} does not match its pinned SHA-256; remove it and retry')
            paths[model] = target
            continue
        fd, temporary = tempfile.mkstemp(prefix='.' + spec['file'] + '.', dir=directory)
        os.close(fd)
        try:
            fetch(spec['url'], temporary)
            if _sha256(temporary) != spec['sha256']:
                raise ValueError(f'downloaded {spec["file"]} does not match its pinned SHA-256')
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
        paths[model] = target
    return paths


def main(argv=None):
    parser = argparse.ArgumentParser(description='Geoid grids for the EGM2008 vertical datum of the flood simulator.')
    sub = parser.add_subparsers(dest='command', required=True)
    command = sub.add_parser('prepare', help='download the NGA EGM96/EGM2008 grids once (public domain, ~83 MB)')
    command.add_argument('--dir', default=str(DEFAULT_GRID_DIR), help='destination (default data/reference/geoid)')
    args = parser.parse_args(argv)
    for model, path in prepare(args.dir).items():
        print(f'{model}: {path} sha256={GRIDS[model]["sha256"]}')


if __name__ == '__main__':
    main()
