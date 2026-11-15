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
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Crosshair,
  Download,
  Droplets,
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
  CHIAPAS_CENTRO,
  CHIAPAS_ZOOM,
  DEFAULT_FLOOD,
  DANGER_CIRCLE_DEFAULT_LABEL,
  DANGER_CIRCLE_TOOLTIP,
  DEFAULT_EXPLORE_ESQUINAS_LONLAT,
  EXPLORE_LAYER_OPTIONS,
  NISAR_FOOTPRINT,
  NISAR_IMAGE_URL,
  WARN_CIRCLE_DEFAULT_LABEL,
  WARN_CIRCLE_TOOLTIP,
  buildDg2EligibilityGeoJSON,
  type Dg2SectorId,
  type ExploreDateViewMode,
  type ExploreLayerId,
  type ExploreWebManifest,
} from '../mocks/initialWorkspaces'
import { fetchExploreManifest, verifyExploreScaleMatch } from '../api/client'
import { useRoiLayers } from '../hooks/useRoiLayers'
import { rectangleFromCorners } from '../utils/roi'
import {
  colorizePngWithLut,
  getColormapSpec,
  type ScientificColormapId,
} from '../utils/colormapLut'
import { RainDg2Panel } from './RainDg2Panel'
import { RightPanel } from './RightPanel'
import type {
  DockWindow,
  DockWindowKind,
  DrawTool,
  EscenaNisar,
  FloodSimulationState,
  LngLat,
  MapAnnotation,
  MapView,
  SolarSimulationState,
} from '../types/workspace'
import {
  buildAnnotationsGeoJSON,
  buildDraftPolygonGeoJSON,
  buildInverseCropMaskGeoJSON,
  createCirclePolygonCoords,
  distanceKm,
  getPolygonBoundsAndCentroid,
  interpolateThermalHighlight,
} from '../utils/geojson'
import { newId } from '../utils/id'

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

const DG2_SOURCE = 'dg2-eligibility-source'
const DG2_FILL_LAYER = 'dg2-eligibility-fill'
const DG2_LINE_LAYER = 'dg2-eligibility-line'

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
    [NISAR_SOURCE]: {
      type: 'image',
      url: NISAR_IMAGE_URL,
      coordinates: DEFAULT_EXPLORE_ESQUINAS_LONLAT,
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
    {
      id: NISAR_LAYER,
      type: 'raster',
      source: NISAR_SOURCE,
      paint: {
        'raster-opacity': 0.78,
        'raster-resampling': 'linear',
        'raster-fade-duration': 0,
      },
    },
  ],
}

