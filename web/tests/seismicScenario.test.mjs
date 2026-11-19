import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { regionCenter, newSeismicScenario, seismicForMap } from '../src/utils/seismicScenario.ts'

test('seleccionar preset sísmico aplica ajustes a la copia elegida sin modificar la anterior', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const select = app.slice(app.indexOf('const handleSelectPresetROI'), app.indexOf('const handleSolarChange'))
  const open = app.slice(app.indexOf('const handleOpenSimulation'), app.indexOf('const handleCropRegionChange'))
  assert.match(select, /const presetSeismic = options\?\.simulation === 'seismic'/)
  assert.match(select, /seismic: presetSeismic/)
  assert.match(select, /seismic: presetSeismic \?\?/)
  assert.match(select, /vs30: SOIL_VS30\[settings\.soilType\]/, 'Vs30 corresponde al suelo recomendado')
  assert.doesNotMatch(open, /handleSeismicChange\(/, 'el segundo callback no debe escribir en la copia anterior')
  const panel = readFileSync(new URL('../src/components/SeismicSimulatorPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /onSelectPresetROI\(preset, \{ simulation: 'seismic' \}\)/)
  assert.match(panel, /if \(onSelectPresetROI\) \{[\s\S]*?\} else \{[\s\S]*?onSeismicChange/)
  assert.match(panel, /vs30: SOIL_VS30\[geo\.soilType\]/)
})

const square = (lng, lat, d) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d]]

test('centro de la región: ROI efectiva, luego recorte manual, luego centro del mapa', () => {
  const roi = { type: 'Polygon', coordinates: [[...square(-93.4, 16.6, 0.4), [-93.4, 16.6]]] }
  assert.deepEqual(regionCenter(roi, null, [0, 0]), [-93.2, 16.8])
  assert.deepEqual(regionCenter(null, square(-99, 19, 0.2), [0, 0]), [-98.9, 19.1])
  assert.deepEqual(regionCenter(null, null, [-92.5, 16.7]), [-92.5, 16.7])
  const multi = { type: 'MultiPolygon', coordinates: [[[...square(-100, 20, 1), [-100, 20]]]] }
  assert.deepEqual(regionCenter(multi, null, [0, 0]), [-99.5, 20.5])
})

test('escenario nuevo: en el centro de la región, sin simular y no histórico', () => {
  const s = newSeismicScenario([-93.2, 16.8], 'Chiapas norte')
  assert.deepEqual(s.epicenter, [-93.2, 16.8])
  assert.equal(s.name, 'Sismo nuevo — Chiapas norte')
  assert.equal(s.simulated, false)
  assert.equal(s.enabled, false)
  assert.equal(s.autoPlaced, true)
  assert.ok(s.magnitude >= 4 && s.magnitude <= 8.8)
})

test('cada mapa usa su propio sismo; si no tiene, uno nuevo en su región (no el de otro mapa)', () => {
  const own = { ...newSeismicScenario([-99, 19], 'X'), autoPlaced: false, magnitude: 6.5 }
  const map = { nombre: 'Mapa A', centro: [-92, 16], croppedRegion: square(-93.4, 16.6, 0.4), effectiveRoi: null }
  assert.equal(seismicForMap({ ...map, seismic: own }), own)
  const derived = seismicForMap({ ...map, seismic: undefined })
  assert.deepEqual(derived.epicenter, [-93.2, 16.8])
  assert.equal(derived.name, 'Sismo nuevo — Mapa A')
})

test('un escenario automático sin tocar sigue a la región cuando ésta cambia', () => {
  const auto = newSeismicScenario([-99, 19], 'Mapa A')
  const map = { nombre: 'Mapa A', centro: [-92, 16], croppedRegion: square(-93.4, 16.6, 0.4), effectiveRoi: null }
  assert.deepEqual(seismicForMap({ ...map, seismic: auto }).epicenter, [-93.2, 16.8])
  // Si el usuario ya simuló, no se mueve
  const ran = { ...auto, simulated: true }
  assert.deepEqual(seismicForMap({ ...map, seismic: ran }).epicenter, [-99, 19])
})

test('al editar el escenario deja de ser automático; elegir en el mapa o cerrar no cuenta como edición', async () => {
  const { markEdited } = await import('../src/utils/seismicScenario.ts')
  const auto = newSeismicScenario([-99, 19], 'Mapa A')
  assert.equal(markEdited(auto, { ...auto, magnitude: 6.1 }).autoPlaced, false)
  assert.equal(markEdited(auto, { ...auto, epicenter: [-98, 18] }).autoPlaced, false)
  assert.equal(markEdited(auto, { ...auto, simulated: true }).autoPlaced, false)
  assert.equal(markEdited(auto, { ...auto, pickingEpicenter: true }).autoPlaced, true)
  assert.equal(markEdited(auto, { ...auto, enabled: false }).autoPlaced, true)
})

test('sin ROI no se usa el centro del mapa ([0,0] en el mapa general, cambia al desplazarse): punto fijo en México', async () => {
  const { DEFAULT_EPICENTER_MX } = await import('../src/utils/seismicScenario.ts')
  const general = { nombre: 'Mapa General', centro: [0, 0], croppedRegion: null, effectiveRoi: null }
  const s = seismicForMap(general)
  assert.deepEqual(s.epicenter, DEFAULT_EPICENTER_MX)
  assert.ok(s.epicenter[0] < -86 && s.epicenter[0] > -118 && s.epicenter[1] > 14 && s.epicenter[1] < 33)   // dentro de México
})

test('un escenario automático sin ROI no salta cuando se desplaza el mapa', () => {
  const auto = newSeismicScenario([-93.1, 16.75], 'Copia')
  const panned = { nombre: 'Copia', centro: [-80, 10], croppedRegion: null, effectiveRoi: null, seismic: auto }
  assert.deepEqual(seismicForMap(panned).epicenter, [-93.1, 16.75])
})
