import type {
  EscenaNisar,
  Footprint,
  LngLat,
  MapAnnotation,
  SolarSimulationState,
  WorkspaceMap,
} from '../types/workspace'
import { buildAnnotationsGeoJSON } from '../utils/geojson'

/**
 * Etiquetas de las anotaciones dibujadas a mano. Son marcas del usuario, no resultados: aún no
 * hay mapa de cambio (C2) ni validación (C3), así que no pueden nombrar anomalías ni causas
 * (AGENTS.md §2).
 */
export const DANGER_CIRCLE_DEFAULT_LABEL = 'Zona marcada (rojo) · anotación manual'

export const DANGER_CIRCLE_TOOLTIP =
  'Círculo dibujado por el usuario. No es una detección ni un resultado del análisis.'

export const WARN_CIRCLE_DEFAULT_LABEL = 'Zona marcada (ámbar) · anotación manual'

export const WARN_CIRCLE_TOOLTIP =
  'Círculo dibujado por el usuario. No es una detección ni un resultado del análisis.'

/** Etiquetas que versiones anteriores guardaron en localStorage y que afirmaban resultados inexistentes. */
export const LEGACY_CIRCLE_LABELS: readonly string[] = [
  'Zona de Peligro',
  'Zona de Advertencia',
  'Hipótesis N2O / N2IV: Caída especular o Doble rebote HH',
  'Anomalía CUMSUM L-HV (Umbral bosque -13 dB)',
]

/** WKT oficial de la ROI en Chiapas (`pipeline/config.yaml` y `data/raw/<scene_id>/scene.json`). */
export const CHIAPAS_ROI_WKT =
  'POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))'

/** Límites geográficos exactos de la ROI de Chiapas en EPSG:4326 (`2687 × 5504 px` a `10 × 10 m` en EPSG:32615). */
export const CHIAPAS_ROI_BOUNDS = Object.freeze({
  west: -93.3919,
  south: 16.6539,
  east: -92.8757,
  north: 16.8964,
})

/** Fecha de corte en el catálogo ASF donde el CRID cambió de P05023 a P05036 (AGENTS.md §4). */
export const CRID_TRANSITION_DATE = '2026-10-23'

/** IDs reales de las 5 escenas GCOV descargadas en `data/raw/` (Contrato C1). */
export const RAW_SCENE_IDS = Object.freeze({
  T62_T1_20260618:
    'NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001',
  T62_T2_20261016:
    'NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001',
  T62_POST_20261028:
    'NISAR_L2_PR_GCOV_034_062_A_010_4005_DHDH_A_20261028T114006_20261028T114041_P05036_N_F_J_001',
  T55_T1_20260618:
    'NISAR_L2_PR_GCOV_023_055_D_080_4005_DHDH_A_20260618T004048_20260618T004123_P05023_N_F_J_001',
  T55_T2_20261016:
    'NISAR_L2_PR_GCOV_033_055_D_080_4005_DHDH_A_20261016T004045_20261016T004119_P05023_N_F_J_001',
})

export interface C1LayerSpec {
  id: 'HHHH' | 'HVHV' | 'mask' | 'numberOfLooks' | 'rtcGammaToSigmaFactor'
  archivo: string
  dtype: 'float32' | 'uint8'
  nodata: string
  descripcion: string
  /** Ruta del dataset en el .h5 (`pipeline/nisar_h5.open_grid`). */
  h5Path: string
}

/**
 * Las 5 capas reales extraídas de `Frequency A` en `data/raw/<scene_id>/` (Contrato C1).
 */
