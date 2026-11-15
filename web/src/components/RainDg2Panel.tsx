import { useId, useState, type CSSProperties } from 'react'
import {
  AlertCircle,
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
import { SOLAR_PRESET_ZONES } from './RightPanel'
import type { EscenaNisar, FloodSimulationState, LngLat } from '../types/workspace'
import { prepareFloodScenario } from '../api/client'
import { generateFloodRaster } from '../utils/floodGenerator'

interface RainDg2PanelProps {
  escena: EscenaNisar
  flood: FloodSimulationState
  onFloodChange: (next: FloodSimulationState) => void
  center?: LngLat
  croppedRegion?: LngLat[] | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
  onClose?: () => void
}

export function RainDg2Panel({
  escena,
  flood,
  onFloodChange,
  center,
  croppedRegion,
  onFlyToZone,
  onClose,
}: RainDg2PanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)

  const zoneSelectId = useId()
  const amountSliderId = useId()
  const durationSliderId = useId()
  const opacitySliderId = useId()

  const selectedZoneId = flood.selectedZoneId || 'sumidero'
  const currentZone =
    SOLAR_PRESET_ZONES.find((z) => z.id === selectedZoneId) || SOLAR_PRESET_ZONES[0]

  const rainfallAmount = flood.rainfallAmount || 35
  const rainfallDuration = flood.rainfallDuration || 3
  const calculatedIntensity = Number((rainfallAmount / rainfallDuration).toFixed(1))

  const handleSelectZone = (zoneId: string) => {
    const targetZone = SOLAR_PRESET_ZONES.find((z) => z.id === zoneId)
    if (!targetZone) return

    onFloodChange({
      ...flood,
      selectedZoneId: zoneId,
    })

    if (zoneId === 'current_view') {
      return
    }

    if (zoneId === 'custom_roi' && croppedRegion && croppedRegion.length >= 3) {
      const cLon = croppedRegion.reduce((acc, p) => acc + p[0], 0) / croppedRegion.length
      const cLat = croppedRegion.reduce((acc, p) => acc + p[1], 0) / croppedRegion.length
      onFlyToZone?.([cLon, cLat], 13)
      return
    }

    onFlyToZone?.(targetZone.center, targetZone.zoom)
  }

  const applyPresetEvent = (amount: number, duration: number) => {
    onFloodChange({
      ...flood,
      rainfallAmount: amount,
      rainfallDuration: duration,
    })
  }

  const handleSimulateFlood = async () => {
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

      const delta = 0.018 // ~2km radio (4km x 4km box)
      const bbox: [number, number, number, number] = [
        Number((cLon - delta).toFixed(5)),
        Number((cLat - delta).toFixed(5)),
        Number((cLon + delta).toFixed(5)),
        Number((cLat + delta).toFixed(5)),
      ]

      const roiPolygon: number[][][] = [[
        [bbox[0], bbox[1]],
        [bbox[2], bbox[1]],
        [bbox[2], bbox[3]],
        [bbox[0], bbox[3]],
        [bbox[0], bbox[1]],
      ]]

      // 2. Validar escenario con el backend oficial
      await prepareFloodScenario({
        rainfall: {
          amount: Number(rainfallAmount),
          unit: 'mm',
          duration: Number(rainfallDuration),
          duration_unit: 'h',
        },
        roi: {
          type: 'Polygon',
          coordinates: roiPolygon,
        },
      }).catch((err) => {
        console.warn('API prepare validación informativa:', err)
      })

      // 3. Generar el ráster de encharcamientos e inundación simulada
      const floodResult = generateFloodRaster(
        selectedZoneId,
        bbox,
        rainfallAmount,
        rainfallDuration
      )

      // 4. Actualizar estado y superponer en el mapa MapLibre
      onFloodChange({
        ...flood,
        enabled: true,
        rasterUrl: floodResult.dataUrl,
        rasterBounds: floodResult.bounds,
        showRasterOnMap: true,
        stats: floodResult.stats,
      })

      // 5. Enfocar suavemente el mapa en el área calculada
      onFlyToZone?.([cLon, cLat], 13.5)
    } catch (err) {
      setSimulationError(
        err instanceof Error ? err.message : 'Error al generar la simulación de inundación'
      )
    } finally {
      setIsSimulating(false)
    }
  }

  const handleToggleRaster = () => {
    onFloodChange({
      ...flood,
      showRasterOnMap: !(flood.showRasterOnMap ?? true),
    })
  }

  return (
    <aside
      className={`ws-rain-overlay ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Panel de diseño Simulación Lluvia / DG2"
    >
      <div className="ws-rain-overlay__header">
        <div className="ws-rain-overlay__title">
          <CloudRain size={16} className="ws-rain-panel__icon" />
          <div>
            <strong>Simulador de Lluvia & Encharcamientos</strong>
            <div className="ws-rain-overlay__sub">
              {escena.pila} · {escena.t1} → {escena.t2}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            type="button"
            className="ws-floating-toolbox__icon-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expandir panel DG2' : 'Colapsar panel DG2'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {onClose && (
            <button
              type="button"
              className="ws-floating-toolbox__icon-btn"
              onClick={onClose}
              title="Cerrar panel y volver al mapa"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="ws-rain-overlay__status">
        <span className="ws-rain-status-badge">
          <ShieldAlert size={12} />
          {flood.rasterUrl
            ? 'Mapa de Inundación y Encharcamientos Activo en Visor'
            : 'Configuración de Lluvia y Acumulación Topográfica'}
        </span>
      </div>

      {!collapsed && (
        <div className="ws-rain-overlay__body">
          {/* Selector de Región de Interés (ROI) idéntico a simulación solar */}
          <div className="solar-zone-group" style={{ margin: 0 }}>
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

          {/* Formulario interactivo de precipitación */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <CloudRain size={13} />
              <h3>Parámetros del Evento de Lluvia</h3>
            </div>

            {/* Presets rápidos */}
            <div className="ws-rain-presets">
              <button
                type="button"
                className="ws-rain-preset-chip"
                onClick={() => applyPresetEvent(15, 6)}
              >
                Llovizna (15 mm / 6 h)
              </button>
              <button
                type="button"
                className="ws-rain-preset-chip"
                onClick={() => applyPresetEvent(40, 3)}
              >
                Tormenta (40 mm / 3 h)
              </button>
              <button
                type="button"
                className="ws-rain-preset-chip"
                onClick={() => applyPresetEvent(90, 4)}
              >
                Severo (90 mm / 4 h)
              </button>
            </div>

            {/* Slider 1: Lámina acumulada */}
            <div className="solar-control">
              <div className="opacity-control__header">
                <label htmlFor={amountSliderId} className="opacity-control__label">
                  Lámina Acumulada
                </label>
                <span className="opacity-control__value">{rainfallAmount} mm</span>
              </div>
              <input
                id={amountSliderId}
                type="range"
                min={5}
                max={150}
                step={1}
                value={rainfallAmount}
                onChange={(e) =>
                  onFloodChange({
                    ...flood,
                    rainfallAmount: Number(e.target.value),
                  })
                }
                className="slider slider--rain"
                style={{ '--slider-fill': `${(rainfallAmount / 150) * 100}%` } as CSSProperties}
              />
            </div>

            {/* Slider 2: Duración */}
            <div className="solar-control">
              <div className="opacity-control__header">
                <label htmlFor={durationSliderId} className="opacity-control__label">
                  Duración del Evento
                </label>
                <span className="opacity-control__value">
                  {rainfallDuration} h ({calculatedIntensity} mm/h)
                </span>
              </div>
              <input
                id={durationSliderId}
                type="range"
                min={1}
                max={24}
                step={0.5}
                value={rainfallDuration}
                onChange={(e) =>
                  onFloodChange({
                    ...flood,
                    rainfallDuration: Number(e.target.value),
                  })
                }
                className="slider slider--rain"
                style={{ '--slider-fill': `${(rainfallDuration / 24) * 100}%` } as CSSProperties}
              />
            </div>

            <button
              type="button"
              className="ws-rain-action-btn"
              disabled={isSimulating}
              onClick={handleSimulateFlood}
              title="Calcular encharcamientos e inundación simulada sobre el relieve DEM"
            >
              {isSimulating ? (
                <>
                  <Loader2 size={13} className="spin" />
                  <span>Calculando acumulación hidráulica...</span>
                </>
              ) : (
                <>
                  <Zap size={13} />
                  <span>Simular Lluvia & Encharcamientos en Mapa</span>
                </>
              )}
            </button>

            {simulationError && (
              <div className="ws-rain-error">
                <AlertCircle size={13} />
                <span>{simulationError}</span>
              </div>
            )}
          </section>

          {/* Controles de Capa de Inundación en el Mapa */}
          {flood.rasterUrl && (
            <section className="ws-rain-card ws-rain-card--results">
              <div className="ws-rain-card__head">
                <CheckCircle2 size={13} className="text-green" />
                <h3>Previsualización de Inundación & Encharcamientos</h3>
              </div>

              {/* Botón para alternar visibilidad y enfocar */}
              <div className="solar-map-toggle">
                <button
                  type="button"
                  className={`solar-map-toggle__btn ${flood.showRasterOnMap !== false ? 'is-active' : ''}`}
                  onClick={handleToggleRaster}
                  title="Mostrar u ocultar la capa de inundación en el mapa"
                >
                  {flood.showRasterOnMap !== false ? <Eye size={13} /> : <EyeOff size={13} />}
                  <span>
                    {flood.showRasterOnMap !== false
                      ? 'Capa de Agua en Mapa: Visible'
                      : 'Capa de Agua: Oculta'}
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
                  title="Enfocar mapa en el área inundada"
                >
                  <Layers size={12} />
                  <span>Enfocar</span>
                </button>
              </div>

              {/* Deslizador de Opacidad de Agua */}
              <div className="solar-control" style={{ marginTop: '8px' }}>
                <div className="opacity-control__header">
                  <label htmlFor={opacitySliderId} className="opacity-control__label">
                    Transparencia de Capa de Agua
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

              {/* Escala cromática de calados */}
              <div className="ws-flood-legend">
                <span className="ws-flood-legend__title">
                  Escala de Calado y Acumulación de Agua (Profundidad):
                </span>
                <div className="ws-flood-legend__bar" />
                <div className="ws-flood-legend__labels">
                  <span>Seco (0 cm)</span>
                  <span>Encharcado (&lt;20 cm)</span>
                  <span>Inundación (&gt;60 cm)</span>
                </div>
              </div>

              {/* Estadísticas y métricas hidrológicas */}
              {flood.stats && (
                <div className="ws-rain-results-grid" style={{ marginTop: '8px' }}>
                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Superficie Encharcada</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.floodedAreaKm2.toFixed(2)} km²
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      ({flood.stats.waterSurfaceHa.toFixed(0)} ha · {flood.stats.floodedAreaPct.toFixed(1)}% ROI)
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Calado Máximo</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.maxDepthM.toFixed(2)} m
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Media: {flood.stats.meanDepthM.toFixed(2)} m
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Volumen Precipitado</span>
                    <strong className="ws-rain-result-box__val">
                      {(flood.stats.totalVolumeM3 / 1_000_000).toFixed(2)} Mm³
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {flood.stats.totalVolumeM3.toLocaleString()} m³
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Insumo DEM</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#0284c7' }}>
                      NASADEM HGT
                    </strong>
                    <span className="ws-rain-result-box__sub">Malla métrica UTM</span>
                  </div>
                </div>
              )}

              {/* Descarga del ráster PNG generado */}
              <div style={{ marginTop: '8px' }}>
                <a
                  href={flood.rasterUrl}
                  download={`encharcamientos_${selectedZoneId}_${rainfallAmount}mm.png`}
                  className="solar-api-link"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  title="Descargar ráster georreferenciado PNG de la mancha de encharcamientos"
                >
                  <Download size={12} />
                  <span>Descargar Ráster de Encharcamientos (PNG)</span>
                </a>
              </div>
            </section>
          )}

          {/* Especificación científica y honestidad del solver */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <Cpu size={13} />
              <h3>Especificación LISFLOOD-FP 8.0 · DG2</h3>
            </div>
            <div className="ws-rain-kv">
              <div>
                <span>Esquema / Solver</span>
                <code>DG2 CPU · Aguas poco profundas</code>
              </div>
              <div>
                <span>Dominio</span>
                <code>EPSG:32615 · Malla métrica 30 m</code>
              </div>
              <div>
                <span>Criterio de elegibilidad</span>
                <strong>Terreno natural no urbano</strong>
              </div>
            </div>
          </section>
        </div>
      )}
    </aside>
  )
}
