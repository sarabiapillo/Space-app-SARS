"""Recorta escenas del catálogo a la ROI y las deja en data/raw/ (contrato C1).

Uso (desde la raíz del repo, entorno ``nisar``):

    python -m pipeline.download <scene_id> [<scene_id> ...]
    python -m pipeline.download <scene_id> --capas HHHH HVHV mask
    python -m pipeline.download <scene_id> --h5-local "ruta/al/archivo.h5"

Las escenas se buscan en el JSON más reciente de data/catalog/ (``python -m pipeline.catalog``),
para que cada recorte quede ligado a una consulta guardada. Con dos o más escenas, al final
se revisa la comparabilidad (compat.check_pair) y que compartan la misma malla.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from .compat import check_pair
from .sources import SceneMeta, get_source
from .sources.subset import AUX_LAYERS, compare_grids

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LAYERS = ("HHHH", "HVHV") + AUX_LAYERS


def latest_catalog(catalog_dir: Path) -> Path:
    files = sorted(catalog_dir.glob("catalog_*.json"))
    if not files:
        raise FileNotFoundError(f"No hay catálogos en {catalog_dir}. Corre primero: python -m pipeline.catalog")
    return files[-1]


def download_roi_scene(scene: SceneMeta, roi_geojson: dict, out_dir: Path) -> list[Path]:
    """Stream only the ROI subset for a SceneMeta already resolved against ASF by the API."""
    from .roi_explore import validate_roi

    roi_wkt = validate_roi(roi_geojson)
    if not isinstance(scene, SceneMeta) or scene.product != "GCOV" or not scene.scene_id:
        raise ValueError("Se requiere una escena GCOV previamente validada en ASF.")
    source = get_source(scene.source)
    polarization_layers = tuple(f"{pol}{pol}" for pol in scene.polarizations if pol in ("HH", "HV"))
    if not polarization_layers:
        raise ValueError(f"{scene.scene_id}: ASF no informa polarizaciones Frequency A compatibles (HH/HV).")
    layers = polarization_layers + AUX_LAYERS
    return source.fetch_subsets(scene, roi_wkt, layers, Path(out_dir))


def find_scenes(catalog_path: Path, scene_ids: list[str]) -> list[SceneMeta]:
    data = json.loads(catalog_path.read_text(encoding="utf-8"))
    by_id = {s["scene_id"]: SceneMeta.from_dict(s) for s in data["scenes"]}
    missing = [sid for sid in scene_ids if sid not in by_id]
    if missing:
        raise KeyError(f"No están en {catalog_path.name}: {missing}")
    return [by_id[sid] for sid in scene_ids]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("scene_ids", nargs="+")
    ap.add_argument("--capas", nargs="+", default=list(DEFAULT_LAYERS),
                    help=f"capas a recortar (default: {' '.join(DEFAULT_LAYERS)})")
    ap.add_argument("--config", default=str(ROOT / "pipeline" / "config.yaml"))
    ap.add_argument("--catalogo", default=None, help="JSON de catálogo (default: el más reciente)")
    ap.add_argument("--h5-local", default=None, help="usar un .h5 ya descargado (solo con una escena)")
    args = ap.parse_args(argv)

    if args.h5_local and len(args.scene_ids) != 1:
        ap.error("--h5-local solo admite una escena")

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    roi_wkt = cfg["roi"]["wkt"]
    raw_dir = ROOT / cfg["paths"].get("raw", "data/raw")
    catalog = Path(args.catalogo) if args.catalogo else latest_catalog(ROOT / cfg["paths"].get("catalog", "data/catalog"))
    scenes = find_scenes(catalog, args.scene_ids)
    source = get_source(cfg.get("source", "asf"))

    print(f"Catálogo: {catalog.relative_to(ROOT) if catalog.is_relative_to(ROOT) else catalog}")
    metas = []
    for s in scenes:
        print(f"\n{s.scene_id}\n  {s.date} T{s.track} F{s.frame} {s.direction} {s.crid} {s.maturity}")
        if s.maturity is None:
            print("  ! madurez desconocida en el catálogo: esta escena no será comparable (AGENTS.md §5)")
        paths = source.fetch_subsets(s, roi_wkt, args.capas, raw_dir,
                                     local_h5=Path(args.h5_local) if args.h5_local else None)
        meta = json.loads((paths[0].parent / "scene.json").read_text(encoding="utf-8"))
        metas.append(meta)
        cov = meta.get("cobertura_roi") or {}
        m = meta["malla"]
        print(f"  {len(paths)} capas -> {paths[0].parent.relative_to(ROOT)}")
        print(f"  malla EPSG:{m['epsg']}, {m['dx_m']:g} x {abs(m['dy_m']):g} m, recorte {m['forma_recorte']}")
        if cov:
            print(f"  píxeles válidos en el polígono ROI: {cov['pct_valido']:.2f} %")
        if m["roi_se_sale_de_la_escena"]:
            print("  ! la ROI se sale de la escena")

    if len(scenes) >= 2:
        print("\nComparabilidad respecto a la primera escena:")
        ok_all = True
        for s, meta in zip(scenes[1:], metas[1:]):
            rep = check_pair(scenes[0], s)
            grid_diffs = compare_grids(metas[0], meta)
            ok = rep.comparable and not grid_diffs
            ok_all &= ok
            print(f"  {scenes[0].date} vs {s.date}: {'COMPARABLE' if ok else 'NO COMPARABLE'}")
            for e in rep.errors + [f"malla: {d}" for d in grid_diffs]:
                print(f"    error: {e}")
            for w in rep.warnings:
                print(f"    aviso: {w}")
        return 0 if ok_all else 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
