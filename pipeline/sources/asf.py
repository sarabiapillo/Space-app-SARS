"""Fuente de datos: catálogo público de ASF (https://search.asf.alaska.edu/)."""
from __future__ import annotations

from pathlib import Path

from .base import DataSource, SceneMeta

MATURITY_LEVELS = ("BETA", "PROVISIONAL", "VALIDATED")


def _attrs(product) -> dict:
    """AdditionalAttributes del registro UMM (CMR) como dict nombre -> lista de valores."""
    umm = getattr(product, "umm", None) or {}
    return {a.get("Name"): a.get("Values") for a in umm.get("AdditionalAttributes", [])}


def product_to_scene(product, maturity: str | None) -> SceneMeta:
    """Convierte un resultado de asf_search en SceneMeta sin inventar campos."""
    p = product.properties
    a = _attrs(product)

    # Polarizaciones de Frequency A: primero el atributo UMM, si no, mainBandPolarization.
    pols = a.get("FREQUENCY_A_POLARIZATION") or p.get("mainBandPolarization") or []
    version = a.get("PRODUCT_VERSION")

    file_name = p.get("fileName")
    size = (p.get("bytes") or {}).get(file_name, {}).get("bytes") if file_name else None

    return SceneMeta(
        scene_id=p["sceneName"],
        source="asf",
        product=p.get("processingLevel"),
        track=p.get("pathNumber"),
        frame=p.get("frameNumber"),
        direction=p.get("flightDirection"),
        polarizations=tuple(pols),
        crid=p.get("crid"),
        maturity=maturity,
        start_time=p["startTime"],
        frame_coverage=p.get("frameCoverage"),
        orbit_type=p.get("orbitType"),
        product_version=version[0] if version else None,
        url=p.get("url"),
        size_bytes=size,
        footprint=getattr(product, "geometry", None),
        extra={"pge_version": p.get("pgeVersion"), "processing_date": p.get("processingDate")},
    )


class ASFSource(DataSource):
    name = "asf"

    def __init__(self, max_results: int = 500):
        self.max_results = max_results

    def search(self, roi_wkt, product, start=None, end=None):
        import asf_search as asf  # import diferido: las pruebas no necesitan red

        base = dict(
            dataset=asf.DATASET.NISAR,
            processingLevel=product,
            intersectsWith=roi_wkt,
            start=start,
            end=end,
            maxResults=self.max_results,
        )
        base = {k: v for k, v in base.items() if v is not None}

        # Las propiedades de asf_search no traen la madurez; se obtiene filtrando
        # por cada nivel. Lo que no aparezca en ningún filtro queda como None.
        maturity_of: dict[str, str] = {}
        for level in MATURITY_LEVELS:
            for prod in asf.search(dataMaturity=level, **base):
                maturity_of[prod.properties["sceneName"]] = level

        results = asf.search(**base)
        scenes = [product_to_scene(r, maturity_of.get(r.properties["sceneName"])) for r in results
                  if r.properties.get("processingLevel") == "GCOV"]
        return sorted(scenes, key=lambda s: s.start_time)

    def fetch_subset(self, scene, roi_wkt, layer, out_dir: Path) -> Path:
        return self.fetch_subsets(scene, roi_wkt, [layer], out_dir)[0]

    def fetch_subsets(self, scene, roi_wkt, layers, out_dir: Path, local_h5: Path | None = None) -> list[Path]:
        """Recorta varias capas abriendo el archivo una sola vez.

        Remoto (por defecto): h5py sobre HTTPS con la sesión de Earthdata (earthaccess +
        fsspec). Solo se transfieren los chunks de la ventana de la ROI y los metadatos.
        No se usa gdalwarp: el GDAL del entorno (3.12 de conda-forge) no trae los drivers
        HDF5 ni NISAR (ver README §9).

        ``local_h5``: usar un .h5 ya descargado en vez de leer por la red.
        """
        import h5py

        from .subset import write_subset

        if local_h5 is not None:
            local_h5 = Path(local_h5).resolve()
            provenance = {"fuente": self.name, "metodo": "h5py, archivo local", "ruta_local": str(local_h5),
                          "url_catalogo": scene.url}
            with h5py.File(local_h5, "r") as f:
                return write_subset(f, scene, roi_wkt, layers, out_dir, provenance)

        if not scene.url:
            raise ValueError(f"{scene.scene_id}: el catálogo no trae URL de descarga.")
        fs = earthdata_https_fs()
        provenance = {"fuente": self.name, "metodo": "h5py sobre HTTPS (fsspec, lectura por ventanas)",
                      "url": scene.url, "block_size_bytes": REMOTE_BLOCK_SIZE}
        with fs.open(scene.url, "rb", block_size=REMOTE_BLOCK_SIZE, cache_type="blockcache") as fobj:
            with h5py.File(fobj, "r") as f:
                return write_subset(f, scene, roi_wkt, layers, out_dir, provenance)


REMOTE_BLOCK_SIZE = 8 * 1024 * 1024   # 8 MiB por petición HTTP: menos viajes que el default de fsspec
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env_file(path: Path = ENV_FILE) -> bool:
    """Carga el .env de la raíz del repo sin pisar variables ya definidas en el sistema.

    En un servidor, las variables de entorno reales (Docker, systemd, panel del hosting)
    tienen prioridad sobre el archivo.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return False
    return load_dotenv(path, override=False) if Path(path).exists() else False


def login_strategies() -> tuple[str, ...]:
    """Orden de credenciales: variables EARTHDATA_* (si están las dos) y luego .netrc."""
    import os

    if os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"):
        return ("environment", "netrc")
    return ("netrc", "environment")


def earthdata_https_fs():
    """Sistema de archivos HTTPS autenticado con Earthdata.

    Credenciales: EARTHDATA_USERNAME / EARTHDATA_PASSWORD (variables de entorno o el .env de
    la raíz del repo) y, si no están, ~/.netrc (o %USERPROFILE%\\.netrc). Nunca se piden por
    consola ni se imprimen.
    """
    import os

    import earthaccess

    load_env_file()

    # En Windows earthaccess busca ~/_netrc, mientras que GDAL, asf_search y el README usan
    # ~/.netrc. Si solo existe .netrc, se le indica con NETRC (solo para este proceso).
    home = Path.home()
    if not os.environ.get("NETRC") and not (home / "_netrc").exists() and (home / ".netrc").exists():
        os.environ["NETRC"] = str(home / ".netrc")

    errors = []
    for strategy in login_strategies():
        try:
            auth = earthaccess.login(strategy=strategy)
        except Exception as err:   # el mensaje de earthaccess no incluye la contraseña
            errors.append(f"{strategy}: {err}")
            continue
        if auth is not None and getattr(auth, "authenticated", False):
            return earthaccess.get_fsspec_https_session()
        errors.append(f"{strategy}: Earthdata rechazó el inicio de sesión (¿usuario o contraseña?)")
    raise RuntimeError(
        "No se pudo iniciar sesión en Earthdata. Define EARTHDATA_USERNAME y EARTHDATA_PASSWORD "
        "en .env o en el entorno, o revisa %USERPROFILE%\\.netrc (README §7).\n  " + "\n  ".join(errors)
    )
