import { test } from 'node:test'
import assert from 'node:assert/strict'
import { synthesizeSeismogram, computePga_g } from '../src/utils/seismic.ts'
import {
  computeSpectrogram,
  dominantFrequencyHz,
  significantDurationSec,
  peakAbs,
  demean,
} from '../src/utils/signal.ts'
import { parseAccelerogram, toAccelG } from '../src/utils/accelerogram.ts'

const source = (soilType) => ({
  epicenter: [-99.78, 16.78], magnitude: 7.1, depthKm: 10, name: 'prueba',
  mechanism: 'subduction', soilType,
})

const sine = (f, fs, seconds, amp = 1) =>
  Float64Array.from({ length: Math.round(fs * seconds) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / fs))

// --- Señal sintética muestreada sin aliasing ---

test('el sismograma sintético se muestrea a 50 Hz (Nyquist 25 Hz > onda P)', () => {
  const s = synthesizeSeismogram(source('rock'), 120)
  assert.equal(s.sampleRateHz, 50)
  assert.equal(s.dtSec, 0.02)
  assert.equal(s.accel_g.length, Math.round(s.durationSec * 50) + 1)
  assert.ok(s.tS_sec > s.tP_sec && s.durationSec > s.tS_sec)
})

test('antes de la onda P solo hay ruido de fondo; el pico ronda el PGA del modelo', () => {
  const s = synthesizeSeismogram(source('intermediate'), 80)
  const pga = computePga_g(80, 7.1, 10, 'subduction', 'intermediate')
  const before = s.accel_g.slice(0, Math.floor(s.tP_sec * 50) - 1)
  assert.ok(peakAbs(before) < 0.01 * pga)
  const peak = peakAbs(s.accel_g)
  assert.ok(peak <= pga * 1.01 && peak >= pga * 0.75, `pico ${peak} vs PGA ${pga}`)
})

test('la onda P (ec. 16) tiene energía en 0.85·fP y 1.15·fP, no en un solo 4.5 Hz', () => {
  const s = synthesizeSeismogram(source('rock'), 200)
  const i0 = Math.ceil(s.tP_sec * 50), i1 = Math.floor(s.tS_sec * 50)
  const f = dominantFrequencyHz(s.accel_g.slice(i0, i1), 50)
  const near = (x) => Math.abs(f - x) < 0.25
  assert.ok(near(0.85 * 4.5) || near(1.15 * 4.5), `dominante ${f} Hz`)
})

test('en suelo blando lacustre la onda S domina en ~0.52 Hz (resonancia de cuenca)', () => {
  const s = synthesizeSeismogram(source('soft_lacustrine'), 320)
  const f = dominantFrequencyHz(s.accel_g.slice(Math.ceil(s.tS_sec * 50)), 50)
  assert.ok(Math.abs(f - 0.52) < 0.05, `dominante ${f} Hz`)
})

// --- Espectrograma y métricas de señal ---

test('el espectrograma ubica un seno de 5 Hz en su frecuencia', () => {
  const sg = computeSpectrogram(sine(5, 50, 30), 50)
  assert.ok(sg.frames > 10 && sg.bins === sg.nfft / 2 + 1)
  const mid = Math.floor(sg.frames / 2)
  let best = 0
  for (let k = 1; k < sg.bins; k++) if (sg.powerDb[mid * sg.bins + k] > sg.powerDb[mid * sg.bins + best]) best = k
  assert.ok(Math.abs(sg.freqs[best] - 5) <= sg.freqs[1], `pico en ${sg.freqs[best]} Hz`)
  assert.equal(sg.times.length, sg.frames)
  assert.ok(sg.times[0] > 0 && sg.times.at(-1) < 30)
})

test('espectrograma con señal más corta que la ventana: una sola ventana con ceros', () => {
  const sg = computeSpectrogram(sine(2, 50, 1), 50)
  assert.equal(sg.frames, 1)
})

test('frecuencia dominante y pico absoluto', () => {
  assert.ok(Math.abs(dominantFrequencyHz(sine(1.3, 100, 40), 100) - 1.3) < 0.02)
  assert.equal(peakAbs([0.1, -0.4, 0.2]), 0.4)
})

test('duración significativa D5–95 (intensidad de Arias) de un pulso uniforme', () => {
  const fs = 100
  const a = new Float64Array(fs * 30)
  for (let i = fs * 10; i < fs * 20; i++) a[i] = Math.sin(2 * Math.PI * 3 * i / fs)
  assert.ok(Math.abs(significantDurationSec(a, fs) - 9) < 0.15)          // 90 % de 10 s
  assert.equal(significantDurationSec(new Float64Array(10), fs), 0)
})

test('quitar la media (línea base) de un registro', () => {
  assert.deepEqual(Array.from(demean([1, 2, 3])), [-1, 0, 1])
})

// --- Lectura de acelerogramas reales (texto/CSV) ---

test('dos columnas tiempo,aceleración con encabezado: detecta columna de tiempo y dt', () => {
  const r = parseAccelerogram('estacion: XYZ\ntiempo,acc\n0.00,0.5\n0.01,-1.2\n0.02,3.0\n0.03,0.1\n')
  assert.equal(r.columns.length, 2)
  assert.equal(r.timeColumn, 0)
  assert.equal(r.dtSec, 0.01)
  assert.deepEqual(r.headerLines, ['estacion: XYZ', 'tiempo,acc'])
  assert.deepEqual(r.columns[1], [0.5, -1.2, 3.0, 0.1])
})

test('varias componentes sin tiempo: toma dt del encabezado si lo declara', () => {
  const text = 'INTERVALO DE MUESTREO, C1-C6 (S): /0.005\nN00E VERT N90E\n1.0 2.0 3.0\n-1.5 0.2 4.0\n2.5 -0.3 1.0\n'
  const r = parseAccelerogram(text)
  assert.equal(r.timeColumn, null)
  assert.equal(r.columns.length, 3)
  assert.equal(r.dtSec, 0.005)
})

test('separadores punto y coma o tabulador; sin dt declarado queda null', () => {
  assert.deepEqual(parseAccelerogram('1;2\n3;4\n5;7\n').columns, [[1, 3, 5], [2, 4, 7]])
  const r = parseAccelerogram('0.1\t0.2\n-0.3\t0.4\n0.5\t0.1\n')
  assert.equal(r.columns.length, 2)
  assert.equal(r.timeColumn, null)
  assert.equal(r.dtSec, null)
})

test('un archivo sin datos numéricos se rechaza', () => {
  assert.throws(() => parseAccelerogram('hola\nmundo\n'), /datos numéricos/)
})

test('conversión de unidades a g', () => {
  assert.deepEqual(Array.from(toAccelG([980.665], 'gal')), [1])
  assert.deepEqual(Array.from(toAccelG([9.80665], 'ms2')), [1])
  assert.deepEqual(Array.from(toAccelG([0.5], 'g')), [0.5])
})
