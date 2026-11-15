"""Carga en la base la inspección de la Etapa 1 de una o varias escenas.

    python manage.py load_explore <granuleId> [<granuleId> ...]
    python manage.py load_explore --todas
    python manage.py load_explore <granuleId> --dir ruta/a/explore

Lee ``data/explore/<granuleId>/metadatos.json`` y ``graficas.json`` (los escribe
``python -m pipeline.etapa1``) y guarda la escena, la ROI, la inspección y sus gráficas.

- Volver a cargar la misma escena, ROI y versión del código reemplaza esa inspección y sus gráficas.
- Otra ROI u otra versión agrega otra inspección y conserva las anteriores.
- Si falta ``graficas.json`` (carpetas de antes del 2026-11-15), se detiene: hay que volver a correr etapa1.
- No lee los .h5 ni llama al pipeline: solo los JSON que este produjo.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry, Polygon
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from scenes.models import ROI, Scene, SceneChart, SceneInspection

REPO_ROOT = Path(settings.BASE_DIR).parent
CHART_FORMATS = {"graficas-etapa1-1"}


def _rel(p: Path) -> str:
    p = p.resolve()
    return p.relative_to(REPO_ROOT).as_posix() if p.is_relative_to(REPO_ROOT) else p.as_posix()


def parse_time(text: str) -> datetime:
    """'2026-06-18T11:40:10.000000000' (nanosegundos, UTC) -> datetime con zona UTC."""
    text = text.strip().rstrip("Z")
    if "." in text:
        base, frac = text.split(".", 1)
        text = f"{base}.{frac[:6]}"
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def polygon_2d(wkt: str | None, srid: int = 4326) -> Polygon | None:
    """boundingPolygon del .h5 viene con altura (lon lat h); se guarda en 2D."""
    if not wkt:
        return None
    g = GEOSGeometry(wkt, srid=srid)
    if g.geom_type != "Polygon":
        raise CommandError(f"Se esperaba un polígono y llegó {g.geom_type}")
    rings = [[(c[0], c[1]) for c in ring.coords] for ring in g]
    return Polygon(*rings, srid=srid)


def read_json(path: Path) -> dict:
    if not path.is_file():
        raise CommandError(f"No existe {path}")
    return json.loads(path.read_text(encoding="utf-8"))


class Command(BaseCommand):
    help = "Carga en la base la inspección de la Etapa 1 (metadatos.json + graficas.json) de una o varias escenas."

    def add_arguments(self, parser):
        parser.add_argument("granule_ids", nargs="*", help="carpetas de data/explore/ a cargar")
        parser.add_argument("--todas", action="store_true", help="cargar todas las carpetas de --dir")
        parser.add_argument("--dir", default=str(REPO_ROOT / "data" / "explore"),
                            help="carpeta con las salidas de etapa1 (default: data/explore/)")
        parser.add_argument("--roi-nombre", default="chiapas",
                            help="nombre de la ROI si hay que crearla (default: chiapas, como pipeline/config.yaml)")

    def handle(self, *args, **opts):
        base = Path(opts["dir"])
        if opts["todas"]:
            folders = sorted(p for p in base.iterdir() if (p / "metadatos.json").is_file())
        elif opts["granule_ids"]:
            folders = [base / g for g in opts["granule_ids"]]
        else:
            raise CommandError("Indica uno o más granuleId, o --todas")
        if not folders:
            raise CommandError(f"No hay salidas de etapa1 en {base}")
        for folder in folders:
            insp, n_charts, created = self.load(folder, opts["roi_nombre"])
            verb = "creada" if created else "reemplazada"
            self.stdout.write(self.style.SUCCESS(
                f"{insp.scene.name}: inspección {verb} (código {insp.code_version}), {n_charts} gráficas"))

    @transaction.atomic
    def load(self, folder: Path, roi_name: str):
        meta = read_json(folder / "metadatos.json")
        charts_path = folder / "graficas.json"
        if not charts_path.is_file():
            raise CommandError(f"Falta {charts_path}. Las carpetas anteriores al 2026-11-15 no lo tienen: "
                               "vuelve a correr `python -m pipeline.etapa1 <scene_id>`.")
        charts = read_json(charts_path)

        ident, grid = meta["identificacion"], meta["malla"]
        granule = ident["granuleId"]
        # Trazabilidad: las gráficas deben ser de la misma escena y la misma corrida que los metadatos.
        if charts.get("version") not in CHART_FORMATS:
            raise CommandError(f"{charts_path}: formato {charts.get('version')!r} no soportado ({CHART_FORMATS})")
        if charts["escena"]["granuleId"] != granule:
            raise CommandError(f"{charts_path} es de {charts['escena']['granuleId']}, no de {granule}")
        if charts["version_codigo"] != meta["version_codigo"]:
            raise CommandError(f"{folder}: graficas.json ({charts['version_codigo']}) y metadatos.json "
                               f"({meta['version_codigo']}) son de corridas distintas; vuelve a correr etapa1")

        maturity = (meta.get("procedencia") or {}).get("catalogo_escena", {}).get("madurez")
        defaults = {
            "product": grid["producto"],
            "track": int(ident["trackNumber"]),
            "frame": int(ident["frameNumber"]),
            "direction": str(ident["orbitPassDirection"]).upper(),
            "polarization": "+".join(grid["polarizaciones"]),
            "frequency": grid["frecuencia"],
            "band": str(ident.get("radarBand") or ""),
            "epsg": grid.get("epsg"),
            "crid": ident["compositeReleaseId"],
            "start_time": parse_time(ident["zeroDopplerStartTime"]),
            "footprint": polygon_2d(ident.get("boundingPolygon")),
        }
        if maturity:                     # una carga local (sin catálogo) no borra la madurez ya conocida
            defaults["maturity"] = maturity
        scene, _ = Scene.objects.update_or_create(name=granule, defaults=defaults)

        roi_geom = GEOSGeometry(meta["roi"]["wkt_4326"], srid=4326)
        roi = ROI.objects.filter(geom__equals=roi_geom).first() or ROI.objects.create(name=roi_name, geom=roi_geom)

        insp, created = SceneInspection.objects.update_or_create(
            scene=scene, roi=roi, code_version=meta["version_codigo"],
            defaults={
                "created_utc": parse_time(meta["creado_utc"]),
                "pct_valid_in_roi": float(meta["roi"]["pct_validos_en_poligono"]),
                "roi_stats": meta["estadisticas_roi"],
                "provenance": meta.get("procedencia") or {},
                "warnings": meta.get("advertencias") or [],
                "source_dir": _rel(folder),
            },
        )
        insp.charts.all().delete()
        SceneChart.objects.bulk_create([
            SceneChart(inspection=insp, chart_id=c["id"], format_version=charts["version"], data=c,
                       source_file=_rel(charts_path))
            for c in charts["graficas"]
        ])
        return insp, len(charts["graficas"]), created
