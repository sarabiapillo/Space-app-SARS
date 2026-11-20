"""Open sea-floor elevations from GEBCO for the sea cells of a metric DEM grid (no DEM burning here).

Dataset and licence
    GEBCO_2026 Grid (GEBCO Compilation Group 2026; Nippon Foundation-GEBCO Seabed 2030 Project),
    global, 15 arc-second (~450 m), released April 2026 (file attribute date_created 2026-04-17).
    Terms (gebco.net, "Terms of use"): "The GEBCO Grid is placed in the public domain and may be used
    free of charge"; commercial use is allowed; users must acknowledge the source and must not
    suggest official status. Not for navigation. The official distribution (BODC/CEDA,
    https://www.gebco.net/data-products/gridded-bathymetry-data) is a zipped global NetCDF, 90 x 90
    degree GeoTIFF tiles or a user-defined area from https://download.gebco.net; no WCS or COG is
    offered there. The default source below is a Cloud Optimized GeoTIFF copy of the same grid kept
    by the Australian Antarctic Division on Source Cooperative (it carries the original GEBCO_2026
    NetCDF attributes); any official GeoTIFF tile or area download can be passed as ``source``.
    The GDAL in env ``nisar`` has no NetCDF/HDF5 driver, so GeoTIFF is the supported input.

Vertical datum
    GEBCO heights are "height_above_mean_sea_level" (negative below the sea surface); shallow-water
    parts may use other chart datums. Returned elevations are on MSL unless ``msl_offset_m`` (the
    mean dynamic topography, e.g. ``pipeline.hydrology.tides.mdt_offset_m``) is added to move them
    to EGM2008; the provenance records which. At ~450 m GEBCO does not resolve coastal lagoons.

Cache a window once (data/reference/gebco/ is ignored by git):
    python -m pipeline.hydrology.bathymetry prepare <west> <south> <east> <north> [--output PATH] [--source PATH|URL]
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import rasterio
import scipy.ndimage as ndi
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

REPO = Path(__file__).resolve().parents[2]
DEFAULT_GEBCO_DIR = REPO / 'data' / 'reference' / 'gebco'
GEBCO_COG_URL = 'https://data.source.coop/ausantarctic/gebco/GEBCO_2026.tif'
GEBCO_OFFICIAL_URL = 'https://www.gebco.net/data-products/gridded-bathymetry-data'
GEBCO_CITATION = ('GEBCO Compilation Group (2026) GEBCO_2026 Grid. Public domain (GEBCO terms of use). '
                  'Not to be used for navigation.')
SEA_DEM_MAX_M = 0.5  # DEM cells at or below this height (sea surface in NASADEM/Copernicus ~0 m) may be sea
WINDOW_MARGIN_DEG = 2 / 240  # two GEBCO cells around the target grid so resampling has neighbours


def _open_path(source):
    source = str(source)
    return f'/vsicurl/{source}' if source.startswith(('http://', 'https://')) else source


def read_gebco_window(bounds, source=GEBCO_COG_URL):
    """GEBCO cells inside ``(west, south, east, north)`` (EPSG:4326): ``(elevation_m, transform, crs)``.

    Only that window is read (a COG over HTTP fetches just the needed blocks). Elevations are float64
    metres about MSL; nodata becomes NaN.
    """
    west, south, east, north = bounds
    with rasterio.open(_open_path(source)) as src:
        window = from_bounds(west, south, east, north, transform=src.transform)
        window = window.round_offsets(op='floor').round_lengths(op='ceil')
        window = window.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        data = src.read(1, window=window, masked=True).astype('float64').filled(np.nan)
        return data, src.window_transform(window), src.crs


def prepare_gebco(bounds, output, source=GEBCO_COG_URL):
    """Cache the GEBCO window for ``bounds`` (EPSG:4326) as a GeoTIFF at ``output``."""
    data, transform, crs = read_gebco_window(bounds, source)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    profile = {'driver': 'GTiff', 'width': data.shape[1], 'height': data.shape[0], 'count': 1,
               'dtype': 'float32', 'crs': crs, 'transform': transform, 'nodata': np.nan, 'compress': 'deflate'}
    with rasterio.open(output, 'w', **profile) as dst:
        dst.write(data.astype('float32'), 1)
        dst.update_tags(source=str(source), citation=GEBCO_CITATION, vertical_datum='mean sea level')
    return output


def gebco_on_grid(transform, crs, shape, source=GEBCO_COG_URL, resampling=Resampling.bilinear):
    """GEBCO elevations (m about MSL) resampled onto a north-up grid ``(transform, crs, shape)``."""
    rows, cols = shape
    west, north = transform.c, transform.f
    east, south = west + cols * transform.a, north + rows * transform.e
    lon0, lat0, lon1, lat1 = transform_bounds(crs, 'EPSG:4326', west, south, east, north, densify_pts=21)
    margin = WINDOW_MARGIN_DEG
    data, src_transform, src_crs = read_gebco_window((lon0 - margin, lat0 - margin, lon1 + margin, lat1 + margin),
                                                     source)
    out = np.full(shape, np.nan, dtype='float64')
    reproject(data, out, src_transform=src_transform, src_crs=src_crs, dst_transform=transform, dst_crs=crs,
              src_nodata=np.nan, dst_nodata=np.nan, resampling=resampling)
    return out


_EDGES = {'north': np.s_[0, :], 'south': np.s_[-1, :], 'west': np.s_[:, 0], 'east': np.s_[:, -1]}


def sea_cell_elevations(dem, transform, crs, *, sea_mask=None, msl_offset_m=None, source=GEBCO_COG_URL,
                        sea_dem_max_m=SEA_DEM_MAX_M, gebco_reader=gebco_on_grid, sea_edges=None):
    """GEBCO sea-floor elevation for the sea cells of a metric DEM grid.

    Without ``sea_mask`` a cell is sea when GEBCO is below MSL, the DEM is at most ``sea_dem_max_m``
    (the DEM shows the sea surface there) and the cell connects through such cells to the grid edge
    (so an inland pit or a closed lagoon is not taken as sea). ``sea_edges`` (names among north, east,
    south, west) limits that edge to the given sides, e.g. the sea sides of a boundary. Returns ``{'sea', 'elevation',
    'provenance'}``: ``elevation`` is GEBCO (+ ``msl_offset_m`` if given) on sea cells and NaN elsewhere.
    """
    dem = np.asarray(dem, dtype='float64')
    gebco = np.asarray(gebco_reader(transform, crs, dem.shape, source=source), dtype='float64')
    if gebco.shape != dem.shape:
        raise ValueError('GEBCO grid does not match the DEM shape')
    if sea_mask is None:
        candidate = np.isfinite(gebco) & (gebco < 0) & np.isfinite(dem) & (dem <= sea_dem_max_m)
        labels, _ = ndi.label(candidate)
        if sea_edges is None:
            edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
            where = 'the grid edge'
        else:
            names = list(sea_edges)
            if not names or any(name not in _EDGES for name in names):
                raise ValueError('sea_edges must name sides among north, east, south and west')
            edge = np.unique(np.concatenate([labels[_EDGES[name]] for name in names]))
            where = 'a sea-side edge (' + ', '.join(names) + ')'
        sea = np.isin(labels, edge[edge > 0])
        rule = f'GEBCO < 0 m, DEM <= {sea_dem_max_m} m and connected to {where}'
    else:
        sea = np.asarray(sea_mask, dtype=bool)
        if sea.shape != dem.shape:
            raise ValueError('sea_mask does not match the DEM shape')
        rule = 'sea_mask given by the caller'
    offset = 0.0
    if msl_offset_m is None:
        datum = 'mean sea level (GEBCO; MDT not applied)'
    elif isinstance(msl_offset_m, (int, float)) and not isinstance(msl_offset_m, bool) and math.isfinite(msl_offset_m):
        offset = float(msl_offset_m)
        datum = 'EGM2008 via MSL + explicit MDT offset'
    else:
        raise ValueError('msl_offset_m must be a finite number of metres or None')
    elevation = np.where(sea, gebco + offset, np.nan)
    provenance = {'dataset': 'GEBCO_2026 Grid', 'citation': GEBCO_CITATION, 'licence': 'public domain',
                  'source': str(source), 'official': GEBCO_OFFICIAL_URL, 'resolution': '15 arc-second (~450 m)',
                  'datum': datum, 'sea_rule': rule, 'sea_cells': int(sea.sum()),
                  'sea_cells_without_gebco_depth': int((sea & ~(np.isfinite(gebco) & (gebco < 0))).sum())}
    if msl_offset_m is not None:
        provenance['msl_offset_m'] = offset
    return {'sea': sea, 'elevation': elevation, 'provenance': provenance}


def main():
    parser = argparse.ArgumentParser(description='Cache a GEBCO_2026 window (EPSG:4326 bounds) as a GeoTIFF.')
    sub = parser.add_subparsers(dest='command', required=True)
    prepare = sub.add_parser('prepare', help='read a window of GEBCO and save it under data/reference/gebco/')
    for name in ('west', 'south', 'east', 'north'):
        prepare.add_argument(name, type=float)
    prepare.add_argument('--output', help='GeoTIFF path (default: data/reference/gebco/gebco_2026_<bounds>.tif)')
    prepare.add_argument('--source', default=GEBCO_COG_URL, help='GEBCO GeoTIFF path or URL')
    args = parser.parse_args()
    bounds = (args.west, args.south, args.east, args.north)
    output = args.output or DEFAULT_GEBCO_DIR / ('gebco_2026_' + '_'.join(f'{v:.4f}' for v in bounds) + '.tif')
    print(prepare_gebco(bounds, output, args.source))


if __name__ == '__main__':
    main()
