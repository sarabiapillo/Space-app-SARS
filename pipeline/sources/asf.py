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
        scenes = [product_to_scene(r, maturity_of.get(r.properties["sceneName"])) for r in results]
        return sorted(scenes, key=lambda s: s.start_time)

    def fetch_subset(self, scene, roi_wkt, layer, out_dir: Path) -> Path:
        # Paso 4 del plan (AGENTS.md §10): recorte remoto con gdalwarp + .netrc.
        raise NotImplementedError("Recorte a la ROI pendiente (paso 4 del plan).")
