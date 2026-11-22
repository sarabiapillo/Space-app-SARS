import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  GeoJSONSource,
  ImageSource,
  Map as MapLibreMap,
  MapMouseEvent,
  NavigationControl,
  ScaleControl,
  type StyleSpecification,
} from 'maplibre-gl'
import {
  Activity,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Crosshair,
  Download,
  Droplets,
  Flame,
  GripHorizontal,
  Hand,
  Monitor,
  Pencil,
  PencilRuler,
  Pentagon,
  Plus,
  Tag,
  Terminal,
  Trash,
  Undo2,
  X,
} from 'lucide-react'
import {
  DEFAULT_FLOOD,
  DEFAULT_SEISMIC,
  DANGER_CIRCLE_DEFAULT_LABEL,
  DANGER_CIRCLE_TOOLTIP,
  EXPLORE_LAYER_OPTIONS,
  WARN_CIRCLE_DEFAULT_LABEL,
  WARN_CIRCLE_TOOLTIP,
  type ExploreDateViewMode,
  type ExploreLayerId,
} from '../mocks/initialWorkspaces'
import { fetchExploreManifest, verifyExploreScaleMatch, type ExploreWebManifest } from '../api/client'
import { useRoiLayers } from '../hooks/useRoiLayers'
import { FloodDepthLegend } from './FloodDepthLegend'
import { RainOverlay } from './flood/RainOverlay'
import type { FloodMapAnimation } from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation.ts'
import { translate as tr, localizeText as localizeMapText, getLanguage } from '../i18n/core.ts'
import { geometryBounds, rectangleFromCorners, type AdministrativeGeometry } from '../utils/roi'
import {
  colorizePngWithLut,
  getColormapSpec,
  type ScientificColormapId,
} from '../utils/colormapLut'
import { RainDg2Panel } from './RainDg2Panel'
import { RightPanel } from './RightPanel'
import { SeismicSimulatorPanel } from './SeismicSimulatorPanel'
import { runSeismicSimulation } from '../utils/seismic'
import type {
  DockWindow,
  DockWindowKind,
  DrawTool,
  EscenaNisar,
  FloodSimulationState,
  LngLat,
  MapAnnotation,
  MapView,
  SeismicSimulationState,
  SolarSimulationState,
} from '../types/workspace'
import {
  buildAnnotationsGeoJSON,
  buildDraftPolygonGeoJSON,
  buildInverseCropMaskGeoJSON,
  buildInverseEffectiveRoiMaskGeoJSON,
  createCirclePolygonCoords,
  distanceKm,
  getPolygonBoundsAndCentroid,
  interpolateThermalHighlight,
} from '../utils/geojson'
import { newId } from '../utils/id'
import type { ToastKind } from './Toast'
import { readyRoiToastKey } from '../utils/toastTimer'
import type { RoiGeometry } from '../utils/roi'
import type { CatalogRoiPreset } from '../utils/roiCatalog'

interface MapCanvasProps {
  roiLayers: ReturnType<typeof useRoiLayers>
  view: MapView
  viewKey: string
  opacity: number
  isEditing: boolean
  activeMapName: string | null
  escena: EscenaNisar
  annotations: MapAnnotation[]
  croppedRegion: LngLat[] | null
  effectiveRoi?: RoiGeometry | null
  solar: SolarSimulationState
  flood?: FloodSimulationState
  exploreLayerId: ExploreLayerId
  dateViewMode: ExploreDateViewMode
  colormapId: ScientificColormapId
  activeTool: DrawTool
  onSelectTool: (tool: DrawTool) => void
  onViewChange?: (view: MapView, info: { userInitiated: boolean }) => void
  onAnnotationsChange: (next: MapAnnotation[]) => void
  onCropRegionChange: (polygon: LngLat[] | null) => void
  onSolarChange: (next: SolarSimulationState) => void
  onFloodChange?: (next: FloodSimulationState) => void
  seismic?: SeismicSimulationState
  onSeismicChange?: (next: SeismicSimulationState) => void
  /** Ventanas acoplables del área central (mapa o agua/DG2) y su ventana activa. */
  dockWindows: DockWindow[]
  activeDockWindowId: string
  onActivateDockWindow: (id: string) => void
  onCloseDockWindow: (id: string) => void
  onOpenDockWindow: (kind: DockWindowKind) => void
  floatingToolsOpen: boolean
  onToggleFloatingTools: () => void
  isCaptureMode: boolean
  onStartCaptureMode: () => void
  onCancelCaptureMode: () => void
  locationPreview?: AdministrativeGeometry | null
  gcovFootprint?: unknown | null
  onNotify: (kind: ToastKind, text: string) => void
  onSelectPresetROI?: (preset: CatalogRoiPreset) => void
  onDuplicateWithHeatmap?: () => void
  onDuplicateForWater?: () => void
  onDuplicateForSeismic?: () => void
}

interface ViewportMetrics {
  centro: LngLat
  zoom: number
  width: number
  height: number
}

// Identificadores de fuentes y capas en MapLibre GL
const NISAR_SOURCE = 'nisar-radar'
const NISAR_LAYER = 'nisar-layer'
const FOOTPRINT_SOURCE = 'nisar-footprint'
const FOOTPRINT_FILL_LAYER = 'nisar-footprint-fill'
const FOOTPRINT_LINE_LAYER = 'nisar-footprint-line'

const DEM_SOURCE = 'terrain-dem'
const SOLAR_THERMAL_LAYER = 'solar-thermal-layer'

const CROP_MASK_SOURCE = 'crop-mask-source'
const CROP_MASK_FILL_LAYER = 'crop-mask-fill'
const CROP_MASK_LINE_LAYER = 'crop-mask-line'
const FLOOD_FLOW_SOURCE = 'flood-flow-arrows-source'
const FLOOD_FLOW_LAYER = 'flood-flow-arrows-layer'
const FLOOD_FLOW_ICON = 'flood-flow-arrow'
// One image source + raster layer per preloaded animation frame: changing frame only changes opacities.
const FLOOD_ANIM_PREFIX = 'flood-anim-frame-'

/** North-pointing arrow icon (white with dark outline); the layer rotates it by each arrow's bearing. */
function flowArrowIcon(): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(24, 3)
  ctx.lineTo(39, 22)
  ctx.lineTo(29, 22)
  ctx.lineTo(29, 45)
  ctx.lineTo(19, 45)
  ctx.lineTo(19, 22)
  ctx.lineTo(9, 22)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#0b2540'
  ctx.stroke()
  const { data } = ctx.getImageData(0, 0, size, size)
  return { width: size, height: size, data }
}

const ANNOTATIONS_SOURCE = 'annotations-source'
const ANN_DANGER_FILL_LAYER = 'annotations-danger-fill'
const ANN_DANGER_LINE_LAYER = 'annotations-danger-line'
const ANN_WARN_FILL_LAYER = 'annotations-warn-fill'
const ANN_WARN_LINE_LAYER = 'annotations-warn-line'
const ANN_FREEHAND_LINE_LAYER = 'annotations-freehand-line'

const DRAFT_POLY_SOURCE = 'draft-polygon-source'
const DRAFT_POLY_FILL_LAYER = 'draft-polygon-fill'
const DRAFT_POLY_LINE_LAYER = 'draft-polygon-line'
const DRAFT_POLY_VERTEX_LAYER = 'draft-polygon-vertex'

const CONFIRMED_ROI_SOURCE = 'confirmed-roi-source'
const LOCATION_PREVIEW_SOURCE = 'location-preview-source'
const GCOV_PREVIEW_SOURCE = 'gcov-preview-source'
const SEISMIC_SOURCE = 'seismic-source'

