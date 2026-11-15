# Preparación de capas NISAR para una ROI dibujada en el mapa (`/api/roi-jobs`)

> Commit `863fa3f` (2026-11-15). Código: `pipeline/roi_explore.py`, `backend/scenes/roi_views.py`, `backend/scenes/roi_urls.py`, `web/src/hooks/useRoiLayers.ts`, `web/src/utils/roi.ts` y los cambios en `MapCanvas`, `Sidebar` y `Header`.
> Pruebas: `pipeline/tests/test_roi_explore.py`, `pipeline/tests/test_roi_http.py`, `web/tests/roi.test.mjs`.

## 1. Qué hace

1. El usuario dibuja un rectángulo en el mapa a partir de dos esquinas (`rectangleFromCorners`).
2. El frontend lo envía a `POST /api/roi-jobs` como `Polygon` GeoJSON en EPSG:4326.
3. El backend crea un trabajo en disco y lo ejecuta en un **proceso aparte** (`python -m pipeline.roi_explore <carpeta>`), con un límite de 30 minutos. Ese proceso:
   1. **Busca escenas:** consulta en ASF las escenas GCOV que intersectan la ROI (`get_source('asf').search`).
   2. **Elige las escenas** (`select_scenes`):
      - descarta las que no tienen madurez conocida;
      - busca el par **comparable** más reciente según `compat.check_pair`, que nunca mezcla CRID ni madurez;
      - si no hay par, usa una sola fecha.
   3. **Genera las capas:** corre `etapa1` en remoto por cada escena, con `--sin-vista --sin-figuras --escala-web -22 0`. Solo lee por HTTPS los bloques de la ROI.
   4. **Compara las mallas:** si hay dos fechas, verifica que los COG tengan el mismo CRS, la misma transformación y la misma forma. Solo entonces marca `comparable: true` y el frontend habilita el deslizador.
   5. **Gráficas y copia (2026-11-15):** junta el `graficas.json` de cada fecha (ángulo de incidencia, histograma de retrodispersión γ⁰ HH/HV y máscara QA de subfranja, **calculados sobre la ROI dibujada**) en `result.json → charts` y guarda una copia en `data/graficas-roi/<id>/` (§2.1).
4. Al terminar el subproceso, Django carga esa copia en PostGIS con el mismo código que `load_explore` (§2.1).
5. El frontend consulta el estado cada 1.8 s y, al terminar, superpone los PNG en MapLibre y dibuja las gráficas con Chart.js en el Sidebar ("Gráficas NISAR de la ROI") y en el panel **Simulador Solar & Radiación**.

El resultado se describe como **inspección exploratoria**: no es un mapa de cambio ni identifica causas.

## 2. Endpoints

| Método y ruta | Respuesta |
|---|---|
| `POST /api/roi-jobs` con `{"roi": {"type": "Polygon", "coordinates": [[[lon, lat], …]]}}` | `202 {"id": "<sha256>"}`. `400` si la ROI no es válida. `429` si ya hay 3 trabajos activos |
| `GET /api/roi-jobs/{id}` | `{"status": "queued" \| "running" \| "ready" \| "error", "message": "…"}`. En `ready` agrega `manifests` (uno o dos `capas.json`), `comparable`, `charts` (`[{granuleId, fecha, manifest: graficas.json}]`), `copia_disco` y `copia` (estado de la copia en disco y en base) |
| `GET /api/roi-jobs/{id}/assets/<ruta>` | El `.png` o `.tif` de una capa. Solo sirve archivos dentro de `layers/` del trabajo |

**Reglas de la ROI** (`validate_roi`):
- un `Polygon` de 4 a 100 vértices, cerrado, válido y sin agujeros;
- longitud entre −180 y 180, latitud entre −85 y 85;
- **0.6° por lado como máximo**, medido sobre la caja que la contiene.

**Caché y concurrencia:**
- El `id` es un SHA-256 de la ROI, la versión del código y la fecha UTC. La misma ROI pedida el mismo día con el mismo código reutiliza el resultado.
- Un directorio `reservation/` evita duplicar el trabajo entre procesos.
- Un trabajo sin avance por más de 35 minutos se da por interrumpido.

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
| **Prueba real contra ASF/Earthdata desde la VPS** | ⏳ **No verificada.** Depende del despliegue: credenciales de Earthdata en el servidor, salida HTTPS hacia ASF y tiempo real de preparación con una ROI de 0.6° |
