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
