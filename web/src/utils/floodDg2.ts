import type { FloodRoiResult, FloodRoiRun, FloodRoiStats } from '../api/client.ts'
import type { FlowArrowCollection } from '../types/workspace.ts'

/** Raw panel inputs; every physical and numerical value is typed by the user, with no defaults. */
export interface FloodDg2Form {
  domain: string; useRoi: boolean; crs: string; resolution: string; resampling: string; manning: string
  boundaryNorth: string; boundaryEast: string; boundarySouth: string; boundaryWest: string; seaLevel: string; stillWater: boolean
  nonurban: boolean; amount: string; rainDuration: string; seed: string; intervals: string
  duration: string; save: string; tstep: string; thinDepth: string; thinDepthOff: boolean; confirm: boolean
}
type Polygon = { type: 'Polygon'; coordinates: unknown }
type Translate = (es: string, en: string) => string

/** Builds the exact POST body of /api/flood-scenarios/roi/start/ or throws a user-facing message. */
export function buildRoiFloodRequest(form: FloodDg2Form, roi: Polygon | null, t: Translate) {
  if(!roi)throw Error(t('Selecciona una ROI Polygon válida en el mapa.','Select a valid Polygon ROI on the map.'))
  let domain
  if(form.useRoi) domain=roi
  else {
    try {const parsed=JSON.parse(form.domain); if(parsed?.type!=='Polygon'||!Array.isArray(parsed.coordinates)||Object.keys(parsed).some(k=>!['type','coordinates'].includes(k)))throw Error(); domain=parsed}
    catch {throw Error(t('Indica un dominio GeoJSON Polygon válido o acepta explícitamente usar la ROI como dominio.','Enter a valid GeoJSON Polygon domain or explicitly opt in to using the ROI as domain.'))}
  }
  const positive=(raw:string,label:string,max=Infinity)=>{const n=Number(raw);if(!raw.trim()||!Number.isFinite(n)||n<=0||n>max)throw Error(`${label}: ${t('indica un número positivo válido.','enter a valid positive number.')}`);return n}
  const integer=(raw:string,label:string,allowZero=false)=>{const n=Number(raw);if(!raw.trim()||!Number.isSafeInteger(n)||n<0||(!allowZero&&n===0))throw Error(`${label}: ${t('se requiere un entero válido.','valid integer required.')}`);return n}
  if(!/^EPSG:\d+$/.test(form.crs))throw Error(t('Indica un CRS métrico EPSG para el terreno.','Enter a metric EPSG terrain CRS.'))
  if(!['nearest','bilinear'].includes(form.resampling))throw Error(t('Selecciona remuestreo.','Select resampling.'))
  const sides={north:form.boundaryNorth,east:form.boundaryEast,south:form.boundarySouth,west:form.boundaryWest}
  if(Object.values(sides).some(v=>!['closed','free','fixed_level'].includes(v)))throw Error(t('Selecciona la frontera de cada lado (N, E, S, O).','Select the boundary of each side (N, E, S, W).'))
  const anyFixed=Object.values(sides).includes('fixed_level')
  // One sea level for every fixed side (metres on the DEM datum, EGM96); 0 and negative values are valid.
  const level=Number(form.seaLevel)
  if(anyFixed&&(!form.seaLevel.trim()||!Number.isFinite(level)||Math.abs(level)>10000))throw Error(t('Nivel del mar fijo: indica un número en metros (EGM96).','Fixed sea level: enter a number in metres (EGM96).'))
  if(form.stillWater&&!anyFixed)throw Error(t('El mar lleno al inicio requiere al menos un lado de nivel fijo.','A still-water start needs at least one fixed-level side.'))
  const boundary=Object.fromEntries(Object.entries(sides).map(([side,type])=>[side,type==='fixed_level'?{type,level_m:level}:{type}]))
  if(!form.nonurban||!form.confirm)throw Error(t('Declara el dominio no urbano y confirma las hipótesis.','Declare a nonurban domain and confirm the assumptions.'))
  // LISFLOOD-FP `dg2depththresh`: null only when the user explicitly disables it; the API caps it at 1 m.
  const thinDepth=form.thinDepthOff?null:positive(form.thinDepth,'Umbral de lámina delgada DG2',1)
  return {roi,domain,rainfall:{amount:positive(form.amount,'Lluvia'),unit:'mm',duration:positive(form.rainDuration,'Duración de lluvia'),duration_unit:'s'},rainfall_profile:{interval_count:integer(form.intervals,'Intervalos'),seed:integer(form.seed,'Semilla',true),distribution:'uniform_balanced'},terrain:{target_crs:form.crs,resolution_m:positive(form.resolution,'Resolución'),resampling:form.resampling},hydraulics:{manning:positive(form.manning,'Manning'),initial_condition:form.stillWater?'still_water_at_fixed_level':'dry_zero_velocity',boundary,infiltration:'unsupported',domain_nonurban:true},simulation:{duration_s:positive(form.duration,'Duración DG2',86400),save_interval_s:positive(form.save,'Guardado'),initial_tstep_s:positive(form.tstep,'Paso inicial'),dg2_depth_thresh_m:thinDepth}}
}

