import { useEffect, useMemo, useRef, useState } from 'react'
import { getGcovDownloadStatus, requestGcovDownload, searchGcov, type GcovDownloadStatus, type GcovSearchScene } from '../api/client'
import { compareGcovMetadata, isCurrentRoiRequest, isValidGcovDateRange } from '../utils/roi'
import type { ToastKind } from './Toast'

function sortGcovScenes(scenes: GcovSearchScene[], sort: 'coverage' | 'date' | 'maturity'): GcovSearchScene[] {
  return [...scenes].sort((a, b) => sort === 'coverage' ? (b.coverage_pct ?? -1) - (a.coverage_pct ?? -1) : sort === 'date' ? b.start_time.localeCompare(a.start_time) : (a.maturity ?? '').localeCompare(b.maturity ?? ''))
}

export function GcovCatalog({ roi, start, end, onStartChange, onEndChange, onFootprint, onNotify }: { roi: unknown | null; start: string; end: string; onStartChange: (date: string) => void; onEndChange: (date: string) => void; onFootprint: (feature: unknown | null) => void; onNotify: (kind: ToastKind, text: string) => void }) {
  const [scenes, setScenes] = useState<GcovSearchScene[]>([]), [selected, setSelected] = useState<string | null>(null), [pairIds, setPairIds] = useState<string[]>([])
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  const [sort, setSort] = useState<'coverage' | 'date' | 'maturity'>('coverage')
  const requestVersion = useRef(0)
  const currentRoiKey = JSON.stringify(roi)
  const currentRoiKeyRef = useRef(currentRoiKey)
  const rows = useMemo(() => sortGcovScenes(scenes, sort), [scenes, sort])
  const invalidDateRange = !isValidGcovDateRange(start, end)
  const pair = pairIds.length === 2 ? pairIds.map(id => scenes.find(scene => scene.scene_id === id)).filter((scene): scene is GcovSearchScene => Boolean(scene)) : []
  const pairCheck = pair.length === 2 ? compareGcovMetadata(pair[0], pair[1]) : null

  useEffect(() => {
    currentRoiKeyRef.current = currentRoiKey
    requestVersion.current += 1
    onFootprint(null)
    return () => { requestVersion.current += 1 }
  }, [currentRoiKey, onFootprint])

  const search = async () => {
    if (!roi || invalidDateRange) return
    const version = ++requestVersion.current, roiKey = currentRoiKey
    setBusy(true); setScenes([]); setSelected(null); setPairIds([]); onFootprint(null); setStatus('Consultando catálogo ASF…')
    try {
      const result = await searchGcov(roi, start || undefined, end || undefined)
      if (requestVersion.current !== version || currentRoiKeyRef.current !== roiKey) return
      setScenes(result.scenes); setStatus(result.count ? `${result.count} escenas GCOV. ${result.coverage_note}` : 'ASF no encontró escenas GCOV que intersecten esta ROI.')
      if (result.count) onNotify('success', 'Consulta del catálogo completada.')
    } catch (cause) {
      if (requestVersion.current === version && currentRoiKeyRef.current === roiKey) { setStatus(''); onNotify('error', cause instanceof Error ? cause.message : 'No se pudo buscar GCOV.') }
    } finally {
      if (requestVersion.current === version && currentRoiKeyRef.current === roiKey) setBusy(false)
    }
  }

  const togglePair = (sceneId: string) => setPairIds(current => current.includes(sceneId) ? current.filter(id => id !== sceneId) : current.length < 2 ? [...current, sceneId] : [current[1], sceneId])

  const download = async (scene: GcovSearchScene) => {
    if (!roi || !window.confirm(`Solicitar el recorte de la ROI para ${scene.scene_id}? No se descargará la escena completa.`)) return
    const version = ++requestVersion.current, roiKey = currentRoiKey
    const isCurrent = () => isCurrentRoiRequest(roiKey, currentRoiKeyRef.current, version, requestVersion.current)
    setStatus(''); setBusy(true)
    try {
      let latest: GcovDownloadStatus = await requestGcovDownload(scene.scene_id, roi)
      if (!isCurrent()) return
      setStatus(`${latest.status}: ${latest.progress}`)
      if (!latest.job_id) {
        if (latest.status === 'ready') { setScenes(prev => prev.map(item => item.scene_id === scene.scene_id ? { ...item, downloaded: true, local_path: latest.path ?? item.local_path } : item)); onNotify('success', 'Recorte de la ROI disponible.') }
        if (latest.status === 'error') { setStatus(''); onNotify('error', latest.progress) }
        return
      }
      const jobId = latest.job_id
      while (latest.status === 'queued' || latest.status === 'running') {
        await new Promise(resolve => window.setTimeout(resolve, 1500))
        if (!isCurrent()) return
        latest = await getGcovDownloadStatus(jobId)
        if (!isCurrent()) return
        setStatus(`${latest.status}: ${latest.progress}`)
      }
      if (latest.status === 'error') { setStatus(''); onNotify('error', latest.progress) }
      if (latest.status === 'ready') { setScenes(prev => prev.map(item => item.scene_id === scene.scene_id ? { ...item, downloaded: true, local_path: latest.path ?? item.local_path } : item)); onNotify('success', 'Recorte de la ROI disponible.') }
    } catch (cause) { if (isCurrent()) { setStatus(''); onNotify('error', cause instanceof Error ? cause.message : 'La solicitud de recorte falló.') } }
    finally { if (isCurrent()) setBusy(false) }
  }

  return <section className="gcov-catalog" aria-label="Catálogo GCOV">
    <div className="gcov-catalog__filters">{(['Desde', 'Hasta'] as const).map((label, index) => { const value = index === 0 ? start : end; const update = index === 0 ? onStartChange : onEndChange; return <label key={label}>{label}<span className="gcov-catalog__date-control"><input aria-label={label} type="date" value={value} onChange={e => update(e.target.value)} /><button type="button" className="gcov-catalog__clear" disabled={!value} aria-label={`Limpiar ${label.toLowerCase()}`} onClick={() => update('')}>Limpiar</button></span></label> })}<button className="btn btn--primary" disabled={!roi || busy || invalidDateRange} onClick={search}>{busy ? 'Consultando…' : 'Buscar GCOV'}</button></div>
    {invalidDateRange && <p className="gcov-catalog__date-error" role="alert">La fecha Desde no puede ser posterior a Hasta.</p>}
    {!roi && <p>Confirma una ROI para consultar ASF.</p>}{status && <p role="status">{status}</p>}
    {scenes.length > 0 && <>
      <p className="gcov-catalog__metadata-warning"><strong>Comparación solo de metadatos:</strong> coincidencias del catálogo no verifican malla ni píxeles válidos; no confirman comparabilidad científica.</p>
      <label className="gcov-catalog__sort">Ordenar por<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="coverage">Cobertura estimada</option><option value="date">Fecha</option><option value="maturity">Madurez</option></select></label>
      <fieldset className="gcov-catalog__pair"><legend>Adquisiciones candidatas ({pairIds.length}/2)</legend><p>Selecciona hasta dos para comparar metadatos. Esto no conecta el comparador temporal.</p>{pairCheck && <div role="status"><strong>{pairCheck.compatible ? 'Coincidencia de metadatos' : 'Metadatos incompatibles'}</strong><ul>{pairCheck.checks.map(({ field, matches }) => <li key={field}>{field}: {matches ? 'coincide' : 'no coincide o no consta'}</li>)}</ul><p>Malla y píxeles válidos no verificados. No es una comprobación científica.</p></div>}</fieldset>
      <ul className="gcov-catalog__rows">{rows.map(scene => <li key={scene.scene_id}><label className="gcov-catalog__candidate"><input type="checkbox" checked={pairIds.includes(scene.scene_id)} onChange={() => togglePair(scene.scene_id)} aria-label={`Incluir ${scene.scene_id} en comparación de metadatos`} /><span>Comparar</span></label><button type="button" className="gcov-catalog__scene" aria-pressed={selected === scene.scene_id} onClick={() => {
        setSelected(scene.scene_id)
        const features = [scene.footprint ? { type: 'Feature', properties: { scene_id: scene.scene_id, role: 'footprint' }, geometry: scene.footprint } : null, scene.roi_intersection ? { type: 'Feature', properties: { scene_id: scene.scene_id, role: 'intersection' }, geometry: scene.roi_intersection } : null].filter(Boolean)
        onFootprint(features.length ? { type: 'FeatureCollection', features } : null)
      }}><strong>{scene.date ?? scene.start_time.slice(0, 10)} · {scene.maturity ?? 'Madurez desconocida'}</strong><span>{scene.product} · T{scene.track ?? 'n/d'}/F{scene.frame ?? 'n/d'} · {scene.direction ?? 'Dirección desconocida'} · {scene.polarizations.join('+') || 'Polarización n/d'}</span><span>{scene.crid ?? 'CRID desconocido'} · {scene.coverage_pct == null ? 'Cobertura n/d' : `${scene.coverage_pct.toFixed(1)}% de huella`}</span><code>{scene.scene_id}</code><span>{scene.size_bytes == null ? 'Tamaño no disponible' : `${(scene.size_bytes / 1e9).toFixed(1)} GB`} · {scene.downloaded ? 'Recorte C1 disponible para esta ROI' : 'No descargada para esta ROI'}</span>{scene.downloaded && scene.local_path && <small>Ruta C1 (estado informativo): <code>{scene.local_path}</code></small>}</button><button className="btn btn--sm" disabled={busy || scene.downloaded} onClick={() => download(scene)}>{scene.downloaded ? 'Disponible' : 'Recortar ROI'}</button></li>)}</ul><small>El porcentaje se estima con la huella de catálogo; no es porcentaje de píxeles válidos. La disponibilidad y ruta C1 corresponden a la ROI consultada.</small>
    </>}
  </section>
}
