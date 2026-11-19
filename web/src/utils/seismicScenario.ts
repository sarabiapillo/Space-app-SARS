/**
 * Escenario sísmico de cada mapa: el simulador sirve para sismos NUEVOS en la región elegida, no solo
 * para repetir sismos históricos. Si un mapa no tiene escenario propio (o tiene uno automático que el
 * usuario aún no ha tocado), se crea uno en el centro de su ROI o, sin ROI, en el centro del mapa.
 */
import type { LngLat, SeismicSimulationState } from '../types/workspace'

type Ring = ReadonlyArray<ReadonlyArray<number>>
type RoiLike = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] }

function ringCenter(ring: Ring): LngLat {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const [lng, lat] of ring) {
    if (lng === undefined || lat === undefined) continue
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }
  const round = (v: number) => Math.round(v * 1e6) / 1e6
  return [round((minLng + maxLng) / 2), round((minLat + maxLat) / 2)]
}

/** Centro de la caja de la región: ROI efectiva, si no el recorte manual, si no el centro del mapa. */
export function regionCenter(effectiveRoi: RoiLike | null | undefined, croppedRegion: LngLat[] | null | undefined, mapCenter: LngLat): LngLat {
  if (effectiveRoi) {
    const ring = effectiveRoi.type === 'Polygon' ? effectiveRoi.coordinates[0] : effectiveRoi.coordinates[0]?.[0]
    if (ring && ring.length >= 3) return ringCenter(ring)
  }
  if (croppedRegion && croppedRegion.length >= 3) return ringCenter(croppedRegion)
  return mapCenter
}

/** Escenario nuevo (no histórico) en `center`, sin simular. `autoPlaced` = aún no lo tocó el usuario. */
export function newSeismicScenario(center: LngLat, mapName: string): SeismicSimulationState {
  return {
    enabled: false,
    epicenter: center,
    magnitude: 7.0,
    depthKm: 20,
    name: `Sismo nuevo — ${mapName}`,
    mechanism: 'subduction',
    soilType: 'intermediate',
    vs30: 450,
    station: null,
    stationVs30: null,
    pickingEpicenter: false,
    pickingStation: false,
    simulated: false,
    autoPlaced: true,
  }
}

interface MapLike {
  nombre: string
  centro: LngLat
  croppedRegion?: LngLat[] | null
  effectiveRoi?: RoiLike | null
  seismic?: SeismicSimulationState
}

/**
 * Escenario que corresponde a un mapa. Respeta el escenario guardado del mapa; si no hay, o si es
 * automático y no se ha simulado ni editado, lo coloca en la región actual del mapa.
 */
export function seismicForMap(map: MapLike): SeismicSimulationState {
  const center = regionCenter(map.effectiveRoi, map.croppedRegion, map.centro)
  const own = map.seismic
  if (!own) return newSeismicScenario(center, map.nombre)
  if (own.autoPlaced && !own.simulated) return { ...own, epicenter: center, name: `Sismo nuevo — ${map.nombre}` }
  return own
}

const SCENARIO_FIELDS = ['epicenter', 'magnitude', 'depthKm', 'mechanism', 'soilType', 'vs30', 'station', 'stationVs30', 'simulated'] as const

/** Si el cambio toca el escenario (no solo modos de selección o visibilidad), deja de ser automático. */
export function markEdited(prev: SeismicSimulationState, next: SeismicSimulationState): SeismicSimulationState {
  if (!next.autoPlaced) return next
  const changed = SCENARIO_FIELDS.some((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null))
  return changed ? { ...next, autoPlaced: false } : next
}
