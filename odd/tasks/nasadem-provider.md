# Proveedor NASADEM reutilizable
Estado: unidad de entrega sin commit en `feat/solar-radiation-simulator`. El trabajo solar previo y sus límites permanecen intactos.

## Specs
S1. «El objetivo inmediato es entregar al equipo un módulo reutilizable que descargue automáticamente los archivos NASADEM correspondientes a cualquier ROI válido dentro de la cobertura del producto.» «No necesita GeoTIFF procesados, cálculo de normales ni funcionalidades del simulador solar.»
S2. «Recibir un ROI en formato GeoJSON o mediante un bounding box, utilizando el contrato de ROI existente cuando esté disponible.» «Validar las coordenadas y geometría.» «Calcular el bounding box geográfico si recibe un polígono.»
S3. «Buscar automáticamente en NASA Earthdata los granulares `NASADEM_HGT`, versión `001`, mediante `earthaccess`.» «Identificar todas las teselas necesarias para cubrir el ROI.» «Descargar las teselas faltantes.» «Reutilizar las teselas existentes cuando sean válidas.»
S4. «Validar que los archivos descargados sean legibles y correspondan a los granulares solicitados.» «Devolver una colección de rutas a los archivos originales descargados, junto con sus identificadores y metadatos básicos.» «Manejar errores de autenticación, cobertura, red y descarga incompleta.»
S5. «Evalúa moverlo a un módulo geoespacial compartido, por ejemplo: `pipeline/elevation/nasadem.py`» «El simulador solar y el módulo de inundaciones deben poder utilizar el mismo proveedor sin duplicar lógica.» «Conserva compatibilidad con las importaciones actuales o actualízalas de manera controlada, sin modificar el trabajo de otros integrantes.»
S6. «Utiliza mocks para pruebas automatizadas y una prueba de integración real acotada cuando sea necesaria.» «No es obligatorio resolver completamente la caché persistente L2/L3 porque no forma parte de esta entrega.» «Si las garantías de concurrencia L1 todavía no están resueltas, limita explícitamente el contrato a uso local de un solo proceso y documenta esa restricción.»
S7. «Incluye: Ubicación definitiva del módulo. Ejemplo funcional de uso desde Python. Dependencias necesarias. Variables de entorno requeridas. Estructura de los resultados. Restricciones de uso y concurrencia. Pruebas ejecutadas. Instrucciones para que otro integrante pueda reutilizarlo.»
S8. «Trabaja en `feat/solar-radiation-simulator`.» «No desarrolles nuevas funcionalidades solares.» «No generes GeoTIFF procesados.» «No implementes frontend ni endpoints Django.» «No modifiques P4/P5 ni el módulo de inundaciones.» «No introduzcas infraestructura innecesaria.» «No hagas commit ni push hasta presentar la entrega para revisión.»
S9. «Los requisitos de producción, Windows, concurrencia multiproceso y mejoras adicionales deben quedar documentados como pendientes, salvo que sean indispensables para garantizar la integridad de los archivos en el escenario de prueba.» «Al finalizar, indícame claramente si el módulo está listo para que otro compañero lo utilice y qué debo hacer para compartirlo mediante Git.»

## Tasks
T1 [S1-S5,S8] route inline: DONE; `pipeline/elevation/nasadem.py` compartido con fachada `pipeline/solar/nasadem.py`; API pública ROI de descarga separada de DEM/halo; commit: prohibido.
T2 [S2-S4,S6] route bounded writer + corrección inline: DONE; RED 4 fallidas/21 aprobadas por caché sin CMR; GREEN verificador independiente 45 enfocadas y 171 suite; commit: prohibido.
T3 [S5,S7-S9] route inline: DONE; `docs/nasadem-provider.md` y `docs/features/nasadem-provider.tex`, estructura LaTeX comprobada (sin pdflatex), 45 pruebas focales y 171 suite verificadas independientemente; presentación pendiente en respuesta; commit: prohibido.

## Log
L1. «Necesito cambiar la prioridad de desarrollo de TerraPulse.

**El objetivo inmediato es entregar al equipo un módulo reutilizable que descargue automáticamente los archivos NASADEM correspondientes a cualquier ROI válido dentro de la cobertura del producto.**

Otro integrante está desarrollando la simulación de inundaciones y necesita consumir esa funcionalidad desde Python.

No necesita GeoTIFF procesados, cálculo de normales ni funcionalidades del simulador solar.

### 1. Alcance exacto

Quiero completar y entregar exclusivamente el proveedor NASADEM existente en `pipeline/solar/nasadem.py`, reutilizando el código que ya funciona.

Debe permitir:

1. Recibir un ROI en formato GeoJSON o mediante un bounding box, utilizando el contrato de ROI existente cuando esté disponible.
2. Validar las coordenadas y geometría.
3. Calcular el bounding box geográfico si recibe un polígono.
4. Buscar automáticamente en NASA Earthdata los granulares `NASADEM_HGT`, versión `001`, mediante `earthaccess`.
5. Identificar todas las teselas necesarias para cubrir el ROI.
6. Descargar las teselas faltantes.
7. Reutilizar las teselas existentes cuando sean válidas.
8. Validar que los archivos descargados sean legibles y correspondan a los granulares solicitados.
9. Devolver una colección de rutas a los archivos originales descargados, junto con sus identificadores y metadatos básicos.
10. Manejar errores de autenticación, cobertura, red y descarga incompleta.

