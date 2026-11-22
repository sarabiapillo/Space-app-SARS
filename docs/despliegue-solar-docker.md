# Despliegue aislado y reproducible del backend solar

**Alcance:** imagen Linux `amd64` del backend Django + pipeline con el entorno local `nisar` reconstruido desde paquetes Conda y PyPI fijados. No instala nada en el servidor por sí sola, no copia prefijos Conda y no modifica el Compose existente de PostGIS. La validación local **no prueba** que el NASADEM usado en producción sea igual: pedir el SHA-256 de la tesela de producción antes de atribuir la diferencia a dependencias.

## Estado y decisión

| Componente | Estado local observado | Control en la imagen |
| --- | --- | --- |
| Python | 3.11.18 | artefacto Conda fijo |
| GDAL / PROJ | 3.12.3 / 9.7.1 | artefactos Conda fijos; GeoDjango usa las bibliotecas Conda |
| Rasterio / NumPy / pyproj | 1.4.4 / 2.4.6 / 3.7.2 | artefactos Conda fijos |
| pvlib / Django / DRF | 0.16.1 / 5.2.19 / 3.18.3 | versiones PyPI fijadas |
| SciPy / pandas / matplotlib / Pillow | 1.17.1 / 3.1.1 / 3.11.2 / 13.0.0 | Conda o PyPI según el entorno local |

`environment.yml` declara rangos y `pipeline/solar/requirements.txt` solo fija tres paquetes solares: ninguno garantiza un entorno idéntico. `docker-compose.yml` gestiona únicamente PostGIS y su volumen `pgdata`; `docs/bd-docker.md` explica su recuperación, pero no había Dockerfile ni procedimiento del backend solar. Se conservan ambos archivos. `infra/solar/conda-linux-64.lock` procede de `conda list -n nisar --explicit --md5` y fija URLs/builds e integridad de los 184 artefactos Conda; `infra/solar/pip.lock` fija las 58 distribuciones PyPI observadas (sin resolver dependencias) más Gunicorn 23.0.0, gestor WSGI **adicional**, no científico. La base micromamba está fijada por digest `linux/amd64`. No se incluyen credenciales, cache, simulaciones ni `.env` en el contexto Docker (`.dockerignore`). Los paquetes PyPI se fijan por versión, **no por hash de wheel**: la reproducción bit a bit de esos paquetes todavía depende de la conservación de sus artefactos en PyPI. `pip check`, las versiones dentro de la imagen y la comparación numérica son controles obligatorios.

## Ruta rápida: construcción y prueba local, sin servidor ni publicación

Desde la raíz del proyecto, con Docker Linux `amd64` y espacio disponible:

```bash
docker build --platform linux/amd64 --pull --tag terrapulse-solar:local -f infra/solar/Dockerfile .
docker image inspect terrapulse-solar:local --format '{{.Id}}'
```

El identificador anterior es el **ID local**, no un digest publicado en GHCR. La imagen probada se etiquetó *solo localmente* como `ghcr.io/sarabiapillo/terrapulse-solar:0.1.0-rc1` (ID `sha256:0ff23cdf5c279beb57f3302defec65feb97945f6528a4335c8f35bdd0a7bd2f2`); no se subió a ningún registro. Para los siguientes comandos crear un directorio de pruebas con `mktemp -d` fuera del repositorio; los tests usan `/tmp` y no montan la caché real como escritura. No guardar las claves de ejemplo en imágenes ni en archivos versionados:

```bash
# Usar siempre un secreto efímero únicamente en el contenedor local de prueba.
docker run --rm -e DJANGO_SECRET_KEY=test-only -e DJANGO_ALLOWED_HOSTS=testserver \
  -e POSTGRES_DB=test -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  terrapulse-solar:local micromamba run -n nisar python backend/manage.py check

docker run --rm -e DJANGO_SECRET_KEY=test-only -e DJANGO_ALLOWED_HOSTS=testserver \
  -e POSTGRES_DB=test -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  terrapulse-solar:local micromamba run -n nisar python -m pytest -q \
  pipeline/tests/test_solar_surface.py pipeline/tests/test_solar_analysis.py \
  pipeline/tests/test_solar_api.py pipeline/tests/test_solar_delivery.py
```

