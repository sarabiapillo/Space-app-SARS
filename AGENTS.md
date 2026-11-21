# AGENTS.md — TerraPulse AI

Este archivo es para cualquier agente de IA (Claude, Codex, Copilot, Cursor, etc.) que trabaje en este repositorio. Léelo completo antes de escribir código o proponer cambios.

## 1. Qué es el proyecto

**TerraPulse AI** ("El pulso cambiante de nuestro planeta") es una plataforma abierta e interactiva que procesa observaciones de radar de la misión **NASA–ISRO NISAR**, detecta cambios en la superficie terrestre y presenta evidencia geoespacial, análisis cuantitativo e interpretaciones asistidas por IA.

Se desarrolla para el reto de observación terrestre de NASA Space Apps 2026 (*Be an Earth System Trend Detective*). La propuesta técnica completa está en `docs/` (documento "TerraPulse AI – Propuesta técnica", 5 de noviembre de 2026).

**Idea central:** no es un visor de imágenes. Es un flujo reproducible con trazabilidad completa: dato NISAR original → procesamiento → métrica → interpretación.

## 2. Principios no negociables

1. **Rigor científico antes que funciones.** Un estudio pequeño, documentado y honesto vale más que una plataforma amplia con resultados sin comprobar.
2. **Una sola historia de uso con datos reales.** No implementar todos los fenómenos ni todos los modelos.
3. **Trazabilidad.** Toda cifra mostrada debe poder rastrearse hasta escenas, fechas, parámetros y código que la produjeron.
4. **No afirmar causas.** Un cambio en retrodispersión describe un cambio en la respuesta radar, no identifica por sí solo la causa física. Distinguir siempre entre observación, inferencia y predicción.
5. **No inventar datos.** Nunca fabricar escenas, valores, métricas, URLs, IDs de producto ni resultados de validación. Si falta información, decirlo.
6. **No afirmar novedad sin evidencia.** No declarar que el proyecto es el primero o el único sin una revisión documentada (ver `docs/comparacion.md`).

## 3. Estado actual

