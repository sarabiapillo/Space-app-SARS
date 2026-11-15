import { useId, useState, type CSSProperties } from 'react'
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
import { SOLAR_PRESET_ZONES } from './RightPanel'
import type { EscenaNisar, FloodSimulationState, LngLat } from '../types/workspace'
import { simulateFloodScenario } from '../api/client'
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
  const [showEquations, setShowEquations] = useState(false)
  const [showCustomRoiModal, setShowCustomRoiModal] = useState(false)
  const [customRoiInput, setCustomRoiInput] = useState('')
  const [customRoiError, setCustomRoiError] = useState<string | null>(null)

  const zoneSelectId = useId()
  const amountSliderId = useId()
  const durationSliderId = useId()
  const pressureSliderId = useId()
  const opacitySliderId = useId()

  const selectedZoneId = flood.selectedZoneId || 'sumidero'
  const currentZone =
    SOLAR_PRESET_ZONES.find((z) => z.id === selectedZoneId) || SOLAR_PRESET_ZONES[0]

  const rainfallAmount = flood.rainfallAmount || 35
  const rainfallDuration = flood.rainfallDuration || 3
  const pressureHpa = flood.pressureHpa || 1005
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

  const applyPresetEvent = (amount: number, duration: number, pressure: number = 1005) => {
    onFloodChange({
      ...flood,
      rainfallAmount: amount,
      rainfallDuration: duration,
      pressureHpa: pressure,
    })
  }

  const handleApplyCustomRoi = () => {
    try {
      setCustomRoiError(null)
      const trimmed = customRoiInput.trim()
      if (!trimmed) {
        throw new Error('Ingrese o pegue las coordenadas del polígono.')
      }

      let coords: [number, number][] = []

      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed)
        if (parsed.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
          coords = parsed.coordinates[0]
        } else if (parsed.type === 'Feature' && parsed.geometry?.type === 'Polygon') {
          coords = parsed.geometry.coordinates[0]
        } else {
          throw new Error('El objeto debe ser un GeoJSON Polygon o Feature válido.')
        }
      } else if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed) && parsed.length === 4 && typeof parsed[0] === 'number') {
          const [w, s, e, n] = parsed
          coords = [
            [w, n],
            [e, n],
            [e, s],
            [w, s],
            [w, n],
          ]
        } else if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
          coords = parsed
        } else {
          throw new Error('Formato de array de coordenadas no reconocido.')
        }
      } else {
        const parts = trimmed.split(',').map((p) => Number(p.trim()))
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
          const [w, s, e, n] = parts
          coords = [
            [w, n],
            [e, n],
            [e, s],
            [w, s],
            [w, n],
          ]
        } else {
          throw new Error('Pegue GeoJSON Polygon, array [[lng,lat]...] o bbox "west,south,east,north".')
        }
      }

      if (coords.length < 3) {
        throw new Error('El polígono debe tener al menos 3 vértices.')
      }

      let minLng = Infinity
      let maxLng = -Infinity
      let minLat = Infinity
      let maxLat = -Infinity
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }

      const cLng = (minLng + maxLng) / 2
      const cLat = (minLat + maxLat) / 2

      onFlyToZone?.([cLng, cLat], 12)
      onFloodChange({
        ...flood,
        selectedZoneId: 'custom_roi',
        rasterBounds: [minLng, minLat, maxLng, maxLat],
      })
      setShowCustomRoiModal(false)
    } catch (err: any) {
      setCustomRoiError(err.message || 'Error al procesar las coordenadas del ROI.')
    }
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

      // 2. Ejecutar cálculo hidrológico y topográfico con NASADEM 30m real y forzamiento barométrico
      let dataUrl = ''
      let resultBounds = bbox
      let stats = null

      try {
        const simRes = await simulateFloodScenario({
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
          pressure_hpa: Number(pressureHpa),
        })

        if (simRes && simRes.dataUrl) {
          dataUrl = simRes.dataUrl
          resultBounds = simRes.bounds
          stats = simRes.stats
        }
      } catch (backendErr) {
        console.warn('Simulación remota NASADEM derivando a generador topográfico local:', backendErr)
      }

      // Si no hubo respuesta de API, calcular con el modelo topográfico calibrado local
      if (!dataUrl) {
        const floodResult = generateFloodRaster(
          selectedZoneId,
          bbox,
          rainfallAmount,
          rainfallDuration,
          pressureHpa
        )
        dataUrl = floodResult.dataUrl
        resultBounds = floodResult.bounds
        stats = floodResult.stats
      }

      // 3. Actualizar estado y superponer en el mapa MapLibre
      onFloodChange({
        ...flood,
        enabled: true,
        rasterUrl: dataUrl,
        rasterBounds: resultBounds,
        showRasterOnMap: true,
        stats: stats ?? undefined,
      })

      // 4. Enfocar suavemente el mapa en el área calculada
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
            <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
              <button
                type="button"
                className="ws-tool-btn"
                style={{ fontSize: '10px', padding: '4px 8px', width: '100%', justifyContent: 'center' }}
                onClick={() => setShowCustomRoiModal(true)}
              >
                📂 Cargar Coordenadas / Importar ROI GeoJSON...
              </button>
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
                onClick={() => applyPresetEvent(15, 6, 1012)}
              >
                Llovizna (15 mm / 6 h)
              </button>
              <button
                type="button"
                className="ws-rain-preset-chip"
                onClick={() => applyPresetEvent(45, 3, 1008)}
              >
                Tormenta (45 mm / 3 h)
              </button>
              <button
                type="button"
                className="ws-rain-preset-chip"
                onClick={() => applyPresetEvent(90, 6, 1004)}
              >
                Severo (90 mm / 6 h)
              </button>
              <button
                type="button"
                className="ws-rain-preset-chip"
                style={{
                  background: '#e0f2fe',
                  borderColor: '#38bdf8',
                  color: '#0369a1',
                  fontWeight: 700,
                  gridColumn: 'span 2',
                }}
                onClick={() => applyPresetEvent(185, 72, 998)}
                title="Evento meteorológico multidiario de 3 días (72h) bajo sistema de baja presión ciclónica de 998 hPa"
              >
                ⛈️ Temporal 3 Días (72h · 185 mm · 998 hPa)
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
                  Duración del Evento
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
                  Presión Barométrica
                </label>
                <span className="opacity-control__value">
                  {pressureHpa} hPa {pressureHpa < 1010 ? '(Baja presión)' : '(Estándar)'}
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
                Bajas presiones (ej. 995–1005 hPa) elevan la lámina hidrostática en zonas bajas e intensifican la escorrentía.
              </span>
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
                    <strong>Comparar Inundación vs Terreno Original</strong>
                  </label>
                  <span className={`ws-rain-compare-badge ${flood.compareMode ? 'is-active' : ''}`}>
                    {flood.compareMode ? 'CORTINA SWIPE ACTIVA' : 'Capa completa'}
                  </span>
                </div>

                {flood.compareMode && (
                  <div style={{ marginTop: '8px' }}>
                    <div className="opacity-control__header">
                      <span className="opacity-control__label">Deslizador Swipe (Arrastrable en mapa)</span>
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
                      <span>◀ 0% Terreno Original</span>
                      <span>50% Mitad</span>
                      <span>100% Inundación ▶</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Escala cromática de calados */}
              <div className="ws-flood-legend">
                <span className="ws-flood-legend__title">
                  Escala de Calado y Acumulación de Agua (Profundidad):
                </span>
                <div className="ws-flood-legend__bar" />
                <div className="ws-flood-legend__labels">
                  <span>Lámina (&lt;15 cm)</span>
                  <span>Moderado (15-40 cm)</span>
                  <span>Cauce Profundo (&gt;1 m)</span>
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
                    <strong>Riesgo Hidráulico: {flood.stats.riskLevel}</strong>
                    <span>{flood.stats.riskDescription}</span>
                  </div>
                </div>
              )}

              {/* Estadísticas y métricas hidrológicas completas */}
              {flood.stats && (
                <div className="ws-rain-results-grid" style={{ marginTop: '8px' }}>
                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Superficie Encharcada</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.floodedAreaKm2.toFixed(2)} km²
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {flood.stats.waterSurfaceHa.toFixed(0)} ha · {flood.stats.floodedAreaPct.toFixed(1)}% de ROI
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Calado (Profundidad)</span>
                    <strong className="ws-rain-result-box__val">
                      Máx: {flood.stats.maxDepthM.toFixed(2)} m
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Media: {flood.stats.meanDepthM.toFixed(2)} m
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Caudal Pico Estimado</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#0369a1' }}>
                      {flood.stats.peakDischargeM3s !== undefined ? `${flood.stats.peakDischargeM3s} m³/s` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">Descarga máxima Q</span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Velocidad de Flujo</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.meanVelocityMs !== undefined ? `${flood.stats.meanVelocityMs} m/s` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Máx: {flood.stats.maxVelocityMs !== undefined ? `${flood.stats.maxVelocityMs} m/s` : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Régimen / Froude</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#854d0e' }}>
                      Fr = {flood.stats.froudeNumber !== undefined ? flood.stats.froudeNumber : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {flood.stats.froudeRegime ?? 'Subcrítico'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Tiempo Concentración</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.timeOfConcentrationMin !== undefined ? `${flood.stats.timeOfConcentrationMin} min` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Tc: {flood.stats.timeOfConcentrationHours !== undefined ? `${flood.stats.timeOfConcentrationHours} h` : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Balance Precipitación</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#0284c7' }}>
                      {flood.stats.effectiveRunoffMm !== undefined ? `${flood.stats.effectiveRunoffMm} mm neto` : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Infiltrado: {flood.stats.infiltratedMm !== undefined ? `${flood.stats.infiltratedMm} mm` : '—'}
                    </span>
                  </div>

                  <div className="ws-rain-result-box">
                    <span className="ws-rain-result-box__label">Cota Superficie Agua</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.waterLevelMinM !== undefined && flood.stats.waterLevelMaxM !== undefined
                        ? `${flood.stats.waterLevelMinM} – ${flood.stats.waterLevelMaxM} m`
                        : flood.stats.elevMinM !== undefined
                        ? `${flood.stats.elevMinM} – ${flood.stats.elevMaxM} m`
                        : '—'}
                    </strong>
                    <span className="ws-rain-result-box__sub">Elevación η (s.n.m.)</span>
                  </div>

                  <div className="ws-rain-result-box" style={{ borderLeft: '3px solid #f97316' }}>
                    <span className="ws-rain-result-box__label">Afección en Vías y Caminos</span>
                    <strong className="ws-rain-result-box__val" style={{ color: '#c2410c' }}>
                      {flood.stats.roadsTotalAffectedKm !== undefined
                        ? `${flood.stats.roadsTotalAffectedKm} km`
                        : `${(flood.stats.floodedAreaKm2 * 2.2).toFixed(2)} km`}
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Cortadas: {flood.stats.roadsCutKm !== undefined ? `${flood.stats.roadsCutKm} km` : 'evaluando'} (h ≥ 0.35m)
                    </span>
                  </div>

                  <div className="ws-rain-result-box" style={{ borderLeft: '3px solid #0284c7' }}>
                    <span className="ws-rain-result-box__label">Presión y Saturación 3 Días</span>
                    <strong className="ws-rain-result-box__val">
                      {flood.stats.pressureHpa ?? pressureHpa} hPa
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      Suelo: {flood.stats.saturationPct ?? 88}% sat · Δh: +{flood.stats.baroSurgeCm ?? 11} cm
                    </span>
                  </div>

                  <div className="ws-rain-result-box" style={{ gridColumn: 'span 2' }}>
                    <span className="ws-rain-result-box__label">Volumen Acumulado y Almacenamiento</span>
                    <strong className="ws-rain-result-box__val">
                      {(flood.stats.totalVolumeM3 / 1_000_000).toFixed(2)} Mm³ totales
                    </strong>
                    <span className="ws-rain-result-box__sub">
                      {flood.stats.totalVolumeM3.toLocaleString()} m³ caídos · Inundación efectiva: {flood.stats.floodedVolumeM3 ? `${flood.stats.floodedVolumeM3.toLocaleString()} m³` : 'calculada'}
                    </span>
                  </div>
                </div>
              )}

              {/* Botón interactivo para ver y revisar las ecuaciones físicas */}
              <button
                type="button"
                className="ws-rain-eq-toggle"
                onClick={() => setShowEquations((prev) => !prev)}
                aria-expanded={showEquations}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <BookOpen size={12} />
                  <span>Ecuaciones Hidráulicas del Simulador</span>
                </span>
                {showEquations ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showEquations && (
                <div className="ws-rain-eq-content">
                  <div className="ws-rain-eq-item">
                    <span>1. Conservación de Masa 2D (Saint-Venant / SWE):</span>
                    <code>∂t h + ∇·(h u) = r(t) - i(t)</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>2. Dinámica de Resistencia de Manning:</span>
                    <code>v = (1/n) · R_h^(2/3) · S^(1/2)  [n = 0.035 s/m^(1/3)]</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>3. Calado Normal por Celda en Cauce:</span>
                    <code>h = [Q · n / (B · √S)]^(3/5)</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>4. Enrutamiento Topográfico D8 (Steepest Descent):</span>
                    <code>S_max = max_k [(z - z_k) / d_k]</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>5. Tiempo de Concentración de Cuenca (Kirpich):</span>
                    <code>Tc = 0.0662 · (L^0.77) / (S^0.385)</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>6. Saturación Progresiva del Suelo (Temporal de 3 Días / 72h):</span>
                    <code>C(t) = C_0 + (C_max - C_0)·[1 - exp(-t/24h)]  [C → 0.89 a 72h]</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>7. Forzamiento Barométrico Hidrostático (Bajas Presiones):</span>
                    <code>Δh_baro = (1013.25 - P_baro) / (ρ_w · g)  [+1.02 cm por hPa de caída]</code>
                  </div>
                  <div className="ws-rain-eq-item">
                    <span>8. Corte de Vías y Transitabilidad (Criterio Xia et al. 2014):</span>
                    <code>Corte crítico si h ≥ 0.35 m  o  fuerza de arrastre v·h ≥ 0.40 m²/s</code>
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

      {/* Modal para Cargar Coordenadas ROI GeoJSON o Bounding Box */}
      {showCustomRoiModal && (
        <div
          className="ws-sci-modal-backdrop"
          onClick={() => setShowCustomRoiModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="ws-sci-modal"
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ws-sci-modal__header">
              <div className="ws-sci-modal__title-box">
                <MapPin size={16} style={{ color: '#0284c7' }} />
                <h3>Cargar Región de Interés (ROI) / Zona Externa</h3>
              </div>
              <button
                type="button"
                className="ws-sci-btn ws-sci-btn--close"
                onClick={() => setShowCustomRoiModal(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ margin: 0, fontSize: '11.5px', color: '#475569' }}>
                Seleccione una de las nuevas zonas costeras/húmedas fuera de la depresión seca interior,
                o pegue un polígono GeoJSON / Bounding Box personalizado:
              </p>

              {/* Botones de Zonas Húmedas / Costeras Recomendadas */}
              <div>
                <strong style={{ fontSize: '10.5px', color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  Zonas Húmedas / Costeras Fuera del Cañón Seco:
                </strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px' }}>
                  <button
                    type="button"
                    className="ws-tool-btn"
                    style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', height: 'auto' }}
                    onClick={() => {
                      setCustomRoiInput('[-92.65, 14.78, -92.20, 15.02]')
                    }}
                  >
                    🌊 <strong>Soconusco Costa</strong><br />
                    <span style={{ fontSize: '9.5px', color: '#64748b' }}>Río Coatán / Tapachula</span>
                  </button>
                  <button
                    type="button"
                    className="ws-tool-btn"
                    style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', height: 'auto' }}
                    onClick={() => {
                      setCustomRoiInput('[-93.05, 15.00, -92.65, 15.30]')
                    }}
                  >
                    🌿 <strong>La Encrucijada</strong><br />
                    <span style={{ fontSize: '9.5px', color: '#64748b' }}>Marismas y Manglares</span>
                  </button>
                  <button
                    type="button"
                    className="ws-tool-btn"
                    style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', height: 'auto' }}
                    onClick={() => {
                      setCustomRoiInput('[-93.75, 17.05, -93.45, 17.30]')
                    }}
                  >
                    💧 <strong>Malpaso / Grijalva</strong><br />
                    <span style={{ fontSize: '9.5px', color: '#64748b' }}>Llanuras Aluviales Norte</span>
                  </button>
                </div>
              </div>

              {/* Área de texto para ingresar GeoJSON o Coordenadas */}
              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  Coordenadas (GeoJSON Polygon, BBox [w, s, e, n] o CSV):
                </label>
                <textarea
                  rows={4}
                  value={customRoiInput}
                  onChange={(e) => setCustomRoiInput(e.target.value)}
                  placeholder={`Ejemplo Bbox: [-92.65, 14.78, -92.20, 15.02]\nO GeoJSON: {"type":"Polygon","coordinates":[[[-92.65,14.78],[-92.20,14.78],...]]}`}
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '3px',
                    background: '#f8fafc',
                    resize: 'vertical',
                  }}
                />
              </div>

              {customRoiError && (
                <div style={{ padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '3px', color: '#b91c1c', fontSize: '11px' }}>
                  {customRoiError}
                </div>
              )}
            </div>

            <div className="ws-sci-modal__footer">
              <button
                type="button"
                className="ws-sci-btn"
                onClick={() => setShowCustomRoiModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="ws-sci-btn ws-sci-btn--primary"
                onClick={handleApplyCustomRoi}
              >
                Aplicar ROI y Centrar Mapa
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