Comparación **sin adquisición remota ni escrituras** con la misma ROI y parámetros del `run.json` recuperado. El script valida el SHA-256 antes de abrir la tesela, lee el TIFF de producción solo para informar diferencias y emite JSON; jamás convierte una tesela con el mismo ID en prueba de identidad con producción:

```bash
TILE_SHA=4f4260d221ac564a7b247d4d41daf628f6839476f70db0ee9e04bcbb5bf8e744
PYTHONPATH=. /home/juliox/miniforge3/envs/nisar/bin/python infra/solar/verify_acapulco.py \
  --manifest terrapulse-diagnostico/run.json --tile data/nasadem-cache/n16w100.zip \
  --expected-sha256 "$TILE_SHA" --incident terrapulse-diagnostico/incident.tif > /tmp/solar-local.json

docker run --rm --mount "type=bind,src=$PWD/data/nasadem-cache,dst=/input-cache,readonly" \
  --mount "type=bind,src=$PWD/terrapulse-diagnostico,dst=/reference,readonly" \
  terrapulse-solar:local micromamba run -n nisar python /app/infra/solar/verify_acapulco.py \
  --manifest /reference/run.json --tile /input-cache/n16w100.zip \
  --expected-sha256 "$TILE_SHA" --incident /reference/incident.tif > /tmp/solar-container.json

diff -u /tmp/solar-local.json /tmp/solar-container.json
```

La salida no contiene claves: revisar `crs`, malla, máscara, SHA del Float32, altitud, DNI, mínimos, percentiles, media y diferencias con producción. Verificación observada: `manage.py check` pasó; 60/60 pruebas solares pasaron en la imagen (12.980 advertencias de bibliotecas existentes); `diff -u` del JSON de la repetición local/contenedor fue vacío. Un POST real de `/api/solar/simulations` (**sin barra final**) con la caché ZIP + recibo local montada como solo lectura, y salida en un directorio temporal nuevo, devolvió 201; GET posterior 200. El hash del array Float32 generado por la API coincidió exactamente con la repetición local (`b579afa3b2935cafa1309ec7197142dd4821065ceb96c5ac3af8895931de56d1`). El primer POST de diagnóstico había usado por error `/simulations/` y respondió 404: no fue una falla del simulador. Se usó exclusivamente almacenamiento temporal para esa ejecución, no la caché ni los resultados existentes como destino de escritura. Una igualdad local/contenedor **no** significa igualdad con producción: el manifiesto antiguo no guardó el hash NASADEM de producción. Cualquier desviación exige inspección, no sustitución silenciosa del DEM. En el caso recuperado, el entorno local produjo DNI 872,8444 y rango 45,53–865,69 W/m² frente a 873,8584 y 587,07–637,32 W/m² en producción; coincide la máscara, no la física. El ZIP local `n16w100.zip` tiene SHA-256 `4f4260d221ac564a7b247d4d41daf628f6839476f70db0ee9e04bcbb5bf8e744` (`n16w094.zip`: `9c78797bb664ef3dadb7ec60c65e8edad86fd0a994698f1313fe435a04b23a86`). Estos hashes **no** acreditan el contenido de los ZIP del servidor.

## Preparar GHCR sin publicar (publicación requiere autorización aparte)

No se ejecuta ninguno de los siguientes comandos en esta preparación. Tras revisar el resultado local, el responsable elige un tag inmutable, identidad GitHub y permisos mínimos del token (escritura de paquetes); no usar `latest` como referencia de despliegue:

```bash
# EJEMPLO para el responsable, solo tras autorizar la publicación:
# docker tag terrapulse-solar:local ghcr.io/OWNER/terrapulse-solar:VERSION
# docker login ghcr.io -u OWNER --password-stdin < /RUTA_PRIVADA/TOKEN
# docker push ghcr.io/OWNER/terrapulse-solar:VERSION
# docker buildx imagetools inspect ghcr.io/OWNER/terrapulse-solar:VERSION
```

Registrar el digest **del manifiesto publicado** `sha256:…` devuelto por GHCR y desplegar `SOLAR_IMAGE=ghcr.io/OWNER/terrapulse-solar@sha256:…`; el ID de imagen local no es ese digest. No escribir tokens en comandos de shell, repositorio, imagen o guía real de operaciones.

