# Corrección ROI administrativa y fechas GCOV
Branch: current working branch. Delivery: uncommitted; no push.
Scope: geosearch ROI, search labels, GCOV date UI, tests and feature documentation.

## Specs
S1. «Antes de modificar código, inspecciona el flujo completo desde Nominatim hasta la geometría que finalmente se dibuja y guarda en el mapa.» «Si el límite administrativo completo cabe dentro de las restricciones, utiliza EXACTAMENTE el polígono original de OpenStreetMap.» «Restricciones: radio de análisis configurable de 1 a 15 km, predeterminado 5 km, y extensión angular máxima de 0.6° por eje.»
S2. «Genera una ROI rectangular completamente contenida dentro del polígono administrativo original.» «Verifica geométricamente que el rectángulo completo esté contenido dentro del límite administrativo, incluyendo sus bordes, huecos e islas.» «Si no cabe, desplaza el centro o reduce progresivamente las dimensiones hasta encontrar una solución válida.» «Si no es posible generar un rectángulo válido, informa al usuario y permite delimitar manualmente. No inventes una ROI.»
S3. «Solamente cuando no exista una geometría administrativa utilizable: Genera un rectángulo alrededor de las coordenadas del lugar.» «No confundas el bounding box de Nominatim con la geometría administrativa real.»
S4. «En los resultados muestra únicamente el nombre del lugar, por ejemplo: Tuxtla Gutiérrez» «Conserva la deduplicación ya implementada, priorizando el límite administrativo frente al punto correspondiente.»
S5. «Inspecciónala y úsala como guía visual para rediseñar específicamente el selector de fechas del Catálogo GCOV · ASF.» «Permite limpiar las fechas y valida que Desde no sea posterior a Hasta.» «No cambies la lógica de búsqueda GCOV; únicamente mejora la presentación y experiencia de selección de fechas.»
S6. «Agrega pruebas que demuestren» geometría original, rectángulo interior con covers, extensión máxima, punto, identidad visual/guardado/backend, deduplicación, fechas y filtros ASF. «No modifiques el procesamiento científico, no elimines funciones existentes y no hagas commit ni push.»

## Tasks
T1 [S1-S3,S6] route: bounded writer + parent correction; status: done; commit: none per user; evidence: 43 Django geosearch/GCOV tests pass, including Shapely covers over holes/islands/concavity and no-solution error.
T2 [S4-S5,S6] route: bounded writer + parent CSS/build correction; status: done; commit: none per user; evidence: 48 web tests, build and focused lint pass; date controls use container width and clean labels.
T3 [S1,S5,S6] route: parent integration, independent verifier, docs; status: blocked (waits for browser visual evidence of calendar popup and mask); commit: none per user; evidence: confirmed geometry source and full inverse visual mask; independent verifier identified date remount bug, corrected with lifted filter state; 43 Django and 49 web tests, web build, focused lint and LaTeX compile passed. Browser unavailable in this environment.

## Log
L1 (solicitud original, verbatim):
## Corrección obligatoria — ROI administrativa, rectángulos interiores y estilos de interfaz

La implementación sigue siendo incorrecta. Necesito que corrijas el comportamiento real de la selección geográfica y mejores el selector de fechas GCOV.

**Antes de modificar código, inspecciona el flujo completo desde Nominatim hasta la geometría que finalmente se dibuja y guarda en el mapa. No apliques otra solución superficial.**

### 1. Utilizar los límites administrativos REALES

Cuando Nominatim/OpenStreetMap devuelva un resultado `boundary=administrative` con geometría `Polygon` o `MultiPolygon`:

- **Si el límite administrativo completo cabe dentro de las restricciones**, utiliza EXACTAMENTE el polígono original de OpenStreetMap.
- No lo conviertas en cuadrado, rectángulo, bounding box ni otra geometría.
- Conserva su forma irregular, vértices y límites originales.
- La ROI visualizada, confirmada, guardada y enviada al backend debe ser la misma geometría.

Restricciones: radio de análisis configurable de 1 a 15 km, predeterminado 5 km, y extensión angular máxima de 0.6° por eje.

### 2. Si el límite administrativo es demasiado grande

Cuando la geometría administrativa supere las dimensiones permitidas:

- Genera una **ROI rectangular completamente contenida dentro del polígono administrativo original**.
- Utiliza un punto interior representativo como referencia inicial, pero no asumas que un rectángulo centrado en él estará completamente dentro.
- Calcula un rectángulo que respete el radio configurado y la extensión máxima de 0.6° por eje.
- Verifica geométricamente que el rectángulo completo esté contenido dentro del límite administrativo, incluyendo sus bordes, huecos e islas.
- Si no cabe, desplaza el centro o reduce progresivamente las dimensiones hasta encontrar una solución válida.
- Prioriza un rectángulo de mayor superficie que se encuentre razonablemente cerca de la zona central.
- No utilices simplemente la intersección del rectángulo con el límite administrativo, porque el resultado dejaría de ser rectangular.
- No permitas que ninguna parte del rectángulo quede fuera de la región.
- Si no es posible generar un rectángulo válido, informa al usuario y permite delimitar manualmente. No inventes una ROI.

