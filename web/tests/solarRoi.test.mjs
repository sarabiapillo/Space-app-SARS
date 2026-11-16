import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { confirmedSolarRoi } from '../src/utils/solarRoi.ts'

test('el simulador recibe exactamente el polígono delimitado, no un cuadrado de radio fijo', () => {
  const region = [[-93.1, 16.7], [-93, 16.7], [-93.02, 16.8]]
  const roi = confirmedSolarRoi(region)
  assert.deepEqual(roi, { type: 'Polygon', coordinates: [[...region, region[0]]] })
  assert.deepEqual(region, [[-93.1, 16.7], [-93, 16.7], [-93.02, 16.8]])
})

test('la interfaz solar ya no ofrece zonas ni cuadrados preseleccionados', () => {
  const source = readFileSync(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /SOLAR_PRESET_ZONES|selectedZoneId|squareAround|RADIUS_OPTIONS_KM|2026-06-21/)
  assert.match(source, /type="date"/)
  assert.match(source, /const roiPolygon = confirmedSolarRoi\(croppedRegion \?\? null\)/)
  assert.match(source, /roi: roiPolygon/)
  assert.match(source, /disabled=\{isSimulating \|\| !croppedRegion/)
  assert.match(source, /if \(!isCurrent\(\)\) return/)
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /solar: \{ \.\.\.activeCopy\.solar, enabled: false, rasterPreviewUrl: null, rasterBounds: null \}/)
  assert.match(app, /setGcovFootprint\(null\)/)
})

test('rechaza ejecución solar sin ROI y polígonos degenerados', () => {
  assert.throws(() => confirmedSolarRoi(null), /ROI/)
  assert.throws(() => confirmedSolarRoi([[0, 0], [0, 1], [0, 2]]), /ROI/)
})
