import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { RoiLayersState } from '../hooks/useRoiLayers'
import type { EffectiveRoiMetadata } from '../utils/roi'
import type { GcovSearchScene } from '../api/client'
import { RoiChartsSection } from './RoiChartsSection'
import { useTranslation } from '../i18n/useTranslation'

export function RoiDetailsModal({ roiLayers, roi, metadata, catalogScenes = [], selectedCatalogSceneId, onClose }: { roiLayers?: RoiLayersState; roi: unknown; metadata?: EffectiveRoiMetadata | null; catalogScenes?: GcovSearchScene[]; selectedCatalogSceneId?: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'scenes' | 'charts' | 'technical'>('scenes')
  const [collapsed, setCollapsed] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])
  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (collapsed || event.key !== 'Tab') return
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])')
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  const tabLabels = [t('Escenas GCOV', 'GCOV scenes'), t('Gráficas NISAR', 'NISAR charts'), t('Datos técnicos', 'Technical data')]
  return createPortal(<div className="solar-analysis-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className={collapsed ? 'solar-analysis-dialog roi-details-modal is-collapsed' : 'solar-analysis-dialog roi-details-modal'} role="dialog" aria-modal={!collapsed} aria-labelledby="roi-details-title" tabIndex={-1} onKeyDown={trapFocus}>
      <header className="solar-analysis-dialog__header"><h2 id="roi-details-title">{metadata?.name || t('Detalles de la ROI', 'ROI details')}</h2><div className="solar-analysis-dialog__actions"><span role="status">{collapsed ? t('Detalles retraídos', 'Details collapsed') : t('Detalles expandidos', 'Details expanded')}</span><button type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed} aria-controls="roi-details-content" aria-label={collapsed ? t('Expandir detalles', 'Expand details') : t('Retraer detalles', 'Collapse details')}>{collapsed ? <ChevronDown /> : <ChevronUp />}</button><button type="button" aria-label={t('Cerrar', 'Close')} onClick={onClose}><X /></button></div></header>
      {!collapsed && <div id="roi-details-content"><nav className="solar-analysis-nav roi-details-tabs" aria-label={t('Detalles de la ROI', 'ROI details')}>
        {(['scenes', 'charts', 'technical'] as const).map((name, index) => <button key={name} type="button" aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>{tabLabels[index]}</button>)}
      </nav>
      <div className="solar-api-results roi-details-content"><div className="solar-api-results__header"><strong className="solar-api-results__title">{tabLabels[['scenes', 'charts', 'technical'].indexOf(tab)]}</strong></div>
        {tab === 'scenes' && <div className="roi-scene-details">{!roiLayers && <p role="status">{t('Preparando la ROI…', 'Preparing ROI…')}</p>}{roiLayers?.loading && <p role="status">{roiLayers.message}</p>}{roiLayers?.error && <p role="alert">{roiLayers.error}</p>}{!roiLayers?.loading && !roiLayers?.error && roiLayers?.manifests.length === 0 && <p>{t('No hay información de escenas disponible para esta ROI.', 'No scene information is available for this ROI.')}</p>}{roiLayers?.manifests.map((manifest, index) => <article key={manifest.escena.granuleId}>
          <h3>t{index + 1} · {manifest.escena.fecha_inicio.slice(0, 10)}</h3>
          <div className="solar-api-grid">
            <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Trayectoria / Marco', 'Track / Frame')}</span><strong className="solar-api-stat__val">{manifest.escena.trayectoria}/{manifest.escena.marco}</strong></div>
            <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Dirección', 'Direction')}</span><strong className="solar-api-stat__val">{manifest.escena.direccion}</strong></div>
            <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Madurez', 'Data maturity')}</span><strong className="solar-api-stat__val">{manifest.escena.madurez_catalogo ?? t('Madurez desconocida', 'Unknown maturity')}</strong></div>
            <div className="solar-api-stat"><span className="solar-api-stat__label">{t('Polarizaciones', 'Polarizations')}</span><strong className="solar-api-stat__val">{manifest.escena.polarizaciones.join(', ')}</strong></div>
            {manifest.capas.map(layer => <div className="solar-api-stat" key={layer.id}><span className="solar-api-stat__label">{layer.simbolo} {layer.capa}</span><strong className="solar-api-stat__val">{layer.pct_pixeles_validos.toFixed(2)}% {t('píxeles válidos', 'valid pixels')} · {layer.pixel_m.toFixed(2)} m</strong></div>)}
          </div>
        </article>)}</div>}
        {tab === 'charts' && roiLayers && <RoiChartsSection key={`${JSON.stringify(roi)}:${roiLayers.key}`} roiLayers={roiLayers} compact={false} />}
        {tab === 'charts' && !roiLayers && <p role="status">{t('Preparando la ROI…', 'Preparing ROI…')}</p>}
        {tab === 'technical' && <div className="roi-scene-details">
          {catalogScenes.length > 0 && <section><h3>{t('Catálogo GCOV · ASF', 'GCOV catalog · ASF')}</h3>
            {[...catalogScenes].sort((a, b) => Number(b.scene_id === selectedCatalogSceneId) - Number(a.scene_id === selectedCatalogSceneId)).map(scene =>
              <details key={scene.scene_id} open={scene.scene_id === selectedCatalogSceneId}>
                <summary>{scene.date ?? scene.start_time.slice(0, 10)} · {scene.maturity ?? t('Madurez desconocida', 'Unknown data maturity')}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(scene, null, 2)}</pre>
              </details>)}</section>}
          <h3>{t('Metadatos de la ROI', 'ROI metadata')}</h3><p>{t('Nombre:', 'Name:')} {metadata?.name ?? t('No disponible', 'Unavailable')}</p>{metadata && <><p>{t('Centro:', 'Center:')} {metadata.center[1]}, {metadata.center[0]}</p><p>{t('Radio solicitado:', 'Requested radius:')} {metadata.radius_km} km</p><p>{t('Radio aplicado:', 'Applied radius:')} {metadata.applied_radius_km} km</p><p>{t('Fuente:', 'Source:')} {metadata.source}</p><p>{t('Generación:', 'Generation:')} {metadata.generation}</p></>}{roiLayers && <><p>{t('Estado:', 'Status:')} {roiLayers.message || roiLayers.error || (roiLayers.loading ? t('Preparando', 'Preparing') : t('Disponible', 'Available'))}</p><p>{t('Duración de preparación:', 'Preparation duration:')} {roiLayers.preparationSeconds ?? t('No disponible', 'Unavailable')}</p>{roiLayers.timings && <><pre>{JSON.stringify(roiLayers.timings, null, 2)}</pre><p>{t('Consulta ASF:', 'ASF search:')} {roiLayers.timings.search_asf_seconds.toFixed(1)} s · {t('Comparación de mallas:', 'Grid comparison:')} {roiLayers.timings.grid_compare_seconds.toFixed(1)} s · {t('Copia de gráficas:', 'Chart copy:')} {roiLayers.timings.chart_copy_seconds.toFixed(1)} s · {t('Preparación total servidor:', 'Server preparation total:')} {roiLayers.timings.server_prepare_total_seconds.toFixed(1)} s</p>{roiLayers.timings.scene_processing_seconds.map((seconds, index) => <p key={index}>t{index + 1}: {seconds.toFixed(1)} s</p>)}</>}{roiLayers.manifests.map(manifest => <article key={manifest.escena.granuleId}><h4>{manifest.escena.fecha_inicio.slice(0, 10)} · {manifest.escena.granuleId}</h4><p>{t('Fecha de adquisición:', 'Acquisition date:')} {manifest.escena.fecha_inicio}</p><p>{manifest.escena.producto} · {manifest.escena.trayectoria}/{manifest.escena.marco} · {manifest.escena.direccion} · {manifest.escena.crid} · {manifest.escena.madurez_catalogo ?? t('Madurez desconocida', 'Unknown maturity')} · {manifest.escena.frecuencia} · {manifest.escena.polarizaciones.join(', ')}</p><p>{t('Granule ID:', 'Granule ID:')} <code>{manifest.escena.granuleId}</code></p><p>{t('Procedencia:', 'Provenance:')} {manifest.procedencia.modo} · {manifest.procedencia.metodo ?? t('Método no disponible', 'Method unavailable')} · {manifest.procedencia.catalogo ?? t('Catálogo no disponible', 'Catalog unavailable')}</p><p>{t('Versión:', 'Version:')} {manifest.version} · {manifest.version_codigo} · {t('Creado UTC:', 'Created UTC:')} {manifest.creado_utc}</p>{manifest.procedencia.url && <p>{t('URL:', 'URL:')} <code>{manifest.procedencia.url}</code></p>}{manifest.capas.map(layer => <details key={layer.id}><summary>{layer.simbolo} {layer.capa}: {layer.pct_pixeles_validos.toFixed(2)}% · {layer.pixel_m.toFixed(2)} m</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(layer, null, 2)}</pre></details>)}<p>{t('ROI WKT:', 'ROI WKT:')} <code>{manifest.roi_wkt_4326}</code></p><p>{t('Metadatos:', 'Metadata:')} <code>{manifest.metadatos}</code></p>{manifest.advertencias.map((warning, index) => <p key={index}>{warning}</p>)}</article>)}{roiLayers.copia && <details><summary>{t('Copia de gráficas:', 'Chart copy:')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(roiLayers.copia, null, 2)}</pre></details>}{roiLayers.charts.map(entry => <details key={entry.granuleId}><summary>{t('Estadísticas de gráficas:', 'Chart statistics:')} {entry.granuleId}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(entry.manifest, null, 2)}</pre></details>)}</>}</div>}
      </div>
      </div>}
    </section>
  </div>, document.body)
}
