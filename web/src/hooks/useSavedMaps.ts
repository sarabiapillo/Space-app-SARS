import { useCallback, useEffect, useState } from 'react'
import {
  DANGER_CIRCLE_DEFAULT_LABEL,
  DEFAULT_SOLAR,
  ESCENA_CHIAPAS,
  RAW_SCENE_IDS,
  LEGACY_CIRCLE_LABELS,
  WARN_CIRCLE_DEFAULT_LABEL,
} from '../mocks/initialWorkspaces'
import {
  CARPETAS,
  type LngLat,
  type MapAnnotation,
  type SolarSimulationState,
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

function normalizeSolar(raw: unknown): SolarSimulationState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SOLAR }
  const s = raw as Record<string, unknown>
  return {
    // El simulador solar no aplica a un radar activo (NISAR): siempre apagado, aunque se haya guardado encendido.
    enabled: false,
    sunAngle: isNumber(s.sunAngle) ? Math.max(0, Math.min(180, s.sunAngle)) : DEFAULT_SOLAR.sunAngle,
    radiationIntensity: isNumber(s.radiationIntensity)
      ? Math.max(0, Math.min(100, s.radiationIntensity))
      : DEFAULT_SOLAR.radiationIntensity,
  }
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
    solar: normalizeSolar(m.solar),
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
