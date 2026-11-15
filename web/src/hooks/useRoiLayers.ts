import { useEffect, useState } from 'react'
import type { LngLat } from '../types/workspace'
import type { ExploreWebManifest } from '../api/client'

export type RoiLayersState = ReturnType<typeof useRoiLayers>

export function useRoiLayers(region: LngLat[] | null, viewKey: string) {
  const [state, setState] = useState<{
    key: string; loading: boolean; error: string | null; message: string;
    manifests: ExploreWebManifest[]; comparable: boolean
  }>({ key: '', loading: false, error: null, message: '', manifests: [], comparable: false })
  const [attempt, setAttempt] = useState(0)
  const geometry = JSON.stringify(region)
  const key = `${viewKey}:${geometry}:${attempt}`
  useEffect(() => {
    if (!region) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = (data: Partial<typeof state>) => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, ...data, key }))
    }
    update({ loading: true, error: null, message: 'Consultando la ROI…', manifests: [], comparable: false })
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
        const points = JSON.parse(geometry) as LngLat[]
        const ring = [...points]
        if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) ring.push(ring[0])
        const { id } = await json('/api/roi-jobs', { roi: { type: 'Polygon', coordinates: [ring] } })
        const deadline = Date.now() + 35 * 60 * 1000
        async function poll() {
          try {
            const result = await json(`/api/roi-jobs/${id}`)
            if (result.status === 'error') throw new Error(result.message)
            if (result.status === 'ready') {
              // La ventana permanece hasta que las imágenes están disponibles.
              update({ message: 'Cargando imágenes de la ROI…' })
              await Promise.all(result.manifests.flatMap((m: ExploreWebManifest) => m.capas.map(c =>
                new Promise<void>((resolve, reject) => {
                  const img = new Image()
                  img.onload = () => resolve()
                  img.onerror = () => reject(new Error('No se pudo cargar una imagen de la ROI.'))
                  img.src = `/${c.png}`
                }))))
              update({ loading: false, manifests: result.manifests, comparable: result.comparable, message: result.message })
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
  return { ...state, loading: Boolean(region) && (!current || state.loading),
    error: current ? state.error : null, manifests: current ? state.manifests : [],
    comparable: current && state.comparable, retry: () => setAttempt(n => n + 1) }
}