/** Solver-velocity arrows of one frame as GeoJSON; null for the maximum or runs without velocities. */
export function flowArrowFeatures(result: Pick<FloodRoiResult, 'flow'>, frameIndex: number | null | undefined): FlowArrowCollection | null {
  if(frameIndex==null) return null
  const frame=result.flow?.frames.find(f=>f.frame_index===frameIndex)
  if(!frame) return null
  return {type:'FeatureCollection',features:frame.arrows.map(([lon,lat,speed,bearing])=>({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{speed,bearing}}))}
}

/** Depth classes of the preview PNG, light to dark blue. Kept in sync with _DEPTH_CLASSES in
 * backend/analyses/roi_flood_runs.py by a test. Below 0.03 m the image is transparent. */
export const DEPTH_CLASSES: ReadonlyArray<{min: number; max: number | null; rgb: [number, number, number]}> = [
  {min:.03,max:.15,rgb:[198,219,239]},
  {min:.15,max:.5,rgb:[107,174,214]},
  {min:.5,max:1,rgb:[33,113,181]},
  {min:1,max:2,rgb:[8,81,156]},
  {min:2,max:null,rgb:[8,48,107]},
]

/** File name for the depth preview PNG of an artifact such as `roi-0001.wd.tif`. */
export function pngDownloadName(artifactName: string) {
  return artifactName.replace(/\.tif$/,'')+'.png'
}

const minutesLabel = (seconds: number) => String(Math.round(seconds / 60 * 100) / 100)

/** Data for the four DG2 charts; each part is null when the run lacks its inputs (older runs).
 * `frameIndex` null selects the maximum for the depth distribution. */
export function dg2ChartData(result: Pick<FloodRoiResult, 'frames' | 'maximum' | 'grid' | 'depth_classes_m' | 'rainfall_segments' | 'mass_balance'>, frameIndex: number | null | undefined) {
  const cellArea = (result.grid?.cellsize_m ?? 0) ** 2
  const classes = (stats: FloodRoiStats | undefined) => Array.isArray(stats?.depth_class_cells) ? stats.depth_class_cells as number[] : null
  const segments = result.rainfall_segments
  const hyetograph = segments?.length ? {labels: segments.map(s => `${minutesLabel(s.start_s)}–${minutesLabel(s.end_s)}`), mmPerHour: segments.map(s => s.intensity_mm_h)} : null
  const counted = result.frames.every(f => classes(f.stats))
  const evolution = counted && cellArea ? {
    minutes: result.frames.map(f => (f.scheduled_time_s ?? 0) / 60),
    wetAreaHa: result.frames.map(f => classes(f.stats)!.reduce((a, b) => a + b, 0) * cellArea / 1e4),
    maxDepthM: result.frames.map(f => Number(f.stats.max_m ?? 0)),
  } : null
  const series = result.mass_balance?.series
  const volume = series?.length ? {minutes: series.map(r => r[0] / 60), domainM3: series.map(r => r[1]), rainM3: series.map(r => r[2])} : null
  const stats = frameIndex == null ? result.maximum.stats : result.frames.find(f => f.frame_index === frameIndex)?.stats
  const cells = classes(stats)
  const bounds = result.depth_classes_m
  const distribution = cells && bounds && cellArea ? {
    labels: bounds.map((low, i) => i + 1 < bounds.length ? `${low}–${bounds[i + 1]}` : `≥ ${low}`),
    areaHa: cells.map(n => n * cellArea / 1e4),
  } : null
  return {hyetograph, evolution, volume, distribution}
}

