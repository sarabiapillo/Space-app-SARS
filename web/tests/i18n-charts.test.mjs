import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setLanguage, localizeText } from '../src/i18n/core.ts'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

test('curated chart and C4 messages translate display text without changing values or identifiers', () => {
  setLanguage('en')
  assert.equal(localizeText('Ascendente'), 'Ascending')
  assert.equal(localizeText('Potencia lineal γ⁰ co-polarizada HH (sin dB, sin máscara; 2687 × 5504 px a 10 m).'), 'Co-polarized HH linear γ⁰ power (not dB, unmasked; 2687 × 5504 px at 10 m).')
  assert.match(localizeText('Bloqueo por cambio de procesador (corte 2026-10-23): CRID \'P05023\' (t1) ≠ \'P05036\' (t2) [PGE R05.02.3 v1.0.11 vs R05.03.2 v1.0.20].'), /Processor change.*2026-10-23.*P05023.*P05036/)
  assert.equal(localizeText('NISAR_L2_PR_GCOV_023'), 'NISAR_L2_PR_GCOV_023')
  setLanguage('es')
  assert.equal(localizeText('Ascendente'), 'Ascendente')
})

test('real chart-manifest labels and warnings are localized without changing protocol fields', () => {
  setLanguage('en')
  assert.equal(localizeText('Histograma de γ⁰ en dB sobre la ROI (resolución del producto)'), 'Histogram of γ⁰ in dB over the ROI (product resolution)')
  assert.equal(localizeText('válido (subfranja)'), 'valid (subswath)')
  assert.equal(localizeText('fuera de la adquisición (255)'), 'outside acquisition (255)')
  assert.equal(localizeText('Una sola fecha: describe la escena, no un cambio.'), 'Single date: describes the scene, not a change.')
  assert.match(localizeText('Datos de inspección: los histogramas son de la ROI a resolución completa, sin máscara de sombra/layover.'), /without a shadow\/layover mask/)
  assert.equal(localizeText('graficas.json'), 'graficas.json')
  assert.equal(localizeText('γ⁰'), 'γ⁰')
  setLanguage('es')
})

test('charts subscribe to language and translate manifest display fields without mutating scientific data', () => {
  const panel = source('components/Etapa1ChartsPanel.tsx')
  assert.match(panel, /useTranslation\(/)
  assert.match(panel, /localizeText\(histogramChart\.titulo\)/)
  assert.match(panel, /maskChart\.etiquetas\.map\(localizeText\)/)
  assert.match(panel, /localizeText\(adv\)/)
  assert.match(panel, /toLocaleString\(locale\)/)
  assert.doesNotMatch(panel, /formatIntEn\(/)
})

test('figure previews and C4 modules render localized text, not translated identifiers', () => {
  for (const path of ['components/ScientificFiguresViewer.tsx', 'components/RoiChartsSection.tsx', 'features/explorador/index.tsx', 'features/comparador/index.tsx', 'features/laboratorio/index.tsx', 'features/exportacion/index.tsx']) {
    assert.match(source(path), /useTranslation\(/, path)
  }
  const figures = source('components/ScientificFiguresViewer.tsx')
  assert.match(figures, /localizeText\(fig\.title\)/)
  assert.match(figures, /localizeText\(modalFigure\.description\)/)
  assert.match(source('features/comparador/index.tsx'), /localizeText\(err\)/)
  assert.match(source('features/explorador/index.tsx'), /localizeText\(layer\.descripcion\)/)
})
