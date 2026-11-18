/**
 * Mapa de cambio t2 − t1 de una ROI (`result.change` de `/api/roi-jobs/{id}`, generado por
 * `pipeline/change.py → change_from_db_cogs`). Los PNG ya vienen coloreados azul–blanco–rojo
 * con escala simétrica: no se pasan por la LUT de la capa de una fecha.
 */
import type { ExploreLayerEntry, ExploreLayerId } from '../mocks/initialWorkspaces.ts'

export type ChangePolarization = 'HH' | 'HV'

export interface ChangeMetrics {
  pixeles_validos?: number
  area_valida_km2: number
  media_dB?: number
  mediana_dB: number
  desv_estandar_dB?: number
  area_disminucion_km2: number
  area_aumento_km2: number
  area_estable_km2?: number
  pct_disminucion: number
  pct_aumento: number
  pct_estable?: number
}

export type ChangeLayerEntry = Omit<ExploreLayerEntry, 'id'> & { id: string }

export interface RoiChangeManifest {
  tipo: 'mapa_de_cambio'
  t1: string
  t2: string
  umbral_dB: number
  capas: ChangeLayerEntry[]
  metricas: Partial<Record<ChangePolarization, ChangeMetrics>>
  advertencias: string[]
  metadatos?: string
}

/** Rampa vertical equivalente a la paleta RdBu de `pipeline/web_export.py` (abajo −, arriba +). */
const RDBU: ReadonlyArray<readonly [number, number, number]> = [
  [5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240],
  [255, 255, 255],
  [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31],
]
export const CHANGE_GRADIENT_VERTICAL = `linear-gradient(to top, ${RDBU
  .map(([r, g, b], i) => `rgb(${r}, ${g}, ${b}) ${(i * 100) / (RDBU.length - 1)}%`)
  .join(', ')})`

export function changePolarization(layerId: ExploreLayerId | string): ChangePolarization {
  return layerId.includes('HVHV') ? 'HV' : 'HH'
}

export function isChangeManifest(value: unknown): value is RoiChangeManifest {
  const v = value as RoiChangeManifest | null
  return Boolean(v && v.tipo === 'mapa_de_cambio' && Array.isArray(v.capas) && v.capas.length > 0)
}

/** Capa Δ de la misma polarización que la capa elegida en la cinta (γ⁰/σ⁰ HH o HV). */
export function pickChangeLayer(change: RoiChangeManifest | null, layerId: ExploreLayerId | string): ChangeLayerEntry | null {
  if (!isChangeManifest(change)) return null
  const pol = changePolarization(layerId)
  return change.capas.find((c) => c.capa === `${pol}${pol}`) ?? null
}

export function pickChangeMetrics(change: RoiChangeManifest | null, layerId: ExploreLayerId | string): ChangeMetrics | null {
  if (!isChangeManifest(change)) return null
  return change.metricas[changePolarization(layerId)] ?? null
}
