import { useState, useMemo } from 'react'
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
import { Activity, Clock, Waves } from 'lucide-react'
import {
  type SeismicSimulationResults,
  generateSyntheticSeismogram,
  mmiToRoman,
} from '../utils/seismic'
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
  const [chartMode, setChartMode] = useState<'pga' | 'travelTime' | 'waveform'>('pga')
  const [stationDistanceKm, setStationDistanceKm] = useState<number>(120)

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

  // --- Gráfica 3: Sismograma Sintético / Serie Temporal a(t) ---
  const seismogram = useMemo(() => {
    return generateSyntheticSeismogram(results.source, stationDistanceKm, 240)
  }, [results.source, stationDistanceKm])

  const waveformLabels = seismogram.points.map((p) => `${p.timeSec.toFixed(1)}s`)
  const waveformValues = seismogram.points.map((p) => p.acceleration_g)

  const waveformChartData = {
    labels: waveformLabels,
    datasets: [
      {
        label: t('Aceleración a(t) [g]', 'Acceleration a(t) [g]'),
        data: waveformValues,
        borderColor: '#dc2626',
        backgroundColor: 'rgba(220, 38, 38, 0.12)',
        borderWidth: 1.4,
        tension: 0.12,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
      },
    ],
  }

  const waveformChartOptions = {
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
          label: (ctx: { parsed: { y: number | null }; dataIndex: number }) => {
            const y = ctx.parsed?.y ?? 0
            const cgs = y * 980.665
            const pt = seismogram.points[ctx.dataIndex]
            let phaseDesc = ''
            if (pt) {
              if (pt.phase === 'ambient') phaseDesc = t(' [Ruido Ambiental]', ' [Ambient Noise]')
              else if (pt.phase === 'p_wave') phaseDesc = t(' [Frente Onda P]', ' [P-Wave Front]')
              else if (pt.phase === 'warning') phaseDesc = t(' [Ventana Alerta]', ' [Warning Window]')
              else if (pt.phase === 's_wave') phaseDesc = t(' [Frente Onda S Destructiva]', ' [Destructive S-Wave]')
              else phaseDesc = t(' [Coda y Superficiales]', ' [Coda & Surface Waves]')
            }
            return ` a(t): ${y.toFixed(4)} g (${cgs.toFixed(1)} cm/s²)${phaseDesc}`
          },
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: t('Tiempo desde la Ruptura (s)', 'Time since Rupture (s)'),
          font: { size: 10 },
        },
        ticks: {
          maxTicksLimit: 8,
          font: { size: 9 },
        },
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
      },
      y: {
        title: {
          display: true,
          text: t('Aceleración (g)', 'Acceleration (g)'),
          font: { size: 10 },
        },
        ticks: { font: { size: 9 } },
        grid: { color: 'rgba(0, 0, 0, 0.06)' },
      },
    },
  }

  const STATION_PRESETS = [
    { label: t('Cercana (30 km)', 'Near (30 km)'), dist: 30 },
    { label: t('Media (80 km)', 'Mid (80 km)'), dist: 80 },
    { label: t('Regional (160 km)', 'Regional (160 km)'), dist: 160 },
    { label: t('Valle México / CDMX (320 km)', 'Mexico Valley / CDMX (320 km)'), dist: 320 },
    { label: t('Lejana (480 km)', 'Far (480 km)'), dist: 480 },
  ]

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
          <button
            type="button"
            className={`seismic-chart-tab ${chartMode === 'waveform' ? 'is-active' : ''}`}
            onClick={() => setChartMode('waveform')}
          >
            <Waves size={12} />
            <span>{t('Sismograma Científico a(t)', 'Scientific Seismogram a(t)')}</span>
          </button>
        </div>
      </div>

      {chartMode === 'waveform' && (
        <div className="seismic-waveform-controls">
          <div className="seismic-waveform-slider-row">
            <label htmlFor="station-dist-slider">
              {t('Distancia Estación Receptora:', 'Receiver Station Distance:')}{' '}
              <span className="seismic-waveform-dist-badge">{stationDistanceKm} km</span>
            </label>
            <input
              id="station-dist-slider"
              type="range"
              min="10"
              max="600"
              step="5"
              value={stationDistanceKm}
              onChange={(e) => setStationDistanceKm(Number(e.target.value))}
              className="seismic-waveform-slider"
            />
          </div>

          <div className="seismic-waveform-presets">
            {STATION_PRESETS.map((p) => (
              <button
                key={p.dist}
                type="button"
                className={`seismic-station-btn ${stationDistanceKm === p.dist ? 'is-active' : ''}`}
                onClick={() => setStationDistanceKm(p.dist)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="seismic-waveform-metrics-strip">
            <span className="seismic-waveform-metric-item">
              🔵 {t('Onda P:', 'P-Wave:')} <strong>{seismogram.tP_sec}s</strong>
            </span>
            <span className="seismic-waveform-metric-item">
              ⚡ {t('Alerta SASMEX:', 'SASMEX Warning:')} <strong style={{ color: '#ea580c' }}>{seismogram.warningTimeSec}s</strong>
            </span>
            <span className="seismic-waveform-metric-item">
              🔴 {t('Onda S Destructiva:', 'Destructive S-Wave:')} <strong>{seismogram.tS_sec}s</strong>
            </span>
            <span className="seismic-waveform-metric-item">
              📈 {t('PGA en Sitio:', 'Site PGA:')} <strong>{seismogram.peakPga_g.toFixed(3)}g</strong> ({seismogram.peakPga_cgs.toFixed(1)} cm/s²)
            </span>
            <span className="seismic-waveform-metric-item">
              🏛️ {t('Intensidad:', 'Intensity:')} <strong>MMI {mmiToRoman(seismogram.stationMmi)}</strong> ({seismogram.stationMmi.toFixed(1)})
            </span>
          </div>
        </div>
      )}

      <div className="seismic-chart-card__body">
        {chartMode === 'pga' ? (
          <Line data={pgaChartData} options={pgaChartOptions} />
        ) : chartMode === 'travelTime' ? (
          <Line data={travelTimeChartData} options={travelTimeChartOptions} />
        ) : (
          <Line data={waveformChartData} options={waveformChartOptions} />
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

      {chartMode === 'waveform' && (
        <div className="seismic-risk-zones-legend">
          <span className="seismic-zone-badge is-light">
            🔵 {t('Onda P (Compresión rápida, menor daño)', 'P-Wave (Fast compression, low damage)')}
          </span>
          <span className="seismic-zone-badge is-moderate">
            ⚡ {t('Ventana de Alerta (Δt = tS - tP)', 'Warning Window (Δt = tS - tP)')}
          </span>
          <span className="seismic-zone-badge is-destructive">
            🔴 {t('Onda S y Superficiales (Corte de alta energía destructiva, PGA máx)', 'S-Wave & Surface Waves (Destructive high-energy shear, max PGA)')}
          </span>
          <span className="seismic-zone-badge is-severe">
            〰️ {t('Coda Sísmica (Atenuación exponencial)', 'Seismic Coda (Exponential decay)')}
          </span>
        </div>
      )}
    </div>
  )
}
