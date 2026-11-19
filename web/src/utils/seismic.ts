import type { LngLat } from '../types/workspace'

export type SeismicMechanism = 'subduction' | 'intraplate' | 'crustal'
export type SoilType = 'rock' | 'intermediate' | 'soft_lacustrine'

export interface SeismicSource {
  epicenter: LngLat // [lng, lat]
  magnitude: number // Mw (e.g. 7.2)
  depthKm: number // Focal depth h in km
  name: string
  mechanism: SeismicMechanism
  soilType: SoilType
  /** Vs30 (m/s) del sitio. Si falta, el valor representativo de `soilType` (SOIL_VS30). */
  vs30?: number
}

export interface IsoseismalRing {
  level: 'destructive' | 'severe' | 'moderate' | 'light'
  mmi: string
  pgaThreshold_g: number
  radiusKm: number
  labelEs: string
  labelEn: string
  color: string
  fillColor: string
  polygon: LngLat[]
}

/**
 * Serie de aceleración sintética a(t) a una frecuencia de muestreo fija (ver `synthesizeSeismogram`).
 * `accel_g[i]` corresponde a t = i / sampleRateHz desde el origen de la ruptura.
 */
export interface SeismogramSignal {
  sampleRateHz: number
  dtSec: number
  durationSec: number
  stationDistKm: number
  hypocentralDistKm: number
  tP_sec: number
  tS_sec: number
  warningTimeSec: number
  peakPga_g: number
  peakPga_cgs: number
  stationMmi: number
  /** Vs30 (m/s) de la estación usado para PGA y frecuencias. */
  stationVs30: number
  /** Ec. 10: tS − t_proceso (s desde el origen). */
  alertTimeSec: number
  /** Frecuencia del paquete P (Hz). Por la ec. 16 su energía queda en 0.85·fP y 1.15·fP. */
  fp_Hz: number
  /** Frecuencia fundamental del paquete S según el suelo (Hz). */
  fs_Hz: number
  tauCoda_sec: number
  accel_g: Float64Array
}

export interface SeismicSimulationResults {
  source: SeismicSource
  epicentralPga_g: number
  epicentralPga_cgs: number
  epicentralMmi: number
  rings: IsoseismalRing[]
  pWaveSpeedKmS: number
  sWaveSpeedKmS: number
  /** Momento sísmico escalar M0 (dyn·cm), ec. 1. */
  seismicMoment_dyncm: number
  /** Vs30 (m/s) usado para el efecto de sitio en todo el escenario. */
  vs30: number
  /** Ley de atenuación usada y su σ de ln(PGA) (null si no la publica). */
  gmpeModel: GmpeModelId
  gmpeSigmaLn: number | null
  /** Avisos si el escenario sale del rango de datos del modelo. */
  validityWarnings: string[]
  /** Datos para gráfica 2D de Atenuación (PGA vs Distancia) */
  attenuationCurve: {
    distanceKm: number
    pga_g: number
    pga_cgs: number
    mmi: number
    tP_sec: number
    tS_sec: number
    warningTimeSec: number
    /** Ec. 10: tS − t_proceso. */
    alertTimeSec: number
  }[]
}

export interface SeismicHistoricalPreset {
  id: string
  name: string
  year: number
  magnitude: number
  depthKm: number
  epicenter: LngLat
  mechanism: SeismicMechanism
  soilType: SoilType
  description: string
}

