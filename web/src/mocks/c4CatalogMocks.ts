import {
  C1_RAW_LAYERS,
  CHIAPAS_ROI_WKT,
  CRID_TRANSITION_DATE,
  PILAS_GCOV_CHIAPAS,
  RAW_SCENE_IDS,
  checkPairCompat,
  resolveSceneIdForStackDate,
} from './initialWorkspaces'

/**
 * Mocks del Contrato C4 alimentados con los metadatos reales verificados en `.h5`
 * de `data/raw/<scene_id>/scene.json` (Contrato C1) y `data/explore/.../metadatos.json` (Etapa 1).
 * Como `data/processed/` (Contrato C2) aún está vacío a la espera de `preprocess.py` y `change.py`,
 * los objetos de cambio Δσ⁰ llevan `isSyntheticMock: true` y `c2Status: 'pendiente'`.
 */

export interface C4Roi {
  id: string
  name: string
  region: string
  wkt: string
  srid: 4326
  targetUtmEpsg: 32615
  gridShapePx: [2687, 5504]
  spacingM: 10
  pixelsInPolygon: 14757214
  isSyntheticMock: boolean
}

export interface C4SceneMeta {
  scene_id: string
  source: 'asf' | 'event'
  product: 'GCOV'
  track: number
  frame: number
  stackId: 'T62/F10' | 'T55/F80' | 'T156/F80'
  direction: 'ASCENDING' | 'DESCENDING'
  polarizations: string[]
  crid: 'P05023' | 'P05036'
  maturity: 'PROVISIONAL' | 'VALIDATED'
  start_time: string
  date: string
  frame_coverage: 'Full' | 'Partial'
  orbit_type: 'MOE' | 'FOE'
  product_version: string
  pge_version: string
  epsg: 32615
  spacing_m: 10
  crop_shape: [2687, 5504]
  roi_valid_pct: number | null
  downloaded_in_raw: boolean
  c1_layers: string[]
  band: string
  repeat_cycle_days: 12
  isSyntheticMock: boolean
}

export interface C4CompatReport {
  t1: string
  t2: string
  t1_scene_id: string
  t2_scene_id: string
  comparable: boolean
  errors: string[]
  warnings: string[]
  isSyntheticMock: boolean
}

export interface C4RunJson {
  run_id: string
  roi_id: string
  c2_status: 'pendiente_ejecucion_p2'
  product: 'NISAR L2 GCOV'
  stack: 'T62/F10' | 'T55/F80' | 'T156/F80'
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
    formula_sigma0: string
    formula_delta: string
    c1_layers_available: string[]
    masks_applied: string[]
    threshold_method: string
    cumsum_forest_ref_db: number
    lband_biomass_saturation_mg_ha: number
  }
  etapa1_roi_reference_stats: {
    reference_scene_id: string
    valid_pixels_in_roi: number
    hhhh_gamma0_mean_db: number
    hhhh_sigma0_mean_db: number
    hvhv_gamma0_mean_db: number
    hvhv_sigma0_mean_db: number
    incidence_angle_mean_deg: number
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
  c2_data_processed_empty: true
  auxiliary_source: string
  auxiliary_date: string
  auxiliary_resolution_m: number
  metrics: {
    precision: null
    recall: null
    f1: null
    iou: null
  }
  scientific_notes: string[]
  isSyntheticMock: boolean
}

export interface C4ChangeSummary {
  id: string
  roi_id: string
  stack: 'T62/F10' | 'T55/F80' | 'T156/F80'
  role: 'principal' | 'respaldo' | 'catalogo'
  product: 'NISAR L2 GCOV'
  t1_scene_id: string
  t2_scene_id: string
  t1_date: string
  t2_date: string
  roi_valid_pct: number | null
  polarizations: ['HH', 'HV']
  crid: 'P05023'
  maturity: 'PROVISIONAL'
  unit: 'dB (γ⁰/σ⁰)'
  status: 'exploratorio'
  c2_status: 'pendiente_en_data_processed'
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
    name: 'Chiapas, México (Malla UTM EPSG:32615 · 2687 × 5504 px a 10 m)',
    region: 'Chiapas, México',
    wkt: CHIAPAS_ROI_WKT,
    srid: 4326,
    targetUtmEpsg: 32615,
    gridShapePx: [2687, 5504],
    spacingM: 10,
    pixelsInPolygon: 14757214,
    isSyntheticMock: false,
  },
])

const REAL_DOWNLOADED_META: Record<
  string,
  {
    scene_id: string
    start_time: string
    roi_valid_pct: number
    product_version: string
    pge_version: string
  }
