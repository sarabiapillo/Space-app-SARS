import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Check,
  Clock,
  Folder,
  FolderOpen,
  FolderTree,
  Layers,
  Map as MapIcon,
  Pencil,
  Trash,
  X,
} from 'lucide-react'
import {
  CARPETAS,
  type Carpeta,
  type EscenaNisar,
  type WorkspaceMap,
} from '../types/workspace'
import { type GcovStackSpec } from '../mocks/initialWorkspaces'
import { ExploradorFeature } from '../features/explorador'
import { ComparadorFeature } from '../features/comparador'
import { Etapa1ChartsPanel } from './Etapa1ChartsPanel'
import { formatRelative } from '../utils/time'

interface SidebarProps {
  maps: WorkspaceMap[]
  /** Id de la copia activa en "Mapa Editado"; `null` si se está viendo el Mapa General. */
  activeMapId: string | null
  escena: EscenaNisar
  onSelectMap: (id: string) => void
  onRenameMap: (id: string, newName: string) => void
  onDeleteMap: (id: string) => void
  opacity: number
  onOpacityChange: (value: number) => void
  onSelectStack?: (stack: GcovStackSpec) => void
  onChangePair?: (t1: string, t2: string) => void
}

const SIDEBAR_DEFAULT_WIDTH = 360
const SIDEBAR_MIN_WIDTH = 260
const SIDEBAR_MAX_WIDTH = 640
const SIDEBAR_WIDTH_STORAGE_KEY = 'terrapulse:sidebar-width:v1'

function loadInitialSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!raw) return SIDEBAR_DEFAULT_WIDTH
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(parsed)))
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function Sidebar({
  maps,
  activeMapId,
  escena,
  onSelectMap,
  onRenameMap,
  onDeleteMap,
  opacity,
  onOpacityChange,
  onSelectStack,
  onChangePair,
}: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadInitialSidebarWidth())
  const [isResizing, setIsResizing] = useState(false)
  const [folderFilter, setFolderFilter] = useState<Carpeta | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [openNodes, setOpenNodes] = useState<{
    savedMaps: boolean
    catalogAndC1: boolean
    chartsEtapa1: boolean
    compat: boolean
    sceneParams: boolean
  }>({
    savedMaps: true,
    catalogAndC1: true,
    chartsEtapa1: true,
    compat: true,
    sceneParams: true,
  })
  const [pairDraft, setPairDraft] = useState<{
    stack: EscenaNisar['pila']
    t1: string
    t2: string
  }>({
    stack: escena.pila,
    t1: escena.t1,
    t2: escena.t2,
  })
  const now = useNow(30_000)
  const sliderId = useId()

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
    } catch {
      // Ignorar si localStorage no está disponible
    }
  }, [sidebarWidth])

  useEffect(() => {
    if (!isResizing) return

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e: MouseEvent) => {
      const nextWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, Math.round(e.clientX)),
      )
      setSidebarWidth(nextWidth)
    }

    const onMouseUp = () => {
      setIsResizing(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isResizing])

  const handleStartResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsResizing(true)
  }

  const handleResetWidth = () => {
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)
  }

  const handleResizerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setSidebarWidth((w) => Math.min(SIDEBAR_MAX_WIDTH, w + 16))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setSidebarWidth((w) => Math.max(SIDEBAR_MIN_WIDTH, w - 16))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)
    }
  }

  const toggleNode = (node: keyof typeof openNodes) => {
    setOpenNodes((prev) => ({ ...prev, [node]: !prev[node] }))
  }

  const activeT1 = pairDraft.stack === escena.pila ? pairDraft.t1 : escena.t1
  const activeT2 = pairDraft.stack === escena.pila ? pairDraft.t2 : escena.t2

  const visibleMaps = folderFilter ? maps.filter((m) => m.carpeta === folderFilter) : maps

  const startRename = (map: WorkspaceMap) => {
    setEditingId(map.id)
    setEditingName(map.nombre)
  }

  const submitRename = (e: FormEvent, id: string) => {
    e.preventDefault()
    const trimmed = editingName.trim()
    if (trimmed) {
      onRenameMap(id, trimmed)
    }
    setEditingId(null)
  }

  return (
    <aside
      className={`sidebar ${isResizing ? 'is-resizing' : ''}`}
      style={{ width: `${sidebarWidth}px` }}
      aria-label="Model Builder / Árbol del Proyecto"
    >
      {/* Cabecera de pestaña de panel acoplado estilo COMSOL ("Model Builder / Árbol del Proyecto") */}
      <div className="ws-panel-tabbar">
        <div className="ws-panel-tab is-active">
          <FolderTree size={13} aria-hidden="true" />
          <span>Model Builder / Árbol del Proyecto</span>
        </div>
        <span className="ws-panel-tabbar__meta">{sidebarWidth} px</span>
      </div>

      <div className="sidebar__scroll">
        {/* Raíz del árbol del proyecto */}
        <div className="tree-root-label">
          <span className="tree-root-label__icon">▣</span>
          <span>Chiapas_GCOV_Workstation.mph (ROI EPSG:{escena.epsg})</span>
        </div>

        {/* Nodo 1: Mis Mapas Guardados */}
        <div className="tree-node">
          <button
            type="button"
            className="tree-node__header"
            onClick={() => toggleNode('savedMaps')}
            aria-expanded={openNodes.savedMaps}
          >
            <span className="tree-node__caret">{openNodes.savedMaps ? '▾' : '▸'}</span>
            <span className="tree-node__title">Mis Mapas Guardados ({maps.length})</span>
          </button>

          {openNodes.savedMaps && (
            <div className="tree-node__body">
              <div className="folders" role="group" aria-label="Filtrar por carpeta">
                {CARPETAS.map((carpeta) => {
                  const count = maps.filter((m) => m.carpeta === carpeta).length
                  const selected = folderFilter === carpeta
                  const Icon = selected ? FolderOpen : Folder
                  return (
                    <button
                      key={carpeta}
                      type="button"
                      className={`folder ${selected ? 'is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => setFolderFilter(selected ? null : carpeta)}
                    >
                      <Icon size={14} aria-hidden="true" />
                      <span className="folder__name">{carpeta}</span>
                      <span className="folder__count">{count}</span>
                    </button>
                  )
                })}
              </div>

              <div className="cards-header">
                <span>{folderFilter ?? 'Todas las copias'}</span>
                {folderFilter && (
                  <button type="button" className="link-btn" onClick={() => setFolderFilter(null)}>
                    Ver todas
                  </button>
                )}
              </div>

              <ul className="cards">
                {visibleMaps.length === 0 && (
                  <li className="cards__empty">
                    No hay mapas en esta carpeta. Usa <strong>Duplicar Mapa</strong> para crear uno.
                  </li>
                )}
                {visibleMaps.map((map) => {
                  const active = map.id === activeMapId
                  const isRenaming = editingId === map.id

                  return (
                    <li key={map.id} className={`card-item ${active ? 'is-active' : ''}`}>
                      {isRenaming ? (
                        <form className="card-rename" onSubmit={(e) => submitRename(e, map.id)}>
                          <input
                            type="text"
                            className="card-rename__input"
                            value={editingName}
                            maxLength={60}
                            onChange={(e) => setEditingName(e.target.value)}
                            autoFocus
                          />
                          <button
                            type="submit"
                            className="icon-btn icon-btn--xs"
                            title="Guardar nombre"
                            aria-label="Guardar nombre"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--xs"
                            onClick={() => setEditingId(null)}
                            title="Cancelar"
                            aria-label="Cancelar"
                          >
                            <X size={13} />
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="card"
                            aria-current={active ? 'true' : undefined}
                            onClick={() => onSelectMap(map.id)}
                          >
                            <span className="card__thumb" aria-hidden="true">
                              <MapIcon size={14} />
                            </span>
                            <span className="card__body">
                              <span className="card__title" title={map.nombre}>
                                {map.nombre}
                              </span>
                              <span className="card__meta">
                                <Clock size={10} aria-hidden="true" />
                                {formatRelative(map.fechaModificacion, now)}
                              </span>
                              {!folderFilter && <span className="card__folder">{map.carpeta}</span>}
                            </span>
                          </button>

                          <div className="card-actions">
                            <button
                              type="button"
                              className="icon-btn icon-btn--xs"
                              onClick={() => startRename(map)}
                              title="Renombrar copia"
                              aria-label={`Renombrar ${map.nombre}`}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn--xs icon-btn--danger"
                              onClick={() => onDeleteMap(map.id)}
                              title="Eliminar copia"
                              aria-label={`Eliminar ${map.nombre}`}
                            >
                              <Trash size={12} />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Nodo 2: Catálogo ASF (3 Pilas GCOV Chiapas) + Capas Contrato C1 (data/raw) */}
        <div className="tree-node">
          <button
            type="button"
            className="tree-node__header"
            onClick={() => toggleNode('catalogAndC1')}
            aria-expanded={openNodes.catalogAndC1}
          >
            <span className="tree-node__caret">{openNodes.catalogAndC1 ? '▾' : '▸'}</span>
            <span className="tree-node__title">
              Catálogo ASF (3 Pilas GCOV Chiapas) & Capas Contrato C1 (data/raw)
            </span>
          </button>

          {openNodes.catalogAndC1 && (
            <div className="tree-node__body">
              <ExploradorFeature
                activeStackId={escena.pila}
                onSelectStack={(stack) => {
                  setPairDraft({ stack: stack.id, t1: stack.defaultT1, t2: stack.defaultT2 })
                  onSelectStack?.(stack)
                }}
              />
            </div>
          )}
        </div>

        {/* Nodo 2b: Gráficas Etapa 1 (Chart.js · T62/F10 Principal) */}
        <div className="tree-node">
          <button
            type="button"
            className="tree-node__header"
            onClick={() => toggleNode('chartsEtapa1')}
            aria-expanded={openNodes.chartsEtapa1}
          >
            <span className="tree-node__caret">{openNodes.chartsEtapa1 ? '▾' : '▸'}</span>
            <span className="tree-node__title">Gráficas Etapa 1 (Chart.js · T62/F10)</span>
          </button>

          {openNodes.chartsEtapa1 && (
            <div className="tree-node__body">
              <Etapa1ChartsPanel compact />
            </div>
          )}
        </div>

        {/* Nodo 3: Validador de Comparabilidad y Selección de Par t1/t2 */}
        <div className="tree-node">
          <button
            type="button"
            className="tree-node__header"
            onClick={() => toggleNode('compat')}
            aria-expanded={openNodes.compat}
          >
            <span className="tree-node__caret">{openNodes.compat ? '▾' : '▸'}</span>
            <span className="tree-node__title">Control de Comparabilidad ({escena.pila})</span>
          </button>

          {openNodes.compat && (
            <div className="tree-node__body">
              <ComparadorFeature
                stackId={escena.pila}
                t1={activeT1}
                t2={activeT2}
                onChangePair={(nextT1, nextT2) => {
                  setPairDraft({ stack: escena.pila, t1: nextT1, t2: nextT2 })
                  onChangePair?.(nextT1, nextT2)
                }}
              />
            </div>
          )}
        </div>

        {/* Nodo 4: Parámetros de Escena */}
        <div className="tree-node">
          <button
            type="button"
            className="tree-node__header"
            onClick={() => toggleNode('sceneParams')}
            aria-expanded={openNodes.sceneParams}
          >
            <span className="tree-node__caret">{openNodes.sceneParams ? '▾' : '▸'}</span>
            <span className="tree-node__title">Parámetros de Escena ({escena.producto})</span>
          </button>

          {openNodes.sceneParams && (
            <div className="tree-node__body">
              <table className="ws-param-table" aria-label="Tabla técnica de parámetros de escena">
                <tbody>
                  <tr>
                    <th>Producto / Banda</th>
                    <td>{escena.producto} · Band L (Freq A, 20 MHz)</td>
                  </tr>
                  <tr>
                    <th>Pila / Órbita</th>
                    <td>
                      {escena.pila} · {escena.direccion}
                    </td>
                  </tr>
                  <tr>
                    <th>Fechas (t1 → t2)</th>
                    <td className="ws-mono">
                      {escena.t1} → {escena.t2}
                    </td>
                  </tr>
                  <tr>
                    <th>CRID / Madurez</th>
                    <td className="ws-mono">
                      {escena.crid} · {escena.madurez}
                    </td>
                  </tr>
                  <tr>
                    <th>Malla / CRS</th>
                    <td className="ws-mono">
                      EPSG:{escena.epsg} · {escena.resolucionM}
                    </td>
                  </tr>
                  <tr>
                    <th>Cobertura ROI</th>
                    <td>{escena.coberturaRoiPct}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar__footer">
        <div className="opacity-control">
          <div className="opacity-control__header">
            <label htmlFor={sliderId} className="opacity-control__label">
              <Layers size={13} aria-hidden="true" />
              Opacidad de capa SAR (0% - 100%)
            </label>
            <span className="opacity-control__value">{opacity}%</span>
          </div>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={opacity}
            onChange={(e) => onOpacityChange(Number(e.target.value))}
            className="slider"
            style={{ '--slider-fill': `${opacity}%` } as CSSProperties}
          />
        </div>

        <div className="sidebar-trace-box" aria-label="Metadatos de trazabilidad NISAR">
          <div className="sidebar-trace-box__line">
            {escena.producto} · {escena.pila} ({escena.direccion}) · {escena.t1} → {escena.t2} ·
            HH/HV · {escena.unidad} · CRID: {escena.crid} ({escena.madurez})
          </div>
          <div
            className="sidebar-trace-box__badge"
            title="data/processed/ aún está vacío a la espera de preprocess.py y change.py (Rol P2)."
          >
            ⚠️ Etapa 1 (Inspección GCOV γ⁰/σ⁰ dB) · Δσ⁰ pendiente de Contrato C2
          </div>
        </div>
      </div>

      <div
        className={`sidebar__resizer ${isResizing ? 'is-active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Arrastrar con el puntero para ajustar el ancho del panel izquierdo (doble clic para restablecer)"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onMouseDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        onKeyDown={handleResizerKeyDown}
        title="Arrastra el borde con el puntero para agrandar o reducir el panel (doble clic para restablecer)"
      >
        <span className="sidebar__resizer-grip" aria-hidden="true" />
      </div>
    </aside>
  )
}