const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [
    {
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
}

function mercatorX(lng: number, worldSize: number): number {
  return ((lng + 180) / 360) * worldSize
}

function mercatorY(lat: number, worldSize: number): number {
  const rad = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * worldSize
}

function projectLngLat(coord: LngLat, vp: ViewportMetrics): [number, number] {
  const worldSize = 512 * Math.pow(2, vp.zoom)
  const cx = mercatorX(vp.centro[0], worldSize)
  const cy = mercatorY(vp.centro[1], worldSize)
  const x = vp.width / 2 + (mercatorX(coord[0], worldSize) - cx)
  const y = vp.height / 2 + (mercatorY(coord[1], worldSize) - cy)
  return [x, y]
}

function radiusKmForScreenPixels(targetRadiusPx: number, latDeg: number, zoom: number): number {
  const latRad = (latDeg * Math.PI) / 180
  const kmPerPixel = (40075.017 * Math.max(0.2, Math.cos(latRad))) / (512 * Math.pow(2, zoom))
  return Number(Math.max(0.015, targetRadiusPx * kmPerPixel).toFixed(4))
}

function sameView(a: MapView, b: MapView): boolean {
  return (
    Math.abs(a.centro[0] - b.centro[0]) < 1e-6 &&
    Math.abs(a.centro[1] - b.centro[1]) < 1e-6 &&
    Math.abs(a.zoom - b.zoom) < 1e-3
  )
}

function computeHillshadeParams(solar: SolarSimulationState): {
  direction: number
  exaggeration: number
  highlightColor: string
} {
  const direction = Math.round(90 + (solar.sunAngle / 180) * 180)
  const elevationFactor = 0.38 + 0.62 * Math.sin((solar.sunAngle * Math.PI) / 180)
  const exaggeration = solar.enabled
    ? Number(Math.min(0.85, (solar.radiationIntensity / 100) * 0.85 * elevationFactor).toFixed(3))
    : 0
  const highlightColor = interpolateThermalHighlight(solar.radiationIntensity)
  return { direction, exaggeration, highlightColor }
}

/** Obtiene la coordenada representativa de una anotación para anclar su menú de acciones. */
function getAnnotationAnchorCoord(ann: MapAnnotation): LngLat {
  if (ann.kind === 'lapiz') {
    const midIdx = Math.floor(ann.points.length / 2)
    return ann.points[midIdx] ?? ann.points[0] ?? [0, 0]
  }
  if (ann.kind === 'etiqueta') {
    return ann.position
  }
  return [ann.center[0], ann.center[1] + ann.radiusKm / 110.574]
}

export function MapCanvas({
  roiLayers,
  view,
  viewKey,
  opacity,
  isEditing,
  activeMapName,
  escena,
  annotations,
  croppedRegion,
  effectiveRoi = null,
  solar,
  flood,
  exploreLayerId,
  dateViewMode,
  colormapId,
  activeTool,
  onSelectTool,
  onViewChange,
  onAnnotationsChange,
  onCropRegionChange,
  onSolarChange,
  onFloodChange,
  seismic,
  onSeismicChange,
  dockWindows,
  activeDockWindowId,
  onActivateDockWindow,
  onCloseDockWindow,
  onOpenDockWindow,
  floatingToolsOpen,
  onToggleFloatingTools,
  isCaptureMode,
  onStartCaptureMode,
  onCancelCaptureMode,
  locationPreview = null,
  gcovFootprint = null,
  onNotify,
  onSelectPresetROI,
  onDuplicateWithHeatmap,
  onDuplicateForWater,
  onDuplicateForSeismic,
}: MapCanvasProps) {
  const { t, localizeText, language, locale } = useTranslation()
  const displayDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
    : localizeText(value)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapStageRef = useRef<HTMLDivElement>(null)
  const svgOverlayRef = useRef<SVGSVGElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const navigationRef = useRef<NavigationControl | null>(null)

  const activeDockWindow = dockWindows.find((w) => w.id === activeDockWindowId) ?? dockWindows[0]
  const isDg2 = activeDockWindow?.kind === 'agua'
  const isSeismic = activeDockWindow?.kind === 'sismo' || Boolean(seismic?.enabled)
  useEffect(() => {
    const nav = navigationRef.current
    if (!nav) return
    for (const [button, label] of [[nav._zoomInButton, language === 'en' ? 'Zoom in' : 'Acercar'], [nav._zoomOutButton, language === 'en' ? 'Zoom out' : 'Alejar']] as const) {
      button.title = label
      button.setAttribute('aria-label', label)
    }
    // MapLibre has no public live locale setter; update only its own attribution toggle.
    const attribution = mapRef.current?.getContainer().querySelector<HTMLButtonElement>('.maplibregl-ctrl-attrib-button')
    if (attribution) {
      const label = language === 'en' ? 'Toggle attribution' : 'Mostrar u ocultar atribución'
      attribution.title = label
      attribution.setAttribute('aria-label', label)
    }
  }, [language, mapReady])
  const [viewport, setViewport] = useState<ViewportMetrics>({
    centro: view.centro,
    zoom: view.zoom,
    width: 960,
    height: 640,
  })
  const [croppedScreenPts, setCroppedScreenPts] = useState<[number, number][] | null>(null)
  const notifiedRoiKey = useRef<string | null>(null)
  const notifiedMissingLayerKey = useRef<string | null>(null)
  const hasAnalysisRoi = Boolean(effectiveRoi || croppedRegion)
  const roiReady = Boolean(hasAnalysisRoi && !roiLayers.loading && !roiLayers.error && roiLayers.manifests.length)
  useEffect(() => {
    if (!hasAnalysisRoi) return
    const key = readyRoiToastKey(notifiedRoiKey.current, roiLayers.key, roiLayers.loading, Boolean(roiLayers.error), roiLayers.manifests.length)
    if (!key) return
    notifiedRoiKey.current = key
    const dates = roiLayers.manifests.map(manifest => manifest.escena.fecha_inicio?.slice(0, 10)).join(' → ')
    onNotify('success', `${localizeMapText(roiLayers.message)} ${dates}`)
  }, [hasAnalysisRoi, roiLayers.key, roiLayers.loading, roiLayers.error, roiLayers.manifests, roiLayers.message, onNotify])

  // Estado del cuadro flotante arrastrable de herramientas de dibujo
  const [toolboxPos, setToolboxPos] = useState<{ x: number; y: number }>({ x: 14, y: 14 })
  const [toolboxCollapsed, setToolboxCollapsed] = useState(true)
  // Menú del botón «+» para agregar ventanas al área central
  const [newWindowMenuOpen, setNewWindowMenuOpen] = useState(false)
  const toolboxDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [isDraggingToolbox, setIsDraggingToolbox] = useState(false)

  const activeFlood = flood || DEFAULT_FLOOD
  const hasCurrentFloodResult = Boolean(croppedRegion && activeFlood.resultRoiKey === JSON.stringify(croppedRegion))

  // Estado de captura de región (PNG / JPG)
  const [captureDragStart, setCaptureDragStart] = useState<{ x: number; y: number } | null>(null)
  const [captureRect, setCaptureRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [captureModal, setCaptureModal] = useState<{
    canvas: HTMLCanvasElement
    previewUrl: string
    width: number
    height: number
    format: 'png' | 'jpeg'
    quality: number
    filename: string
  } | null>(null)

  const [swipePct, setSwipePct] = useState<number>(50)
  const [isDraggingSwipe, setIsDraggingSwipe] = useState(false)
  const [isDraggingFloodSwipe, setIsDraggingFloodSwipe] = useState(false)
  // DG2 animation (set by the panel): preloaded frames, frame shown, cross-fade, its arrows and the rain at that time.
  const [floodAnimation, setFloodAnimation] = useState<FloodMapAnimation | null>(null)
  // Live frames of a run in progress are shown before any result exists for the ROI (the panel scopes them to it).
  const floodAnimating = Boolean(floodAnimation && (hasCurrentFloodResult || floodAnimation.live))
  const floodAnimationLayers = useRef<{ layers: Array<{ id: string; url: string }>; shown: number | null; opacity: number; visible: boolean } | null>(null)
  // Corners of the animated domain projected on the map (px), keyed by its bounds: the rain is drawn inside them.
  const floodAnimationBoundsKey = floodAnimating ? floodAnimation!.frames[floodAnimation!.index]?.bounds.join(',') ?? '' : ''
  const [floodRainArea, setFloodRainArea] = useState<{ key: string; points: Array<[number, number]> } | null>(null)
  const floodRainPoints = floodRainArea && floodRainArea.key === floodAnimationBoundsKey ? floodRainArea.points : null
  const [sceneManifestT1, setSceneManifestT1] = useState<ExploreWebManifest | null>(null)
  const [sceneManifestT2, setSceneManifestT2] = useState<ExploreWebManifest | null>(null)

  useEffect(() => {
    let cancelled = false
    const t1Id = escena.t1SceneId || escena.granuleId
    const t2Id = escena.t2SceneId
    Promise.all([
      t1Id ? fetchExploreManifest(t1Id) : Promise.resolve(null),
      t2Id ? fetchExploreManifest(t2Id) : Promise.resolve(null),
    ]).then(([m1, m2]) => {
      if (cancelled) return
      setSceneManifestT1(m1)
      setSceneManifestT2(m2)
    }).catch(() => {
      if (!cancelled) {
        setSceneManifestT1(null)
        setSceneManifestT2(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [escena.granuleId, escena.t1SceneId, escena.t2SceneId])

  const manifestT1 = (roiReady && roiLayers.manifests[0]) ? roiLayers.manifests[0] : sceneManifestT1
  const manifestT2 = (roiReady && roiLayers.manifests[1]) ? roiLayers.manifests[1] : sceneManifestT2
  const [geometryInput, setGeometryInput] = useState('')
  const [geometryError, setGeometryError] = useState<string | null>(null)
  const [colorizedT1Url, setColorizedT1Url] = useState<string>('')
  const [colorizedT2Url, setColorizedT2Url] = useState<string>('')
  const [colorizedKey, setColorizedKey] = useState('')
  const [logPanelCollapsed, setLogPanelCollapsed] = useState(false)
  const [logActiveTab, setLogActiveTab] = useState<'trace' | 'layers' | 'warnings'>('trace')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [draftFreehand, setDraftFreehand] = useState<LngLat[]>([])
  const [draftCircle, setDraftCircle] = useState<{
    kind: 'peligro' | 'advertencia'
    center: LngLat
    radiusKm: number
  } | null>(null)
  const [draftPolygon, setDraftPolygon] = useState<LngLat[]>([])

  const [labelEditor, setLabelEditor] = useState<{
    coord: LngLat
    text: string
    targetAnnotationId: string | null
  } | null>(null)

  // Anotación seleccionada activa (si fue borrada o se cambió de mapa, es `null`)
  const selectedAnnotation =
    isEditing && selectedAnnotationId
      ? (annotations.find((a) => a.id === selectedAnnotationId) ?? null)
      : null

  const viewRef = useRef(view)
  const opacityRef = useRef(opacity)
  const isEditingRef = useRef(isEditing)
  const activeToolRef = useRef(activeTool)
  const annotationsRef = useRef(annotations)
  const croppedRegionRef = useRef(croppedRegion)
  const solarRef = useRef(solar)
  const draftFreehandRef = useRef<LngLat[]>([])
  const draftCircleRef = useRef<{
    kind: 'peligro' | 'advertencia'
    center: LngLat
    radiusKm: number
  } | null>(null)
  const isPointerDownRef = useRef(false)
  const onViewChangeRef = useRef(onViewChange)
  const onAnnotationsChangeRef = useRef(onAnnotationsChange)
  const lastKeyRef = useRef(viewKey)

  useEffect(() => {
    viewRef.current = view
    opacityRef.current = opacity
    isEditingRef.current = isEditing
    activeToolRef.current = activeTool
    annotationsRef.current = annotations
    croppedRegionRef.current = croppedRegion
    solarRef.current = solar
    onViewChangeRef.current = onViewChange
    onAnnotationsChangeRef.current = onAnnotationsChange
  })

  // Eliminar una anotación por su ID y limpiar selección
  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      onAnnotationsChange(annotations.filter((a) => a.id !== id))
      setSelectedAnnotationId((prev) => (prev === id ? null : prev))
      setLabelEditor((prev) => (prev?.targetAnnotationId === id ? null : prev))
    },
    [annotations, onAnnotationsChange],
  )

  // Atajos de teclado: Delete / Backspace para eliminar el seleccionado, Escape para deseleccionar
  useEffect(() => {
    if (!isEditing || !selectedAnnotation) return

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleDeleteAnnotation(selectedAnnotation.id)
      } else if (e.key === 'Escape') {
        setSelectedAnnotationId(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEditing, selectedAnnotation, handleDeleteAnnotation])

  // Inicialización de MapLibre GL
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const initial = viewRef.current
    const map = new MapLibreMap({
      container,
      style: BASE_STYLE,
      center: initial.centro,
      zoom: initial.zoom,
      attributionControl: { compact: true },
      locale: getLanguage() === 'en' ? { 'NavigationControl.ZoomIn': 'Zoom in', 'NavigationControl.ZoomOut': 'Zoom out', 'AttributionControl.ToggleAttribution': 'Toggle attribution' } : { 'NavigationControl.ZoomIn': 'Acercar', 'NavigationControl.ZoomOut': 'Alejar', 'AttributionControl.ToggleAttribution': 'Mostrar u ocultar atribución' },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapRef.current = map

    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left')
    const navigation = new NavigationControl({ showCompass: false })
    map.addControl(navigation, 'bottom-left')
    navigationRef.current = navigation

    const syncViewport = () => {
      const c = map.getCenter()
      const canvas = map.getCanvas()
      setViewport({
        centro: [c.lng, c.lat],
        zoom: map.getZoom(),
        width: canvas.clientWidth || container.clientWidth || 960,
        height: canvas.clientHeight || container.clientHeight || 640,
      })
    }

    const rafId = window.requestAnimationFrame(() => {
      map.resize()
      syncViewport()
    })

    const resizeObserver = new ResizeObserver(() => {
      map.resize()
      syncViewport()
    })
    resizeObserver.observe(container)

    map.on('move', syncViewport)
    map.on('zoom', syncViewport)
    map.on('rotate', syncViewport)
    map.on('pitch', syncViewport)
    map.on('resize', syncViewport)

    let lastView: MapView = initial
    map.on('moveend', (e) => {
      const c = map.getCenter()
      const current: MapView = { centro: [c.lng, c.lat], zoom: map.getZoom() }
      const programmatic = (e as { programmatic?: boolean }).programmatic === true
      if (!programmatic && sameView(current, lastView)) return
      lastView = current
      onViewChangeRef.current?.(current, { userInitiated: !programmatic })
    })

    const onMouseDown = (e: MapMouseEvent) => {
      if (!isEditingRef.current) return
      const tool = activeToolRef.current
      const coord: LngLat = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]

      if (tool === 'lapiz') {
        e.preventDefault()
        setSelectedAnnotationId(null)
        isPointerDownRef.current = true
        draftFreehandRef.current = [coord]
        setDraftFreehand([coord])
      } else if (tool === 'peligro' || tool === 'advertencia') {
        e.preventDefault()
        setSelectedAnnotationId(null)
        isPointerDownRef.current = true
        const smartRadiusKm = radiusKmForScreenPixels(70, coord[1], map.getZoom())
        const circle = { kind: tool, center: coord, radiusKm: smartRadiusKm }
        draftCircleRef.current = circle
        setDraftCircle(circle)
      }
    }

    const onMouseMove = (e: MapMouseEvent) => {
      if (!isEditingRef.current || !isPointerDownRef.current) return
      const tool = activeToolRef.current
      const coord: LngLat = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]

      if (tool === 'lapiz' && draftFreehandRef.current.length > 0) {
        const nextPts = [...draftFreehandRef.current, coord]
        draftFreehandRef.current = nextPts
        setDraftFreehand(nextPts)
      } else if ((tool === 'peligro' || tool === 'advertencia') && draftCircleRef.current) {
        const dist = distanceKm(draftCircleRef.current.center, coord)
        const minDragKm = radiusKmForScreenPixels(
          12,
          draftCircleRef.current.center[1],
          map.getZoom(),
        )
        if (dist > minDragKm) {
          const updated = {
            ...draftCircleRef.current,
            radiusKm: Number(dist.toFixed(4)),
          }
          draftCircleRef.current = updated
          setDraftCircle(updated)
        }
      }
    }

    const finishPointerStroke = () => {
      if (!isPointerDownRef.current) return
      isPointerDownRef.current = false
      const tool = activeToolRef.current

      if (tool === 'lapiz' && draftFreehandRef.current.length >= 2) {
        const nextAnn: MapAnnotation = {
          id: newId(),
          kind: 'lapiz',
          points: draftFreehandRef.current,
        }
        onAnnotationsChangeRef.current([...annotationsRef.current, nextAnn])
        setSelectedAnnotationId(nextAnn.id)
      } else if ((tool === 'peligro' || tool === 'advertencia') && draftCircleRef.current) {
        const c = draftCircleRef.current
        const nextAnn: MapAnnotation = {
          id: newId(),
          kind: c.kind,
          center: c.center,
          radiusKm: c.radiusKm,
          label:
            c.kind === 'peligro' ? DANGER_CIRCLE_DEFAULT_LABEL : WARN_CIRCLE_DEFAULT_LABEL,
        }
        onAnnotationsChangeRef.current([...annotationsRef.current, nextAnn])
        setSelectedAnnotationId(nextAnn.id)
      }

      draftFreehandRef.current = []
      draftCircleRef.current = null
      setDraftFreehand([])
      setDraftCircle(null)
    }

    const onMapClick = (e: MapMouseEvent) => {
      if (!isEditingRef.current) return
      const tool = activeToolRef.current
      const coord: LngLat = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]

      if (tool === 'mover') {
        setSelectedAnnotationId(null)
      } else if (tool === 'poligono') {
        setSelectedAnnotationId(null)
        setDraftPolygon((prev) => {
          if (prev.length !== 1) return [coord]
          try {
            const rectangle = rectangleFromCorners(prev[0], coord)
            setGeometryError(null)
            return rectangle
          } catch (error) {
            setGeometryError((error as Error).message)
            return prev
          }
        })
      } else if (tool === 'etiqueta') {
        const clickToleranceKm = radiusKmForScreenPixels(24, coord[1], map.getZoom())
        const hit = [...annotationsRef.current].reverse().find((ann) => {
          if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
            return distanceKm(coord, ann.center) <= Math.max(ann.radiusKm, clickToleranceKm)
          }
          if (ann.kind === 'etiqueta') {
            return distanceKm(coord, ann.position) <= clickToleranceKm
          }
          return false
        })

        if (hit && (hit.kind === 'peligro' || hit.kind === 'advertencia')) {
          setSelectedAnnotationId(hit.id)
          setLabelEditor({
            coord: hit.center,
            text: hit.label,
            targetAnnotationId: hit.id,
          })
        } else if (hit && hit.kind === 'etiqueta') {
          setSelectedAnnotationId(hit.id)
          setLabelEditor({
            coord: hit.position,
            text: hit.text,
            targetAnnotationId: hit.id,
          })
        } else {
          setLabelEditor({
            coord,
            text: tr('Zona de interés', 'Region of interest'),
            targetAnnotationId: null,
          })
        }
      }

      if (isSeismic && tool === 'mover') {
        onSeismicChange?.({
          ...(seismic || DEFAULT_SEISMIC),
          enabled: true,
          epicenter: coord,
        })
      }
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', finishPointerStroke)
    map.on('click', onMapClick)

    let cancelled = false
    let layersInitialized = false

    const initMapLayers = () => {
      if (cancelled || layersInitialized) return
      layersInitialized = true
      map.resize()
      syncViewport()

      const alpha = opacityRef.current / 100

      // A. Huella y raster se incorporan únicamente desde manifests de una ROI confirmada.
      try {
        if (!map.getSource(FOOTPRINT_SOURCE)) {
          map.addSource(FOOTPRINT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
          map.addLayer({
            id: FOOTPRINT_FILL_LAYER,
            type: 'fill',
            source: FOOTPRINT_SOURCE,
            paint: {
              'fill-color': '#3399FF',
              'fill-opacity': alpha * 0.05,
            },
          })
          map.addLayer({
            id: FOOTPRINT_LINE_LAYER,
            type: 'line',
            source: FOOTPRINT_SOURCE,
            paint: {
              'line-color': '#3399FF',
              'line-width': 1.8,
              'line-opacity': 0.9,
              'line-dasharray': [3, 2],
            },
          })
        }

        // La fuente raster se crea en el efecto de manifiestos de ROI, nunca como vista por defecto.
      } catch (err) {
        console.warn('No se pudo inicializar la capa NISAR:', err)
      }

      // B. Fuente `terrain-dem` y capa `solar-thermal-layer` (Inferno)
      try {
        if (!map.getSource(DEM_SOURCE)) {
          const hs = computeHillshadeParams(solarRef.current)
          map.addSource(DEM_SOURCE, {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
          })
          map.addLayer({
            id: SOLAR_THERMAL_LAYER,
            type: 'hillshade',
            source: DEM_SOURCE,
            paint: {
              'hillshade-illumination-anchor': 'map',
              'hillshade-illumination-direction': hs.direction,
              'hillshade-exaggeration': hs.exaggeration,
              'hillshade-highlight-color': hs.highlightColor,
              'hillshade-accent-color': '#DD513A',
              'hillshade-shadow-color': '#420A68',
            },
          })
        }
      } catch (err) {
        console.warn('No se pudo inicializar la capa DEM solar:', err)
      }

      // C. Fuente y capas de MÁSCARA INVERSA (`crop-mask-fill`)
      try {
        if (!map.getSource(CROP_MASK_SOURCE)) {
          const initialCrop = croppedRegionRef.current
          const hasCrop = Array.isArray(initialCrop) && initialCrop.length >= 3
          map.addSource(CROP_MASK_SOURCE, {
            type: 'geojson',
            data: buildInverseCropMaskGeoJSON(hasCrop ? initialCrop : null) as never,
          })
          map.addLayer({
            id: CROP_MASK_FILL_LAYER,
            type: 'fill',
            source: CROP_MASK_SOURCE,
            filter: ['==', ['get', 'role'], 'mask'],
            paint: {
              'fill-color': '#CBD5E1',
              'fill-opacity': hasCrop ? 0.65 : 0,
            },
          })
          map.addLayer({
            id: CROP_MASK_LINE_LAYER,
            type: 'line',
            source: CROP_MASK_SOURCE,
            filter: ['==', ['get', 'role'], 'border'],
            paint: {
              'line-color': '#3399FF',
              'line-width': 2.2,
              'line-dasharray': [3, 2],
            },
          })
        }
      } catch (err) {
        console.warn('No se pudo inicializar la máscara de recorte:', err)
      }

      // D. Fuente y capas GeoJSON al tope (`annotations-source`)
      try {
        if (!map.getSource(ANNOTATIONS_SOURCE)) {
          map.addSource(ANNOTATIONS_SOURCE, {
            type: 'geojson',
            data: buildAnnotationsGeoJSON(annotationsRef.current, [], null) as never,
          })

          map.addLayer({
            id: ANN_DANGER_FILL_LAYER,
            type: 'fill',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'peligro'],
            paint: {
              'fill-color': '#DC2626',
              'fill-opacity': 0.24,
            },
          })
          map.addLayer({
            id: ANN_DANGER_LINE_LAYER,
            type: 'line',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'peligro'],
            paint: {
              'line-color': '#DC2626',
              'line-width': 2.5,
            },
          })

          map.addLayer({
            id: ANN_WARN_FILL_LAYER,
            type: 'fill',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'advertencia'],
            paint: {
              'fill-color': '#D97706',
              'fill-opacity': 0.18,
            },
          })
          map.addLayer({
            id: ANN_WARN_LINE_LAYER,
            type: 'line',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'advertencia'],
            paint: {
              'line-color': '#D97706',
              'line-width': 2.5,
              'line-dasharray': [3, 2],
            },
          })

          map.addLayer({
            id: ANN_FREEHAND_LINE_LAYER,
            type: 'line',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'lapiz'],
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': '#3399FF',
              'line-width': 3.5,
            },
          })
        }
      } catch (err) {
        console.warn('No se pudieron inicializar las capas de anotación:', err)
      }

      // E. Fuente y capas para polígono en construcción ("Seleccionar Región")
      try {
        if (!map.getSource(DRAFT_POLY_SOURCE)) {
          map.addSource(DRAFT_POLY_SOURCE, {
            type: 'geojson',
            data: buildDraftPolygonGeoJSON([]) as never,
          })
          map.addLayer({
            id: DRAFT_POLY_FILL_LAYER,
            type: 'fill',
            source: DRAFT_POLY_SOURCE,
            filter: ['==', ['get', 'featureType'], 'fill'],
            paint: {
              'fill-color': '#3399FF',
              'fill-opacity': 0.16,
            },
          })
          map.addLayer({
            id: DRAFT_POLY_LINE_LAYER,
            type: 'line',
            source: DRAFT_POLY_SOURCE,
            filter: ['==', ['get', 'featureType'], 'line'],
            paint: {
              'line-color': '#3399FF',
              'line-width': 2.2,
              'line-dasharray': [3, 2],
            },
          })
          map.addLayer({
            id: DRAFT_POLY_VERTEX_LAYER,
            type: 'circle',
            source: DRAFT_POLY_SOURCE,
            filter: ['==', ['get', 'featureType'], 'vertex'],
            paint: {
              'circle-radius': 5,
              'circle-color': '#FFFFFF',
              'circle-stroke-color': '#3399FF',
              'circle-stroke-width': 2.2,
            },
          })
        }
      } catch (err) {
        console.warn('No se pudo inicializar el borrador de polígono:', err)
      }

      for (const [sourceId, color] of [[CONFIRMED_ROI_SOURCE, '#3399ff'], [LOCATION_PREVIEW_SOURCE, '#facc15'], [GCOV_PREVIEW_SOURCE, '#22d3ee']] as const) {
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
          map.addLayer({ id: `${sourceId}-fill`, type: 'fill', source: sourceId, paint: { 'fill-color': color, 'fill-opacity': 0.12 } })
          map.addLayer({ id: `${sourceId}-line`, type: 'line', source: sourceId, paint: { 'line-color': sourceId === GCOV_PREVIEW_SOURCE ? ['case', ['==', ['get', 'role'], 'intersection'], '#4ade80', color] : color, 'line-width': 2.5, 'line-dasharray': [2, 1] } })
        }
      }

      if (!map.getSource(SEISMIC_SOURCE)) {
        map.addSource(SEISMIC_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: `${SEISMIC_SOURCE}-fill`,
          type: 'fill',
          source: SEISMIC_SOURCE,
          filter: ['!=', ['get', 'isEpicenter'], true],
          paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': 0.35 },
        })
        map.addLayer({
          id: `${SEISMIC_SOURCE}-line`,
          type: 'line',
          source: SEISMIC_SOURCE,
          filter: ['!=', ['get', 'isEpicenter'], true],
          paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] },
        })
        map.addLayer({
          id: `${SEISMIC_SOURCE}-pulse`,
          type: 'circle',
          source: SEISMIC_SOURCE,
          filter: ['==', ['get', 'isEpicenter'], true],
          paint: {
            'circle-radius': 14,
            'circle-color': 'rgba(239, 68, 68, 0.35)',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ef4444',
          },
        })
        map.addLayer({
          id: `${SEISMIC_SOURCE}-epicenter`,
          type: 'circle',
          source: SEISMIC_SOURCE,
          filter: ['==', ['get', 'isEpicenter'], true],
          paint: {
            'circle-radius': 6,
            'circle-color': '#ef4444',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
          },
        })
      }

      setMapReady(true)
    }

    if (map.isStyleLoaded()) {
      initMapLayers()
    } else {
      map.once('style.load', initMapLayers)
      map.once('load', initMapLayers)
    }

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      map.remove()
      navigationRef.current = null
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(LOCATION_PREVIEW_SOURCE) as GeoJSONSource | undefined
    if (!source) return
    source.setData(locationPreview ? { type: 'Feature', properties: {}, geometry: locationPreview } as never : { type: 'FeatureCollection', features: [] })
    if (locationPreview && locationPreview.type !== 'Point') {
      const [west, south, east, north] = geometryBounds(locationPreview)
      map.fitBounds([[west, south], [east, north]], { padding: 100, duration: 500 })
    }
  }, [locationPreview, mapReady])

  useEffect(() => {
    const source = mapRef.current?.getSource(CONFIRMED_ROI_SOURCE) as GeoJSONSource | undefined
    if (source) source.setData(effectiveRoi ? { type: 'Feature', properties: {}, geometry: effectiveRoi } as never : { type: 'FeatureCollection', features: [] })
  }, [effectiveRoi, mapReady])

  useEffect(() => {
    const source = mapRef.current?.getSource(GCOV_PREVIEW_SOURCE) as GeoJSONSource | undefined
    if (source) source.setData(gcovFootprint ? gcovFootprint as never : { type: 'FeatureCollection', features: [] })
  }, [gcovFootprint, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(SEISMIC_SOURCE) as GeoJSONSource | undefined
    if (!source) return

    const activeSeismic = seismic || DEFAULT_SEISMIC
    const shouldShow = isSeismic || Boolean(seismic?.enabled)

    if (shouldShow && activeSeismic) {
      const results = runSeismicSimulation({
        epicenter: activeSeismic.epicenter,
        magnitude: activeSeismic.magnitude,
        depthKm: activeSeismic.depthKm,
        name: activeSeismic.name,
        mechanism: activeSeismic.mechanism,
        soilType: activeSeismic.soilType,
      })

      const ringFeatures = results.rings.map((ring) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [ring.polygon],
        },
        properties: {
          isEpicenter: false,
          level: ring.level,
          color: ring.color,
          fillColor: ring.fillColor,
          mmi: ring.mmi,
          radiusKm: ring.radiusKm,
        },
      }))
      ringFeatures.sort((a, b) => b.properties.radiusKm - a.properties.radiusKm)

      const epicenterFeature = {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: activeSeismic.epicenter,
        },
        properties: {
          isEpicenter: true,
        },
      }

      source.setData({
        type: 'FeatureCollection',
        features: [...ringFeatures, epicenterFeature],
      })
    } else {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      })
    }
  }, [seismic, isSeismic, mapReady])

  const displayScene = hasAnalysisRoi ? {
    ...escena,
    t1: manifestT1?.escena.fecha_inicio?.slice(0, 10) ?? 'Sin datos',
    t2: manifestT2?.escena.fecha_inicio?.slice(0, 10) ?? 'Sin segunda fecha',
    t1SceneId: manifestT1?.escena.granuleId ?? t('Sin datos', 'No data'),
    t2SceneId: manifestT2?.escena.granuleId ?? t('Sin datos', 'No data'),
    crid: manifestT1?.escena.crid ?? t('Sin datos', 'No data'),
    madurez: manifestT1?.escena.madurez_catalogo ?? t('Desconocida', 'Unknown'),
  } : escena

  const activeLayerOption =
    EXPLORE_LAYER_OPTIONS.find((opt) => opt.id === exploreLayerId) ?? EXPLORE_LAYER_OPTIONS[0]

  const layerT1 =
    manifestT1?.capas.find((c) => c.id === exploreLayerId) ?? manifestT1?.capas[0] ?? null
  const layerT2 =
    manifestT2?.capas.find((c) => c.id === exploreLayerId) ?? manifestT2?.capas[0] ?? null
  const layerKey = `${layerT1?.png}|${layerT2?.png}|${colormapId}`
  const imagesReady = colorizedKey === layerKey

  const activeManifest = dateViewMode === 't1' ? manifestT1 : manifestT2
  const activeLayerEntry = dateViewMode === 't1' ? layerT1 : layerT2
  useEffect(() => {
    if (!roiReady || activeLayerEntry) return
    const key = `${roiLayers.key}:${dateViewMode}:${exploreLayerId}`
    if (notifiedMissingLayerKey.current === key) return
    notifiedMissingLayerKey.current = key
    onNotify('error', tr('La capa seleccionada no está disponible. Elige otra polarización o fecha.', 'The selected layer is unavailable. Choose another polarization or acquisition date.'))
  }, [roiReady, activeLayerEntry, roiLayers.key, dateViewMode, exploreLayerId, onNotify])

  const scaleCheck =
    manifestT1 && manifestT2 ? verifyExploreScaleMatch(manifestT1, manifestT2, exploreLayerId) : null

  const activeColormapSpec = getColormapSpec(colormapId)
  const infernoSpec = getColormapSpec('inferno')

  // Colorear dinámicamente los PNG oficiales en EPSG:3857 usando la tabla LUT de 256 colores (Inferno por defecto)
  useEffect(() => {
    let cancelled = false
    Promise.all([
      layerT1 ? colorizePngWithLut(`/${layerT1.png}`, colormapId) : Promise.resolve(''),
      layerT2 ? colorizePngWithLut(`/${layerT2.png}`, colormapId) : Promise.resolve(''),
    ]).then(([u1, u2]) => {
      if (cancelled) return
      setColorizedT1Url(u1)
      setColorizedT2Url(u2)
      setColorizedKey(layerKey)
    })

    return () => {
      cancelled = true
    }
  }, [layerT1, layerT2, colormapId, layerKey])

  const activeColorizedUrl = dateViewMode === 't1' ? colorizedT1Url : colorizedT2Url

  // Conectar slider de opacidad usando `map.setPaintProperty('nisar-layer', 'raster-opacity', opacidad / 100)`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const alpha = opacity / 100

    // Ocultar mapa de calor completamente en pestañas de simulación (Agua / DG2 y Sismo)
    // para evitar que se quede pegado encima o debajo de las simulaciones.
    const isWaterTab = activeDockWindow?.kind === 'agua'
    const isSeismicTab = activeDockWindow?.kind === 'sismo'
    const hideHeatmap = isWaterTab || isSeismicTab

    const shouldShowNisar =
      !hideHeatmap &&
      dateViewMode !== 'swipe' &&
      Boolean(activeLayerEntry) &&
      imagesReady &&
      (!hasAnalysisRoi || !roiLayers.loading) &&
      opacity > 0

    const webglOpacity = shouldShowNisar ? alpha : 0

    if (map.getLayer(NISAR_LAYER)) {
      map.setLayoutProperty(NISAR_LAYER, 'visibility', shouldShowNisar ? 'visible' : 'none')
      map.setPaintProperty(NISAR_LAYER, 'raster-opacity', webglOpacity)
      map.setPaintProperty(NISAR_LAYER, 'raster-resampling', 'linear')
    }
    if (map.getLayer(FOOTPRINT_FILL_LAYER)) {
      map.setLayoutProperty(FOOTPRINT_FILL_LAYER, 'visibility', hideHeatmap || opacity <= 0 ? 'none' : 'visible')
      map.setPaintProperty(FOOTPRINT_FILL_LAYER, 'fill-opacity', hideHeatmap || opacity <= 0 ? 0 : alpha * 0.03)
    }
  }, [
    opacity,
    dateViewMode,
    mapReady,
    activeLayerEntry,
    croppedRegion,
    hasAnalysisRoi,
    roiLayers.loading,
    imagesReady,
    activeDockWindow?.kind,
  ])

  // Actualizar fuente `image` de MapLibre con el BlobURL/DataURL coloreado por LUT y `capa.esquinas_lonlat` (EPSG:3857)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !activeLayerEntry || !activeColorizedUrl || !imagesReady) return
    const imgSource = map.getSource(NISAR_SOURCE) as ImageSource | undefined
    try {
      if (!imgSource && activeColorizedUrl) {
        map.addSource(NISAR_SOURCE, { type: 'image', url: activeColorizedUrl, coordinates: activeLayerEntry.esquinas_lonlat })
        map.addLayer({ id: NISAR_LAYER, type: 'raster', source: NISAR_SOURCE, paint: { 'raster-opacity': opacityRef.current / 100, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } })
      } else if (imgSource && typeof imgSource.updateImage === 'function') {
        imgSource.updateImage({ url: activeColorizedUrl, coordinates: activeLayerEntry.esquinas_lonlat })
      }
      if (map.getSource(FOOTPRINT_SOURCE)) {
        (map.getSource(FOOTPRINT_SOURCE) as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...activeLayerEntry.esquinas_lonlat, activeLayerEntry.esquinas_lonlat[0]]] } } as never)
      }
      if (map.getLayer(NISAR_LAYER)) map.setPaintProperty(NISAR_LAYER, 'raster-opacity', opacityRef.current / 100)
    } catch (err) {
      console.warn('No se pudo actualizar la capa raster NISAR coloreada:', err)
    }
  }, [activeLayerEntry, activeColorizedUrl, mapReady, imagesReady, opacity])

  // Actualizar cursor y `map.dragPan.disable()` / `enable()` según la herramienta activa
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const canvas = map.getCanvas()

    if (!isEditing) {
      canvas.style.cursor = ''
      if (!map.dragPan.isEnabled()) map.dragPan.enable()
      return
    }

    if (activeTool === 'mover') {
      canvas.style.cursor = 'grab'
      if (!map.dragPan.isEnabled()) map.dragPan.enable()
    } else if (activeTool === 'lapiz' || activeTool === 'peligro' || activeTool === 'advertencia') {
      canvas.style.cursor = 'crosshair'
      if (map.dragPan.isEnabled()) map.dragPan.disable()
    } else if (activeTool === 'poligono') {
      canvas.style.cursor = 'crosshair'
      if (!map.dragPan.isEnabled()) map.dragPan.enable()
    } else if (activeTool === 'etiqueta') {
      canvas.style.cursor = 'text'
      if (!map.dragPan.isEnabled()) map.dragPan.enable()
    }
  }, [activeTool, isEditing])

  // Sincronizar fuente GeoJSON `annotations-source`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(ANNOTATIONS_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(buildAnnotationsGeoJSON(annotations, draftFreehand, draftCircle) as never)
    }
  }, [annotations, draftFreehand, draftCircle, mapReady])

  // Sincronizar fuente GeoJSON `draft-polygon-source`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(DRAFT_POLY_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(buildDraftPolygonGeoJSON(draftPolygon) as never)
    }
  }, [draftPolygon, mapReady])

  // La máscara SVG va sobre el comparador: proyectar en un efecto para incluir bearing
  // y pitch sin leer la ref de MapLibre durante el render de React.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !croppedRegion || croppedRegion.length < 3) return
    const update = () => setCroppedScreenPts(croppedRegion.map((point) => {
      const projected = map.project(point)
      return [projected.x, projected.y]
    }))
    map.on('move', update)
    map.on('resize', update)
    update()
    return () => { map.off('move', update); map.off('resize', update) }
  }, [croppedRegion, mapReady])

  // Rain over the animated domain: project its corners (with bearing and pitch) on every move so the tint and the drops
  // follow the domain on screen.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !floodAnimationBoundsKey) return
    const [w, s, e, n] = floodAnimationBoundsKey.split(',').map(Number)
    const update = () => setFloodRainArea({ key: floodAnimationBoundsKey, points: ([[w, n], [e, n], [e, s], [w, s]] as Array<[number, number]>).map((corner) => {
      const projected = map.project(corner)
      return [projected.x, projected.y]
    }) })
    map.on('move', update)
    map.on('resize', update)
    update()
    return () => { map.off('move', update); map.off('resize', update) }
  }, [floodAnimationBoundsKey, mapReady])

  // Sincronizar fuente GeoJSON `crop-mask-source`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const hasCrop = Array.isArray(croppedRegion) && croppedRegion.length >= 3
    const source = map.getSource(CROP_MASK_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(effectiveRoi ? buildInverseEffectiveRoiMaskGeoJSON(effectiveRoi) as never : buildInverseCropMaskGeoJSON(hasCrop ? croppedRegion : null) as never)
    }
    if (map.getLayer(CROP_MASK_FILL_LAYER)) {
      map.setPaintProperty(CROP_MASK_FILL_LAYER, 'fill-opacity', hasCrop || effectiveRoi ? 0.65 : 0)
    }
  }, [croppedRegion, effectiveRoi, mapReady])

  // Actualizar `solar-thermal-layer` en tiempo real con `setPaintProperty` (escala Inferno)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer(SOLAR_THERMAL_LAYER)) return
    const hs = computeHillshadeParams(solar)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-illumination-direction', hs.direction)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-exaggeration', hs.exaggeration)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-highlight-color', hs.highlightColor)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-accent-color', '#DD513A')
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-shadow-color', '#420A68')
  }, [solar, mapReady])

  // Superponer en el mapa el ráster generado por la simulación solar de NASADEM (escala Inferno)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const SOLAR_CALC_SOURCE = 'solar-calc-raster-source'
    const SOLAR_CALC_LAYER = 'solar-calc-raster-layer'

    const shouldShow =
      solar.enabled &&
      Boolean(solar.rasterPreviewUrl) &&
      Array.isArray(solar.rasterBounds) &&
      solar.rasterBounds.length === 4 &&
      solar.showRasterOnMap !== false

    if (!shouldShow) {
      if (map.getLayer(SOLAR_CALC_LAYER)) {
        map.setLayoutProperty(SOLAR_CALC_LAYER, 'visibility', 'none')
      }
      return
    }

    const bounds = solar.rasterBounds!
    const coords: [LngLat, LngLat, LngLat, LngLat] = [
      [bounds[0], bounds[3]], // NW: [west, north]
      [bounds[2], bounds[3]], // NE: [east, north]
      [bounds[2], bounds[1]], // SE: [east, south]
      [bounds[0], bounds[1]], // SW: [west, south]
    ]

    // Opacidad fija: la intensidad ya está en los valores calculados; atarla a la opacidad
    // hacía que una radiación baja se viera casi transparente y no se distinguiera.
    const opacity = 0.88

    const existingSource = map.getSource(SOLAR_CALC_SOURCE) as ImageSource | undefined
    if (existingSource) {
      existingSource.updateImage({
        url: solar.rasterPreviewUrl!,
        coordinates: coords,
      })
      if (map.getLayer(SOLAR_CALC_LAYER)) {
        map.setLayoutProperty(SOLAR_CALC_LAYER, 'visibility', 'visible')
        map.setPaintProperty(SOLAR_CALC_LAYER, 'raster-opacity', opacity)
      }
    } else {
      try {
        map.addSource(SOLAR_CALC_SOURCE, {
          type: 'image',
          url: solar.rasterPreviewUrl!,
          coordinates: coords,
        })
        map.addLayer(
          {
            id: SOLAR_CALC_LAYER,
            type: 'raster',
            source: SOLAR_CALC_SOURCE,
            paint: {
              'raster-opacity': opacity,
              'raster-fade-duration': 150,
              'raster-resampling': 'linear',
            },
          },
          map.getLayer(CROP_MASK_FILL_LAYER) ? CROP_MASK_FILL_LAYER : undefined,
        )
      } catch (err) {
        console.warn('No se pudo superponer el ráster solar en el mapa:', err)
      }
    }
  }, [
    mapReady,
    solar.enabled,
    solar.rasterPreviewUrl,
    solar.rasterBounds,
    solar.showRasterOnMap,
  ])

  // Superponer en el mapa el ráster generado por la simulación de inundación / encharcamientos
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const FLOOD_CALC_SOURCE = 'flood-calc-raster-source'
    const FLOOD_CALC_LAYER = 'flood-calc-raster-layer'

    const shouldShow =
      hasCurrentFloodResult &&
      Boolean(activeFlood.rasterUrl) &&
      Array.isArray(activeFlood.rasterBounds) &&
      activeFlood.rasterBounds.length === 4 &&
      activeFlood.showRasterOnMap !== false &&
      !floodAnimating &&
      activeDockWindow?.kind !== 'sismo'

    if (!shouldShow) {
      if (map.getLayer(FLOOD_CALC_LAYER)) {
        map.setLayoutProperty(FLOOD_CALC_LAYER, 'visibility', 'none')
      }
      return
    }

    const bounds = activeFlood.rasterBounds!
    const coords: [LngLat, LngLat, LngLat, LngLat] = [
      [bounds[0], bounds[3]], // NW: [west, north]
      [bounds[2], bounds[3]], // NE: [east, north]
      [bounds[2], bounds[1]], // SE: [east, south]
      [bounds[0], bounds[1]], // SW: [west, south]
    ]

    const opacity = activeFlood.compareMode
      ? 0
      : ((activeFlood.waterOpacity ?? 85) / 100) * 0.9

    const existingSource = map.getSource(FLOOD_CALC_SOURCE) as ImageSource | undefined
    if (existingSource) {
      existingSource.updateImage({
        url: activeFlood.rasterUrl!,
        coordinates: coords,
      })
      if (map.getLayer(FLOOD_CALC_LAYER)) {
        map.setLayoutProperty(FLOOD_CALC_LAYER, 'visibility', 'visible')
        map.setPaintProperty(FLOOD_CALC_LAYER, 'raster-opacity', opacity)
      }
    } else {
      try {
        map.addSource(FLOOD_CALC_SOURCE, {
          type: 'image',
          url: activeFlood.rasterUrl!,
          coordinates: coords,
        })
        map.addLayer(
          {
            id: FLOOD_CALC_LAYER,
            type: 'raster',
            source: FLOOD_CALC_SOURCE,
            paint: {
              'raster-opacity': opacity,
              'raster-fade-duration': 150,
              'raster-resampling': 'linear',
            },
          },
          map.getLayer(CROP_MASK_FILL_LAYER) ? CROP_MASK_FILL_LAYER : undefined,
        )
      } catch (err) {
        console.warn('No se pudo superponer el ráster de inundación en el mapa:', err)
      }
    }
  }, [
    mapReady,
    activeFlood.rasterUrl,
    activeFlood.rasterBounds,
    activeFlood.showRasterOnMap,
    activeFlood.waterOpacity,
    activeFlood.compareMode,
    hasCurrentFloodResult,
    floodAnimating,
    activeDockWindow?.kind,
  ])

  // DG2 animation (playback or live frames): every frame is its own image layer, added once (frames only ever get
  // appended or replaced as a whole), so changing frame never reloads an image. Moving forward the new layer, which is
  // above, fades in and the previous one disappears when the fade ends; moving back both cross-fade.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const animation = floodAnimating ? floodAnimation : null
    const frames = animation?.frames ?? []
    const state = floodAnimationLayers.current ?? { layers: [], shown: null, opacity: -1, visible: true }
    floodAnimationLayers.current = state
    try {
      let keep = 0
      while (keep < state.layers.length && keep < frames.length && state.layers[keep].url === frames[keep].url) keep++
      for (const { id } of state.layers.splice(keep)) {
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
      }
      if (state.shown != null && state.shown >= keep) state.shown = null
      if (!animation) { state.opacity = -1; return }
      const before = map.getLayer(FLOOD_FLOW_LAYER) ? FLOOD_FLOW_LAYER : map.getLayer(CROP_MASK_FILL_LAYER) ? CROP_MASK_FILL_LAYER : undefined
      const visible = activeFlood.showRasterOnMap !== false && !activeFlood.compareMode && activeDockWindow?.kind !== 'sismo'
      for (let i = keep; i < frames.length; i++) {
        const id = `${FLOOD_ANIM_PREFIX}${i}`
        const [w, s, e, n] = frames[i].bounds
        map.addSource(id, { type: 'image', url: frames[i].url, coordinates: [[w, n], [e, n], [e, s], [w, s]] })
        map.addLayer({ id, type: 'raster', source: id, layout: { visibility: visible ? 'visible' : 'none' },
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, before)
        state.layers.push({ id, url: frames[i].url })
      }
      if (state.visible !== visible) {
        for (const { id } of state.layers) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
        state.visible = visible
      }
      const opacity = ((activeFlood.waterOpacity ?? 85) / 100) * 0.9
      const next = animation.index, fade = animation.fadeMs
      if (state.layers[next] && (state.shown !== next || state.opacity !== opacity)) {
        const previous = state.shown
        if (previous != null && previous !== next && state.layers[previous]) {
          const forward = next > previous
          map.setPaintProperty(state.layers[previous].id, 'raster-opacity-transition', { duration: forward ? 0 : fade, delay: forward ? fade : 0 })
          map.setPaintProperty(state.layers[previous].id, 'raster-opacity', 0)
        }
        map.setPaintProperty(state.layers[next].id, 'raster-opacity-transition', { duration: fade, delay: 0 })
        map.setPaintProperty(state.layers[next].id, 'raster-opacity', opacity)
        state.shown = next
        state.opacity = opacity
      }
    } catch (err) {
      console.warn('No se pudo dibujar la animación de inundación:', err)
    }
  }, [
    floodAnimating,
    mapReady,
    floodAnimation,
    hasCurrentFloodResult,
    activeFlood.showRasterOnMap,
    activeFlood.compareMode,
    activeFlood.waterOpacity,
    activeDockWindow?.kind,
  ])

  // DG2 flow arrows (solver velocities of the selected frame, or of the animation frame), drawn above the depth raster.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const data = floodAnimating ? floodAnimation!.flowArrows : activeFlood.flowArrows
    const shouldShow =
      hasCurrentFloodResult &&
      Boolean(data) &&
      activeFlood.showFlowArrows !== false &&
      !activeFlood.compareMode &&
      activeDockWindow?.kind !== 'sismo'
    if (!shouldShow) {
      if (map.getLayer(FLOOD_FLOW_LAYER)) map.setLayoutProperty(FLOOD_FLOW_LAYER, 'visibility', 'none')
      return
    }
    try {
      if (!map.hasImage(FLOOD_FLOW_ICON)) map.addImage(FLOOD_FLOW_ICON, flowArrowIcon())
      const source = map.getSource(FLOOD_FLOW_SOURCE) as GeoJSONSource | undefined
      if (source) source.setData(data!)
      else map.addSource(FLOOD_FLOW_SOURCE, { type: 'geojson', data: data! })
      if (!map.getLayer(FLOOD_FLOW_LAYER)) {
        map.addLayer(
          {
            id: FLOOD_FLOW_LAYER,
            type: 'symbol',
            source: FLOOD_FLOW_SOURCE,
            layout: {
              'icon-image': FLOOD_FLOW_ICON,
              'icon-rotate': ['get', 'bearing'],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              // Arrow size grows with speed (m/s) and saturates at 3 m/s.
              'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.35, 1, 0.65, 3, 1],
            },
          },
          map.getLayer(CROP_MASK_FILL_LAYER) ? CROP_MASK_FILL_LAYER : undefined,
        )
      }
      map.setLayoutProperty(FLOOD_FLOW_LAYER, 'visibility', 'visible')
    } catch (err) {
      console.warn('No se pudieron dibujar las flechas de flujo:', err)
    }
  }, [
    mapReady,
    activeFlood.flowArrows,
    floodAnimating,
    floodAnimation,
    activeFlood.showFlowArrows,
    activeFlood.compareMode,
    hasCurrentFloodResult,
    activeDockWindow?.kind,
  ])

  const handleFlyToZone = useCallback(
    (targetCenter: LngLat, targetZoom: number = 13) => {
      const map = mapRef.current
      if (map) {
        map.flyTo({
          center: [targetCenter[0], targetCenter[1]],
          zoom: targetZoom,
          duration: 900,
          essential: true,
        })
      }
      onViewChange?.({ centro: targetCenter, zoom: targetZoom }, { userInitiated: true })
    },
    [onViewChange],
  )

  // Volar a la vista de la copia seleccionada
  useEffect(() => {
    const map = mapRef.current
    if (!map || lastKeyRef.current === viewKey) return
    lastKeyRef.current = viewKey
    const target = viewRef.current
    map.flyTo(
      { center: target.centro, zoom: target.zoom, duration: 900, essential: true },
      { programmatic: true },
    )
  }, [viewKey])

  const selectTool = (tool: DrawTool) => {
    onSelectTool(tool)
    if (tool !== 'poligono') setDraftPolygon([])
    if (tool !== 'etiqueta') setLabelEditor(null)
    setDraftCircle(null)
    setDraftFreehand([])
  }

  // Seleccionar una figura haciendo clic sobre ella o su etiqueta
  const handleSelectElement = (e: ReactMouseEvent, ann: MapAnnotation) => {
    if (!isEditing) return
    e.stopPropagation()
    setSelectedAnnotationId(ann.id)

    if (activeTool === 'etiqueta') {
      if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
        setLabelEditor({
          coord: ann.center,
          text: ann.label,
          targetAnnotationId: ann.id,
        })
      } else if (ann.kind === 'etiqueta') {
        setLabelEditor({
          coord: ann.position,
          text: ann.text,
          targetAnnotationId: ann.id,
        })
      }
    }
  }

  // Abrir el editor de texto desde la píldora de acción rápida del elemento seleccionado
  const handleEditSelectedText = () => {
    if (!selectedAnnotation) return
    if (selectedAnnotation.kind === 'peligro' || selectedAnnotation.kind === 'advertencia') {
      setLabelEditor({
        coord: selectedAnnotation.center,
        text: selectedAnnotation.label,
        targetAnnotationId: selectedAnnotation.id,
      })
    } else if (selectedAnnotation.kind === 'etiqueta') {
      setLabelEditor({
        coord: selectedAnnotation.position,
        text: selectedAnnotation.text,
        targetAnnotationId: selectedAnnotation.id,
      })
    } else {
      const anchor = getAnnotationAnchorCoord(selectedAnnotation)
      setLabelEditor({
        coord: anchor,
        text: t('Trazo marcado', 'Marked stroke'),
        targetAnnotationId: null,
      })
    }
  }

  const handleApplyCropRegion = () => {
    if (draftPolygon.length < 3) return
    const poly = [...draftPolygon]
    const { minLng, minLat, maxLng, maxLat } = getPolygonBoundsAndCentroid(poly)

    onCropRegionChange(poly)
    setDraftPolygon([])
    onSelectTool('mover')

    const map = mapRef.current
    if (map) {
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 80, duration: 900 },
      )
    }
  }

  const handleResetCroppedRegion = () => {
    onCropRegionChange(null)
    setDraftPolygon([])
    const map = mapRef.current
    if (map) {
      map.flyTo({ center: viewRef.current.centro, zoom: viewRef.current.zoom, duration: 900, essential: true }, { programmatic: true })
    }
  }

  const handleConfirmLabel = (e: FormEvent) => {
    e.preventDefault()
    if (!labelEditor || !labelEditor.text.trim()) return
    const text = labelEditor.text.trim()

    if (labelEditor.targetAnnotationId) {
      onAnnotationsChange(
        annotations.map((ann) => {
          if (ann.id !== labelEditor.targetAnnotationId) return ann
          if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
            return { ...ann, label: text }
          }
          if (ann.kind === 'etiqueta') {
            return { ...ann, text }
          }
          return ann
        }),
      )
    } else {
      const created: MapAnnotation = {
        id: newId(),
        kind: 'etiqueta',
        position: labelEditor.coord,
        text,
      }
      onAnnotationsChange([...annotations, created])
      setSelectedAnnotationId(created.id)
    }
    setLabelEditor(null)
    onSelectTool('mover')
  }

  const handleUndoLastDrawing = () => {
    if (draftPolygon.length > 0) {
      setDraftPolygon((prev) => prev.slice(0, -1))
      return
    }
    if (annotations.length > 0) {
      const removed = annotations[annotations.length - 1]
      if (removed && removed.id === selectedAnnotationId) {
        setSelectedAnnotationId(null)
      }
      onAnnotationsChange(annotations.slice(0, -1))
    }
  }

  // Limpiar todas las anotaciones y recortes de la copia activa
  const handleClearAllDrawings = () => {
    onAnnotationsChange([])
    onCropRegionChange(null)
    setDraftPolygon([])
    setDraftFreehand([])
    setDraftCircle(null)
    setSelectedAnnotationId(null)
    setLabelEditor(null)
  }

  const hasActiveCrop = Array.isArray(croppedRegion) && croppedRegion.length >= 3
  const croppedInversePathAttr = croppedScreenPts
    ? `M 0 0 L ${viewport.width} 0 L ${viewport.width} ${viewport.height} L 0 ${viewport.height} Z M ${croppedScreenPts
        .map(([x, y], i) => `${i === 0 ? '' : 'L '}${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(' ')} Z`
    : ''

  const draftPolyCentroidScreen =
    draftPolygon.length >= 3
      ? projectLngLat(getPolygonBoundsAndCentroid(draftPolygon).centroid, viewport)
      : null

  const labelEditorScreen = labelEditor ? projectLngLat(labelEditor.coord, viewport) : null

  const selectedAnchorScreen = selectedAnnotation
    ? projectLngLat(getAnnotationAnchorCoord(selectedAnnotation), viewport)
    : null

  const canSelectInSvg = isEditing && (activeTool === 'mover' || activeTool === 'etiqueta')
  const svgElementInteractionStyle = {
    pointerEvents: canSelectInSvg ? ('auto' as const) : ('none' as const),
    cursor: canSelectInSvg ? ('pointer' as const) : ('inherit' as const),
  }

  const activeEsquinas =
    activeLayerEntry?.esquinas_lonlat ??
    layerT2?.esquinas_lonlat ??
    ([[0, 0], [0, 0], [0, 0], [0, 0]] as import('../types/workspace').Footprint)
  const esquinasNW = projectLngLat(activeEsquinas[0], viewport)
  const esquinasSE = projectLngLat(activeEsquinas[2], viewport)
  const esquinasX = Math.min(esquinasNW[0], esquinasSE[0])
  const esquinasY = Math.min(esquinasNW[1], esquinasSE[1])
  const esquinasW = Math.max(1, Math.abs(esquinasSE[0] - esquinasNW[0]))
  const esquinasH = Math.max(1, Math.abs(esquinasSE[1] - esquinasNW[1]))
  const swipeScreenX = esquinasX + (swipePct / 100) * esquinasW

  useEffect(() => {
    if (!isDraggingSwipe) return

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const ratio = ((localX - esquinasX) / Math.max(1, esquinasW)) * 100
      setSwipePct(Math.min(98, Math.max(2, Number(ratio.toFixed(1)))))
    }

    const onMouseUp = () => {
      setIsDraggingSwipe(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingSwipe, esquinasX, esquinasW])

  // Deslizador comparativo interactivo: Inundación Simulada vs Terreno Original
  const floodBounds = activeFlood.rasterBounds
  const floodNW =
    floodBounds && floodBounds.length === 4
      ? projectLngLat([floodBounds[0], floodBounds[3]], viewport)
      : [0, 0]
  const floodSE =
    floodBounds && floodBounds.length === 4
      ? projectLngLat([floodBounds[2], floodBounds[1]], viewport)
      : [0, 0]
  const floodX = Math.min(floodNW[0], floodSE[0])
  const floodY = Math.min(floodNW[1], floodSE[1])
  const floodW = Math.max(1, Math.abs(floodSE[0] - floodNW[0]))
  const floodH = Math.max(1, Math.abs(floodSE[1] - floodNW[1]))
  const floodSwipePct = activeFlood.compareSwipePct ?? 50
  const floodSwipeScreenX = floodX + (floodSwipePct / 100) * floodW

  useEffect(() => {
    if (!isDraggingFloodSwipe) return

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const ratio = ((localX - floodX) / Math.max(1, floodW)) * 100
      const nextPct = Math.min(98, Math.max(2, Number(ratio.toFixed(1))))
      if (onFloodChange) {
        onFloodChange({
          ...activeFlood,
          compareSwipePct: nextPct,
        })
      }
    }

    const onMouseUp = () => {
      setIsDraggingFloodSwipe(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingFloodSwipe, floodX, floodW, activeFlood, onFloodChange])

  // Arrastre del cuadro flotante de herramientas de dibujo dentro del lienzo del mapa
  useEffect(() => {
    if (!isDraggingToolbox) return
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e: MouseEvent) => {
      const drag = toolboxDragRef.current
      const stage = mapStageRef.current
      if (!drag || !stage) return
      const stageRect = stage.getBoundingClientRect()
      const maxX = Math.max(8, stageRect.width - 230)
      const maxY = Math.max(8, stageRect.height - 80)
      const nextX = Math.min(maxX, Math.max(8, drag.origX + (e.clientX - drag.startX)))
      const nextY = Math.min(maxY, Math.max(8, drag.origY + (e.clientY - drag.startY)))
      setToolboxPos({ x: Math.round(nextX), y: Math.round(nextY) })
    }

    const onMouseUp = () => {
      toolboxDragRef.current = null
      setIsDraggingToolbox(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingToolbox])

  const handleCenterRoi = () => {
    if (croppedRegion) {
      const b = getPolygonBoundsAndCentroid(croppedRegion)
      mapRef.current?.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], { padding: 80 })
      return
    }
    // Sin ROI confirmada no hay centro regional que enfocar.
  }

  // Ventana activa del área central: define la vista y la etiqueta de la pestaña.
  const activeDockLabel = activeDockWindow
    ? activeDockWindow.kind === 'agua'
      ? t('Agua / DG2 {index}', 'Water / DG2 {index}', { index: activeDockWindow.index })
      : activeDockWindow.kind === 'sismo'
        ? t('Sismo / Terremoto {index}', 'Earthquake {index}', { index: activeDockWindow.index })
        : t('Gráficos / Mapa {index}', 'Graphics / Map Plot {index}', { index: activeDockWindow.index })
    : t('Gráficos / Mapa 1', 'Graphics / Map Plot 1')

  // Cerrar el menú de «+» al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!newWindowMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.ws-panel-tab-add-wrap')) setNewWindowMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNewWindowMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [newWindowMenuOpen])

  // Sombreado direccional de radiación solar con los stops exactos de Inferno
  const showSolarOverlay = solar.enabled && solar.radiationIntensity > 0
  const radRatio = solar.radiationIntensity / 100
  const sunFocusX = 85 - (solar.sunAngle / 180) * 70
  const sunFocusY = 54 - Math.sin((solar.sunAngle * Math.PI) / 180) * 20
  const shadowSideX = 100 - sunFocusX

  // Captura la región seleccionada (o toda la vista) combinando WebGL + capa SVG de anotaciones
  const executeRegionCapture = useCallback(
    async (rectCss?: { x: number; y: number; w: number; h: number }) => {
      const map = mapRef.current
      const stage = mapStageRef.current
      if (!map || !stage) return

      const mapCanvasEl = map.getCanvas()
      const stageW = stage.clientWidth || viewport.width || 960
      const stageH = stage.clientHeight || viewport.height || 640

      const cropX = rectCss ? Math.max(0, Math.round(rectCss.x)) : 0
      const cropY = rectCss ? Math.max(0, Math.round(rectCss.y)) : 0
      const cropW = rectCss ? Math.max(16, Math.round(rectCss.w)) : stageW
      const cropH = rectCss ? Math.max(16, Math.round(rectCss.h)) : stageH

      const scaleX = mapCanvasEl.width / Math.max(1, stageW)
      const scaleY = mapCanvasEl.height / Math.max(1, stageH)

      const outCanvas = document.createElement('canvas')
      outCanvas.width = Math.max(1, Math.round(cropW * scaleX))
      outCanvas.height = Math.max(1, Math.round(cropH * scaleY))

      const ctx = outCanvas.getContext('2d')
      if (!ctx) return

      // 1. Dibujar el lienzo WebGL de MapLibre (preserveDrawingBuffer: true)
      ctx.drawImage(
        mapCanvasEl,
        cropX * scaleX,
        cropY * scaleY,
        cropW * scaleX,
        cropH * scaleY,
        0,
        0,
        outCanvas.width,
        outCanvas.height,
      )

      // 2. Superponer sombreado solar si está activo
      if (solar.enabled && solar.radiationIntensity > 0) {
        const rad = solar.radiationIntensity / 100
        const grad = ctx.createRadialGradient(
          outCanvas.width * (sunFocusX / 100),
          outCanvas.height * (sunFocusY / 100),
          10,
          outCanvas.width * 0.5,
          outCanvas.height * 0.5,
          Math.max(outCanvas.width, outCanvas.height) * 0.75,
        )
        grad.addColorStop(0, `rgba(252, 255, 164, ${(0.24 * rad).toFixed(2)})`)
        grad.addColorStop(0.55, `rgba(237, 105, 37, ${(0.18 * rad).toFixed(2)})`)
        grad.addColorStop(1, `rgba(0, 0, 4, ${(0.26 * rad).toFixed(2)})`)
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)
      }

      // 3. Superponer la capa SVG (ROI, Swipe t1/t2 y anotaciones)
      const svgEl = svgOverlayRef.current
      if (svgEl) {
        try {
          const serialized = new XMLSerializer().serializeToString(svgEl)
          const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
          const svgUrl = URL.createObjectURL(svgBlob)
          await new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                cropX,
                cropY,
                cropW,
                cropH,
                0,
                0,
                outCanvas.width,
                outCanvas.height,
              )
              URL.revokeObjectURL(svgUrl)
              resolve()
            }
            img.onerror = () => {
              URL.revokeObjectURL(svgUrl)
              resolve()
            }
            img.src = svgUrl
          })
        } catch {
          // Si falla la serialización SVG, al menos se conserva el lienzo WebGL
        }
      }

      const defaultFormat = 'png'
      const previewUrl = outCanvas.toDataURL('image/png')
      const dateTag = dateViewMode === 'swipe' ? `${displayScene.t1}_vs_${displayScene.t2}` : dateViewMode === 't1' ? displayScene.t1 : displayScene.t2
      setCaptureModal({
        canvas: outCanvas,
        previewUrl,
        width: outCanvas.width,
        height: outCanvas.height,
        format: defaultFormat,
        quality: 0.92,
        filename: `terrapulse_${exploreLayerId}_${dateTag}`,
      })
      onCancelCaptureMode()
      setCaptureRect(null)
      setCaptureDragStart(null)
    },
    [
      viewport.width,
      viewport.height,
      solar.enabled,
      solar.radiationIntensity,
      sunFocusX,
      sunFocusY,
      dateViewMode,
      displayScene.t1,
      displayScene.t2,
      exploreLayerId,
      onCancelCaptureMode,
    ],
  )

  const handleDownloadCapture = () => {
    if (!captureModal) return
    const mime = captureModal.format === 'png' ? 'image/png' : 'image/jpeg'
    const ext = captureModal.format === 'png' ? 'png' : 'jpg'
    const dataUrl =
      captureModal.format === 'png'
        ? captureModal.canvas.toDataURL(mime)
        : captureModal.canvas.toDataURL(mime, captureModal.quality)
    const a = document.createElement('a')
    a.href = dataUrl
    const safeName = captureModal.filename.trim() || 'terrapulse-captura'
    a.download = safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`
    a.click()
  }

  const vmin = activeLayerEntry?.escala.vmin_dB ?? -22.0
  const vmax = activeLayerEntry?.escala.vmax_dB ?? 0.0
  const colorbarTicks = [
    vmax,
    vmax - (vmax - vmin) * 0.2,
    vmax - (vmax - vmin) * 0.4,
    vmax - (vmax - vmin) * 0.5,
    vmax - (vmax - vmin) * 0.6,
    vmax - (vmax - vmin) * 0.8,
    vmin,
  ]

  return (
    <main className="ws-center-dock" aria-label={t('Área Central de Estación de Trabajo', 'Central workspace area')}>
      {/* 1. Cabecera de ventanas acopladas (Map Plots y ventanas de agua/DG2) + botón «+» */}
      <div className="ws-panel-tabbar" role="tablist" aria-label={t('Ventanas del área central', 'Central area windows')}>
        <div className="ws-panel-tabbar__tabs">
          {dockWindows.map((win) => {
            const isActive = win.id === activeDockWindow?.id
            const isAgua = win.kind === 'agua'
            const isSismo = win.kind === 'sismo'
            const label = isAgua
              ? t('Agua / DG2 {index}', 'Water / DG2 {index}', { index: win.index })
              : isSismo
                ? t('Sismo / Terremoto {index}', 'Earthquake {index}', { index: win.index })
                : t('Gráficos / Mapa {index}', 'Graphics / Map Plot {index}', { index: win.index })
            return (
              <div
                key={win.id}
                className={`ws-panel-tab-group${isAgua ? ' ws-panel-tab-group--hydro' : ''}${isSismo ? ' ws-panel-tab-group--seismic' : ''}${
                  isActive ? ' is-active' : ''
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`ws-panel-tab${isAgua ? ' ws-panel-tab--hydro' : ''}${isSismo ? ' ws-panel-tab--seismic' : ''}${
                    isActive ? ' is-active' : ''
                  }`}
                  title={label}
                  onClick={() => onActivateDockWindow(win.id)}
                >
                  {isAgua ? (
                    <Droplets size={13} aria-hidden="true" />
                  ) : isSismo ? (
                    <Activity size={13} aria-hidden="true" />
                  ) : (
                    <Monitor size={13} aria-hidden="true" />
                  )}
                  <span>{label}</span>
                </button>
                <button
                  type="button"
                  className="ws-panel-tab__close"
                  aria-label={t('Cerrar {name}', 'Close {name}', { name: label })}
                  title={
                    dockWindows.length <= 1
                      ? t('Debe quedar al menos una ventana', 'At least one window must remain')
                      : t('Cerrar {name}', 'Close {name}', { name: label })
                  }
                  disabled={dockWindows.length <= 1}
                  onClick={() => onCloseDockWindow(win.id)}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            )
          })}

          <div className="ws-panel-tab-add-wrap">
            <button
              type="button"
              className="ws-panel-tab-add"
              aria-label={t('Agregar ventana', 'Add window')}
              aria-haspopup="menu"
              aria-expanded={newWindowMenuOpen}
              title={t('Agregar ventana', 'Add window')}
              onClick={() => setNewWindowMenuOpen((prev) => !prev)}
            >
              <Plus size={13} aria-hidden="true" />
            </button>
            {newWindowMenuOpen && (
              <div className="ws-window-menu" role="menu" aria-label={t('Tipo de ventana', 'Window type')}>
                <button
                  type="button"
                  role="menuitem"
                  className="ws-window-menu__item"
                  onClick={() => {
                    onOpenDockWindow('map')
                    setNewWindowMenuOpen(false)
                  }}
                >
                  <Monitor size={13} aria-hidden="true" />
                  <span>
                    {t('Mapa normal', 'Standard map')}
                    <em>{t('Gráficos / Mapa', 'Graphics / Map Plot')}</em>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ws-window-menu__item"
                  onClick={() => {
                    onOpenDockWindow('agua')
                    setNewWindowMenuOpen(false)
                  }}
                >
                  <Droplets size={13} aria-hidden="true" />
                  <span>
                    {t('Ventana de agua', 'Water window')}
                    <em>{t('Agua / DG2', 'Water / DG2')}</em>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ws-window-menu__item ws-window-menu__item--seismic"
                  onClick={() => {
                    onOpenDockWindow('sismo')
                    setNewWindowMenuOpen(false)
                  }}
                >
                  <Activity size={13} aria-hidden="true" />
                  <span>
                    {t('Ventana sísmica', 'Seismic window')}
                    <em>{t('Sismo / Terremoto', 'Earthquake / Seismic')}</em>
                  </span>
                </button>
              </div>
            )}
          </div>

          {hasAnalysisRoi && (
            <div className="ws-panel-tab-actions">
              {onDuplicateWithHeatmap && (
                <button
                  type="button"
                  className="ws-tab-action-btn ws-tab-action-btn--heat"
                  onClick={onDuplicateWithHeatmap}
                  title={t('Generar una copia de este mapa con el mapa de calor SAR activado', 'Generate a copy of this map with SAR heatmap enabled')}
                >
                  <Flame size={12} />
                  <span>{t('Copia con Calor', 'Copy with Heatmap')}</span>
                </button>
              )}
              {onDuplicateForWater && (
                <button
                  type="button"
                  className="ws-tab-action-btn ws-tab-action-btn--water"
                  onClick={onDuplicateForWater}
                  title={t('Generar copia limpia para simulación de agua (DG2) sin mapa de calor', 'Generate clean copy for water simulation (DG2) without heatmap')}
                >
                  <Droplets size={12} />
                  <span>{t('Copia Agua (DG2)', 'Water Copy (DG2)')}</span>
                </button>
              )}
              {onDuplicateForSeismic && (
                <button
                  type="button"
                  className="ws-tab-action-btn ws-tab-action-btn--seismic"
                  onClick={onDuplicateForSeismic}
                  title={t('Generar copia limpia para simulación sísmica / terremoto', 'Generate clean copy for seismic / earthquake simulation')}
                >
                  <Activity size={12} />
                  <span>{t('Copia Sismo', 'Seismic Copy')}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ws-panel-tabbar__summary">
          <span className="ws-mono">
            {isEditing && activeMapName ? activeMapName : t('Mapa General (Solo lectura)', 'Overview map (read-only)')}
          </span>
          <span>·</span>
          <span className="ws-mono">
            {activeLayerOption.shortLabel} [{activeColormapSpec.shortLabel}]
          </span>
          <span>·</span>
          <span className="ws-mono">
            {dateViewMode === 'swipe'
              ? t('Deslizador t1 ({t1}) ↔ t2 ({t2})', 'Swipe t1 ({t1}) ↔ t2 ({t2})', { t1: displayDate(displayScene.t1), t2: displayDate(displayScene.t2) })
              : dateViewMode === 't1'
                ? `t1 = ${displayDate(displayScene.t1)}`
                : `t2 = ${displayDate(displayScene.t2)}`}
          </span>
          <span>·</span>
          <span className="ws-mono">
            {t('Centro', 'Center')}: [{viewport.centro[0].toFixed(4)}, {viewport.centro[1].toFixed(4)}] · z=
            {viewport.zoom.toFixed(2)}
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* 2. Barra compacta sin duplicidad con la Ribbon Bar (solo acciones de lienzo) */}
          <div
            className="ws-graphics-toolbar"
            role="toolbar"
            aria-label={t('Barra de acciones del lienzo {label}', 'Canvas actions for {label}', { label: activeDockLabel })}
          >
            <div className="ws-graphics-toolbar__group">
              <button
                type="button"
                className={`ws-tool-btn ${floatingToolsOpen ? 'is-active' : ''}`}
                onClick={onToggleFloatingTools}
                title={t('Mostrar/ocultar cuadro flotante arrastrable de herramientas de dibujo', 'Show/hide draggable drawing toolbox')}
              >
                <PencilRuler size={13} />
                <span>{floatingToolsOpen ? t('Ocultar Caja de Dibujo', 'Hide Drawing Toolbox') : t('Mostrar Caja de Dibujo', 'Show Drawing Toolbox')}</span>
              </button>

              <button
                type="button"
                className={`ws-tool-btn ${isCaptureMode ? 'is-active' : ''}`}
                onClick={() => (isCaptureMode ? onCancelCaptureMode() : onStartCaptureMode())}
                title={t('Seleccionar región del mapa simulado y guardar PNG / JPG', 'Select a simulated-map region and save PNG / JPG')}
              >
                <Camera size={13} />
                <span>{isCaptureMode ? t('Cancelar Captura', 'Cancel Capture') : t('Capturar Región (PNG/JPG)', 'Capture Region (PNG/JPG)')}</span>
              </button>

              <button
                type="button"
                className="ws-tool-btn"
                onClick={handleCenterRoi}
                title={t('Centrar vista sobre la ROI activa', 'Center view on active ROI')}
              >
                <Crosshair size={13} />
                <span>{t('Centrar ROI', 'Center ROI')}</span>
              </button>
            </div>

            <div className="ws-graphics-toolbar__right">
              <span className="ws-mono" style={{ fontSize: 11, color: '#475569' }}>
                {isEditing ? t('Herramienta activa: {tool}', 'Active tool: {tool}', { tool: localizeText(activeTool) }) : t('Vista de solo lectura (duplica el mapa para editar)', 'Read-only view (duplicate the map to edit)')}
              </span>
            </div>
          </div>

          {/* 3. Área del lienzo geoespacial + Barra de Escala de Color Vertical a la derecha */}
          <div className="map-canvas" ref={mapStageRef}>
            <div
              ref={containerRef}
              className="map-canvas__map"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
              }}
            />

        {/* Efecto direccional de radiación del Simulador Solar con los stops de Inferno */}
        {showSolarOverlay && (
          <div
            className="solar-thermal-overlay"
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 4,
              background: `
                radial-gradient(circle at ${sunFocusX.toFixed(1)}% ${sunFocusY.toFixed(1)}%, rgba(252, 255, 164, ${(radRatio * 0.46).toFixed(2)}) 0%, rgba(252, 165, 10, ${(radRatio * 0.38).toFixed(2)}) 26%, rgba(221, 81, 58, ${(radRatio * 0.30).toFixed(2)}) 50%, rgba(147, 38, 103, ${(radRatio * 0.22).toFixed(2)}) 72%, rgba(0, 0, 4, 0) 90%),
                radial-gradient(circle at ${shadowSideX.toFixed(1)}% ${(100 - sunFocusY).toFixed(1)}%, rgba(66, 10, 104, ${(radRatio * 0.42).toFixed(2)}) 0%, rgba(0, 0, 4, ${(radRatio * 0.28).toFixed(2)}) 45%, rgba(0, 0, 4, 0) 75%)
              `,
            }}
          />
        )}

        {/* OVERLAY SVG SINCRONIZADO POR ENCIMA DEL MAPA (z-index: 5) */}
        <svg
          ref={svgOverlayRef}
          className="synchronized-vector-svg"
          width={viewport.width}
          height={viewport.height}
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          {/* Deslizador Antes/Después (Swipe t1 ↔ t2) en EPSG:3857 con LUT coloreado */}
          {dateViewMode === 'swipe' && imagesReady && layerT1 && layerT2 && opacity > 0 && roiLayers.comparable && (
            <g>
              <defs>
                <clipPath id="explore-swipe-left">
                  <rect x={0} y={0} width={Math.max(0, swipeScreenX)} height={viewport.height} />
                </clipPath>
                <clipPath id="explore-swipe-right">
                  <rect
                    x={Math.max(0, swipeScreenX)}
                    y={0}
                    width={Math.max(0, viewport.width - swipeScreenX)}
                    height={viewport.height}
                  />
                </clipPath>
              </defs>
              <image
                href={colorizedT1Url}
                x={esquinasX}
                y={esquinasY}
                width={esquinasW}
                height={esquinasH}
                preserveAspectRatio="none"
                opacity={opacity / 100}
                clipPath="url(#explore-swipe-left)"
                style={{ pointerEvents: 'none' }}
              />
              <image
                href={colorizedT2Url}
                x={esquinasX}
                y={esquinasY}
                width={esquinasW}
                height={esquinasH}
                preserveAspectRatio="none"
                opacity={opacity / 100}
                clipPath="url(#explore-swipe-right)"
                style={{ pointerEvents: 'none' }}
              />
              <line
                x1={swipeScreenX}
                y1={esquinasY}
                x2={swipeScreenX}
                y2={esquinasY + esquinasH}
                stroke="#3399FF"
                strokeWidth={2}
              />
            </g>
          )}

          {/* Deslizador Comparativo: Inundación Simulada vs Terreno Original Base */}
          {hasCurrentFloodResult && activeFlood.compareMode && activeFlood.rasterUrl && (
            <g>
              <defs>
                <clipPath id="flood-compare-clip">
                  <rect
                    x={floodSwipeScreenX}
                    y={floodY}
                    width={Math.max(0, floodX + floodW - floodSwipeScreenX)}
                    height={floodH}
                  />
                </clipPath>
              </defs>
              <image
                href={activeFlood.rasterUrl}
                x={floodX}
                y={floodY}
                width={floodW}
                height={floodH}
                preserveAspectRatio="none"
                opacity={((activeFlood.waterOpacity ?? 85) / 100) * 0.95}
                clipPath="url(#flood-compare-clip)"
                style={{ pointerEvents: 'none' }}
              />
              <line
                x1={floodSwipeScreenX}
                y1={floodY}
                x2={floodSwipeScreenX}
                y2={floodY + floodH}
                stroke="#00ffff"
                strokeWidth={2.5}
                strokeDasharray="none"
              />
            </g>
          )}

          {/* La huella y el borde del recorte se dibujan en MapLibre. La máscara SVG
              permanece encima de las imágenes del comparador para ocultar su exterior. */}
          {hasActiveCrop && croppedScreenPts && (
            <path d={croppedInversePathAttr} fill="#CBD5E1" fillOpacity={0.72} fillRule="evenodd" />
          )}

          {/* Figuras guardadas seleccionables (Círculos, Trazos de Lápiz y Nodos de Etiqueta) */}
          {annotations.map((ann) => {
            const isSelected = selectedAnnotation?.id === ann.id

            if (ann.kind === 'lapiz' && ann.points.length >= 2) {
              const pts = ann.points
                .map((pt) => projectLngLat(pt, viewport))
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ')
              return (
                <g key={ann.id} onClick={(e) => handleSelectElement(e, ann)}>
                  {isSelected && (
                    <polyline
                      points={pts}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ filter: 'drop-shadow(0 0 5px #3399FF)', pointerEvents: 'none' }}
                    />
                  )}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={svgElementInteractionStyle}
                  />
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="#3399FF"
                    strokeWidth={isSelected ? 4.5 : 3.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={svgElementInteractionStyle}
                  />
                </g>
              )
            }

            if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
              const ringPts = createCirclePolygonCoords(ann.center, ann.radiusKm, 64)
                .map((pt) => projectLngLat(pt, viewport))
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ')
              const [cx, cy] = projectLngLat(ann.center, viewport)
              const isDanger = ann.kind === 'peligro'

              return (
                <g key={ann.id} onClick={(e) => handleSelectElement(e, ann)}>
                  {isSelected && (
                    <polygon
                      points={ringPts}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={5.5}
                      style={{ filter: 'drop-shadow(0 0 5px #3399FF)', pointerEvents: 'none' }}
                    />
                  )}
                  <polygon
                    points={ringPts}
                    fill={isDanger ? 'rgba(220, 38, 38, 0.26)' : 'rgba(217, 119, 6, 0.22)'}
                    stroke={isDanger ? '#DC2626' : '#D97706'}
                    strokeWidth={isSelected ? 4 : 2.6}
                    strokeDasharray={isDanger ? undefined : '8 6'}
                    style={svgElementInteractionStyle}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 5 : 4}
                    fill={isDanger ? '#DC2626' : '#D97706'}
                    stroke="#FFFFFF"
                    strokeWidth={1.5}
                    style={svgElementInteractionStyle}
                  />
                </g>
              )
            }

            if (ann.kind === 'etiqueta') {
              const [x, y] = projectLngLat(ann.position, viewport)
              return (
                <g key={ann.id} onClick={(e) => handleSelectElement(e, ann)}>
                  {isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r={8.5}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={2.5}
                      style={{ filter: 'drop-shadow(0 0 5px #3399FF)', pointerEvents: 'none' }}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? 5.5 : 4.5}
                    fill="#3399FF"
                    stroke="#FFFFFF"
                    strokeWidth={1.8}
                    style={svgElementInteractionStyle}
                  />
                </g>
              )
            }

            return null
          })}

          {/* Círculo en curso mientras el usuario arrastra */}
          {draftCircle &&
            (() => {
              const ringPts = createCirclePolygonCoords(
                draftCircle.center,
                draftCircle.radiusKm,
                64,
              )
                .map((pt) => projectLngLat(pt, viewport))
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ')
              const [cx, cy] = projectLngLat(draftCircle.center, viewport)
              const isDanger = draftCircle.kind === 'peligro'
              return (
                <g>
                  <polygon
                    points={ringPts}
                    fill={isDanger ? 'rgba(220, 38, 38, 0.26)' : 'rgba(217, 119, 6, 0.22)'}
                    stroke={isDanger ? '#DC2626' : '#D97706'}
                    strokeWidth={2.6}
                    strokeDasharray={isDanger ? undefined : '8 6'}
                  />
                  <circle cx={cx} cy={cy} r={4} fill={isDanger ? '#DC2626' : '#D97706'} />
                </g>
              )
            })()}

          {/* Trazo de lápiz en curso mientras el usuario arrastra */}
          {draftFreehand.length >= 2 && (
            <polyline
              points={draftFreehand
                .map((pt) => projectLngLat(pt, viewport))
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ')}
              fill="none"
              stroke="#3399FF"
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Polígono en construcción (`Recortar Región`) */}
          {draftPolygon.length > 0 && (
            <g>
              {draftPolygon.length >= 3 && (
                <polygon
                  points={draftPolygon
                    .map((pt) => projectLngLat(pt, viewport))
                    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                    .join(' ')}
                  fill="rgba(51, 153, 255, 0.18)"
                />
              )}
              {draftPolygon.length >= 2 && (
                <polyline
                  points={(draftPolygon.length >= 3
                    ? [...draftPolygon, draftPolygon[0]]
                    : draftPolygon
                  )
                    .map((pt) => projectLngLat(pt, viewport))
                    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                    .join(' ')}
                  fill="none"
                  stroke="#3399FF"
                  strokeWidth={2.2}
                  strokeDasharray="6 4"
                />
              )}
              {draftPolygon.map((pt, idx) => {
                const [x, y] = projectLngLat(pt, viewport)
                return (
                  <circle
                    key={idx}
                    cx={x}
                    cy={y}
                    r={5.5}
                    fill="#FFFFFF"
                    stroke="#3399FF"
                    strokeWidth={2.2}
                  />
                )
              })}
            </g>
          )}
        </svg>

        {/* Marcadores HTML seleccionables encima del SVG (z-index: 10) */}
        <div
          className="map-markers-layer"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: 10,
          }}
        >
          {annotations.map((ann) => {
            const isSelected = selectedAnnotation?.id === ann.id

            if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
              const topEdgeCoord: LngLat = [ann.center[0], ann.center[1] + ann.radiusKm / 110.574]
              const [x, y] = projectLngLat(topEdgeCoord, viewport)
              return (
                <div
                  key={ann.id}
                  onClick={(e) => handleSelectElement(e, ann)}
                  title={localizeText(ann.kind === 'peligro' ? DANGER_CIRCLE_TOOLTIP : WARN_CIRCLE_TOOLTIP)}
                  className={`map-marker-tag ${
                    ann.kind === 'peligro' ? 'map-marker-tag--danger' : 'map-marker-tag--warn'
                  } ${isSelected ? 'is-selected' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `${x.toFixed(1)}px`,
                    top: `${(y - 8).toFixed(1)}px`,
                    transform: 'translate(-50%, -100%)',
                    pointerEvents: canSelectInSvg ? 'auto' : 'none',
                    cursor: canSelectInSvg ? 'pointer' : 'inherit',
                  }}
                >
                  {ann.label === DANGER_CIRCLE_DEFAULT_LABEL || ann.label === WARN_CIRCLE_DEFAULT_LABEL ? localizeText(ann.label) : ann.label}
                </div>
              )
            }

            if (ann.kind === 'etiqueta') {
              const [x, y] = projectLngLat(ann.position, viewport)
              return (
                <div
                  key={ann.id}
                  onClick={(e) => handleSelectElement(e, ann)}
                  className={`map-marker-tag map-marker-tag--custom ${
                    isSelected ? 'is-selected' : ''
                  }`}
                  style={{
                    position: 'absolute',
                    left: `${(x + 10).toFixed(1)}px`,
                    top: `${y.toFixed(1)}px`,
                    transform: 'translate(0, -50%)',
                    pointerEvents: canSelectInSvg ? 'auto' : 'none',
                    cursor: canSelectInSvg ? 'pointer' : 'inherit',
                  }}
                >
                  {ann.text}
                </div>
              )
            }

            return null
          })}
        </div>

        {/* Barra de acción rápida junto al elemento seleccionado */}
        {isEditing && selectedAnnotation && selectedAnchorScreen && !labelEditor && (
          <div
            className="selection-action-pill"
            style={{
              left: `${Math.min(Math.max(115, selectedAnchorScreen[0]), viewport.width - 115)}px`,
              top: `${Math.min(Math.max(54, selectedAnchorScreen[1] - 42), viewport.height - 96)}px`,
            }}
          >
            <button
              type="button"
              className="selection-action-pill__btn"
              onClick={handleEditSelectedText}
            >
              ✏️ {t('Editar etiqueta', 'Edit label')}
            </button>
            <span className="selection-action-pill__sep" aria-hidden="true" />
            <button
              type="button"
              className="selection-action-pill__btn selection-action-pill__btn--danger"
              onClick={() => handleDeleteAnnotation(selectedAnnotation.id)}
            >
              🗑️ {t('Eliminar (Supr)', 'Delete (Del)')}
            </button>
          </div>
        )}

        {/* Control interactivo sobre la ROI cuando está activo el Deslizador Antes/Después (Swipe t1 ↔ t2) */}
        {dateViewMode === 'swipe' && imagesReady && roiLayers.comparable && (
          <div
            className="swipe-handle-overlay"
            style={{
              left: `${swipeScreenX}px`,
              top: `${Math.max(24, esquinasY)}px`,
              height: `${Math.max(48, Math.min(viewport.height - 48, esquinasH))}px`,
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              setIsDraggingSwipe(true)
            }}
            role="slider"
            aria-label={t('Deslizador Antes y Después entre t1 y t2', 'Before-and-after swipe between t1 and t2')}
            aria-valuemin={2}
            aria-valuemax={98}
            aria-valuenow={Math.round(swipePct)}
            tabIndex={0}
            title={t('Arrastra para comparar adquisiciones calculadas de la ROI', 'Drag to compare processed ROI acquisitions')}
          >
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--left">
              ◀ t1 · {displayDate(displayScene.t1)}
            </span>
            <div className="swipe-handle-overlay__knob">↔</div>
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--right">
              t2 · {displayDate(displayScene.t2)} ▶
            </span>
          </div>
        )}

        {/* Lluvia sobre el dominio (tinte, gotas y insignia con lo acumulado; sin gotas con movimiento reducido) mientras la animación DG2 muestra un instante con lluvia */}
        {floodAnimating && floodAnimation!.showRain && activeFlood.showRasterOnMap !== false && !activeFlood.compareMode && activeDockWindow?.kind !== 'sismo' && (
          <RainOverlay mmPerHour={floodAnimation!.rainMmH} soFarMm={floodAnimation!.rainSoFarMm} totalMm={floodAnimation!.rainTotalMm}
            area={floodRainPoints} mapSize={[viewport.width, viewport.height]} />
        )}

        {/* Leyenda de profundidad DG2: las mismas clases que el PNG de vista previa */}
        {(floodAnimating || (hasCurrentFloodResult && activeFlood.rasterUrl)) && activeFlood.showRasterOnMap !== false && !activeFlood.compareMode && activeDockWindow?.kind !== 'sismo' && (
          <FloodDepthLegend />
        )}

        {/* Control interactivo sobre la ROI cuando está activo el Deslizador Comparativo de Inundación */}
        {hasCurrentFloodResult && activeFlood.compareMode && activeFlood.rasterUrl && (
          <div
            className="swipe-handle-overlay swipe-handle-overlay--flood"
            style={{
              left: `${floodSwipeScreenX}px`,
              top: `${Math.max(24, floodY)}px`,
              height: `${Math.max(48, Math.min(viewport.height - 48, floodH))}px`,
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              setIsDraggingFloodSwipe(true)
            }}
            role="slider"
            aria-label={t('Deslizador Comparativo Inundación vs Terreno Original', 'Flood versus original terrain comparison slider')}
            aria-valuemin={2}
            aria-valuemax={98}
            aria-valuenow={Math.round(floodSwipePct)}
            tabIndex={0}
            title={t('Arrastra para comparar Terreno Original (izquierda) vs Inundación Simulada (derecha)', 'Drag to compare original terrain (left) against simulated flooding (right)')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                onFloodChange?.({ ...activeFlood, compareSwipePct: Math.max(2, floodSwipePct - 5) })
              } else if (e.key === 'ArrowRight') {
                onFloodChange?.({ ...activeFlood, compareSwipePct: Math.min(98, floodSwipePct + 5) })
              }
            }}
          >
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--left">
              ◀ {t('Terreno Original', 'Original terrain')}
            </span>
            <div className="swipe-handle-overlay__knob">💧</div>
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--right">
              {t('Inundación', 'Flooding')} ({activeFlood.stats?.durationHours ?? activeFlood.rainfallDuration} h · {activeFlood.rainfallAmount} mm) ▶
            </span>
          </div>
        )}

        {/* 4. BARRA DE ESCALA DE COLOR VERTICAL A LA DERECHA DEL LIENZO (`.comsol-colorbar`) */}
        {((opacity > 0 && activeDockWindow?.kind === 'map') || solar.enabled) && (
          <aside
            className="comsol-colorbar"
          aria-label={activeLayerEntry ? t('Escala radiométrica de la ROI', 'ROI radiometric scale') : t('Sin datos calculados para una ROI', 'No computed data for an ROI')}
        >
          <div className="comsol-colorbar__column">
            <div className="comsol-colorbar__header">
              <span className="comsol-colorbar__symbol">
                {activeLayerEntry ? `${activeLayerEntry.simbolo} ${activeLayerEntry.capa}` : t('Sin datos', 'No data')}
              </span>
              <span className="comsol-colorbar__unit">
                {activeLayerEntry ? `[${activeLayerEntry.unidades} · ${activeColormapSpec.shortLabel}]` : t('Sin datos calculados para una ROI', 'No computed data for an ROI')}
              </span>
            </div>

            <div className="comsol-colorbar__body">
              <div
                className="comsol-colorbar__gradient"
                style={{ background: activeColormapSpec.cssGradientVertical }}
                role="img"
                aria-label={t('Rampa vertical {palette} de {min} dB a {max} dB', 'Vertical {palette} ramp from {min} dB to {max} dB', { palette: localizeText(activeColormapSpec.label), min: vmin, max: vmax })}
              />
              <div className="comsol-colorbar__ticks">
                {activeLayerEntry && colorbarTicks.map((val, idx) => (
                  <div key={idx} className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">
                      {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="comsol-colorbar__footer">
              {activeLayerEntry ? <><span>{t('Máx.', 'Max')}: {activeLayerEntry.rango_datos_dB[1].toFixed(1)}</span><span>{t('Mín.', 'Min')}: {activeLayerEntry.rango_datos_dB[0].toFixed(1)}</span></> : <span>{t('Sin datos calculados para una ROI', 'No computed data for an ROI')}</span>}
            </div>
          </div>

          {solar.enabled && (
            <div className="comsol-colorbar__column comsol-colorbar__column--solar">
              <div className="comsol-colorbar__header">
                <span className="comsol-colorbar__symbol">{t('Radiación', 'Irradiance')}</span>
                <span className="comsol-colorbar__unit">[Inferno · {solar.radiationIntensity}%]</span>
              </div>
              <div className="comsol-colorbar__body">
                <div
                  className="comsol-colorbar__gradient"
                  style={{ background: infernoSpec.cssGradientVertical }}
                  role="img"
                  aria-label={t('Escala vertical de irradiancia solar de menor a mayor (Inferno)', 'Vertical solar irradiance scale from lower to higher (Inferno)')}
                />
                <div className="comsol-colorbar__ticks">
                  <div className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">{t('Mayor', 'Higher')}</span>
                  </div>
                  <div className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">80%</span>
                  </div>
                  <div className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">60%</span>
                  </div>
                  <div className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">40%</span>
                  </div>
                  <div className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">20%</span>
                  </div>
                  <div className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">{t('Menor', 'Lower')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>
        )}

        {/* Chip técnico arriba del mapa cuando hay una región recortada activa */}
        {hasActiveCrop && (
          <div className="crop-active-chip" role="status">
            <span className="crop-active-chip__dot" aria-hidden="true" />
            <span>{t('Subregión ROI recortada activa —', 'Active ROI subset —')}</span>
            <button
              type="button"
              className="crop-active-chip__action"
              onClick={handleResetCroppedRegion}
            >
              {t('[Restablecer vista completa]', '[Restore full view]')}
            </button>
          </div>
        )}

        {/* Botones en el centroide del polígono en construcción */}
        {isEditing && draftPolygon.length >= 3 && draftPolyCentroidScreen && (
          <div
            className="poly-centroid-actions"
            style={{
              left: `${Math.min(Math.max(120, draftPolyCentroidScreen[0]), viewport.width - 140)}px`,
              top: `${Math.min(Math.max(64, draftPolyCentroidScreen[1] + 24), viewport.height - 110)}px`,
            }}
          >
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleApplyCropRegion}
            >
              {t('Cargar ROI y buscar escenas', 'Load ROI and search scenes')}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setDraftPolygon([])}
            >
              {t('Limpiar puntos', 'Clear points')}
            </button>
          </div>
        )}

        {hasAnalysisRoi && (roiLayers.loading || roiLayers.error || !imagesReady) && (
          <div className="roi-loading-backdrop">
            <section className="roi-loading-dialog" role="dialog" aria-modal="true" aria-label={t('Carga de ROI', 'Loading ROI')} aria-busy={roiLayers.loading}>
              <h3>{roiLayers.error ? t('No se pudo cargar la ROI', 'Could not load the ROI') : t('Preparando nueva ROI', 'Preparing new ROI')}</h3>
              <p role="status" aria-live="polite">{localizeText(roiLayers.error || (roiLayers.loading || imagesReady ? roiLayers.message : 'Preparando capas de la ROI…'))}</p>
              {roiLayers.loading && <progress aria-label={t('Carga en curso', 'Loading in progress')} />}
              <p>{t('El servidor consulta ASF y lee por HTTPS los bloques necesarios del H5 con Earthdata.', 'The server searches ASF and reads the required H5 blocks over HTTPS using Earthdata.')}</p>
              {roiLayers.error && <button className="btn" onClick={roiLayers.retry}>{t('Reintentar', 'Retry')}</button>}
              <button className="btn" onClick={handleResetCroppedRegion}>{t('Volver al mapa inicial', 'Return to initial map')}</button>
            </section>
          </div>
        )}
        {/* Input técnico para crear o editar una etiqueta */}
        {labelEditor && labelEditorScreen && (
          <form
            className="label-popover"
            style={{
              left: `${Math.min(Math.max(16, labelEditorScreen[0]), viewport.width - 280)}px`,
              top: `${Math.min(Math.max(56, labelEditorScreen[1]), viewport.height - 110)}px`,
            }}
            onSubmit={handleConfirmLabel}
          >
            <input
              type="text"
              className="label-popover__input"
              value={labelEditor.text}
              maxLength={96}
              onChange={(e) => setLabelEditor({ ...labelEditor, text: e.target.value })}
              placeholder={t('Etiqueta técnica...', 'Technical label...')}
              autoFocus
            />
            <button type="submit" className="btn btn--primary btn--xs">
              {t('Aplicar', 'Apply')}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() => setLabelEditor(null)}
            >
              {t('Cancelar', 'Cancel')}
            </button>
          </form>
        )}

        {/* Cuadro Flotante Arrastrable para Herramientas de Dibujo */}
        {floatingToolsOpen && (
          <aside
            className="ws-floating-toolbox"
            style={{ left: `${toolboxPos.x}px`, top: `${toolboxPos.y}px` }}
            aria-label={t('Herramientas de dibujo flotantes', 'Floating drawing tools')}
          >
            <div
              className="ws-floating-toolbox__handle"
              onMouseDown={(e) => {
                e.preventDefault()
                toolboxDragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: toolboxPos.x,
                  origY: toolboxPos.y,
                }
                setIsDraggingToolbox(true)
              }}
              title={t('Arrastrar caja de herramientas a cualquier esquina del mapa', 'Drag the toolbox to any map corner')}
            >
              <div className="ws-floating-toolbox__handle-title">
                <GripHorizontal size={13} />
                <span>{t('Dibujo y Geometría', 'Drawing and Geometry')}</span>
              </div>
              <div className="ws-floating-toolbox__handle-actions">
                <button
                  type="button"
                  className="ws-floating-toolbox__icon-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setToolboxCollapsed((c) => !c)}
                  title={toolboxCollapsed ? t('Expandir herramientas', 'Expand tools') : t('Minimizar herramientas', 'Minimize tools')}
                >
                  {toolboxCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </button>
                <button
                  type="button"
                  className="ws-floating-toolbox__icon-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={onToggleFloatingTools}
                  title={t('Ocultar caja de herramientas', 'Hide toolbox')}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {!toolboxCollapsed && (
              <div className="ws-floating-toolbox__body">
                {isEditing && <form className="roi-coordinate-form" onSubmit={event => {
                  event.preventDefault()
                  try {
                    const tokens = geometryInput.trim().split(/[,\s]+/)
                    if (tokens.length !== 4 || tokens.some(v => v === '')) throw new Error('Escribe oeste, sur, este, norte.')
                    const values = tokens.map(Number)
                    setDraftPolygon(rectangleFromCorners([values[0], values[1]], [values[2], values[3]]))
                    setGeometryError(null)
                    onSelectTool('poligono')
                  } catch (error) { setGeometryError((error as Error).message) }
                }}>
                  <label htmlFor="roi-coordinates">{t('ROI por geometría: oeste, sur, este, norte', 'ROI by geometry: west, south, east, north')}</label>
                  <input id="roi-coordinates" value={geometryInput} onChange={event => setGeometryInput(event.target.value)} placeholder="−93.1, 16.7, −93.0, 16.8" />
                  <button className="btn btn--sm" type="submit">{t('Dibujar rectángulo', 'Draw rectangle')}</button>
                  <small>{t('O marca dos esquinas en el mapa. Máximo 0.6° por lado.', 'Or mark two corners on the map. Maximum 0.6° per side.')}</small>
                  {geometryError && <p role="alert">{localizeText(geometryError)}</p>}
                </form>}
                {!isEditing && (
                  <div className="ws-floating-toolbox__readonly">
                    {t('Solo lectura: usa', 'Read-only: use')} <strong>{t('+ Duplicar Mapa', '+ Duplicate Map')}</strong> {t('para dibujar.', 'to draw.')}
                  </div>
                )}

                <div className="ws-floating-toolbox__grid">
                  <button
                    type="button"
                    className={`ws-tool-btn ${activeTool === 'mover' ? 'is-active' : ''}`}
                    onClick={() => selectTool('mover')}
                    title={t('Mover lienzo / Seleccionar elementos', 'Pan canvas / Select elements')}
                  >
                    <Hand size={13} />
                    <span>{t('Mover', 'Pan')}</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'lapiz' ? 'is-active' : ''}`}
                    onClick={() => selectTool('lapiz')}
                    disabled={!isEditing}
                    title={t('Dibujar trazo libre', 'Draw freehand stroke')}
                  >
                    <Pencil size={13} />
                    <span>{t('Lápiz', 'Pencil')}</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'peligro' ? 'is-active' : ''}`}
                    onClick={() => selectTool('peligro')}
                    disabled={!isEditing}
                    title={localizeText(DANGER_CIRCLE_TOOLTIP)}
                  >
                    <CircleDot size={13} className="icon-danger" />
                    <span>{t('Círculo rojo', 'Red circle')}</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'advertencia' ? 'is-active' : ''}`}
                    onClick={() => selectTool('advertencia')}
                    disabled={!isEditing}
                    title={localizeText(WARN_CIRCLE_TOOLTIP)}
                  >
                    <CircleDot size={13} className="icon-warn" />
                    <span>{t('Círculo ámbar', 'Amber circle')}</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'poligono' ? 'is-active' : ''}`}
                    onClick={() => selectTool('poligono')}
                    disabled={!isEditing}
                    title={t('Dos clics: esquinas opuestas de una ROI rectangular', 'Two clicks: opposite corners of a rectangular ROI')}
                  >
                    <Pentagon size={13} />
                    <span>{t('ROI rectangular · 2 puntos', 'Rectangular ROI · 2 points')}</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'etiqueta' ? 'is-active' : ''}`}
                    onClick={() => selectTool('etiqueta')}
                    disabled={!isEditing}
                    title={t('Insertar o editar etiqueta técnica', 'Insert or edit technical label')}
                  >
                    <Tag size={13} />
                    <span>{t('Etiqueta', 'Label')}</span>
                  </button>
                </div>

                <div className="ws-floating-toolbox__footer">
                  <button
                    type="button"
                    className="ws-tool-btn"
                    onClick={handleUndoLastDrawing}
                    disabled={!isEditing || (annotations.length === 0 && draftPolygon.length === 0)}
                    title={t('Deshacer último trazo o vértice', 'Undo last stroke or vertex')}
                  >
                    <Undo2 size={12} />
                    <span>{t('Deshacer', 'Undo')}</span>
                  </button>
                  <button
                    type="button"
                    className="ws-tool-btn ws-tool-btn--danger"
                    onClick={() => selectedAnnotation && handleDeleteAnnotation(selectedAnnotation.id)}
                    disabled={!selectedAnnotation}
                    title={t('Eliminar elemento seleccionado', 'Delete selected element')}
                  >
                    <Trash size={12} />
                    <span>{t('Eliminar', 'Delete')}</span>
                  </button>
                  <button
                    type="button"
                    className="ws-tool-btn"
                    onClick={handleClearAllDrawings}
                    disabled={
                      !isEditing ||
                      (annotations.length === 0 && !hasActiveCrop && draftPolygon.length === 0)
                    }
                    title={t('Limpiar todos los dibujos y recortes', 'Clear all drawings and subsets')}
                  >
                    <Trash size={12} />
                    <span>{t('Limpiar', 'Clear')}</span>
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* Modo de selección rectangular para Capturar Región (PNG / JPG) */}
        {isCaptureMode && (
          <div
            className="ws-capture-overlay"
            onMouseDown={(e) => {
              const stage = mapStageRef.current
              if (!stage) return
              const rect = stage.getBoundingClientRect()
              const x = e.clientX - rect.left
              const y = e.clientY - rect.top
              setCaptureDragStart({ x, y })
              setCaptureRect({ x, y, w: 0, h: 0 })
            }}
            onMouseMove={(e) => {
              if (!captureDragStart) return
              const stage = mapStageRef.current
              if (!stage) return
              const rect = stage.getBoundingClientRect()
              const curX = Math.min(rect.width, Math.max(0, e.clientX - rect.left))
              const curY = Math.min(rect.height, Math.max(0, e.clientY - rect.top))
              setCaptureRect({
                x: Math.min(captureDragStart.x, curX),
                y: Math.min(captureDragStart.y, curY),
                w: Math.abs(curX - captureDragStart.x),
                h: Math.abs(curY - captureDragStart.y),
              })
            }}
            onMouseUp={() => {
              if (captureRect && captureRect.w >= 20 && captureRect.h >= 20) {
                void executeRegionCapture(captureRect)
              } else {
                setCaptureDragStart(null)
                setCaptureRect(null)
              }
            }}
          >
            <div className="ws-capture-banner" onMouseDown={(e) => e.stopPropagation()}>
              <Camera size={14} />
              <span>{t('Arrastra un recuadro sobre la región simulada o captura la vista completa:', 'Drag a rectangle over the simulated region or capture the full view:')}</span>
              <button
                type="button"
                className="ws-tool-btn is-active"
                onClick={() => void executeRegionCapture()}
              >
                {t('Capturar Vista Completa', 'Capture Full View')}
              </button>
              <button
                type="button"
                className="ws-tool-btn"
                onClick={() => {
                  setCaptureDragStart(null)
                  setCaptureRect(null)
                  onCancelCaptureMode()
                }}
              >
                {t('Cancelar', 'Cancel')}
              </button>
            </div>

            {captureRect && captureRect.w > 2 && captureRect.h > 2 && (
              <div
                className="ws-capture-selection"
                style={{
                  left: `${captureRect.x}px`,
                  top: `${captureRect.y}px`,
                  width: `${captureRect.w}px`,
                  height: `${captureRect.h}px`,
                }}
              >
                <span>
                  {Math.round(captureRect.w)} × {Math.round(captureRect.h)} px
                </span>
              </div>
            )}
          </div>
        )}

        {/* Modal de previsualización y descarga de imagen PNG / JPG */}
        {captureModal && (
          <div className="ws-capture-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('Guardar captura del mapa', 'Save map capture')}>
            <div className="ws-capture-modal">
              <div className="ws-capture-modal__header">
                <strong>
                  <Camera size={14} /> {t('Previsualización de Captura', 'Capture Preview')} ({captureModal.width} × {captureModal.height} px)
                </strong>
                <button
                  type="button"
                  className="ws-floating-toolbox__icon-btn"
                  onClick={() => setCaptureModal(null)}
                >
                  <X size={14} />
                </button>
              </div>

              <div className="ws-capture-modal__preview">
                <img src={captureModal.previewUrl} alt={t('Previsualización de región capturada', 'Captured region preview')} />
              </div>

              <div className="ws-capture-modal__controls">
                <label>
                  <span>{t('Nombre del archivo', 'File name')}</span>
                  <input
                    type="text"
                    value={captureModal.filename}
                    onChange={(e) =>
                      setCaptureModal((prev) => (prev ? { ...prev, filename: e.target.value } : null))
                    }
                  />
                </label>

                <label>
                  <span>{t('Formato', 'Format')}</span>
                  <select
                    value={captureModal.format}
                    onChange={(e) => {
                      const fmt = e.target.value as 'png' | 'jpeg'
                      setCaptureModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              format: fmt,
                              previewUrl:
                                fmt === 'png'
                                  ? prev.canvas.toDataURL('image/png')
                                  : prev.canvas.toDataURL('image/jpeg', prev.quality),
                            }
                          : null,
                      )
                    }}
                  >
                    <option value="png">{t('PNG (sin pérdida)', 'PNG (lossless)')}</option>
                    <option value="jpeg">{t('JPG (comprimido)', 'JPG (compressed)')}</option>
                  </select>
                </label>

                {captureModal.format === 'jpeg' && (
                  <label>
                    <span>{t('Calidad JPG', 'JPG quality')}: {Math.round(captureModal.quality * 100)}%</span>
                    <input
                      type="range"
                      min={0.6}
                      max={1}
                      step={0.02}
                      value={captureModal.quality}
                      onChange={(e) => {
                        const q = Number(e.target.value)
                        setCaptureModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                quality: q,
                                previewUrl: prev.canvas.toDataURL('image/jpeg', q),
                              }
                            : null,
                        )
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="ws-capture-modal__actions">
                <button
                  type="button"
                  className="ws-tool-btn"
                  onClick={() => setCaptureModal(null)}
                >
                  {t('Cerrar', 'Close')}
                </button>
                <button
                  type="button"
                  className="ws-ribbon__btn ws-ribbon__btn--primary"
                  onClick={handleDownloadCapture}
                >
                  <Download size={14} />
                  <span>{t('Descargar', 'Download')} .{captureModal.format === 'png' ? 'png' : 'jpg'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Panel superpuesto compacto y colapsable de Simulación Lluvia / DG2 sobre el mapa */}
        {isDg2 && (
          <RainDg2Panel
            flood={activeFlood}
            onFloodChange={onFloodChange || (() => {})}
            croppedRegion={croppedRegion}
            onFlyToZone={handleFlyToZone}
            onSelectPresetROI={onSelectPresetROI}
            onAnimationChange={setFloodAnimation}
            onClose={() => {
              const mapTab = dockWindows.find((w) => w.kind === 'map')
              if (mapTab) onActivateDockWindow(mapTab.id)
            }}
          />
        )}

        {/* Panel superpuesto de Simulación Sísmica y Terremoto */}
        {isSeismic && (
          <SeismicSimulatorPanel
            seismic={seismic || DEFAULT_SEISMIC}
            onSeismicChange={onSeismicChange || (() => {})}
            croppedRegion={croppedRegion}
            onSelectPresetROI={onSelectPresetROI}
            onFlyToEpicenter={(coord) => {
              if (mapRef.current) {
                mapRef.current.flyTo({ center: coord, zoom: 7.5, duration: 1200 })
              }
            }}
            onClose={() => {
              const mapTab = dockWindows.find((w) => w.kind === 'map')
              if (mapTab) onActivateDockWindow(mapTab.id)
              onSeismicChange?.({ ...(seismic || DEFAULT_SEISMIC), enabled: false })
            }}
          />
        )}

        {/* Panel derecho acoplable/flotante de Simulación Solar */}
        {solar.enabled && !isDg2 && (
          <RightPanel
            solar={solar}
            onSolarChange={onSolarChange}
            onClose={() => onSolarChange({ ...solar, enabled: false })}
            center={view.centro}
            croppedRegion={croppedRegion}
            onFlyToZone={handleFlyToZone}
            onSelectPresetROI={onSelectPresetROI}
            roiLayers={roiLayers}
          />
        )}
      </div>

      {/* 5. PANEL INFERIOR COLAPSABLE DE BITÁCORA Y TRAZABILIDAD ("Messages / Progress / Traceability Log") */}
      <section
        className={`workstation-log-panel ${logPanelCollapsed ? 'is-collapsed' : ''}`}
        aria-label={t('Mensajes / Progreso / Registro de trazabilidad', 'Messages / Progress / Traceability Log')}
      >
        <div className="ws-panel-tabbar workstation-log-panel__tabbar">
          <div className="workstation-log-panel__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={logActiveTab === 'trace'}
              className={`ws-panel-tab ${logActiveTab === 'trace' ? 'is-active' : ''}`}
              onClick={() => {
                setLogActiveTab('trace')
                setLogPanelCollapsed(false)
              }}
            >
              <Terminal size={12} aria-hidden="true" />
              <span>{t('Mensajes / Progreso / Registro de trazabilidad', 'Messages / Progress / Traceability Log')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={logActiveTab === 'layers'}
              className={`ws-panel-tab ${logActiveTab === 'layers' ? 'is-active' : ''}`}
              onClick={() => {
                setLogActiveTab('layers')
                setLogPanelCollapsed(false)
              }}
            >
              <span>{t('Manifiesto explore-web-1 (capas.json)', 'explore-web-1 manifest (capas.json)')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={logActiveTab === 'warnings'}
              className={`ws-panel-tab ${logActiveTab === 'warnings' ? 'is-active' : ''}`}
              onClick={() => {
                setLogActiveTab('warnings')
                setLogPanelCollapsed(false)
              }}
            >
              <span>
                {t('Advertencias Radiométricas', 'Radiometric warnings')} ({activeManifest?.advertencias.length ?? 0})
              </span>
            </button>
          </div>

          <div className="workstation-log-panel__actions">
            {dateViewMode === 'swipe' && imagesReady && roiLayers.comparable && (
              <label className="workstation-log-panel__swipe-inline">
                <span>{t('Deslizador t1↔t2:', 'Swipe t1↔t2:')} {Math.round(swipePct)}%</span>
                <input
                  type="range"
                  min={2}
                  max={98}
                  step={1}
                  value={swipePct}
                  onChange={(e) => setSwipePct(Number(e.target.value))}
                />
              </label>
            )}
            <button
              type="button"
              className="workstation-log-panel__toggle"
              onClick={() => setLogPanelCollapsed((prev) => !prev)}
              title={logPanelCollapsed ? t('Expandir panel de bitácora', 'Expand log panel') : t('Colapsar panel de bitácora', 'Collapse log panel')}
            >
              {logPanelCollapsed ? t('▲ Expandir Log', '▲ Expand Log') : t('▼ Colapsar', '▼ Collapse')}
            </button>
          </div>
        </div>

        {!logPanelCollapsed && (
          <div className="workstation-log-panel__content">
            {logActiveTab === 'trace' && (
              <div className="ws-log-grid">
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">{t('GRÁNULO t1', 'GRANULE t1')}</span>
                  <code className="ws-mono">{manifestT1?.escena.granuleId ?? t('Sin datos', 'No data')}</code>
                  <span className="ws-log-sep">|</span>
                  <span>
                    CRID: <strong>{manifestT1?.escena.crid ?? t('Sin datos', 'No data')}</strong> ({manifestT1?.escena.madurez_catalogo ?? t('Sin datos', 'No data')}) · {t('Píxeles válidos ROI', 'Valid ROI pixels')}:{' '}
                    <strong>
                      {layerT1 ? `${layerT1.pct_pixeles_validos.toFixed(2)}%` : t('Sin datos', 'No data')}
                    </strong>{' '}
                    · {t('Rango COG', 'COG range')}:{' '}
                    <code className="ws-mono">
                      {layerT1
                        ? `[${layerT1.rango_datos_dB[0].toFixed(2)}, +${layerT1.rango_datos_dB[1].toFixed(2)} dB]`
                        : t('Sin datos', 'No data')}
                    </code>
                  </span>
                </div>

                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">{t('GRÁNULO t2', 'GRANULE t2')}</span>
                  <code className="ws-mono">{manifestT2?.escena.granuleId ?? t('Sin datos', 'No data')}</code>
                  <span className="ws-log-sep">|</span>
                  <span>
                    CRID: <strong>{manifestT2?.escena.crid ?? t('Sin datos', 'No data')}</strong> ({manifestT2?.escena.madurez_catalogo ?? t('Sin datos', 'No data')}) · {t('Píxeles válidos ROI', 'Valid ROI pixels')}:{' '}
                    <strong>
                      {layerT2 ? `${layerT2.pct_pixeles_validos.toFixed(2)}%` : t('Sin datos', 'No data')}
                    </strong>{' '}
                    · {t('Rango COG', 'COG range')}:{' '}
                    <code className="ws-mono">
                      {layerT2
                        ? `[${layerT2.rango_datos_dB[0].toFixed(2)}, +${layerT2.rango_datos_dB[1].toFixed(2)} dB]`
                        : t('Sin datos', 'No data')}
                    </code>
                  </span>
                </div>

                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--warn">{t('CALIBRACIÓN', 'CALIBRATION')}</span>
                  <span>{t('Sin banderas de procesamiento disponibles en el manifiesto ROI.', 'No processing flags are available in the ROI manifest.')}</span>
                  <span className="ws-log-sep">|</span>
                  {scaleCheck && (
                    <span className={scaleCheck.valid ? 'ws-log-ok' : 'ws-log-warn'}>
                      {scaleCheck.valid ? '✓ ' : '⚠️ '}
                      {localizeText(scaleCheck.message)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {logActiveTab === 'layers' && activeLayerEntry && (
              <div className="ws-log-grid">
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">{t('CAPA ACTIVA', 'ACTIVE LAYER')}</span>
                  <strong>{activeLayerEntry.id}:</strong> {localizeText(activeLayerOption.title)} · {t('Paleta LUT', 'LUT palette')}:{' '}
                  <strong>{localizeText(activeColormapSpec.label)}</strong>
                </div>
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">{t('PNG WEB', 'WEB PNG')}</span>
                  <code className="ws-mono">/{activeLayerEntry.png}</code> (
                  {activeLayerEntry.forma_png[1]}×{activeLayerEntry.forma_png[0]} px ·{' '}
                  {activeLayerEntry.crs_png}) ·{' '}
                  <span className="ws-log-tag ws-log-tag--info">COG</span>{' '}
                  <code className="ws-mono">/{activeLayerEntry.cog}</code> (
                  {activeLayerEntry.forma_cog[1]}×{activeLayerEntry.forma_cog[0]} px ·{' '}
                  {activeLayerEntry.crs_cog})
                </div>
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">{t('PROCEDENCIA', 'PROVENANCE')}</span>
                  <span>
                    {t('Modo', 'Mode')}: <code>{activeManifest?.procedencia.modo ? localizeText(activeManifest.procedencia.modo) : t('Sin datos', 'No data')}</code> · {t('Método', 'Method')}:{' '}
                    <code>{activeManifest?.procedencia.metodo ? localizeText(activeManifest.procedencia.metodo) : t('Sin datos', 'No data')}</code> ·
                    {t('Identidad verificada contra catálogo ASF', 'Identity verified against ASF catalog')}:{' '}
                    <code>
                      {activeManifest ? t(activeManifest.procedencia.identidad_verificada_contra_catalogo ? 'Sí' : 'No', activeManifest.procedencia.identidad_verificada_contra_catalogo ? 'Yes' : 'No') : t('Sin datos', 'No data')}
                    </code>
                  </span>
                </div>
              </div>
            )}

            {logActiveTab === 'warnings' && (
              <ul className="ws-log-warnings">
                {(activeManifest?.advertencias ?? []).map((adv, idx) => (
                  <li key={idx}>{localizeText(adv)}</li>
                ))}
                {!activeManifest && <li>{t('Sin datos calculados para la ROI.', 'No computed data for the ROI.')}</li>}
              </ul>
            )}
          </div>
        )}
      </section>
      </div>
    </main>
  )
}
