Continúa TerraPulse AI en /Proyectos/Space-app-SARS (rama simulacion-inundacion).
Alcance: backend/pipeline y documentación para frontend. Trabaja de forma
secuencial, sin investigación ni refactors fuera de las tareas listadas.

## Antes de editar
1. Lee AGENTS.md y odd/tasks/flood-dg2-input-exports.md (completo). Corre git status
   y git log -1 para confirmar rama y HEAD (hay un merge reciente).
2. Engram (proyecto space-app-sars): mem_context y búsqueda de
   "architecture/flood-simulation-assessment" y "odd/flood-dg2-input-exports/tasks".
   Lee solo las observaciones relevantes a las tareas de abajo.
3. Hay mucho trabajo sin commit: consérvalo.

## Restricciones
- Sin commits, merges ni publicaciones.
- No borres ni restaures cambios ni cachés.
- No modifiques el sistema, nisar ni data/tools/dg2-build-env.
- No parchees las fuentes de LISFLOOD-FP.
- La ejecución local de LISFLOOD-FP (GPLv2-only) está permitida; la
  redistribución del binario o la fuente queda fuera de alcance.
- No repitas el smoke T030 salvo que una tarea lo requiera.

## Estado verificado
- LISFLOOD-FP 8.0.3 (float, CPU) compilado y ejecutado sobre un caso sintético
  adaptado del oficial T030: 2 s, exit 0, 15 archivos. No es una simulación de la
  ROI del usuario y no valida precisión hidráulica.
- Binario: data/tools/lisflood-fp-8.0/runtime/build/lisflood
- Evidencia en esa misma raíz: runtime/smoke-t030/{case-manifest.json, smoke.par,
  solver.log, run-proof.json (con hashes), results/}.
- Pendientes sin investigar: el log avisa que falta getfattr, y el archivo .mass
  tiene Qerror/Verror no nulos. Repórtalos como pendientes; no afirmes balance validado.
- Toolchain aislada lista en data/tools/dg2-build-env (CMake 3.31, libnetcdf, NUMA).
  Copia de la fuente en runtime/source.
- Ya implementado: frontera FREE idealizada, guía y licencia; NetCDF de lluvia
  corregido.
- Línea base de pruebas (anterior a esas entregas): 181 pytest + 11 Django. Úsala
  como referencia, no como estado actual.
- Aún NO existen dem_dg2.py ni results.py, y generateDG2DEM no está compilado.
- API actual: solo POST /api/flood-scenarios/prepare/ (rainfall_profile opcional),
  documentada en docs/api-simulacion-inundacion.md. No hay endpoints DG2 reales.

## Decisiones vigentes
- Terreno no urbano/global, según datos disponibles.
- NASADEM es elevación EGM96, no profundidad.
- NISAR orienta la extensión observada, no h0; lo desconocido no se vuelve seco
  automáticamente.
- Lluvia hipotética temporal ±10 mm/h, reproducible, conservando el acumulado;
  uniforme dentro de la ROI y cero fuera.
- La duración de la simulación la define el usuario de forma explícita.
- FREE puede permitir entrada/salida y no es frontera medida.
- Manning e infiltración: usa solo valores dados por datos o por el usuario; el
  CPU DG2 8.0 inspeccionado no aplica infiltración.
- Mantén las etiquetas sintético/no validado hasta tener pruebas apropiadas. La
  validación física y las tolerancias van al final; durante el desarrollo, pruebas
  de software y de formatos.

## Tareas (en orden)
1. Compila generateDG2DEM reutilizando el build existente. Crea dem_dg2.py para
   preparar DEM/coeficientes con esa utilidad oficial, con pruebas.
2. Crea results.py: lector/conversor de salidas DG2 para frontend, con pruebas
   usando runtime/smoke-t030/results/.
3. Integra el ejecutable y agrega endpoints iniciar/estado/resultados. Actualiza
   docs/api-simulacion-inundacion.md para frontend.
4. Corre la suite completa (pytest + Django). Verifica binario y entorno
   (hashes contra run-proof.json y el ítem de riesgo correspondiente en el task file).

## Criterio de cierre
Todas las pruebas pasan, la verificación del paso 4 está hecha, y el reporte final
lista archivos cambiados, resultados de pruebas y pendientes abiertos (incluidos
Qerror/Verror y getfattr).

## Ritmo de trabajo (prioridad: rapidez)
- Empieza a implementar en cuanto termines la lectura inicial. No explores
  código que no vayas a tocar.
- Reutiliza los patrones y módulos existentes del backend. No refactorices.
- Haz el cambio más simple que cumpla la tarea; sin abstracciones extra.
- Durante el desarrollo corre solo las pruebas del módulo que tocas. La suite
  completa (pytest + Django) se corre una sola vez, al final.
- Agrupa llamadas de herramientas independientes (lecturas, comandos) en un
  mismo paso.
- No releas archivos ya leídos ni repitas comandos que ya dieron resultado.
- Si algo bloquea más de un intento razonable, anótalo como pendiente y sigue
  con la siguiente tarea.
- Reporte final breve: archivos cambiados, resultado de pruebas, pendientes.