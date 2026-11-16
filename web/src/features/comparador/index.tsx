import {
  CRID_TRANSITION_DATE,
  PILAS_GCOV_CHIAPAS,
  checkPairCompat,
  type GcovStackSpec,
} from '../../mocks/initialWorkspaces'
import { useTranslation } from '../../i18n/useTranslation'

export interface ComparadorFeatureProps {
  stackId: GcovStackSpec['id']
  t1: string
  t2: string
  onChangePair: (nextT1: string, nextT2: string) => void
}

/**
 * Módulo Comparador Temporal (Rol P5 — `docs/plan-de-trabajo.md` §5, §6 y `data/raw/<scene_id>/scene.json`):
 * Selector de fechas `t1` y `t2` y validador visual `checkPairCompat(t1, t2)` con bloqueo por
 * cambio de procesador (`CRID P05023 ≠ P05036`) y diferencia de madurez (`PROVISIONAL ≠ VALIDATED`).
 */
export function ComparadorFeature({ stackId, t1, t2, onChangePair }: ComparadorFeatureProps) {
  const { t, localizeText } = useTranslation()
  const stack = PILAS_GCOV_CHIAPAS.find((s) => s.id === stackId) ?? PILAS_GCOV_CHIAPAS[0]
  const availableDates = [...stack.dates, stack.postTransitionDate]
  const compat = checkPairCompat(t1, t2, stack.id)

  return (
    <section className="c4-module" aria-label={t('Validador de Comparabilidad Temporal C1/C4', 'Temporal comparability checker C1/C4')}>
      <div className="c4-module__header">
        <span className="c4-module__title">{t('Comparabilidad', 'Comparability')} ({stack.id})</span>
        <span
          className={`c4-compat-pill ${
            compat.comparable ? 'c4-compat-pill--ok' : 'c4-compat-pill--blocked'
          }`}
        >
          {compat.comparable ? t('✓ COMPARABLE', '✓ COMPARABLE') : t('⛔ BLOQUEO CRID / MADUREZ', '⛔ CRID / DATA MATURITY MISMATCH')}
        </span>
      </div>

      <div className="c4-pair-selectors">
        <label className="c4-pair-field">
          <span>{t('Fecha t1 (Base)', 'Date t1 (Baseline)')}</span>
          <select
            value={t1}
            onChange={(e) => onChangePair(e.target.value, t2)}
            className="c4-pair-select"
          >
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {d} ({d >= CRID_TRANSITION_DATE ? 'P05036 · VALIDATED' : 'P05023 · PROV'})
              </option>
            ))}
          </select>
        </label>

        <label className="c4-pair-field">
          <span>{t('Fecha t2 (Comparada)', 'Date t2 (Compared)')}</span>
          <select
            value={t2}
            onChange={(e) => onChangePair(t1, e.target.value)}
            className="c4-pair-select"
          >
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {d} ({d >= CRID_TRANSITION_DATE ? 'P05036 · VALIDATED' : 'P05023 · PROV'})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="c4-granules-box" aria-label={t('IDs de gránulos seleccionados', 'Selected granule IDs')}>
        <div className="c4-granules-box__item" title={compat.t1SceneId}>
          <span>t1:</span> <code>{compat.t1SceneId}</code>
        </div>
        <div className="c4-granules-box__item" title={compat.t2SceneId}>
          <span>t2:</span> <code>{compat.t2SceneId}</code>
        </div>
      </div>

      {!compat.comparable && (
        <ul className="c4-compat-messages c4-compat-messages--error" role="alert">
          {compat.errors.map((err, idx) => (
            <li key={idx}>{localizeText(err)}</li>
          ))}
        </ul>
      )}

      {compat.comparable && compat.warnings.length > 0 && (
        <div className="c4-compat-messages c4-compat-messages--warn">
          {localizeText(compat.warnings[0])}
        </div>
      )}
    </section>
  )
}

export default ComparadorFeature
