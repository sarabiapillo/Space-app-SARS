"""Configuración ROI DG2; consulta metadatos de rutas, sin escrituras ni red al importar."""
import re
from pathlib import Path

PINNED_BINARY = '777d50f8d6a926260baa31b4c8ca3ecc0b3ae710494bebb2d4699ccf8c39775c'
PINNED_DEM = 'ada476fc141d536d09abd4aa1238d192bbddfd627574886ada12784ba0e964a8'


def build_flood_service_settings(project_root, environ):
    """Devuelve (enabled, run_root, config); no crea rutas ni consulta credenciales."""
    project = Path(project_root).absolute()
    data = project / 'data'
    prefix = 'FLOOD_ROI_DG2_'
    raw = environ.get(prefix + 'ENABLED', 'true').lower()
    if raw not in ('true', 'false', '1', '0'):
        raise ValueError('FLOOD_ROI_DG2_ENABLED inválido')
    enabled = raw in ('true', '1')

    def path(key, default):
        value = environ.get(prefix + key, str(data / default))
        candidate = Path(value)
        if (not candidate.is_absolute() or '..' in candidate.parts or
                not candidate.is_relative_to(data) or
                any(part.is_symlink() for part in (candidate, *candidate.parents))):
            raise ValueError(prefix + key + ' inválido')
        return str(candidate)

    if not enabled:
        return False, str(data / 'roi-dg2-jobs'), None
    root = path('RUN_ROOT', 'roi-dg2-jobs')

    def positive(key, default, upper, *, integer=False):
        value = environ.get(prefix + key, str(default))
        if not re.fullmatch(r'[0-9]+' if integer else r'[0-9]+(?:\.[0-9]+)?', value):
            raise ValueError(prefix + key + ' inválido')
        number = int(value) if integer else float(value)
        if not 0 < number <= upper:
            raise ValueError(prefix + key + ' fuera de presupuesto')
        return number

    config = {
        'executable': path('EXECUTABLE', 'tools/lisflood-fp-8.0/runtime/build/lisflood'),
        'dem_executable': path('DEM_EXECUTABLE', 'tools/lisflood-fp-8.0/runtime/build/generateDG2DEM'),
        # Defaults sized for a small real NASADEM+DG2 run (measured 2026-11-19: 1680 cells x 900 s
        # simulated took 59-69 s of solver time). Larger or longer runs end as `solver_timeout`.
        'timeout_s': positive('TIMEOUT_S', 120, 120),
        'preparation_timeout_s': positive('PREPARATION_TIMEOUT_S', 600, 600),
        'max_cells': positive('MAX_CELLS', 3000, 50_000_000, integer=True),
        # Up to 121 frames (floor(duration / save) + 2) so the panel can animate the run, e.g. 14400 s every 300 s = 50;
        # max_rain_values also caps frames x cells (121 x 3000 = 363 000) and rain intervals x cells.
        'max_rain_values': positive('MAX_RAIN_VALUES', 1_000_000, 50_000_000, integer=True),
        'max_frames': positive('MAX_FRAMES', 121, 50_000_000, integer=True),
        'max_tiles': positive('MAX_TILES', 2, 50_000_000, integer=True),
        # HydroLAKES GeoPackage (python -m pipeline.hydrology.lakes prepare ...); the lakes option is
        # refused per request while this file does not exist.
        'lakes_path': path('LAKES_PATH', 'reference/hydrolakes/HydroLAKES_polys_v10.gpkg'),
        # NGA EGM96/EGM2008 geoid grids (python -m pipeline.elevation.vertical_datum prepare): every height
        # is converted to EGM2008, so the service is unavailable while they are missing.
        'geoid_dir': path('GEOID_DIR', 'reference/geoid'),
        # PXR-4 v2.1.0 return levels (python -m pipeline.hydrology.design_storm prepare); design-storm requests
        # are answered 503 design_storm_unavailable while this file does not exist.
        'pxr_path': path('PXR_PATH', 'reference/pxr/pxr4-2.1.0.nc'),
        # EOT20 ocean tides (python -m pipeline.hydrology.tides prepare-eot20) and DTUUH22MDT (prepare-mdt) for tide
        # sides; runs with a tide side (or GEBCO with the DTU MDT) fail with tide_unavailable / bathymetry_unavailable
        # while they are missing. GEBCO_2026 itself is read from the public COG on Source Cooperative.
        'eot20_dir': path('EOT20_DIR', 'reference/eot20'),
        'mdt_path': path('MDT_PATH', 'reference/dtu22mdt/dtuuh22mdt.grd.gz'),
    }
    for key, pinned in (('BINARY_SHA256', PINNED_BINARY), ('DEM_SHA256', PINNED_DEM)):
        supplied = environ.get(prefix + key, pinned)
        if supplied != pinned:
            raise ValueError(prefix + key + ' no coincide con hash fijado')
        config['binary_sha256' if key == 'BINARY_SHA256' else 'dem_sha256'] = pinned
    version = environ.get(prefix + 'CODE_VERSION', '772425ef+service-setup-uncommitted')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+\-]{0,119}', version):
        raise ValueError(prefix + 'CODE_VERSION inválido')
    config['code_version'] = version
    return True, root, config
