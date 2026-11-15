# API de preparación y ejecución DG2 sintética

`prepare/` **solo valida** lluvia y ROI; conserva su respuesta original sin ejecutar ni crear resultados. Separadamente, `start/` ejecuta únicamente casos sintéticos preparados y registrados por el operador. La [nueva API por ROI](api-simulacion-roi.md) admite ejecución solicitada por ROI con DEM y lluvia explícitos, sin caso registrado, en un worker separado. No hay casos registrados por defecto ni precisión hidráulica validada. El frontend nunca debe convertir la respuesta de preparación en autorización para correr DG2.

## Solicitud

`POST /api/flood-scenarios/prepare/` con `Content-Type: application/json`. El cuerpo tradicional acepta `rainfall` y `roi`; el contrato completo de solicitud y respuesta de ese caso, mostrado abajo, permanece sin cambios. Solo se genera un perfil si se añade expresamente `rainfall_profile`.

```json
{
  "rainfall": {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"},
  "roi": {"type": "Polygon", "coordinates": [[[-93.1, 16.6], [-93.0, 16.6], [-93.0, 16.7], [-93.1, 16.7], [-93.1, 16.6]]]}
}
```

La lluvia hipotética admite exactamente uno de estos modos:

| Modo | Campos y unidades | Significado |
|---|---|---|
| Cantidad y duración | `amount` ≥ 0, `unit: "mm"`; además `duration` > 0 y `duration_unit: "s"`, `"min"` o `"h"` | Cantidad de agua expresada como altura de lámina sobre un área horizontal, acumulada durante ese intervalo. |
| Intensidad y duración | `intensity` ≥ 0 con `intensity_unit: "mm/h"`, `"mm/min"` o `"mm/s"`; `duration` > 0 con `duration_unit: "s"`, `"min"` o `"h"` | Calcula la cantidad equivalente en metros y conserva la intensidad media en m/s. |

Se requieren números JSON finitos (no booleanos ni cadenas). Las conversiones y valores derivados fuera de rango o con subdesbordamiento se rechazan. Ambas formas requieren duración: en el modo cantidad, `amount_m / duration_s` es solo la intensidad media del intervalo. No describe distribución temporal ni espacial (ni implica lluvia uniforme) y no constituye por sí solo forzamiento hidráulico o resultado. No se requiere lluvia histórica ni pronóstico.

`roi` es un GeoJSON `Polygon` 2D en EPSG:4326: posiciones `[longitud, latitud]`, rangos geográficos válidos, anillos cerrados, área positiva y polígono válido. GeoJSON usa WGS 84 (EPSG:4326) por contrato; no se acepta un campo CRS alternativo. Regiones globales son admisibles; cruces ambiguos del antimeridiano se rechazan. No se impone a la ROI una cobertura arbitraria de proveedor. La ROI no define por sí sola el dominio hidráulico, que puede requerir extensión aguas arriba/abajo; tanto ROI como dominio deben comprobarse como no urbanos. La geometría válida no implica DEM disponible ni elegibilidad.

## Respuesta y errores

Una solicitud válida devuelve `200`; por ejemplo, para intensidad:

```json
{
  "rainfall": {
    "mode": "intensity_duration",
    "input": {"intensity": 36, "intensity_unit": "mm/h", "duration": 2, "duration_unit": "h"},
    "amount_m": 0.072,
    "duration_s": 7200.0,
    "mean_intensity_m_s": 9.999999999999999e-06
  },
  "roi": {"type": "Polygon", "coordinates": [[[-93.1, 16.6], [-93.0, 16.6], [-93.0, 16.7], [-93.1, 16.7], [-93.1, 16.6]]]},
  "can_simulate": false,
  "layers": [],
  "dem": {"status": "acquisition_not_requested", "provider_available": true},
  "blockers": [
    "No hay ejecutable DG2 verificado (versión, formatos y opciones pendientes).",
    "Condiciones iniciales y nivel de agua pendientes.",
    "Fronteras y criterios científicos pendientes.",
    "Elegibilidad no urbana de la ROI y del dominio hidráulico pendiente.",
    "Distribución espacial y temporal de la lluvia pendiente; la intensidad media derivada no la define.",
    "Infiltración no especificada ni supuesta.",
    "El DEM no se ha adquirido ni preparado como insumo hidráulico."
  ]
}
```

La respuesta completa incluye todos los bloqueos vigentes: solver sin verificar; nivel inicial/condiciones de agua; fronteras y criterios científicos; elegibilidad no urbana; distribución espacial y temporal de lluvia; infiltración sin especificar; y DEM sin adquirir ni preparar. `dem.provider_available` indica únicamente que existe una interfaz local de proveedor; **no** afirma cobertura ni disponibilidad de datos y no significa que se hayan obtenido. `layers` permanece vacío. No se crean trabajos, IDs, registros ni contadores.

