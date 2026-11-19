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
const solar = { sunAngle: 90, elevationDeg: 45, azimuthDeg: 180, radiationIntensity: 65, heatmapMode: 'estirado' }

test('simulation panels switch display language but retain numeric input and scientific units', () => {
  setLanguage('es')
  const esRain = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  const esSolar = render(RightPanel, { solar, onSolarChange() {}, onClose() {}, croppedRegion: roi })
  assert.match(esRain, /Lámina Acumulada/)
  assert.match(esSolar, /Irradiancia incidente/)
  setLanguage('en')
  const enRain = render(RainDg2Panel, { flood, onFloodChange() {}, croppedRegion: roi })
  const enSolar = render(RightPanel, { solar, onSolarChange() {}, onClose() {}, croppedRegion: roi })
  assert.match(enRain, /Accumulated rainfall/)
  assert.match(enRain, /runoff/)
  assert.match(enRain, /35 mm/)
  assert.match(enSolar, /Incident irradiance/)
  assert.match(enSolar, /type="range" min="0" max="90" step="1"[^>]*value="45"/)
  assert.match(enSolar, /type="range" min="0" max="360" step="1"[^>]*value="180"/)
  assert.match(enSolar, /value="65"/)
  assert.doesNotMatch(enRain, /Lámina Acumulada|escorrentía/)
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
  assert.match(panel, /Water depth/)
  assert.match(panel, /Peak estimated discharge/)
  assert.match(panel, /Minor shallow ponding on plains/)
  assert.match(panel, /\/image.png/)
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

test('collapsed equation copy has contextual English without changing its mathematical expression', () => {
  // No browser is available to open the disclosure; check its explicit translation pair.
  const source = readFileSync(new URL('../src/components/RainDg2Panel.tsx', import.meta.url), 'utf8')
  const pair = source.match(/<code>\{t\('([^']*\[C →[^']*)', '([^']*)'\)\}<\/code>/)
  assert.ok(pair)
  setLanguage('en')
  assert.match(translate(pair[1], pair[2]), /C → 0.89 at 72h/)
  setLanguage('es')
  assert.match(translate(pair[1], pair[2]), /C → 0.89 a 72h/)
  assert.equal(pair[1].replace(' a 72h', ' at 72h'), pair[2])
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
