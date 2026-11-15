import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CloudRain,
  Columns,
  Download,
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
import type { DrawTool, EscenaNisar, SolarSimulationState, ViewMode } from '../types/workspace'

interface HeaderProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  canShowEdited: boolean
  onDuplicate: () => void
  onExportJson: () => void
  escena: EscenaNisar
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
  /** Abre la galería de figuras científicas oficiales generadas por Matplotlib en el backend. */
  onOpenFigures?: () => void
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
  viewMode,
  onViewModeChange,
  canShowEdited,
  onDuplicate,
  onExportJson,
  escena,
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
  onOpenFigures,
  onOpenTeamPage,
}: HeaderProps) {
  const isEditing = viewMode === 'editado' && canShowEdited
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
        <div className="ws-menubar__menus" role="menubar" aria-label="Menú principal de estación de trabajo">
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={onDuplicate}
            title="Crear copia editable en el espacio de trabajo"
          >
            Archivo
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={() => {
              onDockTabChange('map')
              onDateViewModeChange(dateViewMode === 't1' ? 't2' : 't1')
            }}
            title="Alternar escena activa GCOV t1 / t2"
          >
            Escenas GCOV
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
            title="Alternar calibración radiométrica RTC γ⁰ / elipsoidal σ⁰"
          >
            Procesamiento SAR
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            disabled
            title="Pendiente: no hay validación todavía (validate.py, Contrato C3)"
          >
            Validación
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={onToggleFloatingTools}
            title="Mostrar u ocultar cuadro flotante arrastrable de herramientas de dibujo"
          >
            Ventana
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={onExportJson}
            title="Exportar configuración y geometrías del proyecto en JSON"
          >
            Exportar
          </button>
        </div>

        <div className="ws-menubar__title">
          <span className="ws-menubar__app-badge">NISAR L2</span>
          <span>
            TerraPulse AI — NISAR L2 GCOV Workstation [ROI: Chiapas, EPSG:{escena.epsg} ·{' '}
            {escena.pila} {escena.direccion === 'ASCENDING' ? 'ASC' : 'DESC'} · CRID: {escena.crid}]
          </span>
        </div>

        <div className="ws-menubar__right">
          <div className="ws-menubar__status">
            <span>Band L (24 cm · Freq A)</span>
            <span>|</span>
            <span>Madurez: {escena.madurez}</span>
          </div>

          <button
            type="button"
            className="ws-menubar__team"
            onClick={onOpenTeamPage}
            title="Abrir la landing institucional del equipo MonitosCH (NASA Space Apps Challenge 2026)"
            aria-label="Abrir la landing institucional del equipo MonitosCH"
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
      <div className="ws-ribbon" role="toolbar" aria-label="Cinta de herramientas técnicas">
        {/* Sección 1: Espacio de Trabajo */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--ws-general ${viewMode === 'general' ? 'is-active' : ''}`}
              onClick={() => onViewModeChange('general')}
              title="Vista de solo lectura del Mapa General"
            >
              <Layers size={14} />
              <span>Mapa General</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--ws-edited ${viewMode === 'editado' ? 'is-active' : ''}`}
              onClick={() => onViewModeChange('editado')}
              disabled={!canShowEdited}
              title={
                canShowEdited
                  ? 'Activar copia editable para dibujo y recorte'
                  : 'Duplica el mapa primero para habilitar edición'
              }
            >
              <Sliders size={14} />
              <span>Mapa Editado</span>
            </button>
            <button
              type="button"
              className="ws-ribbon__btn ws-ribbon__btn--create"
              onClick={onDuplicate}
              title="Duplicar vista actual en una nueva copia editable en localStorage"
            >
              <Plus size={14} strokeWidth={2.5} />
              <span>Duplicar Mapa</span>
            </button>
          </div>
          <span className="ws-ribbon__label">Espacio de Trabajo</span>
        </div>

        <div className="ws-ribbon__divider" aria-hidden="true" />

        {/* Sección 2: Capas GCOV (Frequency A) + Escala de Color */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            {/* Selector único que despliega en submenús jerárquicos (RTC γ⁰ vs Elipsoidal σ⁰) */}
            <div className="ws-ribbon__inline-field ws-layer-select-field" ref={layerMenuRef}>
              <span className="ws-layer-select-prefix">Capa SAR:</span>
              <button
                type="button"
                className={`ws-ribbon__select ws-layer-select-btn ${isLayerMenuOpen ? 'is-active' : ''}`}
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
                title="Seleccionar capa SAR GCOV por corrección radiométrica (γ⁰ RTC / σ⁰ Elipsoidal) y polarización"
              >
                <Layers size={12} className="ws-layer-select-icon" />
                <span className="ws-layer-select-val">
                  {activeLayerOption?.shortLabel ?? 'γ⁰ HH [dB]'}
                </span>
                <ChevronDown
                  size={11}
                  className={`ws-layer-select-chevron ${isLayerMenuOpen ? 'is-open' : ''}`}
                />
              </button>

              {isLayerMenuOpen && (
                <div className="ws-layer-menu" role="menu">
                  <div className="ws-layer-menu__header">
                    <span>Capas SAR GCOV (Frequency A)</span>
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
                            <span className="ws-layer-menu__name">{group.title}</span>
                            <span className="ws-layer-menu__sub">{group.subtitle}</span>
                          </div>
                        </div>
                        <div className="ws-layer-menu__item-end">
                          <span className="ws-layer-badge">{group.badge}</span>
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
                              {group.title} ({group.symbol})
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
                                  title={layer.title}
                                >
                                  <div className="ws-layer-subitem__check">
                                    {isSelected && <Check size={13} strokeWidth={2.8} />}
                                  </div>
                                  <div className="ws-layer-subitem__info">
                                    <div className="ws-layer-subitem__top">
                                      <strong className="ws-layer-subitem__code">
                                        {layer.shortLabel}
                                      </strong>
                                      <span className="ws-layer-subitem__tag">{layer.scale}</span>
                                    </div>
                                    <span className="ws-layer-subitem__desc">
                                      {layer.fullLabel}
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

            <label className="ws-ribbon__inline-field" title="Paleta científica aplicada por LUT sobre el raster en EPSG:3857">
              <span>Rampa:</span>
              <select
                className="ws-ribbon__select"
                value={colormapId}
                onChange={(e) => onColormapChange(e.target.value as ScientificColormapId)}
                aria-label="Seleccionar escala científica de color"
              >
                {SCIENTIFIC_COLORMAPS.map((cmap) => (
                  <option key={cmap.id} value={cmap.id}>
                    {cmap.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ws-ribbon__inline-field" title="Opacidad de la capa SAR GCOV (0% - 100%)">
              <span>α: {opacity}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={opacity}
                onChange={(e) => onOpacityChange(Number(e.target.value))}
                className="ws-ribbon__range"
                aria-label="Opacidad de capa SAR en porcentaje"
              />
            </label>
          </div>
          <span className="ws-ribbon__label">Capas GCOV (Frequency A · Escala -22 a 0 dB)</span>
        </div>

        <div className="ws-ribbon__divider" aria-hidden="true" />

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
              title={`Mostrar escena t1 (${escena.t1}): ${escena.t1SceneId}`}
            >
              <span>t1: {escena.t1}</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--mono ${dateViewMode === 't2' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onDateViewModeChange('t2')
              }}
              title={`Mostrar escena t2 (${escena.t2}): ${escena.t2SceneId}`}
            >
              <span>t2: {escena.t2}</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--swipe ${dateViewMode === 'swipe' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onDateViewModeChange('swipe')
              }}
              title="Deslizador Antes/Después (Swipe t1 ↔ t2) con verificación de escala -22 a 0 dB"
            >
              <Columns size={14} />
              <span>Comparador Swipe</span>
            </button>
          </div>
          <span className="ws-ribbon__label">Comparador Temporal t1/t2</span>
        </div>

        <div className="ws-ribbon__divider" aria-hidden="true" />

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
              title="Mostrar/ocultar cuadro flotante arrastrable de herramientas de dibujo"
            >
              <PencilRuler size={14} />
              <span>
                Dibujo ({isEditing ? TOOL_LABELS[activeTool] : 'Solo lectura'})
              </span>
            </button>

            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--solar ${solar.enabled ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange('map')
                onSolarChange({ ...solar, enabled: !solar.enabled })
              }}
              title="Activar/desactivar Simulador Solar con radiación directa incidente (Inferno)"
            >
              <Sun size={14} />
              <span>{solar.enabled ? `Solar ON (${solar.radiationIntensity}%)` : 'Simulador Solar'}</span>
            </button>

            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--rain ${activeDockTab === 'rain-dg2' ? 'is-active' : ''}`}
              onClick={() => {
                onDockTabChange(activeDockTab === 'rain-dg2' ? 'map' : 'rain-dg2')
              }}
              title="Abrir módulo de simulación hidráulica de lluvia e inundación DG2 (LISFLOOD-FP 8.0)"
            >
              <CloudRain size={14} />
              <span>Simulador Inundación (DG2)</span>
            </button>

            {onOpenFigures && (
              <button
                type="button"
                className="ws-ribbon__btn ws-ribbon__btn--figures"
                onClick={onOpenFigures}
                title="Abrir galería de Figuras Científicas Oficiales de Python (Matplotlib / NISAR QA: Figuras B, C, D, E)"
              >
                <Layers size={14} />
                <span>Figuras Científicas (Backend)</span>
              </button>
            )}

          </div>
          <span className="ws-ribbon__label">Herramientas y Módulos</span>
        </div>

        <div className="ws-ribbon__divider" aria-hidden="true" />

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
              title="Seleccionar región del mapa simulado y guardar imagen PNG o JPG"
            >
              <Camera size={14} />
              <span>Capturar Imagen</span>
            </button>
            <button
              type="button"
              className="ws-ribbon__btn ws-ribbon__btn--export"
              onClick={onExportJson}
              title="Exportar proyecto y anotaciones en formato JSON reproducible"
            >
              <Download size={14} />
              <span>Exportar JSON</span>
            </button>
          </div>
          <span className="ws-ribbon__label">Captura y Exportación</span>
        </div>
      </div>
    </header>
  )
}
