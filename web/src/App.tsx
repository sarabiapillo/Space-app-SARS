import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
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
  SeismicSimulationState,
  SolarSimulationState,
  ViewMode,
  WorkspaceMap,
} from './types/workspace'
import { type ScientificColormapId } from './utils/colormapLut'
import { newId } from './utils/id'
import { automaticCropRing, geometryToOuterRing, type AdministrativeGeometry } from './utils/roi'
import { seismicForMap, newSeismicScenario, regionCenter, markEdited } from './utils/seismicScenario'
import { SOIL_VS30 } from './utils/seismic'
import { presetToRoiPolygon, presetToCropRing, presetToEffectiveMetadata, getRecommendedSeismicSettings, type CatalogRoiPreset } from './utils/roiCatalog'
import { bboxFromGeometry, type LonLatBBox } from './utils/terrain3d'

// Visor 3D aislado: three.js solo se descarga cuando el usuario abre "Relieve 3D".
const Terrain3DViewer = lazy(() => import('./components/Terrain3DViewer'))
/** Lado máximo (grados) del rectángulo de la ROI para el relieve 3D. */
const TERRAIN3D_MAX_DEG = 3

function baseName(nombre: string): string {
  return nombre.replace(/^(Copia \d+|Mapa General)\s*-\s*/i, '').trim() || nombre
}

