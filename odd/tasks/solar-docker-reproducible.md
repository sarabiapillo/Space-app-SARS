# Entorno solar reproducible
Estado: en preparación; sin intervenir el servidor ni publicar imágenes.

## Specs
S1. «Identifica las versiones exactas de Python, GDAL, Rasterio, NumPy, pvlib, pyproj, PROJ y demás dependencias científicas utilizadas localmente.»
S2. «Revisa los Dockerfile, Docker Compose y archivos de dependencias existentes antes de crear o reemplazar configuraciones.»; «Antes de implementar, revisa si ya existe un procedimiento de despliegue que podamos aprovechar.»
S3. «Prepara una imagen Docker reproducible con versiones fijadas.»; «Asegúrate de que el backend Django y el pipeline solar funcionen dentro del contenedor.»
S4. «Mantén NASADEM y los resultados generados en almacenamiento persistente, fuera de la imagen.»; «Verifica los hashes SHA-256 de los datos NASADEM utilizados.»
S5. «Ejecuta las pruebas científicas y de la API solar.»; «Reproduce la simulación de Acapulco dentro del contenedor y compara sus resultados numéricos con el entorno local.»
S6. «Prepara la publicación de una imagen versionada en GitHub Container Registry, identificable por digest.»; «Documenta los pasos que deberá realizar el administrador del servidor para desplegarla sin afectar los demás servicios.»
S7. «No modificar el servidor de producción.»; «No hacer push ni publicar imágenes sin mi autorización.»; «No cambiar ecuaciones científicas.»; «No incorporar credenciales al contenedor.»; «No sobrescribir datos NASADEM ni simulaciones existentes.»; «No modificar otros módulos de TerraPulse innecesariamente.»; «Al finalizar, quiero una imagen que pueda verificar localmente y un procedimiento de despliegue controlado con posibilidad de revertir los cambios.»

## Tasks
T1 | S1-S2 | inspección inline + explorer | commit: documentación en siguiente unidad.
T2 | S3-S4,S7 | implementación inline imagen/locks/volúmenes | commit: 9b761cb.
T3 | S4-S5 | pruebas y reproducción aislada | commit: 9b761cb.
T4 | S6-S7 | documentación de GHCR y despliegue reversible | commit: documentación en siguiente unidad.

## Log
L1. Solicitud original del usuario:
Quiero preparar TerraPulse AI para que el backend de producción ejecute exactamente el mismo entorno que utilizo localmente.

Actualmente el simulador de radiación solar genera resultados muy diferentes entre local y producción, incluso utilizando la misma ROI de Acapulco.

Necesito que prepares un despliegue reproducible mediante Docker.

Primero inspecciona el entorno local y la configuración existente del repositorio. No supongas que ambos entornos son idénticos.

Requisitos:

1. Identifica las versiones exactas de Python, GDAL, Rasterio, NumPy, pvlib, pyproj, PROJ y demás dependencias científicas utilizadas localmente.
2. Revisa los Dockerfile, Docker Compose y archivos de dependencias existentes antes de crear o reemplazar configuraciones.
3. Prepara una imagen Docker reproducible con versiones fijadas.
4. Asegúrate de que el backend Django y el pipeline solar funcionen dentro del contenedor.
5. Mantén NASADEM y los resultados generados en almacenamiento persistente, fuera de la imagen.
6. Verifica los hashes SHA-256 de los datos NASADEM utilizados.
7. Ejecuta las pruebas científicas y de la API solar.
8. Reproduce la simulación de Acapulco dentro del contenedor y compara sus resultados numéricos con el entorno local.
9. Prepara la publicación de una imagen versionada en GitHub Container Registry, identificable por digest.
10. Documenta los pasos que deberá realizar el administrador del servidor para desplegarla sin afectar los demás servicios.

Antes de implementar, revisa si ya existe un procedimiento de despliegue que podamos aprovechar.

No quiero simplemente copiar archivos de mi entorno Conda a producción. Quiero que el contenedor reproduzca las dependencias y el comportamiento del simulador.

**Restricciones:**
- No modificar el servidor de producción.
- No hacer push ni publicar imágenes sin mi autorización.
- No cambiar ecuaciones científicas.
- No incorporar credenciales al contenedor.
- No sobrescribir datos NASADEM ni simulaciones existentes.
- No modificar otros módulos de TerraPulse innecesariamente.

Al finalizar, quiero una imagen que pueda verificar localmente y un procedimiento de despliegue controlado con posibilidad de revertir los cambios.
L2. El repo solo tiene Compose PostGIS (pgdata) y environment.yml sin lock; no hay Dockerfile. Entorno Linux local: Python 3.11.18, GDAL 3.12.3, PROJ 9.7.1, rasterio 1.4.4, NumPy 2.4.6, pvlib 0.16.1, pyproj 3.7.2. Existen n16w100.zip (SHA-256 4f4260d221ac564a7b247d4d41daf628f6839476f70db0ee9e04bcbb5bf8e744) y n16w094.zip (SHA-256 9c78797bb664ef3dadb7ec60c65e8edad86fd0a994698f1313fe435a04b23a86) locales. El hash de la tesela de producción no está disponible; no afirmar igualdad con ella. Se preservan cambios de favicon ajenos a la tarea.
L3. Docker local linux/amd64 compilado desde 184 artefactos Conda con MD5 y 58 pins PyPI más Gunicorn, imagen ID sha256:0ff23cdf5c279beb57f3302defec65feb97945f6528a4335c8f35bdd0a7bd2f2; tag local ghcr.io/sarabiapillo/terrapulse-solar:0.1.0-rc1 sin push ni digest GHCR publicado. manage.py check y gunicorn --check-config OK; 60/60 pruebas solares pasan en Docker (12.980 advertencias de dependencias existentes). Repetición offline con archivo ZIP montado read-only: JSON local = Docker exactamente; POST real API en Docker aislado devuelve 201, GET 200, array Float32 coincide exactamente con local (SHA b579afa3b2935cafa1309ec7197142dd4821065ceb96c5ac3af8895931de56d1), diferencia máxima producción 572.3804 W/m². Primer POST fue a ruta con slash final y devolvió 404; corregida invocación, no fue fallo del backend. Verificación independiente identifica requisito de recibo CMR NASADEM y falta de autenticación para tiles nuevos; incorporado a guía, no alterar credenciales ni proveedor. Los wheels PyPI tienen pins de versión pero no hashes: límite de reproducibilidad bit a bit consignado.
