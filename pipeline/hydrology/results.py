"""Lectura offline de profundidad DG2 ASCII (metros sobre el lecho local)."""
from __future__ import annotations

import hashlib
import heapq
import math
from pathlib import Path
import re

import numpy as np
import rasterio
from rasterio import shutil as rio_shutil
from rasterio.crs import CRS
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from pyproj import Geod, Transformer


_HEADERS = ('ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize', 'nodata_value')
_FRAME = re.compile(r'^(.+)-(\d+)\.wd$')
# Arrows show overflow only: water at least FLOW_MIN_DEPTH_M deep outside the channel network
# (D8 upslope area >= CHANNEL_MIN_UPSLOPE_KM2, the same rule as the terrapulseai_v2 simulator) and
# outside the initial sea. Thin films also give spurious HU/H speeds, another reason for the depth floor.
FLOW_MIN_DEPTH_M = .15
FLOW_MAX_ARROWS = 150
CHANNEL_MIN_UPSLOPE_KM2 = .12
FLOW_METHOD = ('overflow only: depth-weighted block mean of LISFLOOD-FP voutput Vx/Vy (HU/H) over cells at '
               'least min_depth_m deep, outside the D8 channel network of the solver DEM (upslope area >= '
               'channel_min_upslope_km2) and outside the initial sea; Vx positive east, Vy positive north')
# Lower bounds (m) of the depth classes used by the preview palette, the map legend and the charts.
DEPTH_CLASS_BOUNDS_M = (.03, .15, .5, 1, 2)
_D8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _limit(max_cells):
    if isinstance(max_cells, bool) or not isinstance(max_cells, int) or max_cells < 1:
        raise ValueError('max_cells must be a positive integer')


def read_depth_ascii(path, max_cells=4_000_000):
    """Parsea seis encabezados ESRI exactos; nodata nunca representa lecho seco."""
    return _read_ascii(path, max_cells, nonnegative=True)


def read_signed_ascii(path, max_cells=4_000_000):
    """Same ESRI grid contract as depth, but values (velocity, elevation, slopes) may be negative."""
    return _read_ascii(path, max_cells, nonnegative=False)


read_velocity_ascii = read_signed_ascii


def _read_ascii(path, max_cells, *, nonnegative):
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
                raise ValueError('invalid depth value' if nonnegative else 'invalid grid value') from exc
            if any(not math.isfinite(v) or (nonnegative and v != nodata and v < 0) for v in row):
                raise ValueError('depth must be finite and nonnegative outside nodata' if nonnegative
                                 else 'values must be finite')
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


