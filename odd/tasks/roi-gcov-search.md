# Búsqueda geográfica y catálogo GCOV con descarga ROI
Branch: feature/roi-gcov-search. Delivery: uncommitted per explicit user request; no push. Runner: pytest, web build/tests.
Strategy: no commits/PR; slices by independent behavior. Forecast: >400 authored lines; review locally by backend, frontend and documentation.

## Specs
S1. «Antes de modificar código: Revisa la captura de pantalla de la interfaz actual ubicada en `references/`. Explora la arquitectura del frontend y backend.» «Reutiliza lo existente. No dupliques funcionalidades ni reemplaces componentes que ya funcionan.»
S2. «No quiero un rediseño completo desde cero, sino una reorganización funcional y visual de la interfaz existente.» «El mapa debe seguir siendo el elemento principal, con la mayor superficie útil posible.» Mantener barra superior, panel lateral plegable, controles de mapa y dibujo compactos, capas SAR, comparador y panel inferior.
S3. «Buscar lugar → Seleccionar región → Visualizar GeoJSON → Confirmar ROI → Buscar GCOV → Visualizar escenas → Seleccionar → Descargar → Procesar.» «No confundir ciudad, municipio y área urbana.» «No utilizar autocompletado con el Nominatim público.» «No descargar ni almacenar una base mundial completa de ciudades.»
S4. «Filtrar exclusivamente los productos GCOV correspondientes.» «No asumir que una intersección significa cobertura completa.» «Limitar las búsquedas sobre áreas demasiado grandes para evitar operaciones costosas.» Resultados con metadatos, cobertura, filtros de fecha y orden; selección t1/t2 sin alterar comparador.
S5. «Nunca exponer credenciales Earthdata al frontend.» «Evitar descargas duplicadas.» «No bloquear peticiones HTTP durante descargas grandes.» «No comenzar descargas sin confirmación del usuario.» Descarga confirmada: «descargar el recorte de la ROI», no escena completa.
S6. «Agrega pruebas para búsqueda geográfica, validación de geometrías, cobertura espacial, búsqueda de escenas, descarga y manejo de errores. Utiliza mocks para evitar descargas reales innecesarias.» «No hagas commit ni push.» Documentación LaTeX aplazada: «Autorizo no documentar en latex por ahora, continua con lo necesario».
S7. «Bien, solo que quiero que quites todo tipo de información de ROI preseleccionados, todo lo que aparece tiene que ser lo que se calcula del roi que el usuario delimita, nada de mocks».
S8. «Tu cambiaste el mapa que estaba antes? quien de todas las sessions realizo el cambio al mapa de open street? yo nunca pedí eso» — preserve the original Esri basemap while removing only the synthetic SAR/ROI overlay.

## Tasks
T1 [S1,S3,S4] route: parent read-only; status: done; commit: none; evidence: screenshot references/image.png inspected, code paths mapped, Nominatim policy and ASF docs consulted.
T2 [S3,S4,S5,S6] route: bounded writer (context backstop); status: blocked (waits for operator storage isolation/quota and public-access policy decision); commit: none per user; evidence: 24 backend and 22 targeted pipeline tests GREEN, no real Earthdata run. Mirror: pending full-content sync.
T3 [S2,S3,S4,S5,S6] route: bounded writer (context backstop); status: blocked (waits for decision whether to extend mock-only comparator for arbitrary ASF scenes); commit: none; evidence: build, focused lint and 11 web node tests GREEN; metadata-only pair selection.
T4 [S6] route: parent; status: dropped (user deferred LaTeX); commit: none; evidence: temporary untracked LaTeX file removed by parent.
T5 [S2,S3,S4,S5,S6] route: parent + independent verifier (risk 2/4); status: blocked (waits for operator policy and native review availability); commit: none; evidence: independent verifier found and corrected C1 and lock issues; native assess unavailable (package-local-binary-missing).
T6 [S6] route: parent; status: blocked (waits for unrelated suite/lint environment fixes); commit: none; evidence: 7 global ESLint errors in unrelated files, 16 full pipeline failures (environment/other routes), focused checks pass.
T7 [S7,S8] route: bounded writer (context backstop); status: done; commit: none per user; evidence: Esri basemap restored, bootstrap empty, legacy c1 read-only preserved and v2 keys for user saves; behavioral seeded/demo test + focused lint + build GREEN.
T8 [S7] route: parent after worker quota failure; status: done; commit: none; evidence: C4 fallback removed, legacy Sidebar panels removed, gallery with fixed scientific figures disconnected, Header enabled by real manifests only; web build/26 Node tests/focused lint GREEN. Solar preset cleanup assigned T10.
T9 [S7,S6] route: parent + independent verifier (risk 3/6); status: done for available local verification, final review and real-data proof unavailable; commit: none (user forbids); evidence: RED→GREEN 30 web tests, build, focused lint and git diff --check pass after concurrent onNotify integration completed; 22 pipeline pytest and backend scene tests passed earlier. No Earthdata real data or browser visual proof.
T10 [S7] route: parent inline; status: done; commit: none; evidence: removed fixed solar ROI zones/radius-derived boxes; solar POST receives exact confirmed polygon, unavailable without ROI, clears saved solar raster on ROI change and invalidates pending async responses; 3 focused tests, web build/lint passed.

