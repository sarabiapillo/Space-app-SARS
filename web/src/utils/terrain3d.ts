/**
 * Relieve 3D de la ROI (módulo aislado, solo cliente).
 *
 * Elevación: teselas abiertas AWS Terrarium (Mapzen/Tilezen, derivadas de SRTM/NASADEM y otras
 * fuentes abiertas), sin API key. Codificación: elev_m = (R·256 + G + B/256) − 32768.
 * Textura: teselas Esri World Imagery (la misma fuente del mapa base) recortadas al mismo bbox.
 *
 * Esto es una visualización del relieve: no reemplaza al DEM NASADEM que usa el pipeline
 * (`pipeline/elevation/nasadem.py`) y sus cifras no se usan en ningún cálculo científico.
 */

export type LonLatBBox = [west: number, south: number, east: number, north: number]

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const TERRARIUM_PROXY_URL = '/tiles-terrarium/{z}/{x}/{y}.png'
export const ESRI_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const TERRAIN_SOURCE_LABEL = 'AWS Terrarium / NASA SRTM'
export const IMAGERY_SOURCE_LABEL = 'Esri World Imagery'

const TILE = 256
const MAX_TILES = 36
const MAX_LAT = 85.05112878

export interface TerrainGrid {
  /** Elevación en metros, fila 0 = norte. NaN = sin dato. */
  heights: Float32Array
  cols: number
  rows: number
  minM: number
  maxM: number
  bbox: LonLatBBox
  zoom: number
  /** Ancho y alto aproximados del bbox en metros (para la proporción de la maqueta). */
  widthM: number
  heightM: number
}

export interface TerrainData {
  grid: TerrainGrid
  /** Textura satelital alineada al bbox; null si no se pudo descargar. */
  imagery: HTMLCanvasElement | null
  imageryZoom: number | null
}

/** Bbox [W,S,E,N] de cualquier geometría GeoJSON Polygon/MultiPolygon o anillo [lon,lat][]. */
export function bboxFromGeometry(geometry: unknown): LonLatBBox | null {
  const xs: number[] = []
  const ys: number[] = []
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      if (Number.isFinite(node[0]) && Number.isFinite(node[1])) { xs.push(node[0]); ys.push(node[1]) }
      return
    }
    node.forEach(walk)
  }
  if (geometry && typeof geometry === 'object' && 'coordinates' in geometry) {
    walk((geometry as { coordinates: unknown }).coordinates)
  } else {
    walk(geometry)
  }
  if (!xs.length) return null
  const bbox: LonLatBBox = [Math.min(...xs), Math.max(-MAX_LAT, Math.min(...ys)), Math.max(...xs), Math.min(MAX_LAT, Math.max(...ys))]
  if (!(bbox[2] > bbox[0]) || !(bbox[3] > bbox[1])) return null
  return bbox
}

/** Decodifica un píxel Terrarium a metros. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}

export function latToTileY(lat: number, z: number): number {
  const rad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}

function tileRange(bbox: LonLatBBox, z: number) {
  const x0 = Math.floor(lonToTileX(bbox[0], z))
  const x1 = Math.floor(lonToTileX(bbox[2], z) - 1e-9)
  const y0 = Math.floor(latToTileY(bbox[3], z))
  const y1 = Math.floor(latToTileY(bbox[1], z) - 1e-9)
  return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) }
}

/** Zoom más alto (dentro de [minZ, maxZ]) cuyo número de teselas no excede `maxTiles`. */
export function chooseZoom(bbox: LonLatBBox, minZ: number, maxZ: number, maxTiles = MAX_TILES): number {
  for (let z = maxZ; z > minZ; z--) {
    if (tileRange(bbox, z).count <= maxTiles) return z
  }
  return minZ
}

/** Distancia aproximada en metros del bbox (esfera, suficiente para la proporción visual). */
export function bboxSizeMeters(bbox: LonLatBBox): { widthM: number; heightM: number } {
  const R = 6371008.8
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const widthM = ((bbox[2] - bbox[0]) * Math.PI / 180) * R * Math.cos(latMid)
  const heightM = ((bbox[3] - bbox[1]) * Math.PI / 180) * R
  return { widthM, heightM }
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const onAbort = () => { img.src = ''; reject(new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    img.onload = () => { signal?.removeEventListener('abort', onAbort); resolve(img) }
    img.onerror = () => { signal?.removeEventListener('abort', onAbort); reject(new Error(`tile ${url}`)) }
    img.src = url
  })
}

