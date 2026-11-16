import type { LngLat } from '../types/workspace'
import type { EffectiveRoiMetadata, RoiGeometry } from './roi'

export type RiskCategory =
  | 'Inundaciones Costeras'
  | 'Riesgo Pluvial y Fluvial'
  | 'Alta Radiación Solar'
  | 'Relieve de Montaña'
  | 'Humedales y Manglares'

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
  riskCategory: RiskCategory
  recommendedSimulation: 'both' | 'flood' | 'solar'
}

export const PRESET_ROI_CATALOG: readonly CatalogRoiPreset[] = [
  // 1. AGUASCALIENTES
  {
    id: 'aguascalientes-presa-calles',
    name: 'Presa Plutarco Elías Calles — San José de Gracia',
    shortLabel: 'Presa Calles (Ags)',
    state: 'Aguascalientes',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-102.415, 22.148],
    zoom: 13,
    bbox: [-102.455, 22.115, -102.375, 22.185],
    description: 'Cuenca semiárida del Río San Pedro y embalse principal. Caso de gestión hídrica, escorrentía superficial y alta insolación en altiplano.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },

  // 2. BAJA CALIFORNIA
  {
    id: 'bc-valle-mexicali',
    name: 'Valle de Mexicali & Delta del Río Colorado',
    shortLabel: 'Valle Mexicali (BC)',
    state: 'Baja California',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-115.435, 32.618],
    zoom: 13,
    bbox: [-115.485, 32.575, -115.385, 32.665],
    description: 'Planicie aluvial desértica fronteriza bajo nivel de mar relativo con radiación solar extrema (>2,400 kWh/m²/año) y red de canales de riego.',
    riskCategory: 'Alta Radiación Solar',
    recommendedSimulation: 'solar',
  },

  // 3. BAJA CALIFORNIA SUR
  {
    id: 'bcs-los-cabos-estero',
    name: 'San José del Cabo — Estero y Bahía Los Cabos',
    shortLabel: 'Los Cabos (BCS)',
    state: 'Baja California Sur',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-109.695, 23.058],
    zoom: 13,
    bbox: [-109.735, 23.025, -109.655, 23.095],
    description: 'Fachada del Pacífico surpeninsular expuesta a ciclones tropicales directos. Estero de agua dulce e inundaciones de barra litoral.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },

  // 4. CAMPECHE
  {
    id: 'campeche-laguna-terminos',
    name: 'Laguna de Términos & Ciudad del Carmen',
    shortLabel: 'Laguna de Términos',
    state: 'Campeche',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-91.815, 18.652],
    zoom: 13,
    bbox: [-91.865, 18.615, -91.765, 18.695],
    description: 'Mayor laguna estuarina de México y humedales de manglar. Susceptibilidad máxima a mareas de tormenta y aumento de nivel estuarino.',
    riskCategory: 'Humedales y Manglares',
    recommendedSimulation: 'flood',
  },

  // 5. CHIAPAS
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

  // 6. CHIHUAHUA
  {
    id: 'chihuahua-samalayuca',
    name: 'Dunas de Samalayuca & Desierto Chihuahuense',
    shortLabel: 'Dunas Samalayuca',
    state: 'Chihuahua',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-106.505, 31.348],
    zoom: 13,
    bbox: [-106.555, 31.305, -106.455, 31.395],
    description: 'Campo de dunas eólicas móviles de arena silícea en el Altiplano norte. Máxima insolación solar y reflectividad en terreno desértico.',
    riskCategory: 'Alta Radiación Solar',
    recommendedSimulation: 'solar',
  },

  // 7. CIUDAD DE MÉXICO
  {
    id: 'cdmx-xochimilco-canales',
    name: 'Xochimilco — Red de Canales & Zona Lacustre',
    shortLabel: 'Xochimilco (CDMX)',
    state: 'Ciudad de México',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.095, 19.268],
    zoom: 13,
    bbox: [-99.135, 19.235, -99.055, 19.305],
    description: 'Sistema de chinampas y humedales lacustres relictos en el fondo de la cuenca endorreica del Valle de México. Zona de subsidencia y drenaje pluvial crítico.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },

  // 8. COAHUILA
  {
    id: 'coahuila-cuatro-cienegas',
    name: 'Valle de Cuatro Ciénegas — Pozas Kársticas',
    shortLabel: 'Cuatro Ciénegas',
    state: 'Coahuila',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-102.058, 26.985],
    zoom: 13,
    bbox: [-102.105, 26.945, -102.015, 27.035],
    description: 'Oasis biológico de pozas kársticas y dunas de yeso en el desierto. Dinámica hidrogeológica subterránea única y fuerte insolación.',
    riskCategory: 'Humedales y Manglares',
    recommendedSimulation: 'both',
  },

  // 9. COLIMA
  {
    id: 'colima-manzanillo-cuyutlan',
    name: 'Manzanillo — Bahía & Laguna de Cuyutlán',
    shortLabel: 'Manzanillo (Colima)',
    state: 'Colima',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-104.315, 19.062],
    zoom: 13,
    bbox: [-104.365, 19.025, -104.265, 19.105],
    description: 'Principal puerto comercial del Pacífico mexicano junto a la albufera de Cuyutlán. Vulnerabilidad a marejadas ciclónicas y tsunamis.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },

  // 10. DURANGO
  {
    id: 'durango-sierra-espinazo',
    name: 'Sierra Madre Occidental — Cañón & Espinazo del Diablo',
    shortLabel: 'Sierra Durango',
    state: 'Durango',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-105.748, 23.742],
    zoom: 13,
    bbox: [-105.795, 23.705, -105.695, 23.785],
    description: 'Quebradas y barrancas de gran profundidad (>2,000 msnm) en la divisoria de aguas continental. Estudio de sombreado orográfico y pendientes extremas.',
    riskCategory: 'Relieve de Montaña',
    recommendedSimulation: 'solar',
  },

  // 11. ESTADO DE MÉXICO
  {
    id: 'edomex-valle-chalco',
    name: 'Valle de Chalco — Cuenca Lacustre & Río de la Compañía',
    shortLabel: 'Valle de Chalco',
    state: 'Estado de México',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-98.938, 19.292],
    zoom: 13,
    bbox: [-98.985, 19.255, -98.885, 19.335],
    description: 'Planicie lacustre densamente poblada con fuerte subsidencia del terreno. Punto crítico de encharcamientos e inundaciones por desbordamiento de colectores.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },

  // 12. GUANAJUATO
  {
    id: 'guanajuato-valle-santiago',
    name: 'Valle de Santiago — Cráteres y Llanura del Lerma',
    shortLabel: 'Valle de Santiago',
    state: 'Guanajuato',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-101.192, 20.395],
    zoom: 13,
    bbox: [-101.235, 20.355, -101.145, 20.445],
    description: 'Campos volcánicos monogenéticos (Luminarias) y llanura aluvial del Bajío. Caso mixto de radiación solar en valles y escorrentía agrícola hacia el Río Lerma.',
    riskCategory: 'Alta Radiación Solar',
    recommendedSimulation: 'both',
  },

  // 13. GUERRERO
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

  // 14. HIDALGO
  {
    id: 'hidalgo-tula-rio',
    name: 'Tula de Allende — Valle del Mezquital & Río Tula',
    shortLabel: 'Tula de Allende',
    state: 'Hidalgo',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.325, 20.052],
    zoom: 13,
    bbox: [-99.365, 20.015, -99.285, 20.085],
    description: 'Garganta fluvial y corredor urbano del Río Tula receptor de descargas metropolitanas. Historial crítico de inundaciones torrenciales y desbordamiento.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },

  // 15. JALISCO
  {
    id: 'jalisco-vallarta-ameca',
    name: 'Puerto Vallarta — Bahía de Banderas & Delta del Río Ameca',
    shortLabel: 'Puerto Vallarta',
    state: 'Jalisco',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-105.235, 20.688],
    zoom: 13,
    bbox: [-105.285, 20.645, -105.185, 20.735],
    description: 'Confluencia de la Sierra de Cuale con el Océano Pacífico y delta del Río Ameca. Riesgo pluvial rápido por cuencas de respuesta corta y marejada.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },

  // 16. MICHOACÁN
  {
    id: 'michoacan-lazaro-cardenas',
    name: 'Lázaro Cárdenas — Delta del Río Balsas & Costa Michoacana',
    shortLabel: 'Lázaro Cárdenas',
    state: 'Michoacán',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-102.202, 17.965],
    zoom: 13,
    bbox: [-102.245, 17.925, -102.155, 18.005],
    description: 'Desembocadura de la mayor cuenca hidrográfica del sur mexicano (Río Balsas). Complejo portuario, barras arenosas e impacto hidrometeorológico.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },

  // 17. MORELOS
  {
    id: 'morelos-cuautla-yautepec',
    name: 'Cuautla — Valle Cálido & Cuenca del Río Yautepec',
    shortLabel: 'Valle de Cuautla',
    state: 'Morelos',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-98.945, 18.818],
    zoom: 13,
    bbox: [-98.985, 18.785, -98.905, 18.855],
    description: 'Valle intermontano de alta insolación y escorrentía rápida proveniente de las laderas del Popocatépetl y el Chichinautzin.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },

  // 18. NAYARIT
  {
    id: 'nayarit-san-blas-marismas',
    name: 'San Blas & Marismas Nacionales del Pacífico',
    shortLabel: 'San Blas (Marismas)',
    state: 'Nayarit',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-105.272, 21.542],
    zoom: 13,
    bbox: [-105.315, 21.505, -105.225, 21.585],
    description: 'Uno de los complejos de manglares más extensos del Pacífico americano. Zona de transición marea-río y esteros de gran productividad ecológica.',
    riskCategory: 'Humedales y Manglares',
    recommendedSimulation: 'flood',
  },

  // 19. NUEVO LEÓN
  {
    id: 'nuevo-leon-monterrey-huasteca',
    name: 'Monterrey — Cañón de la Huasteca & Río Santa Catarina',
    shortLabel: 'Monterrey (Huasteca)',
    state: 'Nuevo León',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-100.432, 25.662],
    zoom: 13,
    bbox: [-100.485, 25.615, -100.385, 25.705],
    description: 'Garganta caliza escarpada de la Sierra Madre Oriental que encauza avenidas torrenciales extraordinarias hacia el área metropolitana de Monterrey.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },

  // 20. OAXACA
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

  // 21. PUEBLA
  {
    id: 'puebla-angelopolis-atoyac',
    name: 'Puebla — Valle de Angelópolis & Cuenca del Río Atoyac',
    shortLabel: 'Puebla (Angelópolis)',
    state: 'Puebla',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-98.222, 19.032],
    zoom: 13,
    bbox: [-98.265, 18.995, -98.175, 19.075],
    description: 'Altiplano poblano a 2,150 msnm dominado por el drenaje del Río Atoyac y escorrentías del Iztaccíhuatl y Malinche. Encharcamientos pluviales urbanos.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },

  // 22. QUERÉTARO
  {
    id: 'queretaro-sierra-gorda',
    name: 'Jalpan de Serra — Reserva de la Biosfera Sierra Gorda',
    shortLabel: 'Sierra Gorda (Qro)',
    state: 'Querétaro',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.452, 21.222],
    zoom: 13,
    bbox: [-99.495, 21.185, -99.405, 21.265],
    description: 'Relieve kárstico quebrado con cañones, sótanos y microclimas contrastantes. Análisis de exposición a insolación orográfica y cuencas de montaña.',
    riskCategory: 'Relieve de Montaña',
    recommendedSimulation: 'solar',
  },

  // 23. QUINTANA ROO
  {
    id: 'quintana-roo-cancun-nichupte',
    name: 'Cancún — Cordón Litoral & Laguna Nichupté',
    shortLabel: 'Cancún (Nichupté)',
    state: 'Quintana Roo',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-86.812, 21.142],
    zoom: 13,
    bbox: [-86.855, 21.105, -86.765, 21.185],
    description: 'Isla de barrera costera entre el Mar Caribe y el sistema lagunar Nichupté sobre plataforma kárstica. Exposición extrema a huracanes atlánticos.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },

  // 24. SAN LUIS POTOSÍ
  {
    id: 'slp-ciudad-valles-huasteca',
    name: 'Ciudad Valles — Huasteca Potosina & Cuenca del Río Tampaón',
    shortLabel: 'Ciudad Valles (SLP)',
    state: 'San Luis Potosí',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-99.002, 21.992],
    zoom: 13,
    bbox: [-99.045, 21.955, -98.955, 22.035],
    description: 'Transición entre la planicie costera del Golfo y la Sierra Madre Oriental. Ríos kársticos de caudal torrencial e inundaciones de llanura selva.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },

  // 25. SINALOA
  {
    id: 'sinaloa-culiacan-valles',
    name: 'Culiacán — Confluencia de Ríos Humaya y Tamazula',
    shortLabel: 'Culiacán (Sinaloa)',
    state: 'Sinaloa',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-107.385, 24.808],
    zoom: 13,
    bbox: [-107.435, 24.775, -107.335, 24.845],
    description: 'Corazón agrícola del noroeste donde confluyen los principales ríos serranos para formar el Río Culiacán hacia el Golfo de California.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },

  // 26. SONORA
  {
    id: 'sonora-penasco-altar',
    name: 'Puerto Peñasco — Gran Desierto de Altar & Mar de Cortés',
    shortLabel: 'Desierto de Altar',
    state: 'Sonora',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-113.522, 31.322],
    zoom: 13,
    bbox: [-113.575, 31.285, -113.475, 31.365],
    description: 'Mayor campo activo de dunas en Norteamérica junto al Alto Golfo de California. Zona de máxima irradiancia solar anual (>2,500 kWh/m²).',
    riskCategory: 'Alta Radiación Solar',
    recommendedSimulation: 'solar',
  },

  // 27. TABASCO
  {
    id: 'tabasco-villahermosa-delta',
    name: 'Villahermosa — Meandros de los Ríos Carrizal y Grijalva',
    shortLabel: 'Villahermosa (Delta)',
    state: 'Tabasco',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-92.922, 18.002],
    zoom: 13,
    bbox: [-92.965, 17.965, -92.875, 18.045],
    description: 'Llanura aluvial del delta Grijalva-Usumacinta receptora de una tercera parte del agua dulce de México. Máximo riesgo nacional de inundación por encharcamiento y desbordamiento.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'flood',
  },

  // 28. TAMAULIPAS
  {
    id: 'tamaulipas-tampico-panuco',
    name: 'Tampico — Desembocadura del Río Pánuco & Laguna del Chairel',
    shortLabel: 'Tampico (Pánuco)',
    state: 'Tamaulipas',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-97.862, 22.252],
    zoom: 13,
    bbox: [-97.905, 22.215, -97.815, 22.295],
    description: 'Sistema estuarino del Golfo de México donde el Río Pánuco se une a un cinturón de lagunas someras. Vulnerabilidad a tormentas tropicales y avenidas del Pánuco.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },

  // 29. TLAXCALA
  {
    id: 'tlaxcala-valle-zahuapan',
    name: 'Valle de Tlaxcala & Cuenca del Río Zahuapan',
    shortLabel: 'Valle de Tlaxcala',
    state: 'Tlaxcala',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-98.232, 19.322],
    zoom: 13,
    bbox: [-98.275, 19.285, -98.185, 19.365],
    description: 'Cuenca alta intermontana del altiplano central flanqueada por el volcán La Malinche. Escorrentía pluvial acelerada y transporte de sedimentos en cauce.',
    riskCategory: 'Riesgo Pluvial y Fluvial',
    recommendedSimulation: 'both',
  },

  // 30. VERACRUZ
  {
    id: 'veracruz-puerto-jamapa',
    name: 'Puerto de Veracruz & Boca del Río — Delta del Río Jamapa',
    shortLabel: 'Veracruz / Boca del Río',
    state: 'Veracruz',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-96.122, 19.172],
    zoom: 13,
    bbox: [-96.165, 19.135, -96.075, 19.215],
    description: 'Principal conurbación costera del Golfo de México en la desembocadura del Río Jamapa. Vulnerable a marejadas ciclónicas, eventos de "Norte" y desbordamientos fluviales.',
    riskCategory: 'Inundaciones Costeras',
    recommendedSimulation: 'both',
  },

  // 31. YUCATÁN
  {
    id: 'yucatan-celestun-estuario',
    name: 'Ría Celestún — Estuario y Humedales Kársticos',
    shortLabel: 'Ría Celestún',
    state: 'Yucatán',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-90.382, 20.862],
    zoom: 13,
    bbox: [-90.425, 20.825, -90.335, 20.905],
    description: 'Corredor hidrológico de la plataforma kárstica yucateca con manantiales de agua dulce en manglares (petenes). Alta radiación y dinámica de marea.',
    riskCategory: 'Humedales y Manglares',
    recommendedSimulation: 'both',
  },

  // 32. ZACATECAS
  {
    id: 'zacatecas-sombrerete-organos',
    name: 'Sombrerete — Parque Nacional Sierra de Órganos',
    shortLabel: 'Sierra de Órganos',
    state: 'Zacatecas',
    country: 'México',
    countryCode: 'MX',
    flag: '🇲🇽',
    center: [-103.782, 23.782],
    zoom: 13,
    bbox: [-103.825, 23.745, -103.735, 23.825],
    description: 'Formaciones rocosas monolíticas de riolita en el Altiplano Central (2,300 msnm). Atmósfera diáfana con potencial de radiación solar excepcional y relieve montañoso.',
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

/** Agrupa las ROIs jerárquicamente por País y Estado, ordenadas alfabéticamente. */
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
    // Ordenar estados alfabéticamente
    const sortedStates = Array.from(countryEntry.statesMap.entries())
      .sort(([stateA], [stateB]) => stateA.localeCompare(stateB, 'es', { sensitivity: 'base' }))
      .map(([state, presets]) => ({
        state,
        presets,
      }))

    result.push({
      country: countryEntry.country,
      countryCode: countryEntry.countryCode,
      flag: countryEntry.flag,
      states: sortedStates,
    })
  }

  return result
}