## Log
L1 (original request, verbatim):
# TerraPulse — Buscador geográfico e integración automática de NISAR GCOV

Quiero implementar un flujo completo para que el usuario pueda **buscar una ciudad, municipio, estado o país, seleccionar su región geográfica y encontrar y descargar productos NISAR L2 GCOV disponibles para esa ubicación**.

Además, quiero reorganizar la interfaz actual para mejorar su jerarquía visual, distribución de controles y experiencia de usuario, manteniendo su estilo de aplicación GIS profesional.

## 1. Inspección inicial (obligatoria)

Antes de modificar código:

- Revisa la captura de pantalla de la interfaz actual ubicada en `references/`.
- Explora la arquitectura del frontend y backend.
- Identifica los componentes existentes del mapa, herramientas de dibujo, selector ROI, catálogo ASF, capas SAR y comparador temporal t1/t2.
- Revisa si ya existen endpoints o servicios para consultar ASF Search, buscar GCOV, autenticarse con NASA Earthdata y descargar archivos.
- Identifica los mecanismos actuales de almacenamiento, procesamiento y gestión de tareas.

**Reutiliza lo existente. No dupliques funcionalidades ni reemplaces componentes que ya funcionan.**

## 2. Reorganización de la interfaz

Mejora la distribución de controles tomando como referencia la captura proporcionada.

Mantén la identidad visual actual, pero reduce la saturación de botones y mejora la organización.

Distribución deseada:

**Barra superior**
- Navegación principal: Archivo, Escenas GCOV, Procesamiento SAR, Validación, Ventana y Exportar.
- Mantener información relevante del producto y proyecto sin saturar la barra.

**Panel lateral izquierdo**
Organizar en secciones claras, preferiblemente plegables:

- **Explorador:** mapas guardados, análisis y capas existentes.
- **Buscar ubicación:** buscador de ciudades, estados, municipios y países.
- **Catálogo GCOV:** escenas locales y resultados de búsquedas en ASF.

**Barra de herramientas del mapa**
- Agrupar controles de navegación, zoom, centrar ROI y herramientas de dibujo.
- Evitar botones redundantes y controles dispersos.
- Mantener accesibles las herramientas utilizadas frecuentemente.

**Panel de dibujo y geometría**
- Reducir su tamaño y reorganizar sus controles.
- Convertirlo en una herramienta compacta que pueda desplegarse cuando sea necesaria.
- Conservar las funciones actuales de dibujo, edición y selección de ROI.

**Controles de capas SAR**
- Agrupar selección de banda, rampa de color, opacidad y comparación temporal.
- Mantener la funcionalidad del comparador t1/t2.
- Evitar que estos controles ocupen espacio innecesario del visor.

