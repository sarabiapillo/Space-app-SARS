import { PILAS_GCOV_CHIAPAS, type GcovStackSpec } from '../../mocks/initialWorkspaces'

export interface ExploradorStackCardProps {
  activeStackId: GcovStackSpec['id']
  onSelectStack?: (stack: GcovStackSpec) => void
}

/**
 * Módulo Explorador (Rol P5 — `docs/plan-de-trabajo.md` §6):
 * Muestra las 3 pilas GCOV reales comparables sobre la ROI de Chiapas (`EPSG:32615`).
 */
export function ExploradorFeature({ activeStackId, onSelectStack }: ExploradorStackCardProps) {
  return (
    <section className="c4-module" aria-label="Explorador de Pilas GCOV en Chiapas">
      <div className="c4-module__header">
        <span className="c4-module__title">Pilas NISAR L2 GCOV · ROI Chiapas</span>
        <span className="c4-module__tag">EPSG:32615 · 12d</span>
      </div>
      <ul className="c4-stack-list">
        {PILAS_GCOV_CHIAPAS.map((stack) => {
          const isSelected = stack.id === activeStackId
          return (
            <li key={stack.id}>
              <button
                type="button"
                className={`c4-stack-item ${isSelected ? 'is-active' : ''}`}
                onClick={() => onSelectStack?.(stack)}
              >
                <div className="c4-stack-item__top">
                  <strong>{stack.id}</strong>
                  <span>{stack.directionLabel}</span>
                  <span className="c4-stack-item__crid">CRID {stack.crid}</span>
                </div>
                <div className="c4-stack-item__sub">
                  {stack.dates.length} fechas ({stack.defaultT1} → {stack.defaultT2}) ·{' '}
                  {stack.polarizations.join('+')} · {stack.maturity}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default ExploradorFeature
