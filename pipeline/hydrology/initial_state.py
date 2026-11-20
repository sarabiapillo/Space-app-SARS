"""Still-water start for LISFLOOD-FP DG2 (`startfile`): the sea begins at the fixed boundary level.

Without it DG2 starts dry and an HFIX side has to fill the sea during the run, an artificial
transient. Cells start wet when their mean elevation is below the level and they are 4-connected
to an edge cell of a fixed-level side that is also below it; enclosed depressions stay dry.
DG2 reads three grids: the cell-average depth ``H = eta - z`` and its slope coefficients. Setting
``H1x = -Z1x`` and ``H1y = -Z1y`` keeps the free surface flat (lake at rest) over a sloping bed.
The level is a height over EGM2008, the datum of the prepared terrain (NASADEM converted from EGM96,
Copernicus GLO-30 from the WGS84 ellipsoid). Neither DEM carries bathymetry, so a flat sea at the level
gets zero depth, not a real sea floor.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import scipy.ndimage as ndi

from .boundaries import SIDES, normalize_boundary
from .results import read_signed_ascii

_EDGE = {'north': np.s_[0, :], 'south': np.s_[-1, :], 'west': np.s_[:, 0], 'east': np.s_[:, -1]}


def write_still_water_start(dg2_dir, output_dir, sides, *, max_cells=4_000_000, lake_depth=None):
    """Write ``initial.wd``, ``initial.wd1x`` and ``initial.wd1y`` beside a manifest; return a summary.

    ``sides`` fills the sea at the fixed level (None: no sea). ``lake_depth`` (a depth grid on the DEM
    grid, e.g. from HydroLAKES) adds lakes already full to their surface; where both apply the deeper wins.
    """
    dg2_dir, output = Path(dg2_dir), Path(output_dir)
    dem, slope_x, slope_y = (read_signed_ascii(dg2_dir / name, max_cells=max_cells)
                             for name in ('terrain.dem', 'terrain.dem1x', 'terrain.dem1y'))
    if any((g['grid'], g['nodata']) != (dem['grid'], dem['nodata']) for g in (slope_x, slope_y)):
        raise ValueError('DEM slope grids must match the DEM grid')
    z = dem['values']
    level, depth = None, np.zeros_like(z)
    if sides is not None:
        sides = normalize_boundary(sides)
        levels = {spec['level_m'] for spec in sides.values() if spec['type'] == 'fixed_level'}
        if not levels:
            raise ValueError('still-water start needs at least one fixed_level side')
        if len(levels) != 1:
            raise ValueError('still-water start needs every fixed_level side at one level')
        level = levels.pop()
        below = (z != dem['nodata']) & (z < level)
        seeds = np.zeros_like(below)
        for side in SIDES:
            if sides[side]['type'] == 'fixed_level':
                seeds[_EDGE[side]] = below[_EDGE[side]]
        labels, _ = ndi.label(below)  # default structure: 4-connectivity
        sea = np.isin(labels, np.unique(labels[seeds & (labels > 0)]))
        depth = np.where(sea, level - z, 0.0)
    if lake_depth is not None:
        lake_depth = np.asarray(lake_depth, dtype='float64')
        if lake_depth.shape != z.shape:
            raise ValueError('lake depth grid must match the DEM grid')
        depth = np.maximum(depth, np.where(z != dem['nodata'], lake_depth, 0.0))
    sea = depth > 0
    cell = dem['grid']['cellsize_m']
    summary = {'level_m': level, 'wet_cells': int(sea.sum()), 'volume_m3': float(depth.sum() * cell * cell)}
    if lake_depth is not None:
        summary['lake_cells'] = int(np.count_nonzero(lake_depth > 0))
    header = ''.join((dg2_dir / 'terrain.dem').read_text(encoding='ascii').splitlines(keepends=True)[:6])
    output.mkdir(parents=False, exist_ok=False)
    for name, values in (('initial.wd', depth), ('initial.wd1x', np.where(sea, -slope_x['values'], 0.0)),
                         ('initial.wd1y', np.where(sea, -slope_y['values'], 0.0))):
        rows = (' '.join(format(v, '.9g') for v in row) for row in values + 0.0)  # +0.0 drops negative zeros
        (output / name).write_text(header + '\n'.join(rows) + '\n', encoding='ascii')
    manifest = {'sides': sides, 'summary': summary,
                'method': 'cells below the fixed level 4-connected to a fixed-level edge; H = level - z, '
                          'H1x = -Z1x, H1y = -Z1y (flat free surface)',
                'datum': 'EGM2008, the vertical datum of the prepared DEM', 'bathymetry': 'none (terrain DEM only)'}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    return summary
