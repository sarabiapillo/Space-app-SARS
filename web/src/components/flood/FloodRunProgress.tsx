import type { FloodRoiRun } from '../../api/client'
import { runProgressView, solverLabel } from '../../utils/floodDg2'
import { useTranslation } from '../../i18n/useTranslation'

/** Progress of a run in progress: simulated time reached of the total (a real bar), frames ready, the solver and a
 * note when the fallback solver restarted from zero. Without progress (preparing, older servers) an indeterminate bar. */
interface Props {
  run: FloodRoiRun
  /** Rain effect on the map (shared with the playback toggle); the checkbox appears once frames are shown. */
  showRain?: boolean
  onShowRainChange?: (show: boolean) => void
}

export function FloodRunProgress({ run, showRain, onShowRainChange }: Props) {
  const { t, locale } = useTranslation()
  const view = runProgressView(run)
  if (!view) return <div className="ws-rain-progressbar" role="progressbar" aria-label={t('Corrida en curso', 'Run in progress')}><span /></div>
  const pct = view.pct.toLocaleString(locale, { maximumFractionDigits: 1 })
  const rain = view.rainMmH != null && view.rainMmH > 0 ? Math.round(view.rainMmH * 10) / 10 : null
  return (
    <div className="ws-flood-progress">
      <div className="ws-rain-progressbar is-determinate" role="progressbar" aria-label={t('Tiempo simulado de la corrida', 'Simulated time of the run')}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.pct} aria-valuetext={`${view.simulated} / ${view.total}`}>
        <span style={{ width: `${view.pct}%` }} />
      </div>
      <p className="ws-rain-help ws-flood-progress__text">{t(
        `Tiempo simulado ${view.simulated} de ${view.total} (${pct} %) · ${solverLabel(view.solver)} · ${view.frames} ${view.frames === 1 ? 'cuadro listo' : 'cuadros listos'} en el mapa`,
        `Simulated time ${view.simulated} of ${view.total} (${pct} %) · ${solverLabel(view.solver)} · ${view.frames} ${view.frames === 1 ? 'frame' : 'frames'} ready on the map`)}
        {rain != null && t(` · lluvia bruta ${rain} mm/h`, ` · gross rain ${rain} mm/h`)}</p>
      {onShowRainChange && view.frames > 0 && <label className="ws-rain-check"><input type="checkbox" checked={showRain ?? true} onChange={e => onShowRainChange(e.target.checked)} /><span>{t('Mostrar lluvia', 'Show rain')}</span></label>}
      {view.restartedFrom && <p className="ws-rain-help ws-rain-warn" role="status">{t(
        `${solverLabel(view.restartedFrom)} falló; el cálculo se reinició desde el principio con ${solverLabel(view.solver)}.`,
        `${solverLabel(view.restartedFrom)} failed; the computation restarted from the beginning with ${solverLabel(view.solver)}.`)}</p>}
    </div>
  )
}
