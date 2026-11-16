import type { LocationResult } from '../api/client'
import type { LngLat } from '../types/workspace'

export type AdministrativeGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

export type RoiGeometry = Extract<AdministrativeGeometry, { type: 'Polygon' | 'MultiPolygon' }>
export const MIN_LOCATION_RADIUS_KM = 1
export const MAX_LOCATION_RADIUS_KM = 15
export const DEFAULT_LOCATION_RADIUS_KM = 5
export const MAX_ROI_AXIS_DEGREES = 0.6

export interface EffectiveRoiMetadata {
  name: string
  center: [number, number]
  radius_km: number
  applied_radius_km: number
  source: string
  generation: string
}

export function isRoiGeometry(value: unknown): value is RoiGeometry {
  if (!value || typeof value !== 'object') return false
  const geometry = value as RoiGeometry
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return false
  const validRing = (ring: unknown) => Array.isArray(ring) && ring.length >= 4 &&
    ring.every(point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(n => typeof n === 'number' && Number.isFinite(n))) &&
    JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1])
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every(validRing))
}

export function isRectangularEffectiveRoi(value: unknown): value is Extract<RoiGeometry, { type: 'Polygon' }> {
  if (!isRoiGeometry(value) || value.type !== 'Polygon' || value.coordinates.length !== 1) return false
  const ring = value.coordinates[0]
  if (!ring || ring.length !== 5 || JSON.stringify(ring[0]) !== JSON.stringify(ring[4])) return false
  if (ring.some(([lng, lat]) => lng < -180 || lng > 180 || lat < -90 || lat > 90)) return false
  const xs = ring.map(point => point[0]), ys = ring.map(point => point[1])
  const west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys)
  if (east <= west || north <= south || east - west > MAX_ROI_AXIS_DEGREES || north - south > MAX_ROI_AXIS_DEGREES) return false
  const corners = new Set([[west, south], [east, south], [east, north], [west, north]].map(point => JSON.stringify(point)))
  return new Set(ring.slice(0, 4).map(point => JSON.stringify(point))).size === 4 &&
    ring.slice(0, 4).every(point => corners.has(JSON.stringify(point)))
}

/**
 * Acepta cualquier geometría de ROI válida cuyos ejes de bounding box no excedan
 * el límite angular. Para las generaciones rectangulares exige la forma rectangular
 * como invariante adicional; para 'administrative_original' conserva Polygon/MultiPolygon.
 */
export function isAcceptableEffectiveRoi(value: unknown, generation?: string): value is RoiGeometry {
  const rectangularGeneration = generation === 'administrative_rectangle' || generation === 'point_geodesic_square'
  if (rectangularGeneration) return isRectangularEffectiveRoi(value)
  return isRoiGeometry(value) && !exceedsRoiSizeLimit(value)
}

export function roiGenerationNotice(generation: string, appliedRadiusKm: number): string | null {
  if (!Number.isFinite(appliedRadiusKm) || appliedRadiusKm <= 0) return null
  const radius = `${Number(appliedRadiusKm.toFixed(2))} km`
  if (generation === 'point_geodesic_square') return `No se pudieron encontrar los límites automáticos de la región. Se generó un área rectangular con un radio de ${radius} alrededor del punto seleccionado.`
  if (generation === 'administrative_rectangle') return `Los límites de la región superan el área de análisis configurada. Se generó un rectángulo centrado en un punto interior, con un radio de ${radius}.`
  return null
}

export function isValidGcovDateRange(start: string, end: string): boolean {
  return !start || !end || start <= end
}

export interface GcovMetadata {
  scene_id: string; product: string; start_time: string; track: number | null; frame: number | null
  direction: string | null; polarizations: string[]; crid: string | null; maturity: string | null
}

export function compareGcovMetadata(a: GcovMetadata, b: GcovMetadata): { compatible: boolean; checks: Array<{ field: string; matches: boolean }> } {
  const values = [
    a.product === 'GCOV' && b.product === 'GCOV', a.track != null && a.track === b.track,
    a.frame != null && a.frame === b.frame, Boolean(a.direction) && a.direction === b.direction,
    a.polarizations.length > 0 && [...a.polarizations].sort().join('|') === [...b.polarizations].sort().join('|'),
    Boolean(a.crid) && a.crid === b.crid, Boolean(a.maturity) && a.maturity === b.maturity,
    a.scene_id !== b.scene_id && a.start_time !== b.start_time,
  ]
  const fields = ['Producto GCOV', 'Trayectoria', 'Marco', 'Dirección', 'Polarizaciones', 'CRID', 'Madurez', 'Adquisiciones distintas']
  const checks = fields.map((field, index) => ({ field, matches: values[index] }))
  return { compatible: values.every(Boolean), checks }
}

/** Dos esquinas opuestas; anillo abierto para las herramientas del mapa. */
export function rectangleFromCorners(a: LngLat, b: LngLat): LngLat[] {
  const west = Math.min(a[0], b[0]), east = Math.max(a[0], b[0])
  const south = Math.min(a[1], b[1]), north = Math.max(a[1], b[1])
  if (![west, east, south, north].every(Number.isFinite) || west < -180 || east > 180 || south < -85 || north > 85)
    throw new Error('Coordenadas fuera de EPSG:4326 (latitud entre −85 y 85).')
  if (west === east || south === north) throw new Error('Selecciona dos esquinas con ancho y alto distintos de cero.')
  if (east - west > 0.6 || north - south > 0.6) throw new Error('La ROI admite como máximo 0.6 grados por lado.')
  return [[west, south], [east, south], [east, north], [west, north]]
}

