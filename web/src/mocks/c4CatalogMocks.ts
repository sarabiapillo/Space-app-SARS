import {
  CHIAPAS_ROI_WKT,
  CRID_TRANSITION_DATE,
  PILAS_GCOV_CHIAPAS,
  checkPairCompat,
} from './initialWorkspaces'

/**
 * Mocks sintéticos oficiales del Contrato C4 (`docs/plan-de-trabajo.md` §3).
 * Todos los objetos incluyen `isSyntheticMock: true` para distinguirlos de resultados reales.
 */

export interface C4Roi {
  id: string
  name: string
  region: string
  wkt: string
  srid: 4326
  targetUtmEpsg: 32615
  isSyntheticMock: boolean
}

export interface C4SceneMeta {
  scene_id: string
  source: 'asf' | 'event'
  product: 'GCOV'
  track: number
  frame: number
  stackId: 'T55/F80' | 'T62/F10' | 'T156/F80'
  direction: 'DESCENDING' | 'ASCENDING'
  polarizations: string[]
  crid: 'P05023' | 'P05036'
  maturity: 'PROVISIONAL' | 'VALIDATED'
  start_time: string
  date: string
  frame_coverage: 'Full' | 'Partial'
  orbit_type: 'MOE' | 'FOE'
  epsg: 32615
  band: string
  repeat_cycle_days: 12
  isSyntheticMock: boolean
}

export interface C4CompatReport {
  t1: string
  t2: string
  comparable: boolean
  errors: string[]
  warnings: string[]
  isSyntheticMock: boolean
}

export interface C4RunJson {
  run_id: string
  roi_id: string
  product: 'NISAR L2 GCOV'
  stack: 'T55/F80' | 'T62/F10' | 'T156/F80'
  t1_scene_id: string
  t2_scene_id: string
  t1_date: string
  t2_date: string
  polarizations: ['HH', 'HV']
  crid: 'P05023'
  maturity: 'PROVISIONAL'
  unit: 'dB (γ⁰/σ⁰)'
  epsg: 32615
  compat: C4CompatReport
  parameters: {
    formula_db: string
    formula_delta: string
     masks_applied: string[]
    threshold_method: string
    threshold_db_hh: number
    threshold_db_hv: number
    cumsum_forest_ref_db: number
    lband_biomass_saturation_mg_ha: number
  }
  statistics: {
    mean_delta_hh_db: number
    std_delta_hh_db: number
    p05_delta_hh_db: number
    p95_delta_hh_db: number
    mean_delta_hv_db: number
    std_delta_hv_db: number
    changed_pixels_pct: number
    valid_roi_coverage_pct: number
  }
  cogs: {
    t1_db: string
    t2_db: string
    delta_db: string
    zscore: string
    change_mask: string
  }
  code_version: string
  isSyntheticMock: boolean
}

export interface C4ValidationJson {
  status: 'exploratorio' | 'validado'
  auxiliary_source: string
  auxiliary_date: string
  auxiliary_resolution_m: number
  metrics: {
    precision: number | null
    recall: number | null
    f1: number | null
    iou: number | null
  }
  scientific_notes: string[]
  isSyntheticMock: boolean
}

export interface C4ChangeSummary {
  id: string
  roi_id: string
  stack: 'T55/F80' | 'T62/F10' | 'T156/F80'
  product: 'NISAR L2 GCOV'
  t1_date: string
  t2_date: string
  polarizations: ['HH', 'HV']
  crid: 'P05023'
  maturity: 'PROVISIONAL'
  unit: 'dB (γ⁰/σ⁰)'
  status: 'exploratorio'
  created_at: string
  isSyntheticMock: boolean
}

export interface C4ChangeDetail extends C4ChangeSummary {
  run: C4RunJson
  validation: C4ValidationJson
}

export interface C4ChangeReport {
  change_id: string
  generated_at: string
  title: string
  roi: C4Roi
  run: C4RunJson
  validation: C4ValidationJson
  limitations: {
    observation: string
    inference: string
    what_delta_does_not_prove: string
    handbook_reference: string
  }
  isSyntheticMock: boolean
}

export const MOCK_ROIS: readonly C4Roi[] = Object.freeze([
  {
    id: 'roi-chiapas-01',
    name: 'Chiapas, México (Caso de estudio principal)',
    region: 'Chiapas, México',
    wkt: CHIAPAS_ROI_WKT,
    srid: 4326,
    targetUtmEpsg: 32615,
    isSyntheticMock: true,
  },
])

