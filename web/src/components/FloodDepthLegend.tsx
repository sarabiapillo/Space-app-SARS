import { DEPTH_CLASSES, FLOODED_MIN_DEPTH_M, depthClassColor } from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation'

/** Map legend for the DG2 depth preview: one swatch per depth class of the PNG palette, naming the sheet classes. */
export function FloodDepthLegend() {
  const { t } = useTranslation()
  // Sheets thinner than 3 cm, by their lower bound; deeper classes are ponded water (the flooded area).
  const names: Record<number, string> = {
    .0005: t('superficie mojada', 'wet surface'),
    .002: t('escurrimiento', 'runoff'),
    .01: t('lámina delgada', 'thin sheet'),
  }
  return (
    <div className="ws-flood-legend" role="note" aria-label={t('Leyenda de profundidad', 'Depth legend')}>
      <strong>{t('Profundidad (m)', 'Depth (m)')}</strong>
      <ul>
        {DEPTH_CLASSES.map(({ min, max, rgb, alpha }) => (
          <li key={min}>
            <span className="ws-flood-legend__swatch" style={{ background: depthClassColor({ rgb, alpha }) }} />
            {max == null ? `≥ ${min}` : `${min} – ${max}`}
            {names[min] && <>{' '}<em className="ws-flood-legend__name">{names[min]}</em></>}
            {min === FLOODED_MIN_DEPTH_M && <>{' '}<em className="ws-flood-legend__name">{t('encharcada', 'ponded')}</em></>}
          </li>
        ))}
      </ul>
      <small>{t('Láminas (< 0.03 m) semitransparentes en cian: la superficie mojada muestra dónde llovió y escurre una película de agua. Desde 0.03 m, agua encharcada (área inundada). Menos de 0.0005 m: transparente',
        'Sheets (< 0.03 m) semi-transparent cyan: the wet surface shows where it rained and a film of water runs off. From 0.03 m, ponded water (flooded area). Below 0.0005 m: transparent')}</small>
    </div>
  )
}
