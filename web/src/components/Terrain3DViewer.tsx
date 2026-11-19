import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Camera, Mountain, RotateCcw, X } from 'lucide-react'
import { useTranslation } from '../i18n/useTranslation'
import {
  IMAGERY_SOURCE_LABEL,
  TERRAIN_SOURCE_LABEL,
  hypsometricCanvas,
  loadTerrain,
  type LonLatBBox,
  type TerrainData,
} from '../utils/terrain3d'

/** Segmentos por lado de la malla (161 × 161 vértices). */
const SEGMENTS = 160
/** Lado mayor de la maqueta en unidades de escena. */
const MODEL_SIZE = 100
/** Grosor fijo del zócalo bajo minElev: 3.5 % del lado horizontal mayor de la maqueta. */
const BASE_THICKNESS_RATIO = 0.035

type SurfaceMode = 'satellite' | 'hypsometric' | 'wireframe'

interface Terrain3DViewerProps {
  bbox: LonLatBBox
  roiName?: string | null
  onClose: () => void
}

interface SceneApi {
  setExaggeration: (value: number) => void
  setMode: (mode: SurfaceMode) => void
  resetCamera: () => void
  capture: () => string | null
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TerrainData }

export default function Terrain3DViewer({ bbox, roiName, onClose }: Terrain3DViewerProps) {
  const { t, localizeText } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<SceneApi | null>(null)
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [exaggeration, setExaggeration] = useState(2)
  const [mode, setMode] = useState<SurfaceMode>('satellite')

  // 1) Descarga de elevación + textura (una vez por montaje; el padre remonta si cambia la ROI).
  useEffect(() => {
    const ctrl = new AbortController()
    loadTerrain(bbox, SEGMENTS, ctrl.signal).then(
      (data) => setLoad({ status: 'ready', data }),
      (err: unknown) => {
        if ((err as DOMException)?.name === 'AbortError') return
        setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      },
    )
    return () => ctrl.abort()
  }, [bbox])

  const data = load.status === 'ready' ? load.data : null
  const effectiveMode: SurfaceMode = mode === 'satellite' && data && !data.imagery ? 'hypsometric' : mode

  // 2) Escena Three.js: se construye una sola vez con los datos y se libera al desmontar.
  useEffect(() => {
    const container = containerRef.current
    if (!data || !container) return
    const { grid } = data
    const k = MODEL_SIZE / Math.max(grid.widthM, grid.heightM, 1)
    const W = grid.widthM * k
    const H = grid.heightM * k
    const baseThickness = Math.max(W, H) * BASE_THICKNESS_RATIO
    const n = SEGMENTS + 1

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, (container.clientWidth || 1) / (container.clientHeight || 1), 0.5, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 20
    controls.maxDistance = 600
    controls.maxPolarAngle = Math.PI * 0.495

    scene.add(new THREE.HemisphereLight(0xf8fafc, 0x475569, 1.35))
    const sun = new THREE.DirectionalLight(0xfffbeb, 1.85)
    sun.position.set(-90, 110, -70)
    scene.add(sun)
    const fillLight = new THREE.DirectionalLight(0xe2e8f0, 0.55)
    fillLight.position.set(80, 70, 90)
    scene.add(fillLight)

    // Superficie: plano local XY, Z = altura; la malla se gira para que Z local sea Y del mundo.
    const surfaceGeom = new THREE.PlaneGeometry(W, H, SEGMENTS, SEGMENTS)
    const pos = surfaceGeom.getAttribute('position') as THREE.BufferAttribute

    // Zócalo: cuatro paredes desde el borde de la superficie hasta la base, más el fondo.
    const edges: number[][] = [[], [], [], []]
    for (let c = 0; c < n; c++) { edges[0].push(c); edges[2].push((n - 1) * n + (n - 1 - c)) }
    for (let r = 0; r < n; r++) { edges[1].push(r * n + (n - 1)); edges[3].push((n - 1 - r) * n) }
    const ring = [...edges[0], ...edges[1].slice(1), ...edges[2].slice(1), ...edges[3].slice(1)]
    const wallPos = new Float32Array(ring.length * 2 * 3)
    const wallIdx: number[] = []
    for (let i = 0; i < ring.length - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
      wallIdx.push(a, b, c, c, b, d)
    }
    const wallGeom = new THREE.BufferGeometry()
    wallGeom.setAttribute('position', new THREE.BufferAttribute(wallPos, 3))
    wallGeom.setIndex(wallIdx)
    const bottomGeom = new THREE.PlaneGeometry(W, H)

    const textures: THREE.Texture[] = []
    const makeTexture = (canvas: HTMLCanvasElement) => {
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      textures.push(tex)
      return tex
    }
    const satTex = data.imagery ? makeTexture(data.imagery) : null
    const hypTex = makeTexture(hypsometricCanvas(grid))

    const surfaceMat = new THREE.MeshStandardMaterial({ map: satTex ?? hypTex, roughness: 0.88, metalness: 0.02 })
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x0f766e, wireframe: true })
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide })
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.96, metalness: 0.04, side: THREE.DoubleSide })

    const group = new THREE.Group()
    group.rotation.x = -Math.PI / 2
    const surface = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(surfaceGeom, surfaceMat)
    const walls = new THREE.Mesh(wallGeom, wallMat)
    const bottom = new THREE.Mesh(bottomGeom, bottomMat)
    bottom.rotation.x = Math.PI // cara hacia abajo
    group.add(surface, walls, bottom)
    scene.add(group)

    const setExag = (ex: number) => {
      for (let i = 0; i < n * n; i++) pos.setZ(i, Math.max(0, (grid.heights[i] - grid.minM) * k * ex))
      pos.needsUpdate = true
      surfaceGeom.computeVertexNormals()
      surfaceGeom.computeBoundingSphere()
      for (let i = 0; i < ring.length; i++) {
        const v = ring[i]
        const x = pos.getX(v), y = pos.getY(v)
        wallPos.set([x, y, pos.getZ(v), x, y, -baseThickness], i * 6)
      }
      wallGeom.getAttribute('position').needsUpdate = true
      wallGeom.computeVertexNormals()
      wallGeom.computeBoundingSphere()
      bottom.position.z = -baseThickness
      group.position.y = -((grid.maxM - grid.minM) * k * ex) / 2
    }

    const resetCamera = () => {
      camera.position.set(MODEL_SIZE * 0.55, MODEL_SIZE * 0.75, MODEL_SIZE * 1.05)
      controls.target.set(0, 0, 0)
      controls.update()
    }

    const applyMode = (m: SurfaceMode) => {
      if (m === 'wireframe') {
        surface.material = wireMat
      } else {
        surface.material = surfaceMat
        surfaceMat.map = m === 'satellite' && satTex ? satTex : hypTex
        surfaceMat.needsUpdate = true
      }
    }

    apiRef.current = {
      setExaggeration: setExag,
      setMode: applyMode,
      resetCamera,
      capture: () => {
        renderer.render(scene, camera)
        try { return renderer.domElement.toDataURL('image/png') } catch { return null }
      },
    }
    resetCamera()

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      apiRef.current = null
      surfaceGeom.dispose(); wallGeom.dispose(); bottomGeom.dispose()
      surfaceMat.dispose(); wireMat.dispose(); wallMat.dispose(); bottomMat.dispose()
      textures.forEach((tex) => tex.dispose())
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [data])

  // 3) Cambios de controles: actualizan la escena existente sin reconstruirla.
  useEffect(() => { apiRef.current?.setExaggeration(exaggeration) }, [exaggeration, data])
  useEffect(() => { apiRef.current?.setMode(effectiveMode) }, [effectiveMode, data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCapture = () => {
    const url = apiRef.current?.capture()
    if (!url) return
    const a = document.createElement('a')
    const safe = (roiName || 'roi').toLowerCase().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '')
    a.href = url
    a.download = `terrapulse-relieve3d-${safe || 'roi'}.png`
    a.click()
  }

  const telemetry = useMemo(() => {
    if (!data) return null
    const { grid } = data
    return {
      min: grid.minM,
      max: grid.maxM,
      dz: grid.maxM - grid.minM,
      wKm: grid.widthM / 1000,
      hKm: grid.heightM / 1000,
      zoom: grid.zoom,
    }
  }, [data])

  const fmt = (v: number, digits = 0) => v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })

  return (
    <div className="terrain3d-overlay" role="dialog" aria-modal="true" aria-label={t('Relieve 3D de la ROI', '3D relief of the ROI')}>
      <div className="terrain3d-modal">
        <header className="terrain3d-header">
          <div className="terrain3d-title">
            <Mountain size={16} />
            <strong>{t('Relieve 3D de la ROI', '3D relief of the ROI')}</strong>
            {roiName ? <span className="terrain3d-roi">{roiName}</span> : null}
          </div>
          <button type="button" className="terrain3d-icon-btn" onClick={onClose} aria-label={t('Cerrar', 'Close')} title={t('Cerrar', 'Close')}>
            <X size={16} />
          </button>
        </header>

        <div className="terrain3d-body">
          <div className="terrain3d-stage" ref={containerRef}>
            {load.status === 'loading' && (
              <div className="terrain3d-status">{t('Descargando elevación y textura de la ROI…', 'Downloading ROI elevation and texture…')}</div>
            )}
            {load.status === 'error' && (
              <div className="terrain3d-status terrain3d-status--error">
                <strong>{t('No se pudo cargar el relieve 3D.', 'Could not load the 3D relief.')}</strong>
                <span>{t('Revisa tu conexión a internet: las teselas abiertas se descargan desde el navegador. El resto de la aplicación sigue funcionando.', 'Check your internet connection: open tiles are downloaded by the browser. The rest of the application keeps working.')}</span>
                <code>{localizeText(load.message)}</code>
              </div>
            )}
            {data && (
              <div className="terrain3d-hint">{t('Arrastra para rotar · clic derecho para desplazar · rueda para acercar', 'Drag to rotate · right-click to pan · wheel to zoom')}</div>
            )}
          </div>

          <aside className="terrain3d-panel">
            <section>
              <label className="terrain3d-label" htmlFor="terrain3d-exag">
                {t('Exageración vertical', 'Vertical exaggeration')}: <strong>{exaggeration.toFixed(1)}×</strong>
              </label>
              <input
                id="terrain3d-exag"
                type="range"
                min={1}
                max={5}
                step={0.1}
                value={exaggeration}
                onChange={(e) => setExaggeration(Number(e.target.value))}
                disabled={!data}
              />
            </section>

            <section>
              <span className="terrain3d-label">{t('Textura superficial', 'Surface texture')}</span>
              <div className="terrain3d-seg">
                <button type="button" className={effectiveMode === 'satellite' ? 'is-active' : ''} onClick={() => setMode('satellite')} disabled={!data?.imagery}>
                  {t('Satelital (Esri)', 'Satellite (Esri)')}
                </button>
                <button type="button" className={effectiveMode === 'hypsometric' ? 'is-active' : ''} onClick={() => setMode('hypsometric')} disabled={!data}>
                  {t('Hipsométrico (Elevación)', 'Hypsometric (Elevation)')}
                </button>
                <button type="button" className={effectiveMode === 'wireframe' ? 'is-active' : ''} onClick={() => setMode('wireframe')} disabled={!data}>
                  {t('Malla (Wireframe)', 'Mesh (Wireframe)')}
                </button>
              </div>
              {data && !data.imagery && (
                <p className="terrain3d-note">{t('La textura satelital no está disponible; se muestra el modo hipsométrico.', 'Satellite texture is unavailable; showing hypsometric mode.')}</p>
              )}
            </section>

            <section className="terrain3d-actions">
              <button type="button" onClick={() => apiRef.current?.resetCamera()} disabled={!data}>
                <RotateCcw size={14} /> {t('Restablecer cámara', 'Reset camera')}
              </button>
              <button type="button" onClick={handleCapture} disabled={!data}>
                <Camera size={14} /> {t('Capturar vista 3D (PNG)', 'Capture 3D view (PNG)')}
              </button>
            </section>

            <section className="terrain3d-telemetry">
              <span className="terrain3d-label">{t('Telemetría de relieve', 'Relief telemetry')}</span>
              {telemetry ? (
                <dl>
                  <dt>{t('Elevación mínima', 'Minimum elevation')}</dt><dd>{fmt(telemetry.min)} m</dd>
                  <dt>{t('Elevación máxima', 'Maximum elevation')}</dt><dd>{fmt(telemetry.max)} m</dd>
                  <dt>{t('Desnivel (Δz)', 'Relief (Δz)')}</dt><dd>{fmt(telemetry.dz)} m</dd>
                  <dt>{t('Extensión', 'Extent')}</dt><dd>{fmt(telemetry.wKm, 1)} × {fmt(telemetry.hKm, 1)} km</dd>
                  <dt>{t('Zoom de teselas', 'Tile zoom')}</dt><dd>{`z${telemetry.zoom}`}</dd>
                </dl>
              ) : (
                <p className="terrain3d-note">—</p>
              )}
              <p className="terrain3d-source">
                {t('Elevación', 'Elevation')}: {TERRAIN_SOURCE_LABEL}
                <br />
                {t('Textura', 'Texture')}: {IMAGERY_SOURCE_LABEL}
              </p>
              <p className="terrain3d-note">
                {t('Visualización del rectángulo que contiene la ROI, remuestreado a 161 × 161 puntos. Cifras aproximadas: no se usan en ningún cálculo del pipeline.', 'Visualization of the rectangle containing the ROI, resampled to 161 × 161 points. Approximate values: not used in any pipeline computation.')}
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
