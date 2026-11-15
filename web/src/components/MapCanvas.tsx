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
  CircleDot,
  Hand,
  Pencil,
  Pentagon,
  Sun,
  Tag,
  Trash,
  Undo2,
} from 'lucide-react'
import {
  CHIAPAS_CENTRO,
  CHIAPAS_ZOOM,
  NISAR_FOOTPRINT,
  NISAR_IMAGE_URL,
} from '../mocks/initialWorkspaces'
import { RightPanel } from './RightPanel'
import type {
  DrawTool,
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
  view: MapView
  viewKey: string
  opacity: number
  isEditing: boolean
  activeMapName: string | null
  annotations: MapAnnotation[]
  croppedRegion: LngLat[] | null
  solar: SolarSimulationState
  onViewChange?: (view: MapView, info: { userInitiated: boolean }) => void
  onAnnotationsChange: (next: MapAnnotation[]) => void
  onCropRegionChange: (polygon: LngLat[] | null) => void
  onSolarChange: (next: SolarSimulationState) => void
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

function preloadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = window.setTimeout(() => resolve(false), 1800)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img.naturalWidth > 0)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(false)
    }
    img.src = url
  })
}

function createFallbackSarDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const baseGrad = ctx.createLinearGradient(0, 0, 512, 512)
  baseGrad.addColorStop(0, 'rgba(6, 78, 59, 0.48)')
  baseGrad.addColorStop(0.45, 'rgba(16, 185, 129, 0.36)')
  baseGrad.addColorStop(0.75, 'rgba(134, 25, 143, 0.28)')
  baseGrad.addColorStop(1, 'rgba(6, 95, 70, 0.48)')
  ctx.fillStyle = baseGrad
  ctx.fillRect(0, 0, 512, 512)

  for (let i = 0; i < 32; i++) {
    const cx = (i * 79) % 512
    const cy = (i * 131) % 512
    const r = 38 + (i % 5) * 24
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r)
    if (i % 3 === 0) {
      g.addColorStop(0, 'rgba(217, 70, 239, 0.36)')
      g.addColorStop(1, 'rgba(134, 25, 143, 0)')
    } else {
      g.addColorStop(0, 'rgba(16, 185, 129, 0.42)')
      g.addColorStop(1, 'rgba(6, 78, 59, 0)')
    }
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = 'rgba(2, 6, 23, 0.68)'
  ctx.beginPath()
  ctx.moveTo(95, 130)
  ctx.bezierCurveTo(150, 120, 195, 175, 255, 210)
  ctx.bezierCurveTo(300, 235, 345, 225, 395, 275)
  ctx.bezierCurveTo(355, 295, 275, 260, 215, 238)
  ctx.bezierCurveTo(155, 215, 110, 175, 85, 150)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, 508, 508)

  return canvas.toDataURL('image/png')
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
  view,
  viewKey,
  opacity,
  isEditing,
  activeMapName,
  annotations,
  croppedRegion,
  solar,
  onViewChange,
  onAnnotationsChange,
  onCropRegionChange,
  onSolarChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [viewport, setViewport] = useState<ViewportMetrics>({
    centro: view.centro,
    zoom: view.zoom,
    width: 960,
    height: 640,
  })

  const [activeTool, setActiveTool] = useState<DrawTool>('mover')
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

  // 2b & 2c. Atajos de teclado: Delete / Backspace para eliminar el seleccionado, Escape para deseleccionar
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
          label: c.kind === 'peligro' ? 'Zona de Peligro' : 'Zona de Advertencia',
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
        // Clic en parte vacía del mapa deselecciona la figura actual
        setSelectedAnnotationId(null)
      } else if (tool === 'poligono') {
        setSelectedAnnotationId(null)
        setDraftPolygon((prev) => [...prev, coord])
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
              'fill-color': '#10B981',
              'fill-opacity': alpha * 0.12,
            },
          })
          map.addLayer({
            id: FOOTPRINT_LINE_LAYER,
            type: 'line',
            source: FOOTPRINT_SOURCE,
            paint: {
              'line-color': '#10B981',
              'line-width': 1.8,
              'line-opacity': 0.85,
              'line-dasharray': [3, 2],
            },
          })
        }

        const fallbackDataUrl = createFallbackSarDataUrl()
        if (fallbackDataUrl && !map.getSource(NISAR_SOURCE)) {
          map.addSource(NISAR_SOURCE, {
            type: 'image',
            url: fallbackDataUrl,
            coordinates: NISAR_FOOTPRINT,
          })
          map.addLayer({
            id: NISAR_LAYER,
            type: 'raster',
            source: NISAR_SOURCE,
            paint: {
              'raster-opacity': alpha,
              'raster-fade-duration': 0,
            },
          })

          preloadImage(NISAR_IMAGE_URL).then((ok) => {
            if (cancelled || !ok) return
            try {
              const src = map.getSource(NISAR_SOURCE) as ImageSource | undefined
              src?.updateImage({ url: NISAR_IMAGE_URL, coordinates: NISAR_FOOTPRINT })
            } catch {
              // Conserva la textura SAR en `<canvas>`
            }
          })
        }
      } catch (err) {
        console.warn('No se pudo inicializar la capa NISAR:', err)
      }

      // B. Fuente `terrain-dem` y capa `solar-thermal-layer`
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
              'hillshade-accent-color': '#EA580C',
              'hillshade-shadow-color': '#1E3A8A',
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
              'fill-color': '#0F172A',
              'fill-opacity': hasCrop ? 0.72 : 0,
            },
          })
          map.addLayer({
            id: CROP_MASK_LINE_LAYER,
            type: 'line',
            source: CROP_MASK_SOURCE,
            filter: ['==', ['get', 'role'], 'border'],
            paint: {
              'line-color': '#10B981',
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
              'fill-color': '#EF4444',
              'fill-opacity': 0.25,
            },
          })
          map.addLayer({
            id: ANN_DANGER_LINE_LAYER,
            type: 'line',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'peligro'],
            paint: {
              'line-color': '#EF4444',
              'line-width': 2.5,
            },
          })

          map.addLayer({
            id: ANN_WARN_FILL_LAYER,
            type: 'fill',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'advertencia'],
            paint: {
              'fill-color': '#F59E0B',
              'fill-opacity': 0.18,
            },
          })
          map.addLayer({
            id: ANN_WARN_LINE_LAYER,
            type: 'line',
            source: ANNOTATIONS_SOURCE,
            filter: ['==', ['get', 'kind'], 'advertencia'],
            paint: {
              'line-color': '#F59E0B',
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
              'line-color': '#38BDF8',
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
              'fill-color': '#10B981',
              'fill-opacity': 0.16,
            },
          })
          map.addLayer({
            id: DRAFT_POLY_LINE_LAYER,
            type: 'line',
            source: DRAFT_POLY_SOURCE,
            filter: ['==', ['get', 'featureType'], 'line'],
            paint: {
              'line-color': '#10B981',
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
              'circle-radius': 5.5,
              'circle-color': '#FFFFFF',
              'circle-stroke-color': '#10B981',
              'circle-stroke-width': 2.2,
            },
          })
        }
      } catch (err) {
        console.warn('No se pudo inicializar el borrador de polígono:', err)
      }

      setMapReady(true)
    }

    map.once('style.load', initMapLayers)
    map.once('load', initMapLayers)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Conectar slider de opacidad usando `map.setPaintProperty('nisar-layer', 'raster-opacity', opacidad / 100)`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const alpha = opacity / 100
    if (map.getLayer(NISAR_LAYER)) {
      map.setPaintProperty(NISAR_LAYER, 'raster-opacity', alpha)
    }
    if (map.getLayer(FOOTPRINT_FILL_LAYER)) {
      map.setPaintProperty(FOOTPRINT_FILL_LAYER, 'fill-opacity', alpha * 0.12)
    }
  }, [opacity, mapReady])

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
      map.setPaintProperty(CROP_MASK_FILL_LAYER, 'fill-opacity', hasCrop ? 0.72 : 0)
    }
  }, [croppedRegion, mapReady])

  // Actualizar `solar-thermal-layer` en tiempo real con `setPaintProperty`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer(SOLAR_THERMAL_LAYER)) return
    const hs = computeHillshadeParams(solar)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-illumination-direction', hs.direction)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-exaggeration', hs.exaggeration)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-highlight-color', hs.highlightColor)
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-accent-color', '#EA580C')
    map.setPaintProperty(SOLAR_THERMAL_LAYER, 'hillshade-shadow-color', '#1E3A8A')
  }, [solar, mapReady])

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
    setActiveTool(tool)
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
    setActiveTool('mover')

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
    setActiveTool('mover')
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

  // 3. Limpiar todas las anotaciones y recortes de la copia activa
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

  const showSolarOverlay = solar.enabled && solar.radiationIntensity > 0
  const radRatio = solar.radiationIntensity / 100
  const sunFocusX = 85 - (solar.sunAngle / 180) * 70
  const sunFocusY = 54 - Math.sin((solar.sunAngle * Math.PI) / 180) * 20
  const shadowSideX = 100 - sunFocusX

  return (
    <main
      className="map-canvas"
      style={{ position: 'relative', flex: 1, width: '100%', height: '100%' }}
    >
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

      {/* Efecto térmico direccional del Simulador Solar */}
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
              radial-gradient(circle at ${sunFocusX.toFixed(1)}% ${sunFocusY.toFixed(1)}%, rgba(239, 68, 68, ${(radRatio * 0.44).toFixed(2)}) 0%, rgba(249, 115, 22, ${(radRatio * 0.34).toFixed(2)}) 32%, rgba(253, 224, 71, ${(radRatio * 0.22).toFixed(2)}) 58%, rgba(15, 23, 42, 0) 82%),
              radial-gradient(circle at ${shadowSideX.toFixed(1)}% ${(100 - sunFocusY).toFixed(1)}%, rgba(30, 58, 138, ${(radRatio * 0.38).toFixed(2)}) 0%, rgba(15, 23, 42, 0) 65%)
            `,
          }}
        />
      )}

      {/* 1. OVERLAY SVG SINCRONIZADO POR ENCIMA DEL MAPA (z-index: 5) */}
      <svg
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
        {/* Máscara inversa de recorte (`croppedRegion`) */}
        {croppedScreenPts && (
          <g>
            <path
              d={croppedInversePathAttr}
              fill="#090D16"
              fillOpacity={0.78}
              fillRule="evenodd"
            />
            <polygon
              points={croppedPolygonPointsAttr}
              fill="none"
              stroke="#10B981"
              strokeWidth={2.5}
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
                {/* Resaltado exterior brillante cuando está seleccionado */}
                {isSelected && (
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: 'drop-shadow(0 0 6px #38BDF8)', pointerEvents: 'none' }}
                  />
                )}
                {/* Área de clic ampliada transparente para facilitar seleccionar el trazo */}
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
                  stroke="#38BDF8"
                  strokeWidth={isSelected ? 5 : 3.5}
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
                {/* Resaltado exterior brillante blanco/cian cuando está seleccionado */}
                {isSelected && (
                  <polygon
                    points={ringPts}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={6}
                    style={{ filter: 'drop-shadow(0 0 6px #38BDF8)', pointerEvents: 'none' }}
                  />
                )}
                <polygon
                  points={ringPts}
                  fill={isDanger ? 'rgba(239, 68, 68, 0.28)' : 'rgba(245, 158, 11, 0.22)'}
                  stroke={isDanger ? '#EF4444' : '#F59E0B'}
                  strokeWidth={isSelected ? 4.5 : 3}
                  strokeDasharray={isDanger ? undefined : '8 6'}
                  style={svgElementInteractionStyle}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5.5 : 4}
                  fill={isDanger ? '#EF4444' : '#F59E0B'}
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
                    r={9}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={2.5}
                    style={{ filter: 'drop-shadow(0 0 6px #38BDF8)', pointerEvents: 'none' }}
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 6 : 5}
                  fill="#10B981"
                  stroke="#FFFFFF"
                  strokeWidth={2}
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
                  fill={isDanger ? 'rgba(239, 68, 68, 0.28)' : 'rgba(245, 158, 11, 0.22)'}
                  stroke={isDanger ? '#EF4444' : '#F59E0B'}
                  strokeWidth={3}
                  strokeDasharray={isDanger ? undefined : '8 6'}
                />
                <circle cx={cx} cy={cy} r={4} fill={isDanger ? '#EF4444' : '#F59E0B'} />
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
            stroke="#38BDF8"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Polígono en construcción (`Seleccionar Región`) */}
        {draftPolygon.length > 0 && (
          <g>
            {draftPolygon.length >= 3 && (
              <polygon
                points={draftPolygon
                  .map((pt) => projectLngLat(pt, viewport))
                  .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                  .join(' ')}
                fill="rgba(16, 185, 129, 0.18)"
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
                stroke="#10B981"
                strokeWidth={2.5}
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
                  r={6}
                  fill="#FFFFFF"
                  stroke="#10B981"
                  strokeWidth={2.5}
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

      {/* 2a. Píldora flotante de acción rápida junto al elemento seleccionado */}
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
            ✏️ Editar texto
          </button>
          <span className="selection-action-pill__sep" aria-hidden="true" />
          <button
            type="button"
            className="selection-action-pill__btn selection-action-pill__btn--danger"
            onClick={() => handleDeleteAnnotation(selectedAnnotation.id)}
          >
            🗑️ Eliminar
          </button>
        </div>
      )}

      {/* Etiqueta de ubicación y copia activa */}
      <div className="map-badge">
        <span className="map-badge__location">📍 Chiapas, México</span>
        {isEditing && activeMapName && (
          <span className="map-badge__copy">· {activeMapName}</span>
        )}
      </div>

      {/* Chip flotante arriba del mapa cuando hay una región recortada activa */}
      {hasActiveCrop && (
        <div className="crop-active-chip" role="status">
          <span className="crop-active-chip__dot" aria-hidden="true" />
          <span>Región recortada activa —</span>
          <button
            type="button"
            className="crop-active-chip__action"
            onClick={handleResetCroppedRegion}
          >
            [Restablecer vista completa]
          </button>
        </div>
      )}

      {/* Botón flotante verde "✂️ Recortar región" y "Limpiar puntos" en el centroide del polígono */}
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
            className="btn btn--emerald btn--sm"
            onClick={handleApplyCropRegion}
          >
            ✂️ Recortar región
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

      {/* Input flotante limpio para crear o editar una etiqueta */}
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
            maxLength={48}
            onChange={(e) => setLabelEditor({ ...labelEditor, text: e.target.value })}
            placeholder="Escribe una etiqueta..."
            autoFocus
          />
          <button type="submit" className="btn btn--primary btn--xs">
            Guardar
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

      {/* Tarjeta Flotante Derecha: Simulación Solar */}
      {solar.enabled && (
        <RightPanel
          solar={solar}
          onSolarChange={onSolarChange}
          onClose={() => onSolarChange({ ...solar, enabled: false })}
        />
      )}

      {/* Barra de Herramientas Flotante Abajo (solo activa en "Mapa Editado") */}
      {isEditing && (
        <div className="bottom-toolbar" role="toolbar" aria-label="Herramientas de edición del mapa">
          <button
            type="button"
            className={`dock-btn ${activeTool === 'mover' ? 'is-active' : ''}`}
            onClick={() => selectTool('mover')}
          >
            <Hand size={17} aria-hidden="true" />
            <span>Mover</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeTool === 'lapiz' ? 'is-active' : ''}`}
            onClick={() => selectTool('lapiz')}
          >
            <Pencil size={17} aria-hidden="true" />
            <span>Lápiz</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeTool === 'peligro' ? 'is-active' : ''}`}
            onClick={() => selectTool('peligro')}
          >
            <CircleDot size={17} className="icon-danger" aria-hidden="true" />
            <span>Círculo Peligro</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeTool === 'advertencia' ? 'is-active' : ''}`}
            onClick={() => selectTool('advertencia')}
          >
            <CircleDot size={17} className="icon-warn" aria-hidden="true" />
            <span>Círculo Advertencia</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeTool === 'poligono' ? 'is-active' : ''}`}
            onClick={() => selectTool('poligono')}
          >
            <Pentagon size={17} aria-hidden="true" />
            <span>Seleccionar Región</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeTool === 'etiqueta' ? 'is-active' : ''}`}
            onClick={() => selectTool('etiqueta')}
          >
            <Tag size={17} aria-hidden="true" />
            <span>Etiqueta</span>
          </button>

          <div className="bottom-toolbar__divider" aria-hidden="true" />

          <button
            type="button"
            className={`dock-btn ${solar.enabled ? 'is-active' : ''}`}
            onClick={() => onSolarChange({ ...solar, enabled: !solar.enabled })}
          >
            <Sun size={17} className="icon-sun" aria-hidden="true" />
            <span>Simulador Solar</span>
          </button>

          <div className="bottom-toolbar__divider" aria-hidden="true" />

          <button
            type="button"
            className="dock-undo-btn"
            onClick={handleUndoLastDrawing}
            disabled={annotations.length === 0 && draftPolygon.length === 0}
            title="Borrar último dibujo (Deshacer)"
            aria-label="Borrar último dibujo"
          >
            <Undo2 size={15} />
          </button>

          {selectedAnnotation && (
            <button
              type="button"
              className="dock-action-btn dock-action-btn--danger"
              onClick={() => handleDeleteAnnotation(selectedAnnotation.id)}
              title="Eliminar elemento seleccionado (Supr)"
            >
              <Trash size={14} aria-hidden="true" />
              <span>Eliminar seleccionado</span>
            </button>
          )}

          <button
            type="button"
            className="dock-action-btn"
            onClick={handleClearAllDrawings}
            disabled={annotations.length === 0 && !hasActiveCrop && draftPolygon.length === 0}
            title="Limpiar todos los dibujos de esta copia"
          >
            <Trash size={14} aria-hidden="true" />
            <span>Limpiar todo</span>
          </button>
        </div>
      )}
    </main>
  )
}