function App() {
  const { t, localizeText } = useTranslation()
  const { maps, addMap, updateMap, deleteMap } = useSavedMaps()
  const [viewMode, setViewMode] = useState<ViewMode>('editado')
  const [activeCopyId, setActiveCopyId] = useState<string | null>(() => maps[0]?.id ?? null)
  const [generalOpacity, setGeneralOpacity] = useState<number>(MAPA_GENERAL.opacidadSar)
  const [generalSolar, setGeneralSolar] = useState<SolarSimulationState>(DEFAULT_SOLAR)
  const [generalFlood, setGeneralFlood] = useState<FloodSimulationState>(DEFAULT_FLOOD)
  // Sin escenario propio del mapa general hasta que el usuario lo edite (se coloca en su región).
  const [generalSeismic, setGeneralSeismic] = useState<SeismicSimulationState | undefined>(undefined)
  const [duplicating, setDuplicating] = useState(false)
  const [teamPageOpen, setTeamPageOpen] = useState(false)
  const [terrainBBox, setTerrainBBox] = useState<LonLatBBox | null>(null)
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
  const current: WorkspaceMap = useMemo(
    () =>
      isEditing
        ? activeCopy
        : {
            ...MAPA_GENERAL,
            opacidadSar: generalOpacity,
            solar: generalSolar,
            flood: generalFlood,
            seismic: generalSeismic,
          },
    [isEditing, activeCopy, generalOpacity, generalSolar, generalFlood, generalSeismic],
  )

  const manualRoi = current.croppedRegion?.length
    ? { type: 'Polygon' as const, coordinates: [[...current.croppedRegion, current.croppedRegion[0]]] }
    : null
  const confirmedROI = current.effectiveRoi ?? manualRoi
  const analysisRegionForJob = current.effectiveRoi ?? (current.croppedRegion?.length
    ? { type: 'Polygon' as const, coordinates: [[...current.croppedRegion, current.croppedRegion[0]]] }
    : null)
  const roiLayers = useRoiLayers(analysisRegionForJob, current.id)
  // Escenario sísmico de ESTE mapa: el guardado, o uno nuevo en su ROI (no el de otro mapa ni uno fijo).
  const currentSeismic = useMemo(
    () => seismicForMap({
      nombre: current.nombre, croppedRegion: current.croppedRegion,
      effectiveRoi: current.effectiveRoi, seismic: current.seismic,
    }),
    // Sin `centro`: desplazar el mapa no debe mover el epicentro.
    [current.nombre, current.croppedRegion, current.effectiveRoi, current.seismic],
  )
  const cameraRef = useRef<MapView>({ centro: current.centro, zoom: current.zoom })

  // Ventanas acoplables del área central (mapa normal y simuladores): solo cambia la vista activa,
  // el mapa y su estado se conservan porque el lienzo no se desmonta.
  const activeDockWindow =
    dockWindows.find((w) => w.id === activeDockWindowId) ?? dockWindows[0]
  const activeDockTab: CenterDockTab =
    activeDockWindow?.kind === 'agua'
      ? 'rain-dg2'
      : activeDockWindow?.kind === 'sismo'
        ? 'seismic'
        : activeDockWindow?.kind === 'solar'
          ? 'solar'
          : 'map'

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
      const kind: DockWindowKind = tab === 'rain-dg2' ? 'agua' : tab === 'seismic' ? 'sismo' : tab === 'solar' ? 'solar' : 'map'
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
    const selected = maps.find(map => map.id === id)
    const dockKind: DockWindowKind = selected?.solar.enabled
      ? 'solar'
      : selected?.flood?.enabled
        ? 'agua'
        : selected?.seismic?.enabled
          ? 'sismo'
          : 'map'
    const dock = dockWindows.find(window => window.kind === dockKind)
    if (dock) setActiveDockWindowId(dock.id)
    else openDockWindow(dockKind)
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

  const handleSelectPresetROI = useCallback((
    preset: CatalogRoiPreset,
    options?: { withHeatmap?: boolean; simulation?: 'flood' | 'solar' | 'seismic' }
  ) => {
    const polygon = presetToRoiPolygon(preset)
    const cropRing = presetToCropRing(preset)
    const metadata = presetToEffectiveMetadata(preset)

    setGcovFootprint(null)
    setLocationPreview(null)

    // Por defecto al cargar un ROI se muestra limpio SIN mapa de calor (opacidadSar = 0).
    // Si se especifica withHeatmap se activa a 72.
    const initialOpacity = options?.withHeatmap ? 72 : 0
    const presetSeismic = options?.simulation === 'seismic'
      ? (() => {
          const settings = getRecommendedSeismicSettings(preset.state, preset.name)
          return { ...newSeismicScenario(preset.center, preset.name), enabled: true,
            name: `Sismo - ${preset.name}`, soilType: settings.soilType,
            vs30: SOIL_VS30[settings.soilType], mechanism: settings.mechanism, autoPlaced: false }
        })()
      : null

    if (activeCopy && isEditing) {
      updateMap(activeCopy.id, {
        centro: preset.center,
        zoom: preset.zoom,
        opacidadSar: initialOpacity,
        effectiveRoi: polygon,
        effectiveRoiMetadata: metadata,
        croppedRegion: cropRing,
        solar: { ...activeCopy.solar, enabled: options?.simulation === 'solar', rasterPreviewUrl: null, rasterBounds: null,
          simulationResult: null, analysisResult: null, contours: null },
        ...(activeCopy.flood ? { flood: { ...activeCopy.flood, enabled: options?.simulation === 'flood', rasterUrl: null, rasterBounds: null, stats: null, charts: null, resultRoiKey: undefined, compareMode: false } } : {}),
        ...(presetSeismic ? { seismic: presetSeismic } : {}),
        fechaModificacion: new Date().toISOString(),
      })
    } else {
      const newCopy: WorkspaceMap = {
        ...current,
        id: newId(),
        nombre: options?.withHeatmap
          ? `Mapa de Calor - ${preset.shortLabel}`
          : options?.simulation === 'flood'
            ? `Agua DG2 - ${preset.shortLabel}`
            : options?.simulation === 'seismic'
              ? `Sismo - ${preset.shortLabel}`
              : `Análisis - ${preset.shortLabel}`,
        carpeta: options?.simulation ? 'Zonas de Riesgo' : 'Mis Análisis',
        esEditable: true,
        fechaModificacion: new Date().toISOString(),
        opacidadSar: initialOpacity,
        centro: preset.center,
        zoom: preset.zoom,
        escena: { ...current.escena },
        annotations: [],
        croppedRegion: cropRing,
        effectiveRoi: polygon,
        effectiveRoiMetadata: metadata,
        solar: { ...DEFAULT_SOLAR, enabled: options?.simulation === 'solar' },
        flood: { ...DEFAULT_FLOOD, enabled: options?.simulation === 'flood' },
        seismic: presetSeismic ?? newSeismicScenario(preset.center, preset.name),
      }
      addMap(newCopy)
      setActiveCopyId(newCopy.id)
      setViewMode('editado')
    }

    cameraRef.current = { centro: preset.center, zoom: preset.zoom }

    if (options?.simulation === 'flood') {
      handleDockTabChange('rain-dg2')
      notify('success', t(`ROI activada para Simulación de Agua: ${preset.name} (${preset.state}) sin mapa de calor.`, `ROI activated for Water Simulation: ${preset.name} (${preset.state}) without heatmap.`))
    } else if (options?.simulation === 'solar') {
      handleDockTabChange('solar')
      notify('success', t(`ROI activada para Simulación Solar: ${preset.name} (${preset.state}).`, `ROI activated for Solar Simulation: ${preset.name} (${preset.state}).`))
    } else if (options?.simulation === 'seismic') {
      handleDockTabChange('seismic')
      notify('success', t(`ROI activada para Sismo: ${preset.name} (${preset.state}) sin mapa de calor.`, `ROI activated for Seismic: ${preset.name} (${preset.state}) without heatmap.`))
    } else if (options?.withHeatmap) {
      handleDockTabChange('map')
      notify('success', t(`ROI activada con Mapa de Calor: ${preset.name} (${preset.state}).`, `ROI activated with Heatmap: ${preset.name} (${preset.state}).`))
    } else {
      handleDockTabChange('map')
      notify('success', t(`ROI activada (vista limpia sin mapa de calor): ${preset.name} (${preset.state}).`, `ROI activated (clean view without heatmap): ${preset.name} (${preset.state}).`))
    }
  }, [activeCopy, isEditing, current, updateMap, addMap, notify, t, handleDockTabChange])

  const handleSolarChange = useCallback(
    (nextSolar: SolarSimulationState) => {
      if (isEditing && activeCopy) {
        updateMap(activeCopy.id, {
          solar: nextSolar,
          fechaModificacion: new Date().toISOString(),
        })
      } else {
        setGeneralSolar(nextSolar)
      }
    },
    [isEditing, activeCopy, updateMap],
  )

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

  const handleSeismicChange = useCallback(
    (incoming: SeismicSimulationState) => {
      const nextSeismic = markEdited(currentSeismic, incoming)
      if (isEditing && activeCopy) {
        updateMap(activeCopy.id, {
          seismic: nextSeismic,
          fechaModificacion: new Date().toISOString(),
        })
      } else {
        setGeneralSeismic(nextSeismic)
      }
    },
    [currentSeismic, isEditing, activeCopy, updateMap],
  )

  const handleOpenSimulation = useCallback(
    (mode: 'flood' | 'solar' | 'seismic', preset?: CatalogRoiPreset) => {
      if (mode === 'flood') {
        handleDockTabChange('rain-dg2')
      } else if (mode === 'solar') {
        handleDockTabChange('solar')
        // Preset selection already enabled solar and cleared results for the new ROI.
        if (!preset) handleSolarChange({ ...current.solar, enabled: true })
      } else if (mode === 'seismic') {
        handleDockTabChange('seismic')
        if (preset) {
          const geoSettings = getRecommendedSeismicSettings(preset.state, preset.name)
          cameraRef.current = { centro: preset.center, zoom: Math.max(7, preset.zoom - 2) }
          notify(
            'success',
            t(
              `Simulador Sísmico vinculado a ${preset.name} (${preset.state}). Suelo: ${geoSettings.soilLabelEs}.`,
              `Seismic Simulator linked to ${preset.name} (${preset.state}). Soil: ${geoSettings.soilLabelEn}.`
            )
          )
        }
      }
    },
    [handleDockTabChange, current.solar, handleSolarChange, notify, t]
  )

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
      ...(changed ? { solar: { ...activeCopy.solar, enabled: false, rasterPreviewUrl: null, rasterBounds: null,
        simulationResult: null, analysisResult: null, contours: null } } : {}),
      ...(changed && previousFlood ? {
        flood: { ...previousFlood, enabled: false, rasterUrl: null, rasterBounds: null,
          stats: null, charts: null, resultRoiKey: undefined, compareMode: false },
      } : {}),
      fechaModificacion: new Date().toISOString(),
    })
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

  const handleDuplicateWithHeatmap = useCallback(() => {
    if (!current.effectiveRoi && !current.croppedRegion) {
      notify('error', t('Selecciona primero una ROI para generar la copia con mapa de calor.', 'Select an ROI first to generate a heatmap copy.'))
      return
    }
    const baseTitle = current.nombre.replace(/^(Copia \d+|Análisis|Mapa de Calor|Agua DG2|Sismo)\s*-\s*/i, '').trim() || 'ROI'
    const newCopy: WorkspaceMap = {
      ...current,
      id: newId(),
      nombre: `Mapa de Calor - ${baseTitle}`,
      carpeta: 'Mis Análisis',
      esEditable: true,
      opacidadSar: 72,
      solar: { ...current.solar, enabled: false },
      fechaModificacion: new Date().toISOString(),
    }
    addMap(newCopy)
    setActiveCopyId(newCopy.id)
    setViewMode('editado')
    handleDockTabChange('map')
    notify('success', t(`Copia con Mapa de Calor creada: "${newCopy.nombre}".`, `Heatmap copy created: "${newCopy.nombre}".`))
  }, [current, addMap, notify, t, handleDockTabChange])

  const handleDuplicateForWater = useCallback(() => {
    if (!current.effectiveRoi && !current.croppedRegion) {
      notify('error', t('Selecciona primero una ROI para generar la copia de simulación de agua.', 'Select an ROI first to generate a water simulation copy.'))
      return
    }
    const baseTitle = current.nombre.replace(/^(Copia \d+|Análisis|Mapa de Calor|Agua DG2|Sismo)\s*-\s*/i, '').trim() || 'ROI'
    const newCopy: WorkspaceMap = {
      ...current,
      id: newId(),
      nombre: `Agua DG2 - ${baseTitle}`,
      carpeta: 'Zonas de Riesgo',
      esEditable: true,
      opacidadSar: 0,
      solar: { ...current.solar, enabled: false },
      flood: {
        ...(current.flood || DEFAULT_FLOOD),
        enabled: true,
        compareMode: false,
      },
      fechaModificacion: new Date().toISOString(),
    }
    addMap(newCopy)
    setActiveCopyId(newCopy.id)
    setViewMode('editado')
    handleDockTabChange('rain-dg2')
    notify('success', t(`Copia limpia para Simulación de Agua creada: "${newCopy.nombre}" (sin mapa de calor).`, `Clean copy for Water Simulation created: "${newCopy.nombre}" (without heatmap).`))
  }, [current, addMap, notify, t, handleDockTabChange])

  const handleDuplicateForSeismic = useCallback(() => {
    if (!current.effectiveRoi && !current.croppedRegion) {
      notify('error', t('Selecciona primero una ROI para generar la copia sísmica.', 'Select an ROI first to generate a seismic copy.'))
      return
    }
    const baseTitle = current.nombre.replace(/^(Copia \d+|Análisis|Mapa de Calor|Agua DG2|Sismo)\s*-\s*/i, '').trim() || 'ROI'
    const newCopy: WorkspaceMap = {
      ...current,
      id: newId(),
      nombre: `Sismo - ${baseTitle}`,
      carpeta: 'Zonas de Riesgo',
      esEditable: true,
      opacidadSar: 0,
      solar: { ...current.solar, enabled: false },
      // Escenario sísmico nuevo en la ROI de la copia, sin heredar el de otro mapa.
      seismic: {
        ...newSeismicScenario(regionCenter(current.effectiveRoi, current.croppedRegion, current.centro), `Sismo - ${baseTitle}`),
        enabled: true,
      },
      fechaModificacion: new Date().toISOString(),
    }
    addMap(newCopy)
    setActiveCopyId(newCopy.id)
    setViewMode('editado')
    handleDockTabChange('seismic')
    notify('success', t(`Copia limpia para Simulación Sísmica creada: "${newCopy.nombre}" (sin mapa de calor).`, `Clean copy for Seismic Simulation created: "${newCopy.nombre}" (without heatmap).`))
  }, [current, addMap, notify, t, handleDockTabChange])

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
  const closeTerrain3D = useCallback(() => setTerrainBBox(null), [])

  const handleOpenTerrain3D = () => {
    if (terrainBBox) { setTerrainBBox(null); return }
    const bbox = bboxFromGeometry(confirmedROI)
    if (!bbox) {
      notify('error', localizeText('Selecciona primero una ROI para ver su relieve 3D.'))
      return
    }
    if (bbox[2] - bbox[0] > TERRAIN3D_MAX_DEG || bbox[3] - bbox[1] > TERRAIN3D_MAX_DEG) {
      notify('error', localizeText('La ROI es demasiado grande para el relieve 3D (máximo 3° por lado).'))
      return
    }
    setTerrainBBox(bbox)
  }

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
        dateViewMode={confirmedROI && ((dateViewMode === 'swipe' && !roiLayers.comparable) || (dateViewMode === 'change' && !roiLayers.change) || (dateViewMode === 't2' && !roiLayers.manifests[1])) ? 't1' : dateViewMode}
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
        onDuplicateWithHeatmap={handleDuplicateWithHeatmap}
        onDuplicateForWater={handleDuplicateForWater}
        onDuplicateForSeismic={handleDuplicateForSeismic}
        onOpenTeamPage={() => setTeamPageOpen(true)}
        onOpenTerrain3D={handleOpenTerrain3D}
        terrain3DOpen={terrainBBox !== null}
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
          onSelectPresetROI={handleSelectPresetROI}
          onOpenSimulation={handleOpenSimulation}
          onConfirmLocationROI={(geometry, metadata) => {
            setGcovFootprint(null)
            const isOriginalAdmin = metadata.generation === 'administrative_original' || metadata.generation === 'administrative_bbox'
            const cropRing = isOriginalAdmin ? geometryToOuterRing(geometry) : automaticCropRing(geometry)
            if (!activeCopy) {
              const newCopy: WorkspaceMap = {
                ...current,
                id: newId(),
                nombre: `Análisis - ${metadata.name || 'ROI'}`,
                carpeta: 'Mis Análisis',
                esEditable: true,
                fechaModificacion: new Date().toISOString(),
                opacidadSar: 0,
                croppedRegion: cropRing,
                effectiveRoi: geometry,
                effectiveRoiMetadata: metadata,
                solar: { ...DEFAULT_SOLAR, enabled: false },
                flood: { ...DEFAULT_FLOOD, enabled: false },
              }
              addMap(newCopy)
              setActiveCopyId(newCopy.id)
              setViewMode('editado')
              notify('success', t('Mapa de análisis creado y ROI confirmada.', 'Analysis map created and ROI confirmed.'))
              return true
            }
            updateMap(activeCopy.id, {
              effectiveRoi: geometry, effectiveRoiMetadata: metadata,
              croppedRegion: cropRing,
              opacidadSar: 0,
              solar: { ...activeCopy.solar, enabled: false, rasterPreviewUrl: null, rasterBounds: null,
                simulationResult: null, analysisResult: null, contours: null },
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
          dateViewMode={confirmedROI && ((dateViewMode === 'swipe' && !roiLayers.comparable) || (dateViewMode === 'change' && !roiLayers.change) || (dateViewMode === 't2' && !roiLayers.manifests[1])) ? 't1' : dateViewMode}
          colormapId={colormapId}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onViewChange={handleViewChange}
          onAnnotationsChange={handleAnnotationsChange}
          onCropRegionChange={handleCropRegionChange}
          onSolarChange={handleSolarChange}
          onFloodChange={handleFloodChange}
          seismic={currentSeismic}
          onSeismicChange={handleSeismicChange}
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
          onSelectPresetROI={handleSelectPresetROI}
          onDuplicateWithHeatmap={handleDuplicateWithHeatmap}
          onDuplicateForWater={handleDuplicateForWater}
          onDuplicateForSeismic={handleDuplicateForSeismic}
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
      {terrainBBox && (
        <Suspense fallback={<div className="terrain3d-overlay"><div className="terrain3d-status">{t('Cargando visor 3D…', 'Loading 3D viewer…')}</div></div>}>
          <Terrain3DViewer
            key={terrainBBox.join(',')}
            bbox={terrainBBox}
            roiName={current.effectiveRoiMetadata?.name || current.nombre}
            onClose={closeTerrain3D}
          />
        </Suspense>
      )}
      <Toast message={toast} onClose={closeToast} />

    </div>
  )
}

export default App
