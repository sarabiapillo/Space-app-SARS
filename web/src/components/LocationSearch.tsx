import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { generateLocationRoi, searchLocations, suggestLocations, type LocationResult } from '../api/client'
import {
  DEFAULT_LOCATION_RADIUS_KM,
  MAX_LOCATION_RADIUS_KM,
  MIN_LOCATION_RADIUS_KM,
  deduplicateLocationResults,
  formatLocationResultLabel,
  getLocationResultKey,
  isAcceptableEffectiveRoi,
  roiGenerationNotice,
  type EffectiveRoiMetadata,
  type RoiGeometry,
} from '../utils/roi'
import type { ToastKind } from './Toast'

export function LocationSearch({ onPreview, onConfirmROI, onDrawROI, onNotify }: { onPreview: (geometry: RoiGeometry | null) => void; onConfirmROI: (geometry: RoiGeometry, metadata: EffectiveRoiMetadata) => boolean | void; onDrawROI: () => void; onNotify: (kind: ToastKind, text: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocationResult[]>([])
  const [selected, setSelected] = useState<LocationResult | null>(null)
  const [radius, setRadius] = useState(DEFAULT_LOCATION_RADIUS_KM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Array<{ name: string; query: string }>>([])
  const [suggestionError, setSuggestionError] = useState('')
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const suggestionRequest = useRef(0)
  const suggestionTimer = useRef<number | null>(null)
  const suggestionController = useRef<AbortController | null>(null)
  const suppressNextSuggestion = useRef(false)
  const requestId = useRef(0)
  const lastNoticeKey = useRef<string | null>(null)

  const visibleResults = useMemo(() => deduplicateLocationResults(results), [results])

  useEffect(() => {
    if (suppressNextSuggestion.current) { suppressNextSuggestion.current = false; return }
    if (query.trim().length < 3) return
    const controller = new AbortController()
    suggestionController.current = controller
    const id = ++suggestionRequest.current
    suggestionTimer.current = window.setTimeout(async () => {
      try {
        const response = await suggestLocations(query.trim(), controller.signal)
        if (suggestionRequest.current === id) setSuggestions(response.suggestions)
      } catch {
        if (suggestionRequest.current === id && !controller.signal.aborted) setSuggestionError('No hay sugerencias disponibles. Usa Buscar.')
      }
    }, 550)
    return () => { if (suggestionTimer.current !== null) window.clearTimeout(suggestionTimer.current); controller.abort() }
  }, [query])

  const clearSuggestions = () => {
    suggestionRequest.current += 1
    if (suggestionTimer.current !== null) window.clearTimeout(suggestionTimer.current)
    suggestionController.current?.abort()
    setSuggestions([]); setActiveSuggestion(-1); setSuggestionError('')
  }
  const invalidate = () => { requestId.current += 1; setBusy(false); onPreview(null) }
  const generate = async (place: LocationResult, searchQuery: string, radiusKm: number, confirm: boolean) => {
    const id = ++requestId.current
    setBusy(true); setError(''); onPreview(null)
    try {
      const result = await generateLocationRoi({ place_id: place.place_id, query: searchQuery, radius_km: radiusKm })
      if (id !== requestId.current) return
      if (!isAcceptableEffectiveRoi(result.geometry, result.metadata.generation)) {
        throw new Error('El servicio devolvió una ROI inválida: debe ser un polígono o multipolígono dentro del límite de 0.6° por lado.')
      }
      if (!Number.isFinite(result.metadata.applied_radius_km) || result.metadata.applied_radius_km <= 0) throw new Error('El servicio no informó el radio realmente aplicado.')
      onPreview(result.geometry)
      if (confirm) {
        const accepted = onConfirmROI(result.geometry, result.metadata)
        if (accepted === false) return
      }
      const notice = roiGenerationNotice(result.metadata.generation, result.metadata.applied_radius_km)
      const noticeKey = `${place.place_id}:${radiusKm}:${result.metadata.generation}:${result.metadata.applied_radius_km}`
      if (notice && noticeKey !== lastNoticeKey.current) {
        lastNoticeKey.current = noticeKey
        onNotify('info', notice)
      }
    } catch (cause) {
      if (id === requestId.current) {
        const message = cause instanceof Error ? cause.message : 'No se pudo generar la región de análisis.'
        setError(message); onNotify('error', message)
      }
    } finally { if (id === requestId.current) setBusy(false) }
  }
  const lookup = async (searchQuery: string) => {
    clearSuggestions()
    invalidate()
    const id = ++requestId.current
    setBusy(true); setError(''); setSearchedQuery(''); setSelected(null); setResults([])
    try {
      const response = await searchLocations(searchQuery)
      if (id !== requestId.current) return
      setSearchedQuery(searchQuery); setResults(response.results)
    } catch (cause) {
      if (id === requestId.current) {
        const message = cause instanceof Error ? cause.message : 'Falló la búsqueda geográfica.'
        setError(message); onNotify('error', message)
      }
    } finally { if (id === requestId.current) setBusy(false) }
  }
  const selectSuggestion = (suggestion: { name: string; query: string }) => {
    suppressNextSuggestion.current = true
    setQuery(suggestion.query)
    void lookup(suggestion.query)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (activeSuggestion >= 0 && suggestions[activeSuggestion]) selectSuggestion(suggestions[activeSuggestion])
    else void lookup(query.trim())
  }
  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { clearSuggestions(); return }
    if (!suggestions.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestion(current => event.key === 'ArrowDown'
        ? (current + 1) % suggestions.length : (current - 1 + suggestions.length) % suggestions.length)
    }
  }
  const select = (result: LocationResult) => {
    setSelected(result); setError('')
    void generate(result, query.trim(), radius, false)
  }
  const updateRadius = (next: number) => {
    setRadius(next)
    if (selected) void generate(selected, query.trim(), next, false)
  }
  const confirm = () => { if (selected) void generate(selected, query.trim(), radius, true) }

  return <section className="geo-search" aria-label="Buscar ubicación">
    <form onSubmit={submit}>
      <label htmlFor="location-query">Buscar ubicación</label>
      <div className="geo-search__row"><input id="location-query" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="location-suggestions" aria-activedescendant={activeSuggestion >= 0 ? `location-suggestion-${activeSuggestion}` : undefined} value={query} onKeyDown={onQueryKeyDown} onChange={event => { clearSuggestions(); suppressNextSuggestion.current = false; setQuery(event.target.value); setSearchedQuery(''); setSelected(null); setResults([]); invalidate() }} placeholder="Ej. Tuxtla Gutiérrez, Chiapas" maxLength={200} autoComplete="off" /><button className="btn btn--primary" disabled={busy || !query.trim()}>{busy ? 'Buscando…' : 'Buscar'}</button></div>
    </form>
    {suggestions.length > 0 && <ul id="location-suggestions" className="geo-search__results" role="listbox" aria-label="Sugerencias de ubicación">{suggestions.map((suggestion, index) => <li key={suggestion.query} id={`location-suggestion-${index}`} role="option" aria-selected={activeSuggestion === index}><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => selectSuggestion(suggestion)}>{suggestion.name}</button></li>)}</ul>}
    {suggestionError && <small role="status">{suggestionError}</small>}
    {visibleResults.length > 0 && <ul className="geo-search__results" aria-label="Resultados geográficos">{visibleResults.map((result) => {
      const label = formatLocationResultLabel(result)
      return <li key={getLocationResultKey(result)}><button type="button" aria-pressed={selected === result} onClick={() => select(result)}><strong>{label.primary}</strong></button></li>
    })}</ul>}
    {error && <p role="alert">{error}</p>}
    {!busy && searchedQuery === query.trim() && visibleResults.length === 0 && !error && <p role="status">Sin resultados para “{query}”. Prueba un nombre más específico.</p>}
    {selected && <div className="geo-search__selection"><label htmlFor="roi-radius">Radio máximo: {radius} km</label><input id="roi-radius" type="range" min={MIN_LOCATION_RADIUS_KM} max={MAX_LOCATION_RADIUS_KM} step="1" value={radius} onChange={event => updateRadius(Number(event.target.value))} /><div className="geo-search__radius"><span>1 km</span><span>{MAX_LOCATION_RADIUS_KM} km</span></div>{busy && <p role="status">Actualizando región…</p>}<button type="button" className="btn btn--primary" disabled={busy} onClick={confirm}>Confirmar región de análisis</button><button type="button" className="link-btn" onClick={onDrawROI}>Dibujar o editar región</button></div>}
    <small>© OpenStreetMap contributors · ODbL 1.0</small>
  </section>
}