export const C1_RAW_LAYERS: readonly C1LayerSpec[] = Object.freeze([
  {
    id: 'HHHH',
    archivo: 'HHHH.tif',
    dtype: 'float32',
    nodata: 'NaN',
    descripcion: 'Potencia lineal γ⁰ co-polarizada HH (sin dB, sin máscara; 2687 × 5504 px a 10 m).',
    h5Path: 'science/LSAR/GCOV/grids/frequencyA/HHHH',
  },
  {
    id: 'HVHV',
    archivo: 'HVHV.tif',
    dtype: 'float32',
    nodata: 'NaN',
    descripcion: 'Potencia lineal γ⁰ polarización cruzada HV (sensible a volumen de dosel; sin dB).',
    h5Path: 'science/LSAR/GCOV/grids/frequencyA/HVHV',
  },
  {
    id: 'mask',
    archivo: 'mask.tif',
    dtype: 'uint8',
    nodata: 'null',
    descripcion:
      'Máscara de validez original (0 = no válido, 255 = fuera de adquisición, otro = subfranja válida).',
    h5Path: 'science/LSAR/GCOV/grids/frequencyA/mask',
  },
  {
    id: 'numberOfLooks',
    archivo: 'numberOfLooks.tif',
    dtype: 'float32',
    nodata: 'NaN',
    descripcion: 'Número efectivo de looks radiométricos por celda en malla UTM EPSG:32615.',
    h5Path: 'science/LSAR/GCOV/grids/frequencyA/numberOfLooks',
  },
  {
    id: 'rtcGammaToSigmaFactor',
    archivo: 'rtcGammaToSigmaFactor.tif',
    dtype: 'float32',
    nodata: 'NaN',
    descripcion:
      'Factor de conversión radiométrica (σ⁰ = γ⁰ · factor) entre retrodispersión corregida por terreno RTC (γ⁰) y elipsoidal (σ⁰).',
    h5Path: 'science/LSAR/GCOV/grids/frequencyA/rtcGammaToSigmaFactor',
  },
])

export interface GcovStackSpec {
  id: 'T62/F10' | 'T55/F80' | 'T156/F80'
  roleLabel: string
  track: number
  frame: number
  direction: 'ASCENDING' | 'DESCENDING'
  directionLabel: 'Ascendente' | 'Descendente'
  product: 'GCOV'
  band: string
  polarizations: readonly ['HH', 'HV']
  crid: 'P05023'
  maturity: 'PROVISIONAL'
  repeatCycleDays: 12
  roiValidPctLabel: string
  gridResolutionLabel: string
  t1SceneId: string
  t2SceneId: string
  postTransitionSceneId: string
  dates: readonly string[]
  /** Fecha posterior al cambio de procesador (P05036) para demostrar bloqueo CRID. */
  postTransitionDate: string
  defaultT1: string
  defaultT2: string
  notes: string
}

/**
 * Las 3 pilas GCOV reales sobre la ROI de Chiapas (`pipeline/config.yaml` y `data/raw/<scene_id>/scene.json`).
 * - Pila Principal: `T62/F10` (ASCENDING, 99.57% / 99.61% cobertura ROI en `data/raw/`).
 * - Pila de Respaldo: `T55/F80` (DESCENDING, ~50.28% cobertura mitad este en `data/raw/`).
 * - Pila 3: `T156/F80` (DESCENDING, 8 fechas en catálogo, sin recorte en `data/raw/`).
 */
