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
import { Bar, Line } from 'react-chartjs-2'
import type { FloodRoiResult } from '../api/client'
import { DEPTH_CLASSES, dg2ChartData } from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

interface Props {
  result: FloodRoiResult
  /** Selected frame for the depth distribution; null or undefined selects the maximum. */
  frameIndex: number | null | undefined
}

const RAIN = '#64748B'
const AREA = '#0284C7'
const DEPTH = '#1E3A8A'
const RAIN_TOTAL = '#94A3B8'

const round = (v: number, digits = 2) => String(Math.round(v * 10 ** digits) / 10 ** digits)

function axes(x: string, y: string, locale: string): ChartOptions<'bar'> & ChartOptions<'line'> {
  return {
    locale,
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: x, font: { size: 10 } }, ticks: { font: { size: 9 } } },
      y: { title: { display: true, text: y, font: { size: 10 } }, ticks: { font: { size: 9 } }, beginAtZero: true },
    },
  }
}

/** Charts of one DG2 run: synthetic rain, flooded area and maximum depth, volume balance and depth classes. */
export function FloodDg2Charts({ result, frameIndex }: Props) {
  const { t, locale } = useTranslation()
  const data = useMemo(() => dg2ChartData(result, frameIndex), [result, frameIndex])
  const minutes = t('tiempo programado (min)', 'scheduled time (min)')
  if (!data.hyetograph && !data.evolution && !data.volume && !data.distribution) {
    return <p className="flood-charts__empty">{t('Esta corrida es anterior a las gráficas DG2.', 'This run predates the DG2 charts.')}</p>
  }
  return (
    <section className="flood-charts" aria-label={t('Gráficas de la simulación DG2', 'DG2 simulation charts')}>
      <p className="flood-charts__source">{t('Solución numérica DG2 con lluvia sintética; no son observaciones.', 'DG2 numerical solution with synthetic rainfall; not observations.')}</p>

      {data.hyetograph && (
        <figure className="flood-charts__fig">
          <figcaption>{t('Hietograma de la lluvia sintética (mm/h)', 'Synthetic rainfall hyetograph (mm/h)')}</figcaption>
          <div className="flood-charts__canvas">
            <Bar
              data={{ labels: data.hyetograph.labels, datasets: [{ data: data.hyetograph.mmPerHour, backgroundColor: RAIN }] }}
              options={axes(t('intervalo (min)', 'interval (min)'), 'mm/h', locale)}
            />
          </div>
        </figure>
      )}

      {data.evolution && (
        <figure className="flood-charts__fig">
          <figcaption>{t('Área inundada (≥ 0.03 m) y profundidad máxima', 'Flooded area (≥ 0.03 m) and maximum depth')}</figcaption>
          <div className="flood-charts__canvas">
            <Line
              data={{
                labels: data.evolution.minutes.map(m => round(m)),
                datasets: [
                  { label: t('Área inundada (ha)', 'Flooded area (ha)'), data: data.evolution.wetAreaHa, borderColor: AREA, backgroundColor: AREA, yAxisID: 'y' },
                  { label: t('Profundidad máxima (m)', 'Maximum depth (m)'), data: data.evolution.maxDepthM, borderColor: DEPTH, backgroundColor: DEPTH, borderDash: [4, 3], yAxisID: 'y1' },
                ],
              }}
              options={{
                ...axes(minutes, 'ha', locale),
                plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 9 } } } },
                scales: {
                  ...axes(minutes, 'ha', locale).scales,
                  y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'm', font: { size: 10 } }, ticks: { font: { size: 9 } } },
                },
              }}
            />
          </div>
        </figure>
      )}

      {data.volume && (
        <figure className="flood-charts__fig">
          <figcaption>{t('Agua en el dominio frente a lluvia acumulada (m³)', 'Water in the domain against cumulative rain (m³)')}</figcaption>
          <div className="flood-charts__canvas">
            <Line
              data={{
                labels: data.volume.minutes.map(m => round(m)),
                datasets: [
                  { label: t('Lluvia acumulada', 'Cumulative rain'), data: data.volume.rainM3, borderColor: RAIN_TOTAL, backgroundColor: RAIN_TOTAL, borderDash: [4, 3] },
                  { label: t('Agua en el dominio', 'Water in the domain'), data: data.volume.domainM3, borderColor: AREA, backgroundColor: AREA },
                ],
              }}
              options={{ ...axes(minutes, 'm³', locale), plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 9 } } } } }}
            />
          </div>
          <small>{t('La diferencia es el agua que salió por las fronteras (balance de masa del solver).', 'The gap is water that left through the boundaries (solver mass balance).')}</small>
        </figure>
      )}

      {data.distribution && (
        <figure className="flood-charts__fig">
          <figcaption>
            {frameIndex == null
              ? t('Área por clase de profundidad: máximo (ha)', 'Area per depth class: maximum (ha)')
              : t(`Área por clase de profundidad: cuadro #${frameIndex} (ha)`, `Area per depth class: frame #${frameIndex} (ha)`)}
          </figcaption>
          <div className="flood-charts__canvas">
            <Bar
              data={{ labels: data.distribution.labels, datasets: [{ data: data.distribution.areaHa, backgroundColor: DEPTH_CLASSES.map(c => `rgb(${c.rgb.join(',')})`), borderColor: '#334155', borderWidth: 1 }] }}
              options={axes(t('profundidad (m)', 'depth (m)'), 'ha', locale)}
            />
          </div>
        </figure>
      )}
    </section>
  )
}
