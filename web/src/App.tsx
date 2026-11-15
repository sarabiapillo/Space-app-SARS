import { useCallback, useRef, useState } from 'react'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { MapCanvas } from './components/MapCanvas'
import { DuplicateMapModal } from './components/DuplicateMapModal'
import { useSavedMaps } from './hooks/useSavedMaps'
import { DEFAULT_SOLAR, MAPA_GENERAL } from './mocks/initialWorkspaces'
import type {
  Carpeta,
  LngLat,
  MapAnnotation,
  MapView,
  SolarSimulationState,
  ViewMode,
  WorkspaceMap,
} from './types/workspace'
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
  const [duplicating, setDuplicating] = useState(false)

  const activeCopy = maps.find((m) => m.id === activeCopyId) ?? maps[0] ?? null
  const isEditing = viewMode === 'editado' && activeCopy !== null
  const current: WorkspaceMap = isEditing
    ? activeCopy
    : { ...MAPA_GENERAL, opacidadSar: generalOpacity, solar: generalSolar }

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
      />

      <div className="app__body">
        <Sidebar
          maps={maps}
          activeMapId={isEditing && activeCopy ? activeCopy.id : null}
          onSelectMap={handleSelectMap}
          onRenameMap={handleRenameMap}
          onDeleteMap={handleDeleteMap}
          opacity={current.opacidadSar}
          onOpacityChange={handleOpacityChange}
        />

        <MapCanvas
          view={{ centro: current.centro, zoom: current.zoom }}
          viewKey={isEditing && activeCopy ? `copia:${activeCopy.id}` : 'general'}
          opacity={current.opacidadSar}
          isEditing={isEditing}
          activeMapName={isEditing && activeCopy ? activeCopy.nombre : null}
          annotations={current.annotations}
          croppedRegion={current.croppedRegion}
          solar={current.solar}
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
