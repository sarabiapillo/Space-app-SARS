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

/** Coeficientes de la ec. 11 por mecanismo (manual §5.1). */
export const GMPE_COEFFICIENTS: Readonly<Record<SeismicMechanism, { c1: number; c2: number; c3: number; c4: number }>> = Object.freeze({
  subduction: { c1: -1.85, c2: 0.92, c3: 1.15, c4: 0.0032 },
  intraplate: { c1: -1.55, c2: 0.96, c3: 1.25, c4: 0.0040 },
  crustal: { c1: -1.95, c2: 0.88, c3: 1.05, c4: 0.0028 },
})

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
 * Aceleración pico del suelo (PGA en g), ec. 11 con saturación de campo cercano:
 * ln(PGA) = c1 + c2·Mw − c3·ln(R_ef) − c4·R_ef + S_sitio, con R_ef = √(D² + h² + h_sat(Mw)²).
 * Aun con saturación, los coeficientes del manual dan más de 2.5 g junto a la fuente en sismos
 * grandes; se acota a [0.0001, 2.5] g como salvaguarda (documentado).
 */
export function computePga_g(
  distanceEpicentralKm: number,
  magnitude: number,
  depthKm: number,
  mechanism: SeismicMechanism = 'subduction',
  soilType: SoilType = 'intermediate',
  vs30?: number | null
): number {
  const hSat = nearSourceSaturationKm(magnitude)
  const R = Math.sqrt(distanceEpicentralKm * distanceEpicentralKm + depthKm * depthKm + hSat * hSat)
  const { c1, c2, c3, c4 } = GMPE_COEFFICIENTS[mechanism]
  const lnPga = c1 + c2 * magnitude - c3 * Math.log(R) - c4 * R + siteAmplification(effectiveVs30(soilType, vs30))
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
