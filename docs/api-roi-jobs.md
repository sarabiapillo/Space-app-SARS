# Preparación de capas NISAR para una ROI dibujada en el mapa (`/api/roi-jobs`)

> Commit `863fa3f` (2026-11-15). Código: `pipeline/roi_explore.py`, `backend/scenes/roi_views.py`, `backend/scenes/roi_urls.py`, `web/src/hooks/useRoiLayers.ts`, `web/src/utils/roi.ts` y los cambios en `MapCanvas`, `Sidebar` y `Header`.
> Pruebas: `pipeline/tests/test_roi_explore.py`, `pipeline/tests/test_roi_http.py`, `web/tests/roi.test.mjs`.

## 1. Qué hace

1. El usuario dibuja un rectángulo en el mapa a partir de dos esquinas (`rectangleFromCorners`).
2. El frontend lo envía a `POST /api/roi-jobs` como `Polygon` GeoJSON en EPSG:4326.
3. El backend crea un trabajo en disco y lo ejecuta en un **proceso aparte** (`python -m pipeline.roi_explore <carpeta>`), con un límite de 30 minutos. En POSIX, el coordinador inicia una sesión nueva y, al vencer el límite o terminar con error, envía `SIGKILL` a su grupo y recoge al coordinador; el alcance es ese grupo aislado, no procesos ajenos. Si no se puede señalizar el grupo, el respaldo solo detiene al coordinador y no garantiza terminar descendientes. En Windows intenta detener el árbol con `taskkill /T /F` y recoge al coordinador. Si esa orden no está disponible o no confirma éxito, el respaldo solo puede detener al coordinador: no se garantiza la terminación de sus descendientes. Ese proceso:
   1. **Busca escenas:** consulta en ASF las escenas GCOV que intersectan la ROI (`get_source('asf').search`).
   2. **Elige las escenas** (`select_scenes`):
      - descarta las que no tienen madurez conocida;
      - busca el par **comparable** más reciente según `compat.check_pair`, que nunca mezcla CRID ni madurez;
      - si no hay par, usa una sola fecha.
   3. **Genera las capas:** con una sola escena, conserva el flujo directo de `etapa1`; con un par comparable, inicia dos procesos Python independientes, uno por `scene_id`, para ejecutar ambos `etapa1` en paralelo. Cada proceso lee por HTTPS únicamente los bloques de su escena dentro de la ROI y escribe su manifiesto y gráficas en el índice de escena correspondiente. La selección mantiene el orden del par y el ensamblado respeta ese orden. La búsqueda ASF y la comparación de mallas, copia de gráficas y publicación siguen siendo secuenciales. El límite de 25 minutos empieza antes de buscar en ASF, dejando margen frente al límite de 30 minutos del proceso padre; si vence antes de lanzar procesos, no se inicia ninguno. Un fallo o vencimiento detiene y recoge los procesos activos, y el estado público usa un mensaje controlado. La preparación registra duraciones monotónicas por fase: búsqueda ASF, procesamiento por escena, comparación de mallas, copia de gráficas y total del servidor.
   4. **Compara las mallas:** si hay dos fechas, verifica que los COG tengan el mismo CRS, la misma transformación y la misma forma. Solo entonces marca `comparable: true` y el frontend habilita el deslizador.
   5. **Gráficas y copia (2026-11-15):** junta el `graficas.json` de cada fecha (ángulo de incidencia, histograma de retrodispersión γ⁰ HH/HV y máscara QA de subfranja, **calculados sobre la ROI dibujada**) en `result.json → charts` y guarda una copia en `data/graficas-roi/<id>/` (§2.1).
   6. **Mapa de cambio (2026-11-18):** si el par es comparable, `build_change` calcula Δ = t2 − t1 en γ⁰ dB a partir de la **potencia lineal** de cada fecha que deja `etapa1` en `layers/<granuleId>/geotiff/gamma0_<capa>.tif` (resolución del producto, ya enmascarada con la `mask` del producto y la ROI). Usa `pipeline/change.py → change_from_linear_cogs`: verifica que la malla coincida, hace el **multilook n×n promediando potencia lineal antes del dB** y escribe `layers/cambio/ml<n>_u<umbral>/` (`delta_<pol>_dB.tif`, `zscore_<pol>.tif`, `cambio_<pol>.tif`, `change.json`) y las capas web `web/delta_gamma0_<pol>_ml<n>_dB.{tif,png}` con paleta azul–blanco–rojo ±6 dB (la escala no depende del umbral). **Por defecto: multilook 5×5 (50 m con GCOV de 10 m) y umbral ±3 dB**; las capas de inspección de cada fecha siguen a 2×2. El resultado va en `result.json → change` (manifiesto con `capas`, `metricas` por polarización, `umbral_dB`, `multilook`, `pixel_m`, `opciones` y `advertencias`). Con una sola fecha, `change` es `null`.
      - **Ruido de referencia por ROI:** cada polarización trae `ruido_dB` (1.4826 · MAD del Δ en la ROI), `umbral_sobre_ruido`, `umbral_cerca_del_ruido` (umbral < 3 × ruido) y `pct_abs_z_mayor_3`. Si el umbral está cerca del ruido, `advertencias` lo dice. El umbral se mantiene en **dB fijo** para que las cifras sean comparables entre ROIs; el ruido y el |z| son solo referencia de qué tan confiable es ese umbral en esa ROI.