## Guía del administrador: incorporar solo el servicio solar, sin tocar los otros

1. **Antes de intervenir:** identificar el *proyecto Compose* y la red de la instancia actual (no crear otro proyecto por accidente), ventana de mantenimiento y ruta de reversión. Registrar el digest previo de la imagen solar y hacer copia verificada/snapshot de `solar-runs`, `nasadem-cache` y la base cuando corresponda. Comprobar que las rutas de datos existentes son directorios reales, no symlinks, y pertenecen al mismo filesystem para el `flock` de NASADEM; verificar permisos de lectura/escritura del UID 1000 sin cambiar recursivamente la propiedad de datos existentes. No usar `docker compose down`, `down -v`, `prune` ni migraciones automáticas.
2. **Elegir las rutas y cotejar datos:** obtener el SHA-256 de `n16w100.zip` en el servidor y contrastarlo con la referencia local. Si difiere, detener la afirmación de equivalencia: conservar ambos archivos y obtener procedencia/validación del dato; nunca copiar encima del original. Confirmar almacenamiento suficiente y control de acceso a ambos directorios. Verificar también el recibo `.n16w100.cmr.json` contra el ZIP: el proveedor no acepta sin corroboración CMR una tesela que solo exista como ZIP. La caché local incluye ese recibo, pero no se ha verificado el servidor. La configuración Compose **no proporciona credenciales Earthdata**: nuevos mosaicos o ZIP sin recibo requerirán antes un mecanismo privado de autenticación de ejecución autorizado por el administrador, nunca una clave incorporada a la imagen; de lo contrario el POST fallará, sin reemplazar los datos. Resolver por separado los límites de seguridad del endpoint solar público antes de exponerlo a Internet.
3. **Preparar configuración privada de Compose:** definir `SOLAR_IMAGE` con **digest** autorizado; `SOLAR_NASADEM_HOST_DIR` y `SOLAR_RUNS_HOST_DIR` como rutas absolutas existentes; `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` y las variables `POSTGRES_*` a través de la configuración privada ya aprobada. El servicio publica solo `127.0.0.1:${SOLAR_PORT:-18080}`; coordinar el proxy, no abrir un puerto público. El proceso Django tiene un worker y no ejecuta migraciones al iniciar. Usar la misma identidad de proyecto Compose que la instancia PostGIS existente.
4. **Validación previa:** `docker compose -p PROJECT -f docker-compose.yml -f infra/solar/compose.yml config --quiet` (no imprimir configuración con secretos), `docker pull ghcr.io/OWNER/terrapulse-solar@sha256:DIGEST`, luego inspeccionar el digest resuelto. Verificar mounts, UID y salud del servicio con comandos de diagnóstico propios del entorno.
5. **Despliegue selectivo:** `docker compose -p PROJECT -f docker-compose.yml -f infra/solar/compose.yml up -d --no-deps solar`. No reiniciar `db` ni el resto de servicios. Comprobar logs solo del solar y ejecutar `manage.py check` dentro del contenedor; no existe un endpoint de salud solar dedicado. Hacer un POST de prueba a `/api/solar/simulations` (**sin barra final**) **únicamente** con una ROI y almacenamiento autorizado para nuevas corridas, sin sobrescribir IDs. Confirmar acceso en el proxy y respuesta de la API antes de dar por terminado el cambio.
6. **Reversión:** volver a establecer `SOLAR_IMAGE` al digest anterior y ejecutar `up -d --no-deps --force-recreate solar`; para una instalación nueva, parar **solo** `solar` y restaurar el proxy anterior. Restaurar datos únicamente desde un respaldo validado y con autorización específica: cambiar imagen no debe borrar ni reemplazar cache ni corridas. No usar `down -v`.

**Límites:** esta guía no despliega frontend, no incorpora binarios hidráulicos de LISFLOOD ni suplanta el despliegue de otros servicios. Django usa PostGIS en producción y las pruebas de la API solar usan settings aislados, sin tocar la base del servidor. El hash de `code_version` refleja código del backend, no el contenido NASADEM ni la versión del frontend; para comparar entornos hace falta verificar cada componente por separado.
