/**
 * Parámetros del escenario sísmico (epicentro, Mw, profundidad, mecanismo, suelo y Vs30). Se usa en
 * el panel y en el modal de gráficas: ambos editan el mismo estado, así que el mapa se actualiza.
 */
import { useState } from 'react'
import { MapPin, Crosshair } from 'lucide-react'
import type { LngLat, SeismicSimulationState } from '../types/workspace'
import {
  SOIL_VS30,
  effectiveVs30,
  siteAmplification,
  type SeismicMechanism,
  type SoilType,
} from '../utils/seismic'
import { useTranslation } from '../i18n/useTranslation'

interface Props {
  seismic: SeismicSimulationState
  onSeismicChange: (next: SeismicSimulationState) => void
  onFlyToEpicenter?: (coord: LngLat) => void
  /** Prefijo de ids para no repetirlos cuando el panel y el modal están montados a la vez. */
  idPrefix: string
}

/** Coordenada editable: se aplica al salir del campo o con Enter, si es un número válido. */
function CoordInput({ id, label, value, min, max, onCommit }: {
  id: string; label: string; value: number; min: number; max: number; onCommit: (v: number) => void
}) {
  // Borrador solo mientras se escribe; fuera de eso se muestra el valor vigente del escenario.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value.toFixed(4)
  const commit = () => {
    const v = Number(text)
    if (draft !== null && Number.isFinite(v) && v >= min && v <= max) onCommit(v)
    setDraft(null)
  }
  return (
    <label className="seismic-coord-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        step="0.01"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      />
    </label>
  )
}

