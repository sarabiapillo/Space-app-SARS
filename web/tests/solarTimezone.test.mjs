import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panel = readFileSync(new URL('../src/components/RightPanel.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/api/client.ts', import.meta.url), 'utf8')

test('idealized solar panel has no date/timezone selection or lookup dependency', () => {
  assert.doesNotMatch(panel, /resolveSolarTimezone|type="date"|type="time"|datetime_local|timezoneInput/)
  assert.doesNotMatch(client, /api\/solar\/timezone|resolveSolarTimezone/)
  assert.match(panel, /elevation_deg: elevation/)
  assert.match(panel, /azimuth_deg: azimuth/)
  assert.match(panel, /min="0" max="90"/)
  assert.match(panel, /min="0" max="360"/)
})

test('solar contours use the simulations endpoint and GeoJSON is shown only for active solar state', () => {
  assert.match(client, /\/api\/solar\/simulations\/\$\{encodeURIComponent\(runId\)\}\/contours/)
  assert.match(panel, /getSolarContours\(res\.id, res\.layers\.incident\.contours_url\)/)
  assert.match(panel, /showContours/)
  assert.match(panel, /Isolíneas de igual irradiancia/)
})
