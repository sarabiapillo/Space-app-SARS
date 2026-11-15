import { useState } from 'react'
import {
  Camera,
  Columns,
  Download,
  Layers,
  PencilRuler,
  Plus,
  Sliders,
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
  onDockTabChange,
  floatingToolsOpen,
  onToggleFloatingTools,
  isCaptureMode,
  onStartCaptureMode,
  onOpenTeamPage,
}: HeaderProps) {
  const isEditing = viewMode === 'editado' && canShowEdited
  const [logoFailed, setLogoFailed] = useState(false)

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
            {EXPLORE_LAYER_OPTIONS.map((layer) => (
              <button
                key={layer.id}
                type="button"
                className={`ws-ribbon__btn ws-ribbon__btn--mono ${exploreLayerId === layer.id ? 'is-active' : ''}`}
                onClick={() => {
                  onDockTabChange('map')
                  onExploreLayerChange(layer.id)
                }}
                title={layer.title}
              >
                <span>{layer.shortLabel}</span>
              </button>
            ))}

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