- Entorno conda `nisar` creado (Python 3.11, GDAL, rasterio, h5py, geopandas, xarray, rioxarray, asf_search, earthaccess, Django, DRF, celery, redis).
- Proyecto Django creado en `backend/` (`config`, apps `scenes` y `analyses`).
- PostGIS en Docker funcionando; migraciones base aplicadas. Configuración sensible en `.env` (ver `.env.example`).
- `pipeline/sources/` (fuente intercambiable, hoy ASF), `pipeline/compat.py` y `pipeline/catalog.py` implementados y con pruebas.
- `pipeline/nisar_h5.py` + `pipeline/etapa1.py`: lectura por ventanas de los `.h5` e inspección de una escena (Etapa 1), desde un `.h5` local o remoto (`scene_id`). Genera también `web/` (COG, PNG en EPSG:3857 y `capas.json`) para la interfaz web (`pipeline/web_export.py`, ver `docs/p1-etapa1-web.md`).
- `pipeline/sources/subset.py` + `pipeline/download.py`: recorte a la ROI (local o remoto por HTTPS, solo los bloques de la ROI), con verificación de identidad contra el catálogo, cobertura de la ROI y comparación de malla.
- **Par de trabajo recortado (2026-11-14):** GCOV T62/F10 ASC P05023 PROVISIONAL, 2026-06-18 → 2026-10-16, en `data/raw/` (ver §4). Comparable y con malla idéntica.
- **Mapa de cambio (2026-11-18):** `pipeline/preprocess.py` + `pipeline/change.py` (`python -m pipeline.change`). γ⁰ dB, máscara del producto + polígono ROI, multilook 5×5 (50 m), Δ = t2 − t1, z robusto y clases con umbral ±3 dB. Salida en `data/processed/cambio_GCOV_T062_F010_P05023_20260618_20261016_gamma0/` (GeoTIFF, `change.json`, `web/capas.json`). **Exploratorio:** sin validación ni máscara de sombra/layover/pendiente. También se calcula para **cualquier ROI dibujada** con par comparable (`roi_explore.build_change` → `result.json → change`) y se ve en la web con el botón **Cambio Δ**. En las ROIs el Δ sale por defecto a 5×5 (50 m) y ±3 dB; la web permite cambiar resolución (20/50/100 m) y umbral (dB fijo) con `POST /api/roi-jobs/{id}/change`, y muestra el ruido medido de cada ROI con un aviso si el umbral está a menos de 3 veces ese ruido (ver `docs/api-roi-jobs.md`).
- El fenómeno sigue **sin decidir**. Las fuentes auxiliares candidatas están en `docs/metodologia.md`.
- **Simulación de inundación (línea paralela, exploratoria; estado verificado 2026-11-19):** `pipeline/elevation/nasadem.py` (adquisición NASADEM vía Earthdata) y `pipeline/hydrology/` (DEM métrico → DG2, lluvia sintética reproducible ±10 mm/h exportada a NetCDF, frontera FREE idealizada, adaptador LISFLOOD-FP 8.0.3 DG2 CPU y conversión de salidas a COG). El solver y `generateDG2DEM` están compilados localmente en `data/tools/lisflood-fp-8.0/runtime/build/`, con hashes fijados en `backend/config/flood_service.py`. API Django autenticada: `POST /api/flood-scenarios/roi/start/` y `/api/flood-roi-runs/<uuid>/` (estado, resultados, COG y preview PNG EPSG:3857); el panel web `RainDg2Panel` está conectado a ella (ver `docs/api-simulacion-roi.md`, `docs/configuracion-servicio-inundacion.md` y `docs/features/flood-ui-dg2.tex`). Todo resultado se marca `synthetic` e `hydraulic_accuracy_validated: false`. El 2026-11-19 se completó una simulación real NASADEM (`n16w094`) + DG2 de prueba sobre un dominio de ~1 km² dentro de la ROI, con valores de prueba explícitos y `dg2_depth_thresh_m` (sin él, DG2 produce profundidades negativas en láminas finas). Los presupuestos por defecto solo admiten dominios pequeños (3000 celdas, 120 s de solver); la ROI completa no cabe. **No** existe validación hidráulica.

**Lo más importante que falta:** decidir el fenómeno para elegir la fuente de validación (paso 6), máscara de sombra/layover/pendiente y mostrar la capa de cambio en la web.

## 4. Caso de estudio

- **Región:** Chiapas, México.
- **ROI (WKT, EPSG:4326):**
  ```
  POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))
  ```
- **Fenómeno:** por decidir entre inundación, humedales, vegetación o deformación, según disponibilidad de datos y posibilidad de validación independiente. Se elige el que permita un resultado medible, no el más espectacular.
- **Criterios de selección:** disponibilidad NISAR, calidad y consistencia, relevancia local, validación independiente posible y claridad de comunicación.

### Pilas GCOV sobre la ROI (salida de `python -m pipeline.catalog`, consulta del 2026-11-12 UTC)

39 productos GCOV en total. Pilas con al menos dos fechas y mismos producto, trayectoria, marco, dirección, polarización, CRID y madurez:

| Trayectoria / Marco | Dirección | Pol. (Freq A) | CRID | Madurez | Fechas |
|---|---|---|---|---|---|
| 55 / 80 | DESCENDING | HH+HV | P05023 | PROVISIONAL | 10 fechas, 2026-06-18 → 2026-10-16, cada 12 días (falta 2026-08-05) |
| 62 / 10 | ASCENDING | HH+HV | P05023 | PROVISIONAL | 10 fechas, 2026-06-18 → 2026-10-16, mismas fechas que T55 |
| 156 / 80 | DESCENDING | HH+HV | P05023 | PROVISIONAL | 8 fechas, 2026-06-25 → 2026-10-11 (2026-09-05 tiene dos productos: contador 001 y 002) |
| 55 / 80 | DESCENDING | HH+HV | X05009 / X05010 | BETA | 2025-11 → 2026-01 (dos pilas separadas por CRID) |

