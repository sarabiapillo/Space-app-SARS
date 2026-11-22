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
  type Chart,
  type ChartOptions,
  type Plugin,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import type { FloodRoiResult } from '../api/client'
import { chartCursor, hyetographCaption, dg2ChartData, WATER_BUDGET_COLORS as BUDGET_COLORS } from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

interface Props {
  result: FloodRoiResult
  /** Selected frame for the depth distribution; null or undefined selects the maximum. */
  frameIndex: number | null | undefined
  /** Simulated time (s) shown by the animation: a vertical cursor on the time charts; none when null. */
  cursorS?: number | null
}

const RAIN = '#64748B'
const AREA = '#0284C7'
const DEPTH = '#1E3A8A'
const RAIN_TOTAL = '#94A3B8'
const RAIN_GROSS = '#CBD5E1'
const CURSOR = '#0F172A'

type CursorAt = { index: number } | { fraction: number } | null
declare module 'chart.js' {
  interface PluginOptionsByType<TType extends import('chart.js').ChartType> {
    timeCursor?: { at: CursorAt; _type?: TType }
  }
}

/** Vertical line at the animation time: a category index (frames, mass-balance rows) or a fraction of the x span. */
const timeCursor: Plugin = {
  id: 'timeCursor',
  afterDatasetsDraw(chart: Chart, _args, options: { at?: CursorAt }) {
    const at = options?.at, x = chart.scales.x, area = chart.chartArea
    if (!at || !x || !area) return
    const px = 'index' in at ? x.getPixelForValue(at.index) : area.left + at.fraction * (area.right - area.left)
    if (!Number.isFinite(px) || px < area.left - 1 || px > area.right + 1) return
    const ctx = chart.ctx
    ctx.save()
    ctx.strokeStyle = CURSOR
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 2])
    ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke()
    ctx.restore()
  },
}
const cursorPlugins = [timeCursor]

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
export function FloodDg2Charts({ result, frameIndex, cursorS }: Props) {
  const { t, locale } = useTranslation()
  const data = useMemo(() => dg2ChartData(result, frameIndex), [result, frameIndex])
  const cursor = useMemo(() => chartCursor(result, cursorS), [result, cursorS])
  const at = (value: number | null, kind: 'index' | 'fraction'): { at: CursorAt } => ({ at: value == null ? null : kind === 'index' ? { index: value } : { fraction: value } })
  const minutes = t('tiempo programado (min)', 'scheduled time (min)')
  if (!data.hyetograph && !data.evolution && !data.volume && !data.distribution) {
    return <p className="flood-charts__empty">{t('Esta corrida es anterior a las gráficas DG2.', 'This run predates the DG2 charts.')}</p>
  }
  return (
    <section className="flood-charts" aria-label={t('Gráficas de la simulación DG2', 'DG2 simulation charts')}>
      <p className="flood-charts__source">{t('Solución numérica con lluvia hipotética (sintética o de diseño); no son observaciones.', 'Numerical solution with hypothetical rainfall (synthetic or design); not observations.')}</p>

      {data.hyetograph && (
        <figure className="flood-charts__fig">
          <figcaption>{data.hyetographGross
            ? t('Hietograma: lluvia bruta y lluvia neta que recibe el solver, media de la ROI (mm/h)', 'Hyetograph: gross rain and the net rain the solver receives, ROI mean (mm/h)')
            : hyetographCaption(result, t)}</figcaption>
          <div className="flood-charts__canvas">
            <Bar
              plugins={cursorPlugins}
              data={{
                labels: data.hyetograph.labels,
                datasets: data.hyetographGross
                  ? [{ label: t('Lluvia bruta', 'Gross rain'), data: data.hyetographGross, backgroundColor: RAIN_GROSS },
                    { label: t('Lluvia neta (solver)', 'Net rain (solver)'), data: data.hyetograph.mmPerHour, backgroundColor: RAIN }]
                  : [{ data: data.hyetograph.mmPerHour, backgroundColor: RAIN }],
              }}
              options={{
                ...axes(t('intervalo (min)', 'interval (min)'), 'mm/h', locale),
                plugins: { legend: { display: Boolean(data.hyetographGross), labels: { boxWidth: 10, font: { size: 9 } } }, timeCursor: at(cursor.hyetographFraction, 'fraction') },
              }}
            />
          </div>
        </figure>
      )}

      {data.evolution && (
        <figure className="flood-charts__fig">
          <figcaption>{data.evolution.sheetAreaHa
            ? t('Área inundada (≥ 0.03 m), área con láminas (< 0.03 m) y profundidad máxima', 'Flooded area (≥ 0.03 m), area with sheets (< 0.03 m) and maximum depth')
            : t('Área inundada (≥ 0.03 m) y profundidad máxima', 'Flooded area (≥ 0.03 m) and maximum depth')}</figcaption>
          <div className="flood-charts__canvas">
            <Line
              plugins={cursorPlugins}
              data={{
                labels: data.evolution.minutes.map(m => round(m)),
                datasets: [
                  { label: t('Área inundada (ha)', 'Flooded area (ha)'), data: data.evolution.wetAreaHa, borderColor: AREA, backgroundColor: AREA, yAxisID: 'y' },
                  ...(data.evolution.sheetAreaHa ? [{ label: t('Láminas < 0.03 m (ha)', 'Sheets < 0.03 m (ha)'), data: data.evolution.sheetAreaHa, borderColor: BUDGET_COLORS.sheet, backgroundColor: BUDGET_COLORS.sheet, yAxisID: 'y' }] : []),
                  { label: t('Profundidad máxima (m)', 'Maximum depth (m)'), data: data.evolution.maxDepthM, borderColor: DEPTH, backgroundColor: DEPTH, borderDash: [4, 3], yAxisID: 'y1' },
                ],
              }}
              options={{
                ...axes(minutes, 'ha', locale),
                plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 9 } } }, timeCursor: at(cursor.frameIndex, 'index') },
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
              plugins={cursorPlugins}
              data={{
                labels: data.volume.minutes.map(m => round(m)),
                datasets: [
                  { label: t('Lluvia acumulada', 'Cumulative rain'), data: data.volume.rainM3, borderColor: RAIN_TOTAL, backgroundColor: RAIN_TOTAL, borderDash: [4, 3] },
                  { label: t('Agua en el dominio', 'Water in the domain'), data: data.volume.domainM3, borderColor: AREA, backgroundColor: AREA },
                ],
              }}
              options={{ ...axes(minutes, 'm³', locale), plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 9 } } }, timeCursor: at(cursor.volumeIndex, 'index') } }}
            />
          </div>
          <small>{t('La diferencia es el agua que salió por las fronteras (balance de masa del solver).', 'The gap is water that left through the boundaries (solver mass balance).')}</small>
        </figure>
      )}

      {data.frameVolumes && (
        <figure className="flood-charts__fig">
          <figcaption>{t('Agua en el dominio por tipo en cada cuadro (m³)', 'Water in the domain by kind in each frame (m³)')}</figcaption>
          <div className="flood-charts__canvas">
            <Bar
              plugins={cursorPlugins}
              data={{
                labels: data.frameVolumes.minutes.map(m => round(m)),
                datasets: [
                  { label: t('Láminas < 0.03 m', 'Sheets < 0.03 m'), data: data.frameVolumes.sheetM3, backgroundColor: BUDGET_COLORS.sheet, borderColor: '#f0f9ff', borderWidth: 1 },
                  { label: t('Encharcada ≥ 0.03 m', 'Ponded ≥ 0.03 m'), data: data.frameVolumes.pondedM3, backgroundColor: BUDGET_COLORS.ponded, borderColor: '#f0f9ff', borderWidth: 1 },
                ],
              }}
              options={{
                ...axes(minutes, 'm³', locale),
                plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 9 } } }, timeCursor: at(cursor.frameIndex, 'index') },
                scales: { x: { ...axes(minutes, 'm³', locale).scales!.x, stacked: true }, y: { ...axes(minutes, 'm³', locale).scales!.y, stacked: true } },
              }}
            />
          </div>
          <small>{t('Láminas: agua de menos de 3 cm que escurre sobre las laderas; encharcada: 3 cm o más (la misma frontera del área inundada).', 'Sheets: water thinner than 3 cm running over the slopes; ponded: 3 cm or more (the same threshold as the flooded area).')}</small>
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
              data={{ labels: data.distribution.labels, datasets: [{ data: data.distribution.areaHa, backgroundColor: data.distribution.colors, borderColor: '#334155', borderWidth: 1 }] }}
              options={axes(t('profundidad (m)', 'depth (m)'), 'ha', locale)}
            />
          </div>
          {data.distribution.labels[0]?.startsWith('0.0005') && <small>{t('0.0005–0.002 m es la superficie mojada: la película de agua que deja la lluvia en casi toda la zona. Las clases hasta 0.03 m son láminas; desde 0.03 m, agua encharcada.',
            '0.0005–0.002 m is the wet surface: the film of water the rain leaves over most of the area. Classes up to 0.03 m are sheets; from 0.03 m, ponded water.')}</small>}
        </figure>
      )}
    </section>
  )
}
