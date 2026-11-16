import { useTranslation } from '../../i18n/useTranslation'

/**
 * Placeholder limpio del módulo Laboratorio Científico (`docs/plan-de-trabajo.md` §2 y §6).
 * Reservado para edición exclusiva del Rol P6 en su rama (`p6/...`).
 */
export function LaboratorioFeature() {
  const { t } = useTranslation()
  return (
    <section aria-label={t('Laboratorio Científico (Placeholder P6)', 'Scientific Laboratory (P6 placeholder)')}>
      <h3>{t('Laboratorio Científico', 'Scientific Laboratory')}</h3>
      <p>
        {t('Módulo reservado para el Rol P6 (histograma de Δσ⁰/Δγ⁰ en dB, estadísticas, máscaras y trazabilidad a', 'Module reserved for Role P6 (Δσ⁰/Δγ⁰ histogram in dB, statistics, masks and traceability to')} <code>run.json</code>).
      </p>
    </section>
  )
}

export default LaboratorioFeature