def summarize_results(directory, *, save_interval_s, crs=None, max_cells=4_000_000, initial_depth=None):
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
    velocity = {index: (path.with_suffix('.Vx'), path.with_suffix('.Vy')) for index, path in frame_paths}
    present = [vx.is_file() and vy.is_file() for vx, vy in velocity.values()]
    flow = froude = concentration = None
    dem_path = directory / (prefix + '.dem')
    if crs is not None and any(present) and dem_path.is_file():
        if not all(present):
            raise ValueError('incomplete velocity frames')
        flow = {'units': 'm/s', 'min_depth_m': FLOW_MIN_DEPTH_M, 'channel_min_upslope_km2': CHANNEL_MIN_UPSLOPE_KM2,
                'max_arrows': FLOW_MAX_ARROWS, 'method': FLOW_METHOD, 'frames': []}
        froude = {'min_depth_m': FLOW_MIN_DEPTH_M, 'method': 'Fr = |v| / sqrt(g h), g = 9.81 m/s2, solver HU/H velocity',
                  'frames': []}
        dem = read_signed_ascii(dem_path, max_cells=max_cells)
        concentration = time_of_concentration(dem, crs)
        eligible = (dem['values'] != dem['nodata']) & ~channel_network(dem)
        grids = [dem]
        if initial_depth is not None:
            start = read_depth_ascii(initial_depth, max_cells=max_cells)
            eligible &= ~((start['values'] != start['nodata']) & (start['values'] > 0))
            grids.append(start)
    frames = []
    reference = None
    for index, path in frame_paths + [(None, maxima[0])]:
        data = read_depth_ascii(path, max_cells=max_cells)
        signature = (data['grid'], data['nodata'])
        if reference is None:
            reference = signature
        elif signature != reference:
            raise ValueError('mixed grids across frames/max')
        record = {'file': path.name, 'source_sha256': _sha(path),
                  'stats': {**data['stats'], 'depth_class_cells': _depth_class_cells(data)}}
        if index is None:
            maximum = record
        else:
            scheduled = index * save_interval_s
            if not math.isfinite(scheduled):
                raise ValueError('nonfinite scheduled frame time')
            record.update(frame_index=index, time_s=None, scheduled_time_s=scheduled)
            frames.append(record)
            if flow is not None:
                vx, vy = (read_velocity_ascii(item, max_cells=max_cells) for item in velocity[index])
                if any((item['grid'], item['nodata']) != signature for item in (vx, vy)):
                    raise ValueError('velocity grid must match the depth grid')
                if any(item['grid'] != signature[0] for item in grids):
                    raise ValueError('DEM and initial depth grids must match the depth grid')
                arrows = flow_arrows(data, vx['values'], vy['values'], crs=crs, eligible=eligible)
                flow['frames'].append({'frame_index': index, 'arrows': arrows,
                                       'max_speed_m_s': max((a[2] for a in arrows), default=0)})
                froude['frames'].append({'frame_index': index, **froude_frame(data, vx['values'], vy['values'])})
    mass = directory / (prefix + '.mass')
    balance = None
    if not mass.is_file():
        warnings = ['Archivo .mass ausente; balance de masa no disponible.']
    else:
        try:
            balance = mass_balance(mass)
            warnings = [f"Balance de masa con lluvia incluida: error máximo por intervalo "
                        f"{balance['max_abs_interval_error_m3']:.3g} m³ sobre {balance['rain_m3']:.6g} m³ de lluvia; "
                        f"mide conservación numérica, no exactitud hidráulica."]
        except (ValueError, OSError, IndexError):
            warnings = ['Archivo .mass ilegible; balance de masa no disponible.']
    return {'grid': {**reference[0], 'crs': crs, 'bounds': data['bounds'], 'nodata': reference[1]},
            'units': 'm above local bed', 'frames': frames, 'maximum': maximum,
            'time_axis': {'status': 'actual_times_unavailable', 'reason': 'DG2 ASCII frames do not record actual physical timestamps; scheduled_time_s is requested, not observed.'},
            'mass_balance': balance, 'flow': flow, 'froude': froude, 'time_of_concentration': concentration, 'depth_classes_m': list(DEPTH_CLASS_BOUNDS_M),
            'synthetic': True, 'hydraulic_accuracy_validated': False, 'warnings': warnings}


def channel_network(dem, min_upslope_km2=CHANNEL_MIN_UPSLOPE_KM2):
    """Cells whose D8 (steepest descent) upslope area, the cell included, reaches ``min_upslope_km2``.

    Same area rule as the terrapulseai_v2 simulator, but pits are filled first (priority-flood):
    unfilled, a 30 m NASADEM network breaks at every small pit (1 channel cell of 1680 in a real run,
    59 after filling), and water ponded in a filled pit counts as outside the channel.
    """
    d8 = _d8(dem)
    return d8['valid'] & (d8['area_km2'] >= min_upslope_km2)


def _d8(dem):
    """Pit-filled D8 routing: receiver and step length per cell, upslope area and the longest
    upstream flow path (length and the original elevation of its head) for every cell."""
    nodata = dem['nodata']
    rows, cols = dem['values'].shape
    cell = dem['grid']['cellsize_m']
    valid = dem['values'] != nodata
    z = fill_pits(dem['values'], valid)
    padded = np.pad(np.where(valid, z, np.inf), 1, constant_values=np.inf)
    slopes = np.stack([(z - padded[1 + dr:1 + dr + rows, 1 + dc:1 + dc + cols]) / (cell * math.hypot(dr, dc))
                       for dr, dc in _D8])
    best = slopes.argmax(axis=0)
    drains = valid & (slopes.max(axis=0) > 0)
    index = np.arange(rows * cols).reshape(rows, cols)
    shift = np.array([dr * cols + dc for dr, dc in _D8])
    distance = np.array([cell * math.hypot(dr, dc) for dr, dc in _D8])
    receiver = np.where(drains, index + shift[best], -1).ravel()
    step = distance[best].ravel()
    area = np.where(valid, 1.0, 0.0).ravel()
    longest = np.zeros(rows * cols)
    head = np.where(valid, dem['values'], np.nan).astype('float64').ravel()
    for i in np.argsort(np.where(valid, z, -np.inf).ravel(), kind='stable')[::-1]:
        r = receiver[i]
        if r >= 0:
            area[r] += area[i]
            if longest[i] + step[i] > longest[r]:
                longest[r], head[r] = longest[i] + step[i], head[i]
    return {'valid': valid, 'area_km2': area.reshape(rows, cols) * cell * cell / 1e6,
            'longest_m': longest.reshape(rows, cols), 'head_z': head.reshape(rows, cols)}


