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
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { AlertTriangle, BarChart3, CheckCircle2, FileJson, Info } from 'lucide-react'
import { fetchExploreCharts, type ExploreChartsFetchResult } from '../api/client'
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
}

type DateChoice = 't1' | 't2'
type PolFilter = 'both' | 'HHHH' | 'HVHV'
type MaskChartMode = 'bar' | 'doughnut'

function formatInt(n: number): string {
  return n.toLocaleString('es-MX')
}

export function Etapa1ChartsPanel({ compact = false }: Etapa1ChartsPanelProps) {
  const [dateChoice, setDateChoice] = useState<DateChoice>('t2')
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
    let cancelled = false
    fetchExploreCharts(targetGranuleId).then((res) => {
      if (cancelled) return
      setLoaded({ granuleId: targetGranuleId, result: res })
    })
    return () => {
      cancelled = true
    }
  }, [targetGranuleId])

  const loading = loaded?.granuleId !== targetGranuleId
  const manifest = !loading ? (loaded?.result.manifest ?? null) : null
  const sourceUrl = !loading ? (loaded?.result.sourceUrl ?? '') : ''
  const error = !loading ? (loaded?.result.error ?? null) : null

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

  // Reconstruir centros de bin exactos y porcentajes en una malla común de ancho_bin (0.1 dB)
  const histogramData = useMemo(() => {
    if (!histogramChart || histogramChart.series.length === 0) return null
    const anchoBin = histogramChart.eje_x.ancho_bin || 0.1
    const activeSeries =
      polFilter === 'both'
        ? histogramChart.series
        : histogramChart.series.filter((s) => s.nombre === polFilter)

    if (activeSeries.length === 0) return null

    const minStart = Math.min(...activeSeries.map((s) => s.bin_inicio_dB))
    const maxEnd = Math.max(
      ...activeSeries.map((s) => s.bin_inicio_dB + s.conteos.length * anchoBin),
    )
    const totalBins = Math.max(1, Math.round((maxEnd - minStart) / anchoBin))
    const labels = Array.from({ length: totalBins }, (_, i) =>
      Number((minStart + (i + 0.5) * anchoBin).toFixed(2)),
    )

    const palette: Record<string, { bg: string; border: string }> = {
      HHHH: { bg: 'rgba(51, 153, 255, 0.55)', border: '#1D4ED8' },
      HVHV: { bg: 'rgba(234, 88, 12, 0.50)', border: '#C2410C' },
    }

    const datasets = activeSeries.map((serie) => {
      const aligned = new Array<number | null>(totalBins).fill(null)
      const denom = serie.total_en_rango > 0 ? serie.total_en_rango : 1
      for (let k = 0; k < serie.conteos.length; k += 1) {
        const centroK = serie.bin_inicio_dB + (k + 0.5) * anchoBin
        const idx = Math.round((centroK - (minStart + 0.5 * anchoBin)) / anchoBin)
        if (idx >= 0 && idx < totalBins) {
          aligned[idx] = Number(((100 * serie.conteos[k]) / denom).toFixed(5))
        }
      }
      const colors = palette[serie.nombre] ?? {
        bg: 'rgba(15, 118, 110, 0.5)',
        border: '#0F766E',
      }
      return {
        label: `${serie.nombre} (${histogramChart.eje_x.unidad})`,
        data: aligned,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: 0.75,
        barPercentage: 1,
        categoryPercentage: 1,
      }
    })

    return { labels, datasets, anchoBin }
  }, [histogramChart, polFilter])

  const histogramOptions: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, font: { size: 11, family: 'Segoe UI, Inter, sans-serif' } },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const xVal = items[0]?.label ?? ''
              return `γ⁰ centro de bin: ${xVal} ${histogramChart?.eje_x.unidad ?? 'dB'}`
            },
            label: (ctx) =>
              `${ctx.dataset.label}: ${typeof ctx.parsed.y === 'number' ? ctx.parsed.y.toFixed(3) : '0'} %`,
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: `${histogramChart?.eje_x.etiqueta ?? 'γ⁰'} [${histogramChart?.eje_x.unidad ?? 'dB'}] (bin ${histogramChart?.eje_x.ancho_bin ?? 0.1} dB)`,
            font: { size: 11, weight: 'bold' },
          },
          ticks: {
            maxTicksLimit: 16,
            font: { size: 10 },
          },
          grid: { color: '#E2E8F0' },
        },
        y: {
          title: {
            display: true,
            text: `% de píxeles (total en rango · bin ${histogramChart?.eje_x.ancho_bin ?? 0.1} dB)`,
            font: { size: 11, weight: 'bold' },
          },
          ticks: {
            font: { size: 10 },
            callback: (val) => `${val}%`,
          },
          grid: { color: '#E2E8F0' },
        },
      },
    }),
    [histogramChart],
  )

  const maskChartData = useMemo(() => {
    if (!maskChart || !maskChart.series[0]) return null
    const values = maskChart.series[0].valores
    const colors = ['#16A34A', '#DC2626', '#64748B', '#F59E0B']
    return {
      labels: maskChart.etiquetas,
      datasets: [
        {
          label: `${maskChart.series[0].nombre} (${maskChart.eje_y.unidad})`,
          data: values,
          backgroundColor: colors.slice(0, values.length),
          borderColor: '#FFFFFF',
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
          title: {
            display: true,
            text: `${incidenceChart?.eje_y.etiqueta ?? 'Ángulo de incidencia'} [${incidenceChart?.eje_y.unidad ?? 'degrees'}]`,
            font: { size: 11, weight: 'bold' },
          },
          ticks: { font: { size: 10 } },
        },
      },
    }),
    [incidenceChart],
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
            <strong>Gráficas Etapa 1 · T62/F10 (Chart.js)</strong>
            <div className="ws-charts-panel__sub">
              <code>graficas.json</code> · sin CSV de <code>control/</code>
            </div>
          </div>
        </div>

        <div className="ws-charts-panel__controls">
          <button
            type="button"
            className={`ws-tool-btn ws-tool-btn--mono ${dateChoice === 't1' ? 'is-active' : ''}`}
            onClick={() => setDateChoice('t1')}
            title={`Cargar graficas.json t1 (2026-06-18): ${RAW_SCENE_IDS.T62_T1_20260618}`}
          >
            t1 (2026-06-18)
          </button>
          <button
            type="button"
            className={`ws-tool-btn ws-tool-btn--mono ${dateChoice === 't2' ? 'is-active' : ''}`}
            onClick={() => setDateChoice('t2')}
            title={`Cargar graficas.json t2 (2026-10-16): ${RAW_SCENE_IDS.T62_T2_20261016}`}
          >
            t2 (2026-10-16)
          </button>
        </div>
      </div>

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
          {histogramChart && histogramData && (
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

              <div className="ws-chart-card__canvas-lg">
                <Bar data={histogramData} options={histogramOptions} />
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
                    <Bar data={maskChartData} options={maskBarOptions} />
                  ) : (
                    <Doughnut data={maskChartData} options={maskDoughnutOptions} />
                  )}
                </div>

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
                    </p>
                  </div>
                </div>

                <div className="ws-chart-card__canvas-md">
                  <Line data={incidenceData} options={incidenceOptions} />
                </div>

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
    </div>
  )
}