Entrada inválida devuelve `400` con forma estable `{"errors": {"campo": ["mensaje"]}}`. Ejemplo exacto de campos requeridos faltantes (por ejemplo, duración):

```json
{"errors": {"rainfall": ["Campos de lluvia desconocidos o faltantes."]}}
```

Por ejemplo, ese error se devuelve si falta duración o su unidad. Una unidad incorrecta produce `{"errors": {"rainfall": ["Unidad no admitida; use mm."]}}`.

### Perfil temporal opcional

Para solicitar la variación temporal sintética, añada un objeto `rainfall_profile` con exactamente estos tres campos. No se elige ni muestrea ningún conteo o semilla por omisión:

```json
{
  "rainfall": {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"},
  "roi": {"type": "Polygon", "coordinates": [[[-93.1, 16.6], [-93.0, 16.6], [-93.0, 16.7], [-93.1, 16.7], [-93.1, 16.6]]]},
  "rainfall_profile": {"interval_count": 8, "seed": 27, "distribution": "uniform_balanced"}
}
```

`interval_count` debe ser un entero par entre 2 y 10 000; `seed`, un entero; y la única ley disponible es `uniform_balanced`. La respuesta conserva los campos anteriores y añade `rainfall_profile` con `rainfall` normalizada, `roi`, `segments` (`start_s`, `end_s`, `intensity_m_s`), `distribution` (nombre, semilla, conteo y límites solicitados/efectivos), `synthetic: true` y `hydraulic_ready: false`. Los segmentos cubren el intervalo solicitado; el ejemplo produce ocho intensidades no negativas entre 0 y 12 mm/h: como la media es 6 mm/h, el límite efectivo se reduce a ±6 mm/h para evitar intensidades negativas (aunque el límite solicitado siga siendo ±10 mm/h). Su integral conserva los 12 mm prescritos salvo redondeo de coma flotante.

Cada segmento de la respuesta tiene la forma `{"start_s": <segundos>, "end_s": <segundos>, "intensity_m_s": <metros por segundo>}`. Para la solicitud de ejemplo, la lluvia normalizada contiene `amount_m: 0.012` y `duration_s: 7200.0`; la media es 6 mm/h y el límite solicitado es 10 mm/h. El perfil concreto se genera con la semilla y el conteo enviados; no se fija una muestra global.

Grafique la serie `intensity_m_s` frente a los tiempos `start_s`/`end_s` (o convierta a mm/h multiplicando por 3 600 000). Esto representa únicamente lluvia sintética en el tiempo, **no** extensión, profundidad, velocidad ni resultado de inundación. Con opción explícita, el bloque de lluvia indica que el perfil es sintético/no validado y que la distribución espacial sigue pendiente; los demás bloqueos no cambian. `can_simulate` sigue en `false`, `layers` en `[]` y DEM en `acquisition_not_requested`.

Errores del sobre usan `400` y prefijo `rainfall_profile`: objeto nulo/no objeto → `{"errors":{"rainfall_profile":["Debe ser un objeto con exactamente interval_count, seed y distribution."]}}`; claves faltantes o extra → `{"errors":{"rainfall_profile":["Debe contener exactamente interval_count, seed y distribution."]}}`; conteo inválido → `interval_count debe ser par entre 2 y 10000.`; semilla no entera → `seed debe ser un entero.`; ley desconocida → `distribution debe ser 'uniform_balanced'.`. Los errores de lluvia y ROI conservan sus campos existentes. La ausencia total de `rainfall_profile` conserva literalmente la respuesta y validación antiguas: no se añade un campo nulo ni valores predeterminados.

JSON malformado, claves JSON repetidas o media type no compatible usan errores estándar de DRF (400/415); método distinto de POST responde 405. No incluir credenciales ni rutas locales en solicitudes o respuestas.

## Estado inicial y límites científicos

La fuente elegida para una futura observación de extensión de agua es NISAR. La intención no es aún un estado inicial de profundidad: clasificación de agua no validada, profundidad y tratamiento de clases desconocidas siguen siendo cuestiones separadas y pendientes. No infiera que «sin agua detectada» significa seco, ni derive profundidad, DEM, infiltración o fronteras del perfil sintético.

## Integración frontend

El estado existente `croppedRegion` es `LngLat[] | null`, con puntos `[longitud, latitud]` en EPSG:4326 y al menos tres puntos. Compruebe que no sea `null` y conviértalo en un anillo cerrado (el helper de máscara también cierra repitiendo el primer punto); no envíe un `bbox` ni coordenadas de pantalla:

