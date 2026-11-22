# Finalización solar idealizada
Estado: en curso; directorio compartido; sin ramas ni worktrees nuevos ni push. Commits locales estructurados autorizados por la última petición; la verificación interactiva sigue pendiente.

## Specs
S1. «Elimina completamente la selección y dependencia de fechas, horas y zonas horarias en el flujo de simulación solar, tanto en frontend como en backend.» «Elevación predeterminada: 45°.» «Azimut predeterminado: 180°, medido desde el norte en sentido horario.» «El usuario solamente debe seleccionar una ROI y ejecutar la simulación.» «Los controles de elevación y azimut estarán dentro de Ajustes avanzados, con rangos de 0°–90° y 0°–360°, respectivamente.» «Mantén la compatibilidad con simulaciones históricas y conserva únicamente timestamps administrativos cuando corresponda. No afectes las fechas t1/t2 de las escenas SAR ni otros módulos que utilizan zonas horarias.»
S2. «Los resultados deben representar irradiancia solar directa modelada (W/m²) bajo un escenario idealizado, no temperatura, radiación absorbida ni mediciones en tiempo real.» «Permite visualizar claramente: Irradiancia normal directa de entrada (DNI), en W/m². Irradiancia incidente mínima, máxima y promedio sobre el terreno, en W/m². Relación entre irradiancia incidente media y DNI, cuando corresponda. Factor de intensidad intensity_percent, correctamente identificado como porcentaje adimensional.» «Verifica cómo se calcula la DNI y asegúrate de que los cambios de elevación y azimut recalculen los valores físicos y no solamente los colores.» «Los parámetros utilizados deben conservarse en los metadatos.»
S3. «Utiliza el GeoTIFF Float32 como fuente numérica de verdad.» «Paleta Inferno y escala en W/m².» «Transparencia fuera del ROI.» «Alineación geoespacial y resolución visual adecuada.» «Consulta de irradiancia por ubicación.» «Isolíneas de igual irradiancia calculadas desde el raster, respetando NoData y los límites del ROI.» «Controles para mostrar u ocultar las isolíneas y consultar sus valores.» «No alteres los datos numéricos para mejorar la apariencia. Las isolíneas representan igual irradiancia, no dirección de flujo de calor.» «Cuando se active una copia solar, oculta automáticamente la capa SAR, sus leyendas en dB y sus controles exclusivos. Al regresar a un mapa SAR, restaura su configuración.»
S4. «Simplifica el panel lateral para mostrar únicamente la configuración esencial, la ejecución, el estado de la simulación y un resumen breve.» «Agrega un botón «Ver análisis completo» que abra un modal amplio, responsivo y sin desbordamientos.» «Estadísticas de irradiancia. Comparación entre DNI de entrada e irradiancia incidente. Histograma y gráficas disponibles. Capas e isolíneas. Metadatos y parámetros físicos. Exportaciones.» «Cada gráfica debe incluir debajo una explicación breve de qué representa, qué significan sus ejes y unidades, cómo interpretarla y cuáles son sus limitaciones.» «Permite descargar GeoTIFF, PNG, gráficas en PNG/SVG, estadísticas en CSV/JSON e isolíneas en GeoJSON cuando corresponda.»
S5. «Cada copia debe conservar de manera independiente sus parámetros, ROI, resultados, capas, identificadores y controles.» «Al cambiar de pestaña, únicamente deben mostrarse los overlays y herramientas correspondientes al mapa activo, sin superposiciones ni pérdida de resultados.» «Prueba el flujo completo: crear copia solar, simular, crear copia de agua, ejecutar DG2, regresar a solar y después cambiar a sismo, todo sin recargar la página.»
S6. «Adapta los contratos de API para trabajar con elevación y azimut, sin requerir parámetros temporales. Valida rangos y conserva compatibilidad con resultados anteriores.» «Ejecuta las pruebas científicas y frontend relevantes, incluyendo: Escenario predeterminado de 45° y 180°. Cambios de elevación, azimut y orientación del terreno. Diferentes ROI. Reproducibilidad de los resultados. Consistencia entre GeoTIFF, PNG, estadísticas e isolíneas. Manejo de NoData. Independencia entre copias y restauración de capas. Responsividad del modal y exportaciones.» «Realiza validaciones funcionales en navegador si el entorno lo permite.» «No hagas commit ni push.»
S7. «El diagrama actual no está bien porque muestra azimut y elevación en dos representaciones diferentes. Quiero una sola representación ilustrativa, con un estilo similar al diagrama anterior del simulador.» «Recupera el concepto visual del semicírculo, pero ya no lo relaciones con fecha ni hora.» «usar un solo diagrama, no dos;» «no mostrar horas ni trayectoria temporal real;» «no usar textos como “cenit (18:00)”;» «mostrar el sol en una cúpula/semicírculo simplificado;» «etiquetar de forma coherente el esquema, por ejemplo Este (90°), Sur (180°), Oeste (270°), y mostrar aparte los valores actuales de azimut y elevación;» «incluir una nota breve como “ilustrativo, no trayectoria temporal/efemérides”.»
S8. «Además, corrige los sliders de elevación, azimut e intensidad para que sigan el estilo visual del modal y del resto de TerraPulse. Ahora se ven como componentes ajenos. Unifica colores, grosor, radios, espaciado y jerarquía visual.» «No cambies la lógica física; solo corrige la representación visual y la consistencia de UI.»
S9. «La imagen generada de irradiancia va bien, pero reduce la saturación visual de las isolíneas: usa menos niveles, menor grosor y/o menor opacidad.»
S10. «Además, elimina del encabezado y del contexto visible cualquier referencia residual a SAR, dB, t2 o capas no solares cuando la copia activa sea de radiación solar.»
S11. «Y quiero que el modal de simulacion solar se pueda retraer y expandir ya que estorba un poco al querer visualizar el mapa.»
S12. «Quiero que si selecciono simulador solar me abrá una nueva pestaña para usar el simulador, parecido al comportamiento de simulador de inundaciones»

