# Primer incremento de entradas de inundación
Rama: `simulacion-inundancion`; alcance: backend/pipeline y documentación frontend, sin commits ni publicación.
Pruebas: pytest del pipeline y pruebas Django sin base de datos; sin ejecución hidráulica.

## Specs
- S1: «El físico aprobó el documento conceptual DG2 para terreno no urbano. El producto debe poder atender regiones del mundo donde existan datos suficientes; Chiapas no es un límite geográfico.»
- S2: «El usuario final definirá una lluvia hipotética mediante cantidad o intensidad y duración: no uses lluvia histórica ni pronósticos como entrada obligatoria.»
- S3: «Implementa primero un incremento acotado: contrato y validación de esos parámetros con unidades explícitas».
- S4: «una interfaz para obtener el DEM según la ROI. No inventes ni conectes todavía la URL de la API del DEM: otro compañero entregará su contrato. No uses NASADEM ni presentes mocks como resultados hidráulicos. NISAR no proporciona por sí mismo DEM, lluvia ni profundidad.»
- S5: «Antes de ejecutar una simulación DG2 real, verifica versión, licencia, formatos y opciones del solver, así como las condiciones iniciales, fronteras y criterios científicos. No supongas soporte de infiltración.»
- S6: «Ejecuta las pruebas aplicables y reporta qué funciona y qué sigue bloqueado. No hagas commits, fusiones ni publicaciones.»
- S7 (sustituye integración frontend inicial): «Por cierto, debes de trabajar solo en el back y preparar la documentación para el front de que datos se le va enviar para que muestren la simulacion.»

## Tasks
- T1 | S1-S7 | ruta: gentle-ai-worker (context backstop) | blocked (esperando que el usuario termine de traer cambios y autorice retomar) | Implementar contrato y validación de lluvia/ROI, interfaz DEM inyectable, endpoint de preparación sin solver y documentación frontend; RED/GREEN y autorrevisión. Commit: prohibido por usuario.
- T2 | S1-S7 | ruta: parent | pending | Comprobar integración, pruebas aplicables, preservación documental y límites; cerrar evidencia. Commit: prohibido por usuario.

## Log
L1 — Solicitud inicial literal:
Continúa TerraPulse AI en /Proyectos/Space-app-SARS e inicia un primer incremento de desarrollo para la simulación de inundación. Recupera el contexto de
 │ Engram del proyecto space-app-sars, especialmente architecture/flood-simulation-assessment; lee AGENTS.md y revisa git status antes de editar. Conserva los
 │ cuatro cambios documentales sin commit de la rama simulacion-inundancion.
 │
 │ El físico aprobó el documento conceptual DG2 para terreno no urbano. El producto debe poder atender regiones del mundo donde existan datos suficientes;
 │ Chiapas no es un límite geográfico. El usuario final definirá una lluvia hipotética mediante cantidad o intensidad y duración: no uses lluvia histórica ni
 │ pronósticos como entrada obligatoria.
 │
 │ Implementa primero un incremento acotado: contrato y validación de esos parámetros con unidades explícitas, integración con el frontend React/MapLibre
 │ existente y una interfaz para obtener el DEM según la ROI. No inventes ni conectes todavía la URL de la API del DEM: otro compañero entregará su contrato. No
 │ uses NASADEM ni presentes mocks como resultados hidráulicos. NISAR no proporciona por sí mismo DEM, lluvia ni profundidad.
 │
 │ Antes de ejecutar una simulación DG2 real, verifica versión, licencia, formatos y opciones del solver, así como las condiciones iniciales, fronteras y
 │ criterios científicos. No supongas soporte de infiltración. Si falta una decisión imprescindible para el primer incremento, haz una pregunta concreta.
 │ Ejecuta las pruebas aplicables y reporta qué funciona y qué sigue bloqueado. No hagas commits, fusiones ni publicaciones.. Si tienes alguna pregunta durante el desarrollo, hazla.

L2 — Corrección literal posterior: «Ya continua, ya deberías de poder ver los cambios en la rama. Por cierto, debes de trabajar solo en el back y preparar la documentación para el front de que datos se le va enviar para que muestren la simulacion.» Última autorización tras pausa: «Ya continua.»
L3 — Estado reconciliado: rama simulacion-inundancion limpia en 1f0df32 tras fusión realizada por humano. Los cuatro archivos documentales previos ya están en el historial (8cd8ad6), no se restauran ni modifican. Backend scaffold con DRF instalado y rutas solo admin; pipeline independiente. No se integra IMERG ni proveedor DEM pese a recomendaciones del explorador que contradicen la solicitud.
L5 — Pausa explícita: «Detente, jalare unos cambios.» Se canceló worker mwhkvpg4-3-bif1 y se confirmó estado cancelled. Git muestra únicamente odd/ sin seguimiento: no hay cambios fuente ni de documentación API. T1 espera al usuario; T2 permanece pendiente por orden. Antes de retomar reconciliar git y documento.

L4 — Alcance técnico: endpoint sin persistencia para preparar/validar entradas, no crear ni ejecutar simulación. Admite ambas formas de lluvia y unidades explícitas, devuelve normalización SI y faltantes. Distribución espacial/temporal, estado inicial, fronteras e infiltración permanecen pendientes, no se deciden por defecto. Interfaz DEM interna, no contrato externo inventado. Documentar respuesta vigente sin capas hidráulicas; cualquier esquema futuro de resultados se marca propuesto, no implementado. Sin cambios en web/, configuración SAR ni documentos previos. Forecast aproximado: 400-600 líneas con pruebas/documentación, sin PR/commits por instrucción humana.
