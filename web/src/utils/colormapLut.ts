export type ScientificColormapId = 'inferno' | 'turbo' | 'viridis' | 'grayscale'

export interface ScientificColormapSpec {
  id: ScientificColormapId
  label: string
  shortLabel: string
  description: string
  cssGradientHorizontal: string
  cssGradientVertical: string
  stops: readonly [number, [number, number, number]][]
}

export const SCIENTIFIC_COLORMAPS: readonly ScientificColormapSpec[] = Object.freeze([
  {
    id: 'inferno',
    label: 'Inferno (Mapa de Calor)',
    shortLabel: 'Inferno',
    description: 'Rampa térmica perceptual (negro → púrpura → carmesí → ámbar → amarillo pálido)',
    cssGradientHorizontal:
      'linear-gradient(90deg, rgb(0, 0, 4) 0%, rgb(66, 10, 104) 20%, rgb(147, 38, 103) 40%, rgb(221, 81, 58) 60%, rgb(252, 165, 10) 80%, rgb(252, 255, 164) 100%)',
    cssGradientVertical:
      'linear-gradient(0deg, rgb(0, 0, 4) 0%, rgb(66, 10, 104) 20%, rgb(147, 38, 103) 40%, rgb(221, 81, 58) 60%, rgb(252, 165, 10) 80%, rgb(252, 255, 164) 100%)',
    stops: [
      [0.0, [0, 0, 4]],
      [0.2, [66, 10, 104]],
      [0.4, [147, 38, 103]],
      [0.6, [221, 81, 58]],
      [0.8, [252, 165, 10]],
      [1.0, [252, 255, 164]],
    ],
  },
  {
    id: 'turbo',
    label: 'Turbo (Multifísica)',
    shortLabel: 'Turbo',
    description: 'Rampa de alto contraste tipo COMSOL / Jet corregido perceptualmente',
    cssGradientHorizontal:
      'linear-gradient(90deg, rgb(48, 18, 59) 0%, rgb(65, 119, 246) 20%, rgb(27, 218, 172) 40%, rgb(164, 252, 60) 60%, rgb(251, 150, 39) 80%, rgb(122, 4, 3) 100%)',
    cssGradientVertical:
      'linear-gradient(0deg, rgb(48, 18, 59) 0%, rgb(65, 119, 246) 20%, rgb(27, 218, 172) 40%, rgb(164, 252, 60) 60%, rgb(251, 150, 39) 80%, rgb(122, 4, 3) 100%)',
    stops: [
      [0.0, [48, 18, 59]],
      [0.2, [65, 119, 246]],
      [0.4, [27, 218, 172]],
      [0.6, [164, 252, 60]],
      [0.8, [251, 150, 39]],
      [1.0, [122, 4, 3]],
    ],
  },
  {
    id: 'viridis',
    label: 'Viridis (Científica)',
    shortLabel: 'Viridis',
    description: 'Rampa uniforme para retrodispersión y biomasa (violeta → azul → verde → amarillo)',
    cssGradientHorizontal:
      'linear-gradient(90deg, rgb(68, 1, 84) 0%, rgb(59, 82, 139) 25%, rgb(33, 145, 140) 50%, rgb(94, 201, 98) 75%, rgb(253, 231, 37) 100%)',
    cssGradientVertical:
      'linear-gradient(0deg, rgb(68, 1, 84) 0%, rgb(59, 82, 139) 25%, rgb(33, 145, 140) 50%, rgb(94, 201, 98) 75%, rgb(253, 231, 37) 100%)',
    stops: [
      [0.0, [68, 1, 84]],
      [0.25, [59, 82, 139]],
      [0.5, [33, 145, 140]],
      [0.75, [94, 201, 98]],
      [1.0, [253, 231, 37]],
    ],
  },
  {
    id: 'grayscale',
    label: 'Grayscale (SAR dB)',
    shortLabel: 'Grayscale',
    description: 'Escala de grises lineal oficial SAR (-22 dB negro a 0 dB blanco)',
    cssGradientHorizontal: 'linear-gradient(90deg, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)',
    cssGradientVertical: 'linear-gradient(0deg, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)',
    stops: [
      [0.0, [0, 0, 0]],
      [1.0, [255, 255, 255]],
    ],
  },
])

