import { useState, useMemo, useEffect, useCallback } from 'react'
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
  type SeismicSimulationResults,
  computePga_g,
  pgaToMmi,
  mmiToRoman,
  SOIL_VS30,
  sasmexAlertTimeSec,
} from '../utils/seismic'
import { getPolygonBoundsAndCentroid, distanceKm } from '../utils/geojson'
import { newSeismicScenario } from '../utils/seismicScenario'
import {
  PRESET_ROI_CATALOG,
  getRecommendedSeismicSettings,
  type CatalogRoiPreset,
} from '../utils/roiCatalog'
import { Seismic2DChart, type SeismicChartMode } from './Seismic2DChart'
import { SeismicScenarioControls } from './SeismicScenarioControls'
import { SeismicChartModal } from './SeismicChartModal'
import { useTranslation } from '../i18n/useTranslation'

interface SeismicSimulatorPanelProps {
  seismic: SeismicSimulationState
  onSeismicChange: (next: SeismicSimulationState) => void
  onFlyToEpicenter?: (coord: LngLat) => void
  onClose: () => void
  croppedRegion?: LngLat[] | null
  onSelectPresetROI?: (preset: CatalogRoiPreset) => void
  /** Centro de la región del mapa (ROI o, sin ROI, centro visible del mapa): ahí se crea un sismo nuevo. */
  getRegionCenter?: () => LngLat
}

