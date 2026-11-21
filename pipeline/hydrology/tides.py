"""Astronomical tide at a coastal point from EOT20, as a LISFLOOD-FP time-varying level (HVAR).

Model and licence
    EOT20 (DGFI-TUM; Hart-Davis et al. 2021, ESSD 13:3869) is an empirical ocean tide model from
    multi-mission altimetry (1992-2019), 17 constituents on a global 0.125 degree grid. Licence
    CC BY 4.0; DOI 10.17882/79489 (SEANOE). The archive ``85762.zip`` holds two nested zips,
    ``ocean_tides.zip`` and ``load_tides.zip``; only the ocean tides are used here. The constants at
    the point are read with h5py from a band of rows (pyTMD's own reader loads all 17 global grids,
    ~1 min per call without dask) and sampled like pyTMD (bilinear, else nearest ocean node within
    10 km). The prediction (FES nodal corrections, minor constituents inferred from the majors) is
    done by pyTMD (MIT licence, pinned 3.1.0; adds h5netcdf, pint, timescale, lxml, platformdirs).
    TPXO (non-commercial) and FES2022 (needs an AVISO account) are not used.

Vertical datum
    EOT20 heights are tidal elevations about the local mean sea surface (MSL). To put them on the
    project datum (EGM2008) the mean dynamic topography (MDT, height of MSL above the geoid) is added.
    The default MDT is DTUUH22MDT (DTU Space 2022, CC BY 4.0, DOI 10.11583/DTU.26947894), which is
    MSL above the XGM2019e geoid (degree 2160). XGM2019e is used as a stand-in for EGM2008: the
    XGM2019e - EGM2008 geoid difference is not applied unless ``geoid_difference`` is given, and the
    provenance says so. With ``mdt=None`` no MDT is added and the levels stay on MSL; the provenance
    then records "MDT not applied". A single coastal MDT value is uncertain at the decimetre level
    (filtered altimetry/geoid near the coast; the grid is filled over land), and the zero-degree
    convention of XGM2019e versus EGM2008 was not checked, so a constant bias is possible.
    Storm surge, waves, river inflow and sea-level anomalies are not included: this is the
    astronomical tide only.

LISFLOOD-FP format (8.0.3 source, data/tools/lisflood-fp-8.0/runtime/source)
    ``.bci``: ``N|E|S|W <start> <end> HVAR <name>`` (input.cpp:1700-1711). ``.bdy``: the first line
    is skipped (comment); then for each series a line with its name, a line ``<count> <units>``
    (units seconds|minutes|hours|days) and ``count`` lines ``<value> <time>``, value first, times
    strictly increasing (input.cpp:1949-1972, 1819-1903). DG2 and FV1 both read HVAR edges:
    the outside depth is ``max(0, level(t) - z)`` with linear interpolation in time, the first value
    before the first time and the last value after the last time (swe/dg2.cpp:620-622,
    swe/fv1.cpp:537-541, swe/boundary.cpp:3-27).

Prepare the datasets once (both caches live under data/reference/, ignored by git):
    python -m pipeline.hydrology.tides prepare-eot20 [--source 85762.zip] [--directory DIR]
    python -m pipeline.hydrology.tides prepare-mdt [--source dtuuh22mdt.grd.gz] [--output PATH]
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import gzip
import math
import re
import shutil
import struct
import tempfile
import urllib.request
import zipfile
import zlib
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
DEFAULT_EOT20_DIR = REPO / 'data' / 'reference' / 'eot20'
EOT20_URL = 'https://www.seanoe.org/data/00683/79489/data/85762.zip'
EOT20_DOI = '10.17882/79489'
EOT20_CITATION = ('Hart-Davis, M., Piccioni, G., Dettmering, D., Schwatke, C., Passaro, M., Seitz, F. (2021). '
                  'EOT20 - A global Empirical Ocean Tide model from multi-mission satellite altimetry. SEANOE. '
                  'https://doi.org/10.17882/79489. CC BY 4.0.')
EOT20_MEMBER = 'ocean_tides.zip'
EOT20_FILE = re.compile(r'^[A-Z0-9]+_ocean_eot20\.nc$')
EOT20_CONSTITUENTS = ('2N2', 'J1', 'K1', 'K2', 'M2', 'M4', 'MF', 'MM', 'N2', 'O1', 'P1', 'Q1', 'S1', 'S2',
                      'SA', 'SSA', 'T2')

DEFAULT_MDT_PATH = REPO / 'data' / 'reference' / 'dtu22mdt' / 'dtuuh22mdt.grd.gz'
MDT_URL = 'https://ndownloader.figshare.com/files/49049419'  # dtuuh22mdt.grd.gz, 8501173 bytes
MDT_DOI = '10.11583/DTU.26947894'
MDT_CITATION = ('DTUUH22MDT, The DTU 2022 Mean Dynamic Topography models, DTU Space (Knudsen, Andersen, '
                'Maximenko). https://doi.org/10.11583/DTU.26947894. CC BY 4.0. MSL above the XGM2019e geoid.')
MDT_SEARCH_CELLS = 8  # nearest valid MDT node within this many grid steps (coast points are often masked)

_CHUNK = 1 << 20


# ----------------------------------------------------------------------------------------------- prepare
def _open_range(url, start, end, opener):
    request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
    response = opener(request)
    if getattr(response, 'status', 206) != 206:
        raise OSError(f'{url}: server ignored the byte range (HTTP {getattr(response, "status", "?")})')
    return response


class _HttpRangeFile:
    """Seekable read-only view of a remote file through HTTP byte ranges (enough for zipfile's index)."""

    def __init__(self, url, opener):
        self.url, self.opener, self.pos = url, opener, 0
        head = opener(urllib.request.Request(url, method='HEAD'))
        self.size = int(head.headers['Content-Length'])

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b''
        with _open_range(self.url, self.pos, min(self.size, self.pos + n) - 1, self.opener) as response:
            data = response.read()
        self.pos += len(data)
        return data


def _copy_remote_member(url, member, destination, opener):
    """Stream one member of a remote zip to ``destination`` with a single ranged GET, checking its CRC."""
    info = zipfile.ZipFile(_HttpRangeFile(url, opener)).getinfo(member)
    with _open_range(url, info.header_offset, info.header_offset + 29, opener) as response:
        header = response.read(30)
    signature, *_, name_length, extra_length = struct.unpack('<IHHHHHIIIHH', header)
    if signature != 0x04034B50:
        raise OSError(f'{url}: bad local header for {member}')
    start = info.header_offset + 30 + name_length + extra_length
    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise OSError(f'{member}: unsupported compression {info.compress_type}')
    inflate = zlib.decompressobj(-15) if info.compress_type == zipfile.ZIP_DEFLATED else None
    crc, size = 0, 0
    with _open_range(url, start, start + info.compress_size - 1, opener) as response, open(destination, 'wb') as out:
        while chunk := response.read(_CHUNK):
            data = inflate.decompress(chunk) if inflate else chunk
            crc, size = zlib.crc32(data, crc), size + len(data)
            out.write(data)
        if inflate:
            tail = inflate.flush()
            crc, size = zlib.crc32(tail, crc), size + len(tail)
            out.write(tail)
    if crc != info.CRC or size != info.file_size:
        raise OSError(f'{member}: download incomplete or corrupt (CRC/size mismatch)')
    return destination


def prepare_eot20(directory=DEFAULT_EOT20_DIR, source=None, opener=urllib.request.urlopen):
    """Put the 17 EOT20 ocean-tide NetCDF files at ``<directory>/EOT20/ocean_tides/`` (pyTMD layout).

    ``source`` is a local ``85762.zip`` (SEANOE archive) or ``ocean_tides.zip``; without it only the
    ``ocean_tides.zip`` member (~1.2 GB) of the remote archive is downloaded (one byte-range request),
    not the load tides. Existing files are kept; returns the ocean_tides directory.
    """
    target = Path(directory) / 'EOT20' / 'ocean_tides'
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as scratch:
        inner = Path(scratch) / EOT20_MEMBER
        if source is None:
            _copy_remote_member(EOT20_URL, EOT20_MEMBER, inner, opener)
        else:
            with zipfile.ZipFile(source) as archive:
                names = {Path(n).name: n for n in archive.namelist()}
                if EOT20_MEMBER in names:
                    with archive.open(names[EOT20_MEMBER]) as src, open(inner, 'wb') as out:
                        shutil.copyfileobj(src, out, _CHUNK)
                else:
                    inner = Path(source)
        written = 0
        with zipfile.ZipFile(inner) as archive:
            for name in archive.namelist():
                base = Path(name).name
                if not EOT20_FILE.match(base):
                    continue
                with archive.open(name) as src, open(target / base, 'wb') as out:
                    shutil.copyfileobj(src, out, _CHUNK)
                written += 1
    if written == 0:
        raise ValueError(f'{source or EOT20_URL}: no *_ocean_eot20.nc files found')
    return target


def prepare_mdt(output=DEFAULT_MDT_PATH, source=None, opener=urllib.request.urlopen):
    """Copy (or download) the DTUUH22MDT GRAVSOFT grid ``dtuuh22mdt.grd.gz`` to ``output``."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if source is not None:
        shutil.copyfile(source, output)
    else:
        with opener(MDT_URL) as response, open(output, 'wb') as out:
            shutil.copyfileobj(response, out, _CHUNK)
    read_gravsoft_grid(output)  # fail now if the file is not a GRAVSOFT grid
    return output


# --------------------------------------------------------------------------------------------- datum (MDT)
def read_gravsoft_grid(path):
    """Read a GRAVSOFT ASCII grid (optionally gzipped): ``(lats, lons, values)``.

    Header ``lat1 lat2 lon1 lon2 dlat dlon``; values follow row by row from north (lat2) to south
    (lat1), each row west to east. 9999 (or larger) marks no data and becomes NaN.
    """
    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rt') as handle:
        numbers = np.array(handle.read().split(), dtype='float64')
    lat1, lat2, lon1, lon2, dlat, dlon = numbers[:6]
    rows = int(round((lat2 - lat1) / dlat)) + 1
    cols = int(round((lon2 - lon1) / dlon)) + 1
    values = numbers[6:]
    if values.size != rows * cols:
        raise ValueError(f'{path}: {values.size} values for a {rows} x {cols} GRAVSOFT grid')
    values = values.reshape(rows, cols)
    values[values >= 9999] = np.nan
    lats = lat2 - dlat * np.arange(rows)
    lons = lon1 + dlon * np.arange(cols)
    return lats, lons, values


_cached_gravsoft_grid = functools.lru_cache(maxsize=2)(read_gravsoft_grid)  # the 8.5 MB text grid parses in seconds


def _sample_grid(lats, lons, values, lon, lat, search_cells, max_km=math.inf):
    """Value of a regular lat/lon grid at a point: ``(value, record)``.

    Bilinear interpolation when the four surrounding nodes are valid; otherwise the nearest valid
    node within ``search_cells`` grid steps and ``max_km`` (coast cells are often masked or missing).
    Rows may run north-to-south or south-to-north; ``lon`` is wrapped into the grid's range.
    """
    lon_w = ((lon - lons[0]) % 360.0) + lons[0]
    fr, fc = (lat - lats[0]) / (lats[1] - lats[0]), (lon_w - lons[0]) / (lons[1] - lons[0])
    r0, c0 = int(math.floor(fr)), int(math.floor(fc))
    if 0 <= r0 < len(lats) - 1 and 0 <= c0 < len(lons) - 1:
        block = values[r0:r0 + 2, c0:c0 + 2]
        if np.all(np.isfinite(block)):
            tr, tc = fr - r0, fc - c0
            value = ((1 - tr) * ((1 - tc) * block[0, 0] + tc * block[0, 1])
                     + tr * ((1 - tc) * block[1, 0] + tc * block[1, 1]))
            return value, {'method': 'bilinear'}
    rc, cc = int(round(fr)), int(round(fc))
    r_lo, r_hi = max(rc - search_cells, 0), min(rc + search_cells + 1, len(lats))
    c_lo, c_hi = max(cc - search_cells, 0), min(cc + search_cells + 1, len(lons))
    window = values[r_lo:r_hi, c_lo:c_hi]
    rr, cols = np.meshgrid(np.arange(r_lo, r_hi), np.arange(c_lo, c_hi), indexing='ij')
    ys = (lats[rr] - lat) * 111.32
    xs = (lons[cols] - lon_w) * 111.32 * math.cos(math.radians(lat))
    distance = np.where(np.isfinite(window), np.hypot(xs, ys), np.inf)
    if not np.isfinite(distance).any() or distance.min() > max_km:
        return None, {'method': 'none'}
    k = np.unravel_index(np.argmin(distance), distance.shape)
    node_lon = (float(lons[cols[k]]) + 180.0) % 360.0 - 180.0  # grids run 0-360: report -180..180 like the point
    return window[k], {'method': 'nearest valid node', 'distance_km': float(distance[k]),
                       'node': [node_lon, float(lats[rr[k]])]}


def mdt_offset_m(lon, lat, path=DEFAULT_MDT_PATH, reader=_cached_gravsoft_grid, search_cells=MDT_SEARCH_CELLS):
    """MDT (height of mean sea level above the geoid, m) at a point: ``(value, record)``.

    Bilinear interpolation of the four surrounding nodes when all are valid; otherwise the nearest
    valid node within ``search_cells`` steps, recorded as such. DTUUH22MDT itself has values on land
    too (filled), so over land and at the coast the value is an extrapolation of the ocean field.
    """
    lats, lons, values = reader(path)
    value, record = _sample_grid(lats, lons, values, lon, lat, search_cells)
    if value is None:
        raise ValueError(f'no MDT value within {search_cells} grid steps of ({lon}, {lat})')
    return float(value), {'source': MDT_CITATION, 'geoid': 'XGM2019e', **record}


# --------------------------------------------------------------------------------------- tide prediction
def _read_eot20_band(path, lat, cutoff_km):
    """Rows of one EOT20 file within ``cutoff_km`` of ``lat`` as complex metres, padded across 0/360.

    Returns ``(lats, lons, values, rows)`` where ``rows`` is the search radius in grid cells.
    """
    import h5py

    with h5py.File(path, 'r') as handle:
        lats = handle['lat'][:]
        lons = handle['lon'][:]
        step_km = abs(lats[1] - lats[0]) * 111.32 * max(math.cos(math.radians(lat)), 0.05)
        rows = max(1, int(math.ceil(cutoff_km / step_km))) + 1
        row = int(round((lat - lats[0]) / (lats[1] - lats[0])))
        lo, hi = max(row - rows, 0), min(row + rows + 1, len(lats))
        amplitude = handle['amplitude'][lo:hi, :]
        phase = handle['phase'][lo:hi, :]
        units = handle['amplitude'].attrs.get('units', b'')
    units = units.decode() if isinstance(units, bytes) else str(units)
    if units != 'cm':
        raise ValueError(f'{path}: expected amplitude in cm, found {units!r}')
    valid = (amplitude != 0) | (phase != 0)  # 0/0 marks land, as in pyTMD's FES reader
    values = np.where(valid, amplitude / 100.0 * np.exp(-1j * np.radians(phase)), np.nan + 0j)
    # The grid repeats the 0 degree meridian at 360: pad both sides so searches cross the seam.
    pad = rows + 1
    values = np.concatenate([values[:, -pad - 1:-1], values, values[:, 1:pad + 1]], axis=1)
    step = lons[1] - lons[0]
    lons = np.concatenate([lons[0] - step * np.arange(pad, 0, -1), lons, lons[-1] + step * np.arange(1, pad + 1)])
    return lats[lo:hi], lons, values, rows


def eot20_constants(lon, lat, directory=DEFAULT_EOT20_DIR, cutoff_km=10.0):
    """EOT20 complex harmonic constants at a point: ``{'constants', 'corrections', 'minor', 'sampling'}``.

    Constants are metres with the pyTMD convention ``amplitude * exp(-i * phase)``. Each file is
    read only in a band of rows around the point (h5py; the files are plain NetCDF4). Like pyTMD's
    ``extrapolate=True, cutoff=10`` default, a point whose four surrounding nodes are not all ocean
    takes the nearest ocean node within ``cutoff_km`` (so a harbour or a lagoon mouth gets the
    nearby open-coast tide); beyond that it fails. Nodal corrections 'FES' as in pyTMD's database.
    """
    folder = Path(directory) / 'EOT20' / 'ocean_tides'
    constants, sampling = {}, None
    for name in EOT20_CONSTITUENTS:
        path = folder / f'{name}_ocean_eot20.nc'
        if not path.exists():
            raise FileNotFoundError(f'{path} (run: python -m pipeline.hydrology.tides prepare-eot20)')
        lats, lons, values, rows = _read_eot20_band(path, lat, cutoff_km)
        value, record = _sample_grid(lats, lons, values, lon, lat, rows, cutoff_km)
        if value is None:
            raise ValueError(f'EOT20 has no ocean value within {cutoff_km} km of ({lon}, {lat})')
        constants[name] = complex(value)
        sampling = sampling or record
    return {'constants': constants, 'corrections': 'FES', 'minor': None, 'sampling': sampling}


def _parse_utc(value):
    if isinstance(value, str):
        value = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('times must be timezone-aware (UTC)')
    return value.astimezone(dt.timezone.utc)


def predict_tide(constants, start, end, step_s=600, corrections='FES', minor=None, infer_minor=True):
    """Tide (m about MSL) at ``start + k * step_s`` up to ``end`` from complex harmonic constants.

    ``constants`` maps constituent names to complex amplitudes in metres with the pyTMD sign
    convention ``amplitude * exp(-i * phase)`` (phase in Greenwich degrees, lag). Nodal corrections
    follow ``corrections`` ('FES' for EOT20) and minor constituents are inferred from the majors.
    Returns ``[(time_s, level_m), ...]`` with time_s from ``start``.
    """
    import timescale.time
    import xarray as xr
    from pyTMD.constituents import _parse_name
    from pyTMD.predict import infer_minor as _infer_minor, time_series

    start, end = _parse_utc(start), _parse_utc(end)
    if not step_s > 0 or end <= start:
        raise ValueError('need end > start and a positive step')
    count = int(math.floor((end - start).total_seconds() / step_s + 1e-9)) + 1
    seconds = np.arange(count, dtype='float64') * step_s
    stamps = np.datetime64(start.replace(tzinfo=None), 'ns') + (seconds * 1e9).astype('timedelta64[ns]')
    ts = timescale.time.Timescale().from_datetime(stamps)
    ds = xr.Dataset({_parse_name(name): xr.DataArray(np.complex128(value), attrs={'units': 'm'})
                     for name, value in constants.items()})  # pyTMD keys constituents by parsed (lower-case) name
    deltat = np.zeros_like(ts.tt_ut1) if corrections in ('OTIS', 'ATLAS', 'TMD3', 'netcdf') else ts.tt_ut1
    levels = np.asarray(time_series(ts.tide, ds, deltat=deltat, corrections=corrections), dtype='float64')
    if infer_minor:
        inferred = _infer_minor(ts.tide, ds, deltat=deltat, corrections=corrections, minor=minor)
        levels = levels + np.asarray(inferred, dtype='float64')
    return [(float(t), float(h)) for t, h in zip(seconds, levels.ravel())]


def tide_series(lon, lat, start, end, step_s=600, *, mdt='DTUUH22MDT', geoid_difference=None,
                constants_reader=eot20_constants, mdt_reader=mdt_offset_m, infer_minor=True):
    """EOT20 tide at a coastal point as ``{'series': [(time_s, level_m)], 'provenance': {...}}``.

    ``mdt``: 'DTUUH22MDT' adds the DTU MDT at the point (levels on the XGM2019e geoid, used as
    EGM2008); a number adds that explicit offset in metres (recorded as given); ``None`` adds nothing
    (levels on MSL, provenance says "MDT not applied"). ``geoid_difference(lon, lat)`` may return
    N(XGM2019e) - N(EGM2008) in metres to complete the conversion; it is reported when used.
    """
    start, end = _parse_utc(start), _parse_utc(end)
    model = constants_reader(lon, lat)
    series = predict_tide(model['constants'], start, end, step_s, corrections=model.get('corrections', 'FES'),
                          minor=model.get('minor'), infer_minor=infer_minor)
    provenance = {'model': 'EOT20', 'citation': EOT20_CITATION, 'licence': 'CC BY 4.0', 'doi': EOT20_DOI,
                  'point': [float(lon), float(lat)], 'sampling': model.get('sampling'),
                  'start_utc': start.isoformat(), 'end_utc': end.isoformat(),
                  'step_s': float(step_s), 'constituents': sorted(model['constants']),
                  'minor_inferred': bool(infer_minor), 'nodal_corrections': model.get('corrections', 'FES'),
                  'software': 'pyTMD 3.1.0 (MIT)', 'content': 'astronomical tide only (no surge, waves or anomalies)'}
    offset = 0.0
    if mdt is None:
        provenance['datum'] = 'mean sea level (MDT not applied)'
    elif isinstance(mdt, str):
        if mdt.upper() != 'DTUUH22MDT':
            raise ValueError("mdt must be 'DTUUH22MDT', a number of metres or None")
        offset, record = mdt_reader(lon, lat)
        provenance['mdt'] = {**record, 'value_m': offset}
        if geoid_difference is None:
            provenance['datum'] = 'EGM2008 (approx.: MSL + DTUUH22MDT on XGM2019e; XGM2019e - EGM2008 not applied)'
        else:
            delta = float(geoid_difference(lon, lat))
            offset += delta
            provenance['geoid_difference_m'] = delta
            provenance['datum'] = 'EGM2008 (MSL + DTUUH22MDT + XGM2019e - EGM2008 geoid difference)'
    elif isinstance(mdt, (int, float)) and not isinstance(mdt, bool) and math.isfinite(mdt):
        offset = float(mdt)
        provenance['mdt'] = {'source': 'explicit offset given by the caller', 'value_m': offset}
        provenance['datum'] = 'EGM2008 via explicit MDT offset'
    else:
        raise ValueError("mdt must be 'DTUUH22MDT', a number of metres or None")
    provenance['offset_m'] = offset
    return {'series': [(t, h + offset) for t, h in series], 'provenance': provenance}


# ------------------------------------------------------------------------------------------- LISFLOOD-FP
def write_bdy(series, path, name, comment='LISFLOOD-FP boundary time series'):
    """Write one HVAR/QVAR series as a LISFLOOD-FP ``.bdy`` file (``value time`` lines, seconds).

    ``series`` is ``[(time_s, value), ...]`` with strictly increasing finite times. ``name`` is the
    token the ``.bci`` line refers to (``... HVAR <name>``): no whitespace, at most 79 characters.
    """
    if not isinstance(name, str) or not name or len(name) > 79 or any(ch.isspace() for ch in name):
        raise ValueError('name must be one token without whitespace, at most 79 characters')
    rows = [(float(t), float(v)) for t, v in series]
    if not rows:
        raise ValueError('empty series')
    previous = -math.inf
    for t, v in rows:
        if not (math.isfinite(t) and math.isfinite(v)):
            raise ValueError('series values must be finite')
        if t <= previous:
            raise ValueError('times must be strictly increasing')
        previous = t
    lines = [comment.replace('\n', ' '), name, f'{len(rows)} seconds']
    lines += [f'{v:.4f} {t:.1f}' for t, v in rows]
    Path(path).write_text('\n'.join(lines) + '\n', encoding='ascii')
    return Path(path)


def main():
    parser = argparse.ArgumentParser(description='Prepare EOT20 tides and the DTU MDT for coastal HVAR boundaries.')
    sub = parser.add_subparsers(dest='command', required=True)
    eot = sub.add_parser('prepare-eot20', help='extract the EOT20 ocean-tide NetCDF files (downloads ~1.2 GB)')
    eot.add_argument('--source', help='local 85762.zip or ocean_tides.zip (default: download from SEANOE)')
    eot.add_argument('--directory', default=str(DEFAULT_EOT20_DIR))
    mdt = sub.add_parser('prepare-mdt', help='copy or download DTUUH22MDT (8.5 MB)')
    mdt.add_argument('--source', help='local dtuuh22mdt.grd.gz (default: download from DTU Data)')
    mdt.add_argument('--output', default=str(DEFAULT_MDT_PATH))
    args = parser.parse_args()
    if args.command == 'prepare-eot20':
        print(prepare_eot20(args.directory, args.source))
    else:
        print(prepare_mdt(args.output, args.source))


if __name__ == '__main__':
    main()
