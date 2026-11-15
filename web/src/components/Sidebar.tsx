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
      aria-label="Mis Mapas Guardados"
    >
      <div className="sidebar__scroll">
        <h2 className="sidebar__title">Mis Mapas Guardados</h2>

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
                <Icon size={16} aria-hidden="true" />
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
              No hay mapas en esta carpeta. Usa <strong>+ Duplicar Mapa</strong> para crear uno.
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
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--xs"
                      onClick={() => setEditingId(null)}
                      title="Cancelar"
                      aria-label="Cancelar"
                    >
                      <X size={14} />
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
                        <MapIcon size={16} />
                      </span>
                      <span className="card__body">
                        <span className="card__title" title={map.nombre}>
                          {map.nombre}
                        </span>
                        <span className="card__meta">
                          <Clock size={11} aria-hidden="true" />
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
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--xs icon-btn--danger"
                        onClick={() => onDeleteMap(map.id)}
                        title="Eliminar copia"
                        aria-label={`Eliminar ${map.nombre}`}
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>

        {/* Pilas GCOV Reales de Chiapas y Validador de Bloqueo CRID (Contrato C4) */}
        <ExploradorFeature
          activeStackId={escena.pila}
          onSelectStack={(stack) => {
            setPairDraft({ stack: stack.id, t1: stack.defaultT1, t2: stack.defaultT2 })
            onSelectStack?.(stack)
          }}
        />

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

      <div className="sidebar__footer">
        <div className="opacity-control">
          <div className="opacity-control__header">
            <label htmlFor={sliderId} className="opacity-control__label">
              <Layers size={14} aria-hidden="true" />
              Opacidad de capa (0% - 100%)
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
            HH/HV · {escena.unidad} · CRID: {escena.crid} ({escena.madurez}) · Cobertura ROI:{' '}
            {escena.coberturaRoiPct}
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