## Tasks
T1 [S1,S2,S6] route worker: motor idealizado, API, compatibilidad histórica y pruebas científicas; commits: `41b5f27`, `6bd9b9d`, `552ea09`.
T2 [S3,S6] route worker: isolíneas de raster, contrato y pruebas NoData/GeoJSON; commits: `41b5f27`, `552ea09`.
T3 [S1,S2,S3,S4,S5,S6] route worker: UI solar, mapa y aislamiento de copias; commits: `f31ad68`, `97e8ac3`, `39487cc`; sigue parcial por ID real y listener sísmico.
T4 [S1-S6] route parent: integración, documentación LaTeX y checks; commits: `41b5f27`, `f093d21`, `552ea09`, `39487cc`; falta navegador y prueba integral.
T5 [S7-S8] route parent: semicírculo único y sliders; commits: `97e8ac3`, `39487cc`; hallazgo aria-modal/foco del diálogo retraído no corregido.
T7 [S12] route parent: pestaña interna solar independiente como DG2; commit: `39487cc`; comprobación interactiva pendiente.

## Log
L1. Solicitud original del usuario: «# TerraPulse AI — Finalización del simulador de radiación solar

Necesito finalizar el módulo de radiación solar de TerraPulse, simplificando su funcionamiento y mejorando la visualización y el análisis científico de los resultados.

Ya existen modificaciones en frontend y backend. Inspecciona el estado actual y conserva los avances realizados.

Trabaja en el directorio compartido. No crees ramas ni worktrees. No hagas commit ni push.

## 1. Simulación solar idealizada

Elimina completamente la selección y dependencia de fechas, horas y zonas horarias en el flujo de simulación solar, tanto en frontend como en backend.

En su lugar, utilizaremos una geometría solar configurable:

- **Elevación predeterminada:** 45°.
- **Azimut predeterminado:** 180°, medido desde el norte en sentido horario.

El usuario solamente debe seleccionar una ROI y ejecutar la simulación. Los controles de elevación y azimut estarán dentro de **Ajustes avanzados**, con rangos de 0°–90° y 0°–360°, respectivamente.

Elimina el calendario, selector horario, trayectoria solar basada en horas y cualquier requisito temporal de la API solar.

