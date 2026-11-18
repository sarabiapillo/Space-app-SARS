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
  synthesizeSeismogram,
  haversineDistanceKm,
  mmiToRoman,
} from '../utils/seismic'
import type { SeismicSimulationState } from '../types/workspace'
import { SeismogramSpectrogram } from './SeismogramSpectrogram'
import { RealRecordCompare } from './RealRecordCompare'
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
  /** Estado del escenario: permite elegir la estación receptora en el mapa. */
  seismic?: SeismicSimulationState
  onSeismicChange?: (next: SeismicSimulationState) => void
}

export function Seismic2DChart({ results, seismic, onSeismicChange }: Seismic2DChartProps) {
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

  // --- Gráfica 3: Sismograma sintético a(t) a 50 Hz + espectrograma (canvas) ---
  const station = seismic?.station ?? null
  const effectiveDistanceKm = station
    ? Math.round(haversineDistanceKm(results.source.epicenter, station) * 10) / 10
    : stationDistanceKm
  const stationVs30 = station ? seismic?.stationVs30 ?? null : null
  const seismogram = useMemo(
    () => synthesizeSeismogram(results.source, effectiveDistanceKm, { stationVs30 }),
    [results.source, effectiveDistanceKm, stationVs30]
  )
  const markers = useMemo(() => ({ tP: seismogram.tP_sec, tS: seismogram.tS_sec }), [seismogram])

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
            <span>{t('Sismograma y Espectrograma', 'Seismogram & Spectrogram')}</span>
          </button>
        </div>
      </div>

      {chartMode === 'waveform' && (
        <div className="seismic-waveform-controls">
          <div className="seismic-waveform-slider-row">
            <label htmlFor="station-dist-slider">
              {t('Distancia Estación Receptora:', 'Receiver Station Distance:')}{' '}
              <span className="seismic-waveform-dist-badge">{effectiveDistanceKm} km</span>
            </label>
            <input
              id="station-dist-slider"
              disabled={Boolean(station)}
              type="range"
              min="10"
              max="600"
              step="5"
              value={stationDistanceKm}
              onChange={(e) => setStationDistanceKm(Number(e.target.value))}
              className="seismic-waveform-slider"
            />
          </div>

          {seismic && onSeismicChange && (
            <div className="seismic-station-map-row">
              <button
                type="button"
                className={`seismic-station-btn ${seismic.pickingStation ? 'is-active' : ''}`}
                onClick={() => onSeismicChange({ ...seismic, pickingStation: !seismic.pickingStation })}
                title={t('El siguiente clic en el mapa coloca la estación receptora', 'The next map click places the receiver station')}
              >
                📍 {seismic.pickingStation
                  ? t('Haz clic en el mapa… (cancelar)', 'Click on the map… (cancel)')
                  : station ? t('Mover estación en el mapa', 'Move station on the map') : t('Elegir estación en el mapa', 'Pick station on the map')}
              </button>
              {station && (
                <>
                  <span className="seismic-waveform-metric-item">
                    {station[1].toFixed(3)}°, {station[0].toFixed(3)}°
                  </span>
                  <label className="seismic-waveform-metric-item">
                    Vs30 {t('estación', 'station')}
                    <input
                      type="number"
                      min="80"
                      max="1500"
                      step="10"
                      className="seismic-vs30-input"
                      value={seismogram.stationVs30}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (v >= 80 && v <= 1500) onSeismicChange({ ...seismic, stationVs30: v })
                      }}
                    />
                    m/s
                  </label>
                  <button
                    type="button"
                    className="seismic-station-btn"
                    onClick={() => onSeismicChange({ ...seismic, station: null, stationVs30: null, pickingStation: false })}
                  >
                    {t('Quitar estación', 'Remove station')}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="seismic-waveform-presets">
            {STATION_PRESETS.map((p) => (
              <button
                key={p.dist}
                type="button"
                className={`seismic-station-btn ${!station && stationDistanceKm === p.dist ? 'is-active' : ''}`}
                onClick={() => {
                  setStationDistanceKm(p.dist)
                  if (station && seismic && onSeismicChange) onSeismicChange({ ...seismic, station: null, stationVs30: null, pickingStation: false })
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="seismic-waveform-metrics-strip">
            <span className="seismic-waveform-metric-item">
              🔵 {t('Onda P:', 'P-Wave:')} <strong>{seismogram.tP_sec.toFixed(1)}s</strong>
            </span>
            <span className="seismic-waveform-metric-item">
              ⏱ {t('Ventana P–S (Δt):', 'P–S window (Δt):')} <strong>{seismogram.warningTimeSec.toFixed(1)}s</strong>
            </span>
            <span className="seismic-waveform-metric-item" title={t('Ec. 10: tS − 3 s de proceso, desde el origen del sismo', 'Eq. 10: tS − 3 s processing, from origin time')}>
              ⚡ {t('Alerta SASMEX:', 'SASMEX Warning:')} <strong style={{ color: '#ea580c' }}>{seismogram.alertTimeSec.toFixed(1)}s</strong>
            </span>
            <span className="seismic-waveform-metric-item">
              🔴 {t('Onda S Destructiva:', 'Destructive S-Wave:')} <strong>{seismogram.tS_sec.toFixed(1)}s</strong>
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

      {chartMode === 'waveform' ? (
        <>
          <SeismogramSpectrogram
            accel_g={seismogram.accel_g}
            sampleRateHz={seismogram.sampleRateHz}
            markers={markers}
            ariaLabel={t('Sismograma sintético y espectrograma', 'Synthetic seismogram and spectrogram')}
          />
          <p className="seismic-chart-footer-note">
            {t('Espectrograma: potencia de a(t) por frecuencia (ventana de Hann de 5.1 s, inferno, dB bajo el máximo). Onda P ≈ {p1}–{p2} Hz; onda S fundamental {fs} Hz según el suelo. Modelo analítico ilustrativo (50 muestras/s), no un registro.',
              'Spectrogram: power of a(t) by frequency (5.1 s Hann window, inferno, dB below max). P-wave ≈ {p1}–{p2} Hz; S-wave fundamental {fs} Hz by soil. Illustrative analytic model (50 samples/s), not a record.',
              { p1: (0.85 * seismogram.fp_Hz).toFixed(1), p2: (1.15 * seismogram.fp_Hz).toFixed(1), fs: seismogram.fs_Hz })}
          </p>
          <RealRecordCompare synthetic={seismogram} />
        </>
      ) : (
        <div className="seismic-chart-card__body">
          {chartMode === 'pga' ? (
            <Line data={pgaChartData} options={pgaChartOptions} />
          ) : (
            <Line data={travelTimeChartData} options={travelTimeChartOptions} />
          )}
        </div>
      )}

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
