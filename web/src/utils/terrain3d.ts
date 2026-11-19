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

/** Umbral por defecto (en metros) para eliminar picos aislados tipo "aguja" de 1 vértice. */
export const DESPIKE_THRESHOLD_M = 80

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
 * Descarga y decodifica una tesela Terrarium a resolución nativa 1:1 (256 × 256) directamente
 * a metros saneados (`Float32Array`), sin escalar nunca en espacio RGB.
 */
async function decodeTerrariumTileNative(
  z: number,
  wx: number,
  ty: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const primaryUrl = TERRARIUM_PROXY_URL.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty))
  const fallbackUrl = TERRARIUM_URL.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty))
  let source: CanvasImageSource
  try {
    source = await loadRawTileSource(primaryUrl, signal)
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') throw err
    source = await loadRawTileSource(fallbackUrl, signal)
  }
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
  const out = new Float32Array(TILE * TILE)
  for (let i = 0; i < TILE * TILE; i++) {
    const raw = decodeTerrarium(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])
    out[i] = sanitizeElevationSample(raw, px[i * 4 + 3], MIN_ELEVATION_FLOOR_M)
  }
  return out
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
 * Filtro anti-picos 3×3 (despike) sobre una malla de elevaciones en metros:
 * Para cada celda calcula la mediana de sus vecinos inmediatos disponibles (8 en el interior);
 * si `|elev - medianaVecinos| > thresholdM` (típico artefacto de +256 m por salto del canal R en
 * Terrarium), reemplaza el vértice por la mediana de sus vecinos y recalcula `minM` y `maxM`.
 */
export function despikeElevationGrid(
  inputHeights: Float32Array,
  cols: number,
  rows: number,
  thresholdM = DESPIKE_THRESHOLD_M,
): { heights: Float32Array; minM: number; maxM: number } {
  const heights = new Float32Array(inputHeights.length)
  const neighbors: number[] = []
  let minM = Infinity
  let maxM = -Infinity

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const center = inputHeights[idx]
      neighbors.length = 0
      for (let dr = -1; dr <= 1; dr++) {
        const nr = r + dr
        if (nr < 0 || nr >= rows) continue
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nc = c + dc
          if (nc < 0 || nc >= cols) continue
          const val = inputHeights[nr * cols + nc]
          if (Number.isFinite(val)) neighbors.push(val)
        }
      }
      let outVal = center
      if (neighbors.length >= 3) {
        neighbors.sort((a, b) => a - b)
        const mid = neighbors.length >> 1
        const median = neighbors.length % 2 === 1 ? neighbors[mid] : 0.5 * (neighbors[mid - 1] + neighbors[mid])
        if (!Number.isFinite(center) || Math.abs(center - median) > thresholdM) {
          outVal = median
        }
      }
      heights[idx] = outVal
      if (Number.isFinite(outVal)) {
        if (outVal < minM) minM = outVal
        if (outVal > maxM) maxM = outVal
      }
    }
  }
  if (!Number.isFinite(minM)) throw new Error('sin elevación válida')
  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) heights[i] = minM
  }
  return { heights, minM, maxM }
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

  const jobs: Promise<void>[] = []
  let failed = 0
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= n) continue
      const wx = ((tx % n) + n) % n
      const offX = (tx - x0) * TILE
      const offY = (ty - y0) * TILE
      jobs.push(
        decodeTerrariumTileNative(zoom, wx, ty, signal).then(
          (tileHeights) => {
            for (let r = 0; r < TILE; r++) {
              const dstRow = (offY + r) * srcW + offX
              const srcRow = r * TILE
              mosaic.set(tileHeights.subarray(srcRow, srcRow + TILE), dstRow)
            }
          },
          (err) => {
            if ((err as DOMException)?.name === 'AbortError') throw err
            failed++
          },
        ),
      )
    }
  }
  await Promise.all(jobs)
  if (failed > 0) throw new Error(`${failed} teselas no disponibles`)

  const sx = (lonToTileX(bbox[0], zoom) - x0) * TILE
  const sy = (latToTileY(bbox[3], zoom) - y0) * TILE
  const sw = (lonToTileX(bbox[2], zoom) - x0) * TILE - sx
  const sh = (latToTileY(bbox[1], zoom) - y0) * TILE - sy

  const resampled = resampleElevationBilinear(mosaic, srcW, srcH, sx, sy, sw, sh, cols, rows)
  const sanitized = sanitizeElevationGrid(resampled, null, MIN_ELEVATION_FLOOR_M)
  const { heights, minM, maxM } = despikeElevationGrid(sanitized.heights, cols, rows, DESPIKE_THRESHOLD_M)
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
