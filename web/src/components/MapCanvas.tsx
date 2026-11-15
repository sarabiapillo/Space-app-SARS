import { useEffect, useRef, useState, type FormEvent } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  GeoJSONSource,
  ImageSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker,
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

/**
 * 2. Estilo base seguro: únicamente `version: 8`, `glyphs`, la fuente `esri-satellite`
 * y su capa `raster` base. Todas las demás fuentes/capas se agregan en `map.on('load')`
 * dentro de bloques `try/catch` independientes.
 */
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

/**
 * 3. Genera dinámicamente un DataURL en `<canvas>` con el patrón compuesto SAR
 * verde/magenta semitransparente para que la fuente `image` de MapLibre siempre
 * cargue al instante aunque no exista `/nisar_chiapas.jpg` en `public/`.
 */
function createFallbackSarDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // Base semitransparente SAR (banda L HH/HV)
  const baseGrad = ctx.createLinearGradient(0, 0, 512, 512)
  baseGrad.addColorStop(0, 'rgba(6, 78, 59, 0.48)')
  baseGrad.addColorStop(0.45, 'rgba(16, 185, 129, 0.36)')
  baseGrad.addColorStop(0.75, 'rgba(134, 25, 143, 0.28)')
  baseGrad.addColorStop(1, 'rgba(6, 95, 70, 0.48)')
  ctx.fillStyle = baseGrad
  ctx.fillRect(0, 0, 512, 512)

  // Dispersión volumétrica verde (vegetación / relieve) y magenta (doble rebote HH)
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

  // Cuerpos de agua en calma (baja retrodispersión)
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
  const markersRef = useRef<Marker[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [viewport, setViewport] = useState<ViewportMetrics>({
    centro: view.centro,
    zoom: view.zoom,
    width: 960,
    height: 640,
  })

  const [activeTool, setActiveTool] = useState<DrawTool>('mover')
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

  // Inicialización de MapLibre GL, ResizeObserver y capas protegidas con try/catch
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

    // 1. Garantizar que el canvas de WebGL tome el ancho y alto reales
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
        isPointerDownRef.current = true
        draftFreehandRef.current = [coord]
        setDraftFreehand([coord])
      } else if (tool === 'peligro' || tool === 'advertencia') {
        e.preventDefault()
        isPointerDownRef.current = true
        const defaultRadiusKm = Number(
          Math.max(1.2, 48 / Math.pow(2, map.getZoom() - 7)).toFixed(2),
        )
        const circle = { kind: tool, center: coord, radiusKm: defaultRadiusKm }
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
        if (dist > 0.4) {
          const updated = {
            ...draftCircleRef.current,
            radiusKm: Number(dist.toFixed(2)),
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

      if (tool === 'poligono') {
        setDraftPolygon((prev) => [...prev, coord])
      } else if (tool === 'etiqueta') {
        const hit = [...annotationsRef.current].reverse().find((ann) => {
          if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
            return distanceKm(coord, ann.center) <= Math.max(ann.radiusKm, 2.0)
          }
          if (ann.kind === 'etiqueta') {
            return distanceKm(coord, ann.position) <= 2.5
          }
          return false
        })

        if (hit && (hit.kind === 'peligro' || hit.kind === 'advertencia')) {
          setLabelEditor({
            coord: hit.center,
            text: hit.label,
            targetAnnotationId: hit.id,
          })
        } else if (hit && hit.kind === 'etiqueta') {
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

    map.on('load', () => {
      if (cancelled) return
      map.resize()
      syncViewport()

      const alpha = opacityRef.current / 100

      // A. Huella GeoJSON de respaldo + Fuente `nisar-radar` con DataURL inmediato
      try {
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

        const fallbackDataUrl = createFallbackSarDataUrl()
        if (fallbackDataUrl) {
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

          // Si `/nisar_chiapas.jpg` existe en `public/`, actualiza la textura sin bloquear el mapa
          preloadImage(NISAR_IMAGE_URL).then((ok) => {
            if (cancelled || !ok) return
            try {
              const src = map.getSource(NISAR_SOURCE) as ImageSource | undefined
              src?.updateImage({ url: NISAR_IMAGE_URL, coordinates: NISAR_FOOTPRINT })
            } catch {
              // Mantiene el patrón SAR en `<canvas>`
            }
          })
        }
      } catch (err) {
        console.warn('No se pudo inicializar la capa NISAR:', err)
      }

      // B. Fuente `terrain-dem` y capa `solar-thermal-layer`
      try {
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
      } catch (err) {
        console.warn('No se pudo inicializar la capa DEM solar:', err)
      }

      // C. Fuente y capas de MÁSCARA INVERSA (`crop-mask-fill`)
      try {
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
      } catch (err) {
        console.warn('No se pudo inicializar la máscara de recorte:', err)
      }

      // D. Fuente y capas vectoriales de dibujo (`annotations-source`)
      try {
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
            'line-color': '#10B981',
            'line-width': 3.2,
          },
        })
      } catch (err) {
        console.warn('No se pudieron inicializar las capas de anotación:', err)
      }

      // E. Fuente y capas para polígono en construcción ("Seleccionar Región")
      try {
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
      } catch (err) {
        console.warn('No se pudo inicializar el borrador de polígono:', err)
      }

      setMapReady(true)
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      for (const m of markersRef.current) m.remove()
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  // 1. Conectar slider de opacidad usando `map.setPaintProperty('nisar-layer', 'raster-opacity', opacidad / 100)`
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

  // 2. Actualizar cursor y `map.dragPan.disable()` / `enable()` según la herramienta activa
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

  // 2. Renderizar las etiquetas de texto usando `maplibregl.Marker` con elementos HTML limpios
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    for (const ann of annotations) {
      if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
        const el = document.createElement('div')
        el.className = `map-marker-tag ${
          ann.kind === 'peligro' ? 'map-marker-tag--danger' : 'map-marker-tag--warn'
        }`
        el.textContent = ann.label
        const topEdgeCoord: LngLat = [ann.center[0], ann.center[1] + ann.radiusKm / 110.574]
        const marker = new Marker({ element: el, anchor: 'bottom', offset: [0, -6] })
          .setLngLat(topEdgeCoord)
          .addTo(map)
        markersRef.current.push(marker)
      } else if (ann.kind === 'etiqueta') {
        const el = document.createElement('div')
        el.className = 'map-marker-tag map-marker-tag--custom'
        el.textContent = ann.text
        const marker = new Marker({ element: el, anchor: 'left', offset: [8, 0] })
          .setLngLat(ann.position)
          .addTo(map)
        markersRef.current.push(marker)
      }
    }
  }, [annotations, mapReady])

  // Sincronizar fuente GeoJSON `draft-polygon-source`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(DRAFT_POLY_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(buildDraftPolygonGeoJSON(draftPolygon) as never)
    }
  }, [draftPolygon, mapReady])

  // 4. Sincronizar fuente GeoJSON `crop-mask-source` (vacío y opacidad 0 cuando `croppedRegion` es `null`)
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
      onAnnotationsChange([
        ...annotations,
        {
          id: newId(),
          kind: 'etiqueta',
          position: labelEditor.coord,
          text,
        },
      ])
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
      onAnnotationsChange(annotations.slice(0, -1))
    }
  }

  const draftPolyCentroidScreen =
    draftPolygon.length >= 3
      ? projectLngLat(getPolygonBoundsAndCentroid(draftPolygon).centroid, viewport)
      : null

  const labelEditorScreen = labelEditor ? projectLngLat(labelEditor.coord, viewport) : null

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

      {/* Etiqueta de ubicación y copia activa */}
      <div className="map-badge">
        <span className="map-badge__location">📍 Chiapas, México</span>
        {isEditing && activeMapName && (
          <span className="map-badge__copy">· {activeMapName}</span>
        )}
      </div>

      {/* Chip flotante arriba del mapa cuando hay una región recortada activa */}
      {croppedRegion && croppedRegion.length >= 3 && (
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

          <button
            type="button"
            className="dock-undo-btn"
            onClick={handleUndoLastDrawing}
            disabled={annotations.length === 0 && draftPolygon.length === 0}
            title="Borrar último dibujo"
            aria-label="Borrar último dibujo"
          >
            <Undo2 size={15} />
          </button>
        </div>
      )}
    </main>
  )
}
