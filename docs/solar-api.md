# Consumir el simulador solar: API de fases D/E

La única capa disponible es **irradiancia solar directa incidente**, en W/m². No mide radiación real ni temperatura: usa NASADEM, SPA y DNI de cielo despejado climatológico. No hay absorción/reflexión/transmisión de materiales.

## Arranque local

Desde la raíz del repositorio, en el entorno Python del proyecto:

```bash
# Si faltan dependencias solares, aislarlas sin cambiar el entorno compartido:
python -m pip install --no-deps --target data/solar-pvlib-deps -r pipeline/solar/requirements.txt
# Versiones HTTP verificadas: Django 5.2.19 y DRF 3.18.3.
# El entorno debe tener Django, DRF, Rasterio/GDAL, pyproj, shapely,
# numpy, pandas, scipy, h5py, earthaccess, matplotlib y Pillow.
export PYTHONPATH="$PWD/data/solar-pvlib-deps:$PWD:$PWD/backend"
python backend/manage.py runserver --noreload 127.0.0.1:8000
```

La configuración normal de Django conserva `.env` (ver `.env.example`) y sus dependencias; nunca publicar sus valores. La API solar no usa tablas ni requiere migraciones propias. El proveedor puede reutilizar ZIP válidos de la caché; si faltan necesita autenticación Earthdata no interactiva configurada fuera del repositorio. No enviar credenciales Earthdata al frontend ni en el POST.

**Ejecutar un único proceso local**, sin servidores multiproceso ni adquisiciones externas concurrentes sobre la misma caché. Se serializa el cálculo y una petición concurrente se rechaza, no se encola. La implementación usa un bloqueo de archivos POSIX: Windows y despliegue distribuido no están habilitados.

## POST: ejecutar una simulación

Ruta exacta sin barra final: `POST /api/solar/simulations`.

```bash
curl -i http://127.0.0.1:8000/api/solar/simulations \
  -H 'Content-Type: application/json' \
  --data '{
    "roi": {
      "type": "Polygon",
      "coordinates": [[[-93.56,16.74],[-93.54,16.74],[-93.54,16.76],[-93.56,16.76],[-93.56,16.74]]]
    },
    "datetime_local": "2026-11-15T12:00:00",
    "timezone": "America/Mexico_City",
    "intensity_percent": 50,
    "temperature_c": 12
  }'
```

Este GeoJSON es una **petición de ejemplo**, no una medición o resultado precalculado. La presión opcional se envía como `pressure_hpa`; si falta se estima con atmósfera estándar desde la altitud representativa NASADEM. La temperatura omitida usa 12 °C. Los números deben ser JSON numéricos finitos, no cadenas ni booleanos. La fecha local exige segundos y **no** acepta offset; la zona IANA resuelve el instante. Horas DST ambiguas/inexistentes se rechazan. No se aceptan `roi_id`, albedo, ángulos solares, irradiancia manual, paleta ni rutas a disco.

Una simulación completa devuelve `201 Created`, encabezado `Location`, identificador opaco y `status: ready`; no hay `202` ni trabajos ficticios. `position` y `clear_sky` contienen los valores efectivos, métodos, fuentes y supuestos de esa corrida. `raster` describe el TIFF numérico. `preview` describe la imagen final EPSG:4326 y su escala. `layers.incident.preview_url`, `layers.incident.export_url` y `sample_url` son rutas relativas al mismo servidor.

## Respuesta observada de extremo a extremo

Se ejecutó el POST anterior mediante **HTTP WSGI real en loopback**, usando el ZIP NASADEM local de `n16w094`. Solo la adquisición fue sustituida por el granular local para impedir red; el resto del pipeline, exportación, vistas y muestreo fue real. Se obtuvieron **201, 200, 200, 200 y 200** para POST, detalle, PNG, TIFF y sample. No es una medición de campo ni una prueba de autenticación Earthdata. El ID siguiente es el observado localmente, no estará disponible en otro servidor.

Extracto de la respuesta real (se omiten campos adicionales, no se alteran cifras):

