import { useCallback, useRef, useState } from 'react'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { MapCanvas } from './components/MapCanvas'
import { DuplicateMapModal } from './components/DuplicateMapModal'
import { useSavedMaps } from './hooks/useSavedMaps'
import {
  DEFAULT_SOLAR,
  ESCENA_CHIAPAS,
  MAPA_GENERAL,
  checkPairCompat,
  type ExploreDateViewMode,
  type ExploreLayerId,
  type GcovStackSpec,
} from './mocks/initialWorkspaces'
import type {
  Carpeta,
  DrawTool,
  EscenaNisar,
  LngLat,
  MapAnnotation,
  MapView,
  SolarSimulationState,
  ViewMode,
  WorkspaceMap,
} from './types/workspace'
import { type ScientificColormapId } from './utils/colormapLut'
import { newId } from './utils/id'

function baseName(nombre: string): string {
  return nombre.replace(/^(Copia \d+|Mapa General)\s*-\s*/i, '').trim() || nombre
}

function App() {
  const { maps, addMap, updateMap, deleteMap } = useSavedMaps()
  const [viewMode, setViewMode] = useState<ViewMode>('editado')
  const [activeCopyId, setActiveCopyId] = useState<string | null>(() => maps[0]?.id ?? null)
  const [generalOpacity, setGeneralOpacity] = useState<number>(MAPA_GENERAL.opacidadSar)
  const [generalSolar, setGeneralSolar] = useState<SolarSimulationState>(DEFAULT_SOLAR)
  const [generalEscena, setGeneralEscena] = useState<EscenaNisar>(ESCENA_CHIAPAS)
  const [duplicating, setDuplicating] = useState(false)

  // Controles de estación de trabajo científica compartidos entre Ribbon Bar y Lienzo
  const [exploreLayerId, setExploreLayerId] = useState<ExploreLayerId>('gamma0_HHHH_ml2_dB')
  const [dateViewMode, setDateViewMode] = useState<ExploreDateViewMode>('t2')
  const [colormapId, setColormapId] = useState<ScientificColormapId>('inferno')
  const [activeTool, setActiveTool] = useState<DrawTool>('mover')

  const activeCopy = maps.find((m) => m.id === activeCopyId) ?? maps[0] ?? null
  const isEditing = viewMode === 'editado' && activeCopy !== null
  const current: WorkspaceMap = isEditing
    ? activeCopy
    : {
        ...MAPA_GENERAL,
        opacidadSar: generalOpacity,
        solar: generalSolar,
        escena: generalEscena,
      }

  const cameraRef = useRef<MapView>({ centro: current.centro, zoom: current.zoom })

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
    setActiveCopyId(id)
    setViewMode('editado')
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
    updateMap(activeCopy.id, {
      croppedRegion: polygon,
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

  const handleSelectStack = (stack: GcovStackSpec) => {
    const nextEscena: EscenaNisar = {
      ...current.escena,
      granuleId: stack.t1SceneId,
      t1SceneId: stack.t1SceneId,
      t2SceneId: stack.t2SceneId,
      pila: stack.id,
      direccion: stack.direction,
      t1: stack.defaultT1,
      t2: stack.defaultT2,
      crid: stack.crid,
      madurez: stack.maturity,
      coberturaRoiPct: stack.roiValidPctLabel,
      resolucionM: stack.gridResolutionLabel,
    }
    if (isEditing && activeCopy) {
      updateMap(activeCopy.id, {
        escena: nextEscena,
        fechaModificacion: new Date().toISOString(),
      })
    } else {
      setGeneralEscena(nextEscena)
    }
  }

  const handleChangePair = (t1: string, t2: string) => {
    const compat = checkPairCompat(t1, t2, current.escena.pila)
    // Si cruza 2026-10-23 (P05023 vs P05036) o t1 === t2, ComparadorFeature muestra el bloqueo visual y no altera el par válido del mapa
    if (!compat.comparable) return

    const nextEscena: EscenaNisar = {
      ...current.escena,
      granuleId: compat.t1SceneId,
      t1SceneId: compat.t1SceneId,
      t2SceneId: compat.t2SceneId,
      t1,
      t2,
      crid: compat.cridT1,
      madurez: compat.maturityT1,
    }
    if (isEditing && activeCopy) {
      updateMap(activeCopy.id, {
        escena: nextEscena,
        fechaModificacion: new Date().toISOString(),
      })
    } else {
      setGeneralEscena(nextEscena)
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
        viewMode={isEditing ? 'editado' : 'general'}
        onViewModeChange={setViewMode}
        canShowEdited={activeCopy !== null}
        onDuplicate={() => setDuplicating(true)}
        onExportJson={handleExportJson}
        escena={current.escena}
        opacity={current.opacidadSar}
        onOpacityChange={handleOpacityChange}
        exploreLayerId={exploreLayerId}
        onExploreLayerChange={setExploreLayerId}
        dateViewMode={dateViewMode}
        onDateViewModeChange={setDateViewMode}
        colormapId={colormapId}
        onColormapChange={setColormapId}
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        solar={current.solar}
        onSolarChange={handleSolarChange}
      />

      <div className="app__body">
        <Sidebar
          maps={maps}
          activeMapId={isEditing && activeCopy ? activeCopy.id : null}
          escena={current.escena}
          onSelectMap={handleSelectMap}
          onRenameMap={handleRenameMap}
          onDeleteMap={handleDeleteMap}
          opacity={current.opacidadSar}
          onOpacityChange={handleOpacityChange}
          onSelectStack={handleSelectStack}
          onChangePair={handleChangePair}
        />

        <MapCanvas
          view={{ centro: current.centro, zoom: current.zoom }}
          viewKey={isEditing && activeCopy ? `copia:${activeCopy.id}` : 'general'}
          opacity={current.opacidadSar}
          isEditing={isEditing}
          activeMapName={isEditing && activeCopy ? activeCopy.nombre : null}
          escena={current.escena}
          annotations={current.annotations}
          croppedRegion={current.croppedRegion}
          solar={current.solar}
          exploreLayerId={exploreLayerId}
          onExploreLayerChange={setExploreLayerId}
          dateViewMode={dateViewMode}
          onDateViewModeChange={setDateViewMode}
          colormapId={colormapId}
          onColormapChange={setColormapId}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onViewChange={handleViewChange}
          onAnnotationsChange={handleAnnotationsChange}
          onCropRegionChange={handleCropRegionChange}
          onSolarChange={handleSolarChange}
        />
      </div>

      {duplicating && (
        <DuplicateMapModal
          sourceName={current.nombre}
          defaultName={`Copia ${maps.length + 1} - ${baseName(current.nombre)}`}
          defaultFolder={current.carpeta ?? 'Mis Análisis'}
          onConfirm={handleConfirmDuplicate}
          onCancel={closeModal}
        />
      )}
    </div>
  )
}

export default App
