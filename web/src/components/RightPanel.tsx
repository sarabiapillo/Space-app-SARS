import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Sun,
  X,
  Zap,
} from 'lucide-react'
import type { LngLat, SolarSimulationState } from '../types/workspace'
import type { RoiGeometry } from '../utils/roi'
import { solarRoiGeometry } from '../utils/solarRoi'
import { LUT_INFERNO_256 } from '../utils/colormapTables'
import { getSolarAnalysis, getSolarContours, runSolarSimulation, type SolarAnalysisResponse, type SolarContoursResponse, type SolarSampleResponse, type SolarSimulationResponse } from '../api/client'
import { useTranslation } from '../i18n/useTranslation'
import type { RoiLayersState } from '../hooks/useRoiLayers'
import { legendTicks } from '../utils/solarHeatmap'

import { PRESET_ROI_CATALOG, type CatalogRoiPreset } from '../utils/roiCatalog'

const fmtW = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)} W/m²` : '—')
// The same 256 quantized colors used by the PNG (not interpolated CSS approximations).
const infernoGradient = `linear-gradient(90deg, ${Array.from({ length: 256 }, (_, index) => {
  const offset = index * 3
  const color = `rgb(${LUT_INFERNO_256[offset]},${LUT_INFERNO_256[offset + 1]},${LUT_INFERNO_256[offset + 2]})`
  return `${color} ${index / 256 * 100}%, ${color} ${(index + 1) / 256 * 100}%`
}).join(', ')})`

interface SolarPanelProps {
  solar: SolarSimulationState
  onSolarChange: (next: SolarSimulationState) => void
  onClose: () => void
  center?: LngLat
  croppedRegion?: LngLat[] | null
  effectiveRoi?: RoiGeometry | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
  onSelectPresetROI?: (preset: CatalogRoiPreset, options?: { simulation?: 'solar' }) => void
  roiLayers?: RoiLayersState
  solarSample?: { coordinate: LngLat; loading: boolean; result: SolarSampleResponse | null; error: string | null } | null
  solarOpacity?: number
  onSolarOpacityChange?: (opacity: number) => void
}

export function RightPanel({
  solar,
  onSolarChange,
  onClose,
  center,
  croppedRegion,
  effectiveRoi,
  onFlyToZone,
  onSelectPresetROI,
  solarSample,
  solarOpacity = 88,
  onSolarOpacityChange,
}: SolarPanelProps) {
  const { t, localizeText, locale } = useTranslation()
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResult, setSimulationResult] = useState<SolarSimulationResponse | null>(solar.simulationResult ?? null)
  const [analysis, setAnalysis] = useState<SolarAnalysisResponse | null>(solar.analysisResult ?? null)
  const [contours, setContours] = useState<SolarContoursResponse | null>(solar.contours ?? null)
  const [contoursError, setContoursError] = useState<string | null>(null)
  const [contoursLoading, setContoursLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [runInfo, setRunInfo] = useState<{ intensity: number } | null>(() => {
    const savedIntensity = solar.simulationResult?.request?.intensity_percent ?? solar.radiationIntensity
    return typeof savedIntensity === 'number' ? { intensity: Math.max(0, Math.min(100, savedIntensity)) } : null
  })
  const elevation = solar.elevationDeg ?? 45
  const azimuth = solar.azimuthDeg ?? 180
  // Orthographic illustration: east/west spread across the dome; elevation rises from the horizon.
  // The displayed azimuth remains authoritative (north and south share the center in this projection).
  const domeX = 130 - 92 * Math.sin(azimuth * Math.PI / 180) * Math.cos(elevation * Math.PI / 180)
  const domeY = 115 - 92 * Math.sin(elevation * Math.PI / 180)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false)
  const [analysisSection, setAnalysisSection] = useState(0)
  const [runInvalidated, setRunInvalidated] = useState(false)
  const analysisTrigger = useRef<HTMLButtonElement>(null)
  const analysisDialog = useRef<HTMLDivElement>(null)
  const solarCard = useRef<HTMLElement>(null)
  const wasAnalysisOpen = useRef(false)
  const requestVersion = useRef(0)
  const roiKey = JSON.stringify({ effectiveRoi: effectiveRoi ?? null, croppedRegion: croppedRegion ?? null })
  const confirmedRoi = (() => {
    try { return effectiveRoi ?? (croppedRegion && croppedRegion.length >= 3 ? solarRoiGeometry(null, croppedRegion) : null) }
    catch { return null }
  })()
  const lastRoiKey = useRef(roiKey)
  const lastRunId = useRef(solar.simulationResult?.id ?? null)
  const roiStates = [...new Set(PRESET_ROI_CATALOG.map(preset => preset.state))].sort((a, b) => a.localeCompare(b))
  const invalidateRun = () => {
    requestVersion.current++
    setSimulationError(null)
    setSimulationResult(null)
    setAnalysis(null)
    setRunInfo(null)
    setAnalysisError(null)
    setAnalysisLoading(false)
    setContours(null)
    setContoursError(null)
    setIsSimulating(false)
    setAnalysisOpen(false)
    setRunInvalidated(simulationResult !== null || isSimulating)
    onSolarChange({ ...solar, rasterPreviewUrl: null, rasterBounds: null, simulationResult: null, analysisResult: null, contours: null })
  }
  useEffect(() => {
    if (lastRunId.current !== (solar.simulationResult?.id ?? null)) {
      lastRunId.current = solar.simulationResult?.id ?? null
      setSimulationResult(solar.simulationResult ?? null)
      setAnalysis(solar.analysisResult ?? null)
      setContours(solar.contours ?? null)
      const savedIntensity = solar.simulationResult?.request?.intensity_percent ?? (solar.simulationResult ? solar.radiationIntensity : null)
      setRunInfo(typeof savedIntensity === 'number' ? { intensity: Math.max(0, Math.min(100, savedIntensity)) } : null)
      setRunInvalidated(false)
    }
  }, [solar.simulationResult?.id, solar.analysisResult])
  useEffect(() => {
    requestVersion.current++
    if (lastRoiKey.current !== roiKey) {
      lastRoiKey.current = roiKey
      setSimulationError(null)
      setSimulationResult(null)
      setAnalysis(null)
      setContours(null)
      onSolarChange({ ...solar, rasterPreviewUrl: null, rasterBounds: null, simulationResult: null, analysisResult: null, contours: null })
      setRunInfo(null)
      setAnalysisError(null)
      setAnalysisLoading(false)
      setIsSimulating(false)
      setSelectedPresetId('')
      setAnalysisOpen(false)
      setRunInvalidated(simulationResult !== null || isSimulating)
    }
    return () => { requestVersion.current++ }
    // ROI changes, not unrelated solar state, invalidate a finished result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roiKey])
  useEffect(() => {
    if (!analysisOpen) return
    analysisDialog.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnalysisOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [analysisOpen])
  useEffect(() => {
    if (analysisOpen) { wasAnalysisOpen.current = true; return }
    if (wasAnalysisOpen.current) {
      wasAnalysisOpen.current = false
      ;(analysisTrigger.current ?? solarCard.current)?.focus()
    }
  }, [analysisOpen])
  const solarLayerVisible = solar.showRasterOnMap !== false && solarOpacity > 0
  const upperWm2 = simulationResult?.clear_sky.dni_adjusted_w_m2 ?? 0
  const ticks = simulationResult ? [0, ...legendTicks(0, upperWm2).filter(value => value > 0 && value < upperWm2), upperWm2] : []

  const elevationId = useId()
  const azimuthId = useId()
  const radId = useId()

  const handleRunBackendSimulation = async () => {
    const version = ++requestVersion.current
    const isCurrent = () => requestVersion.current === version
    setIsSimulating(true)
    setSimulationError(null)
    setRunInvalidated(simulationResult !== null)
    setSimulationResult(null)
    setAnalysis(null)
    setRunInfo(null)
    setAnalysisError(null)
    setAnalysisLoading(false)
    onSolarChange({ ...solar, rasterPreviewUrl: null, rasterBounds: null, simulationResult: null, analysisResult: null, contours: null })

    try {
      // Use the confirmed polygon, not a preselected place or an invented square.
      const roiPolygon = solarRoiGeometry(effectiveRoi, croppedRegion ?? null)
      const polygons = roiPolygon.type === 'Polygon' ? [roiPolygon.coordinates] : roiPolygon.coordinates
      const coordinates = polygons.flat(2) as LngLat[]
      const lons = coordinates.map(([lon]) => lon)
      const lats = coordinates.map(([, lat]) => lat)
      const w = Math.min(...lons), s = Math.min(...lats), e = Math.max(...lons), n = Math.max(...lats)
      const cLon = (w + e) / 2, cLat = (s + n) / 2

      const intensity = Math.max(0, Math.min(100, Math.round(solar.radiationIntensity)))

      const res = await runSolarSimulation({
        roi: roiPolygon,
        elevation_deg: elevation,
        azimuth_deg: azimuth,
        intensity_percent: intensity,
      })
      if (!isCurrent()) return

      setSimulationResult(res)
      onSolarChange({ ...solar, simulationResult: res })
      setContoursLoading(true)
      let latestContours: SolarContoursResponse | null = null
      let latestAnalysis: SolarAnalysisResponse | null = null
      setContours(null)
      setContoursError(null)
      try {
        const contourData = await getSolarContours(res.id, res.layers.incident.contours_url)
        if (isCurrent()) {
          latestContours = contourData
          setContours(contourData)
          onSolarChange({ ...solar, simulationResult: res, contours: contourData, showContours: solar.showContours ?? true })
        }
      } catch (error) {
        if (isCurrent()) setContoursError(error instanceof Error ? error.message : 'No se pudieron cargar las isolíneas')
      } finally {
        if (isCurrent()) setContoursLoading(false)
      }
      setRunInvalidated(false)
      setRunInfo({ intensity })
      setAnalysis(null)
      setAnalysisError(null)
      setAnalysisLoading(true)
      try {
        const result = await getSolarAnalysis(res.id)
        if (isCurrent()) {
          latestAnalysis = result
          setAnalysis(result)
          onSolarChange({ ...solar, simulationResult: res, analysisResult: result, contours: latestContours, showContours: solar.showContours ?? true })
        }
      } catch (error) {
        if (isCurrent()) setAnalysisError(error instanceof Error ? error.message : 'No se pudo cargar el análisis')
      } finally {
        if (isCurrent()) setAnalysisLoading(false)
      }
      if (!isCurrent()) return
      const previewUrl = res.layers.incident.preview_url

      // Actualizar estado solar para renderizar el ráster en el mapa MapLibre
      onSolarChange({
        ...solar,
        rasterPreviewUrl: previewUrl,
        rasterBounds: res.preview?.bounds_lonlat ?? [w, s, e, n],
        showRasterOnMap: true,
        simulationResult: res,
        analysisResult: latestAnalysis,
        contours: latestContours,
        showContours: solar.showContours ?? true,
      })

      // Enfocar el mapa en el ráster generado, con un zoom acorde al radio
      onFlyToZone?.([cLon, cLat])
    } catch (err) {
      if (!isCurrent()) return
      const message = err instanceof Error ? err.message : 'Error al conectar con la API de simulación'
      setSimulationError(message)
    } finally {
      if (isCurrent()) setIsSimulating(false)
    }
  }

  // La exportación del histograma se genera únicamente desde sus bins estadísticos.
  const downloadHistogramPng = () => {
    if (!analysis) return
    const canvas = document.createElement('canvas')
    canvas.width = 960
    canvas.height = 480
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#172033'
    context.font = '20px sans-serif'
    context.fillText('Irradiancia (W/m²) · frecuencia (celdas válidas)', 32, 32)
    const peak = Math.max(1, ...analysis.histogram.counts)
    const width = 880 / Math.max(analysis.histogram.counts.length, 1)
    context.fillStyle = '#ef6c20'
    analysis.histogram.counts.forEach((count, index) => {
      const height = count / peak * 370
      context.fillRect(40 + index * width, 420 - height, Math.max(1, width - 2), height)
    })
    context.fillStyle = '#172033'
    context.font = '14px sans-serif'
    context.fillText(`${analysis.histogram.bin_edges[0]?.toFixed(0)} W/m²`, 40, 455)
    context.fillText(`${analysis.histogram.bin_edges.at(-1)?.toFixed(0)} W/m²`, 840, 455)
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'solar-histogram.png'
      link.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const handleToggleRasterOnMap = () => {
    onSolarChange({
      ...solar,
      showRasterOnMap: !(solar.showRasterOnMap ?? true),
    })
  }

  return (
    <aside ref={solarCard} tabIndex={-1} className={`solar-card${panelCollapsed ? ' is-collapsed' : ''}`} aria-label={t('Simulación Solar y Radiación (Inferno)', 'Solar simulation and irradiance (Inferno)')}>
      <div className="solar-card__header">
        <div>
          <h3 className="solar-card__title">
            <Sun size={14} className="solar-card__icon" aria-hidden="true" />
            {t('Simulador Solar & Radiación', 'Solar & irradiance simulator')}
          </h3>
          <p className="solar-card__subtitle">
            {t('Relieve DEM · irradiancia idealizada · Rampa', 'DEM terrain · idealized irradiance · Palette')} <strong>Inferno</strong>
          </p>
        </div>
        <div className="solar-card__header-actions">
        <button
          type="button"
          className="icon-btn icon-btn--xs solar-card__collapse"
          onClick={() => setPanelCollapsed(value => !value)}
          aria-expanded={!panelCollapsed}
          aria-controls="solar-card-body"
          aria-label={panelCollapsed ? t('Expandir panel solar', 'Expand solar panel') : t('Retraer panel solar', 'Collapse solar panel')}
          title={panelCollapsed ? t('Expandir panel solar', 'Expand solar panel') : t('Retraer panel solar', 'Collapse solar panel')}
        >
          {panelCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          onClick={onClose}
          title={t('Cerrar Simulación Solar', 'Close solar simulation')}
          aria-label={t('Cerrar Simulación Solar', 'Close solar simulation')}
        >
          <X size={14} />
        </button>
        </div>
      </div>

      <div id="solar-card-body" className="solar-card__body" hidden={panelCollapsed}>
      <div className="solar-zone-group">
        {runInvalidated && <p role="status">{t('La configuración cambió; los resultados anteriores se descartaron. Ejecuta de nuevo para actualizar.', 'Configuration changed; previous results were discarded. Run again to update.')}</p>}
        <p role="status" style={{ margin: '0 0 6px 0', fontSize: '11px', color: croppedRegion?.length ? '#166534' : '#64748b' }}>
          {croppedRegion?.length
            ? t('✓ Se calculará para la ROI delimitada y confirmada en este mapa.', '✓ Will be calculated for the confirmed ROI on this map.')
            : t('Delimita una ROI o elige una zona precargada para calcular:', 'Define an ROI or choose a preloaded zone to calculate:')}
        </p>
        <div>
          <select
            className="ws-rain-select"
            style={{ width: '100%', fontSize: '12px', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc' }}
            value={selectedPresetId}
            aria-label={t('ROI precargada opcional', 'Optional saved ROI')}
            onChange={(e) => {
              setSelectedPresetId(e.target.value)
              const preset = PRESET_ROI_CATALOG.find((p) => p.id === e.target.value)
              if (preset) {
                onSelectPresetROI?.(preset, { simulation: 'solar' })
                onFlyToZone?.(preset.center, preset.zoom)
              }
            }}
          >
            <option value="">{t('— ROI precargada opcional —', '— Optional saved ROI —')}</option>
            {roiStates.map(state => <optgroup key={state} label={state}>
              {PRESET_ROI_CATALOG.filter(preset => preset.state === state).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </optgroup>)}
          </select>
        </div>
      </div>

      <p className="solar-legend__note">{t('Escenario idealizado de irradiancia modelada; no es una medición en tiempo real.', 'Idealized modeled irradiance scenario; not a real-time measurement.')}</p>

      <figure className="solar-position-diagram">
        <svg viewBox="0 0 260 148" role="img" aria-label={t(`Sol ilustrativo: azimut ${azimuth} grados desde el norte, elevación ${elevation} grados`, `Illustrative sun: azimuth ${azimuth} degrees from north, elevation ${elevation} degrees`)}>
          <path d="M30 115a100 100 0 0 1 200 0" className="solar-position-diagram__dome" />
          <path d="M21 115h218" className="solar-position-diagram__horizon" />
          <path d="M83 115l24-19 13 9 19-25 24 22 14-12 23 25z" className="solar-position-diagram__terrain" />
          <path d={`M130 115L${domeX} ${domeY}`} className="solar-position-diagram__ray" />
          <circle cx={domeX} cy={domeY} r="10" className="solar-position-diagram__sun-glow" />
          <circle cx={domeX} cy={domeY} r="6" className="solar-position-diagram__sun" />
          <text x="20" y="137" textAnchor="start">{t('Este (90°)', 'East (90°)')}</text>
          <text x="130" y="137" textAnchor="middle">{t('Sur (180°)', 'South (180°)')}</text>
          <text x="240" y="137" textAnchor="end">{t('Oeste (270°)', 'West (270°)')}</text>
        </svg>
        <figcaption>
          <div className="solar-position-diagram__readouts">
            <span>{t('Azimut', 'Azimuth')} <strong>{azimuth}°</strong></span>
            <span>{t('Elevación', 'Elevation')} <strong>{elevation}°</strong></span>
          </div>
          <small>{t('ilustrativo, no trayectoria temporal/efemérides', 'illustrative, not a temporal trajectory/ephemeris')}</small>
        </figcaption>
      </figure>
      <details className="solar-advanced"><summary>{t('Ajustes avanzados', 'Advanced settings')}</summary>
      <div className="solar-control">
        <label htmlFor={elevationId}>{t('Elevación solar', 'Solar elevation')} <strong>{elevation}°</strong></label>
        <input id={elevationId} className="solar-control__range" type="range" min="0" max="90" step="1" value={elevation} style={{ '--solar-fill': `${elevation / 90 * 100}%` } as CSSProperties} onChange={event => {
          invalidateRun()
          onSolarChange({ ...solar, enabled: true, elevationDeg: Number(event.target.value), rasterPreviewUrl: null, rasterBounds: null })
        }} />
      </div>
      <div className="solar-control">
        <label htmlFor={azimuthId}>{t('Azimut (desde norte, horario)', 'Azimuth (from north, clockwise)')} <strong>{azimuth}°</strong></label>
        <input id={azimuthId} className="solar-control__range" type="range" min="0" max="360" step="1" value={azimuth} style={{ '--solar-fill': `${azimuth / 360 * 100}%` } as CSSProperties} onChange={event => {
          invalidateRun()
          onSolarChange({ ...solar, enabled: true, azimuthDeg: Number(event.target.value), rasterPreviewUrl: null, rasterBounds: null })
        }} />
      </div>
      <div className="solar-control">
        <label htmlFor={radId}>
          {t('Factor de intensidad adimensional', 'Dimensionless intensity factor')}
          <strong>{solar.radiationIntensity}% ({(solar.radiationIntensity / 100).toFixed(2)}×)</strong>
        </label>
        <input
          id={radId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={solar.radiationIntensity}
          onChange={(e) => {
            invalidateRun()
            onSolarChange({ ...solar, enabled: true, radiationIntensity: Number(e.target.value), rasterPreviewUrl: null, rasterBounds: null })
          }}
          className="solar-control__range"
          style={{ '--solar-fill': `${solar.radiationIntensity}%` } as CSSProperties}
        />
      </div>

      </details>

      {/* Barra de leyenda con gradiente exacto Inferno y valores en W/m² */}
      <div className="solar-legend">
        <div className="solar-legend__head">
          <span className="solar-legend__title">{t('Irradiancia incidente (Inferno)', 'Incident irradiance (Inferno)')}</span>

        </div>
        <div
          className="solar-legend__bar"
          style={{ background: infernoGradient }}
        />
        {simulationResult && upperWm2 > 0 ? (
          <>
            <div className="solar-legend__ticks">
              {ticks.map((t) => (
                <span key={t} style={{ left: `${(t / upperWm2) * 100}%` }}>
                  {t.toFixed(0)}
                </span>
              ))}
            </div>
            <small className="solar-legend__note">
              W/m² ·{' '}
              {t('0 a DNI ajustado ({max}); los valores exactos se consultan en el mapa', '0 to adjusted DNI ({max}); exact values can be sampled on the map', { max: upperWm2.toFixed(0) })}
            </small>
          </>
        ) : simulationResult ? <small className="solar-legend__note">{t('0 W/m² en todos los píxeles válidos', '0 W/m² in every valid pixel')}</small> : <small className="solar-legend__note">{t('Escala disponible después del cálculo', 'Scale available after simulation')}</small>}
      </div>

      {/* Botón de Ejecución API NASADEM Backend */}
      <div className="solar-api-section">
        <button
          type="button"
          className="solar-api-btn"
          disabled={isSimulating || !confirmedRoi}
          onClick={handleRunBackendSimulation}
          title={t('Ejecutar cálculo idealizado de irradiancia con NASADEM en backend para la ROI seleccionada', 'Run idealized irradiance calculation with NASADEM for the selected ROI')}
        >
          {isSimulating ? (
            <>
              <Loader2 size={13} className="spin" />
              <span>{t('Calculando física NASADEM...', 'Calculating NASADEM physics...')}</span>
            </>
          ) : (
            <>
              <Zap size={13} />
              <span>{t('Calcular Simulación en Mapa', 'Calculate simulation on map')}</span>
            </>
          )}
        </button>

        {simulationError && (
          <div className="solar-api-error">
            <AlertCircle size={13} />
            <span>{localizeText(simulationError)}</span>
          </div>
        )}

        {/* Capa superpuesta en el mapa */}
        {solar.rasterPreviewUrl && (
          <div className="solar-map-toggle">
            <button
              type="button"
              className={`solar-map-toggle__btn ${solarLayerVisible ? 'is-active' : ''}`}
              onClick={handleToggleRasterOnMap}
              title={t('Mostrar u ocultar la capa ráster de radiación en el mapa', 'Show or hide the irradiance raster on the map')}
            >
              {solarLayerVisible ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>
                {solarLayerVisible
                  ? t('Capa de Radiación en Mapa: Activa', 'Irradiance layer on map: active')
                  : solarOpacity === 0 && solar.showRasterOnMap !== false
                    ? t('Capa oculta: opacidad 0%', 'Layer hidden: 0% opacity')
                    : t('Capa en Mapa: Oculta', 'Map layer: hidden')}
              </span>
            </button>
            <button
              type="button"
              className="solar-map-toggle__fly"
              onClick={() => {
                if (solar.rasterBounds) {
                  const [w, s, e, n] = solar.rasterBounds
                  onFlyToZone?.([(w + e) / 2, (s + n) / 2], 13.5)
                }
              }}
              title={t('Enfocar mapa en el área calculada', 'Focus map on calculated area')}
            >
              <Layers size={12} />
              <span>{t('Enfocar', 'Focus')}</span>
            </button>
            <label className="solar-opacity-control">
              {t('Opacidad de capa incidente', 'Incident layer opacity')} {solarOpacity}%
              <input aria-label={t('Opacidad de capa incidente', 'Incident layer opacity')} type="range" min="0" max="100" value={solarOpacity} className="solar-control__range" onChange={event => onSolarOpacityChange?.(Number(event.target.value))} />
            </label>
          </div>
        )}
        {simulationResult && (
          <>
            <div className="solar-compact-summary">
              <strong>{t('Estimación del modelo', 'Model estimate')}</strong>
              <span>{t('DNI ajustado', 'Adjusted DNI')}: {fmtW(simulationResult.clear_sky.dni_adjusted_w_m2)}</span>
              {analysisError && <p role="alert">{t('Análisis GeoTIFF no disponible:', 'GeoTIFF analysis unavailable:')} {localizeText(analysisError)}</p>}
              <button ref={analysisTrigger} type="button" onClick={() => setAnalysisOpen(true)}>{t('Ver análisis completo', 'View full analysis')}</button>
            </div>
            {analysisOpen && createPortal(<div className="solar-analysis-backdrop">
              <div ref={analysisDialog} className={`solar-analysis-dialog${analysisCollapsed ? ' is-collapsed' : ''}`} role="dialog" aria-modal="true" aria-labelledby="solar-analysis-title" tabIndex={-1} onKeyDown={event => {
                if (event.key !== 'Tab') return
                const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])')
                const first = focusable[0], last = focusable[focusable.length - 1]
                if (event.shiftKey && (document.activeElement === first || document.activeElement === analysisDialog.current)) { event.preventDefault(); last?.focus() }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
              }}>
                <header className="solar-analysis-dialog__header"><h2 id="solar-analysis-title">{t('Análisis solar completo', 'Full solar analysis')}</h2><div className="solar-analysis-dialog__actions"><span role="status">{analysisCollapsed ? t('Análisis retraído · mapa disponible', 'Analysis collapsed · map available') : t('Análisis expandido', 'Analysis expanded')}</span><button type="button" onClick={() => setAnalysisCollapsed(value => !value)} aria-expanded={!analysisCollapsed} aria-controls="solar-analysis-content" aria-label={analysisCollapsed ? t('Expandir análisis', 'Expand analysis') : t('Retraer análisis', 'Collapse analysis')}>{analysisCollapsed ? <ChevronDown /> : <ChevronUp />}</button><button type="button" onClick={() => setAnalysisOpen(false)} aria-label={t('Cerrar análisis', 'Close analysis')}><X /></button></div></header>
                {!analysisCollapsed && <div id="solar-analysis-content"><nav className="solar-analysis-nav" aria-label={t('Secciones del análisis', 'Analysis sections')}>
                  {['Resumen y estadísticas', 'Distribución de irradiancia', 'Gráficas científicas', 'Capas y datos geoespaciales', 'Metadatos', 'Exportaciones'].map((label, index) => <button key={label} type="button" aria-current={analysisSection === index ? 'page' : undefined} onClick={() => setAnalysisSection(index)}>{t(label, ['Summary and statistics', 'Irradiance distribution', 'Available scientific charts', 'Layers and geospatial data', 'Metadata', 'Exports'][index])}</button>)}
                </nav>
                {analysisSection === 2 && <section aria-label={t('Gráficas científicas', 'Scientific charts')}>
                  <h3>{t('Gráficas científicas disponibles', 'Available scientific charts')}</h3>
                  <p>{t('No hay series temporales solares adicionales en la respuesta de esta corrida.', 'No additional solar time-series are available in this run response.')}</p>
                </section>}
                {analysisSection === 3 && <section aria-label={t('Capas y datos geoespaciales', 'Layers and geospatial data')}>
                  <h3>{t('Capas y datos geoespaciales', 'Layers and geospatial data')}</h3>
                  <label><input type="checkbox" checked={solar.showContours !== false} disabled={!contours} onChange={event => onSolarChange({ ...solar, showContours: event.target.checked })} /> {t('Mostrar isolíneas de irradiancia', 'Show irradiance contours')}</label>
                  {contoursLoading && <p role="status">{t('Cargando isolíneas de la corrida…', 'Loading run contours…')}</p>}
                  {contoursError && <p role="alert">{localizeText(contoursError)}</p>}
                  {contours && <><p>{t('Isolíneas de igual irradiancia; no representan flujo térmico.', 'Equal-irradiance contours; they do not represent heat flow.')}</p><ul>{contours.features.map((feature, index) => <li key={index}>{t('Valor de isolínea', 'Contour value')}: {String(feature.properties.value_w_m2 ?? '—')} {String(feature.properties.units ?? 'W/m2')}</li>)}</ul><a href={`data:application/geo+json;charset=utf-8,${encodeURIComponent(JSON.stringify(contours))}`} download="solar-contours.geojson">GeoJSON isolíneas</a></>}
                  <p>{t('Centro de cámara (solo vista)', 'Camera center (view only)')}: {center?.join(', ') ?? '—'}</p>
              <p>{t('Geometría persistida en la simulación', 'Geometry persisted in simulation')}: <code>{simulationResult.request?.roi ? JSON.stringify(simulationResult.request.roi) : t('No incluida en esta respuesta', 'Not included in this response')}</code></p>
              <p>{t('Límites del raster de respuesta', 'Response raster bounds')}: {simulationResult.preview?.bounds_lonlat.join(', ') ?? '—'}</p>
              <p>{t('Visibilidad', 'Visibility')}: {solarLayerVisible ? t('visible', 'visible') : t('oculta', 'hidden')} · {t('Opacidad visual', 'Visual opacity')}: {solarOpacity}%</p>
                  {simulationResult.preview && <p>{simulationResult.preview.crs} · {simulationResult.preview.width} × {simulationResult.preview.height} px · {simulationResult.preview.bounds_lonlat.join(', ')}</p>}
                  {solarSample?.loading && <p role="status">{t('Consultando muestra GeoTIFF…', 'Sampling GeoTIFF…')}</p>}
                  {solarSample?.error && <p role="alert">{localizeText(solarSample.error)}</p>}
                  {solarSample?.result ? <p>{t('Muestra GeoTIFF', 'GeoTIFF sample')}: {solarSample.result.status === 'valid' ? fmtW(solarSample.result.value_w_m2) : solarSample.result.status} ({solarSample.coordinate.join(', ')})</p> : !solarSample?.loading && <p>{t('Selecciona un píxel del mapa para consultar el GeoTIFF.', 'Select a map pixel to sample the GeoTIFF.')}</p>}
                  {simulationResult.layers.incident.preview_url && <img className="solar-api-preview-img" src={simulationResult.layers.incident.preview_url} alt={t('Vista previa visual; los valores exactos proceden del GeoTIFF', 'Visual preview; exact values come from the GeoTIFF')} />}
                </section>}
                {analysisSection === 4 && <section aria-label={t('Metadatos exactos de la respuesta', 'Exact response metadata')}>
                  <h3>{t('Metadatos de la respuesta', 'Response metadata')}</h3>
                  <dl className="solar-metadata"><dt>ID</dt><dd>{simulationResult.id}</dd><dt>{t('Estado', 'Status')}</dt><dd>{simulationResult.status}</dd><dt>{t('Modelo', 'Model')}</dt><dd>{simulationResult.model}</dd><dt>{t('Unidades', 'Units')}</dt><dd>{simulationResult.units}</dd><dt>{t('Elevación usada', 'Elevation used')}</dt><dd>{simulationResult.request?.elevation_deg ?? elevation}°</dd><dt>{t('Azimut usado (norte, horario)', 'Azimuth used (north, clockwise)')}</dt><dd>{simulationResult.request?.azimuth_deg ?? azimuth}°</dd><dt>{t('Factor de intensidad', 'Intensity factor')}</dt><dd>{simulationResult.request?.intensity_percent ?? runInfo?.intensity ?? solar.radiationIntensity}% · adimensional</dd><dt>code_version</dt><dd>{'code_version' in simulationResult ? String(simulationResult.code_version ?? '—') : t('No incluida en la respuesta', 'Not included in response')}</dd></dl>
                </section>}
                {analysisSection === 0 && <div className="solar-api-results">
            <div className="solar-api-results__header">
              <CheckCircle2 size={13} className="solar-api-results__ok" />
              <span className="solar-api-results__title">{t('Cálculo Físico Concluido', 'Physical calculation complete')}</span>
            </div>

            {runInfo && runInfo.intensity !== Math.max(0, Math.min(100, Math.round(solar.radiationIntensity))) && (
              <div className="solar-api-stale" role="status">
                {t('Elegiste {chosen}% de radiación; estos resultados son de {previous}%. Pulsa «Calcular» para actualizar.', 'You selected {chosen}% irradiance; these results are for {previous}%. Click “Calculate” to update.', { chosen: solar.radiationIntensity, previous: runInfo.intensity })}
              </div>
            )}
            <div className="solar-api-grid">
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">{t('Factor de intensidad adimensional', 'Dimensionless intensity factor')}</span>
                <span className="solar-api-stat__val">{runInfo ? `${runInfo.intensity}% (${(runInfo.intensity / 100).toFixed(2)}×)` : '—'}</span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">{t('DNI cielo despejado', 'Clear-sky DNI')}</span>
                <span className="solar-api-stat__val">
                  {simulationResult.clear_sky.dni_clear_sky_w_m2.toFixed(1)} W/m²
                </span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">{t('DNI Ajustado', 'Adjusted DNI')}</span>
                <span className="solar-api-stat__val">
                  {simulationResult.clear_sky.dni_adjusted_w_m2.toFixed(1)} W/m²
                </span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">{t('Elevación configurada', 'Configured elevation')}</span>
                <span className="solar-api-stat__val">{(simulationResult.request?.elevation_deg ?? elevation).toFixed(1)}°</span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">{t('Azimut configurado (norte, horario)', 'Configured azimuth (north, clockwise)')}</span>
                <span className="solar-api-stat__val">{(simulationResult.request?.azimuth_deg ?? azimuth).toFixed(1)}°</span>
              </div>
              {simulationResult.request?.elevation_deg === undefined && typeof simulationResult.position.geometric_elevation_deg === 'number' && <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Elevación geométrica histórica (SPA; no es parámetro de esta simulación)', 'Historical geometric elevation (SPA; not a parameter of this simulation)')}</span><span className="solar-api-stat__val">{simulationResult.position.geometric_elevation_deg.toFixed(1)}°</span></div>}
              {runInfo && <div className="solar-api-stat"><span className="solar-api-stat__label">{t('ROI calculada', 'Calculated ROI')}</span><span className="solar-api-stat__val">{t('ROI confirmada', 'Confirmed ROI')}</span></div>}
              {analysis && <>
                <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Mín / Máx', 'Min / Max')}</span><span className="solar-api-stat__val">{fmtW(analysis.statistics.min)} / {fmtW(analysis.statistics.max)}</span></div>
                <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Media / Mediana', 'Mean / Median')}</span><span className="solar-api-stat__val">{fmtW(analysis.statistics.mean)} / {fmtW(analysis.statistics.median)}</span></div>
                <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Celdas válidas', 'Valid cells')}</span><span className="solar-api-stat__val">{analysis.valid_cells.toLocaleString(locale)}</span></div>
              </>}
            </div>
            <small className="solar-legend__note">{t('Las cifras son estadísticas del GeoTIFF; la vista PNG cuantizada no se usa para derivar valores.', 'Values are GeoTIFF statistics; the quantized PNG preview is not used to derive values.')}</small>
            </div>}
            {analysisSection === 1 && <section className="solar-analysis" aria-label={t('Distribución de irradiancia', 'Irradiance distribution')}>
              {analysisLoading && <p role="status">{t('Cargando análisis del GeoTIFF…', 'Loading GeoTIFF analysis…')}</p>}
              {analysisError && <p role="alert">{localizeText(analysisError)}</p>}
              {analysis && <><h4>{t('Distribución de irradiancia (W/m²)', 'Irradiance distribution (W/m²)')}</h4>
              <div className="solar-analysis__bars" role="img" aria-label={t('Histograma: irradiancia en W/m², frecuencia en celdas', 'Histogram: irradiance in W/m², frequency in cells')}>
                {analysis.histogram.counts.map((count, index) => {
                  const peak = Math.max(1, ...analysis.histogram.counts)
                  return <span key={index} title={`${analysis.histogram.bin_edges[index]}–${analysis.histogram.bin_edges[index + 1]} W/m²: ${count} celdas`} style={{ height: `${count / peak * 100}%` }} />
                })}
              </div>
              <div className="solar-analysis__axis"><span>{analysis.histogram.bin_edges[0]?.toFixed(0)} W/m²</span><span>{analysis.histogram.bin_edges.at(-1)?.toFixed(0)} W/m²</span></div>
              <small>{t('Eje X: irradiancia (W/m²); eje Y: número de celdas válidas. Barras altas indican más terreno en ese intervalo; el histograma resume la distribución y no muestra la ubicación espacial.', 'X-axis: irradiance (W/m²); Y-axis: number of valid cells. Taller bars indicate more terrain in that interval; the histogram summarizes distribution, not spatial location.')}</small>
              <small>{t('Resolución', 'Resolution')} {analysis.resolution.map(value => value.toFixed(2)).join(' × ')} {t('unidades del CRS', 'CRS units')}</small>
              <p>{t('La media de irradiancia incidente dividida por la DNI ajustada compara el terreno con la irradiancia normal de entrada; no equivale a una eficiencia del sistema.', 'Mean incident irradiance divided by adjusted DNI compares terrain incidence with normal input irradiance; it is not system efficiency.')}: {analysis.statistics.mean !== null && simulationResult.clear_sky.dni_adjusted_w_m2 > 0 ? (analysis.statistics.mean / simulationResult.clear_sky.dni_adjusted_w_m2).toFixed(3) : '—'}</p></>}
            </section>}

            {analysisSection === 5 && <section aria-label={t('Exportaciones', 'Exports')}><h3>{t('Exportaciones existentes', 'Existing exports')}</h3><div className="solar-api-actions">
              <a
                href={simulationResult.layers.incident.export_url}
                download="incident.tif"
                className="solar-api-link"
                title={t('Descargar GeoTIFF Float32 con la irradiancia incidente calculada', 'Download Float32 GeoTIFF with calculated incident irradiance')}
              >
                <Download size={12} />
                <span>incident.tif</span>
              </a>
              <a href={simulationResult.layers.incident.preview_url} download="incident-preview.png" className="solar-api-link">{t('Vista previa PNG', 'Preview PNG')}</a>
              {analysis && <>
                <a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(analysis, null, 2))}`} download="solar-statistics.json" className="solar-api-link">JSON</a>
                <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`statistic,value_w_m2,bin_start_w_m2,bin_end_w_m2,cells\nminimum,${analysis.statistics.min ?? ''},,,\nmaximum,${analysis.statistics.max ?? ''},,,\nmean,${analysis.statistics.mean ?? ''},,,\nmedian,${analysis.statistics.median ?? ''},,,\n${analysis.histogram.counts.map((count, i) => `,,${analysis.histogram.bin_edges[i]},${analysis.histogram.bin_edges[i + 1]},${count}`).join('\n')}`)}`} download="solar-statistics.csv" className="solar-api-link">CSV</a>
                <button type="button" className="solar-api-link" onClick={downloadHistogramPng}>PNG histograma</button>
                <a href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><text x="20" y="20">Irradiancia (W/m²) · frecuencia (celdas)</text>${analysis.histogram.counts.map((count, i) => `<rect x="${30 + i * (580 / analysis.histogram.counts.length)}" y="${290 - (count / Math.max(1, ...analysis.histogram.counts)) * 250}" width="${Math.max(1, 560 / analysis.histogram.counts.length)}" height="${(count / Math.max(1, ...analysis.histogram.counts)) * 250}" fill="#ef6c20"/>`).join('')}</svg>`)}`} download="solar-histogram.svg" className="solar-api-link">SVG histograma</a>
              </>}
            </div></section>}
                </div>}
              </div>
            </div>, document.body)}
          </>
        )}

      </div>
      </div>
    </aside>
  )
}
