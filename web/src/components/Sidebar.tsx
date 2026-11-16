import type { useRoiLayers } from '../hooks/useRoiLayers'
import {
  useEffect,
  useState,
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
  Map as MapIcon,
  Pencil,
  Trash,
  X,
} from 'lucide-react'
import {
  CARPETAS,
  type Carpeta,
  type WorkspaceMap,
} from '../types/workspace'
import { RoiChartsSection } from './RoiChartsSection'
import { formatRelative } from '../utils/time'
import { LocationSearch } from './LocationSearch'
import { GcovCatalog } from './GcovCatalog'
import type { AdministrativeGeometry, EffectiveRoiMetadata, RoiGeometry } from '../utils/roi'
import type { ToastKind } from './Toast'

interface SidebarProps {
  roiLayers?: ReturnType<typeof useRoiLayers>
  maps: WorkspaceMap[]
  /** Id de la copia activa en "Mapa Editado"; `null` si se está viendo el Mapa General. */
  activeMapId: string | null
  onSelectMap: (id: string) => void
  onRenameMap: (id: string, newName: string) => void
  onDeleteMap: (id: string) => void
  opacity: number
  onOpacityChange: (value: number) => void
  locationPreview?: AdministrativeGeometry | null
  onLocationPreview: (geometry: AdministrativeGeometry | null) => void
  onConfirmLocationROI: (geometry: RoiGeometry, metadata: EffectiveRoiMetadata) => boolean | void
  onDrawLocationROI: () => void
  onGcovFootprint: (feature: unknown | null) => void
  confirmedROI: unknown | null
  onNotify: (kind: ToastKind, text: string) => void
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
  roiLayers,
  maps,
  activeMapId,
  onSelectMap,
  onRenameMap,
  onDeleteMap,
  onLocationPreview, onConfirmLocationROI, onDrawLocationROI, onGcovFootprint, confirmedROI, onNotify,
}: SidebarProps) {
  const [gcovStart, setGcovStart] = useState('')
  const [gcovEnd, setGcovEnd] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadInitialSidebarWidth())
  const [isResizing, setIsResizing] = useState(false)
  const [folderFilter, setFolderFilter] = useState<Carpeta | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [openNodes, setOpenNodes] = useState<{
    savedMaps: boolean
    locationSearch: boolean
    gcovCatalog: boolean
  }>({
    savedMaps: true,
    locationSearch: true,
    gcovCatalog: true,
  })
  const now = useNow(30_000)

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
          <span>{roiLayers ? 'ROI del usuario · NISAR GCOV' : 'Sin ROI confirmada'}</span>
        </div>

        <div className="tree-node">
          <button type="button" className="tree-node__header" onClick={() => toggleNode('locationSearch')} aria-expanded={openNodes.locationSearch}><span className="tree-node__caret">{openNodes.locationSearch ? '▾' : '▸'}</span><span className="tree-node__title">Buscar ubicación</span></button>
          {openNodes.locationSearch && <div className="tree-node__body"><LocationSearch key={activeMapId ?? 'general'} onPreview={onLocationPreview} onConfirmROI={onConfirmLocationROI} onDrawROI={onDrawLocationROI} onNotify={onNotify} /></div>}
        </div>
        <div className="tree-node">
          <button type="button" className="tree-node__header" onClick={() => toggleNode('gcovCatalog')} aria-expanded={openNodes.gcovCatalog}><span className="tree-node__caret">{openNodes.gcovCatalog ? '▾' : '▸'}</span><span className="tree-node__title">Catálogo GCOV · ASF</span></button>
          {openNodes.gcovCatalog && <div className="tree-node__body"><GcovCatalog key={`${activeMapId ?? 'general'}:${JSON.stringify(confirmedROI)}`} roi={confirmedROI} start={gcovStart} end={gcovEnd} onStartChange={setGcovStart} onEndChange={setGcovEnd} onFootprint={onGcovFootprint} onNotify={onNotify} /><button type="button" className="link-btn" onClick={() => onGcovFootprint(null)}>Limpiar huella seleccionada</button></div>}
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
            <span className="tree-node__title">Explorador · Mapas guardados ({maps.length})</span>
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

        {roiLayers ? <section className="roi-scene-details" aria-label="Resultados de la ROI delimitada">
          <h3>Escenas de la ROI seleccionada</h3>
          <p role="status">{roiLayers.error || roiLayers.message}</p>
          {roiLayers.manifests.map((manifest, i) => <article key={manifest.escena.granuleId}>
            <h4>t{i + 1}: {manifest.escena.fecha_inicio.slice(0, 10)}</h4>
            <p>T{manifest.escena.trayectoria}/F{manifest.escena.marco} · {manifest.escena.direccion}</p>
            <p>{manifest.escena.crid} · {manifest.escena.madurez_catalogo ?? 'Madurez desconocida'}</p>
            <p>Polarizaciones: {manifest.escena.polarizaciones.join(', ')}</p>
            <code>{manifest.escena.granuleId}</code>
            {manifest.capas.map(layer => <p key={layer.id}>
              {layer.simbolo} {layer.capa}: {layer.pct_pixeles_validos.toFixed(2)}% de píxeles válidos en el recorte · {layer.pixel_m} m
            </p>)}
          </article>)}
          {roiLayers.manifests.length > 0 && <><h3>Gráficas NISAR de la ROI</h3>
            <RoiChartsSection roiLayers={roiLayers} compact /></>}
        </section> : <p className="roi-empty-state" role="status">Sin datos calculados para una ROI todavía. Delimitá y confirmá una región para iniciar el análisis.</p>}
      </div>

      <div className="sidebar__footer">
        <div className="sidebar-trace-box" aria-label="Metadatos de trazabilidad NISAR">
          <div className="sidebar-trace-box__line">
            {roiLayers ? 'ROI del usuario · inspección exploratoria' : 'Sin datos calculados para una ROI todavía.'}
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
