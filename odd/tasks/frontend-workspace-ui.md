# TerraPulse frontend workspace UI
Rama: `feature/frontend-workspace-ui` en `data/worktrees/frontend-workspace-ui`. Sin commits ni push por pedido explícito. Alcance: solo `web/` y esta documentación de interfaz.

## Specs
S1. «Trabaja en una rama o worktree independiente para evitar interferencias con el agente del simulador.» «No modifiques archivos del backend ni algoritmos científicos.» «No hagas commit ni push.»
S2. «Cada acción debe tener una ubicación principal clara.» «Eliminar controles redundantes sin eliminar funcionalidades.» «Conservar los eventos, estados y comportamientos de las acciones originales.» «Evitar desbordamientos y superposiciones.»
S3. «Barra principal» para navegación global; «Barra contextual del mapa» para mapa activo; «Panel lateral izquierdo» para explorador, catálogo, escenas, mapas y herramientas; «Área central» con el mapa principal. «No implementes esta propuesta de manera rígida».
S4. «Panel compacto» con ROI, fecha y hora, parámetros, ejecución, estado, capa/opacidad, resumen y «Ver análisis completo». «Vista de análisis completo» amplia, «90–95% del espacio disponible en escritorio», seis secciones, vuelta al mapa sin perder configuración, carga/error y exportaciones existentes. «No dupliques las gráficas».
S5. «Utiliza formatos legibles sin modificar los valores originales.» «30.92 × 30.92 m, únicamente cuando la unidad esté confirmada.» Gráficas, leyendas, tooltip, tablas e identificadores adaptables.
S6. «Diferenciar visualmente las capas SAR y solares.» «Mostrar la leyenda correspondiente a cada capa.» «Mostrar el estado real de visibilidad de las capas.» Sin alterar datos ni interpretación raster.
S7. «TerraPulse ya no está limitado a Chiapas.» «La ubicación mostrada debe proceder de información geográfica real y del estado activo de la aplicación.» «Cuando la información no esté disponible, utiliza una etiqueta neutral y explícita.»
S8. «Revisa» scroll anidado, ayudas, controles, modales, menús, mapas, navegación responsive y «Accesibilidad básica de controles y navegación por teclado.» Mantener estilo actual.
S9. «Prueba al menos» navegación, copias agua/calor/sismo, herramientas, apertura/cierre solar y análisis, paletas SAR, visibilidad capas, ROI, mapas guardados, gráficas, exportaciones y viewports. «Verifica que no existan errores de consola ni regresiones evidentes.»
S10. «Al finalizar, informa» bugs/causas, cambios, componentes, navegación/responsividad, pruebas, no resuelto y contratos del simulador.

## Tasks
T1 [S1,S10] inline — aislar worktree, investigar divergencias y coordinar titularidad; commit: ninguno.
T2 [S2,S3,S8,S9] writer/inline según evidencia — barra global/contextual y acciones de copias; commit: ninguno.
T3 [S4,S5,S7,S9] writer/inline según evidencia — panel compacto, análisis solar amplio y zona horaria IANA explícita para ROI; commit: ninguno.
T4 [S6,S7,S8,S9] writer/inline según evidencia — overlays, leyendas, geografía y responsive; commit: ninguno.
T5 [S9,S10] inline/verificador según riesgo — pruebas, documentación de interfaz y entrega; commit: ninguno.

## Log
L1. Solicitud original del usuario (texto literal):
# TerraPulse AI — Corrección de bugs, refactorización UI/UX y reorganización del espacio de trabajo

## Contexto

Trabajarás exclusivamente en la interfaz de TerraPulse AI.

Ya tienes contexto del proyecto, su arquitectura, los componentes existentes y las funcionalidades implementadas.

Actualmente la aplicación presenta problemas importantes de organización visual, duplicación de controles, desbordamientos y una experiencia de usuario poco clara.

