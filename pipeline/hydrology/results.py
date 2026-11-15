"""Lectura offline de profundidad DG2 ASCII (metros sobre el lecho local)."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import re

import numpy as np
import rasterio
from rasterio import shutil as rio_shutil
from rasterio.crs import CRS
from rasterio.io import MemoryFile
from rasterio.transform import from_origin


_HEADERS = ('ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize', 'nodata_value')
_FRAME = re.compile(r'^(.+)-(\d+)\.wd$')


def _limit(max_cells):
    if isinstance(max_cells, bool) or not isinstance(max_cells, int) or max_cells < 1:
        raise ValueError('max_cells must be a positive integer')


def read_depth_ascii(path, max_cells=4_000_000):
    """Parsea seis encabezados ESRI exactos; nodata nunca representa lecho seco."""
    _limit(max_cells)
    path = Path(path)
    with path.open(encoding='ascii') as stream:
        fields = {}
        for expected in _HEADERS:
            parts = stream.readline().split()
            if len(parts) != 2 or parts[0].lower() != expected:
                raise ValueError('invalid ESRI ASCII header')
            try:
                value = float(parts[1])
            except ValueError as exc:
                raise ValueError('invalid ESRI ASCII header value') from exc
            if not math.isfinite(value):
                raise ValueError('nonfinite ESRI ASCII header')
            fields[expected] = value
        width, height = fields['ncols'], fields['nrows']
        if (not width.is_integer() or not height.is_integer() or width < 1 or height < 1 or
                width * height > max_cells or fields['cellsize'] <= 0):
            raise ValueError('invalid or oversized ESRI ASCII grid')
        width, height = int(width), int(height)
        rows = []
        nodata = fields['nodata_value']
        for _ in range(height):
            parts = stream.readline().split()
            if len(parts) != width:
                raise ValueError('incorrect ESRI ASCII shape')
            try:
                row = [float(part) for part in parts]
            except ValueError as exc:
                raise ValueError('invalid depth value') from exc
            if any(not math.isfinite(v) or (v != nodata and v < 0) for v in row):
                raise ValueError('depth must be finite and nonnegative outside nodata')
            rows.append(row)
        if stream.read(1):
            raise ValueError('extra ESRI ASCII data')
    values = np.asarray(rows, dtype='float64')
    mask = values == nodata
    valid = values[~mask]
    if not all(math.isfinite(v) for v in (
            fields['xllcorner'] + width * fields['cellsize'],
            fields['yllcorner'] + height * fields['cellsize'])):
        raise ValueError('nonfinite grid bounds')
    return {
        'values': values, 'nodata': nodata,
        'grid': {'shape': [height, width], 'cellsize_m': fields['cellsize'],
                 'xllcorner': fields['xllcorner'], 'yllcorner': fields['yllcorner']},
        'bounds': [fields['xllcorner'], fields['yllcorner'],
                   fields['xllcorner'] + width * fields['cellsize'],
                   fields['yllcorner'] + height * fields['cellsize']],
        'stats': {'valid_cells': int(valid.size), 'nodata_cells': int(mask.sum()),
                  'wet_cells': int(np.count_nonzero(valid > 0)),
                  'min_m': float(valid.min()) if valid.size else None,
                  'max_m': float(valid.max()) if valid.size else None},
    }


def _sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _metric_crs(crs):
    try:
        parsed = CRS.from_user_input(crs)
        if not parsed.is_projected or not parsed.linear_units_factor or not math.isclose(parsed.linear_units_factor[1], 1):
            raise ValueError('CRS must be projected with metre units')
        return parsed
    except (rasterio.errors.CRSError, TypeError) as exc:
        raise ValueError('explicit valid metric projected CRS required') from exc


def export_depth_cog(path, output_path, *, crs, code_version, max_cells=4_000_000):
    """Exporta COG sin reproyección ni sobrescritura; devuelve SHA256 de origen/destino."""
    target = Path(output_path)
    if target.exists():
        raise FileExistsError(target)
    projected = _metric_crs(crs)
    if not isinstance(code_version, str) or not code_version.strip():
        raise ValueError('code_version must be explicit')
    source = Path(path)
    grid = read_depth_ascii(source, max_cells=max_cells)
    if source.resolve() == target.resolve():
        raise ValueError('output cannot be source')
    values = grid['values'].astype('float32')
    nodata = grid['nodata']
    if not np.isfinite(values).all() or not np.isfinite(np.float32(nodata)) or np.any((grid['values'] != nodata) & (values == np.float32(nodata))):
        raise ValueError('depth/nodata not representable as float32')
    geom = grid['grid']
    transform = from_origin(geom['xllcorner'], grid['bounds'][3], geom['cellsize_m'], geom['cellsize_m'])
    source_hash = _sha(source)
    with MemoryFile() as memory:
        with memory.open(driver='GTiff', height=geom['shape'][0], width=geom['shape'][1],
                         count=1, dtype='float32', crs=projected, transform=transform,
                         nodata=float(np.float32(nodata))) as dataset:
            dataset.write(values, 1)
            dataset.update_tags(source_sha256=source_hash, code_version=code_version,
                                units='m', meaning='water depth above local bed')
        with memory.open() as dataset:
            rio_shutil.copy(dataset, target, driver='COG', compress='DEFLATE',
                            overview_resampling='nearest')
    return {'path': str(target), 'source_sha256': source_hash,
            'output_sha256': _sha(target), 'code_version': code_version,
            'crs': projected.to_string(), 'units': 'm'}


def summarize_results(directory, *, save_interval_s, crs=None, max_cells=4_000_000):
    """Ordena cuadros por índice; solo calcula tiempos programados, no tiempos físicos."""
    if (isinstance(save_interval_s, bool) or not isinstance(save_interval_s, (int, float)) or
            not math.isfinite(save_interval_s) or save_interval_s <= 0):
        raise ValueError('save_interval_s must be finite and positive')
    _limit(max_cells)
    if crs is not None:
        crs = _metric_crs(crs).to_string()
    directory = Path(directory)
    frame_paths = sorted((int(match.group(2)), path) for path in directory.iterdir()
                         if (match := _FRAME.fullmatch(path.name)) and path.is_file())
    maxima = sorted(directory.glob('*.max'))
    if not frame_paths or len(maxima) != 1 or len({index for index, _ in frame_paths}) != len(frame_paths):
        raise ValueError('expected unique indexed .wd frames and one .max')
    prefix = _FRAME.fullmatch(frame_paths[0][1].name).group(1)
    if any(_FRAME.fullmatch(path.name).group(1) != prefix for _, path in frame_paths) or maxima[0].name != prefix + '.max':
        raise ValueError('frames and maximum must share a prefix')
    frames = []
    reference = None
    for index, path in frame_paths + [(None, maxima[0])]:
        data = read_depth_ascii(path, max_cells=max_cells)
        signature = (data['grid'], data['nodata'])
        if reference is None:
            reference = signature
        elif signature != reference:
            raise ValueError('mixed grids across frames/max')
        record = {'file': path.name, 'source_sha256': _sha(path), 'stats': data['stats']}
        if index is None:
            maximum = record
        else:
            scheduled = index * save_interval_s
            if not math.isfinite(scheduled):
                raise ValueError('nonfinite scheduled frame time')
            record.update(frame_index=index, time_s=None, scheduled_time_s=scheduled)
            frames.append(record)
    mass = directory / (prefix + '.mass')
    warnings = ['Qerror/Verror en .mass: balance pendiente, no validado.',
                'getfattr: advertencia del smoke pendiente de investigación.']
    if not mass.is_file():
        warnings[0] = 'Archivo .mass ausente; Qerror/Verror pendientes.'
    return {'grid': {**reference[0], 'crs': crs, 'bounds': data['bounds'], 'nodata': reference[1]},
            'units': 'm above local bed', 'frames': frames, 'maximum': maximum,
            'time_axis': {'status': 'actual_times_unavailable', 'reason': 'DG2 ASCII frames do not record actual physical timestamps; scheduled_time_s is requested, not observed.'},
            'synthetic': True, 'hydraulic_accuracy_validated': False, 'warnings': warnings}
