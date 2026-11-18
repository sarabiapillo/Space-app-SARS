import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CloudRain,
  Columns,
  Download,
  Diff,
  Droplets,
  Flame,
  Layers,
  PencilRuler,
  Plus,
  Sliders,
  Sun,
} from 'lucide-react'
import {
  EXPLORE_LAYER_OPTIONS,
  type CenterDockTab,
  type ExploreDateViewMode,
  type ExploreLayerId,
} from '../mocks/initialWorkspaces'
import {
  SCIENTIFIC_COLORMAPS,
  type ScientificColormapId,
} from '../utils/colormapLut'
import type { DrawTool, SolarSimulationState, ViewMode } from '../types/workspace'
import { useTranslation } from '../i18n/useTranslation'
import type { Language } from '../i18n/core'

interface HeaderProps {
  roiLayers?: import('../hooks/useRoiLayers').RoiLayersState
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  canShowEdited: boolean
  hasConfirmedROI: boolean
  onDuplicate: () => void
  onExportJson: () => void
  opacity: number
  onOpacityChange: (value: number) => void
  exploreLayerId: ExploreLayerId
  onExploreLayerChange: (id: ExploreLayerId) => void
  dateViewMode: ExploreDateViewMode
  onDateViewModeChange: (mode: ExploreDateViewMode) => void
  colormapId: ScientificColormapId
  onColormapChange: (id: ScientificColormapId) => void
  activeTool: DrawTool
  solar: SolarSimulationState
  onSolarChange: (next: SolarSimulationState) => void
  activeDockTab: CenterDockTab
  onDockTabChange: (tab: CenterDockTab) => void
  floatingToolsOpen: boolean
  onToggleFloatingTools: () => void
  isCaptureMode: boolean
  onStartCaptureMode: () => void
  onDuplicateWithHeatmap?: () => void
  onDuplicateForWater?: () => void
  onDuplicateForSeismic?: () => void
  /** Abre la landing institucional del equipo (MonitosCH) sin perder el estado del mapa. */
  onOpenTeamPage: () => void
}

const TOOL_LABELS: Record<DrawTool, string> = {
  mover: 'Mover',
  lapiz: 'Lápiz',
  peligro: 'Círculo rojo',
  advertencia: 'Círculo ámbar',
  poligono: 'Recortar ROI',
  etiqueta: 'Etiqueta',
}

interface SarLayerSubitem {
  id: ExploreLayerId
  shortLabel: string
  fullLabel: string
  scale: string
  title: string
}

interface SarLayerGroup {
  id: 'gamma0' | 'sigma0'
  symbol: string
  title: string
  subtitle: string
  badge: string
  layers: SarLayerSubitem[]
}

const SAR_LAYER_GROUPS: SarLayerGroup[] = [
  {
    id: 'gamma0',
    symbol: 'γ⁰',
    title: 'Retrodispersión RTC (γ⁰)',
    subtitle: 'Corrección topográfica de terreno',
    badge: 'Terreno',
    layers: [
      {
        id: 'gamma0_HHHH_ml2_dB',
        shortLabel: 'γ⁰ HH [dB]',
        fullLabel: 'Copolarizada HHHH',
        scale: '-22 a 0 dB · 20 m',
        title: 'Retrodispersión RTC γ⁰ HHHH en dB (multilook 2×2 · 20 m · EPSG:3857)',
      },
      {
        id: 'gamma0_HVHV_ml2_dB',
        shortLabel: 'γ⁰ HV [dB]',
        fullLabel: 'Polarización cruzada HVHV',
        scale: '-22 a 0 dB · 20 m',
        title: 'Retrodispersión RTC γ⁰ HVHV en dB (multilook 2×2 · 20 m · EPSG:3857)',
      },
    ],
  },
  {
    id: 'sigma0',
    symbol: 'σ⁰',
    title: 'Retrodispersión Elipsoidal (σ⁰)',
    subtitle: 'Corrección elipsoidal convencional',
    badge: 'Elipsoide',
    layers: [
      {
        id: 'sigma0_HHHH_ml2_dB',
        shortLabel: 'σ⁰ HH [dB]',
        fullLabel: 'Copolarizada HHHH',
        scale: '-22 a 0 dB · 20 m',
        title: 'Retrodispersión elipsoidal σ⁰ = γ⁰ · rtcGammaToSigmaFactor (HHHH en dB · 20 m)',
      },
      {
        id: 'sigma0_HVHV_ml2_dB',
        shortLabel: 'σ⁰ HV [dB]',
        fullLabel: 'Polarización cruzada HVHV',
        scale: '-22 a 0 dB · 20 m',
        title: 'Retrodispersión elipsoidal σ⁰ = γ⁰ · rtcGammaToSigmaFactor (HVHV en dB · 20 m)',
      },
    ],
  },
]