function isTerrariumTemplate(template: string): boolean {
  return template === TERRARIUM_URL || template === TERRARIUM_PROXY_URL
}

/**
 * Descarga las teselas que cubren el bbox, las compone y recorta exactamente al bbox.
 * Devuelve un canvas en proyección Web Mercator (filas = norte → sur).
 */
async function mosaicToBBox(template: string, bbox: LonLatBBox, z: number, outW: number, outH: number, signal?: AbortSignal, allowMissing = false): Promise<HTMLCanvasElement> {
  const { x0, x1, y0, y1 } = tileRange(bbox, z)
  const n = 2 ** z
  const mosaic = document.createElement('canvas')
  mosaic.width = (x1 - x0 + 1) * TILE
  mosaic.height = (y1 - y0 + 1) * TILE
  const ctx = mosaic.getContext('2d')
  if (!ctx) throw new Error('canvas 2d')
  const jobs: Promise<void>[] = []
  let failed = 0
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= n) continue
      const wx = ((tx % n) + n) % n
      const url = template.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty))
      const fallbackUrl = template === TERRARIUM_PROXY_URL
        ? TERRARIUM_URL.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty))
        : null
      jobs.push(
        loadImage(url, signal)
          .catch((err) => {
            if ((err as DOMException)?.name === 'AbortError' || !fallbackUrl) throw err
            return loadImage(fallbackUrl, signal)
          })
          .then(
            (img) => { ctx.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE) },
            (err) => { if ((err as DOMException)?.name === 'AbortError') throw err; failed++ },
          ),
      )
    }
  }
  await Promise.all(jobs)
  if (failed > 0 && (!allowMissing || failed === jobs.length)) throw new Error(`${failed} teselas no disponibles`)
  const sx = (lonToTileX(bbox[0], z) - x0) * TILE
  const sy = (latToTileY(bbox[3], z) - y0) * TILE
  const sw = (lonToTileX(bbox[2], z) - x0) * TILE - sx
  const sh = (latToTileY(bbox[1], z) - y0) * TILE - sy
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')
  if (!octx) throw new Error('canvas 2d')
  // Terrarium se remuestrea sin suavizado de color para no mezclar bytes codificados.
  octx.imageSmoothingEnabled = !isTerrariumTemplate(template)
  octx.drawImage(mosaic, sx, sy, sw, sh, 0, 0, outW, outH)
  return out
}

/** Piso mínimo de elevación en metros (nivela batimetría oceánica y outliers negativos a 0 m). */
export const MIN_ELEVATION_FLOOR_M = 0
/** Techo físico razonable en metros para descartar píxeles corruptos. */
export const MAX_ELEVATION_CEIL_M = 9000

/**
 * Sanea una muestra decodificada de Terrarium:
 * - Si `alpha < 255` o el valor no es finito o supera `MAX_ELEVATION_CEIL_M`, devuelve `NaN`.
 * - Si la elevación está por debajo de `floorM` (p. ej. batimetría oceánica en zonas costeras como
 *   Acapulco, donde Terrarium codifica hasta −9,651 m), se recorta a `floorM` (0 m por defecto).
 */
export function sanitizeElevationSample(rawElevM: number, alpha = 255, floorM = MIN_ELEVATION_FLOOR_M): number {
  if (alpha < 255 || !Number.isFinite(rawElevM) || rawElevM > MAX_ELEVATION_CEIL_M) {
    return Number.NaN
  }
  return rawElevM < floorM ? floorM : rawElevM
}

/**
 * Sanea una rejilla completa de elevaciones y recalcula `minM` y `maxM` después del saneamiento,
 * rellenando muestras sin dato (`NaN`) con `minM` para evitar picos o agujeros en la malla 3D.
 */
export function sanitizeElevationGrid(
  rawHeights: Float32Array,
  alphas?: Uint8Array | null,
  floorM = MIN_ELEVATION_FLOOR_M,
): { heights: Float32Array; minM: number; maxM: number } {
  const n = rawHeights.length
  const heights = new Float32Array(n)
  let minM = Infinity
  let maxM = -Infinity
  for (let i = 0; i < n; i++) {
    const a = alphas ? alphas[i] : 255
    const h = sanitizeElevationSample(rawHeights[i], a, floorM)
    heights[i] = h
    if (!Number.isNaN(h)) {
      if (h < minM) minM = h
      if (h > maxM) maxM = h
    }
  }
  if (!Number.isFinite(minM)) throw new Error('sin elevación válida')
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(heights[i])) heights[i] = minM
  }
  return { heights, minM, maxM }
}

