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
import { SCIENTIFIC_FIGURES, type ScientificFigure } from './scientificFigures'

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
