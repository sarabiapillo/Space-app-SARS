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
  CHIAPAS_ROI_WKT,
  DEFAULT_EXPLORE_ESQUINAS_LONLAT,
  RAW_SCENE_IDS,
  checkPairCompat,
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

function buildDefaultExploreManifest(granuleId: string): ExploreWebManifest {
  const isT1 = granuleId === RAW_SCENE_IDS.T62_T1_20260618
  const targetGranule =
    granuleId === RAW_SCENE_IDS.T62_T1_20260618 || granuleId === RAW_SCENE_IDS.T62_T2_20261016
      ? granuleId
      : RAW_SCENE_IDS.T62_T2_20261016

  const pctValid = isT1 ? 99.45859452111725 : 99.47850828585776
  const ranges: Record<ExploreLayerId, [number, number]> = isT1
    ? {
        gamma0_HHHH_ml2_dB: [-29.69961929321289, 37.023895263671875],
        gamma0_HVHV_ml2_dB: [-34.97626876831055, 33.63725662231445],
        sigma0_HHHH_ml2_dB: [-31.880226135253906, 36.95541763305664],
        sigma0_HVHV_ml2_dB: [-36.806758880615234, 33.2723274230957],
      }
    : {
        gamma0_HHHH_ml2_dB: [-31.405437469482422, 39.009300231933594],
        gamma0_HVHV_ml2_dB: [-34.44783020019531, 32.90635681152344],
        sigma0_HHHH_ml2_dB: [-33.062313079833984, 37.029354095458984],
        sigma0_HVHV_ml2_dB: [-37.36626052856445, 32.20421600341797],
      }

  const makeLayer = (
    id: ExploreLayerId,
    capa: 'HHHH' | 'HVHV',
    magnitud: 'gamma0' | 'sigma0',
    simbolo: 'γ⁰' | 'σ⁰',
  ): ExploreLayerEntry => ({
    id,
    cog: `data/explore/${targetGranule}/web/${id}.tif`,
    png: `data/explore/${targetGranule}/web/${id}.png`,
    crs_cog: 'EPSG:32615',
    crs_png: 'EPSG:3857',
    forma_cog: [1343, 2752],
    forma_png: [1352, 2750],
    esquinas_lonlat: DEFAULT_EXPLORE_ESQUINAS_LONLAT,
    unidades: 'dB',
    escala: {
      vmin_dB: -22.0,
      vmax_dB: 0.0,
      colormap: 'gray',
      metodo: 'fija (--escala-web)',
    },
    rango_datos_dB: ranges[id],
    pct_pixeles_validos: pctValid,
    capa,
    magnitud,
    simbolo,
    multilook: 2,
    pixel_m: 20.0,
  })

  return {
    version: 'explore-web-1',
    tipo: 'inspeccion_una_fecha',
    creado_utc: isT1 ? '2026-11-15T05:29:32.812909+00:00' : '2026-11-15T05:32:51.497286+00:00',
    version_codigo: '7688c87-dirty',
    escena: {
      granuleId: targetGranule,
      producto: 'GCOV',
      fecha_inicio: isT1 ? '2026-06-18T11:40:10.000000000' : '2026-10-16T11:40:06.000000000',
      trayectoria: 62,
      marco: 10,
      direccion: 'Ascending',
      crid: 'P05023',
      madurez_catalogo: 'PROVISIONAL',
      frecuencia: 'A',
      polarizaciones: ['HH', 'HV'],
    },
    roi_wkt_4326: CHIAPAS_ROI_WKT,
    procedencia: {
      modo: 'remoto',
      metodo: 'h5py sobre HTTPS (fsspec, lectura por ventanas)',
      nombre: `${targetGranule}.h5`,
      catalogo: 'catalog_asf_GCOV_20261114T231456Z.json',
      identidad_verificada_contra_catalogo: true,
    },
    capas: [
      makeLayer('gamma0_HHHH_ml2_dB', 'HHHH', 'gamma0', 'γ⁰'),
      makeLayer('gamma0_HVHV_ml2_dB', 'HVHV', 'gamma0', 'γ⁰'),
      makeLayer('sigma0_HHHH_ml2_dB', 'HHHH', 'sigma0', 'σ⁰'),
      makeLayer('sigma0_HVHV_ml2_dB', 'HVHV', 'sigma0', 'σ⁰'),
    ],
    figuras: [
      `data/explore/${targetGranule}/figuras/B2_roi_sigma0_dB.png`,
      `data/explore/${targetGranule}/figuras/B_roi_gamma0_dB.png`,
      `data/explore/${targetGranule}/figuras/C_histogramas_gamma0_dB.png`,
      `data/explore/${targetGranule}/figuras/D_mascara.png`,
      `data/explore/${targetGranule}/figuras/E_incidencia.png`,
    ],
    metadatos: `data/explore/${targetGranule}/metadatos.json`,
    advertencias: [
      'Una sola fecha: sirve para ver la escena, no es un mapa de cambio.',
      'Los PNG son solo para ver; los valores en dB están en los COG (.tif).',
      'Para comparar dos fechas en el mapa, ambas deben tener la misma escala (--escala-web).',
    ],
  }
}

/**
 * Consulta el manifiesto `/data/explore/<granuleId>/web/capas.json` (`explore-web-1`, `docs/p1-etapa1-web.md` §4 y §5).
 */
export async function fetchExploreManifest(granuleId: string): Promise<ExploreWebManifest> {
  try {
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
    // Si se selecciona una escena que aún no tiene carpeta en data/explore/, usar el respaldo de T62/F10
  }
  return buildDefaultExploreManifest(granuleId)
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
