import type { ReactNode } from 'react'
import type { FloodRoiResult } from '../../api/client'
import { dg2Summary, solverLabel } from '../../utils/floodDg2'
import { useTranslation } from '../../i18n/useTranslation'

interface Props {
  result: FloodRoiResult
  /** Selected frame; null or undefined summarises the maximum. */
  frameIndex: number | null | undefined
}

function Card({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="ws-rain-result-box">
      <span className="ws-rain-result-box__label">{label}</span>
      <strong className="ws-rain-result-box__val">{value}</strong>
      {sub && <span className="ws-rain-result-box__sub">{sub}</span>}
    </div>
  )
}

/** Headline cards of the selected DG2 frame (or the maximum) shown before the charts. */
export function FloodResultSummary({ result, frameIndex }: Props) {
  const { t, locale } = useTranslation()
  const s = dg2Summary(result, frameIndex)
  const fmt = (v: number | null | undefined, digits = 2) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(locale, { maximumFractionDigits: digits })
  const atMaximum = frameIndex == null
  const thresholds = result.roads?.thresholds_m
  const fallback = result.solver_fallback
  return (
    <div className="ws-rain-results-grid" role="group" aria-label={t('Resumen de resultados', 'Results summary')}>
      <Card label={t('Método de cálculo', 'Computation method')} value={solverLabel(result.solver ?? 'dg2')}
        sub={fallback ? t(`cambio automático desde ${solverLabel(fallback.from)}`, `automatic switch from ${solverLabel(fallback.from)}`) : t('el elegido', 'the one chosen')} />
      <Card label={t('Área inundada (≥ 0.03 m)', 'Flooded area (≥ 0.03 m)')} value={`${fmt(s.floodedHa)} ha`}
        sub={s.floodedPct == null ? undefined : t(`${fmt(s.floodedPct, 1)} % de las celdas con dato`, `${fmt(s.floodedPct, 1)} % of cells with data`)} />
      <Card label={t('Profundidad máxima', 'Maximum depth')} value={`${fmt(s.maxDepthM)} m`}
        sub={atMaximum ? t('en toda la corrida', 'over the whole run') : t('en el cuadro elegido', 'in the chosen frame')} />
      <Card label={t('Agua en el dominio al final', 'Water in the domain at the end')} value={`${fmt(s.domainM3, 0)} m³`}
        sub={s.rainM3 == null ? undefined : t(`de ${fmt(s.rainM3, 0)} m³ de lluvia acumulada`, `of ${fmt(s.rainM3, 0)} m³ of cumulative rain`)} />
      {result.froude && (
        <Card label={t('Froude máximo (h ≥ 0.15 m)', 'Maximum Froude (h ≥ 0.15 m)')}
          value={s.froude ? fmt(s.froude.max) : '—'}
          sub={atMaximum ? t('Disponible por cuadro: elige un instante.', 'Available per frame: choose an instant.')
            : s.froude ? t(`${s.froude.supercritical} de ${s.froude.cells} celdas supercríticas (Fr > 1)`, `${s.froude.supercritical} of ${s.froude.cells} cells supercritical (Fr > 1)`)
              : t('sin agua suficiente', 'not enough water')} />
      )}
      {s.tcMin != null && (
        <Card label={t('Tiempo de concentración', 'Time of concentration')} value={`${fmt(s.tcMin, 1)} min`} sub="Kirpich" />
      )}
      {s.roads && (
        <Card label={t('Caminos cortados', 'Roads cut')}
          value={s.roads === 'unavailable' ? t('No disponible', 'Not available') : `${fmt(s.roads.cutKm)} km`}
          sub={s.roads === 'unavailable' ? 'OpenStreetMap'
            : t(`≥ ${thresholds?.cut ?? '—'} m de agua · de ${fmt(s.roads.totalKm)} km (OpenStreetMap)`, `≥ ${thresholds?.cut ?? '—'} m of water · of ${fmt(s.roads.totalKm)} km (OpenStreetMap)`)} />
      )}
    </div>
  )
}
