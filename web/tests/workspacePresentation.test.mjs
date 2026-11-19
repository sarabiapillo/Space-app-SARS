import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('solar and seismic floating panels fit inside their clipped map canvas', () => {
  const css = source('../src/index.css')
  assert.match(css, /\.solar-card\s*\{[^}]*max-height: calc\(100% - 24px\)/s)
  assert.match(css, /\.seismic-panel\s*\{[^}]*max-height: calc\(100% - 54px\)/s)
  assert.match(css, /\.seismic-panel\.is-expanded-full\s*\{[^}]*max-height: calc\(100% - 54px\)/s)
})

test('solar run needs only a confirmed ROI and uses idealized geometry while preserving zero intensity', () => {
  const panel = source('../src/components/RightPanel.tsx')
  assert.match(panel, /disabled=\{isSimulating \|\| !confirmedRoi/)
  assert.match(panel, /elevation_deg: elevation/)
  assert.match(panel, /azimuth_deg: azimuth/)
  assert.match(panel, /const intensity = Math\.max\(0, Math\.min\(100, Math\.round\(solar\.radiationIntensity\)\)\)/)
  assert.doesNotMatch(panel, /resolveSolarTimezone|type="date"|datetime_local|timezoneInput/)
})

test('scientific resolution is rounded for display only and reference case is not current ROI', () => {
  const panel = source('../src/components/RightPanel.tsx')
  const sidebar = source('../src/components/Sidebar.tsx')
  const explorer = source('../src/features/explorador/index.tsx')
  const landing = source('../src/components/TeamLandingPage.tsx')
  assert.match(panel, /analysis\.resolution\.map\(value => value\.toFixed\(2\)\)/)
  assert.match(sidebar, /layer\.pixel_m\.toFixed\(2\)/)
  assert.match(explorer, /Caso de referencia/)
  assert.doesNotMatch(landing, /Caso de estudio actual:/)
})

test('solar header replaces NISAR context and hides non-solar duplicate actions only on active solar map', () => {
  const header = source('../src/components/Header.tsx')
  assert.match(header, /const isSolarCopy = solar\.enabled/)
  assert.doesNotMatch(header, /const isActiveSolarMap = solar\.enabled && activeDockTab/)
  assert.match(header, /isSolarCopy \? t\('SOLAR', 'SOLAR'\) : 'NISAR L2'/)
  assert.match(header, /!isSolarCopy && <div className="ws-menubar__status">/)
  assert.match(header, /hasConfirmedROI && !isSolarCopy/)
  assert.match(header, /!isSolarCopy && <button[\s\S]*?Escenas GCOV/)
  assert.match(header, /!isSolarCopy && activeDockTab === 'map'/)
})

test('narrow chart cards and long legends can wrap without overflow', () => {
  const css = source('../src/index.css')
  assert.match(css, /minmax\(min\(360px, 100%\), 1fr\)/)
  assert.match(css, /minmax\(min\(280px, 100%\), 1fr\)/)
  assert.match(css, /\.ws-hist-legend li\s*\{[^}]*white-space: normal/s)
})
