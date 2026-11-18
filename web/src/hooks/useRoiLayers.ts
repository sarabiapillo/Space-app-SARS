import { useCallback, useEffect, useRef, useState } from 'react'
import type { LngLat } from '../types/workspace'
import type { RoiGeometry } from '../utils/roi'
import type { ExploreWebManifest } from '../api/client'
import type { ExploreChartsManifest } from '../mocks/initialWorkspaces'
import { isChangeManifest, type RoiChangeManifest } from '../utils/changeLayer.ts'
import { localizeText } from '../i18n/core.ts'
import { useTranslation } from '../i18n/useTranslation.ts'

/** Gráficas de una escena de la ROI (graficas.json generado por etapa1 sobre la ROI dibujada). */
export interface RoiChartsEntry {
  granuleId: string
  fecha: string
  manifest: ExploreChartsManifest
}

/** Dónde quedó la copia de las gráficas de la ROI (disco y PostGIS). */
export interface RoiChartsCopy {
  disco?: string | null
  base_datos: 'ok' | 'parcial' | 'no disponible' | 'guardando'
  escenas?: Array<{ granuleId: string; code_version: string; roi_id: string; graficas: number }>
  errores?: string[]
}

export type RoiLayersState = ReturnType<typeof useRoiLayers>

export function useRoiLayers(region: LngLat[] | RoiGeometry | null, viewKey: string) {
  useTranslation() // Subscribe for display-only changes; never restart the ROI job on language switch.
  const [state, setState] = useState<{
    key: string; loading: boolean; error: string | null; message: string;
    manifests: ExploreWebManifest[]; comparable: boolean; change: RoiChangeManifest | null
    charts: RoiChartsEntry[]; copia: RoiChartsCopy | null; jobId: string | null
  }>({ key: '', loading: false, error: null, message: '', manifests: [], comparable: false, change: null, charts: [], copia: null, jobId: null })
  const [attempt, setAttempt] = useState(0)
  const geometry = JSON.stringify(region)
  const key = `${viewKey}:${geometry}:${attempt}`
  // Recálculo del mapa de cambio (otro multilook/umbral) sobre la ROI ya preparada.
  const [changeJob, setChangeJob] = useState<{ key: string; busy: boolean; error: string | null }>({ key: '', busy: false, error: null })
  const changeRequest = useRef(0)
  const recomputeChange = useCallback(async (multilook: number, umbralDb: number) => {
    const jobId = state.key === key ? state.jobId : null
    if (!jobId) return
    const request = ++changeRequest.current
    setChangeJob({ key, busy: true, error: null })
    try {
      const response = await fetch(`/api/roi-jobs/${jobId}/change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ multilook, umbral_dB: umbralDb }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || `No se pudo recalcular el mapa de cambio (HTTP ${response.status}).`)
      if (!isChangeManifest(data)) throw new Error('Respuesta inesperada del servidor.')
      await Promise.all(data.capas.map(c => new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('No se pudo cargar una imagen del mapa de cambio.'))
        img.src = `/${c.png}`
      })))
      if (request !== changeRequest.current) return   // llegó una petición más nueva
      setState(previous => previous.key === key ? { ...previous, change: data } : previous)
      setChangeJob({ key, busy: false, error: null })
    } catch (error) {
      if (request !== changeRequest.current) return
      setChangeJob({ key, busy: false, error: error instanceof Error ? error.message : 'Error de conexión.' })
    }
  }, [key, state.key, state.jobId])
  useEffect(() => {
    if (!region) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = (data: Partial<typeof state>) => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, ...data, key }))
    }
    update({ loading: true, error: null, message: 'Consultando la ROI…', manifests: [], comparable: false, change: null, charts: [], copia: null, jobId: null })
    async function json(url: string, body?: unknown) {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!response.ok) throw new Error(`No se pudo cargar la ROI (HTTP ${response.status}). Verifica el servidor y los límites de la región.`)
      return response.json()
    }
    async function start() {
      try {
        const parsed = JSON.parse(geometry) as LngLat[] | RoiGeometry
        const roi = Array.isArray(parsed)
          ? { type: 'Polygon', coordinates: [[...parsed, ...(JSON.stringify(parsed[0]) === JSON.stringify(parsed.at(-1)) ? [] : [parsed[0]])]] }
          : parsed
        const { id } = await json('/api/roi-jobs', { roi })
        update({ jobId: id })
        const deadline = Date.now() + 35 * 60 * 1000
        async function poll() {
          try {
            const result = await json(`/api/roi-jobs/${id}`)
            if (result.status === 'error') throw new Error(result.message)
            if (result.status === 'ready') {
              // La ventana permanece hasta que las imágenes están disponibles.
              update({ message: 'Cargando imágenes de la ROI…' })
              // Mapa de cambio t2 − t1: solo si el backend lo calculó (par comparable).
              const change = result.comparable && isChangeManifest(result.change) ? result.change : null
              const pngLayers: Array<{ png: string }> = [
                ...result.manifests.flatMap((m: ExploreWebManifest) => m.capas),
                ...(change ? change.capas : []),
              ]
              await Promise.all(pngLayers.map(c =>
                new Promise<void>((resolve, reject) => {
                  const img = new Image()
                  img.onload = () => resolve()
                  img.onerror = () => reject(new Error('No se pudo cargar una imagen de la ROI.'))
                  img.src = `/${c.png}`
                })))
              update({ loading: false, manifests: result.manifests, comparable: result.comparable, change, message: result.message,
                charts: Array.isArray(result.charts) ? result.charts : [], copia: result.copia ?? null })
              // La copia en PostGIS se escribe justo después de terminar: consultar una vez más su estado.
              if (result.copia?.base_datos === 'guardando') {
                timer = setTimeout(async () => {
                  try {
                    const again = await json(`/api/roi-jobs/${id}`)
                    if (again.copia) update({ copia: again.copia })
                  } catch { /* el estado de la copia es informativo */ }
                }, 2500)
              }
              return
            }
            if (Date.now() > deadline) throw new Error('Se agotó el tiempo de espera. Reintenta la carga.')
            update({ message: result.message })
            timer = setTimeout(poll, 1800)
          } catch (error) {
            update({ loading: false, error: error instanceof Error ? error.message : 'Error de carga.' })
          }
        }
        await poll()
      } catch (error) {
        update({ loading: false, error: error instanceof Error ? error.message : 'Error de conexión.' })
      }
    }
    void start()
    return () => { controller.abort(); clearTimeout(timer) }
    // geometry es la representación estable de region.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const current = state.key === key
  return { ...state, message: localizeText(state.message),
    loading: Boolean(region) && (!current || state.loading),
    error: current ? localizeText(state.error) : null, manifests: current ? state.manifests : [],
    comparable: current && state.comparable, change: current ? state.change : null, charts: current ? state.charts : [],
    copia: current ? state.copia : null, retry: () => setAttempt(n => n + 1),
    recomputeChange, changeBusy: changeJob.key === key && changeJob.busy,
    changeError: changeJob.key === key ? localizeText(changeJob.error) : null }
}