**Panel inferior**
- Conservar logs, progreso, advertencias y trazabilidad.
- Permitir contraerlo y expandirlo fácilmente.

El mapa debe seguir siendo el elemento principal, con la mayor superficie útil posible.

**No quiero un rediseño completo desde cero, sino una reorganización funcional y visual de la interfaz existente.**

## 3. Buscador geográfico

Implementa un selector que permita buscar ubicaciones por nombre.

Flujo:

1. El usuario escribe, por ejemplo, «Tuxtla Gutiérrez, Chiapas».
2. Se consulta un servicio de geocodificación.
3. Se muestran resultados con nombre, país y nivel administrativo.
4. El usuario selecciona una ubicación.
5. Se obtiene su geometría GeoJSON (`Polygon` o `MultiPolygon`).
6. El mapa se centra en la región y muestra sus límites.
7. El usuario puede confirmar la ROI o modificarla mediante las herramientas existentes.

Evalúa Nominatim/OpenStreetMap y geoBoundaries, seleccionando la solución más adecuada.

Consideraciones:
- Utilizar geometrías reales en EPSG:4326.
- Diferenciar puntos geográficos de límites administrativos.
- No confundir ciudad, municipio y área urbana.
- Validar geometrías y manejar resultados ambiguos.
- Incorporar caché de ubicaciones.
- Respetar los límites y políticas del proveedor; no utilizar autocompletado con el Nominatim público.
- No descargar ni almacenar una base mundial completa de ciudades.

## 4. Integración frontend-backend

El frontend debe enviar al backend la ROI seleccionada en formato GeoJSON.

Reutiliza los endpoints existentes cuando sea posible. Si faltan funcionalidades, implementa las necesarias para:

- Buscar ubicaciones.
- Obtener sus geometrías.
- Consultar escenas NISAR GCOV disponibles para una ROI.
- Obtener metadatos de las escenas.
- Solicitar descargas.
- Consultar el estado de cada descarga.

Mantén contratos de API consistentes con la arquitectura actual.

## 5. Búsqueda de productos NISAR GCOV

Inspecciona primero si el proyecto ya utiliza `asf_search`, ASF Search API o NASA CMR.

Implementa o completa la búsqueda espacial de productos NISAR L2 GCOV utilizando el polígono seleccionado.

El sistema debe:

- Filtrar exclusivamente los productos GCOV correspondientes.
- Buscar escenas cuyas huellas intersecten la ROI.
- Calcular el porcentaje de cobertura geográfica.
- Distinguir cobertura total y parcial.
- Mostrar fecha, polarizaciones, identificador, madurez, tamaño y otros metadatos disponibles.
- Permitir filtrar por rango de fechas.
- Ordenar resultados por cobertura, fecha y calidad.
- Contemplar varias escenas si una sola no cubre toda la región.
- Informar correctamente cuando no existan datos disponibles.

No asumir que una intersección significa cobertura completa.

Limitar las búsquedas sobre áreas demasiado grandes para evitar operaciones costosas.

## 6. Visualización y selección de escenas

Dentro del catálogo GCOV, muestra los resultados de ASF de manera clara y compacta.

Al seleccionar una escena:

- Resaltar su huella sobre el mapa.
- Mostrar visualmente la cobertura respecto a la ROI.
- Presentar sus metadatos principales.
- Indicar si ya está descargada.
- Ofrecer una acción para descargarla.

Considera también la selección de dos adquisiciones compatibles para aprovechar el comparador temporal t1/t2 existente.

No modificar la lógica científica del comparador.

## 7. Descarga automática al servidor

Cuando el usuario solicite una descarga:

1. Validar el identificador de la escena.
2. Autenticarse de forma segura con NASA Earthdata.
3. Descargar el GCOV al almacenamiento del servidor.
4. Registrar estado, progreso, ruta y metadatos.
5. Verificar la integridad del archivo.
6. Incorporarlo al catálogo local existente.
7. Dejarlo disponible para el procesamiento SAR actual.

