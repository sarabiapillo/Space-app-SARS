import { useCallback, useRef, useState } from 'react'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { MapCanvas } from './components/MapCanvas'
import { DuplicateMapModal } from './components/DuplicateMapModal'
import { TeamLandingPage } from './components/TeamLandingPage'
import { Toast, type ToastKind, type ToastMessage } from './components/Toast'
import { useSavedMaps } from './hooks/useSavedMaps'
import { useRoiLayers } from './hooks/useRoiLayers'
import { useTranslation } from './i18n/useTranslation'
import {
  DEFAULT_FLOOD,
  DEFAULT_SOLAR,
  MAPA_GENERAL,
  type CenterDockTab,
  type ExploreDateViewMode,
  type ExploreLayerId,
} from './mocks/initialWorkspaces'
import type {
  Carpeta,
  DockWindow,
  DockWindowKind,
  DrawTool,
  FloodSimulationState,
  LngLat,
  MapAnnotation,
  MapView,
  SolarSimulationState,
  ViewMode,
  WorkspaceMap,
} from './types/workspace'
import { type ScientificColormapId } from './utils/colormapLut'
import { newId } from './utils/id'
import { automaticCropRing, geometryToOuterRing, type AdministrativeGeometry } from './utils/roi'

function baseName(nombre: string): string {
  return nombre.replace(/^(Copia \d+|Mapa General)\s*-\s*/i, '').trim() || nombre
}

