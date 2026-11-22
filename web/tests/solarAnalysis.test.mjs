import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSolarSample, getSolarAnalysis, getSolarContours, runSolarSimulation, histogramBars } from '../src/api/client.ts'
import { readFileSync } from 'node:fs'

test('histogramBars pairs backend bins and counts without deriving values', () => {
  assert.deepEqual(histogramBars({ bin_edges: [0, 10, 20], counts: [3, 7] }), [
    { start: 0, end: 10, count: 3 },
    { start: 10, end: 20, count: 7 },
  ])
})

test('histogramBars rejects inconsistent, negative, and non-finite histogram data', () => {
  assert.throws(() => histogramBars({ bin_edges: [0, 1], counts: [] }))
  assert.throws(() => histogramBars({ bin_edges: [0, 1], counts: [-1] }))
  assert.throws(() => histogramBars({ bin_edges: [0, Infinity], counts: [1] }))
})

test('solar 400 and 404 responses retain backend error without fabricated analysis', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Persisted analysis summary is invalid' }), { status: 400, headers: { 'content-type': 'application/json' } })
    await assert.rejects(getSolarAnalysis('run'), /Persisted analysis summary is invalid/)
    globalThis.fetch = async () => new Response(JSON.stringify(['Persisted analysis summary is invalid']), { status: 400, headers: { 'content-type': 'application/json' } })
    await assert.rejects(getSolarAnalysis('run'), /Persisted analysis summary is invalid/)
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Persisted analysis summary is invalid' }), { status: 400, headers: { 'content-type': 'application/json' } })
    const request = { roi: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, elevation_deg: 45, azimuth_deg: 180, intensity_percent: 0 }
    await assert.rejects(runSolarSimulation(request), /Persisted analysis summary is invalid/)
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unknown solar route or layer', code: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    await assert.rejects(getSolarAnalysis('run'), /Unknown solar route or layer/)
    await assert.rejects(getSolarSample('/api/solar/simulations/run/sample', 0, 0), /Unknown solar route or layer/)
    const panel = readFileSync(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')
    assert.match(panel, /analysisError && <p role="alert"/)
    assert.match(panel, /solar-compact-summary[\s\S]*analysisError && <p role="alert"/)
    assert.match(panel.slice(panel.indexOf('const invalidateRun ='), panel.indexOf('useEffect(() => {', panel.indexOf('const invalidateRun ='))), /setSimulationError\(null\)/)
    assert.match(panel.slice(panel.indexOf('if (lastRoiKey.current !== roiKey)'), panel.indexOf('return () => { requestVersion.current++ }')), /setSimulationError\(null\)/)
    assert.match(panel, /simulationError &&/)
  } finally { globalThis.fetch = originalFetch }
})

test('idealized solar request defaults to elevation 45 and north-clockwise azimuth 180', async () => {
  const originalFetch = globalThis.fetch
  let sent
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body)
    return new Response(JSON.stringify({ id: 'idealized-run' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await runSolarSimulation({ roi: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })
    assert.equal(sent.elevation_deg, 45)
    assert.equal(sent.azimuth_deg, 180)
    assert.equal('datetime_local' in sent, false)
    assert.equal('timezone' in sent, false)
  } finally { globalThis.fetch = originalFetch }
})

test('solar contour request uses the simulations contours route and preserves GeoJSON', async () => {
  const originalFetch = globalThis.fetch
  let requested
  const featureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { value_w_m2: 500, units: 'W/m2' } }] }
  globalThis.fetch = async url => {
    requested = String(url)
    return new Response(JSON.stringify(featureCollection), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    assert.deepEqual(await getSolarContours('run-1'), featureCollection)
    assert.equal(requested, '/api/solar/simulations/run-1/contours')
  } finally { globalThis.fetch = originalFetch }
})

test('solar API rejects out-of-range elevation and azimuth before sending', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; return new Response('{}', { status: 200 }) }
  try {
    const roi = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    await assert.rejects(runSolarSimulation({ roi, elevation_deg: 91 }), /elevation/i)
    await assert.rejects(runSolarSimulation({ roi, azimuth_deg: 361 }), /azimuth/i)
    assert.equal(requests, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('solar panel exposes idealized angles and no date or timezone selectors', () => {
  const panel = readFileSync(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /elevation_deg/)
  assert.match(panel, /azimuth_deg/)
  assert.doesNotMatch(panel, /resolveSolarTimezone|type="date"|datetime_local|timezoneInput/)
})

test('getSolarSample requests exact WGS84 coordinates from the GeoTIFF endpoint', async () => {
  const originalFetch = globalThis.fetch
  let requested
  globalThis.fetch = async (url) => {
    requested = String(url)
    return new Response(JSON.stringify({ value_w_m2: null, status: 'nodata' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await getSolarSample('/api/solar/simulations/run/sample', -92.5, 16.75)
    assert.equal(new URL(requested, 'http://localhost').searchParams.get('lon'), '-92.5')
    assert.equal(new URL(requested, 'http://localhost').searchParams.get('lat'), '16.75')
    assert.deepEqual(result, { value_w_m2: null, status: 'nodata' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