```json
{
  "id": "8e1a075f7712435bab9a0292d8eb36c0",
  "status": "ready",
  "units": "W/m2",
  "night": false,
  "position": {
    "datetime_utc": "2026-11-15T18:00:00+00:00",
    "apparent_elevation_deg": 54.63962031088027,
    "altitude_m": 782.1372680664062,
    "altitude_datum": "EGM96",
    "pressure_hpa": 922.7514462351598,
    "temperature_c": 12.0
  },
  "clear_sky": {
    "dni_clear_sky_w_m2": 885.3905049756529,
    "dni_adjusted_w_m2": 442.69525248782645,
    "intensity_percent": 50.0,
    "linke_turbidity": 3.85
  },
  "raster": {
    "crs": "EPSG:32615", "width": 72, "height": 74,
    "resolution_m": [30.92222222222222, 30.92222222222222],
    "units": "W/m2", "valid_pixels": 4968
  },
  "preview": {
    "crs": "EPSG:4326", "width": 74, "height": 73,
    "bounds_lonlat": [-93.56034941688789,16.739547709324466,-93.53927810823552,16.760334270562613],
    "palette": "inferno", "range_w_m2": [0.0,442.69525248782645], "zero_range": false
  },
  "layers": {
    "incident": {
      "preview_url": "/api/solar/simulations/8e1a075f7712435bab9a0292d8eb36c0/preview/incident",
      "export_url": "/api/solar/simulations/8e1a075f7712435bab9a0292d8eb36c0/export/incident"
    }
  },
  "sample_url": "/api/solar/simulations/8e1a075f7712435bab9a0292d8eb36c0/sample"
}
```

Para `sample?lon=-93.55&lat=16.75`, se observó:

```json
{"value_w_m2":400.95941162109375,"status":"valid"}
```

El manifiesto además conserva `request` (incluida ROI y parámetros efectivos), `transform_gdal`, bounds nativos, versión/huella del código, métodos y hashes de productos. La presión automática y su procedencia están disponibles tanto en POST como al consultar GET después de la publicación.

## Consultas y archivos

| Método/ruta | Resultado |
|---|---|
| `GET /api/solar/simulations/{id}` | Metadatos y enlaces de la corrida |
| `GET /api/solar/simulations/{id}/preview/incident` | `image/png`, Inferno RGBA |
| `GET /api/solar/simulations/{id}/export/incident` | `image/tiff`, Float32 numérico |
| `GET /api/solar/simulations/{id}/sample?lon=-93.55&lat=16.75` | Valor real del píxel TIFF en W/m² |

`sample` utiliza WGS84 (orden **longitud, latitud**) y transforma al CRS nativo del GeoTIFF. Devuelve `status: valid` con `value_w_m2` numérico (incluido 0), o `outside_coverage` / `nodata` con `value_w_m2: null`. No extrae valores del PNG ni interpola un valor físico más preciso que el píxel.

## Superponer el PNG y representar la leyenda

`preview.bounds_lonlat` tiene orden `[west, south, east, north]`, deducido de **la grilla PNG final**. Para un ImageSource, las esquinas son:

```javascript
[[west, north], [east, north], [east, south], [west, south]]
```

Esta documentación no modifica el frontend. Conservar juntos PNG, bounds, escala e identificador de corrida. El PNG por sí solo no contiene CRS. La escala está en `preview.range_w_m2: [0, DNI_ajustada]`; Inferno representa `clip(G_i / DNI_ajustada, 0, 1)`. Si `zero_range: true`, usar una leyenda **0 W/m²**, sin dividir entre cero. Cero válido es opaco; NoData es transparente. Los valores numéricos se consultan en `sample` o en el TIFF.

## Límites y seguridad del MVP

- ROI válida Polygon/MultiPolygon, en la cobertura NASADEM, con máximo de 1.000 vértices y dos teselas fuente.
- Caja envolvente de hasta 0,25° por eje, diámetro diagonal geodésico máximo de 30 km y estimación de hasta 500.000 píxeles (antes 0,2°, 10 km y 150.000). Se ampliaron el 2026-11-15 para permitir radios de hasta 10 km desde el panel, con medidas reales en Windows (NASADEM 30 m, centro −93.115, 16.76, 2026-06-21 10:00): radio 2 km → 131×132 px, 3 s; 5 km → 324×326 px, 13 s; 10 km → 646×650 px, 61 s y pico de ~92 MB. Estos son **presupuestos operativos**, no una garantía de uniformidad solar o validación física.
- **Windows:** el candado entre procesos usa `fcntl.flock` en Linux y `msvcrt.locking` en Windows (`backend/solar/services.py`), así que la API también corre en desarrollo local con Windows.

### Mapa de calor en la interfaz (2026-11-15)

El panel **Simulador Solar & Radiación** (`web/src/components/RightPanel.tsx`, `web/src/utils/solarHeatmap.ts`):

