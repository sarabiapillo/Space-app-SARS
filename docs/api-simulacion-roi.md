# Ejecución DG2 por ROI: API y contrato frontend

**Ruta nueva autenticada**, independiente de los casos registrados. `POST /api/flood-scenarios/roi/start/` valida primero y devuelve `202`; adquisición NASADEM, preparación DG2, lluvia NetCDF y solver se ejecutan **fuera del request**. No valida precisión hidráulica ni observa inundación. Para el contrato anterior `prepare/` y casos registrados, véase [API de simulación](api-simulacion-inundacion.md).

## Operación del servidor (antes de llamar)

Configurar en Django, exclusivamente por el operador, los ajustes siguientes. Ejemplo copiable desde la raíz del proyecto, sujeto a verificar que ambos archivos existentes coinciden con estos hashes antes de activar el servicio (no instalar ni construir desde la API):

```python
from pathlib import Path
BASE = Path(__file__).resolve().parents[2]  # en backend/config/settings.py
FLOOD_ROI_DG2_RUN_ROOT = str(BASE / 'data/roi-dg2-jobs')
FLOOD_ROI_DG2_CONFIG = {
    'executable': str(BASE / 'data/tools/lisflood-fp-8.0/runtime/build/lisflood'),
    'binary_sha256': '777d50f8d6a926260baa31b4c8ca3ecc0b3ae710494bebb2d4699ccf8c39775c',
    'dem_executable': str(BASE / 'data/tools/lisflood-fp-8.0/runtime/build/generateDG2DEM'),
    'dem_sha256': 'ada476fc141d536d09abd4aa1238d192bbddfd627574886ada12784ba0e964a8',
    'timeout_s': 15, 'preparation_timeout_s': 25,
    'max_cells': 1000, 'max_rain_values': 5000, 'max_frames': 5, 'max_tiles': 2,
    'code_version': 'roi-dg2-operator-reviewed',
}
```

Los límites son **ejemplo pequeño de prueba**, no recomendación de explotación. Ejecutables y directorio de trabajos deben permanecer dentro de `data/` del proyecto; root de trabajos privado (sin permisos de grupo/otros), hashes correctos y binarios ejecutables. El operador debe fijar presupuestos para su capacidad y revisar el dominio físico. La cuenta de servicio necesita acceso Earthdata NASADEM y red, configurados en el servidor; nunca enviar credenciales en JSON. **No activar acceso a red incondicionalmente por importar la vista:** solo el worker de un POST autenticado intenta adquirir datos. Una ROI fuera de latitudes NASADEM −56…60, una tesela inaccesible o una malla con huecos fallará sin rellenar elevación inventada. No se ha probado aquí adquisición Earthdata real.

## Solicitud completa

`Content-Type: application/json`, sesión autenticada y CSRF cuando aplique. **Todos** los valores numéricos y de hipótesis abajo son ilustrativos, no parámetros físicos recomendados. `domain` debe cubrir la ROI, estar en GeoJSON Polygon EPSG:4326 y ser suficientemente amplio para la física que se quiera examinar; su selección corresponde al usuario informado. `domain_nonurban: true` es una declaración explícita, no una comprobación automática del terreno. El ejemplo es deliberadamente diminuto y atraviesa dos teselas NASADEM:

```json
{
  "roi": {"type":"Polygon","coordinates":[[[-92.9998,16.8],[-92.9995,16.8],[-92.9995,16.8003],[-92.9998,16.8003],[-92.9998,16.8]]]},
  "domain": {"type":"Polygon","coordinates":[[[-92.9999,16.7998],[-92.9993,16.7998],[-92.9993,16.8005],[-92.9999,16.8005],[-92.9999,16.7998]]]},
  "rainfall": {"amount":2,"unit":"mm","duration":1,"duration_unit":"s"},
  "rainfall_profile": {"interval_count":2,"seed":7,"distribution":"uniform_balanced"},
  "terrain": {"target_crs":"EPSG:32615","resolution_m":20,"resampling":"nearest"},
  "hydraulics": {"manning":0.02,"initial_condition":"dry_zero_velocity","boundary":"free","infiltration":"unsupported","domain_nonurban":true},
  "simulation": {"duration_s":2,"save_interval_s":1,"initial_tstep_s":0.1}
}
```

El sobre acepta exactamente estas siete secciones. La lluvia es hipotética, perfil temporal sintético conservativo con semilla, uniforme dentro de la ROI y cero fuera; no es precipitación observada. `closed` o `free` (FREE idealizada), terreno métrico, duración, paso inicial y frecuencia de guardado deben elegirse expresamente. Estado inicial seco y velocidad cero **no** provienen de NISAR. Infiltración no modelada; NASADEM es elevación EGM96 y **no** profundidad. La malla se expande a un rectángulo métrico completo antes de comprobar cobertura; presupuestos de celdas, lluvia, cuadros y teselas se validan antes de crear trabajo.