4. Al terminar el subproceso, Django carga esa copia en PostGIS con el mismo código que `load_explore` (§2.1).
5. El frontend consulta el estado cada 1.8 s y, al terminar, superpone los PNG en MapLibre. Si hay `change`, se habilita el botón **Cambio Δ** de la cinta: muestra la capa Δ de la misma polarización elegida (HH o HV), sin pasar por la LUT, y la barra de color indica las áreas que bajan o suben ≥ umbral (`web/src/utils/changeLayer.ts`). En la misma barra, `ChangeControls.tsx` permite elegir **resolución** (20 / 50 / 100 m) y **umbral** (±1.5 a ±6 dB), muestra el ruido de la ROI y el |z| > 3, y avisa si el umbral está cerca del ruido. Cada cambio llama a `POST /api/roi-jobs/{id}/change`. El frontend también dibuja las gráficas con Chart.js en el Sidebar ("Gráficas NISAR de la ROI") y en el panel **Simulador Solar & Radiación**.

El resultado se describe como **inspección exploratoria**: no es un mapa de cambio ni identifica causas.

## 2. Endpoints

| Método y ruta | Respuesta |
|---|---|
| `POST /api/roi-jobs` con `{"roi": {"type": "Polygon", "coordinates": [[[lon, lat], …]]}}` | `202 {"id": "<sha256>"}`. `400` si la ROI no es válida. `429` si ya hay 3 trabajos activos |
| `GET /api/roi-jobs/{id}` | `{"status": "queued" \| "running" \| "ready" \| "error", "message": "…"}`. En `ready` agrega `manifests` (uno o dos `capas.json`), `comparable`, `charts` (`[{granuleId, fecha, manifest: graficas.json}]`), `copia_disco` y `copia` (estado de la copia en disco y en base) |
| `POST /api/roi-jobs/{id}/change` con `{"multilook": 2 \| 5 \| 10, "umbral_dB": 1.5 \| 2 \| 2.5 \| 3 \| 4 \| 5 \| 6}` | `200` con el manifiesto del mapa de cambio (mismo formato que `change`, con URLs de assets). Recalcula **solo el Δ** desde la potencia lineal ya guardada: no vuelve a ASF (0.1–1.5 s en la ROI de prueba). `400` si los valores no están en las opciones o la ROI no tiene par comparable; `409` si la ROI no está lista o esa combinación se está calculando; `404` si el trabajo no existe |
| `GET /api/roi-jobs/{id}/assets/<ruta>` | El `.png` o `.tif` de una capa. Solo sirve archivos dentro de `layers/` del trabajo |

