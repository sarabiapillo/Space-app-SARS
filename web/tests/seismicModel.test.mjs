// Modelo sísmico según docs/sismo.pdf (docs/latex/ecuaciones_sismo.tex).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GMPE_COEFFICIENTS,
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

test('coeficientes GMPE por mecanismo (§5.1)', () => {
  assert.deepEqual(GMPE_COEFFICIENTS.subduction, { c1: -1.85, c2: 0.92, c3: 1.15, c4: 0.0032 })
  assert.deepEqual(GMPE_COEFFICIENTS.intraplate, { c1: -1.55, c2: 0.96, c3: 1.25, c4: 0.0040 })
  assert.deepEqual(GMPE_COEFFICIENTS.crustal, { c1: -1.95, c2: 0.88, c3: 1.05, c4: 0.0028 })
})

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

test('ln(PGA) = c1 + c2·Mw − c3·ln R_ef − c4·R_ef + S (ec. 11 con saturación), por mecanismo', () => {
  for (const mech of ['subduction', 'intraplate', 'crustal']) {
    const { c1, c2, c3, c4 } = GMPE_COEFFICIENTS[mech]
    const R = Math.sqrt(150 ** 2 + 20 ** 2 + nearSourceSaturationKm(7.0) ** 2)
    const expected = Math.exp(c1 + c2 * 7.0 - c3 * Math.log(R) - c4 * R + siteAmplification(450))
    close(computePga_g(150, 7.0, 20, mech, 'intermediate'), expected, 1e-12)
  }
  // Vs30 explícito manda sobre la clase de suelo
  const R = Math.sqrt(100 ** 2 + 10 ** 2 + nearSourceSaturationKm(7) ** 2)
  close(computePga_g(100, 7, 10, 'subduction', 'rock', 200),
    Math.exp(-1.85 + 0.92 * 7 - 1.15 * Math.log(R) - 0.0032 * R + siteAmplification(200)), 1e-12)
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

test('saturación de campo cercano: R_ef = √(D² + h² + h_sat(M)²), h_sat = 10^(−0.405+0.235·M)', () => {
  close(nearSourceSaturationKm(7), 10 ** (-0.405 + 0.235 * 7), 1e-12)
  const { c1, c2, c3, c4 } = GMPE_COEFFICIENTS.subduction
  const Reff = Math.sqrt(0 + 15 * 15 + nearSourceSaturationKm(6) ** 2)
  close(computePga_g(0, 6, 15, 'subduction', 'rock'), Math.exp(c1 + c2 * 6 - c3 * Math.log(Reff) - c4 * Reff), 1e-12)
  // Lejos de la fuente el término casi no cambia el resultado (< 3 % a 300 km)
  const far = computePga_g(300, 8.1, 15, 'subduction', 'rock')
  const R = Math.hypot(300, 15)
  const noSat = Math.exp(c1 + c2 * 8.1 - c3 * Math.log(R) - c4 * R)
  assert.ok(Math.abs(far / noSat - 1) < 0.03, `${far / noSat}`)
  // Decrece con la distancia (la bisección de radios lo necesita)
  let prev = Infinity
  for (let d = 0; d <= 1500; d += 5) { const v = computePga_g(d, 8.1, 15, 'subduction', 'soft_lacustrine'); assert.ok(v <= prev); prev = v }
})
