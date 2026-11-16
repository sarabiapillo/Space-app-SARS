# Selección geográfica inteligente de ROI
Branch: current (no commit or push, by explicit request). Delivery: uncommitted; backend/frontend/documentation slices. Runner: backend Django tests, web Node tests/build.

## Specs
S1. «Inspecciona primero el código existente, implementa los cambios necesarios»; «Reutiliza la arquitectura y las funcionalidades existentes. No dupliques servicios ni componentes.»
S2. «Agrupe resultados que correspondan realmente al mismo lugar, utilizando nombre normalizado, país, jerarquía administrativa e identificadores de OpenStreetMap cuando estén disponibles.» «Priorice el resultado boundary=administrative que tenga una geometría válida.» «Oculte el resultado puntual duplicado.» «No dependa exclusivamente de que los nombres completos (display_name) sean idénticos.» «Considere diferencias de acentos, mayúsculas y nombres alternativos.» «No fusione una ciudad y un municipio si representan entidades geográficas diferentes; en ese caso, muéstralos con nombres comprensibles que permitan distinguirlos.» «Evite que resultados duplicados reaparezcan al actualizar la búsqueda o cambiar el radio.» «Revisa el proceso completo de deduplicación antes de renderizar resultados, no solamente el componente visual.»
S3. «Mantén el radio predeterminado de 5 km y el rango configurable de 1 a 15 km.» «Mantén el límite angular obligatorio de 0.6° por eje.» «Utiliza cálculos geodésicos para convertir kilómetros a coordenadas geográficas.»
S4. «Si el límite administrativo completo cabe dentro de las restricciones, utiliza EXACTAMENTE el polígono original de OpenStreetMap.» «No lo conviertas en cuadrado, rectángulo, bounding box ni otra geometría.» «Genera una ROI rectangular completamente contenida dentro del polígono administrativo original.» «Verifica geométricamente que el rectángulo completo esté contenido dentro del límite administrativo, incluyendo sus bordes, huecos e islas.» «Si no cabe, desplaza el centro o reduce progresivamente las dimensiones hasta encontrar una solución válida.» «Prioriza un rectángulo de mayor superficie que se encuentre razonablemente cerca de la zona central.» «No utilices simplemente la intersección del rectángulo con el límite administrativo, porque el resultado dejaría de ser rectangular.» «No permitas que ninguna parte del rectángulo quede fuera de la región.» «Si no es posible generar un rectángulo válido, informa al usuario y permite delimitar manualmente. No inventes una ROI.»
S5. «Si únicamente existe un punto geográfico y no se pueden obtener límites administrativos, genera una ROI rectangular alrededor de ese punto.» «La ROI rectangular debe ser un GeoJSON `Polygon` válido en EPSG:4326.»
S6. «Mantén las alertas informativas existentes, adaptando los mensajes a la generación de rectángulos y mostrando el radio realmente aplicado.» «No se pudieron encontrar los límites automáticos de la región. Se generó un área rectangular con un radio de 5 km alrededor del punto seleccionado.»
S7. «Mantener el diseño actual de TerraPulse y reutilizar el panel «Buscar ubicación».» «Actualizar la ROI y su visualización al cambiar el radio.» «Permitir confirmar, editar o reemplazar la ROI utilizando las herramientas existentes.» «Y usa la interfaz de referencia que te deje en references (no tiene que ser exactamente igual pero que se vea mejor que la actual)».
S8. «Enviar siempre la geometría efectiva de análisis, no necesariamente la geometría administrativa completa.» «Validar o recalcular la ROI en el backend.» «Conservar internamente el nombre de la ubicación, coordenadas centrales, radio, fuente y tipo de generación de ROI.» La restricción rectangular aplica solo a las ROI alternativas; el flujo completo admite `Polygon` y `MultiPolygon` de límites administrativos. «Utilizar la ROI resultante para buscar productos NISAR GCOV mediante el flujo ASF existente.»
S10. «En los resultados muestra únicamente el nombre del lugar, por ejemplo: Tuxtla Gutiérrez.» «Mantén internamente la jerarquía administrativa para deduplicar y distinguir lugares, pero no la muestres como clasificación técnica.» S11. «Inspecciónala y úsala como guía visual para rediseñar específicamente el selector de fechas del Catálogo GCOV · ASF.» «Mantén las opciones «Desde» y «Hasta».» «Permite limpiar las fechas y valida que «Desde» no sea posterior a «Hasta».» «Conserva los valores seleccionados y la integración con la búsqueda ASF existente.» «No cambies la lógica de búsqueda GCOV; únicamente mejora la presentación y experiencia de selección de fechas.» «No inventes un diseño diferente sin revisar primero la referencia.»
S9. «Implementa pruebas para: Deduplicación de resultados y prioridad administrativa. Localidades que solo tienen coordenadas puntuales. Regiones administrativas pequeñas. Regiones administrativas que superan el radio. Intersecciones `Polygon` y `MultiPolygon`. Cambio dinámico del radio. Geometrías inválidas o vacías. Persistencia de la ROI y compatibilidad con la búsqueda GCOV.» «No modifiques funcionalidades ajenas a esta implementación, no agregues dependencias innecesarias y no hagas commit ni push.»

