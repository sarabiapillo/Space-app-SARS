import { useCallback, useEffect, useState } from 'react'
import { createInitialCopies, DEFAULT_SOLAR, ESCENA_CHIAPAS } from '../mocks/initialWorkspaces'
import {
  CARPETAS,
  type LngLat,
  type MapAnnotation,
  type SolarSimulationState,
  type WorkspaceMap,
} from '../types/workspace'
import { buildAnnotationsGeoJSON } from '../utils/geojson'

export const STORAGE_KEY = 'terrapulse_saved_maps'

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
    const defaultLabel = a.kind === 'peligro' ? 'Zona de Peligro' : 'Zona de Advertencia'
    return {
      id: a.id,
      kind: a.kind,
      center: a.center,
      radiusKm: a.radiusKm,
      label: typeof a.label === 'string' && a.label.trim() ? a.label : defaultLabel,
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
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SOLAR.enabled,
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

  return {
    id: m.id,
    nombre: m.nombre,
    carpeta: m.carpeta as WorkspaceMap['carpeta'],
    fechaModificacion: m.fechaModificacion,
    esEditable: true,
    opacidadSar: m.opacidadSar,
    centro: m.centro,
    zoom: m.zoom,
    escena: {
      granuleId:
        typeof escenaRaw?.granuleId === 'string' ? escenaRaw.granuleId : ESCENA_CHIAPAS.granuleId,
      epsg: isNumber(escenaRaw?.epsg) ? escenaRaw.epsg : ESCENA_CHIAPAS.epsg,
      banda: typeof escenaRaw?.banda === 'string' ? escenaRaw.banda : ESCENA_CHIAPAS.banda,
      fuente: typeof escenaRaw?.fuente === 'string' ? escenaRaw.fuente : ESCENA_CHIAPAS.fuente,
    },
    annotations,
    geojson: buildAnnotationsGeoJSON(annotations, [], null),
    croppedRegion,
    solar: normalizeSolar(m.solar),
  }
}

function parse(raw: string | null): WorkspaceMap[] | null {
  if (raw === null) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    const parsed = data.map(normalizeMap).filter((x): x is WorkspaceMap => x !== null)
    return parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

function loadInitial(): WorkspaceMap[] {
  try {
    return parse(localStorage.getItem(STORAGE_KEY)) ?? createInitialCopies()
  } catch {
    return createInitialCopies()
  }
}

/**
 * Lista de copias editables sincronizada automáticamente con `localStorage`.
 */
export function useSavedMaps() {
  const [maps, setMaps] = useState<WorkspaceMap[]>(loadInitial)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(maps))
    } catch {
      // Sin persistencia: sigue funcionando en memoria.
    }
  }, [maps])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      const next = parse(event.newValue)
      if (next) setMaps(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const addMap = useCallback((map: WorkspaceMap) => {
    setMaps((prev) => [map, ...prev])
  }, [])

  const updateMap = useCallback((id: string, changes: Partial<Omit<WorkspaceMap, 'id'>>) => {
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
    setMaps((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return { maps, addMap, updateMap, deleteMap }
}
