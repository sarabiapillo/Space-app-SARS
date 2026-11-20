import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setLanguage, localizeText, translate } from '../src/i18n/core.ts'
import { formatRelative } from '../src/utils/time.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context) }
      catch { return nextResolve(`${specifier}.tsx`, context) }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
  if (!url.endsWith('.tsx')) return nextLoad(url, context)
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText }
} })

const { RightPanel } = await import('../src/components/RightPanel.tsx')
const { RainDg2Panel } = await import('../src/components/RainDg2Panel.tsx')
const { FloodCharts } = await import('../src/components/FloodCharts.tsx')
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const roi = [[-93.2, 16.7], [-93, 16.7], [-93, 16.8], [-93.2, 16.7]]
const flood = { rainfallAmount: 35, rainfallDuration: 3, pressureHpa: 1005, statsSource: 'backend' }
const solar = { sunAngle: 90, radiationIntensity: 65, heatmapMode: 'estirado' }

test('simulation panels switch display language but retain numeric input and scientific units', () => {
  setLanguage('es')
  const esRain = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  const esSolar = render(RightPanel, { solar, onSolarChange() {}, onClose() {}, croppedRegion: roi })
  assert.match(esRain, /Lluvia hipotética \(mm\)/)
  assert.match(esSolar, /Irradiancia incidente/)
  setLanguage('en')
  const enRain = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  const enSolar = render(RightPanel, { solar, onSolarChange() {}, onClose() {}, croppedRegion: roi })
  assert.match(enRain, /Hypothetical rainfall \(mm\)/)
  // The label text is a span next to the select inside the same <label> (redesigned panel, T1 of flood-ui-friendly).
  assert.match(enRain, /Infiltration<\/span><select/)
  assert.match(enRain, /not modeled \(all rain runs off\)/)
  assert.match(enRain, /Atmospheric pressure \(hPa, 950–1040; optional\)/)
  assert.match(enRain, /Synthetic profile seed/)
  assert.match(enSolar, /Incident irradiance/)
  assert.match(enSolar, /aria-valuenow="90"/)
  assert.match(enSolar, /value="90"/)
  assert.doesNotMatch(enRain, /Lluvia hipotética|escorrentía/)
  setLanguage('es')
})

test('redesigned DG2 panel shows its steps, example action and explanation in the selected language only', () => {
  setLanguage('es')
  const es = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  for (const text of [/Cargar valores de ejemplo/, /Opciones avanzadas/, /Cómo funciona la simulación/, /Mar al sur/, /celdas de|resolución/]) assert.match(es, text)
  assert.match(es, /Copernicus GLO-30 \(recomendado\)/)
  assert.match(es, /Terreno<\/span><select/)
  assert.doesNotMatch(es, /m, EGM96|\(EGM96\)/)
  setLanguage('en')
  const en = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  for (const text of [/Load example values/, /Advanced options/, /How the simulation works/, /Sea to the south/]) assert.match(en, text)
  assert.match(en, /Copernicus GLO-30 \(recommended\)/)
  assert.match(en, /EGM2008/)
  assert.doesNotMatch(en, /m, EGM96|\(EGM96\)|recomendado/)  // sea levels are EGM2008 now
  assert.doesNotMatch(en, /Cargar valores|Opciones avanzadas|Cómo funciona|Mar al sur|Tierra adentro|Faltan valores/)
  setLanguage('es')
})

test('flood result and charts preserve synthetic and unobserved qualification in both languages', () => {
  const stats = { rainfallMm: 35, durationHours: 3, totalVolumeM3: 2000, floodedAreaKm2: 1.2, floodedAreaPct: 10, waterSurfaceHa: 120, maxDepthM: 0.2, meanDepthM: 0.1, riskLevel: 'Leve', riskDescription: 'Encharcamientos laminares menores en llanura', effectiveVolumeM3: 1000, infiltratedVolumeM3: 500, floodedVolumeM3: 500 }
  const charts = { depth_classes: [{ desde_m: 0.03, hasta_m: 0.1, area_km2: 1.2, pct_mojado: 100 }], cell_size_m: 30 }
  const result = { ...flood, rasterUrl: '/image.png', resultRoiKey: JSON.stringify(roi), stats, charts }
  setLanguage('es')
  assert.match(render(FloodCharts, { flood: result }), /Escenario simulado, no observación/)
  setLanguage('en')
  const panel = render(RainDg2Panel, { flood: result, croppedRegion: roi, onFloodChange() {} })
  assert.match(panel, /Synthetic profile seed/)
  assert.match(panel, /unvalidated accuracy/)
  assert.doesNotMatch(panel, /Peak estimated discharge|Minor shallow ponding|\/image.png|Flood hazard/)
  const figures = render(FloodCharts, { flood: result })
  assert.match(figures, /Simulated scenario, not an observation/)
  assert.match(figures, /runoff/)
  assert.match(figures, /water depth/)
  setLanguage('es')
})

