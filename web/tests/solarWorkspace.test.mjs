import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const panel = await readFile(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')

test('solar panel illustrates configured azimuth/elevation without time and can collapse its analysis dialog accessibly', async () => {
  assert.match(panel, /solar-position-diagram/)
  assert.match(panel, /ilustrativo, no trayectoria temporal\/efemérides/)
  const asideHeader = panel.slice(panel.indexOf('className="solar-card__header"'), panel.indexOf('<div className="solar-zone-group">'))
  assert.match(asideHeader, /type="button"[\s\S]*aria-expanded=\{!panelCollapsed\}/)
  assert.match(asideHeader, /aria-label=\{panelCollapsed \? t\('Expandir panel solar'/)
  assert.match(asideHeader, /setPanelCollapsed\(value => !value\)/)
  const workspaceCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(workspaceCss, /solar-card__collapse:focus-visible/)
  assert.match(workspaceCss, /solar-card__body\[hidden\]/)
  assert.match(panel, /className="solar-card__body" hidden=\{panelCollapsed\}/)
  const advanced = panel.slice(panel.indexOf('<details className="solar-advanced">'), panel.indexOf('</details>'))
  assert.doesNotMatch(advanced, /solar-position-diagram/)
  assert.match(panel, /solar-position-diagram[\s\S]*?ilustrativo, no trayectoria temporal\/efemérides[\s\S]*?<details className="solar-advanced">/)
  assert.match(panel, /aria-expanded=\{!analysisCollapsed\}/)
  assert.match(panel, /setAnalysisCollapsed\(value => !value\)/)
  const diagram = panel.slice(panel.indexOf('<figure className="solar-position-diagram"'), panel.indexOf('<details className="solar-advanced">'))
  assert.equal((diagram.match(/<svg\b/g) ?? []).length, 1, 'un solo diagrama para ambos ángulos')
  assert.match(diagram, /solar-position-diagram__dome/)
  assert.match(diagram, /solar-position-diagram__terrain/)
  assert.match(diagram, /Este \(90°\)[\s\S]*Sur \(180°\)[\s\S]*Oeste \(270°\)/)
  assert.match(diagram, /Azimut[\s\S]*\{azimuth\}°[\s\S]*Elevación[\s\S]*\{elevation\}°/)
  assert.doesNotMatch(diagram, /<circle[^>]*compass|__profile|__axis|\d{1,2}:\d{2}|[Ff]echa|[Hh]ora|[Cc]enit/)
  for (const [name, fill] of [['elevation', 'elevation'], ['azimuth', 'azimuth'], ['radId', 'solar.radiationIntensity']]) {
    assert.match(panel, new RegExp(`id=\\{${name === 'elevation' ? 'elevationId' : name === 'azimuth' ? 'azimuthId' : name}\\}[\\s\\S]*?className="solar-control__range"[\\s\\S]*?--solar-fill.*${fill}`), `slider ${name} comparte diseño y relleno`)
  }
  const styles = await readFile(new URL('../src/components/SolarAnalysis.css', import.meta.url), 'utf8')
  assert.match(styles, /\.solar-control__range::-webkit-slider-thumb/)
  assert.match(styles, /\.solar-control__range::-moz-range-thumb/)
  assert.match(styles, /\.solar-control__range:focus-visible/)
  assert.doesNotMatch(panel, /Anillo de recorte activo|Geometría enviada a la API|Gráficas NISAR de la ROI/)
})

test('solar rehydration security rejects external and cross-run URLs and mismatched ROI', async () => {
  const savedMaps = await readFile(new URL('../src/hooks/useSavedMaps.ts', import.meta.url), 'utf8')
  const source = savedMaps.slice(savedMaps.indexOf('function safeLocalApiUrl'), savedMaps.indexOf('/** Normaliza cada copia'))
  const js = ts.transpile(source, { module: ts.ModuleKind.None })
  const { safeLocalApiUrl, solarSimulationMatchesCopy } = new Function(`${js}; return { safeLocalApiUrl, solarSimulationMatchesCopy }`)()
  const id = 'b7b3ac4127714e728c21abc5bb3a7931'
  assert.equal(safeLocalApiUrl(`/api/solar/simulations/${id}/export/incident`, id), `/api/solar/simulations/${id}/export/incident`)
  assert.equal(safeLocalApiUrl('https://attacker.example/file', id), null)
  assert.equal(safeLocalApiUrl('javascript:alert(1)', id), null)
  assert.equal(safeLocalApiUrl(`/api/solar/simulations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/export/incident`, id), null)
  assert.equal(safeLocalApiUrl(`/api/solar/simulations/b7b3ac41-2771-4e72-8c21-abc5bb3a7931/export/incident`, id), null)
  assert.equal(solarSimulationMatchesCopy({ id, request: { roi: { type: 'Polygon', coordinates: [[[0, 0]]] } } }, { type: 'Polygon', coordinates: [[[0, 0]]] }), true)
  assert.equal(solarSimulationMatchesCopy({ id, request: { roi: { type: 'Polygon', coordinates: [[[1, 1]]] } } }, { type: 'Polygon', coordinates: [[[0, 0]]] }), false)
})

test('rehydration normalizes and retains each simulator result and map overlay state', async () => {
  const savedMaps = await readFile(new URL('../src/hooks/useSavedMaps.ts', import.meta.url), 'utf8')
  assert.match(savedMaps, /simulationResult:.*simulationResult/)
  assert.match(savedMaps, /analysisResult: validAnalysis/)
  assert.match(savedMaps, /contours:.*contours/)
  assert.match(savedMaps, /const rasterPreviewUrl = safeLocalApiUrl/)
  assert.match(savedMaps, /solarSimulationMatchesCopy/)
  assert.match(savedMaps, /simulations\/\$\{runId\}/)
  assert.match(savedMaps, /\.roi\) === JSON\.stringify\(roi\)/)
  const roiStart = savedMaps.indexOf('  const solarRoi = effectiveRoi ??')
  const roiExpression = savedMaps.slice(roiStart, savedMaps.indexOf('\n\n  return {', roiStart))
  const restoredRoi = new Function('effectiveRoi', 'croppedRegion', `${ts.transpile(roiExpression, { module: ts.ModuleKind.None })}; return solarRoi`)
  const openRing = [[0, 0], [1, 0], [0, 1]]
  const closedRing = [...openRing, openRing[0]]
  assert.deepEqual(restoredRoi(null, openRing), { type: 'Polygon', coordinates: [closedRing] })
  assert.deepEqual(restoredRoi(null, closedRing), { type: 'Polygon', coordinates: [closedRing] })
  assert.match(savedMaps, /flood: normalizeFlood\(m\.flood\)/)
  assert.match(savedMaps, /seismic: normalizeSeismic\(m\.seismic\)/)
  assert.match(savedMaps, /catch \{\s*\/\/ Sin persistencia: sigue funcionando en memoria/)
})

test('CSV statistics and histogram use one five-column schema', () => {
  const csv = panel.match(/statistic,value_w_m2,bin_start_w_m2,bin_end_w_m2,cells[\s\S]*?download="solar-statistics.csv"/)
  assert.ok(csv)
  assert.match(csv[0], /minimum,\$\{analysis\.statistics\.min \?\? ''\},,,/)
  assert.match(csv[0], /`,,\$\{analysis\.histogram\.bin_edges\[i\]\},\$\{analysis\.histogram\.bin_edges\[i \+ 1\]\},\$\{count\}`/)
})

test('solar simulation uses confirmed ROI and no temporal inputs', () => {
  assert.match(panel, /solarRoiGeometry\(effectiveRoi, croppedRegion/)
  assert.doesNotMatch(panel, /resolveSolarTimezone|datetime_local|timezoneInput|type="date"/)
  assert.match(panel, /elevation_deg: elevation/)
  assert.match(panel, /azimuth_deg: azimuth/)
  assert.match(panel, /const elevation = solar\.elevationDeg \?\? 45/)
  assert.match(panel, /const azimuth = solar\.azimuthDeg \?\? 180/)
})

test('full analysis escapes clipped map canvas through a body portal', () => {
  assert.match(panel, /createPortal\(/)
  assert.match(panel, /document\.body/)
})

test('analysis is an accessible dialog with six mutually exclusive section guards', () => {
  assert.match(panel, /role="dialog"[\s\S]*aria-modal="true"/)
  for (const section of [0, 1, 2, 3, 4, 5]) assert.match(panel, new RegExp(`analysisSection === ${section}`))
  assert.match(panel, /Ver análisis completo/)
  assert.match(panel, /Escape/)
  assert.match(panel, /event\.key !== 'Tab'/)
  assert.match(panel, /document\.activeElement === analysisDialog\.current/)
  assert.match(panel, /analysisTrigger\.current \?\? solarCard\.current/)
  assert.doesNotMatch(panel, /onMouseDown=.*setAnalysisOpen\(false\)/)
})

test('compact view excludes non-solar content from solar analysis', () => {
  assert.doesNotMatch(panel, /!analysisOpen && roiLayers/)
  assert.match(panel, /No hay series temporales solares adicionales/)
  assert.doesNotMatch(panel, /Gráficas NISAR de la ROI|SAR|\bdB\b|\bt2\b/)
  assert.match(panel, /analysisSection === 1[\s\S]*solar-analysis__bars/)
  assert.match(panel, /analysisSection === 5[\s\S]*Exportaciones existentes/)
})

test('preset ROI options are grouped dynamically by catalog state and have neutral label', () => {
  assert.match(panel, /new Set\(PRESET_ROI_CATALOG\.map\(preset => preset\.state\)\)/)
  assert.doesNotMatch(panel, /optgroup label="🇲🇽 Estado de/)
  assert.match(panel, /ROI precargada opcional/)
})

test('solar intensity is a dimensionless advanced factor and position comes from model result', async () => {
  assert.match(panel, /Factor de intensidad adimensional/)
  assert.match(panel, /toFixed\(2\).*×/)
  assert.match(panel, /Ajustes avanzados/)
  assert.match(panel, /min="0" max="90"/)
  assert.match(panel, /min="0" max="360"/)
  assert.match(panel, /Azimut configurado \(norte, horario\)/)
  assert.match(panel, /Elevación configurada/)
  assert.match(panel, /elevation_deg/)
  assert.match(panel, /simulationResult\?\.id/)
  assert.match(panel, /analysisResult: latestAnalysis,[\s\S]*contours: latestContours/)
  assert.match(panel, /Escenario idealizado de irradiancia modelada/)
  assert.doesNotMatch(panel, /NREL SPA/)
  assert.match(panel, /runInfo\.intensity.*%/s)
  assert.doesNotMatch(panel, /\\\\\\\\n/)
  assert.match(panel, /requestVersion\.current === version/)
  const workspaceTypes = await readFile(new URL('../src/types/workspace.ts', import.meta.url), 'utf8')
  assert.match(workspaceTypes, /analysisResult\?: SolarAnalysisResponse \| null/)
  assert.match(workspaceTypes, /layerOpacity\?: number/)
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /handleSelectMap[\s\S]*activeDockWindowId/)
  assert.match(app, /simulationResult: null, analysisResult: null, contours: null/)
  assert.match(app, /handleDuplicateWithHeatmap[\s\S]*solar: \{ \.\.\.current\.solar, enabled: false \}/)
})
