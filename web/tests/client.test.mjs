import test from 'node:test'
import assert from 'node:assert/strict'
import { getRois, getScenes, getChanges, getChangeDetail, checkCompat, getChangeReport, generateLocationRoi, searchGcov, suggestLocations, searchLocations } from '../src/api/client.ts'

const cases = [
  ['getRois', () => getRois(), '/api/rois'],
  ['getScenes', () => getScenes(), '/api/scenes'],
  ['getChanges', () => getChanges(), '/api/changes'],
  ['getChangeDetail', () => getChangeDetail('run/1'), '/api/changes/run%2F1'],
  ['checkCompat', () => checkCompat('a', 'b'), '/api/compat?'],
  ['getChangeReport', () => getChangeReport('run/1'), '/api/changes/run%2F1/report'],
]

test('typing suggestions use dedicated endpoint; choosing a name still uses explicit Nominatim search', async () => {
  const paths = []
  globalThis.fetch = async (path) => {
    paths.push(path)
    return new Response(JSON.stringify(path.includes('suggest')
      ? { suggestions: [{ name: 'Tuxtla Gutiérrez', query: 'Tuxtla Gutiérrez, Chiapas, México' }] }
      : { results: [] }))
  }
  const suggestions = await suggestLocations('Tuxtla')
  assert.equal(suggestions.suggestions[0].name, 'Tuxtla Gutiérrez')
  await searchLocations(suggestions.suggestions[0].query)
  assert.deepEqual(paths, ['/api/locations/suggest?q=Tuxtla', '/api/locations?q=Tuxtla%20Guti%C3%A9rrez%2C%20Chiapas%2C%20M%C3%A9xico'])
})

test('ROI generation sends selected place, query and radius to the agreed endpoint', async () => {
  let sent
  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/api/locations/roi')
    sent = JSON.parse(init.body)
    return new Response(JSON.stringify({ geometry: { type: 'MultiPolygon', coordinates: [] }, original_geometry: { type: 'Polygon', coordinates: [] }, metadata: { name: 'Lugar', center: [0, 0], radius_km: 5, applied_radius_km: 3.2, source: 'osm', generation: 'administrative_rectangle' } }), { status: 200 })
  }
  const result = await generateLocationRoi({ place_id: 23, query: 'Lugar', radius_km: 5 })
  assert.deepEqual(sent, { place_id: 23, query: 'Lugar', radius_km: 5 })
  assert.equal(result.geometry.type, 'MultiPolygon')
  assert.equal(result.metadata.applied_radius_km, 3.2)
})

test('GCOV search preserves selected start/end filters and omits cleared filters', async () => {
  let body
  globalThis.fetch = async (_path, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ scenes: [], count: 0, coverage_note: '' })) }
  const roi = { type: 'Polygon', coordinates: [] }
  await searchGcov(roi, '2026-06-18', '2026-10-16')
  assert.deepEqual(body, { roi, start: '2026-06-18', end: '2026-10-16' })
  await searchGcov(roi, '', '2026-10-16')
  assert.deepEqual(body, { roi, end: '2026-10-16' })
})

test('GCOV search posts complete effective GeoJSON without flattening rings or parts', async () => {
  const roi = { type: 'MultiPolygon', coordinates: [[[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[2,1],[2,2],[1,2],[1,1]]], [[[8,8],[9,8],[9,9],[8,9],[8,8]]]] }
  let body
  globalThis.fetch = async (_path, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ scenes: [], count: 0, coverage_note: '' })) }
  await searchGcov(roi)
  assert.deepEqual(body.roi, roi)
})

test('catalog/comparison APIs reject backend errors instead of substituting synthetic data', async (t) => {
  for (const [name, call, expectedPath] of cases) {
    await t.test(name, async () => {
      globalThis.fetch = async (path) => {
        assert.ok(String(path).startsWith(expectedPath))
        return new Response(JSON.stringify({ detail: 'endpoint unavailable' }), {
          status: 404, headers: { 'content-type': 'application/json' },
        })
      }
      await assert.rejects(call(), /endpoint unavailable/)
    })
  }
})

test('catalog API preserves successful backend response and marks it non-synthetic', async () => {
  const payload = [{ id: 'actual' }]
  globalThis.fetch = async () => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
  assert.deepEqual(await getRois(), { data: payload, isSyntheticMock: false })
})

test('every POST sends the Django CSRF token from the cookie, so a logged-in session is not rejected', async () => {
  const { requestGcovDownload, runSolarSimulation, prepareFloodScenario, simulateFloodScenario, csrfHeaders } = await import('../src/api/client.ts')
  globalThis.document = { cookie: 'sessionid=s; csrftoken=abc%3D1' }
  const sent = []
  globalThis.fetch = async (path, init) => { sent.push([path, new Headers(init?.headers).get('X-CSRFToken')]); return new Response('{}') }
  await generateLocationRoi({ place_id: 1, query: 'x', radius_km: 1 })
  await searchGcov({ type: 'Polygon', coordinates: [] })
  await requestGcovDownload('scene', { type: 'Polygon', coordinates: [] })
  await runSolarSimulation({}).catch(() => {})
  await prepareFloodScenario({}).catch(() => {})
  await simulateFloodScenario({}).catch(() => {})
  assert.deepEqual(sent.map(([, token]) => token), Array(6).fill('abc=1'))
  assert.deepEqual(csrfHeaders(), { 'X-CSRFToken': 'abc=1' })
  globalThis.document = { cookie: '' }
  assert.deepEqual(csrfHeaders(), {})
  delete globalThis.document
})
