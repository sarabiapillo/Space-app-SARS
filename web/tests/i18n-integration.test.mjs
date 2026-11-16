import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLanguage } from '../src/i18n/core.ts'
import { render, capturedCharts } from './i18n-rendering.mjs'
const { ExploradorFeature } = await import('../src/features/explorador/index.tsx')
const { ComparadorFeature } = await import('../src/features/comparador/index.tsx')
const { Etapa1ChartsPanel } = await import('../src/components/Etapa1ChartsPanel.tsx')

test('explorer and comparator translate public text and keep scene identifiers and warning visibility', () => {
  const pair = { stackId: 'T62/F10', t1: '2026-06-18', t2: '2026-10-16', onChangePair() {} }
  try {
    setLanguage('es')
    assert.match(render(ExploradorFeature, { activeStackId: 'T62/F10', onSelectStack() {} }), /Pilas NISAR L2 GCOV/)
    assert.match(render(ComparadorFeature, pair), /Fecha t1 \(Base\)/)
    setLanguage('en')
    const explorer = render(ExploradorFeature, { activeStackId: 'T62/F10', onSelectStack() {} })
    assert.match(explorer, /NISAR L2 GCOV stacks/)
    assert.match(explorer, /Co-polarized HH linear γ⁰ power/)
    assert.match(explorer, /HHHH.tif/)
    const comparable = render(ComparadorFeature, pair)
    assert.match(comparable, /Date t1 \(Baseline\)/)
    assert.match(comparable, /NISAR_L2_PR_GCOV_023_062/)
    assert.match(comparable, /Grid verified in .h5/)
    const blocked = render(ComparadorFeature, { ...pair, t2: '2026-10-28' })
    assert.match(blocked, /Processor change blocks comparison/)
    assert.doesNotMatch(blocked, /c4-compat-messages--warn/)
    assert.doesNotMatch(comparable, /La escena 2026-10-28|2026-07-24 T55/)
  } finally { setLanguage('es') }
})

test('real ROI chart rendering translates manifest labels and axes but does not modify the source data', () => {
  // Deliberately synthetic test fixture, not measured scene values.
  const manifest = {
    escena: { granuleId: 'SCENE_TEST', fecha_inicio: '2026-01-01T00:00:00Z', producto: 'GCOV', trayectoria: 1, marco: 2, direccion: 'ASCENDING', crid: 'TEST', madurez_catalogo: 'PROVISIONAL' },
    version_codigo: 'fixture', fuentes: { metadatos: 'metadata.json' },
    advertencias: ['Una sola fecha: describe la escena, no un cambio.'],
    graficas: [{ id: 'mascara_roi', titulo: 'Categorías de la máscara en la ventana de la ROI (todos los píxeles)', etiquetas: ['válido (subfranja)', 'fuera de la adquisición (255)'], series: [{ nombre: 'Porcentaje de la ventana', valores: [90, 10] }], eje_y: { etiqueta: 'Porcentaje de la ventana', unidad: '%' }, pct_validos_en_poligono: 90 }],
  }
  const props = { roiCharts: [{ granuleId: 'SCENE_TEST', manifest }], roiLabel: 'Mi región' }
  const snapshot = JSON.stringify(props)
  try {
    setLanguage('es')
    capturedCharts.length = 0
    assert.match(render(Etapa1ChartsPanel, props), /Una sola fecha: describe la escena, no un cambio/)
    assert.deepEqual(capturedCharts.at(-1).data.labels, ['válido (subfranja)', 'fuera de la adquisición (255)'])
    setLanguage('en')
    capturedCharts.length = 0
    const english = render(Etapa1ChartsPanel, props)
    assert.match(english, /Single date: describes the scene, not a change/)
    assert.match(english, /Mi región/)
    const chart = capturedCharts.at(-1)
    assert.deepEqual(chart.data.labels, ['valid (subswath)', 'outside acquisition (255)'])
    assert.deepEqual(chart.data.datasets[0].data, [90, 10])
    assert.equal(chart.options.scales.x.title.text, 'Mask category')
    assert.equal(chart.options.scales.y.title.text, 'Percentage of window [%]')
    assert.equal(chart.options.locale, 'en-US')
    assert.equal(JSON.stringify(props), snapshot)
  } finally { setLanguage('es') }
})
