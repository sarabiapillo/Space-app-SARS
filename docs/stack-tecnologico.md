# Stack tecnológico, arquitectura y recursos — TerraPulse AI

> Resumen para el equipo. Actualizado: 2026-11-15, según el código de la rama `ETAPA-1`.
> Las versiones son las del entorno `nisar` (`environment.yml`); los enlaces se comprobaron ese día.

## 1. Vista general

```
 NASA / ASF (nube)                    pipeline/ (Python puro)                   backend/ (Django)              web/ (React)
┌──────────────────────┐   asf_search  ┌─────────────────────────────┐  JSON   ┌──────────────────────┐  REST  ┌─────────────────┐
│ ASF Search API       │──────────────►│ catalog.py   (pilas, pares) │  y      │ load_explore         │  JSON  │ Explorador      │
│ Earthdata Login      │  earthaccess  │ download.py  (recorte ROI)  │  COG    │  Models  (PostGIS)   │───────►│ Comparador      │
│ .h5 NISAR por HTTPS  │──────────────►│ etapa1.py    (inspección)   │────────►│  Serializers (DRF)   │        │ MapLibre +      │
│ (lectura por bloques)│   h5py+fsspec │ graficas_datos / web_export │ data/   │  Views → /api/…      │        │ Chart.js (prop.)│
└──────────────────────┘               └─────────────────────────────┘         └──────────────────────┘        └─────────────────┘
```

**Regla de arquitectura** (AGENTS.md §8): `pipeline/` no depende de Django.
- El pipeline escribe archivos en `data/`. Django los carga en la base y los sirve; nunca abre un `.h5`.
- Así el procesamiento SAR se prueba desde la terminal, sin servidor.

---

## 2. Librerías de Python que usa el código

### 2.1 Datos NISAR y geoespacial (`pipeline/`)

| Librería | Versión | Para qué la usamos | Dónde | Documentación |
|---|---|---|---|---|
| **h5py** | 3.16.0 (HDF5 2.2.0) | Leer los `.h5` de NISAR por ventanas, locales o remotos. Es la única vía: el GDAL del entorno no trae drivers HDF5/NISAR | `nisar_h5.py`, `sources/subset.py`, `sources/asf.py`, `etapa1.py` | https://docs.h5py.org/ |
| **NumPy** | 2.4.6 | Potencia, dB (`10·log10`), multilook, máscaras, estadísticas, histogramas | casi todo `pipeline/` | https://numpy.org/doc/ |
| **rasterio** (sobre GDAL 3.12.3) | 1.4.4 | Escribir GeoTIFF y COG, reproyectar a EPSG:3857 y escribir los PNG web | `sources/subset.py`, `etapa1.py`, `web_export.py`, `nisar_h5.py` | https://rasterio.readthedocs.io/ · https://gdal.org/ |
| **Shapely** | 2.2.0 | Geometría de la ROI (WKT → polígono) y su intersección con la malla | `nisar_h5.py` | https://shapely.readthedocs.io/ |
| **pyproj** | 3.7.2 | Transformar la ROI de EPSG:4326 al UTM del producto (EPSG:32615) y de vuelta | `nisar_h5.py` | https://pyproj4.github.io/pyproj/ |
| **matplotlib** | 3.11.2 | Figuras PNG de inspección (A–E). Se importa solo si se piden figuras | `etapa1_figuras.py` | https://matplotlib.org/ |

### 2.2 Acceso a datos de la NASA (`pipeline/sources/`)

| Librería | Versión | Para qué | Dónde | Documentación |
|---|---|---|---|---|
| **asf_search** | 14.1.0 | Consultar el catálogo de ASF: productos GCOV que intersectan la ROI, con trayectoria, marco, CRID y madurez | `sources/asf.py` | https://docs.asf.alaska.edu/asf_search/basics/ |
| **earthaccess** | 0.17.0 | Iniciar sesión en Earthdata Login (`.env` o `.netrc`) y obtener una sesión HTTPS autenticada | `sources/asf.py` | https://earthaccess.readthedocs.io/ |
| **fsspec** | 2026.9.0 | Viene con earthaccess. Abre el `.h5` remoto como si fuera un archivo y pide solo los bytes de la ROI (bloques de 8 MiB) | indirecto, vía `earthaccess.get_fsspec_https_session()` | https://filesystem-spec.readthedocs.io/ |

### 2.3 Backend y base de datos (`backend/`)

| Librería | Versión | Para qué | Documentación |
|---|---|---|---|
| **Django** | 5.2.19 | Framework web: modelos, migraciones, comandos de gestión (`load_explore`), panel `/admin/` | https://docs.djangoproject.com/en/5.2/ |
| **GeoDjango** (`django.contrib.gis`) | incluido en Django | Campos geométricos (`PolygonField`) y consultas espaciales (`footprint__intersects`) sobre PostGIS | https://docs.djangoproject.com/en/5.2/ref/contrib/gis/ |
| **Django REST Framework** | 3.18.3 | Serializers y vistas de la API JSON (`/api/…`) | https://www.django-rest-framework.org/ |
| **psycopg** | 3.3.8 | Driver de PostgreSQL para Django | https://www.psycopg.org/psycopg3/docs/ |
| **PostgreSQL 16 + PostGIS 3.4** | imagen `postgis/postgis:16-3.4` | Base de datos con tipos y funciones espaciales | https://postgis.net/documentation/ |

