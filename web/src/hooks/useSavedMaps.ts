import { useCallback, useEffect, useState } from 'react'
import {
  DANGER_CIRCLE_DEFAULT_LABEL,
  DEFAULT_SOLAR,
  ESCENA_CHIAPAS,
  RAW_SCENE_IDS,
  LEGACY_CIRCLE_LABELS,
  WARN_CIRCLE_DEFAULT_LABEL,
  DEFAULT_FLOOD,
  DEFAULT_SEISMIC,
} from '../mocks/initialWorkspaces'
import {
  CARPETAS,
  type LngLat,
  type MapAnnotation,
  type SolarSimulationState,
  type FloodSimulationState,
  type SeismicSimulationState,
  type WorkspaceMap,
} from '../types/workspace'
import { buildAnnotationsGeoJSON } from '../utils/geojson'
import { isRoiGeometry } from '../utils/roi'

const LEGACY_STORAGE_KEY = 'terrapulse_saved_maps_c1'
export const STORAGE_KEY = 'terrapulse_saved_maps_c2'

const EMPTY_SCENE = { granuleId: '', t1SceneId: '', t2SceneId: '', producto: '', descripcionProducto: '', epsg: 0, resolucionM: '', coberturaRoiPct: '', banda: '', polarizacion: '', madurez: 'PROVISIONAL' as const, cicloRepeticion: '', pila: 'T62/F10' as const, direccion: 'ASCENDING' as const, t1: '', t2: '', crid: '', unidad: '', fuente: '' }

export function isUnchangedSeededDemo(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  const escena = typeof m.escena === 'object' && m.escena !== null ? m.escena as Record<string, unknown> : {}
  const first = m.id === 'copia-1-presa-malpaso'
  const signature = first
    ? { name: 'Copia 1 - Sector Noroeste ROI (T62/F10 Principal)', center: [-93.1338, 16.77515], zoom: 10.3, opacity: 75, folder: 'Mis Análisis', solarAngle: 105, solarIntensity: 60 }
    : m.id === 'copia-2-sierra'
      ? { name: 'Copia 2 - Sector Este Grijalva (T55/F80 Respaldo)', center: [-93.03, 16.75], zoom: 10.4, opacity: 65, folder: 'Zonas de Riesgo', solarAngle: 125, solarIntensity: 70 }
      : null
  const expectedScene = first ? ESCENA_CHIAPAS : { ...ESCENA_CHIAPAS, granuleId: RAW_SCENE_IDS.T55_T1_20260618, t1SceneId: RAW_SCENE_IDS.T55_T1_20260618, t2SceneId: RAW_SCENE_IDS.T55_T2_20261016, pila: 'T55/F80', direccion: 'DESCENDING', coberturaRoiPct: '~50.3% este (t1: 50.28%, t2: 50.25%)' }
  return Boolean(signature && m.nombre === signature.name && JSON.stringify(m.centro) === JSON.stringify(signature.center) && m.zoom === signature.zoom && m.opacidadSar === signature.opacity && m.carpeta === signature.folder && !m.croppedRegion && (!Array.isArray(m.annotations) || m.annotations.length === 0) && JSON.stringify(escena) === JSON.stringify(expectedScene) && typeof m.solar === 'object' && m.solar !== null && (m.solar as Record<string, unknown>).sunAngle === signature.solarAngle && (m.solar as Record<string, unknown>).radiationIntensity === signature.solarIntensity)
}

export function getInitialSavedMaps(raw: string | null): WorkspaceMap[] {
  const entries = parseEntries(raw)
  if (entries === null) return []
  return entries
    .filter((entry) => !isUnchangedSeededDemo(entry))
    .map(normalizeMap)
    .filter((map): map is WorkspaceMap => map !== null)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1])
}