Adapta el motor para utilizar directamente estos ángulos. Si existen dependencias temporales en el cálculo de irradiancia o DNI, sustitúyelas por parámetros físicos de referencia explícitos, justificados y reproducibles, sin fechas ficticias.

Mantén la compatibilidad con simulaciones históricas y conserva únicamente timestamps administrativos cuando corresponda. No afectes las fechas t1/t2 de las escenas SAR ni otros módulos que utilizan zonas horarias.

Los resultados deben representar **irradiancia solar directa modelada (W/m²)** bajo un escenario idealizado, no temperatura, radiación absorbida ni mediciones en tiempo real.

## 2. Irradiancia de entrada e incidente

Permite visualizar claramente:

- Irradiancia normal directa de entrada (DNI), en W/m².
- Irradiancia incidente mínima, máxima y promedio sobre el terreno, en W/m².
- Relación entre irradiancia incidente media y DNI, cuando corresponda.
- Factor de intensidad `intensity_percent`, correctamente identificado como porcentaje adimensional.

Verifica cómo se calcula la DNI y asegúrate de que los cambios de elevación y azimut recalculen los valores físicos y no solamente los colores.

Los parámetros utilizados deben conservarse en los metadatos.

## 3. Mapa de irradiancia e isolíneas

Utiliza el GeoTIFF Float32 como fuente numérica de verdad.

Mejora el mapa con:

- Paleta Inferno y escala en W/m².
- Leyenda y rangos correctos.
- Transparencia fuera del ROI.
- Alineación geoespacial y resolución visual adecuada.
- Consulta de irradiancia por ubicación.
- Isolíneas de igual irradiancia calculadas desde el raster, respetando NoData y los límites del ROI.
- Controles para mostrar u ocultar las isolíneas y consultar sus valores.

No alteres los datos numéricos para mejorar la apariencia. Las isolíneas representan igual irradiancia, no dirección de flujo de calor.

Cuando se active una copia solar, **oculta automáticamente la capa SAR, sus leyendas en dB y sus controles exclusivos**. Al regresar a un mapa SAR, restaura su configuración.

## 4. Panel compacto y análisis completo

Simplifica el panel lateral para mostrar únicamente la configuración esencial, la ejecución, el estado de la simulación y un resumen breve.

Agrega un botón **«Ver análisis completo»** que abra un modal amplio, responsivo y sin desbordamientos.

Organiza el análisis en:

- Estadísticas de irradiancia.
- Comparación entre DNI de entrada e irradiancia incidente.
- Histograma y gráficas disponibles.
- Capas e isolíneas.
- Metadatos y parámetros físicos.
- Exportaciones.

Cada gráfica debe incluir debajo una explicación breve de qué representa, qué significan sus ejes y unidades, cómo interpretarla y cuáles son sus limitaciones.

Permite descargar GeoTIFF, PNG, gráficas en PNG/SVG, estadísticas en CSV/JSON e isolíneas en GeoJSON cuando corresponda.

## 5. Independencia entre simuladores

Corrige definitivamente el problema que obliga a recargar la aplicación al pasar de una copia solar a una de agua o sismo.

Cada copia debe conservar de manera independiente sus parámetros, ROI, resultados, capas, identificadores y controles.

Al cambiar de pestaña, únicamente deben mostrarse los overlays y herramientas correspondientes al mapa activo, sin superposiciones ni pérdida de resultados.

Prueba el flujo completo: crear copia solar, simular, crear copia de agua, ejecutar DG2, regresar a solar y después cambiar a sismo, todo sin recargar la página.

## 6. API, pruebas y entrega

Adapta los contratos de API para trabajar con elevación y azimut, sin requerir parámetros temporales. Valida rangos y conserva compatibilidad con resultados anteriores.

Ejecuta las pruebas científicas y frontend relevantes, incluyendo:

- Escenario predeterminado de 45° y 180°.
- Cambios de elevación, azimut y orientación del terreno.
- Diferentes ROI.
- Reproducibilidad de los resultados.
- Consistencia entre GeoTIFF, PNG, estadísticas e isolíneas.
- Manejo de NoData.
- Independencia entre copias y restauración de capas.
- Responsividad del modal y exportaciones.

Realiza validaciones funcionales en navegador si el entorno lo permite.

