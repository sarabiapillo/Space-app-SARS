# API REST (contrato C4) — TerraPulse

> Backend: Django + DRF en `backend/` (P4). Consumidores: P5 (Explorador, Comparador) y P6 (Laboratorio, Exportación).
> Base de datos: [bd-docker.md](bd-docker.md). Datos de las gráficas: [p1-graficas-chartjs.md](p1-graficas-chartjs.md).
> Actualizado: 2026-11-15. Todo es de **solo lectura** (`GET`); `POST`/`PUT`/`DELETE` responden 405.

## Estado

| Endpoint | Estado |
|---|---|
| `GET /api/rois` | ✅ |
| `GET /api/scenes` (filtros) | ✅ |
| `GET /api/scenes/{scene_id}` | ✅ |
| `GET /api/scenes/{scene_id}/charts` | ✅ |
| `GET /api/scenes/{scene_id}/charts/{chart_id}` | ✅ |
| `GET /api/changes`, `/api/changes/{id}`, `/api/changes/{id}/report` | ⏳ Esperan a C2 (`run.json` de P2) y C3 (`validation.json` de P3) |
| `GET /api/compat?t1=&t2=` | ⏳ Pendiente (usará `pipeline.compat`) |

Mientras un endpoint no existe, el cliente del frontend (`web/src/api/client.ts`) usa los mocks sintéticos de C4.

## Levantar la API en local

```
docker compose up -d                 # PostGIS (ver bd-docker.md)
conda activate nisar
cd backend
python manage.py migrate
python manage.py load_explore --todas   # carga data/explore/ (requiere graficas.json)
python manage.py runserver           # http://localhost:8000/api/…
```

### Conectar el frontend (Vite) en desarrollo

El cliente pide rutas relativas (`/api/scenes`), así que en desarrollo Vite debe reenviarlas a Django. Hay que agregar esto a `web/vite.config.ts`, que es de P5:

```ts
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
```

Con el proxy, el navegador ve el mismo origen y no hace falta configurar CORS. El cliente tiene un tiempo límite de 1.6 s: si Django no responde, muestra los mocks y los marca con `isSyntheticMock: true`.

## Convenciones

- **Formato:** JSON (`Content-Type: application/json`). En el navegador, sin el encabezado `Accept: application/json`, DRF muestra su página HTML navegable.
- **Fechas:** ISO 8601 en UTC (`2026-06-18T11:40:10Z`).
- **Geometrías:** GeoJSON en EPSG:4326, en orden `[lon, lat]`, que es el que usa MapLibre.
- **`scene_id`:** el `granuleId` completo del producto NISAR.
- **Errores:** `400` (parámetro inválido, con el motivo en el JSON), `404` (no existe), `405` (método no permitido).
- **Trazabilidad:** toda gráfica devuelve `code_version`, `source_file` y `warnings`. La interfaz debe mostrarlos (AGENTS.md §2.3).

---

## `GET /api/rois`

Regiones de interés.

```json
[
  {
    "id": "1",
    "name": "chiapas",
    "wkt": "POLYGON ((-93.3919 16.6539, -92.8757 16.6539, …))",
    "srid": 4326,
    "geometry": { "type": "Polygon", "coordinates": [[[-93.3919, 16.6539], …]] }
  }
]
```

Diferencias con el tipo `C4Roi` del frontend:
- **Se agrega:** `geometry`, el mismo polígono en GeoJSON, listo para MapLibre.
- **No vienen:** `region` y `targetUtmEpsg`, porque no se guardan. El EPSG está en cada escena (`epsg`).

## `GET /api/scenes`

Escenas cargadas en la base.

| Parámetro | Ejemplo | Filtra por |
|---|---|---|
| `roi` | `1` | Escenas cuya huella intersecta la ROI (id de `/api/rois`) |
| `track` | `62` | Trayectoria |
| `frame` | `10` | Marco |
| `direction` | `ASCENDING` | Dirección de vuelo (no distingue mayúsculas) |
| `maturity` | `PROVISIONAL` | `BETA`, `PROVISIONAL` o `VALIDATED` |
| `crid` | `P05023` | Versión de procesamiento |

Ejemplo real (2026-11-15, `?roi=1&track=62`):

```json
[
  {
    "scene_id": "NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001",
    "product": "GCOV",
    "track": 62,
    "frame": 10,
    "stackId": "T62/F10",
    "direction": "ASCENDING",
    "polarizations": ["HH", "HV"],
    "frequency": "A",
    "band": "L",
    "epsg": 32615,
    "crid": "P05023",
    "maturity": "PROVISIONAL",
    "start_time": "2026-06-18T11:40:10Z",
    "date": "2026-06-18",
    "has_inspection": true
  }
]
```

