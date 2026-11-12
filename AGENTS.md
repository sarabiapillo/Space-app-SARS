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
- PostGIS definido en `docker-compose.yml` (por verificar que corra).
- Exploración de datos en ASF Vertex en curso. Aún **no** hay un par de escenas comparables confirmado ni un mapa de cambio real.

**Lo más importante que falta:** confirmar que existen al menos dos escenas NISAR comparables sobre la ROI. Todo lo demás depende de eso.

## 4. Caso de estudio

- **Región:** Chiapas, México.
- **ROI (WKT, EPSG:4326):**
  ```
  POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))
  ```
- **Fenómeno:** por decidir entre inundación, humedales, vegetación o deformación, según disponibilidad de datos y posibilidad de validación independiente. Se elige el que permita un resultado medible, no el más espectacular.
- **Criterios de selección:** disponibilidad NISAR, calidad y consistencia, relevancia local, validación independiente posible y claridad de comunicación.

### Escenas vistas hasta ahora en ASF Vertex (para orientar, no son definitivas)

| Producto | Trayectoria | Marco | Dirección | Fecha | Nota |
|---|---|---|---|---|---|
| GSLC (L-band, HH+HV) | 62 | 10 | ASCENDING | 2026-10-28 | CRID P05036, ~22.5 GB, complejo (CFloat32) |
| GCOV (L-band, HH+HV) | 62 | — | — | 2026-10-28 | Existe; verificar tamaño y marco |
| GCOV (L-band, HH+HV) | 55 | 80 | DESCENDING | 2026-10-16 y 2026-10-28 | Posible par comparable; verificar CRID de ambas |
| GUNW | — | — | — | 2026-10-04 | Interferograma, solo si el caso fuera deformación |

Un agente debe **verificar estos datos en el catálogo** antes de usarlos. Pueden estar incompletos o cambiar.

## 5. Reglas de datos NISAR

- Fuente central: productos públicos NISAR vía ASF (https://search.asf.alaska.edu/) y NASA Earthdata. Documentación: https://nisar-docs.asf.alaska.edu/
- **Preferir GCOV** para retrodispersión (σ⁰/γ⁰) y mapas de cambio. GSLC es complejo y requiere calcular `10*log10(|z|²)`. GUNW solo para deformación (desplazamiento en línea de vista, no vertical).
- **No procesar datos crudos (L0, RRSD).**
- **Comparabilidad.** Dos escenas solo se comparan si coinciden en: producto, trayectoria, marco, dirección de vuelo, polarización, resolución, versión de procesamiento (CRID) y nivel de madurez. **No mezclar BETA con PROVISIONAL.**
- **No asumir polarizaciones.** Leer de los metadatos y del nombre del producto qué polarizaciones tiene cada escena.
- Los productos L-band PROVISIONAL (desde 2026-06-17) están calibrados y parcialmente validados; no describirlos como completamente validados.
- Los PNG de "Visualizaciones" son solo para inspección visual. **Nunca calcular diferencias sobre ellos.**
- No descargar escenas completas (~22 GB). Recortar a la ROI con `gdalwarp` (ver sección 8).
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

El LLM **no** mide, **no** clasifica imágenes por intuición y **no** inventa causas.

1. El usuario hace una pregunta sobre una región o resultado.
2. El backend consulta métricas calculadas, metadatos y documentación.
3. Se arma un contexto estructurado (JSON) con valores, unidades, fechas y fuentes.
4. El modelo redacta una explicación **limitada a ese contexto**.
5. La interfaz muestra las mediciones originales y advertencias junto a la explicación.

Si no hay datos suficientes, el sistema responde que no puede concluir. Cada afirmación cuantitativa debe rastrearse a un resultado reproducible. Esta parte se implementa **al final**.

## 8. Stack y estructura

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
│   ├── catalog.py              # consulta con asf_search
│   ├── download.py             # recorte GDAL a la ROI
│   ├── preprocess.py           # complejo -> dB, máscaras
│   ├── compat.py               # control de comparabilidad
│   ├── change.py               # Δσ⁰, z-score, umbral
│   ├── validate.py             # precisión, recall, F1, IoU
│   └── config.yaml             # ROI, fechas, trayectoria, polarización, madurez
├── backend/                    # Django
│   ├── manage.py
│   ├── config/                 # settings, urls
│   ├── scenes/                 # modelos ROI y Scene
│   └── analyses/               # modelo ChangeResult
└── web/                        # React + MapLibre (Explorador, Comparador, Laboratorio, Exportación)
```

**Regla de arquitectura:** `pipeline/` no depende de Django. Django solo lo llama (idealmente desde tareas Celery). Así el procesamiento SAR se prueba desde la terminal sin levantar el servidor.

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

Recorte remoto con GDAL (la autenticación Earthdata va en `%USERPROFILE%\.netrc`):

```
gdalwarp HDF5:"/vsicurl/<URL_H5>"://science/LSAR/<PRODUCTO>/grids/frequencyA/HH ^
  -of GTiff salida.tif ^
  -cutline "<WKT_ROI>" -cutline_srs WGS84 -crop_to_cutline -dstalpha ^
  --config GDAL_HTTP_NETRC YES ^
  --config GDAL_HTTP_COOKIEFILE %TEMP%/gdal_cookies.txt ^
  --config GDAL_HTTP_COOKIEJAR %TEMP%/gdal_cookies.txt
```

El fragmento completo (con todas las opciones de rendimiento) se genera desde el ícono de recorte en ASF Vertex. Usar solo **Frequency A** (banda L).

## 10. Plan de trabajo (orden obligatorio)

1. Verificar entorno (`gdalinfo --version`, imports) y que PostGIS corra.
2. Crear `.netrc` y probar un recorte HH.
3. Correr `pipeline/catalog.py` y **confirmar un par comparable** sobre la ROI.
4. Descargar el mismo recorte de ambas fechas a `data/raw/`.
5. `preprocess.py` y `change.py`: dB, diferencia, z-score, GeoTIFF de cambio con metadatos.
6. `validate.py` con una fuente auxiliar pertinente.
7. Cargar escenas y resultado en Django; endpoints DRF (`/api/scenes`, `/api/changes`).
8. Frontend (MapLibre: ROI, deslizador antes/después, capa de diferencias, panel de métricas).
9. Asistente IA restringido a evidencia.
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
- Earthdata Search: https://search.earthdata.nasa.gov/
- Reto Space Apps 2026: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/