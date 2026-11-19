import { DEPTH_CLASSES } from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation'

/** Map legend for the DG2 depth preview: one swatch per depth class of the PNG palette. */
export function FloodDepthLegend() {
  const { t } = useTranslation()
  return (
    <div className="ws-flood-legend" role="note" aria-label={t('Leyenda de profundidad', 'Depth legend')}>
      <strong>{t('Profundidad (m)', 'Depth (m)')}</strong>
      <ul>
        {DEPTH_CLASSES.map(({ min, max, rgb }) => (
          <li key={min}>
            <span className="ws-flood-legend__swatch" style={{ background: `rgb(${rgb.join(',')})` }} />
            {max == null ? `≥ ${min}` : `${min} – ${max}`}
          </li>
        ))}
      </ul>
      <small>{t('Menos de 0.03 m: transparente', 'Below 0.03 m: transparent')}</small>
    </div>
  )
}