function normalizeAnnotation(raw: unknown): MapAnnotation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const a = raw as Record<string, unknown>
  if (typeof a.id !== 'string') return null

  if (a.kind === 'lapiz' && Array.isArray(a.points) && a.points.every(isLngLat)) {
    return { id: a.id, kind: 'lapiz', points: a.points }
  }
  if (
    (a.kind === 'peligro' || a.kind === 'advertencia') &&
    isLngLat(a.center) &&
    isNumber(a.radiusKm)
  ) {
    const defaultLabel =
      a.kind === 'peligro' ? DANGER_CIRCLE_DEFAULT_LABEL : WARN_CIRCLE_DEFAULT_LABEL
    const rawLabel = typeof a.label === 'string' ? a.label.trim() : ''
    const isLegacyGeneric = rawLabel === '' || LEGACY_CIRCLE_LABELS.includes(rawLabel)
    return {
      id: a.id,
      kind: a.kind,
      center: a.center,
      radiusKm: a.radiusKm,
      label: isLegacyGeneric ? defaultLabel : rawLabel,
    }
  }
  if (a.kind === 'etiqueta' && isLngLat(a.position) && typeof a.text === 'string') {
    return { id: a.id, kind: 'etiqueta', position: a.position, text: a.text }
  }
  return null
}

function safeLocalApiUrl(value: unknown, runId?: string): string | null {
  if (typeof value !== 'string') return null
  if (runId === undefined) return /^\/api\/[a-zA-Z0-9/_.-]+(?:\?[a-zA-Z0-9_=&.%-]*)?$/.test(value) ? value : null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) return null
  return new RegExp(`^/api/solar/simulations/${runId}/(?:preview/incident|export/incident|contours|sample)$`, 'i').test(value) ? value : null
}

function solarSimulationMatchesCopy(result: Record<string, unknown> | null, roi: unknown): boolean {
  if (!result || typeof result.id !== 'string' || !roi || typeof result.request !== 'object' || result.request === null) return false
  return JSON.stringify((result.request as Record<string, unknown>).roi) === JSON.stringify(roi)
}

function normalizeSolar(raw: unknown, roi: unknown): SolarSimulationState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SOLAR }
  const s = raw as Record<string, unknown>
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
  const candidateResult = asRecord(s.simulationResult)
  const candidateId = typeof candidateResult?.id === 'string' ? candidateResult.id : ''
  const candidateLayers = asRecord(candidateResult?.layers)
  const incidentLayer = asRecord(candidateLayers?.incident)
  const linksMatchRun = Boolean(candidateResult &&
    safeLocalApiUrl(incidentLayer?.preview_url, candidateId) &&
    safeLocalApiUrl(incidentLayer?.export_url, candidateId) &&
    safeLocalApiUrl(incidentLayer?.contours_url, candidateId) &&
    safeLocalApiUrl(candidateResult.sample_url, candidateId))
  const simulationResult = linksMatchRun && solarSimulationMatchesCopy(candidateResult, roi) ? candidateResult : null
  const runId = typeof simulationResult?.id === 'string' ? simulationResult.id : ''
  const analysisResult = simulationResult ? asRecord(s.analysisResult) : null
  const histogram = asRecord(analysisResult?.histogram)
  const statistics = asRecord(analysisResult?.statistics)
  const validAnalysis = analysisResult && analysisResult.units === 'W/m2' && isNumber(analysisResult.valid_cells) &&
    statistics && Array.isArray(histogram?.bin_edges) && Array.isArray(histogram?.counts)
    ? analysisResult as unknown as SolarSimulationState['analysisResult'] : null
  const contours = simulationResult ? asRecord(s.contours) : null
  const rasterPreviewUrl = safeLocalApiUrl(s.rasterPreviewUrl, runId)
  const rasterBounds = Array.isArray(s.rasterBounds) && s.rasterBounds.length === 4 && s.rasterBounds.every(isNumber)
    ? s.rasterBounds as SolarSimulationState['rasterBounds'] : null
  return {
    enabled: s.enabled === true,
    sunAngle: isNumber(s.sunAngle) ? Math.max(0, Math.min(180, s.sunAngle)) : DEFAULT_SOLAR.sunAngle,
    elevationDeg: isNumber(s.elevationDeg) ? Math.max(0, Math.min(90, s.elevationDeg)) : DEFAULT_SOLAR.elevationDeg,
    azimuthDeg: isNumber(s.azimuthDeg) ? ((s.azimuthDeg % 360) + 360) % 360 : DEFAULT_SOLAR.azimuthDeg,
    radiationIntensity: isNumber(s.radiationIntensity) ? Math.max(0, Math.min(100, s.radiationIntensity)) : DEFAULT_SOLAR.radiationIntensity,
    simulationResult: simulationResult as unknown as SolarSimulationState['simulationResult'],
    analysisResult: validAnalysis,
    contours: contours && contours.type === 'FeatureCollection' && Array.isArray(contours.features) ? contours as unknown as SolarSimulationState['contours'] : null,
    showContours: s.showContours !== false,
    selectedZoneId: typeof s.selectedZoneId === 'string' ? s.selectedZoneId : undefined,
    rasterPreviewUrl,
    rasterBounds,
    showRasterOnMap: s.showRasterOnMap !== false,
    layerOpacity: isNumber(s.layerOpacity) ? Math.max(0, Math.min(100, s.layerOpacity)) : DEFAULT_SOLAR.layerOpacity,
    radiusKm: isNumber(s.radiusKm) ? Math.max(1, Math.min(10, s.radiusKm)) : DEFAULT_SOLAR.radiusKm,
    heatmapMode: s.heatmapMode === 'absoluto' ? 'absoluto' : 'estirado',
  }
}