- **`maturity`:** viene del catálogo de ASF. Es `null` si la escena solo se inspeccionó desde un `.h5` local. Nunca se deduce del CRID.
- **Campos de `C4SceneMeta` que la base no tiene:** `source`, `frame_coverage`, `orbit_type` y `repeat_cycle_days`. No se rellenan con valores supuestos. Si el frontend los necesita, se pide a P1/P4 guardarlos desde el catálogo.

## `GET /api/scenes/{scene_id}`

Igual que un elemento de la lista. Agrega:
- **`footprint`:** huella completa del producto (GeoJSON), que viene del `boundingPolygon` del `.h5`.
- **`inspections`:** las corridas de la Etapa 1 cargadas, de la más reciente a la más antigua.

```json
{
  "scene_id": "NISAR_L2_PR_GCOV_023_…_001",
  "…": "…",
  "footprint": { "type": "Polygon", "coordinates": [ … ] },
  "inspections": [
    {
      "code_version": "<commit>",
      "created_utc": "2026-11-15T07:46:16Z",
      "roi_id": "1",
      "pct_valid_in_roi": 99.574,
      "source_dir": "data/explore/NISAR_L2_PR_GCOV_023_…_001",
      "warnings": ["Una sola fecha: sirve para inspección, no para un mapa de cambio.", "…"],
      "charts": ["histograma_gamma0_dB", "incidencia_por_altura", "mascara_roi"]
    }
  ]
}
```

## `GET /api/scenes/{scene_id}/charts`

Todas las gráficas de la inspección **más reciente**. Con `?code_version=<commit>` se pide una corrida concreta.

```json
{
  "scene_id": "NISAR_L2_PR_GCOV_023_…_001",
  "inspection": { "code_version": "…", "created_utc": "…", "roi_id": "1", "pct_valid_in_roi": 99.574,
                  "source_dir": "…", "warnings": ["…"], "charts": ["…"] },
  "charts": [
    { "chart_id": "histograma_gamma0_dB", "format_version": "graficas-etapa1-1",
      "source_file": "data/explore/…/graficas.json", "data": { … } },
    { "chart_id": "incidencia_por_altura", "…": "…" },
    { "chart_id": "mascara_roi", "…": "…" }
  ]
}
```

`data` es la entrada de `graficas.json` **sin cambios**. Su formato (ejes, unidades, series, cómo leer el histograma) está en [p1-graficas-chartjs.md](p1-graficas-chartjs.md) §2. Tamaño real: histograma ~8 KB, incidencia ~1 KB, máscara ~1 KB.

| `chart_id` | Tipo sugerido | Qué es |
|---|---|---|
| `histograma_gamma0_dB` | barras | Conteo de píxeles por bin de 0.1 dB de γ⁰, por polarización, con estadísticas |
| `mascara_roi` | barras | % de la ventana de la ROI en cada categoría de la máscara |
| `incidencia_por_altura` | línea | Ángulo de incidencia medio en la ROI por altura sobre el elipsoide |

Respuesta `404`: la escena no existe, no tiene inspecciones cargadas o no tiene esa `code_version`.

## `GET /api/scenes/{scene_id}/charts/{chart_id}`

Una sola gráfica, con su trazabilidad en el mismo objeto:

```json
{
  "scene_id": "…",
  "code_version": "…",
  "created_utc": "…",
  "warnings": ["…"],
  "chart_id": "histograma_gamma0_dB",
  "format_version": "graficas-etapa1-1",
  "source_file": "data/explore/…/graficas.json",
  "data": { "id": "histograma_gamma0_dB", "eje_x": { … }, "series": [ … ] }
}
```

Ejemplo mínimo con Chart.js:

```ts
const r = await fetch(`/api/scenes/${sceneId}/charts/histograma_gamma0_dB`, { headers: { Accept: 'application/json' } })
const { data: h, code_version, warnings } = await r.json()
const s = h.series[0]
const labels = s.conteos.map((_: number, k: number) => +(s.bin_inicio_dB + (k + 0.5) * h.eje_x.ancho_bin).toFixed(2))
const pct = s.conteos.map((n: number) => (100 * n) / s.total_en_rango)
// new Chart(canvas, { type: 'bar', data: { labels, datasets: [{ label: `${s.nombre} (dB)`, data: pct }] } })
// Mostrar también code_version, la fecha de la escena y las warnings.
```

---

## Pruebas

```
cd backend
python manage.py test scenes      # 16 pruebas (carga y API) con datos sintéticos, sobre PostGIS
```

Verificación con datos reales (2026-11-15): se cargó la inspección real de 2026-06-18 y se consultaron todos los endpoints con `runserver`. `/api/scenes?roi=1&track=62` devolvió la escena con los valores de arriba. `/charts` devolvió las 3 gráficas, y `/charts/histograma_gamma0_dB` devolvió `200 application/json` (7.7 KB).