- **Radio de cálculo:** 1, 2, 3, 5, 7,5 o 10 km alrededor del centro de la zona (caja cuadrada con conversión grados↔km según la latitud).
- **Escala:** el PNG del backend se normaliza entre 0 y el DNI ajustado. En zonas pequeñas los valores quedan en una franja estrecha (p. ej. 398–450 de 0–500 W/m² con radio 2 km) y casi no se distinguen. El navegador invierte la LUT Inferno de 256 colores (idéntica a la de matplotlib) para recuperar W/m² de cada píxel (±DNI/512, ~1 W/m²) y vuelve a colorear con dos modos: **Contraste** (p2–p98 de esa simulación) y **Absoluta** (0–DNI, comparable entre horas). La leyenda muestra marcas en W/m² y la imagen se amplía con interpolación suave.
- **Tablero:** radiación elegida, DNI de cielo despejado y ajustado, zona (radio y km²) e irradiancia incidente mínima, máxima, mediana y media. Si se cambia la radiación después de calcular, avisa que hay que recalcular.
- **Mapa:** opacidad fija (0,88) y remuestreo lineal; antes la opacidad dependía del deslizador de radiación y una radiación baja casi no se veía.
- **Verificado:** con radio 5 km, los valores recuperados del PNG (p2 294, mediana 423, p98 479 W/m²) coinciden con los de `incident.tif` (293, 423, 480). Pruebas: `web/tests/solarHeatmap.test.mjs`.
- No se permiten rutas, nombres de archivo, capas adicionales ni identificadores elegidos por el cliente. Los UUID opacos se resuelven solo bajo la raíz de almacenamiento de la API; los symlinks se rechazan.
- Publicación íntegra de TIFF + PNG + manifiesto antes de responder `ready`; sin corridas parciales visibles.
- **API pública de hackatón, sin autenticación ni permisos por usuario.** Conocer un ID permite consultar la corrida. Los IDs no son un sistema de autorización para información privada. Para Internet se necesitan autenticación, HTTPS, cuotas, limitación de peticiones, proxy con límites/timeout y política de retención.
- No hay CORS abierto automático: usar el mismo origen o un proxy de desarrollo del frontend. No desactivar protecciones del servidor para resolver integraciones.
- No hay cola durable, timeout duro de cálculo o recuperación distribuida. Las corridas consumen disco hasta que el operador aplique una política de conservación; no hay borrado arbitrario mediante la API.

## Errores y configuración

| HTTP | Situación | Respuesta JSON |
|---|---|---|
| 400 | Parámetros, ROI, fecha o zona inválidos | `error` y `code: invalid_request` |
| 400 | Coordenadas de sample o JSON malformados | detalle de validación (`detail` o lista de errores DRF) |
| 404 | Corrida/archivo inexistente | `detail` de recurso no encontrado |
| 404 | ID malformado, ruta o capa no admitida | `error` y `code: not_found` |
| 413 | Presupuesto ROI excedido | `detail` explicativo |
| 429 | Otra ejecución ocupa el bloqueo | `detail` explicativo |
| 503 | Proveedor, almacenamiento o cálculo no disponible | `detail` saneado, sin rutas ni credenciales |

`Content-Type` de POST debe ser `application/json` (otros tipos reciben 415); un método no permitido recibe 405. No reintentar automáticamente un POST después de un fallo de red ambiguo: pudo haber terminado la corrida, y este MVP no tiene clave de idempotencia.

Configurar `SOLAR_OUTPUT_ROOT` (por defecto `data/solar-runs`) y `SOLAR_NASADEM_CACHE` (por defecto `data/nasadem-cache`) con rutas del servidor, nunca desde la petición. Para reutilizar una caché existente, señalar su directorio que contiene los ZIP y recibos del proveedor. Ejemplo: `export SOLAR_NASADEM_CACHE="$PWD/data/raw/dem/nasadem_hgt/001"`. Las raíces no deben contener symlinks. No compartir la misma caché entre aplicaciones con raíces de bloqueo distintas ni con adquisiciones externas concurrentes. El código identifica las fuentes por tesela; no afirma hashes de HGT calculados por la API ni autenticidad criptográfica de bytes remotos.

## Comprobaciones

```bash
PYTHONPATH=data/solar-pvlib-deps:backend pytest -q pipeline/tests/test_solar_delivery.py pipeline/tests/test_solar_api.py
PYTHONPATH=data/solar-pvlib-deps:backend pytest -q pipeline/tests
```

Las pruebas usan estado aislado y entradas sintéticas; no requieren descargas Earthdata. **Resultados finales observados:** 16 pruebas D/E aprobadas (108 advertencias) y 267 de la suite disponible aprobadas (1.545 advertencias), ambas salida 0. Incluyen regresiones RED → GREEN para exportación vacía, ausencia inicial de rutas, persistencia de ROI en GET, geometría mal anidada (400 JSON sin proveedor ni artefactos) y procedencia correcta de la temperatura predeterminada. El verificador independiente de D/E reprodujo 16/267; detectó el error geométrico y confirmó su cierre mediante recheck focalizado. La corrección posterior de procedencia de temperatura se comprobó en la suite final del padre, no se atribuye al verificador previo. El control Django de URLs pasó sin problemas. LaTeX: estructura revisada, PDF no compilado porque no hay compilador instalado. El riesgo de verificación pendiente de fase C se mantiene registrado por instrucción del usuario y no se repite ni bloquea D/E.
