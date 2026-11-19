/** Built-in NISAR stage-1 figure catalog shown by ScientificFiguresViewer (data only). */
export interface ScientificFigure {
  id: string
  code: string
  title: string
  subtitle: string
  filename: string
  category: 'incidencia' | 'retrodispersion' | 'mascara' | 'estadistica'
  description: string
  details: string[]
  tags: string[]
  aspectRatio: 'standard' | 'wide'
}

export const SCIENTIFIC_FIGURES: ScientificFigure[] = [
  {
    id: 'incidencia',
    code: 'Figura E',
    title: 'Ángulo de Incidencia en la ROI',
    subtitle: 'metadata/radarGrid · Malla 500 m · Altura 500 m sobre el elipsoide',
    filename: 'E_incidencia.png',
    category: 'incidencia',
    description:
      'Distribución espacial del ángulo de incidencia θi en grados sobre la ROI oficial de Chiapas en EPSG:32615. Generada con colormap Viridis uniforme.',
    details: [
      'Proyección: EPSG:32615 (UTM zona 15N en km)',
      'Espaciado de malla: dx = 500 m, dy = 500 m',
      'Rango angular: 42.5° a 45.2° (banda ancha L-band)',
      'Altura de referencia: 500 m s.n.e.',
      'Contorno rojo: Delimitación poligonal de la ROI',
    ],
    tags: ['Viridis', '500m RadarGrid', 'θi (degrees)', 'EPSG:32615'],
    aspectRatio: 'standard',
  },
  {
    id: 'roi_gamma0',
    code: 'Figura B',
    title: 'Retrodispersión RTC γ⁰ [dB] (HHHH vs HVHV)',
    subtitle: 'Multilook 2×2 (píxel 20 m) · Escala común percentiles 2–98: -19.36 a -3.10 dB',
    filename: 'B_roi_gamma0_dB.png',
    category: 'retrodispersion',
    description:
      'Comparativa simultánea de las polarizaciones HHHH (copolarizada) y HVHV (cruzada) con corrección radiométrica de terreno (RTC). Permite delimitar cuerpos de agua y rugosidad.',
    details: [
      'Resolución espacial: 20 m (multilook 2×2)',
      'Escala radiométrica: -19.36 a -3.10 dB común',
      'Cuerpos de agua: Reflejo especular en negro (< -16 dB)',
      'Vegetación / Selva: Retorno difuso alto en gris/blanco',
      'Ejes: Coordenadas UTM EPSG:32615 en km',
    ],
    tags: ['γ⁰ RTC', 'Dual-Pol HH/HV', '20m Multilook', 'Escala Común'],
    aspectRatio: 'wide',
  },
  {
    id: 'mascara',
    code: 'Figura D',
    title: 'Máscara de Calidad y Subfranja en la ROI',
    subtitle: 'Clasificación píxel a píxel en la ventana geográfica de análisis',
    filename: 'D_mascara.png',
    category: 'mascara',
    description:
      'Validación de datos en la ventana de la ROI. Cuantifica píxeles válidos dentro de la subfranja de adquisición (99.39%), áreas fuera de polígono y zonas no válidas por sombra de radar.',
    details: [
      'Válido (subfranja verde): 99.393 % de píxeles',
      'No válido / sombra (rojo): 0.391 % en cañones profundos',
      'Fuera del polígono ROI (gris): 0.217 %',
      'Fuera de adquisición (azul): 0.000 %',
      'Resolución: Submuestreo 1 de cada 3 px para visualización',
    ],
    tags: ['Máscara QA', 'Subfranja', '99.4% Válido', 'Matplotlib'],
    aspectRatio: 'standard',
  },
  {
    id: 'roi_sigma0',
    code: 'Figura B2',
    title: 'Retrodispersión Elipsoidal σ⁰ [dB] (HHHH vs HVHV)',
    subtitle: 'Calibración σ⁰ = γ⁰ · rtcGammaToSigmaFactor (multilook 20 m)',
    filename: 'B2_roi_sigma0_dB.png',
    category: 'retrodispersion',
    description:
      'Retrodispersión convencional referida al elipsoide WGS-84 antes de la corrección topográfica de pendiente. Útil para verificar la ganancia del factor radiométrico local.',
    details: [
      'Normalización: Normal del elipsoide sin DEM',
      'Canales: HHHH y HVHV lado a lado con escala común',
      'Efecto de relieve: Realce en laderas de cara al sensor',
      'Resolución: 20 × 20 m en EPSG:32615',
    ],
    tags: ['σ⁰ Elipsoidal', 'Factor RTC', 'Dual-Pol', 'NISAR Level 2'],
    aspectRatio: 'wide',
  },
  {
    id: 'histogramas',
    code: 'Figura C',
    title: 'Histogramas de Densidad Espectral en dB',
    subtitle: 'Distribución estadística completa con media, mediana y percentiles 5–95',
    filename: 'C_histogramas_gamma0_dB.png',
    category: 'estadistica',
    description:
      'Curvas de densidad de probabilidad y estadísticas anotadas (media de dB, mediana, dB de la media lineal) con ventana acotada a p0.2–p99.8 para evitar compresión de colas.',
    details: [
      'Píxeles válidos: > 14.6 millones por canal',
      'Media HHHH: -9.86 dB | Mediana: -9.53 dB',
      'Media HVHV: -16.42 dB | Mediana: -16.12 dB',
      'Franja p5–p95: Marcada en azul suave',
      'Líneas rojas: Desglose de medidas de tendencia central',
    ],
    tags: ['Histogramas', 'Densidad dB', 'Percentiles 5-95', 'Estadística'],
    aspectRatio: 'wide',
  },
]
