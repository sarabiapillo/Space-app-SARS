"""Lectura por ventanas de productos NISAR L2 en HDF5 (Etapa 1: GCOV y GSLC).

Nada aquí carga una capa completa en memoria: una capa de un marco completo ocupa
GB o decenas de GB sin comprimir. Se lee solo la ventana de la ROI, o una versión
submuestreada para la vista general. La biblioteca HDF5 descomprime al vuelo solo
los bloques (chunks) que se piden.

Fórmulas (AGENTS.md §6, propuesta §6.2):
    GCOV: capas HHHH, HVHV = potencia lineal en la convención que declara el archivo
          (processingInformation/parameters/rtc/outputBackscatterNormalizationConvention,
          p. ej. gamma0). σ⁰ = γ⁰ · rtcGammaToSigmaFactor.
    GSLC: β⁰ = |z|² = Re(z)² + Im(z)²
    X_dB = 10·log10(X)
    multilook: promedio LINEAL de bloques n×n, y después dB
"""
from __future__ import annotations

from dataclasses import dataclass

import h5py
import numpy as np
import shapely
from pyproj import Transformer
from rasterio.transform import Affine, from_origin
from shapely import wkt as shapely_wkt
from shapely.geometry import Polygon

import re

SUPPORTED_PRODUCTS = ("GCOV", "GSLC")
SYMBOL = {"beta0": "β⁰", "gamma0": "γ⁰", "sigma0": "σ⁰"}
# Atributo de la capa `mask`: 0 = muestra no válida, 255 = fuera de la adquisición,
# cualquier otro valor = número de subfranja válida.
MASK_INVALID = 0
MASK_OUTSIDE = 255
H5_CHUNK_ROWS = 512


def to_text(value):
    """Convierte valores leídos del HDF5 (bytes, arrays, escalares numpy) a tipos de Python."""
    if isinstance(value, bytes):
        return value.decode()
    if isinstance(value, np.ndarray):
        if value.dtype.kind == "S":
            return [v.decode() for v in value.ravel()]
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    return value


def attrs_dict(obj) -> dict:
    out = {}
    for k, v in obj.attrs.items():
        if k == "DIMENSION_LIST":
            continue
        try:
            out[k] = to_text(v)
        except Exception:
            out[k] = str(v)
    return out


def read_identification(f: h5py.File) -> dict:
    g = f["science/LSAR/identification"]
    return {k: to_text(g[k][()]) for k in g.keys() if isinstance(g[k], h5py.Dataset)}


@dataclass(frozen=True)
class Grid:
    product: str
    frequency: str
    path: str
    epsg: int
    x: np.ndarray       # centros de píxel (m)
    y: np.ndarray       # centros de píxel (m), decrecientes
    dx: float
    dy: float           # negativo
    polarizations: tuple[str, ...]
    layers: tuple[str, ...]   # capas de potencia: GCOV HHHH/HVHV; GSLC HH/HV (complejas)
    quantity: str             # "gamma0", "beta0", … según declara el producto

    @property
    def shape(self) -> tuple[int, int]:
        return (self.y.size, self.x.size)

    def transform(self, row0: int = 0, col0: int = 0, step: int = 1) -> Affine:
        """Afín de la esquina superior izquierda de una ventana (o de un multilook de paso `step`)."""
        return from_origin(
            self.x[col0] - self.dx / 2,
            self.y[row0] + abs(self.dy) / 2,
            self.dx * step,
            abs(self.dy) * step,
        )

    def extent(self) -> tuple[float, float, float, float]:
        """(xmin, xmax, ymin, ymax) en metros, bordes de píxel de toda la malla."""
        return (
            float(self.x[0] - self.dx / 2),
            float(self.x[-1] + self.dx / 2),
            float(self.y[-1] - abs(self.dy) / 2),
            float(self.y[0] + abs(self.dy) / 2),
        )


def processing_parameters(f: h5py.File, product: str) -> dict:
    """Parámetros escalares de processingInformation/parameters (banderas de corrección, RTC, etc.)."""
    base = f[f"science/LSAR/{product}/metadata/processingInformation/parameters"]
    out = {}

    def visit(name, obj):
        if isinstance(obj, h5py.Dataset) and obj.size < 20 and not name.endswith("runConfigurationContents"):
            out[name] = to_text(obj[()])

    base.visititems(visit)
    if "runConfigurationContents" in base:
        m = re.search(r"mantissa_nbits:\s*(\d+)", to_text(base["runConfigurationContents"][()]))
        out["mantissa_nbits_capas_potencia"] = int(m.group(1)) if m else None
    return out