export function geometryBounds(geometry: AdministrativeGeometry): [number, number, number, number] {
  const coords: number[][] = []
  const collect = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') coords.push(value)
    else value.forEach(collect)
  }
  collect(geometry.coordinates)
  if (!coords.length) throw new Error('La geometría no contiene coordenadas.')
  const xs = coords.map((point) => point[0]), ys = coords.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function exceedsRoiSizeLimit(geometry: Extract<AdministrativeGeometry, { type: 'Polygon' | 'MultiPolygon' }>, maxDegrees = MAX_ROI_AXIS_DEGREES): boolean {
  const [west, south, east, north] = geometryBounds(geometry)
  return east - west > maxDegrees || north - south > maxDegrees
}

export function isBoundedAdministrativeGeometry(geometry: unknown): geometry is Extract<AdministrativeGeometry, {type: 'Polygon' | 'MultiPolygon'}> {
  if (!geometry || typeof geometry !== 'object') return false
  const candidate = geometry as AdministrativeGeometry
  if (candidate.type !== 'Polygon' && candidate.type !== 'MultiPolygon') return false
  try {
    const [west, south, east, north] = geometryBounds(candidate)
    return Number.isFinite(west + south + east + north) && east > west && north > south
  } catch { return false }
}

/** Anillo rectangular sin repetir el punto inicial; null si la geometría no es rectangular. */
export function automaticCropRing(effectiveRoi: unknown): LngLat[] | null {
  if (!isRectangularEffectiveRoi(effectiveRoi)) return null
  const ring = effectiveRoi.coordinates[0]
  return ring.slice(0, 4).map(([lng, lat]) => [lng, lat])
}

function ringArea(ring: number[][]): number {
  let area = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) / 2
}

/**
 * Devuelve el anillo exterior de una geometría de ROI. Para MultiPolygon se usa
 * el anillo exterior de la parte de mayor área aproximada. Esto es sólo para la
 * máscara visual de recorte, centrado y guardias del lienzo; el análisis, la
 * persistencia y la búsqueda GCOV siempre usan la geometría completa.
 */
export function geometryToOuterRing(geometry: Extract<AdministrativeGeometry, {type: 'Polygon' | 'MultiPolygon'}>): LngLat[] | null {
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0]
    return ring?.slice(0, -1).map(([lng, lat]) => [lng, lat]) ?? null
  }
  const parts = geometry.coordinates
  if (!parts.length) return null
  let bestIndex = 0
  let bestArea = ringArea(parts[0][0])
  for (let i = 1; i < parts.length; i++) {
    const area = ringArea(parts[i][0])
    if (area > bestArea) { bestArea = area; bestIndex = i }
  }
  const ring = parts[bestIndex][0]
  return ring?.slice(0, -1).map(([lng, lat]) => [lng, lat]) ?? null
}

export function isAnalysisRoiActive(effectiveRoi: unknown, croppedRegion: unknown): boolean {
  return Boolean(effectiveRoi && isRoiGeometry(effectiveRoi)) || Boolean(Array.isArray(croppedRegion) && croppedRegion.length >= 3)
}

export function isCurrentRoiRequest(requestRoiKey: string, currentRoiKey: string, requestVersion: number, currentVersion: number): boolean {
  return requestRoiKey === currentRoiKey && requestVersion === currentVersion
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function baseName(result: LocationResult): string {
  return result.name.split(',')[0]?.trim() || result.name
}

function regionContext(result: LocationResult): string[] {
  const a = result.address
  const parts: (string | undefined)[] = [a.country, a.state, a.region, a.county]
  return parts.filter((p): p is string => Boolean(p))
}

/** Muestra el nombre del lugar; la jerarquía se conserva solo para desambiguar. */
export function formatLocationResultLabel(result: LocationResult): { primary: string; secondary: string } {
  const base = baseName(result)
  const primary = base
  const secondary = regionContext(result)
    .filter(part => normalizeName(part) !== normalizeName(base))
    .join(', ')
  return { primary, secondary }
}

/**
 * Clave estable para renderizar resultados. Usa `place_id` cuando está disponible;
 * de lo contrario combina nombre, tipo y jerarquía para evitar claves duplicadas
 * sin perder entidades distintas que compartan nombre.
 */
export function getLocationResultKey(result: LocationResult): string {
  if (result.place_id != null) return `place:${result.place_id}`
  const a = result.address
  return [normalizeName(baseName(result)), result.type ?? '', a.country ?? '', a.state ?? '', a.municipality ?? a.city ?? a.town ?? a.village ?? ''].join('|')
}

/**
 * Refuerzo de deduplicación en frontend. Elimina duplicados exactos por identidad
 * (`place_id`) y prefiere un resultado con geometría administrativa sobre un punto
 * con la misma clave. No fusiona entidades diferentes que compartan nombre.
 */
export function deduplicateLocationResults(results: LocationResult[]): LocationResult[] {
  const seen = new Map<string, { index: number; result: LocationResult }>()
  results.forEach((result, index) => {
    const key = getLocationResultKey(result)
    const existing = seen.get(key)
    const hasPolygon = result.geometry.type === 'Polygon' || result.geometry.type === 'MultiPolygon'
    if (!existing || (hasPolygon && !(existing.result.geometry.type === 'Polygon' || existing.result.geometry.type === 'MultiPolygon'))) {
      seen.set(key, { index, result })
    }
  })
  return Array.from(seen.values())
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.result)
}