export function Header({
  roiLayers,
  viewMode,
  onViewModeChange,
  canShowEdited,
  hasConfirmedROI,
  onDuplicate,
  onExportJson,
  opacity,
  onOpacityChange,
  exploreLayerId,
  onExploreLayerChange,
  dateViewMode,
  onDateViewModeChange,
  colormapId,
  onColormapChange,
  activeTool,
  solar,
  onSolarChange,
  activeDockTab,
  onDockTabChange,
  floatingToolsOpen,
  onToggleFloatingTools,
  isCaptureMode,
  onStartCaptureMode,
  onDuplicateWithHeatmap,
  onDuplicateForWater,
  onDuplicateForSeismic,
  onOpenTeamPage,
}: HeaderProps) {
  const { language, setLanguage, t, localizeText } = useTranslation()
  const isEditing = viewMode === 'editado' && canShowEdited
  const hasFirstScene = Boolean(roiLayers?.manifests[0])
  const hasSecondScene = Boolean(roiLayers?.manifests[1])
  const [logoFailed, setLogoFailed] = useState(false)
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(false)
  const [hoveredGroup, setHoveredGroup] = useState<'gamma0' | 'sigma0' | null>(null)
  const layerMenuRef = useRef<HTMLDivElement>(null)

  const activeLayerOption =
    EXPLORE_LAYER_OPTIONS.find((opt) => opt.id === exploreLayerId) ?? EXPLORE_LAYER_OPTIONS[0]

  // Cerrar al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!isLayerMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (layerMenuRef.current && !layerMenuRef.current.contains(e.target as Node)) {
        setIsLayerMenuOpen(false)
        setHoveredGroup(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLayerMenuOpen(false)
        setHoveredGroup(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isLayerMenuOpen])

  return (
    <header className="ws-header" role="banner">
      {/* 1. Barra superior de menús en escala de grises oscura (estilo ventana técnica de escritorio) */}
      <div className="ws-menubar">
        <div className="ws-menubar__menus" role="menubar" aria-label={t('Menú principal de estación de trabajo', 'Main workstation menu')}>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={onDuplicate}
            title={t('Crear copia editable en el espacio de trabajo', 'Create an editable copy in the workspace')}
          >
            {t('Archivo', 'File')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={() => {
              onDockTabChange('map')
              onDateViewModeChange(dateViewMode === 't1' ? 't2' : 't1')
            }}
            disabled={!hasSecondScene}
            title={t('Alternar escenas GCOV de la ROI confirmada', 'Switch between GCOV acquisitions for the confirmed ROI')}
          >
            {t('Escenas GCOV', 'GCOV scenes')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={() => {
              onDockTabChange('map')
              onExploreLayerChange(
                exploreLayerId === 'gamma0_HHHH_ml2_dB'
                  ? 'sigma0_HHHH_ml2_dB'
                  : 'gamma0_HHHH_ml2_dB',
              )
            }}
            disabled={!hasFirstScene}
            title={t('Alternar calibración radiométrica RTC γ⁰ / elipsoidal σ⁰', 'Switch between RTC γ⁰ and ellipsoidal σ⁰ radiometric corrections')}
          >
            {t('Procesamiento SAR', 'SAR processing')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            disabled
            title={t('Pendiente: no hay validación todavía (validate.py, Contrato C3)', 'Pending: validation is not available yet (validate.py, Contract C3)')}
          >
            {t('Validación', 'Validation')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={onToggleFloatingTools}
            title={t('Mostrar u ocultar cuadro flotante arrastrable de herramientas de dibujo', 'Show or hide the draggable drawing tools')}
          >
            {t('Ventana', 'Window')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={onExportJson}
            title={t('Exportar configuración y geometrías del proyecto en JSON', 'Export project settings and geometries as JSON')}
          >
            {t('Exportar', 'Export')}
          </button>
          <select className="ws-menubar__item" aria-label={t('Idioma', 'Language')} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="ws-menubar__title">
          <span className="ws-menubar__app-badge">NISAR L2</span>
          <span>
            {roiLayers ? t('TerraPulse AI — ROI seleccionada · NISAR GCOV', 'TerraPulse AI — Selected ROI · NISAR GCOV') : t('TerraPulse AI — Delimita y confirma una ROI', 'TerraPulse AI — Delineate and confirm an ROI')}
          </span>
        </div>

        <div className="ws-menubar__right">
          <div className="ws-menubar__status">
            {roiLayers ? <><span>{t('Banda L (24 cm · Frec. A)', 'L-band (24 cm · Freq A)')}</span><span>|</span><span>{t('Madurez:', 'Data maturity:')} {roiLayers.manifests[0]?.escena.madurez_catalogo ?? localizeText('Pendiente')}</span></> : <span>{localizeText('Sin datos calculados para una ROI')}</span>}
          </div>

          <button
            type="button"
            className="ws-menubar__team"
            onClick={onOpenTeamPage}
            title={t('Abrir la página del equipo MonitosCH (NASA Space Apps Challenge 2026)', 'Open the MonitosCH team page (NASA Space Apps Challenge 2026)')}
            aria-label={t('Abrir la página del equipo MonitosCH', 'Open the MonitosCH team page')}
          >
            <span className="team-logo-slot" aria-hidden="true">
              {logoFailed ? (
                <span className="team-logo-slot__fallback">MCH</span>
              ) : (
                <img
                  src="/monitosch-logo.png"
                  alt=""
                  onError={() => setLogoFailed(true)}
                />
              )}
            </span>
            <span className="ws-menubar__team-label">MonitosCH</span>
          </button>
        </div>
      </div>

      {/* 2. Cinta técnica Ribbon Bar sin controles duplicados */}
      <div className={`ws-ribbon ${isLayerMenuOpen ? 'ws-ribbon--layer-menu-open' : ''}`} role="toolbar" aria-label={t('Cinta de herramientas técnicas', 'Technical tools ribbon')}>
        <div className="ws-ribbon__top-groups">
        {/* Sección 1: Espacio de Trabajo */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--ws-general ${viewMode === 'general' ? 'is-active' : ''}`}
              onClick={() => onViewModeChange('general')}
              title={t('Vista de solo lectura del Mapa General', 'Read-only view of the General Map')}
            >
              <Layers size={14} />
              <span>{t('Mapa General', 'General Map')}</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--ws-edited ${viewMode === 'editado' ? 'is-active' : ''}`}
              onClick={() => onViewModeChange('editado')}
              disabled={!canShowEdited}
              title={
                canShowEdited
                  ? t('Activar copia editable para dibujo y recorte', 'Activate an editable copy for drawing and cropping')
                  : t('Duplica el mapa primero para habilitar edición', 'Duplicate the map first to enable editing')
              }
            >
              <Sliders size={14} />
              <span>{t('Mapa Editado', 'Edited Map')}</span>
            </button>
            <button
              type="button"
              className="ws-ribbon__btn ws-ribbon__btn--create"
              onClick={onDuplicate}
              title={t('Duplicar vista actual en una nueva copia editable en localStorage', 'Duplicate the current view into a new editable copy in localStorage')}
            >
              <Plus size={14} strokeWidth={2.5} />
              <span>{t('Duplicar Mapa', 'Duplicate Map')}</span>
            </button>
            {hasConfirmedROI && (
              <>
                {onDuplicateWithHeatmap && (
                  <button
                    type="button"
                    className="ws-ribbon__btn ws-ribbon__btn--heat"
                    onClick={onDuplicateWithHeatmap}
                    title={t('Generar copia de esta ROI con mapa de calor SAR activado', 'Generate a copy of this ROI with SAR heatmap enabled')}
                  >
                    <Flame size={14} />
                    <span>{t('Copia con Calor', 'Copy with Heatmap')}</span>
                  </button>
                )}
                {onDuplicateForWater && (
                  <button
                    type="button"
                    className="ws-ribbon__btn ws-ribbon__btn--water"
                    onClick={onDuplicateForWater}
                    title={t('Generar copia limpia para simulación de agua (DG2) sin mapa de calor', 'Generate clean copy for water simulation (DG2) without heatmap')}
                  >
                    <Droplets size={14} />
                    <span>{t('Copia Agua (DG2)', 'Water Copy (DG2)')}</span>
                  </button>
                )}
                {onDuplicateForSeismic && (
                  <button
                    type="button"
                    className="ws-ribbon__btn ws-ribbon__btn--seismic"
                    onClick={onDuplicateForSeismic}
                    title={t('Generar copia limpia para simulación sísmica / terremoto sin mapa de calor', 'Generate clean copy for seismic / earthquake simulation without heatmap')}
                  >
                    <Activity size={14} />
                    <span>{t('Copia Sismo', 'Seismic Copy')}</span>
                  </button>
                )}
              </>
            )}
          </div>
          <span className="ws-ribbon__label">{t('Espacio de Trabajo', 'Workspace')}</span>
        </div>

        {/* Sección 2: Capas GCOV (Frequency A) + Escala de Color */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            {/* Selector único que despliega en submenús jerárquicos (RTC γ⁰ vs Elipsoidal σ⁰) */}
            <div className="ws-ribbon__inline-field ws-layer-select-field" ref={layerMenuRef}>
              <span className="ws-layer-select-prefix">{t('Capa SAR:', 'SAR layer:')}</span>
              <button
                type="button"
                className={`ws-ribbon__select ws-layer-select-btn ${isLayerMenuOpen ? 'is-active' : ''}`}
                disabled={!hasFirstScene}
                onClick={() => {
                  const nextState = !isLayerMenuOpen
                  setIsLayerMenuOpen(nextState)
                  if (nextState) {
                    const activeGrp = SAR_LAYER_GROUPS.find((g) =>
                      g.layers.some((l) => l.id === exploreLayerId)
                    )
                    setHoveredGroup(activeGrp?.id ?? 'gamma0')
                  } else {
                    setHoveredGroup(null)
                  }
                }}
                aria-haspopup="true"
                aria-expanded={isLayerMenuOpen}
                title={t('Seleccionar capa SAR GCOV por corrección radiométrica (γ⁰ RTC / σ⁰ Elipsoidal) y polarización', 'Select a GCOV SAR layer by radiometric correction (RTC γ⁰ / ellipsoidal σ⁰) and polarization')}
              >
                <Layers size={12} className="ws-layer-select-icon" />
                <span className="ws-layer-select-val">
                  {hasFirstScene ? activeLayerOption?.shortLabel : localizeText('Sin capa calculada')}
                </span>
                <ChevronDown
                  size={11}
                  className={`ws-layer-select-chevron ${isLayerMenuOpen ? 'is-open' : ''}`}
                />
              </button>

              {isLayerMenuOpen && (
                <div className="ws-layer-menu" role="menu">
                  <div className="ws-layer-menu__header">
                    <span>{t('Capas SAR GCOV (Frequency A)', 'GCOV SAR layers (Frequency A)')}</span>
                  </div>
                  {SAR_LAYER_GROUPS.map((group) => {
                    const isGroupActive = group.layers.some((l) => l.id === exploreLayerId)
                    const isHovered = hoveredGroup === group.id
                    return (
                      <div
                        key={group.id}
                        className={`ws-layer-menu__item ${isGroupActive ? 'is-group-active' : ''} ${isHovered ? 'is-hovered' : ''}`}
                        onMouseEnter={() => setHoveredGroup(group.id)}
                        onClick={() => setHoveredGroup(hoveredGroup === group.id ? null : group.id)}
                      >
                        <div className="ws-layer-menu__item-main">
                          <span className="ws-layer-menu__sym">{group.symbol}</span>
                          <div className="ws-layer-menu__text">
                            <span className="ws-layer-menu__name">{localizeText(group.title)}</span>
                            <span className="ws-layer-menu__sub">{localizeText(group.subtitle)}</span>
                          </div>
                        </div>
                        <div className="ws-layer-menu__item-end">
                          <span className="ws-layer-badge">{localizeText(group.badge)}</span>
                          <ChevronRight size={12} className="ws-layer-menu__arrow" />
                        </div>

                        {/* Submenú desplegable flotante a la derecha */}
                        {isHovered && (
                          <div
                            className="ws-layer-submenu"
                            role="menu"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="ws-layer-submenu__header">
                              {localizeText(group.title)} ({group.symbol})
                            </div>
                            {group.layers.map((layer) => {
                              const isSelected = exploreLayerId === layer.id
                              return (
                                <button
                                  key={layer.id}
                                  type="button"
                                  className={`ws-layer-subitem ${isSelected ? 'is-selected' : ''}`}
                                  onClick={() => {
                                    onDockTabChange('map')
                                    onExploreLayerChange(layer.id)
                                    setIsLayerMenuOpen(false)
                                    setHoveredGroup(null)
                                  }}
                                  title={localizeText(layer.title)}
                                >
                                  <div className="ws-layer-subitem__check">
                                    {isSelected && <Check size={13} strokeWidth={2.8} />}
                                  </div>
                                  <div className="ws-layer-subitem__info">
                                    <div className="ws-layer-subitem__top">
                                      <strong className="ws-layer-subitem__code">
                                        {layer.shortLabel}
                                      </strong>
                                      <span className="ws-layer-subitem__tag">{localizeText(layer.scale)}</span>
                                    </div>
                                    <span className="ws-layer-subitem__desc">
                                      {localizeText(layer.fullLabel)}
                                    </span>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <label className="ws-ribbon__inline-field" title={t('Paleta científica aplicada por LUT sobre el ráster en EPSG:3857', 'Scientific palette applied via LUT to the raster in EPSG:3857')}>
              <span>{t('Paleta de colores:', 'Color palette:')}</span>
              <select
                className="ws-ribbon__select"
                value={colormapId}
                disabled={!hasFirstScene}
                onChange={(e) => onColormapChange(e.target.value as ScientificColormapId)}
                aria-label={t('Seleccionar escala científica de color', 'Select scientific color scale')}
              >
                {SCIENTIFIC_COLORMAPS.map((cmap) => (
                  <option key={cmap.id} value={cmap.id}>
                    {localizeText(cmap.label)}
                  </option>
                ))}
              </select>
            </label>

            <label className="ws-ribbon__inline-field" title={t('Opacidad de la capa SAR GCOV (0% - 100%)', 'GCOV SAR layer opacity (0% - 100%)')}>
              <span>α: {opacity}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={opacity}
                disabled={!hasFirstScene}
                onChange={(e) => onOpacityChange(Number(e.target.value))}
                className="ws-ribbon__range"
                aria-label={t('Opacidad de capa SAR en porcentaje', 'SAR layer opacity in percent')}
              />
            </label>
          </div>
          <span className="ws-ribbon__label">{t('Capas GCOV (Frequency A · Escala -22 a 0 dB)', 'GCOV layers (Frequency A · Scale -22 to 0 dB)')}</span>
        </div>

        {/* Sección 3: Comparador Temporal t1/t2 */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--mono ${dateViewMode === 't1' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onDateViewModeChange('t1')
              }}
              disabled={!hasFirstScene}
              title={roiLayers?.manifests[0]?.escena.granuleId ?? localizeText('Sin primera escena calculada')}
            >
              <span>t1: {roiLayers?.manifests[0]?.escena.fecha_inicio.slice(0, 10) ?? localizeText('Sin datos calculados')}</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--mono ${dateViewMode === 't2' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onDateViewModeChange('t2')
              }}
              disabled={!hasSecondScene}
              title={roiLayers?.manifests[1]?.escena.granuleId ?? localizeText('Sin segunda escena calculada')}
            >
              <span>t2: {roiLayers?.manifests[1]?.escena.fecha_inicio.slice(0, 10) ?? localizeText('Sin datos calculados')}</span>
            </button>
            <button
              type="button"
              disabled={!hasSecondScene || !roiLayers?.comparable}
              className={`ws-ribbon__btn ws-ribbon__btn--swipe ${dateViewMode === 'swipe' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onDateViewModeChange('swipe')
              }}
              title={t('Deslizador Antes/Después (Swipe t1 ↔ t2) con verificación de escala -22 a 0 dB', 'Before/After slider (Swipe t1 ↔ t2) with -22 to 0 dB scale verification')}
            >
              <Columns size={14} />
              <span>{t('Comparador Swipe', 'Swipe comparison')}</span>
            </button>
            <button
              type="button"
              disabled={!roiLayers?.change}
              className={`ws-ribbon__btn ws-ribbon__btn--swipe ${dateViewMode === 'change' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onDateViewModeChange('change')
              }}
              title={roiLayers?.change
                ? t('Mapa de cambio t2 − t1 en dB (azul: baja la señal; rojo: sube). No identifica la causa.', 'Change map t2 − t1 in dB (blue: signal decreases; red: increases). It does not identify the cause.')
                : t('Requiere un par comparable en la ROI', 'Requires a comparable pair in the ROI')}
            >
              <Diff size={14} />
              <span>{t('Cambio Δ', 'Change Δ')}</span>
            </button>
          </div>
          <span className="ws-ribbon__label">{t('Comparador Temporal t1/t2', 'Temporal comparison t1/t2')}</span>
        </div>
        </div>

        <div className="ws-ribbon__bottom-groups">
        {/* Sección 4: Vistas, Dibujo Flotante y Simulación */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ${floatingToolsOpen ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onToggleFloatingTools()
              }}
              title={t('Mostrar/ocultar cuadro flotante arrastrable de herramientas de dibujo', 'Show/hide draggable drawing tools')}
            >
              <PencilRuler size={14} />
              <span>
                {t('Dibujo', 'Drawing')} ({isEditing ? localizeText(TOOL_LABELS[activeTool]) : t('Solo lectura', 'Read-only')})
              </span>
            </button>

            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--solar ${solar.enabled ? 'is-active' : ''}`}
              disabled={!hasConfirmedROI}
              onClick={() => {
                onDockTabChange('map')
                onSolarChange({ ...solar, enabled: !solar.enabled })
              }}
              title={t('Activar/desactivar Simulador Solar con radiación directa incidente (Inferno)', 'Enable/disable Solar Simulator with incident direct irradiance (Inferno)')}
            >
              <Sun size={14} />
              <span>{solar.enabled ? `Solar ON (${solar.radiationIntensity}%)` : t('Simulador Solar', 'Solar Simulator')}</span>
            </button>

            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--rain ${activeDockTab === 'rain-dg2' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange(activeDockTab === 'rain-dg2' ? 'map' : 'rain-dg2')
              }}
              title={t('Abrir módulo de simulación hidráulica de lluvia e inundación DG2 (LISFLOOD-FP 8.0)', 'Open the DG2 rainfall and flood hydraulic simulation module (LISFLOOD-FP 8.0)')}
            >
              <CloudRain size={14} />
              <span>{t('Simulador Inundación (DG2)', 'Flood Simulator (DG2)')}</span>
            </button>

            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--seismic ${activeDockTab === 'seismic' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange(activeDockTab === 'seismic' ? 'map' : 'seismic')
              }}
              title={t('Abrir simulador de terremoto, atenuación de ondas P/S y zonificación de riesgo', 'Open earthquake simulator, P/S wave attenuation and risk zoning')}
            >
              <Activity size={14} />
              <span>{t('Simulador Terremoto', 'Earthquake Simulator')}</span>
            </button>


          </div>
          <span className="ws-ribbon__label">{t('Herramientas y Módulos', 'Tools and Modules')}</span>
        </div>

        {/* Sección 5: Acciones de Salida y Captura */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--capture ${isCaptureMode ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onStartCaptureMode()
              }}
              title={t('Seleccionar región del mapa simulado y guardar imagen PNG o JPG', 'Select a simulated map region and save a PNG or JPG image')}
            >
              <Camera size={14} />
              <span>{t('Capturar Imagen', 'Capture Image')}</span>
            </button>
            <button
              type="button"
              className="ws-ribbon__btn ws-ribbon__btn--export"
              onClick={onExportJson}
              title={t('Exportar proyecto y anotaciones en formato JSON reproducible', 'Export project and annotations in reproducible JSON format')}
            >
              <Download size={14} />
              <span>{t('Exportar JSON', 'Export JSON')}</span>
            </button>
          </div>
          <span className="ws-ribbon__label">{t('Captura y Exportación', 'Capture and Export')}</span>
        </div>
        </div>
      </div>
    </header>
  )
}