const FOOTPRINT_GEOJSON = {
  type: 'Feature' as const,
  properties: { descripcion: 'Huella de la escena NISAR en Chiapas' },
  geometry: { type: 'Polygon' as const, coordinates: [[...NISAR_FOOTPRINT, NISAR_FOOTPRINT[0]]] },
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
    return ann.points[midIdx] ?? ann.points[0] ?? CHIAPAS_CENTRO
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
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapStageRef = useRef<HTMLDivElement>(null)
  const svgOverlayRef = useRef<SVGSVGElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [viewport, setViewport] = useState<ViewportMetrics>({
    centro: view.centro,
    zoom: view.zoom,
    width: 960,
    height: 640,
  })

  // Estado del cuadro flotante arrastrable de herramientas de dibujo
  const [toolboxPos, setToolboxPos] = useState<{ x: number; y: number }>({ x: 14, y: 14 })
  const [toolboxCollapsed, setToolboxCollapsed] = useState(false)
  // Menú del botón «+» para agregar ventanas al área central
  const [newWindowMenuOpen, setNewWindowMenuOpen] = useState(false)
  const toolboxDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [isDraggingToolbox, setIsDraggingToolbox] = useState(false)

  // Sector seleccionado en el modo Simulación Lluvia / DG2
  const dg2SectorId: Dg2SectorId = 'grijalva-chicoasen'
  const activeFlood = flood || DEFAULT_FLOOD

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
  const [defaultT1, setManifestT1] = useState<ExploreWebManifest | null>(null)
  const [defaultT2, setManifestT2] = useState<ExploreWebManifest | null>(null)
  const manifestT1 = croppedRegion ? roiLayers.manifests[0] ?? null : defaultT1
  const manifestT2 = croppedRegion ? roiLayers.manifests[1] ?? null : defaultT2
  const [geometryInput, setGeometryInput] = useState('')
  const [geometryError, setGeometryError] = useState<string | null>(null)
  const [colorizedT1Url, setColorizedT1Url] = useState<string>(NISAR_IMAGE_URL)
  const [colorizedT2Url, setColorizedT2Url] = useState<string>(NISAR_IMAGE_URL)
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
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapRef.current = map

    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left')
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-left')

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
            text: 'Zona de interés',
            targetAnnotationId: null,
          })
        }
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

      // A. Huella GeoJSON + Fuente `nisar-radar`
      try {
        if (!map.getSource(FOOTPRINT_SOURCE)) {
          map.addSource(FOOTPRINT_SOURCE, { type: 'geojson', data: FOOTPRINT_GEOJSON })
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

        if (!map.getSource(DG2_SOURCE)) {
          map.addSource(DG2_SOURCE, {
            type: 'geojson',
            data: buildDg2EligibilityGeoJSON('grijalva-chicoasen'),
          })
          map.addLayer({
            id: DG2_FILL_LAYER,
            type: 'fill',
            source: DG2_SOURCE,
            layout: { visibility: 'none' },
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'tipo'], 'excluida'],
                '#EF4444',
                ['==', ['get', 'id'], 'grijalva-chicoasen'],
                '#0EA5E9',
                '#10B981',
              ],
              'fill-opacity': [
                'case',
                ['boolean', ['get', 'selected'], false],
                0.42,
                0.22,
              ],
            },
          })
          map.addLayer({
            id: DG2_LINE_LAYER,
            type: 'line',
            source: DG2_SOURCE,
            layout: { visibility: 'none' },
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'tipo'], 'excluida'],
                '#DC2626',
                ['==', ['get', 'id'], 'grijalva-chicoasen'],
                '#0284C7',
                '#059669',
              ],
              'line-width': [
                'case',
                ['boolean', ['get', 'selected'], false],
                3,
                1.6,
              ],
              'line-dasharray': [3, 2],
            },
          })
        }

        if (!map.getSource(NISAR_SOURCE)) {
          map.addSource(NISAR_SOURCE, {
            type: 'image',
            url: NISAR_IMAGE_URL,
            coordinates: DEFAULT_EXPLORE_ESQUINAS_LONLAT,
          })
          map.addLayer({
            id: NISAR_LAYER,
            type: 'raster',
            source: NISAR_SOURCE,
            paint: {
              'raster-opacity': alpha,
              'raster-resampling': 'linear',
              'raster-fade-duration': 0,
            },
          })
        } else if (map.getLayer(NISAR_LAYER)) {
          map.setPaintProperty(NISAR_LAYER, 'raster-opacity', alpha)
          map.setPaintProperty(NISAR_LAYER, 'raster-resampling', 'linear')
        }
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
      mapRef.current = null
    }
  }, [])

  // Consultar `/data/explore/<granuleId>/web/capas.json` (`explore-web-1`) para t1 y t2
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchExploreManifest(escena.t1SceneId),
      fetchExploreManifest(escena.t2SceneId),
    ]).then(([m1, m2]) => {
      if (cancelled) return
      setManifestT1(m1)
      setManifestT2(m2)
    }).catch(() => {
      if (!cancelled) { setManifestT1(null); setManifestT2(null) }
    })
    return () => {
      cancelled = true
    }
  }, [escena.t1SceneId, escena.t2SceneId])

  const displayScene = croppedRegion ? {
    ...escena,
    t1: manifestT1?.escena.fecha_inicio?.slice(0, 10) ?? 'Sin datos',
    t2: manifestT2?.escena.fecha_inicio?.slice(0, 10) ?? 'Sin segunda fecha',
    t1SceneId: manifestT1?.escena.granuleId ?? 'Sin datos',
    t2SceneId: manifestT2?.escena.granuleId ?? 'Sin datos',
    crid: manifestT1?.escena.crid ?? 'Sin datos',
    madurez: manifestT1?.escena.madurez_catalogo ?? 'Desconocida',
  } : escena

  const activeLayerOption =
    EXPLORE_LAYER_OPTIONS.find((opt) => opt.id === exploreLayerId) ?? EXPLORE_LAYER_OPTIONS[0]

  const layerT1 =
    manifestT1?.capas.find((c) => c.id === exploreLayerId) ?? (croppedRegion ? null : manifestT1?.capas[0]) ?? null
  const layerT2 =
    manifestT2?.capas.find((c) => c.id === exploreLayerId) ?? (croppedRegion ? null : manifestT2?.capas[0]) ?? null
  const layerKey = `${layerT1?.png}|${layerT2?.png}|${colormapId}`
  const imagesReady = colorizedKey === layerKey

  const activeManifest = dateViewMode === 't1' ? manifestT1 : manifestT2
  const activeLayerEntry = dateViewMode === 't1' ? layerT1 : layerT2

  const scaleCheck =
    manifestT1 && manifestT2 ? verifyExploreScaleMatch(manifestT1, manifestT2, exploreLayerId) : null

  const activeColormapSpec = getColormapSpec(colormapId)
  const infernoSpec = getColormapSpec('inferno')

  // Colorear dinámicamente los PNG oficiales en EPSG:3857 usando la tabla LUT de 256 colores (Inferno por defecto)
  useEffect(() => {
    let cancelled = false
    const rawT1 = layerT1 ? `/${layerT1.png}` : NISAR_IMAGE_URL
    const rawT2 = layerT2 ? `/${layerT2.png}` : NISAR_IMAGE_URL

    Promise.all([
      colorizePngWithLut(rawT1, colormapId),
      colorizePngWithLut(rawT2, colormapId),
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
    // En modo Swipe (t1 ↔ t2) las dos capas coloreadas se dibujan con recorte sincronizado en EPSG:3857
    const webglOpacity = dateViewMode === 'swipe' || !activeLayerEntry || !imagesReady || (croppedRegion && roiLayers.loading) ? 0 : alpha

    if (map.getLayer(NISAR_LAYER)) {
      map.setPaintProperty(NISAR_LAYER, 'raster-opacity', webglOpacity)
      map.setPaintProperty(NISAR_LAYER, 'raster-resampling', 'linear')
    }
    if (map.getLayer(FOOTPRINT_FILL_LAYER)) {
      map.setPaintProperty(FOOTPRINT_FILL_LAYER, 'fill-opacity', alpha * 0.03)
    }
  }, [opacity, dateViewMode, mapReady, activeLayerEntry, croppedRegion, roiLayers.loading, imagesReady])

  // Actualizar fuente `image` de MapLibre con el BlobURL/DataURL coloreado por LUT y `capa.esquinas_lonlat` (EPSG:3857)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !activeLayerEntry || !activeColorizedUrl || !imagesReady) return
    const imgSource = map.getSource(NISAR_SOURCE) as ImageSource | undefined
    if (imgSource && typeof imgSource.updateImage === 'function') {
      try {
        imgSource.updateImage({
          url: activeColorizedUrl,
          coordinates: activeLayerEntry.esquinas_lonlat,
        })
      } catch (err) {
        console.warn('No se pudo actualizar la capa raster NISAR coloreada:', err)
      }
    }
  }, [activeLayerEntry, activeColorizedUrl, mapReady, imagesReady])

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

  // Sincronizar fuente GeoJSON `crop-mask-source`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const hasCrop = Array.isArray(croppedRegion) && croppedRegion.length >= 3
    const source = map.getSource(CROP_MASK_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(buildInverseCropMaskGeoJSON(hasCrop ? croppedRegion : null) as never)
    }
    if (map.getLayer(CROP_MASK_FILL_LAYER)) {
      map.setPaintProperty(CROP_MASK_FILL_LAYER, 'fill-opacity', hasCrop ? 0.65 : 0)
    }
  }, [croppedRegion, mapReady])

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
      Boolean(activeFlood.rasterUrl) &&
      Array.isArray(activeFlood.rasterBounds) &&
      activeFlood.rasterBounds.length === 4 &&
      activeFlood.showRasterOnMap !== false

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
        text: 'Trazo marcado',
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
      map.flyTo(
        { center: CHIAPAS_CENTRO, zoom: CHIAPAS_ZOOM, duration: 900, essential: true },
        { programmatic: true },
      )
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
  const croppedScreenPts = hasActiveCrop
    ? croppedRegion.map((pt) => projectLngLat(pt, viewport))
    : null
  const croppedPolygonPointsAttr = croppedScreenPts
    ? croppedScreenPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    : ''
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
    DEFAULT_EXPLORE_ESQUINAS_LONLAT
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
    mapRef.current?.flyTo({
      center: CHIAPAS_CENTRO,
      zoom: CHIAPAS_ZOOM,
      duration: 500,
    })
  }

  // Ventana activa del área central: define la vista y la etiqueta de la pestaña.
  const activeDockWindow = dockWindows.find((w) => w.id === activeDockWindowId) ?? dockWindows[0]
  const isDg2 = activeDockWindow?.kind === 'agua'
  const activeDockLabel = activeDockWindow
    ? activeDockWindow.kind === 'agua'
      ? `Agua / DG2 ${activeDockWindow.index}`
      : `Graphics / Map Plot ${activeDockWindow.index}`
    : 'Graphics / Map Plot 1'

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

  // Sincronizar polígonos vectoriales de elegibilidad no urbana cuando está activa la ventana de agua/DG2
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const visibility = isDg2 ? 'visible' : 'none'
    try {
      if (map.getLayer(DG2_FILL_LAYER)) {
        map.setLayoutProperty(DG2_FILL_LAYER, 'visibility', visibility)
      }
      if (map.getLayer(DG2_LINE_LAYER)) {
        map.setLayoutProperty(DG2_LINE_LAYER, 'visibility', visibility)
      }
      const src = map.getSource(DG2_SOURCE) as GeoJSONSource | undefined
      if (src) {
        src.setData(buildDg2EligibilityGeoJSON(dg2SectorId))
      }
    } catch {
      // Ignorar si el estilo aún no termina de cargar
    }
  }, [mapReady, isDg2, dg2SectorId])

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
    <main className="ws-center-dock" aria-label="Área Central de Estación de Trabajo">
      {/* 1. Cabecera de ventanas acopladas (Map Plots y ventanas de agua/DG2) + botón «+» */}
      <div className="ws-panel-tabbar" role="tablist" aria-label="Ventanas del área central">
        <div className="ws-panel-tabbar__tabs">
          {dockWindows.map((win) => {
            const isActive = win.id === activeDockWindow?.id
            const isAgua = win.kind === 'agua'
            const label = isAgua
              ? `Agua / DG2 ${win.index}`
              : `Graphics / Map Plot ${win.index}`
            return (
              <div
                key={win.id}
                className={`ws-panel-tab-group${isAgua ? ' ws-panel-tab-group--hydro' : ''}${
                  isActive ? ' is-active' : ''
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`ws-panel-tab${isAgua ? ' ws-panel-tab--hydro' : ''}${
                    isActive ? ' is-active' : ''
                  }`}
                  title={label}
                  onClick={() => onActivateDockWindow(win.id)}
                >
                  {isAgua ? (
                    <Droplets size={13} aria-hidden="true" />
                  ) : (
                    <Monitor size={13} aria-hidden="true" />
                  )}
                  <span>{label}</span>
                </button>
                <button
                  type="button"
                  className="ws-panel-tab__close"
                  aria-label={`Cerrar ${label}`}
                  title={
                    dockWindows.length <= 1
                      ? 'Debe quedar al menos una ventana'
                      : `Cerrar ${label}`
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
              aria-label="Agregar ventana"
              aria-haspopup="menu"
              aria-expanded={newWindowMenuOpen}
              title="Agregar ventana"
              onClick={() => setNewWindowMenuOpen((prev) => !prev)}
            >
              <Plus size={13} aria-hidden="true" />
            </button>
            {newWindowMenuOpen && (
              <div className="ws-window-menu" role="menu" aria-label="Tipo de ventana">
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
                    Mapa normal
                    <em>Graphics / Map Plot</em>
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
                    Ventana de agua
                    <em>Agua / DG2</em>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="ws-panel-tabbar__summary">
          <span className="ws-mono">
            {isEditing && activeMapName ? activeMapName : 'Mapa General (Solo lectura)'}
          </span>
          <span>·</span>
          <span className="ws-mono">
            {activeLayerOption.shortLabel} [{activeColormapSpec.shortLabel}]
          </span>
          <span>·</span>
          <span className="ws-mono">
            {dateViewMode === 'swipe'
              ? `Swipe t1 (${displayScene.t1}) ↔ t2 (${displayScene.t2})`
              : dateViewMode === 't1'
                ? `t1 = ${displayScene.t1}`
                : `t2 = ${displayScene.t2}`}
          </span>
          <span>·</span>
          <span className="ws-mono">
            Centro: [{viewport.centro[0].toFixed(4)}, {viewport.centro[1].toFixed(4)}] · z=
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
            aria-label={`Barra de acciones del lienzo ${activeDockLabel}`}
          >
            <div className="ws-graphics-toolbar__group">
              <button
                type="button"
                className={`ws-tool-btn ${floatingToolsOpen ? 'is-active' : ''}`}
                onClick={onToggleFloatingTools}
                title="Mostrar/ocultar cuadro flotante arrastrable de herramientas de dibujo"
              >
                <PencilRuler size={13} />
                <span>{floatingToolsOpen ? 'Ocultar Caja de Dibujo' : 'Mostrar Caja de Dibujo'}</span>
              </button>

              <button
                type="button"
                className={`ws-tool-btn ${isCaptureMode ? 'is-active' : ''}`}
                onClick={() => (isCaptureMode ? onCancelCaptureMode() : onStartCaptureMode())}
                title="Seleccionar región del mapa simulado y guardar PNG / JPG"
              >
                <Camera size={13} />
                <span>{isCaptureMode ? 'Cancelar Captura' : 'Capturar Región (PNG/JPG)'}</span>
              </button>

              <button
                type="button"
                className="ws-tool-btn"
                onClick={handleCenterRoi}
                title="Centrar vista sobre la ROI activa"
              >
                <Crosshair size={13} />
                <span>Centrar ROI</span>
              </button>
            </div>

            <div className="ws-graphics-toolbar__right">
              <span className="ws-mono" style={{ fontSize: 11, color: '#475569' }}>
                {isEditing ? `Herramienta activa: ${activeTool}` : 'Vista de solo lectura (duplica el mapa para editar)'}
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
          {dateViewMode === 'swipe' && imagesReady && layerT1 && layerT2 && opacity > 0 && (!croppedRegion || roiLayers.comparable) && (
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
          {activeFlood.compareMode && activeFlood.rasterUrl && (
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

          {/* Delimitación exacta del polígono ROI oficial de Chiapas (2687 × 5504 px a 10 m en EPSG:32615) */}
          <polygon
            points={(croppedRegion ?? NISAR_FOOTPRINT).map((pt) => projectLngLat(pt, viewport))
              .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
              .join(' ')}
            fill="rgba(51, 153, 255, 0.02)"
            stroke="#3399FF"
            strokeWidth={1.6}
            strokeDasharray="6 4"
            style={{ pointerEvents: 'none' }}
          />

          {/* Máscara inversa de recorte (`croppedRegion`) */}
          {croppedScreenPts && (
            <g>
              <path
                d={croppedInversePathAttr}
                fill="#CBD5E1"
                fillOpacity={0.72}
                fillRule="evenodd"
              />
              <polygon
                points={croppedPolygonPointsAttr}
                fill="none"
                stroke="#3399FF"
                strokeWidth={2.4}
                strokeDasharray="8 5"
              />
            </g>
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
                  title={ann.kind === 'peligro' ? DANGER_CIRCLE_TOOLTIP : WARN_CIRCLE_TOOLTIP}
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
                  {ann.label}
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
              ✏️ Editar etiqueta
            </button>
            <span className="selection-action-pill__sep" aria-hidden="true" />
            <button
              type="button"
              className="selection-action-pill__btn selection-action-pill__btn--danger"
              onClick={() => handleDeleteAnnotation(selectedAnnotation.id)}
            >
              🗑️ Eliminar (Supr)
            </button>
          </div>
        )}

        {/* Control interactivo sobre la ROI cuando está activo el Deslizador Antes/Después (Swipe t1 ↔ t2) */}
        {dateViewMode === 'swipe' && imagesReady && (!croppedRegion || roiLayers.comparable) && (
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
            aria-label="Deslizador Antes y Después entre t1 y t2"
            aria-valuemin={2}
            aria-valuemax={98}
            aria-valuenow={Math.round(swipePct)}
            tabIndex={0}
            title="Arrastra hacia la izquierda o derecha para comparar t1 (2026-06-18) vs t2 (2026-10-16) con escala común -22 a 0 dB"
          >
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--left">
              ◀ t1 · {displayScene.t1}
            </span>
            <div className="swipe-handle-overlay__knob">↔</div>
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--right">
              t2 · {displayScene.t2} ▶
            </span>
          </div>
        )}

        {/* Control interactivo sobre la ROI cuando está activo el Deslizador Comparativo de Inundación */}
        {activeFlood.compareMode && activeFlood.rasterUrl && (
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
            aria-label="Deslizador Comparativo Inundación vs Terreno Original"
            aria-valuemin={2}
            aria-valuemax={98}
            aria-valuenow={Math.round(floodSwipePct)}
            tabIndex={0}
            title="Arrastra para comparar Terreno Original (izquierda) vs Inundación Simulada (derecha)"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                onFloodChange?.({ ...activeFlood, compareSwipePct: Math.max(2, floodSwipePct - 5) })
              } else if (e.key === 'ArrowRight') {
                onFloodChange?.({ ...activeFlood, compareSwipePct: Math.min(98, floodSwipePct + 5) })
              }
            }}
          >
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--left">
              ◀ Terreno Original
            </span>
            <div className="swipe-handle-overlay__knob">💧</div>
            <span className="swipe-handle-overlay__tag swipe-handle-overlay__tag--right">
              Inundación ({activeFlood.stats?.stormDays ?? (Math.round(activeFlood.rainfallDuration / 24) || 3)}d · {activeFlood.rainfallAmount}mm) ▶
            </span>
          </div>
        )}

        {/* 4. BARRA DE ESCALA DE COLOR VERTICAL A LA DERECHA DEL LIENZO (`.comsol-colorbar`) */}
        <aside
          className="comsol-colorbar"
          aria-label="Barra vertical de escala radiométrica estilo COMSOL"
        >
          <div className="comsol-colorbar__column">
            <div className="comsol-colorbar__header">
              <span className="comsol-colorbar__symbol">
                {activeLayerEntry?.simbolo ?? 'γ⁰'} {activeLayerEntry?.capa ?? 'HH'}
              </span>
              <span className="comsol-colorbar__unit">
                [{activeLayerEntry?.unidades ?? 'dB'} · {activeColormapSpec.shortLabel}]
              </span>
            </div>

            <div className="comsol-colorbar__body">
              <div
                className="comsol-colorbar__gradient"
                style={{ background: activeColormapSpec.cssGradientVertical }}
                role="img"
                aria-label={`Rampa vertical ${activeColormapSpec.label} de ${vmin} dB a ${vmax} dB`}
              />
              <div className="comsol-colorbar__ticks">
                {colorbarTicks.map((val, idx) => (
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
              <span>Max: {activeLayerEntry ? `+${activeLayerEntry.rango_datos_dB[1].toFixed(1)}` : '+9.8'}</span>
              <span>Min: {activeLayerEntry ? activeLayerEntry.rango_datos_dB[0].toFixed(1) : '-28.8'}</span>
            </div>
          </div>

          {solar.enabled && (
            <div className="comsol-colorbar__column comsol-colorbar__column--solar">
              <div className="comsol-colorbar__header">
                <span className="comsol-colorbar__symbol">Radiación</span>
                <span className="comsol-colorbar__unit">[Inferno · {solar.radiationIntensity}%]</span>
              </div>
              <div className="comsol-colorbar__body">
                <div
                  className="comsol-colorbar__gradient"
                  style={{ background: infernoSpec.cssGradientVertical }}
                  role="img"
                  aria-label="Escala vertical de radiación solar de Menor radiación a Mayor radiación (Inferno)"
                />
                <div className="comsol-colorbar__ticks">
                  <div className="comsol-colorbar__tick">
                    <span className="comsol-colorbar__tick-line" />
                    <span className="comsol-colorbar__tick-val">Mayor</span>
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
                    <span className="comsol-colorbar__tick-val">Menor</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Chip técnico arriba del mapa cuando hay una región recortada activa */}
        {hasActiveCrop && (
          <div className="crop-active-chip" role="status">
            <span className="crop-active-chip__dot" aria-hidden="true" />
            <span>Subregión ROI recortada activa —</span>
            <button
              type="button"
              className="crop-active-chip__action"
              onClick={handleResetCroppedRegion}
            >
              [Restablecer vista completa]
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
              Cargar ROI y buscar escenas
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setDraftPolygon([])}
            >
              Limpiar puntos
            </button>
          </div>
        )}

        {croppedRegion && (roiLayers.loading || roiLayers.error || !imagesReady) && (
          <div className="roi-loading-backdrop">
            <section className="roi-loading-dialog" role="dialog" aria-modal="true" aria-label="Carga de ROI" aria-busy={roiLayers.loading}>
              <h3>{roiLayers.error ? 'No se pudo cargar la ROI' : 'Preparando nueva ROI'}</h3>
              <p role="status" aria-live="polite">{roiLayers.error || (roiLayers.loading || imagesReady ? roiLayers.message : 'Preparando capas de la ROI…')}</p>
              {roiLayers.loading && <progress aria-label="Carga en curso" />}
              <p>El servidor consulta ASF y lee por HTTPS los bloques necesarios del H5 con Earthdata.</p>
              {roiLayers.error && <button className="btn" onClick={roiLayers.retry}>Reintentar</button>}
              <button className="btn" onClick={handleResetCroppedRegion}>Volver al mapa inicial</button>
            </section>
          </div>
        )}
        {croppedRegion && !roiLayers.loading && !roiLayers.error && (
          <div className="roi-result-status" role="status">
            {roiLayers.message} {roiLayers.manifests.map(m => m.escena.fecha_inicio?.slice(0, 10)).join(' → ')}
            {!activeLayerEntry && ' La capa seleccionada no está disponible. Elige otra polarización o fecha.'}
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
              placeholder="Etiqueta técnica..."
              autoFocus
            />
            <button type="submit" className="btn btn--primary btn--xs">
              Aplicar
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() => setLabelEditor(null)}
            >
              Cancelar
            </button>
          </form>
        )}

        {/* Cuadro Flotante Arrastrable para Herramientas de Dibujo */}
        {floatingToolsOpen && (
          <aside
            className="ws-floating-toolbox"
            style={{ left: `${toolboxPos.x}px`, top: `${toolboxPos.y}px` }}
            aria-label="Herramientas de dibujo flotantes"
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
              title="Arrastrar caja de herramientas a cualquier esquina del mapa"
            >
              <div className="ws-floating-toolbox__handle-title">
                <GripHorizontal size={13} />
                <span>Dibujo y Geometría</span>
              </div>
              <div className="ws-floating-toolbox__handle-actions">
                <button
                  type="button"
                  className="ws-floating-toolbox__icon-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setToolboxCollapsed((c) => !c)}
                  title={toolboxCollapsed ? 'Expandir herramientas' : 'Minimizar herramientas'}
                >
                  {toolboxCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </button>
                <button
                  type="button"
                  className="ws-floating-toolbox__icon-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={onToggleFloatingTools}
                  title="Ocultar caja de herramientas"
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
                  <label htmlFor="roi-coordinates">ROI por geometría: oeste, sur, este, norte</label>
                  <input id="roi-coordinates" value={geometryInput} onChange={event => setGeometryInput(event.target.value)} placeholder="−93.1, 16.7, −93.0, 16.8" />
                  <button className="btn btn--sm" type="submit">Dibujar rectángulo</button>
                  <small>O marca dos esquinas en el mapa. Máximo 0.6° por lado.</small>
                  {geometryError && <p role="alert">{geometryError}</p>}
                </form>}
                {!isEditing && (
                  <div className="ws-floating-toolbox__readonly">
                    Solo lectura: usa <strong>+ Duplicar Mapa</strong> para dibujar.
                  </div>
                )}

                <div className="ws-floating-toolbox__grid">
                  <button
                    type="button"
                    className={`ws-tool-btn ${activeTool === 'mover' ? 'is-active' : ''}`}
                    onClick={() => selectTool('mover')}
                    title="Mover lienzo / Seleccionar elementos"
                  >
                    <Hand size={13} />
                    <span>Mover</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'lapiz' ? 'is-active' : ''}`}
                    onClick={() => selectTool('lapiz')}
                    disabled={!isEditing}
                    title="Dibujar trazo libre"
                  >
                    <Pencil size={13} />
                    <span>Lápiz</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'peligro' ? 'is-active' : ''}`}
                    onClick={() => selectTool('peligro')}
                    disabled={!isEditing}
                    title={DANGER_CIRCLE_TOOLTIP}
                  >
                    <CircleDot size={13} className="icon-danger" />
                    <span>Círculo rojo</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'advertencia' ? 'is-active' : ''}`}
                    onClick={() => selectTool('advertencia')}
                    disabled={!isEditing}
                    title={WARN_CIRCLE_TOOLTIP}
                  >
                    <CircleDot size={13} className="icon-warn" />
                    <span>Círculo ámbar</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'poligono' ? 'is-active' : ''}`}
                    onClick={() => selectTool('poligono')}
                    disabled={!isEditing}
                    title="Dos clics: esquinas opuestas de una ROI rectangular"
                  >
                    <Pentagon size={13} />
                    <span>ROI rectangular · 2 puntos</span>
                  </button>
                  <button
                    type="button"
                    className={`ws-tool-btn ${isEditing && activeTool === 'etiqueta' ? 'is-active' : ''}`}
                    onClick={() => selectTool('etiqueta')}
                    disabled={!isEditing}
                    title="Insertar o editar etiqueta técnica"
                  >
                    <Tag size={13} />
                    <span>Etiqueta</span>
                  </button>
                </div>

                <div className="ws-floating-toolbox__footer">
                  <button
                    type="button"
                    className="ws-tool-btn"
                    onClick={handleUndoLastDrawing}
                    disabled={!isEditing || (annotations.length === 0 && draftPolygon.length === 0)}
                    title="Deshacer último trazo o vértice"
                  >
                    <Undo2 size={12} />
                    <span>Deshacer</span>
                  </button>
                  <button
                    type="button"
                    className="ws-tool-btn ws-tool-btn--danger"
                    onClick={() => selectedAnnotation && handleDeleteAnnotation(selectedAnnotation.id)}
                    disabled={!selectedAnnotation}
                    title="Eliminar elemento seleccionado"
                  >
                    <Trash size={12} />
                    <span>Eliminar</span>
                  </button>
                  <button
                    type="button"
                    className="ws-tool-btn"
                    onClick={handleClearAllDrawings}
                    disabled={
                      !isEditing ||
                      (annotations.length === 0 && !hasActiveCrop && draftPolygon.length === 0)
                    }
                    title="Limpiar todos los dibujos y recortes"
                  >
                    <Trash size={12} />
                    <span>Limpiar</span>
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
              <span>Arrastra un recuadro sobre la región simulada o captura la vista completa:</span>
              <button
                type="button"
                className="ws-tool-btn is-active"
                onClick={() => void executeRegionCapture()}
              >
                Capturar Vista Completa
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
                Cancelar
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
          <div className="ws-capture-modal-backdrop" role="dialog" aria-modal="true" aria-label="Guardar captura del mapa">
            <div className="ws-capture-modal">
              <div className="ws-capture-modal__header">
                <strong>
                  <Camera size={14} /> Previsualización de Captura ({captureModal.width} × {captureModal.height} px)
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
                <img src={captureModal.previewUrl} alt="Previsualización de región capturada" />
              </div>

              <div className="ws-capture-modal__controls">
                <label>
                  <span>Nombre del archivo</span>
                  <input
                    type="text"
                    value={captureModal.filename}
                    onChange={(e) =>
                      setCaptureModal((prev) => (prev ? { ...prev, filename: e.target.value } : null))
                    }
                  />
                </label>

                <label>
                  <span>Formato</span>
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
                    <option value="png">PNG (sin pérdida)</option>
                    <option value="jpeg">JPG (comprimido)</option>
                  </select>
                </label>

                {captureModal.format === 'jpeg' && (
                  <label>
                    <span>Calidad JPG: {Math.round(captureModal.quality * 100)}%</span>
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
                  Cerrar
                </button>
                <button
                  type="button"
                  className="ws-ribbon__btn ws-ribbon__btn--primary"
                  onClick={handleDownloadCapture}
                >
                  <Download size={14} />
                  <span>Descargar .{captureModal.format === 'png' ? 'png' : 'jpg'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Panel superpuesto compacto y colapsable de Simulación Lluvia / DG2 sobre el mapa */}
        {isDg2 && (
          <RainDg2Panel
            escena={escena}
            flood={activeFlood}
            onFloodChange={onFloodChange || (() => {})}
            center={view.centro}
            croppedRegion={croppedRegion}
            onFlyToZone={handleFlyToZone}
            onClose={() => {
              const mapTab = dockWindows.find((w) => w.kind === 'map')
              if (mapTab) onActivateDockWindow(mapTab.id)
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
            roiLayers={roiLayers}
          />
        )}
      </div>

      {/* 5. PANEL INFERIOR COLAPSABLE DE BITÁCORA Y TRAZABILIDAD ("Messages / Progress / Traceability Log") */}
      <section
        className={`workstation-log-panel ${logPanelCollapsed ? 'is-collapsed' : ''}`}
        aria-label="Messages / Progress / Traceability Log"
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
              <span>Messages / Progress / Traceability Log</span>
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
              <span>Manifiesto explore-web-1 (capas.json)</span>
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
                Advertencias Radiométricas ({activeManifest?.advertencias.length ?? 2})
              </span>
            </button>
          </div>

          <div className="workstation-log-panel__actions">
            {dateViewMode === 'swipe' && imagesReady && (!croppedRegion || roiLayers.comparable) && (
              <label className="workstation-log-panel__swipe-inline">
                <span>Swipe t1↔t2: {Math.round(swipePct)}%</span>
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
              title={logPanelCollapsed ? 'Expandir panel de bitácora' : 'Colapsar panel de bitácora'}
            >
              {logPanelCollapsed ? '▲ Expandir Log' : '▼ Colapsar'}
            </button>
          </div>
        </div>

        {!logPanelCollapsed && (
          <div className="workstation-log-panel__content">
            {logActiveTab === 'trace' && (
              <div className="ws-log-grid">
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">GRANULE t1</span>
                  <code className="ws-mono">{displayScene.t1SceneId}</code>
                  <span className="ws-log-sep">|</span>
                  <span>
                    CRID: <strong>{displayScene.crid}</strong> ({displayScene.madurez}) · Píxeles válidos ROI:{' '}
                    <strong>
                      {layerT1 ? `${layerT1.pct_pixeles_validos.toFixed(2)}%` : 'Sin datos'}
                    </strong>{' '}
                    · Rango COG:{' '}
                    <code className="ws-mono">
                      {layerT1
                        ? `[${layerT1.rango_datos_dB[0].toFixed(2)}, +${layerT1.rango_datos_dB[1].toFixed(2)} dB]`
                        : 'Sin datos'}
                    </code>
                  </span>
                </div>

                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">GRANULE t2</span>
                  <code className="ws-mono">{displayScene.t2SceneId}</code>
                  <span className="ws-log-sep">|</span>
                  <span>
                    CRID: <strong>{displayScene.crid}</strong> ({displayScene.madurez}) · Píxeles válidos ROI:{' '}
                    <strong>
                      {layerT2 ? `${layerT2.pct_pixeles_validos.toFixed(2)}%` : 'Sin datos'}
                    </strong>{' '}
                    · Rango COG:{' '}
                    <code className="ws-mono">
                      {layerT2
                        ? `[${layerT2.rango_datos_dB[0].toFixed(2)}, +${layerT2.rango_datos_dB[1].toFixed(2)} dB]`
                        : '[-28.83, +9.78 dB]'}
                    </code>
                  </span>
                </div>

                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--warn">CALIBRACIÓN</span>
                  <code className="ws-mono">
                    noiseCorrectionApplied = False | shadowMaskingApplied = False | rfiMitigationApplied = True
                  </code>
                  <span className="ws-log-sep">|</span>
                  {scaleCheck && (
                    <span className={scaleCheck.valid ? 'ws-log-ok' : 'ws-log-warn'}>
                      {scaleCheck.valid ? '✓ ' : '⚠️ '}
                      {scaleCheck.message}
                    </span>
                  )}
                </div>
              </div>
            )}

            {logActiveTab === 'layers' && activeLayerEntry && (
              <div className="ws-log-grid">
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">CAPA ACTIVA</span>
                  <strong>{activeLayerEntry.id}:</strong> {activeLayerOption.title} · Paleta LUT:{' '}
                  <strong>{activeColormapSpec.label}</strong>
                </div>
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">PNG WEB</span>
                  <code className="ws-mono">/{activeLayerEntry.png}</code> (
                  {activeLayerEntry.forma_png[1]}×{activeLayerEntry.forma_png[0]} px ·{' '}
                  {activeLayerEntry.crs_png}) ·{' '}
                  <span className="ws-log-tag ws-log-tag--info">COG</span>{' '}
                  <code className="ws-mono">/{activeLayerEntry.cog}</code> (
                  {activeLayerEntry.forma_cog[1]}×{activeLayerEntry.forma_cog[0]} px ·{' '}
                  {activeLayerEntry.crs_cog})
                </div>
                <div className="ws-log-row">
                  <span className="ws-log-tag ws-log-tag--info">PROCEDENCIA</span>
                  <span>
                    Modo: <code>{activeManifest?.procedencia.modo ?? 'remoto'}</code> · Método:{' '}
                    <code>{activeManifest?.procedencia.metodo ?? 'h5py sobre HTTPS'}</code> ·
                    Identidad verificada contra catálogo ASF:{' '}
                    <code>
                      {String(
                        activeManifest?.procedencia.identidad_verificada_contra_catalogo ?? true,
                      )}
                    </code>
                  </span>
                </div>
              </div>
            )}

            {logActiveTab === 'warnings' && (
              <ul className="ws-log-warnings">
                {(activeManifest?.advertencias ?? []).map((adv, idx) => (
                  <li key={idx}>{adv}</li>
                ))}
                <li>
                  Banderas de procesamiento leídas del HDF5: <code>noiseCorrectionApplied = False</code>,{' '}
                  <code>shadowMaskingApplied = False</code>. Etapa 1 exploratoria; mapa de cambio{' '}
                  <code>Δσ⁰</code> pendiente de Contrato C2.
                </li>
              </ul>
            )}
          </div>
        )}
      </section>
      </div>
    </main>
  )
}
