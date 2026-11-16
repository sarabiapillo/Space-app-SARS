import test from 'node:test'
import assert from 'node:assert/strict'
import { setLanguage, localizeText } from '../src/i18n/core.ts'
import { verifyExploreScaleMatch, searchLocations, generateLocationRoi } from '../src/api/client.ts'
import { rectangleFromCorners } from '../src/utils/roi.ts'

const manifest = (min, max) => ({ capas: [{ id: 'HHHH', escala: { vmin_dB: min, vmax_dB: max } }] })
test('scale verification translates only presentation, preserves numbers and validity', () => {
  try {
    setLanguage('en')
    const same = verifyExploreScaleMatch(manifest(-22, 0), manifest(-22, 0), 'HHHH')
    assert.equal(same.valid, true)
    assert.equal(same.vminT1, -22)
    assert.equal(same.message, 'Verified common scale: -22 to 0 dB (--escala-web -22 0)')
    const different = verifyExploreScaleMatch(manifest(-22, 0), manifest(-20, 0), 'HHHH')
    assert.equal(different.valid, false)
    assert.match(different.message, /^Scale warning: t1 \(-22\.\.0 dB\) ≠ t2 \(-20\.\.0 dB\)/)
    setLanguage('es')
    assert.equal(verifyExploreScaleMatch(manifest(-22, 0), manifest(-22, 0), 'HHHH').message, 'Escala común verificada: -22 a 0 dB (--escala-web -22 0)')
  } finally { setLanguage('es') }
})

test('curated ROI notices and scientific metadata translate without replacing identifiers', () => {
  try {
    setLanguage('en')
    assert.equal(localizeText('La ROI admite como máximo 0.6 grados por lado.'), 'The ROI allows at most 0.6 degrees per side.')
    assert.equal(localizeText('Producto GCOV'), 'GCOV product')
    assert.equal(localizeText('No se pudieron encontrar los límites automáticos de la región. Se generó un área rectangular con un radio de 5 km alrededor del punto seleccionado.'), 'Automatic region boundaries could not be found. A rectangular area with a radius of 5 km was generated around the selected point.')
    assert.equal(localizeText('User ROI GCOV_023'), 'User ROI GCOV_023')
  } finally { setLanguage('es') }
})

test('known server stages, exploratory caveats and layer names retain science and IDs in both languages', () => {
  const pairs = [
    ['En espera para iniciar el recorte…', 'Waiting to start the ROI subset…'],
    ['Leyendo bloques HTTPS del H5 y preparando capas (2/2)…', 'Reading H5 blocks over HTTPS and preparing layers (2/2)…'],
    ['El destino existente está dañado; recupéralo manualmente. No se modificaron ni eliminaron archivos.', 'The existing destination is damaged; recover it manually. No files were modified or deleted.'],
    ['La cobertura es una estimación de huellas de catálogo, no de píxeles válidos.', 'Coverage is estimated from catalog footprints, not from valid pixels.'],
    ['Capas listas. Inspección exploratoria; no identifica causas.', 'Layers ready. Exploratory inspection; it does not identify causes.'],
    ['Una sola fecha: sirve para ver la escena, no es un mapa de cambio.', 'A single acquisition: useful for inspecting the scene, not a change map.'],
    ['Retrodispersión RTC γ⁰ HHHH en dB (multilook 2×2 · 20 m · EPSG:3857)', 'RTC γ⁰ HHHH backscatter in dB (2×2 multilook · 20 m · EPSG:3857)'],
    ['Círculo dibujado por el usuario. No es una detección ni un resultado del análisis.', 'Circle drawn by the user. It is not a detection or an analysis result.'],
  ]
  try {
    for (const [es, en] of pairs) {
      setLanguage('es'); assert.equal(localizeText(es), es)
      setLanguage('en'); assert.equal(localizeText(es), en)
    }
    assert.equal(localizeText('NISAR_L2_PR_GCOV_023'), 'NISAR_L2_PR_GCOV_023')
    assert.equal(localizeText('Tuxtla Gutiérrez'), 'Tuxtla Gutiérrez')
  } finally { setLanguage('es') }
})

test('ROI geometry is language-independent and server validation errors are readable', async () => {
  const fetchBefore = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]); return { ok: false, status: 400, json: async () => ({ geometry: 'Geometría polar no admitida por los límites de análisis.' }) }
  }
  const westSouth = [-93.1, 16.7], eastNorth = [-93, 16.8]
  try {
    setLanguage('es')
    const es = rectangleFromCorners(westSouth, eastNorth)
    await assert.rejects(generateLocationRoi({ place_id: 4, query: 'Tuxtla', radius_km: 5 }), /Geometría polar no admitida/)
    setLanguage('en')
    assert.deepEqual(rectangleFromCorners(westSouth, eastNorth), es)
    await assert.rejects(generateLocationRoi({ place_id: 4, query: 'Tuxtla', radius_km: 5 }), /Polar geometry is not supported by the analysis limits/)
    assert.equal(calls[0][0], '/api/locations/roi')
    assert.deepEqual(JSON.parse(calls[1][1].body), { place_id: 4, query: 'Tuxtla', radius_km: 5 })
  } finally { globalThis.fetch = fetchBefore; setLanguage('es') }
})

test('location client leaves request and response DTO intact while localizing human API detail', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push([url, init])
    return url.startsWith('/api/locations?q=')
      ? { ok: true, json: async () => ({ results: [{ name: 'Tuxtla Gutiérrez', place_id: 23 }], attribution: 'OpenStreetMap', license: 'ODbL' }) }
      : { ok: false, status: 400, json: async () => ({ detail: 'La ROI admite como máximo 0.6 grados por lado.' }) }
  }
  try {
    setLanguage('en')
    assert.deepEqual((await searchLocations('Tuxtla Gutiérrez')).results, [{ name: 'Tuxtla Gutiérrez', place_id: 23 }])
    await assert.rejects(generateLocationRoi({ place_id: 23, query: 'Tuxtla Gutiérrez', radius_km: 5 }), /The ROI allows at most 0.6 degrees per side/)
    assert.equal(calls[0][0], '/api/locations?q=Tuxtla%20Guti%C3%A9rrez')
    assert.deepEqual(JSON.parse(calls[1][1].body), { place_id: 23, query: 'Tuxtla Gutiérrez', radius_km: 5 })
  } finally { globalThis.fetch = originalFetch; setLanguage('es') }
})
