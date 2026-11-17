# Paralelismo acotado de escenas ROI
Rama: `research/roi-preparation-performance`. Entrega: ask-on-risk; chain_strategy=feature-branch-chain elegido por el usuario; commit aislado de concurrencia sin publicar.
Pruebas: `pytest -q pipeline/tests/test_roi_explore.py pipeline/tests/test_roi_http.py`; `node --test web/tests/roi.test.mjs`; `npm run build` en `web/`.

## Specs
S1. «si, autorizo» acepta la propuesta inmediatamente anterior: «implementar ahora ese paralelismo acotado en la rama, sin desplegarlo ni borrar la caché». Comprobar hasta dos escenas en procesos aislados, con resultado en orden y las mismas salidas.
S2. «¿como podríamos optimizar en temas de tiempo sin perdes nada de la información que necesitamos o es usada?» Conservar COG, PNG, gráficas, metadatos, procedencia y verificaciones de comparabilidad; no alterar los algoritmos científicos.

## Tasks
T1 (S1-S2) — done; ruta: gentle-ai-worker + corrección parent; compromiso: pendiente T2; pruebas focalizadas 20/20 con COPY_ROOT aislado y --basetemp local único; docs actualizados. Dos procesos por escena, deadline desde pre-búsqueda, polling fail-fast y cleanup implementados.
T2 (S1-S2) — in_progress; ruta: parent + gentle-ai-verify (Risk: item 4, concurrencia); compromiso: pendiente. Re-verificación independiente limitada 5/5 aprobadas, suite ROI 20/20, compila LaTeX; commit aislado pendiente. Sin verificación real ASF/RAM ni ASSESS nativo (binario ausente).

## Log
L1. Usuario: «si, autorizo».
L2. Propuesta aceptada (asistente): «El primer cambio que propongo es procesar las dos escenas en paralelo, en procesos aislados y con un máximo de dos por trabajo. Mantendría el orden del resultado, las comprobaciones científicas y todos los archivos; lo probaría con datos sintéticos antes de afirmar una mejora. Por ser un cambio de concurrencia, también requiere verificación independiente. Para activarlo en producción necesitaríamos comprobar que el servidor tiene memoria suficiente y medir una corrida nueva; no puedo prometer todavía cuánto bajarán los 3 min 14 s. ¿Me autorizás a implementar ahora ese paralelismo acotado en la rama, sin desplegarlo ni borrar la caché?».
L3. Evidencia de referencia (2026-11-17): una ROI distinta de Acapulco guardó 194,27 s servidor; ASF 20,54 s; escenas secuenciales 94,69 y 79,01 s. No inferir ganancia sin corrida comparable.
L4. Riesgo: item 4 (concurrencia); preservar cambios ajenos en `.gitignore` y `references/`. No leer `.env` (denegado por política), no ejecutar red ni borrar caché.
L5. La instrumentación previa se aisló en el commit `2d1ee10` (`perf(roi): record preparation timings`); no incluye cambios ajenos. ASSESS nativo de este commit no disponible (`package-local-binary-missing`); no inventar tier ni aprobación.
L6. T1 GREEN: worker 18/18 pruebas ROI, 20/20 web focalizadas, build web; parent confirmó 18/18 ROI. ASSESS para diff con escalación item 4 devolvió high, nativeRisk unassessable por `package-local-binary-missing`, plan exige verificador independiente en T2. Ninguna prueba remota de ASF/Earthdata; no se afirma mejoría temporal.
L7. Verificador independiente detectó: timeout externo de 1800 s puede matar al padre mientras dos hijos aún corren (deadline actual comienza tras búsqueda ASF); fallo del segundo hijo detectado tarde; pytest escribe en `data/graficas-roi/run` fuera de scratch y ese destino existe. Su corrida no ejecutó tests por preservar datos. Se reabre T1 para una sola corrección del conjunto; no reintentar sin aislar COPY_ROOT.
L8. Corrección: deadline compartido desde antes de búsqueda, poll de ambos hijos, tests COPY_ROOT aislados. Primera prueba aislada 15/20 por defectos de mocks/rutas en test; tras corregir esos casos, 19/20 porque el mock de fallo no reportaba `poll`; segundo ajuste del mismo test produjo 20/20 con `--basetemp=data/roi-parallel-second-correction-20261117`. Aún falta re-verificación independiente limitada a esos tres bloqueos; no real ASF ni medición de RAM.
L9. Re-verificación independiente limitada 5/5 aprobadas, 17 advertencias Rasterio; no se probó terminación real de hijos bajo timeout 1800 ni producción Windows/ASF. LaTeX compiló con advertencias de caja ancha. Previsión de rama: commit instrumentación 127 líneas autoradas y diff concurrente ~321 (total ~448), activa elección humana de estrategia de entrega antes del commit siguiente; no publicar sin permiso.
L10. Usuario eligió `feature-branch-chain` (cadena desde rama de feature, recomendado) como estrategia eventual de revisión; no autoriza publicar, crear PR ni merge. Se levanta bloqueo de commit aislado.