## Tasks
T1 [S1,S2,S9] route: parent exploration then backend worker; status: done; commit: none; evidence: RED/GREEN, backend geosearch 15 tests passing.
T2 [S2,S3,S4,S5,S8,S9] route: backend worker; status: done; commit: none; evidence: RED/GREEN 21 geosearch tests incl. Tuxtla-like dedup and original-geometry preservation; 39 backend OK integrated.
T3 [S2,S3,S6,S7,S8,S9] route: frontend worker; status: done; commit: none; evidence: 45 web tests (6 mandatory scenarios), build, focused ESLint; preview==saved==GCOV geometry regression.
T5 [S4,S8,S9] route: backend worker; status: in_progress (inscribed rectangle fully inside admin polygon, covers-verified; original preserved); commit: none.
T6 [S2,S7,S10,S9] route: frontend worker; status: in_progress (clean names, remove dead administrative_bbox alias, inscribed-rectangle alert); S11 cancelled by user L16; commit: none.
T7 [S7,S9] route: parent; status: pending (LaTeX + integrated verification + cause explanation); commit: none.
T4 [S7,S9] route: parent; status: done for available verification; commit: none; evidence: integrated 39/9/45 green; LaTeX recompiled; browser E2E and real Nominatim/ASF unverified.

## Log
L1 (original request, verbatim): «Quiero mejorar el buscador geográfico de TerraPulse para que el usuario pueda seleccionar cualquier ciudad, municipio, estado, país o localidad y obtener automáticamente una ROI válida, sin preocuparse por los tipos de geometría que devuelve OpenStreetMap.» «No modifiques funcionalidades ajenas a esta implementación, no agregues dependencias innecesarias y no hagas commit ni push.» «Y usa la interfaz de referencia que te deje en references (no tiene que ser exactamente igual pero que se vea mejor que la actual)».
L2: La rama ya contiene cambios no confirmados, incluidos archivos geosearch/ROI y otros trabajos; preservar todo lo ajeno. La interfaz actual guarda un único anillo ROI en croppedRegion y rechaza multipolígonos. La referencia muestra flujo compacto de selección y catálogo, no autoriza mostrar metadatos técnicos.
L3: Backend worker reported RED/GREEN: 15 geosearch, 18 GCOV Django and 9 pipeline ROI pytest; exact original small polygon and clipped multi preserved. Backend retained 0.6-degree validator and explicitly rejects antimeridian/poles; these limit requested universal 1–30 km support and must be surfaced unless corrected.
L4: Frontend worker reported RED/GREEN web 22 targeted tests, build and focused lint; full lint blocked by pre-existing ScientificFiguresViewer issue. Full effective geometry and metadata preserved in localStorage and sent to GCOV/ROI jobs; browser E2E unverified. LaTeX feature document compiled with pdflatex in scratch directory and scratch removed.
L5 (user correction, verbatim):
**Corrección a la implementación en curso:**

Ajusta la lógica de generación de ROI del prompt anterior con estas condiciones:

1. **Todas las ROI generadas automáticamente deben ser rectangulares**, incluso cuando la ubicación tenga límites administrativos. Utiliza su bounding box si cumple las restricciones.

2. **Reduce el radio máximo configurable de 30 km a 15 km**, manteniendo 5 km como valor predeterminado.

3. **Restricción obligatoria:** ninguna ROI puede superar **0.6° de latitud ni 0.6° de longitud**. Valida ambos límites en frontend y backend.

4. Si los límites administrativos superan el tamaño permitido, genera un rectángulo centrado en un punto representativo dentro de la región, respetando el radio configurado y los límites angulares.

5. Si los límites administrativos caben dentro del tamaño configurado, utiliza su bounding box rectangular.

6. Si solo existe un punto, genera un rectángulo centrado en sus coordenadas con el radio configurado.

7. Utiliza cálculos geodésicos para convertir kilómetros a coordenadas geográficas. No sumes kilómetros directamente a grados.

8. Conserva la deduplicación del prompt anterior: **prioriza resultados administrativos frente a puntos duplicados**.

9. Mantén las alertas informativas existentes, adaptando los mensajes a la generación de rectángulos y mostrando el radio realmente aplicado.

