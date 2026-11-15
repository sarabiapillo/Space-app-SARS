import { useEffect, useMemo, useState } from 'react'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { AlertTriangle, BarChart3, CheckCircle2, FileJson, Info } from 'lucide-react'
import { fetchExploreCharts, type ExploreChartsFetchResult } from '../api/client'
import { ScientificFiguresViewer } from './ScientificFiguresViewer'
import type { RoiChartsEntry } from '../hooks/useRoiLayers'
import {
  RAW_SCENE_IDS,
  type ExploreHistogramChart,
  type ExploreIncidenceChart,
  type ExploreMaskChart,
} from '../mocks/initialWorkspaces'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

interface Etapa1ChartsPanelProps {
  compact?: boolean
  /**
   * Gráficas de la ROI dibujada en el mapa (una entrada por fecha). Si viene con datos, el panel
   * las usa en lugar del par fijo T62/F10 de data/explore/.
   */
  roiCharts?: RoiChartsEntry[]
  /** Texto corto que identifica la ROI (p. ej. su caja en grados). */
  roiLabel?: string
}

type DateChoice = 't1' | 't2'
type PolFilter = 'both' | 'HHHH' | 'HVHV'
type MaskChartMode = 'bar' | 'doughnut'

function formatInt(n: number): string {
  return n.toLocaleString('es-MX')
}

/** Mismo formato que la figura C (`f"{n:,}"`): 14,699,508. */
function formatIntEn(n: number): string {
  return n.toLocaleString('en-US')
}

/** Colores de la figura D (`etapa1_figuras.mask`: tab:red, tab:green, blue, lightgray). */
function maskColor(etiqueta: string): string {
  const e = etiqueta.toLowerCase()
  if (e.startsWith('no válido')) return '#D62728'
  if (e.startsWith('válido')) return '#2CA02C'
  if (e.includes('adquisición')) return '#0000FF'
  if (e.includes('polígono')) return '#D3D3D3'
  return '#94A3B8'
}

/**
 * Ventana de dibujo del histograma: p0.2–p99.8 de la CDF, la MISMA regla que usa la figura C
 * (`pipeline/etapa1_figuras.histograms`: `ax.set_xlim(cdf 0.002, cdf 0.998)`), una por panel.
 *
 * Sin esto el eje abarca todos los bins con ≥1 píxel (−38 a +30 dB en el par T62) y el 90 % de la
 * masa queda comprimido en ~16 % del ancho: la distribución se ve como una aguja.
 */
function plotWindow(series: ExploreHistogramChart['series'], anchoBin: number): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY

  for (const serie of series) {
    const total = serie.conteos.reduce((acc, c) => acc + c, 0)
    if (total <= 0) continue
    let acc = 0
    const cdf = serie.conteos.map((c) => (acc += c) / total)
    const iLo = Math.max(0, cdf.findIndex((v) => v >= 0.002))
    const iHi = Math.max(iLo, cdf.findIndex((v) => v >= 0.998))
    lo = Math.min(lo, serie.bin_inicio_dB + (iLo + 0.5) * anchoBin)
    hi = Math.max(hi, serie.bin_inicio_dB + (iHi + 0.5) * anchoBin)
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    const inicio = series[0]?.bin_inicio_dB ?? -20
    return [Number((inicio - anchoBin / 2).toFixed(2)), Number((inicio + 20).toFixed(2))]
  }
  // medio bin de margen para que el primer y el último escalón entren completos
  return [
    Number((lo - anchoBin / 2).toFixed(2)),
    Number((hi + anchoBin / 2).toFixed(2)),
  ]
}

// Colores y trazos de la figura C (matplotlib): curva negra, referencias rojas, franja azul claro.
const HIST_STYLE = {
  curve: '#000000',
  ref: '#D62728',
  band: 'rgba(31, 119, 180, 0.09)',
  dash: {
    media: [] as number[],
    mediana: [5, 3],
    mediaLineal: [1.5, 2.5],
  },
}

interface HistRef {
  p5: number
  p95: number
  media: number
  mediana: number
  mediaLineal: number
}

/**
 * Franja p5–p95 y líneas de media de los dB (sólida), mediana (discontinua) y dB de la media
 * lineal (punteada), igual que anota la figura C. Se dibuja sobre el área del gráfico, sin añadir
 * datasets que ensucien el tooltip.
 */
