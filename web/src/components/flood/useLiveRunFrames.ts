import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FloodRoiRun } from '../../api/client'
import { liveFrameToFetch, type AnimationFrame, type FloodMapAnimation } from '../../utils/floodDg2'
import { usePrefersReducedMotion } from './useFloodPlayback'

type LivePreview = (id: string, frameIndex: number, signal: AbortSignal) => Promise<{blob: Blob; bounds: [number, number, number, number]}>
const IN_PROGRESS = ['running', 'results']
/** Cross-fade (ms) when a new live frame arrives. */
export const LIVE_FADE_MS = 600

/**
 * Frames of a run in progress, as the solver writes them: on every status poll the newest complete frame not shown
 * yet is fetched from the live preview endpoint and becomes the frame on the map. A solver switch (new attempt) drops
 * the frames of the failed attempt; a successful run releases them (the full playback takes over); a failed run keeps
 * its last frame. Object URLs are revoked on run change and unmount.
 */
export function useLiveRunFrames({ run, preview, showRain }: { run: FloodRoiRun | undefined; preview: LivePreview; showRain: boolean }) {
  const reducedMotion = usePrefersReducedMotion()
  // Every fetched frame with the run and solver attempt it belongs to; only those of the current attempt are shown.
  const [fetchedFrames, setFetchedFrames] = useState<Array<{ runId: string; attempt: number | null; frame: AnimationFrame }>>([])
  const urls = useRef<string[]>([])
  const fetched = useRef<number[]>([])
  const attempt = useRef<number | null>(null)
  const pending = useRef<AbortController | null>(null)
  const runId = run?.id, state = run?.state, progress = run?.progress
  const latest = progress?.latest_frame_index ?? null, currentAttempt = progress?.attempt ?? null

  const releaseAll = useCallback(() => {
    pending.current?.abort(); pending.current = null
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current = []; fetched.current = []
  }, [])

  // A new run (or none) starts empty; unmounting releases every live preview.
  useEffect(() => () => { releaseAll(); attempt.current = null }, [runId, releaseAll])

  // Success: the full playback replaces the live frames, whose previews are released.
  useEffect(() => { if (state === 'succeeded') releaseAll() }, [state, releaseAll])

  useEffect(() => {
    if (!runId || !IN_PROGRESS.includes(state ?? '') || !progress) return
    if (attempt.current !== currentAttempt) {
      // First progress of the run, or the fallback solver restarted from zero: the failed attempt's frames go.
      if (attempt.current != null) releaseAll()
      attempt.current = currentAttempt
    }
    const index = liveFrameToFetch(progress, fetched.current)
    if (index == null || pending.current) return
    const controller = new AbortController(); pending.current = controller
    const time = progress.latest_frame_time_s, forAttempt = currentAttempt
    preview(runId, index, controller.signal).then(image => {
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(image.blob)
      urls.current.push(url); fetched.current.push(index)
      setFetchedFrames(list => [...list, { runId, attempt: forAttempt, frame: { name: `live-${index}`, frameIndex: index, scheduledTimeS: time, url, bounds: image.bounds } }])
    }).catch(() => {
      // A frame that cannot be shown is skipped; the next new frame is tried on a later poll.
    }).finally(() => { if (pending.current === controller) pending.current = null })
  }, [runId, state, progress, latest, currentAttempt, preview, releaseAll])

  const frames = useMemo(() => {
    if (state === 'succeeded') return []
    const own = fetchedFrames.filter(item => item.runId === runId)
    // After the run ends there is no progress: keep the frames of its last attempt (earlier ones were released).
    const shown = currentAttempt ?? Math.max(...own.map(item => item.attempt ?? 0))
    return own.filter(item => (item.attempt ?? 0) === (shown ?? 0)).map(item => item.frame)
  }, [fetchedFrames, runId, state, currentAttempt])
  const seen = fetchedFrames.some(item => item.runId === runId)
  const rainMmH = IN_PROGRESS.includes(state ?? '') ? progress?.rain_mm_h ?? null : null
  const animation = useMemo<FloodMapAnimation | null>(() => (frames.length
    ? { frames, index: frames.length - 1, fadeMs: reducedMotion ? 0 : LIVE_FADE_MS, flowArrows: null, rainMmH, showRain, live: true }
    : null), [frames, reducedMotion, rainMmH, showRain])
  return { animation, frames, seen, current: frames.at(-1) ?? null }
}