El sistema originalmente estaba enfocado en Chiapas, pero ahora trabaja con regiones de todo México. La interfaz no debe conservar textos, configuraciones o comportamientos dependientes de Chiapas.

IMPORTANTE: Otro agente trabajará simultáneamente en la lógica y el backend del simulador de radiación solar. Tu responsabilidad es únicamente frontend/UI/UX.

## 1. Aislamiento del trabajo

Antes de modificar archivos:

- Inspecciona el estado actual de Git.
- Identifica tu rama y worktree.
- Trabaja en una rama o worktree independiente para evitar interferencias con el agente del simulador.
- No modifiques archivos del backend ni algoritmos científicos.
- No reviertas cambios existentes ni sobrescribas trabajo de otras sesiones.
- Evita modificar componentes internos específicos del cálculo solar cuando puedan generar conflictos.

Si necesitas integrar información del simulador, utiliza sus interfaces públicas existentes y documenta qué contratos de datos adicionales serían necesarios.

No hagas commit ni push.

## 2. Corregir duplicación de botones y barras superiores

Actualmente existen botones duplicados:

- Copia con Calor.
- Copia Agua (DG2).
- Copia Sismo.

Aparecen tanto en la barra del espacio de trabajo como en la barra de pestañas o controles internos.

Además, la navegación superior está saturada y algunos controles se cortan horizontalmente.

Investiga la causa de estas duplicaciones.

Requisitos:

- Cada acción debe tener una ubicación principal clara.
- Eliminar controles redundantes sin eliminar funcionalidades.
- Conservar los eventos, estados y comportamientos de las acciones originales.
- Evitar que las barras crezcan indefinidamente.
- Garantizar que los controles permanezcan accesibles en diferentes resoluciones.
- Revisar el comportamiento de las pestañas y controles al cambiar de mapa.
- Evitar desbordamientos y superposiciones.

No soluciones el problema simplemente ocultando elementos mediante CSS si su lógica sigue generando componentes duplicados.

## 3. Reorganizar la jerarquía visual

Actualmente existen demasiadas barras, botones, paneles y controles simultáneamente.

Reorganiza el espacio de trabajo manteniendo todas las funcionalidades existentes.

Propongo esta jerarquía:

### Barra principal

Contendrá navegación global:

- Archivo.
- Escenas GCOV.
- Procesamiento SAR.
- Validación.
- Ventana.
- Exportar.
- Configuración global.

### Barra contextual del mapa

Contendrá únicamente acciones relacionadas con el mapa activo:

- Selector de mapas o pestañas.
- Herramientas geoespaciales.
- Controles de visualización relevantes.
- Acciones contextuales.

### Panel lateral izquierdo

Mantendrá:

- Explorador de ROI.
- Catálogo geográfico.
- Escenas disponibles.
- Mapas guardados.
- Configuración de herramientas y simulaciones.

### Área central

El mapa debe continuar siendo el elemento visual principal.

Evita que los controles secundarios reduzcan innecesariamente el área disponible.

No implementes esta propuesta de manera rígida: primero inspecciona la arquitectura actual y adapta la reorganización a los patrones existentes.

## 4. Reestructurar el panel del simulador solar

Actualmente el simulador solar contiene demasiada información en una columna estrecha.

Esto ocasiona:

- Gráficas cortadas.
- Texto fuera del contenedor.
- Tablas ilegibles.
- Scroll horizontal.
- Scroll vertical excesivo.
- Controles difíciles de encontrar.
- Información científica mezclada con configuración.

Quiero separar claramente configuración y análisis.

### Panel compacto

Debe contener únicamente:

- Identificación de la herramienta.
- ROI seleccionado.
- Fecha y hora.
- Parámetros disponibles.
- Botón para ejecutar la simulación.
- Estado de procesamiento.
- Controles de capa y opacidad.
- Resumen breve de resultados.
- Botón "Ver análisis completo".

### Vista de análisis completo

Implementa una vista amplia, preferentemente mediante un modal de gran tamaño o pantalla completa.

