import { LUT_INFERNO_256 } from './colormapTables.ts'

/**
 * Mapa de calor del simulador solar con mejor contraste y escala numérica.
 *
 * El backend publica `preview.png` coloreado con la LUT Inferno de matplotlib (256 colores),
 * normalizado entre 0 y el DNI ajustado (`clear_sky.dni_adjusted_w_m2`). Aquí se invierte esa
 * LUT para recuperar la irradiancia de cada píxel (con la resolución de 1/256 del DNI que tiene
 * el PNG) y se vuelve a colorear:
 *
 * - `estirado`: entre los percentiles 2 y 98 de ESTA simulación. Distingue mejor las diferencias
 *   del relieve dentro de la zona, pero los colores no se comparan entre horas.
 * - `absoluto`: entre 0 y el DNI ajustado (igual que el PNG original). Comparable entre horas.
 *
 * Los valores exactos están en `incident.tif` (Float32); esto es solo para ver.
 */

export type HeatmapScaleMode = 'estirado' | 'absoluto'

export interface HeatmapStats {
  min: number
  p2: number
  p50: number
  p98: number
  max: number
  mean: number
  validPixels: number
  /** Medio escalón de cuantización del PNG en W/m² (incertidumbre de los valores recuperados). */
  halfStep: number
}

export interface DecodedHeatmap {
  width: number
  height: number
  values: Float32Array // W/m², NaN fuera de la zona
  stats: HeatmapStats
}

export interface RenderedHeatmap {
  image: ImageData
  vmin: number
  vmax: number
}

const LUT = LUT_INFERNO_256
const exactIndex = new Map<number, number>()
for (let i = 0; i < 256; i++) {
  exactIndex.set((LUT[i * 3] << 16) | (LUT[i * 3 + 1] << 8) | LUT[i * 3 + 2], i)
}
const nearestCache = new Map<number, number>()

/** Índice de la LUT para un color; exacto si coincide, si no el más cercano (p. ej. tras compresión). */
export function infernoIndex(r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b
  const hit = exactIndex.get(key) ?? nearestCache.get(key)
  if (hit !== undefined) return hit
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < 256; i++) {
    const dr = LUT[i * 3] - r
    const dg = LUT[i * 3 + 1] - g
    const db = LUT[i * 3 + 2] - b
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  nearestCache.set(key, best)
  return best
}

function percentile(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Recupera la irradiancia de cada píxel a partir de los colores RGBA del PNG Inferno. */
export function decodeInfernoPixels(rgba: Uint8ClampedArray, width: number, height: number, upperWm2: number): DecodedHeatmap {
  const n = width * height
  const values = new Float32Array(n)
  const valid: number[] = []
  let sum = 0
  for (let p = 0; p < n; p++) {
    const o = p * 4
    if (rgba[o + 3] === 0) {
      values[p] = NaN
      continue
    }
    // matplotlib asigna el índice floor(t·256) (t = valor/DNI): el centro del escalón es (i + 0.5)/256.
    const v = ((infernoIndex(rgba[o], rgba[o + 1], rgba[o + 2]) + 0.5) / 256) * upperWm2
    values[p] = v
    valid.push(v)
    sum += v
  }
  const sorted = Float32Array.from(valid).sort()
  return {
    width,
    height,
    values,
    stats: {
      min: sorted[0] ?? NaN,
      p2: percentile(sorted, 0.02),
      p50: percentile(sorted, 0.5),
      p98: percentile(sorted, 0.98),
      max: sorted[sorted.length - 1] ?? NaN,
      mean: valid.length ? sum / valid.length : NaN,
      validPixels: valid.length,
      halfStep: upperWm2 / 512,
    },
  }
}

/** Colores RGBA con la LUT Inferno entre vmin y vmax (los valores fuera se saturan). */
export function colorize(values: Float32Array, vmin: number, vmax: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(values.length * 4))
  const span = vmax > vmin ? vmax - vmin : 1
  for (let p = 0; p < values.length; p++) {
    const v = values[p]
    if (!Number.isFinite(v)) continue
    const t = Math.min(1, Math.max(0, (v - vmin) / span))
    const i = Math.min(255, Math.floor(t * 256))
    out[p * 4] = LUT[i * 3]
    out[p * 4 + 1] = LUT[i * 3 + 1]
    out[p * 4 + 2] = LUT[i * 3 + 2]
    out[p * 4 + 3] = 255
  }
  return out
}

/** Límites de la escala para un modo. */
export function scaleFor(mode: HeatmapScaleMode, stats: HeatmapStats, upperWm2: number): [number, number] {
  if (mode === 'absoluto' || !(stats.p98 > stats.p2)) return [0, upperWm2]
  return [stats.p2, stats.p98]
}

/** Valores redondos para las marcas de la leyenda. */
export function legendTicks(vmin: number, vmax: number, count = 5): number[] {
  const span = vmax - vmin
  if (!(span > 0)) return [vmin]
  const raw = span / (count - 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  // Paso redondo cuyo número de marcas queda más cerca de `count` (en empate, el más fino).
  const nTicks = (s: number) => Math.floor(vmax / s + 1e-9) - Math.ceil(vmin / s - 1e-9) + 1
  let step = mag
  for (const s of [1, 2, 2.5, 5, 10].map((m) => m * mag)) {
    if (nTicks(s) >= 2 && Math.abs(nTicks(s) - count) < Math.abs(nTicks(step) - count)) step = s
  }
  const ticks: number[] = []
  for (let v = Math.ceil(vmin / step) * step; v <= vmax + 1e-9; v += step) ticks.push(Number(v.toFixed(6)))
  return ticks
}

/** Carga el PNG del backend y recupera sus valores (requiere mismo origen: /api vía proxy). */
export async function loadHeatmap(url: string, upperWm2: number): Promise<DecodedHeatmap> {
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo cargar la imagen de radiación.'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('El navegador no permite procesar la imagen.')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return decodeInfernoPixels(data, canvas.width, canvas.height, upperWm2)
}

/** Colorea valores de los píxeles originales; MapLibre recibe ImageData sin interpolar colores ni cargar otra URL. */
export function renderHeatmap(decoded: DecodedHeatmap, vmin: number, vmax: number): RenderedHeatmap {
  return { image: new ImageData(colorize(decoded.values, vmin, vmax), decoded.width, decoded.height), vmin, vmax }
}