> = {
  'T62/F10:2026-06-18': {
    scene_id: RAW_SCENE_IDS.T62_T1_20260618,
    start_time: '2026-06-18T11:40:10Z',
    roi_valid_pct: 99.57,
    product_version: '1.0.11',
    pge_version: 'R05.02.3',
  },
  'T62/F10:2026-10-16': {
    scene_id: RAW_SCENE_IDS.T62_T2_20261016,
    start_time: '2026-10-16T11:40:06Z',
    roi_valid_pct: 99.61,
    product_version: '1.0.11',
    pge_version: 'R05.02.3',
  },
  'T62/F10:2026-10-28': {
    scene_id: RAW_SCENE_IDS.T62_POST_20261028,
    start_time: '2026-10-28T11:40:06Z',
    roi_valid_pct: 99.61,
    product_version: '1.0.20',
    pge_version: 'R05.03.2',
  },
  'T55/F80:2026-06-18': {
    scene_id: RAW_SCENE_IDS.T55_T1_20260618,
    start_time: '2026-06-18T00:40:48Z',
    roi_valid_pct: 50.28,
    product_version: '1.0.11',
    pge_version: 'R05.02.3',
  },
  'T55/F80:2026-10-16': {
    scene_id: RAW_SCENE_IDS.T55_T2_20261016,
    start_time: '2026-10-16T00:40:45Z',
    roi_valid_pct: 50.25,
    product_version: '1.0.11',
    pge_version: 'R05.02.3',
  },
}

function buildScenesFromStacks(): C4SceneMeta[] {
  const list: C4SceneMeta[] = []
  const c1LayerFiles = C1_RAW_LAYERS.map((l) => l.archivo)

  for (const stack of PILAS_GCOV_CHIAPAS) {
    for (const date of stack.dates) {
      const real = REAL_DOWNLOADED_META[`${stack.id}:${date}`]
      list.push({
        scene_id: real?.scene_id ?? resolveSceneIdForStackDate(stack.id, date),
        source: 'asf',
        product: 'GCOV',
        track: stack.track,
        frame: stack.frame,
        stackId: stack.id,
        direction: stack.direction,
        polarizations: ['HH', 'HV'],
        crid: 'P05023',
        maturity: 'PROVISIONAL',
        start_time: real?.start_time ?? `${date}T11:40:06Z`,
        date,
        frame_coverage: 'Full',
        orbit_type: 'MOE',
        product_version: real?.product_version ?? '1.0.11',
        pge_version: real?.pge_version ?? 'R05.02.3',
        epsg: 32615,
        spacing_m: 10,
        crop_shape: [2687, 5504],
        roi_valid_pct: real?.roi_valid_pct ?? null,
        downloaded_in_raw: Boolean(real),
        c1_layers: real ? c1LayerFiles : [],
        band: stack.band,
        repeat_cycle_days: 12,
        isSyntheticMock: !real,
      })
    }

    // Escena posterior al corte 2026-10-23 con CRID P05036 (VALIDATED)
    const postDate = stack.postTransitionDate
    const postReal = REAL_DOWNLOADED_META[`${stack.id}:${postDate}`]
    list.push({
      scene_id: postReal?.scene_id ?? stack.postTransitionSceneId,
      source: 'asf',
      product: 'GCOV',
      track: stack.track,
      frame: stack.frame,
      stackId: stack.id,
      direction: stack.direction,
      polarizations: ['HH', 'HV'],
      crid: 'P05036',
      maturity: 'VALIDATED',
      start_time: postReal?.start_time ?? `${postDate}T11:40:06Z`,
      date: postDate,
      frame_coverage: 'Full',
      orbit_type: 'MOE',
      product_version: postReal?.product_version ?? '1.0.20',
      pge_version: postReal?.pge_version ?? 'R05.03.2',
      epsg: 32615,
      spacing_m: 10,
      crop_shape: [2687, 5504],
      roi_valid_pct: postReal?.roi_valid_pct ?? null,
      downloaded_in_raw: Boolean(postReal),
      c1_layers: postReal ? c1LayerFiles : [],
      band: stack.band,
      repeat_cycle_days: 12,
      isSyntheticMock: !postReal,
    })
  }
  return list
}

export const MOCK_SCENES: readonly C4SceneMeta[] = Object.freeze(buildScenesFromStacks())

