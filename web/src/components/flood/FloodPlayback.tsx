import { Loader2, Pause, Play, Repeat, SkipBack } from 'lucide-react'
import { PLAYBACK_BASE_FPS, PLAYBACK_SPEEDS, simulatedTimeLabel } from '../../utils/floodDg2'
import { useTranslation } from '../../i18n/useTranslation'
import type { FloodPlayback } from './useFloodPlayback'

interface ControlsProps {
  playback: FloodPlayback
  /** Shows the maximum depth of the run (the separate, non-animated view). */
  onShowMaximum: () => void
}

/** Play/pause, time slider labelled with the simulated time, speed, loop and the rain toggle. */
export function FloodPlaybackControls({ playback, onShowMaximum }: ControlsProps) {
  const { t } = useTranslation()
  if (!playback.available) {
    return <p className="ws-rain-help">{playback.total < 2
      ? t('Esta corrida tiene menos de dos cuadros: no hay animación.', 'This run has fewer than two frames: there is no animation.')
      : t('Dominio demasiado grande para animar en el navegador; usa el selector de cuadro.', 'Domain too large to animate in the browser; use the frame selector.')}</p>
  }
  const frames = playback.frames
  const count = frames?.length ?? playback.total
  const shown = playback.current
  const end = frames?.at(-1)?.scheduledTimeS ?? null
  const time = shown ? simulatedTimeLabel(shown.scheduledTimeS) : simulatedTimeLabel(frames?.[0]?.scheduledTimeS ?? 0)
  const loading = playback.status === 'loading'
  const rain = playback.rainMmH
  return (
    <div className="ws-flood-playback" role="group" aria-label={t('Animación de la corrida', 'Run animation')}>
      <div className="ws-flood-playback__row">
        <button type="button" className="ws-rain-action-btn ws-flood-playback__play" disabled={loading}
          onClick={() => playback.playing ? playback.pause() : playback.play()}
          aria-label={playback.playing ? t('Pausar animación', 'Pause animation') : t('Reproducir animación', 'Play animation')}>
          {loading ? <Loader2 size={13} className="spin" aria-hidden="true" /> : playback.playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {loading ? t(`Cargando cuadros ${playback.progress}/${playback.total}…`, `Loading frames ${playback.progress}/${playback.total}…`)
            : playback.playing ? t('Pausar', 'Pause') : t('Reproducir', 'Play')}
        </button>
        <span className="ws-flood-playback__time" aria-live="off">
          <strong>{time}</strong>{end != null && <> / {simulatedTimeLabel(end)}</>}
        </span>
      </div>
      <input type="range" className="ws-flood-playback__slider" min={0} max={Math.max(0, count - 1)} step={1}
        value={playback.active ? playback.index : 0} disabled={!frames}
        onChange={e => playback.seek(Number(e.target.value))}
        aria-label={t('Tiempo simulado', 'Simulated time')}
        aria-valuetext={t(`${time}, cuadro ${(playback.active ? playback.index : 0) + 1} de ${count}`, `${time}, frame ${(playback.active ? playback.index : 0) + 1} of ${count}`)} />
      <div className="ws-flood-playback__row ws-flood-playback__options">
        <span className="ws-flood-playback__speed" role="group" aria-label={t('Velocidad', 'Speed')}>
          <span aria-hidden="true">{t('Velocidad', 'Speed')}</span>
          {PLAYBACK_SPEEDS.map(v => <button key={v} type="button" className={`ws-rain-chip ${playback.speed === v ? 'is-active' : ''}`} aria-pressed={playback.speed === v} onClick={() => playback.setSpeed(v)}>{`${v}×`}</button>)}
        </span>
        <label className="ws-rain-check"><input type="checkbox" checked={playback.loop} onChange={e => playback.setLoop(e.target.checked)} /><span><Repeat size={11} aria-hidden="true" /> {t('Repetir', 'Loop')}</span></label>
        <label className="ws-rain-check"><input type="checkbox" checked={playback.showRain} onChange={e => playback.setShowRain(e.target.checked)} /><span>{t('Mostrar lluvia', 'Show rain')}</span></label>
        <button type="button" className="ws-rain-secondary-btn" onClick={() => { playback.stop(); onShowMaximum() }}><SkipBack size={12} aria-hidden="true" />{t('Ver máximo', 'Show maximum')}</button>
      </div>
      {playback.active && rain != null && <p className="ws-rain-help ws-flood-playback__rain" role="status">
        {rain > 0 ? t(`Lluvia bruta en este instante: ${Math.round(rain * 10) / 10} mm/h`, `Gross rain at this instant: ${Math.round(rain * 10) / 10} mm/h`)
          : t('Sin lluvia en este instante', 'No rain at this instant')}
      </p>}
      {playback.error && <p role="alert" className="ws-rain-error"><span>{t('No se pudieron cargar los cuadros:', 'The frames could not be loaded:')} {playback.error}</span></p>}
      <small className="ws-rain-field__hint">{t(
        `1× = ${PLAYBACK_BASE_FPS} cuadros por segundo; cada cuadro es el tiempo programado de guardado, no un tiempo observado. Entre cuadros la imagen se funde, no se interpola el agua.${playback.reducedMotion ? ' Movimiento reducido: sin fundidos ni gotas animadas.' : ''}`,
        `1× = ${PLAYBACK_BASE_FPS} frames per second; each frame is the scheduled save time, not an observed time. Between frames the image cross-fades, the water is not interpolated.${playback.reducedMotion ? ' Reduced motion: no fades or animated drops.' : ''}`)}</small>
    </div>
  )
}
