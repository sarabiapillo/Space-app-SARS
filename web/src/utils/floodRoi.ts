import type { LngLat } from '../types/workspace'

export interface FloodPolygon { type: 'Polygon'; coordinates: [number, number][][] }

/** Convierte solo el anillo dibujado/seleccionado en el mapa a Polygon GeoJSON válido. */
export function floodRoiPolygon(region: LngLat[] | null | undefined): FloodPolygon | null {
  if (!region || region.length < 3) return null
  const ring = region.map(([lng, lat]) => [lng, lat] as [number, number])
  if (ring.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90)) return null
  const first = ring[0], last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first])
  if (ring.length < 4) return null
  if (ring.some((point, i) => i > 0 && Math.abs(point[0] - ring[i - 1][0]) > 180)) return null
  const vertices = ring.slice(0, -1)
  if (new Set(vertices.map(([lng, lat]) => `${lng},${lat}`)).size < 3) return null
  if (vertices.some((point, index) => point[0] === ring[index + 1][0] && point[1] === ring[index + 1][1])) return null
  const area = vertices.reduce((sum, point, i) => {
    const next = ring[i + 1]
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)
  if (area === 0 || selfIntersects(ring)) return null
  return { type: 'Polygon', coordinates: [ring] }
}

function selfIntersects(ring: [number, number][]): boolean {
  const n = ring.length - 1
  const orient = (a: number[], b: number[], c: number[]) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  const onSegment = (a: number[], b: number[], p: number[]) =>
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) {
    if (j === i+1 || (i === 0 && j === n-1)) continue
    const a=ring[i], b=ring[i+1], c=ring[j], d=ring[j+1]
    const o1=orient(a,b,c), o2=orient(a,b,d), o3=orient(c,d,a), o4=orient(c,d,b)
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true
    if ((o1 === 0 && onSegment(a,b,c)) || (o2 === 0 && onSegment(a,b,d)) ||
        (o3 === 0 && onSegment(c,d,a)) || (o4 === 0 && onSegment(c,d,b))) return true
  }
  return false
}