export const MOCK_CHANGES: readonly C4ChangeSummary[] = Object.freeze([
  {
    id: 'pair-chiapas-t62-f10-20260618-20261016',
    roi_id: 'roi-chiapas-01',
    stack: 'T62/F10',
    role: 'principal',
    product: 'NISAR L2 GCOV',
    t1_scene_id: RAW_SCENE_IDS.T62_T1_20260618,
    t2_scene_id: RAW_SCENE_IDS.T62_T2_20261016,
    t1_date: '2026-06-18',
    t2_date: '2026-10-16',
    roi_valid_pct: 99.59,
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    unit: 'dB (γ⁰/σ⁰)',
    status: 'exploratorio',
    c2_status: 'pendiente_en_data_processed',
    created_at: '2026-11-15T02:43:39Z',
    isSyntheticMock: true,
  },
  {
    id: 'pair-chiapas-t55-f80-20260618-20261016',
    roi_id: 'roi-chiapas-01',
    stack: 'T55/F80',
    role: 'respaldo',
    product: 'NISAR L2 GCOV',
    t1_scene_id: RAW_SCENE_IDS.T55_T1_20260618,
    t2_scene_id: RAW_SCENE_IDS.T55_T2_20261016,
    t1_date: '2026-06-18',
    t2_date: '2026-10-16',
    roi_valid_pct: 50.26,
    polarizations: ['HH', 'HV'],
    crid: 'P05023',
    maturity: 'PROVISIONAL',
    unit: 'dB (γ⁰/σ⁰)',
    status: 'exploratorio',
    c2_status: 'pendiente_en_data_processed',
    created_at: '2026-11-14T23:33:37Z',
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
      c2_status: 'pendiente_ejecucion_p2',
      product: 'NISAR L2 GCOV',
      stack: base.stack,
      t1_scene_id: base.t1_scene_id,
      t2_scene_id: base.t2_scene_id,
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
        t1_scene_id: base.t1_scene_id,
        t2_scene_id: base.t2_scene_id,
        comparable: compatCheck.comparable,
        errors: compatCheck.errors,
        warnings: compatCheck.warnings,
        isSyntheticMock: true,
      },
      parameters: {
        formula_db: 'X_dB = 10 · log10(X)',
        formula_sigma0: 'σ⁰ = γ⁰ · rtcGammaToSigmaFactor',
        formula_delta: 'Δσ⁰_dB(x,y) = σ⁰_dB,t2(x,y) − σ⁰_dB,t1(x,y)',
        c1_layers_available: C1_RAW_LAYERS.map((l) => l.archivo),
        masks_applied: [
          'mask.tif (0 = no válido, 255 = fuera de adquisición)',
          'shadowMaskingApplied=False en GCOV original (aplicar con DEM en preprocess.py)',
        ],
        threshold_method: 'Pendiente de ejecución de preprocess.py y change.py (Contrato C2)',
        cumsum_forest_ref_db: -13.0,
        lband_biomass_saturation_mg_ha: 100,
      },
      etapa1_roi_reference_stats: {
        reference_scene_id: RAW_SCENE_IDS.T62_POST_20261028,
        valid_pixels_in_roi: 14699442,
        hhhh_gamma0_mean_db: -8.06,
        hhhh_sigma0_mean_db: -9.79,
        hvhv_gamma0_mean_db: -13.5,
        hvhv_sigma0_mean_db: -15.23,
        incidence_angle_mean_deg: 43.89,
        valid_roi_coverage_pct: base.roi_valid_pct ?? 99.59,
      },
      cogs: {
        t1_db: `/data/processed/${base.id}/t1_db.tif`,
        t2_db: `/data/processed/${base.id}/t2_db.tif`,
        delta_db: `/data/processed/${base.id}/delta_db.tif`,
        zscore: `/data/processed/${base.id}/zscore.tif`,
        change_mask: `/data/processed/${base.id}/change_mask.tif`,
      },
      code_version: '19de237',
      isSyntheticMock: true,
    },
    validation: {
      status: 'exploratorio',
      c2_data_processed_empty: true,
      auxiliary_source: 'Pendiente de elección del fenómeno (GPM IMERG / HLS / OPERA DSWx)',
      auxiliary_date: base.t2_date,
      auxiliary_resolution_m: 10,
      metrics: {
        precision: null,
        recall: null,
        f1: null,
        iou: null,
      },
      scientific_notes: [
        'Estado honesto C2: data/processed/ está vacío a la espera de preprocess.py y change.py (Rol P2).',
        'Visualización actual en mapa: Etapa 1 (Inspección GCOV γ⁰/σ⁰ en dB sobre la ROI de 2687 × 5504 px en EPSG:32615).',
        `Bloqueo CRID activo desde ${CRID_TRANSITION_DATE}: la 5ta escena descargada (${RAW_SCENE_IDS.T62_POST_20261028}) tiene CRID P05036 (VALIDATED) y no se mezcla con P05023 (PROVISIONAL).`,
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
    generated_at: '2026-11-15T02:45:00Z',
    title: `Reporte Reproducible TerraPulse AI — ${detail.stack} (${detail.t1_date} → ${detail.t2_date})`,
    roi: MOCK_ROIS[0],
    run: detail.run,
    validation: detail.validation,
    limitations: {
      observation:
        'Recortes GCOV reales (Contrato C1 en data/raw/) en malla UTM EPSG:32615 a 10 × 10 m (2687 × 5504 px) con capas HHHH.tif, HVHV.tif, mask.tif, numberOfLooks.tif y rtcGammaToSigmaFactor.tif.',
      inference:
        'Hipótesis física según NISAR Handbook (2025): caída especular HH/HV en agua abierta (N2O), doble rebote agua-tronco en HH para vegetación inundada (N2IV) o variación volumétrica del dosel en HV (anomalía CUMSUM).',
      what_delta_does_not_prove:
        'Un cambio en retrodispersión Δγ⁰/Δσ⁰ describe un cambio en la respuesta radar, no identifica por sí solo la causa física. El mapa de cambio Δσ⁰ está pendiente de ejecución del Contrato C2 en data/processed/.',
      handbook_reference:
        'NISAR Science Users’ Handbook, 2nd Edition (Oct 2025), JPL / NASA-ISRO, DOI: 10.48577/jpl.UD4HV3 (§5.2–§5.3 GCOV & RTC Factor, §6.2–§6.4 Ecosystems & Inundation).',
    },
    isSyntheticMock: true,
  }
}