export const PILAS_GCOV_CHIAPAS: readonly GcovStackSpec[] = Object.freeze([
  {
    id: 'T62/F10',
    roleLabel: 'Par de Trabajo Principal (data/raw/)',
    track: 62,
    frame: 10,
    direction: 'ASCENDING',
    directionLabel: 'Ascendente',
    product: 'GCOV',
    band: 'L-Band (24 cm, 1.257 GHz, Frequency A)',
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    repeatCycleDays: 12,
    roiValidPctLabel: '99.6% (t1: 99.57%, t2: 99.61%)',
    gridResolutionLabel: '10 × 10 m · EPSG:32615 (2687 × 5504 px)',
    t1SceneId: RAW_SCENE_IDS.T62_T1_20260618,
    t2SceneId: RAW_SCENE_IDS.T62_T2_20261016,
    postTransitionSceneId: RAW_SCENE_IDS.T62_POST_20261028,
    dates: [
      '2026-06-18',
      '2026-06-30',
      '2026-07-12',
      '2026-07-24',
      '2026-08-17',
      '2026-08-29',
      '2026-09-10',
      '2026-09-22',
      '2026-10-04',
      '2026-10-16',
    ],
    postTransitionDate: '2026-10-28',
    defaultT1: '2026-06-18',
    defaultT2: '2026-10-16',
    notes:
      'Par de trabajo principal en data/raw/: 99.57% (t1) y 99.61% (t2) de píxeles válidos en el polígono ROI. Incluye 5ta escena 2026-10-28 (P05036 VALIDATED).',
  },
  {
    id: 'T55/F80',
    roleLabel: 'Par de Respaldo (data/raw/ · ~50% este)',
    track: 55,
    frame: 80,
    direction: 'DESCENDING',
    directionLabel: 'Descendente',
    product: 'GCOV',
    band: 'L-Band (24 cm, 1.257 GHz, Frequency A)',
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    repeatCycleDays: 12,
    roiValidPctLabel: '~50.3% este (32.6% fuera de adquisición al oeste)',
    gridResolutionLabel: '10 × 10 m · EPSG:32615 (2687 × 5504 px)',
    t1SceneId: RAW_SCENE_IDS.T55_T1_20260618,
    t2SceneId: RAW_SCENE_IDS.T55_T2_20261016,
    postTransitionSceneId:
      'NISAR_L2_PR_GCOV_034_055_D_080_4005_DHDH_A_20261028T004045_20261028T004119_P05036_N_F_J_001',
    dates: [
      '2026-06-18',
      '2026-06-30',
      '2026-07-12',
      '2026-07-24',
      '2026-08-17',
      '2026-08-29',
      '2026-09-10',
      '2026-09-22',
      '2026-10-04',
      '2026-10-16',
    ],
    postTransitionDate: '2026-10-28',
    defaultT1: '2026-06-18',
    defaultT2: '2026-10-16',
    notes:
      'Par de respaldo descargado en data/raw/: el marco solo cubre al este de lon ≈ -93.14 (50.28% t1 / 50.25% t2).',
  },
  {
    id: 'T156/F80',
    roleLabel: 'Catálogo ASF (Sin verificar en .h5)',
    track: 156,
    frame: 80,
    direction: 'DESCENDING',
    directionLabel: 'Descendente',
    product: 'GCOV',
    band: 'L-Band (24 cm, 1.257 GHz, Frequency A)',
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    repeatCycleDays: 12,
    roiValidPctLabel: 'Sin verificar en .h5',
    gridResolutionLabel: 'EPSG:32615 (en catálogo)',
    t1SceneId:
      'NISAR_L2_PR_GCOV_024_156_D_080_4005_DHDH_A_20260625T004812_20260625T004847_P05023_N_F_J_001',
    t2SceneId:
      'NISAR_L2_PR_GCOV_033_156_D_080_4005_DHDH_A_20261011T004809_20261011T004844_P05023_N_F_J_001',
    postTransitionSceneId:
      'NISAR_L2_PR_GCOV_034_156_D_080_4005_DHDH_A_20261023T004809_20261023T004844_P05036_N_F_J_001',
    dates: [
      '2026-06-25',
      '2026-07-07',
      '2026-07-19',
      '2026-08-12',
      '2026-08-24',
      '2026-09-05',
      '2026-09-29',
      '2026-10-11',
    ],
    postTransitionDate: '2026-10-23',
    defaultT1: '2026-06-25',
    defaultT2: '2026-10-11',
    notes: 'Pila 3: 8 fechas descendentes en catálogo (2026-09-05 tiene contador 001 y 002).',
  },
])

export interface PairCompatCheckResult {
  comparable: boolean
  cridT1: 'P05023' | 'P05036'
  cridT2: 'P05023' | 'P05036'
  maturityT1: 'PROVISIONAL' | 'VALIDATED'
  maturityT2: 'PROVISIONAL' | 'VALIDATED'
  t1SceneId: string
  t2SceneId: string
  errors: string[]
  warnings: string[]
  isSyntheticMock: true
}