Al finalizar, entrega un resumen de cambios, decisiones científicas, pruebas realizadas y limitaciones pendientes.

No hagas commit ni push.

**Objetivo final:** un simulador solar sencillo, sin fechas ni horas, basado en una geometría idealizada configurable, con resultados científicamente consistentes, mapas claros, isolíneas, gráficas explicativas, exportaciones e independencia total respecto a los demás simuladores.»
L2. El árbol compartido contiene modificaciones staged, unstaged y archivos no seguidos preexistentes en backend/solar, pipeline/solar, web y docs. Preservar sin revertir ni limpiar; el usuario prohíbe ramas/worktrees/commits/push.
L3. Exploración de solo lectura: `surface.py` orquesta SPA/Linke dependientes de fecha, `services.py` publica TIFF Float32/PNG y `analysis.py` resume TIFF; `RightPanel.tsx` todavía exige fecha/zona y `App.tsx` maneja estado por copia, pero limpia el ráster al cambiar de dock; no hay isolíneas implementadas. Worker frontend inicial no editó nada por cautela excesiva ante árbol compartido; 12 pruebas web enfocadas y build aprobaron, primera invocación de pruebas falló por ruta relativa incorrecta. Continuación autorizada sobre las mismas superficies para edición quirúrgica, sin reiniciar límite correctivo.
L4. Worker backend inicial agregó prueba en `pipeline/tests/test_solar_api.py` y se detuvo porque invocó Python base sin pytest. Padre encontró `/home/juliox/miniforge3/envs/nisar/bin/python` con pytest y ejecutó RED reproducible: 1 fallida/7 descartadas, test `idealized_request_defaults_angles_and_rejects_temporal_fields`, el validador aún exige fecha/zona. Continuación con ese intérprete y PYTHONPATH de dependencias locales; no se atribuye GREEN ni se ha hecho commit.
L5. Continuación backend implementó defaults 45/180/100, API sin entradas temporales, DNI Ineichen idealizada con I0 fijo 1361 W/m² y Linke fijo 3, isolíneas desde TIFF con endpoint `/api/solar/simulations/{id}/contours`, preservando funciones históricas. Worker observó RED del test de contrato del padre y RED de importación de `contour_geojson`, después GREEN 241 pruebas solares (`PYTHONPATH=data/solar-pvlib-deps:backend` con intérprete conda nisar) y `git diff --check` sin errores. ASSESS nativo indisponible (`package-local-binary-missing`); escalado Risk item 3 a verificador independiente en curso. Docs `docs/solar-api.md` y `docs/features/solar-radiation-simulator.tex` actualizados; integración frontend todavía en ejecución, sin browser comprobado ni commit.
L6. Verificador independiente observó 19 pruebas enfocadas PASS e identificó dos defectos: `prepare_dem` incluye franja de celdas tocadas cuyo centro está fuera de ROI y la máscara se transmite a TIFF/PNG/contornos; `/contours` no acota complejidad de segmentos/respuesta ni concurrencia ante grilla 500k y 20 niveles. Una corrección worker acotada en `surface.py`, `analysis.py`, `views.py` y tests: RED de borde y límites, GREEN 247 tests solares del worker y 247 del padre/13246 avisos. Máscara final de centros ROI tras derivadas, fail-closed de trabajo/JSON/vertices y semáforo compartido. No se editó `dem.py` ni `delivery.py`. El verificador previo no observó esta corrección.
L7. Frontend worker migró controles y contrato, persistencia en copia, overlays solares e isolíneas; 28 pruebas focalizadas y build GREEN pero reportó S3/S5 parciales. Suite web completa falló primero por tests heredados que esperaban fecha/hora, corregidos `web/tests/solarRoi.test.mjs` y `web/tests/i18n-simulation.test.mjs`: suite nueva 113/113 exit0. Verificador independiente identificó todavía superposición agua/sismo en solar, SAR exclusivo visible, rehidratación que pierde estado de copias, intensidad restaurada vacía, rótulo SPA falso, CSV sin saltos, invalidación ROI incompleta y ausencia clic en contornos; 36 PASS/1 FAIL de test anterior a corrección de tests. Una ronda correctiva UI cambió `App.tsx`, `useSavedMaps.ts`, `Header.tsx`, `MapCanvas.tsx`, `RightPanel.tsx`; 24 enfocadas, 114 suite y build GREEN, `git diff --check` limpio, verificación independiente poscorrección en curso. No hay navegador/DOM (Chromium/Playwright/Puppeteer ausentes), por lo que el flujo solar→DG2→solar→sismo y el clic específico sobre una isolínea no están probados. T3 permanece en progreso; no hay commit ni push.
L8. Verificador posterior observó 15/15 tests UI enfocados PASS pero todavía detectó superposición: ráster y comparador DG2 visibles en dock solar por `MapCanvas.tsx` (líneas ~1429,2277,2645), anillos sísmicos dependientes de enabled fuera del dock, y copia de calor SAR desde solar conserva solar activo (`App.tsx` ~402). Cambio de ROI borra URL/límites pero retiene análisis/resultado/contornos, y al reactivar el panel muestra la corrida anterior; `useSavedMaps.ts` acepta `simulationResult` completo con URLs de export no validadas utilizadas por `RightPanel.tsx`. No se puede seleccionar una isolínea en el mapa (solo muestrear el TIFF por clic). CSV ya tiene saltos reales pero filas de dos y tres columnas. S5 no conforme; S1-S4 parciales en interfaz. La ronda correctiva worker-local UI ya se usó; no aplicar otra automáticamente. Sin navegador ni prueba integral solar→DG2→solar→sismo. Se requiere decisión humana para una continuación delimitada con worker, máximo una nueva ronda, suite web/build y verificación independiente; sin commit/push.
L9. Usuario eligió «Sí, continuación acotada» frente a «No, detener aquí» para la corrección acotada propuesta: un worker, una ronda adicional sobre App, MapCanvas, RightPanel, useSavedMaps y pruebas web; suite web/build y verificación independiente. No reinicia límites previos ni autoriza ramas, commit o push. Todos los hijos anteriores completados; navegador/DOM ausentes sigue como prueba pendiente.
L10. Worker aplicó esa única ronda: aislamiento por dock, invalidación de ROI, URL rehidratada restringida, selección de isolínea y CSV uniforme. RED focalizado por contratos de estado, GREEN 14 focused / 118 suite web y build; `git diff --check` limpio. Verificador independiente posterior confirmó contradicción crítica: backend genera ID `uuid4().hex` 32 hex, pero `useSavedMaps.safeLocalApiUrl` solo acepta UUID con guiones; corridas reales se pierden al rehidratar. También el listener de clic sísmico en MapCanvas captura `isSeismic` inicial con efecto `[]`, por lo que cambiar sin recarga a sismo no habilita reposicionar epicentro. El verificador no ejecutó test adicional inútil con ID ficticio; hallazgos estructurales sin test con ID real ni browser. S3/S4 parciales, S5 no conforme. Se agotó la ronda worker-local; sin nueva corrección automática, commit, push, ramas ni worktrees. `docs/solar-api.md` y LaTeX consignan bloqueo; `pdflatex` de feature y modelo exit0, `git diff --check` limpio. Pendientes concretos: ID real, listener reactivado, test de flujo y navegador/descargas.
L11. Petición nueva literal: «Reintroduce la posición solar ilustrativa en el panel, pero sin depender de fecha u hora real. Debe representar visualmente la elevación y el azimut configurados. Si muestras una hora, deja explícito que es solo ilustrativa o elimínala del texto.  

