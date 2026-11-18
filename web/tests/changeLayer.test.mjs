import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  changePolarization,
  pickChangeLayer,
  pickChangeMetrics,
  isChangeManifest,
  CHANGE_GRADIENT_VERTICAL,
} from '../src/utils/changeLayer.ts'

const layer = (capa) => ({
  id: `delta_gamma0_${capa.slice(0, 2)}_ml2_dB`, capa, png: `x/${capa}.png`, cog: `x/${capa}.tif`,
  escala: { vmin_dB: -6, vmax_dB: 6, colormap: 'rdbu', metodo: 'simétrica' },
})
const change = {
  tipo: 'mapa_de_cambio', t1: 'A', t2: 'B', umbral_dB: 3,
  capas: [layer('HHHH'), layer('HVHV')],
  metricas: {
    HH: { area_disminucion_km2: 1.5, area_aumento_km2: 2, pct_disminucion: 1, pct_aumento: 2, mediana_dB: 0.1, area_valida_km2: 100 },
    HV: { area_disminucion_km2: 0.5, area_aumento_km2: 3, pct_disminucion: 0.5, pct_aumento: 3, mediana_dB: 0.2, area_valida_km2: 100 },
  },
  advertencias: [],
}

test('polarización del mapa de cambio según la capa elegida', () => {
  assert.equal(changePolarization('gamma0_HHHH_ml2_dB'), 'HH')
  assert.equal(changePolarization('sigma0_HVHV_ml2_dB'), 'HV')
})

test('elige la capa Δ de la misma polarización que la capa seleccionada', () => {
  assert.equal(pickChangeLayer(change, 'gamma0_HVHV_ml2_dB').capa, 'HVHV')
  assert.equal(pickChangeLayer(change, 'sigma0_HHHH_ml2_dB').capa, 'HHHH')
  assert.equal(pickChangeLayer(null, 'gamma0_HHHH_ml2_dB'), null)
  assert.equal(pickChangeLayer({ ...change, capas: [layer('HHHH')] }, 'gamma0_HVHV_ml2_dB'), null)
})

test('métricas de la polarización activa', () => {
  assert.equal(pickChangeMetrics(change, 'gamma0_HVHV_ml2_dB').area_aumento_km2, 3)
  assert.equal(pickChangeMetrics(null, 'gamma0_HVHV_ml2_dB'), null)
})

test('solo acepta manifiestos de cambio con capas', () => {
  assert.equal(isChangeManifest(change), true)
  assert.equal(isChangeManifest(null), false)
  assert.equal(isChangeManifest({ tipo: 'inspeccion_una_fecha', capas: [] }), false)
  assert.equal(isChangeManifest({ tipo: 'mapa_de_cambio', capas: [] }), false)
})

test('rampa vertical: rojo arriba (+), blanco al centro, azul abajo (−)', () => {
  assert.match(CHANGE_GRADIENT_VERTICAL, /^linear-gradient\(to top, rgb\(5, 48, 97\)/)
  assert.match(CHANGE_GRADIENT_VERTICAL, /rgb\(255, 255, 255\) 50%/)
  assert.match(CHANGE_GRADIENT_VERTICAL, /rgb\(103, 0, 31\) 100%\)$/)
})

// --- Controles de multilook/umbral y ruido de referencia por ROI ---
import { changeResolutionM, changeOptions, noiseSummary, sameChangeParams } from '../src/utils/changeLayer.ts'

const tuned = { ...change, multilook: 5, pixel_m: 50, opciones: { multilook: [2, 5, 10], umbral_dB: [1.5, 3, 6] } }

test('resolución en metros de cada opción de multilook según el píxel del producto', () => {
  assert.equal(changeResolutionM(tuned, 2), 20)
  assert.equal(changeResolutionM(tuned, 10), 100)
  assert.equal(changeResolutionM(change, 5), null)          // manifiesto viejo sin multilook/pixel_m
})

test('opciones de recálculo: las del servidor, o ninguna si no las manda', () => {
  assert.deepEqual(changeOptions(tuned), { multilook: [2, 5, 10], umbral_dB: [1.5, 3, 6] })
  assert.equal(changeOptions(change), null)
  assert.equal(changeOptions(null), null)
})

test('resumen de ruido: umbral cerca del ruido y |z| > 3', () => {
  const s = noiseSummary({ ...change.metricas.HH, ruido_dB: 1.1, umbral_sobre_ruido: 2.7, umbral_cerca_del_ruido: true, pct_abs_z_mayor_3: 0.8 })
  assert.deepEqual(s, { noiseDb: 1.1, ratio: 2.7, nearNoise: true, pctAbsZ3: 0.8 })
  assert.equal(noiseSummary(change.metricas.HH), null)       // sin ruido calculado
  assert.equal(noiseSummary(null), null)
})

test('detecta si el manifiesto ya corresponde a la combinación pedida', () => {
  assert.equal(sameChangeParams(tuned, 5, 3), true)
  assert.equal(sameChangeParams(tuned, 2, 3), false)
  assert.equal(sameChangeParams(null, 5, 3), false)
})
