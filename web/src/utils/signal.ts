/**
 * Procesamiento de series de aceleración para el simulador sísmico: FFT, espectrograma (STFT con
 * ventana de Hann), frecuencia dominante y duración significativa D5–95 (intensidad de Arias).
 * Sin dependencias, para poder probarlo con `node --test`.
 */

type Num = ArrayLike<number>

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** FFT radix-2 in situ (re, im de longitud potencia de 2). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

function hann(n: number): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => (n === 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))))
}

export interface Spectrogram {
  /** Centro de cada ventana (s, desde la primera muestra). */
  times: number[]
  freqs: number[]
  frames: number
  bins: number
  nfft: number
  /** Potencia en dB, fila por ventana: powerDb[frame * bins + bin]. */
  powerDb: Float32Array
  maxDb: number
}

/**
 * STFT con ventana de Hann de ~4 s (potencia de 2 en muestras) y 87.5 % de traslape. A 50 Hz:
 * 256 muestras = 5.12 s, resolución 0.195 Hz, paso 0.64 s. Suficiente para separar la resonancia
 * de cuenca (~0.5 Hz) de la onda P (3–5 Hz).
 */
export function computeSpectrogram(signal: Num, sampleRateHz: number, windowSec = 4): Spectrogram {
  const nfft = Math.max(16, nextPow2(Math.round(windowSec * sampleRateHz)))
  const hop = Math.max(1, nfft / 8)
  const win = hann(nfft)
  const bins = nfft / 2 + 1
  const frames = signal.length <= nfft ? 1 : 1 + Math.floor((signal.length - nfft) / hop)
  const powerDb = new Float32Array(frames * bins)
  const re = new Float64Array(nfft), im = new Float64Array(nfft)
  let maxDb = -Infinity
  for (let f = 0; f < frames; f++) {
    const start = f * hop
    for (let i = 0; i < nfft; i++) {
      const k = start + i
      re[i] = k < signal.length ? signal[k] * win[i] : 0
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < bins; k++) {
      const db = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20)
      powerDb[f * bins + k] = db
      if (db > maxDb) maxDb = db
    }
  }
  return {
    times: Array.from({ length: frames }, (_, f) => (f * hop + nfft / 2) / sampleRateHz),
    freqs: Array.from({ length: bins }, (_, k) => (k * sampleRateHz) / nfft),
    frames, bins, nfft, powerDb, maxDb,
  }
}

/** Frecuencia del máximo del espectro de amplitud (Hann, con ceros hasta ≥ 8× la longitud). */
export function dominantFrequencyHz(signal: Num, sampleRateHz: number): number {
  const n = signal.length
  if (n < 2) return 0
  const nfft = nextPow2(Math.max(n * 8, 1024))
  const win = hann(n)
  let mean = 0
  for (let i = 0; i < n; i++) mean += signal[i]
  mean /= n
  const re = new Float64Array(nfft), im = new Float64Array(nfft)
  for (let i = 0; i < n; i++) re[i] = (signal[i] - mean) * win[i]
  fft(re, im)
  let best = 1, bestP = -1
  for (let k = 1; k <= nfft / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k]
    if (p > bestP) { bestP = p; best = k }
  }
  return (best * sampleRateHz) / nfft
}

export function peakAbs(signal: Num): number {
  let m = 0
  for (let i = 0; i < signal.length; i++) m = Math.max(m, Math.abs(signal[i]))
  return m
}

export function demean(signal: Num): Float64Array {
  let mean = 0
  for (let i = 0; i < signal.length; i++) mean += signal[i]
  mean /= signal.length || 1
  return Float64Array.from({ length: signal.length }, (_, i) => signal[i] - mean)
}

/** Duración significativa D5–95: tiempo entre el 5 % y el 95 % de ∫a² dt (intensidad de Arias). */
export function significantDurationSec(signal: Num, sampleRateHz: number): number {
  let total = 0
  for (let i = 0; i < signal.length; i++) total += signal[i] * signal[i]
  if (total <= 0) return 0
  let acc = 0, i5 = -1, i95 = -1
  for (let i = 0; i < signal.length; i++) {
    acc += signal[i] * signal[i]
    if (i5 < 0 && acc >= 0.05 * total) i5 = i
    if (acc >= 0.95 * total) { i95 = i; break }
  }
  return (i95 - i5) / sampleRateHz
}