export function resolveSceneIdForStackDate(
  stackId: GcovStackSpec['id'],
  date: string,
): string {
  if (stackId === 'T62/F10') {
    if (date === '2026-06-18') return RAW_SCENE_IDS.T62_T1_20260618
    if (date === '2026-10-16') return RAW_SCENE_IDS.T62_T2_20261016
    if (date === '2026-10-28') return RAW_SCENE_IDS.T62_POST_20261028
  }
  if (stackId === 'T55/F80') {
    if (date === '2026-06-18') return RAW_SCENE_IDS.T55_T1_20260618
    if (date === '2026-10-16') return RAW_SCENE_IDS.T55_T2_20261016
  }
  const stack = PILAS_GCOV_CHIAPAS.find((s) => s.id === stackId) ?? PILAS_GCOV_CHIAPAS[0]
  const dirCode = stack.direction === 'ASCENDING' ? 'A' : 'D'
  const trackStr = String(stack.track).padStart(3, '0')
  const frameStr = String(stack.frame).padStart(3, '0')
  const crid = date >= CRID_TRANSITION_DATE ? 'P05036' : 'P05023'
  const compact = date.replace(/-/g, '')
  return `NISAR_L2_PR_GCOV_028_${trackStr}_${dirCode}_${frameStr}_4005_DHDH_A_${compact}T114006_${compact}T114041_${crid}_N_F_J_001`
}

/**
 * Validador visual y de reglas de comparabilidad (`pipeline/compat.py` y `data/raw/<scene_id>/scene.json`).
 * Bloquea cualquier par que cruce la fecha `2026-10-23` donde el CRID cambió de `P05023` (`PROVISIONAL`)
 * a `P05036` (`VALIDATED`), incluyendo la 5ta escena real descargada (`2026-10-28` T62/F10).
 */
export function checkPairCompat(
  t1: string,
  t2: string,
  stackId: GcovStackSpec['id'] = 'T62/F10',
): PairCompatCheckResult {
  const cridT1: 'P05023' | 'P05036' = t1 >= CRID_TRANSITION_DATE ? 'P05036' : 'P05023'
  const cridT2: 'P05023' | 'P05036' = t2 >= CRID_TRANSITION_DATE ? 'P05036' : 'P05023'
  const maturityT1: 'PROVISIONAL' | 'VALIDATED' =
    cridT1 === 'P05036' ? 'VALIDATED' : 'PROVISIONAL'
  const maturityT2: 'PROVISIONAL' | 'VALIDATED' =
    cridT2 === 'P05036' ? 'VALIDATED' : 'PROVISIONAL'

  const t1SceneId = resolveSceneIdForStackDate(stackId, t1)
  const t2SceneId = resolveSceneIdForStackDate(stackId, t2)

  const errors: string[] = []
  const warnings: string[] = []

  if (!t1 || !t2) {
    errors.push('Selecciona ambas fechas (t1 y t2) para verificar comparabilidad.')
  } else if (t1 === t2) {
    errors.push('misma adquisición: no hay intervalo temporal que comparar (t1 = t2).')
  }

  if (cridT1 !== cridT2) {
    errors.push(
      `Bloqueo por cambio de procesador (corte ${CRID_TRANSITION_DATE}): CRID '${cridT1}' (${t1}) ≠ '${cridT2}' (${t2}) [PGE R05.02.3 v1.0.11 vs R05.03.2 v1.0.20].`,
    )
    errors.push(
      `Diferencia de madurez: '${maturityT1}' ≠ '${maturityT2}' (AGENTS.md §5: prohibido mezclar PROVISIONAL con VALIDATED).`,
    )
  } else if (cridT1 === 'P05036' && cridT2 === 'P05036') {
    warnings.push(
      'La escena 2026-10-28 (P05036, VALIDATED) no tiene pareja: es la única fecha P05036 de su pila.',
    )
  }

  if (stackId === 'T62/F10' && cridT1 === 'P05023' && cridT2 === 'P05023') {
    warnings.push(
      'Malla verificada en .h5 (data/raw/): EPSG:32615, 10 × 10 m (2687 × 5504 px), cobertura válida ROI 99.57% (t1) y 99.61% (t2).',
    )
  } else if (stackId === 'T55/F80') {
    warnings.push(
      'Cobertura parcial en data/raw/: T55/F80 solo cubre ~50.3% de la ROI (mitad este, lon > -93.14; 32.6% fuera de adquisición).',
    )
    if (t1 === '2026-07-24' || t2 === '2026-07-24') {
      warnings.push(
        '2026-07-24 T55/F80 tiene un segundo producto con órbita FOE sin madurez; usar el producto MOE.',
      )
    }
  } else if (stackId === 'T156/F80') {
    warnings.push(
      'Pila T156/F80 solo en catálogo; resolución y cobertura de ROI aún no verificadas en .h5.',
    )
  }

  return {
    comparable: errors.length === 0,
    cridT1,
    cridT2,
    maturityT1,
    maturityT2,
    t1SceneId,
    t2SceneId,
    errors,
    warnings,
    isSyntheticMock: true,
  }
}