export const HISTORICAL_SEISMIC_PRESETS: readonly SeismicHistoricalPreset[] = [
  {
    id: 'michoacan-1985',
    name: '1985 — Michoacán / Costa del Pacífico (M8.1)',
    year: 1985,
    magnitude: 8.1,
    depthKm: 15,
    epicenter: [-102.53, 18.19],
    mechanism: 'subduction',
    soilType: 'intermediate',
    description: 'Terremoto de subducción en la Trinchera Mesoamericana. Produjo resonancia y amplificación destructiva extrema en el suelo lacustre del Valle de México a 350 km.',
  },
  {
    id: 'puebla-morelos-2017',
    name: '2017 — Puebla / Morelos (M7.1)',
    year: 2017,
    magnitude: 7.1,
    depthKm: 57,
    epicenter: [-98.68, 18.40],
    mechanism: 'intraplate',
    soilType: 'rock',
    description: 'Sismo intraplaca profundo en la placa de Cocos subducida. Alta aceleración espectral destructiva en Morelos, Puebla y Ciudad de México.',
  },
  {
    id: 'tehuantepec-2017',
    name: '2017 — Golfo de Tehuantepec (M8.2)',
    year: 2017,
    magnitude: 8.2,
    depthKm: 45,
    epicenter: [-93.72, 15.02],
    mechanism: 'intraplate',
    soilType: 'rock',
    description: 'El mayor sismo registrado en México en un siglo. Falla normal intraplaca bajo el Istmo de Tehuantepec y costa de Chiapas/Oaxaca.',
  },
  {
    id: 'acapulco-2021',
    name: '2021 — Acapulco / Guerrero (M7.1)',
    year: 2021,
    magnitude: 7.1,
    depthKm: 10,
    epicenter: [-99.78, 16.78],
    mechanism: 'subduction',
    soilType: 'intermediate',
    description: 'Epicentro a escasos 11 km de Acapulco en la zona de contacto interplaca. Fuerte aceleración local y trenes de ondas de gran percepción.',
  },
  {
    id: 'coalcoman-2022',
    name: '2022 — Coalcomán / Michoacán (M7.7)',
    year: 2022,
    magnitude: 7.7,
    depthKm: 15,
    epicenter: [-103.25, 18.36],
    mechanism: 'subduction',
    soilType: 'intermediate',
    description: 'Ruptura en la interfaz de la Placa de Cocos. Daños significativos en la costa michoacana y activación de la Alerta Sísmica con amplio margen.',
  },
  {
    id: 'san-andres-mexicali',
    name: '2010 — Mexicali / Falla Laguna Salada (M7.2)',
    year: 2010,
    magnitude: 7.2,
    depthKm: 10,
    epicenter: [-115.30, 32.26],
    mechanism: 'crustal',
    soilType: 'rock',
    description: 'Falla cortical transformante del sistema San Andrés - Golfo de California. Aceleración muy intensa en superficie somera.',
  },
]

/**
 * Calcula la distancia epicentral en kilómetros entre dos coordenadas usando la fórmula del semiverseno.
 */
export function haversineDistanceKm(coord1: LngLat, coord2: LngLat): number {
  const [lng1, lat1] = coord1
  const [lng2, lat2] = coord2
  const R = 6371 // Radio terrestre en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export const VP_KM_S = 6.0
export const VS_KM_S = 3.5
/** t_proceso de la ec. 10 (detección y difusión de la alerta). */
export const SASMEX_PROCESS_SEC = 3.0
export const VS30_REF = 760
export const B_SITE = -0.45

/**
 * Ley de atenuación usada por mecanismo:
 *  - subducción interplaca: Arroyo et al. (2010), J. Seismol. 14:769–785 (ec. 8a, tabla 2, fila PGA);
 *  - intraplaca: García et al. (2005), BSSA 95(6):2272–2282 (ec. 2, tabla 2, PGA horizontal);
 *  - cortical: PROVISIONAL, coeficientes del manual del 17-nov-2026 sin fuente publicada, hasta
 *    integrar Boore et al. (2014) (sus coeficientes están en el suplemento electrónico del artículo).
 */
export type GmpeModelId = 'arroyo2010' | 'garcia2005' | 'manual-crustal'
export const GMPE_BY_MECHANISM: Readonly<Record<SeismicMechanism, GmpeModelId>> = Object.freeze({
  subduction: 'arroyo2010',
  intraplate: 'garcia2005',
  crustal: 'manual-crustal',
})

/** Desviación estándar total de ln(PGA): Arroyo σ = 0.75 (ln); García σ = 0.28 (log10). */
export const GMPE_SIGMA_LN: Readonly<Record<GmpeModelId, number | null>> = Object.freeze({
  arroyo2010: 0.75,
  garcia2005: 0.28 * Math.LN10,
  'manual-crustal': null,
})

/** Coeficientes corticales del manual anterior (provisionales, sin fuente publicada). */
export const MANUAL_CRUSTAL_COEFFICIENTS = Object.freeze({ c1: -1.95, c2: 0.88, c3: 1.05, c4: 0.0028 })

/**
 * Integral exponencial E1(x) = ∫_x^∞ e^(−t)/t dt, x > 0: serie para x ≤ 1 y fracción continua
 * (Lentz) para x > 1, como en Abramowitz y Stegun (1972) / Numerical Recipes.
 */
export function exponentialIntegralE1(x: number): number {
  if (!(x > 0)) return Infinity
  const EULER = 0.5772156649015329
  if (x <= 1) {
    let sum = 0
    let term = 1
    for (let k = 1; k < 200; k++) {
      term *= -x / k
      const add = term / k
      sum += add
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break
    }
    return -EULER - Math.log(x) - sum
  }
  const TINY = 1e-300
  let b = x + 1
  let c = 1 / TINY
  let d = 1 / b
  let h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * i
    b += 2
    d = 1 / (an * d + b)
    c = b + an / c
    const del = c * d
    h *= del
    if (Math.abs(del - 1) < 1e-15) break
  }
  return h * Math.exp(-x)
}

