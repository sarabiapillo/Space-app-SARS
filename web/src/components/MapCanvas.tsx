import { useEffect, useRef, useState, type FormEvent } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  GeoJSONSource,
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
const ANN_LABEL_DOT_LAYER = 'annotations-label-dot'

const DRAFT_POLY_SOURCE = 'draft-polygon-source'
const DRAFT_POLY_FILL_LAYER = 'draft-polygon-fill'
const DRAFT_POLY_LINE_LAYER = 'draft-polygon-line'
const DRAFT_POLY_VERTEX_LAYER = 'draft-polygon-vertex'

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    [DEM_SOURCE]: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
    },
  },
  layers: [
    {
      id: 'esri-world-imagery',
      type: 'raster',
      source: 'esri-world-imagery',
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
    img.onload = () => resolve(img.naturalWidth > 0)
    img.onerror = () => resolve(false)
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
  baseGrad.addColorStop(0, 'rgba(6, 78, 59, 0.52)')
  baseGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0.34)')
  baseGrad.addColorStop(1, 'rgba(6, 95, 70, 0.52)')
  ctx.fillStyle = baseGrad
  ctx.fillRect(0, 0, 512, 512)

  for (let i = 0; i < 24; i++) {
    const cx = (i * 79) % 512
    const cy = (i * 131) % 512
    const r = 42 + (i % 4) * 26
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r)
    g.addColorStop(0, 'rgba(16, 185, 129, 0.38)')
    g.addColorStop(1, 'rgba(6, 78, 59, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  return canvas.toDataURL('image/png')
}

function sameView(a: MapView, b: MapView): boolean {
  return (
    Math.abs(a.centro[0] - b.centro[0]) < 1e-6 &&
    Math.abs(a.centro[1] - b.centro[1]) < 1e-6 &&
    Math.abs(a.zoom - b.zoom) < 1e-3
  )
}

/** Calcula los parámetros `hillshade` de MapLibre a partir del estado solar. */
function computeHillshadeParams(solar: SolarSimulationState): {
  direction: number
  exaggeration: number
  highlightColor: string
} {
  // Mapea el ángulo en el arco (0° Este mañana -> 180° Oeste tarde) a azimut (90° Este -> 270° Oeste)
  const direction = Math.round(90 + (solar.sunAngle / 180) * 180)
  // Altura solar: máxima al mediodía (90°), mínima al amanecer/atardecer (pero nunca < 0.35 para que se aprecie)
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
  const [mapReady, setMapReady] = useState(false)
  const [viewport, setViewport] = useState<ViewportMetrics>({
    centro: view.centro,
    zoom: view.zoom,
    width: 960,
    height: 640,
  })

  // Herramienta activa en la barra inferior
  const [activeTool, setActiveTool] = useState<DrawTool>('mover')
  const [draftFreehand, setDraftFreehand] = useState<LngLat[]>([])
  const [draftCircle, setDraftCircle] = useState<{
    kind: 'peligro' | 'advertencia'
    center: LngLat
    radiusKm: number
  } | null>(null)
  const [draftPolygon, setDraftPolygon] = useState<LngLat[]>([])

  // Input flotante para crear/editar una etiqueta sobre una coordenada o figura
  const [labelEditor, setLabelEditor] = useState<{
    coord: LngLat
    text: string
    targetAnnotationId: string | null
  } | null>(null)

  // Referencias mutables para que los listeners nativos de MapLibre siempre lean el estado actual
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

  // Inicialización de MapLibre GL y registro de fuentes/capas e interacciones nativas
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
        width: canvas.clientWidth || 960,
        height: canvas.clientHeight || 640,
      })
    }
    syncViewport()
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

    // Listeners nativos de MapLibre para Lápiz, Círculo Peligro/Advertencia, Polígono y Etiqueta
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
    const styleLoaded = new Promise<void>((resolve) => map.once('load', () => resolve()))

    Promise.all([preloadImage(NISAR_IMAGE_URL), styleLoaded]).then(([imageOk]) => {
      if (cancelled) return
      const alpha = opacityRef.current / 100
      const resolvedUrl = imageOk ? NISAR_IMAGE_URL : createFallbackSarDataUrl()

      // 1. Fuente `nisar-radar` tipo `image` y capa `nisar-layer`
      if (resolvedUrl) {
        map.addSource(NISAR_SOURCE, {
          type: 'image',
          url: resolvedUrl,
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
      }

      // Borde sutil alrededor de la huella de la escena NISAR
      map.addSource(FOOTPRINT_SOURCE, { type: 'geojson', data: FOOTPRINT_GEOJSON })
      map.addLayer({
        id: FOOTPRINT_LINE_LAYER,
        type: 'line',
        source: FOOTPRINT_SOURCE,
        paint: {
          'line-color': '#10B981',
          'line-width': 1.6,
          'line-opacity': 0.75,
          'line-dasharray': [3, 2],
        },
      })

      // 4. Capa `hillshade` (`solar-thermal-layer`) encima del mapa base/radar y debajo de las anotaciones
      const hs = computeHillshadeParams(solarRef.current)
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

      // 3. Fuente y capas de MÁSCARA INVERSA para "Recortar región"
      map.addSource(CROP_MASK_SOURCE, {
        type: 'geojson',
        data: buildInverseCropMaskGeoJSON(croppedRegionRef.current) as never,
      })
      map.addLayer({
        id: CROP_MASK_FILL_LAYER,
        type: 'fill',
        source: CROP_MASK_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#0F172A',
          'fill-opacity': 0.72,
        },
      })
      map.addLayer({
        id: CROP_MASK_LINE_LAYER,
        type: 'line',
        source: CROP_MASK_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#10B981',
          'line-width': 2.2,
          'line-dasharray': [3, 2],
        },
      })

      // 2. Fuente y capas vectoriales GeoJSON para Lápiz, Círculo Peligro y Círculo Advertencia
      map.addSource(ANNOTATIONS_SOURCE, {
        type: 'geojson',
        data: buildAnnotationsGeoJSON(annotationsRef.current, [], null) as never,
      })

      // Círculo Peligro (relleno #EF4444 opacidad 0.25 + borde sólido #EF4444 2.5px)
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

      // Círculo Advertencia (relleno #F59E0B opacidad 0.18 + borde punteado #F59E0B [3, 2] 2.5px)
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

      // Lápiz (LineString en tiempo real)
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

      // Marcador base para Etiquetas
      map.addLayer({
        id: ANN_LABEL_DOT_LAYER,
        type: 'circle',
        source: ANNOTATIONS_SOURCE,
        filter: ['==', ['get', 'kind'], 'etiqueta'],
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#10B981',
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.8,
        },
      })

      // 3b. Fuente y capas para polígono en construcción ("Seleccionar Región")
      map.addSource(DRAFT_POLY_SOURCE, {
        type: 'geojson',
        data: buildDraftPolygonGeoJSON([]) as never,
      })
      map.addLayer({
        id: DRAFT_POLY_FILL_LAYER,
        type: 'fill',
        source: DRAFT_POLY_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#10B981',
          'fill-opacity': 0.16,
        },
      })
      map.addLayer({
        id: DRAFT_POLY_LINE_LAYER,
        type: 'line',
        source: DRAFT_POLY_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
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
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5.5,
          'circle-color': '#FFFFFF',
          'circle-stroke-color': '#10B981',
          'circle-stroke-width': 2.2,
        },
      })

      syncViewport()
      setMapReady(true)
    })

    return () => {
      cancelled = true
      map.remove()
      mapRef.current = null
    }
  }, [])

  // 1. Conectar slider de opacidad usando `map.setPaintProperty('nisar-layer', 'raster-opacity', opacidad / 100)`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (map.getLayer(NISAR_LAYER)) {
      map.setPaintProperty(NISAR_LAYER, 'raster-opacity', opacity / 100)
    }
  }, [opacity, mapReady])

  // 2. Actualizar cursor del mapa y `map.dragPan.disable()` / `enable()` según la herramienta activa
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

  // Sincronizar fuente GeoJSON `annotations-source` cuando cambian las anotaciones o el trazo en curso
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(ANNOTATIONS_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(buildAnnotationsGeoJSON(annotations, draftFreehand, draftCircle) as never)
    }
  }, [annotations, draftFreehand, draftCircle, mapReady])

  // Sincronizar fuente GeoJSON `draft-polygon-source` para "Seleccionar Región"
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(DRAFT_POLY_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(buildDraftPolygonGeoJSON(draftPolygon) as never)
    }
  }, [draftPolygon, mapReady])

  // Sincronizar fuente GeoJSON `crop-mask-source` (Máscara Inversa) cuando cambia `croppedRegion`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(CROP_MASK_SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(buildInverseCropMaskGeoJSON(croppedRegion) as never)
    }
  }, [croppedRegion, mapReady])

  // 4. Actualizar `solar-thermal-layer` en tiempo real con `setPaintProperty`
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

  // Volar a la vista de la copia seleccionada y limpiar borradores temporales al cambiar de mapa
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

  // 3. Ejecutar "Recortar región" (fitBounds + máscara inversa)
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

  // Restablecer vista completa al quitar la región recortada
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

  // Posición en pantalla del botón flotante "✂️ Recortar región" sobre el centroide del polígono
  const draftPolyCentroidScreen =
    draftPolygon.length >= 3
      ? projectLngLat(getPolygonBoundsAndCentroid(draftPolygon).centroid, viewport)
      : null

  const labelEditorScreen = labelEditor ? projectLngLat(labelEditor.coord, viewport) : null

  return (
    <main className="map-canvas">
      <div ref={containerRef} className="map-canvas__map" />

      {/* Etiqueta de ubicación y copia activa */}
      <div className="map-badge">
        <span className="map-badge__location">📍 Chiapas, México</span>
        {isEditing && activeMapName && (
          <span className="map-badge__copy">· {activeMapName}</span>
        )}
      </div>

      {/* 3c. Chip flotante arriba del mapa cuando hay una región recortada activa */}
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

      {/* 3. Botón flotante verde "✂️ Recortar región" y "Limpiar puntos" en el centroide del polígono */}
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

      {/* Marcadores limpios georreferenciados para las etiquetas de Círculo Peligro/Advertencia y Etiqueta */}
      <div className="map-markers-layer" aria-hidden="true">
        {annotations.map((ann) => {
          if (ann.kind === 'peligro' || ann.kind === 'advertencia') {
            const topEdgeCoord: LngLat = [ann.center[0], ann.center[1] + ann.radiusKm / 110.574]
            const [x, y] = projectLngLat(topEdgeCoord, viewport)
            return (
              <div
                key={ann.id}
                className={`map-marker-tag ${
                  ann.kind === 'peligro' ? 'map-marker-tag--danger' : 'map-marker-tag--warn'
                }`}
                style={{ left: `${x.toFixed(1)}px`, top: `${(y - 14).toFixed(1)}px` }}
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
                className="map-marker-tag map-marker-tag--custom"
                style={{ left: `${(x + 10).toFixed(1)}px`, top: `${y.toFixed(1)}px` }}
              >
                {ann.text}
              </div>
            )
          }

          return null
        })}
      </div>

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
