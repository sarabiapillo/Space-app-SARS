import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { LUT_INFERNO_256 } from '../src/utils/colormapTables.ts'
import { colorize, decodeInfernoPixels, infernoIndex, legendTicks, renderHeatmap, scaleFor } from '../src/utils/solarHeatmap.ts'

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

test('Acapulco: un rango estrecho del TIFF usa contraste local sin alterar la escala absoluta opcional', () => {
  const upper = 873.8584
  const pixels = new Uint8ClampedArray([...
    rgb(Math.floor(587.1 / upper * 256)), 255,
    ...rgb(Math.floor(617.9 / upper * 256)), 255,
    ...rgb(Math.floor(637.3 / upper * 256)), 255,
  ])
  const decoded = decodeInfernoPixels(pixels, 3, 1, upper)
  const [min, max] = scaleFor('estirado', decoded.stats, upper)
  assert.ok(min > 580 && max < 650 && max > min)
  assert.deepEqual(scaleFor('absoluto', decoded.stats, upper), [0, upper])
  assert.notDeepEqual(Array.from(colorize(decoded.values, min, max).slice(0, 3)), Array.from(pixels.slice(0, 3)))
})

test('Acapulco: el histograma de colores del PNG de producción conserva p2–p98 y la leyenda local', () => {
  // Conteos de los 55.954 píxeles opacos del preview.png recuperado; no se lee el artefacto en CI.
  const counts = [1, 12, 15, 264, 737, 601, 793, 3127, 1069, 958, 24762, 5438, 16252, 1051, 787, 87]
  const upper = 873.8583741788452
  const rgba = new Uint8ClampedArray(counts.reduce((n, count) => n + count, 0) * 4)
  let offset = 0
  counts.forEach((count, index) => {
    for (let n = 0; n < count; n++) rgba.set([...rgb(171 + index), 255], offset++ * 4)
  })
  const decoded = decodeInfernoPixels(rgba, offset, 1, upper)
  assert.equal(decoded.stats.validPixels, 55954)
  const range = scaleFor('estirado', decoded.stats, upper)
  assert.ok(Math.abs(range[0] - 602.4843868850242) < 0.001)
  assert.ok(Math.abs(range[1] - 629.7924610781131) < 0.001)
  assert.deepEqual(scaleFor('absoluto', decoded.stats, upper), [0, upper])
  const recolored = colorize(new Float32Array([decoded.stats.p2, decoded.stats.p98]), ...range)
  assert.deepEqual(Array.from(recolored.slice(0, 3)), rgb(0))
  assert.deepEqual(Array.from(recolored.slice(4, 7)), rgb(255))
  assert.deepEqual(legendTicks(...range), [605, 610, 615, 620, 625])
})

test('renderHeatmap conserva los píxeles Inferno exactos sin mezclar colores RGB', () => {
  const previous = globalThis.ImageData
  globalThis.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height } }
  try {
    const values = new Float32Array([600, 620, 640, NaN])
    const { image } = renderHeatmap({ width: 2, height: 2, values }, 600, 640)
    assert.deepEqual([image.width, image.height], [2, 2])
    assert.deepEqual(Array.from(image.data), Array.from(colorize(values, 600, 640)))
  } finally { globalThis.ImageData = previous }
})

test('el mapa conecta el contraste Inferno y la leyenda con el modo de la copia, sin cambiar el PNG original', async () => {
  const map = await readFile(new URL('../src/components/MapCanvas.tsx', import.meta.url), 'utf8')
  const panel = await readFile(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')
  for (const pattern of [/loadHeatmap\([\s\S]{0,150}rasterPreviewUrl/, /scaleFor\([\s\S]{0,150}heatmapMode/, /renderHeatmap\(/, /solarApplied/, /updateImage\(\{ image:/, /setSolarApplied\(/, /setSolarDisplayError\(null\)/, /source\.on\('error', onSourceError\)/, /kind: stretch \? 'contrast' : 'preview'/, /return \(\) => \{ active = false \}/]) {
    assert.ok(pattern.test(map), `MapCanvas no conecta ${pattern}`)
  }
  for (const pattern of [/heatmapMode[\s\S]{0,150}estirado/, /heatmapRange/, /legendTicks\(vmin, vmax\)/, /preview_url/]) {
    assert.ok(pattern.test(panel), `RightPanel no conecta ${pattern}`)
  }
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
