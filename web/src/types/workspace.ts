import type { GeoJSONFeatureCollection } from '../utils/geojson'

/**
 * Tipos del espacio de trabajo de mapas de TerraPulse AI.
 */

/** Carpetas disponibles para organizar las copias editables. */
export type Carpeta = 'Mis Análisis' | 'Zonas de Riesgo'

export const CARPETAS: readonly Carpeta[] = ['Mis Análisis', 'Zonas de Riesgo']

/** Coordenada geográfica en el orden que usa MapLibre: [longitud, latitud] (EPSG:4326). */
export type LngLat = [number, number]

/** Las cuatro esquinas de una imagen georreferenciada: sup-izq, sup-der, inf-der, inf-izq. */
export type Footprint = [LngLat, LngLat, LngLat, LngLat]

/** Modo de visualización en la cabecera. */
export type ViewMode = 'general' | 'editado'

/** Tipo de ventana acoplable del área central. */
export type DockWindowKind = 'map' | 'agua'

/** Ventana acoplable del área central (pestaña de mapa o de agua/DG2). */
export interface DockWindow {
  id: string
  kind: DockWindowKind
  /** Consecutivo dentro de su tipo, usado en la etiqueta de la pestaña. */
  index: number
}

/** Herramientas de la barra flotante inferior en "Mapa Editado". */
export type DrawTool = 'mover' | 'lapiz' | 'peligro' | 'advertencia' | 'poligono' | 'etiqueta'

/** Figura o anotación dibujada por el usuario sobre una copia del mapa. */
export type MapAnnotation =
  | {
      id: string
      kind: 'lapiz'
      points: LngLat[]
    }
  | {
      id: string
      kind: 'peligro' | 'advertencia'
      center: LngLat
      radiusKm: number
      label: string
    }
  | {
      id: string
      kind: 'etiqueta'
      position: LngLat
      text: string
    }

/** Configuración de la Simulación Solar guardada por cada mapa. */
export interface SolarSimulationState {
  /** Si el panel y el efecto térmico están visibles/activos. */
  enabled: boolean
  /** Ángulo solar de 0° (06:00 Este) a 180° (18:00 Oeste). 90° = 12:00. */
  sunAngle: number
  /** Intensidad de calor / radiación proyectada (0 a 100%). */
  radiationIntensity: number
  /** ID de la zona o ROI seleccionada (ej. 'sumidero', 'chicoasen', 'tuxtla', 'sancristobal', 'custom_roi', 'current_view'). */
  selectedZoneId?: string
  /** URL de la imagen PNG de previsualización generada por el backend (/api/solar/simulations/.../preview/incident). */
  rasterPreviewUrl?: string | null
  /** Límites geográficos de la capa de radiación calculada [west, south, east, north]. */
  rasterBounds?: [number, number, number, number] | null
  /** Si se debe superponer la capa ráster calculada sobre el mapa. */
  showRasterOnMap?: boolean
}

/** Metadatos de la escena y pila NISAR GCOV asociada al mapa (Contrato C1 real en `data/raw/`). */
export interface EscenaNisar {
  granuleId: string
  t1SceneId: string
  t2SceneId: string
  producto: string
  descripcionProducto: string
  epsg: number
  resolucionM: string
  coberturaRoiPct: string
  banda: string
  polarizacion: string
  madurez: 'BETA' | 'PROVISIONAL' | 'VALIDATED'
  cicloRepeticion: string
  pila: 'T62/F10' | 'T55/F80' | 'T156/F80'
  direccion: 'ASCENDING' | 'DESCENDING'
  t1: string
  t2: string
  crid: string
  unidad: string
  fuente: string
}

export interface WorkspaceMap {
  id: string
  nombre: string
  /** `null` solo para el Mapa General. */
  carpeta: Carpeta | null
  /** Fecha ISO 8601 de la última modificación. */
  fechaModificacion: string
  esEditable: boolean
  /** Opacidad de la capa SAR superpuesta, de 0 a 100. */
  opacidadSar: number
  centro: LngLat
  zoom: number
  escena: EscenaNisar
  /** Dibujos guardados en esta copia (lápiz, círculos, etiquetas). */
  annotations: MapAnnotation[]
  /** Colección GeoJSON de las figuras de esta copia persistida en `localStorage`. */
  geojson: GeoJSONFeatureCollection
  /** Polígono activo de recorte si el usuario aplicó "Recortar región". */
  croppedRegion: LngLat[] | null
  /** Configuración del Simulador Solar para esta copia. */
  solar: SolarSimulationState
  /** Configuración y estado de la Simulación de Inundación / Lluvia DG2. */
  flood?: FloodSimulationState
}

/** Configuración de la Simulación de Inundación y Encharcamientos guardada por mapa. */
export interface FloodSimulationState {
  enabled: boolean
  selectedZoneId: string
  rainfallAmount: number
  rainfallDuration: number
  pressureHpa?: number
  compareMode?: boolean
  compareSwipePct?: number
  rasterUrl: string | null
  rasterBounds: [number, number, number, number] | null
  showRasterOnMap: boolean
  waterOpacity: number
  stats?: {
    rainfallMm: number
    durationHours: number
    stormDays?: number
    pressureHpa?: number
    baroSurgeCm?: number
    saturationPct?: number
    totalVolumeM3: number
    effectiveVolumeM3?: number
    infiltratedVolumeM3?: number
    floodedVolumeM3?: number
    effectiveRunoffMm?: number
    infiltratedMm?: number
    floodedAreaKm2: number
    floodedAreaPct: number
    maxDepthM: number
    meanDepthM: number
    waterSurfaceHa: number
    peakDischargeM3s?: number
    maxVelocityMs?: number
    meanVelocityMs?: number
    froudeNumber?: number
    froudeRegime?: string
    timeOfConcentrationMin?: number
    timeOfConcentrationHours?: number
    elevMinM?: number
    elevMaxM?: number
    waterLevelMinM?: number
    waterLevelMaxM?: number
    roadsTotalAffectedKm?: number
    roadsCutKm?: number
    roadsWarningKm?: number
    riskLevel?: string
    riskDescription?: string
  } | null
  /** Datos para las gráficas del simulador (solo los devuelve el backend NASADEM). */
  charts?: FloodChartsData | null
  /** De dónde salieron las cifras: cálculo del backend con NASADEM o generador local de respaldo. */
  statsSource?: 'backend' | 'local'
}

/** Una clase de calado del ráster de inundación (mismos cortes que la paleta del mapa). */
export interface FloodDepthClass {
  desde_m: number
  hasta_m: number | null
  celdas: number
  area_km2: number
  pct_mojado: number
}

export interface FloodChartsData {
  depth_classes: FloodDepthClass[]
  cell_size_m: number
  wet_threshold_m: number
}

/** Vista de cámara del mapa. */
export interface MapView {
  centro: LngLat
  zoom: number
}
