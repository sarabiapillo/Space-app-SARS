import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  MapPin,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react'
import type { FloodSimulationState, LngLat } from '../types/workspace'
import { simulateFloodScenario } from '../api/client'
import { floodRoiPolygon } from '../utils/floodRoi'
import { FloodCharts } from './FloodCharts'
import { useTranslation } from '../i18n/useTranslation'
import { PRESET_ROI_CATALOG, type CatalogRoiPreset } from '../utils/roiCatalog'

interface RainDg2PanelProps {
  flood: FloodSimulationState
  onFloodChange: (next: FloodSimulationState) => void
  croppedRegion?: LngLat[] | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
  onSelectPresetROI?: (preset: CatalogRoiPreset) => void
  onClose?: () => void
}

export function RainDg2Panel({
  flood,
  onFloodChange,
  croppedRegion,
  onFlyToZone,
  onSelectPresetROI,
  onClose,
}: RainDg2PanelProps) {
  const { t, localizeText, locale } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [showEquations, setShowEquations] = useState(false)
  const requestId = useRef(0)
  const currentFlood = useRef(flood)
  const changeFlood = useRef(onFloodChange)
  const roiKey = JSON.stringify(croppedRegion ?? null)
  const previousRoiKey = useRef(roiKey)

  useEffect(() => {
    currentFlood.current = flood
    changeFlood.current = onFloodChange
  }, [flood, onFloodChange])

  // Una respuesta pendiente no puede restaurar un resultado tras cerrar el panel.
  useEffect(() => () => { requestId.current += 1 }, [])

  useEffect(() => {
    if (previousRoiKey.current === roiKey) return
    previousRoiKey.current = roiKey
    requestId.current += 1
    const latest = currentFlood.current
    if (latest.rasterUrl || latest.stats) {
      changeFlood.current({ ...latest, enabled: false, rasterUrl: null, rasterBounds: null, stats: null, charts: null, resultRoiKey: undefined })
    }
  }, [roiKey])

  const amountSliderId = useId()
  const durationSliderId = useId()
  const pressureSliderId = useId()
  const opacitySliderId = useId()

  const rainfallAmount = flood.rainfallAmount || 35
  const rainfallDuration = flood.rainfallDuration || 3
  const pressureHpa = flood.pressureHpa || 1005
  const calculatedIntensity = Number((rainfallAmount / rainfallDuration).toFixed(1))

  const handleSimulateFlood = async () => {
    const roi = floodRoiPolygon(croppedRegion)
    if (!roi) {
      setSimulationError('Selecciona y dibuja una ROI válida en el mapa antes de simular.')
      return
    }
    const thisRequest = ++requestId.current
    const requestedRoiKey = roiKey
    setIsSimulating(true)
    setSimulationError(null)

    try {
      // Enviar exclusivamente el polígono seleccionado en el mapa.
      const simRes = await simulateFloodScenario({
        rainfall: { amount: Number(rainfallAmount), unit: 'mm', duration: Number(rainfallDuration), duration_unit: 'h' },
        roi,
        pressure_hpa: Number(pressureHpa),
      })
      if (!simRes?.dataUrl) throw new Error('El servicio no devolvió un resultado de simulación.')
      if (requestId.current !== thisRequest || JSON.stringify(croppedRegion ?? null) !== requestedRoiKey) return
      onFloodChange({ ...flood, enabled: true, rasterUrl: simRes.dataUrl, rasterBounds: simRes.bounds, showRasterOnMap: true, stats: simRes.stats, charts: simRes.charts ?? null, statsSource: 'backend', resultRoiKey: requestedRoiKey })
    } catch (err) {
      if (requestId.current !== thisRequest) return
      setSimulationError(err instanceof Error ? err.message : 'Error al generar la simulación de inundación')
      onFloodChange({ ...flood, enabled: false, rasterUrl: null, rasterBounds: null, stats: null, charts: null })
    } finally {
      if (requestId.current === thisRequest) setIsSimulating(false)
    }
  }

  const resultMatchesRoi = flood.resultRoiKey === roiKey

  const handleToggleRaster = () => {
    onFloodChange({
      ...flood,
      showRasterOnMap: !(flood.showRasterOnMap ?? true),
    })
  }

  return (
    <aside
      className={`ws-rain-overlay ${collapsed ? 'is-collapsed' : ''}`}
      aria-label={t('Panel de diseño Simulación Lluvia / DG2', 'Rain / DG2 simulation panel')}
    >
      <div className="ws-rain-overlay__header">
        <div className="ws-rain-overlay__title">
          <CloudRain size={16} className="ws-rain-panel__icon" />
          <div>
            <strong>{t('Simulador de Lluvia & Encharcamientos', 'Rainfall & ponding simulator')}</strong>
            <div className="ws-rain-overlay__sub">{t('Calculá únicamente sobre una ROI delimitada', 'Calculate only within a defined ROI')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            type="button"
            className="ws-floating-toolbox__icon-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? t('Expandir panel DG2', 'Expand DG2 panel') : t('Colapsar panel DG2', 'Collapse DG2 panel')}
            aria-label={collapsed ? t('Expandir panel DG2', 'Expand DG2 panel') : t('Colapsar panel DG2', 'Collapse DG2 panel')}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {onClose && (
            <button
              type="button"
              className="ws-floating-toolbox__icon-btn"
              onClick={onClose}
              title={t('Cerrar panel y volver al mapa', 'Close panel and return to map')}
              aria-label={t('Cerrar panel y volver al mapa', 'Close panel and return to map')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="ws-rain-overlay__status">
        <span className="ws-rain-status-badge">
          <ShieldAlert size={12} />
          {flood.rasterUrl && resultMatchesRoi
            ? t('Mapa de Inundación y Encharcamientos Activo en Visor', 'Flood and ponding map active in viewer')
            : t('Configuración de Lluvia y Acumulación Topográfica', 'Rainfall and topographic accumulation settings')}
        </span>
      </div>

      {!collapsed && (
        <div className="ws-rain-overlay__body">
          <div className="solar-zone-group" style={{ margin: 0 }}>
            <div className="solar-zone-label"><MapPin size={12} /><span>{t('Región de Interés (ROI)', 'Region of interest (ROI)')}</span></div>
            <div className="solar-zone-info">
              {floodRoiPolygon(croppedRegion)
                ? t('✓ ROI confirmada en el mapa. Lista para simulación hidrológica.', '✓ ROI confirmed on map. Ready for hydrological simulation.')
                : t('Delimita una ROI o elige una zona precargada para simular:', 'Define an ROI or choose a preloaded zone to simulate:')}
            </div>
            <div style={{ marginTop: '8px' }}>
              <select
                className="ws-rain-select"
                style={{ width: '100%', fontSize: '12px', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc' }}
                defaultValue=""
                onChange={(e) => {
                  const preset = PRESET_ROI_CATALOG.find((p) => p.id === e.target.value)
                  if (preset) {
                    onSelectPresetROI?.(preset)
                    onFlyToZone?.(preset.center, preset.zoom)
                  }
                }}
              >
                <option value="">{t('— Elegir ROI precargada (Guerrero, Chiapas, Oaxaca) —', '— Choose preloaded ROI (Guerrero, Chiapas, Oaxaca) —')}</option>
                <optgroup label="🇲🇽 Estado de Guerrero">
                  {PRESET_ROI_CATALOG.filter((p) => p.state === 'Guerrero').map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
                <optgroup label="🇲🇽 Estado de Chiapas">
                  {PRESET_ROI_CATALOG.filter((p) => p.state === 'Chiapas').map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
                <optgroup label="🇲🇽 Estado de Oaxaca">
                  {PRESET_ROI_CATALOG.filter((p) => p.state === 'Oaxaca').map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Formulario interactivo de precipitación */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <CloudRain size={13} />
              <h3>{t('Parámetros del Evento de Lluvia', 'Rainfall event parameters')}</h3>
            </div>

            {/* Slider 1: Lámina acumulada */}
            <div className="solar-control">
              <div className="opacity-control__header">
                <label htmlFor={amountSliderId} className="opacity-control__label">
                  {t('Lámina Acumulada', 'Accumulated rainfall')}
                </label>
                <span className="opacity-control__value">{rainfallAmount} mm</span>
              </div>
              <input
                id={amountSliderId}
                type="range"
                min={5}
                max={350}
                step={1}
                value={rainfallAmount}
                onChange={(e) =>
                  onFloodChange({
                    ...flood,
                    rainfallAmount: Number(e.target.value),
                  })
                }
                className="slider slider--rain"
                style={{ '--slider-fill': `${(rainfallAmount / 350) * 100}%` } as CSSProperties}
              />
            </div>

            {/* Slider 2: Duración (hasta 72h / 3 días) */}
            <div className="solar-control">
              <div className="opacity-control__header">
                <label htmlFor={durationSliderId} className="opacity-control__label">
                  {t('Duración del Evento', 'Event duration')}
                </label>
                <span className="opacity-control__value">
                  {rainfallDuration} h ({Number((rainfallDuration / 24).toFixed(1))} d · {calculatedIntensity} mm/h)
                </span>
              </div>
              <input
                id={durationSliderId}
                type="range"
                min={1}
                max={72}
                step={0.5}
                value={rainfallDuration}
                onChange={(e) =>
                  onFloodChange({
                    ...flood,
                    rainfallDuration: Number(e.target.value),
                  })
                }
                className="slider slider--rain"
                style={{ '--slider-fill': `${(rainfallDuration / 72) * 100}%` } as CSSProperties}
              />
            </div>

            {/* Slider 3: Presión Barométrica */}
            <div className="solar-control">
              <div className="opacity-control__header">
                <label htmlFor={pressureSliderId} className="opacity-control__label">
                  {t('Presión Barométrica', 'Barometric pressure')}
                </label>
                <span className="opacity-control__value">
                  {pressureHpa} hPa {pressureHpa < 1010 ? t('(Baja presión)', '(Low pressure)') : t('(Estándar)', '(Standard)')}
                </span>
              </div>
              <input
                id={pressureSliderId}
                type="range"
                min={980}
                max={1030}
                step={1}
                value={pressureHpa}
                onChange={(e) =>
                  onFloodChange({
                    ...flood,
                    pressureHpa: Number(e.target.value),
                  })
                }
                className="slider slider--rain"
                style={{ '--slider-fill': `${((pressureHpa - 980) / 50) * 100}%` } as CSSProperties}
              />
              <span className="solar-control__hint">
                {t('Bajas presiones (ej. 995–1005 hPa) elevan la lámina hidrostática en zonas bajas e intensifican la escorrentía.', 'Low pressure (e.g., 995–1005 hPa) raises the hydrostatic water level in low-lying areas and increases runoff.')}
              </span>
            </div>

            <button
              type="button"
              className="ws-rain-action-btn"
              disabled={isSimulating || !floodRoiPolygon(croppedRegion)}
              onClick={handleSimulateFlood}
              title={floodRoiPolygon(croppedRegion) ? t('Enviar la ROI seleccionada al servicio de simulación', 'Submit the selected ROI to the simulation service') : t('Dibuja y aplica una ROI válida en el mapa', 'Draw and apply a valid ROI on the map')}
            >
              {isSimulating ? (
                <>
                  <Loader2 size={13} className="spin" />
                  <span>{t('Calculando acumulación hidráulica...', 'Calculating water accumulation...')}</span>
                </>
              ) : (
                <>
                  <Zap size={13} />
                  <span>{t('Simular Lluvia & Encharcamientos en Mapa', 'Simulate rainfall & ponding on map')}</span>
                </>
              )}
            </button>

            {simulationError && (
              <div className="ws-rain-error">
                <AlertCircle size={13} />
                <span>{localizeText(simulationError)}</span>
              </div>
            )}
          </section>

          {/* Controles de Capa de Inundación en el Mapa */}
          {flood.rasterUrl && resultMatchesRoi && (
            <section className="ws-rain-card ws-rain-card--results">
              <div className="ws-rain-card__head">
                <CheckCircle2 size={13} className="text-green" />
                <h3>{t('Previsualización de Inundación & Encharcamientos', 'Flood & ponding preview')}</h3>
              </div>

              {/* Botón para alternar visibilidad y enfocar */}
              <div className="solar-map-toggle">
                <button
                  type="button"
                  className={`solar-map-toggle__btn ${flood.showRasterOnMap !== false ? 'is-active' : ''}`}
                  onClick={handleToggleRaster}
                  title={t('Mostrar u ocultar la capa de inundación en el mapa', 'Show or hide the flood layer on the map')}
                >
                  {flood.showRasterOnMap !== false ? <Eye size={13} /> : <EyeOff size={13} />}
                  <span>
                    {flood.showRasterOnMap !== false
                      ? t('Capa de Agua en Mapa: Visible', 'Water layer on map: visible')
                      : t('Capa de Agua: Oculta', 'Water layer: hidden')}
                  </span>
                </button>
                <button
                  type="button"
                  className="solar-map-toggle__fly"
                  onClick={() => {
                    if (flood.rasterBounds) {
                      const [w, s, e, n] = flood.rasterBounds
                      onFlyToZone?.([(w + e) / 2, (s + n) / 2], 13.5)
                    }
                  }}
                  title={t('Enfocar mapa en el área inundada', 'Focus map on flooded area')}
                >
                  <Layers size={12} />
                  <span>{t('Enfocar', 'Focus')}</span>
                </button>
              </div>

              {/* Deslizador de Opacidad de Agua */}
              <div className="solar-control" style={{ marginTop: '8px' }}>
                <div className="opacity-control__header">
                  <label htmlFor={opacitySliderId} className="opacity-control__label">
                    {t('Transparencia de Capa de Agua', 'Water layer transparency')}
                  </label>
                  <span className="opacity-control__value">{flood.waterOpacity ?? 85}%</span>
                </div>
                <input
                  id={opacitySliderId}
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  value={flood.waterOpacity ?? 85}
                  onChange={(e) =>
                    onFloodChange({
                      ...flood,
                      waterOpacity: Number(e.target.value),
                    })
                  }
                  className="slider slider--rain"
                  style={{ '--slider-fill': `${flood.waterOpacity ?? 85}%` } as CSSProperties}
                />
              </div>

              {/* Modo de Comparación / Swipe Cortina (Inundación vs Terreno Original) */}
              <div className="ws-rain-compare-box">
                <div className="ws-rain-compare-box__header">
                  <label className="ws-rain-compare-toggle">
                    <input
                      type="checkbox"
                      checked={flood.compareMode ?? false}
                      onChange={(e) =>
                        onFloodChange({
                          ...flood,
                          compareMode: e.target.checked,
                        })
                      }
                    />
                    <strong>{t('Comparar Inundación vs Terreno Original', 'Compare flooding vs original terrain')}</strong>
                  </label>
                  <span className={`ws-rain-compare-badge ${flood.compareMode ? 'is-active' : ''}`}>
                    {flood.compareMode ? t('CORTINA SWIPE ACTIVA', 'SWIPE COMPARISON ACTIVE') : t('Capa completa', 'Full layer')}
                  </span>
                </div>

                {flood.compareMode && (
                  <div style={{ marginTop: '8px' }}>
                    <div className="opacity-control__header">
                      <span className="opacity-control__label">{t('Deslizador Swipe (Arrastrable en mapa)', 'Swipe slider (drag on map)')}</span>
                      <span className="opacity-control__value">{flood.compareSwipePct ?? 50}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={flood.compareSwipePct ?? 50}
                      onChange={(e) =>
                        onFloodChange({
                          ...flood,
                          compareSwipePct: Number(e.target.value),
                        })
                      }
                      className="slider slider--rain"
                      style={{ '--slider-fill': `${flood.compareSwipePct ?? 50}%` } as CSSProperties}
                    />
                    <div className="ws-flood-legend__labels" style={{ marginTop: '3px' }}>
                      <span>{t('◀ 0% Terreno Original', '◀ 0% Original terrain')}</span>
                      <span>{t('50% Mitad', '50% Half')}</span>
                      <span>{t('100% Inundación ▶', '100% Flooding ▶')}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Escala cromática de calados */}
              <div className="ws-flood-legend">
                <span className="ws-flood-legend__title">
                  {t('Escala de Calado y Acumulación de Agua (Profundidad):', 'Water depth and accumulation scale:')}
                </span>
                <div className="ws-flood-legend__bar" />
                <div className="ws-flood-legend__labels">
                  <span>{t('Lámina (<15 cm)', 'Shallow water (<15 cm)')}</span>
                  <span>{t('Moderado (15-40 cm)', 'Moderate (15-40 cm)')}</span>
                  <span>{t('Cauce Profundo (>1 m)', 'Deep channel (>1 m)')}</span>
                </div>
              </div>

              {/* Alerta de riesgo hidráulico */}
              {flood.stats?.riskLevel && (
                <div
                  className={`ws-rain-risk-badge ws-rain-risk-badge--${flood.stats.riskLevel.toLowerCase()}`}
                  style={{ marginTop: '8px' }}
                >
                  <ShieldAlert size={15} />
                  <div>
                    <strong>{t('Riesgo Hidráulico: {level}', 'Flood hazard: {level}', { level: localizeText(flood.stats.riskLevel) })}</strong>
                    <span>{localizeText(flood.stats.riskDescription)}</span>
                  </div>
                </div>
              )}

              {/* Estadísticas y métricas hidrológicas completas */}
              {flood.stats && (
                <div className="ws-rain-results-grid" style={{ marginTop: '8px' }}>
                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Superficie Encharcada', 'Ponded area')}</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.floodedAreaKm2.toFixed(2)} km²
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {flood.stats.waterSurfaceHa.toFixed(0)} ha · {flood.stats.floodedAreaPct.toFixed(1)}% {t('de ROI', 'of ROI')}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Calado (Profundidad)', 'Water depth')}</span>
                    <strong className="ws-rain-result-box__val">
                      {t('Máx:', 'Max:')} {flood.stats.maxDepthM.toFixed(2)} m
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {t('Media:', 'Mean:')} {flood.stats.meanDepthM.toFixed(2)} m
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Caudal Pico Estimado', 'Peak estimated discharge')}</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#0369a1' }}>
                      {flood.stats.peakDischargeM3s !== undefined ? `${flood.stats.peakDischargeM3s} m³/s` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">{t('Descarga máxima Q', 'Maximum discharge Q')}</span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Velocidad de Flujo', 'Flow velocity')}</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.meanVelocityMs !== undefined ? `${flood.stats.meanVelocityMs} m/s` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {t('Máx:', 'Max:')} {flood.stats.maxVelocityMs !== undefined ? `${flood.stats.maxVelocityMs} m/s` : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Régimen / Froude', 'Flow regime / Froude')}</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#854d0e' }}>
                      Fr = {flood.stats.froudeNumber !== undefined ? flood.stats.froudeNumber : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {flood.stats.froudeRegime ? localizeText(flood.stats.froudeRegime) : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Tiempo Concentración', 'Time of concentration')}</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.timeOfConcentrationMin !== undefined ? `${flood.stats.timeOfConcentrationMin} min` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Tc: {flood.stats.timeOfConcentrationHours !== undefined ? `${flood.stats.timeOfConcentrationHours} h` : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Balance Precipitación', 'Rainfall balance')}</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#0284c7' }}>
                      {flood.stats.effectiveRunoffMm !== undefined ? `${flood.stats.effectiveRunoffMm} mm ${t('neto', 'net')}` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {t('Infiltrado:', 'Infiltrated:')} {flood.stats.infiltratedMm !== undefined ? `${flood.stats.infiltratedMm} mm` : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">{t('Cota Superficie Agua', 'Water surface elevation')}</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.waterLevelMinM !== undefined && flood.stats.waterLevelMaxM !== undefined
                        ? `${flood.stats.waterLevelMinM} – ${flood.stats.waterLevelMaxM} m`
                        : flood.stats.elevMinM !== undefined
                        ? `${flood.stats.elevMinM} – ${flood.stats.elevMaxM} m`
                        : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">{t('Elevación η (s.n.m.)', 'Elevation η (above sea level)')}</span>
                  </div>

                  <div className="ws-rain-result-box" style={{ borderLeft: '3px solid #0284c7' }}>
                    <span className="ws-rain-result-box__label">{t('Presión y Saturación', 'Pressure and saturation')}</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.pressureHpa !== undefined ? `${flood.stats.pressureHpa} hPa` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {t('Saturación:', 'Saturation:')} {flood.stats.saturationPct !== undefined ? `${flood.stats.saturationPct}%` : '—'} · Δh: {flood.stats.baroSurgeCm !== undefined ? `${flood.stats.baroSurgeCm} cm` : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box" style={{ gridColumn: 'span 2' }}>
                    <span className="ws-rain-result-box__label">{t('Volumen Acumulado y Almacenamiento', 'Accumulated volume and storage')}</span>
                    <strong className="ws-rain-result-box__val">
                      {(flood.stats.totalVolumeM3 / 1_000_000).toFixed(2)} Mm³ {t('totales', 'total')}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {flood.stats.totalVolumeM3.toLocaleString(locale)} m³ {t('caídos', 'fallen')} · {t('Inundación efectiva:', 'Effective flooding:')} {flood.stats.floodedVolumeM3 !== undefined ? `${flood.stats.floodedVolumeM3.toLocaleString(locale)} m³` : '—'}
                    </span>
                  </div>
                </div>
              )}

              {/* Gráficas generadas con el resultado de la simulación de la zona / ROI seleccionada */}
              {flood.stats && <FloodCharts flood={flood} />}

              {/* Botón interactivo para ver y revisar las ecuaciones físicas */}
              <button
                type="button"
                className="ws-rain-eq-toggle"
                onClick={() => setShowEquations((prev) => !prev)}
                aria-expanded={showEquations}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <BookOpen size={12} />
                  <span>{t('Ecuaciones Hidráulicas del Simulador', 'Simulator hydraulic equations')}</span>
                </span>
                {showEquations ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showEquations && (
                <div className="ws-rain-eq-content">
                  <div className="ws-rain-eq-item">
                    <span>{t('1. Conservación de Masa 2D (Saint-Venant / SWE):', '1. 2D mass conservation (Saint-Venant / SWE):')}</span>
                    <code>∂t h + ∇·(h u) = r(t) - i(t)</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>{t('2. Dinámica de Resistencia de Manning:', '2. Manning resistance dynamics:')}</span>
                    <code>v = (1/n) · R_h^(2/3) · S^(1/2)  [n = 0.035 s/m^(1/3)]</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>{t('3. Calado Normal por Celda en Cauce:', '3. Normal water depth per channel cell:')}</span>
                    <code>h = [Q · n / (B · √S)]^(3/5)</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>{t('4. Enrutamiento Topográfico D8 (Steepest Descent):', '4. D8 topographic routing (steepest descent):')}</span>
                    <code>S_max = max_k [(z - z_k) / d_k]</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>{t('5. Tiempo de Concentración de Cuenca (Kirpich):', '5. Watershed time of concentration (Kirpich):')}</span>
                    <code>Tc = 0.0662 · (L^0.77) / (S^0.385)</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>{t('6. Saturación Progresiva del Suelo (Temporal de 3 Días / 72h):', '6. Progressive soil saturation (3-day / 72h storm):')}</span>
                    <code>{t('C(t) = C_0 + (C_max - C_0)·[1 - exp(-t/24h)]  [C → 0.89 a 72h]', 'C(t) = C_0 + (C_max - C_0)·[1 - exp(-t/24h)]  [C → 0.89 at 72h]')}</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>{t('7. Forzamiento Barométrico Hidrostático (Bajas Presiones):', '7. Hydrostatic barometric forcing (low pressure):')}</span>
                    <code>Δh_baro = (1013.25 - P_baro) / (ρ_w · g)  [{t('+1.02 cm por hPa de caída', '+1.02 cm per hPa drop')}]</code>
                  </div>
                </div>
              )}

              {/* Descarga del ráster PNG generado */}
              <div style={{ marginTop: '8px' }}>
                <a
                  href={flood.rasterUrl}
                  download={`encharcamientos_${rainfallAmount}mm.png`}
                  className="solar-api-link"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  title={t('Descargar ráster georreferenciado PNG de la mancha de encharcamientos', 'Download georeferenced PNG raster of ponding extent')}
                >
                  <Download size={12} />
                  <span>{t('Descargar Ráster de Encharcamientos (PNG)', 'Download ponding raster (PNG)')}</span>
                </a>
              </div>
            </section>
          )}

          {/* Especificación científica y honestidad del solver */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <Cpu size={13} />
              <h3>{t('Alcance del servicio', 'Service scope')}</h3>
            </div>
            <div className="ws-rain-kv">
              <div>
                <span>{t('ROI enviada', 'Submitted ROI')}</span>
                <code>{t('Polígono seleccionado y validado en EPSG:4326', 'Selected and validated polygon in EPSG:4326')}</code>
              </div>
              <div>
                <span>{t('Resultado', 'Result')}</span>
                <code>{t('Se muestra únicamente la respuesta del servicio', 'Only the service response is displayed')}</code>
              </div>
              <div>
                <span>{t('Sin respuesta', 'No response')}</span>
                <strong>{t('No se genera resultado local de respaldo', 'No local fallback result is generated')}</strong>
              </div>
            </div>
          </section>
        </div>
      )}

    </aside>
  )
}