/**
 * Arroyo et al. (2010), ec. 8a con la fila PGA de la tabla 2, roca (NEHRP B), en cm/s²:
 * ln PGA = α1 + α2·Mw + α3·ln{[E1(α4·R) − E1(α4·√(R² + r0²))] / r0²}, r0² = 1.4447e−5·e^(2.3026·Mw).
 * R: distancia más cercana a la falla (km). El término de E1 da la saturación de campo cercano.
 */
export function pgaRockArroyo2010_cgs(magnitude: number, distanceKm: number): number {
  const a1 = 2.4862, a2 = 0.9392, a3 = 0.5061, a4 = 0.0150
  const r02 = 1.4447e-5 * Math.exp(2.3026 * magnitude)
  const term = (exponentialIntegralE1(a4 * distanceKm) - exponentialIntegralE1(a4 * Math.sqrt(distanceKm * distanceKm + r02))) / r02
  return Math.exp(a1 + a2 * magnitude + a3 * Math.log(term))
}

/**
 * García et al. (2005), ec. 2 (PGA horizontal, roca), en cm/s²:
 * log10 PGA = −0.2 + 0.59·Mw − 0.0039·R − log10 R + 0.008·H, con R = √(R_cld² + Δ²) y
 * Δ = 0.00750·10^(0.507·Mw) (saturación de campo cercano de Atkinson y Boore, 2003). H en km.
 */
export function pgaRockGarcia2005_cgs(magnitude: number, faultDistanceKm: number, depthKm: number): number {
  const delta = 0.0075 * 10 ** (0.507 * magnitude)
  const R = Math.sqrt(faultDistanceKm * faultDistanceKm + delta * delta)
  return 10 ** (-0.2 + 0.59 * magnitude - 0.0039 * R - Math.log10(R) + 0.008 * depthKm)
}

/** Avisos cuando el escenario sale del rango de datos del modelo usado (o si es provisional). */
export function gmpeValidityWarnings(
  mechanism: SeismicMechanism,
  magnitude: number,
  depthKm: number,
  distanceEpicentralKm: number
): string[] {
  const R = Math.hypot(distanceEpicentralKm, depthKm)
  const out: string[] = []
  if (mechanism === 'subduction') {
    if (magnitude < 5.0 || magnitude > 8.0) out.push('Arroyo et al. (2010) se ajustó con Mw 5.0–8.0; fuera de ese rango es extrapolación.')
    if (R > 400) out.push('Arroyo et al. (2010) usa distancias hasta 400 km.')
    if (depthKm > 30) out.push('Arroyo et al. (2010) es para sismos interplaca someros (≲ 30 km).')
    out.push('Arroyo et al. (2010) es para roca en la costa del Pacífico (antearco): no representa la amplificación regional de la Faja Volcánica ni del Valle de México.')
  } else if (mechanism === 'intraplate') {
    if (magnitude < 5.2 || magnitude > 7.4) out.push('García et al. (2005) se ajustó con Mw 5.2–7.4; fuera de ese rango es extrapolación.')
    if (depthKm < 35 || depthKm > 138) out.push('García et al. (2005) usa profundidades de 35 a 138 km.')
    if (R > 400) out.push('García et al. (2005) usa distancias hasta 400 km.')
    out.push('García et al. (2005) es para roca; excluyó las estaciones del Valle de México.')
  } else {
    out.push('Mecanismo cortical: coeficientes provisionales sin fuente publicada (pendiente Boore et al., 2014).')
  }
  return out
}

