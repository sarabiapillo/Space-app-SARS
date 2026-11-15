import {
  MOCK_CHANGES,
  MOCK_ROIS,
  MOCK_SCENES,
  buildMockChangeDetail,
  buildMockChangeReport,
  type C4ChangeDetail,
  type C4ChangeReport,
  type C4ChangeSummary,
  type C4CompatReport,
  type C4Roi,
  type C4SceneMeta,
} from '../mocks/c4CatalogMocks'
import { checkPairCompat, type GcovStackSpec } from '../mocks/initialWorkspaces'

export type {
  C4Roi,
  C4SceneMeta,
  C4CompatReport,
  C4ChangeSummary,
  C4ChangeDetail,
  C4ChangeReport,
}

export interface GetScenesParams {
  roi?: string
  track?: number
  maturity?: 'BETA' | 'PROVISIONAL' | 'VALIDATED'
}

export interface ApiEnvelope<T> {
  data: T
  isSyntheticMock: boolean
}

async function fetchOrFallback<T>(path: string, fallback: () => T): Promise<ApiEnvelope<T>> {
  try {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 1600)
    const res = await fetch(path, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    window.clearTimeout(timeoutId)

    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const json = (await res.json()) as T
        return { data: json, isSyntheticMock: false }
      }
    }
  } catch {
    // El backend local de Django aún no está levantado; se devuelve el mock sintético de C4.
  }

  return {
    data: fallback(),
    isSyntheticMock: true,
  }
}

/** `GET /api/rois` — Regiones de interés registradas en PostGIS (Contrato C4). */
export async function getRois(): Promise<ApiEnvelope<C4Roi[]>> {
  return fetchOrFallback('/api/rois', () =>
    MOCK_ROIS.map((r) => ({ ...r, isSyntheticMock: true })),
  )
}

/** `GET /api/scenes?roi=&track=&maturity=` — Escenas NISAR GCOV normalizadas (Contrato C4). */
export async function getScenes(params: GetScenesParams = {}): Promise<ApiEnvelope<C4SceneMeta[]>> {
  const qs = new URLSearchParams()
  if (params.roi) qs.set('roi', params.roi)
  if (params.track !== undefined) qs.set('track', String(params.track))
  if (params.maturity) qs.set('maturity', params.maturity)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''

  return fetchOrFallback(`/api/scenes${suffix}`, () =>
    MOCK_SCENES.filter((s) => {
      if (params.track !== undefined && s.track !== params.track) return false
      if (params.maturity !== undefined && s.maturity !== params.maturity) return false
      return true
    }).map((s) => ({ ...s, isSyntheticMock: true })),
  )
}

/** `GET /api/changes` — Lista de corridas de cambio Δγ⁰/Δσ⁰ en dB (Contrato C4). */
export async function getChanges(): Promise<ApiEnvelope<C4ChangeSummary[]>> {
  return fetchOrFallback('/api/changes', () =>
    MOCK_CHANGES.map((c) => ({ ...c, isSyntheticMock: true })),
  )
}

/** `GET /api/changes/{id}` — Detalle de corrida con `run.json` y `validation.json` incrustados (Contrato C4). */
export async function getChangeDetail(id: string): Promise<ApiEnvelope<C4ChangeDetail>> {
  return fetchOrFallback(`/api/changes/${encodeURIComponent(id)}`, () =>
    buildMockChangeDetail(id),
  )
}

/** `GET /api/compat?t1=&t2=` — Verificación estricta de comparabilidad de par (Contrato C4). */
export async function checkCompat(
  t1: string,
  t2: string,
  stackId: GcovStackSpec['id'] = 'T55/F80',
): Promise<ApiEnvelope<C4CompatReport>> {
  const qs = new URLSearchParams({ t1, t2, stack: stackId })
  return fetchOrFallback(`/api/compat?${qs.toString()}`, () => {
    const res = checkPairCompat(t1, t2, stackId)
    return {
      t1,
      t2,
      comparable: res.comparable,
      errors: res.errors,
      warnings: res.warnings,
      isSyntheticMock: true,
    }
  })
}

/** `GET /api/changes/{id}/report` — Datos estructurados del reporte reproducible (Contrato C4). */
export async function getChangeReport(id: string): Promise<ApiEnvelope<C4ChangeReport>> {
  return fetchOrFallback(`/api/changes/${encodeURIComponent(id)}/report`, () =>
    buildMockChangeReport(id),
  )
}