def time_of_concentration(dem, crs):
    """Kirpich (1940) on the longest D8 flow path to the main outlet (largest upslope area).

    tc [min] = 0.0195 L^0.77 S^-0.385, L in m and S = (head - outlet elevation) / L. Kirpich derived it
    for small rural basins; here it is an indicator for the computational domain, not a calibrated value.
    """
    d8 = _d8(dem)
    area = np.where(d8['valid'], d8['area_km2'], -1)
    r, c = np.unravel_index(int(area.argmax()), area.shape)
    length = float(d8['longest_m'][r, c])
    drop = float(d8['head_z'][r, c] - dem['values'][r, c])
    if length <= 0 or drop <= 0:
        return None
    slope = drop / length
    grid = dem['grid']
    x = grid['xllcorner'] + (c + .5) * grid['cellsize_m']
    y = grid['yllcorner'] + (area.shape[0] - r - .5) * grid['cellsize_m']
    lon, lat = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform(x, y)
    return {'method': 'Kirpich (1940): tc_min = 0.0195 L^0.77 S^-0.385 on the longest pit-filled D8 path to the main outlet',
            'minutes': .0195 * length ** .77 * slope ** -.385, 'flow_length_m': length, 'slope_m_m': slope,
            'upslope_area_km2': float(d8['area_km2'][r, c]), 'outlet': [round(lon, 6), round(lat, 6)]}


def froude_frame(depth, vx, vy, *, min_depth_m=FLOW_MIN_DEPTH_M):
    """Froude number |v| / sqrt(g h) over cells at least ``min_depth_m`` deep (thin films are spurious)."""
    h = depth['values']
    keep = (h != depth['nodata']) & (h >= min_depth_m) & (vx != depth['nodata']) & (vy != depth['nodata'])
    if not keep.any():
        return {'cells': 0, 'max': None, 'mean': None, 'supercritical_cells': 0}
    froude = np.hypot(vx[keep], vy[keep]) / np.sqrt(9.81 * h[keep])
    return {'cells': int(keep.sum()), 'max': float(froude.max()), 'mean': float(froude.mean()),
            'supercritical_cells': int((froude > 1).sum())}


def fill_pits(z, valid, epsilon=1e-4):
    """Priority-flood depression filling (Barnes et al. 2014) seeded from the grid edges and nodata.

    Each filled cell is raised to at least ``epsilon`` above the cell it was reached from, so
    filled flats still drain toward their spill point.
    """
    rows, cols = z.shape
    filled = np.where(valid, z, -np.inf).astype('float64')
    seen = ~valid.copy()
    queue = []
    for r in range(rows):
        for c in range(cols):
            edge = r in (0, rows - 1) or c in (0, cols - 1) or any(
                0 <= r + dr < rows and 0 <= c + dc < cols and not valid[r + dr, c + dc] for dr, dc in _D8)
            if valid[r, c] and edge:
                seen[r, c] = True
                heapq.heappush(queue, (filled[r, c], r, c))
    while queue:
        level, r, c = heapq.heappop(queue)
        for dr, dc in _D8:
            rr, cc = r + dr, c + dc
            if 0 <= rr < rows and 0 <= cc < cols and not seen[rr, cc]:
                seen[rr, cc] = True
                filled[rr, cc] = max(filled[rr, cc], level + epsilon)
                heapq.heappush(queue, (filled[rr, cc], rr, cc))
    return filled