export function SeismicScenarioControls({ seismic, onSeismicChange, onFlyToEpicenter, idPrefix }: Props) {
  const { t } = useTranslation()
  const vs30 = effectiveVs30(seismic.soilType, seismic.vs30)
  const setEpicenter = (epicenter: LngLat) =>
    onSeismicChange({ ...seismic, enabled: true, epicenter, name: t('Epicentro personalizado', 'Custom epicenter') })

  return (
    <div className="seismic-scenario-controls">
      {/* Epicentro: clic en el mapa o coordenadas */}
      <div className="seismic-control-group">
        <div className="seismic-epicenter-row">
          <div className="seismic-epicenter-badge">
            <MapPin size={13} className="seismic-icon-red" />
            <span>{t('Epicentro', 'Epicenter')}</span>
          </div>
          <button
            type="button"
            className="seismic-btn-fly"
            onClick={() => onFlyToEpicenter?.(seismic.epicenter)}
            title={t('Centrar la cámara del mapa en el epicentro', 'Center map camera on epicenter')}
          >
            {t('Centrar Mapa', 'Center Map')}
          </button>
        </div>
        <div className="seismic-coord-row">
          <CoordInput id={`${idPrefix}-lat`} label={t('Lat.', 'Lat.')} value={seismic.epicenter[1]} min={-85} max={85}
            onCommit={(lat) => setEpicenter([seismic.epicenter[0], lat])} />
          <CoordInput id={`${idPrefix}-lon`} label={t('Lon.', 'Lon.')} value={seismic.epicenter[0]} min={-180} max={180}
            onCommit={(lon) => setEpicenter([lon, seismic.epicenter[1]])} />
          <button
            type="button"
            className={`seismic-station-btn ${seismic.pickingEpicenter ? 'is-active' : ''}`}
            onClick={() => onSeismicChange({ ...seismic, pickingEpicenter: !seismic.pickingEpicenter, pickingStation: false })}
            title={t('El siguiente clic en el mapa coloca el epicentro (Esc cancela)', 'The next map click places the epicenter (Esc cancels)')}
          >
            <Crosshair size={12} />{' '}
            {seismic.pickingEpicenter ? t('Haz clic en el mapa… (cancelar)', 'Click on the map… (cancel)') : t('Elegir en el mapa', 'Pick on map')}
          </button>
        </div>
      </div>

      {/* Magnitud y profundidad */}
      <div className="seismic-sliders-grid">
        <div className="seismic-slider-box">
          <div className="seismic-slider-header">
            <span>{t('Magnitud (Mw):', 'Magnitude (Mw):')}</span>
            <strong className="seismic-val-highlight">{seismic.magnitude.toFixed(1)}</strong>
          </div>
          <input
            type="range"
            min="4.0"
            max="8.8"
            step="0.1"
            className="seismic-slider"
            value={seismic.magnitude}
            onChange={(e) =>
              onSeismicChange({ ...seismic, magnitude: parseFloat(e.target.value), name: `Personalizado Mw ${e.target.value}` })
            }
          />
          <div className="seismic-slider-range-labels">
            <span>4.0</span>
            <span>6.0</span>
            <span>7.5</span>
            <span>8.8</span>
          </div>
        </div>

        <div className="seismic-slider-box">
          <div className="seismic-slider-header">
            <span>{t('Profundidad Focal (h):', 'Focal Depth (h):')}</span>
            <strong className="seismic-val-highlight">{seismic.depthKm} km</strong>
          </div>
          <input
            type="range"
            min="5"
            max="120"
            step="1"
            className="seismic-slider"
            value={seismic.depthKm}
            onChange={(e) => onSeismicChange({ ...seismic, depthKm: parseInt(e.target.value, 10) })}
          />
          <div className="seismic-slider-range-labels">
            <span>5 km</span>
            <span>30 km</span>
            <span>60 km</span>
            <span>120 km</span>
          </div>
        </div>
      </div>

      {/* Mecanismo y suelo */}
      <div className="seismic-dropdowns-row">
        <div className="seismic-select-item">
          <label className="seismic-sublabel" htmlFor={`${idPrefix}-mechanism`}>
            {t('Mecanismo Tectónico:', 'Tectonic Mechanism:')}
          </label>
          <select
            id={`${idPrefix}-mechanism`}
            className="seismic-select"
            value={seismic.mechanism}
            onChange={(e) => onSeismicChange({ ...seismic, mechanism: e.target.value as SeismicMechanism })}
          >
            <option value="subduction">{t('Subducción (Trinchera / Interplaca)', 'Subduction (Trench / Interplate)')}</option>
            <option value="intraplate">{t('Intraplaca (Profundo / Cocos)', 'Intraplate (Deep / Cocos slab)')}</option>
            <option value="crustal">{t('Cortical (Somero / Fallas)', 'Crustal (Shallow / Faults)')}</option>
          </select>
        </div>

        <div className="seismic-select-item">
          <label className="seismic-sublabel" htmlFor={`${idPrefix}-soil`}>
            {t('Tipo de Suelo (Efecto Vs30):', 'Soil Type (Vs30 Effect):')}
          </label>
          <select
            id={`${idPrefix}-soil`}
            className="seismic-select"
            value={seismic.soilType}
            onChange={(e) => {
              const soilType = e.target.value as SoilType
              onSeismicChange({ ...seismic, soilType, vs30: SOIL_VS30[soilType] })
            }}
          >
            <option value="rock">{t('Roca Firme (Vs30 > 760 m/s)', 'Hard Rock (Vs30 > 760 m/s)')}</option>
            <option value="intermediate">{t('Suelo Firme/Aluvial (360-760 m/s)', 'Stiff Soil/Alluvial (360-760 m/s)')}</option>
            <option value="soft_lacustrine">{t('Suelo Blando Lacustre (< 180 m/s, CDMX)', 'Soft Lacustrine (< 180 m/s, CDMX)')}</option>
          </select>
          <label className="seismic-sublabel seismic-vs30-row" htmlFor={`${idPrefix}-vs30`}>
            <span>Vs30 [m/s]</span>
            <input
              id={`${idPrefix}-vs30`}
              type="number"
              min="80"
              max="1500"
              step="10"
              className="seismic-vs30-input"
              value={vs30}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= 80 && v <= 1500) onSeismicChange({ ...seismic, vs30: v })
              }}
            />
            <span className="seismic-vs30-site" title={t('S_sitio = −0.45·ln(Vs30/760); 0 en roca (Vs30 ≥ 760)', 'S_site = −0.45·ln(Vs30/760); 0 on rock (Vs30 ≥ 760)')}>
              S = {siteAmplification(vs30).toFixed(2)} (×{Math.exp(siteAmplification(vs30)).toFixed(2)})
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