```js
if (!croppedRegion || croppedRegion.length < 3) throw new Error("Seleccione una región");
const ring = [...croppedRegion.map(([lng, lat]) => [lng, lat]), [...croppedRegion[0]]];
const payload = {
  rainfall: { amount: Number(amountMm), unit: "mm", duration: Number(duration), duration_unit: "h" },
  roi: { type: "Polygon", coordinates: [ring] },
};
```

Sustituya `rainfall` por el objeto de intensidad/duración cuando corresponda. `Number(...)` es una conversión de interfaz, no una validación: enviar solo valores finitos y no vacíos. En el estado actual muestre la normalización, `can_simulate: false` y los bloqueos; no espere ni represente un resultado de profundidad.

## Adquisición DEM explícita en Python

La vista HTTP nunca descarga ni llama al proveedor. En una operación local explícita, valide la ROI con `validate_roi` (la misma validación usada por el adaptador), luego use una caché exclusiva de un solo proceso:

```python
from pathlib import Path
from pipeline.hydrology.inputs import validate_roi
from pipeline.hydrology.dem import acquire_dem

roi = {"type": "Polygon", "coordinates": [[[-93.1, 16.6], [-93.0, 16.6], [-93.0, 16.7], [-93.1, 16.7], [-93.1, 16.6]]]}
roi = validate_roi(roi)
records = acquire_dem(roi, cache_dir=Path("data/raw/dem/nasadem_hgt/001"))
# records son NASADEMGranule con ZIP HGT originales; no son un DEM hidráulico.
```

El proveedor `pipeline.elevation.nasadem.NASADEMProvider(cache_dir).acquire_roi(roi)` solo cubre latitudes −56 a 60; una región fuera de cobertura se reporta como falta, sin fallback ni alturas ficticias. La geometría de la API no impone esa cobertura: otra fuente puede ser necesaria. Ejecutar con credenciales Earthdata privadas configuradas localmente según `docs/nasadem-provider.md`; nunca exponerlas ni registrar rutas locales. No compartir esta caché entre procesos concurrentes.

## Ejecución sintética registrada (API implementada)

La configuración es **solo de servidor**, no parte de `prepare/`: definir en Django `FLOOD_DG2_CASES` (diccionario de identificadores a casos preparados), `FLOOD_DG2_EXECUTABLE` (ruta absoluta dentro del proyecto), `FLOOD_DG2_BINARY_SHA256` (64 dígitos hex), `FLOOD_DG2_RUN_ROOT` (carpeta dentro del proyecto) y `FLOOD_DG2_TIMEOUT_S` (segundos > 0, máximo 120). Sin estos ajustes la API responde 503; **no registrar el smoke T030**. Ejemplo de caso sintético declarado por el operador (rutas ilustrativas locales, no enviar al frontend):

```python
FLOOD_DG2_CASES = {
    'demo': {
        'source_dir': '/ruta/dentro/del/proyecto/caso-preparado',
        'files': {'terrain.dem': '<sha256-hex>', 'terrain.dem1x': '<sha256-hex>',
                  'terrain.dem1y': '<sha256-hex>', 'case.par': '<sha256-hex>'},
        'parameter_file': 'case.par', 'simulation_duration_s': 2, 'save_interval_s': 1,
        'initial_condition': 'dry_zero_velocity', 'boundary': 'closed',
        'manning': 0.02, 'infiltration': 'unsupported', 'rainfall': 'none',
        'domain_nonurban': True, 'synthetic': True, 'hydraulic_accuracy_validated': False,
    },
}
```

Los valores son **ejemplo**, no parámetros físicos recomendados. Solo se admiten casos preparados sintéticos explícitamente secos, sin lluvia, con frontera cerrada y dominio declarado no urbano; FREE, lluvia espacial y casos regionales aún no están habilitados en el ejecutor. `case.par` usa `dg2`, `DEMfile terrain.dem`, `dirroot outputs`, `resroot synthetic`, `sim_time`, `saveint`, `fpfric` consistentes; requiere `initial_tstep` explícito, finito, positivo y no mayor que `sim_time`; sin él se rechaza el caso antes de crear el trabajo (el valor predeterminado del solver no es seguro). Esto no garantiza tiempos exactos de guardado. Se requieren ambos coeficientes oficiales `terrain.dem1x` y `terrain.dem1y` además del DEM y `.par`; los archivos deben ser regulares, con nombre simple y hash registrado. El servidor copia y coteja DEM, parámetros y binario en un directorio UUID nuevo, no lee rutas ni opciones del cuerpo HTTP. El DEM es **elevación, no profundidad**. Datos iniciales, fronteras y Manning de un caso regional requieren aprobación física independiente; no se infieren de NISAR ni NASADEM. El operador debe verificar la preparación oficial de DEM y la procedencia de todos los insumos antes de registrar un caso.