**Importante:** esta instrucción corrige y complementa el prompt que ya estás ejecutando. No reinicies la implementación ni deshagas avances; adapta los cambios en curso a estas restricciones. No hagas commit ni push.
L6: Backend correction passes 36 Django tests for geosearch+GCOV, new RED/GREEN test proves administrative 0.2° bbox with 5km uses centered rectangle and with 15km bbox. Existing 0.6° constraints retained. Antimeridian/poles deliberately rejected because ASF single-WKT path unverified. LaTeX rewritten to reflect rectangles and compiled.
L7: Frontend corrected to 15km maximum and 0.6° rectangular validation, applied-radius informational alerts, 38 web Node tests and build plus focused ESLint passed per worker. Integrated backend/pipeline/web tests passed 36/9/38, LaTeX compiled. Native assess unavailable (package-local-binary-missing); full lint previously failed in unrelated ScientificFiguresViewer.tsx.
L8: Independent verifier reported blocking Risk item 3: App sets effectiveRoi with croppedRegion:null, but MapCanvas gates temporal swipe on !croppedRegion, allowing noncomparable manifests for automatic ROI; crop mask/center and solar control also depend only on croppedRegion. T3 reopened for scoped correction and focused regression checks.
L9 (user): «Pausa la implemenación por un momento, documenta lo qu falta» — the shared-state correction worker started but failed on subagent quota before any edit; no fix landed. Remaining work documented in L10; no new verification ran during the pause.
L10 (pendiente, estado al pausar): (1) Corregir estado compartido de ROI automática (T3): comparador temporal nunca activo con manifestos no comparables tras ROI automática, incluido recarga/cambio de mapa; máscara, centrado y control solar deben reconocer la ROI efectiva; dibujo manual sigue reemplazando y limpiando effectiveRoi; respuestas asíncronas obsoletas guardadas. Prueba de regresión RED/GREEN y suite web completa + build + lint focalizado. (2) Verificación independiente posterior y suites backend/pipeline/web 36/9/38 tras la corrección. (3) LaTeX final con resultados observados post-corrección (hoy compila con resultados previos) y verificación de compilación. (4) Sin commit ni push (expreso del usuario). Restricciones permanentes: antimeridiano y latitudes ≥85° rechazados explícitamente; ASF recibe una sola geometría WKT; lint global bloqueado por error preexistente en ScientificFiguresViewer.tsx; sin prueba visual de navegador ni consulta real Nominatim/ASF.
L11: Reanudado por el usuario («continúa con la inplementación»). Corrección compartida completada: confirmación guarda effectiveRoi + anillo rectangular equivalente en croppedRegion; swipe exige roiLayers.comparable (MapCanvas ~1981/2367/3036); App normaliza dateViewMode con confirmedROI; manual MultiPolygon persiste. Suites integradas tras la corrección: backend 36 OK, pipeline 9, web 39, build y lint focalizado aprobados. LaTeX recompilado con resultados observados. E2E de navegador y consulta real Nominatim/ASF siguen sin ejecutarse.
L12 (user correction, verbatim):
**Corrección de errores en el buscador geográfico y generación de ROI de TerraPulse**

La implementación actual presenta dos problemas que debes investigar y corregir, sin rehacer el módulo ni modificar funcionalidades que ya trabajan correctamente.

### 1. Respetar las geometrías administrativas originales

Actualmente parece que todas las ubicaciones terminan generando una ROI rectangular, incluso cuando existe una geometría administrativa válida.

**Corrige esta lógica:**

- Si el resultado seleccionado contiene una geometría administrativa válida (`Polygon` o `MultiPolygon`) y su extensión completa cabe dentro del límite configurado, **utiliza el polígono original, conservando su forma y sus coordenadas**. No lo conviertas a rectángulo ni a `bounding box`.
- Si los límites administrativos exceden el tamaño permitido, genera una ROI rectangular centrada en un punto representativo del área.
- Si únicamente existe un punto geográfico y no se pueden obtener límites administrativos, genera una ROI rectangular alrededor de ese punto.
- Mantén el radio predeterminado de 5 km y el rango configurable de 1 a 15 km.
- Mantén el límite angular obligatorio de 0.6° por eje.

Para determinar si un límite administrativo cabe dentro del radio configurado, evalúa su extensión geográfica completa y sus distancias reales en kilómetros, no solamente su superficie. Una geometría solo cabe si está contenida dentro de la ventana permitida.

**Importante:** la restricción de forma rectangular aplica únicamente a las ROI generadas como alternativa. Si existe un límite administrativo válido que cabe dentro de las restricciones, conserva su geometría original aunque sea irregular.

Revisa especialmente si algún componente del frontend, normalizador GeoJSON o endpoint del backend está convirtiendo automáticamente todas las ROI a rectángulos. Corrige esa transformación y asegúrate de que el flujo completo admita `Polygon` y `MultiPolygon` cuando provengan de límites administrativos.

### 2. Corregir los resultados duplicados

Actualmente algunas ciudades, como Tuxtla Gutiérrez, aparecen dos veces.

