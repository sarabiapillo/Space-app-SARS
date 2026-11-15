import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  MapPin,
  Sun,
  X,
  Zap,
} from 'lucide-react'
import type { LngLat, SolarSimulationState } from '../types/workspace'
import { getColormapSpec } from '../utils/colormapLut'
import { runSolarSimulation, type SolarSimulationResponse } from '../api/client'

export interface SolarZoneOption {
  id: string
  name: string
  shortLabel: string
  center: LngLat
  zoom: number
  description: string
  bbox?: [number, number, number, number] // [west, south, east, north]
}

export const SOLAR_PRESET_ZONES: readonly SolarZoneOption[] = [
  {
    id: 'sumidero',
    name: 'ROI Principal: Cañón del Sumidero (Chiapas)',
    shortLabel: 'Sumidero (ROI Oficial)',
    center: [-93.0901, 16.7600],
    zoom: 13,
    description: 'Relieve escarpado del Cañón del Sumidero (ROI oficial NISAR)',
    bbox: [-93.1081, 16.7420, -93.0721, 16.7780],
  },
  {
    id: 'chicoasen',
    name: 'Presa Chicoasén (M. Moreno Torres)',
    shortLabel: 'Presa Chicoasén',
    center: [-93.1380, 16.9450],
    zoom: 13,
    description: 'Cañón profundo y central hidroeléctrica de gran desnivel',
    bbox: [-93.1560, 16.9270, -93.1200, 16.9630],
  },
  {
    id: 'tuxtla',
    name: 'Valle de Tuxtla Gutiérrez',
    shortLabel: 'Tuxtla Gutiérrez',
    center: [-93.1180, 16.7530],
    zoom: 13,
    description: 'Cuenca urbana y meseta central chiapaneca',
    bbox: [-93.1360, 16.7350, -93.1000, 16.7710],
  },
  {
    id: 'sancristobal',
    name: 'Altos de Chiapas (San Cristóbal)',
    shortLabel: 'Altos de Chiapas',
    center: [-92.6370, 16.7370],
    zoom: 13,
    description: 'Macizo montañoso de alta elevación (~2,200 m)',
    bbox: [-92.6550, 16.7190, -92.6190, 16.7550],
  },
  {
    id: 'current_view',
    name: 'Vista actual en el mapa',
    shortLabel: 'Vista Actual',
    center: [-93.0901, 16.7600],
    zoom: 13,
    description: 'Calcula la simulación centrada en la cámara visible',
  },
  {
    id: 'custom_roi',
    name: 'Polígono de Recorte ROI (Manual)',
    shortLabel: 'Recorte Manual',
    center: [-93.0901, 16.7600],
    zoom: 13,
    description: 'Centrado en el polígono trazado con la herramienta de recorte',
  },
]

