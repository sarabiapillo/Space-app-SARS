import type {
  EscenaNisar,
  Footprint,
  LngLat,
  MapAnnotation,
  SolarSimulationState,
  WorkspaceMap,
} from '../types/workspace'
import { buildAnnotationsGeoJSON } from '../utils/geojson'

export const ESCENA_CHIAPAS: Readonly<EscenaNisar> = Object.freeze({
  granuleId: 'NISAR_L2_PR_GSLC_034_062_A_010_4005_DHDH_A_20261028',
  epsg: 32615,
  banda: 'L-Band HH+HV',
  fuente: 'NASA Earthdata / ASF Vertex',
})

export const CHIAPAS_CENTRO: LngLat = [-93.12, 16.75]
export const CHIAPAS_ZOOM = 8.4

/** Imagen de radar superpuesta. */
export const NISAR_IMAGE_URL = '/nisar_chiapas.jpg'

/** Coordenadas aproximadas de la escena en Chiapas: sup-izq, sup-der, inf-der, inf-izq. */
export const NISAR_FOOTPRINT: Footprint = [
  [-94.15, 18.25],
  [-91.85, 17.85],
  [-92.3, 15.3],
  [-94.6, 15.7],
]

export const DEFAULT_SOLAR: Readonly<SolarSimulationState> = Object.freeze({
  enabled: false,
  sunAngle: 110,
  radiationIntensity: 65,
})

export const MAPA_GENERAL_ID = 'mapa-general-chiapas'

/** Estado base de solo lectura. */
export const MAPA_GENERAL: Readonly<WorkspaceMap> = Object.freeze({
  id: MAPA_GENERAL_ID,
  nombre: 'Mapa General - Chiapas',
  carpeta: null,
  fechaModificacion: '2026-11-14T00:00:00.000Z',
  esEditable: false,
  opacidadSar: 70,
  centro: CHIAPAS_CENTRO,
  zoom: CHIAPAS_ZOOM,
  escena: ESCENA_CHIAPAS,
  annotations: [],
  geojson: buildAnnotationsGeoJSON([], [], null),
  croppedRegion: null,
  solar: DEFAULT_SOLAR,
})

const MINUTO = 60_000
const DIA = 24 * 60 * MINUTO

/** Copias iniciales de ejemplo si `localStorage` está vacío. */
export function createInitialCopies(now: number = Date.now()): WorkspaceMap[] {
  const c1Annotations: MapAnnotation[] = [
    {
      id: 'init-warn-malpaso',
      kind: 'advertencia',
      center: [-93.6, 17.17],
      radiusKm: 5.2,
      label: 'Zona de Advertencia',
    },
  ]
  const c2Annotations: MapAnnotation[] = [
    {
      id: 'init-danger-sierra',
      kind: 'peligro',
      center: [-93.0, 15.95],
      radiusKm: 6.5,
      label: 'Zona de Peligro',
    },
  ]

  return [
    {
      id: 'copia-1-presa-malpaso',
      nombre: 'Copia 1 - Presa Malpaso',
      carpeta: 'Mis Análisis',
      fechaModificacion: new Date(now - 5 * MINUTO).toISOString(),
      esEditable: true,
      opacidadSar: 75,
      centro: [-93.6, 17.17],
      zoom: 10.2,
      escena: { ...ESCENA_CHIAPAS },
      annotations: c1Annotations,
      geojson: buildAnnotationsGeoJSON(c1Annotations, [], null),
      croppedRegion: null,
      solar: { enabled: false, sunAngle: 105, radiationIntensity: 60 },
    },
    {
      id: 'copia-2-sierra',
      nombre: 'Copia 2 - Sierra',
      carpeta: 'Zonas de Riesgo',
      fechaModificacion: new Date(now - DIA).toISOString(),
      esEditable: true,
      opacidadSar: 60,
      centro: [-93.0, 15.95],
      zoom: 9.4,
      escena: { ...ESCENA_CHIAPAS },
      annotations: c2Annotations,
      geojson: buildAnnotationsGeoJSON(c2Annotations, [], null),
      croppedRegion: null,
      solar: { enabled: true, sunAngle: 125, radiationIntensity: 70 },
    },
  ]
}
