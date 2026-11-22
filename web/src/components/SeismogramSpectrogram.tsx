/**
 * Sismograma a(t) y, debajo, su espectrograma (STFT, potencia en dB relativa al máximo), con el
 * mismo eje de tiempo. Dibujado en canvas: miles de muestras y una imagen tiempo–frecuencia, que
 * Chart.js no representa bien. Marca opcionalmente los arribos P y S y la ventana de alerta.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { computeSpectrogram, peakAbs } from '../utils/signal'
import { buildLut256 } from '../utils/colormapLut'
import { useTranslation } from '../i18n/useTranslation'

interface Props {
  accel_g: ArrayLike<number>
  sampleRateHz: number
  /** Tiempo de la primera muestra (s). 0 = origen de la ruptura en el sintético. */
  startSec?: number
  markers?: { tP: number; tS: number }
  color?: string
  /** Frecuencia máxima mostrada (se limita a Nyquist). */
  maxFreqHz?: number
  /** Rango dinámico del espectrograma (dB bajo el máximo). */
  dynamicRangeDb?: number
  /** Alturas (px) de la traza y del espectrograma. */
  traceHeight?: number
  specHeight?: number
  ariaLabel: string
}

const M = { left: 50, right: 56, top: 8, gap: 26, bottom: 30 }

function niceStep(span: number, maxTicks: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300]) if (span / s <= maxTicks) return s
  return 600
}