En estado `ready`, la API incluye `timings` con duraciones en segundos (`float`): `search_asf_seconds`, `scene_processing_seconds` (un elemento por escena, en el mismo orden de `manifests`; lectura H5 y exportación son una fase conjunta), `grid_compare_seconds`, `chart_copy_seconds` y `server_prepare_total_seconds`. Si hay dos escenas, sus procesos pueden solaparse; el orden de resultados no depende del orden de finalización. El presupuesto compartido de 25 minutos empieza al iniciar `prepare` e incluye la búsqueda ASF; si vence antes del lanzamiento no se inicia ningún hijo. Durante el procesamiento se revisa periódicamente el estado de todos los hijos, y un fallo o vencimiento detiene y recolecta los procesos pendientes. El margen restante queda para limpieza antes del límite de 30 minutos del proceso padre; el error público es genérico. `copia.timings.database_copy_seconds` mide la copia a PostGIS cuando esta se intenta. El navegador muestra el tiempo hasta cargar las imágenes y un desglose desplegable de las fases del servidor; el hook expone `preparationSeconds`, desde el inicio del POST hasta que se cargan las imágenes. Al cambiar o reintentar la ROI, borra los tiempos previos. Son mediciones monotónicas locales; no incluyen espera atribuible a tiempos absolutos ni identifican el desglose interno de la fase por escena. No se incluyen URLs, credenciales ni datos por píxel.

**Reglas de la ROI** (`validate_roi`):
- un `Polygon` de 4 a 100 vértices, cerrado, válido y sin agujeros;
- longitud entre −180 y 180, latitud entre −85 y 85;
- **0.6° por lado como máximo**, medido sobre la caja que la contiene.

**Caché y concurrencia:**
- El `id` es un SHA-256 de la ROI y la versión del código, con el prefijo de formato `roi-web-3` (desde que `change` sale a 5×5 desde potencia lineal, con ruido de referencia y `opciones`; los trabajos anteriores no se reutilizan). La misma ROI pedida el mismo día con el mismo código reutiliza el resultado.
- Un directorio `reservation/` evita duplicar el trabajo entre procesos.
- Un trabajo sin avance por más de 35 minutos se da por interrumpido.
- **Recálculo del cambio:** cada combinación queda en `layers/cambio/ml<n>_u<umbral>/` y se reutiliza. Se guardan la de por defecto (`ml5_u3`) y las 4 más recientes (`CHANGE_CACHE_KEEP`). Un directorio `<combinación>.lock` evita calcular dos veces la misma (se libera a los 5 minutos si quedó huérfano).

**Archivos:** cada trabajo vive en `data/roi-runs/<id>/` (o en `ROI_OUTPUT_ROOT` de `settings`): `request.json`, `status.json`, `catalog.json`, `config.yaml`, `layers/` y `result.json`.

**Errores públicos:** el proceso nunca devuelve detalles de la sesión HTTPS, URLs firmadas ni credenciales. Un fallo desconocido muestra: *"No se pudo preparar la ROI. Verifica acceso Earthdata, cobertura y conexión del servidor."*

### 2.1 Copia de las gráficas de cada ROI

| Dónde | Qué queda | Cuándo |
|---|---|---|
| `data/graficas-roi/<id>/<granuleId>/` | `graficas.json` y `metadatos.json` de cada fecha | Al final de `pipeline.roi_explore` |
| `data/graficas-roi/<id>/roi.json` | id del trabajo, WKT de la ROI, escenas, fecha y versión del código | Igual |
| PostGIS (`scenes_roi`, `scenes_scene`, `scenes_sceneinspection`, `scenes_scenechart`) | Una ROI llamada `roi-<12 primeros caracteres del id>` y una inspección por (escena, ROI, versión del código) con sus 3 gráficas | Justo después, en el hilo del trabajo (`roi_views.copy_to_database`) |
| `data/roi-runs/<id>/copia.json` | `{"disco", "base_datos": "ok" \| "parcial" \| "no disponible", "escenas", "errores"}` | Igual |

