import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const map = readFileSync(new URL('../src/components/MapCanvas.tsx', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')

test('swipe imagery and slider are absent outside the map tab', () => {
  assert.match(map, /dateViewMode === 'swipe' && !hideNisar && imagesReady && layerT1/)
  assert.match(map, /dateViewMode === 'swipe' && !hideNisar && imagesReady && roiLayers\.comparable/)
  assert.match(map, /if \(isEditing && activeTool !== 'mover'\) return/)
})

test('solar copy hides SAR while its GeoTIFF layer and contours stay gated to the active solar map', () => {
  assert.match(map, /const hideNisar = hideHeatmap \|\| isActiveSolarMap/)
  assert.match(map, /solar\.enabled && !hideSolar && solar\.showContours !== false && Boolean\(solar\.contours\)/)
  assert.doesNotMatch(map, /solar-thermal-overlay|createRadialGradient/)
})

test('water raster/comparator and seismic rings are scoped to their own active dock', () => {
  assert.match(map, /activeDockWindow\?\.kind === 'agua'[\s\S]{0,300}hasCurrentFloodResult/)
  assert.match(map, /isSeismic && Boolean\(seismic\?\.enabled\)/)
  assert.match(map, /activeDockWindow\?\.kind === 'agua' && hasCurrentFloodResult && activeFlood\.compareMode/)
})

test('solar raster is visible only with its controls and nonzero opacity', () => {
  assert.match(map, /const shouldShow =\s*solar\.enabled &&\s*!hideSolar &&\s*solarOpacity > 0/)
  assert.match(map, /solar\.enabled && !hideSolar &&/)
  assert.match(panel, /solar\.showRasterOnMap !== false && solarOpacity > 0/)
  assert.match(panel, /solarOpacity === 0 && solar\.showRasterOnMap !== false/)
})

test('isolines can be selected and report their own irradiance value', () => {
  assert.match(map, /map\.on\('click', layerId/)
  assert.match(map, /value_w_m2/)
  assert.match(map, /solar-contour-selection/)
})
