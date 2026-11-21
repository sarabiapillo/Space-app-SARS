import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLanguage } from '../src/i18n/core.ts'
import { render } from './i18n-rendering.mjs'
const { ScientificFiguresViewer } = await import('../src/components/ScientificFiguresViewer.tsx')
const { SCIENTIFIC_FIGURES } = await import('../src/components/scientificFigures.ts')

test('scientific viewer translates every built-in figure title, subtitle, tag and description without replacing image sources', () => {
  const snapshot = JSON.stringify(SCIENTIFIC_FIGURES)
  try {
    setLanguage('es')
    const spanish = render(ScientificFiguresViewer, { sceneId: 'SCENE_TEST', dateLabel: '2026-10-16' })
    assert.match(spanish, /Ángulo de Incidencia en la ROI/)
    setLanguage('en')
    const english = render(ScientificFiguresViewer, { sceneId: 'SCENE_TEST', dateLabel: '2026-10-16' })
    assert.match(english, /Incidence Angle in the ROI/)
    assert.match(english, /Backscatter histograms in dB/)
    assert.doesNotMatch(english, /Retrodispersión|Máscara de Calidad/)
    for (const figure of SCIENTIFIC_FIGURES) {
      assert.ok(english.includes(`/data/explore/SCENE_TEST/figuras/${figure.filename}`))
    }
    assert.equal(JSON.stringify(SCIENTIFIC_FIGURES), snapshot)
  } finally { setLanguage('es') }
})
