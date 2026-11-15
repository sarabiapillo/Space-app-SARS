import {
  CRID_TRANSITION_DATE,
  PILAS_GCOV_CHIAPAS,
  checkPairCompat,
  type GcovStackSpec,
} from '../../mocks/initialWorkspaces'

export interface ComparadorFeatureProps {
  stackId: GcovStackSpec['id']
  t1: string
  t2: string
  onChangePair: (nextT1: string, nextT2: string) => void
}

/**
 * Módulo Comparador Temporal (Rol P5 — `docs/plan-de-trabajo.md` §1, §5 y §6):
 * Selector de fechas `t1` y `t2` y validador visual `checkPairCompat(t1, t2)` con bloqueo CRID
 * cuando se cruza la fecha `2026-10-23` (`P05023` PROVISIONAL vs `P05036` VALIDATED).
 */
export function ComparadorFeature({ stackId, t1, t2, onChangePair }: ComparadorFeatureProps) {
  const stack = PILAS_GCOV_CHIAPAS.find((s) => s.id === stackId) ?? PILAS_GCOV_CHIAPAS[0]
  const availableDates = [...stack.dates, stack.postTransitionDate]
  const compat = checkPairCompat(t1, t2, stack.id)

  return (
    <section className="c4-module" aria-label="Validador de Comparabilidad Temporal C4">
      <div className="c4-module__header">
        <span className="c4-module__title">Comparabilidad Temporal ({stack.id})</span>
        <span
          className={`c4-compat-pill ${
            compat.comparable ? 'c4-compat-pill--ok' : 'c4-compat-pill--blocked'
          }`}
        >
          {compat.comparable ? '✓ Par comparable' : '⛔ Bloqueo CRID / Par inválido'}
        </span>
      </div>

      <div className="c4-pair-selectors">
        <label className="c4-pair-field">
          <span>Fecha t1 (Base)</span>
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
          <span>Fecha t2 (Comparada)</span>
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

      {!compat.comparable && (
        <ul className="c4-compat-messages c4-compat-messages--error" role="alert">
          {compat.errors.map((err, idx) => (
            <li key={idx}>{err}</li>
          ))}
        </ul>
      )}

      {compat.comparable && compat.warnings.length > 0 && (
        <div className="c4-compat-messages c4-compat-messages--warn">
          <span>
            CRID {compat.cridT1} ({compat.maturityT1}) verificado · Unidad: dB (γ⁰/σ⁰)
          </span>
        </div>
      )}
    </section>
  )
}

export default ComparadorFeature