/** Vs30 representativo de cada clase de suelo (manual §5.2). */
export const SOIL_VS30: Readonly<Record<SoilType, number>> = Object.freeze({
  rock: 760,
  intermediate: 450,
  soft_lacustrine: 100,
})

export function effectiveVs30(soilType: SoilType, vs30?: number | null): number {
  return vs30 && vs30 > 0 ? vs30 : SOIL_VS30[soilType]
}

/** S_sitio = b·ln(Vs30/Vref), ec. 12. En roca firme (Vs30 ≥ 760 m/s) S = 0. */
export function siteAmplification(vs30: number): number {
  return vs30 >= VS30_REF ? 0 : B_SITE * Math.log(vs30 / VS30_REF)
}

/** M0 = 10^(3/2·(Mw + 10.7)) en dyn·cm, ec. 1 (1 dyn·cm = 1e-7 N·m). */
export function seismicMomentDynCm(magnitude: number): number {
  return 10 ** (1.5 * (magnitude + 10.7))
}

/** Ec. 10: T_alerta ≈ tS − t_proceso (s desde el origen), con tS = √(D² + h²)/vs. */
export function sasmexAlertTimeSec(distanceEpicentralKm: number, depthKm: number): number {
  return Math.max(0, Math.hypot(distanceEpicentralKm, depthKm) / VS_KM_S - SASMEX_PROCESS_SEC)
}

/**
 * Término de saturación de campo cercano (km) de Yenier y Atkinson (2015, BSSA 105(4)):
 * h_sat = 10^(−0.405 + 0.235·Mw). Representa la extensión finita de la ruptura: cerca de la falla
 * la distancia efectiva no baja de h_sat. Se adopta aquí como aproximación (fue calibrado con
 * otro modelo de atenuación); ver docs/latex/ecuaciones_sismo.tex.
 */
export function nearSourceSaturationKm(magnitude: number): number {
  return 10 ** (-0.405 + 0.235 * magnitude)
}

/**
 * Aceleración pico del suelo (PGA en g) = PGA en roca del modelo del mecanismo × e^(S_sitio).
 * La fuente es puntual: como distancia a la falla se usa la hipocentral R = √(D² + h²), lo que
 * subestima algo la PGA cerca de rupturas grandes. Cortical (provisional): manual anterior con
 * R_ef = √(D² + h² + h_sat²). Se acota a [0.0001, 2.5] g como salvaguarda.
 */
export function computePga_g(
  distanceEpicentralKm: number,
  magnitude: number,
  depthKm: number,
  mechanism: SeismicMechanism = 'subduction',
  soilType: SoilType = 'intermediate',
  vs30?: number | null
): number {
  const R = Math.hypot(distanceEpicentralKm, depthKm)
  let lnRock_g: number
  if (mechanism === 'subduction') {
    lnRock_g = Math.log(pgaRockArroyo2010_cgs(magnitude, R) / 980.665)
  } else if (mechanism === 'intraplate') {
    lnRock_g = Math.log(pgaRockGarcia2005_cgs(magnitude, R, depthKm) / 980.665)
  } else {
    const { c1, c2, c3, c4 } = MANUAL_CRUSTAL_COEFFICIENTS
    const hSat = nearSourceSaturationKm(magnitude)
    const Reff = Math.sqrt(R * R + hSat * hSat)
    lnRock_g = c1 + c2 * magnitude - c3 * Math.log(Reff) - c4 * Reff
  }
  const lnPga = lnRock_g + siteAmplification(effectiveVs30(soilType, vs30))
  return Math.max(0.0001, Math.min(2.5, Math.exp(lnPga)))
}