function buildScenesFromStacks(): C4SceneMeta[] {
  const list: C4SceneMeta[] = []
  for (const stack of PILAS_GCOV_CHIAPAS) {
    const dirCode = stack.direction === 'DESCENDING' ? 'D' : 'A'
    const trackStr = String(stack.track).padStart(3, '0')
    const frameStr = String(stack.frame).padStart(3, '0')

    for (const date of stack.dates) {
      const compactDate = date.replace(/-/g, '')
      list.push({
        scene_id: `NISAR_L2_PR_GCOV_001_${trackStr}_${dirCode}_${frameStr}_4005_DHDH_A_${compactDate}T120000_${compactDate}T120035_P05023_001`,
        source: 'asf',
        product: 'GCOV',
        track: stack.track,
        frame: stack.frame,
        stackId: stack.id,
        direction: stack.direction,
        polarizations: ['HH', 'HV'],
        crid: 'P05023',
        maturity: 'PROVISIONAL',
        start_time: `${date}T12:00:00Z`,
        date,
        frame_coverage: 'Full',
        orbit_type: 'MOE',
        epsg: 32615,
        band: stack.band,
        repeat_cycle_days: 12,
        isSyntheticMock: true,
      })
    }

    // Escena posterior al 2026-10-23 con CRID P05036 para probar el bloqueo de comparabilidad
    const postCompact = stack.postTransitionDate.replace(/-/g, '')
    list.push({
      scene_id: `NISAR_L2_PR_GCOV_001_${trackStr}_${dirCode}_${frameStr}_4005_DHDH_A_${postCompact}T120000_${postCompact}T120035_P05036_001`,
      source: 'asf',
      product: 'GCOV',
      track: stack.track,
      frame: stack.frame,
      stackId: stack.id,
      direction: stack.direction,
      polarizations: ['HH', 'HV'],
      crid: 'P05036',
      maturity: 'VALIDATED',
      start_time: `${stack.postTransitionDate}T12:00:00Z`,
      date: stack.postTransitionDate,
      frame_coverage: 'Full',
      orbit_type: 'MOE',
      epsg: 32615,
      band: stack.band,
      repeat_cycle_days: 12,
      isSyntheticMock: true,
    })
  }
  return list
}

export const MOCK_SCENES: readonly C4SceneMeta[] = Object.freeze(buildScenesFromStacks())

export const MOCK_CHANGES: readonly C4ChangeSummary[] = Object.freeze([
  {
    id: 'run-chiapas-t55-20260618-20261016',
    roi_id: 'roi-chiapas-01',
    stack: 'T55/F80',
    product: 'NISAR L2 GCOV',
    t1_date: '2026-06-18',
    t2_date: '2026-10-16',
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    unit: 'dB (γ⁰/σ⁰)',
    status: 'exploratorio',
    created_at: '2026-11-14T18:00:00Z',
    isSyntheticMock: true,
  },
  {
    id: 'run-chiapas-t62-20260618-20261016',
    roi_id: 'roi-chiapas-01',
    stack: 'T62/F10',
    product: 'NISAR L2 GCOV',
    t1_date: '2026-06-18',
    t2_date: '2026-10-16',
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    unit: 'dB (γ⁰/σ⁰)',
    status: 'exploratorio',
    created_at: '2026-11-14T18:10:00Z',
    isSyntheticMock: true,
  },
  {
    id: 'run-chiapas-t156-20260625-20261011',
    roi_id: 'roi-chiapas-01',
    stack: 'T156/F80',
    product: 'NISAR L2 GCOV',
    t1_date: '2026-06-25',
    t2_date: '2026-10-11',
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    unit: 'dB (γ⁰/σ⁰)',
    status: 'exploratorio',
    created_at: '2026-11-14T18:20:00Z',
    isSyntheticMock: true,
  },
])

