import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { confirmedSolarRoi, solarRoiGeometry } from '../src/utils/solarRoi.ts'

test('el simulador recibe exactamente el polígono delimitado, no un cuadrado de radio fijo', () => {
  const region = [[-93.1, 16.7], [-93, 16.7], [-93.02, 16.8]]
  const roi = confirmedSolarRoi(region)
  assert.deepEqual(roi, { type: 'Polygon', coordinates: [[...region, region[0]]] })
  assert.deepEqual(region, [[-93.1, 16.7], [-93, 16.7], [-93.02, 16.8]])
})

test('la interfaz solar ya no ofrece zonas ni cuadrados preseleccionados', () => {
  const source = readFileSync(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /SOLAR_PRESET_ZONES|selectedZoneId|squareAround|RADIUS_OPTIONS_KM|2026-06-21/)
  assert.doesNotMatch(source, /type="date"|datetime_local|resolveSolarTimezone/)
  assert.match(source, /elevation_deg: elevation/)
  assert.match(source, /azimuth_deg: azimuth/)
  assert.match(source, /const roiPolygon = solarRoiGeometry\(effectiveRoi, croppedRegion \?\? null\)/)
  assert.match(source, /roi: roiPolygon/)
  assert.match(source, /JSON.stringify\(\{ effectiveRoi: effectiveRoi \?\? null, croppedRegion: croppedRegion \?\? null \}\)/)
  const mapCanvas = readFileSync(new URL('../src/components/MapCanvas.tsx', import.meta.url), 'utf8')
  assert.match(mapCanvas, /<RightPanel[\s\S]*?effectiveRoi=\{effectiveRoi\}/)
  assert.match(source, /disabled=\{isSimulating \|\| !confirmedRoi/)
  assert.match(source, /if \(!isCurrent\(\)\) return/)
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /solar: \{ \.\.\.activeCopy\.solar, enabled: false, rasterPreviewUrl: null, rasterBounds: null,[\s\S]*?simulationResult: null, analysisResult: null, contours: null \}/)
  assert.match(app, /setGcovFootprint\(null\)/)
})

test('preserva exactamente MultiPolygon con huecos cuando hay geometría efectiva confirmada', () => {
  const effective = { type: 'MultiPolygon', coordinates: [
    [[[1, 2], [4, 2], [4, 5], [1, 2]], [[2, 3], [3, 3], [2, 3]]],
    [[[8, 9], [10, 9], [10, 11], [8, 9]]],
  ] }
  assert.equal(solarRoiGeometry(effective, [[-93, 16], [-92, 16], [-93, 17]]), effective)
  assert.deepEqual(solarRoiGeometry(null, [[-93, 16], [-92, 16], [-93, 17]]), confirmedSolarRoi([[-93, 16], [-92, 16], [-93, 17]]))
})

test('rechaza ejecución solar sin ROI y polígonos degenerados', () => {
  assert.throws(() => confirmedSolarRoi(null), /ROI/)
  assert.throws(() => confirmedSolarRoi([[0, 0], [0, 1], [0, 2]]), /ROI/)
})
