import type { LngLat } from '../types/workspace'
import type { EffectiveRoiMetadata, RoiGeometry } from './roi'

export interface CatalogRoiPreset {
  id: string
  name: string
  shortLabel: string
  state: string
  country: string
  countryCode: string
  flag: string
  center: LngLat
  zoom: number
  bbox: [number, number, number, number] // [west, south, east, north]
  description: string
  riskCategory: 'Inundaciones Costeras' | 'Riesgo Pluvial y Fluvial' | 'Alta Radiación Solar' | 'Relieve de Montaña' | 'Humedales y Manglares'
  recommendedSimulation: 'both' | 'flood' | 'solar'
}

export const PRESET_ROI_CATALOG: readonly CatalogRoiPreset[] = [
  // --- MÉXICO: ESTADO DE GUERRERO ---
  {
    id: 'acapulco-bahia',
    name: 'Acapulco — Bahía & Costera Miguel Alemán',
    shortLabel: 'Acapulco (Bahía)',
    state: 'Guerrero',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.880, 16.852],
    zoom: 13,
    bbox: [-99.915, 16.820, -99.845, 16.885],
    description: 'Anfiteatro montañoso de la Sierra Madre del Sur y fachada marítima de la Bahía de Santa Lucía.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },
  {
    id: 'acapulco-diamante',
    name: 'Acapulco — Zona Diamante & Laguna de Tres Palos',
    shortLabel: 'Acapulco (Diamante)',
    state: 'Guerrero',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.770, 16.775],
    zoom: 13,
    bbox: [-99.825, 16.735, -99.715, 16.815],
    description: 'Planicie aluvial de muy baja elevación, cordón litoral y esteros. Zona crítica de acumulación por huracanes e inundaciones extraordinarias.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'flood',
  },
  {
    id: 'acapulco-pie-cuesta',
    name: 'Acapulco — Barra Pie de la Cuesta & Laguna de Coyuca',
    shortLabel: 'Pie de la Cuesta',
    state: 'Guerrero',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-100.000, 16.925],
    zoom: 13,
    bbox: [-100.045, 16.885, -99.955, 16.965],
    description: 'Cordón de barra costera entre el Océano Pacífico y la Laguna de Coyuca, ecosistema de humedales costeros.',
    riskCategory: 'Humedales y Manglares',
    recommendedSimulation: 'both',
  },
  {
    id: 'chilpancingo-valle',
    name: 'Chilpancingo — Valle Central & Río Huacapa',
    shortLabel: 'Chilpancingo (Centro)',
    state: 'Guerrero',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.502, 17.550],
    zoom: 13,
    bbox: [-99.535, 17.515, -99.470, 17.585],
    description: 'Capital del estado de Guerrero. Valle intermontano estrecho encañonado por el Río Huacapa con alta susceptibilidad a crecidas repentinas.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },
  {
    id: 'zihuatanejo-ixtapa',
    name: 'Zihuatanejo / Ixtapa — Bahía y Costa Grande',
    shortLabel: 'Zihuatanejo / Ixtapa',
    state: 'Guerrero',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-101.550, 17.640],
    zoom: 13,
    bbox: [-101.595, 17.605, -101.505, 17.675],
    description: 'Relieve abrupto costero de la Costa Grande guerrerense, laderas con pendiente pronunciada hacia caletas naturales.',
    riskCategory: 'Relieve de Montaña',
    recommendedSimulation: 'solar',
  },
  {
    id: 'coyuca-benitez',
    name: 'Coyuca de Benítez — Cuenca Baja & Río Coyuca',
    shortLabel: 'Coyuca de Benítez',
    state: 'Guerrero',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-100.080, 17.015],
    zoom: 13,
    bbox: [-100.125, 16.975, -100.035, 17.055],
    description: 'Valle aluvial fértil y delta fluvial con zonas agropecuarias inundables en eventos extremos.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },
  {
    id: 'taxco-sierra',
    name: 'Taxco de Alarcón — Sierra Norte & Relieve Escarpado',
    shortLabel: 'Taxco de Alarcón',
    state: 'Guerrero',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.605, 18.555],
    zoom: 14,
    bbox: [-99.635, 18.525, -99.575, 18.585],
    description: 'Topografía de montaña quebrada (1,700 - 2,400 msnm). Ideal para análisis de sombreado orográfico e irradiancia solar en laderas.',
    riskCategory: 'Relieve de Montaña',
    recommendedSimulation: 'solar',
  },

  // --- MÉXICO: ESTADO DE CHIAPAS ---
  {
    id: 'sumidero-tuxtla',
    name: 'Cañón del Sumidero & Tuxtla Gutiérrez',
    shortLabel: 'Cañón del Sumidero',
    state: 'Chiapas',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-93.090, 16.760],
    zoom: 13,
    bbox: [-93.135, 16.715, -93.045, 16.805],
    description: 'Paredes verticales de caliza kárstica de más de 800m sobre el Río Grijalva. Zona oficial calibrada para NISAR GCOV.',
    riskCategory: 'Relieve de Montaña',
    recommendedSimulation: 'both',
  },
  {
    id: 'soconusco-costa',
    name: 'Soconusco — Tapachula & Vertiente del Pacífico',
    shortLabel: 'Soconusco Costa',
    state: 'Chiapas',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-92.270, 14.900],
    zoom: 13,
    bbox: [-92.325, 14.855, -92.215, 14.945],
    description: 'Planicie costera del Pacífico sur y faldas del Volcán Tacaná. Zona de precipitación tropical muy intensa y cultivos de alta humedad.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },
  {
    id: 'encrucijada-manglares',
    name: 'Reserva de la Biosfera La Encrucijada',
    shortLabel: 'La Encrucijada (Manglares)',
    state: 'Chiapas',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-92.890, 15.160],
    zoom: 12,
    bbox: [-92.955, 15.095, -92.825, 15.225],
    description: 'Ecosistema de manglares estuarinos de hasta 35m de altura. Dinámica hidrológica influida por mareas y descargas fluviales.',
    riskCategory: 'Humedales y Manglares',
    recommendedSimulation: 'both',
  },
  {
    id: 'malpaso-grijalva',
    name: 'Presa Malpaso / Nezahualcóyotl (Río Grijalva)',
    shortLabel: 'Presa Malpaso',
    state: 'Chiapas',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-93.580, 17.200],
    zoom: 12,
    bbox: [-93.635, 17.145, -93.525, 17.255],
    description: 'Embalse hidroeléctrico estratégico en la cuenca del Grijalva, laderas pronunciadas y control de avenidas.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },
  {
    id: 'san-cristobal-valle',
    name: 'San Cristóbal de las Casas — Valle de Jovel',
    shortLabel: 'San Cristóbal (Jovel)',
    state: 'Chiapas',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-92.635, 16.735],
    zoom: 13,
    bbox: [-92.675, 16.705, -92.595, 16.765],
    description: 'Valle endorreico de montaña en los Altos de Chiapas a 2,200 msnm. Alto riesgo de encharcamientos por drenaje subterráneo en sumideros.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },

  // --- MÉXICO: ESTADO DE OAXACA ---
  {
    id: 'puerto-escondido',
    name: 'Puerto Escondido & Zicatela',
    shortLabel: 'Puerto Escondido',
    state: 'Oaxaca',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-97.060, 15.870],
    zoom: 13,
    bbox: [-97.105, 15.835, -97.015, 15.905],
    description: 'Costa del Pacífico sur oaxaqueño con fuerte oleaje, caletas y desembocaduras de ríos costeros.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },
  {
    id: 'salina-cruz-istmo',
    name: 'Salina Cruz — Istmo de Tehuantepec',
    shortLabel: 'Salina Cruz (Istmo)',
    state: 'Oaxaca',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-95.190, 16.175],
    zoom: 13,
    bbox: [-95.235, 16.135, -95.145, 16.215],
    description: 'Corredor interoceánico de gran insolación solar y topografía plana costera.',
    riskCategory: 'Alta Radiación Solar',
    recommendedSimulation: 'solar',
  },
]

