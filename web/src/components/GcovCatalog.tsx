import { useEffect, useMemo, useRef, useState } from 'react'
import { getGcovDownloadStatus, requestGcovDownload, searchGcov, type GcovDownloadStatus, type GcovSearchScene } from '../api/client'
import { compareGcovMetadata, isCurrentRoiRequest, isValidGcovDateRange } from '../utils/roi'
import type { ToastKind } from './Toast'
import { useTranslation } from '../i18n/useTranslation.ts'

function sortGcovScenes(scenes: GcovSearchScene[], sort: 'coverage' | 'date' | 'maturity'): GcovSearchScene[] {
  return [...scenes].sort((a, b) => sort === 'coverage' ? (b.coverage_pct ?? -1) - (a.coverage_pct ?? -1) : sort === 'date' ? b.start_time.localeCompare(a.start_time) : (a.maturity ?? '').localeCompare(b.maturity ?? ''))
}

function displayAcquisitionDate(value: string, locale: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
    : value
}

export function GcovCatalog({ roi, start, end, onStartChange, onEndChange, onFootprint, onNotify, onScenesChange, onSceneSelect }: { roi: unknown | null; start: string; end: string; onStartChange: (date: string) => void; onEndChange: (date: string) => void; onFootprint: (feature: unknown | null) => void; onNotify: (kind: ToastKind, text: string) => void; onScenesChange?: (scenes: GcovSearchScene[]) => void; onSceneSelect?: (sceneId: string) => void }) {
  const { t, localizeText, locale } = useTranslation()
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

  const runSearch = async (searchStart: string, searchEnd: string) => {
    if (!roi || !isValidGcovDateRange(searchStart, searchEnd)) return
    const version = ++requestVersion.current, roiKey = currentRoiKey
    setBusy(true); setScenes([]); onScenesChange?.([]); setSelected(null); setPairIds([]); onFootprint(null); setStatus('Consultando catálogo ASF…')
    try {
      const result = await searchGcov(roi, searchStart || undefined, searchEnd || undefined)
      if (requestVersion.current !== version || currentRoiKeyRef.current !== roiKey) return
      setScenes(result.scenes); onScenesChange?.(result.scenes); setStatus(result.count ? `${result.count} escenas GCOV. ${result.coverage_note}` : 'ASF no encontró escenas GCOV que intersecten esta ROI.')
      if (result.count) onNotify('success', t('Consulta del catálogo completada.', 'Catalog search completed.'))
    } catch (cause) {
      if (requestVersion.current === version && currentRoiKeyRef.current === roiKey) { setStatus(''); onNotify('error', cause instanceof Error ? localizeText(cause.message) : t('No se pudo buscar GCOV.', 'Could not search GCOV.')) }
    } finally {
      if (requestVersion.current === version && currentRoiKeyRef.current === roiKey) setBusy(false)
    }
  }
  const search = () => runSearch(start, end)

  useEffect(() => {
    currentRoiKeyRef.current = currentRoiKey
    requestVersion.current += 1
    // Sidebar keys this component by map and ROI: a new identity starts with the
    // initial empty state; cleanup invalidates outstanding searches and downloads.
    onFootprint(null)
    let active = true
    if (roi) {
      // One search per mounted ROI identity. Cancelled effect setups never issue a request
      // (including React StrictMode's development-only setup/cleanup replay).
      // Keep the visible date filters authoritative when a different ROI is selected.
      queueMicrotask(() => { if (active) void runSearch(start, end) })
    }
    return () => { active = false; requestVersion.current += 1 }
    // Deliberately keyed to ROI identity: opening/collapsing UI or changing dates never auto-searches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoiKey])

  const togglePair = (sceneId: string) => setPairIds(current => current.includes(sceneId) ? current.filter(id => id !== sceneId) : current.length < 2 ? [...current, sceneId] : [current[1], sceneId])

  const markDownloaded = (scene: GcovSearchScene, latest: GcovDownloadStatus) => {
    const updated = scenes.map(item => item.scene_id === scene.scene_id
      ? { ...item, downloaded: true, local_path: latest.path ?? item.local_path } : item)
    setScenes(updated)
    onScenesChange?.(updated)
    onNotify('success', t('Recorte de la ROI disponible.', 'ROI subset available.'))
  }

  const download = async (scene: GcovSearchScene) => {
    if (!roi || !window.confirm(t('¿Solicitar el recorte de la ROI para {id}? No se descargará la escena completa.', 'Request an ROI subset for {id}? The full scene will not be downloaded.', { id: scene.scene_id }))) return
    const version = ++requestVersion.current, roiKey = currentRoiKey
    const isCurrent = () => isCurrentRoiRequest(roiKey, currentRoiKeyRef.current, version, requestVersion.current)
    setStatus(''); setBusy(true)
    try {
      let latest: GcovDownloadStatus = await requestGcovDownload(scene.scene_id, roi)
      if (!isCurrent()) return
      setStatus(`${latest.status}: ${latest.progress}`)
      if (!latest.job_id) {
        if (latest.status === 'ready') markDownloaded(scene, latest)
        if (latest.status === 'error') { setStatus(''); onNotify('error', localizeText(latest.progress)) }
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
      if (latest.status === 'error') { setStatus(''); onNotify('error', localizeText(latest.progress)) }
      if (latest.status === 'ready') markDownloaded(scene, latest)
    } catch (cause) { if (isCurrent()) { setStatus(''); onNotify('error', cause instanceof Error ? localizeText(cause.message) : t('La solicitud de recorte falló.', 'The subset request failed.')) } }
    finally { if (isCurrent()) setBusy(false) }
  }

  return <section className="gcov-catalog" aria-label={t('Catálogo GCOV', 'GCOV catalog')}>
    <div className="gcov-catalog__filters">{(['Desde', 'Hasta'] as const).map((label, index) => { const value = index === 0 ? start : end; const update = index === 0 ? onStartChange : onEndChange; return <label key={label}>{index === 0 ? t('Desde', 'From') : t('Hasta', 'To')}<span className="gcov-catalog__date-control"><input aria-label={index === 0 ? t('Desde', 'From') : t('Hasta', 'To')} type="date" value={value} onChange={e => update(e.target.value)} /><button type="button" className="gcov-catalog__clear" disabled={!value} aria-label={t('Limpiar {label}', 'Clear {label}', { label: index === 0 ? t('desde', 'from') : t('hasta', 'to') })} onClick={() => update('')}>{t('Limpiar', 'Clear')}</button></span></label> })}<button className="btn btn--primary" disabled={!roi || busy || invalidDateRange} onClick={search}>{busy ? t('Consultando…', 'Searching…') : t('Buscar GCOV', 'Search GCOV')}</button></div>
    {invalidDateRange && <p className="gcov-catalog__date-error" role="alert">{t('La fecha Desde no puede ser posterior a Hasta.', 'The From date cannot be later than the To date.')}</p>}
    {!roi && <p>{t('Confirma una ROI para consultar ASF.', 'Confirm an ROI to search ASF.')}</p>}{status && <p role="status">{(() => { const job = /^(queued|running|ready|error|recovery_required): (.*)$/s.exec(status); return job ? `${localizeText(job[1])}: ${localizeText(job[2])}` : localizeText(status) })()}</p>}
    {scenes.length > 0 && <>
      <label className="gcov-catalog__sort">{t('Ordenar por', 'Sort by')}{' '}
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
          <option value="coverage">{t('Cobertura estimada', 'Estimated coverage')}</option>
          <option value="date">{t('Fecha', 'Date')}</option>
          <option value="maturity">{t('Madurez', 'Data maturity')}</option>
        </select>
      </label>
      <ul className="gcov-catalog__rows">{rows.map(scene => <li key={scene.scene_id}>
        <button type="button" className="gcov-catalog__scene" aria-pressed={selected === scene.scene_id} onClick={() => {
          setSelected(scene.scene_id)
          onSceneSelect?.(scene.scene_id)
          const features = [scene.footprint ? { type: 'Feature', properties: { scene_id: scene.scene_id, role: 'footprint' }, geometry: scene.footprint } : null,
            scene.roi_intersection ? { type: 'Feature', properties: { scene_id: scene.scene_id, role: 'intersection' }, geometry: scene.roi_intersection } : null].filter(Boolean)
          onFootprint(features.length ? { type: 'FeatureCollection', features } : null)
        }}>
          <strong>{displayAcquisitionDate(scene.date ?? scene.start_time.slice(0, 10), locale)}</strong>
          <span>{scene.maturity ?? t('Madurez desconocida', 'Unknown data maturity')} · {scene.direction ?? t('Dirección desconocida', 'Unknown direction')}</span>
          <span>T{scene.track ?? t('n/d', 'n/a')}/F{scene.frame ?? t('n/d', 'n/a')} · {scene.polarizations.join('+') || t('Polarización n/d', 'Polarization n/a')}</span>
        </button>
        <div className="gcov-catalog__actions">
          <label className="gcov-catalog__candidate"><input type="checkbox" checked={pairIds.includes(scene.scene_id)} onChange={() => togglePair(scene.scene_id)} aria-label={t('Incluir {id} en comparación de metadatos', 'Include {id} in metadata comparison', { id: scene.scene_id })} />{t('Comparar', 'Compare')}</label>
          <button type="button" className="btn btn--sm" disabled={busy || scene.downloaded} onClick={() => download(scene)}>{scene.downloaded ? t('Disponible', 'Available') : t('Recortar ROI', 'Subset ROI')}</button>
        </div>
      </li>)}</ul>
      <details className="gcov-catalog__comparison">
        <summary>{t('Adquisiciones candidatas', 'Candidate acquisitions')} ({pairIds.length}/2)</summary>
        <fieldset className="gcov-catalog__pair"><legend>{t('Comparación solo de metadatos:', 'Metadata-only comparison:')}</legend>
          <p>{t('Selecciona hasta dos para comparar metadatos. Esto no conecta el comparador temporal.', 'Select up to two to compare metadata. This does not connect the temporal comparison view.')}</p>
          {pairCheck && <div role="status"><strong>{pairCheck.compatible ? t('Coincidencia de metadatos', 'Matching metadata') : t('Metadatos incompatibles', 'Incompatible metadata')}</strong><ul>{pairCheck.checks.map(({ field, matches }) => <li key={field}>{localizeText(field)}: {matches ? t('coincide', 'matches') : t('no coincide o no consta', 'does not match or is unknown')}</li>)}</ul><p>{t('Malla y píxeles válidos no verificados. No es una comprobación científica.', 'Grid and valid pixels have not been verified. This is not a scientific validation.')}</p></div>}
          <p className="gcov-catalog__metadata-warning">{t('coincidencias del catálogo no verifican malla ni píxeles válidos; no confirman comparabilidad científica.', 'catalog matches do not verify the grid or valid pixels; they do not confirm scientific comparability.')}</p>
          <small>{t('El porcentaje se estima con la huella de catálogo; no es porcentaje de píxeles válidos. La disponibilidad y ruta C1 corresponden a la ROI consultada.', 'The percentage is estimated from the catalog footprint; it is not the percentage of valid pixels. C1 availability and path refer to the queried ROI.')}</small>
        </fieldset>
      </details>
    </>}
  </section>
}