## Respuestas y animación

`202` (valores ilustrativos; UUID asignado por servidor):

```json
{"id":"6c5b38f4-9d14-4c71-912b-04ed7629d94a","state":"created","stage":"created","simulation_duration_s":2,"save_interval_s":1,"synthetic":true,"hydraulic_accuracy_validated":false,"status_url":"/api/flood-roi-runs/6c5b38f4-9d14-4c71-912b-04ed7629d94a/","results_url":"/api/flood-roi-runs/6c5b38f4-9d14-4c71-912b-04ed7629d94a/results/"}
```

Consultar `GET status_url` con la misma sesión. `state`/`stage`: `created`, `acquiring`, `preparing`, `running`, `results`, `succeeded`, `failed`, `timed_out`. En fallo hay `error` limitado a códigos seguros (`acquisition_failed`, `preparation_failed`, `preparation_or_output_invalid`, `worker_stopped`, `worker_deadline`, `worker_launch_failed`, `preparation_timeout`, `solver_timeout` o `run_failed`); no se expone traceback ni rutas. Mostrar fallo de adquisición distinto de preparación/cobertura; los detalles de cobertura no se infieren del código general. `GET results_url` responde `409 {"errors":{"result":["Resultado no disponible."]}}` hasta éxito.

En éxito `results_url` devuelve `grid` (`shape`, `cellsize_m`, `xllcorner`, `yllcorner`, `bounds`, `nodata`, `crs` métrico), `units: "m above local bed"`, `frames` ordenados (`frame_index`, `time_s:null`, `scheduled_time_s`, `stats`, `source_sha256`), `maximum` (`stats`, `source_sha256`), `time_axis`, `warnings`, `synthetic:true`, `hydraulic_accuracy_validated:false`, y `artifacts`. Ejemplo **ilustrativo de estructura, no medición**:

```json
{"grid":{"shape":[8,9],"cellsize_m":20,"xllcorner":500000,"yllcorner":1850000,"bounds":[500000,1850000,500180,1850160],"nodata":-9999,"crs":"EPSG:32615"},"units":"m above local bed","frames":[{"frame_index":0,"time_s":null,"scheduled_time_s":0,"stats":{"wet_cells":0},"source_sha256":"<sha256>"}],"maximum":{"stats":{"wet_cells":0},"source_sha256":"<sha256>"},"time_axis":{"status":"actual_times_unavailable","reason":"DG2 ASCII frames do not record actual physical timestamps; scheduled_time_s is requested, not observed."},"warnings":["<advertencia>"],"synthetic":true,"hydraulic_accuracy_validated":false,"artifacts":[{"name":"roi-0000.wd.tif","url":"/api/flood-roi-runs/<uuid>/artifacts/roi-0000.wd.tif/","sha256":"<sha256>","source_sha256":"<sha256>","geographic_bounds":[-93,16.8,-92.99,16.81],"frame_index":0,"time_s":null,"scheduled_time_s":0,"nodata":-9999,"units":"m"}]}
```

El servidor entrega COG TIFF **solo al propietario** y únicamente cuando figura en los artefactos de un trabajo exitoso; descarga completa (`Content-Type: image/tiff`, `Content-Length`, `ETag` SHA256); **no implementa HTTP Range**. Comprobar el SHA256 al recibirlo. `geographic_bounds` es EPSG:4326 para encuadre, no cambia el CRS del raster: **NO** pasar COG UTM directo a MapLibre `image` ni tratarlo como tesela XYZ/3857. Para visualización frontend, decodificar GeoTIFF y reproyectar explícitamente a Web Mercator o utilizar un servidor de teselas propio autorizado por propietario; aquí **no se ofrece URL de teselas**. Animar en orden de `frame_index`, no etiquetar `scheduled_time_s` como tiempo físico observado: `time_s` es siempre null; el máximo no tiene instante propio. Respetar nodata como desconocido, no como lecho seco.

Errores: sin autenticación `401/403`, otro propietario/UUID/artefacto inexistente o adulterado `404`, JSON inválido/duplicado o entrada/cobertura/presupuesto rechazado `400` (sin crear trabajo), servicio sin configuración válida `503`. No hay acceso público a `data/`, ni descarga de ASCII por esta API. Los resultados de prueba con proveedor HGT sintético y solver DG2 real verifican integración y cuatro COG, **no** disponibilidad Earthdata real ni fidelidad física.
