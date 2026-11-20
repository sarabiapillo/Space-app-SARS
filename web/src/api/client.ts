import { translate as tr, localizeText } from '../i18n/core.ts'
import type {
  C4ChangeDetail,
  C4ChangeReport,
  C4ChangeSummary,
  C4CompatReport,
  C4Roi,
  C4SceneMeta,
} from '../mocks/c4CatalogMocks'
import type {
  ExploreChartsManifest,
  ExploreLayerEntry,
  ExploreLayerId,
  ExploreWebManifest,
  GcovStackSpec,
} from '../mocks/initialWorkspaces'

export interface LocationResult {
  place_id: number | string | null
  name: string
  category: string | null
  type: string | null
  address: Record<string, string>
  geometry: { type: 'Point' | 'Polygon' | 'MultiPolygon'; coordinates: unknown }
  selectable_roi: boolean
}

export interface GcovSearchScene {
  scene_id: string
  product: string
  start_time: string
  date: string | null
  track: number | null
  frame: number | null
  direction: string | null
  polarizations: string[]
  crid: string | null
  maturity: string | null
  size_bytes: number | null
  frame_coverage: string | null
  footprint: unknown
  roi_intersection: unknown
  coverage_pct: number | null
  coverage_source: string | null
  downloaded?: boolean
  local_path?: string | null
}

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

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const detail = ['detail', 'query', 'radius_km', 'place_id', 'geometry', 'q', 'roi', 'scene_id']
      .map(key => body?.[key])
      .find(value => (typeof value === 'string' && value.length > 0) || (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0))
    const message = Array.isArray(detail) ? detail[0] : detail
    throw new Error(typeof message === 'string' ? localizeText(message) : `Error HTTP ${response.status}`)
  }
  return body as T
}

export const searchLocations = (query: string) => apiJson<{ results: LocationResult[]; attribution: string; license: string }>(`/api/locations?q=${encodeURIComponent(query)}`)

/** Photon suggests text only; the selected name is resolved through the explicit Nominatim search. */
export const suggestLocations = (query: string, signal?: AbortSignal) => apiJson<{ suggestions: Array<{ name: string; query: string }>; attribution: string }>(`/api/locations/suggest?q=${encodeURIComponent(query)}`, { signal })

export interface LocationRoiResponse {
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }
  original_geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }
  metadata: { name: string; center: [number, number]; radius_km: number; applied_radius_km: number; source: string; generation: string }
}

