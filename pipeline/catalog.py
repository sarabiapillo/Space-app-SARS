"""Consulta el catálogo sobre la ROI y agrupa las escenas en pilas comparables.

Uso (desde la raíz del repo, con el entorno ``nisar`` activo):

    python -m pipeline.catalog
    python -m pipeline.catalog --config pipeline/config.yaml

Guarda un JSON en data/catalog/ con la consulta, la versión del código y todas las
escenas, para poder rastrear de dónde salió cada par elegido.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

from .compat import stack_key
from .sources import SceneMeta, get_source

ROOT = Path(__file__).resolve().parent.parent


def code_version() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        )
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True)
        return out.stdout.strip() + ("-dirty" if dirty.stdout.strip() else "")
    except Exception:
        return "unknown"


def group_stacks(scenes: list[SceneMeta]) -> dict[tuple, list[SceneMeta]]:
    stacks: dict[tuple, list[SceneMeta]] = defaultdict(list)
    for s in scenes:
        stacks[stack_key(s)].append(s)
    return dict(stacks)


def print_report(stacks: dict[tuple, list[SceneMeta]]) -> None:
    ordered = sorted(stacks.items(), key=lambda kv: -len(kv[1]))
    print(f"\n{len(ordered)} pilas (escenas con mismo producto/trayectoria/marco/dirección/pol./CRID/madurez)\n")
    for key, items in ordered:
        product, track, frame, direction, pols, crid, maturity = key
        dates = [s.date for s in items]
        dup = sorted({d for d in dates if dates.count(d) > 1})
        tag = "CANDIDATA" if len(set(dates)) >= 2 else "una fecha"
        print(f"[{tag}] {product} T{track} F{frame} {direction} {'+'.join(pols) or '?'} {crid} {maturity}")
        print(f"   {len(items)} productos, {len(set(dates))} fechas: {', '.join(sorted(set(dates)))}")
        if dup:
            print(f"   ! fechas con más de un producto (reprocesado u otra órbita): {', '.join(dup)}")
    print("\nCANDIDATA = al menos dos fechas en la misma pila. Confirmar cada par con compat.check_pair")
    print("y verificar cobertura real de la ROI y resolución en el archivo antes de analizar.")


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", default=str(ROOT / "pipeline" / "config.yaml"))
    args = ap.parse_args(argv)

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    source = get_source(cfg.get("source", "asf"))
    query = {
        "roi_wkt": cfg["roi"]["wkt"],
        "product": cfg["search"]["product"],
        "start": cfg["search"].get("start"),
        "end": cfg["search"].get("end"),
    }

    scenes = source.search(**query)
    stacks = group_stacks(scenes)
    print_report(stacks)

    now = datetime.now(timezone.utc)
    out_dir = ROOT / cfg["paths"].get("catalog", "data/catalog")
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"catalog_{source.name}_{query['product']}_{now:%Y%m%dT%H%M%SZ}.json"
    out.write_text(
        json.dumps(
            {
                "created_utc": now.isoformat(),
                "code_version": code_version(),
                "source": source.name,
                "query": query,
                "n_scenes": len(scenes),
                "scenes": [s.to_dict() for s in scenes],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\n{len(scenes)} escenas guardadas en {out.relative_to(ROOT)}")
    return out


if __name__ == "__main__":
    main()
