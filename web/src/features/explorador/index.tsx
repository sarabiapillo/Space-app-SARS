import {
  C1_RAW_LAYERS,
  PILAS_GCOV_CHIAPAS,
  type GcovStackSpec,
} from '../../mocks/initialWorkspaces'

export interface ExploradorStackCardProps {
  activeStackId: GcovStackSpec['id']
  onSelectStack?: (stack: GcovStackSpec) => void
}

/**
 * Módulo Explorador (Rol P5 — `docs/plan-de-trabajo.md` §6 y `data/raw/<scene_id>/scene.json`):
 * Muestra las pilas GCOV reales sobre la ROI de Chiapas (`EPSG:32615`, `10 × 10 m`)
 * y las 5 capas extraídas de `Frequency A` en el Contrato C1.
 */
export function ExploradorFeature({ activeStackId, onSelectStack }: ExploradorStackCardProps) {
  return (
    <section className="c4-module" aria-label="Explorador de Pilas GCOV y Capas C1 en Chiapas">
      <div className="c4-module__header">
        <span className="c4-module__title">Pilas NISAR L2 GCOV · ROI Chiapas</span>
        <span className="c4-module__tag">EPSG:32615 · 10×10 m</span>
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
                  <strong>
                    {stack.id} · {stack.directionLabel}
                  </strong>
                  <span className="c4-stack-item__crid">CRID {stack.crid}</span>
                </div>
                <div className="c4-stack-item__role">{stack.roleLabel}</div>
                <div className="c4-stack-item__sub">
                  Cobertura ROI: <strong>{stack.roiValidPctLabel}</strong> · {stack.dates.length}{' '}
                  fechas ({stack.defaultT1} → {stack.defaultT2})
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="c1-layers-box" aria-label="Capas extraídas en Contrato C1 (Frequency A)">
        <div className="c1-layers-box__title">
          Capas Contrato C1 en <code>data/raw/</code> (Frequency A · 2687×5504 px)
        </div>
        <ul className="c1-layers-list">
          {C1_RAW_LAYERS.map((layer) => (
            <li key={layer.id} className="c1-layers-item" title={layer.h5Path}>
              <code>{layer.archivo}</code>
              <span>{layer.descripcion}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default ExploradorFeature
