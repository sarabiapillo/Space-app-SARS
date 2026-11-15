import { useState } from 'react'
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Cpu,
  Info,
  Layers,
  Loader2,
  MapPin,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react'
import { DG2_ROI_SECTORS, type Dg2SectorId } from '../mocks/initialWorkspaces'
import type { EscenaNisar, LngLat } from '../types/workspace'
import { prepareFloodScenario, type FloodPrepareResponse } from '../api/client'

interface RainDg2PanelProps {
  escena: EscenaNisar
  selectedSectorId: Dg2SectorId
  onSelectSector: (id: Dg2SectorId) => void
  onFlyToSector?: (center: LngLat, zoom?: number) => void
  onClose?: () => void
}

export function RainDg2Panel({
  escena,
  selectedSectorId,
  onSelectSector,
  onFlyToSector,
  onClose,
}: RainDg2PanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [rainfallAmount, setRainfallAmount] = useState<number>(25)
  const [rainfallDuration, setRainfallDuration] = useState<number>(3)
  const [withProfile, setWithProfile] = useState<boolean>(true)
  const [isValidating, setIsValidating] = useState<boolean>(false)
  const [prepareResult, setPrepareResult] = useState<FloodPrepareResponse | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)

  const selectedSector =
    DG2_ROI_SECTORS.find((s) => s.id === selectedSectorId) ?? DG2_ROI_SECTORS[0]

  const handleSectorClick = (sectorId: Dg2SectorId) => {
    onSelectSector(sectorId)
    const sec = DG2_ROI_SECTORS.find((s) => s.id === sectorId)
    if (sec && sec.coordinates[0].length >= 3 && onFlyToSector) {
      const ring = sec.coordinates[0]
      const cLon = ring.reduce((acc, p) => acc + p[0], 0) / ring.length
      const cLat = ring.reduce((acc, p) => acc + p[1], 0) / ring.length
      onFlyToSector([cLon, cLat], 12.5)
    }
  }

  const handleValidateScenario = async () => {
    setIsValidating(true)
    setPrepareError(null)

    try {
      const payload = {
        rainfall: {
          amount: Number(rainfallAmount),
          unit: 'mm' as const,
          duration: Number(rainfallDuration),
          duration_unit: 'h' as const,
        },
        roi: {
          type: 'Polygon' as const,
          coordinates: selectedSector.coordinates,
        },
        ...(withProfile
          ? {
              rainfall_profile: {
                interval_count: 6,
                seed: 42,
                distribution: 'uniform_balanced' as const,
              },
            }
          : {}),
      }

      const res = await prepareFloodScenario(payload)
      setPrepareResult(res)
    } catch (err) {
      setPrepareError(
        err instanceof Error ? err.message : 'Error al validar el escenario de inundación'
      )
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <aside
      className={`ws-rain-overlay ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Panel de diseño Simulación Lluvia / DG2"
    >
      <div className="ws-rain-overlay__header">
        <div className="ws-rain-overlay__title">
          <CloudRain size={15} className="ws-rain-panel__icon" />
          <div>
            <strong>Simulación Lluvia / DG2 (LISFLOOD-FP 8.0)</strong>
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
          {prepareResult
            ? 'Escenario Preparado y Validado por Backend API'
            : 'Estado: Diseño / Validación de Parámetros Hidráulicos'}
        </span>
      </div>

      {!collapsed && (
        <div className="ws-rain-overlay__body">
          {/* Banner de honestidad científica */}
          <div className="ws-rain-honesty-banner" role="status">
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              Modelo hidráulico <code>LISFLOOD-FP 8.0 DG2</code>. La API prepara y valida
              parámetros de precipitación y límites topográficos sobre terreno no urbano.
            </div>
          </div>

          {/* Formulario interactivo de precipitación */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <CloudRain size={13} />
              <h3>1. Parámetros de Precipitación Hipotética</h3>
            </div>

            <div className="ws-rain-form-grid">
              <div className="ws-rain-form-field">
                <label>Lámina acumulada:</label>
                <div className="ws-rain-input-group">
                  <input
                    type="number"
                    min={0}
                    max={500}
                    step={1}
                    value={rainfallAmount}
                    onChange={(e) => setRainfallAmount(Math.max(0, Number(e.target.value)))}
                    className="ws-rain-input"
                  />
                  <span className="ws-rain-unit">mm</span>
                </div>
              </div>

              <div className="ws-rain-form-field">
                <label>Duración del evento:</label>
                <div className="ws-rain-input-group">
                  <input
                    type="number"
                    min={0.1}
                    max={72}
                    step={0.5}
                    value={rainfallDuration}
                    onChange={(e) => setRainfallDuration(Math.max(0.1, Number(e.target.value)))}
                    className="ws-rain-input"
                  />
                  <span className="ws-rain-unit">horas</span>
                </div>
              </div>
            </div>

            <label className="ws-rain-checkbox-label">
              <input
                type="checkbox"
                checked={withProfile}
                onChange={(e) => setWithProfile(e.target.checked)}
              />
              <span>Generar perfil temporal balanceado (6 intervalos)</span>
            </label>

            <button
              type="button"
              className="ws-rain-action-btn"
              disabled={isValidating}
              onClick={handleValidateScenario}
              title="Enviar parámetros al endpoint /api/flood-scenarios/prepare/"
            >
              {isValidating ? (
                <>
                  <Loader2 size={13} className="spin" />
                  <span>Validando con API backend...</span>
                </>
              ) : (
                <>
                  <Zap size={13} />
                  <span>Validar y Preparar Escenario (API)</span>
                </>
              )}
            </button>

            {prepareError && (
              <div className="ws-rain-error">
                <AlertCircle size={13} />
                <span>{prepareError}</span>
              </div>
            )}
          </section>

          {/* Resultados de la validación del Backend */}
          {prepareResult && (
            <section className="ws-rain-card ws-rain-card--results">
              <div className="ws-rain-card__head">
                <CheckCircle2 size={13} className="text-green" />
                <h3>Resultados de Preparación (API Backend)</h3>
              </div>

              <div className="ws-rain-results-grid">
                <div className="ws-rain-result-box">
                  <span className="ws-rain-result-box__label">Lámina Total</span>
                  <strong className="ws-rain-result-box__val">
                    {(prepareResult.rainfall.amount_m * 1000).toFixed(1)} mm
                  </strong>
                  <span className="ws-rain-result-box__sub">
                    ({prepareResult.rainfall.amount_m.toFixed(4)} m)
                  </span>
                </div>

                <div className="ws-rain-result-box">
                  <span className="ws-rain-result-box__label">Duración Total</span>
                  <strong className="ws-rain-result-box__val">
                    {(prepareResult.rainfall.duration_s / 3600).toFixed(1)} h
                  </strong>
                  <span className="ws-rain-result-box__sub">
                    ({prepareResult.rainfall.duration_s.toFixed(0)} s)
                  </span>
                </div>

                <div className="ws-rain-result-box">
                  <span className="ws-rain-result-box__label">Intensidad Media</span>
                  <strong className="ws-rain-result-box__val">
                    {(prepareResult.rainfall.mean_intensity_m_s * 1000 * 3600).toFixed(2)} mm/h
                  </strong>
                  <span className="ws-rain-result-box__sub">
                    {prepareResult.rainfall.mean_intensity_m_s.toExponential(3)} m/s
                  </span>
                </div>

                <div className="ws-rain-result-box">
                  <span className="ws-rain-result-box__label">Insumo DEM</span>
                  <strong className="ws-rain-result-box__val" style={{ color: '#047857' }}>
                    Disponible
                  </strong>
                  <span className="ws-rain-result-box__sub">NASADEM Provider</span>
                </div>
              </div>

              {/* Perfil temporal sintético si fue solicitado */}
              {prepareResult.rainfall_profile && (
                <div className="ws-rain-profile-section">
                  <div className="ws-rain-profile-title">
                    <BarChart3 size={12} />
                    <span>Perfil Temporal Sintético (6 intervalos balanceados):</span>
                  </div>
                  <div className="ws-rain-profile-bars">
                    {prepareResult.rainfall_profile.segments.map((seg, idx) => {
                      const mmH = seg.intensity_m_s * 1000 * 3600
                      const maxMmH = Math.max(
                        ...prepareResult.rainfall_profile!.segments.map(
                          (s) => s.intensity_m_s * 1000 * 3600
                        ),
                        1
                      )
                      const pct = Math.max(10, Math.min(100, (mmH / maxMmH) * 100))
                      return (
                        <div key={idx} className="ws-rain-profile-bar-col">
                          <div
                            className="ws-rain-profile-bar"
                            style={{ height: `${pct}%` }}
                            title={`T = ${seg.start_s / 3600}h a ${seg.end_s / 3600}h: ${mmH.toFixed(2)} mm/h`}
                          />
                          <span className="ws-rain-profile-bar-lbl">{mmH.toFixed(1)}</span>
                          <span className="ws-rain-profile-bar-time">
                            {idx + 1}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Lista de bloqueadores y criterios de verificación */}
              <div className="ws-rain-blockers">
                <span className="ws-rain-blockers__title">
                  Criterios y Bloqueos Científicos Reportados por el Solver:
                </span>
                <ul>
                  {prepareResult.blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Selector de Elegibilidad No Urbana */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <MapPin size={13} />
              <h3>2. Selector de Elegibilidad No Urbana (ROI)</h3>
            </div>
            <div className="ws-rain-sectors-compact">
              {DG2_ROI_SECTORS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={`ws-rain-sector-btn ${selectedSectorId === sec.id ? 'is-selected' : ''} ${
                    sec.tipo === 'excluida' ? 'is-excluded' : 'is-eligible'
                  }`}
                  onClick={() => handleSectorClick(sec.id)}
                >
                  <span className="ws-rain-sector-btn__badge">
                    {sec.tipo === 'elegible' ? 'ELEGIBLE NO URBANO' : 'EXCLUIDA (URBANA)'}
                  </span>
                  <strong>{sec.nombre}</strong>
                </button>
              ))}
            </div>
            <div className="ws-rain-sector-detail">
              <div>
                <strong>Criterio:</strong> {selectedSector.criterio}
              </div>
              <div>
                <strong>Nota:</strong> {selectedSector.nota}
              </div>
            </div>
          </section>

          {/* Contexto de precipitación GPM */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <Layers size={13} />
              <h3>3. Contexto Temporal de Precipitación</h3>
            </div>
            <div className="ws-rain-kv">
              <div>
                <span>Catálogo</span>
                <code>GPM_3IMERGDL v07</code>
              </div>
              <div>
                <span>Resolución / Rango</span>
                <code>0.1° (~11 km) · 153 días</code>
              </div>
              <div>
                <span>Ventana</span>
                <code>2026-06-01 → 2026-10-31</code>
              </div>
              <div>
                <span>Uso permitido</span>
                <strong>Solo contexto temporal</strong>
              </div>
            </div>
            <p className="ws-rain-note">
              <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} /> Nunca se usa como validación
              píxel a píxel ni como profundidad de agua.
            </p>
          </section>

          {/* Especificación LISFLOOD-FP */}
          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <Cpu size={13} />
              <h3>4. Especificación LISFLOOD-FP 8.0 · DG2</h3>
            </div>
            <div className="ws-rain-kv">
              <div>
                <span>Esquema / Backend</span>
                <code>DG2 CPU · pipeline/hydrology/</code>
              </div>
              <div>
                <span>Malla / Dominio</span>
                <code>EPSG:32615 · Terreno no urbano</code>
              </div>
            </div>
          </section>
        </div>
      )}
    </aside>
  )
}
