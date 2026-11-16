import { useMemo } from 'react'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import type { FloodSimulationState } from '../types/workspace'
import { useTranslation } from '../i18n/useTranslation'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

interface FloodChartsProps {
  flood: FloodSimulationState
}

// Mismos tonos que la paleta del ráster de calados (analyses/simulate.py).
const DEPTH_COLORS = ['#22D3EE', '#06B6D4', '#0284C7', '#1D4ED8', '#1E3A8A']

const fmt = (v: number, locale: string, d = 1) => v.toLocaleString(locale, { maximumFractionDigits: d })

function baseOptions(xTitle: string, yTitle: string, locale: string, horizontal = false): ChartOptions<'bar'> {
  return {
    locale,
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: xTitle, font: { size: 10 } }, ticks: { font: { size: 9 } }, beginAtZero: true },
      y: { title: { display: true, text: yTitle, font: { size: 10 } }, ticks: { font: { size: 9 } }, beginAtZero: true },
    },
  }
}

/**
 * Gráficas del simulador de inundación, generadas con la respuesta de /api/flood-scenarios/simulate:
 * balance hídrico, distribución de calados e hietograma de la lluvia simulada.
 */
export function FloodCharts({ flood }: FloodChartsProps) {
  const { t, locale } = useTranslation()
  const stats = flood.stats

  const balance = useMemo(() => {
    if (!stats) return null
    const rows: Array<[string, number | undefined, string]> = [
      [t('Lluvia total', 'Total rainfall'), stats.totalVolumeM3, '#64748B'],
      [t('Infiltrado', 'Infiltrated'), stats.infiltratedVolumeM3, '#A16207'],
      [t('Escorrentía efectiva', 'Effective runoff'), stats.effectiveVolumeM3, '#0EA5E9'],
      [t('Almacenado en láminas ≥ 3 cm', 'Stored in water depths ≥ 3 cm'), stats.floodedVolumeM3, '#1D4ED8'],
    ]
    const known = rows.filter((r): r is [string, number, string] => typeof r[1] === 'number')
    return {
      labels: known.map((r) => r[0]),
      datasets: [{ data: known.map((r) => r[1] / 1000), backgroundColor: known.map((r) => r[2]) }],
    }
  }, [stats, t])

  const depth = useMemo(() => {
    const classes = flood.charts?.depth_classes
    if (!classes || classes.length === 0) return null
    return {
      labels: classes.map((c) => (c.hasta_m === null ? `≥ ${c.desde_m} m` : `${c.desde_m}–${c.hasta_m} m`)),
      datasets: [{ data: classes.map((c) => c.area_km2), backgroundColor: DEPTH_COLORS.slice(0, classes.length) }],
      pct: classes.map((c) => c.pct_mojado),
    }
  }, [flood.charts])

  // Hietograma: el modelo reparte la lámina de lluvia de forma uniforme en la duración indicada.
  const hyeto = useMemo(() => {
    if (!stats || !(stats.durationHours > 0) || !(stats.rainfallMm >= 0)) return null
    const hours = stats.durationHours
    const step = hours <= 24 ? 1 : hours <= 72 ? 3 : 6
    const n = Math.max(1, Math.ceil(hours / step))
    const intensity = stats.rainfallMm / hours
    const labels: string[] = []
    const perStep: number[] = []
    for (let i = 0; i < n; i++) {
      const start = i * step
      const end = Math.min(hours, (i + 1) * step)
      labels.push(`${fmt(start, locale, 1)}–${fmt(end, locale, 1)} h`)
      perStep.push(Number((intensity * (end - start)).toFixed(3)))
    }
    return {
      intensity,
      step,
      data: { labels, datasets: [{ data: perStep, backgroundColor: '#38BDF8' }] },
    }
  }, [stats, locale])

  if (!stats) {
    return (
      <p className="flood-charts__empty">
        {t('Ejecuta la simulación para generar las gráficas de la zona seleccionada.', 'Run the simulation to generate charts for the selected area.')}
      </p>
    )
  }

  return (
    <section className="flood-charts" aria-label={t('Gráficas del simulador de inundación', 'Flood simulator charts')}>
      <p className="flood-charts__source">
        {t('Fuente:', 'Source:')}{' '}
        {t('cálculo del backend con DEM NASADEM 30 m', 'backend computation with NASADEM 30 m DEM')}
        {t('. Escenario simulado, no observación.', '. Simulated scenario, not an observation.')}
      </p>

      {balance && (
        <figure className="flood-charts__fig">
          <figcaption>{t('Balance hídrico de la ROI (miles de m³)', 'ROI water balance (thousands of m³)')}</figcaption>
          <div className="flood-charts__canvas">
            <Bar data={balance} options={{
              ...baseOptions(t('miles de m³', 'thousands of m³'), '', locale, true),
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(Number(ctx.parsed.x), locale, 3)} ${t('miles de m³', 'thousands of m³')}` } } },
            }} />
          </div>
          <small>
            {t('Infiltrado + escorrentía = lluvia total. El volumen almacenado es el de las celdas con calado ≥ 3 cm.', 'Infiltration + runoff = total rainfall. Stored volume is from cells with water depth ≥ 3 cm.')}
          </small>
        </figure>
      )}

      <figure className="flood-charts__fig">
        <figcaption>{t('Distribución de calados en las celdas mojadas', 'Water depth distribution in wet cells')}</figcaption>
        {depth ? (
          <>
            <div className="flood-charts__canvas">
              <Bar
                data={{ labels: depth.labels, datasets: depth.datasets }}
                options={{
                  ...baseOptions(t('clase de calado', 'water depth class'), t('área [km²]', 'area [km²]'), locale),
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => t('{area} km² · {pct} % del área mojada', '{area} km² · {pct} % of wet area', { area: fmt(Number(ctx.parsed.y), locale, 4), pct: depth.pct[ctx.dataIndex] }),
                      },
                    },
                  },
                }}
              />
            </div>
            <small>{t('Clases con los mismos cortes que la paleta del mapa. Celda de {size} m.', 'Classes use the same boundaries as the map palette. Cell size: {size} m.', { size: flood.charts?.cell_size_m ?? '—' })}</small>
          </>
        ) : (
          <small>{t('No disponible: solo lo calcula el backend con NASADEM.', 'Unavailable: only the NASADEM backend computes this.')}</small>
        )}
      </figure>

      {hyeto && (
        <figure className="flood-charts__fig">
          <figcaption>
            {t('Hietograma de la lluvia simulada ({amount} mm en {hours} h)', 'Simulated rainfall hyetograph ({amount} mm over {hours} h)', { amount: fmt(stats.rainfallMm, locale), hours: fmt(stats.durationHours, locale) })}
          </figcaption>
          <div className="flood-charts__canvas">
            <Bar data={hyeto.data} options={{
              ...baseOptions(t('intervalo de {step} h', '{step} h interval', { step: hyeto.step }), t('lluvia [mm]', 'rainfall [mm]'), locale),
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${fmt(Number(ctx.parsed.y), locale, 3)} mm` } } },
            }} />
          </div>
          <small>
            {t('Intensidad uniforme de {intensity} mm/h: es el supuesto del modelo, no un registro de lluvia.', 'Uniform intensity of {intensity} mm/h: this is a model assumption, not a rainfall observation.', { intensity: fmt(hyeto.intensity, locale, 2) })}
          </small>
        </figure>
      )}
    </section>
  )
}
