import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FloodRoiResult } from '../../api/client'
import {
  animationAvailable, animationFrames, flowArrowFeatures, playbackFadeMs, playbackIntervalMs, playbackStep, preloadFramePreviews,
  rainAccumulatedAt, rainIntensityAt, type AnimationFrame, type FloodMapAnimation, type PlaybackState,
} from '../../utils/floodDg2'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
function subscribeMotion(change: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}
const readMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCED_MOTION).matches)

/** True while the system asks for reduced motion (false on the server). */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeMotion, readMotion, () => false)
}

type Preview = (id: string, name: string, signal: AbortSignal) => Promise<{blob: Blob; bounds: [number, number, number, number]}>
type Status = 'idle' | 'loading' | 'ready' | 'error'

interface Options {
  runId: string | undefined
  result: FloodRoiResult | undefined
  preview: Preview
}

/**
 * Playback of the frames of one run: preloads every frame preview once (on the first play), then steps through them
 * with a timer. Object URLs are revoked when the run changes, the panel unmounts or the preload is cancelled.
 */
export function useFloodPlayback({ runId, result, preview }: Options) {
  const reducedMotion = usePrefersReducedMotion()
  const [status, setStatus] = useState<Status>('idle')
  const [frames, setFrames] = useState<AnimationFrame[] | null>(null)
  const [progress, setProgress] = useState(0)
  const [state, setState] = useState<PlaybackState>({ index: 0, playing: false, loop: false })
  const [speed, setSpeed] = useState(1)
  const [showRain, setShowRain] = useState(true)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const loaded = useRef<AnimationFrame[] | null>(null)
  const artifacts = useMemo(() => (result ? animationFrames(result) : []), [result])
  const available = Boolean(result && animationAvailable(result))

  const release = useCallback(() => {
    abort.current?.abort(); abort.current = null
    for (const frame of loaded.current ?? []) URL.revokeObjectURL(frame.url)
    loaded.current = null
  }, [])

  // A new run (or none) starts from scratch; unmounting releases every preview and clears the map.
  useEffect(() => {
    return () => {
      release()
      setFrames(null); setStatus('idle'); setProgress(0); setActive(false); setError(null)
      setState(s => ({ ...s, index: 0, playing: false }))
    }
  }, [runId, result, release])

  const load = useCallback(async (startAt: number) => {
    if (!runId || !available || status === 'loading') return
    if (loaded.current) { setActive(true); setState(s => ({ ...s, index: startAt, playing: true })); return }
    const controller = new AbortController(); abort.current = controller
    setStatus('loading'); setProgress(0); setError(null)
    try {
      const found = await preloadFramePreviews(preview, runId, artifacts, { signal: controller.signal, onProgress: setProgress })
      if (controller.signal.aborted) return
      loaded.current = found
      setFrames(found); setStatus('ready'); setActive(true)
      setState(s => ({ ...s, index: Math.min(startAt, found.length - 1), playing: true }))
    } catch (e) {
      if (controller.signal.aborted) return
      setStatus('error'); setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }, [runId, available, status, preview, artifacts])

  // Timer: one frame per interval while playing.
  useEffect(() => {
    if (!active || !state.playing || !frames) return
    const count = frames.length
    const timer = setInterval(() => setState(s => playbackStep(s, count)), playbackIntervalMs(speed))
    return () => clearInterval(timer)
  }, [active, state.playing, frames, speed])

  const current = active && frames ? frames[Math.min(state.index, frames.length - 1)] : null
  const segments = result?.rainfall_gross_segments ?? result?.rainfall_segments
  const rainMmH = current ? rainIntensityAt(segments, current.scheduledTimeS ?? 0) : null
  // Gross rain fallen up to the frame shown and in the whole storm (null without a hyetograph).
  const fallen = current ? rainAccumulatedAt(segments, current.scheduledTimeS ?? 0) : null
  const rainSoFarMm = fallen?.mm ?? null, rainTotalMm = fallen?.totalMm ?? null
  const fadeMs = playbackFadeMs(speed, reducedMotion)

  // What the map draws (null while the animation is off): every frame once, the one shown, its arrows and the rain.
  const animation = useMemo<FloodMapAnimation | null>(() => (!current || !frames || !result ? null
    : { frames, index: frames.indexOf(current), fadeMs, flowArrows: flowArrowFeatures(result, current.frameIndex), rainMmH, rainSoFarMm, rainTotalMm, showRain }),
  [current, frames, result, fadeMs, rainMmH, rainSoFarMm, rainTotalMm, showRain])

  return {
    animation, available, status, progress, total: artifacts.length, frames, current, active, error, speed, showRain, reducedMotion, rainMmH, rainSoFarMm, rainTotalMm,
    index: state.index, playing: active && state.playing, loop: state.loop,
    /** Starts (preloading the first time) from the frame at `startAt`, or resumes. */
    play: (startAt = state.index) => { if (frames) { setActive(true); setState(s => ({ ...s, index: s.index >= frames.length - 1 && !s.loop ? 0 : s.index, playing: true })) } else void load(startAt) },
    pause: () => setState(s => ({ ...s, playing: false })),
    /** Shows frame `index` (position in the frame list) and pauses. */
    seek: (index: number) => { if (frames) { setActive(true); setState(s => ({ ...s, index: Math.max(0, Math.min(frames.length - 1, index)), playing: false })) } },
    setSpeed, setShowRain,
    setLoop: (loop: boolean) => setState(s => ({ ...s, loop })),
    /** Leaves the animation (the map goes back to the frame or maximum chosen in the selector). */
    stop: () => { abort.current?.abort(); setActive(false); setState(s => ({ ...s, playing: false })); if (status === 'loading') setStatus('idle') },
  }
}

export type FloodPlayback = ReturnType<typeof useFloodPlayback>