/**
 * PGA (cm/s²) donde se cruzan las dos rectas de Wald et al. (1999): 2.20·x + 1.00 = 3.66·x − 1.66,
 * x = log10(PGA) = 2.66/1.46 → ≈ 66.4 gal (MMI ≈ V). El manual ponía el corte en 4.22 gal, lo que
 * hacía la escala discontinua (MMI 2.4 → 1.0 al cruzarlo).
 */
export const MMI_BREAKPOINT_GAL = 10 ** (2.66 / 1.46)

/**
 * PGA → intensidad Mercalli Modificada con las relaciones de Wald et al. (1999):
 * MMI = 2.20·log10(PGA) + 1.00 bajo el corte; MMI = 3.66·log10(PGA) − 1.66 sobre él (PGA en cm/s²).
 * Resultado acotado a [1, 10.5].
 */
export function pgaToMmi(pga_g: number): number {
  const pga_cgs = pga_g * 980.665
  const x = Math.log10(pga_cgs)
  const mmi = pga_cgs <= MMI_BREAKPOINT_GAL ? 2.2 * x + 1.0 : 3.66 * x - 1.66
  return Math.max(1.0, Math.min(10.5, mmi))
}

export function mmiToRoman(mmi: number): string {
  const round = Math.round(mmi)
  if (round <= 1) return 'I'
  if (round === 2) return 'II'
  if (round === 3) return 'III'
  if (round === 4) return 'IV'
  if (round === 5) return 'V'
  if (round === 6) return 'VI'
  if (round === 7) return 'VII'
  if (round === 8) return 'VIII'
  if (round === 9) return 'IX'
  return 'X+'
}

/**
 * Genera un polígono circular geodésico alrededor de un punto central [lng, lat].
 */
export function generateGeodesicCircle(center: LngLat, radiusKm: number, points = 64): LngLat[] {
  if (radiusKm <= 0) return []
  const [lng, lat] = center
  const coords: LngLat[] = []
  const latRad = (lat * Math.PI) / 180
  const lngRad = (lng * Math.PI) / 180
  const dRad = radiusKm / 6371

  for (let i = 0; i <= points; i++) {
    const bearing = (i * 2 * Math.PI) / points
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(dRad) + Math.cos(latRad) * Math.sin(dRad) * Math.cos(bearing)
    )
    const pLng =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dRad) * Math.cos(latRad),
        Math.cos(dRad) - Math.sin(latRad) * Math.sin(pLat)
      )
    coords.push([(pLng * 180) / Math.PI, (pLat * 180) / Math.PI])
  }
  return coords
}

/**
 * Resuelve por bisección numérica el radio epicentral (en km) donde el PGA alcanza un umbral dado.
 */
function solveDistanceForPga(
  targetPga_g: number,
  magnitude: number,
  depthKm: number,
  mechanism: SeismicMechanism,
  soilType: SoilType,
  vs30?: number
): number {
  const pgaAtEpicenter = computePga_g(0, magnitude, depthKm, mechanism, soilType, vs30)
  if (pgaAtEpicenter < targetPga_g) {
    return 0 // El sismo ni siquiera alcanza este umbral en el epicentro
  }

  let low = 0
  let high = 1500 // km máx de búsqueda
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2
    const pgaMid = computePga_g(mid, magnitude, depthKm, mechanism, soilType, vs30)
    if (pgaMid > targetPga_g) {
      low = mid
    } else {
      high = mid
    }
  }
  return Math.round(low * 10) / 10
}

/**
 * Ejecuta el cálculo completo de propagación sísmica, radios de riesgo y curvas para gráficas 2D.
 */
