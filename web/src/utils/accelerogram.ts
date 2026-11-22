/**
 * Lectura de acelerogramas reales en texto (CSV, TXT o ASCII por columnas) para compararlos con el
 * sismograma sintético. Formatos admitidos:
 *  - una o varias columnas numéricas separadas por coma, punto y coma, tabulador o espacios;
 *  - líneas de encabezado no numéricas al inicio (se conservan para mostrarlas);
 *  - si una columna es estrictamente creciente con paso constante, se toma como tiempo y define dt;
 *  - si no, se busca en el encabezado un intervalo de muestreo ("muestreo", "sampling", "dt", "delta").
 * El usuario confirma dt, columna y unidades: este módulo no adivina unidades.
 */

export type AccelUnit = 'gal' | 'g' | 'ms2'

export interface ParsedAccelerogram {
  headerLines: string[]
  /** columns[c][i]: valor i de la columna c. */
  columns: number[][]
  timeColumn: number | null
  dtSec: number | null
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

function splitRow(line: string): string[] {
  return line.trim().split(/[,;\t ]+/).filter(Boolean)
}

function isTimeColumn(values: number[]): number | null {
  if (values.length < 3) return null
  const step = values[1] - values[0]
  if (!(step > 0)) return null
  for (let i = 2; i < values.length; i++) {
    if (Math.abs(values[i] - values[i - 1] - step) > Math.max(1e-9, step * 1e-3)) return null
  }
  return Math.round(step * 1e9) / 1e9
}

function dtFromHeader(lines: string[]): number | null {
  for (const line of lines) {
    const key = line.search(/muestreo|sampling|sample interval|\bdt\b|\bdelta\b/i)
    if (key < 0) continue
    // Último decimal tras la palabra clave (evita tomar el "1" de "C1-C6").
    const decimals = line.slice(key).match(/\d*\.\d+/g)
    const v = decimals ? Number(decimals[decimals.length - 1]) : NaN
    if (v > 0 && v < 1) return v
  }
  return null
}

export function parseAccelerogram(text: string): ParsedAccelerogram {
  const headerLines: string[] = []
  const rows: number[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const cells = splitRow(line)
    if (cells.length && cells.every((c) => NUMBER.test(c))) {
      rows.push(cells.map(Number))
    } else if (rows.length === 0) {
      headerLines.push(line)
    }
  }
  if (rows.length < 3) throw new Error('El archivo no tiene suficientes datos numéricos (mínimo 3 filas).')
  // Columnas presentes en la mayoría de las filas; las filas con menos columnas se descartan.
  const width = Math.max(...rows.map((r) => r.length))
  const full = rows.filter((r) => r.length === width)
  const columns = Array.from({ length: width }, (_, c) => full.map((r) => r[c]))
  let timeColumn: number | null = null
  let dtSec: number | null = null
  if (width > 1) {
    const dt = isTimeColumn(columns[0])
    if (dt !== null) { timeColumn = 0; dtSec = dt }
  }
  if (dtSec === null) dtSec = dtFromHeader(headerLines)
  return { headerLines, columns, timeColumn, dtSec }
}

export function toAccelG(values: ArrayLike<number>, unit: AccelUnit): Float64Array {
  const g = unit === 'gal' ? 980.665 : unit === 'ms2' ? 9.80665 : 1
  return Float64Array.from({ length: values.length }, (_, i) => values[i] / g)
}
