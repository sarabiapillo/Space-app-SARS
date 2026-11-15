# Gráficas de la Etapa 1 en la web (Chart.js) y en la base de datos — propuesta de P1

Estado: **la parte de P1 está hecha; lo demás es una propuesta** para que la acepten o cambien P4, P5 y P6 (contrato nuevo, ver `docs/plan-de-trabajo.md` §3). Fecha: 2026-11-15.

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

## 3. Propuesta para P4 (base de datos y API)

Modelo en `backend/scenes/` (o en una app nueva), una fila por gráfica:

```python
class SceneChart(models.Model):
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name="charts")
    chart_id = models.CharField(max_length=64)          # "histograma_gamma0_dB", …
    format_version = models.CharField(max_length=32)    # "graficas-etapa1-1"
    data = models.JSONField()                           # la entrada completa de "graficas"
    code_version = models.CharField(max_length=64)
    source_file = models.CharField(max_length=512)      # ruta de graficas.json (trazabilidad)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("scene", "chart_id", "code_version")
```

- `JSONField` usa `jsonb` en PostgreSQL. Un histograma pesa unos pocos KB por polarización, así que no hace falta una tabla por bin.
- **Carga:** `python manage.py load_explore <granuleId>` lee `graficas.json` y crea o actualiza `Scene` y `SceneChart`. Es el mismo patrón que `load_run`. Django no llama a `etapa1`.
- **Re-ejecución:** con `unique_together` sobre `code_version`, una corrida con código nuevo agrega filas y conserva las anteriores. P4 decide si prefiere sobrescribir.
- **Endpoint:** `GET /api/scenes/{id}/charts` y `GET /api/scenes/{id}/charts/{chart_id}` devuelven `data` tal cual, más `code_version` y `source_file`. Se documenta en `docs/api.md` (C4).

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

## 5. Pendiente de decidir

| Decisión | Quién |
|---|---|
| Aprobar Chart.js como la librería única de gráficas | P5 (elige) y P6 (aprueba) |
| Aceptar o cambiar el formato de `graficas.json` y el modelo `SceneChart` | P4, P5 |
| ¿Se conservan las filas de corridas anteriores o se sobrescriben? | P4 |