function referencePlugin(ref: HistRef): Plugin<'line'> {
  const paint = (chart: ChartJS<'line'>, lines: boolean) => {
    const { ctx, chartArea, scales } = chart
    const x = scales.x
    if (!x) return
    if (!lines) {
      const p0 = x.getPixelForValue(ref.p5)
      const p1 = x.getPixelForValue(ref.p95)
      const left = Math.max(chartArea.left, Math.min(p0, p1))
      const right = Math.min(chartArea.right, Math.max(p0, p1))
      if (right <= left) return
      ctx.save()
      ctx.fillStyle = HIST_STYLE.band
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top)
      ctx.restore()
      return
    }
    for (const [valor, dash] of [
      [ref.media, HIST_STYLE.dash.media],
      [ref.mediana, HIST_STYLE.dash.mediana],
      [ref.mediaLineal, HIST_STYLE.dash.mediaLineal],
    ] as Array<[number, number[]]>) {
      const px = x.getPixelForValue(valor)
      if (!Number.isFinite(px) || px < chartArea.left || px > chartArea.right) continue
      ctx.save()
      ctx.strokeStyle = HIST_STYLE.ref
      ctx.lineWidth = 1.2
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(px, chartArea.top)
      ctx.lineTo(px, chartArea.bottom)
      ctx.stroke()
      ctx.restore()
    }
  }

  return {
    id: 'referencias-estadisticas',
    beforeDatasetsDraw: (chart) => paint(chart, false),
    afterDatasetsDraw: (chart) => paint(chart, true),
  }
}

/**
 * Etiquetas con el valor encima de cada barra. La máscara va de 0 a 100 % porque "válido" es
 * 99.39 %: sin el número, las categorías de 0.39 %, 0.22 % y 0.00 % son invisibles.
 */
const maskValueLabels: Plugin<'bar'> = {
  id: 'valores-sobre-barras',
  afterDatasetsDraw(chart) {
    const { ctx } = chart
    const values = chart.data.datasets[0]?.data as Array<number | null> | undefined
    const meta = chart.getDatasetMeta(0)
    if (!values || !meta) return
    ctx.save()
    ctx.fillStyle = '#0f172a'
    ctx.font = '10px "Segoe UI", Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    meta.data.forEach((element, i) => {
      const value = values[i]
      if (typeof value !== 'number') return
      const y = Math.max(chart.chartArea.top + 11, element.y - 3)
      ctx.fillText(`${value.toFixed(3)} %`, element.x, y)
    })
    ctx.restore()
  },
}

