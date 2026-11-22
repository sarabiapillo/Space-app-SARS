import { useEffect, useRef } from 'react'
import { CloudRain } from 'lucide-react'
import { rainAreaBox, rainBadgePosition, rainBadgeText, rainDrops, rainEffect } from '../../utils/floodDg2'
import { useTranslation } from '../../i18n/useTranslation'
import { usePrefersReducedMotion } from './useFloodPlayback'

interface Props {
  /** Gross rain intensity (mm/h) at the simulated time shown; nothing is drawn when it is 0 or null. */
  mmPerHour: number | null
  /** Gross rain (mm) fallen so far and in the whole storm, for the badge; omitted from it when unknown. */
  soFarMm?: number | null
  totalMm?: number | null
  /** Corners of the simulated domain projected on the map (px); the tint and the drops stay inside them. Without them
   * the rain covers the whole map. */
  area?: ReadonlyArray<readonly [number, number]> | null
  /** Width and height of the map (px), to clamp the rained box to what is on screen. */
  mapSize?: readonly [number, number]
  /** Overrides the system reduced-motion preference (tests); by default the preference is read. */
  reducedMotion?: boolean
}

type Drop = { x: number; y: number; length: number; velocity: number }

/** Falling-rain streaks on a canvas filling its box; `density` drops per 10 000 px² of the box (rainDrops). */
function RainCanvas({ density, speed }: { density: number; speed: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const target = useRef({ density, speed })
  useEffect(() => { target.current = { density, speed } }, [density, speed])
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let width = 0, height = 0, frame = 0, last = performance.now()
    const particles: Drop[] = []
    const spawn = (anywhere: boolean): Drop => ({
      x: Math.random() * (width + 40) - 20, y: anywhere ? Math.random() * height : -20 - Math.random() * 40,
      length: 10 + Math.random() * 12, velocity: .55 + Math.random() * .45,
    })
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      width = element.clientWidth; height = element.clientHeight
      element.width = Math.max(1, Math.round(width * ratio)); element.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(element); resize()
    const draw = (now: number) => {
      const dt = Math.min(64, now - last) / 16.7; last = now
      const { density: perArea, speed: factor } = target.current
      const wanted = rainDrops(perArea, width, height)
      while (particles.length < wanted) particles.push(spawn(true))
      particles.length = Math.min(particles.length, wanted)
      context.clearRect(0, 0, width, height)
      context.beginPath()
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        // Slanted streaks: wind drift of a quarter of the fall.
        const step = 14 * factor * p.velocity * dt
        p.y += step; p.x += step * .25
        if (p.y > height + 20 || p.x > width + 20) particles[i] = spawn(false)
        context.moveTo(p.x, p.y)
        context.lineTo(p.x - p.length * .25, p.y - p.length)
      }
      context.lineCap = 'round'
      // Dark halo under a light core: the streaks read on dark vegetation and on bright roofs alike.
      context.strokeStyle = 'rgba(8, 47, 73, 0.45)'
      context.lineWidth = 3
      context.stroke()
      context.strokeStyle = 'rgba(224, 242, 254, 0.95)'
      context.lineWidth = 1.5
      context.stroke()
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer?.disconnect() }
  }, [])
  return <canvas ref={canvas} className="ws-flood-rain__canvas" data-density={density} />
}

/**
 * Rain on the map while the animation shows a time inside a rain interval: a translucent rain-curtain tint and falling
 * drops over the simulated domain, and a badge above it with the gross intensity and the rain fallen so far. Purely
 * illustrative: the tint, the number and the speed of the drops follow the gross intensity, not a radar picture. With
 * reduced motion there are no drops; the tint and the badge stay.
 */
export function RainOverlay({ mmPerHour, soFarMm, totalMm, area, mapSize, reducedMotion }: Props) {
  const { t, locale } = useTranslation()
  const prefersReduced = usePrefersReducedMotion()
  const reduced = reducedMotion ?? prefersReduced
  const effect = rainEffect(mmPerHour)
  if (!effect || mmPerHour == null) return null
  const box = rainAreaBox(area, mapSize?.[0] ?? Infinity, mapSize?.[1] ?? Infinity)
  // The badge labels the rained domain (above it), so a side panel over the map centre does not hide it.
  const badge = rainBadgePosition(box, mapSize?.[0] ?? Infinity)
  const style = box && box !== 'offscreen'
    ? { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, clipPath: box.clipPath }
    : undefined
  return (
    <div className={`ws-flood-rain ${reduced ? 'is-static' : ''}`} aria-hidden={reduced ? undefined : true}>
      {box !== 'offscreen' && (
        <div className="ws-flood-rain__area" style={style} data-area={box ? 'domain' : 'map'}>
          <div className="ws-flood-rain__tint" style={{ opacity: effect.tint }} />
          {!reduced && <RainCanvas density={effect.density} speed={effect.speed} />}
        </div>
      )}
      <span className={`ws-flood-rain__badge ${badge ? 'is-anchored' : ''}`} role="status" style={badge ? { left: `${badge.left}px`, top: `${badge.top}px` } : undefined}>
        <CloudRain size={13} aria-hidden="true" />{rainBadgeText({ mmPerHour, soFarMm, totalMm }, t, locale)}
      </span>
    </div>
  )
}
