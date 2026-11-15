# Gráficas de la Etapa 1 en la web (Chart.js) y en la base de datos — propuesta de P1

Estado: **hechos la exportación (P1) y el guardado en la base (§3, revisión pendiente de P4)**; API de gráficas implementada ([api.md](api.md)); Chart.js en el frontend es propuesta para P5 y P6 (contrato nuevo, ver `docs/plan-de-trabajo.md` §3). Fecha: 2026-11-15.

## 1. Qué cambió en P1

- `figuras/*.png` se siguen generando con **matplotlib**, igual que antes.
- Además, `python -m pipeline.etapa1 …` escribe **`data/explore/<granuleId>/graficas.json`** con los números de las gráficas que son series (`pipeline/graficas_datos.py`). La ruta queda en `metadatos.json → graficas` y en `web/capas.json → graficas`.
- Para las escenas que ya estaban en `data/explore/` hay que **volver a correr `etapa1`**: el histograma no se guardaba antes, solo se dibujaba.

Los datos **no** salen de `control/`. Esos CSV (15 píxeles al azar y un bloque de 2×2) son para revisar los cálculos a mano y no sirven para graficar.

| Gráfica (`id`) | Figura PNG equivalente | Tipo sugerido | De dónde salen los números |
|---|---|---|---|
| `histograma_gamma0_dB` | `C_histogramas_gamma0_dB.png` | barras | Conteo por bin de 0.1 dB de γ⁰ en la ROI, por polarización, a resolución completa |
| `mascara_roi` | `D_mascara.png` (sus porcentajes) | barras | `roi.pct_mascara_en_ventana` |
| `incidencia_por_altura` | `E_incidencia.png` (metadatos) | línea | `incidencia.media_en_roi_por_altura` |

Las figuras A, B, D y E son **mapas** (rásteres). En la web van como capas de MapLibre (`web/*.png`, `web/*.tif`), no en Chart.js.

## 2. Formato de `graficas.json` (`version: graficas-etapa1-1`)

```jsonc
{
  "version": "graficas-etapa1-1",
  "tipo": "graficas_inspeccion_una_fecha",
  "creado_utc": "…", "version_codigo": "<commit>",
  "escena": { "granuleId": "…", "producto": "GCOV", "fecha_inicio": "…", "trayectoria": 62, "marco": 10,
              "direccion": "ASCENDING", "crid": "P05023", "madurez_catalogo": "PROVISIONAL",
              "frecuencia": "A", "polarizaciones": ["HH", "HV"] },
  "fuentes": { "metadatos": "data/explore/<granuleId>/metadatos.json" },
  "graficas": [
    { "id": "histograma_gamma0_dB", "tipo_sugerido": "bar", "titulo": "…",
      "eje_x": { "etiqueta": "γ⁰", "unidad": "dB", "ancho_bin": 0.1, "rango_bins": [-60, 30] },
      "eje_y": { "etiqueta": "píxeles", "unidad": "conteo" },
      "series": [ { "nombre": "HHHH", "bin_inicio_dB": …, "conteos": [ … ],
                    "total_en_rango": …, "fuera_de_rango": …,
                    "estadisticas": { "n_validos": …, "media_dB": …, "mediana_dB": …, "dB_de_la_media": …,
                                      "desv_std_dB": …, "p5_dB": …, "p95_dB": … } } ] },
    { "id": "mascara_roi", "tipo_sugerido": "bar", "categorias": ["valido", …], "etiquetas": ["válido (subfranja)", …],
      "series": [ { "nombre": "porcentaje", "valores": [ … ] } ], "pct_validos_en_poligono": … },
    { "id": "incidencia_por_altura", "tipo_sugerido": "line", "x": [-1000, -500, …, 9000],
      "eje_y": { "unidad": "degrees" }, "series": [ { "nombre": "media en la ROI", "valores": [ … ] } ],
      "altura_figura_m": 500 }
  ],
  "advertencias": [ "Una sola fecha: describe la escena, no un cambio.", "…" ]
}
```

Reglas del formato:

- Los conteos del histograma son **enteros exactos**, sin suavizar. El bin *k* va de `bin_inicio_dB + k·ancho_bin` a `bin_inicio_dB + (k+1)·ancho_bin`.
- Se quitan los bins vacíos de los extremos, sin perder ningún conteo: `sum(conteos) == total_en_rango`. Los píxeles fuera de −60…30 dB se cuentan en `fuera_de_rango`.
- No lleva colores ni opciones de Chart.js. El formato es independiente de la librería. La presentación la decide el frontend.

