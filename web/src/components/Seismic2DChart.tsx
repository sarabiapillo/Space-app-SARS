import { useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { Activity, Clock } from 'lucide-react'
import type { SeismicSimulationResults } from '../utils/seismic'
import { useTranslation } from '../i18n/useTranslation'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface Seismic2DChartProps {
  results: SeismicSimulationResults
}

export function Seismic2DChart({ results }: Seismic2DChartProps) {
  const { t } = useTranslation()
  const [chartMode, setChartMode] = useState<'pga' | 'travelTime'>('pga')

  const labels = results.attenuationCurve.map((d) => `${d.distanceKm} km`)

  // --- Gráfica 1: Atenuación de Aceleración Pico (PGA) y Zonas de Riesgo ---
  const pgaDataValues = results.attenuationCurve.map((d) => d.pga_g)
  const mmiDataValues = results.attenuationCurve.map((d) => d.mmi)

  const pgaChartData = {
    labels,
    datasets: [
      {
        label: t('Aceleración PGA (g)', 'PGA Acceleration (g)'),
        data: pgaDataValues,
        borderColor: '#dc2626',
        backgroundColor: 'rgba(220, 38, 38, 0.15)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 5,
        yAxisID: 'yPga',
      },
      {
        label: t('Intensidad Mercalli (MMI)', 'Mercalli Intensity (MMI)'),
        data: mmiDataValues,
        borderColor: '#f59e0b',
        borderWidth: 2,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0.25,
        yAxisID: 'yMmi',
      },
    ],
  }

  const pgaChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          boxWidth: 12,
          font: { size: 10, weight: 'bold' as const },
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx: { datasetIndex: number; parsed: { y: number | null } }) => {
            const y = ctx.parsed?.y ?? 0
            if (ctx.datasetIndex === 0) {
              const cgs = y * 980.665
              return ` PGA: ${y.toFixed(3)} g (${cgs.toFixed(1)} cm/s²)`
            }
            return ` Intensidad: MMI ${y.toFixed(1)}`
          },
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: t('Distancia Epicentral (km)', 'Epicentral Distance (km)'),
          font: { size: 10 },
        },
        ticks: {
          maxTicksLimit: 7,
          font: { size: 9 },
        },
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
      },
      yPga: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        title: {
          display: true,
          text: t('Aceleración PGA (g)', 'PGA (g)'),
          font: { size: 10 },
        },
        min: 0,
        ticks: { font: { size: 9 } },
        grid: { color: 'rgba(0, 0, 0, 0.06)' },
      },
      yMmi: {
        type: 'linear' as const,
        display: true,
        position: 'right' as const,
        title: {
          display: true,
          text: t('Escala Mercalli (MMI)', 'Mercalli Scale (MMI)'),
          font: { size: 10 },
        },
        min: 1,
        max: 10,
        ticks: { font: { size: 9 }, stepSize: 2 },
        grid: { drawOnChartArea: false },
      },
    },
  }

  // --- Gráfica 2: Tiempos de Arribo de Onda P y S & Ventana de Alerta ---
  const tPValues = results.attenuationCurve.map((d) => d.tP_sec)
  const tSValues = results.attenuationCurve.map((d) => d.tS_sec)

  const travelTimeChartData = {
    labels,
    datasets: [
      {
        label: t('Onda S (Frente destructivo, 3.5 km/s)', 'S-Wave (Destructive front, 3.5 km/s)'),
        data: tSValues,
        borderColor: '#dc2626',
        backgroundColor: 'rgba(59, 130, 246, 0.18)',
        borderWidth: 2.2,
        tension: 0.1,
        pointRadius: 0,
        fill: '+1', // Rellena hasta la Onda P -> Ventana de alerta
      },
      {
        label: t('Onda P (Frente primario, 6.0 km/s)', 'P-Wave (Primary front, 6.0 km/s)'),
        data: tPValues,
        borderColor: '#2563eb',
        borderWidth: 2.2,
        borderDash: [5, 5],
        tension: 0.1,
        pointRadius: 0,
        fill: false,
      },
    ],
  }

  const travelTimeChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          boxWidth: 12,
          font: { size: 10, weight: 'bold' as const },
        },
      },
      tooltip: {
        callbacks: {
          afterBody: (items: { dataIndex: number }[]) => {
            const idx = items[0]?.dataIndex ?? 0
            const pt = results.attenuationCurve[idx]
            if (!pt) return ''
            return `⚡ ${t('Ventana Alerta Temprana (Δt):', 'Early Warning Window (Δt):')} ${pt.warningTimeSec} s`
          },
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: t('Distancia Epicentral (km)', 'Epicentral Distance (km)'),
          font: { size: 10 },
        },
        ticks: {
          maxTicksLimit: 7,
          font: { size: 9 },
        },
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
      },
      y: {
        title: {
          display: true,
          text: t('Tiempo de Arribo (segundos)', 'Travel Time (seconds)'),
          font: { size: 10 },
        },
        min: 0,
        ticks: { font: { size: 9 } },
        grid: { color: 'rgba(0, 0, 0, 0.06)' },
      },
    },
  }

  return (
    <div className="seismic-chart-card">
      <div className="seismic-chart-card__header">
        <div className="seismic-chart-card__tabs">
          <button
            type="button"
            className={`seismic-chart-tab ${chartMode === 'pga' ? 'is-active' : ''}`}
            onClick={() => setChartMode('pga')}
          >
            <Activity size={12} />
            <span>{t('Atenuación PGA vs Distancia', 'PGA Attenuation vs Distance')}</span>
          </button>
          <button
            type="button"
            className={`seismic-chart-tab ${chartMode === 'travelTime' ? 'is-active' : ''}`}
            onClick={() => setChartMode('travelTime')}
          >
            <Clock size={12} />
            <span>{t('Propagación Ondas P/S & Alerta', 'P/S Waves & Warning Window')}</span>
          </button>
        </div>
      </div>

      <div className="seismic-chart-card__body">
        {chartMode === 'pga' ? (
          <Line data={pgaChartData} options={pgaChartOptions} />
        ) : (
          <Line data={travelTimeChartData} options={travelTimeChartOptions} />
        )}
      </div>

      {chartMode === 'pga' && (
        <div className="seismic-risk-zones-legend">
          <span className="seismic-zone-badge is-destructive">
            ■ {t('Destructivo (PGA ≥ 0.34g, MMI VIII+)', 'Destructive (PGA ≥ 0.34g, MMI VIII+)')}
          </span>
          <span className="seismic-zone-badge is-severe">
            ■ {t('Severo (0.12 - 0.34g, MMI VI-VII)', 'Severe (0.12 - 0.34g, MMI VI-VII)')}
          </span>
          <span className="seismic-zone-badge is-moderate">
            ■ {t('Moderado (0.03 - 0.12g, MMI IV-V)', 'Moderate (0.03 - 0.12g, MMI IV-V)')}
          </span>
          <span className="seismic-zone-badge is-light">
            ■ {t('Leve (0.005 - 0.03g, MMI II-III)', 'Light (0.005 - 0.03g, MMI II-III)')}
          </span>
        </div>
      )}

      {chartMode === 'travelTime' && (
        <div className="seismic-chart-footer-note">
          <span>
            ℹ️ {t('El área entre curvas representa el tiempo de oportunidad de advertencia antes del arribo de la onda destructiva S.', 'The shaded area represents the warning window before the destructive S-wave arrives.')}
          </span>
        </div>
      )}
    </div>
  )
}
