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
import { useTranslation } from '../i18n/useTranslation'
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
  const { t, localizeText } = useTranslation()
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
      aria-label={t('Model Builder / Árbol del Proyecto', 'Model Builder / Project Tree')}
    >
      {/* Cabecera de pestaña de panel acoplado estilo COMSOL ("Model Builder / Árbol del Proyecto") */}
      <div className="ws-panel-tabbar">
        <div className="ws-panel-tab is-active">
          <FolderTree size={13} aria-hidden="true" />
          <span>{t('Model Builder / Árbol del Proyecto', 'Model Builder / Project Tree')}</span>
        </div>
        <span className="ws-panel-tabbar__meta">{sidebarWidth} px</span>
      </div>

      <div className="sidebar__scroll">
        {/* Raíz del árbol del proyecto */}
        <div className="tree-root-label">
          <span className="tree-root-label__icon">▣</span>
          <span>{roiLayers ? t('ROI del usuario · NISAR GCOV', 'User-defined ROI · NISAR GCOV') : t('Sin ROI confirmada', 'No confirmed ROI')}</span>
        </div>

        <div className="tree-node">
          <button type="button" className="tree-node__header" onClick={() => toggleNode('locationSearch')} aria-expanded={openNodes.locationSearch}><span className="tree-node__caret">{openNodes.locationSearch ? '▾' : '▸'}</span><span className="tree-node__title">{t('Buscar ubicación', 'Search location')}</span></button>
          {openNodes.locationSearch && <div className="tree-node__body"><LocationSearch key={activeMapId ?? 'general'} onPreview={onLocationPreview} onConfirmROI={onConfirmLocationROI} onDrawROI={onDrawLocationROI} onNotify={onNotify} /></div>}
        </div>
        <div className="tree-node">
          <button type="button" className="tree-node__header" onClick={() => toggleNode('gcovCatalog')} aria-expanded={openNodes.gcovCatalog}><span className="tree-node__caret">{openNodes.gcovCatalog ? '▾' : '▸'}</span><span className="tree-node__title">{t('Catálogo GCOV · ASF', 'GCOV catalog · ASF')}</span></button>
          {openNodes.gcovCatalog && <div className="tree-node__body"><GcovCatalog key={`${activeMapId ?? 'general'}:${JSON.stringify(confirmedROI)}`} roi={confirmedROI} start={gcovStart} end={gcovEnd} onStartChange={setGcovStart} onEndChange={setGcovEnd} onFootprint={onGcovFootprint} onNotify={onNotify} /><button type="button" className="link-btn" onClick={() => onGcovFootprint(null)}>{t('Limpiar huella seleccionada', 'Clear selected footprint')}</button></div>}
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
            <span className="tree-node__title">{t('Explorador · Mapas guardados ({count})', 'Explorer · Saved maps ({count})', { count: maps.length })}</span>
          </button>

          {openNodes.savedMaps && (
            <div className="tree-node__body">
              <div className="folders" role="group" aria-label={t('Filtrar por carpeta', 'Filter by folder')}>
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
                      <span className="folder__name">{localizeText(carpeta)}</span>
                      <span className="folder__count">{count}</span>
                    </button>
                  )
                })}
              </div>

              <div className="cards-header">
                <span>{folderFilter ? localizeText(folderFilter) : t('Todas las copias', 'All copies')}</span>
                {folderFilter && (
                  <button type="button" className="link-btn" onClick={() => setFolderFilter(null)}>
                    {t('Ver todas', 'Show all')}
                  </button>
                )}
              </div>

              <ul className="cards">
                {visibleMaps.length === 0 && (
                  <li className="cards__empty">
                    {t('No hay mapas en esta carpeta. Usa', 'No maps in this folder. Use')} <strong>{t('Duplicar Mapa', 'Duplicate Map')}</strong> {t('para crear uno.', 'to create one.')}
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
                            title={t('Guardar nombre', 'Save name')}
                            aria-label={t('Guardar nombre', 'Save name')}
                          >
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--xs"
                            onClick={() => setEditingId(null)}
                            title={t('Cancelar', 'Cancel')}
                            aria-label={t('Cancelar', 'Cancel')}
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
                              {!folderFilter && <span className="card__folder">{localizeText(map.carpeta)}</span>}
                            </span>
                          </button>

                          <div className="card-actions">
                            <button
                              type="button"
                              className="icon-btn icon-btn--xs"
                              onClick={() => startRename(map)}
                              title={t('Renombrar copia', 'Rename copy')}
                              aria-label={t('Renombrar {name}', 'Rename {name}', { name: map.nombre })}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn--xs icon-btn--danger"
                              onClick={() => onDeleteMap(map.id)}
                              title={t('Eliminar copia', 'Delete copy')}
                              aria-label={t('Eliminar {name}', 'Delete {name}', { name: map.nombre })}
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

        {roiLayers ? <section className="roi-scene-details" aria-label={t('Resultados de la ROI delimitada', 'Results for the delineated ROI')}>
          <h3>{t('Escenas de la ROI seleccionada', 'Scenes for the selected ROI')}</h3>
          <p role="status">{localizeText(roiLayers.error || roiLayers.message)}</p>
          {roiLayers.manifests.map((manifest, i) => <article key={manifest.escena.granuleId}>
            <h4>t{i + 1}: {manifest.escena.fecha_inicio.slice(0, 10)}</h4>
            <p>{t('Trayectoria', 'Track')} {manifest.escena.trayectoria}/{t('Marco', 'Frame')} {manifest.escena.marco} · {manifest.escena.direccion === 'ASCENDING' ? t('Ascendente', 'Ascending') : manifest.escena.direccion === 'DESCENDING' ? t('Descendente', 'Descending') : manifest.escena.direccion}</p>
            <p>{manifest.escena.crid} · {manifest.escena.madurez_catalogo ?? localizeText('Madurez desconocida')}</p>
            <p>{t('Polarizaciones:', 'Polarizations:')} {manifest.escena.polarizaciones.join(', ')}</p>
            <code>{manifest.escena.granuleId}</code>
            {manifest.capas.map(layer => <p key={layer.id}>
              {layer.simbolo} {layer.capa}: {layer.pct_pixeles_validos.toFixed(2)}% {t('de píxeles válidos en el recorte', 'valid pixels in the crop')} · {layer.pixel_m} m
            </p>)}
          </article>)}
          {roiLayers.manifests.length > 0 && <><h3>{t('Gráficas NISAR de la ROI', 'NISAR ROI charts')}</h3>
            <RoiChartsSection roiLayers={roiLayers} compact /></>}
        </section> : <p className="roi-empty-state" role="status">{t('Sin datos calculados para una ROI todavía. Delimitá y confirmá una región para iniciar el análisis.', 'No calculated data for a region of interest yet. Delineate and confirm a region to start the analysis.')}</p>}
      </div>

      <div className="sidebar__footer">
        <div className="sidebar-trace-box" aria-label={t('Metadatos de trazabilidad NISAR', 'NISAR provenance metadata')}>
          <div className="sidebar-trace-box__line">
            {roiLayers ? t('ROI del usuario · inspección exploratoria', 'User-defined ROI · exploratory inspection') : localizeText('Sin datos calculados para una ROI todavía.')}
          </div>
          <div
            className="sidebar-trace-box__badge"
            title={t('data/processed/ aún está vacío a la espera de preprocess.py y change.py (Rol P2).', 'data/processed/ is still empty pending preprocess.py and change.py (Role P2).')}
          >
            {t('⚠️ Etapa 1 (Inspección GCOV γ⁰/σ⁰ dB) · Δσ⁰ pendiente de Contrato C2', '⚠️ Stage 1 (GCOV γ⁰/σ⁰ dB inspection) · Δσ⁰ pending Contract C2')}
          </div>
        </div>
      </div>

      <div
        className={`sidebar__resizer ${isResizing ? 'is-active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Arrastrar con el puntero para ajustar el ancho del panel izquierdo (doble clic para restablecer)', 'Drag to resize the left panel (double-click to reset)')}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onMouseDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        onKeyDown={handleResizerKeyDown}
        title={t('Arrastra el borde con el puntero para agrandar o reducir el panel (doble clic para restablecer)', 'Drag the edge to resize the panel (double-click to reset)')}
      >
        <span className="sidebar__resizer-grip" aria-hidden="true" />
      </div>
    </aside>
  )
}
