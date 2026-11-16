import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Sun,
  X,
  Zap,
} from 'lucide-react'
import type { LngLat, SolarSimulationState } from '../types/workspace'
import { confirmedSolarRoi } from '../utils/solarRoi'
import { getColormapSpec } from '../utils/colormapLut'
import { runSolarSimulation, type SolarSimulationResponse } from '../api/client'
import { RoiChartsSection } from './RoiChartsSection'
import type { RoiLayersState } from '../hooks/useRoiLayers'
import {
  legendTicks,
  loadHeatmap,
  renderHeatmap,
  scaleFor,
  type DecodedHeatmap,
  type HeatmapScaleMode,
} from '../utils/solarHeatmap'

const fmtW = (v: number) => (Number.isFinite(v) ? `${v.toFixed(0)} W/m²` : '—')

interface SolarPanelProps {
  solar: SolarSimulationState
  onSolarChange: (next: SolarSimulationState) => void
  onClose: () => void
  center?: LngLat
  croppedRegion?: LngLat[] | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
  /** Capas y gráficas NISAR de la ROI dibujada (se generan solas con /api/roi-jobs). */
  roiLayers?: RoiLayersState
}

/** Convierte el ángulo solar [0..180] en hora solar (06:00 a 18:00). */
function formatSolarHour(angleDeg: number): string {
  const totalMinutes = Math.round(6 * 60 + (angleDeg / 180) * 12 * 60)
  const hh = Math.floor(totalMinutes / 60)
  const mm = totalMinutes % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Coordenadas (x, y) de la esfera del Sol sobre el arco Este -> Oeste. */
function sunArcCoords(angleDeg: number): { x: number; y: number } {
  const cx = 130
  const cy = 96
  const r = 78
  const rad = ((180 - angleDeg) * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  }
}

export function RightPanel({
  solar,
  onSolarChange,
  onClose,
  croppedRegion,
  onFlyToZone,
  roiLayers,
}: SolarPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResult, setSimulationResult] = useState<SolarSimulationResponse | null>(null)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [heatmap, setHeatmap] = useState<DecodedHeatmap | null>(null)
  const [runInfo, setRunInfo] = useState<{ intensity: number } | null>(null)
  const [simulationDate, setSimulationDate] = useState(() =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
  )
  const requestVersion = useRef(0)
  const roiKey = JSON.stringify(croppedRegion ?? null)
  useEffect(() => {
    const versionRef = requestVersion
    versionRef.current++
    return () => { versionRef.current++ }
  }, [roiKey])
  const heatmapMode: HeatmapScaleMode = solar.heatmapMode ?? 'estirado'
  const upperWm2 = simulationResult?.clear_sky.dni_adjusted_w_m2 ?? 0
  const [vmin, vmax] = heatmap ? scaleFor(heatmapMode, heatmap.stats, upperWm2) : [0, 0]
  const ticks = heatmap ? legendTicks(vmin, vmax) : []

  const angleId = useId()
  const radId = useId()
  const infernoSpec = getColormapSpec('inferno')

  const { x: sunX, y: sunY } = sunArcCoords(solar.sunAngle)

  const updateAngleFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * 260
    const relY = ((e.clientY - rect.top) / rect.height) * 116
    const dx = relX - 130
    const dy = Math.max(2, 96 - relY)
    const theta = Math.atan2(dy, dx)
    const angle = Math.round(Math.max(0, Math.min(180, 180 - (theta * 180) / Math.PI)))
    onSolarChange({
      ...solar,
      enabled: true,
      sunAngle: angle,
      radiationIntensity: solar.radiationIntensity === 0 ? 65 : solar.radiationIntensity,
    })
  }

  const handleRunBackendSimulation = async () => {
    const version = ++requestVersion.current
    const isCurrent = () => requestVersion.current === version
    setIsSimulating(true)
    setSimulationError(null)

    try {
      // Use the confirmed polygon, not a preselected place or an invented square.
      const roiPolygon = confirmedSolarRoi(croppedRegion ?? null)
      const lons = roiPolygon.coordinates[0].map(([lon]) => lon)
      const lats = roiPolygon.coordinates[0].map(([, lat]) => lat)
      const w = Math.min(...lons), s = Math.min(...lats), e = Math.max(...lons), n = Math.max(...lats)
      const cLon = (w + e) / 2, cLat = (s + n) / 2

      // 2. Mapear ángulo a hora local
      const totalMinutes = Math.round(6 * 60 + (solar.sunAngle / 180) * 12 * 60)
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
      const mm = String(totalMinutes % 60).padStart(2, '0')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(simulationDate)) throw new Error('Seleccioná una fecha para simular.')
      const datetimeLocal = `${simulationDate}T${hh}:${mm}:00`

      const intensity = Math.max(1, Math.min(100, Math.round(solar.radiationIntensity || 65)))

      const res = await runSolarSimulation({
        roi: roiPolygon,
        datetime_local: datetimeLocal,
        timezone: 'America/Mexico_City',
        intensity_percent: intensity,
      })
      if (!isCurrent()) return

      setSimulationResult(res)
      setRunInfo({ intensity })

      // Recuperar W/m² del PNG Inferno y redibujarlo con más contraste; si falla, usar el PNG original.
      let previewUrl = res.layers.incident.preview_url
      try {
        const decoded = await loadHeatmap(res.layers.incident.preview_url, res.clear_sky.dni_adjusted_w_m2)
        if (!isCurrent()) return
        const [lo, hi] = scaleFor(heatmapMode, decoded.stats, res.clear_sky.dni_adjusted_w_m2)
        previewUrl = renderHeatmap(decoded, lo, hi).dataUrl
        setHeatmap(decoded)
      } catch {
        if (!isCurrent()) return
        setHeatmap(null)
      }
      if (!isCurrent()) return

      // Actualizar estado solar para renderizar el ráster en el mapa MapLibre
      onSolarChange({
        ...solar,
        rasterPreviewUrl: previewUrl,
        rasterBounds: res.preview?.bounds_lonlat ?? [w, s, e, n],
        showRasterOnMap: true,
      })

      // Enfocar el mapa en el ráster generado, con un zoom acorde al radio
      onFlyToZone?.([cLon, cLat])
    } catch (err) {
      if (!isCurrent()) return
      setSimulationError(
        err instanceof Error ? err.message : 'Error al conectar con la API de simulación'
      )
    } finally {
      if (isCurrent()) setIsSimulating(false)
    }
  }

  // Cambiar la escala vuelve a dibujar el mapa sin recalcular la física.
  const lastMode = useRef(heatmapMode)
  useEffect(() => {
    if (!heatmap || !simulationResult || lastMode.current === heatmapMode) return
    lastMode.current = heatmapMode
    const [lo, hi] = scaleFor(heatmapMode, heatmap.stats, simulationResult.clear_sky.dni_adjusted_w_m2)
    onSolarChange({ ...solar, rasterPreviewUrl: renderHeatmap(heatmap, lo, hi).dataUrl })
  }, [heatmapMode, heatmap, simulationResult, solar, onSolarChange])

  const handleToggleRasterOnMap = () => {
    onSolarChange({
      ...solar,
      showRasterOnMap: !(solar.showRasterOnMap ?? true),
    })
  }

  return (
    <aside className="solar-card" aria-label="Simulación Solar y Radiación (Inferno)">
      <div className="solar-card__header">
        <div>
          <h3 className="solar-card__title">
            <Sun size={14} className="solar-card__icon" aria-hidden="true" />
            Simulador Solar & Radiación
          </h3>
          <p className="solar-card__subtitle">
            Relieve DEM · NREL SPA · Rampa <strong>Inferno</strong>
          </p>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          onClick={onClose}
          title="Cerrar Simulación Solar"
          aria-label="Cerrar Simulación Solar"
        >
          <X size={14} />
        </button>
      </div>

      <div className="solar-zone-group">
        <p role="status">{croppedRegion?.length ? 'Se calculará únicamente para la ROI delimitada y confirmada en este mapa.' : 'Delimitá y confirmá una ROI antes de calcular la simulación.'}</p>
      </div>

      {/* Recuadro técnico con arco Este a Oeste y esfera solar arrastrable */}
      <div className="solar-arc-box">
        <svg
          ref={svgRef}
          className={`solar-arc-svg ${dragging ? 'is-dragging' : ''}`}
          viewBox="0 0 260 116"
          role="slider"
          aria-label="Arco solar interactivo de Este a Oeste"
          aria-valuemin={0}
          aria-valuemax={180}
          aria-valuenow={solar.sunAngle}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging(true)
            updateAngleFromPointer(e)
          }}
          onPointerMove={(e) => {
            if (dragging) updateAngleFromPointer(e)
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
        >
          {/* Línea de horizonte */}
          <line x1={32} y1={96} x2={228} y2={96} stroke="#94A3B8" strokeWidth={1.5} />

          {/* Arco punteado completo Este -> Oeste */}
          <path
            d="M 52 96 A 78 78 0 0 1 208 96"
            fill="none"
            stroke="#64748B"
            strokeWidth={1.6}
            strokeDasharray="4 4"
          />

          {/* Tramo recorrido del Sol */}
          <path
            d={`M 52 96 A 78 78 0 0 1 ${sunX.toFixed(1)} ${sunY.toFixed(1)}`}
            fill="none"
            stroke="#DD513A"
            strokeWidth={2.4}
          />

          {/* Rayo proyectado hacia el relieve central */}
          <line
            x1={sunX}
            y1={sunY}
            x2={130}
            y2={96}
            stroke="#FCA50A"
            strokeWidth={1.4}
            strokeDasharray="3 3"
          />

          {/* Silueta técnica del relieve */}
          <polygon
            points="96,96 114,80 128,89 144,74 166,96"
            fill="#CBD5E1"
            stroke="#475569"
            strokeWidth={1.2}
          />

          {/* Halo y esfera solar */}
          <circle cx={sunX} cy={sunY} r={12} fill="rgba(252, 165, 10, 0.25)" />
          <circle
            cx={sunX}
            cy={sunY}
            r={7.5}
            fill="#FCA50A"
            stroke="#932667"
            strokeWidth={1.6}
          />

          {/* Etiquetas Este / Mediodía / Oeste */}
          <text x={52} y={111} textAnchor="middle" className="solar-arc-svg__label">
            Este (06:00)
          </text>
          <text x={130} y={12} textAnchor="middle" className="solar-arc-svg__label">
            Cenit ({formatSolarHour(solar.sunAngle)})
          </text>
          <text x={208} y={111} textAnchor="middle" className="solar-arc-svg__label">
            Oeste (18:00)
          </text>
        </svg>
      </div>

      {/* Deslizador 1: Ángulo del Sol / Hora */}
      <div className="solar-control">
        <label htmlFor="solar-simulation-date" className="opacity-control__label">Fecha de simulación (hora local de Chiapas)</label>
        <input id="solar-simulation-date" type="date" value={simulationDate} onChange={(event) => {
          requestVersion.current++
          setSimulationDate(event.target.value)
          setSimulationResult(null)
          setRunInfo(null)
          setHeatmap(null)
          setIsSimulating(false)
          onSolarChange({ ...solar, rasterPreviewUrl: null, rasterBounds: null })
        }} />
      </div>

      <div className="solar-control">
        <div className="opacity-control__header">
          <label htmlFor={angleId} className="opacity-control__label">
            Ángulo Solar / Hora Local
          </label>
          <span className="opacity-control__value">
            {formatSolarHour(solar.sunAngle)} ({solar.sunAngle}°)
          </span>
        </div>
        <input
          id={angleId}
          type="range"
          min={0}
          max={180}
          step={1}
          value={solar.sunAngle}
          onChange={(e) =>
            onSolarChange({
              ...solar,
              enabled: true,
              sunAngle: Number(e.target.value),
            })
          }
          className="slider slider--sun"
          style={{ '--slider-fill': `${(solar.sunAngle / 180) * 100}%` } as CSSProperties}
        />
      </div>

      {/* Deslizador 2: Intensidad de Calor / Radiación */}
      <div className="solar-control">
        <div className="opacity-control__header">
          <label htmlFor={radId} className="opacity-control__label">
            Intensidad de Radiación (Inferno)
          </label>
          <span className="opacity-control__value">{solar.radiationIntensity}%</span>
        </div>
        <input
          id={radId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={solar.radiationIntensity}
          onChange={(e) =>
            onSolarChange({
              ...solar,
              enabled: true,
              radiationIntensity: Number(e.target.value),
            })
          }
          className="slider slider--sun"
          style={{ '--slider-fill': `${solar.radiationIntensity}%` } as CSSProperties}
        />
      </div>

      {/* Barra de leyenda con gradiente exacto Inferno y valores en W/m² */}
      <div className="solar-legend">
        <div className="solar-legend__head">
          <span className="solar-legend__title">Irradiancia incidente (Inferno)</span>
          {heatmap && (
            <div className="solar-legend__modes" role="radiogroup" aria-label="Escala de color">
              {(['estirado', 'absoluto'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={heatmapMode === mode}
                  className={`solar-radius__btn ${heatmapMode === mode ? 'is-active' : ''}`}
                  onClick={() => onSolarChange({ ...solar, heatmapMode: mode })}
                  title={
                    mode === 'estirado'
                      ? 'Percentiles 2–98 de esta simulación: distingue mejor el relieve'
                      : '0 a DNI ajustado: comparable entre horas'
                  }
                >
                  {mode === 'estirado' ? 'Contraste' : 'Absoluta'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="solar-legend__bar"
          style={{ background: infernoSpec.cssGradientHorizontal }}
        />
        {heatmap && vmax > vmin ? (
          <>
            <div className="solar-legend__ticks">
              {ticks.map((t) => (
                <span key={t} style={{ left: `${((t - vmin) / (vmax - vmin)) * 100}%` }}>
                  {t.toFixed(0)}
                </span>
              ))}
            </div>
            <small className="solar-legend__note">
              W/m² ·{' '}
              {heatmapMode === 'estirado'
                ? `p2–p98 de esta simulación (${vmin.toFixed(0)}–${vmax.toFixed(0)}); los extremos se saturan`
                : `0 a DNI ajustado (${vmax.toFixed(0)}), comparable entre horas`}
            </small>
          </>
        ) : (
          <div className="solar-legend__labels">
            <span>Menor radiación</span>
            <span>Media</span>
            <span>Mayor radiación</span>
          </div>
        )}
      </div>

      {/* Botón de Ejecución API NASADEM Backend */}
      <div className="solar-api-section">
        <button
          type="button"
          className="solar-api-btn"
          disabled={isSimulating || !croppedRegion || croppedRegion.length < 3 || !simulationDate}
          onClick={handleRunBackendSimulation}
          title="Ejecutar cálculo de radiación con NASADEM y NREL SPA en backend para la ROI seleccionada"
        >
          {isSimulating ? (
            <>
              <Loader2 size={13} className="spin" />
              <span>Calculando física NASADEM...</span>
            </>
          ) : (
            <>
              <Zap size={13} />
              <span>Calcular Simulación en Mapa</span>
            </>
          )}
        </button>

        {simulationError && (
          <div className="solar-api-error">
            <AlertCircle size={13} />
            <span>{simulationError}</span>
          </div>
        )}

        {/* Capa superpuesta en el mapa */}
        {solar.rasterPreviewUrl && (
          <div className="solar-map-toggle">
            <button
              type="button"
              className={`solar-map-toggle__btn ${solar.showRasterOnMap !== false ? 'is-active' : ''}`}
              onClick={handleToggleRasterOnMap}
              title="Mostrar u ocultar la capa ráster de radiación en el mapa"
            >
              {solar.showRasterOnMap !== false ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>
                {solar.showRasterOnMap !== false
                  ? 'Capa de Radiación en Mapa: Activa'
                  : 'Capa en Mapa: Oculta'}
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
              title="Enfocar mapa en el área calculada"
            >
              <Layers size={12} />
              <span>Enfocar</span>
            </button>
          </div>
        )}

        {simulationResult && (
          <div className="solar-api-results">
            <div className="solar-api-results__header">
              <CheckCircle2 size={13} className="solar-api-results__ok" />
              <span className="solar-api-results__title">Cálculo Físico Concluido</span>
            </div>

            {runInfo && runInfo.intensity !== Math.max(1, Math.min(100, Math.round(solar.radiationIntensity || 65))) && (
              <div className="solar-api-stale" role="status">
                Elegiste {solar.radiationIntensity}% de radiación; estos resultados son de {runInfo.intensity}%.
                Pulsa «Calcular» para actualizar.
              </div>
            )}
            <div className="solar-api-grid">
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">Radiación elegida</span>
                <span className="solar-api-stat__val">{runInfo ? `${runInfo.intensity}%` : '—'}</span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">DNI cielo despejado</span>
                <span className="solar-api-stat__val">
                  {simulationResult.clear_sky.dni_clear_sky_w_m2.toFixed(1)} W/m²
                </span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">DNI Ajustado</span>
                <span className="solar-api-stat__val">
                  {simulationResult.clear_sky.dni_adjusted_w_m2.toFixed(1)} W/m²
                </span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">Elevación Solar</span>
                <span className="solar-api-stat__val">
                  {simulationResult.position.apparent_elevation_deg.toFixed(1)}°
                </span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">Azimut</span>
                <span className="solar-api-stat__val">
                  {simulationResult.position.azimuth_deg.toFixed(1)}°
                </span>
              </div>
              <div className="solar-api-stat">
                <span className="solar-api-stat__label">Altitud DEM</span>
                <span className="solar-api-stat__val">
                  {simulationResult.position.altitude_m.toFixed(0)} m (EGM96)
                </span>
              </div>
              {runInfo && <div className="solar-api-stat"><span className="solar-api-stat__label">Zona calculada</span><span className="solar-api-stat__val">ROI delimitada por el usuario</span></div>}
              {heatmap && (
                <>
                  <div className="solar-api-stat">
                    <span className="solar-api-stat__label">Incidente mín / máx</span>
                    <span className="solar-api-stat__val">
                      {heatmap.stats.min.toFixed(0)} / {fmtW(heatmap.stats.max)}
                    </span>
                  </div>
                  <div className="solar-api-stat">
                    <span className="solar-api-stat__label">Incidente mediana / media</span>
                    <span className="solar-api-stat__val">
                      {heatmap.stats.p50.toFixed(0)} / {fmtW(heatmap.stats.mean)}
                    </span>
                  </div>
                </>
              )}
            </div>
            {heatmap && (
              <small className="solar-legend__note">
                Valores leídos del PNG de 256 colores (±{heatmap.stats.halfStep.toFixed(1)} W/m²) sobre{' '}
                {heatmap.stats.validPixels.toLocaleString('es-MX')} píxeles; los exactos están en incident.tif.
              </small>
            )}

            {/* Acciones de exportación */}
            <div className="solar-api-actions">
              <a
                href={simulationResult.layers.incident.export_url}
                download="incident.tif"
                className="solar-api-link"
                title="Descargar GeoTIFF Float32 con la irradiancia incidente calculada"
              >
                <Download size={12} />
                <span>incident.tif</span>
              </a>
              <a
                href={simulationResult.layers.incident.preview_url}
                target="_blank"
                rel="noreferrer"
                className="solar-api-link"
                title="Abrir imagen de previsualización en alta resolución"
              >
                <ExternalLink size={12} />
                <span>Preview PNG</span>
              </a>
            </div>

            {/* Thumbnail visual */}
            {simulationResult.layers.incident.preview_url && (
              <div className="solar-api-preview-box">
                <img
                  src={simulationResult.layers.incident.preview_url}
                  alt="Previsualización de radiación solar calculada"
                  className="solar-api-preview-img"
                />
              </div>
            )}
          </div>
        )}

        {/* Gráficas NISAR de la ROI: ángulo de incidencia, retrodispersión γ⁰ y máscara QA de subfranja */}
        {roiLayers && croppedRegion && (
          <section className="solar-roi-charts" aria-label="Gráficas NISAR de la ROI">
            <RoiChartsSection roiLayers={roiLayers} region={croppedRegion} compact />
          </section>
        )}
      </div>
    </aside>
  )
}