export function SeismogramSpectrogram({
  accel_g, sampleRateHz, startSec = 0, markers, color = '#dc2626', maxFreqHz = 15, dynamicRangeDb = 60,
  traceHeight = 120, specHeight = 130, ariaLabel,
}: Props) {
  const TRACE_H = traceHeight
  const SPEC_H = specHeight
  const HEIGHT = M.top + TRACE_H + M.gap + SPEC_H + M.bottom
  const { t } = useTranslation()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(600)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const spec = useMemo(() => computeSpectrogram(accel_g, sampleRateHz), [accel_g, sampleRateHz])
  const lut = useMemo(() => buildLut256('inferno'), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${HEIGHT}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)
    ctx.font = '9px ui-monospace, monospace'

    const n = accel_g.length
    const duration = (n - 1) / sampleRateHz
    const plotW = width - M.left - M.right
    const x = (tSec: number) => M.left + ((tSec - startSec) / duration) * plotW
    const traceTop = M.top
    const specTop = M.top + TRACE_H + M.gap

    // --- Ventana de alerta y arribos (ambos paneles) ---
    if (markers) {
      ctx.fillStyle = 'rgba(234, 88, 12, 0.10)'
      ctx.fillRect(x(markers.tP), traceTop, x(markers.tS) - x(markers.tP), TRACE_H)
    }

    // --- Traza: mínimo y máximo por columna de píxel (sin perder picos al reducir) ---
    const peak = peakAbs(accel_g) || 1
    const yMid = traceTop + TRACE_H / 2
    const yScale = (TRACE_H / 2 - 4) / peak
    ctx.strokeStyle = '#e2e8f0'
    ctx.beginPath(); ctx.moveTo(M.left, yMid); ctx.lineTo(M.left + plotW, yMid); ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let px = 0; px < plotW; px++) {
      const i0 = Math.floor((px / plotW) * (n - 1))
      const i1 = Math.max(i0 + 1, Math.floor(((px + 1) / plotW) * (n - 1)))
      let lo = Infinity, hi = -Infinity
      for (let i = i0; i <= Math.min(i1, n - 1); i++) { lo = Math.min(lo, accel_g[i]); hi = Math.max(hi, accel_g[i]) }
      ctx.moveTo(M.left + px + 0.5, yMid - hi * yScale)
      ctx.lineTo(M.left + px + 0.5, yMid - lo * yScale + 0.5)
    }
    ctx.stroke()
    ctx.strokeStyle = '#94a3b8'
    ctx.strokeRect(M.left, traceTop, plotW, TRACE_H)
    ctx.fillStyle = '#334155'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(`+${peak.toFixed(3)}`, M.left - 3, traceTop + 4)
    ctx.fillText('0', M.left - 3, yMid)
    ctx.fillText(`−${peak.toFixed(3)}`, M.left - 3, traceTop + TRACE_H - 4)
    ctx.save()
    ctx.translate(10, traceTop + TRACE_H / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText(t('a(t) [g]', 'a(t) [g]'), 0, 0)
    ctx.restore()

    // --- Espectrograma ---
    const fMax = Math.min(maxFreqHz, sampleRateHz / 2)
    const kMax = Math.max(2, spec.freqs.findIndex((f) => f > fMax) === -1 ? spec.bins : spec.freqs.findIndex((f) => f > fMax))
    const off = document.createElement('canvas')
    off.width = spec.frames
    off.height = kMax
    const octx = off.getContext('2d')
    if (octx) {
      const img = octx.createImageData(spec.frames, kMax)
      const floor = spec.maxDb - dynamicRangeDb
      for (let f = 0; f < spec.frames; f++) {
        for (let k = 0; k < kMax; k++) {
          const v = Math.max(0, Math.min(1, (spec.powerDb[f * spec.bins + k] - floor) / dynamicRangeDb))
          const c = Math.round(v * 255) * 3
          const p = ((kMax - 1 - k) * spec.frames + f) * 4
          img.data[p] = lut[c]; img.data[p + 1] = lut[c + 1]; img.data[p + 2] = lut[c + 2]; img.data[p + 3] = 255
        }
      }
      octx.putImageData(img, 0, 0)
      const hop = spec.frames > 1 ? spec.times[1] - spec.times[0] : spec.nfft / sampleRateHz
      const x0 = x(startSec + spec.times[0] - hop / 2)
      const x1 = x(startSec + spec.times[spec.frames - 1] + hop / 2)
      ctx.fillStyle = `rgb(${lut[0]}, ${lut[1]}, ${lut[2]})`
      ctx.fillRect(M.left, specTop, plotW, SPEC_H)
      ctx.save()
      ctx.beginPath(); ctx.rect(M.left, specTop, plotW, SPEC_H); ctx.clip()
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, x0, specTop, x1 - x0, SPEC_H)
      ctx.restore()
    }
    ctx.strokeStyle = '#94a3b8'
    ctx.strokeRect(M.left, specTop, plotW, SPEC_H)
    const fStep = niceStep(fMax, 6)
    ctx.fillStyle = '#334155'
    ctx.textAlign = 'right'
    for (let f = 0; f <= fMax + 1e-9; f += fStep) {
      const yy = specTop + SPEC_H - (f / fMax) * SPEC_H
      ctx.fillText(`${f}`, M.left - 3, yy)
    }
    ctx.save()
    ctx.translate(10, specTop + SPEC_H / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText(t('Frecuencia [Hz]', 'Frequency [Hz]'), 0, 0)
    ctx.restore()

    // Barra de color del espectrograma
    const cbX = M.left + plotW + 6
    for (let i = 0; i < SPEC_H; i++) {
      const c = Math.round((1 - i / (SPEC_H - 1)) * 255) * 3
      ctx.fillStyle = `rgb(${lut[c]}, ${lut[c + 1]}, ${lut[c + 2]})`
      ctx.fillRect(cbX, specTop + i, 8, 1)
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#334155'
    ctx.fillText('0 dB', cbX + 11, specTop + 5)
    ctx.fillText(`−${dynamicRangeDb} dB`, cbX + 11, specTop + SPEC_H - 5)

    // --- Marcadores P y S sobre ambos paneles ---
    if (markers) {
      for (const [tt, col, label] of [[markers.tP, '#2563eb', 'P'], [markers.tS, '#dc2626', 'S']] as const) {
        const xx = x(tt)
        ctx.strokeStyle = col
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(xx, traceTop); ctx.lineTo(xx, traceTop + TRACE_H)
        ctx.moveTo(xx, specTop); ctx.lineTo(xx, specTop + SPEC_H)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = col
        ctx.textAlign = 'center'
        ctx.fillText(label, xx, traceTop + TRACE_H + 8)
      }
    }

    // --- Eje de tiempo común ---
    const step = niceStep(duration, 8)
    ctx.fillStyle = '#334155'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let tt = Math.ceil(startSec / step) * step; tt <= startSec + duration + 1e-9; tt += step) {
      const xx = x(tt)
      ctx.strokeStyle = '#94a3b8'
      ctx.beginPath(); ctx.moveTo(xx, specTop + SPEC_H); ctx.lineTo(xx, specTop + SPEC_H + 3); ctx.stroke()
      ctx.fillText(`${tt}`, xx, specTop + SPEC_H + 5)
    }
    ctx.fillText(t('Tiempo [s]', 'Time [s]'), M.left + plotW / 2, specTop + SPEC_H + 17)
  }, [width, accel_g, sampleRateHz, startSec, markers, color, maxFreqHz, dynamicRangeDb, spec, lut, t, TRACE_H, SPEC_H, HEIGHT])

  return (
    <div ref={wrapRef} className="seismo-spectro">
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  )
}
