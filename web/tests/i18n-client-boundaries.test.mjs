import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { searchLocations, searchGcov, requestGcovDownload } from '../src/api/client.ts'
import { setLanguage, localizeText } from '../src/i18n/core.ts'

test('shared API callers preserve successful DTOs, geometry, flags and request values in both languages', async () => {
  const originalFetch = globalThis.fetch
  const roi = { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
    [[[8, 8], [9, 8], [9, 9], [8, 9], [8, 8]]],
  ] }
  const payload = { scenes: [{ scene_id: 'NISAR_P05023', maturity: 'PROVISIONAL', coverage_pct: 0, footprint: roi }], count: 1, coverage_note: 'Unknown user-provided text' }
  const calls = []
  try {
    globalThis.fetch = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify(payload)) }
    for (const language of ['es', 'en']) {
      setLanguage(language)
      assert.deepEqual(await searchGcov(roi, '', '2026-10-16'), payload)
      await requestGcovDownload('NISAR_P05023', roi)
    }
    for (const index of [0, 2]) {
      assert.equal(calls[index][0], '/api/gcov/search')
      assert.equal(calls[index][1].method, 'POST')
      assert.deepEqual(JSON.parse(calls[index][1].body), { roi, end: '2026-10-16' })
      assert.equal(calls[index + 1][0], '/api/gcov/downloads')
      assert.deepEqual(JSON.parse(calls[index + 1][1].body), { scene_id: 'NISAR_P05023', roi })
    }
  } finally { globalThis.fetch = originalFetch; setLanguage('es') }
})

test('known API errors localize while empty, missing or malformed error bodies retain HTTP fallback', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const language of ['es', 'en']) {
      setLanguage(language)
      for (const body of [{ detail: '' }, {}, null, { query: [] }]) {
        globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 400 })
        await assert.rejects(searchLocations('Tuxtla'), { name: 'Error', message: 'Error HTTP 400' })
      }
      globalThis.fetch = async () => new Response('invalid JSON', { status: 503 })
      await assert.rejects(searchLocations('Tuxtla'), { name: 'Error', message: 'Error HTTP 503' })
    }
    setLanguage('en')
    globalThis.fetch = async () => new Response(JSON.stringify({ radius_km: ['El radio debe estar entre 1 y 15 km.'] }), { status: 400 })
    await assert.rejects(searchLocations('Tuxtla'), { name: 'Error', message: 'The radius must be between 1 and 15 km.' })
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Unknown user value P05023' }), { status: 400 })
    await assert.rejects(searchLocations('Tuxtla'), { name: 'Error', message: 'Unknown user value P05023' })
    const stored = localizeText('El radio debe estar entre 1 y 15 km.')
    setLanguage('es')
    assert.equal(localizeText(stored), 'El radio debe estar entre 1 y 15 km.')
  } finally { globalThis.fetch = originalFetch; setLanguage('es') }
})

test('location search presents stored errors through the reversible display translator', () => {
  // Structural wiring complements behavioral reverse-message tests without a browser DOM.
  const source = readFileSync(new URL('../src/components/LocationSearch.tsx', import.meta.url), 'utf8')
  assert.match(source, /role="alert"[^>]*>\{localizeText\(error\)\}/)
})
