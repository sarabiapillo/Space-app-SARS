/**
 * Comparación con un acelerograma real cargado por el usuario (texto/CSV). El archivo se lee solo
 * en el navegador: no se sube a ningún servidor. El usuario confirma componente, dt y unidades.
 * La comparación es de referencia: el sintético es un modelo analítico ilustrativo.
 */
import { useMemo, useState } from 'react'
import { parseAccelerogram, toAccelG, type AccelUnit, type ParsedAccelerogram } from '../utils/accelerogram'
import { demean, dominantFrequencyHz, peakAbs, significantDurationSec } from '../utils/signal'
import type { SeismogramSignal } from '../utils/seismic'
import { SeismogramSpectrogram } from './SeismogramSpectrogram'
import { useTranslation } from '../i18n/useTranslation'

interface Props {
  synthetic: SeismogramSignal
}

export function RealRecordCompare({ synthetic }: Props) {
  const { t } = useTranslation()
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedAccelerogram | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [column, setColumn] = useState(0)
  const [dtText, setDtText] = useState('')
  const [unit, setUnit] = useState<AccelUnit>('gal')

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const p = parseAccelerogram(await file.text())
      setParsed(p)
      setFileName(file.name)
      setColumn(p.timeColumn === 0 ? 1 : 0)
      setDtText(p.dtSec ? String(p.dtSec) : '')
    } catch (e) {
      setParsed(null)
      setFileName(file.name)
      setError(e instanceof Error ? e.message : t('No se pudo leer el archivo.', 'Could not read the file.'))
    }
  }

  const dt = Number(dtText)
  const real = useMemo(() => {
    if (!parsed || !(dt > 0 && dt < 1) || !parsed.columns[column]) return null
    const accel = demean(toAccelG(parsed.columns[column], unit))
    const fs = 1 / dt
    return {
      accel, fs,
      startSec: parsed.timeColumn !== null ? parsed.columns[parsed.timeColumn][0] : 0,
      pga: peakAbs(accel),
      fDom: dominantFrequencyHz(accel, fs),
      d595: significantDurationSec(accel, fs),
    }
  }, [parsed, column, dt, unit])

  const model = useMemo(() => {
    const strong = synthetic.accel_g.slice(Math.ceil(synthetic.tS_sec * synthetic.sampleRateHz))
    return {
      pga: synthetic.peakPga_g,
      fDom: dominantFrequencyHz(strong, synthetic.sampleRateHz),
      d595: significantDurationSec(synthetic.accel_g, synthetic.sampleRateHz),
    }
  }, [synthetic])

  return (
    <div className="real-record">
      <div className="real-record__head">
        <strong>{t('Comparar con un registro real', 'Compare with a real record')}</strong>
        <label className="real-record__file">
          <input type="file" accept=".txt,.csv,.dat,.asc,.acc,text/plain,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          <span>{fileName ?? t('Cargar acelerograma (TXT/CSV)…', 'Load accelerogram (TXT/CSV)…')}</span>
        </label>
      </div>
      <p className="real-record__hint">
        {t('Columnas numéricas (con o sin columna de tiempo). El archivo se lee solo en tu navegador. Ajusta escenario y distancia de la estación a los del sismo real para que la comparación tenga sentido.',
          'Numeric columns (with or without a time column). The file is read only in your browser. Match the scenario and station distance to the real event for a meaningful comparison.')}
      </p>
      {error && <p className="real-record__error" role="alert">{error}</p>}

      {parsed && (
        <>
          {parsed.headerLines.length > 0 && (
            <details className="real-record__header">
              <summary>{t('Encabezado del archivo', 'File header')} ({parsed.headerLines.length})</summary>
              <pre>{parsed.headerLines.slice(0, 40).join('\n')}</pre>
            </details>
          )}
          <div className="real-record__controls">
            <label>
              {t('Componente', 'Component')}
              <select value={column} onChange={(e) => setColumn(Number(e.target.value))}>
                {parsed.columns.map((_, c) => c === parsed.timeColumn ? null : (
                  <option key={c} value={c}>{t('Columna', 'Column')} {c + 1}</option>
                ))}
              </select>
            </label>
            <label>
              dt [s]
              <input type="number" step="any" min="0" value={dtText} onChange={(e) => setDtText(e.target.value)}
                placeholder="0.01" disabled={parsed.timeColumn !== null} />
            </label>
            <label>
              {t('Unidades', 'Units')}
              <select value={unit} onChange={(e) => setUnit(e.target.value as AccelUnit)}>
                <option value="gal">gal (cm/s²)</option>
                <option value="g">g</option>
                <option value="ms2">m/s²</option>
              </select>
            </label>
            <span className="real-record__meta">
              {parsed.columns[0].length} {t('muestras', 'samples')}
              {real ? ` · ${real.fs.toFixed(0)} Hz · ${((parsed.columns[0].length - 1) / real.fs).toFixed(1)} s` : ''}
            </span>
          </div>
          {!real && <p className="real-record__error">{t('Indica el intervalo de muestreo dt (entre 0 y 1 s).', 'Enter the sampling interval dt (between 0 and 1 s).')}</p>}
        </>
      )}

      {real && (
        <>
          <SeismogramSpectrogram accel_g={real.accel} sampleRateHz={real.fs} startSec={real.startSec} color="#0f766e"
            maxFreqHz={Math.min(25, real.fs / 2)}
            ariaLabel={t('Registro real: aceleración y espectrograma', 'Real record: acceleration and spectrogram')} />
          <table className="real-record__table">
            <thead>
              <tr><th></th><th>{t('Modelo', 'Model')}</th><th>{t('Registro', 'Record')}</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>PGA</td>
                <td>{model.pga.toFixed(3)} g ({(model.pga * 980.665).toFixed(1)} gal)</td>
                <td>{real.pga.toFixed(3)} g ({(real.pga * 980.665).toFixed(1)} gal)</td>
              </tr>
              <tr>
                <td title={t('Máximo del espectro de amplitud (en el modelo, desde el arribo S)', 'Amplitude spectrum peak (model: from S arrival)')}>{t('Frecuencia dominante', 'Dominant frequency')}</td>
                <td>{model.fDom.toFixed(2)} Hz</td>
                <td>{real.fDom.toFixed(2)} Hz</td>
              </tr>
              <tr>
                <td title={t('Tiempo entre el 5 % y el 95 % de la intensidad de Arias', 'Time between 5 % and 95 % of Arias intensity')}>{t('Duración D5–95', 'Duration D5–95')}</td>
                <td>{model.d595.toFixed(1)} s</td>
                <td>{real.d595.toFixed(1)} s</td>
              </tr>
            </tbody>
          </table>
          <p className="real-record__hint">
            {t('Al registro se le quita la media (línea base); no se filtra. El tiempo del registro es el de su archivo, no el del origen del sismo.',
              'The record mean (baseline) is removed; no filtering. Record time is as in its file, not the earthquake origin time.')}
          </p>
        </>
      )}
    </div>
  )
}