function App() {
  const { t } = useTranslation()
  const { maps, addMap, updateMap, deleteMap } = useSavedMaps()
  const [viewMode, setViewMode] = useState<ViewMode>('editado')
  const [activeCopyId, setActiveCopyId] = useState<string | null>(() => maps[0]?.id ?? null)
  const [generalOpacity, setGeneralOpacity] = useState<number>(MAPA_GENERAL.opacidadSar)
  const [generalSolar, setGeneralSolar] = useState<SolarSimulationState>(DEFAULT_SOLAR)
  const [generalFlood, setGeneralFlood] = useState<FloodSimulationState>(DEFAULT_FLOOD)
  const [duplicating, setDuplicating] = useState(false)
  const [teamPageOpen, setTeamPageOpen] = useState(false)
  const [locationPreview, setLocationPreview] = useState<AdministrativeGeometry | null>(null)
  const [gcovFootprint, setGcovFootprint] = useState<unknown | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const nextToastId = useRef(0)
  const notify = useCallback((kind: ToastKind, text: string) => {
    setToast({ id: ++nextToastId.current, kind, text })
  }, [])
  const closeToast = useCallback((id: number) => {
    setToast(current => current?.id === id ? null : current)
  }, [])

  // Controles de estación de trabajo científica compartidos entre Ribbon Bar y Lienzo
  const [exploreLayerId, setExploreLayerId] = useState<ExploreLayerId>('gamma0_HHHH_ml2_dB')
  const [dateViewMode, setDateViewMode] = useState<ExploreDateViewMode>('t2')
  const [colormapId, setColormapId] = useState<ScientificColormapId>('inferno')
  const [activeTool, setActiveTool] = useState<DrawTool>('mover')
  const [dockWindows, setDockWindows] = useState<DockWindow[]>([
    { id: 'dock-map-1', kind: 'map', index: 1 },
  ])
  const [activeDockWindowId, setActiveDockWindowId] = useState<string>('dock-map-1')
  const [floatingToolsOpen, setFloatingToolsOpen] = useState<boolean>(true)
  const [isCaptureMode, setIsCaptureMode] = useState<boolean>(false)

  const activeCopy = maps.find((m) => m.id === activeCopyId) ?? maps[0] ?? null
  const isEditing = viewMode === 'editado' && activeCopy !== null
  const current: WorkspaceMap = isEditing
    ? activeCopy
    : {
        ...MAPA_GENERAL,
        opacidadSar: generalOpacity,
        solar: generalSolar,
        flood: generalFlood,
      }

  const manualRoi = current.croppedRegion?.length
    ? { type: 'Polygon' as const, coordinates: [[...current.croppedRegion, current.croppedRegion[0]]] }
    : null
  const confirmedROI = current.effectiveRoi ?? manualRoi
  const analysisRegionForJob = current.effectiveRoi ?? (current.croppedRegion?.length
    ? { type: 'Polygon' as const, coordinates: [[...current.croppedRegion, current.croppedRegion[0]]] }
    : null)
  const roiLayers = useRoiLayers(analysisRegionForJob, current.id)
  const cameraRef = useRef<MapView>({ centro: current.centro, zoom: current.zoom })

  // Ventanas acoplables del área central (mapa normal y agua/DG2): solo cambia la vista activa,
  // el mapa y su estado se conservan porque el lienzo no se desmonta.
  const activeDockWindow =
    dockWindows.find((w) => w.id === activeDockWindowId) ?? dockWindows[0]
  const activeDockTab: CenterDockTab = activeDockWindow?.kind === 'agua' ? 'rain-dg2' : 'map'

  const openDockWindow = useCallback(
    (kind: DockWindowKind) => {
      const nextIndex =
        dockWindows.filter((w) => w.kind === kind).reduce((max, w) => Math.max(max, w.index), 0) + 1
      const next: DockWindow = { id: newId(), kind, index: nextIndex }
      setDockWindows((prev) => [...prev, next])
      setActiveDockWindowId(next.id)
    },
    [dockWindows],
  )

  const closeDockWindow = useCallback(
    (id: string) => {
      if (dockWindows.length <= 1) return
      const position = dockWindows.findIndex((w) => w.id === id)
      if (position < 0) return
      const remaining = dockWindows.filter((w) => w.id !== id)
      setDockWindows(remaining)
      if (activeDockWindowId === id) {
        const fallback = remaining[Math.max(0, position - 1)] ?? remaining[0]
        setActiveDockWindowId(fallback.id)
      }
    },
    [dockWindows, activeDockWindowId],
  )

  const handleDockTabChange = useCallback(
    (tab: CenterDockTab) => {
      const kind: DockWindowKind = tab === 'rain-dg2' ? 'agua' : 'map'
      const existing = dockWindows.find((w) => w.kind === kind)
      if (existing) {
        setActiveDockWindowId(existing.id)
        return
      }
      openDockWindow(kind)
    },
    [dockWindows, openDockWindow],
  )

  const handleViewChange = useCallback(
    (view: MapView, { userInitiated }: { userInitiated: boolean }) => {
      cameraRef.current = view
      if (userInitiated && isEditing && activeCopy) {
        updateMap(activeCopy.id, { ...view, fechaModificacion: new Date().toISOString() })
      }
    },
    [isEditing, activeCopy, updateMap],
  )

  const handleOpacityChange = (value: number) => {
    if (isEditing && activeCopy) {
      updateMap(activeCopy.id, { opacidadSar: value, fechaModificacion: new Date().toISOString() })
    } else {
      setGeneralOpacity(value)
    }
  }

  const handleSelectMap = (id: string) => {
    setLocationPreview(null)
    setGcovFootprint(null)
    setActiveCopyId(id)
    setViewMode('editado')
  }

  const handleViewModeChange = (mode: ViewMode) => {
    if (mode !== viewMode) {
      setLocationPreview(null)
      setGcovFootprint(null)
    }
    setViewMode(mode)
  }

  const handleRenameMap = (id: string, nombre: string) => {
    updateMap(id, { nombre, fechaModificacion: new Date().toISOString() })
  }

  const handleDeleteMap = (id: string) => {
    const remaining = maps.filter((m) => m.id !== id)
    deleteMap(id)
    if (activeCopy?.id === id) {
      if (remaining.length > 0) {
        setActiveCopyId(remaining[0].id)
      } else {
        setActiveCopyId(null)
        setViewMode('general')
      }
    }
  }

  const handleAnnotationsChange = (next: MapAnnotation[]) => {
    if (!activeCopy) return
    updateMap(activeCopy.id, {
      annotations: next,
      fechaModificacion: new Date().toISOString(),
    })
  }

  const handleCropRegionChange = (polygon: LngLat[] | null) => {
    if (!activeCopy) return
    const changed = JSON.stringify(activeCopy.croppedRegion ?? null) !== JSON.stringify(polygon ?? null) || Boolean(activeCopy.effectiveRoi)
    if (changed) {
      setGcovFootprint(null)
      setLocationPreview(null)
    }
    const previousFlood = activeCopy.flood
    updateMap(activeCopy.id, {
      croppedRegion: polygon,
      effectiveRoi: null,
      effectiveRoiMetadata: null,
      ...(changed ? { solar: { ...activeCopy.solar, enabled: false, rasterPreviewUrl: null, rasterBounds: null } } : {}),
      ...(changed && previousFlood ? {
        flood: { ...previousFlood, enabled: false, rasterUrl: null, rasterBounds: null,
          stats: null, charts: null, resultRoiKey: undefined, compareMode: false },
      } : {}),
      fechaModificacion: new Date().toISOString(),
    })
  }

  const handleSolarChange = (nextSolar: SolarSimulationState) => {
    if (isEditing && activeCopy) {
      updateMap(activeCopy.id, {
        solar: nextSolar,
        fechaModificacion: new Date().toISOString(),
      })
    } else {
      setGeneralSolar(nextSolar)
    }
  }

  const handleFloodChange = (nextFlood: FloodSimulationState) => {
    if (isEditing && activeCopy) {
      updateMap(activeCopy.id, {
        flood: nextFlood,
        fechaModificacion: new Date().toISOString(),
      })
    } else {
      setGeneralFlood(nextFlood)
    }
  }

  const handleConfirmDuplicate = (nombre: string, carpeta: Carpeta) => {
    const copy: WorkspaceMap = {
      ...current,
      id: newId(),
      nombre,
      carpeta,
      esEditable: true,
      fechaModificacion: new Date().toISOString(),
      centro: cameraRef.current.centro,
      zoom: cameraRef.current.zoom,
      escena: { ...current.escena },
      annotations: [...current.annotations],
      croppedRegion: current.croppedRegion ? [...current.croppedRegion] : null,
      solar: { ...current.solar },
    }
    addMap(copy)
    setActiveCopyId(copy.id)
    setViewMode('editado')
    setDuplicating(false)
  }

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      map: current,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = current.nombre
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-|-$/g, '')
    a.href = url
    a.download = `${safeName || 'terrapulse-mapa'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const closeModal = useCallback(() => setDuplicating(false), [])

  return (
    <div className="app">
      <Header
        roiLayers={confirmedROI ? roiLayers : undefined}
        viewMode={isEditing ? 'editado' : 'general'}
        onViewModeChange={handleViewModeChange}
        canShowEdited={activeCopy !== null}
        hasConfirmedROI={Boolean(current.effectiveRoi || current.croppedRegion)}
        onDuplicate={() => setDuplicating(true)}
        onExportJson={handleExportJson}
        opacity={current.opacidadSar}
        onOpacityChange={handleOpacityChange}
        exploreLayerId={exploreLayerId}
        onExploreLayerChange={setExploreLayerId}
        dateViewMode={confirmedROI && ((dateViewMode === 'swipe' && !roiLayers.comparable) || (dateViewMode === 't2' && !roiLayers.manifests[1])) ? 't1' : dateViewMode}
        onDateViewModeChange={setDateViewMode}
        colormapId={colormapId}
        onColormapChange={setColormapId}
        activeTool={activeTool}
        solar={current.solar}
        onSolarChange={handleSolarChange}
        activeDockTab={activeDockTab}
        onDockTabChange={handleDockTabChange}
        floatingToolsOpen={floatingToolsOpen}
        onToggleFloatingTools={() => setFloatingToolsOpen((prev) => !prev)}
        isCaptureMode={isCaptureMode}
        onStartCaptureMode={() => setIsCaptureMode((prev) => !prev)}
        onOpenTeamPage={() => setTeamPageOpen(true)}
      />

      <div className="app__body">
        <Sidebar
          roiLayers={confirmedROI ? roiLayers : undefined}
          maps={maps}
          activeMapId={isEditing && activeCopy ? activeCopy.id : null}
          onSelectMap={handleSelectMap}
          onRenameMap={handleRenameMap}
          onDeleteMap={handleDeleteMap}
          opacity={current.opacidadSar}
          onOpacityChange={handleOpacityChange}
          locationPreview={locationPreview}
          confirmedROI={confirmedROI}
          onNotify={notify}
          onLocationPreview={setLocationPreview}
          onGcovFootprint={setGcovFootprint}
          onConfirmLocationROI={(geometry, metadata) => {
            if (!activeCopy) { notify('error', 'Duplica o selecciona un mapa editable antes de guardar una ROI.'); return false }
            setGcovFootprint(null)
            const isOriginalAdmin = metadata.generation === 'administrative_original' || metadata.generation === 'administrative_bbox'
            const cropRing = isOriginalAdmin ? geometryToOuterRing(geometry) : automaticCropRing(geometry)
            updateMap(activeCopy.id, {
              effectiveRoi: geometry, effectiveRoiMetadata: metadata,
              croppedRegion: cropRing,
              solar: { ...activeCopy.solar, enabled: false, rasterPreviewUrl: null, rasterBounds: null },
              ...(activeCopy.flood ? { flood: { ...activeCopy.flood, enabled: false, rasterUrl: null, rasterBounds: null, stats: null, charts: null, resultRoiKey: undefined, compareMode: false } } : {}),
              fechaModificacion: new Date().toISOString(),
            })
            notify('success', 'ROI confirmada y guardada en el mapa editable.')
            return true
          }}
          onDrawLocationROI={() => {
            notify('error', activeCopy
              ? 'Dibuja una ROI no mayor de 0.6° por lado con la herramienta Recortar ROI; no se asumirá ni truncará un rectángulo.'
              : 'Duplica un mapa para habilitar herramientas. Después dibuja una ROI no mayor de 0.6° por lado; no se asumirá un rectángulo.')
            if (activeCopy) setViewMode('editado')
            setActiveTool('poligono')
          }}
        />

        <MapCanvas
          roiLayers={roiLayers}
          view={{ centro: current.centro, zoom: current.zoom }}
          viewKey={isEditing && activeCopy ? `copia:${activeCopy.id}` : 'general'}
          opacity={current.opacidadSar}
          isEditing={isEditing}
          activeMapName={isEditing && activeCopy ? activeCopy.nombre : null}
          escena={current.escena}
          annotations={current.annotations}
          croppedRegion={current.croppedRegion}
          effectiveRoi={current.effectiveRoi ?? null}
          solar={current.solar}
          flood={current.flood || generalFlood}
          exploreLayerId={exploreLayerId}
          dateViewMode={confirmedROI && ((dateViewMode === 'swipe' && !roiLayers.comparable) || (dateViewMode === 't2' && !roiLayers.manifests[1])) ? 't1' : dateViewMode}
          colormapId={colormapId}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onViewChange={handleViewChange}
          onAnnotationsChange={handleAnnotationsChange}
          onCropRegionChange={handleCropRegionChange}
          onSolarChange={handleSolarChange}
          onFloodChange={handleFloodChange}
          dockWindows={dockWindows}
          activeDockWindowId={activeDockWindow?.id ?? ''}
          onActivateDockWindow={setActiveDockWindowId}
          onCloseDockWindow={closeDockWindow}
          onOpenDockWindow={openDockWindow}
          floatingToolsOpen={floatingToolsOpen}
          onToggleFloatingTools={() => setFloatingToolsOpen((prev) => !prev)}
          isCaptureMode={isCaptureMode}
          onStartCaptureMode={() => setIsCaptureMode(true)}
          onCancelCaptureMode={() => setIsCaptureMode(false)}
          locationPreview={locationPreview ?? current.effectiveRoi ?? null}
          gcovFootprint={gcovFootprint}
          onNotify={notify}
        />
      </div>

      {duplicating && (
        <DuplicateMapModal
          sourceName={current.nombre}
          defaultName={`${t('Copia', 'Copy')} ${maps.length + 1} - ${baseName(current.nombre)}`}
          defaultFolder={current.carpeta ?? 'Mis Análisis'}
          onConfirm={handleConfirmDuplicate}
          onCancel={closeModal}
        />
      )}

      {teamPageOpen && <TeamLandingPage onClose={() => setTeamPageOpen(false)} />}
      <Toast message={toast} onClose={closeToast} />

    </div>
  )
}

export default App
