import { useTranslation } from '../../i18n/useTranslation'

/**
 * Placeholder limpio del módulo Exportación (`docs/plan-de-trabajo.md` §2 y §6).
 * Reservado para edición exclusiva del Rol P6 en su rama (`p6/...`).
 */
export function ExportacionFeature() {
  const { t } = useTranslation()
  return (
    <section aria-label={t('Exportación Reproducible (Placeholder P6)', 'Reproducible Export (P6 placeholder)')}>
      <h3>{t('Exportación Reproducible', 'Reproducible Export')}</h3>
      <p>
        {t('Módulo reservado para el Rol P6 (descarga de GeoTIFF COG, figura PNG y reporte trazable vía', 'Module reserved for Role P6 (download of GeoTIFF COG, PNG figure and traceable report via')}{' '}
        <code>/api/changes/&#123;id&#125;/report</code>).
      </p>
    </section>
  )
}

export default ExportacionFeature
