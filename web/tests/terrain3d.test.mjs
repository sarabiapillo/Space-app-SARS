import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bboxFromGeometry,
  bboxSizeMeters,
  chooseZoom,
  decodeTerrarium,
  despikeElevationGrid,
  hypsometricColor,
  latToTileY,
  lonToTileX,
  resampleElevationBilinear,
  sanitizeElevationGrid,
  sanitizeElevationSample,
} from '../src/utils/terrain3d.ts'
import { setLanguage, localizeText } from '../src/i18n/core.ts'

const CHIAPAS = 'POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))'

test('decodifica Terrarium a metros: (R·256 + G + B/256) − 32768', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0)
  assert.equal(decodeTerrarium(128, 100, 128), 100.5)
  assert.equal(decodeTerrarium(0, 0, 0), -32768)
})

test('bbox de Polygon, MultiPolygon y anillo de recorte', () => {
  const ring = [[-93.3919, 16.6539], [-92.8757, 16.6539], [-92.8757, 16.8964], [-93.3919, 16.8964]]
  assert.deepEqual(bboxFromGeometry({ type: 'Polygon', coordinates: [[...ring, ring[0]]] }), [-93.3919, 16.6539, -92.8757, 16.8964])
  assert.deepEqual(bboxFromGeometry({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]] }), [0, 0, 3, 3])
  assert.deepEqual(bboxFromGeometry(ring), [-93.3919, 16.6539, -92.8757, 16.8964])
  assert.equal(bboxFromGeometry(null), null)
  assert.equal(bboxFromGeometry({ type: 'Polygon', coordinates: [[[1, 1], [1, 1]]] }), null)
  assert.ok(CHIAPAS.includes('-93.3919'))
})

test('matemática de teselas Web Mercator', () => {
  assert.equal(lonToTileX(-180, 3), 0)
  assert.equal(lonToTileX(0, 3), 4)
  assert.ok(Math.abs(latToTileY(0, 3) - 4) < 1e-9)
})

test('el zoom elegido respeta el máximo de teselas y el rango permitido', () => {
  const bbox = [-93.3919, 16.6539, -92.8757, 16.8964]
  const z = chooseZoom(bbox, 8, 13, 36)
  assert.ok(z >= 8 && z <= 13)
  const small = chooseZoom([-93.13, 16.80, -93.10, 16.82], 8, 13, 36)
  assert.equal(small, 13)
  assert.equal(chooseZoom([-100, 10, -90, 20], 8, 13, 36), 8)
})

test('tamaño del bbox en metros es coherente (~55 km × ~27 km para la ROI de Chiapas)', () => {
  const { widthM, heightM } = bboxSizeMeters([-93.3919, 16.6539, -92.8757, 16.8964])
  assert.ok(widthM > 50000 && widthM < 60000)
  assert.ok(heightM > 25000 && heightM < 29000)
})

test('rampa hipsométrica acotada y azul costero a nivel del mar', () => {
  assert.deepEqual(hypsometricColor(0), [38, 115, 77])
  assert.deepEqual(hypsometricColor(1), [245, 245, 245])
  assert.deepEqual(hypsometricColor(-5), [38, 115, 77])
  assert.deepEqual(hypsometricColor(0, 0), [38, 118, 178])
})

test('saneamiento de elevaciones: recorta batimetría/outliers negativos a 0 m e ignora alpha < 255', () => {
  assert.equal(sanitizeElevationSample(-9651, 255), 0)
  assert.equal(sanitizeElevationSample(-120, 255), 0)
  assert.equal(sanitizeElevationSample(561, 255), 561)
  assert.ok(Number.isNaN(sanitizeElevationSample(120, 128)))
  assert.ok(Number.isNaN(sanitizeElevationSample(120, 0)))

  const raw = new Float32Array([-9651, -45, 0, 180, 561, 999])
  const alphas = new Uint8Array([255, 255, 255, 255, 255, 120])
  const { heights, minM, maxM } = sanitizeElevationGrid(raw, alphas)
  assert.equal(minM, 0)
  assert.equal(maxM, 561)
  assert.deepEqual(Array.from(heights), [0, 0, 0, 180, 561, 0])
})

test('despikeElevationGrid elimina aguja aislada de +256 m sin aplanar una pendiente real', () => {
  // Malla 5x5 con pendiente continua hacia el este (20 m por columna) y hacia el sur (15 m por fila)
  const cols = 5
  const rows = 5
  const grid = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = 500 + c * 20 + r * 15
    }
  }
  const cleanSlopeCopy = new Float32Array(grid)
  // Insertamos un pico tipo aguja de +256 m en el centro (r=2, c=2), cuyo valor real era 570 m
  const centerIdx = 2 * cols + 2
  grid[centerIdx] += 256

  const { heights, minM, maxM } = despikeElevationGrid(grid, cols, rows, 80)
  // El pico aislado de 826 m debe volver a la mediana de sus 8 vecinos (570 m)
  assert.equal(heights[centerIdx], 570)
  // El resto de la pendiente continua no debe alterarse
  assert.deepEqual(Array.from(heights), Array.from(cleanSlopeCopy))
  assert.equal(minM, 500)
  assert.equal(maxM, 500 + 4 * 20 + 4 * 15)

  // Remuestreo bilineal en metros conserva una rampa lineal
  const resampled = resampleElevationBilinear(cleanSlopeCopy, cols, rows, 0, 0, 4, 4, 3, 3)
  assert.equal(resampled[0], 500)
  assert.equal(resampled[4], 570)
  assert.equal(resampled[8], 640)
})

test('mensajes del módulo registrados en i18n (ES/EN)', () => {
  try {
    setLanguage('en')
    assert.equal(localizeText('Relieve 3D'), '3D Relief')
    assert.equal(localizeText('4 teselas no disponibles'), '4 tiles unavailable')
    assert.equal(localizeText('Selecciona primero una ROI para ver su relieve 3D.'), 'Select an ROI first to view its 3D relief.')
  } finally { setLanguage('es') }
})

test('el visor 3D se carga de forma diferida y libera WebGL al desmontar', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /lazy\(\(\) => import\('\.\/components\/Terrain3DViewer'\)\)/)
  assert.doesNotMatch(app, /from 'three'/)
  const viewer = readFileSync(new URL('../src/components/Terrain3DViewer.tsx', import.meta.url), 'utf8')
  for (const call of ['renderer.dispose()', 'forceContextLoss()', 'ro.disconnect()', 'controls.dispose()', 'cancelAnimationFrame(raf)']) {
    assert.ok(viewer.includes(call), call)
  }
})
