"""Preparación offline de elevaciones con la utilidad oficial generateDG2DEM."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np
import rasterio

from .dem_prepared import _validate_crs


def _sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare_dg2_dem(terrain_path, output_dir, *, executable, vertical_datum,
                    code_version, timeout_s, max_cells=4_000_000):
    """Genera .dem/.dem1x/.dem1y sin llenar huecos ni decidir el dominio.

    El DEM debe ser rectangular, completo y métrico. El datum se declara,
    nunca se transforma. La carpeta debe ser nueva; se conserva si falla el proceso.
    """
    source = Path(terrain_path).resolve(strict=True)
    helper = Path(executable).resolve(strict=True)
    destination = Path(output_dir)
    if destination.exists():
        raise FileExistsError('output directory already exists; refusing overwrite')
    if not isinstance(code_version, str) or not code_version.strip():
        raise ValueError('code_version must be explicit')
    if not isinstance(vertical_datum, str) or not vertical_datum.strip():
        raise ValueError('vertical_datum must be explicit')
    if isinstance(timeout_s, bool) or not isinstance(timeout_s, (int, float)) or not math.isfinite(timeout_s) or not 0 < timeout_s <= 120:
        raise ValueError('timeout_s must be between 0 and 120 seconds')
    if isinstance(max_cells, bool) or not isinstance(max_cells, int) or max_cells < 1:
        raise ValueError('max_cells must be a positive integer')
    with rasterio.open(source) as src:
        crs = _validate_crs(src.crs)
        transform = src.transform
        if (src.count != 1 or src.width * src.height > max_cells or
                min(src.width, src.height) < 2 or transform.b != 0 or transform.d != 0 or
                transform.a <= 0 or transform.e != -transform.a or
                not all(math.isfinite(v) for v in transform[:6])):
            raise ValueError('DEM must have one band and a bounded square north-up metric grid')
        data = src.read(1, masked=True)
        if np.ma.getmaskarray(data).any() or not np.isfinite(data.data).all():
            raise ValueError('DEM contains unknown elevations; no implicit filling is allowed')
        width, height = src.width, src.height
        xll, yll, cell = transform.c, transform.f + height * transform.e, transform.a
        values = data.astype('float32').filled(np.nan)
        if not np.isfinite(values).all() or np.any((values == -9999) | (values == np.float32(1e10))):
            raise ValueError('DEM elevations cannot be represented with the selected nodata sentinel')
    source_hash, helper_hash = _sha256(source), _sha256(helper)
    destination.mkdir(parents=True, exist_ok=False)
    header = f'ncols {width}\nnrows {height}\nxllcorner {xll:.17g}\nyllcorner {yll:.17g}\ncellsize {cell:.17g}\nNODATA_value -9999\n'
    np.savetxt(destination / 'terrain.dem.raw', values, fmt='%.9g', header=header, comments='')
    # El preprocesador construye Pars sin los valores iniciales del ejecutable principal.
    # Declarar el centinela explícitamente evita tratar una elevación 0 como hueco.
    (destination / 'prepare.par').write_text(
        'DEMfile terrain.dem\ndirroot results\ndg2\nnodata_elevation 10000000000\n', encoding='utf-8')
    with (destination / 'generator.log').open('w') as log:
        try:
            process = subprocess.run([str(helper), 'prepare.par'], cwd=destination,
                                     stdout=log, stderr=subprocess.STDOUT, timeout=timeout_s,
                                     check=False)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError('generateDG2DEM timed out; see generator.log') from exc
    if process.returncode != 0:
        raise RuntimeError(f'generateDG2DEM failed ({process.returncode}); see generator.log')
    files = {}
    for name in ('terrain.dem', 'terrain.dem1x', 'terrain.dem1y'):
        path = destination / name
        with path.open() as stream:
            fields = dict(stream.readline().lower().split() for _ in range(6))
            expected = {'ncols': width, 'nrows': height, 'xllcorner': xll,
                        'yllcorner': yll, 'cellsize': cell}
            if any(not math.isclose(float(fields[k]), v, rel_tol=0, abs_tol=1e-6) for k, v in expected.items()):
                raise RuntimeError('generateDG2DEM output geometry differs from input')
            array = np.loadtxt(stream, ndmin=2)
        if (array.shape != (height, width) or not np.isfinite(array).all() or
                np.any(array == float(fields['nodata_value']))):
            raise RuntimeError('generateDG2DEM produced invalid coefficients')
        files[name] = {'sha256': _sha256(path)}
    manifest = {
        'source': {'name': source.name, 'sha256': source_hash},
        'generator': {'name': helper.name, 'sha256': helper_hash, 'returncode': process.returncode},
        'grid': {'shape': [height, width], 'crs': crs.to_string(), 'transform': list(transform)[:6]},
        'vertical_datum': vertical_datum, 'code_version': code_version,
        'files': files, 'hydraulic_ready': False,
        'warnings': ['Elevación, no profundidad. No se certifica precisión hidráulica.'],
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding='utf-8')
    return manifest