## 3. Guardado en la base de datos (P4) — implementado el 2026-11-15

> Se implementó a pedido del equipo, aunque `backend/**` es de P4. P4 debe revisarlo antes del merge.

**Modelos** (`backend/scenes/models.py`, migración `scenes/0001_initial`):

| Modelo | Qué guarda | Clave |
|---|---|---|
| `ROI` | Nombre y polígono (EPSG:4326) | Se reutiliza si la geometría es igual |
| `Scene` | granuleId, producto, trayectoria, marco, dirección, polarizaciones, frecuencia, CRID, madurez (del catálogo), fecha de inicio y huella (`boundingPolygon` del `.h5`, en 2D) | `name` (granuleId) único |
| `SceneInspection` | Una corrida de `etapa1`: versión del código, fecha, % válido en la ROI, `estadisticas_roi`, procedencia, advertencias y carpeta de origen | Única por (escena, versión del código) |
| `SceneChart` | Una entrada de `graficas.json` **tal cual** en `data` (`jsonb`), con `chart_id`, versión del formato y archivo de origen | Única por (inspección, `chart_id`) |

**Carga** (desde `backend/`, con PostGIS levantado):

```
python manage.py migrate
python manage.py load_explore <granuleId> [<granuleId> ...]
python manage.py load_explore --todas            # todas las carpetas de data/explore/
```

- Lee `metadatos.json` y `graficas.json`. No abre los `.h5` ni llama al pipeline.
- **Misma versión del código:** reemplaza la inspección y sus gráficas. **Otra versión:** agrega una inspección nueva y conserva las anteriores.
- Se detiene sin guardar nada (transacción) en estos casos:
  - falta `graficas.json` (carpetas anteriores al 2026-11-15);
  - las gráficas son de otra escena;
  - `graficas.json` y `metadatos.json` son de corridas distintas (otra versión del código);
  - el formato no es conocido.
- Una carga local (sin catálogo) no borra una madurez ya conocida, y la madurez nunca se deduce del CRID.
- Las tablas se pueden ver en el panel `/admin/`.

**Verificación:**
- **Pruebas:** `python manage.py test scenes` corre 9 pruebas con salidas sintéticas sobre PostGIS.
- **Datos reales:** se cargó la salida real de `etapa1` de 2026-06-18. Escena T62/F10 ASCENDING, HH+HV, P05023 PROVISIONAL, 99.574 % válido. Las 3 gráficas pesan 8.3 KB, 0.8 KB y 1.1 KB, y el histograma HH suma los 14 694 370 píxeles válidos.

**API (P4):** `GET /api/scenes/{scene_id}/charts` y `GET /api/scenes/{scene_id}/charts/{chart_id}` ya están implementados; ver [api.md](api.md). `ChangeResult` y `load_run` esperan a que P2 produzca C2. Crear la base en Docker: [bd-docker.md](bd-docker.md).

## 4. Propuesta para P5 / P6 (Chart.js)

- El plan dice que en el frontend hay **una sola librería de gráficas, que elige P5 y aprueba P6**. Chart.js necesita esa aprobación y que P5 la agregue a `web/package.json` (`chart.js`; opcional `react-chartjs-2`).
- Las gráficas de la Etapa 1 encajan en el **Explorador** (P5, detalle de la escena). El histograma de Δσ⁰ del **Laboratorio** (P6) vendrá de C2 (`run.json`), no de aquí.

Conversión mínima del histograma a Chart.js (para que P5 la adapte):

```ts
const h = charts.find(c => c.id === "histograma_gamma0_dB")!;
const s = h.series[0];                                         // una polarización
const labels = s.conteos.map((_, k) => +(s.bin_inicio_dB + (k + 0.5) * h.eje_x.ancho_bin).toFixed(2));
const pct = s.conteos.map(n => (100 * n) / s.total_en_rango);  // igual que la figura PNG
new Chart(canvas, {
  type: "bar",
  data: { labels, datasets: [{ label: `${s.nombre} (${h.eje_x.unidad})`, data: pct,
                               barPercentage: 1, categoryPercentage: 1 }] },
  options: { scales: { x: { title: { display: true, text: `${h.eje_x.etiqueta} [dB]` } },
                       y: { title: { display: true, text: "% de píxeles (bin 0.1 dB)" } } } },
});
```