/** Umbral por defecto (en metros) para eliminar picos aislados tipo "aguja" en montaña. */
export const DESPIKE_THRESHOLD_M = 80
/** Umbral estricto (en metros) para zonas bajas o costeras (< 100 m, ej. Cancún). */
export const DESPIKE_LOWLAND_THRESHOLD_M = 15
/** Salto máximo permitido entre un píxel y sus vecinos inmediatos dentro de una tesela nativa. */
export const NATIVE_TILE_MAX_STEP_M = 150

/**
 * Umbral adaptativo de despike en función de la mediana local y de la desviación absoluta mediana (MAD)
 * de los vecinos en la ventana 3×3:
 * - En zonas bajas o costeras (`median < 100 m`, p. ej. Cancún), el tope máximo es estricto (15 m) y
 *   además se acota a `max(6 m, 4.5 * MAD + 5 m)` para eliminar cualquier aguja sobre planicies.
 * - En zonas de montaña (`median >= 100 m`), se permite hasta `maxThresholdM` (80 m por defecto) o
 *   `max(18 m, 4.5 * MAD + 12 m)` según la pendiente local.
 */
export function adaptiveDespikeThreshold(
  localMedianM: number,
  localMadM: number,
  maxThresholdM = DESPIKE_THRESHOLD_M,
): number {
  const cap = localMedianM < 100 ? Math.min(DESPIKE_LOWLAND_THRESHOLD_M, maxThresholdM) : maxThresholdM
  const floor = localMedianM < 100 ? 6 : 18
  const margin = localMedianM < 100 ? 5 : 12
  return Math.min(cap, Math.max(floor, localMadM * 4.5 + margin))
}

/**
 * Comprobación de cordura (sanity check) sobre una tesela decodificada a resolución nativa (p. ej. 256×256):
 * Si el salto de altura entre un píxel y la mediana de sus vecinos ortogonales/diagonales inmediatos
 * supera un valor ilógico (`maxStepM`, 150 m por defecto en un solo píxel, o 20 m en planicies costeras
 * donde la mediana vecina es `< 50 m`), suaviza el píxel reemplazándolo por la mediana vecina antes de
 * integrarlo al mosaico general.
 */
export function sanitizeDecodedTilePixels(
  tileHeights: Float32Array,
  width = TILE,
  height = TILE,
  maxStepM = NATIVE_TILE_MAX_STEP_M,
): Float32Array {
  const out = new Float32Array(tileHeights)
  const neighbors: number[] = []
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? tileHeights : out
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const idx = r * width + c
        const val = src[idx]
        neighbors.length = 0
        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr
          if (nr < 0 || nr >= height) continue
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue
            const nc = c + dc
            if (nc < 0 || nc >= width) continue
            const nVal = src[nr * width + nc]
            if (Number.isFinite(nVal)) neighbors.push(nVal)
          }
        }
        if (neighbors.length < 3) continue
        neighbors.sort((a, b) => a - b)
        const mid = neighbors.length >> 1
        const median = neighbors.length % 2 === 1 ? neighbors[mid] : 0.5 * (neighbors[mid - 1] + neighbors[mid])
        const effectiveMaxStep = median < 50 ? Math.min(20, maxStepM) : maxStepM
        if (!Number.isFinite(val) || Math.abs(val - median) > effectiveMaxStep) {
          out[idx] = median
        }
      }
    }
  }
  return out
}

/**
 * Carga una tesela PNG de Terrarium sin conversión de perfil de color (`colorSpaceConversion: 'none'`)
 * cuando el navegador soporta `fetch` + `createImageBitmap`, con respaldo a `HTMLImageElement`.
 */
async function loadRawTileSource(url: string, signal?: AbortSignal): Promise<CanvasImageSource> {
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    const res = await fetch(url, { signal, mode: 'cors' })
    if (!res.ok) throw new Error(`tile ${url}`)
    const blob = await res.blob()
    return await createImageBitmap(blob, { colorSpaceConversion: 'none' })
  }
  return await loadImage(url, signal)
}

/**
 * Descarga con reintentos automáticos y decodifica una tesela Terrarium a resolución nativa 1:1
 * (256 × 256) directamente a metros saneados (`Float32Array`), aplicando validación estricta de saltos
 * entre píxeles adyacentes antes de pasarla al mosaico general.
 */