### 2.4 Utilidades y pruebas

| Librería | Versión | Para qué | Documentación |
|---|---|---|---|
| **PyYAML** | 6.0.3 | Leer `pipeline/config.yaml` (ROI, comparabilidad, par de trabajo) | https://pyyaml.org/wiki/PyYAMLDocumentation |
| **python-dotenv** | — | Cargar `.env` (credenciales de Earthdata y de la base) sin escribirlas en el código | https://pypi.org/project/python-dotenv/ |
| **pytest** | 9.2.0 | 53 pruebas del pipeline con HDF5 sintéticos (`pytest`) | https://docs.pytest.org/ |
| `unittest` de Django | — | 16 pruebas del backend sobre PostGIS (`python manage.py test scenes`) | https://docs.djangoproject.com/en/5.2/ |

### 2.5 Instaladas pero aún sin uso en el código
  
| Librería | Plan |
|---|---|
| **xarray / rioxarray** | Posible uso en `preprocess.py` / `change.py` (P2) para pilas de fechas. https://docs.xarray.dev/ |
| **geopandas** | Posible uso con capas vectoriales auxiliares (P3) |
| **Celery + Redis** | Tareas en segundo plano, solo si el tiempo de cómputo lo justifica (plan, Fase 2). https://docs.celeryq.dev/ |

### 2.6 Frontend (no es Python; como referencia)

| Herramienta | Uso | Documentación |
|---|---|---|
| React + TypeScript + Vite | Aplicación web (P5) | https://react.dev/ · https://vite.dev/ |
| MapLibre GL JS | Mapa, ROI y capas PNG/COG | https://maplibre.org/maplibre-gl-js/docs/ |
| Chart.js | Gráficas (**propuesta**, pendiente de aprobación de P5/P6) | https://www.chartjs.org/docs/latest/ |
| TiTiler | Servir los COG como teselas (contrato C5, P6) | https://developmentseed.org/titiler/ |
| Formato COG | GeoTIFF optimizado para la nube | https://cogeo.org/ |

---

## 3. Arquitectura: el patrón MVC en el proyecto

**MVC** (Modelo–Vista–Controlador) separa los **datos** (Modelo), la **presentación** (Vista) y la **lógica que los conecta** (Controlador). Django usa una variante llamada **MTV** (Modelo–Template–Vista):
- la *View* de Django hace de controlador;
- el *Template* hace de vista.

Como el proyecto es una **API JSON con un frontend aparte**, no usamos templates. La capa de presentación es React, y la "vista" de Django devuelve JSON.

| Capa MVC | En TerraPulse | Archivos |
|---|---|---|
| **Modelo** (datos y reglas) | Modelos de Django sobre PostGIS: `ROI`, `Scene`, `SceneInspection`, `SceneChart`. Definen tablas, tipos espaciales y restricciones (una inspección por escena y versión del código) | `backend/scenes/models.py`, `migrations/` |
| **Controlador** (recibe la petición y decide) | *Views* de DRF: validan filtros (`track`, `maturity`…), consultan los modelos y devuelven `200`/`400`/`404`. `urls.py` dirige cada ruta a su vista | `backend/scenes/views.py`, `urls.py`, `config/urls.py` |
| **Vista** (presentación) | Dos niveles. **Serializers:** convierten los modelos a JSON con los nombres del contrato C4. **React + MapLibre + Chart.js:** dibujan ese JSON | `backend/scenes/serializers.py`, `web/src/` |

Otras piezas que no son MVC, pero que hay que conocer:

- **Comando de carga** (`load_explore`): es la entrada de datos. Lee los JSON del pipeline y escribe en los modelos dentro de una transacción.
- **Patrón puerto–adaptador en `pipeline/sources/`:** `base.py` define el contrato `DataSource` / `SceneMeta`, y `asf.py` lo implementa para ASF. El resto del pipeline no importa `asf_search`, así que para cambiar de fuente basta crear otro módulo y cambiar `source:` en `config.yaml`.
- **Contratos entre equipos** (C1–C5, `plan-de-trabajo.md` §3): formatos de archivo y de API acordados. Permiten que cada rol trabaje con datos simulados sin esperar a los demás.

Recorrido de una petición:

```
GET /api/scenes/{id}/charts
  → config/urls.py → scenes/urls.py          (ruta)
  → views.SceneCharts.get()                  (controlador: busca escena e inspección más reciente)
  → models.SceneInspection / SceneChart      (modelo: consulta a PostGIS)
  → serializers.ChartSerializer              (vista: JSON)
  → web/src/api/client.ts → Chart.js         (presentación)
```

---

## 4. APIs y servicios