/**
 * Escena y par de trabajo principal verificados en `.h5` (`pipeline/config.yaml` y `data/raw/`):
 * Pila `T62/F10` ASCENDING (`2026-06-18` → `2026-10-16`, `CRID: P05023`, `PROVISIONAL`, cobertura `99.6%`).
 */
export const ESCENA_CHIAPAS: Readonly<EscenaNisar> = Object.freeze({
  granuleId: RAW_SCENE_IDS.T62_T1_20260618,
  t1SceneId: RAW_SCENE_IDS.T62_T1_20260618,
  t2SceneId: RAW_SCENE_IDS.T62_T2_20261016,
  producto: 'NISAR L2 GCOV',
  descripcionProducto:
    'Matriz de Covarianza Polarimétrica Geocodificada en malla UTM EPSG:32615 (10 × 10 m, 2687 × 5504 px), potencia lineal γ⁰ RTC y factor σ⁰ en dB',
  epsg: 32615,
  resolucionM: '10 × 10 m (2687 × 5504 px)',
  coberturaRoiPct: '99.6% (t1: 99.57%, t2: 99.61%)',
  banda: 'L-Band (24 cm, 1.257 GHz, Frequency A)',
  polarizacion: 'Dual-Pol (HH+HV)',
  madurez: 'PROVISIONAL',
  cicloRepeticion: '12 días',
  pila: 'T62/F10',
  direccion: 'ASCENDING',
  t1: '2026-06-18',
  t2: '2026-10-16',
  crid: 'P05023',
  unidad: 'dB (γ⁰/σ⁰)',
  fuente: 'NASA Earthdata / ASF Vertex (h5py por ventanas · Contrato C1)',
})

/** Centro exacto del polígono ROI de Chiapas: `[(-93.3919 + -92.8757)/2, (16.6539 + 16.8964)/2]`. */
export const CHIAPAS_CENTRO: LngLat = [-93.1338, 16.77515]
export const CHIAPAS_ZOOM = 10.1

export type ExploreLayerId =
  | 'gamma0_HHHH_ml2_dB'
  | 'gamma0_HVHV_ml2_dB'
  | 'sigma0_HHHH_ml2_dB'
  | 'sigma0_HVHV_ml2_dB'

export type ExploreDateViewMode = 't1' | 't2' | 'swipe'

export interface ExploreLayerEntry {
  id: ExploreLayerId
  cog: string
  png: string
  crs_cog: string
  crs_png: 'EPSG:3857' | string
  forma_cog: [number, number]
  forma_png: [number, number]
  esquinas_lonlat: Footprint
  unidades: 'dB' | string
  escala: {
    vmin_dB: number
    vmax_dB: number
    colormap: string
    metodo: string
  }
  rango_datos_dB: [number, number]
  pct_pixeles_validos: number
  capa: 'HHHH' | 'HVHV' | string
  magnitud: 'gamma0' | 'sigma0' | string
  simbolo: 'γ⁰' | 'σ⁰' | string
  multilook: number
  pixel_m: number
}

