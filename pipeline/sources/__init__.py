"""Fuentes de datos intercambiables. Elegir con ``source:`` en config.yaml."""
from .base import DataSource, SceneMeta


def get_source(name: str) -> DataSource:
    if name == "asf":
        from .asf import ASFSource
        return ASFSource()
    raise ValueError(f"Fuente de datos desconocida: {name!r}")


__all__ = ["DataSource", "SceneMeta", "get_source"]