async function decodeTerrariumTileNative(
  z: number,
  wx: number,
  ty: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const primaryUrl = TERRARIUM_PROXY_URL.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty))
  const fallbackUrl = TERRARIUM_URL.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty))
  const urls = [primaryUrl, fallbackUrl, fallbackUrl]
  let source: CanvasImageSource | null = null
  let lastErr: unknown = null
  for (const url of urls) {
    try {
      source = await loadRawTileSource(url, signal)
      break
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw err
      lastErr = err
    }
  }
  if (!source) throw lastErr ?? new Error(`tile ${z}/${wx}/${ty}`)

  const tileCanvas = document.createElement('canvas')
  tileCanvas.width = TILE
  tileCanvas.height = TILE
  const ctx = tileCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0)
  if ('close' in source && typeof source.close === 'function') {
    source.close()
  }
  const px = ctx.getImageData(0, 0, TILE, TILE).data
  const rawTile = new Float32Array(TILE * TILE)
  for (let i = 0; i < TILE * TILE; i++) {
    const raw = decodeTerrarium(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])
    rawTile[i] = sanitizeElevationSample(raw, px[i * 4 + 3], MIN_ELEVATION_FLOOR_M)
  }
  return sanitizeDecodedTilePixels(rawTile, TILE, TILE, NATIVE_TILE_MAX_STEP_M)
}

/**
 * Remuestrea bilinealmente un mosaico de elevación en metros (`srcW × srcH`) al rectángulo
 * `[sx, sy, sw, sh]` hacia una malla de salida `cols × rows` (ya en metros, nunca en RGB).
 */
export function resampleElevationBilinear(
  mosaic: Float32Array,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  cols: number,
  rows: number,
): Float32Array {
  const out = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const v = rows > 1 ? r / (rows - 1) : 0.5
    const fy = Math.max(0, Math.min(srcH - 1, sy + v * sh))
    const y0 = Math.floor(fy)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const ty = fy - y0
    for (let c = 0; c < cols; c++) {
      const u = cols > 1 ? c / (cols - 1) : 0.5
      const fx = Math.max(0, Math.min(srcW - 1, sx + u * sw))
      const x0 = Math.floor(fx)
      const x1 = Math.min(srcW - 1, x0 + 1)
      const tx = fx - x0

      const h00 = mosaic[y0 * srcW + x0]
      const h10 = mosaic[y0 * srcW + x1]
      const h01 = mosaic[y1 * srcW + x0]
      const h11 = mosaic[y1 * srcW + x1]

      if (Number.isFinite(h00) && Number.isFinite(h10) && Number.isFinite(h01) && Number.isFinite(h11)) {
        const top = h00 * (1 - tx) + h10 * tx
        const bot = h01 * (1 - tx) + h11 * tx
        out[r * cols + c] = top * (1 - ty) + bot * ty
      } else {
        const valid = [h00, h10, h01, h11].filter((val) => Number.isFinite(val))
        out[r * cols + c] = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : Number.NaN
      }
    }
  }
  return out
}

/**
 * Filtro anti-picos 3×3 adaptativo en múltiples pasadas (despike) sobre una malla de elevaciones en metros:
 * - En cada pasada calcula la mediana y la desviación absoluta mediana (MAD) de los 8 vecinos inmediatos.
 * - Utiliza un umbral dinámico estricto en zonas bajas (`< 100 m`, tope 15 m, ideal para Cancún o planicies
 *   costeras) y adaptativo a la pendiente real en zonas montañosas (hasta `thresholdM`).
 * - Ejecuta `passes` pasadas consecutivas (2 por defecto) para eliminar tanto agujas aisladas como
 *   pequeños clústeres de ruido surgidos del remuestreo, recalculando `minM` y `maxM` al final.
 */
