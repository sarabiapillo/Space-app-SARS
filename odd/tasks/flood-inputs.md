# Primer incremento de entradas de inundación
Rama: `simulacion-inundancion`; alcance: backend/pipeline y documentación frontend, sin commits ni publicación.
Pruebas: pytest del pipeline y pruebas Django sin base de datos; sin ejecución hidráulica.

## Specs
- S1: «El físico aprobó el documento conceptual DG2 para terreno no urbano. El producto debe poder atender regiones del mundo donde existan datos suficientes; Chiapas no es un límite geográfico.»
- S2: «El usuario final definirá una lluvia hipotética mediante cantidad o intensidad y duración: no uses lluvia histórica ni pronósticos como entrada obligatoria.»
- S3: «Implementa primero un incremento acotado: contrato y validación de esos parámetros con unidades explícitas».
- S4 (actualizada por entrega del proveedor): «una interfaz para obtener el DEM según la ROI.» «Ya puedes continuar, jale los cambios del compañero que estaba trabajando con NASADEM, ya debería de estar implementado, la documentacion esta en docs.» «Ya, ahora si puedes continuar, eran las variables para  NASA Earthdata Login.» Siguen vigentes: «ni presentes mocks como resultados hidráulicos. NISAR no proporciona por sí mismo DEM, lluvia ni profundidad.»
- S5: «Antes de ejecutar una simulación DG2 real, verifica versión, licencia, formatos y opciones del solver, así como las condiciones iniciales, fronteras y criterios científicos. No supongas soporte de infiltración.»
- S6: «Ejecuta las pruebas aplicables y reporta qué funciona y qué sigue bloqueado. No hagas commits, fusiones ni publicaciones.»
- S7 (sustituye integración frontend inicial): «Por cierto, debes de trabajar solo en el back y preparar la documentación para el front de que datos se le va enviar para que muestren la simulacion.»

## Tasks
- T1 | S1-S7 | ruta: gentle-ai-worker (context backstop) | done | Contrato, validación, interfaz DEM y docs implementados; RED 7 fallos/30 pasaron, GREEN 39 focales, 117 pipeline y 8 Django aprobadas tras corrección. Commit: prohibido por usuario.
- T2 | S1-S7 | ruta: parent | done | Parent repitió suite pipeline 117/117 y Django 8/8; diff --check OK y superficies preservadas verificadas. Commit: prohibido por usuario.

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

L6 — Actualización literal: «Ya puedes continuar, jale los cambios del compañero que estaba trabajando con NASADEM, ya debería de estar implementado, la documentacion esta en docs.» Pausa posterior literal: «Detente, tengo que hacer una ultima cosa.» Reanudación literal: «Ya, ahora si puedes continuar, eran las variables para  NASA Earthdata Login.»
L7 — Reconciliación: árbol limpio en fdc2dca; humano incorporó el plan en 58e254a. Se confirmó docs/nasadem-provider.md: interfaz pública NASADEMProvider(cache_dir).acquire_roi(roi) devuelve ZIP HGT originales y metadatos, NO mosaico/DEM hidráulico. Se permite reutilizar el proveedor entregado (sustituye restricción temporal de S4), sin modificarlo ni inventar API remota. Cobertura NASADEM lat -56 a 60, sin antimeridiano; producto mantiene ROI global y comunica falta de datos. Caché exclusiva de un proceso; no activar descargas desde vista HTTP multiproceso. Adaptador Python inyectable para adquisición explícita; endpoint de preparación sin red ni descargas. Credenciales no se leen/imprimen ni se modifican. T1 retomada, T2 pendiente. No se ejecuta solver ni descarga real como parte de pruebas deterministas.
L8 — Primera entrega worker mwhl9d1f-5-mbd1: 32 pruebas focales, 110 pipeline y 5 Django aprobadas (reportadas). Revisión parent detectó incumplimiento: cantidad sin duración fue aceptada; entero de coordenada 10**400 produjo OverflowError en lugar de validación. Reproducción con conda run -n nisar python -c exit 0; stdout confirmó ambos. El primer intento de reproducción usando stdin en conda no emitió salida y no sirve como evidencia. T1 sigue in_progress hasta corrección acotada de estos errores y precisión del estado DEM. Se solicita una corrección de contrato y geometría con pruebas RED/GREEN y documentación correspondiente; T2 aún pendiente.
L9 — Corrección mwhlpvtv-6-ki0h completada: worker verificó duración en ambos modos, duration_s, intensidad media y validación estricta ROI; estado DEM provider_available sin afirmar datos disponibles. Reportó RED 7 fallos/30 pasaron, GREEN 39 focales; suite completa 117 aprobadas/109 warnings y 8 pruebas Django sin BD, diff --check exit 0. Fallos transitorios de expectativas/sintaxis de pruebas Django corregidos; no quedaron fallos reportados. T1 terminada; T2 en curso para comprobación parent. No se ejecutó hidráulica/adquisición real ni se verificaron credenciales.
L10 — Verificación final parent: `git diff --check && PYTHONPATH=. conda run -n nisar python -m pytest -q -p no:cacheprovider && PYTHONPATH=. conda run -n nisar python backend/manage.py test analyses --noinput` exit 0, 117 pytest en 11.53s, 109 warnings Rasterio (PendingDeprecationWarning y NotGeoreferencedWarning), 8 Django en 0.516s, sin problemas de system check. Lectura del contrato corregido y tests exactos confirmó duración obligatoria y estado sin simulación. `git diff --name-only -- README.md docs/guia-simulacion-inundacion.md docs/flujo-dg2-simulacion-inundacion.tex docs/flujo-dg2-simulacion-inundacion.pdf web/ pipeline/elevation/` no produjo salida. Sin commits, publicaciones, fusiones ni modificaciones de credenciales. Sin fallos pendientes del incremento. No se ejecutaron solver ni descarga real: son pasos científicos externos futuros, no pruebas omitidas de esta API. Risk: none (endpoint aditivo, helpers nuevos aislados, sin cambiar consumidores preexistentes ni controles de seguridad). Próximo incremento: preparar/validar DEM hidráulico y resolver/verificar solver, licencia, condiciones, fronteras, infiltración y criterios antes de resultados.
