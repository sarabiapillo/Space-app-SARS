import type { FloodRoiResult } from '../../api/client'
import { simulatedTimeLabel, WATER_BUDGET_COLORS as BUDGET_COLORS, waterBudgetView } from '../../utils/floodDg2'
import { useTranslation } from '../../i18n/useTranslation'

interface Props {
  result: Pick<FloodRoiResult, 'water_budget'>
}

/** Where the rain went: one stacked bar (infiltrated, sheets, ponded, left the domain) and the same numbers in words. */
export function FloodWaterBudget({ result }: Props) {
  const { t, locale } = useTranslation()
  const budget = result.water_budget
  const view = waterBudgetView(budget)
  if (!budget || !view) return null
  const m3 = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 ? 1 : 0 })} m³`
  const pct = (v: number) => `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 ? 1 : 0 })} %`
  const share = (v: number) => budget.gross_rain_m3 > 0 ? pct(v * 100 / budget.gross_rain_m3) : '—'
  const names: Record<string, string> = {
    infiltrated: t('Infiltrada o retenida', 'Infiltrated or retained'),
    sheet: t('Láminas < 3 cm (laderas)', 'Sheets < 3 cm (slopes)'),
    ponded: t('Encharcada ≥ 3 cm', 'Ponded ≥ 3 cm'),
    final: t('En el dominio al final', 'In the domain at the end'),
    left: t('Salió por las fronteras', 'Left through the boundaries'),
  }
  const at = simulatedTimeLabel(budget.last_frame_time_s)
  const losses = budget.gross_source === 'curve_number'
    ? t(`${m3(budget.infiltrated_m3)} (${share(budget.infiltrated_m3)}) se infiltraron o quedaron retenidos en el suelo y la vegetación antes de escurrir (número de curva)`,
      `${m3(budget.infiltrated_m3)} (${share(budget.infiltrated_m3)}) infiltrated or were retained by soil and vegetation before running off (Curve Number)`)
    : budget.gross_source === 'runoff_coefficient'
      ? t(`${m3(budget.infiltrated_m3)} (${share(budget.infiltrated_m3)}) se descontaron como infiltrados con el coeficiente de escorrentía`,
        `${m3(budget.infiltrated_m3)} (${share(budget.infiltrated_m3)}) were removed as infiltrated by the runoff coefficient`)
      : t('sin pérdidas modeladas: toda la lluvia escurre', 'no losses modelled: all the rain runs off')
  const end = view.split
    ? t(`al final (${at}) quedan ${m3(budget.final_water_m3)} en el dominio: ${m3(budget.sheet_m3)} como láminas de menos de 3 cm sobre las laderas y ${m3(budget.ponded_m3)} encharcados (3 cm o más)`,
      `at the end (${at}) ${m3(budget.final_water_m3)} remain in the domain: ${m3(budget.sheet_m3)} as sheets thinner than 3 cm on the slopes and ${m3(budget.ponded_m3)} ponded (3 cm or more)`)
    : t(`al final quedan ${m3(budget.final_water_m3)} en el dominio`, `at the end ${m3(budget.final_water_m3)} remain in the domain`)
  const inflow = (budget.boundary_inflow_m3 ?? 0) > 0 || (budget.initial_water_m3 ?? 0) > 0
  return (
    <figure className="ws-flood-budget" aria-label={t('Balance del agua de la corrida', 'Water budget of the run')}>
      <figcaption>{t('¿A dónde fue la lluvia?', 'Where did the rain go?')}</figcaption>
      <div className="ws-flood-budget__bar" role="img" aria-label={view.parts.map(p => `${names[p.key]} ${pct(p.pct)}`).join(', ')}>
        {view.parts.filter(p => p.pct > 0).map(p => (
          <span key={p.key} className="ws-flood-budget__part" style={{ width: `${p.pct}%`, background: BUDGET_COLORS[p.key] }} title={`${names[p.key]}: ${m3(p.m3)}`} />
        ))}
      </div>
      <ul className="ws-flood-budget__legend">
        {view.parts.map(p => (
          <li key={p.key}><span className="ws-flood-budget__swatch" style={{ background: BUDGET_COLORS[p.key] }} aria-hidden="true" />
            <span>{names[p.key]}</span><strong>{m3(p.m3)}</strong><small>{pct(p.pct)}</small></li>
        ))}
      </ul>
      <p className="ws-rain-help">{t(
        `De ${m3(budget.gross_rain_m3)} de lluvia bruta, ${losses}. Los ${m3(budget.net_rain_m3)} de lluvia neta escurrieron sobre el terreno; ${end}; ${m3(budget.boundary_outflow_m3)} salieron por las fronteras.`,
        `Of ${m3(budget.gross_rain_m3)} of gross rain, ${losses}. The ${m3(budget.net_rain_m3)} of net rain ran off over the terrain; ${end}; ${m3(budget.boundary_outflow_m3)} left through the boundaries.`)}</p>
      <small className="ws-rain-field__hint">{t(
        'Una lámina de 5 mm sobre una hectárea son solo 50 m³: el agua repartida en láminas cubre mucha área con poco volumen y casi no se ve en el mapa del máximo; el agua encharcada concentra el volumen en pocas celdas. Balance del solver (lluvia, volumen final) y profundidades del último cuadro; no validado con observaciones.',
        'A 5 mm sheet over one hectare is only 50 m³: water spread in sheets covers a large area with little volume and hardly shows on the maximum map; ponded water concentrates the volume in few cells. Solver balance (rain, final volume) and last-frame depths; not validated against observations.')}
        {inflow && t(' Incluye agua inicial (mar o lagos llenos al inicio) o que entró por fronteras de mar.', ' Includes initial water (sea or lakes full at the start) or water that entered through sea boundaries.')}</small>
    </figure>
  )
}