def flow_arrows(depth, vx, vy, *, crs, eligible=None, max_arrows=FLOW_MAX_ARROWS, min_depth_m=FLOW_MIN_DEPTH_M):
    """Aggregate solver velocities into at most ``max_arrows`` arrows ``[lon, lat, speed_m_s, bearing_deg]``.

    Each square block of cells gives one arrow: its velocity is total momentum over total depth
    (sum(h*v)/sum(h)) of ``eligible`` cells at least ``min_depth_m`` deep, placed at their centroid. The bearing
    is clockwise from true north, measured geodesically so grid convergence is accounted for.
    """
    h, nodata = depth['values'], depth['nodata']
    rows, cols = h.shape
    cell = depth['grid']['cellsize_m']
    x0, y0 = depth['grid']['xllcorner'], depth['grid']['yllcorner']
    stride = max(1, math.ceil(math.sqrt(rows * cols / max_arrows)))
    keep = (h != nodata) & (h >= min_depth_m) & (vx != nodata) & (vy != nodata)
    if eligible is not None:
        keep &= eligible
    weight = np.where(keep, h, 0.0)
    to_lonlat = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True)
    geod = Geod(ellps='WGS84')
    arrows = []
    for r0 in range(0, rows, stride):
        for c0 in range(0, cols, stride):
            block = np.s_[r0:r0 + stride, c0:c0 + stride]
            w = weight[block]
            total = w.sum()
            if total <= 0:
                continue
            u, v = (w * vx[block]).sum() / total, (w * vy[block]).sum() / total
            speed = math.hypot(u, v)
            if not speed:
                continue
            rr, cc = np.nonzero(w)
            x = x0 + (c0 + cc.mean() + .5) * cell
            y = y0 + (rows - r0 - rr.mean() - .5) * cell
            step = cell * .1 / speed
            lon, lat = to_lonlat.transform(x, y)
            lon2, lat2 = to_lonlat.transform(x + u * step, y + v * step)
            bearing = geod.inv(lon, lat, lon2, lat2)[0] % 360
            arrows.append([round(lon, 6), round(lat, 6), round(speed, 3), round(bearing, 1)])
    return arrows


def _depth_class_cells(data):
    """Valid cells per depth class: [0.03, 0.15), [0.15, 0.5), [0.5, 1), [1, 2) and >= 2 m."""
    values = data['values'][data['values'] != data['nodata']]
    edges = [*DEPTH_CLASS_BOUNDS_M, math.inf]
    return [int(np.count_nonzero((values >= low) & (values < high))) for low, high in zip(edges, edges[1:])]


def mass_balance(path):
    """Rain-inclusive volume balance from a LISFLOOD-FP ``.mass`` file.

    The SWE solvers (FV1/DG2) of 8.0.3 report ``Verror = VolIn - VolOut - (vol2 - vol1)``
    without the rain source (``swe/stats.cpp``), so during rain Verror is about minus the
    rain added in the interval. Adding the cumulative rain increment back gives the actual
    per-interval conservation error. Columns: Vol = 5, Verror = 10, Rain-(Inf+Evap) = 11.
    """
    rows = []
    for line in Path(path).read_text().splitlines():
        fields = line.split()
        if not fields or fields[0] == 'Time':
            continue
        if len(fields) != 12:
            raise ValueError('unexpected .mass row')
        values = [float(fields[i]) for i in (0, 5, 10, 11)]
        if not all(math.isfinite(v) for v in values):
            raise ValueError('nonfinite .mass value')
        rows.append(values)
    if not rows:
        raise ValueError('empty .mass')
    previous_rain, errors = 0.0, []
    for _time, _volume, verror, rain in rows:
        errors.append(verror + (rain - previous_rain))
        previous_rain = rain
    worst = max(abs(e) for e in errors)
    rain_total = rows[-1][3]
    return {'intervals': len(rows), 'rain_m3': rain_total, 'final_volume_m3': rows[-1][1],
            'max_abs_interval_error_m3': worst,
            'max_abs_interval_error_relative_to_rain': worst / rain_total if rain_total > 0 else None,
            'method': 'Verror + interval rain increment (SWE Verror omits rain in LISFLOOD-FP 8.0.3)',
            # [time_s, volume_m3 in the domain, cumulative rain_m3]; the gap is water that left the domain.
            'series': [[t, volume, rain] for t, volume, _verror, rain in rows[::max(1, math.ceil(len(rows) / 500))]]}
