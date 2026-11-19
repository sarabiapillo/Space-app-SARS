"""Bounded-window quantitative summaries and raster-derived solar isolines."""
import json
import math

import numpy as np
import rasterio
from matplotlib.figure import Figure
from pyproj import Transformer

# Match the POST preflight budget; avoid analyzing oversized foreign artifacts.
MAX_PIXELS = 500_000
BINS = 20
MAX_CONTOUR_LEVELS = 20
MAX_CONTOUR_WORK = 5_000_000
MAX_CONTOUR_VERTICES = 100_000
MAX_GEOJSON_BYTES = 4 * 1024 * 1024


class ContourTooLarge(Exception):
    """Raster contour work or serialized output exceeds its bounded budget."""


def summarize_incident(path):
    with rasterio.open(path) as src:
        count = src.width * src.height
        if count > MAX_PIXELS:
            raise ValueError('raster exceeds analysis pixel limit')
        if src.count != 1:
            raise ValueError('incident raster must have one band')
        values = []
        for _, window in src.block_windows(1):
            tile = src.read(1, window=window, masked=True)
            data = np.asarray(tile.compressed(), dtype=np.float64)
            data = data[np.isfinite(data)]
            if data.size:
                values.append(data)
        if values:
            data = np.concatenate(values)
            minimum, maximum = float(data.min()), float(data.max())
            edges = np.linspace(minimum, maximum, BINS + 1) if minimum != maximum else np.linspace(minimum - .5, maximum + .5, BINS + 1)
            counts, edges = np.histogram(data, bins=edges)
            median = float(np.median(data))
            mean = float(data.mean())
            valid = int(data.size)
        else:
            edges, counts = np.linspace(0, 1, BINS + 1), np.zeros(BINS, dtype=np.int64)
            minimum = maximum = mean = median = None
            valid = 0
        resolution = [abs(float(src.transform.a)), abs(float(src.transform.e))]
        area = None
        try:
            if src.crs and src.crs.is_projected:
                area = resolution[0] * resolution[1]
        except Exception:
            pass
        return {'units': 'W/m2', 'valid_cells': valid, 'resolution': resolution,
                'resolution_units': 'map_units', 'cell_area': area,
                'cell_area_units': 'map_units^2' if area is not None else None,
                'statistics': {'min': minimum, 'max': maximum, 'mean': mean, 'median': median},
                'histogram': {'bin_edges': edges.tolist(), 'counts': counts.tolist()}}


def _extract_contours(masked, levels):
    figure = Figure()
    axes = figure.subplots()
    try:
        result = axes.contour(np.arange(masked.shape[1]), np.arange(masked.shape[0]),
                              masked, levels=levels)
        return result.levels, result.allsegs
    finally:
        figure.clear()


def contour_geojson(path, *, levels=None):
    """Bounded GeoJSON isolines from raster pixel centers, excluding NoData."""
    with rasterio.open(path) as src:
        pixels = src.width * src.height
        if src.count != 1 or pixels > MAX_PIXELS:
            raise ContourTooLarge('raster exceeds contour pixel limit')
        if src.crs is None:
            raise ValueError('raster CRS is required for GeoJSON contours')
        if src.width < 2 or src.height < 2:
            return {'type': 'FeatureCollection', 'features': []}
        if levels is None:
            level_count = 6
        else:
            levels = [float(level) for level in levels]
            if not 1 <= len(levels) <= MAX_CONTOUR_LEVELS or not all(math.isfinite(v) for v in levels):
                raise ValueError('contour levels must contain 1–20 finite values')
            level_count = len(levels)
        # Reject pathological level × raster requests before allocating the raster
        # array or invoking the contour engine.
        if pixels * level_count > MAX_CONTOUR_WORK:
            raise ContourTooLarge('contour level-pixel work exceeds limit')
        raster = src.read(1, masked=True).astype(np.float64)
        masked = np.ma.masked_invalid(raster)
        finite = masked.compressed()
        if not finite.size:
            return {'type': 'FeatureCollection', 'features': []}
        minimum, maximum = float(finite.min()), float(finite.max())
        if levels is None:
            if minimum == maximum:
                return {'type': 'FeatureCollection', 'features': []}
            levels = np.linspace(minimum, maximum, 8)[1:-1].tolist()
        elif not all(minimum < value < maximum for value in levels):
            raise ValueError('contour levels must be inside the raster value range')
        raw_levels, segments_by_level = _extract_contours(masked, levels)
        to_wgs84 = Transformer.from_crs(src.crs, 'EPSG:4326', always_xy=True)
        features = []
        vertex_count = 0
        geojson_bytes = 128  # FeatureCollection and feature/property structural overhead.
        for level, segments in zip(raw_levels, segments_by_level):
            lines = []
            for segment in segments:
                if len(segment) < 2:
                    continue
                coordinates = []
                for col, row in segment:
                    col_center, row_center = float(col) + 0.5, float(row) + 0.5
                    affine = src.transform
                    x = affine.a * col_center + affine.b * row_center + affine.c
                    y = affine.d * col_center + affine.e * row_center + affine.f
                    lon, lat = to_wgs84.transform(x, y)
                    if not math.isfinite(lon) or not math.isfinite(lat):
                        raise ValueError('raster transform produced invalid GeoJSON coordinate')
                    coordinate = [lon, lat]
                    encoded_size = len(json.dumps(coordinate, separators=(',', ':')))
                    vertex_count += 1
                    geojson_bytes += encoded_size + 1
                    if vertex_count > MAX_CONTOUR_VERTICES or geojson_bytes > MAX_GEOJSON_BYTES:
                        raise ContourTooLarge('contour GeoJSON output exceeds vertex or byte limit')
                    coordinates.append(coordinate)
                lines.append(coordinates)
            if lines:
                feature = {'type': 'Feature',
                           'properties': {'value_w_m2': float(level), 'units': 'W/m2'},
                           'geometry': {'type': 'MultiLineString', 'coordinates': lines}}
                features.append(feature)
        collection = {'type': 'FeatureCollection', 'features': features}
        if len(json.dumps(collection, separators=(',', ':')).encode('utf-8')) > MAX_GEOJSON_BYTES:
            raise ContourTooLarge('serialized contour GeoJSON exceeds byte limit')
        return collection