Debe utilizar aproximadamente el 90–95% del espacio disponible en escritorio, ajustándose correctamente a móviles.

Organiza su contenido en secciones o pestañas:

1. Resumen y estadísticas.
2. Distribución de irradiancia.
3. Gráficas científicas disponibles.
4. Capas y datos geoespaciales.
5. Metadatos.
6. Exportaciones.

Debe permitir:

- Cerrar y regresar al mapa sin perder la configuración.
- Navegar entre secciones.
- Visualizar gráficas completas.
- Consultar valores y unidades.
- Exportar los resultados disponibles.
- Mantener estados de carga y error claros.

Reutiliza los endpoints y mecanismos de exportación existentes.

Si alguna exportación requiere cambios de backend, documenta el contrato necesario sin implementar lógica científica por tu cuenta.

No dupliques las gráficas en el panel compacto y el modal.

## 5. Corregir responsividad de gráficas y tablas

Investiga los componentes de gráficas utilizados en TerraPulse.

Actualmente varias gráficas aparecen recortadas debido a que el contenedor es demasiado estrecho.

Corrige:

- Dimensiones y redimensionamiento de gráficas.
- Títulos excesivamente largos.
- Etiquetas de ejes.
- Leyendas.
- Tooltips.
- Tablas.
- Identificadores extensos.
- Valores con demasiados decimales.

Utiliza formatos legibles sin modificar los valores originales.

Por ejemplo:

Resolución:
30.9222222222222 × 30.9222222222222

Visualización:
30.92 × 30.92 m, únicamente cuando la unidad esté confirmada.

Mantén la precisión completa en los datos numéricos subyacentes y las exportaciones correspondientes.

Las gráficas deben adaptarse al contenedor y funcionar en el modal amplio.

## 6. Mejorar la administración visual de capas

Actualmente existen controles de paleta y leyendas que pueden generar confusión entre los resultados SAR y la simulación solar.

La aplicación utiliza capas SAR con valores en dB y simulaciones de irradiancia expresadas en W/m².

Requisitos:

- Diferenciar visualmente las capas SAR y solares.
- Mostrar la leyenda correspondiente a cada capa.
- Evitar que un selector de paleta parezca controlar una capa diferente.
- Mostrar el estado real de visibilidad de las capas.
- Mantener controles de opacidad claros.
- Evitar leyendas duplicadas o inconsistentes.
- No permitir que una capa marcada como activa aparezca visualmente oculta sin indicarlo.

No modifiques el cálculo, la generación ni la interpretación numérica de los raster.

Investiga primero cómo se gestionan los overlays y sus estados.

Si existe un problema de sincronización entre capas, corrígelo únicamente cuando sea responsabilidad de la presentación frontend.

## 7. Eliminar textos geográficos desactualizados

TerraPulse ya no está limitado a Chiapas.

Busca en la interfaz:

- Referencias estáticas a Chiapas.
- Nombres de municipios o estados codificados.
- Etiquetas de zonas horarias fijas.
- Descripciones de ROI obsoletas.
- Textos que hagan referencia a una ubicación anterior.
- Información de mapas guardados que no corresponda al mapa activo.

La ubicación mostrada debe proceder de información geográfica real y del estado activo de la aplicación.

No infieras el estado o municipio exclusivamente del nombre del mapa guardado.

No reemplaces "Chiapas" por "Aguascalientes" de forma estática.

Cuando la información no esté disponible, utiliza una etiqueta neutral y explícita.

La obtención de coordenadas y zona horaria para cálculos físicos pertenece al otro agente; aquí solo debes consumir y presentar correctamente los metadatos disponibles.

## 8. Mejorar la interacción general

Revisa:

- Múltiples barras de desplazamiento anidadas.
- Tooltips y textos de ayuda.
- Botones pequeños.
- Controles demasiado juntos.
- Indicadores de estado.
- Modales que exceden el viewport.
- Posicionamiento de menús desplegables.
- Paneles flotantes sobre el mapa.
- Comportamiento responsive de la navegación.
- Accesibilidad básica de controles y navegación por teclado.