- **La copia en disco no depende de Docker.** Si PostGIS está apagado, el trabajo termina igual y `copia.json` dice `"no disponible"`. Para cargarla después: `python manage.py load_explore --todas --dir data/graficas-roi/<id>`.
- **`data/roi-runs/` es caché** (se puede borrar); `data/graficas-roi/` es la copia que se conserva.
- **Consulta por API:** `GET /api/scenes/{granuleId}/charts?roi=<roi_id>` (ver `api.md`).

## 3. Requisitos para que funcione

- **`PYTHONPATH`:** Django debe arrancar con la raíz del repo en `PYTHONPATH`, porque `roi_views.py` importa `pipeline.*`. Es la misma convención de `configuracion-servicio-inundacion.md` y `solar-api.md`:
  ```
  PYTHONPATH=.:backend python backend/manage.py runserver
  ```
- **Credenciales:** las de Earthdata (`EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` o `.netrc`) deben estar en el entorno del proceso del servidor.
- **Frontend:** necesita el proxy de `/api` hacia Django (ver `api.md`). Las imágenes se piden en `/api/roi-jobs/…/assets/…`.

## 4. Verificación (2026-11-15, Windows local)

| Qué | Resultado |
|---|---|
| `pytest pipeline/tests/test_roi_explore.py test_roi_http.py` (ROI válida o inválida, caché, selección de par sin mezclar versiones, preparación remota simulada, deduplicación, límite de assets) | ✅ pasan |
| `node --test web/tests/roi.test.mjs` (rectángulo a partir de dos esquinas y rechazo de rectángulos degenerados o excesivos) | ✅ 2/2 |
| `npm run build` | ✅ compila |
| `eslint` sobre los archivos de este commit | ✅ sin errores |
| **Prueba real en Windows (2026-11-15)**: ROI de 0.05° × 0.04° cerca de Tuxtla (`-93.15…-93.10, 16.74…16.78`) | ✅ 2 min 3 s. Eligió el par comparable más reciente T62/F10 2026-10-04 → 2026-10-16 (P05023), 100 % válido en la ROI, `comparable: true`. Gráficas: γ⁰ HH media de los dB −5.06 / −5.07 dB, HV −11.30 / −11.28 dB; incidencia 43.87° a 500 m; los conteos suman los 235 586 píxeles. Copia en `data/graficas-roi/prueba-e2e-202611150926/` y en PostGIS (ROI id 2, 2 inspecciones, 6 gráficas); `/api/scenes/…/charts?roi=2` responde 200 |
| **Recálculo con datos reales (2026-11-18, WSL)**: ROI `574924…` cerca de Tuxtla, par P05036 2026-10-28 → 2026-11-09, 9.3 km² | ✅ A 20 m el Δ es idéntico bit a bit al cálculo anterior desde los COG dB 2×2. Ruido HH: 1.53 dB (20 m), 0.70 dB (50 m), 0.39 dB (100 m). Con ±3 dB: 20 m marca 2.96 % baja / 2.88 % sube y avisa "cerca del ruido"; 50 m marca 0.00 % / 0.03 %. Entre las ROIs guardadas, el ruido a 20 m va de 1.09 a 1.53 dB. `POST /api/roi-jobs/{id}/change` con las URLs reales de Django responde 200 y sirve el PNG |
| **Prueba real contra ASF/Earthdata desde la VPS** | ⏳ **No verificada.** Depende del despliegue: credenciales de Earthdata en el servidor, salida HTTPS hacia ASF y tiempo real de preparación con una ROI de 0.6° |
