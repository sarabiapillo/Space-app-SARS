# Proveedor NASADEM para Python

`pipeline/elevation/nasadem.py` obtiene los ZIP **originales** `NASADEM_HGT`, versión `001`, para una ROI geográfica. No genera GeoTIFF, DEM preparado, mosaicos ni resultados solares. `pipeline/solar/nasadem.py` conserva la importación anterior por compatibilidad; el código nuevo debe importar desde `pipeline.elevation.nasadem`.

## Uso

Desde la raíz del repositorio, con el entorno `nisar` activado y credenciales Earthdata disponibles en el proceso:

```python
from pathlib import Path
from pipeline.elevation.nasadem import NASADEMProvider

# EPSG:4326: oeste, sur, este, norte; también acepta Polygon/MultiPolygon GeoJSON.
roi = (-93.3919, 16.6539, -92.8757, 16.8964)
provider = NASADEMProvider(cache_dir=Path("data/raw/dem/nasadem_hgt/001"))
files = provider.acquire_roi(roi)
for item in files:
    print(item.tile_id, item.granule_ur, item.path)
    # Otro módulo puede abrir item.path como ZIP, sin depender de pipeline.solar.
```

`acquire_roi` valida la geometría, calcula el bounding box si recibe GeoJSON, enumera teselas por intersección de área positiva con la ROI, busca una coincidencia CMR única por tesela, descarga las faltantes y devuelve una `tuple[NASADEMGranule, ...]`. Cada registro inmutable contiene `tile_id` (por ejemplo `n16w094`), `granule_ur` (`NASADEM_HGT_<tile_id>`), `short_name` (`NASADEM_HGT`), `version` (`001`) y `path` (`pathlib.Path` al ZIP original). El orden es estable por latitud y longitud. Un límite de grado exacto no requiere la tesela contigua si el polígono no ocupa área dentro de ella. Para una ROI dispersa solo se buscan las teselas intersectadas, no cada tesela del rectángulo envolvente.

Para buscar sin descargar, `provider.search_roi(roi)` devuelve los resultados CMR crudos, uno por tesela requerida; **no** gestiona automáticamente autenticación en ese método. Para obtener archivos sin conocer la búsqueda ni la autenticación, usar `acquire_roi`. La interfaz heredada `provider.search(bbox_de_una_tesela)` / `provider.acquire([un_resultado_cmr])` permanece para los consumidores solares; `acquire` devuelve una sola `Path`, no la colección de `acquire_roi`.

## Entorno y credenciales

`environment.yml` ya incluye Python 3.11, `earthaccess==0.17.0` y `geopandas` (que instala Shapely); los tests requieren `pytest`. No se añadieron dependencias. Para una búsqueda/descarga nueva, `acquire_roi` intenta `earthaccess.login(strategy="environment", persist=False)` y luego `strategy="netrc"`, sin solicitar entrada interactiva ni persistir secretos. Configurá **en tu entorno local**, nunca en Git, `EARTHDATA_TOKEN` o el par `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD`; alternativamente usá un `.netrc` privado de Earthdata. No hace falta ninguna variable específica de TerraPulse para el proveedor. Una caché completa y corroborada puede reutilizarse sin credenciales ni red.

## Cobertura, errores y garantías

- Acepta bbox `(west, south, east, north)` con números finitos y ordenados o GeoJSON `Polygon`/`MultiPolygon` en EPSG:4326, válido y de área positiva. Cobertura admitida: latitudes de `-56` a `60` y longitudes de `-180` a `180` grados. No admite bbox invertido para envolver el antimeridiano; no interpreta coordenadas GeoJSON como un envoltorio antimeridiano. No reinterpreta CRS distintos. Un resultado CMR ausente o ambiguo para cualquier tesela detiene la adquisición, sin presentar cobertura completa.
- La falta de credenciales produce un `RuntimeError` con instrucciones de configuración; fallas de búsqueda o descarga se expresan como `RuntimeError` sin incluir texto de excepción que pudiera contener secretos. ROI inválida, cobertura sin granular, ZIP parcial/incorrecto y recibos inconsistentes producen `ValueError`. Si la operación falla después de descargar una tesela anterior, esa tesela válida puede quedar en caché: **no hay transacción de lote**. Repetir la llamada tras resolver la causa recupera las faltantes.
- Se verifica que cada ZIP contenga exactamente un HGT de 3601×3601 muestras de 16 bits, con nombre coincidente con la tesela y CRC legible; se comprueba nombre de ZIP devuelto, `GranuleUR`, colección y versión CMR. La descarga se hace en staging bajo la caché y se publica sin sobrescribir el destino. Un ZIP preexistente sin recibo necesita una búsqueda CMR inicial; al confirmar la identidad nominal se guarda un recibo local de colección/UR/versión y hash SHA-256 del HGT. Un acierto posterior valida recibo y HGT sin red. Si ZIP o recibo están corruptos se detiene sin sobrescribirlos: el responsable de la caché debe investigar antes de retirar archivos propios.
- **Límite de confianza:** el recibo comprueba consistencia de metadatos CMR y bytes locales, **no** autenticidad criptográfica de los bytes ante NASA. No presentar archivos preexistentes arbitrarios como datos científicamente autenticados por un checksum oficial. Tampoco se verificó aquí una nueva descarga real; la prueba real de `n16w094` fue informada anteriormente por el equipo.
- **Concurrencia:** usar una caché local exclusiva para **un solo proceso**. Hay bloqueo entre hilos, no coordinación multiproceso ni garantías de múltiples workers, Windows o sistemas de archivos compartidos. No escribir concurrentemente en el directorio de caché desde otra aplicación. El proveedor rechaza rutas de descarga fuera de staging y enlaces simbólicos en el destino y componentes de la caché. L2/L3, checksum remoto, endurecimiento multiproceso/Windows y rendimiento de ROI extensas quedan pendientes; no bloquean este uso acotado.

## Comprobaciones y entrega al equipo

En esta unidad, con Earthdata simulado y ZIP HGT sintéticos: `pytest -q pipeline/tests/test_elevation_nasadem.py pipeline/tests/test_solar_nasadem.py pipeline/tests/test_solar_acquire.py` → **45 aprobadas**, 8 advertencias; `pytest -q` → **171 aprobadas**, 182 advertencias; códigos de salida 0. La revisión independiente repitió ambos comandos. No hubo búsqueda ni descarga de red en esas pruebas. La disponibilidad de granulares y la autenticación del entorno de cada compañero se confirman al ejecutar el ejemplo con credenciales propias.

Para integrarlo, activá el entorno `nisar`, proporcioná credenciales Earthdata privadas, importá `NASADEMProvider` desde `pipeline.elevation.nasadem`, pasá tu ROI EPSG:4326 y consumí `item.path`. Si surge una ROI sin granular, informá la falta de cobertura en vez de generar elevaciones ficticias. Para compartir mediante Git: limitá el cambio a `pipeline/elevation/`, la fachada `pipeline/solar/nasadem.py`, `pipeline/tests/test_elevation_nasadem.py`, `docs/nasadem-provider.md` y `docs/features/nasadem-provider.tex`. Los archivos solares no rastreados corresponden a otro cambio. Nunca incluyas `data/`, `.env` ni `.netrc`.