export function buildMockChangeDetail(changeId: string): C4ChangeDetail {
  const base =
    MOCK_CHANGES.find((c) => c.id === changeId) ?? MOCK_CHANGES[0]
  const compatCheck = checkPairCompat(base.t1_date, base.t2_date, base.stack)

  return {
    ...base,
    run: {
      run_id: base.id,
      roi_id: base.roi_id,
      product: 'NISAR L2 GCOV',
      stack: base.stack,
      t1_scene_id: `NISAR_L2_PR_GCOV_${base.stack.replace('/', '_')}_${base.t1_date}_P05023`,
      t2_scene_id: `NISAR_L2_PR_GCOV_${base.stack.replace('/', '_')}_${base.t2_date}_P05023`,
      t1_date: base.t1_date,
      t2_date: base.t2_date,
      polarizations: ['HH', 'HV'],
      crid: 'P05023',
      maturity: 'PROVISIONAL',
      unit: 'dB (γ⁰/σ⁰)',
      epsg: 32615,
      compat: {
        t1: base.t1_date,
        t2: base.t2_date,
        comparable: compatCheck.comparable,
        errors: compatCheck.errors,
        warnings: compatCheck.warnings,
        isSyntheticMock: true,
      },
      parameters: {
        formula_db: 'γ⁰_dB = 10 · log10(γ⁰)',
        formula_delta: 'Δγ⁰_dB(x,y) = γ⁰_dB,t2(x,y) − γ⁰_dB,t1(x,y)',
        masks_applied: ['nodata / ceros GCOV', 'layover / sombra radar', 'pendiente DEM > 25°'],
        threshold_method: 'Umbral por estadística regional + Z-score respecto a pila P05023',
        threshold_db_hh: 3.0,
        threshold_db_hv: 2.5,
        cumsum_forest_ref_db: -13.0,
        lband_biomass_saturation_mg_ha: 100,
      },
      statistics: {
        mean_delta_hh_db: -0.84,
        std_delta_hh_db: 2.15,
        p05_delta_hh_db: -4.62,
        p95_delta_hh_db: 2.94,
        mean_delta_hv_db: -0.52,
        std_delta_hv_db: 1.78,
        changed_pixels_pct: 6.4,
        valid_roi_coverage_pct: 98.2,
      },
      cogs: {
        t1_db: `/data/processed/${base.id}/t1_db.tif`,
        t2_db: `/data/processed/${base.id}/t2_db.tif`,
        delta_db: `/data/processed/${base.id}/delta_db.tif`,
        zscore: `/data/processed/${base.id}/zscore.tif`,
        change_mask: `/data/processed/${base.id}/change_mask.tif`,
      },
      code_version: '0.1.0-mock-c4',
      isSyntheticMock: true,
    },
    validation: {
      status: 'exploratorio',
      auxiliary_source: 'Precipitación CHIRPS / IMERG + óptico Sentinel-2 MSI (pendiente cruce etiquetado)',
      auxiliary_date: base.t2_date,
      auxiliary_resolution_m: 20,
      metrics: {
        precision: null,
        recall: null,
        f1: null,
        iou: null,
      },
      scientific_notes: [
        'Resultado marcado como EXPLORATORIO (AGENTS.md §6): sin etiquetas de campo independientes no se reporta exactitud.',
        `CRID P05023 consistente en ambas fechas (previo al corte ${CRID_TRANSITION_DATE} → P05036).`,
        'NISAR Science Users’ Handbook (2nd Ed., Oct 2025, DOI: 10.48577/jpl.UD4HV3): caída especular HH/HV sugiere lámina de agua abierta (N2O); incremento fuerte de HH sugiere doble rebote agua-tronco en vegetación inundada (N2IV).',
      ],
      isSyntheticMock: true,
    },
    isSyntheticMock: true,
  }
}

export function buildMockChangeReport(changeId: string): C4ChangeReport {
  const detail = buildMockChangeDetail(changeId)
  return {
    change_id: detail.id,
    generated_at: '2026-11-14T20:00:00Z',
    title: `Reporte Reproducible TerraPulse AI — ${detail.stack} (${detail.t1_date} → ${detail.t2_date})`,
    roi: MOCK_ROIS[0],
    run: detail.run,
    validation: detail.validation,
    limitations: {
      observation:
        'Variación cuantitativa en el coeficiente de retrodispersión radar banda L (24 cm, 1.257 GHz) γ⁰/σ⁰ en dB entre adquisiciones co-registradas en malla UTM EPSG:32615.',
      inference:
        'Hipótesis física compatible con transición a agua abierta (reflexión especular N2O), vegetación inundada (doble rebote diedro agua-tronco N2IV en HH) o cambio de dispersión volumétrica en dosel (canal cruzado HV).',
      what_delta_does_not_prove:
        'Un cambio en retrodispersión Δγ⁰/Δσ⁰ describe un cambio en la respuesta dieléctrica y geométrica al radar, pero NO identifica por sí solo la causa física sin contraste con datos auxiliares independientes (AGENTS.md §2.4).',
      handbook_reference:
        'NISAR Science Users’ Handbook, 2nd Edition (Oct 2025), JPL / NASA-ISRO, DOI: 10.48577/jpl.UD4HV3 (§6.2 Forests & Biomass, §6.3 Soil Moisture, §6.4 Inundation & Wetlands).',
    },
    isSyntheticMock: true,
  }
}