export interface ExploreWebManifest {
  version: 'explore-web-1' | string
  tipo: 'inspeccion_una_fecha' | string
  creado_utc: string
  version_codigo: string
  escena: {
    granuleId: string
    producto: string
    fecha_inicio: string
    trayectoria: number
    marco: number
    direccion: string
    crid: string
    madurez_catalogo: string | null
    frecuencia: string
    polarizaciones: string[]
  }
  roi_wkt_4326: string
  procedencia: {
    modo: string
    metodo?: string
    nombre?: string
    bytes?: number
    url?: string
    block_size_bytes?: number
    catalogo?: string
    identidad_verificada_contra_catalogo?: boolean
  }
  capas: ExploreLayerEntry[]
  figuras: string[]
  metadatos: string
  advertencias: string[]
}

export interface ExploreLayerOption {
  id: ExploreLayerId
  shortLabel: string
  title: string
}

export const EXPLORE_LAYER_OPTIONS: readonly ExploreLayerOption[] = Object.freeze([
  {
    id: 'gamma0_HHHH_ml2_dB',
    shortLabel: 'γ⁰ HH [dB]',
    title: 'Retrodispersión RTC γ⁰ HHHH en dB (multilook 2×2 · 20 m · EPSG:3857)',
  },
  {
    id: 'gamma0_HVHV_ml2_dB',
    shortLabel: 'γ⁰ HV [dB]',
    title: 'Retrodispersión RTC γ⁰ HVHV en dB (multilook 2×2 · 20 m · EPSG:3857)',
  },
  {
    id: 'sigma0_HHHH_ml2_dB',
    shortLabel: 'σ⁰ HH [dB]',
    title: 'Retrodispersión elipsoidal σ⁰ = γ⁰ · rtcGammaToSigmaFactor (HHHH en dB · 20 m)',
  },
  {
    id: 'sigma0_HVHV_ml2_dB',
    shortLabel: 'σ⁰ HV [dB]',
    title: 'Retrodispersión elipsoidal σ⁰ = γ⁰ · rtcGammaToSigmaFactor (HVHV en dB · 20 m)',
  },
])

/**
 * Esquinas exactas en EPSG:3857 (orientadas al norte) de `data/explore/<granuleId>/web/capas.json`
 * en orden MapLibre `image` source: `[sup-izq, sup-der, inf-der, inf-izq]`.
 */
export const DEFAULT_EXPLORE_ESQUINAS_LONLAT: Footprint = [
  [-93.3923862, 16.8968125],
  [-92.8756794, 16.8968125],
  [-92.8756794, 16.6535913],
  [-93.3923862, 16.6535913],
]

/** Ruta inicial por defecto servida desde `/data/explore/<granuleId>/web/gamma0_HHHH_ml2_dB.png`. */
export const NISAR_IMAGE_URL = `/data/explore/${RAW_SCENE_IDS.T62_T2_20261016}/web/gamma0_HHHH_ml2_dB.png`

/**
 * Coordenadas del polígono ROI oficial en Chiapas (`pipeline/config.yaml` y `data/raw/<scene_id>/scene.json`):
 * orden MapLibre `image` source: sup-izq (NW), sup-der (NE), inf-der (SE), inf-izq (SW).
 */
export const NISAR_FOOTPRINT: Footprint = [
  [CHIAPAS_ROI_BOUNDS.west, CHIAPAS_ROI_BOUNDS.north],
  [CHIAPAS_ROI_BOUNDS.east, CHIAPAS_ROI_BOUNDS.north],
  [CHIAPAS_ROI_BOUNDS.east, CHIAPAS_ROI_BOUNDS.south],
  [CHIAPAS_ROI_BOUNDS.west, CHIAPAS_ROI_BOUNDS.south],
]

export const DEFAULT_SOLAR: Readonly<SolarSimulationState> = Object.freeze({
  enabled: false,
  sunAngle: 110,
  radiationIntensity: 65,
})

export const MAPA_GENERAL_ID = 'mapa-general-chiapas'