function normalizeFlood(raw: unknown): WorkspaceMap['flood'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const f = raw as Record<string, unknown>
  const rasterBounds = Array.isArray(f.rasterBounds) && f.rasterBounds.length === 4 && f.rasterBounds.every(isNumber) ? f.rasterBounds as [number, number, number, number] : null
  return { ...DEFAULT_FLOOD, ...f, enabled: f.enabled === true, rasterUrl: safeLocalApiUrl(f.rasterUrl), rasterBounds,
    stats: typeof f.stats === 'object' && f.stats !== null ? f.stats as FloodSimulationState['stats'] : null,
    charts: typeof f.charts === 'object' && f.charts !== null ? f.charts as FloodSimulationState['charts'] : null }
}

function normalizeSeismic(raw: unknown): WorkspaceMap['seismic'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const s = raw as Record<string, unknown>
  return { ...DEFAULT_SEISMIC, ...s, enabled: s.enabled === true,
    epicenter: isLngLat(s.epicenter) ? s.epicenter : DEFAULT_SEISMIC.epicenter,
    magnitude: isNumber(s.magnitude) ? Math.max(0, Math.min(10, s.magnitude)) : DEFAULT_SEISMIC.magnitude,
    depthKm: isNumber(s.depthKm) ? Math.max(0, Math.min(700, s.depthKm)) : DEFAULT_SEISMIC.depthKm,
    mechanism: ['subduction', 'intraplate', 'crustal'].includes(String(s.mechanism)) ? s.mechanism as SeismicSimulationState['mechanism'] : DEFAULT_SEISMIC.mechanism,
    soilType: ['rock', 'intermediate', 'soft_lacustrine'].includes(String(s.soilType)) ? s.soilType as SeismicSimulationState['soilType'] : DEFAULT_SEISMIC.soilType }
}

