// Modelo sísmico (docs/latex/ecuaciones_sismo.tex): GMPE de Arroyo et al. (2010) y García et al. (2005).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MANUAL_CRUSTAL_COEFFICIENTS,
  GMPE_BY_MECHANISM,
  exponentialIntegralE1,
  pgaRockArroyo2010_cgs,
  pgaRockGarcia2005_cgs,
  gmpeValidityWarnings,
  GMPE_SIGMA_LN,
  SOIL_VS30,
  siteAmplification,
  effectiveVs30,
  computePga_g,
  seismicMomentDynCm,
  sasmexAlertTimeSec,
  siteWaveParams,
  synthesizeSeismogram,
  runSeismicSimulation,
  pgaToMmi,
  MMI_BREAKPOINT_GAL,
  nearSourceSaturationKm,
} from '../src/utils/seismic.ts'

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`)

test('efecto de sitio S = −0.45·ln(Vs30/760), 0 en roca (§5.2)', () => {
  close(siteAmplification(760), 0)
  close(siteAmplification(1200), 0)
  close(siteAmplification(450), -0.45 * Math.log(450 / 760))
  assert.ok(Math.abs(Math.exp(siteAmplification(450)) - 1.27) < 0.01)    // "~1.3×"
  assert.ok(Math.abs(siteAmplification(100) - 0.913) < 0.001)            // "S ≈ 0.91"
  assert.deepEqual(SOIL_VS30, { rock: 760, intermediate: 450, soft_lacustrine: 100 })
  assert.equal(effectiveVs30('soft_lacustrine'), 100)
  assert.equal(effectiveVs30('rock', 300), 300)
})

test('momento sísmico M0 = 10^(1.5(Mw+10.7)) dyn·cm (ec. 1)', () => {
  close(seismicMomentDynCm(7.0), 10 ** (1.5 * 17.7), 1e10)
  close(Math.log10(seismicMomentDynCm(8.1)), 1.5 * 18.8, 1e-12)
})

test('alerta SASMEX T ≈ tS − t_proceso (ec. 10): CDMX a 320 km, h = 15 km → ≈ 88.5 s', () => {
  const T = sasmexAlertTimeSec(320, 15)
  assert.ok(Math.abs(T - 88.5) < 0.1, `${T}`)
  assert.equal(sasmexAlertTimeSec(0, 1), 0)                       // nunca negativo
})

test('parámetros de onda S según Vs30: < 180 m/s es cuenca lacustre (§8.3)', () => {
  assert.deepEqual(siteWaveParams(150), { fs_Hz: 0.52, tauCoda_sec: 28.0 })
  assert.deepEqual(siteWaveParams(760), { fs_Hz: 2.2, tauCoda_sec: 9.0 })
  assert.deepEqual(siteWaveParams(450), { fs_Hz: 1.3, tauCoda_sec: 14.0 })
})

test('el sismograma usa el Vs30 de la estación si se da', () => {
  const src = { epicenter: [-102.53, 18.19], magnitude: 8.1, depthKm: 15, name: '1985', mechanism: 'subduction', soilType: 'rock' }
  const rock = synthesizeSeismogram(src, 350)
  const lake = synthesizeSeismogram(src, 350, { stationVs30: 100 })
  assert.equal(rock.fs_Hz, 2.2)
  assert.equal(lake.fs_Hz, 0.52)
  assert.ok(lake.peakPga_g > rock.peakPga_g)
  assert.equal(lake.stationVs30, 100)
  assert.ok(Math.abs(lake.alertTimeSec - sasmexAlertTimeSec(350, 15)) < 1e-9)
})

test('la simulación reporta M0 y mantiene radios crecientes por umbral', () => {
  const r = runSeismicSimulation({ epicenter: [-99.78, 16.78], magnitude: 7.1, depthKm: 10, name: 'x', mechanism: 'subduction', soilType: 'intermediate' })
  close(r.seismicMoment_dyncm, seismicMomentDynCm(7.1), 1e10)
  const radii = r.rings.map((ring) => ring.radiusKm)
  assert.ok(radii.length === 4)
  assert.deepEqual([...radii].sort((a, b) => a - b), radii)       // destructivo < severo < moderado < leve
})

test('MMI de Wald et al. (1999) continua: corte donde se cruzan las dos rectas (~66 gal, MMI V)', () => {
  const x = 2.66 / 1.46                                   // 2.20·x + 1.00 = 3.66·x − 1.66
  close(MMI_BREAKPOINT_GAL, 10 ** x, 1e-9)
  assert.ok(Math.abs(MMI_BREAKPOINT_GAL - 66.4) < 0.1)
  const g = MMI_BREAKPOINT_GAL / 980.665
  assert.ok(Math.abs(pgaToMmi(g * 0.9999) - pgaToMmi(g * 1.0001)) < 0.01)   // sin salto
  close(pgaToMmi(0.12), 3.66 * Math.log10(0.12 * 980.665) - 1.66, 1e-12)
  close(pgaToMmi(0.03), 2.2 * Math.log10(0.03 * 980.665) + 1.0, 1e-12)
  // Umbrales de los anillos coherentes con la tabla 1: II–III, IV–V, VI–VII, VIII+
  assert.ok(pgaToMmi(0.005) >= 2 && pgaToMmi(0.005) < 3.5)
  assert.ok(pgaToMmi(0.03) >= 3.5 && pgaToMmi(0.03) < 5.5)
  assert.ok(pgaToMmi(0.12) >= 5.5 && pgaToMmi(0.12) < 7.5)
  assert.ok(pgaToMmi(0.34) >= 7.5)
  let prev = 0
  for (let gal = 0.5; gal < 2000; gal *= 1.1) { const m = pgaToMmi(gal / 980.665); assert.ok(m >= prev); prev = m }
})


test('integral exponencial E1 (valores de tabla)', () => {
  close(exponentialIntegralE1(0.1), 1.8229239584, 1e-9)
  close(exponentialIntegralE1(0.5), 0.5597735948, 1e-9)
  close(exponentialIntegralE1(1), 0.2193839344, 1e-9)
  close(exponentialIntegralE1(2), 0.0489005107, 1e-9)
  close(exponentialIntegralE1(5), 0.0011482956, 1e-9)
})

test('un modelo publicado por mecanismo; cortical provisional', () => {
  assert.deepEqual(GMPE_BY_MECHANISM, { subduction: 'arroyo2010', intraplate: 'garcia2005', crustal: 'manual-crustal' })
  assert.deepEqual(MANUAL_CRUSTAL_COEFFICIENTS, { c1: -1.95, c2: 0.88, c3: 1.05, c4: 0.0028 })
  close(GMPE_SIGMA_LN.arroyo2010, 0.75, 1e-12)
  close(GMPE_SIGMA_LN.garcia2005, 0.28 * Math.LN10, 1e-12)
  assert.equal(GMPE_SIGMA_LN['manual-crustal'], null)
})

test('Arroyo et al. (2010), ec. 8a con la fila PGA de la tabla 2', () => {
  const [a1, a2, a3, a4] = [2.4862, 0.9392, 0.5061, 0.0150]
  const M = 7.3, R = 60
  const r02 = 1.4447e-5 * Math.exp(2.3026 * M)
  const term = (exponentialIntegralE1(a4 * R) - exponentialIntegralE1(a4 * Math.sqrt(R * R + r02))) / r02
  close(pgaRockArroyo2010_cgs(M, R), Math.exp(a1 + a2 * M + a3 * Math.log(term)), 1e-9)
  // Figura 9a del artículo: Mw 8.0 a ~20 km ≈ 380–390 cm/s²
  const near = pgaRockArroyo2010_cgs(8.0, 20.8)
  assert.ok(near > 340 && near < 430, `${near}`)
})

test('García et al. (2005), ec. 2: log PGA = −0.2 + 0.59·Mw − 0.0039·R − log R + 0.008·H', () => {
  const M = 7.0, Rcld = 120, H = 60
  const delta = 0.0075 * 10 ** (0.507 * M)
  const R = Math.sqrt(Rcld * Rcld + delta * delta)
  close(pgaRockGarcia2005_cgs(M, Rcld, H), 10 ** (-0.2 + 0.59 * M - 0.0039 * R - Math.log10(R) + 0.008 * H), 1e-9)
})

test('computePga_g usa el modelo del mecanismo, en roca, más el efecto de sitio', () => {
  // Subducción: R hipocentral; resultado en g
  const R = Math.hypot(100, 20)
  close(computePga_g(100, 7.5, 20, 'subduction', 'rock'), pgaRockArroyo2010_cgs(7.5, R) / 980.665, 1e-12)
  close(computePga_g(100, 7.5, 20, 'subduction', 'rock', 200),
    pgaRockArroyo2010_cgs(7.5, R) / 980.665 * Math.exp(siteAmplification(200)), 1e-12)
  // Intraplaca: R hipocentral como distancia a la falla, H = profundidad
  close(computePga_g(80, 7.1, 57, 'intraplate', 'rock'), pgaRockGarcia2005_cgs(7.1, Math.hypot(80, 57), 57) / 980.665, 1e-12)
  // Cortical provisional: coeficientes del manual con saturación de Yenier y Atkinson
  const { c1, c2, c3, c4 } = MANUAL_CRUSTAL_COEFFICIENTS
  const Reff = Math.sqrt(150 ** 2 + 10 ** 2 + nearSourceSaturationKm(7) ** 2)
  close(computePga_g(150, 7, 10, 'crustal', 'intermediate'),
    Math.exp(c1 + c2 * 7 - c3 * Math.log(Reff) - c4 * Reff + siteAmplification(450)), 1e-12)
})

test('valores epicentrales razonables con los modelos publicados (sin llegar al tope de 2.5 g)', () => {
  const p1985 = computePga_g(0, 8.1, 15, 'subduction', 'rock')
  const pPuebla = computePga_g(0, 7.1, 57, 'intraplate', 'rock')
  assert.ok(p1985 > 0.3 && p1985 < 0.7, `${p1985}`)
  assert.ok(pPuebla > 0.15 && pPuebla < 0.4, `${pPuebla}`)
})

test('la PGA decrece con la distancia en los tres mecanismos (la bisección lo necesita)', () => {
  for (const [mech, h] of [['subduction', 15], ['intraplate', 57], ['crustal', 10]]) {
    let prev = Infinity
    for (let d = 0; d <= 1500; d += 5) {
      const v = computePga_g(d, 8.1, h, mech, 'soft_lacustrine')
      assert.ok(v <= prev, `${mech} ${d}`)
      prev = v
    }
  }
})

test('avisos de validez fuera del rango de cada artículo', () => {
  assert.ok(gmpeValidityWarnings('subduction', 7.5, 20, 100).every((w) => w.includes('antearco')))   // solo el alcance
  assert.ok(gmpeValidityWarnings('subduction', 8.5, 20, 100).some((w) => w.includes('Mw')))
  assert.ok(gmpeValidityWarnings('subduction', 7, 20, 500).some((w) => w.includes('400')))
  assert.ok(gmpeValidityWarnings('intraplate', 8.2, 45, 100).some((w) => w.includes('7.4')))
  assert.ok(gmpeValidityWarnings('intraplate', 7, 20, 100).some((w) => w.includes('35')))
  assert.ok(gmpeValidityWarnings('crustal', 7, 10, 50).some((w) => w.includes('provisional')))
})
