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
 * Etiquetas y tooltips oficiales basados en el NISAR Science Users' Handbook
 * (2nd Ed., Oct 2025, DOI: 10.48577/jpl.UD4HV3) y `docs/plan-de-trabajo.md` §6.
 */
export const DANGER_CIRCLE_DEFAULT_LABEL =
  'Hipótesis N2O / N2IV: Caída especular o Doble rebote HH'

export const DANGER_CIRCLE_TOOLTIP =
  'NISAR Science Users’ Handbook §6.4 (2025, DOI: 10.48577/jpl.UD4HV3): En agua abierta (OW) cae la retrodispersión HH/HV por reflexión especular; en vegetación inundada (IV) aumenta fuertemente HH y la razón HH/HV por doble rebote agua-tronco. Hipótesis exploratoria sujeta a validación independiente.'

export const WARN_CIRCLE_DEFAULT_LABEL =
  'Anomalía CUMSUM L-HV (Umbral bosque -13 dB)'

export const WARN_CIRCLE_TOOLTIP =
  'NISAR Science Users’ Handbook §6.2–§6.3 (2025, DOI: 10.48577/jpl.UD4HV3): Variación en dispersión volumétrica del dosel en canal cruzado HV (umbral de referencia bosque -13 dB) o humedad superficial del suelo (modelo Oh et al., 1992); límite de saturación de biomasa L-Band en 100 Mg/ha.'

/** WKT oficial de la ROI en Chiapas (AGENTS.md §4). */
export const CHIAPAS_ROI_WKT =
  'POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))'

/** Fecha de corte en el catálogo ASF donde el CRID cambió de P05023 a P05036 (AGENTS.md §4). */
export const CRID_TRANSITION_DATE = '2026-10-23'

export interface GcovStackSpec {
  id: 'T55/F80' | 'T62/F10' | 'T156/F80'
  track: number
  frame: number
  direction: 'DESCENDING' | 'ASCENDING'
  directionLabel: 'Descendente' | 'Ascendente'
  product: 'GCOV'
  band: string
  polarizations: readonly ['HH', 'HV']
  crid: 'P05023'
  maturity: 'PROVISIONAL'
  repeatCycleDays: 12
  dates: readonly string[]
  /** Fecha posterior al cambio de procesador (P05036) para demostrar bloqueo CRID. */
  postTransitionDate: string
  defaultT1: string
  defaultT2: string
  notes: string
}

/**
 * Las 3 pilas GCOV reales comparables sobre la ROI de Chiapas
 * (consulta del catálogo ASF 2026-11-12 UTC, `docs/plan-de-trabajo.md` §1 y §5).
 */
export const PILAS_GCOV_CHIAPAS: readonly GcovStackSpec[] = Object.freeze([
  {
    id: 'T55/F80',
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
    notes: 'Pila 1 (Par principal de Fase 1): 10 fechas cada 12 días (falta 2026-08-05; usar MOE en 2026-07-24).',
  },
  {
    id: 'T62/F10',
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
    notes: 'Pila 2: 10 fechas ascendentes (jun–oct 2026), mismas fechas que T55/F80 con CRID P05023.',
  },
  {
    id: 'T156/F80',
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
    notes: 'Pila 3: 8 fechas descendentes (jun–oct 2026; 2026-09-05 tiene contador 001 y 002).',
  },
])

export interface PairCompatCheckResult {
  comparable: boolean
  cridT1: 'P05023' | 'P05036'
  cridT2: 'P05023' | 'P05036'
  maturityT1: 'PROVISIONAL' | 'VALIDATED'
  maturityT2: 'PROVISIONAL' | 'VALIDATED'
  errors: string[]
  warnings: string[]
  isSyntheticMock: true
}

/**
 * Validador visual y de reglas de comparabilidad (`pipeline/compat.py` y `plan-de-trabajo.md` §1 y §5).
 * Bloquea cualquier par que cruce la fecha `2026-10-23` donde el CRID cambió de `P05023` a `P05036`.
 */
