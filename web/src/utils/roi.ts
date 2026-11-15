import type { LngLat } from '../types/workspace'

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
