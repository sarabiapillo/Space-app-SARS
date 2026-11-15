import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LUT_INFERNO_256 } from '../src/utils/colormapTables.ts'
import { colorize, decodeInfernoPixels, infernoIndex, legendTicks, scaleFor } from '../src/utils/solarHeatmap.ts'

const rgb = (i) => [LUT_INFERNO_256[i * 3], LUT_INFERNO_256[i * 3 + 1], LUT_INFERNO_256[i * 3 + 2]]

test('cada color Inferno vuelve a su índice', () => {
  for (let i = 0; i < 256; i++) assert.equal(infernoIndex(...rgb(i)), i)
})

test('recupera W/m² del PNG con el centro del escalón y deja la transparencia fuera', () => {
  const upper = 512
  const px = new Uint8ClampedArray([...rgb(0), 255, ...rgb(128), 255, ...rgb(255), 255, 0, 0, 0, 0])
  const d = decodeInfernoPixels(px, 2, 2, upper)
  assert.deepEqual(Array.from(d.values.slice(0, 3)), [1, 257, 511])     // (i + 0.5)/256 · 512
  assert.ok(Number.isNaN(d.values[3]))
  assert.equal(d.stats.validPixels, 3)
  assert.equal(d.stats.min, 1)
  assert.equal(d.stats.max, 511)
  assert.equal(d.stats.halfStep, 1)
})

test('la escala estirada usa p2–p98; la absoluta 0–DNI', () => {
  const stats = { p2: 400, p98: 450, min: 390, max: 470, p50: 425, mean: 425, validPixels: 10, halfStep: 1 }
  assert.deepEqual(scaleFor('estirado', stats, 500), [400, 450])
  assert.deepEqual(scaleFor('absoluto', stats, 500), [0, 500])
  assert.deepEqual(scaleFor('estirado', { ...stats, p98: 400 }, 500), [0, 500])  // sin rango: absoluta
})

test('colorize satura los extremos y respeta NaN', () => {
  const out = colorize(new Float32Array([300, 425, 600, NaN]), 400, 450)
  assert.deepEqual(Array.from(out.slice(0, 3)), rgb(0))
  assert.deepEqual(Array.from(out.slice(8, 11)), rgb(255))
  assert.equal(out[15], 0)
})

test('marcas de leyenda redondas dentro del rango', () => {
  assert.deepEqual(legendTicks(398, 450), [400, 410, 420, 430, 440, 450])
  assert.deepEqual(legendTicks(0, 500), [0, 100, 200, 300, 400, 500])
  assert.deepEqual(legendTicks(236, 479), [250, 300, 350, 400, 450])
})
