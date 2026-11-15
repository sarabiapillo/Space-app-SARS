import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Sun, X } from 'lucide-react'
import type { SolarSimulationState } from '../types/workspace'

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
    <aside className="solar-card" aria-label="Simulación Solar">
      <div className="solar-card__header">
        <div>
          <h3 className="solar-card__title">
            <Sun size={16} className="solar-card__icon" aria-hidden="true" />
            Simulación Solar
          </h3>
          <p className="solar-card__subtitle">Ajusta la luz sobre el terreno</p>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn--xs"
          onClick={onClose}
          title="Cerrar Simulación Solar"
          aria-label="Cerrar Simulación Solar"
        >
          <X size={16} />
        </button>
      </div>

      {/* Recuadro limpio con arco sencillo Este a Oeste y esfera amarilla arrastrable */}
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
          <line x1={32} y1={96} x2={228} y2={96} stroke="#374151" strokeWidth={1.5} />

          {/* Arco punteado completo Este -> Oeste */}
          <path
            d="M 52 96 A 78 78 0 0 1 208 96"
            fill="none"
            stroke="#4B5563"
            strokeWidth={2}
            strokeDasharray="4 4"
          />

          {/* Tramo recorrido del Sol */}
          <path
            d={`M 52 96 A 78 78 0 0 1 ${sunX.toFixed(1)} ${sunY.toFixed(1)}`}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={2.5}
          />

          {/* Rayo proyectado hacia el relieve central */}
          <line
            x1={sunX}
            y1={sunY}
            x2={130}
            y2={96}
            stroke="#FBBF24"
            strokeWidth={1.25}
            strokeDasharray="3 3"
          />

          {/* Silueta minimalista del terreno */}
          <polygon
            points="96,96 114,80 128,89 144,74 166,96"
            fill="#1F2937"
            stroke="#6B7280"
            strokeWidth={1.2}
          />

          {/* Esfera amarilla del Sol */}
          <circle
            cx={sunX}
            cy={sunY}
            r={13}
            fill="rgba(251, 191, 36, 0.25)"
          />
          <circle
            cx={sunX}
            cy={sunY}
            r={8.5}
            fill="#FACC15"
            stroke="#D97706"
            strokeWidth={1.8}
          />

          {/* Etiquetas Este / Mediodía / Oeste */}
          <text x={52} y={111} textAnchor="middle" className="solar-arc-svg__label">
            Este (6:00)
          </text>
          <text x={130} y={12} textAnchor="middle" className="solar-arc-svg__label">
            12:00 ({formatSolarHour(solar.sunAngle)})
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
            Ángulo del Sol / Hora
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
            Intensidad de Calor / Radiación
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

      {/* Barra sencilla de leyenda: Temperatura del terreno */}
      <div className="solar-legend">
        <span className="solar-legend__title">Temperatura del terreno</span>
        <div className="solar-legend__bar" />
        <div className="solar-legend__labels">
          <span>Baja</span>
          <span>Media</span>
          <span>Mayor calor</span>
        </div>
      </div>
    </aside>
  )
}