export function Etapa1ChartsPanel({ compact = false, roiCharts, roiLabel }: Etapa1ChartsPanelProps) {
  const [dateChoice, setDateChoice] = useState<DateChoice>('t2')
  const [chosenViewMode, setViewMode] = useState<'matplotlib' | 'chartjs'>('matplotlib')
  const [roiIndexChoice, setRoiIndex] = useState<number | null>(null)
  const roiMode = Boolean(roiCharts && roiCharts.length > 0)
  // Las capas de la ROI se generan sin figuras PNG (--sin-figuras): solo hay vista Chart.js.
  const viewMode = roiMode ? 'chartjs' : chosenViewMode
  const roiIndex = roiMode
    ? Math.min(roiIndexChoice ?? roiCharts!.length - 1, roiCharts!.length - 1)
    : 0
  const roiEntry = roiMode ? roiCharts![roiIndex] : null
  const [polFilter, setPolFilter] = useState<PolFilter>('both')
  const [maskMode, setMaskMode] = useState<MaskChartMode>('bar')
  const [loaded, setLoaded] = useState<{
    granuleId: string
    result: ExploreChartsFetchResult
  } | null>(null)

  // Usar siempre los granuleId reales del par principal T62/F10 (que cuentan con graficas.json en disco)
  const targetGranuleId =
    dateChoice === 't1' ? RAW_SCENE_IDS.T62_T1_20260618 : RAW_SCENE_IDS.T62_T2_20261016
  const targetDateLabel = dateChoice === 't1' ? '2026-06-18' : '2026-10-16'

  useEffect(() => {
    if (roiMode) return
    let cancelled = false
    fetchExploreCharts(targetGranuleId).then((res) => {
      if (cancelled) return
      setLoaded({ granuleId: targetGranuleId, result: res })
    })
    return () => {
      cancelled = true
    }
  }, [targetGranuleId, roiMode])

  const loading = roiMode ? false : loaded?.granuleId !== targetGranuleId
  const manifest = roiEntry
    ? roiEntry.manifest
    : !loading ? (loaded?.result.manifest ?? null) : null
  const sourceUrl = roiEntry
    ? `ROI · ${roiEntry.granuleId}/graficas.json`
    : !loading ? (loaded?.result.sourceUrl ?? '') : ''
  const error = roiMode ? null : !loading ? (loaded?.result.error ?? null) : null

  const histogramChart = useMemo(
    () =>
      manifest?.graficas.find((g): g is ExploreHistogramChart => g.id === 'histograma_gamma0_dB') ??
      null,
    [manifest],
  )

  const maskChart = useMemo(
    () =>
      manifest?.graficas.find((g): g is ExploreMaskChart => g.id === 'mascara_roi') ?? null,
    [manifest],
  )

  const incidenceChart = useMemo(
    () =>
      manifest?.graficas.find((g): g is ExploreIncidenceChart => g.id === 'incidencia_por_altura') ??
      null,
    [manifest],
  )

  // Histograma: un panel por polarización, como la figura C. Cada panel con su ventana
  // p0.2–p99.8 y % = 100 · conteo / total_en_rango.
  const histogramPanels = useMemo(() => {
    if (!histogramChart || histogramChart.series.length === 0) return []
    const anchoBin = histogramChart.eje_x.ancho_bin || 0.1
    const etiqueta = histogramChart.eje_x.etiqueta || 'γ⁰'
    const unidad = histogramChart.eje_x.unidad || 'dB'
    const activeSeries =
      polFilter === 'both'
        ? histogramChart.series
        : histogramChart.series.filter((s) => s.nombre === polFilter)

    return activeSeries.map((serie) => {
      const [xMin, xMax] = plotWindow([serie], anchoBin)
      const denom = serie.total_en_rango > 0 ? serie.total_en_rango : 1
      const st = serie.estadisticas

      const data = {
        datasets: [
          {
            label: `${serie.nombre} · % de píxeles`,
            // Un punto por bin en su centro exacto, dibujado en escalón (ax.step where='mid').
            data: serie.conteos.map((conteo, k) => ({
              x: Number((serie.bin_inicio_dB + (k + 0.5) * anchoBin).toFixed(3)),
              y: Number(((100 * conteo) / denom).toFixed(5)),
            })),
            stepped: 'middle' as const,
            fill: false,
            borderColor: HIST_STYLE.curve,
            borderWidth: 1,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0,
          },
        ],
      }

      const options: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) =>
                `${etiqueta} ${serie.nombre} ≈ ${Number(items[0]?.parsed.x ?? 0).toFixed(2)} ${unidad}`,
              label: (ctx) =>
                `${typeof ctx.parsed.y === 'number' ? ctx.parsed.y.toFixed(3) : '0'} % de píxeles`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: xMin,
            max: xMax,
            title: {
              display: true,
              text: `${etiqueta} ${serie.nombre} [${unidad}]`,
              font: { size: 11 },
            },
            ticks: { font: { size: 10 } },
            // Solo ticks redondos (cada 5 dB), sin los extremos de la ventana (−18.7, 7.5).
            afterBuildTicks: (scale) => {
              const first = Math.ceil(xMin / 5) * 5
              const ticks = []
              for (let v = first; v <= xMax; v += 5) ticks.push({ value: v })
              scale.ticks = ticks
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            grace: '5%',
            title: {
              display: true,
              text: `% de píxeles (bin ${anchoBin} dB)`,
              font: { size: 11 },
            },
            ticks: { font: { size: 10 } },
            grid: { display: false },
          },
        },
      }

      // % de píxeles de la serie que queda fuera de la ventana (colas): se declara, no se esconde.
      const fuera = serie.conteos.reduce((suma, conteo, k) => {
        const centro = serie.bin_inicio_dB + (k + 0.5) * anchoBin
        return centro < xMin || centro > xMax ? suma + conteo : suma
      }, 0)

      return {
        serie,
        data,
        options,
        plugins: [
          referencePlugin({
            p5: st.p5_dB,
            p95: st.p95_dB,
            media: st.media_dB,
            mediana: st.mediana_dB,
            mediaLineal: st.dB_de_la_media,
          }),
        ],
        xMin,
        xMax,
        recortado: (100 * fuera) / denom,
      }
    })
  }, [histogramChart, polFilter])

  const maskChartData = useMemo(() => {
    if (!maskChart || !maskChart.series[0]) return null
    const values = maskChart.series[0].valores
    return {
      labels: maskChart.etiquetas,
      datasets: [
        {
          label: `${maskChart.series[0].nombre} (${maskChart.eje_y.unidad})`,
          data: values,
          backgroundColor: maskChart.etiquetas.map(maskColor),
          borderColor: '#94A3B8',
          borderWidth: 1,
        },
      ],
    }
  }, [maskChart])

  const maskBarOptions: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${typeof ctx.parsed.y === 'number' ? ctx.parsed.y.toFixed(4) : '0'} % de la ventana`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Categoría de máscara', font: { size: 11, weight: 'bold' } },
          ticks: { font: { size: 10 } },
        },
        y: {
          min: 0,
          max: 100,
          title: {
            display: true,
            text: `${maskChart?.eje_y.etiqueta ?? '% de la ventana'} [${maskChart?.eje_y.unidad ?? '%'}]`,
            font: { size: 11, weight: 'bold' },
          },
          ticks: { callback: (v) => `${v}%`, font: { size: 10 } },
        },
      },
    }),
    [maskChart],
  )

  const maskDoughnutOptions: ChartOptions<'doughnut'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 11, font: { size: 10.5 } } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.label}: ${typeof ctx.parsed === 'number' ? ctx.parsed.toFixed(4) : '0'} %`,
          },
        },
      },
    }),
    [],
  )

  const incidenceData = useMemo(() => {
    if (!incidenceChart || !incidenceChart.series[0]) return null
    const values = incidenceChart.series[0].valores
    const highlightH = incidenceChart.altura_figura_m
    return {
      labels: incidenceChart.x.map((h) => `${h} m`),
      datasets: [
        {
          label: `${incidenceChart.series[0].nombre} (${incidenceChart.eje_y.unidad})`,
          data: values,
          borderColor: '#3399FF',
          backgroundColor: 'rgba(51, 153, 255, 0.14)',
          fill: true,
          tension: 0.2,
          pointRadius: incidenceChart.x.map((h) => (h === highlightH ? 6 : 3)),
          pointBackgroundColor: incidenceChart.x.map((h) =>
            h === highlightH ? '#EA580C' : '#1D4ED8',
          ),
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 1.5,
        },
      ],
    }
  }, [incidenceChart])

  // El span real es ~0.40° en 10 000 m: con el eje arrancando en 0 la curva parece plana y engaña.
  const incidenceRange = useMemo(() => {
    const valores = incidenceChart?.series[0]?.valores ?? []
    if (valores.length === 0) return null
    const min = Math.min(...valores)
    const max = Math.max(...valores)
    const pad = Math.max((max - min) * 0.15, 0.05)
    return { min: Number((min - pad).toFixed(3)), max: Number((max + pad).toFixed(3)), span: max - min }
  }, [incidenceChart])

  const incidenceOptions: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `Incidencia media: ${typeof ctx.parsed.y === 'number' ? ctx.parsed.y.toFixed(4) : '0'} ${incidenceChart?.eje_y.unidad ?? 'degrees'}`,
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: `${incidenceChart?.eje_x.etiqueta ?? 'Altura WGS84'} [${incidenceChart?.eje_x.unidad ?? 'm'}]`,
            font: { size: 11, weight: 'bold' },
          },
          ticks: { font: { size: 10 }, maxTicksLimit: 11 },
        },
        y: {
          min: incidenceRange?.min,
          max: incidenceRange?.max,
          title: {
            display: true,
            text: `${incidenceChart?.eje_y.etiqueta ?? 'Ángulo de incidencia'} [${incidenceChart?.eje_y.unidad ?? 'degrees'}]`,
            font: { size: 11, weight: 'bold' },
          },
          ticks: {
            font: { size: 10 },
            callback: (v) => `${Number(v).toFixed(2)}°`,
          },
        },
      },
    }),
    [incidenceChart, incidenceRange],
  )

  const highlightIdx = incidenceChart
    ? incidenceChart.x.findIndex((h) => h === incidenceChart.altura_figura_m)
    : -1
  const highlightAngle =
    highlightIdx >= 0 && incidenceChart?.series[0]
      ? incidenceChart.series[0].valores[highlightIdx]
      : null

  return (
    <div className={`ws-charts-panel ${compact ? 'ws-charts-panel--compact' : ''}`}>
      {/* Barra superior de selección de fecha y trazabilidad */}
      <div className="ws-charts-panel__topbar">
        <div className="ws-charts-panel__title">
          <BarChart3 size={14} className="ws-charts-panel__icon" />
          <div>
            <strong>
              {roiMode ? 'Gráficas NISAR de la ROI (Chart.js)' : 'Gráficas Etapa 1 · T62/F10 (Chart.js)'}
            </strong>
            <div className="ws-charts-panel__sub">
              {roiMode ? (
                <>
                  Ángulo de incidencia · retrodispersión γ⁰ · máscara QA de subfranja
                  {roiLabel ? <> · ROI {roiLabel}</> : null}
                </>
              ) : (
                <>
                  <code>graficas.json</code> · sin CSV de <code>control/</code>
                </>
              )}
            </div>
          </div>
        </div>

        {roiMode ? (
          <div className="ws-charts-panel__controls">
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {roiCharts!.map((entry, i) => (
                <button
                  key={entry.granuleId}
                  type="button"
                  className={`ws-tool-btn ws-tool-btn--mono ${i === roiIndex ? 'is-active' : ''}`}
                  onClick={() => setRoiIndex(i)}
                  title={entry.granuleId}
                >
                  t{i + 1} ({entry.fecha})
                </button>
              ))}
            </div>
          </div>
        ) : (
        <div className="ws-charts-panel__controls">
          <div style={{ display: 'flex', gap: '3px' }}>
            <button
              type="button"
              className={`ws-tool-btn ${viewMode === 'matplotlib' ? 'is-active' : ''}`}
              onClick={() => setViewMode('matplotlib')}
              title="Figuras científicas oficiales de Python Matplotlib (Figuras B, C, D, E)"
            >
              📊 Figuras Python
            </button>
            <button
              type="button"
              className={`ws-tool-btn ${viewMode === 'chartjs' ? 'is-active' : ''}`}
              onClick={() => setViewMode('chartjs')}
              title="Gráficas interactivas vectoriales Chart.js"
            >
              📈 Chart.js
            </button>
          </div>

          <div style={{ display: 'flex', gap: '3px' }}>
            <button
              type="button"
              className={`ws-tool-btn ws-tool-btn--mono ${dateChoice === 't1' ? 'is-active' : ''}`}
              onClick={() => setDateChoice('t1')}
              title={`Cargar t1 (2026-06-18): ${RAW_SCENE_IDS.T62_T1_20260618}`}
            >
              t1 (2026-06-18)
            </button>
            <button
              type="button"
              className={`ws-tool-btn ws-tool-btn--mono ${dateChoice === 't2' ? 'is-active' : ''}`}
              onClick={() => setDateChoice('t2')}
              title={`Cargar t2 (2026-10-16): ${RAW_SCENE_IDS.T62_T2_20261016}`}
            >
              t2 (2026-10-16)
            </button>
          </div>
        </div>
        )}
      </div>

      {viewMode === 'matplotlib' ? (
        <ScientificFiguresViewer
          sceneId={targetGranuleId}
          dateLabel={targetDateLabel}
        />
      ) : (
        <>
          {loading && (
            <div className="ws-charts-panel__empty">
              Cargando <code>{sourceUrl || `/data/explore/${targetGranuleId}/graficas.json`}</code> para{' '}
              {targetDateLabel}…
            </div>
          )}

      {!loading && error && (
        <div className="ws-charts-panel__error" role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>No hay datos de gráficas disponibles para esta escena</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {!loading && manifest && (
        <div className="ws-charts-panel__body">
          {/* Regla obligatoria (§6 plan-de-trabajo): fecha, trazabilidad y advertencias */}
          <div className="ws-charts-trace-card">
            <div className="ws-charts-trace-card__grid">
              <div>
                <span>granuleId</span>
                <code>{manifest.escena.granuleId}</code>
              </div>
              <div>
                <span>fecha_inicio</span>
                <code>{manifest.escena.fecha_inicio}</code>
              </div>
              <div>
                <span>version_codigo</span>
                <code>{manifest.version_codigo}</code>
              </div>
              <div>
                <span>Escena / Pila</span>
                <code>
                  {manifest.escena.producto} · T{manifest.escena.trayectoria}/F{manifest.escena.marco} (
                  {manifest.escena.direccion}) · {manifest.escena.crid} · {manifest.escena.madurez_catalogo}
                </code>
              </div>
              <div>
                <span>Fuente metadatos</span>
                <code>
                  <FileJson size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {manifest.fuentes.metadatos}
                </code>
              </div>
            </div>

            {manifest.advertencias.length > 0 && (
              <div className="ws-charts-warnings" role="note">
                <AlertTriangle size={14} className="ws-charts-warnings__icon" />
                <ul>
                  {manifest.advertencias.map((adv) => (
                    <li key={adv}>{adv}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Gráfica 1: Histograma γ⁰ [dB] */}
          {histogramChart && histogramPanels.length > 0 && (
            <section className="ws-chart-card">
              <div className="ws-chart-card__header">
                <div>
                  <h3>1. {histogramChart.titulo}</h3>
                  <p className="ws-chart-card__meta">
                    Fecha: <code>{manifest.escena.fecha_inicio}</code> · Unidad:{' '}
                    <code>{histogramChart.eje_x.unidad}</code> / <code>% de píxeles</code> · Fuente:{' '}
                    <code>{manifest.escena.granuleId}</code> (<code>{manifest.version_codigo}</code>)
                  </p>
                </div>
                <div className="ws-chart-card__actions">
                  <button
                    type="button"
                    className={`ws-tool-btn ${polFilter === 'both' ? 'is-active' : ''}`}
                    onClick={() => setPolFilter('both')}
                  >
                    Ambas (HH + HV)
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ws-tool-btn--mono ${polFilter === 'HHHH' ? 'is-active' : ''}`}
                    onClick={() => setPolFilter('HHHH')}
                  >
                    HHHH
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ws-tool-btn--mono ${polFilter === 'HVHV' ? 'is-active' : ''}`}
                    onClick={() => setPolFilter('HVHV')}
                  >
                    HVHV
                  </button>
                </div>
              </div>

              <div className="ws-hist-panels">
                {histogramPanels.map((panel) => {
                  const st = panel.serie.estadisticas
                  return (
                    <figure key={panel.serie.nombre} className="ws-hist-panel">
                      <figcaption className="ws-hist-panel__title">
                        {panel.serie.nombre} · n = {formatIntEn(st.n_validos)} píxeles válidos en la ROI
                      </figcaption>
                      <div className="ws-hist-panel__plot">
                        <ul className="ws-hist-legend">
                          <li>
                            <i className="ws-hist-legend__line" /> media de los dB: {st.media_dB.toFixed(3)}
                          </li>
                          <li>
                            <i className="ws-hist-legend__line ws-hist-legend__line--dashed" /> mediana:{' '}
                            {st.mediana_dB.toFixed(3)}
                          </li>
                          <li>
                            <i className="ws-hist-legend__line ws-hist-legend__line--dotted" /> dB de la media
                            lineal: {st.dB_de_la_media.toFixed(3)}
                          </li>
                          <li>
                            <i className="ws-hist-legend__band" /> p5–p95: {st.p5_dB.toFixed(2)} a{' '}
                            {st.p95_dB.toFixed(2)}
                          </li>
                        </ul>
                        <div className="ws-chart-card__canvas-lg">
                          <Line data={panel.data} options={panel.options} plugins={panel.plugins} />
                        </div>
                      </div>
                      <p className="ws-chart-card__meta">
                        Ventana <code>{panel.xMin.toFixed(2)} a {panel.xMax.toFixed(2)} dB</code> (p0.2–p99.8,
                        igual que la figura C) · fuera de la ventana: <code>{panel.recortado.toFixed(3)} %</code>
                      </p>
                    </figure>
                  )
                })}
              </div>

              <div className="ws-chart-stats-grid">
                {histogramChart.series.map((s) => (
                  <div key={s.nombre} className="ws-stat-box">
                    <div className="ws-stat-box__title">
                      <strong>Canal {s.nombre}</strong>
                      <span>
                        en rango: {formatInt(s.total_en_rango)} px · fuera: {formatInt(s.fuera_de_rango)} px
                      </span>
                    </div>
                    <div className="ws-stat-box__items">
                      <div>
                        <span>n_validos</span>
                        <code>{formatInt(s.estadisticas.n_validos)}</code>
                      </div>
                      <div>
                        <span>media_dB</span>
                        <code>{s.estadisticas.media_dB.toFixed(3)} dB</code>
                      </div>
                      <div>
                        <span>mediana_dB</span>
                        <code>{s.estadisticas.mediana_dB.toFixed(3)} dB</code>
                      </div>
                      <div>
                        <span>dB_de_la_media</span>
                        <code>{s.estadisticas.dB_de_la_media.toFixed(3)} dB</code>
                      </div>
                      <div>
                        <span>desv_std_dB</span>
                        <code>{s.estadisticas.desv_std_dB.toFixed(3)} dB</code>
                      </div>
                      <div>
                        <span>p5_dB</span>
                        <code>{s.estadisticas.p5_dB.toFixed(3)} dB</code>
                      </div>
                      <div>
                        <span>p95_dB</span>
                        <code>{s.estadisticas.p95_dB.toFixed(3)} dB</code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Gráficas 2 y 3 en fila */}
          <div className="ws-charts-two-col">
            {maskChart && maskChartData && (
              <section className="ws-chart-card">
                <div className="ws-chart-card__header">
                  <div>
                    <h3>2. {maskChart.titulo}</h3>
                    <p className="ws-chart-card__meta">
                      Fecha: <code>{manifest.escena.fecha_inicio}</code> · Unidad:{' '}
                      <code>{maskChart.eje_y.unidad}</code> · Válidos en polígono:{' '}
                      <strong>{maskChart.pct_validos_en_poligono.toFixed(2)}%</strong>
                    </p>
                  </div>
                  <div className="ws-chart-card__actions">
                    <button
                      type="button"
                      className={`ws-tool-btn ${maskMode === 'bar' ? 'is-active' : ''}`}
                      onClick={() => setMaskMode('bar')}
                    >
                      Barras
                    </button>
                    <button
                      type="button"
                      className={`ws-tool-btn ${maskMode === 'doughnut' ? 'is-active' : ''}`}
                      onClick={() => setMaskMode('doughnut')}
                    >
                      Dona
                    </button>
                  </div>
                </div>

                <div className="ws-chart-card__canvas-md">
                  {maskMode === 'bar' ? (
                    <Bar data={maskChartData} options={maskBarOptions} plugins={[maskValueLabels]} />
                  ) : (
                    <Doughnut data={maskChartData} options={maskDoughnutOptions} />
                  )}
                </div>
                <p className="ws-chart-card__meta">
                  Eje de 0 a 100 % porque «válido» es casi toda la ventana: el valor exacto de cada
                  categoría está escrito sobre su barra. «Fuera de la adquisición» vale 0.000 % de
                  verdad (no hay píxeles con máscara 255 en esta escena). <code>graficas.json</code> solo
                  trae estos 4 porcentajes, no la distribución espacial de la figura D.
                </p>

                <div className="ws-chart-pill-row">
                  <span className="ws-chart-pill">
                    <CheckCircle2 size={12} /> pct_validos_en_poligono:{' '}
                    <strong>{maskChart.pct_validos_en_poligono.toFixed(4)}%</strong>
                  </span>
                </div>
              </section>
            )}

            {incidenceChart && incidenceData && (
              <section className="ws-chart-card">
                <div className="ws-chart-card__header">
                  <div>
                    <h3>3. {incidenceChart.titulo}</h3>
                    <p className="ws-chart-card__meta">
                      Fecha: <code>{manifest.escena.fecha_inicio}</code> · Unidades:{' '}
                      <code>{incidenceChart.eje_x.unidad}</code> vs{' '}
                      <code>{incidenceChart.eje_y.unidad}</code>
                      {incidenceRange && (
                        <>
                          {' '}
                          · span real: <code>{incidenceRange.span.toFixed(4)}°</code> en 10 000 m
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="ws-chart-card__canvas-md">
                  <Line data={incidenceData} options={incidenceOptions} />
                </div>
                <p className="ws-chart-card__meta">
                  Media de la incidencia en la ROI para cada capa de altura del cubo. No es el mapa de la
                  figura E: la media borra la variación oeste–este del mapa y por eso el rango es de solo
                  0.40°. <code>graficas.json</code> no trae la malla 2-D del mapa.
                </p>

                <div className="ws-chart-pill-row">
                  <span className="ws-chart-pill ws-chart-pill--accent">
                    <Info size={12} /> altura_figura_m: <strong>{incidenceChart.altura_figura_m} m</strong>
                    {highlightAngle !== null && (
                      <>
                        {' '}
                        → incidencia media: <strong>{highlightAngle.toFixed(4)} degrees</strong>
                      </>
                    )}
                  </span>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  )
}