export function generateLocationRoi(input: { place_id: number | string | null; query: string; radius_km: number }) {
  return apiJson<LocationRoiResponse>('/api/locations/roi', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}
export const searchGcov = (roi: unknown, start?: string, end?: string) => apiJson<{ scenes: GcovSearchScene[]; count: number; coverage_note: string }>('/api/gcov/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roi, ...(start ? { start } : {}), ...(end ? { end } : {}) }) })
export interface GcovDownloadStatus { job_id?: string; status?: 'queued' | 'running' | 'ready' | 'error'; progress: string; scene_id?: string; path?: string; already_present?: boolean }
export const requestGcovDownload = (scene_id: string, roi: unknown) => apiJson<GcovDownloadStatus>('/api/gcov/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene_id, roi }) })
export const getGcovDownloadStatus = (jobId: string) => apiJson<GcovDownloadStatus>(`/api/gcov/downloads/${encodeURIComponent(jobId)}`)

export interface GetScenesParams {
  roi?: string
  track?: number
  maturity?: 'BETA' | 'PROVISIONAL' | 'VALIDATED'
}

export interface ApiEnvelope<T> {
  data: T
  isSyntheticMock: boolean
}

async function fetchApi<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  const contentType = res.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => null) as T | { detail?: string }
    : null
  if (!res.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null
    throw new Error(detail ? localizeText(detail) : `Error HTTP ${res.status}`)
  }
  if (body === null) throw new Error(tr('Respuesta JSON inválida de {path}', 'Invalid JSON response from {path}', { path }))
  return { data: body as T, isSyntheticMock: false }
}

/** `GET /api/rois` — Regiones de interés registradas en PostGIS (Contrato C4). */
export async function getRois(): Promise<ApiEnvelope<C4Roi[]>> {
  return fetchApi('/api/rois')
}

/** `GET /api/scenes?roi=&track=&maturity=` — Escenas NISAR GCOV normalizadas (Contrato C4). */
export async function getScenes(params: GetScenesParams = {}): Promise<ApiEnvelope<C4SceneMeta[]>> {
  const qs = new URLSearchParams()
  if (params.roi) qs.set('roi', params.roi)
  if (params.track !== undefined) qs.set('track', String(params.track))
  if (params.maturity) qs.set('maturity', params.maturity)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''

  return fetchApi(`/api/scenes${suffix}`)
}

/** `GET /api/changes` — Lista de corridas de cambio Δγ⁰/Δσ⁰ en dB (Contrato C4). */
export async function getChanges(): Promise<ApiEnvelope<C4ChangeSummary[]>> {
  return fetchApi('/api/changes')
}

/** `GET /api/changes/{id}` — Detalle de corrida con `run.json` y `validation.json` incrustados (Contrato C4). */
export async function getChangeDetail(id: string): Promise<ApiEnvelope<C4ChangeDetail>> {
  return fetchApi(`/api/changes/${encodeURIComponent(id)}`)
}

/** `GET /api/compat?t1=&t2=` — Verificación estricta de comparabilidad de par (Contrato C4). */
export async function checkCompat(
  t1: string,
  t2: string,
  stackId: GcovStackSpec['id'] = 'T62/F10',
): Promise<ApiEnvelope<C4CompatReport>> {
  const qs = new URLSearchParams({ t1, t2, stack: stackId })
  return fetchApi(`/api/compat?${qs.toString()}`)
}

/** `GET /api/changes/{id}/report` — Datos estructurados del reporte reproducible (Contrato C4). */
export async function getChangeReport(id: string): Promise<ApiEnvelope<C4ChangeReport>> {
  return fetchApi(`/api/changes/${encodeURIComponent(id)}/report`)
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
      throw new Error(tr('No hay capas preparadas para esta escena.', 'No layers have been prepared for this scene.'))
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
  throw new Error(tr('No hay capas preparadas para esta escena.', 'No layers have been prepared for this scene.'))
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
      message: tr('Escala común verificada: -22 a 0 dB (--escala-web -22 0)', 'Verified common scale: -22 to 0 dB (--escala-web -22 0)'),
    }
  }

  if (sameScale) {
    return {
      valid: true,
      vminT1,
      vmaxT1,
      vminT2,
      vmaxT2,
      message: tr('Escala común verificada: {min} a {max} dB', 'Verified common scale: {min} to {max} dB', { min: vminT1, max: vmaxT1 }),
    }
  }

  return {
    valid: false,
    vminT1,
    vmaxT1,
    vminT2,
    vmaxT2,
    message: tr('Advertencia de escala: t1 ({min1}..{max1} dB) ≠ t2 ({min2}..{max2} dB). Ejecutar con el mismo --escala-web.', 'Scale warning: t1 ({min1}..{max1} dB) ≠ t2 ({min2}..{max2} dB). Run with the same --escala-web.', { min1: vminT1, max1: vmaxT1, min2: vminT2, max2: vmaxT2 }),
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
        error: tr('La escena {id} aún no tiene graficas.json en data/explore/. Ejecuta `python -m pipeline.etapa1` para generarlo (disponible actualmente para T62/F10 t1 y t2).', 'Scene {id} does not yet have graficas.json in data/explore/. Run `python -m pipeline.etapa1` to generate it (currently available for T62/F10 t1 and t2).', { id: granuleId }),
      }
    }

    const res = await fetch(sourceUrl, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return {
        manifest: null,
        sourceUrl,
        error: tr('HTTP {status}: no existe graficas.json en disco para {id}. Ejecuta `python -m pipeline.etapa1` para generarlo.', 'HTTP {status}: graficas.json is not on disk for {id}. Run `python -m pipeline.etapa1` to generate it.', { status: res.status, id: granuleId }),
      }
    }
    const json = (await res.json()) as ExploreChartsManifest
    if (!json || !Array.isArray(json.graficas) || json.graficas.length === 0) {
      return {
        manifest: null,
        sourceUrl,
        error: tr('El archivo {url} no contiene el arreglo `graficas`.', 'File {url} does not contain the `graficas` array.', { url: sourceUrl }),
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
          ? tr('No se pudo leer {url}: {message}', 'Could not read {url}: {message}', { url: sourceUrl, message: localizeText(err.message) })
          : tr('Error al leer {url}', 'Error reading {url}', { url: sourceUrl }),
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

export interface FloodRoiRun { id: string; state: string; stage: string; error?: string | null; synthetic?: boolean; hydraulic_accuracy_validated?: boolean; dg2_depth_thresh_m?: number | null; losses?: {infiltration: string; runoff_coefficient: number | null; atmospheric_pressure_hpa: number | null; barometric_surge_m: number} | null }
export interface FloodRoiStats { wet_cells?: number; max_depth_m?: number; mean_depth_m?: number; [key: string]: unknown }
export interface FloodRoiResult {
  frames: Array<{frame_index: number; scheduled_time_s: number | null; time_s: null; stats: FloodRoiStats}>
  maximum: {stats: FloodRoiStats}
  artifacts: Array<{name: string; url: string; frame_index?: number | null; scheduled_time_s?: number | null}>
  warnings?: string[]; synthetic?: boolean; hydraulic_accuracy_validated?: boolean
  /** Solver-velocity arrows per frame; null for runs without LISFLOOD-FP voutput. */
  flow?: FloodRoiFlow | null
  grid?: {cellsize_m: number; shape?: [number, number]}
  /** Chart inputs (null in older runs): depth class lower bounds (m), synthetic rain segments and the volume series. */
  depth_classes_m?: number[] | null
  rainfall_segments?: Array<{start_s: number; end_s: number; intensity_mm_h: number}> | null
  mass_balance?: {series?: Array<[number, number, number]>; [key: string]: unknown} | null
  /** Hydraulic indicators (null in older runs). */
  froude?: {min_depth_m: number; frames: Array<{frame_index: number; cells: number; max: number | null; mean: number | null; supercritical_cells: number}>} | null
  time_of_concentration?: {minutes: number; flow_length_m: number; slope_m_m: number; upslope_area_km2: number; outlet: [number, number]} | null
}
/** Each arrow is [lon, lat, speed m/s, bearing degrees clockwise from true north]. */
export interface FloodRoiFlow {
  units: 'm/s'; min_depth_m: number; method?: string
  /** Overflow-only arrows (absent in older runs): D8 channel threshold and arrow cap. */
  channel_min_upslope_km2?: number; max_arrows?: number
  frames: Array<{frame_index: number; max_speed_m_s: number; arrows: Array<[number, number, number, number]>}>
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function roiRunPath(id: string) {
  if (!uuidPattern.test(id)) throw new Error('ID de corrida inválido')
  return `/api/flood-roi-runs/${id}/`
}
export function roiFloodArtifactUrl(id: string, name: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.tif$/.test(name) || name.includes('..')) throw new Error('Nombre de artefacto inválido')
  return `${roiRunPath(id)}artifacts/${name}/`
}
function csrfCookie() {
  return typeof document === 'undefined' ? '' : decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('csrftoken='))?.slice(10) ?? '')
}
async function roiResponse(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {credentials:'same-origin', ...init})
  if (!response.ok) {
    if (response.status===401 || response.status===403) throw new Error('Sesión requerida o CSRF vencido. Inicia sesión en /admin/login/ y vuelve a intentar.')
    const body = await response.json().catch(()=>null)
    const errors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).flat() : []
    const detail = errors.find((v): v is string => typeof v==='string') ?? (typeof body?.detail==='string' ? body.detail : null)
    throw new Error(detail ?? (response.status===503 ? 'Servicio DG2 no disponible (HTTP 503).' : `Error HTTP ${response.status}`))
  }
  return response
}
export async function startRoiFlood(req: unknown, signal?: AbortSignal): Promise<FloodRoiRun> {
  const res = await roiResponse('/api/flood-scenarios/roi/start/', {method:'POST',signal,headers:{'Content-Type':'application/json','Accept':'application/json','X-CSRFToken':csrfCookie()},body:JSON.stringify(req)})
  if (res.status!==202) throw new Error('Respuesta de inicio DG2 inválida')
  const run = await res.json() as FloodRoiRun
  roiRunPath(run.id)
  return run
}
export async function getRoiFloodStatus(id: string, signal?: AbortSignal): Promise<FloodRoiRun> {
  return (await roiResponse(roiRunPath(id),{signal,headers:{Accept:'application/json'}})).json()
}
export async function getRoiFloodResults(id: string, signal?: AbortSignal): Promise<FloodRoiResult> {
  return (await roiResponse(`${roiRunPath(id)}results/`,{signal,headers:{Accept:'application/json'}})).json()
}
export async function getRoiFloodPreview(id: string, name: string, signal?: AbortSignal) {
  const res = await roiResponse(`${roiFloodArtifactUrl(id,name)}preview/`,{signal})
  const raw=res.headers.get('X-Preview-Bounds')?.split(',').map(Number)
  if (res.headers.get('X-Preview-CRS')!=='EPSG:3857' || res.headers.get('X-Preview-Units')!=='m' || !res.headers.get('content-type')?.startsWith('image/png') || raw?.length!==4 || !raw.every(Number.isFinite) || raw[0]<-180 || raw[2]>180 || raw[1]<-90 || raw[3]>90 || raw[0]>=raw[2] || raw[1]>=raw[3]) throw new Error('Metadatos de preview inválidos')
  return {blob:await res.blob(),bounds:raw as [number,number,number,number]}
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
    throw new Error(localizeText(msg))
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
  charts?: {
    depth_classes: Array<{ desde_m: number; hasta_m: number | null; celdas: number; area_km2: number; pct_mojado: number }>
    cell_size_m: number
    wet_threshold_m: number
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



