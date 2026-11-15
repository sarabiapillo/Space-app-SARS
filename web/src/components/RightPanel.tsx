import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Sun, X } from 'lucide-react'
import type { SolarSimulationState } from '../types/workspace'
import { getColormapSpec } from '../utils/colormapLut'

interface SolarPanelProps {
  solar: SolarSimulationState
  onSolarChange: (next: SolarSimulationState) => void
  onClose: () => void
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

export function RightPanel({ solar, onSolarChange, onClose }: SolarPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
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
      radiationIntensity: solar.radiationIntensity === 0 ? 60 : solar.radiationIntensity,
    })
  }

  return (
    <aside className="solar-card" aria-label="Simulación Solar y Radiación (Inferno)">
      <div className="solar-card__header">
        <div>
          <h3 className="solar-card__title">
            <Sun size={14} className="solar-card__icon" aria-hidden="true" />
            Settings — Simulación Solar / Radiación
          </h3>
          <p className="solar-card__subtitle">
            Incidencia azimutal DEM y rampa térmica <strong>Inferno</strong>
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

          {/* Silueta técnica del relieve (Cañón del Sumidero / Chiapas) */}
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
    </aside>
  )
}
