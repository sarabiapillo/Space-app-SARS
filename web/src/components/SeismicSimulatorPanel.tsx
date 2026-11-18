import { useState, useMemo } from 'react'
import {
  Activity,
  X,
  ChevronDown,
  ChevronUp,
  MapPin,
  AlertTriangle,
  Flame,
  Info,
  Maximize2,
  Minimize2,
  Layers,
  Sparkles,
  Compass,
} from 'lucide-react'
import type { LngLat, SeismicSimulationState } from '../types/workspace'
import {
  HISTORICAL_SEISMIC_PRESETS,
  runSeismicSimulation,
  type SeismicMechanism,
  type SoilType,
  computePga_g,
  pgaToMmi,
  mmiToRoman,
  SOIL_VS30,
  sasmexAlertTimeSec,
  siteAmplification,
} from '../utils/seismic'
import { getPolygonBoundsAndCentroid, distanceKm } from '../utils/geojson'
import {
  PRESET_ROI_CATALOG,
  getRecommendedSeismicSettings,
  type CatalogRoiPreset,
} from '../utils/roiCatalog'
import { Seismic2DChart } from './Seismic2DChart'
import { useTranslation } from '../i18n/useTranslation'

interface SeismicSimulatorPanelProps {
  seismic: SeismicSimulationState
  onSeismicChange: (next: SeismicSimulationState) => void
  onFlyToEpicenter?: (coord: LngLat) => void
  onClose: () => void
  croppedRegion?: LngLat[] | null
  onSelectPresetROI?: (preset: CatalogRoiPreset) => void
}

/** 1.26e+28 → "1.26×10²⁸" para el momento sísmico. */
function formatMoment(m0: number): string {
  const exp = Math.floor(Math.log10(m0))
  const sup = String(exp).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]).join('')
  return `${(m0 / 10 ** exp).toFixed(2)}×10${sup}`
}