export function despikeElevationGrid(
  inputHeights: Float32Array,
  cols: number,
  rows: number,
  thresholdM = DESPIKE_THRESHOLD_M,
  passes = 2,
): { heights: Float32Array; minM: number; maxM: number } {
  let current = new Float32Array(inputHeights)
  const neighbors: number[] = []
  const deviations: number[] = []
  const totalPasses = Math.max(1, passes)

  for (let pass = 0; pass < totalPasses; pass++) {
    const next = new Float32Array(current.length)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c
        const center = current[idx]
        neighbors.length = 0
        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr
          if (nr < 0 || nr >= rows) continue
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue
            const nc = c + dc
            if (nc < 0 || nc >= cols) continue
            const val = current[nr * cols + nc]
            if (Number.isFinite(val)) neighbors.push(val)
          }
        }
        let outVal = center
        if (neighbors.length >= 3) {
          neighbors.sort((a, b) => a - b)
          const mid = neighbors.length >> 1
          const median = neighbors.length % 2 === 1 ? neighbors[mid] : 0.5 * (neighbors[mid - 1] + neighbors[mid])
          deviations.length = 0
          for (let k = 0; k < neighbors.length; k++) {
            deviations.push(Math.abs(neighbors[k] - median))
          }
          deviations.sort((a, b) => a - b)
          const mad = deviations.length % 2 === 1 ? deviations[mid] : 0.5 * (deviations[mid - 1] + deviations[mid])
          const dynamicThreshold = adaptiveDespikeThreshold(median, mad, thresholdM)
          if (!Number.isFinite(center) || Math.abs(center - median) > dynamicThreshold) {
            outVal = median
          }
        }
        next[idx] = outVal
      }
    }
    current = next
  }

  let minM = Infinity
  let maxM = -Infinity
  for (let i = 0; i < current.length; i++) {
    const v = current[i]
    if (Number.isFinite(v)) {
      if (v < minM) minM = v
      if (v > maxM) maxM = v
    }
  }
  if (!Number.isFinite(minM)) throw new Error('sin elevación válida')
  for (let i = 0; i < current.length; i++) {
    if (!Number.isFinite(current[i])) current[i] = minM
  }
  return { heights: current, minM, maxM }
}

/** Rejilla de elevación (cols × rows) del bbox, decodificada 1:1 en metros y remuestreada en metros. */
export async function fetchTerrainGrid(bbox: LonLatBBox, cols: number, rows: number, signal?: AbortSignal): Promise<TerrainGrid> {
  const zoom = chooseZoom(bbox, 8, 13)
  const { x0, x1, y0, y1 } = tileRange(bbox, zoom)
  const n = 2 ** zoom
  const tilesX = x1 - x0 + 1
  const tilesY = y1 - y0 + 1
  const srcW = tilesX * TILE
  const srcH = tilesY * TILE
  const mosaic = new Float32Array(srcW * srcH)
  mosaic.fill(Number.NaN)

  const tilePromises: Promise<{ offX: number; offY: number; tileHeights: Float32Array | null }>[] = []
  let validTiles = 0
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= n) continue
      const wx = ((tx % n) + n) % n
      const offX = (tx - x0) * TILE
      const offY = (ty - y0) * TILE
      tilePromises.push(
        decodeTerrariumTileNative(zoom, wx, ty, signal).then(
          (tileHeights) => {
            validTiles++
            return { offX, offY, tileHeights }
          },
          (err) => {
            if ((err as DOMException)?.name === 'AbortError') throw err
            return { offX, offY, tileHeights: null }
          },
        ),
      )
    }
  }
  // Espera estrictamente a que TODAS las teselas hayan resuelto antes de ensamblar y remuestrear
  const resolvedTiles = await Promise.all(tilePromises)
  if (validTiles === 0) throw new Error(`${resolvedTiles.length} teselas no disponibles`)

  for (const { offX, offY, tileHeights } of resolvedTiles) {
    if (!tileHeights) continue
    for (let r = 0; r < TILE; r++) {
      const dstRow = (offY + r) * srcW + offX
      const srcRow = r * TILE
      mosaic.set(tileHeights.subarray(srcRow, srcRow + TILE), dstRow)
    }
  }

  // Si alguna tesela individual falló tras los reintentos, rellenar sus NaN con la mediana global válida
  // para no dejar huecos que generen picos por interpolación con NaN
  if (validTiles < resolvedTiles.length) {
    let sum = 0
    let count = 0
    for (let i = 0; i < mosaic.length; i++) {
      if (Number.isFinite(mosaic[i])) {
        sum += mosaic[i]
        count++
      }
    }
    const fillVal = count > 0 ? sum / count : MIN_ELEVATION_FLOOR_M
    for (let i = 0; i < mosaic.length; i++) {
      if (!Number.isFinite(mosaic[i])) mosaic[i] = fillVal
    }
  }

  const sx = (lonToTileX(bbox[0], zoom) - x0) * TILE
  const sy = (latToTileY(bbox[3], zoom) - y0) * TILE
  const sw = (lonToTileX(bbox[2], zoom) - x0) * TILE - sx
  const sh = (latToTileY(bbox[1], zoom) - y0) * TILE - sy

  const resampled = resampleElevationBilinear(mosaic, srcW, srcH, sx, sy, sw, sh, cols, rows)
  const sanitized = sanitizeElevationGrid(resampled, null, MIN_ELEVATION_FLOOR_M)
  const { heights, minM, maxM } = despikeElevationGrid(sanitized.heights, cols, rows, DESPIKE_THRESHOLD_M, 2)
  return { heights, cols, rows, minM, maxM, bbox, zoom, ...bboxSizeMeters(bbox) }
}

