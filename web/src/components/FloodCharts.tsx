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

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

interface FloodChartsProps {
  flood: FloodSimulationState
}

// Mismos tonos que la paleta del ráster de calados (analyses/simulate.py).
const DEPTH_COLORS = ['#22D3EE', '#06B6D4', '#0284C7', '#1D4ED8', '#1E3A8A']

const fmt = (v: number, d = 1) => v.toLocaleString('es-MX', { maximumFractionDigits: d })

function baseOptions(xTitle: string, yTitle: string, horizontal = false): ChartOptions<'bar'> {
  return {
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
  const stats = flood.stats

  const balance = useMemo(() => {
    if (!stats) return null
    const rows: Array<[string, number | undefined, string]> = [
      ['Lluvia total', stats.totalVolumeM3, '#64748B'],
      ['Infiltrado', stats.infiltratedVolumeM3, '#A16207'],
      ['Escorrentía efectiva', stats.effectiveVolumeM3, '#0EA5E9'],
      ['Almacenado en láminas ≥ 3 cm', stats.floodedVolumeM3, '#1D4ED8'],
    ]
    const known = rows.filter((r): r is [string, number, string] => typeof r[1] === 'number')
    return {
      labels: known.map((r) => r[0]),
      datasets: [{ data: known.map((r) => r[1] / 1000), backgroundColor: known.map((r) => r[2]) }],
    }
  }, [stats])

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
      labels.push(`${fmt(start, 1)}–${fmt(end, 1)} h`)
      perStep.push(Number((intensity * (end - start)).toFixed(3)))
    }
    return {
      intensity,
      step,
      data: { labels, datasets: [{ data: perStep, backgroundColor: '#38BDF8' }] },
    }
  }, [stats])

  if (!stats) {
    return (
      <p className="flood-charts__empty">
        Ejecuta la simulación para generar las gráficas de la zona seleccionada.
      </p>
    )
  }

  return (
    <section className="flood-charts" aria-label="Gráficas del simulador de inundación">
      <p className="flood-charts__source">
        Fuente:{' '}
        {'cálculo del backend con DEM NASADEM 30 m'}
        . Escenario simulado, no observación.
      </p>

      {balance && (
        <figure className="flood-charts__fig">
          <figcaption>Balance hídrico de la ROI (miles de m³)</figcaption>
          <div className="flood-charts__canvas">
            <Bar data={balance} options={baseOptions('miles de m³', '', true)} />
          </div>
          <small>
            Infiltrado + escorrentía = lluvia total. El volumen almacenado es el de las celdas con calado ≥ 3 cm.
          </small>
        </figure>
      )}

      <figure className="flood-charts__fig">
        <figcaption>Distribución de calados en las celdas mojadas</figcaption>
        {depth ? (
          <>
            <div className="flood-charts__canvas">
              <Bar
                data={{ labels: depth.labels, datasets: depth.datasets }}
                options={{
                  ...baseOptions('clase de calado', 'área [km²]'),
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => `${fmt(Number(ctx.parsed.y), 4)} km² · ${depth.pct[ctx.dataIndex]} % del área mojada`,
                      },
                    },
                  },
                }}
              />
            </div>
            <small>Clases con los mismos cortes que la paleta del mapa. Celda de {flood.charts?.cell_size_m} m.</small>
          </>
        ) : (
          <small>No disponible: solo lo calcula el backend con NASADEM.</small>
        )}
      </figure>

      {hyeto && (
        <figure className="flood-charts__fig">
          <figcaption>
            Hietograma de la lluvia simulada ({fmt(stats.rainfallMm)} mm en {fmt(stats.durationHours)} h)
          </figcaption>
          <div className="flood-charts__canvas">
            <Bar data={hyeto.data} options={baseOptions(`intervalo de ${hyeto.step} h`, 'lluvia [mm]')} />
          </div>
          <small>
            Intensidad uniforme de {fmt(hyeto.intensity, 2)} mm/h: es el supuesto del modelo, no un registro de lluvia.
          </small>
        </figure>
      )}
    </section>
  )
}