Ejemplo: si selecciono Chiapas, quiero un rectángulo de análisis dentro de Chiapas, no un cuadrado que pueda cruzar las fronteras del estado.

### 3. Si únicamente existe un punto

Solamente cuando no exista una geometría administrativa utilizable:

- Genera un rectángulo alrededor de las coordenadas del lugar.
- Respeta el radio configurado y el límite angular de 0.6° por eje.
- Muestra un aviso sencillo indicando que no se encontraron límites automáticos y se generó una región rectangular aproximada.

**Orden de prioridad obligatorio:**

1. Polígono administrativo original, si cabe.
2. Rectángulo completamente interior al polígono administrativo, si este es demasiado grande.
3. Rectángulo alrededor del punto, únicamente si no hay límites administrativos disponibles.

No confundas el `bounding box` de Nominatim con la geometría administrativa real. Si no se recibe el GeoJSON original, investiga por qué y corrige la consulta o la transformación correspondiente.

### 4. Nombres limpios en resultados

No quiero etiquetas como «condado», `county`, `administrative`, `municipality`, `Point` o `Polygon`.

En los resultados muestra únicamente el **nombre del lugar**, por ejemplo:

**Tuxtla Gutiérrez**

Mantén internamente la jerarquía administrativa para deduplicar y distinguir lugares, pero no la muestres como clasificación técnica. Conserva la deduplicación ya implementada, priorizando el límite administrativo frente al punto correspondiente.

### 5. Mejorar el selector de fechas GCOV

Dejé una nueva captura de referencia en la carpeta `references/`.

**Inspecciónala y úsala como guía visual para rediseñar específicamente el selector de fechas del Catálogo GCOV · ASF.**

Quiero reemplazar los campos actuales de fecha, que se ven apretados y poco cuidados, por controles bien distribuidos y consistentes con la referencia.

- Mantén las opciones «Desde» y «Hasta».
- Utiliza selectores de fecha visualmente claros y correctamente alineados.
- Evita que los campos se encimen o desborden el panel lateral.
- Respeta la tipografía, colores, bordes, espaciados y demás estilos de la referencia.
- Asegura que los calendarios desplegables no queden recortados por el contenedor lateral.
- Permite limpiar las fechas y valida que «Desde» no sea posterior a «Hasta».
- Conserva los valores seleccionados y la integración con la búsqueda ASF existente.
- No cambies la lógica de búsqueda GCOV; únicamente mejora la presentación y experiencia de selección de fechas.

No inventes un diseño diferente sin revisar primero la referencia.

### 6. Verificación obligatoria

No consideres terminada la tarea simplemente porque una ROI se dibuja en el mapa.

Agrega pruebas que demuestren:

- Que un polígono administrativo pequeño conserva su geometría original.
- Que una región administrativa grande genera un rectángulo completamente interior, verificándolo con operaciones geométricas reales como `covers`.
- Que ningún rectángulo excede 0.6° en latitud o longitud.
- Que una ubicación puntual genera correctamente la ROI alternativa.
- Que el GeoJSON mostrado coincide con el que se guarda y se envía al backend.
- Que los resultados no vuelven a aparecer duplicados.
- Que los selectores de fecha funcionan correctamente y mantienen los filtros ASF.

**Revisa especialmente si existe alguna normalización, conversión a bounding box o validación en frontend/backend que esté forzando rectángulos para todas las ROI. Esa es una posible causa del problema y debes investigarla.**

No modifiques el procesamiento científico, no elimines funciones existentes y no hagas commit ni push.

Al finalizar, explica cuál era la causa de que se generaran cuadrados, cómo la corregiste y qué pruebas demuestran que ahora funciona correctamente.
L2: Inspección previa: geosearch consulta GeoJSON polygon_geojson=1, _validated_geometry conserva shape, LocationRoi preserva límite pequeño pero genera rectángulo alrededor de representative_point sin covers; frontend confirma effectiveRoi en App, lo persiste useSavedMaps y lo transmite a ASF; croppedRegion era máscara visual derivada y perdía islas/huecos. Capturas references/ubicacion_catalogo_referencia.png y ubicacion_catalogo_actual.png inspeccionadas.
L3: Pruebas finales locales: 43 backend tests, 49 web tests, compilación web, lint focalizado y compilación de docs/features/seleccion-geografica-roi.tex pasaron. RDD assess no disponible por binario local faltante; navegador visual no disponible en entorno. Sin commit/push.
L4: El verificador independiente halló que la clave de montaje de GcovCatalog borraba fechas al confirmar una nueva ROI o cambiar mapa. RED agregado y corregido elevando estado de Desde/Hasta al Sidebar; 49 web tests, build, lint focalizado GREEN. Verificación visual real de calendario y máscara pendiente por falta de navegador instalado; no se declara finalizada.
