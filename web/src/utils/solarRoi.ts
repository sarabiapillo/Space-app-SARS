import type { LngLat } from '../types/workspace'
import type { RoiGeometry } from './roi'

/** Keep the exact confirmed user polygon; backend validates its resource limits. */
export function solarRoiGeometry(effectiveRoi: RoiGeometry | null | undefined, region: LngLat[] | null): RoiGeometry {
  return effectiveRoi ?? confirmedSolarRoi(region)
}

export function confirmedSolarRoi(region: LngLat[] | null): { type: 'Polygon'; coordinates: LngLat[][] } {
  if (!region || region.length < 3 || region.length > 1000 || region.some(([lon, lat]) =>
    !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)) {
    throw new Error('Delimitá y confirmá una ROI válida antes de calcular.')
  }
  const ring = region.map(([lon, lat]): LngLat => [lon, lat])
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([...ring[0]])
  const area = ring.slice(0, -1).reduce((sum, [x, y], i) => sum + x * ring[i + 1][1] - ring[i + 1][0] * y, 0)
  if (Math.abs(area) < 1e-12) throw new Error('La ROI delimitada no tiene área válida.')
  return { type: 'Polygon', coordinates: [ring] }
}