No es necesario generar GeoTIFF, mosaicos ni recortes del terreno.

### 2. Reutilización por otros módulos

Actualmente el proveedor está ubicado en `pipeline/solar/nasadem.py`, pero la descarga de NASADEM no es una responsabilidad exclusiva del simulador solar.

Evalúa moverlo a un módulo geoespacial compartido, por ejemplo:

`pipeline/elevation/nasadem.py`

O una ubicación equivalente acorde con la arquitectura existente.

El simulador solar y el módulo de inundaciones deben poder utilizar el mismo proveedor sin duplicar lógica.

Conserva compatibilidad con las importaciones actuales o actualízalas de manera controlada, sin modificar el trabajo de otros integrantes.

### 3. Pruebas necesarias para la entrega

Ya comprobamos exitosamente la descarga real de `n16w094`.

Ahora prioriza:

- Búsqueda y selección de múltiples teselas cuando un ROI cruce sus límites.
- Comprobación de cobertura de todas las teselas requeridas.
- Identificación correcta de nombres y metadatos.
- Descarga de granulares faltantes.
- Reutilización de archivos válidos.
- Manejo de ROI fuera de cobertura.
- Manejo de errores y descargas incompletas.

Utiliza mocks para pruebas automatizadas y una prueba de integración real acotada cuando sea necesaria.

No es obligatorio resolver completamente la caché persistente L2/L3 porque no forma parte de esta entrega.

Sin embargo, no ignores problemas que puedan causar corrupción de archivos o escrituras fuera del directorio previsto. Si las garantías de concurrencia L1 todavía no están resueltas, limita explícitamente el contrato a uso local de un solo proceso y documenta esa restricción. No presentes el proveedor como seguro para múltiples workers concurrentes.

### 4. Entregable obligatorio

Quiero entregar una API Python sencilla y documentada, conceptualmente similar a:

```python
provider = NASADEMProvider(cache_dir=...)

granules = provider.search(roi)
files = provider.acquire(granules)
```

Puedes proponer una interfaz más adecuada si simplifica la integración.

El resultado debe permitir que otro desarrollador obtenga las teselas NASADEM correspondientes a un ROI sin conocer los detalles de autenticación, Earthdata o búsqueda de granulares.

Incluye:

- Ubicación definitiva del módulo.
- Ejemplo funcional de uso desde Python.
- Dependencias necesarias.
- Variables de entorno requeridas.
- Estructura de los resultados.
- Restricciones de uso y concurrencia.
- Pruebas ejecutadas.
- Instrucciones para que otro integrante pueda reutilizarlo.

### 5. Restricciones

- Trabaja en `feat/solar-radiation-simulator`.
- No desarrolles nuevas funcionalidades solares.
- No generes GeoTIFF procesados.
- No implementes frontend ni endpoints Django.
- No modifiques P4/P5 ni el módulo de inundaciones.
- No introduzcas infraestructura innecesaria.
- Prioriza una implementación mínima, funcional y comprobable.
- No hagas commit ni push hasta presentar la entrega para revisión.

### 6. Prioridad

Tenemos que avanzar con el desarrollo del equipo.

No quiero que este trabajo siga bloqueado por mejoras opcionales de arquitectura.

Resuelve únicamente los errores que impidan entregar un proveedor funcional bajo las restricciones de uso declaradas.

Los requisitos de producción, Windows, concurrencia multiproceso y mejoras adicionales deben quedar documentados como pendientes, salvo que sean indispensables para garantizar la integridad de los archivos en el escenario de prueba.

**Al finalizar, indícame claramente si el módulo está listo para que otro compañero lo utilice y qué debo hacer para compartirlo mediante Git.**

No solicites nuevas autorizaciones para investigaciones que estén fuera de este alcance. Completa la unidad de trabajo y presenta los resultados.»
L2. Rama `feat/solar-radiation-simulator`; otros archivos solares, plan, LaTeX y skill preexistían sin seguimiento Git. `pipeline/elevation/nasadem.py` concentra la API `acquire_roi`; `pipeline/solar/nasadem.py` reexporta compatiblemente. No se tocó P4/P5 ni inundaciones, tampoco se hizo commit/push.
L3. Implementación con tests: primera unidad y corrección de autenticación no interactiva RED 3 fallidas/16 aprobadas, GREEN 20 enfocados/166 suite; verificador independiente 40 enfocados/166 suite, pero detectó caché ZIP sin CMR. Corrección final RED 4 fallidas/21 aprobadas → GREEN 25 enfocadas/171 suite. Prueba nueva de ROI ancho mostró RED 1 fallida (rechazo artificial); se retiró ese rechazo y volvió GREEN 1 enfocada y suite 171. Verificador final: 45 enfocadas/8 advertencias y 171 suite/182 advertencias, ambas exit 0, sin red ni ZIP real. No hay checksum remoto ni seguridad multiproceso; uso exclusivo un proceso.
L4. Guía `docs/nasadem-provider.md` y documento `docs/features/nasadem-provider.tex` agregados; estructura LaTeX y llaves comprobadas, sin pdflatex instalado. `git diff --check` exit 0; no commit/push ni publicación, ZIP real anterior informado por el usuario no se tocó ni se volvió a descargar.
