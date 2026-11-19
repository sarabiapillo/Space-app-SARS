# Activar y comprobar el servicio ROI DG2

El servidor configura DG2 mediante variables de entorno; no instala ni ejecuta binarios al arrancar. El comando de comprobación local no usa red ni escribe archivos. La adquisición Earthdata requiere una petición explícita del operador y no equivale a validar resultados hidráulicos.

## Ruta rápida

1. Mantener los dos binarios DG2 existentes bajo `data/tools/lisflood-fp-8.0/runtime/build/`; los hashes esperados están fijados en `backend/config/flood_service.py`. No instalar desde la API.
2. Ejecutar `PYTHONPATH=. python backend/manage.py check_flood_service` desde la raíz. `ready:true`, `binary:verified`, `helper:verified`, `root:writable_private` indica solo preparación local; `earthdata:not_checked` **no** acredita acceso a NASADEM. Si la raíz aún no existe, `root:writable_private` indica que puede crearse de forma privada bajo el directorio comprobado, no que ya haya sido creada. Un fallo devuelve código distinto de cero y `reason` seguro.
3. Solo cuando proceda probar red: configurar `EARTHDATA_TOKEN` **o** el par `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` en el entorno privado del proceso, nunca en el JSON de la API ni en el chat. Ejecutar `PYTHONPATH=. python backend/manage.py check_flood_service --earthdata`; opcionalmente `--timeout-s 60` (1–120 s). Consulta y descarga una tesela original `n16w094` para una ROI diminuta de Chiapas, y guarda comprobante privado en `data/service-checks/<uuid>/proof.json`. Conservar la evidencia, no publicarla.

## Ajustes del operador

Por defecto `FLOOD_ROI_DG2_ENABLED=true`; `false` deshabilita la ejecución ROI (`503` en `start/`). Las rutas absolutas configurables deben quedar dentro de `data/` del proyecto, sin enlaces simbólicos; la raíz de trabajos debe ser privada. Los valores iniciales admiten una corrida real *pequeña*, no capacidad recomendada: medido el 2026-11-19, 1680 celdas × 900 s simulados tardaron 59–69 s de solver. Dominios mayores o simulaciones más largas terminan en `solver_timeout`; `TIMEOUT_S` (120 s) y `PREPARATION_TIMEOUT_S` (600 s) ya están en el tope que admite el código. Cada variable del entorno sigue teniendo prioridad sobre el valor inicial:

| Variable (prefijo `FLOOD_ROI_DG2_`) | Valor inicial |
| --- | --- |
| `RUN_ROOT` | `data/roi-dg2-jobs` |
| `EXECUTABLE`, `DEM_EXECUTABLE` | `data/tools/lisflood-fp-8.0/runtime/build/lisflood`, `generateDG2DEM` |
| `BINARY_SHA256`, `DEM_SHA256` | Hashes fijados en código (no se admiten sustituciones) |
| `TIMEOUT_S`, `PREPARATION_TIMEOUT_S` | 120 s, 600 s |
| `MAX_CELLS`, `MAX_RAIN_VALUES`, `MAX_FRAMES`, `MAX_TILES` | 3000, 100000, 20, 2 |
| `CODE_VERSION` | `772425ef+service-setup-uncommitted` (actualizar con versión real al desplegar) |

El comando local verifica hashes, ejecutabilidad y permisos antes de declarar preparación local; importar Django solo valida la configuración sintáctica. Un POST autenticado inicia un trabajo y puede acceder a NASADEM entonces; **no** hay conexión al importar settings. El chequeo remoto usa exclusivamente credenciales en memoria del entorno (`persist=False`), nunca `.netrc` ni prompts; cada ejecución utiliza caché nueva, una sola tesela y plazo máximo 120 s. `proof.json` incluye identidad CMR, SHA256 de HGT y ZIP y bytes, no credenciales. La fuente NASADEM no ofrece aquí autenticidad criptográfica independiente del servidor remoto. El límite de 64 MiB se comprueba tras la descarga; el plazo restringe la duración, no el tráfico instantáneo. Errores seguros: `configuration_invalid`, `missing_environment_credentials`, `authentication_failed`, `acquisition_failed`, `timeout`. Revisar acceso Earthdata/autorizar la aplicación si falla; no interpretar un fallo como éxito.

## Contrato HTTP

Consultar [API ROI DG2](api-simulacion-roi.md) para solicitud, estados, artefactos y advertencias físicas. No existe endpoint público de diagnóstico ni de credenciales.