### Par de trabajo y cobertura real de la ROI (verificado en el `.h5`, 2026-11-14)

| Pila (P05023 PROVISIONAL) | Píxeles válidos en el polígono ROI | Uso |
|---|---|---|
| **T62 / F10 ASCENDING** | **99.57 % (t1) y 99.61 % (t2)** | **Par de trabajo:** 2026-06-18 → 2026-10-16 |
| T55 / F80 DESCENDING | ~50 %: el marco solo cubre al este de lon ≈ −93.14 | Respaldo (mismas fechas, también en `data/raw/`) |
| T156 / F80 DESCENDING | Sin verificar | — |

- Escenas del par: `NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001` y `NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001` (también en `pipeline/config.yaml → pair`).
- Malla idéntica en ambas fechas: EPSG:32615, 10 × 10 m, recorte de 2687 × 5504 px. Polarizaciones HH y HV leídas del `.h5`.
- La escena T62/F10 2026-10-28 (P05036, VALIDATED) se inspeccionó en la Etapa 1, pero **no tiene pareja**: es la única fecha P05036 de su pila.

Hallazgos que cambian lo que se creía antes:

- **El CRID cambió a P05036 (madurez VALIDATED en el catálogo) a partir del 2026-10-23.** Por eso el par T55 2026-10-16 / 2026-10-28 que se había anotado **no es comparable** (P05023 vs P05036). Al 2026-11-18, la pila T62/F10 P05036 ya tiene un par comparable (2026-10-28 → 2026-11-09): es el que elige `roi_explore` como "par más reciente" para ROIs cerca de Tuxtla.
- 2026-07-24 T55 tiene un segundo producto con órbita FOE y sin madurez en el catálogo. Usar el MOE.
- 2025-10-21 T55 es de cobertura parcial y solo HV.
- La resolución y la cobertura real de la ROI **no** vienen en el catálogo: verificarlas en el `.h5` antes de analizar (`python -m pipeline.download` lo hace y lo guarda en `scene.json`).
- Que una pila intersecte la ROI en el catálogo no significa que la cubra: T55 solo cubre la mitad.

Visto en Vertex sin verificar con `catalog.py`: GSLC T62/F10 2026-10-28 (P05036, ~22.5 GB) y GUNW 2026-10-04 (solo útil si el caso fuera deformación).

## 5. Reglas de datos NISAR