La interfaz autenticada usa esta secuencia:

1. `POST /api/flood-scenarios/prepare/` con lluvia/ROI para mostrar sus bloqueos originales. Esto **no registra** casos.
2. Si el operador registró un caso sintético y el usuario eligió expresamente su duración, enviar `POST /api/flood-scenarios/start/` (`Content-Type: application/json`): `{"case_id":"demo","simulation_duration_s":2}`. La duración debe coincidir con la preparada; no fijar 2 por defecto en el frontend. Respuesta `202`: `{"id":"<uuid>","case_id":"demo","state":"created","synthetic":true,"hydraulic_accuracy_validated":false,"simulation_duration_s":2.0,"save_interval_s":1.0,"input_hashes":{"terrain.dem":"<sha256>","case.par":"<sha256>"},"binary_sha256":"<sha256>"}`. El estado también puede ser `running` si el worker arranca antes de responder.
3. Consultar `GET /api/flood-runs/<uuid>/` con la misma sesión: misma forma de estado (`created`, `running`, `succeeded`, `failed` o `timed_out`); el propietario es el único autorizado. Los estados y hashes residen en JSON atómico en disco y sobreviven al proceso HTTP. No se exponen rutas locales, log ni entorno.
4. Solo al llegar a `succeeded`, consultar `GET /api/flood-runs/<uuid>/results/`. Antes devuelve `409 {"errors":{"result":["Resultado no disponible."]}}`. En éxito devuelve `grid` (`shape`, `cellsize_m`, `xllcorner`, `yllcorner`, `bounds`, `nodata`, `crs`), `units`, `frames` (`file`, `source_sha256`, `stats`, `frame_index` entero, `time_s: null`, `scheduled_time_s` en segundos programados), `time_axis` (`status: "actual_times_unavailable"`, motivo), `maximum`, `synthetic:true`, `hydraulic_accuracy_validated:false`, `warnings` y `artifacts` (URLs protegidas). `GET /api/flood-runs/<uuid>/artifacts/<nombre>/` descarga exclusivamente la profundidad ASCII enumerada, después de comprobar propietario y estado.

Ejemplo de cliente: `const start = await fetch('/api/flood-scenarios/start/', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-CSRFToken': csrfToken}, body:JSON.stringify({case_id: selectedCase, simulation_duration_s: Number(userDurationSeconds)})});` Tratar `202` como trabajo pendiente, consultar estado con la misma sesión y solo solicitar resultados al terminar. No usar URLs de `artifacts` como imágenes georreferenciadas: el CRS sintético es `null`, la malla puede ser local; nodata es **desconocido**, no agua seca. Profundidad está en metros sobre lecho; `time_s` es `null`: no hay tiempo físico real por cuadro en las salidas ASCII DG2. `scheduled_time_s = frame_index × save_interval_s` es el tiempo **solicitado**, no el observado; el frontend puede animar en orden de `frame_index` pero no etiquetar cuadros con segundos físicos ni sincronizarlos con observaciones. El solver avanza antes de guardar y un `initial_tstep` pequeño no demuestra coincidencia temporal. Máxima profundidad sin tiempo propio. No se entrega velocidad ni se certifica balance/precisión. `Qerror/Verror` del `.mass` y advertencia `getfattr` siguen pendientes.

Errores: sin autenticación `401/403` según autenticador; otro propietario o UUID desconocido `404`; cuerpo incompleto, claves extra, identificador o duración inválidos, hashes/parámetros inconsistentes `400 {"errors":{"request":["Caso preparado no disponible o entradas inconsistentes."]}}` (forma específica para campos requeridos: `Se requieren exactamente case_id y simulation_duration_s.`); configuración ausente `503 {"errors":{"service":["Ejecución DG2 no disponible."]}}`. No se crea un trabajo por entrada rechazada. La CLI interna `python -m pipeline.hydrology.runner --help` describe `--worker UUID --root CARPETA`; no es una interfaz de usuario ni admite parámetros científicos del cliente. El worker usa subprocess sin shell, con límite de tiempo y guarda `solver.log` local (no expuesto por HTTP). Una prueba nativa nueva de malla sintética 4×4 preparada con `generateDG2DEM`, `initial_tstep 0.1`, duración 2 s y binario de SHA256 `777d50f8d6a926260baa31b4c8ca3ecc0b3ae710494bebb2d4699ccf8c39775c` produjo exit 0, estados `succeeded`, cuadros de índices 0/1/2 (tiempos programados 0/1/2 s, tiempos físicos desconocidos) y `.max` legible; **no** reutilizó el caso T030 ni acredita precisión física. La preparación de ROI real, fronteras FREE, lluvia espacial y validación hidráulica siguen pendientes; **no** presentar estos casos sintéticos como inundación observada.