test('curated backend messages and risk labels translate only known display text', () => {
  setLanguage('en')
  assert.match(localizeText('El perfil temporal de lluvia es sintético y no validado; la distribución espacial aún está pendiente.'), /synthetic and unvalidated/)
  assert.equal(localizeText('Encharcamientos laminares menores en llanura'), 'Minor shallow ponding on plains')
  assert.equal(localizeText('ROI <My custom region>'), 'ROI <My custom region>')
  assert.equal(localizeText('Leve'), 'Low')
  setLanguage('es')
  assert.equal(localizeText('Leve'), 'Leve')
})

test('DG2 panel does not reuse the terrapulseai_v2 simulator state or its unsupported equations', () => {
  // Pressure and infiltration now reach DG2 through the ROI API (atmospheric_pressure_hpa, infiltration), not old state fields.
  const source = readFileSync(new URL('../src/components/RainDg2Panel.tsx', import.meta.url), 'utf8')
  // Froude and Kirpich are shown from DG2 results (froude, time_of_concentration), never from the old simulator state.
  assert.doesNotMatch(source, /FloodCharts|pressureHpa|Q_bank|baroSurge|flood\.stats\.(froude|tc)/)
  assert.match(translate('Infiltración no modelada','Infiltration not modeled'), /Infiltración|Infiltration/)
})

test('method selector offers DG2 (default) and FV1 in the selected language only', () => {
  setLanguage('es')
  const es = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  assert.match(es, /Método<\/span><select/)
  assert.match(es, /<option value="dg2" selected="">DG2 \(más preciso\)<\/option>/)
  assert.match(es, /<option value="fv1">FV1 \(estable, para terreno empinado\)<\/option>/)
  assert.match(es, /Iniciar corrida DG2/)
  setLanguage('en')
  const en = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  assert.match(en, /Method<\/span><select/)
  assert.match(en, /DG2 \(more accurate\)/)
  assert.match(en, /FV1 \(stable, for steep terrain\)/)
  assert.doesNotMatch(en, /más preciso|terreno empinado|cambio automático/)
  setLanguage('es')
})

test('result cards show the solver and an automatic switch in the selected language', async () => {
  const { FloodResultSummary } = await import('../src/components/flood/FloodResultSummary.tsx')
  const result = { grid: { cellsize_m: 30 }, frames: [], maximum: { stats: { max_m: 1 } }, artifacts: [],
    solver: 'fv1', requested_solver: 'dg2', solver_fallback: { from: 'dg2', to: 'fv1', reason: 'negative_depth_artifacts' } }
  setLanguage('es')
  const es = render(FloodResultSummary, { result, frameIndex: null })
  assert.match(es, /Método de cálculo/); assert.match(es, />FV1</); assert.match(es, /cambio automático desde DG2/)
  setLanguage('en')
  const en = render(FloodResultSummary, { result, frameIndex: null })
  assert.match(en, /Computation method/); assert.match(en, /automatic switch from DG2/)
  assert.doesNotMatch(en, /Método|cambio automático/)
  assert.match(render(FloodResultSummary, { result: { ...result, solver: undefined, solver_fallback: undefined }, frameIndex: null }), />DG2<.*the one chosen/)
  assert.equal(localizeText('artefactos numéricos en terreno muy empinado; profundidades poco confiables, la dirección del flujo sí vale'),
    'numerical artifacts on very steep terrain; depths unreliable, the flow direction is still valid')
  setLanguage('es')
})

test('DG2 resampling options match the ROI API contract', () => {
  const html = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  assert.match(html, /<option[^>]*>nearest<\/option>/)
  assert.match(html, /<option[^>]*>bilinear<\/option>/)
  assert.doesNotMatch(html, /<option[^>]*>cubic<\/option>/)
})

test('relative time uses selected display locale without changing input signatures or invalid-date semantics', () => {
  const now = Date.parse('2026-11-14T12:00:00Z')
  setLanguage('es')
  assert.equal(formatRelative('not-date', now), 'fecha desconocida')
  assert.equal(formatRelative('2026-11-14T12:00:00Z', now), 'hace un momento')
  setLanguage('en')
  assert.equal(formatRelative('not-date', now), 'unknown date')
  assert.equal(formatRelative('2026-11-14T12:00:00Z', now), 'just now')
  assert.match(formatRelative('2026-11-04T12:00:00Z', now), /Nov/)
  setLanguage('es')
})
