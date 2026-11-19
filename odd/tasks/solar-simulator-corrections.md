# Correcciones del simulador solar
Trabajo sobre árbol compartido existente; sin ramas, worktrees, commits ni push por instrucción explícita del usuario.

## Specs
S1. «El usuario no debe introducir manualmente la zona horaria. Implementa la resolución automática de la zona IANA a partir de la geometría confirmada de la ROI, considerando la fecha de simulación. Utiliza un procedimiento geográfico confiable. Evita valores fijos como America/Mexico_City. Muestra la zona horaria detectada en la interfaz. Contempla geometrías que atraviesen varias zonas horarias. Si no puede determinarse de forma inequívoca, permite corregirla manualmente como excepción. Garantiza que la hora local se transforme correctamente para los cálculos solares. Conserva los metadatos temporales en los resultados.»
S2. «Audita el parámetro `intensity_percent`. Necesito saber exactamente qué representa y cómo modifica el modelo. No etiquetes un porcentaje como W/m². Si es un factor adimensional, represéntalo correctamente, por ejemplo 100% (1.0×). Muestra los resultados numéricos de irradiancia en W/m². Distingue los parámetros físicos de los visuales. Considera mover el control experimental a una sección avanzada si no es necesario para el flujo principal. No inventes mediciones ni magnitudes físicas.»
S3. «Mantén un panel lateral compacto para configuración. Mueve el análisis extenso a un modal grande o una vista ampliada. Utiliza dimensiones responsivas. Evita overflow horizontal y contenido oculto. Garantiza que todas las gráficas, estadísticas, tablas y controles sean visibles. Mantén desplazamiento interno apropiado. Conserva exportaciones y metadatos. Verifica que abrir y cerrar el modal no haga perder el estado de la simulación.»
S4. Diferido por corrección posterior del usuario: «Cancela la parte de fecha y hora de simulación. Despues de que termines corregiremos eso en otro work unit». No modificar ahora controles ni lógica de fecha/hora; conservar la fecha actual exclusivamente como dato requerido para resolver zona horaria de S1.
S5. «Investiga por qué un mapa identificado como Presa Calles (Aguascalientes) muestra un centro de mapa cercano a [-93.0000, 16.7670]. No presupongas que esto demuestra un error del backend. Comprueba por separado: Centro de la cámara. Geometría de ROI activa. ROI confirmada. Geometría enviada al backend. Geometría persistida en la simulación. Límites del raster generado. Corrige cualquier desincronización confirmada.»
S6. «Ejecuta pruebas automatizadas y, si dispones de navegador, verifica visualmente: Cambio de ROI entre estados. Detección de zona horaria. Cambio de fecha y hora. Valores y unidades de irradiancia. Apertura del análisis completo. Responsividad del modal. Persistencia y actualización de resultados. No declares corregidos los defectos visuales sin comprobarlos en navegador. Al finalizar, explica las causas reales, los cambios realizados, los resultados de las pruebas y cualquier limitación pendiente.»

## Tasks
T1 [S1] Zona geográfica y contrato IANA; route worker; instalado y probado en conda nisar por autorización posterior; commit: ninguno (prohibido).
T2 [S2,S3,S5] Presentación, modal, ROI y unidades; route parent/worker; CSS y portal implementados, bloqueado para cierre visual: navegador ausente; commit: ninguno (prohibido).
T3 [S1-S3,S5-S6] Pruebas, documentación LaTeX y limitaciones verificables; route parent; bloqueado para prueba visual: navegador ausente; commit: ninguno (prohibido).
T4 [S4] Fecha/hora del cálculo; route dropped (diferida por usuario); commit: ninguno.

## Log
L1. Necesito corregir varios problemas introducidos o no resueltos en la última modificación del simulador solar de TerraPulse.

Trabaja sobre la implementación actual. No crees ramas ni worktrees adicionales, no hagas commit ni push y coordina cualquier archivo compartido con otros agentes activos.

### 1. Zona horaria IANA automática

El usuario no debe introducir manualmente la zona horaria.

Implementa la resolución automática de la zona IANA a partir de la geometría confirmada de la ROI, considerando la fecha de simulación.

- Utiliza un procedimiento geográfico confiable.
- Evita valores fijos como America/Mexico_City.
- Muestra la zona horaria detectada en la interfaz.
- Contempla geometrías que atraviesen varias zonas horarias.
- Si no puede determinarse de forma inequívoca, permite corregirla manualmente como excepción.
- Garantiza que la hora local se transforme correctamente para los cálculos solares.
- Conserva los metadatos temporales en los resultados.

