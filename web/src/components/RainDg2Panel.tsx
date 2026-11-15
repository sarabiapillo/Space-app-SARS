import { useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Cpu,
  Info,
  Layers,
  ShieldAlert,
} from 'lucide-react'
import { DG2_ROI_SECTORS, type Dg2SectorId } from '../mocks/initialWorkspaces'
import type { EscenaNisar } from '../types/workspace'

interface RainDg2PanelProps {
  escena: EscenaNisar
  selectedSectorId: Dg2SectorId
  onSelectSector: (id: Dg2SectorId) => void
}

export function RainDg2Panel({
  escena,
  selectedSectorId,
  onSelectSector,
}: RainDg2PanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const selectedSector =
    DG2_ROI_SECTORS.find((s) => s.id === selectedSectorId) ?? DG2_ROI_SECTORS[0]

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

        <button
          type="button"
          className="ws-floating-toolbox__icon-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expandir panel DG2' : 'Colapsar panel DG2'}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      <div className="ws-rain-overlay__status">
        <span className="ws-rain-status-badge">
          <ShieldAlert size={12} />
          Estado: Diseño / No ejecutado — sin resultados hidráulicos
        </span>
      </div>

      {!collapsed && (
        <div className="ws-rain-overlay__body">
          <div className="ws-rain-honesty-banner" role="status">
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              El solver externo <code>LISFLOOD-FP 8.0 DG2</code> (CPU, terreno no urbano) aún no
              está instalado ni ejecutado (<code>pipeline/hydrology/</code> pendiente). No se muestran
              profundidades ni manchas simuladas.
            </div>
          </div>

          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <Layers size={13} />
              <h3>1. Contexto Temporal de Precipitación</h3>
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

          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <Cpu size={13} />
              <h3>2. Especificación LISFLOOD-FP 8.0 · DG2</h3>
            </div>
            <div className="ws-rain-kv">
              <div>
                <span>Esquema / Backend</span>
                <code>DG2 CPU · pipeline/hydrology/ pendiente</code>
              </div>
              <div>
                <span>Malla / Dominio</span>
                <code>EPSG:32615 · Terreno no urbano</code>
              </div>
            </div>
          </section>

          <section className="ws-rain-card">
            <div className="ws-rain-card__head">
              <CloudRain size={13} />
              <h3>3. Selector de Elegibilidad No Urbana (ROI)</h3>
            </div>
            <div className="ws-rain-sectors-compact">
              {DG2_ROI_SECTORS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={`ws-rain-sector-btn ${selectedSectorId === sec.id ? 'is-selected' : ''} ${
                    sec.tipo === 'excluida' ? 'is-excluded' : 'is-eligible'
                  }`}
                  onClick={() => onSelectSector(sec.id)}
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
        </div>
      )}
    </aside>
  )
}
