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

export interface SeismicSimulationResults {
  source: SeismicSource
  epicentralPga_g: number
  epicentralPga_cgs: number
  epicentralMmi: number
  rings: IsoseismalRing[]
  pWaveSpeedKmS: number
  sWaveSpeedKmS: number
  /** Datos para gráfica 2D de Atenuación (PGA vs Distancia) */
  attenuationCurve: {
    distanceKm: number
    pga_g: number
    pga_cgs: number
    mmi: number
    tP_sec: number
    tS_sec: number
    warningTimeSec: number
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

/**
 * Predice la aceleración pico del suelo (PGA en g) con el modelo GMPE calibrado para México.
 * ln(PGA) = c1 + c2*Mw - c3*ln(R) - c4*R + S_sitio
 */
export function computePga_g(
  distanceEpicentralKm: number,
  magnitude: number,
  depthKm: number,
  mechanism: SeismicMechanism = 'subduction',
  soilType: SoilType = 'intermediate'
): number {
  const R = Math.sqrt(distanceEpicentralKm * distanceEpicentralKm + depthKm * depthKm)

  let c1 = -1.85
  let c2 = 0.92
  let c3 = 1.15
  const c4 = 0.0032

  if (mechanism === 'intraplate') {
    c1 += 0.18 // Mayor caída de esfuerzos en intraplaca
  } else if (mechanism === 'crustal') {
    c3 = 1.25 // Mayor atenuación geométrica en corteza somera
  }

  let siteFactor = 0.0
  if (soilType === 'rock') {
    siteFactor = -0.15
  } else if (soilType === 'intermediate') {
    siteFactor = 0.18
  } else if (soilType === 'soft_lacustrine') {
    siteFactor = 0.85 // Amplificación por resonancia en arcillas lacustres
  }

  const lnPga = c1 + c2 * magnitude - c3 * Math.log(R) - c4 * R + siteFactor
  const pga = Math.exp(lnPga)
  return Math.max(0.0001, Math.min(2.5, pga))
}

/**
 * Convierte aceleración pico del terreno a escala de Intensidad Mercalli Modificada (MMI).
 * Relación empírica Worden & Wald:
 * PGA en cm/s² = pga_g * 980.665
 */
export function pgaToMmi(pga_g: number): number {
  const pga_cgs = pga_g * 980.665 // cm/s²
  let mmi: number
  if (pga_cgs <= 4.22) {
    mmi = 2.2 * Math.log10(pga_cgs) + 1.0
  } else {
    mmi = 3.66 * Math.log10(pga_cgs) - 1.66
  }
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
  soilType: SoilType
): number {
  const pgaAtEpicenter = computePga_g(0, magnitude, depthKm, mechanism, soilType)
  if (pgaAtEpicenter < targetPga_g) {
    return 0 // El sismo ni siquiera alcanza este umbral en el epicentro
  }

  let low = 0
  let high = 1500 // km máx de búsqueda
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2
    const pgaMid = computePga_g(mid, magnitude, depthKm, mechanism, soilType)
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

  const epicentralPga_g = computePga_g(0, magnitude, depthKm, mechanism, soilType)
  const epicentralPga_cgs = epicentralPga_g * 980.665
  const epicentralMmi = pgaToMmi(epicentralPga_g)

  const vp = 6.0 // km/s (Onda P)
  const vs = 3.5 // km/s (Onda S)

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
    const rKm = solveDistanceForPga(spec.pgaThreshold_g, magnitude, depthKm, mechanism, soilType)
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
    const pga = computePga_g(dist, magnitude, depthKm, mechanism, soilType)
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
    attenuationCurve,
  }
}