Según la regla de interfaz del plan (§6), toda gráfica muestra unidad, fecha (`escena.fecha_inicio`) y fuente (`escena.granuleId`, `version_codigo`). Además lleva el aviso de "una sola fecha".

### 4.1 Implementación aplicada en el panel (2026-11-15): ventana de dibujo

La conversión de arriba (una categoría por bin) **no representaba la distribución**: el eje abarcaba de −38 a +30 dB porque solo se quitan los bins con 0 píxeles, y el 90 % de la masa (p5–p95) queda en ~11 dB, el **16 % del ancho**. En el sidebar (360 px) son ~0.48 px por bin, así que Chart.js además redondeaba y perdía bins.

Reglas que usa ahora `web/src/components/Etapa1ChartsPanel.tsx` (los números siguen saliendo de `graficas.json`, sin recalcular nada):

- **Ventana**: p0.2–p99.8 de la CDF, la misma regla que `pipeline/etapa1_figuras.histograms` (`ax.set_xlim(cdf 0.002, cdf 0.998)`), calculada con **todas** las series para que el eje no se mueva al cambiar de polarización. En el par T62 queda en [−24.0, 7.5] dB (31.5 dB en lugar de 68.4) y el pie declara el % de píxeles que queda fuera (0.46 %).
- **Eje X lineal** con un punto por bin en su centro (`{x, y}`), dibujado como escalón (`stepped: 'middle'`), igual que `ax.step(..., where='mid')` de la figura C. Así el ancho del canvas no altera los valores y no hay reindexado a categorías.
- **Referencias** con un plugin propio (sin dependencias nuevas): franja p5–p95 y líneas de media (sólida) y mediana (discontinua), como anota la figura C.
- **Máscara**: eje 0–100 % con el valor numérico escrito sobre cada barra. Con 99.39 % válido, las categorías de 0.39 %, 0.22 % y 0.00 % son invisibles en la barra pero legibles en la etiqueta.
- **Incidencia**: eje Y fijado al span real (0.4002° en 10 000 m). Con el eje desde 0 la curva parece plana.

Verificación del cambio: `tsc -b` y `vite build` sin errores; el panel carga t1 y t2 sin errores de consola y declara las ventanas [−24.00, 7.20] dB (t1) y [−24.00, 7.50] dB (t2).

**Revisión del mismo día, contra las figuras C, D y E:**

- **Histograma**: ahora hay un panel por polarización con su propia ventana p0.2–p99.8, igual que la figura C (t2: HH [−18.7, 7.5] dB y HV [−24.0, −1.7] dB). La curva es negra, en escalón y sin relleno. Las referencias son rojas: media de los dB (sólida), mediana (discontinua) y **dB de la media lineal** (punteada, `dB_de_la_media`). La franja p5–p95 es azul claro. El título incluye `n` y la leyenda los valores. En el sidebar la leyenda va fuera del área de trazado para no tapar el pico. Los ticks son múltiplos de 5 dB.
- **Máscara e incidencia**: siguen como barras/dona y línea. **No se pueden replicar las figuras D y E con `graficas.json`**, porque no contiene sus datos:
  - `mascara_roi` solo guarda **4 porcentajes**. El mapa D necesita la malla de categorías (2687 × 5504 px). Esa malla está en `geotiff/mascara.tif`, pero no en el JSON.
  - `incidencia_por_altura` solo guarda **21 medias** (una por capa de altura). El mapa E usa la malla 2-D `angulo` de la capa de 500 m, que `nisar_h5.read_incidence` lee del `.h5` pero **solo se dibuja en el PNG; no se guarda en ningún archivo**.
  - Para replicarlas hace falta que P1 exporte esas mallas (ver §6 pendiente). Mostrar el PNG en la web no sirve: no se puede inspeccionar ni rastrear valor por valor.

## 5. Pendiente de decidir

| Decisión | Quién |
|---|---|
| Aprobar Chart.js como la librería única de gráficas | P5 (elige) y P6 (aprueba) |
| Aceptar o cambiar el formato de `graficas.json` y los modelos de §3 | P4, P5 |
| ¿Conservar las inspecciones de versiones anteriores del código (hoy sí) o sobrescribirlas? | P4 |