Implementa una deduplicación que:

- Agrupe resultados que correspondan realmente al mismo lugar, utilizando nombre normalizado, país, jerarquía administrativa e identificadores de OpenStreetMap cuando estén disponibles.
- Priorice el resultado `boundary=administrative` que tenga una geometría válida.
- Oculte el resultado puntual duplicado.
- No dependa exclusivamente de que los nombres completos (`display_name`) sean idénticos.
- Considere diferencias de acentos, mayúsculas y nombres alternativos.
- No fusione una ciudad y un municipio si representan entidades geográficas diferentes; en ese caso, muéstralos con nombres comprensibles que permitan distinguirlos.
- Evite que resultados duplicados reaparezcan al actualizar la búsqueda o cambiar el radio.

**Revisa el proceso completo de deduplicación antes de renderizar resultados, no solamente el componente visual.**

### 3. Pruebas obligatorias

Verifica al menos estos escenarios:

1. Una localidad con límites administrativos pequeños conserva su polígono original.
2. Una región administrativa demasiado grande genera un rectángulo limitado.
3. Un lugar que únicamente tiene coordenadas genera un rectángulo.
4. Tuxtla Gutiérrez no aparece duplicado cuando ambos resultados representan el mismo lugar.
5. Dos lugares diferentes con el mismo nombre no se fusionan incorrectamente.
6. Las ROI originales y alternativas cumplen las restricciones espaciales y pueden confirmarse y enviarse al backend.

Agrega pruebas de regresión y verifica que la geometría visualizada en el mapa sea la misma que se guarda y posteriormente se utiliza para buscar GCOV.

**No modifiques el procesamiento SAR, las descargas GCOV ni el diseño general de la interfaz. No hagas commit ni push.**

Investiga la causa real de ambos problemas, corrígelos y explica qué originaba cada uno y cómo verificaste su solución.
L13 (análisis de causa): (1) La instrucción L5 anterior exigía ROI rectangulares para toda selección; el backend pasó a devolver bbox/rectángulo siempre (administrative_bbox/administrative_rectangle) y el frontend añadió isRectangularEffectiveRoi, que rechaza cualquier geometría no rectangular antes de previsualizar o confirmar. Esa combinación convierte o bloquea los polígonos administrativos originales. (2) La dedup exige identidad OSM exacta o coincidencia de nombre + jerarquía completa + cobertura; un punto ciudad y un límite municipal con claves de dirección distintas (city vs municipality) no se agrupan y ambos se renderizan.
L14: Corrección L12 completada. Backend: administrative_original devuelve la geometría del proveedor sin reproyectar cuando toda su extensión cabe geodésicamente en la ventana (proyección aeqd local, vértices dentro de ±radio y ejes ≤0.6°); dedup _same_place agrupa identidad OSM o nombre primario normalizado + país + estado (si ambos) + punto cubierto por el polígono. Frontend: isAcceptableEffectiveRoi acepta Polygon/MultiPolygon originales con ejes ≤0.6° (rectangular solo para generaciones alternativas); etiquetas comprensibles Ciudad/Municipio/Pueblo; dedup frontend reforzada por identidad; croppedRegion derivado del anillo exterior (parte mayor en MultiPolygon, máscara aproximada; análisis/persistencia/GCOV usan geometría completa). Verificación integrada: backend 39 OK, pipeline 9, web 45, build y lint focalizado aprobados; LaTeX recompilado con resultados observados. Pendiente: E2E navegador y consulta real Nominatim/ASF; native assess sigue unavailable (package-local-binary-missing).
L15 (user correction, verbatim):
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
- Evita que los campos se enciman o desborden el panel lateral.
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
L16 (user, verbatim, respuesta a la pregunta sobre la referencia del selector de fechas): «Usaré otro modelo, cancela la operación» — el rediseño del selector de fechas (S11/T6-parte-5) queda cancelado en esta sesión; el usuario lo abordará con otro modelo. El resto de la corrección L15 (§1-4 y §6) continúa autorizado.
L17 (resultado de la inspección del flujo, explorador mwieqnij-f): No queda ninguna conversión activa polígono→bbox en frontend: isAcceptableEffectiveRoi acepta administrative_original con Polygon/MultiPolygon (web/src/utils/roi.ts:53-56) y el preview renderiza la geometría completa (MapCanvas.tsx:879-886). Restos a corregir: App.tsx:327 referencia el alias muerto 'administrative_bbox' que el backend nunca emite; el backend aún genera administrative_rectangle centrado sin verificar contención (geosearch.py:351-394) — L15 §2 exige rectángulo inscrito verificado con covers; Nominatim se consulta con polygon_geojson=1 sin simplificación añadida (geosearch.py:110-111); el raster C1 es el rectángulo contenedor por diseño del pipeline (subset.py:204-206), no un defecto de esta feature.