/** One controller per mounted panel. Invalidation fences every async continuation and timer. */
export function createFloodRunController(
  api: { start: (req: unknown, signal: AbortSignal) => Promise<FloodRoiRun>; status: (id: string, signal: AbortSignal) => Promise<FloodRoiRun>; results: (id: string, signal: AbortSignal) => Promise<FloodRoiResult>; preview: (id: string, name: string, signal: AbortSignal) => Promise<{blob: Blob; bounds: [number, number, number, number]}> },
  update: (value: {run?: FloodRoiRun; result?: FloodRoiResult; artifactName?: string; rasterUrl?: string; rasterBounds?: [number, number, number, number]; error?: string; roiKey: string} | null) => void,
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
  wait: (signal: AbortSignal) => Promise<void> = signal => new Promise(resolve => { const timer = setTimeout(resolve, 2000); signal.addEventListener('abort', () => {clearTimeout(timer); resolve()}, {once:true}) }),
) {
  let token=0, selection=0, abort: AbortController | null=null, objectUrl: string | null=null
  let committedPreview: { artifactName: string; rasterUrl: string; rasterBounds: [number, number, number, number] } | undefined
  function invalidate() {token++; selection++; abort?.abort(); abort=null; if(objectUrl) urls.revokeObjectURL(objectUrl); objectUrl=null; committedPreview=undefined; update(null)}
  async function start(req: unknown, roiKey: string) {
    invalidate(); const key=token; const controller=new AbortController(); abort=controller
    const current=()=>key===token && !controller.signal.aborted
    try {
      let run=await api.start(req,controller.signal)
      if(!current()) return
      update({run,roiKey})
      while(current() && !['succeeded','failed','timed_out'].includes(run.state)) {
        await wait(controller.signal)
        if(!current()) return
        run=await api.status(run.id,controller.signal)
        if(!current()) return
        update({run,roiKey})
      }
      if(!current() || run.state!=='succeeded') return
      const result=await api.results(run.id,controller.signal)
      if(!current()) return
      update({run,result,roiKey})
      return {run,result}
    } catch(e) {
      if(current()) update({roiKey,error:e instanceof Error ? e.message : 'Error de simulación'})
    }
  }
  async function select(run: FloodRoiRun, result: FloodRoiResult, name: string, roiKey: string) {
    if(!abort || abort.signal.aborted || !result.artifacts.some(a=>a.name===name)) return
    const key=token, choice=++selection, signal=abort.signal
    try {
      const image=await api.preview(run.id,name,signal)
      if(signal.aborted || token!==key || choice!==selection) return
      const url=urls.createObjectURL(image.blob)
      if(objectUrl) urls.revokeObjectURL(objectUrl)
      objectUrl=url
      committedPreview={artifactName:name,rasterUrl:url,rasterBounds:image.bounds}
      update({run,result,roiKey,...committedPreview})
    } catch(e) { if(token===key && choice===selection && !signal.aborted) update({run,result,roiKey,...committedPreview,error:e instanceof Error ? e.message : 'Error de preview'}) }
  }
  return {start,select,invalidate}
}