Requisitos:
- Nunca exponer credenciales Earthdata al frontend.
- Evitar descargas duplicadas.
- Manejar interrupciones, errores y archivos incompletos.
- Controlar espacio disponible y descargas concurrentes.
- Usar el sistema de tareas asíncronas existente, si lo hay.
- No bloquear peticiones HTTP durante descargas grandes.
- No comenzar descargas sin confirmación del usuario.

Revisa también si NASA Harmony puede resultar útil para obtener subconjuntos espaciales, pero no compliques innecesariamente el MVP.

## 8. Integración y pruebas

La funcionalidad debe conectarse al flujo actual:

**Buscar lugar → Seleccionar región → Visualizar GeoJSON → Confirmar ROI → Buscar GCOV → Visualizar escenas → Seleccionar → Descargar → Procesar.**

Comprueba que continúen funcionando los mapas guardados, herramientas ROI, capas SAR, controles de visualización, comparador temporal y procesamiento existente.

Agrega pruebas para búsqueda geográfica, validación de geometrías, cobertura espacial, búsqueda de escenas, descarga y manejo de errores. Utiliza mocks para evitar descargas reales innecesarias.

## 9. Criterios de implementación

- Respeta el stack y las convenciones del proyecto.
- Prioriza componentes reutilizables y código mantenible.
- Conserva el estilo visual de TerraPulse.
- Mejora la experiencia de usuario sin sobrecargar la interfaz.
- No introduzcas dependencias innecesarias.
- No alteres cálculos científicos ni funcionalidades ajenas al alcance.
- No hagas commit ni push.

**Resultado esperado:** una interfaz GIS más organizada, con herramientas distribuidas de manera lógica y un flujo completamente funcional para buscar ubicaciones, consultar la disponibilidad de NISAR GCOV y descargar escenas al servidor.

