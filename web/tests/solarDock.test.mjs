import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const load = path => readFile(new URL(path, import.meta.url), 'utf8')

test('solar opens a distinct, reusable dock tab instead of a browser tab or toggling map', async () => {
  const [app, header, types, dock] = await Promise.all([
    load('../src/App.tsx'), load('../src/components/Header.tsx'),
    load('../src/types/workspace.ts'), load('../src/mocks/initialWorkspaces.ts'),
  ])
  assert.match(types, /DockWindowKind = [^\n]*'solar'/)
  assert.match(dock, /CenterDockTab = [^\n]*'solar'/)
  assert.match(app, /activeDockWindow\?\.kind === 'solar'\s*\? 'solar'/)
  assert.match(app, /tab === 'solar' \? 'solar'/)
  assert.match(app, /selected\?\.solar\.enabled\s*\? 'solar'/)
  assert.match(header, /onDockTabChange\('solar'\)/)
  const solarButton = header.slice(header.indexOf('ws-ribbon__btn--solar'), header.indexOf('ws-ribbon__btn--rain'))
  assert.doesNotMatch(solarButton, /disabled=\{!hasConfirmedROI\}/, 'la pestaña permite elegir ROI desde su panel')
  assert.match(solarButton, /t\('Simulador de radiación solar', 'Solar irradiance simulator'\)/)
  assert.doesNotMatch(solarButton, /Solar ON|solar\.radiationIntensity|\? `Solar/, 'el rótulo no cambia con el estado ni el porcentaje')
  assert.doesNotMatch(header, /window\.open\(/)
  assert.match(app, /const existing = dockWindows\.find\(\(w\) => w\.kind === kind\)/)
})

test('ROI selection in solar pane keeps the solar tab and resets old results without stale overwrite', async () => {
  const [panel, app, map] = await Promise.all([load('../src/components/RightPanel.tsx'), load('../src/App.tsx'), load('../src/components/MapCanvas.tsx')])
  assert.match(panel, /onSelectPresetROI\?\.\(preset, \{ simulation: 'solar' \}\)/)
  const presetBranch = app.slice(app.indexOf("if (options?.simulation === 'flood')"), app.indexOf('}, [activeCopy, current, updateMap'))
  assert.match(presetBranch, /options\?\.simulation === 'solar'[\s\S]*handleDockTabChange\('solar'\)/)
  const solarBranch = app.slice(app.indexOf("} else if (mode === 'solar')"), app.indexOf("} else if (mode === 'seismic')"))
  assert.match(solarBranch, /if \(!preset\) handleSolarChange/)
  assert.match(map, /activeDockWindow\?\.kind === 'agua' &&\s*hasCurrentFloodResult/)
  assert.match(app, /if \(activeCopy && isEditing\) \{\s*updateMap\(activeCopy\.id/, 'desde vista general se crea una copia editable en vez de mutar una inactiva')
  assert.match(map, /setLayoutProperty\(FOOTPRINT_LINE_LAYER, 'visibility', hideNisar \? 'none' : 'visible'\)/)
  assert.match(map, /setLayoutProperty\(`\$\{GCOV_PREVIEW_SOURCE\}-line`, 'visibility', hideNisar \? 'none' : 'visible'\)/)
})

test('the entire solar tab uses the light-orange heat-copy palette including close', async () => {
  const css = await load('../src/index.css')
  assert.match(css, /\.ws-ribbon__btn--heat\s*\{[^}]*color:\s*#c2410c;[^}]*background:\s*#fff7ed;/)
  assert.match(css, /\.ws-panel-tab-group--solar\s*\{[^}]*background:\s*#fff7ed;/)
  assert.match(css, /\.ws-panel-tab-group--solar\.is-active\s*\{[^}]*background:\s*#ffedd5;/)
  assert.match(css, /\.ws-panel-tab-group--solar \.ws-panel-tab--solar\s*\{[^}]*background:\s*transparent;[^}]*color:\s*#c2410c;/)
  assert.match(css, /\.ws-panel-tab-group--solar \.ws-panel-tab__close\s*\{[^}]*color:\s*#c2410c;/)
  assert.match(css, /\.ws-panel-tab-group--solar \.ws-panel-tab__close:focus-visible/)
})

test('solar pane has its own label and contains map overlays and controls only in that pane', async () => {
  const map = await load('../src/components/MapCanvas.tsx')
  assert.match(map, /activeDockWindow\?\.kind === 'solar'/)
  assert.match(map, /Solar \/ Radiación \{index\}/)
  assert.match(map, /const hideSolar = activeDockWindow\?\.kind !== 'solar'/)
  assert.match(map, /solar\.enabled && !hideSolar && \(/)
  assert.match(map, /const hideHeatmap = activeDockWindow\?\.kind !== 'map'/)
  assert.match(map, /const hideNisar = hideHeatmap \|\| isActiveSolarMap/)
  assert.match(map, /const visible = solar\.enabled && !hideSolar && solar\.showContours/)
  assert.match(map, /activeDockWindow\?\.kind === 'agua'/)
  assert.match(map, /activeDockWindow\?\.kind === 'sismo'/)
  assert.match(map, /onClose=\{\(\) => \{[\s\S]*?onSolarChange\(\{ \.\.\.solar, enabled: false \}\)[\s\S]*?onActivateDockWindow\(mapTab\.id\)[\s\S]*?onOpenDockWindow\('map'\)/)
})