def backscatter_quantity(f: h5py.File, product: str) -> str:
    """Magnitud de las capas de potencia, leída del archivo (no se supone)."""
    if product == "GSLC":
        return "beta0"
    rtc = f[f"science/LSAR/{product}/metadata/processingInformation/parameters/rtc"]
    expr = to_text(rtc["outputBackscatterExpressionConvention"][()])
    norm = to_text(rtc["outputBackscatterNormalizationConvention"][()])
    if expr.strip().lower() != "linear power":
        raise ValueError(f"Convención de salida no soportada: {expr!r} (se esperaba 'Linear power').")
    return norm.strip()


def open_grid(f: h5py.File, frequency: str = "A") -> Grid:
    product = to_text(f["science/LSAR/identification/productType"][()])
    if product not in SUPPORTED_PRODUCTS:
        raise ValueError(f"Producto {product}: la Etapa 1 solo está verificada con GCOV y GSLC.")
    path = f"science/LSAR/{product}/grids/frequency{frequency}"
    g = f[path]
    pols = tuple(to_text(g["listOfPolarizations"][()]))
    if product == "GCOV":
        terms = to_text(g["listOfCovarianceTerms"][()])
        layers = tuple(t for t in terms if t[:2] == t[2:])   # términos diagonales = potencias
    else:
        layers = pols
    return Grid(
        product=product,
        frequency=frequency,
        path=path,
        epsg=int(g["projection"].attrs["epsg_code"]),
        x=g["xCoordinates"][()],
        y=g["yCoordinates"][()],
        dx=float(g["xCoordinateSpacing"][()]),
        dy=float(g["yCoordinateSpacing"][()]),
        polarizations=pols,
        layers=layers,
        quantity=backscatter_quantity(f, product),
    )


@dataclass(frozen=True)
class Window:
    row0: int
    row1: int
    col0: int
    col1: int

    @property
    def shape(self) -> tuple[int, int]:
        return (self.row1 - self.row0, self.col1 - self.col0)

    @property
    def slices(self) -> tuple[slice, slice]:
        return (slice(self.row0, self.row1), slice(self.col0, self.col1))


def roi_to_crs(roi_wkt: str, epsg: int) -> Polygon:
    """ROI en lon/lat (EPSG:4326) → CRS de la malla. Se densifica para que los bordes no se deformen."""
    roi = shapely.segmentize(shapely_wkt.loads(roi_wkt), max_segment_length=0.005)
    t = Transformer.from_crs(4326, epsg, always_xy=True)
    return shapely.transform(roi, lambda x, y: t.transform(x, y), interleaved=False)


def roi_window(grid: Grid, roi_wkt: str) -> tuple[Window, Polygon, bool]:
    """Ventana de filas/columnas que contiene la ROI. `clipped` = la ROI se sale de la escena."""
    roi = roi_to_crs(roi_wkt, grid.epsg)
    xmin, ymin, xmax, ymax = roi.bounds
    cols = np.flatnonzero((grid.x >= xmin) & (grid.x <= xmax))
    rows = np.flatnonzero((grid.y >= ymin) & (grid.y <= ymax))
    if cols.size == 0 or rows.size == 0:
        raise ValueError("La ROI no intersecta la malla de esta escena.")
    clipped = bool(xmin < grid.x.min() or xmax > grid.x.max() or ymin < grid.y.min() or ymax > grid.y.max())
    return Window(int(rows[0]), int(rows[-1]) + 1, int(cols[0]), int(cols[-1]) + 1), roi, clipped


def to_lonlat(epsg: int, x, y):
    t = Transformer.from_crs(epsg, 4326, always_xy=True)
    return t.transform(x, y)


def power(z: np.ndarray) -> np.ndarray:
    """β⁰ = Re(z)² + Im(z)² en float32. El relleno NaN+NaN·j queda como NaN."""
    re = z.real.astype(np.float32)
    im = z.imag.astype(np.float32)
    return re * re + im * im


