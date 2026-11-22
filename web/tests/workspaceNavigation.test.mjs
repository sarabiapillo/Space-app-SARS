import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('workspace copy actions have one primary location in Header, not map tabs', () => {
  const header = source('../src/components/Header.tsx')
  const map = source('../src/components/MapCanvas.tsx')
  for (const [label, callback] of [
    ['Copia con Calor', 'onDuplicateWithHeatmap'],
    ['Copia Agua (DG2)', 'onDuplicateForWater'],
    ['Copia Sismo', 'onDuplicateForSeismic'],
  ]) {
    assert.match(header, new RegExp(`onClick={${callback}}`))
    assert.doesNotMatch(map, new RegExp(label))
  }
  assert.match(map, /onOpenDockWindow\(/)
})

test('workspace navigation remains keyboard reachable and ribbon can wrap on narrow viewports', () => {
  const header = source('../src/components/Header.tsx')
  const css = source('../src/index.css')
  assert.match(header, /role="toolbar"/)
  assert.match(css, /\.ws-ribbon__controls\s*\{[^}]*flex-wrap:\s*wrap/)
})
