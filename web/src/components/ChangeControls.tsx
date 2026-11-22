/**
 * Controles del mapa de cambio de una ROI: resolución (multilook) y umbral en dB fijo.
 * Cada cambio recalcula en el servidor (`POST /api/roi-jobs/{id}/change`) sin volver a ASF.
 * Muestra el ruido medido en esta ROI y avisa si el umbral está cerca de él.
 */
import {
  changeOptions,
  changeResolutionM,
  noiseSummary,
  type ChangeMetrics,
  type RoiChangeManifest,
} from '../utils/changeLayer.ts'
import { useTranslation } from '../i18n/useTranslation.ts'

interface Props {
  change: RoiChangeManifest
  metrics: ChangeMetrics | null
  busy: boolean
  error: string | null
  onRecompute: (multilook: number, umbralDb: number) => void
}

export function ChangeControls({ change, metrics, busy, error, onRecompute }: Props) {
  const { t } = useTranslation()
  const options = changeOptions(change)
  const noise = noiseSummary(metrics)
  const looks = change.multilook ?? null

  return (
    <div className="change-controls" aria-busy={busy}>
      {options && looks !== null && (
        <>
          <label className="change-controls__field">
            <span>{t('Resolución', 'Resolution')}</span>
            <select
              value={looks}
              disabled={busy}
              onChange={(e) => onRecompute(Number(e.target.value), change.umbral_dB)}
              title={t('Multilook: promedia n×n píxeles para reducir el speckle; se pierde detalle fino.',
                'Multilook: averages n×n pixels to reduce speckle; fine detail is lost.')}
            >
              {options.multilook.map((n) => {
                const m = changeResolutionM(change, n)
                return <option key={n} value={n}>{m !== null ? `${m} m (${n}×${n})` : `${n}×${n}`}</option>
              })}
            </select>
          </label>
          <label className="change-controls__field">
            <span>{t('Umbral', 'Threshold')}</span>
            <select
              value={change.umbral_dB}
              disabled={busy}
              onChange={(e) => onRecompute(looks, Number(e.target.value))}
              title={t('Solo decide qué píxeles cuentan en las cifras de km²; el mapa de color no cambia.',
                'Only decides which pixels count in the km² figures; the color map does not change.')}
            >
              {options.umbral_dB.map((v) => <option key={v} value={v}>±{v} dB</option>)}
            </select>
          </label>
        </>
      )}
      {busy && <span className="change-controls__status">{t('Recalculando…', 'Recomputing…')}</span>}
      {error && <span className="change-controls__error" role="alert">{error}</span>}
      {noise && (
        <>
          <span title={t('1.4826 × MAD del Δ en esta ROI. Con el mismo umbral, una ROI más ruidosa marca más falsas alarmas.',
            '1.4826 × MAD of Δ in this ROI. With the same threshold, a noisier ROI flags more false alarms.')}>
            {t('Ruido de la ROI', 'ROI noise')}: ≈{noise.noiseDb.toFixed(2)} dB
            {noise.ratio !== null ? ` · ${t('umbral', 'threshold')} = ${noise.ratio.toFixed(1)}× ${t('ruido', 'noise')}` : ''}
          </span>
          {noise.pctAbsZ3 !== null && (
            <span title={t('Referencia: píxeles que se alejan más de 3 veces el ruido de esta misma ROI.',
              'Reference: pixels more than 3 times this ROI\'s own noise away.')}>
              |z| &gt; 3: {noise.pctAbsZ3.toFixed(1)} %
            </span>
          )}
          {noise.nearNoise && (
            <span className="change-controls__warning" role="note">
              {t('El umbral está cerca del ruido de esta ROI: parte de lo marcado puede ser speckle. Sube la resolución o el umbral.',
                'The threshold is close to this ROI\'s noise: part of what is flagged may be speckle. Increase the resolution or the threshold.')}
            </span>
          )}
        </>
      )}
    </div>
  )
}