def _strips(start: int, stop: int, size: int):
    """Franjas de filas alineadas a los chunks del HDF5 (para no descomprimir dos veces un bloque)."""
    edges = [start] + list(range((start // size + 1) * size, stop, size)) + [stop]
    return list(zip(edges[:-1], edges[1:]))


def as_power(block: np.ndarray) -> np.ndarray:
    """Capa compleja (GSLC) → |z|²; capa real (GCOV, ya es potencia) → float32 sin cambios."""
    if np.iscomplexobj(block):
        return power(block)
    return block.astype(np.float32, copy=False)


def read_float(ds: h5py.Dataset, win: Window, fn=None, chunk_rows: int = H5_CHUNK_ROWS) -> np.ndarray:
    """Lee una ventana por franjas alineadas a los chunks, aplicando `fn` a cada franja."""
    out = np.empty(win.shape, dtype=np.float32)
    for r0, r1 in _strips(win.row0, win.row1, chunk_rows):
        block = ds[r0:r1, win.col0 : win.col1]
        out[r0 - win.row0 : r1 - win.row0] = fn(block) if fn else block
    return out


def read_power(ds: h5py.Dataset, win: Window, chunk_rows: int = H5_CHUNK_ROWS) -> np.ndarray:
    return read_float(ds, win, as_power, chunk_rows)


def valid_mask(mask: np.ndarray, pw: np.ndarray | None = None) -> np.ndarray:
    ok = (mask != MASK_INVALID) & (mask != MASK_OUTSIDE)
    if pw is not None:
        ok &= np.isfinite(pw)
    return ok


def multilook(a: np.ndarray, n: int, min_valid_fraction: float = 0.5) -> np.ndarray:
    """Promedio lineal de bloques n×n ignorando NaN.

    Un bloque con menos de `min_valid_fraction`·n² píxeles válidos queda en NaN.
    Las filas/columnas sobrantes del borde (que no completan un bloque) se descartan.
    """
    if n == 1:
        return a.astype(np.float32, copy=True)
    h, w = (a.shape[0] // n) * n, (a.shape[1] // n) * n
    b = a[:h, :w].reshape(h // n, n, w // n, n)
    finite = np.isfinite(b)
    count = finite.sum(axis=(1, 3))
    total = np.where(finite, b, 0).sum(axis=(1, 3), dtype=np.float64)
    out = np.full(count.shape, np.nan, dtype=np.float32)
    ok = count >= min_valid_fraction * n * n
    out[ok] = total[ok] / count[ok]
    return out


def to_db(p):
    """10·log10(p). Valores ≤ 0 o NaN → NaN (no se toma logaritmo de cero)."""
    arr = np.asarray(p)
    out = np.full(arr.shape, np.nan, dtype=np.float64 if arr.ndim == 0 else np.float32)
    pos = arr > 0
    out[pos] = 10.0 * np.log10(arr[pos].astype(np.float64))
    return out[()] if arr.ndim == 0 else out


def power_stats(p: np.ndarray) -> dict:
    """Estadísticas de β⁰ lineal (cualquier forma; se ignoran NaN).

    Se reporta tanto el dB de la media (10·log10(media lineal)) como la media de los dB:
    no son iguales; la media de los dB siempre es menor o igual.
    """
    v = p[np.isfinite(p)].astype(np.float64)
    if v.size == 0:
        raise ValueError("No hay píxeles válidos.")
    pos = v[v > 0]
    db = 10.0 * np.log10(pos)
    mean_lin = float(v.mean())
    p5, p95 = np.percentile(v, [5, 95])
    p5_db, p95_db = np.percentile(db, [5, 95])
    return {
        "n_validos": int(v.size),
        "n_ceros": int(v.size - pos.size),
        "media_lineal": mean_lin,
        "dB_de_la_media": float(10.0 * np.log10(mean_lin)) if mean_lin > 0 else None,
        "media_dB": float(db.mean()),
        "mediana_dB": float(np.median(db)),
        "desv_std_dB": float(db.std()),
        "p5_lineal": float(p5),
        "p95_lineal": float(p95),
        "p5_dB": float(p5_db),
        "p95_dB": float(p95_db),
    }


def decimate(ds: h5py.Dataset, step: int) -> np.ndarray:
    """Toma 1 de cada `step` píxeles en filas y columnas.

    Aviso: para una vista de toda la escena HDF5 tiene que descomprimir TODOS los
    chunks de la capa (decenas de GB); puede tardar varios minutos.
    """
    return ds[::step, ::step]


def read_incidence(f: h5py.File, product: str, bounds, height_m: float) -> dict:
    """Ángulo de incidencia (radarGrid, malla gruesa) sobre la ROI, en la capa de altura más cercana."""
    r = f[f"science/LSAR/{product}/metadata/radarGrid"]
    heights = r["heightAboveEllipsoid"][()]
    x, y = r["xCoordinates"][()], r["yCoordinates"][()]
    xmin, ymin, xmax, ymax = bounds
    cols = np.flatnonzero((x >= xmin) & (x <= xmax))
    rows = np.flatnonzero((y >= ymin) & (y <= ymax))
    # un nodo de margen a cada lado para cubrir toda la ROI
    c0, c1 = max(int(cols[0]) - 1, 0), min(int(cols[-1]) + 2, x.size)
    r0, r1 = max(int(rows[0]) - 1, 0), min(int(rows[-1]) + 2, y.size)
    k = int(np.argmin(np.abs(heights - height_m)))
    cube = r["incidenceAngle"][:, r0:r1, c0:c1]
    return {
        "altura_m": float(heights[k]),
        "x": x[c0:c1],
        "y": y[r0:r1],
        "angulo": cube[k],
        "media_por_altura": {float(h): float(np.nanmean(cube[i])) for i, h in enumerate(heights)},
        "unidades": to_text(r["incidenceAngle"].attrs.get("units", b"")),
    }