/** Textura satelital alineada al bbox (Esri World Imagery). */
export async function fetchImagery(bbox: LonLatBBox, size: number, signal?: AbortSignal): Promise<{ canvas: HTMLCanvasElement; zoom: number }> {
  const zoom = chooseZoom(bbox, 8, 16, 48)
  const { widthM, heightM } = bboxSizeMeters(bbox)
  const aspect = widthM / Math.max(heightM, 1)
  const w = aspect >= 1 ? size : Math.max(64, Math.round(size * aspect))
  const h = aspect >= 1 ? Math.max(64, Math.round(size / aspect)) : size
  const canvas = await mosaicToBBox(ESRI_IMAGERY_URL, bbox, zoom, w, h, signal, true)
  return { canvas, zoom }
}

/**
 * Carga elevación (obligatoria) e imagen (opcional). Si falla la imagen se devuelve null en
 * `imagery` y el visor usa el modo hipsométrico; si falla la elevación, se lanza el error.
 */
export async function loadTerrain(bbox: LonLatBBox, segments: number, signal?: AbortSignal): Promise<TerrainData> {
  const n = segments + 1
  const [gridResult, imageryResult] = await Promise.allSettled([
    fetchTerrainGrid(bbox, n, n, signal),
    fetchImagery(bbox, 2048, signal),
  ])
  if (gridResult.status === 'rejected') throw gridResult.reason
  const imagery = imageryResult.status === 'fulfilled' ? imageryResult.value : null
  return { grid: gridResult.value, imagery: imagery?.canvas ?? null, imageryZoom: imagery?.zoom ?? null }
}

/**
 * Rampa hipsométrica para relieve terrestre (t ∈ [0,1] → RGB 0–255).
 * Si `elevM` se proporciona y es `<= 0.5` m (nivel del mar / costa), devuelve azul costero.
 */
export function hypsometricColor(t: number, elevM?: number): [number, number, number] {
  if (elevM !== undefined && elevM <= 0.5) {
    return [38, 118, 178]
  }
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [38, 115, 77]],
    [0.2, [110, 168, 88]],
    [0.45, [224, 206, 128]],
    [0.72, [166, 112, 68]],
    [0.9, [132, 108, 94]],
    [1.0, [245, 245, 245]],
  ]
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]
    const [t0, c0] = stops[i - 1]
    if (x <= t1) {
      const k = (x - t0) / (t1 - t0 || 1)
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number]
    }
  }
  return stops[stops.length - 1][1]
}