export function SeismicSimulatorPanel({
  seismic,
  onSeismicChange,
  onFlyToEpicenter,
  onClose,
  croppedRegion,
  onSelectPresetROI,
}: SeismicSimulatorPanelProps) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isExpandedFull, setIsExpandedFull] = useState(false)

  // Ejecución del modelo analítico de propagación de ondas
  const simulationResults = useMemo(() => {
    return runSeismicSimulation({
      epicenter: seismic.epicenter,
      magnitude: seismic.magnitude,
      depthKm: seismic.depthKm,
      name: seismic.name,
      mechanism: seismic.mechanism,
      soilType: seismic.soilType,
      vs30: seismic.vs30,
    })
  }, [seismic])

  // Datos geológicos y de propagación vinculados al ROI en el visor
  const activeRoiData = useMemo(() => {
    if (!croppedRegion || croppedRegion.length < 3) return null
    const bounds = getPolygonBoundsAndCentroid(croppedRegion)
    const centroid = bounds.centroid
    const distToEpicenter = Math.round(distanceKm(seismic.epicenter, centroid) * 10) / 10

    // Buscar ROI más cercana en el catálogo para inferir Estado y Geología
    let closestPreset: CatalogRoiPreset | null = null
    let minDist = Infinity
    for (const p of PRESET_ROI_CATALOG) {
      const d = distanceKm(centroid, p.center)
      if (d < minDist) {
        minDist = d
        closestPreset = p
      }
    }

    const state = closestPreset && minDist < 160 ? closestPreset.state : 'México'
    const name = closestPreset && minDist < 60 ? closestPreset.name : t('Región Delimitada', 'Bounded Region')
    const geoSettings = getRecommendedSeismicSettings(state, name)

    // Afectación local en el ROI causada por el sismo
    const pgaAtRoi_g = computePga_g(distToEpicenter, seismic.magnitude, seismic.depthKm, seismic.mechanism, seismic.soilType, seismic.vs30)
    const pgaAtRoi_cgs = pgaAtRoi_g * 980.665
    const mmiAtRoi = pgaToMmi(pgaAtRoi_g)
    const hypoDist = Math.sqrt(distToEpicenter * distToEpicenter + seismic.depthKm * seismic.depthKm)
    const tP = Math.round((hypoDist / 6.0) * 10) / 10
    const tS = Math.round((hypoDist / 3.5) * 10) / 10
    const warningTime = Math.max(0, Math.round((tS - tP) * 10) / 10)
    const alertTime = Math.round(sasmexAlertTimeSec(distToEpicenter, seismic.depthKm) * 10) / 10

    return {
      centroid,
      distToEpicenter,
      closestPreset,
      state,
      name,
      geoSettings,
      pgaAtRoi_g,
      pgaAtRoi_cgs,
      mmiAtRoi,
      tP,
      tS,
      warningTime,
      alertTime,
    }
  }, [croppedRegion, seismic, t])

  const handleSelectPreset = (presetId: string) => {
    const preset = HISTORICAL_SEISMIC_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    onSeismicChange({
      ...seismic,
      enabled: true,
      name: preset.name,
      magnitude: preset.magnitude,
      depthKm: preset.depthKm,
      epicenter: preset.epicenter,
      mechanism: preset.mechanism,
      soilType: preset.soilType,
      vs30: SOIL_VS30[preset.soilType],
    })
    onFlyToEpicenter?.(preset.epicenter)
  }

  const destructiveRing = simulationResults.rings.find((r) => r.level === 'destructive')
  const severeRing = simulationResults.rings.find((r) => r.level === 'severe')

  return (
    <div
      className={`seismic-panel ${isCollapsed ? 'is-collapsed' : ''} ${
        isExpandedFull ? 'is-expanded-full' : ''
      }`}
      aria-label={t('Simulador de Terremotos y Ondas Sísmicas', 'Earthquake and Seismic Wave Simulator')}
    >
      {/* Cabecera del panel */}
      <div className="seismic-panel__header">
        <div className="seismic-panel__title-wrap">
          <div className="seismic-panel__icon-pulse">
            <Activity size={16} />
          </div>
          <div>
            <h3 className="seismic-panel__title">
              {t('Simulador de Terremotos', 'Earthquake Simulator')}
            </h3>
            <span className="seismic-panel__subtitle">
              {t('Física de Ondas P/S & Zonificación de Riesgo', 'P/S Wave Physics & Risk Zoning')}
            </span>
          </div>
        </div>

        <div className="seismic-panel__actions">
          <button
            type="button"
            className="seismic-panel__btn-icon"
            onClick={() => setIsExpandedFull((prev) => !prev)}
            title={isExpandedFull ? t('Reducir tamaño', 'Reduce size') : t('Maximizar panel', 'Maximize panel')}
          >
            {isExpandedFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            className="seismic-panel__btn-icon"
            onClick={() => setIsCollapsed((prev) => !prev)}
            title={isCollapsed ? t('Expandir panel', 'Expand panel') : t('Minimizar panel', 'Minimize panel')}
          >
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            type="button"
            className="seismic-panel__btn-icon is-close"
            onClick={onClose}
            title={t('Cerrar simulador', 'Close simulator')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="seismic-panel__body">
          {/* SECCIÓN ROI: VINCULACIÓN CON REGIÓN DE INTERÉS (ROI) Y SUELO REAL */}
          <div className="seismic-control-group seismic-roi-section">
            <div className="seismic-roi-header">
              <Compass size={13} className="seismic-icon-red" />
              <span>{t('Región de Interés (ROI) & Geología Real:', 'Region of Interest (ROI) & Real Geology:')}</span>
            </div>

            {/* Selector de ROI de México */}
            <select
              className="seismic-select"
              defaultValue=""
              onChange={(e) => {
                const preset = PRESET_ROI_CATALOG.find((p) => p.id === e.target.value)
                if (preset) {
                  onSelectPresetROI?.(preset)
                  const geo = getRecommendedSeismicSettings(preset.state, preset.name)
                  onSeismicChange({
                    ...seismic,
                    epicenter: preset.center,
                    name: `Sismo - ${preset.name}`,
                    soilType: geo.soilType,
                    mechanism: geo.mechanism,
                  })
                  onFlyToEpicenter?.(preset.center)
                }
              }}
            >
              <option value="">{t('— Cargar ROI de México con su geología real —', '— Load Mexico ROI with real geology —')}</option>
              <optgroup label="🇲🇽 Guerrero (Brecha Sísmica / Trinchera)">
                {PRESET_ROI_CATALOG.filter((p) => p.state === 'Guerrero').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="🇲🇽 Ciudad de México (Suelo Blando Lacustre / Resonancia)">
                {PRESET_ROI_CATALOG.filter((p) => p.state === 'Ciudad de México').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="🇲🇽 Oaxaca (Trinchera / Istmo Tehuantepec)">
                {PRESET_ROI_CATALOG.filter((p) => p.state === 'Oaxaca').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="🇲🇽 Chiapas (Subducción / Intraplaca Profundo)">
                {PRESET_ROI_CATALOG.filter((p) => p.state === 'Chiapas').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="🇲🇽 Puebla & Morelos (Intraplaca en Cocos)">
                {PRESET_ROI_CATALOG.filter((p) => p.state === 'Puebla' || p.state === 'Morelos').map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.state})</option>
                ))}
              </optgroup>
              <optgroup label="🇲🇽 Michoacán & Jalisco (Costa Pacífico)">
                {PRESET_ROI_CATALOG.filter((p) => p.state === 'Michoacán' || p.state === 'Jalisco').map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.state})</option>
                ))}
              </optgroup>
              <optgroup label="🇲🇽 Baja California (Fallas Corticales / San Andrés)">
                {PRESET_ROI_CATALOG.filter((p) => p.state === 'Baja California').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            </select>

            {/* Tarjeta de integración activa cuando hay un ROI seleccionado */}
            {activeRoiData && (
              <div className="seismic-roi-card">
                <div className="seismic-roi-card__head">
                  <div className="seismic-roi-card__title">
                    <MapPin size={12} className="seismic-icon-red" />
                    <strong>{activeRoiData.name} ({activeRoiData.state})</strong>
                  </div>
                  <span className="seismic-roi-dist-badge">
                    {activeRoiData.distToEpicenter <= 0.5
                      ? t('Epicentro en ROI', 'Epicenter in ROI')
                      : `${activeRoiData.distToEpicenter} km ${t('del epicentro', 'from epicenter')}`}
                  </span>
                </div>

                <div className="seismic-roi-card__geo">
                  <span className="seismic-roi-geo-title">
                    <Sparkles size={11} className="seismic-icon-amber" />
                    <strong>{t('Geología y Suelo Real:', 'Real Soil & Geology:')}</strong> {activeRoiData.geoSettings.soilLabelEs} · {activeRoiData.geoSettings.mechanismLabelEs}
                  </span>
                  <p className="seismic-roi-geo-desc">{activeRoiData.geoSettings.geologicalDescriptionEs}</p>
                </div>

                <div className="seismic-roi-actions">
                  <button
                    type="button"
                    className="seismic-roi-action-btn is-primary"
                    onClick={() => {
                      onSeismicChange({
                        ...seismic,
                        epicenter: activeRoiData.centroid,
                        name: `Sismo en ${activeRoiData.name}`,
                        soilType: activeRoiData.geoSettings.soilType,
                        vs30: SOIL_VS30[activeRoiData.geoSettings.soilType],
                        mechanism: activeRoiData.geoSettings.mechanism,
                      })
                      onFlyToEpicenter?.(activeRoiData.centroid)
                    }}
                    title={t('Fijar el epicentro de la simulación en el centroide de esta ROI', 'Set simulation epicenter at centroid of this ROI')}
                  >
                    📍 {t('Fijar Epicentro en ROI', 'Set Epicenter in ROI')}
                  </button>
                  <button
                    type="button"
                    className="seismic-roi-action-btn is-secondary"
                    onClick={() => {
                      onSeismicChange({
                        ...seismic,
                        soilType: activeRoiData.geoSettings.soilType,
                        vs30: SOIL_VS30[activeRoiData.geoSettings.soilType],
                        mechanism: activeRoiData.geoSettings.mechanism,
                      })
                    }}
                    title={t('Aplicar el tipo de suelo Vs30 y mecanismo de esta región', 'Apply Vs30 soil and mechanism of this region')}
                  >
                    ⚙️ {t('Aplicar Suelo Real', 'Apply Real Soil')}
                  </button>
                </div>

                {/* Si el ROI no es el epicentro, mostrar la afectación pronosticada en este ROI */}
                {activeRoiData.distToEpicenter > 0.5 && (
                  <div className="seismic-roi-metrics">
                    <div className="seismic-roi-metric-item">
                      <span title={t('Ec. 10: tS − 3 s de proceso, contado desde el origen del sismo', 'Eq. 10: tS − 3 s processing, counted from origin time')}>{t('Alerta SASMEX:', 'SASMEX Warning:')}</span>
                      <strong style={{ color: '#ea580c' }}>{activeRoiData.alertTime}s</strong>
                    </div>
                    <div className="seismic-roi-metric-item">
                      <span>{t('Ventana P–S (Δt):', 'P–S window (Δt):')}</span>
                      <strong>{activeRoiData.warningTime}s</strong>
                    </div>
                    <div className="seismic-roi-metric-item">
                      <span>{t('Arribo Onda S:', 'S-Wave Arrival:')}</span>
                      <strong>{activeRoiData.tS}s</strong>
                    </div>
                    <div className="seismic-roi-metric-item">
                      <span>{t('PGA en ROI:', 'PGA at ROI:')}</span>
                      <strong>{activeRoiData.pgaAtRoi_g.toFixed(3)}g</strong>
                    </div>
                    <div className="seismic-roi-metric-item">
                      <span>{t('Intensidad:', 'Intensity:')}</span>
                      <strong>MMI {mmiToRoman(activeRoiData.mmiAtRoi)}</strong>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selector de Casos Históricos de Terremotos */}
          <div className="seismic-control-group">
            <label className="seismic-label" htmlFor="seismic-preset-select">
              <Flame size={13} className="seismic-icon-amber" />
              <span>{t('Terremotos Históricos de Referencia:', 'Historical Benchmark Earthquakes:')}</span>
            </label>
            <select
              id="seismic-preset-select"
              className="seismic-select"
              value={HISTORICAL_SEISMIC_PRESETS.find((p) => p.name === seismic.name)?.id || ''}
              onChange={(e) => handleSelectPreset(e.target.value)}
            >
              <option value="" disabled>
                {t('-- Seleccionar evento histórico --', '-- Select historical event --')}
              </option>
              {HISTORICAL_SEISMIC_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Epicentro Coordenadas y Centrado */}
          <div className="seismic-control-group">
            <div className="seismic-epicenter-row">
              <div className="seismic-epicenter-badge">
                <MapPin size={13} className="seismic-icon-red" />
                <span>
                  {t('Epicentro:', 'Epicenter:')} <strong>{seismic.epicenter[1].toFixed(3)}°N, {seismic.epicenter[0].toFixed(3)}°W</strong>
                </span>
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
          </div>

          {/* Controles de Magnitud y Profundidad */}
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
                onChange={(e) =>
                  onSeismicChange({ ...seismic, depthKm: parseInt(e.target.value, 10) })
                }
              />
              <div className="seismic-slider-range-labels">
                <span>5 km</span>
                <span>30 km</span>
                <span>60 km</span>
                <span>120 km</span>
              </div>
            </div>
          </div>

          {/* Selectores de Mecanismo Tectónico y Tipo de Suelo */}
          <div className="seismic-dropdowns-row">
            <div className="seismic-select-item">
              <label className="seismic-sublabel" htmlFor="seismic-mechanism">
                {t('Mecanismo Tectónico:', 'Tectonic Mechanism:')}
              </label>
              <select
                id="seismic-mechanism"
                className="seismic-select"
                value={seismic.mechanism}
                onChange={(e) =>
                  onSeismicChange({ ...seismic, mechanism: e.target.value as SeismicMechanism })
                }
              >
                <option value="subduction">{t('Subducción (Trinchera / Interplaca)', 'Subduction (Trench / Interplate)')}</option>
                <option value="intraplate">{t('Intraplaca (Profundo / Cocos)', 'Intraplate (Deep / Cocos slab)')}</option>
                <option value="crustal">{t('Cortical (Somero / Fallas)', 'Crustal (Shallow / Faults)')}</option>
              </select>
            </div>

            <div className="seismic-select-item">
              <label className="seismic-sublabel" htmlFor="seismic-soil">
                {t('Tipo de Suelo (Efecto Vs30):', 'Soil Type (Vs30 Effect):')}
              </label>
              <select
                id="seismic-soil"
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
              <label className="seismic-sublabel seismic-vs30-row" htmlFor="seismic-vs30">
                <span>Vs30 [m/s]</span>
                <input
                  id="seismic-vs30"
                  type="number"
                  min="80"
                  max="1500"
                  step="10"
                  className="seismic-vs30-input"
                  value={simulationResults.vs30}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (v >= 80 && v <= 1500) onSeismicChange({ ...seismic, vs30: v })
                  }}
                />
                <span className="seismic-vs30-site" title={t('S_sitio = −0.45·ln(Vs30/760); 0 en roca (Vs30 ≥ 760)', 'S_site = −0.45·ln(Vs30/760); 0 on rock (Vs30 ≥ 760)')}>
                  S = {siteAmplification(simulationResults.vs30).toFixed(2)} (×{Math.exp(siteAmplification(simulationResults.vs30)).toFixed(2)})
                </span>
              </label>
            </div>
          </div>

          {/* Tarjetas de Métricas de Riesgo y Radios Isosistas */}
          <div className="seismic-kpi-grid">
            <div className="seismic-kpi-card is-pga">
              <span className="seismic-kpi-title">{t('PGA Epicentral', 'Epicentral PGA')}</span>
              <strong className="seismic-kpi-value">
                {simulationResults.epicentralPga_g.toFixed(3)} g
              </strong>
              <span className="seismic-kpi-sub">
                {simulationResults.epicentralPga_cgs.toFixed(1)} cm/s²
              </span>
              <span className="seismic-kpi-sub" title={t('Momento sísmico escalar, ec. 1: M0 = 10^(1.5·(Mw + 10.7))', 'Scalar seismic moment, eq. 1: M0 = 10^(1.5·(Mw + 10.7))')}>
                M0 = {formatMoment(simulationResults.seismicMoment_dyncm)} dyn·cm
              </span>
            </div>

            <div className="seismic-kpi-card is-mmi">
              <span className="seismic-kpi-title">{t('Intensidad Máx.', 'Max Intensity')}</span>
              <strong className="seismic-kpi-value">
                MMI {mmiToRoman(simulationResults.epicentralMmi)}
              </strong>
              <span className="seismic-kpi-sub">
                {simulationResults.epicentralMmi.toFixed(1)} / 10
              </span>
            </div>

            <div className="seismic-kpi-card is-destructive">
              <span className="seismic-kpi-title">{t('Radio Destructivo', 'Destructive Radius')}</span>
              <strong className="seismic-kpi-value">
                {destructiveRing ? `${destructiveRing.radiusKm} km` : t('Sin daño severo', 'No severe damage')}
              </strong>
              <span className="seismic-kpi-sub">
                {destructiveRing ? t('Colapso estructural (VIII+)', 'Structural collapse (VIII+)') : t('Aceleración contenida', 'Contained acceleration')}
              </span>
            </div>

            <div className="seismic-kpi-card is-severe">
              <span className="seismic-kpi-title">{t('Radio Daño Fuerte', 'Strong Damage Radius')}</span>
              <strong className="seismic-kpi-value">
                {severeRing ? `${severeRing.radiusKm} km` : t('0 km', '0 km')}
              </strong>
              <span className="seismic-kpi-sub">
                {severeRing ? t('Fisuras y pánico (VI-VII)', 'Cracks & alarm (VI-VII)') : t('Baja aceleración', 'Low acceleration')}
              </span>
            </div>
          </div>

          {/* Gráfica 2D de Atenuación y Propagación de Ondas */}
          <div className="seismic-chart-section">
            <div className="seismic-section-label">
              <Layers size={13} />
              <span>{t('Gráfica 2D: Propagación de Ondas y Atenuación en Suelo', '2D Plot: Wave Propagation & Soil Attenuation')}</span>
            </div>
            <Seismic2DChart results={simulationResults} seismic={seismic} onSeismicChange={onSeismicChange} />
          </div>

          {/* Desglose de Radios de Afectación Concéntricos */}
          <div className="seismic-rings-breakdown">
            <div className="seismic-rings-header">
              <AlertTriangle size={13} className="seismic-icon-amber" />
              <strong>{t('Zonas de Afectación Sísmica Calculadas:', 'Calculated Seismic Impact Zones:')}</strong>
            </div>
            <div className="seismic-rings-table">
              {simulationResults.rings.map((ring) => (
                <div key={ring.level} className="seismic-ring-row">
                  <div className="seismic-ring-col-name">
                    <span className="seismic-ring-dot" style={{ backgroundColor: ring.color }} />
                    <span className="seismic-ring-label">{ring.labelEs}</span>
                  </div>
                  <span className="seismic-ring-mmi">MMI {ring.mmi}</span>
                  <strong className="seismic-ring-radius">{ring.radiusKm} km</strong>
                </div>
              ))}
            </div>
          </div>

          {/* Nota informativa de las ecuaciones GMPE */}
          <div className="seismic-footer-info">
            <Info size={13} />
            <span>
              {t(
                'Ecuaciones basadas en Leyes de Atenuación GMPE (Ordaz / García / Boore-Atkinson) calibradas para la Trinchera Mesoamericana. Consulte docs/latex/ecuaciones_sismo.tex para el desarrollo analítico completo.',
                'Equations based on GMPE Attenuation Laws (Ordaz / García / Boore-Atkinson) calibrated for the Middle America Trench. See docs/latex/ecuaciones_sismo.tex for complete analytical derivation.'
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