export function checkPairCompat(
  t1: string,
  t2: string,
  stackId: GcovStackSpec['id'] = 'T55/F80',
): PairCompatCheckResult {
  const cridT1: 'P05023' | 'P05036' = t1 >= CRID_TRANSITION_DATE ? 'P05036' : 'P05023'
  const cridT2: 'P05023' | 'P05036' = t2 >= CRID_TRANSITION_DATE ? 'P05036' : 'P05023'
  const maturityT1: 'PROVISIONAL' | 'VALIDATED' =
    cridT1 === 'P05036' ? 'VALIDATED' : 'PROVISIONAL'
  const maturityT2: 'PROVISIONAL' | 'VALIDATED' =
    cridT2 === 'P05036' ? 'VALIDATED' : 'PROVISIONAL'

  const errors: string[] = []
  const warnings: string[] = []

  if (!t1 || !t2) {
    errors.push('Selecciona ambas fechas (t1 y t2) para verificar comparabilidad.')
  } else if (t1 === t2) {
    errors.push('misma adquisición: no hay intervalo temporal que comparar (t1 = t2).')
  }

  if (cridT1 !== cridT2) {
    errors.push(
      `Bloqueo CRID (corte ${CRID_TRANSITION_DATE}): crid '${cridT1}' (${t1}) vs '${cridT2}' (${t2}). No se deben cruzar versiones de procesador P05023 y P05036.`,
    )
    errors.push(
      `maturity: '${maturityT1}' vs '${maturityT2}' (AGENTS.md §5: prohibido mezclar niveles de madurez).`,
    )
  } else if (cridT1 === 'P05036' && cridT2 === 'P05036') {
    warnings.push(
      'Cada pila P05036 (post 2026-10-23) cuenta por ahora con una sola fecha en catálogo.',
    )
  }

  if (stackId === 'T55/F80' && (t1 === '2026-07-24' || t2 === '2026-07-24')) {
    warnings.push(
      '2026-07-24 T55/F80 tiene un segundo producto con órbita FOE sin madurez; se selecciona el producto MOE.',
    )
  }
  if (stackId === 'T156/F80' && (t1 === '2026-09-05' || t2 === '2026-09-05')) {
    warnings.push(
      '2026-09-05 T156/F80 tiene dos productos en catálogo (contador 001 y 002); verificar cobertura de ROI en el .h5.',
    )
  }

  warnings.push(
    'Resolución y cobertura real de la ROI en malla EPSG:32615 se verifican en el archivo .h5 (pipeline/inspect.py).',
  )

  return {
    comparable: errors.length === 0,
    cridT1,
    cridT2,
    maturityT1,
    maturityT2,
    errors,
    warnings,
    isSyntheticMock: true,
  }
}

export const ESCENA_CHIAPAS: Readonly<EscenaNisar> = Object.freeze({
  granuleId: 'NISAR_L2_PR_GCOV_001_055_D_080_4005_DHDH_A_20260618_20261016_P05023',
  producto: 'NISAR L2 GCOV',
  descripcionProducto:
    'Matriz de Covarianza Polarimétrica Geocodificada en malla UTM EPSG:32615, retrodispersión corregida radiométricamente por terreno RTC γ⁰ / σ⁰ en dB',
  epsg: 32615,
  banda: 'L-Band (24 cm, 1.257 GHz, Frequency A)',
  polarizacion: 'Dual-Pol (HH+HV)',
  madurez: 'PROVISIONAL',
  cicloRepeticion: '12 días',
  pila: 'T55/F80',
  direccion: 'DESCENDING',
  t1: '2026-06-18',
  t2: '2026-10-16',
  crid: 'P05023',
  unidad: 'dB (γ⁰/σ⁰)',
  fuente: 'NASA Earthdata / ASF Vertex',
})

export const CHIAPAS_CENTRO: LngLat = [-93.12, 16.75]
export const CHIAPAS_ZOOM = 8.4

/** Imagen de radar superpuesta (referencia visual; las diferencias Δγ⁰/Δσ⁰ se calculan sobre GCOV en dB). */
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

/** Estado base de solo lectura (Par principal Fase 1: T55/F80, 2026-06-18 -> 2026-10-16, P05023). */
export const MAPA_GENERAL: Readonly<WorkspaceMap> = Object.freeze({
  id: MAPA_GENERAL_ID,
  nombre: 'Mapa General - Chiapas (GCOV T55/F80)',
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
      label: WARN_CIRCLE_DEFAULT_LABEL,
    },
  ]
  const c2Annotations: MapAnnotation[] = [
    {
      id: 'init-danger-sierra',
      kind: 'peligro',
      center: [-93.0, 15.95],
      radiusKm: 6.5,
      label: DANGER_CIRCLE_DEFAULT_LABEL,
    },
  ]

  return [
    {
      id: 'copia-1-presa-malpaso',
      nombre: 'Copia 1 - Presa Malpaso (T55/F80)',
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
      nombre: 'Copia 2 - Sierra (T62/F10)',
      carpeta: 'Zonas de Riesgo',
      fechaModificacion: new Date(now - DIA).toISOString(),
      esEditable: true,
      opacidadSar: 60,
      centro: [-93.0, 15.95],
      zoom: 9.4,
      escena: {
        ...ESCENA_CHIAPAS,
        granuleId: 'NISAR_L2_PR_GCOV_001_062_A_010_4005_DHDH_A_20260618_20261016_P05023',
        pila: 'T62/F10',
        direccion: 'ASCENDING',
      },
      annotations: c2Annotations,
      geojson: buildAnnotationsGeoJSON(c2Annotations, [], null),
      croppedRegion: null,
      solar: { enabled: true, sunAngle: 125, radiationIntensity: 70 },
    },
  ]
}