/** Normaliza cada copia guardada en `localStorage` para garantizar todos los campos y su GeoJSON. */
function normalizeMap(value: unknown): WorkspaceMap | null {
  if (typeof value !== 'object' || value === null) return null
  const m = value as Record<string, unknown>
  if (
    typeof m.id !== 'string' ||
    typeof m.nombre !== 'string' ||
    !CARPETAS.includes(m.carpeta as never) ||
    typeof m.fechaModificacion !== 'string' ||
    m.esEditable !== true ||
    !isNumber(m.opacidadSar) ||
    !isLngLat(m.centro) ||
    !isNumber(m.zoom)
  ) {
    return null
  }

  const escenaRaw = m.escena as Record<string, unknown> | undefined
  const annotations = Array.isArray(m.annotations)
    ? m.annotations.map(normalizeAnnotation).filter((x): x is MapAnnotation => x !== null)
    : []
  const croppedRegion =
    Array.isArray(m.croppedRegion) && m.croppedRegion.length >= 3 && m.croppedRegion.every(isLngLat)
      ? m.croppedRegion
      : null
  const effectiveRoi = isRoiGeometry(m.effectiveRoi) ? m.effectiveRoi : null
  const rawMetadata = m.effectiveRoiMetadata
  const effectiveRoiMetadata = effectiveRoi && typeof rawMetadata === 'object' && rawMetadata !== null &&
    typeof (rawMetadata as Record<string, unknown>).name === 'string' &&
    Array.isArray((rawMetadata as Record<string, unknown>).center) &&
    typeof (rawMetadata as Record<string, unknown>).radius_km === 'number' &&
    typeof (rawMetadata as Record<string, unknown>).applied_radius_km === 'number' &&
    typeof (rawMetadata as Record<string, unknown>).source === 'string' &&
    typeof (rawMetadata as Record<string, unknown>).generation === 'string'
      ? rawMetadata as WorkspaceMap['effectiveRoiMetadata'] : null

  const solarRoi = effectiveRoi ?? (croppedRegion ? { type: 'Polygon', coordinates: [[...croppedRegion, croppedRegion[0]]] } : null)

  return {
    id: m.id,
    nombre: m.nombre,
    carpeta: m.carpeta as WorkspaceMap['carpeta'],
    fechaModificacion: m.fechaModificacion,
    esEditable: true,
    opacidadSar: m.opacidadSar,
    centro: m.centro,
    zoom: m.zoom,
    escena: (croppedRegion ? { ...EMPTY_SCENE, ...(escenaRaw ?? {}) } : EMPTY_SCENE) as WorkspaceMap['escena'],
    annotations,
    geojson: buildAnnotationsGeoJSON(annotations, [], null),
    croppedRegion,
    effectiveRoi,
    effectiveRoiMetadata,
    solar: normalizeSolar(m.solar, solarRoi),
    flood: normalizeFlood(m.flood),
    seismic: normalizeSeismic(m.seismic),
  }
}

function parseEntries(raw: string | null): unknown[] | null {
  if (raw === null) return null
  try {
    const data: unknown = JSON.parse(raw)
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

function loadInitial(): WorkspaceMap[] {
  try {
    const current = localStorage.getItem(STORAGE_KEY)
    return getInitialSavedMaps(current === null ? localStorage.getItem(LEGACY_STORAGE_KEY) : current)
  } catch {
    return []
  }
}

/**
 * Lista de copias editables sincronizada automáticamente con `localStorage`.
 */
export function useSavedMaps() {
  const [maps, setMaps] = useState<WorkspaceMap[]>(loadInitial)
  const [hasUserChanges, setHasUserChanges] = useState(false)

  useEffect(() => {
    if (!hasUserChanges) return
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      const entries = parseEntries(stored)
      if (stored !== null && (entries === null || entries.some((entry) => normalizeMap(entry) === null))) return
      localStorage.setItem(STORAGE_KEY, JSON.stringify(maps))
    } catch {
      // Sin persistencia: sigue funcionando en memoria.
    }
  }, [maps, hasUserChanges])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      setMaps(getInitialSavedMaps(event.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const addMap = useCallback((map: WorkspaceMap) => {
    setMaps((prev) => [map, ...prev])
    setHasUserChanges(true)
  }, [])

  const updateMap = useCallback((id: string, changes: Partial<Omit<WorkspaceMap, 'id'>>) => {
    setHasUserChanges(true)
    setMaps((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m
        const nextAnnotations = changes.annotations ?? m.annotations
        const nextGeojson =
          changes.annotations !== undefined
            ? buildAnnotationsGeoJSON(nextAnnotations, [], null)
            : (changes.geojson ?? m.geojson)
        return {
          ...m,
          ...changes,
          annotations: nextAnnotations,
          geojson: nextGeojson,
        }
      }),
    )
  }, [])

  const deleteMap = useCallback((id: string) => {
    setHasUserChanges(true)
    setMaps((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return { maps, addMap, updateMap, deleteMap }
}