### 4.1 Externas (NASA / ASF) que consume el pipeline

| Servicio | Cómo lo usamos | Autenticación |
|---|---|---|
| **ASF Search API** (vía `asf_search`) | `python -m pipeline.catalog`: busca productos NISAR GCOV sobre la ROI y guarda el catálogo en `data/catalog/` | No requiere |
| **Earthdata Login (URS)** | `earthaccess.login()`: obtiene la sesión para descargar | Usuario y contraseña de Earthdata en `.env` o `.netrc` |
| **Descarga HTTPS de ASF** (archivos `.h5`) | `download.py` y `etapa1.py` abren el `.h5` por HTTPS y piden por rangos de bytes solo los bloques de la ROI y los metadatos, sin bajar el archivo completo (~7 GB) | Sesión de Earthdata |

### 4.2 Interna: API REST de TerraPulse (contrato C4)

Solo lectura y en JSON. Detalle y ejemplos en [api.md](api.md).

| Endpoint | Devuelve |
|---|---|
| `GET /api/rois` | Regiones de interés (WKT y GeoJSON) |
| `GET /api/scenes?roi=&track=&frame=&direction=&maturity=&crid=` | Escenas NISAR |
| `GET /api/scenes/{scene_id}` | Detalle con huella e inspecciones |
| `GET /api/scenes/{scene_id}/charts[/{chart_id}]` | Datos de las gráficas, con versión del código y advertencias |
| `/api/changes`, `/api/compat` | Pendientes (esperan a C2 de P2 y C3 de P3) |

---

## 5. Recursos públicos de la NASA y la misión

| Recurso | Enlace | Para qué |
|---|---|---|
| Misión NISAR (JPL) | https://nisar.jpl.nasa.gov/ | Descripción de la misión |
| Documentación NISAR en ASF | https://nisar-docs.asf.alaska.edu/ | Formato de productos, calibración, madurez |
| Productos NISAR | https://nisar-docs.asf.alaska.edu/products-overview/ | GCOV, GSLC, GUNW, etc. |
| Disponibilidad | https://nisar-docs.asf.alaska.edu/availability-overview/ | Qué datos hay y desde cuándo |
| ASF Data Search (Vertex) | https://search.asf.alaska.edu/ | Buscar escenas en el navegador |
| NASA Earthdata | https://www.earthdata.nasa.gov/ | Portal general de datos de la NASA |
| Earthdata Search | https://search.earthdata.nasa.gov/ | Buscar datos de cualquier DAAC (también auxiliares) |
| Earthdata Login (perfil) | https://urs.earthdata.nasa.gov/ | Crear cuenta y autorizar aplicaciones (p. ej., GES DISC) |
| HyP3 (ASF) | https://hyp3-docs.asf.alaska.edu/ | Procesamiento SAR bajo demanda |
| OpenSARLab (ASF) | https://asf.alaska.edu/asf-services-opensarlab/ | Notebooks SAR en la nube |
| ISCE3 | https://github.com/isce-framework/isce3 | Software con el que se procesan los productos NISAR |
| Reto Space Apps 2026 | https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/ | Enunciado del reto |

**Fuentes auxiliares candidatas** para la validación (P3; ver `metodologia.md`):

| Fuente | Enlace | DAAC |
|---|---|---|
| GPM IMERG (precipitación) | https://gpm.nasa.gov/data/imerg | GES DISC: https://disc.gsfc.nasa.gov/ |
| HLS (Landsat + Sentinel-2 armonizados) | https://www.earthdata.nasa.gov/data/projects/hls | LP DAAC: https://lpdaac.usgs.gov/ |
| OPERA (DSWx, DIST) | https://www.earthdata.nasa.gov/data/projects/opera | PO.DAAC: https://podaac.jpl.nasa.gov/ · LP DAAC |

Comparar con OPERA mide **acuerdo** entre productos, no exactitud (AGENTS.md §5).

---

## 6. Infraestructura

| Pieza | Uso | Documentación |
|---|---|---|
| Conda (Miniforge), entorno `nisar` | Python 3.11 y librerías geoespaciales compiladas (GDAL, PROJ, HDF5) | https://github.com/conda-forge/miniforge |
| Docker / Docker Compose | PostGIS en local ([bd-docker.md](bd-docker.md)); despliegue previsto en AWS EC2 | https://docs.docker.com/compose/ |
| Git + GitHub | Ramas por rol (`p1/…`, `p4/…`), PR con revisión | — |

## 7. Limitaciones conocidas del stack

- **GDAL 3.12** no tiene los drivers HDF5/NISAR; AGENTS.md pide ≥ 3.13. Por eso toda la lectura de `.h5` se hace con h5py, y el fragmento `gdalwarp` que genera Vertex no funciona en este entorno.
- **Matplotlib y Chart.js conviven:** los PNG de `figuras/` son para revisar y documentar; `graficas.json` es para la web. Ambos salen de los mismos números.
- **Los PNG son solo para ver.** Los valores se leen de los GeoTIFF/COG (AGENTS.md §5).