### 2. Intensidad física y unidades

Audita el parámetro `intensity_percent`.

Necesito saber exactamente qué representa y cómo modifica el modelo.

- No etiquetes un porcentaje como W/m².
- Si es un factor adimensional, represéntalo correctamente, por ejemplo 100% (1.0×).
- Muestra los resultados numéricos de irradiancia en W/m².
- Distingue los parámetros físicos de los visuales.
- Considera mover el control experimental a una sección avanzada si no es necesario para el flujo principal.
- No inventes mediciones ni magnitudes físicas.

### 3. Corregir el modal del simulador

El contenido no cabe correctamente en el espacio disponible.

- Mantén un panel lateral compacto para configuración.
- Mueve el análisis extenso a un modal grande o una vista ampliada.
- Utiliza dimensiones responsivas.
- Evita overflow horizontal y contenido oculto.
- Garantiza que todas las gráficas, estadísticas, tablas y controles sean visibles.
- Mantén desplazamiento interno apropiado.
- Conserva exportaciones y metadatos.
- Verifica que abrir y cerrar el modal no haga perder el estado de la simulación.

### 4. Fecha y hora de simulación

Revisa que la fecha y la hora realmente se utilicen en el cálculo de posición solar.

- La fecha debe representar el día para el que se estima la irradiancia.
- La hora debe interpretarse según la zona horaria del ROI.
- Distingue la fecha de simulación de las fechas t1 y t2 de las escenas SAR.
- Muestra la posición solar calculada, no solamente un ángulo ilustrativo.
- Aclara que la irradiancia es una estimación del modelo, no una medición histórica.

### 5. Consistencia del ROI

Investiga por qué un mapa identificado como Presa Calles (Aguascalientes) muestra un centro de mapa cercano a [-93.0000, 16.7670].

No presupongas que esto demuestra un error del backend.

Comprueba por separado:

- Centro de la cámara.
- Geometría de ROI activa.
- ROI confirmada.
- Geometría enviada al backend.
- Geometría persistida en la simulación.
- Límites del raster generado.

Corrige cualquier desincronización confirmada.

### 6. Validación

Ejecuta pruebas automatizadas y, si dispones de navegador, verifica visualmente:

- Cambio de ROI entre estados.
- Detección de zona horaria.
- Cambio de fecha y hora.
- Valores y unidades de irradiancia.
- Apertura del análisis completo.
- Responsividad del modal.
- Persistencia y actualización de resultados.

No declares corregidos los defectos visuales sin comprobarlos en navegador.

Al finalizar, explica las causas reales, los cambios realizados, los resultados de las pruebas y cualquier limitación pendiente.
L2. El usuario confirmó: «El otro agente no está trabajando». Comunicación directa con la otra sesión fue denegada por el runtime; preservar todos los cambios ajenos existentes.
L3. «Cancela la parte de fecha y hora de simulación. Despues de que termines corregiremos eso en otro work unit».
L4. Evidencia previa: 107 pruebas web y build pasaron; 44 pruebas de zona/tiempo y 104 de regresión solar pasaron con PYTHONPATH correcto; zona geográfica real 7.0.2 probada inicialmente en dependencias locales aisladas (frío ~42 s, segundo ROI <1 s). Compilación LaTeX pasó. Navegador no disponible; conda nisar no tenía timezonefinder instalado. Verificador encontró guardia regex y ROI efectiva diferentes de anillo de recorte; se corrigieron y reejecutaron pruebas. El control angular de hora queda diferido expresamente.
L5. «Autorizo la instalación de timezonefinder. Además el modal sigue siendo recortado (no visible debido a otro elemento, te dejo una captura en references,\n  tambien el del terremoto así que supongo que es un problema del contenedor padre)». timezonefinder 7.0.2 instalado en conda nisar; 44 pruebas zona/tiempo pasaron. Capturas muestran paneles flotantes recortados por barra inferior del mapa. CSS relativo al contenedor y portal de análisis aplicados; 109 tests web y build pasaron, pendiente comprobar visualmente después del cambio.
L6. HTTP real /api/solar/timezone para ROI pequeña Presa Calles: 200, America/Mexico_City, -06:00, 32.6 s en frío. Verificador independiente encontró escape de foco con Shift+Tab desde el contenedor del diálogo y falta de retorno al invalidarse resultado; se añadió trampa desde el contenedor y fallback de foco al panel, con RED estructural y 109 pruebas web/build verdes. Navegador ausente, sin afirmación de corrección visual.
