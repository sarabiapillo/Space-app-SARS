import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/components/MapCanvas.tsx', import.meta.url), 'utf8')

test('la capa y leyenda SAR usan el mismo predicado de visibilidad', () => {
  const predicate = source.match(/const shouldShowNisar = ([^\n]+)/)?.[1]
  assert.ok(predicate, 'debe existir un predicado único de visibilidad SAR')
  assert.match(source, /const hideNisar = hideHeatmap \|\| isActiveSolarMap/)
  assert.match(source, /setLayoutProperty\(NISAR_LAYER, 'visibility', shouldShowNisar \? 'visible' : 'none'\)/)
  assert.match(source, /\{!isActiveSolarMap && shouldShowNisar && \(/)
  for (const condition of ['hideNisar', "dateViewMode !== 'swipe'", 'Boolean(activeLayerEntry)', 'imagesReady', 'opacity > 0']) {
    assert.ok(predicate.includes(condition), `el predicado debe incluir ${condition}`)
  }
})

test('no presenta la intensidad solar porcentual como leyenda', () => {
  assert.doesNotMatch(source, /comsol-colorbar__column--solar/)
  assert.doesNotMatch(source, /comsol-colorbar__tick-val">(?:80|60|40|20)%/)
  assert.ok(source.includes('activeLayerEntry.unidades'), 'la escala restante debe describir valores SAR')
})

test('la paleta se identifica como exclusiva de capas SAR', () => {
  assert.match(source, /Paleta SAR \(solo SAR\)/)
})

test('la presentación solar activa suprime contexto SAR sin cambiar estados de escena', () => {
  assert.match(source, /const isActiveSolarMap = solar\.enabled && activeDockWindow\?\.kind === 'solar'/)
  assert.match(source, /!isActiveSolarMap && hasAnalysisRoi && \(roiLayers\.loading \|\| roiLayers\.error \|\| !imagesReady\)/)
  assert.match(source, /!isActiveSolarMap && <div className="ws-panel-tabbar__summary">/)
  assert.match(source, /!isActiveSolarMap && shouldShowNisar/)
  assert.match(source, /!isActiveSolarMap && <section[\s\S]*?workstation-log-panel/)
  assert.match(source, /solar\.enabled && !hideSolar && selectedContourValue/)
  assert.match(source, /'line-width': 1, 'line-opacity': Math\.min\(0\.48, solarOpacity \/ 200\)/)
  assert.match(source, /dateViewMode === 't1' \? manifestT1 : manifestT2/)
})
