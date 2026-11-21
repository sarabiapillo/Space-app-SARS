"""Lakes anywhere in the world from HydroLAKES for DG2: a burned bed and still water at the surface.

HydroLAKES v1.0 (Messager et al. 2016, Nature Communications 7:13603; CC BY 4.0) gives about 1.4
million lakes and reservoirs of at least 10 ha with an estimated mean depth (``Depth_avg``). NASADEM
only has the water surface, so each lake bed is dug into the DEM. The surface level is the median DEM
elevation of the lake cells, lowered if needed to the lowest cell just outside the lake so the lake
does not spill at the start (a real run on a karst lake drained violently otherwise). The bed is a
paraboloid of the distance to the shore, scaled so its mean over the lake cells inside the domain
equals ``Depth_avg`` and capped at three times that mean (a cone-like profile reached 20 m before).
Lakes cut by the domain edge are skipped and recorded: they would drain through the boundary (a real
karst-lake run lost 17 % of its lake water in 900 s that way). The DG2 run then starts with the lake full
to that level. This is a recorded terrain change based on an estimated depth, not surveyed bathymetry.

Prepare the dataset once (GeoPackage with a spatial index, only the fields used here):
    python -m pipeline.hydrology.lakes prepare <HydroLAKES_polys_v10_shp.zip or .shp> <output.gpkg>
"""
from __future__ import annotations

import argparse
import math
import subprocess
from pathlib import Path

import numpy as np
import pyogrio
import scipy.ndimage as ndi
from rasterio.features import geometry_mask

FIELDS = ('Hylak_id', 'Lake_name', 'Lake_area', 'Depth_avg', 'Vol_total', 'Elevation')
MAX_DEPTH_RATIO = 3.0  # cap on maximum / mean depth of the dug bed
CITATION = ('HydroLAKES v1.0, Messager, M.L., Lehner, B., Grill, G., Nedeva, I., Schmitt, O. (2016). '
            'Nature Communications 7:13603. CC BY 4.0.')


def prepare_hydrolakes(source, output):
    """Convert the HydroLAKES polygons to a GeoPackage (layer ``lakes``, R-tree index) with GDAL."""
    source, output = Path(source), Path(output)
    if output.exists():
        raise FileExistsError(output)
    path = f'/vsizip/{source}/HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp' if source.suffix == '.zip' else str(source)
    subprocess.run(['ogr2ogr', '-f', 'GPKG', '-nln', 'lakes', '-select', ','.join(FIELDS), str(output), path],
                   check=True, stdin=subprocess.DEVNULL)
    return output


def lakes_in_bounds(path, bounds):
    """Lakes whose bounding box touches ``(west, south, east, north)`` in EPSG:4326."""
    return pyogrio.read_dataframe(path, layer='lakes', bbox=tuple(bounds), columns=list(FIELDS))


def burn_lakes(dem, transform, crs, lakes):
    """Return ``(burned_dem, lake_depth, records)`` for the lakes on this metric grid.

    ``dem`` is a north-up elevation grid in ``crs`` with ``transform``. Lakes without a positive mean
    depth or without any cell centre inside the grid are skipped.
    """
    burned = np.array(dem, dtype='float64')
    depth = np.zeros_like(burned)
    records = []
    if lakes is None or not len(lakes):
        return burned, depth, records
    for lake in lakes.to_crs(crs).itertuples():
        mean_depth = float(lake.Depth_avg) if lake.Depth_avg is not None else math.nan
        if not math.isfinite(mean_depth) or mean_depth <= 0:
            continue
        inside = geometry_mask([lake.geometry], out_shape=burned.shape, transform=transform, invert=True)
        inside &= np.isfinite(burned) & (depth == 0)
        if not inside.any():
            continue
        if inside[0].any() or inside[-1].any() or inside[:, 0].any() or inside[:, -1].any():
            records.append({'hylak_id': int(lake.Hylak_id), 'name': lake.Lake_name or None,
                            'skipped': 'cut by the domain edge'})
            continue
        ring = ndi.binary_dilation(inside) & ~inside & np.isfinite(burned)
        level = float(np.median(burned[inside]))
        if ring.any():
            level = min(level, float(burned[ring].min()))
        # Paraboloid of the distance to the shore (shore cells shallowest), mean = Depth_avg, max <= 3 x mean.
        distance = ndi.distance_transform_edt(inside)[inside]
        shape = 1 - (1 - distance / distance.max()) ** 2
        lake_depth = np.minimum(mean_depth * shape / shape.mean(), MAX_DEPTH_RATIO * mean_depth)
        burned[inside] = level - lake_depth
        depth[inside] = lake_depth
        cell_area = abs(transform.a * transform.e)
        records.append({'hylak_id': int(lake.Hylak_id), 'name': lake.Lake_name or None,
                        'depth_avg_m': mean_depth, 'domain_mean_depth_m': float(lake_depth.mean()), 'area_km2': float(lake.Lake_area),
                        'cells': int(inside.sum()), 'surface_m': level, 'max_depth_m': float(lake_depth.max()),
                        'volume_m3': float(lake_depth.sum() * cell_area)})
    return burned, depth, records


def main():
    parser = argparse.ArgumentParser(description='Prepare HydroLAKES as a GeoPackage for DG2 lakes.')
    sub = parser.add_subparsers(dest='command', required=True)
    prepare = sub.add_parser('prepare', help='convert HydroLAKES polygons to a GeoPackage')
    prepare.add_argument('source', help='HydroLAKES_polys_v10_shp.zip or the .shp inside it')
    prepare.add_argument('output', help='new .gpkg path')
    args = parser.parse_args()
    print(prepare_hydrolakes(args.source, args.output))


if __name__ == '__main__':
    main()