- Fuente central: productos públicos NISAR vía ASF (https://search.asf.alaska.edu/) y NASA Earthdata. Documentación: https://nisar-docs.asf.alaska.edu/
- **Recursos del reto:** la lista oficial de Space Apps 2026 da como fuentes NASA **Earthdata Search y ASF Vertex**, las mismas que ya usa `ASFSource`. Por eso `sources/event.py` **no hace falta** para NISAR. Aun así, todo acceso a datos sigue pasando por `pipeline/sources/` (interfaz `DataSource`, que devuelve `SceneMeta`); el resto del pipeline no importa `asf_search` ni conoce la fuente. Si se agrega otra fuente, se crea un módulo en `sources/` y se cambia `source:` en `config.yaml`.
- **Otros sensores del reto** (RCM y RADARSAT-1 de la CSA, banda C; SAOCOM de CONAE, banda L): **nunca se mezclan con NISAR en un Δσ⁰** (otro sensor, geometría y calibración). RADARSAT-1 no tiene datos de 2026. SAOCOM solo como posible contraste, si P3 lo decide. Ver `docs/metodologia.md`.
- **Fuentes auxiliares** (validación y contexto) vía Earthdata, con la misma cuenta: GPM IMERG (GES DISC; requiere autorizar la aplicación en el perfil), HLS, OPERA DSWx y OPERA DIST (LP DAAC / PO.DAAC). OPERA es otro producto derivado: compararse con él mide **acuerdo**, no exactitud.
- **Lectura de los `.h5`:** el GDAL del entorno (3.12) no trae los drivers NISAR ni HDF5. Los `.h5` se leen con `h5py` (`nisar_h5.py`, `sources/subset.py`), locales o remotos.
- **Preferir GCOV** para retrodispersión (σ⁰/γ⁰) y mapas de cambio. GSLC es complejo y requiere calcular `10*log10(|z|²)`. GUNW solo para deformación (desplazamiento en línea de vista, no vertical). **SME2** (humedad del suelo a escala de parcela) es candidato si el caso fuera humedales o inundación.
- **Madurez:** leerla del catálogo (filtro `dataMaturity`), no deducirla de la letra del CRID. Si no se conoce, la escena no es comparable.
- **No procesar datos crudos (L0, RRSD).**
- **Comparabilidad.** Dos escenas solo se comparan si coinciden en: producto, trayectoria, marco, dirección de vuelo, polarización, resolución, versión de procesamiento (CRID) y nivel de madurez. **No mezclar BETA con PROVISIONAL.**
- **No asumir polarizaciones.** Leer de los metadatos y del nombre del producto qué polarizaciones tiene cada escena.
- Los productos L-band PROVISIONAL (desde 2026-06-17) están calibrados y parcialmente validados; no describirlos como completamente validados.
- Los PNG de "Visualizaciones" son solo para inspección visual. **Nunca calcular diferencias sobre ellos.**
- No descargar escenas completas (GCOV ~7 GB, GSLC ~22 GB). Recortar a la ROI con `python -m pipeline.download` (ver §9).
- Disponibilidad y especificaciones pueden cambiar: consultar la documentación vigente.

## 6. Metodología

Flujo: consulta → adquisición → inspección → preparación → comparabilidad → análisis → validación → publicación.

- Retrodispersión en dB: `σ⁰_dB = 10·log10(σ⁰)`.
- Cambio entre fechas comparables: `Δσ⁰_dB(x,y) = σ⁰_dB,t2(x,y) − σ⁰_dB,t1(x,y)`.
- Empezar con métodos interpretables: diferencia y razón, umbrales por estadística de la región, z-score respecto a una línea base, segmentación por reglas con máscaras auxiliares.
- Modelos ML (Random Forest, XGBoost, U-Net) **solo** si hay etiquetas fiables y partición espacial o temporal independiente. Una red neuronal no es automáticamente mejor que un método simple.
- Aplicar máscaras (nulos, sombras/layover, pendiente con DEM) y documentar parámetros.
- **Validación:** contrastar con datos independientes (precipitación, Sentinel-2, inventarios de eventos). Con etiquetas, calcular precisión, recall, F1 e IoU. Sin etiquetas, marcar el resultado como **exploratorio** y no presentar una exactitud no demostrada.

## 7. Asistente de IA dentro de la app (reglas estrictas)

> **Fuera de alcance por ahora** (decisión del equipo, 2026-11-11). No implementarlo ni dejarle código preparado. Las reglas se conservan por si se retoma después.

El LLM **no** mide, **no** clasifica imágenes por intuición y **no** inventa causas.

1. El usuario hace una pregunta sobre una región o resultado.
2. El backend consulta métricas calculadas, metadatos y documentación.
3. Se arma un contexto estructurado (JSON) con valores, unidades, fechas y fuentes.
4. El modelo redacta una explicación **limitada a ese contexto**.
5. La interfaz muestra las mediciones originales y advertencias junto a la explicación.

Si no hay datos suficientes, el sistema responde que no puede concluir. Cada afirmación cuantitativa debe rastrearse a un resultado reproducible. Esta parte se implementa **al final**.

## 8. Stack y estructura

> **Decisión:** la propuesta (§8 del PDF) sugería FastAPI. Se usa **Django + GeoDjango + DRF** porque da ORM espacial con PostGIS, migraciones y panel de administración sin código extra. La arquitectura lógica (catálogo, procesamiento, servicio de IA, PostGIS) es la misma.

**Stack:** Python 3.11, Django + GeoDjango, Django REST Framework, PostgreSQL + PostGIS (Docker), Celery + Redis, GDAL (≥ 3.13 para el driver NISAR), rasterio, h5py, xarray, geopandas, React + TypeScript + MapLibre GL, TiTiler para teselas, Docker Compose. Desarrollo en Windows con conda (Miniforge); despliegue previsto en AWS EC2 con Docker.

```
terrapulse/
├── AGENTS.md
├── README.md
├── docker-compose.yml          # db (PostGIS), luego redis/worker/web
├── docs/                       # propuesta, metodologia.md, comparacion.md
├── data/                       # NO va a git
│   ├── raw/                    # recortes descargados
│   └── processed/              # GeoTIFF/COG de dB y cambio
├── pipeline/                   # Python puro, independiente de Django
│   ├── sources/                # fuentes intercambiables: base.py (contrato), asf.py, subset.py (recorte .h5 → C1)
│   ├── elevation/              # proveedor NASADEM (Earthdata) para la simulación de inundación
│   ├── hydrology/              # DEM DG2, lluvia sintética, fronteras, adaptador LISFLOOD-FP y resultados
│   ├── catalog.py              # consulta la fuente, agrupa pilas, guarda JSON en data/catalog/
│   ├── tests/                  # pytest (pytest.ini en la raíz)
│   ├── download.py             # recorte a la ROI (h5py, local o remoto) → data/raw/<scene_id>/
│   ├── nisar_h5.py             # lectura por ventanas de los .h5 NISAR
│   ├── etapa1.py               # inspección de una escena, local o remota → data/explore/
│   ├── web_export.py           # COG + PNG (EPSG:3857) + capas.json para la web
│   ├── preprocess.py           # complejo -> dB, máscaras
│   ├── compat.py               # control de comparabilidad
│   ├── change.py               # Δσ⁰, z-score, umbral
│   ├── validate.py             # precisión, recall, F1, IoU
│   └── config.yaml             # ROI, comparabilidad y par de trabajo (pair)
├── backend/                    # Django
│   ├── manage.py
│   ├── config/                 # settings, urls
│   ├── scenes/                 # modelos ROI y Scene
│   └── analyses/               # modelo ChangeResult
└── web/                        # React + MapLibre (Explorador, Comparador, Laboratorio, Exportación)
```

**Regla de arquitectura:** `pipeline/` no depende de Django. Django solo lo llama (idealmente desde tareas Celery). Así el procesamiento SAR se prueba desde la terminal sin levantar el servidor.

Desde la raíz del repo: `python -m pipeline.catalog` (consulta del catálogo), `python -m pipeline.download <scene_id> ...` (recorte a la ROI) y `pytest` (pruebas).

### Modelos base

- `ROI`: nombre, `geom` (PolygonField, SRID 4326).
- `Scene`: nombre (único), producto, trayectoria, marco, dirección, polarización, CRID, fecha, `footprint`.
- `ChangeResult`: ROI, escena t1, escena t2, parámetros (JSON), métricas (JSON), ruta del archivo, fecha de creación.

## 9. Comandos habituales (Windows, Anaconda/Miniforge Prompt)

```
conda activate nisar
docker compose up -d                       # PostGIS
cd backend
python manage.py makemigrations scenes analyses
python manage.py migrate
python manage.py runserver
```

Recorte a la ROI (la autenticación Earthdata va en `%USERPROFILE%\.netrc`; en Windows el pipeline lo usa aunque earthaccess busque `_netrc`):

```
python -m pipeline.catalog                                # actualiza data/catalog/
python -m pipeline.download <scene_id_t1> <scene_id_t2>   # recorta, verifica y compara el par
python -m pipeline.download <scene_id> --capas HHHH mask  # solo algunas capas
python -m pipeline.download <scene_id> --h5-local "ruta\archivo.h5"   # desde un .h5 ya descargado
python -m pipeline.etapa1 <scene_id> --escala-web -22 0  # inspección remota + capas web (misma escala en ambas fechas)
python -m pipeline.change                                 # mapa de cambio del par de config.yaml (--multilook, --umbral, --magnitud)
```

Escribe `data/raw/<scene_id>/<capa>.tif` + `scene.json` (contrato C1) e imprime si el par es `COMPARABLE`. Usa solo **Frequency A** (banda L). El fragmento `gdalwarp` que genera ASF Vertex **no funciona** con el GDAL del entorno (3.12, sin drivers HDF5/NISAR).

## 10. Plan de trabajo (orden obligatorio)

1. ✅ Verificar entorno (`gdalinfo --version`, imports) y que PostGIS corra.
2. ✅ Crear `.netrc` y probar un recorte.
3. ✅ Correr `pipeline/catalog.py` y **confirmar un par comparable** sobre la ROI (T62/F10, 2026-11-14).
4. ✅ Descargar el mismo recorte de ambas fechas a `data/raw/`.
5. ✅ `preprocess.py` y `change.py`: dB, diferencia, z-score, GeoTIFF de cambio con metadatos (2026-11-18; falta máscara de sombra/layover/pendiente).
6. `validate.py` con una fuente auxiliar pertinente (candidatas en `docs/metodologia.md`; depende del fenómeno).
7. Cargar escenas y resultado en Django; endpoints DRF (`/api/scenes`, `/api/changes`).
8. Frontend (MapLibre: ROI, deslizador antes/después, capa de diferencias, panel de métricas).
9. ~~Asistente IA restringido a evidencia.~~ Fuera de alcance por ahora (ver §7).
10. Documentación, pruebas y publicación del repositorio.

**Alcance mínimo viable:** región con datos NISAR; al menos dos observaciones comparables; metadatos y visualización de cada una; una métrica de cambio calculada y representada; explicación de qué significa y qué no; contraste con al menos una fuente auxiliar; exportación de una figura o reporte reproducible.

## 11. Convenciones para agentes

- Responder y documentar en **español**; nombres de código en inglés o español, pero consistentes.
- Hacer cambios pequeños y verificables. Explicar qué se cambió y por qué.
- Cada resultado del pipeline guarda un JSON con escenas usadas, fechas, parámetros y versión del código.
- Escribir pruebas (`pytest`) para `compat.py`, conversión a dB y métricas de validación.
- Si falta un dato o una decisión, **preguntar** en lugar de suponer.
- No introducir dependencias pesadas sin justificarlo.

## 12. Seguridad

- **Nunca** escribir en el repo ni en la salida credenciales de Earthdata, `.netrc`, tokens o contraseñas. Están en `.gitignore`.
- Credenciales de Earthdata: `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` en `.env` o como variables del sistema (tienen prioridad sobre `.netrc`). En el servidor, como variables del hosting, no en un archivo dentro de la imagen.
- `.env` y `data/` no se suben a git.
- Las credenciales de la base de datos en `docker-compose.yml` son solo para desarrollo local; en producción usar variables de entorno.
- Respetar licencias y condiciones de acceso de los datos NISAR al exportar o publicar.

## 13. Referencias

- NISAR: https://nisar.jpl.nasa.gov/
- ASF Data Search (Vertex): https://search.asf.alaska.edu/
- Documentación NISAR (ASF): https://nisar-docs.asf.alaska.edu/
- Productos: https://nisar-docs.asf.alaska.edu/products-overview/
- Disponibilidad: https://nisar-docs.asf.alaska.edu/availability-overview/
- ISCE3: https://github.com/isce-framework/isce3
- HyP3: https://hyp3-docs.asf.alaska.edu/
- OpenSARLab: https://asf.alaska.edu/asf-services-opensarlab/
- Earthdata Search: https://search.earthdata.nasa.gov/ (también GPM IMERG, HLS y OPERA)
- Perfil de Earthdata (autorizar aplicaciones como GES DISC): https://urs.earthdata.nasa.gov/
- Reto Space Apps 2026: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/