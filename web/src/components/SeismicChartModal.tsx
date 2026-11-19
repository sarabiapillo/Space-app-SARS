/**
 * Modal de gráficas sísmicas: la gráfica elegida en grande y, a la izquierda, los parámetros del
 * escenario. Edita el mismo estado que el panel, así que el mapa y el panel se actualizan a la vez.
 * Se cierra con Esc, con clic fuera, o al pedir elegir epicentro/estación en el mapa.
 */
import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { LngLat, SeismicSimulationState } from '../types/workspace'
import { mmiToRoman, type SeismicSimulationResults } from '../utils/seismic'
import { Seismic2DChart, type SeismicChartMode } from './Seismic2DChart'
import { SeismicScenarioControls } from './SeismicScenarioControls'
import { useTranslation } from '../i18n/useTranslation'

interface Props {
  mode: SeismicChartMode
  onModeChange: (mode: SeismicChartMode) => void
  onClose: () => void
  seismic: SeismicSimulationState
  onSeismicChange: (next: SeismicSimulationState) => void
  onFlyToEpicenter?: (coord: LngLat) => void
  results: SeismicSimulationResults
  stationDistanceKm: number
  onStationDistanceChange: (km: number) => void
  gmpeLabel: string
}

export function SeismicChartModal({
  mode, onModeChange, onClose, seismic, onSeismicChange, onFlyToEpicenter, results,
  stationDistanceKm, onStationDistanceChange, gmpeLabel,
}: Props) {
  const { t } = useTranslation()
  const titleId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Elegir epicentro o estación requiere el mapa: se cierra el modal.
  useEffect(() => {
    if (seismic.pickingEpicenter || seismic.pickingStation) onClose()
  }, [seismic.pickingEpicenter, seismic.pickingStation, onClose])

  const sigma = results.gmpeSigmaLn
  return createPortal(
    <div className="seismic-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="seismic-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="seismic-modal__header">
          <div>
            <h2 id={titleId} className="seismic-modal__title">{t('Gráficas del escenario sísmico', 'Seismic scenario charts')}</h2>
            <span className="seismic-modal__sub">{seismic.name}</span>
          </div>
          <button type="button" className="seismic-panel__btn-icon is-close" onClick={onClose} aria-label={t('Cerrar', 'Close')}>
            <X size={16} />
          </button>
        </div>
        <div className="seismic-modal__body">
          <aside className="seismic-modal__params">
            <SeismicScenarioControls
              seismic={seismic}
              onSeismicChange={onSeismicChange}
              onFlyToEpicenter={onFlyToEpicenter}
              idPrefix="seismic-modal"
            />
            <div className="seismic-modal__kpis">
              <span>{t('PGA epicentral', 'Epicentral PGA')}: <strong>{results.epicentralPga_g.toFixed(3)} g</strong>
                {sigma !== null && <> ({(results.epicentralPga_g * Math.exp(-sigma)).toFixed(2)}–{Math.min(2.5, results.epicentralPga_g * Math.exp(sigma)).toFixed(2)} g, 16–84 %)</>}
              </span>
              <span>{t('Intensidad máx.', 'Max intensity')}: <strong>MMI {mmiToRoman(results.epicentralMmi)}</strong> ({results.epicentralMmi.toFixed(1)})</span>
              <span>{t('Atenuación', 'Attenuation')}: {gmpeLabel}</span>
              {results.validityWarnings.map((w) => <span key={w} className="seismic-gmpe-note__warning">⚠ {w}</span>)}
            </div>
          </aside>
          <section className="seismic-modal__chart">
            <Seismic2DChart
              results={results}
              seismic={seismic}
              onSeismicChange={onSeismicChange}
              mode={mode}
              onModeChange={onModeChange}
              stationDistanceKm={stationDistanceKm}
              onStationDistanceChange={onStationDistanceChange}
              variant="modal"
            />
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