interface SolarPanelProps {
  solar: SolarSimulationState
  onSolarChange: (next: SolarSimulationState) => void
  onClose: () => void
  center?: LngLat
  croppedRegion?: LngLat[] | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
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
  center,
  croppedRegion,
  onFlyToZone,
}: SolarPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResult, setSimulationResult] = useState<SolarSimulationResponse | null>(null)
  const [simulationError, setSimulationError] = useState<string | null>(null)

  const selectedZoneId = solar.selectedZoneId || 'sumidero'
  const currentZone =
    SOLAR_PRESET_ZONES.find((z) => z.id === selectedZoneId) || SOLAR_PRESET_ZONES[0]

  const angleId = useId()
  const radId = useId()
  const zoneSelectId = useId()
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

  const handleSelectZone = (zoneId: string) => {
    const targetZone = SOLAR_PRESET_ZONES.find((z) => z.id === zoneId)
    if (!targetZone) return

    onSolarChange({
      ...solar,
      selectedZoneId: zoneId,
    })

    if (zoneId === 'current_view') {
      // No vuela, se queda en la vista actual
      return
    }

    if (zoneId === 'custom_roi' && croppedRegion && croppedRegion.length >= 3) {
      const cLon = croppedRegion.reduce((acc, p) => acc + p[0], 0) / croppedRegion.length
      const cLat = croppedRegion.reduce((acc, p) => acc + p[1], 0) / croppedRegion.length
      onFlyToZone?.([cLon, cLat], 13.5)
      return
    }

    // Vuela a la zona predefinida
    onFlyToZone?.(targetZone.center, targetZone.zoom)
  }

  const handleRunBackendSimulation = async () => {
    setIsSimulating(true)
    setSimulationError(null)

    try {
      // 1. Determinar centro y coordenadas de la zona seleccionada
      let cLon = currentZone.center[0]
      let cLat = currentZone.center[1]

      if (selectedZoneId === 'current_view' && center) {
        cLon = center[0]
        cLat = center[1]
      } else if (selectedZoneId === 'custom_roi' && croppedRegion && croppedRegion.length >= 3) {
        cLon = croppedRegion.reduce((acc, p) => acc + p[0], 0) / croppedRegion.length
        cLat = croppedRegion.reduce((acc, p) => acc + p[1], 0) / croppedRegion.length
      }

      const delta = 0.018 // ~2km radio (4km x 4km box, diagonal ~5.7km, strictly within NASADEM limits)
      const roiPolygon: number[][][] = [[
        [Number((cLon - delta).toFixed(5)), Number((cLat - delta).toFixed(5))],
        [Number((cLon + delta).toFixed(5)), Number((cLat - delta).toFixed(5))],
        [Number((cLon + delta).toFixed(5)), Number((cLat + delta).toFixed(5))],
        [Number((cLon - delta).toFixed(5)), Number((cLat + delta).toFixed(5))],
        [Number((cLon - delta).toFixed(5)), Number((cLat - delta).toFixed(5))],
      ]]

      // 2. Mapear ángulo a hora local
      const totalMinutes = Math.round(6 * 60 + (solar.sunAngle / 180) * 12 * 60)
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
      const mm = String(totalMinutes % 60).padStart(2, '0')
      const datetimeLocal = `2026-06-21T${hh}:${mm}:00`

      const intensity = Math.max(1, Math.min(100, Math.round(solar.radiationIntensity || 65)))

      const res = await runSolarSimulation({
        roi: {
          type: 'Polygon',
          coordinates: roiPolygon,
        },
        datetime_local: datetimeLocal,
        timezone: 'America/Mexico_City',
        intensity_percent: intensity,
      })

      setSimulationResult(res)

      // Actualizar estado solar para renderizar el ráster en el mapa MapLibre
      onSolarChange({
        ...solar,
        rasterPreviewUrl: res.layers.incident.preview_url,
        rasterBounds: res.preview?.bounds_lonlat ?? [
          Number((cLon - delta).toFixed(5)),
          Number((cLat - delta).toFixed(5)),
          Number((cLon + delta).toFixed(5)),
          Number((cLat + delta).toFixed(5)),
        ],
        showRasterOnMap: true,
      })

      // Enfocar suavemente el mapa en el ráster generado
      onFlyToZone?.([cLon, cLat], 13.5)
    } catch (err) {
      setSimulationError(
        err instanceof Error ? err.message : 'Error al conectar con la API de simulación'
      )
    } finally {
      setIsSimulating(false)
    }
  }

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

      {/* Selector de Región de Interés (ROI) */}
      <div className="solar-zone-group">
        <label htmlFor={zoneSelectId} className="solar-zone-label">
          <MapPin size={12} className="solar-zone-label__icon" />
          <span>Zona / Región de Interés (ROI):</span>
        </label>
        <select
          id={zoneSelectId}
          value={selectedZoneId}
          onChange={(e) => handleSelectZone(e.target.value)}
          className="solar-zone-select"
        >
          {SOLAR_PRESET_ZONES.map((zone) => {
            if (zone.id === 'custom_roi' && (!croppedRegion || croppedRegion.length < 3)) {
              return null
            }
            return (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            )
          })}
        </select>
        <div className="solar-zone-info">
          <span>{currentZone.description}</span>
        </div>
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

      {/* Barra de leyenda con gradiente exacto Inferno */}
      <div className="solar-legend">
        <span className="solar-legend__title">Escala de Radiación Solar (Inferno)</span>
        <div
          className="solar-legend__bar"
          style={{ background: infernoSpec.cssGradientHorizontal }}
        />
        <div className="solar-legend__labels">
          <span>Menor radiación</span>
          <span>Media</span>
          <span>Mayor radiación</span>
        </div>
      </div>

      {/* Botón de Ejecución API NASADEM Backend */}
      <div className="solar-api-section">
        <button
          type="button"
          className="solar-api-btn"
          disabled={isSimulating}
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

            <div className="solar-api-grid">
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
            </div>

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
      </div>
    </aside>
  )
}
