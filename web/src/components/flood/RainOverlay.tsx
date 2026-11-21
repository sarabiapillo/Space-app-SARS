import { useEffect, useRef } from 'react'
import { CloudRain } from 'lucide-react'
import { rainEffect } from '../../utils/floodDg2'
import { useTranslation } from '../../i18n/useTranslation'
import { usePrefersReducedMotion } from './useFloodPlayback'

interface Props {
  /** Gross rain intensity (mm/h) at the simulated time shown; nothing is drawn when it is 0 or null. */
  mmPerHour: number | null
}

type Drop = { x: number; y: number; length: number; velocity: number }

/** Falling-rain streaks on a canvas covering the map container; strength from rainEffect(mmPerHour). */
function RainCanvas({ drops, speed }: { drops: number; speed: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const target = useRef({ drops, speed })
  useEffect(() => { target.current = { drops, speed } }, [drops, speed])
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let width = 0, height = 0, frame = 0, last = performance.now()
    const particles: Drop[] = []
    const spawn = (anywhere: boolean): Drop => ({
      x: Math.random() * (width + 40) - 20, y: anywhere ? Math.random() * height : -20 - Math.random() * 40,
      length: 8 + Math.random() * 10, velocity: .55 + Math.random() * .45,
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
      const { drops: wanted, speed: factor } = target.current
      while (particles.length < wanted) particles.push(spawn(true))
      particles.length = Math.min(particles.length, wanted)
      context.clearRect(0, 0, width, height)
      context.strokeStyle = 'rgba(191, 219, 254, 0.85)'
      context.lineWidth = 1.3
      context.lineCap = 'round'
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
      context.stroke()
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer?.disconnect() }
  }, [])
  return <canvas ref={canvas} className="ws-flood-rain__canvas" data-drops={drops} />
}

/**
 * Rain on the map while the animation shows a time inside a rain interval. Purely illustrative: the number and speed of
 * the drops follow the gross intensity, not a radar picture. With reduced motion only a static badge is shown.
 */
export function RainOverlay({ mmPerHour }: Props) {
  const { t, locale } = useTranslation()
  const reduced = usePrefersReducedMotion()
  const effect = rainEffect(mmPerHour)
  if (!effect || mmPerHour == null) return null
  const value = mmPerHour.toLocaleString(locale, { maximumFractionDigits: 1 })
  return (
    <div className={`ws-flood-rain ${reduced ? 'is-static' : ''}`} aria-hidden={reduced ? undefined : true}>
      {!reduced && <RainCanvas drops={effect.drops} speed={effect.speed} />}
      <span className="ws-flood-rain__badge" role="status">
        <CloudRain size={12} aria-hidden="true" />{t(`Lloviendo ${value} mm/h`, `Raining ${value} mm/h`)}
      </span>
    </div>
  )
}
