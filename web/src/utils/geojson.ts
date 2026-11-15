import type { LngLat, MapAnnotation } from '../types/workspace'

export interface GeoJSONFeature<G = unknown, P = Record<string, unknown>> {
  type: 'Feature'
  id?: string
  geometry: G
  properties: P
}

export interface GeoJSONFeatureCollection<G = unknown, P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: GeoJSONFeature<G, P>[]
}

/**
 * Genera un anillo cerrado de `vertices` puntos (por defecto 64) que aproxima un círculo
 * georreferenciado de `radiusKm` kilómetros alrededor de `center` ([lng, lat]).
 */
export function createCirclePolygonCoords(
  center: LngLat,
  radiusKm: number,
  vertices = 64,
): LngLat[] {
  const [lng, lat] = center
  const latRad = (lat * Math.PI) / 180
  const degLatPerKm = 1 / 110.574
  const degLngPerKm = 1 / (111.32 * Math.max(0.15, Math.cos(latRad)))

  const ring: LngLat[] = []
  for (let i = 0; i < vertices; i++) {
    const theta = (i / vertices) * Math.PI * 2
    const dLng = Math.cos(theta) * radiusKm * degLngPerKm
    const dLat = Math.sin(theta) * radiusKm * degLatPerKm
    ring.push([Number((lng + dLng).toFixed(6)), Number((lat + dLat).toFixed(6))])
  }
  ring.push(ring[0])
  return ring
}

/** Calcula la distancia geodésica aproximada en kilómetros entre dos puntos [lng, lat]. */
export function distanceKm(a: LngLat, b: LngLat): number {
  const meanLatRad = (((a[1] + b[1]) / 2) * Math.PI) / 180
  const dx = (b[0] - a[0]) * 111.32 * Math.cos(meanLatRad)
  const dy = (b[1] - a[1]) * 110.574
  return Math.hypot(dx, dy)
}

/**
 * Construye el `FeatureCollection` GeoJSON para la fuente `annotations-source` de MapLibre,
 * incluyendo los trazos guardados y cualquier trazo/círculo en curso (borrador).
 */
export function buildAnnotationsGeoJSON(
  annotations: MapAnnotation[],
  draftFreehand: LngLat[],
  draftCircle: { kind: 'peligro' | 'advertencia'; center: LngLat; radiusKm: number } | null,
): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = []

  for (const ann of annotations) {
    if (ann.kind === 'lapiz' && ann.points.length >= 2) {
      features.push({
        type: 'Feature',
        id: ann.id,
        properties: { id: ann.id, kind: 'lapiz' },
        geometry: {
          type: 'LineString',
          coordinates: ann.points,
        },
      })
    } else if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
      const ring = createCirclePolygonCoords(ann.center, ann.radiusKm, 64)
      features.push({
        type: 'Feature',
        id: ann.id,
        properties: {
          id: ann.id,
          kind: ann.kind,
          label: ann.label,
          radiusKm: ann.radiusKm,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      })
    } else if (ann.kind === 'etiqueta') {
      features.push({
        type: 'Feature',
        id: ann.id,
        properties: {
          id: ann.id,
          kind: 'etiqueta',
          text: ann.text,
        },
        geometry: {
          type: 'Point',
          coordinates: ann.position,
        },
      })
    }
  }

  if (draftFreehand.length >= 2) {
    features.push({
      type: 'Feature',
      id: 'draft-freehand',
      properties: { id: 'draft-freehand', kind: 'lapiz', draft: true },
      geometry: {
        type: 'LineString',
        coordinates: draftFreehand,
      },
    })
  }

  if (draftCircle) {
    const ring = createCirclePolygonCoords(draftCircle.center, draftCircle.radiusKm, 64)
    features.push({
      type: 'Feature',
      id: 'draft-circle',
      properties: { id: 'draft-circle', kind: draftCircle.kind, draft: true },
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    })
  }

  return { type: 'FeatureCollection', features }
}

/**
 * Construye el `FeatureCollection` para el polígono en construcción ("Seleccionar Región"):
 * - `Polygon` si hay 3 o más puntos
 * - `LineString` conectando los puntos
 * - `Point` por cada vértice para renderizar círculos blancos con borde verde `#10B981`
 */
export function buildDraftPolygonGeoJSON(points: LngLat[]): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = []

  if (points.length >= 3) {
    features.push({
      type: 'Feature',
      properties: { featureType: 'fill' },
      geometry: {
        type: 'Polygon',
        coordinates: [[...points, points[0]]],
      },
    })
  }

  if (points.length >= 2) {
    const lineCoords = points.length >= 3 ? [...points, points[0]] : points
    features.push({
      type: 'Feature',
      properties: { featureType: 'line' },
      geometry: {
        type: 'LineString',
        coordinates: lineCoords,
      },
    })
  }

  points.forEach((pt, index) => {
    features.push({
      type: 'Feature',
      properties: { featureType: 'vertex', index },
      geometry: {
        type: 'Point',
        coordinates: pt,
      },
    })
  })

  return { type: 'FeatureCollection', features }
}

const WORLD_EXTERIOR_RING: LngLat[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
]

/**
 * Construye el GeoJSON de MÁSCARA INVERSA para "Recortar región":
 * Un `Polygon` cuyo anillo exterior es el mundo entero y cuyo anillo interior (hueco)
 * son las coordenadas del polígono seleccionado, además de un `LineString` para el borde.
 */
export function buildInverseCropMaskGeoJSON(
  croppedRegion: LngLat[] | null,
): GeoJSONFeatureCollection {
  if (!croppedRegion || croppedRegion.length < 3) {
    return { type: 'FeatureCollection', features: [] }
  }

  const closedHole: LngLat[] = [...croppedRegion, croppedRegion[0]]

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { role: 'mask' },
        geometry: {
          type: 'Polygon',
          coordinates: [WORLD_EXTERIOR_RING, closedHole],
        },
      },
      {
        type: 'Feature',
        properties: { role: 'border' },
        geometry: {
          type: 'LineString',
          coordinates: closedHole,
        },
      },
    ],
  }
}

/** Calcula bounding box `[minLng, minLat, maxLng, maxLat]` y centroide de una lista de puntos. */
export function getPolygonBoundsAndCentroid(points: LngLat[]): {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
  centroid: LngLat
} {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  let sumLng = 0
  let sumLat = 0

  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
    sumLng += lng
    sumLat += lat
  }

  const n = Math.max(1, points.length)
  return {
    minLng,
    minLat,
    maxLng,
    maxLat,
    centroid: [sumLng / n, sumLat / n],
  }
}

/**
 * Interpola el color `hillshade-highlight-color` según la intensidad de radiación (0% a 100%)
 * desde `#FDE047` (calor bajo/medio) pasando por `#F97316` hasta `#EF4444` (mayor calor).
 */
export function interpolateThermalHighlight(intensityPercent: number): string {
  const t = Math.max(0, Math.min(100, intensityPercent)) / 100

  const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')

  // 0.0 -> #FDE047 (253, 224, 71)
  // 0.5 -> #F97316 (249, 115, 22)
  // 1.0 -> #EF4444 (239, 68, 68)
  if (t <= 0.5) {
    const u = t / 0.5
    return `#${toHex(lerp(253, 249, u))}${toHex(lerp(224, 115, u))}${toHex(lerp(71, 22, u))}`
  }
  const u = (t - 0.5) / 0.5
  return `#${toHex(lerp(249, 239, u))}${toHex(lerp(115, 68, u))}${toHex(lerp(22, 68, u))}`
}