/** Convierte una ROI preconfigurada en polígono GeoJSON para simulación o visualización. */
export function presetToRoiPolygon(preset: CatalogRoiPreset): RoiGeometry {
  const [w, s, e, n] = preset.bbox
  return {
    type: 'Polygon',
    coordinates: [[
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ]],
  }
}

/** Convierte una ROI preconfigurada en anillo de recorte [LngLat, ...] sin duplicar el primer vértice. */
export function presetToCropRing(preset: CatalogRoiPreset): LngLat[] {
  const [w, s, e, n] = preset.bbox
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ]
}

/** Genera los metadatos correspondientes para registrar la ROI en el mapa activo. */
export function presetToEffectiveMetadata(preset: CatalogRoiPreset): EffectiveRoiMetadata {
  return {
    name: preset.name,
    center: preset.center,
    radius_km: 5,
    applied_radius_km: 5,
    source: `catalog:${preset.countryCode.toLowerCase()}:${preset.state.toLowerCase()}`,
    generation: 'administrative_original',
  }
}

export interface CatalogGroupedCountry {
  country: string
  countryCode: string
  flag: string
  states: {
    state: string
    presets: CatalogRoiPreset[]
  }[]
}

/** Agrupa las ROIs jerárquicamente por País y Estado. */
export function getCatalogGrouped(): CatalogGroupedCountry[] {
  const countriesMap = new Map<string, { country: string; countryCode: string; flag: string; statesMap: Map<string, CatalogRoiPreset[]> }>()

  for (const preset of PRESET_ROI_CATALOG) {
    let countryEntry = countriesMap.get(preset.country)
    if (!countryEntry) {
      countryEntry = {
        country: preset.country,
        countryCode: preset.countryCode,
        flag: preset.flag,
        statesMap: new Map<string, CatalogRoiPreset[]>(),
      }
      countriesMap.set(preset.country, countryEntry)
    }

    let statePresets = countryEntry.statesMap.get(preset.state)
    if (!statePresets) {
      statePresets = []
      countryEntry.statesMap.set(preset.state, statePresets)
    }
    statePresets.push(preset)
  }

  const result: CatalogGroupedCountry[] = []
  for (const countryEntry of countriesMap.values()) {
    const states = Array.from(countryEntry.statesMap.entries()).map(([state, presets]) => ({
      state,
      presets,
    }))
    result.push({
      country: countryEntry.country,
      countryCode: countryEntry.countryCode,
      flag: countryEntry.flag,
      states,
    })
  }

  return result
}
