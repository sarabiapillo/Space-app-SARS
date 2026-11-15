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
import {
  checkPairCompat,
  type ExploreChartsManifest,
  type ExploreLayerEntry,
  type ExploreLayerId,
  type ExploreWebManifest,
  type GcovStackSpec,
} from '../mocks/initialWorkspaces'

export type {
  C4Roi,
  C4SceneMeta,
  C4CompatReport,
  C4ChangeSummary,
  C4ChangeDetail,
  C4ChangeReport,
  ExploreChartsManifest,
  ExploreLayerId,
  ExploreLayerEntry,
  ExploreWebManifest,
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
  stackId: GcovStackSpec['id'] = 'T62/F10',
): Promise<ApiEnvelope<C4CompatReport>> {
  const qs = new URLSearchParams({ t1, t2, stack: stackId })
  return fetchOrFallback(`/api/compat?${qs.toString()}`, () => {
    const res = checkPairCompat(t1, t2, stackId)
    return {
      t1,
      t2,
      t1_scene_id: res.t1SceneId,
      t2_scene_id: res.t2SceneId,
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

interface ExploreDiskIndex {
  scenes: Record<string, { hasCapas: boolean; hasGraficas: boolean }>
}

let exploreIndexPromise: Promise<ExploreDiskIndex | null> | null = null

async function getExploreDiskIndex(): Promise<ExploreDiskIndex | null> {
  if (!exploreIndexPromise) {
    exploreIndexPromise = fetch('/data/explore/_index.json', {
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) return null
        return (await res.json()) as ExploreDiskIndex
      })
      .catch(() => null)
  }
  return exploreIndexPromise
}

/**
 * Consulta el manifiesto `/data/explore/<granuleId>/web/capas.json` (`explore-web-1`, `docs/p1-etapa1-web.md` §4 y §5).
 */
export async function fetchExploreManifest(granuleId: string): Promise<ExploreWebManifest> {
  try {
    const idx = await getExploreDiskIndex()
    if (idx && !idx.scenes[granuleId]?.hasCapas) {
      throw new Error('No hay capas preparadas para esta escena.')
    }

    const res = await fetch(`/data/explore/${encodeURIComponent(granuleId)}/web/capas.json`, {
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const json = (await res.json()) as ExploreWebManifest
      if (json && Array.isArray(json.capas) && json.capas.length > 0) {
        return json
      }
    }
  } catch {
    // No sustituir una escena ausente por imágenes de otra región.
  }
  throw new Error('No hay capas preparadas para esta escena.')
}

export interface ExploreScaleVerification {
  valid: boolean
  vminT1: number
  vmaxT1: number
  vminT2: number
  vmaxT2: number
  message: string
}

/**
 * Verifica que los dos manifiestos tengan `escala.vmin_dB === -22` y `escala.vmax_dB === 0`
 * (y que coincidan entre `t1` y `t2`) antes de habilitar o mostrar el deslizador antes/después (`docs/p1-etapa1-web.md` §5).
 */
export function verifyExploreScaleMatch(
  m1: ExploreWebManifest,
  m2: ExploreWebManifest,
  layerId: ExploreLayerId,
): ExploreScaleVerification {
  const c1 = m1.capas.find((c) => c.id === layerId) ?? m1.capas[0]
  const c2 = m2.capas.find((c) => c.id === layerId) ?? m2.capas[0]
  const vminT1 = c1?.escala.vmin_dB ?? -22
  const vmaxT1 = c1?.escala.vmax_dB ?? 0
  const vminT2 = c2?.escala.vmin_dB ?? -22
  const vmaxT2 = c2?.escala.vmax_dB ?? 0

  const sameScale = vminT1 === vminT2 && vmaxT1 === vmaxT2
  const isFixed22To0 = vminT1 === -22 && vmaxT1 === 0 && vminT2 === -22 && vmaxT2 === 0

  if (sameScale && isFixed22To0) {
    return {
      valid: true,
      vminT1,
      vmaxT1,
      vminT2,
      vmaxT2,
      message: 'Escala común verificada: -22 a 0 dB (--escala-web -22 0)',
    }
  }

  if (sameScale) {
    return {
      valid: true,
      vminT1,
      vmaxT1,
      vminT2,
      vmaxT2,
      message: `Escala común verificada: ${vminT1} a ${vmaxT1} dB`,
    }
  }

  return {
    valid: false,
    vminT1,
    vmaxT1,
    vminT2,
    vmaxT2,
    message: `Advertencia de escala: t1 (${vminT1}..${vmaxT1} dB) ≠ t2 (${vminT2}..${vmaxT2} dB). Ejecutar con el mismo --escala-web.`,
  }
}

export interface ExploreChartsFetchResult {
  manifest: ExploreChartsManifest | null
  sourceUrl: string
  error: string | null
}

/**
 * Carga `/data/explore/<granuleId>/graficas.json` (`graficas-etapa1-1`, `docs/p1-graficas-chartjs.md`).
 * Nunca inventa series si el archivo no existe para esa escena; devuelve `manifest: null` y el motivo.
 */
export async function fetchExploreCharts(granuleId: string): Promise<ExploreChartsFetchResult> {
  const sourceUrl = `/data/explore/${encodeURIComponent(granuleId)}/graficas.json`
  try {
    const idx = await getExploreDiskIndex()
    if (idx && !idx.scenes[granuleId]?.hasGraficas) {
      return {
        manifest: null,
        sourceUrl,
        error: `La escena ${granuleId} aún no tiene graficas.json en data/explore/. Ejecuta \`python -m pipeline.etapa1\` para generarlo (disponible actualmente para T62/F10 t1 y t2).`,
      }
    }

    const res = await fetch(sourceUrl, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return {
        manifest: null,
        sourceUrl,
        error: `HTTP ${res.status}: no existe graficas.json en disco para ${granuleId}. Ejecuta \`python -m pipeline.etapa1\` para generarlo.`,
      }
    }
    const json = (await res.json()) as ExploreChartsManifest
    if (!json || !Array.isArray(json.graficas) || json.graficas.length === 0) {
      return {
        manifest: null,
        sourceUrl,
        error: `El archivo ${sourceUrl} no contiene el arreglo \`graficas\`.`,
      }
    }
    return {
      manifest: json,
      sourceUrl,
      error: null,
    }
  } catch (err) {
    return {
      manifest: null,
      sourceUrl,
      error:
        err instanceof Error
          ? `No se pudo leer ${sourceUrl}: ${err.message}`
          : `Error al leer ${sourceUrl}`,
    }
  }
}

export interface SolarSimulationRequest {
  roi: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
  datetime_local: string
  timezone: string
  intensity_percent: number
  temperature_c?: number
  pressure_hpa?: number
}

export interface SolarSimulationResponse {
  id: string
  status: string
  model: string
  units: string
  position: {
    azimuth_deg: number
    apparent_elevation_deg: number
    geometric_elevation_deg: number
    altitude_m: number
    altitude_datum: string
    pressure_hpa: number
    pressure_provenance: string
    temperature_c: number
    datetime_local: string
    timezone: string
  }
  clear_sky: {
    dni_clear_sky_w_m2: number
    dni_adjusted_w_m2: number
    linke_turbidity: number
    airmass_relative: number
  }
  layers: {
    incident: {
      preview_url: string
      export_url: string
    }
  }
  preview?: {
    crs: string
    bounds_lonlat: [number, number, number, number]
    width: number
    height: number
    palette: string
  }
  sample_url: string
}

export async function runSolarSimulation(
  req: SolarSimulationRequest
): Promise<SolarSimulationResponse> {
  const res = await fetch('/api/solar/simulations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error HTTP ${res.status}` }))
    throw new Error(err.error || `Error HTTP ${res.status}`)
  }
  return res.json()
}

export interface FloodRainfallInput {
  amount?: number
  unit?: 'mm'
  intensity?: number
  intensity_unit?: 'mm/h' | 'mm/min' | 'mm/s'
  duration: number
  duration_unit: 's' | 'min' | 'h'
}

export interface FloodPrepareRequest {
  rainfall: FloodRainfallInput
  roi: {
    type: 'Polygon'
    coordinates: number[][][]
  }
  pressure_hpa?: number
  rainfall_profile?: {
    interval_count: number
    seed: number
    distribution: 'uniform_balanced'
  }
}

export interface FloodProfileSegment {
  start_s: number
  end_s: number
  intensity_m_s: number
}

export interface FloodPrepareResponse {
  rainfall: {
    mode: string
    input: FloodRainfallInput
    amount_m: number
    duration_s: number
    mean_intensity_m_s: number
  }
  roi: {
    type: 'Polygon'
    coordinates: number[][][]
  }
  can_simulate: boolean
  layers: unknown[]
  dem: {
    status: string
    provider_available: boolean
  }
  blockers: string[]
  rainfall_profile?: {
    segments: FloodProfileSegment[]
    distribution: {
      name: string
      interval_count: number
      seed: number
    }
    synthetic: boolean
    hydraulic_ready: boolean
  }
}

export async function prepareFloodScenario(
  req: FloodPrepareRequest
): Promise<FloodPrepareResponse> {
  const res = await fetch('/api/flood-scenarios/prepare/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ errors: { request: ['Error al procesar la solicitud'] } }))
    const msg =
      err.errors?.rainfall?.[0] ||
      err.errors?.roi?.[0] ||
      err.errors?.rainfall_profile?.[0] ||
      err.errors?.request?.[0] ||
      `Error HTTP ${res.status}`
    throw new Error(msg)
  }
  return res.json()
}

export interface FloodSimulateResponse {
  status: string
  dataUrl: string
  bounds: [number, number, number, number]
  stats: {
    rainfallMm: number
    durationHours: number
    totalVolumeM3: number
    effectiveVolumeM3?: number
    infiltratedVolumeM3?: number
    floodedVolumeM3?: number
    effectiveRunoffMm?: number
    infiltratedMm?: number
    floodedAreaKm2: number
    floodedAreaPct: number
    maxDepthM: number
    meanDepthM: number
    waterSurfaceHa: number
    peakDischargeM3s?: number
    maxVelocityMs?: number
    meanVelocityMs?: number
    froudeNumber?: number
    froudeRegime?: string
    timeOfConcentrationMin?: number
    timeOfConcentrationHours?: number
    elevMinM?: number
    elevMaxM?: number
    waterLevelMinM?: number
    waterLevelMaxM?: number
    stormDays?: number
    pressureHpa?: number
    baroSurgeCm?: number
    saturationPct?: number
    roadsTotalAffectedKm?: number
    roadsCutKm?: number
    roadsWarningKm?: number
    riskLevel?: string
    riskDescription?: string
  }
  hydro_equations?: Record<string, string>
  model_metadata?: {
    topography_dem: string
    flow_algorithm: string
    hydraulic_law: string
    infiltration: string
    color_palette: string
  }
}

export async function simulateFloodScenario(
  req: FloodPrepareRequest
): Promise<FloodSimulateResponse> {
  const res = await fetch('/api/flood-scenarios/simulate/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error al simular inundación' }))
    throw new Error(err.error || `Error HTTP ${res.status}`)
  }
  return res.json()
}