Ajusta los sliders para que sigan el estilo visual del modal y del resto de TerraPulse.  

La imagen generada de irradiancia va bien, pero reduce la saturación visual de las isolíneas: usa menos niveles, menor grosor y/o menor opacidad.  

Además, elimina del encabezado y del contexto visible cualquier referencia residual a SAR, dB, t2 o capas no solares cuando la copia activa sea de radiación solar.

Y quiero que el modal de simulacion solar se pueda retraer y expandir ya que estorba un poco al querer visualizar el mapa.» T5 independiente de T3/S5 pendientes: no inferir autorización para reparar IDs de rehidratación o listener sísmico. Sin ramas/worktrees/commit/push, conservar árbol compartido.
L12. Worker T5 de Header/MapCanvas: RED de presentación, 14 pruebas enfocadas GREEN, atenúa isolíneas y oculta contexto SAR en mapa solar. `npm --prefix web run build` falló transitoriamente por props de RightPanel mientras el otro worker lo editaba en paralelo; aquel worker restituyó `roiLayers`, luego compiló sin error. Intentos `node --test tests/...` y `npm run build` desde raíz fallaron por rutas/cwd; no son fallas del código. Worker de panel agregó SVG angular sin fecha/hora y estilos, y primero retrajo solo el diálogo de análisis; padre identificó que el panel flotante también estorbaba, pidió una única corrección de la tarjeta solar flotante. RED de botón aria-expanded, GREEN 21 tests enfocados, build; panel flotante ahora retraíble sin desactivar solar ni borrar resultados, SVG visible sin abrir Ajustes avanzados. Padre observó suite web completa 121 PASS y build exit0, `git diff --check` limpio. Verificador independiente riesgo item3 observó 19 enfocadas PASS pero detectó `RightPanel` análisis retraído deja pasar mouse al mapa mientras sigue aria-modal=true y foco Tab atrapado, `MapCanvas` backdrop de carga SAR/H5 tapa mapa solar, y `Header` vuelve a contexto NISAR cuando copia solar activa cambia de dock. Una corrección disponible del worker Header/MapCanvas reparó los últimos dos: RED enfocado, GREEN 14; padre repitió 121 pruebas web exit0, build exit0, TeX exit0, diff check limpio. Worker panel consumió su única corrección, no se corrigió automáticamente el diálogo de análisis retraído. Sin navegador/DOM, no afirmar validación visual, interacción real de isolíneas ni foco. Los 2 bloqueos anteriores de S5 siguen fuera de T5. Native ASSESS no disponible `package-local-binary-missing`, verificador independiente sí corrió antes de corrección final.
L13. Corrección literal del usuario: «Rehaz el bloque visual del simulador solar.  