const lutCache = new Map<ScientificColormapId, Uint8Array>()
const colorizedUrlCache = new Map<string, Promise<string>>()

export function getColormapSpec(id: ScientificColormapId): ScientificColormapSpec {
  return SCIENTIFIC_COLORMAPS.find((c) => c.id === id) ?? SCIENTIFIC_COLORMAPS[0]
}

/** Construye una tabla LUT de 256 × 3 bytes (R, G, B) interpolando linealmente los stops de la paleta. */
export function buildLut256(id: ScientificColormapId): Uint8Array {
  const cached = lutCache.get(id)
  if (cached) return cached

  const spec = getColormapSpec(id)
  const stops = spec.stops
  const lut = new Uint8Array(256 * 3)

  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let s0 = stops[0]
    let s1 = stops[stops.length - 1]
    for (let j = 0; j < stops.length - 1; j++) {
      if (t >= stops[j][0] && t <= stops[j + 1][0]) {
        s0 = stops[j]
        s1 = stops[j + 1]
        break
      }
    }
    const span = Math.max(1e-6, s1[0] - s0[0])
    const f = Math.min(1, Math.max(0, (t - s0[0]) / span))
    lut[i * 3] = Math.round(s0[1][0] + f * (s1[1][0] - s0[1][0]))
    lut[i * 3 + 1] = Math.round(s0[1][1] + f * (s1[1][1] - s0[1][1]))
    lut[i * 3 + 2] = Math.round(s0[1][2] + f * (s1[1][2] - s0[1][2]))
  }

  lutCache.set(id, lut)
  return lut
}

/** Interpolar un color hex/rgb de Inferno dado `t` en [0..1] (para el Simulador Solar). */
export function sampleColormapRgbString(id: ScientificColormapId, tNorm: number): string {
  const lut = buildLut256(id)
  const idx = Math.min(255, Math.max(0, Math.round(tNorm * 255)))
  const r = lut[idx * 3]
  const g = lut[idx * 3 + 1]
  const b = lut[idx * 3 + 2]
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Carga un PNG en escala de grises lineal (`/data/explore/<granuleId>/web/*.png`) en un `<canvas>` en memoria,
 * aplica la tabla LUT de 256 colores en cada píxel con `A > 0` tomando `t = R / 255` y conservando intacto
 * el canal Alfa (`A`), y devuelve un BlobURL/DataURL listo para la fuente `image` de MapLibre.
 */
export function colorizePngWithLut(
  pngUrl: string,
  colormapId: ScientificColormapId,
): Promise<string> {
  if (colormapId === 'grayscale') {
    return Promise.resolve(pngUrl)
  }

  const cacheKey = `${pngUrl}::${colormapId}`
  const existing = colorizedUrlCache.get(cacheKey)
  if (existing) return existing

  const promise = new Promise<string>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          resolve(pngUrl)
          return
        }
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, w, h)
        const data = imageData.data
        const lut = buildLut256(colormapId)

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3]
          if (alpha > 0) {
            const lum = data[i] // 0..255 lineal entre vmin_dB (-22) y vmax_dB (0)
            const base = lum * 3
            data[i] = lut[base]
            data[i + 1] = lut[base + 1]
            data[i + 2] = lut[base + 2]
          }
        }

        ctx.putImageData(imageData, 0, 0)
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(URL.createObjectURL(blob))
          } else {
            resolve(canvas.toDataURL('image/png'))
          }
        }, 'image/png')
      } catch {
        resolve(pngUrl)
      }
    }
    img.onerror = () => {
      colorizedUrlCache.delete(cacheKey)
      resolve(pngUrl)
    }
    img.src = pngUrl
  })

  colorizedUrlCache.set(cacheKey, promise)
  return promise
}
