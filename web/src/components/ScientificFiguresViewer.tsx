import { useState } from 'react'
import {
  Download,
  FileCheck,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react'
import { RAW_SCENE_IDS } from '../mocks/initialWorkspaces'
import { useTranslation } from '../i18n/useTranslation'

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

interface ScientificFiguresViewerProps {
  sceneId?: string
  dateLabel?: string
  onClose?: () => void
}

export function ScientificFiguresViewer({
  sceneId = RAW_SCENE_IDS.T62_T2_20261016,
  dateLabel = '2026-10-16 (t2)',
  onClose,
}: ScientificFiguresViewerProps) {
  const { t, localizeText } = useTranslation()
  const [selectedCategory, setSelectedCategory] = useState<string>('todas')
  const [modalFigure, setModalFigure] = useState<ScientificFigure | null>(null)
  const [zoomLevel, setZoomLevel] = useState<number>(1)
  const [imgLoadErrors, setImgLoadErrors] = useState<Record<string, boolean>>({})

  const filteredFigures =
    selectedCategory === 'todas'
      ? SCIENTIFIC_FIGURES
      : SCIENTIFIC_FIGURES.filter((f) => f.category === selectedCategory)

  const getFigureUrl = (filename: string) => `/data/explore/${sceneId}/figuras/${filename}`

  const handleDownload = (fig: ScientificFigure) => {
    const link = document.createElement('a')
    link.href = getFigureUrl(fig.filename)
    link.download = `${sceneId}_${fig.filename}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="ws-sci-figures">
      {/* Cabecera del Visor Científico */}
      <div className="ws-sci-figures__header">
        <div className="ws-sci-figures__header-info">
          <div className="ws-sci-figures__badge-row">
            <span className="ws-sci-badge ws-sci-badge--verified">
              <FileCheck size={12} /> {t('Figuras Oficiales Matplotlib (Backend C4)', 'Matplotlib scientific figures (Backend C4)')}
            </span>
            <span className="ws-sci-badge ws-sci-badge--date">{dateLabel}</span>
            <span className="ws-sci-badge ws-sci-badge--dpi">150 DPI · {t('Publicación', 'Publication')}</span>
          </div>
          <h2 className="ws-sci-figures__title">
            {t('Inspección SAR de Calibración y Geometría Radar (NISAR GCOV)', 'SAR inspection of calibration and radar geometry (NISAR GCOV)')}
          </h2>
          <p className="ws-sci-figures__subtitle">
            {t('Gráficas científicas oficiales generadas directamente por el pipeline en Python', 'Scientific figures generated directly by the Python pipeline')}
            (<code>pipeline/etapa1_figuras.py</code>) {t('con mallas cartográficas en EPSG:32615.', 'on cartographic grids in EPSG:32615.')}
          </p>
        </div>

        {onClose && (
          <button
            type="button"
            className="ws-sci-figures__close-btn"
            onClick={onClose}
            title={t('Cerrar visor de figuras científicas', 'Close scientific figures viewer')}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Barra de Filtros por Categoría */}
      <div className="ws-sci-figures__toolbar">
        <div className="ws-sci-figures__categories">
          <button
            type="button"
            className={`ws-sci-filter-btn ${selectedCategory === 'todas' ? 'is-active' : ''}`}
            onClick={() => setSelectedCategory('todas')}
          >
            {t('Todas', 'All')} ({SCIENTIFIC_FIGURES.length})
          </button>
          <button
            type="button"
            className={`ws-sci-filter-btn ${selectedCategory === 'incidencia' ? 'is-active' : ''}`}
            onClick={() => setSelectedCategory('incidencia')}
          >
            📐 {t('Ángulo de Incidencia', 'Incidence angle')}
          </button>
          <button
            type="button"
            className={`ws-sci-filter-btn ${selectedCategory === 'retrodispersion' ? 'is-active' : ''}`}
            onClick={() => setSelectedCategory('retrodispersion')}
          >
            📡 {t('Retrodispersión (γ⁰ y σ⁰)', 'Backscatter (γ⁰ and σ⁰)')}
          </button>
          <button
            type="button"
            className={`ws-sci-filter-btn ${selectedCategory === 'mascara' ? 'is-active' : ''}`}
            onClick={() => setSelectedCategory('mascara')}
          >
            🟩 {t('Máscara QA y Subfranja', 'QA mask and subswath')}
          </button>
          <button
            type="button"
            className={`ws-sci-filter-btn ${selectedCategory === 'estadistica' ? 'is-active' : ''}`}
            onClick={() => setSelectedCategory('estadistica')}
          >
            📊 {t('Histogramas en dB', 'Histograms in dB')}
          </button>
        </div>

        <div className="ws-sci-figures__meta-right">
          <span>{t('Escena:', 'Scene:')} <code>{sceneId.slice(0, 32)}...</code></span>
        </div>
      </div>

      {/* Rejilla de Tarjetas Científicas */}
      <div className="ws-sci-figures__grid">
        {filteredFigures.map((fig) => {
          const imgUrl = getFigureUrl(fig.filename)
          const hasError = imgLoadErrors[fig.id]

          return (
            <article
              key={fig.id}
              className={`ws-sci-card ${fig.aspectRatio === 'wide' ? 'ws-sci-card--wide' : ''}`}
            >
              <div className="ws-sci-card__header">
                <div className="ws-sci-card__title-wrap">
                  <span className="ws-sci-card__code">{localizeText(fig.code)}</span>
                  <h3 className="ws-sci-card__title">{localizeText(fig.title)}</h3>
                </div>
                <div className="ws-sci-card__actions">
                  <button
                    type="button"
                    className="ws-sci-btn ws-sci-btn--icon"
                    onClick={() => {
                      setModalFigure(fig)
                      setZoomLevel(1)
                    }}
                    title={t('Ampliar en pantalla completa con zoom', 'Open full screen with zoom')}
                  >
                    <Maximize2 size={13} />
                  </button>
                  <button
                    type="button"
                    className="ws-sci-btn ws-sci-btn--icon"
                    onClick={() => handleDownload(fig)}
                    title={t('Descargar imagen PNG en alta resolución', 'Download high-resolution PNG image')}
                  >
                    <Download size={13} />
                  </button>
                </div>
              </div>

              <p className="ws-sci-card__subtitle">{localizeText(fig.subtitle)}</p>

              {/* Contenedor de la Imagen Científica con Zoom preview al hacer clic */}
              <div
                className="ws-sci-card__preview"
                onClick={() => {
                  setModalFigure(fig)
                  setZoomLevel(1)
                }}
                title={t('Hacer clic para ver en pantalla completa con lupa de alta resolución', 'Click to view full screen with high-resolution zoom')}
              >
                {!hasError ? (
                  <img
                    src={imgUrl}
                    alt={localizeText(fig.title)}
                    className="ws-sci-card__img"
                    onError={() => {
                      setImgLoadErrors((prev) => ({ ...prev, [fig.id]: true }))
                    }}
                    loading="lazy"
                  />
                ) : (
                  <div className="ws-sci-card__fallback">
                    <p>{t('Cargando figura generada en backend...', 'Loading figure generated by the backend...')}</p>
                    <button
                      type="button"
                      className="ws-sci-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setImgLoadErrors((prev) => ({ ...prev, [fig.id]: false }))
                      }}
                    >
                      <RefreshCw size={12} /> {t('Reintentar', 'Retry')}
                    </button>
                  </div>
                )}
                <div className="ws-sci-card__zoom-hint">
                  <ZoomIn size={14} /> {t('Clic para pantalla completa', 'Click for full screen')}
                </div>
              </div>

              {/* Metadatos y Parámetros Cartográficos */}
              <div className="ws-sci-card__footer">
                <p className="ws-sci-card__desc">{localizeText(fig.description)}</p>
                <div className="ws-sci-card__tags">
                  {fig.tags.map((tag) => (
                    <span key={tag} className="ws-sci-tag">
                      {localizeText(tag)}
                    </span>
                  ))}
                </div>
                <ul className="ws-sci-card__details">
                  {fig.details.map((detail, idx) => (
                    <li key={idx}>{localizeText(detail)}</li>
                  ))}
                </ul>
              </div>
            </article>
          )
        })}
      </div>

      {/* Modal Pantalla Completa con Zoom y Lupa */}
      {modalFigure && (
        <div
          className="ws-sci-modal-backdrop"
          onClick={() => setModalFigure(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="ws-sci-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ws-sci-modal__header">
              <div className="ws-sci-modal__title-box">
                <span className="ws-sci-card__code">{localizeText(modalFigure.code)}</span>
                <h3>{localizeText(modalFigure.title)}</h3>
                <span className="ws-sci-modal__sub">{localizeText(modalFigure.subtitle)}</span>
              </div>

              <div className="ws-sci-modal__controls">
                <div className="ws-sci-zoom-controls">
                  <button
                    type="button"
                    className="ws-sci-btn"
                    onClick={() => setZoomLevel((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                    title={t('Alejar (-)', 'Zoom out (-)')}
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span className="ws-sci-zoom-level">{Math.round(zoomLevel * 100)}%</span>
                  <button
                    type="button"
                    className="ws-sci-btn"
                    onClick={() => setZoomLevel((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                    title={t('Acercar (+)', 'Zoom in (+)')}
                  >
                    <ZoomIn size={13} />
                  </button>
                  <button
                    type="button"
                    className="ws-sci-btn"
                    onClick={() => setZoomLevel(1)}
                    title={t('Restablecer al 100%', 'Reset to 100%')}
                  >
                    100%
                  </button>
                </div>

                <button
                  type="button"
                  className="ws-sci-btn ws-sci-btn--primary"
                  onClick={() => handleDownload(modalFigure)}
                >
                  <Download size={13} /> {t('Descargar PNG (150 DPI)', 'Download PNG (150 DPI)')}
                </button>

                <button
                  type="button"
                  className="ws-sci-btn ws-sci-btn--close"
                  onClick={() => setModalFigure(null)}
                  title={t('Cerrar modal (Esc)', 'Close dialog (Esc)')}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="ws-sci-modal__body">
              <div
                className="ws-sci-modal__img-canvas"
                style={{
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.12s ease',
                }}
              >
                <img
                  src={getFigureUrl(modalFigure.filename)}
                  alt={localizeText(modalFigure.title)}
                  className="ws-sci-modal__img"
                />
              </div>
            </div>

            <div className="ws-sci-modal__footer">
              <div className="ws-sci-modal__footer-text">
                <p><strong>{t('Descripción física:', 'Physical description:')}</strong> {localizeText(modalFigure.description)}</p>
              </div>
              <div className="ws-sci-modal__footer-details">
                {modalFigure.details.map((d, i) => (
                  <span key={i} className="ws-sci-modal__pill">{localizeText(d)}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