El diagrama actual no está bien porque muestra azimut y elevación en dos representaciones diferentes. Quiero una sola representación ilustrativa, con un estilo similar al diagrama anterior del simulador.  

Recupera el concepto visual del semicírculo, pero ya no lo relaciones con fecha ni hora. Debe funcionar como un diagrama ilustrativo de posición solar a partir de los parámetros manuales:
- elevación solar
- azimut solar
Requisitos:
- usar un solo diagrama, no dos;
- no mostrar horas ni trayectoria temporal real;
- no usar textos como “cenit (18:00)”;
- mostrar el sol en una cúpula/semicírculo simplificado;
- etiquetar de forma coherente el esquema, por ejemplo Este (90°), Sur (180°), Oeste (270°), y mostrar aparte los valores actuales de azimut y elevación;
- incluir una nota breve como “ilustrativo, no trayectoria temporal/efemérides”.
Además, corrige los sliders de elevación, azimut e intensidad para que sigan el estilo visual del modal y del resto de TerraPulse. Ahora se ven como componentes ajenos. Unifica colores, grosor, radios, espaciado y jerarquía visual.

No cambies la lógica física; solo corrige la representación visual y la consistencia de UI.» Reabrir solo T5/S7-S8; S9-S11 siguen como estaban, el hallazgo previo de aria-modal/foco no forma parte de este pedido visual. No tocar física ni flujo temporal.
L14. Usuario: «La referencia del concepto visual del semicirculo puedes verla en references/sol.png». Leída: arco sobre relieve con sol y etiquetas Este/Oeste, pero el original incluye horas, calendario y cenit horario: usar solo la composición visual, no trasladar su semántica temporal.
L15. T5 S7-S8: prueba nueva `solarWorkspace` RED 1/10 por ausencia del semicírculo; implementación única cúpula SVG + relieve y sol sobre proyección ilustrativa ortográfica de e/A, valores actuales por separado y nota sin tiempo. Sliders de elevación, azimut e intensidad ahora comparten clase, relleno, thumb y rótulos; no se tocaron física, API, resultados ni bloque previo aria-modal. Prueba focused GREEN 10/10. Suite completa web primer intento 120/121 por aserción i18n de orden exacto de atributos input, actualizada a preservar rangos/valores con estilo intermedio: suite 121/121 exit0; `npm --prefix web run build` exit0 con aviso bundle grande; feature LaTeX exit0, diff check limpio. Revisión independiente de solo lectura no encontró defecto concreto en T5 S7-S8; confirmó geometría E90/S180/O270 y ambigüedad N/S resuelta con rótulo numérico. Sin navegador/lector de pantalla, no hay validación visual ni prueba de lectura accesible real; no entregar como visualmente verificado. Native ASSESS indisponible package-local-binary-missing; sin commit, rama, worktree ni push.
L16. Usuario: «Quiero que si selecciono simulador solar me abrá una nueva pestaña para usar el simulador, parecido al comportamiento de simulador de inundaciones». Se entiende como pestaña interna del dock igual a Agua/DG2 (no pestaña del navegador), sin alterar el cálculo físico ni deshacer aislamiento de capas. T7 nuevo, T3/T4 y accesibilidad del diálogo previo permanecen bloqueados.
L17. T7: RED 0/2 pruebas dock solar, implementación tipo `solar` independiente y reutilizable, botón Header/Sidebar/menú +, mismo lienzo, panel, ráster, isolíneas y relieve solar solo en solar; test focused 16/16, suite inicial 123/123, build falló por `Sun` no importado, se corrigió y build pasó. Verificador independiente detectó 4 defectos: selector de ROI del panel solar apagaba simulador, solar sobre copia de agua bloqueaba raster DG2, doble callback preset podía sobrescribir invalidación ROI, huella GCOV lineal visible fuera de SAR. Corrección localizada: panel envía simulation solar, `handleOpenSimulation` preset no reescribe solar obsoleto, agua se rige por dock, ocultar footprint line y GCOV preview en dock solar. Verificador poscorrección confirmó estructura de los 4 y detectó pestaña vacía al cerrar tarjeta, botón solar deshabilitado sin ROI, y vista general con copia guardada que se mutaba en segundo plano. RED 2/3, arreglo: cerrar tarjeta regresa/abre dock mapa, botón solar abre sin ROI, selector crea copia editable en vista general; RED 1/3 para último hallazgo, corregido `activeCopy && isEditing`. Suite 124/124 exit0, build exit0, diff check limpio. Sin navegador/DOM: no afirmar interacción visual o flujo integral. No tocar física ni previo aria-modal; sin branch/worktree/commit/push.
L18. Usuario: «Si, solo que actualmente dice siempre Solar ON 100%, quiero que ahora siempre diga Simulador de radiación solar». Se fijó el rótulo sin porcentaje; suite web 124/124 y build aprobados.
L19. Usuario: «Bien, solo que el botón de la pestaña de simulacion solar para cerrar se ve de color naranja/rojo y quiero que todo el botón de la pestaña se vea rojo, te dejo una captura en references de como se ve». Referencia `references/image.png`. Se aplicó rojo inicial y prueba 125/125.
L20. Usuario corrigió: «Quiero que el color sea naranja claro como el botón de copia con calor de arriba». Se igualó la pestaña y su botón de cierre a la paleta clara de Copia con Calor; 125/125 web, build y diff check aprobados; sin navegador.
L21. Usuario: «Por ultimo commitea todos los cambios de la rama con commits estructurados.». Autoriza commits locales de todo el árbol en esta rama, no push, publicación, ni declarar cerrados los defectos previos. Se concluyó merge pendiente `11a40b0` con los cambios staged preexistentes, y se dividieron los cambios nuevos por física (`41b5f27`), análisis (`f093d21`), compatibilidad histórica (`6bd9b9d`), API (`552ea09`), cliente y persistencia (`f31ad68`), panel (`97e8ac3`) y dock/mapa (`39487cc`); docs workspace `866be15`. Revisión por slices: el merge recibido es grande por semántica indivisible; el panel y dock/mapa superan ~400 líneas cada uno; faltan pruebas browser y revisión nativa (`package-local-binary-missing`). Antes de commits, conda nisar: 23 ROI + 247 solar, web 125, build web; sin validación en navegador. El Python base no tiene pytest (se usó conda nisar).