/** Estado base de solo lectura (Par de trabajo principal: T62/F10 ASC, 2026-06-18 -> 2026-10-16, P05023). */
export const MAPA_GENERAL: Readonly<WorkspaceMap> = Object.freeze({
  id: MAPA_GENERAL_ID,
  nombre: 'Mapa General - Chiapas (GCOV T62/F10 · 99.6% ROI)',
  carpeta: null,
  fechaModificacion: '2026-11-15T02:43:39.000Z',
  esEditable: false,
  opacidadSar: 72,
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

/** Copias iniciales de ejemplo si `localStorage` está vacío, posicionadas dentro de la ROI real. */
export function createInitialCopies(now: number = Date.now()): WorkspaceMap[] {
  // Sin anotaciones precargadas: un círculo sobre Malpaso o el Grijalva sugería un hallazgo.
  const c1Annotations: MapAnnotation[] = []
  const c2Annotations: MapAnnotation[] = []

  return [
    {
      id: 'copia-1-presa-malpaso',
      nombre: 'Copia 1 - Sector Noroeste ROI (T62/F10 Principal)',
      carpeta: 'Mis Análisis',
      fechaModificacion: new Date(now - 5 * MINUTO).toISOString(),
      esEditable: true,
      opacidadSar: 75,
      centro: CHIAPAS_CENTRO,
      zoom: 10.3,
      escena: { ...ESCENA_CHIAPAS },
      annotations: c1Annotations,
      geojson: buildAnnotationsGeoJSON(c1Annotations, [], null),
      croppedRegion: null,
      solar: { enabled: false, sunAngle: 105, radiationIntensity: 60 },
    },
    {
      id: 'copia-2-sierra',
      nombre: 'Copia 2 - Sector Este Grijalva (T55/F80 Respaldo)',
      carpeta: 'Zonas de Riesgo',
      fechaModificacion: new Date(now - DIA).toISOString(),
      esEditable: true,
      opacidadSar: 65,
      centro: [-93.03, 16.75],
      zoom: 10.4,
      escena: {
        ...ESCENA_CHIAPAS,
        granuleId: RAW_SCENE_IDS.T55_T1_20260618,
        t1SceneId: RAW_SCENE_IDS.T55_T1_20260618,
        t2SceneId: RAW_SCENE_IDS.T55_T2_20261016,
        pila: 'T55/F80',
        direccion: 'DESCENDING',
        coberturaRoiPct: '~50.3% este (t1: 50.28%, t2: 50.25%)',
      },
      annotations: c2Annotations,
      geojson: buildAnnotationsGeoJSON(c2Annotations, [], null),
      croppedRegion: null,
      solar: { enabled: true, sunAngle: 125, radiationIntensity: 70 },
    },
  ]
}

export type CenterDockTab = 'map' | 'rain-dg2'

export type Dg2SectorId = 'grijalva-chicoasen' | 'canon-laderas' | 'tuxtla-urbana'

export interface NonUrbanSector {
  id: Dg2SectorId
  nombre: string
  tipo: 'elegible' | 'excluida'
  criterio: string
  nota: string
  coordinates: [number, number][][]
}

export const DG2_ROI_SECTORS: readonly NonUrbanSector[] = [
  {
    id: 'grijalva-chicoasen',
    nombre: 'Cauce Río Grijalva / Presa Chicoasén',
    tipo: 'elegible',
    criterio: 'Terreno natural / cauce abierto sin red de alcantarillado ni edificios densos',
    nota: 'Apto para ecuaciones de aguas poco profundas DG2 con DEM hidrográfico + fricción Manning n.',
    coordinates: [
      [
        [-93.2, 16.8],
        [-93.02, 16.8],
        [-92.98, 16.89],
        [-93.16, 16.89],
        [-93.2, 16.8],
      ],
    ],
  },
  {
    id: 'canon-laderas',
    nombre: 'Laderas y terrazas agrícolas (Valle Central)',
    tipo: 'elegible',
    criterio: 'Uso agrícola/forestal no urbano en malla UTM EPSG:32615',
    nota: 'Candidato para contraste exploratorio frente a Δγ⁰ / Δσ⁰ de NISAR GCOV.',
    coordinates: [
      [
        [-93.38, 16.66],
        [-93.21, 16.66],
        [-93.21, 16.88],
        [-93.38, 16.88],
        [-93.38, 16.66],
      ],
    ],
  },
  {
    id: 'tuxtla-urbana',
    nombre: 'Mancha Urbana de Tuxtla Gutiérrez',
    tipo: 'excluida',
    criterio: 'Zona urbana con edificios, calles y drenaje pluvial subterráneo',
    nota: 'Excluida del alcance DG2 (flujo-dg2-simulacion-inundacion.tex §1): el solver no modela drenaje urbano ni obstrucción de edificaciones.',
    coordinates: [
      [
        [-93.19, 16.71],
        [-93.03, 16.71],
        [-93.03, 16.79],
        [-93.19, 16.79],
        [-93.19, 16.71],
      ],
    ],
  },
]

export function buildDg2EligibilityGeoJSON(selectedId: Dg2SectorId) {
  return {
    type: 'FeatureCollection' as const,
    features: DG2_ROI_SECTORS.map((sec) => ({
      type: 'Feature' as const,
      properties: {
        id: sec.id,
        nombre: sec.nombre,
        tipo: sec.tipo,
        selected: sec.id === selectedId,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: sec.coordinates,
      },
    })),
  }
}

/**
 * Contrato `graficas-etapa1-1` (`data/explore/<granuleId>/graficas.json`, `docs/p1-graficas-chartjs.md`).
 */
export interface ExploreHistogramStats {
  n_validos: number
  media_dB: number
  mediana_dB: number
  dB_de_la_media: number
  desv_std_dB: number
  p5_dB: number
  p95_dB: number
}

export interface ExploreHistogramSeries {
  nombre: string
  bin_inicio_dB: number
  conteos: number[]
  total_en_rango: number
  fuera_de_rango: number
  estadisticas: ExploreHistogramStats
}

export interface ExploreHistogramChart {
  id: 'histograma_gamma0_dB'
  figura_png: string
  tipo_sugerido: 'bar'
  titulo: string
  eje_x: {
    etiqueta: string
    unidad: string
    ancho_bin: number
    rango_bins: [number, number]
  }
  eje_y: {
    etiqueta: string
    unidad: string
  }
  como_leer?: string
  series: ExploreHistogramSeries[]
}

export interface ExploreMaskChart {
  id: 'mascara_roi'
  figura_png: string
  tipo_sugerido: 'bar'
  titulo: string
  eje_x: {
    etiqueta: string
    unidad: string | null
  }
  eje_y: {
    etiqueta: string
    unidad: string
  }
  categorias: string[]
  etiquetas: string[]
  series: Array<{
    nombre: string
    valores: number[]
  }>
  pct_validos_en_poligono: number
  como_leer?: string
}

export interface ExploreIncidenceChart {
  id: 'incidencia_por_altura'
  figura_png: string
  tipo_sugerido: 'line'
  titulo: string
  eje_x: {
    etiqueta: string
    unidad: string
  }
  eje_y: {
    etiqueta: string
    unidad: string
  }
  x: number[]
  series: Array<{
    nombre: string
    valores: number[]
  }>
  altura_figura_m: number
  como_leer?: string
}

export type ExploreChartEntry =
  | ExploreHistogramChart
  | ExploreMaskChart
  | ExploreIncidenceChart

export interface ExploreChartsManifest {
  version: string
  tipo: string
  creado_utc: string
  version_codigo: string
  escena: {
    granuleId: string
    producto: string
    fecha_inicio: string
    trayectoria: number
    marco: number
    direccion: string
    crid: string
    madurez_catalogo: string
    frecuencia: string
    polarizaciones: string[]
  }
  fuentes: {
    metadatos: string
  }
  graficas: ExploreChartEntry[]
  advertencias: string[]
}