export function runSeismicSimulation(source: SeismicSource): SeismicSimulationResults {
  const { epicenter, magnitude, depthKm, mechanism, soilType } = source
  const vs30 = effectiveVs30(soilType, source.vs30)

  const epicentralPga_g = computePga_g(0, magnitude, depthKm, mechanism, soilType, vs30)
  const epicentralPga_cgs = epicentralPga_g * 980.665
  const epicentralMmi = pgaToMmi(epicentralPga_g)

  const vp = VP_KM_S
  const vs = VS_KM_S

  // Umbrales de zonificación sísmica (Worden et al. / USGS ShakeMap)
  const RING_SPECS: {
    level: 'destructive' | 'severe' | 'moderate' | 'light'
    mmi: string
    pgaThreshold_g: number
    labelEs: string
    labelEn: string
    color: string
    fillColor: string
  }[] = [
    {
      level: 'destructive',
      mmi: 'VIII+',
      pgaThreshold_g: 0.34,
      labelEs: 'Zona Destructiva (Daño Severo / Colapso)',
      labelEn: 'Destructive Zone (Severe Damage / Collapse)',
      color: '#ef4444',
      fillColor: 'rgba(239, 68, 68, 0.28)',
    },
    {
      level: 'severe',
      mmi: 'VI - VII',
      pgaThreshold_g: 0.12,
      labelEs: 'Zona de Daño Fuerte a Moderado',
      labelEn: 'Strong to Moderate Damage Zone',
      color: '#f97316',
      fillColor: 'rgba(249, 115, 22, 0.22)',
    },
    {
      level: 'moderate',
      mmi: 'IV - V',
      pgaThreshold_g: 0.03,
      labelEs: 'Zona de Percepción Fuerte a Moderada',
      labelEn: 'Strong to Moderate Perception Zone',
      color: '#eab308',
      fillColor: 'rgba(234, 179, 8, 0.16)',
    },
    {
      level: 'light',
      mmi: 'II - III',
      pgaThreshold_g: 0.005,
      labelEs: 'Zona de Percepción Débil / Límite Sentido',
      labelEn: 'Light Perception / Felt Limit Zone',
      color: '#3b82f6',
      fillColor: 'rgba(59, 130, 246, 0.10)',
    },
  ]

  const rings: IsoseismalRing[] = []
  for (const spec of RING_SPECS) {
    const rKm = solveDistanceForPga(spec.pgaThreshold_g, magnitude, depthKm, mechanism, soilType, vs30)
    if (rKm > 0) {
      const polygon = generateGeodesicCircle(epicenter, rKm, 64)
      rings.push({
        ...spec,
        radiusKm: rKm,
        polygon,
      })
    }
  }

  // Generación de puntos continuos para la gráfica 2D (distancias de 0 a 600 km)
  const attenuationCurve: SeismicSimulationResults['attenuationCurve'] = []
  const maxPlotDist = Math.max(250, rings[rings.length - 1]?.radiusKm ? rings[rings.length - 1].radiusKm * 1.15 : 400)
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const dist = (i / steps) * maxPlotDist
    const pga = computePga_g(dist, magnitude, depthKm, mechanism, soilType, vs30)
    const pga_cgs = pga * 980.665
    const mmi = pgaToMmi(pga)
    const hypoDist = Math.sqrt(dist * dist + depthKm * depthKm)
    const tP = hypoDist / vp
    const tS = hypoDist / vs
    const warningTime = Math.max(0, tS - tP)

    attenuationCurve.push({
      distanceKm: Math.round(dist * 10) / 10,
      pga_g: pga,
      pga_cgs: Math.round(pga_cgs * 10) / 10,
      mmi: Math.round(mmi * 10) / 10,
      tP_sec: Math.round(tP * 10) / 10,
      tS_sec: Math.round(tS * 10) / 10,
      warningTimeSec: Math.round(warningTime * 10) / 10,
      alertTimeSec: Math.round(sasmexAlertTimeSec(dist, depthKm) * 10) / 10,
    })
  }

  return {
    source,
    epicentralPga_g,
    epicentralPga_cgs,
    epicentralMmi,
    rings,
    pWaveSpeedKmS: vp,
    sWaveSpeedKmS: vs,
    seismicMoment_dyncm: seismicMomentDynCm(magnitude),
    vs30,
    gmpeModel: GMPE_BY_MECHANISM[mechanism],
    gmpeSigmaLn: GMPE_SIGMA_LN[GMPE_BY_MECHANISM[mechanism]],
    validityWarnings: gmpeValidityWarnings(mechanism, magnitude, depthKm, 0),
    attenuationCurve,
  }
}

