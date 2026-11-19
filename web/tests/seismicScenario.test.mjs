import { test } from 'node:test'
import assert from 'node:assert/strict'
import { regionCenter, newSeismicScenario, seismicForMap } from '../src/utils/seismicScenario.ts'

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
