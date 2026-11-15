import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FormEvent,
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
import { CARPETAS, type Carpeta, type WorkspaceMap } from '../types/workspace'
import { formatRelative } from '../utils/time'

interface SidebarProps {
  maps: WorkspaceMap[]
  /** Id de la copia activa en "Mapa Editado"; `null` si se está viendo el Mapa General. */
  activeMapId: string | null
  onSelectMap: (id: string) => void
  onRenameMap: (id: string, newName: string) => void
  onDeleteMap: (id: string) => void
  opacity: number
  onOpacityChange: (value: number) => void
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
  onSelectMap,
  onRenameMap,
  onDeleteMap,
  opacity,
  onOpacityChange,
}: SidebarProps) {
  const [folderFilter, setFolderFilter] = useState<Carpeta | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const now = useNow(30_000)
  const sliderId = useId()

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
    <aside className="sidebar" aria-label="Mis Mapas Guardados">
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
      </div>
    </aside>
  )
}