/**
 * Frecuencia fundamental de la onda S y decaimiento de coda según Vs30 de la estación: < 180 m/s
 * es cuenca lacustre (manual §8.3: 0.52 Hz, τ = 28 s). Los valores de roca (≥ 760 m/s) y suelo firme
 * son los del código original; el manual no los especifica.
 */
export function siteWaveParams(vs30: number): { fs_Hz: number; tauCoda_sec: number } {
  if (vs30 < 180) return { fs_Hz: 0.52, tauCoda_sec: 28.0 }
  if (vs30 >= VS30_REF) return { fs_Hz: 2.2, tauCoda_sec: 9.0 }
  return { fs_Hz: 1.3, tauCoda_sec: 14.0 }
}

/**
 * Sismograma sintético a(t, D) = a_ruido + a_P + a_S (manual §8) para una estación a distancia
 * epicentral `stationDistKm`, muestreado a `sampleRateHz` (50 Hz por defecto: Nyquist 25 Hz, por
 * encima de la onda P de 3.8–5.2 Hz; con 240 muestras en ≥ 45 s la onda P quedaba submuestreada).
 * Es un modelo analítico ilustrativo, no un registro.
 */
export function synthesizeSeismogram(
  source: SeismicSource,
  stationDistKm: number,
  options: { sampleRateHz?: number; stationVs30?: number | null } = {}
): SeismogramSignal {
  const { magnitude, depthKm, mechanism, soilType } = source
  const sampleRateHz = options.sampleRateHz ?? 50
  const stationVs30 = options.stationVs30 && options.stationVs30 > 0 ? options.stationVs30 : effectiveVs30(soilType, source.vs30)
  const vp = VP_KM_S
  const vs = VS_KM_S
  const hypoDist = Math.sqrt(stationDistKm * stationDistKm + depthKm * depthKm)
  const tP = hypoDist / vp
  const tS = hypoDist / vs
  const pga_g = computePga_g(stationDistKm, magnitude, depthKm, mechanism, soilType, stationVs30)
  const { fs_Hz: fs, tauCoda_sec: tauS } = siteWaveParams(stationVs30)
  const fp = 4.5 // Hz (onda P)
  const riseTime = 1.8
  const durationSec = Math.max(45, Math.ceil(tS + (stationVs30 < 180 ? 45 : 30)))
  const n = Math.round(durationSec * sampleRateHz) + 1
  const accel = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    const t = i / sampleRateHz
    // Microtremores de fondo (amplitud despreciable frente al PGA)
    let a = 0.0012 * pga_g * Math.sin(11.2 * t + 0.3) + 0.0006 * pga_g * Math.cos(23.7 * t)
    if (t >= tP && t < tS) {
      const dtP = t - tP
      a += 0.22 * pga_g * Math.sin(2 * Math.PI * fp * dtP) * Math.cos(0.3 * Math.PI * fp * dtP) * Math.exp(-dtP / 3.2)
    } else if (t >= tS) {
      const dtS = t - tS
      const env = dtS <= riseTime ? dtS / riseTime : Math.exp(-(dtS - riseTime) / tauS)
      a += pga_g * env * (0.82 * Math.sin(2 * Math.PI * fs * dtS) + 0.18 * Math.sin(4 * Math.PI * fs * dtS + 0.6))
    }
    accel[i] = a
  }

  return {
    sampleRateHz,
    dtSec: 1 / sampleRateHz,
    durationSec,
    stationDistKm,
    hypocentralDistKm: Math.round(hypoDist * 10) / 10,
    tP_sec: tP,
    tS_sec: tS,
    warningTimeSec: Math.max(0, tS - tP),
    peakPga_g: pga_g,
    peakPga_cgs: pga_g * 980.665,
    stationMmi: pgaToMmi(pga_g),
    stationVs30,
    alertTimeSec: sasmexAlertTimeSec(stationDistKm, depthKm),
    fp_Hz: fp,
    fs_Hz: fs,
    tauCoda_sec: tauS,
    accel_g: accel,
  }
}
