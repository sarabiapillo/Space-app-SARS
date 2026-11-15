import {
  CircleDot,
  Columns,
  Copy,
  Download,
  Hand,
  Layers,
  Pencil,
  Pentagon,
  Sliders,
  Sun,
  Tag,
} from 'lucide-react'
import {
  EXPLORE_LAYER_OPTIONS,
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
  onSelectTool: (tool: DrawTool) => void
  solar: SolarSimulationState
  onSolarChange: (next: SolarSimulationState) => void
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
  onSelectTool,
  solar,
  onSolarChange,
}: HeaderProps) {
  const isEditing = viewMode === 'editado' && canShowEdited

  return (
    <header className="ws-header" role="banner">
      {/* 1. Barra fina de menú clásico estilo COMSOL / SNAP / QGIS */}
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
            onClick={() => onDateViewModeChange(dateViewMode === 't1' ? 't2' : 't1')}
            title="Alternar escena activa GCOV t1 / t2"
          >
            Escenas GCOV
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={() =>
              onExploreLayerChange(
                exploreLayerId === 'gamma0_HHHH_ml2_dB'
                  ? 'sigma0_HHHH_ml2_dB'
                  : 'gamma0_HHHH_ml2_dB',
              )
            }
            title="Alternar calibración radiométrica RTC γ⁰ / elipsoidal σ⁰"
          >
            Procesamiento SAR
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={() => onDateViewModeChange('swipe')}
            title="Activar comparador visual t1 ↔ t2 con escala común -22 a 0 dB"
          >
            Validación
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-menubar__item"
            onClick={() => onSolarChange({ ...solar, enabled: !solar.enabled })}
            title="Mostrar u ocultar panel acoplado de Simulación Solar / Radiación"
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

        <div className="ws-menubar__status">
          <span>Band L (24 cm · Freq A)</span>
          <span>|</span>
          <span>Madurez: {escena.madurez}</span>
        </div>
      </div>

      {/* 2. Cinta técnica Ribbon Bar agrupada por secciones con divisores verticales */}
      <div className="ws-ribbon" role="toolbar" aria-label="Cinta de herramientas técnicas">
        {/* Sección 1: Espacio de Trabajo */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ${viewMode === 'general' ? 'is-active' : ''}`}
              onClick={() => onViewModeChange('general')}
              title="Vista de solo lectura del Mapa General"
            >
              <Layers size={14} />
              <span>Mapa General</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ${viewMode === 'editado' ? 'is-active' : ''}`}
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
              className="ws-ribbon__btn ws-ribbon__btn--primary"
              onClick={onDuplicate}
              title="Duplicar vista actual en una nueva copia editable en localStorage"
            >
              <Copy size={14} />
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
                onClick={() => onExploreLayerChange(layer.id)}
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
              onClick={() => onDateViewModeChange('t1')}
              title={`Mostrar escena t1 (${escena.t1}): ${escena.t1SceneId}`}
            >
              <span>t1: {escena.t1}</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ws-ribbon__btn--mono ${dateViewMode === 't2' ? 'is-active' : ''}`}
              onClick={() => onDateViewModeChange('t2')}
              title={`Mostrar escena t2 (${escena.t2}): ${escena.t2SceneId}`}
            >
              <span>t2: {escena.t2}</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ${dateViewMode === 'swipe' ? 'is-active' : ''}`}
              onClick={() => onDateViewModeChange('swipe')}
              title="Deslizador Antes/Después (Swipe t1 ↔ t2) con verificación de escala -22 a 0 dB"
            >
              <Columns size={14} />
              <span>Swipe t1 ↔ t2</span>
            </button>
          </div>
          <span className="ws-ribbon__label">Comparador Temporal t1/t2</span>
        </div>

        <div className="ws-ribbon__divider" aria-hidden="true" />

        {/* Sección 4: Herramientas de Geometría y Dibujo */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ${isEditing && activeTool === 'mover' ? 'is-active' : ''}`}
              onClick={() => {
                if (!isEditing && canShowEdited) onViewModeChange('editado')
                onSelectTool('mover')
              }}
              title="Mover lienzo / Seleccionar elementos dibujados"
            >
              <Hand size={13} />
              <span>Mover</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ${isEditing && activeTool === 'lapiz' ? 'is-active' : ''}`}
              onClick={() => {
                if (!isEditing && canShowEdited) onViewModeChange('editado')
                onSelectTool('lapiz')
              }}
              title="Dibujar trazo libre (LineString)"
            >
              <Pencil size={13} />
              <span>Lápiz</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ${isEditing && activeTool === 'peligro' ? 'is-active' : ''}`}
              onClick={() => {
                if (!isEditing && canShowEdited) onViewModeChange('editado')
                onSelectTool('peligro')
              }}
              title="Marcar anomalía radiométrica / zona de peligro"
            >
              <CircleDot size={13} className="icon-danger" />
              <span>Anomalía</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ${isEditing && activeTool === 'advertencia' ? 'is-active' : ''}`}
              onClick={() => {
                if (!isEditing && canShowEdited) onViewModeChange('editado')
                onSelectTool('advertencia')
              }}
              title="Marcar zona de observación / advertencia"
            >
              <CircleDot size={13} className="icon-warn" />
              <span>Observación</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ${isEditing && activeTool === 'poligono' ? 'is-active' : ''}`}
              onClick={() => {
                if (!isEditing && canShowEdited) onViewModeChange('editado')
                onSelectTool('poligono')
              }}
              title="Seleccionar y recortar subregión poligonal"
            >
              <Pentagon size={13} />
              <span>Recortar ROI</span>
            </button>
            <button
              type="button"
              className={`ws-ribbon__btn ${isEditing && activeTool === 'etiqueta' ? 'is-active' : ''}`}
              onClick={() => {
                if (!isEditing && canShowEdited) onViewModeChange('editado')
                onSelectTool('etiqueta')
              }}
              title="Insertar o editar etiqueta técnica sobre el mapa"
            >
              <Tag size={13} />
              <span>Etiqueta</span>
            </button>
          </div>
          <span className="ws-ribbon__label">Herramientas de Geometría y Dibujo</span>
        </div>

        <div className="ws-ribbon__divider" aria-hidden="true" />

        {/* Sección 5: Simulación Solar / Radiación */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className={`ws-ribbon__btn ${solar.enabled ? 'is-active' : ''}`}
              onClick={() => onSolarChange({ ...solar, enabled: !solar.enabled })}
              title="Activar/desactivar Simulador Solar y mapa de calor de radiación (Inferno)"
            >
              <Sun size={14} className="icon-sun" />
              <span>{solar.enabled ? `Solar ON (${solar.radiationIntensity}%)` : 'Simulador Solar'}</span>
            </button>
          </div>
          <span className="ws-ribbon__label">Simulación Solar / Radiación</span>
        </div>

        <div className="ws-ribbon__divider" aria-hidden="true" />

        {/* Sección 6: Exportar */}
        <div className="ws-ribbon__group">
          <div className="ws-ribbon__controls">
            <button
              type="button"
              className="ws-ribbon__btn"
              onClick={onExportJson}
              title="Exportar proyecto y anotaciones en formato JSON reproducible"
            >
              <Download size={14} />
              <span>Exportar JSON</span>
            </button>
          </div>
          <span className="ws-ribbon__label">Exportar</span>
        </div>
      </div>
    </header>
  )
}
