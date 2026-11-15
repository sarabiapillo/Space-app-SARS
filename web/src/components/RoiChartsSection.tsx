import { Database, HardDrive, Loader2 } from 'lucide-react'
import { Etapa1ChartsPanel } from './Etapa1ChartsPanel'
import type { RoiLayersState } from '../hooks/useRoiLayers'
import type { LngLat } from '../types/workspace'

interface RoiChartsSectionProps {
  roiLayers: RoiLayersState
  region?: LngLat[] | null
  compact?: boolean
}

/** Caja de la ROI en grados, para identificarla en el título de las gráficas. */
function roiBox(region?: LngLat[] | null): string | undefined {
  if (!region || region.length < 3) return undefined
  const lons = region.map((p) => p[0])
  const lats = region.map((p) => p[1])
  const f = (v: number) => v.toFixed(3)
  return `${f(Math.min(...lons))}…${f(Math.max(...lons))}°, ${f(Math.min(...lats))}…${f(Math.max(...lats))}°`
}

const DB_LABEL: Record<string, string> = {
  ok: 'guardada en PostGIS',
  parcial: 'guardada en PostGIS solo en parte',
  'no disponible': 'no se pudo guardar en PostGIS (¿Docker apagado?)',
  guardando: 'guardando en PostGIS…',
}

/**
 * Gráficas NISAR de la ROI dibujada (ángulo de incidencia, retrodispersión γ⁰ y máscara QA de
 * subfranja). Se generan solas al preparar la ROI (`/api/roi-jobs`) y el backend guarda una copia
 * en `data/graficas-roi/<id>/` y en la base de datos.
 */
export function RoiChartsSection({ roiLayers, region, compact = true }: RoiChartsSectionProps) {
  if (roiLayers.loading) {
    return (
      <div className="ws-charts-panel__empty" role="status">
        <Loader2 size={14} className="spin" aria-hidden="true" /> {roiLayers.message || 'Preparando la ROI…'} Las
        gráficas se generan al terminar.
      </div>
    )
  }
  if (roiLayers.error) {
    return (
      <div className="ws-charts-panel__error" role="alert">
        <div>
          <strong>No se pudieron generar las gráficas de la ROI</strong>
          <p>{roiLayers.error}</p>
          <button type="button" className="ws-tool-btn" onClick={roiLayers.retry}>
            Reintentar
          </button>
        </div>
      </div>
    )
  }
  if (roiLayers.charts.length === 0) {
    return (
      <div className="ws-charts-panel__empty">
        La ROI no tiene gráficas todavía. Dibuja o selecciona una ROI para generarlas.
      </div>
    )
  }

  const copia = roiLayers.copia
  return (
    <div className="roi-charts-section">
      <Etapa1ChartsPanel compact={compact} roiCharts={roiLayers.charts} roiLabel={roiBox(region)} />
      <p className="roi-charts-section__copy">
        <HardDrive size={12} aria-hidden="true" /> Copia en disco:{' '}
        <code>{copia?.disco ?? 'data/graficas-roi/…'}</code>
        <br />
        <Database size={12} aria-hidden="true" /> Base de datos:{' '}
        {copia ? DB_LABEL[copia.base_datos] ?? copia.base_datos : DB_LABEL.guardando}
        {copia?.escenas && copia.escenas.length > 0 && (
          <> · ROI id {copia.escenas[0].roi_id} (consultable en <code>/api/scenes/…/charts?roi={copia.escenas[0].roi_id}</code>)</>
        )}
      </p>
      <p className="roi-charts-section__note">
        Inspección exploratoria de cada fecha: describe la respuesta radar en la ROI, no identifica causas.
      </p>
    </div>
  )
}