Comienza inspeccionando el código y la referencia visual. Después implementa los cambios necesarios, verifica su funcionamiento y entrega un resumen de qué reutilizaste, qué modificaste, qué endpoints intervienen, qué pruebas ejecutaste y qué limitaciones quedaron pendientes.
L2 (user confirmation, verbatim):
Listo, deje la carpeta references con una captura image.png
Si confirmo que significa eso, descargar el recorte de la ROI
L3: references/image.png inspected before source modification. Nominatim server-side explicit searches with cache/rate limiting are appropriate for name disambiguation; geoBoundaries ADM files require country/level downloads rather than direct text search. Existing pipeline subset is polygon-aware; existing web ROI job bounds apply; state/country outlines are preview only until a suitably small ROI is confirmed.
L4: T2 backend routes GET /api/locations, POST /api/gcov/search, POST /api/gcov/downloads, GET /api/gcov/downloads/<id>; verified 14 backend + 22 pipeline tests with mocks; no real external call. User prohibited commits. Full Engram mirror remains pending; index observation 315 exists.
L5: T3 frontend build passed after TypeScript fixes, 9 node tests passed; npm lint initially failed during setup, later -f json ran and found 7 unrelated existing violations outside edited paths. Backend multi-ROI storage collision and frontend no local availability indication identified for follow-up.
L6: Independent read-only verifier found candidate defects: same scene for different ROI fails, queued jobs orphan on restart, partial-polarization download fails, stale frontend results after ROI switch, no t1/t2 selection, malformed provider response can 500. Reopen T2/T3; proof remains incomplete until corrections run.
L7 (user correction, verbatim): Autorizo no documentar en latex por ahora, continua con lo necesario
L8: T2 corrections now support ROI-scoped C1 without overwrite, terminal interrupted jobs, scene polarizations, defensive geocoder response and downloaded field; 15 backend GCOV + 22 targeted pipeline tests passed. Full pipeline had 440 pass and 16 failures outside edited scope; follow-up required. Parent removed only its untracked LaTeX artifact per L7.
L9: T3 stale-result and polling invalidation plus exact-ROI downloaded state completed; 11 node tests, build and focused lint pass. Catalog supports pairing as metadata only; arbitrary ASF pair cannot reuse existing mock-only scientific comparator without changing its logic.
L10: Backend final 24 tests + 22 focused pipeline tests passed; frontend build, 11 tests, focused lint passed. Independent verifier found guardrail defects and corrections were applied to C1 metadata and lock cleanup; filesystem quota is not hard, no live network data tested. Global lint reports 7 unrelated failures; full pipeline suite 440 pass, 16 fail outside edited scope. Native ASSESS unavailable: package-local-binary-missing. No commits/push. Stop for deployment/access decision, plus verifier/environment gaps; never claim completed delivery.
L11 (user correction, verbatim): Bien, solo que quiero que quites todo tipo de información de ROI preseleccionados, todo lo que aparece tiene que ser lo que se calcula del roi que el usuario delimita, nada de mocks
L12: Current frontend bootstrap injects Chiapas scene/ROI figures and two demo maps via initialWorkspaces/useSavedMaps; client.ts has fallback synthetic C4 for endpoints some of which do not exist. Preserve user-drawn ROI and saved user maps; never delete old localStorage wholesale. Peer fixed MapCanvas SVG ghost at rotated map; preserve its patch. LaTeX remains deferred per L7.
L13 (user correction, verbatim): Tu cambiaste el mapa que estaba antes? quien de todas las sessions realizo el cambio al mapa de open street? yo nunca pedí eso
L14: The parent acknowledged its worker changed Esri World Imagery to OSM tiles without authorization, immediately restored original Esri raster source/layer in MapCanvas.tsx without reintroducing NISAR demo overlays. Concurrent peer owns flood-real-ROI edits in RainDg2Panel/initialWorkspaces; no more edits there until coordination. Current saved-map filter erroneously normalized before detecting seeded demos; fixed raw detection, original c1 storage left untouched, v2 for user edits. Actual Node behavior test passes for both original demo copies and edited saved ROI; build and focused lint pass. Peer continues flood ROI in independent files.
L15: Removed Sidebar static Chiapas stacks, synthetic comparator, fixed charts and scene table; Header shows/disables SAR/t1/t2 based only on actual ROI job manifests; App fixed scientific figures gallery disconnected because ROI job uses --sin-figuras. C4 client errors now surface instead of synthetic fallback. RightPanel solar fixed zones removed and exact ROI polygon sent, radius-derived mock area removed; 29 web Node tests and build/lint pass. Esri base preserved; flood peer changes untouched.
L16: Independent verifier found MapCanvas log still presents fallback range [-28.83, +9.78 dB], HDF5 processing flags, and default ASF identity true without manifest; RED test proves failure. Peer owned MapCanvas concurrent flood edits; asked for scoped permission before fixing that block. Solar pending responses now invalidated and GCOV footprint cleared on ROI change. Backend scene tests, 22 pipeline tests, web build and 29 web tests passed before adding the intentional RED log assertion; new log assertion fails as expected. No real Earthdata verification or release claim.
L17: Peer flood-real-ROI released MapCanvas and initialWorkspaces; preserved its flood invalidation and mask edits. Replaced fixed SAR bitácora t2 range, calibration flags, misleading HDF5 warning, and default ASF identity true with manifest-backed values or explicit 'Sin datos'; GREEN 29/29 web tests, build, focused lint and git diff --check passed at that snapshot. Solar simulation no longer silently fixes date 2026-06-21; date selector defaults to today's date in Mexico City and changing date clears pending/results. Backend/pipeline checks from L16 passed. No commit/push, as requested. Independent post-fix verifier and native RDD assessment unavailable (native package-local binary missing); no real Earthdata/visual check; access policy and ASF comparator decisions remain open.
L18: Further audit found flood overlay still displayed `escena.pila` and t1/t2 from saved demo scene. RED test then removed that stale subtitle and its unused escena prop. 29/29 web tests GREEN. New concurrent frontend changes to App/Sidebar introduced `onNotify` before GcovCatalog accepted it; an intermediate build failed TS2322. Did not edit concurrent paths; another writer completed GcovCatalog's onNotify contract. Latest npm build passes, 30/30 web tests GREEN, focused ESLint and git diff --check pass. The intermediate failure was not a release result.