const GMPE_LABELS: Record<SeismicSimulationResults['gmpeModel'], string> = {
  arroyo2010: 'Arroyo et al. (2010), interplaca',
  garcia2005: 'García et al. (2005), intraplaca',
  'manual-crustal': 'Cortical provisional (sin fuente publicada)',
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
  getRegionCenter,
}: SeismicSimulatorPanelProps) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isExpandedFull, setIsExpandedFull] = useState(false)
  // Gráficas: pestaña y distancia de estación compartidas entre el panel y el modal.
  const [chartMode, setChartMode] = useState<SeismicChartMode>('pga')
  const [stationDistanceKm, setStationDistanceKm] = useState(120)
  const [chartModalOpen, setChartModalOpen] = useState(false)
  const closeChartModal = useCallback(() => setChartModalOpen(false), [])
  const picking = Boolean(seismic.pickingEpicenter || seismic.pickingStation)

  // Esc cancela la elección de epicentro o estación en el mapa.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSeismicChange({ ...seismic, pickingEpicenter: false, pickingStation: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking, seismic, onSeismicChange])

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

      {picking && (
        <div className="seismic-pick-banner" role="status">
          {seismic.pickingEpicenter
            ? t('Haz clic en el mapa para colocar el epicentro. Esc cancela.', 'Click on the map to place the epicenter. Esc cancels.')
            : t('Haz clic en el mapa para colocar la estación. Esc cancela.', 'Click on the map to place the station. Esc cancels.')}
        </div>
      )}

      {chartModalOpen && (
        <SeismicChartModal
          mode={chartMode}
          onModeChange={setChartMode}
          onClose={closeChartModal}
          seismic={seismic}
          onSeismicChange={onSeismicChange}
          onFlyToEpicenter={onFlyToEpicenter}
          results={simulationResults}
          stationDistanceKm={stationDistanceKm}
          onStationDistanceChange={setStationDistanceKm}
          gmpeLabel={GMPE_LABELS[simulationResults.gmpeModel]}
        />
      )}

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
                {seismic.simulated && activeRoiData.distToEpicenter > 0.5 && (
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

          {/* Escenario: un sismo NUEVO en la región del mapa; los históricos son solo referencia */}
          <div className="seismic-scenario-name">
            <span>
              {t('Escenario:', 'Scenario:')} <strong>{seismic.name}</strong>
              {seismic.autoPlaced && <em> · {t('en el centro de la región del mapa', 'at the center of the map region')}</em>}
            </span>
            {getRegionCenter && (
              <button
                type="button"
                className="seismic-btn-fly"
                onClick={() => {
                  const center = getRegionCenter()
                  onSeismicChange({ ...newSeismicScenario(center, t('este mapa', 'this map')) })
                  onFlyToEpicenter?.(center)
                }}
                title={t('Sismo nuevo (no histórico) en el centro de la región de este mapa', 'New (non-historical) earthquake at the center of this map region')}
              >
                ✚ {t('Nuevo sismo en este mapa', 'New earthquake on this map')}
              </button>
            )}
          </div>

          {/* Selector de Casos Históricos de Terremotos (opcional) */}
          <div className="seismic-control-group">
            <label className="seismic-label" htmlFor="seismic-preset-select">
              <Flame size={13} className="seismic-icon-amber" />
              <span>{t('Cargar un sismo histórico como referencia (opcional):', 'Load a historical earthquake as reference (optional):')}</span>
            </label>
            <select
              id="seismic-preset-select"
              className="seismic-select"
              value={HISTORICAL_SEISMIC_PRESETS.find((p) => p.name === seismic.name)?.id || ''}
              onChange={(e) => handleSelectPreset(e.target.value)}
            >
              <option value="" disabled>
                {t('— Escenario propio (sismo nuevo) —', '— Own scenario (new earthquake) —')}
              </option>
              {HISTORICAL_SEISMIC_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Epicentro (mapa o coordenadas), magnitud, profundidad, mecanismo y suelo */}
          <SeismicScenarioControls
            seismic={seismic}
            onSeismicChange={onSeismicChange}
            onFlyToEpicenter={onFlyToEpicenter}
            idPrefix="seismic-panel"
          />

          {/* Acciones: ejecutar o limpiar la simulación y abrir el editor de parámetros */}
          <div className="seismic-run-row">
            {seismic.simulated ? (
              <button type="button" className="seismic-run-btn is-secondary"
                onClick={() => onSeismicChange({ ...seismic, simulated: false, animatingWaves: false })}>
                ⟲ {t('Limpiar resultados', 'Clear results')}
              </button>
            ) : (
              <button type="button" className="seismic-run-btn"
                onClick={() => onSeismicChange({ ...seismic, enabled: true, simulated: true })}>
                ▶ {t('Ejecutar simulación', 'Run simulation')}
              </button>
            )}
            <button type="button" className="seismic-run-btn is-secondary" onClick={() => setChartModalOpen(true)}>
              ⚙ {t('Editar parámetros', 'Edit parameters')}
            </button>
          </div>

          {/* Animación de los frentes de onda P y S en el mapa */}
          {seismic.simulated && (
            <div className="seismic-wave-row">
              <button
                type="button"
                className={`seismic-run-btn ${seismic.animatingWaves ? 'is-secondary' : 'is-wave'}`}
                onClick={() => onSeismicChange({ ...seismic, animatingWaves: !seismic.animatingWaves })}
              >
                {seismic.animatingWaves ? `⏸ ${t('Detener animación', 'Stop animation')}` : `🌊 ${t('Animar ondas P y S', 'Animate P and S waves')}`}
              </button>
              <label className="seismic-wave-speed">
                {t('Velocidad', 'Speed')}
                <select
                  value={seismic.waveAnimationSpeed ?? 5}
                  onChange={(e) => onSeismicChange({ ...seismic, waveAnimationSpeed: Number(e.target.value) })}
                >
                  <option value={2}>×2</option>
                  <option value={5}>×5</option>
                  <option value={10}>×10</option>
                  <option value={20}>×20</option>
                </select>
              </label>
            </div>
          )}

          {!seismic.simulated ? (
            <div className="seismic-empty-results">
              {t('Ajusta el epicentro y los parámetros, y pulsa «Ejecutar simulación» para calcular la aceleración, los anillos y las gráficas.',
                'Set the epicenter and parameters, then press "Run simulation" to compute acceleration, rings and charts.')}
            </div>
          ) : (
          <>
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

          {/* Modelo de atenuación usado, incertidumbre y validez */}
          <div className="seismic-gmpe-note">
            <span>
              {t('Atenuación:', 'Attenuation:')} <strong>{GMPE_LABELS[simulationResults.gmpeModel]}</strong>
              {simulationResults.gmpeSigmaLn !== null && (
                <> · {t('PGA epicentral 16–84 %:', 'Epicentral PGA 16–84 %:')}{' '}
                  {(simulationResults.epicentralPga_g * Math.exp(-simulationResults.gmpeSigmaLn)).toFixed(2)}–
                  {Math.min(2.5, simulationResults.epicentralPga_g * Math.exp(simulationResults.gmpeSigmaLn)).toFixed(2)} g</>
              )}
            </span>
            {simulationResults.validityWarnings.map((w) => (
              <span key={w} className="seismic-gmpe-note__warning">⚠ {w}</span>
            ))}
          </div>

          {/* Gráfica 2D de Atenuación y Propagación de Ondas */}
          <div className="seismic-chart-section">
            <div className="seismic-section-label">
              <Layers size={13} />
              <span>{t('Gráfica 2D: Propagación de Ondas y Atenuación en Suelo', '2D Plot: Wave Propagation & Soil Attenuation')}</span>
            </div>
            <Seismic2DChart
              results={simulationResults}
              seismic={seismic}
              onSeismicChange={onSeismicChange}
              mode={chartMode}
              onModeChange={setChartMode}
              stationDistanceKm={stationDistanceKm}
              onStationDistanceChange={setStationDistanceKm}
              onExpand={(m) => { setChartMode(m); setChartModalOpen(true) }}
            />
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

          </>
          )}

          {/* Nota informativa de las ecuaciones GMPE */}
          <div className="seismic-footer-info">
            <Info size={13} />
            <span>
              {t(
                'Atenuación: Arroyo et al. (2010) para subducción y García et al. (2005) para intraplaca, en roca; cortical provisional. Modelo ilustrativo de escenarios, no un estudio de peligro. Ver docs/latex/ecuaciones_sismo.tex.',
                'Attenuation: Arroyo et al. (2010) for subduction and García et al. (2005) for intraslab, on rock; crustal provisional. Illustrative scenario model, not a hazard study. See docs/latex/ecuaciones_sismo.tex.'
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
