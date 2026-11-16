import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { geometryBounds, isBoundedAdministrativeGeometry, geometryToOuterRing, exceedsRoiSizeLimit, isCurrentRoiRequest, compareGcovMetadata, isValidGcovDateRange } from '../src/utils/roi.ts'

const gcovScene = (overrides = {}) => ({
  scene_id: 'NISAR_GCOV_20260618', product: 'GCOV', start_time: '2026-06-18T11:40:10Z', date: '2026-06-18',
  track: 62, frame: 10, direction: 'ASCENDING', polarizations: ['HH', 'HV'], crid: 'P05023', maturity: 'PROVISIONAL',
  size_bytes: null, frame_coverage: null, footprint: null, roi_intersection: null, coverage_pct: null, coverage_source: null,
  ...overrides,
})

test('el rango GCOV acepta fechas vacías e iguales, y rechaza Desde posterior a Hasta', () => {
  assert.equal(isValidGcovDateRange('', ''), true)
  assert.equal(isValidGcovDateRange('2026-06-18', ''), true)
  assert.equal(isValidGcovDateRange('2026-06-18', '2026-06-18'), true)
  assert.equal(isValidGcovDateRange('2026-10-16', '2026-06-18'), false)
})

test('los filtros de fecha sobreviven a cambios de ROI y mapa, mientras resultados viejos se invalidan', () => {
  const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8')
  const catalog = readFileSync(new URL('../src/components/GcovCatalog.tsx', import.meta.url), 'utf8')
  assert.match(sidebar, /\[gcovStart, setGcovStart\] = useState\(''\)/)
  assert.match(sidebar, /\[gcovEnd, setGcovEnd\] = useState\(''\)/)
  assert.match(sidebar, /<GcovCatalog key=\{`\$\{activeMapId/)
  assert.match(sidebar, /start=\{gcovStart\} end=\{gcovEnd\} onStartChange=\{setGcovStart\} onEndChange=\{setGcovEnd\}/)
  assert.doesNotMatch(catalog, /\[start, setStart\] = useState/)
  assert.match(catalog, /requestVersion\.current \+= 1/)
})

test('limites administrativos grandes siguen siendo geometrías válidas y conservan su contorno', () => {
  const polygon = { type: 'Polygon', coordinates: [[[-100, 10], [-90, 10], [-90, 20], [-100, 10]]] }
  assert.equal(isBoundedAdministrativeGeometry(polygon), true)
  assert.deepEqual(geometryBounds(polygon), [-100, 10, -90, 20])
  assert.deepEqual(geometryToOuterRing(polygon), [[-100, 10], [-90, 10], [-90, 20]])
  assert.equal(exceedsRoiSizeLimit(polygon), true)
  const small = { type: 'Polygon', coordinates: [[[-93.2, 16.7], [-93.1, 16.7], [-93.1, 16.8], [-93.2, 16.7]]] }
  assert.equal(exceedsRoiSizeLimit(small), false)
})

test('resultados y descargas solo se aceptan para la ROI y solicitud vigentes', () => {
  assert.equal(isCurrentRoiRequest('roi-a', 'roi-a', 4, 4), true)
  assert.equal(isCurrentRoiRequest('roi-a', 'roi-b', 4, 4), false)
  assert.equal(isCurrentRoiRequest('roi-a', 'roi-a', 4, 5), false)
})

test('puntos no se consideran límites administrativos seleccionables', () => {
  assert.equal(isBoundedAdministrativeGeometry({ type: 'Point', coordinates: [0, 0] }), false)
})

test('comparación de catálogo solo marca metadata coincidente y adquisiciones distintas', () => {
  const first = gcovScene()
  const second = gcovScene({ scene_id: 'NISAR_GCOV_20261016', start_time: '2026-10-16T11:40:10Z' })
  assert.equal(compareGcovMetadata(first, second).compatible, true)
  assert.equal(compareGcovMetadata(first, first).compatible, false)
  for (const field of ['track', 'frame', 'direction', 'crid', 'maturity']) {
    assert.equal(compareGcovMetadata(first, gcovScene({ ...second, [field]: null })).compatible, false, `${field} desconocido no debe pasar`)
  }
  assert.equal(compareGcovMetadata(first, gcovScene({ ...second, polarizations: ['HH'] })).compatible, false)
  assert.equal(compareGcovMetadata(first, gcovScene({ ...second, crid: 'P05036' })).compatible, false)
})