El objetivo no es simplemente reducir elementos, sino organizarlos mejor.

Mantén el estilo visual actual de TerraPulse, pero mejora su consistencia, espaciado, jerarquía y legibilidad.

No realices un rediseño estético completo ni introduzcas dependencias innecesarias.

## 9. Validación

Prueba al menos:

- Navegación entre mapas.
- Creación de copias de agua, calor y sismo.
- Activación de herramientas.
- Apertura y cierre del simulador.
- Apertura y cierre del análisis completo.
- Cambio de paletas SAR.
- Visibilidad de capas.
- Cambio de ROI.
- Restauración de mapas guardados.
- Renderizado de gráficas.
- Exportaciones existentes.
- Diferentes tamaños de viewport.

Verifica que no existan errores de consola ni regresiones evidentes.

## 10. Entrega

Al finalizar, informa:

- Bugs identificados y causas.
- Cambios realizados.
- Componentes modificados.
- Mejoras de navegación y responsividad.
- Pruebas ejecutadas.
- Problemas que no pudieron resolverse.
- Dependencias o contratos que deba proporcionar el agente del simulador.

No hagas commit ni push.

Prioriza corregir problemas estructurales en lugar de aplicar parches CSS aislados.

El resultado debe ser un espacio de trabajo limpio, responsivo y consistente, donde las herramientas científicas puedan utilizarse sin saturar la interfaz.

L2. Evidencia comunicada por el agente solar: el POST requiere `roi` GeoJSON EPSG:4326, `datetime_local` con segundos sin offset y `timezone` IANA explícita; backend no infiere zona. `RightPanel.tsx` hoy envía `America/Mexico_City` fijo para toda ROI. Decisión de interfaz: entrada IANA validada y explícita sin heredar la zona al cambiar ROI; no implementar inferencia geográfica ni algoritmos físicos. `intensity_percent` es factor físico experimental y no opacidad; PNG Inferno solo vista previa, valores numéricos de TIFF/sample/analysis.
L3. Evidencia adicional agente solar: `sunAngle` horario y arco de MapCanvas son ilustrativos, no posición SPA; no mostrar grados como azimut/elevación científica. `position` de corrida incluye azimuth/geometric/apparent; `night` histórico usaba elevación aparente y nuevo usa geométrica, distinguir mediante `code_version`.
L4. Agente solar informa nuevo `analysis_summary` en GET detalle/run.json y `X-Artifact-Integrity` en GET /analysis con errores 404 por hash TIFF distinto y 400 resumen inválido; la UI puede continuar usando GET /analysis, manejando errores sin datos falsos, e invalidar resultados ante ROI/fecha/zona/intensidad distintas.
L5. Integración solicitada por el usuario en el árbol principal, sin commit/push ni worktrees nuevos. Respaldo comprobado `data/integration-backups/frontend-c9a646629763/manifest.json`: 23 rutas (14 modificadas y 9 sin seguimiento en frontend), 16 destinos respaldados, 15 copiados y 8 iguales; sin borrados, sin cambios de backend de esta integración. El puente sin red Django→cliente de `contract_bridge.py` y `contract_bridge.mjs` observó POST/GET análisis/muestra y respuestas 400/404; halló y corrigió el JSON 400 de DRF en forma de lista. Verificación final en principal: 103/103 web, 230/230 solar (entorno nisar, `PYTHONPATH=backend:.`), build y LaTeX OK; lint global sigue con cuatro errores preexistentes en `ScientificFiguresViewer.tsx` y `utils/seismic.ts`. No se pudo ejecutar navegador ni descargas reales; los enlaces nativos TIFF/PNG no informan en el panel si la descarga recibe 404. La verificación independiente detectó y se corrigió error de POST obsoleto tras cambiar parámetros.