/** Canvas hipsométrico con sombreado direccional (hillshade Lambertiano desde el NO) a partir de la rejilla. */
export function hypsometricCanvas(grid: TerrainGrid): HTMLCanvasElement {
  const { cols, rows, heights, minM, maxM } = grid
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const img = ctx.createImageData(cols, rows)
  const range = Math.max(maxM - minM, 1)
  const dx = Math.max(grid.widthM / Math.max(cols - 1, 1), 1)
  const dy = Math.max(grid.heightM / Math.max(rows - 1, 1), 1)
  // Vector solar normalizado desde el noroeste (azimut 315°, elevación 42°) con realce de pendiente
  const lx = -0.526
  const ly = 0.526
  const lz = 0.669
  const zFactor = 2.2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const h = heights[i]
      const isSea = minM <= 0.5 && h <= 0.5
      const [R, G, B] = hypsometricColor((h - minM) / range, minM <= 0.5 ? h : undefined)
      if (isSea) {
        img.data[i * 4] = R
        img.data[i * 4 + 1] = G
        img.data[i * 4 + 2] = B
        img.data[i * 4 + 3] = 255
        continue
      }
      const dzdx = ((heights[r * cols + Math.min(cols - 1, c + 1)] - heights[r * cols + Math.max(0, c - 1)]) / (2 * dx)) * zFactor
      const dzdy = ((heights[Math.max(0, r - 1) * cols + c] - heights[Math.min(rows - 1, r + 1) * cols + c]) / (2 * dy)) * zFactor
      const invLen = 1 / Math.hypot(dzdx, dzdy, 1)
      const dot = (-dzdx * lx - dzdy * ly + lz) * invLen
      const shade = Math.max(0.48, Math.min(1.22, 0.45 + Math.max(0, dot) * 0.85))
      img.data[i * 4] = Math.min(255, Math.round(R * shade))
      img.data[i * 4 + 1] = Math.min(255, Math.round(G * shade))
      img.data[i * 4 + 2] = Math.min(255, Math.round(B * shade))
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** Dirección de órbita del radar NISAR (mirada lateral izquierda). */
export type SarOrbitDirection = 'ascending' | 'descending'

/** Clases geométricas de confiabilidad y distorsión topográfica SAR. */
export type SarGeometricClass = 'reliable' | 'steep' | 'layover' | 'shadow'

/** Ángulo de incidencia nominal representativo de NISAR L-band (rango 33°–47°). */
export const DEFAULT_SAR_INCIDENCE_DEG = 43
/** Umbral de pendiente crítica (en grados) donde aumenta la distorsión radiométrica. */
export const SAR_CRITICAL_SLOPE_DEG = 15

export interface SarMaskOptions {
  orbit?: SarOrbitDirection
  incidenceDeg?: number
  criticalSlopeDeg?: number
}

export interface SarMaskStats {
  reliablePct: number
  steepPct: number
  layoverPct: number
  shadowPct: number
  totalCells: number
  orbit: SarOrbitDirection
  incidenceDeg: number
}

/**
 * Color RGB [0..255] para cada categoría de la máscara geométrica SAR:
 * - Confiable (verde `#22C55E`)
 * - Pendiente crítica > 15° (ámbar `#F59E0B`)
 * - Layover / escorzo severo (rojo `#EF4444`)
 * - Sombra radar (morado carbón `#1E1B4B`)
 */
export function sarClassColor(cls: SarGeometricClass): [number, number, number] {
  switch (cls) {
    case 'reliable':
      return [34, 197, 94]
    case 'steep':
      return [245, 158, 11]
    case 'layover':
      return [239, 68, 68]
    case 'shadow':
      return [30, 27, 75]
  }
}

/**
 * Clasifica cada celda de la rejilla topográfica en una de las 4 clases geométricas SAR y
 * devuelve además los colores sombreados (RGBA) y el resumen porcentual de la ROI.
 *
 * Geometría NISAR (radar de mirada izquierda):
 * - Órbita Ascendente (`ascending`, rumbo ~350°): el haz mira hacia el Oeste-Suroeste (azimut ~260°).
 * - Órbita Descendente (`descending`, rumbo ~190°): el haz mira hacia el Este-Sureste (azimut ~100°).
 *
 * Para un punto con derivadas locales `(zx = ∂z/∂x, zy = ∂z/∂y)` (x = Este, y = Norte) y vector
 * unitario de propagación del haz desde el sensor hacia el terreno `(lx, ly)`:
 * - Pendiente real: `α = arctan(√(zx² + zy²))`
 * - Pendiente proyectada hacia el radar (positiva cuando la altura crece en el sentido de propagación
 *   del haz, es decir, cuando la normal de la ladera apunta de regreso hacia el sensor):
 *   `s_rad = zx·lx + zy·ly`
 *   * `s_rad > 0`: ladera orientada hacia el radar → Layover si `s_rad ≥ tan(θ_i)`.
 *   * `s_rad < 0`: ladera opuesta al radar → Sombra si `-s_rad ≥ tan(90° - θ_i)`.
 */
export function computeSarGeometricMask(
  grid: Pick<TerrainGrid, 'heights' | 'cols' | 'rows' | 'widthM' | 'heightM'>,
  options: SarMaskOptions = {},
): { classes: Uint8Array; rgba: Uint8ClampedArray; stats: SarMaskStats } {
  const orbit: SarOrbitDirection = options.orbit ?? 'ascending'
  const incidenceDeg = Math.max(20, Math.min(70, options.incidenceDeg ?? DEFAULT_SAR_INCIDENCE_DEG))
  const criticalSlopeDeg = options.criticalSlopeDeg ?? SAR_CRITICAL_SLOPE_DEG

  const { heights, cols, rows, widthM, heightM } = grid
  const total = cols * rows
  const classes = new Uint8Array(total) // 0=reliable, 1=steep, 2=layover, 3=shadow
  const rgba = new Uint8ClampedArray(total * 4)

  const dx = Math.max(widthM / Math.max(cols - 1, 1), 1e-3)
  const dy = Math.max(heightM / Math.max(rows - 1, 1), 1e-3)

  // Dirección del haz radar (desde el satélite hacia el terreno): azimut medido desde el Norte en sentido horario
  const lookAzimuthDeg = orbit === 'ascending' ? 260 : 100
  const lookRad = (lookAzimuthDeg * Math.PI) / 180
  const lx = Math.sin(lookRad) // componente Este
  const ly = Math.cos(lookRad) // componente Norte

  const tanIncidence = Math.tan((incidenceDeg * Math.PI) / 180)
  const tanGrazing = Math.tan(((90 - incidenceDeg) * Math.PI) / 180)
  const tanCritical = Math.tan((criticalSlopeDeg * Math.PI) / 180)

  // Vector de iluminación direccional suave (NO) para conservar la percepción de volumen 3D
  const sunX = -0.526
  const sunY = 0.526
  const sunZ = 0.669

  let reliableCount = 0
  let steepCount = 0
  let layoverCount = 0
  let shadowCount = 0

  for (let r = 0; r < rows; r++) {
    const rPrev = Math.max(0, r - 1)
    const rNext = Math.min(rows - 1, r + 1)
    const spanY = Math.max(1, rNext - rPrev) * dy
    for (let c = 0; c < cols; c++) {
      const cPrev = Math.max(0, c - 1)
      const cNext = Math.min(cols - 1, c + 1)
      const spanX = Math.max(1, cNext - cPrev) * dx

      const i = r * cols + c
      const zx = (heights[r * cols + cNext] - heights[r * cols + cPrev]) / spanX
      // Filas crecen de Norte (r=0) a Sur (r=rows-1), por lo que ∂z/∂Norte = (z[rPrev] - z[rNext]) / spanY
      const zy = (heights[rPrev * cols + c] - heights[rNext * cols + c]) / spanY

      const slopeMag = Math.hypot(zx, zy)
      // Pendiente proyectada hacia el sensor: positiva cuando el terreno sube en la dirección de propagación del haz (lx, ly)
      const slopeTowardRadar = zx * lx + zy * ly

      let cls: SarGeometricClass
      if (slopeTowardRadar >= tanIncidence) {
        cls = 'layover'
        classes[i] = 2
        layoverCount++
      } else if (-slopeTowardRadar >= tanGrazing) {
        cls = 'shadow'
        classes[i] = 3
        shadowCount++
      } else if (slopeMag > tanCritical) {
        cls = 'steep'
        classes[i] = 1
        steepCount++
      } else {
        cls = 'reliable'
        classes[i] = 0
        reliableCount++
      }

      const [R, G, B] = sarClassColor(cls)
      const invLen = 1 / Math.hypot(zx, zy, 1)
      const dot = (-zx * sunX - zy * sunY + sunZ) * invLen
      const shade = cls === 'shadow'
        ? Math.max(0.75, Math.min(1.15, 0.75 + Math.max(0, dot) * 0.4))
        : Math.max(0.62, Math.min(1.18, 0.58 + Math.max(0, dot) * 0.65))

      rgba[i * 4] = Math.min(255, Math.round(R * shade))
      rgba[i * 4 + 1] = Math.min(255, Math.round(G * shade))
      rgba[i * 4 + 2] = Math.min(255, Math.round(B * shade))
      rgba[i * 4 + 3] = 255
    }
  }

  const denom = Math.max(total, 1)
  return {
    classes,
    rgba,
    stats: {
      reliablePct: (reliableCount / denom) * 100,
      steepPct: (steepCount / denom) * 100,
      layoverPct: (layoverCount / denom) * 100,
      shadowPct: (shadowCount / denom) * 100,
      totalCells: total,
      orbit,
      incidenceDeg,
    },
  }
}

/**
 * Genera el `<canvas>` de textura para el modo "Máscara Geométrica SAR" junto con las estadísticas
 * porcentuales de la ROI.
 */
export function sarMaskCanvas(
  grid: TerrainGrid,
  options: SarMaskOptions = {},
): { canvas: HTMLCanvasElement; stats: SarMaskStats } {
  const { cols, rows } = grid
  const { rgba, stats } = computeSarGeometricMask(grid, options)
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const img = ctx.createImageData(cols, rows)
    img.data.set(rgba)
    ctx.putImageData(img, 0, 0)
  }
  return { canvas, stats }
}
