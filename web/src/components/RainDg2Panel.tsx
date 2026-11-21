import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, BarChart3, CheckCircle2, ChevronDown, ChevronUp, CloudRain, Download, Eye, EyeOff, Layers,
  Loader2, MapPin, Mountain, Navigation, Settings2, ShieldAlert, Wand2, Waves, X, Zap,
} from 'lucide-react'
import type { FloodSimulationState, LngLat } from '../types/workspace'
import { floodRoiPolygon } from '../utils/floodRoi'
import { startRoiFlood, getRoiFloodStatus, getRoiFloodResults, getRoiFloodPreview, getRoiFloodLivePreview, roiFloodArtifactUrl, type FloodRoiRun, type FloodRoiResult } from '../api/client'
import {
  buildRoiFloodRequest, coastPreset, createFloodRunController, DG2_DEFAULT_MAX_CELLS, DG2_DEFAULT_MAX_FRAMES, designStormNote, estimateDomainCells, exampleFormValues,
  failedAttemptsNotice, flowArrowFeatures, formStepStatus, inlandPreset, landSurfaceNotes, NEGATIVE_DEPTH_WARNING, negativeDepthWarning, pngDownloadName,
  RETURN_PERIODS, runErrorMessage, solverFallbackNotice, solverLabel, terrainLabel, URBAN_WARNING, urbanWarning, withFormChange, type FloodDg2Form,
  bathymetryNote, simulatedTimeLabel, tideNote, type FloodMapAnimation,
} from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation'
import { FloodDg2Charts } from './FloodDg2Charts'
import { PRESET_ROI_CATALOG, type CatalogRoiPreset } from '../utils/roiCatalog'
import { FloodCheck, FloodCollapsible, FloodField, FloodStep } from './flood/FloodFormParts'
import { FloodResultSummary } from './flood/FloodResultSummary'
import { FloodHowItWorks } from './flood/FloodHowItWorks'
import { FloodPlaybackControls } from './flood/FloodPlayback'
import { useFloodPlayback } from './flood/useFloodPlayback'
import { useLiveRunFrames } from './flood/useLiveRunFrames'
import { FloodRunProgress } from './flood/FloodRunProgress'
import { FloodWaterBudget } from './flood/FloodWaterBudget'

interface Props {
  flood: FloodSimulationState
  onFloodChange: (next: FloodSimulationState) => void
  croppedRegion?: LngLat[] | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
  onSelectPresetROI?: (preset: CatalogRoiPreset) => void
  onClose?: () => void
  /** Receives what the map draws while the run is animated (preloaded frames, frame shown, rain), null otherwise. */
  onAnimationChange?: (animation: FloodMapAnimation | null) => void
}
/** Every value starts empty: nothing reaches the server unless the user types it or loads the example values.
 * Choices that are not physical values start at their previous behaviour: DG2, synthetic rain, uniform Manning.
 * The urban declaration starts at "includes urban area", the conservative choice (results carry the warning). */
const initial: FloodDg2Form = {domain:'',useRoi:false,crs:'',resolution:'',resampling:'',manning:'',manningMode:'uniform',boundaryNorth:'',boundaryEast:'',boundarySouth:'',boundaryWest:'',seaLevel:'',stillWater:false,infiltration:'',moisture:'',pressure:'',lakes:'',nonurban:false,rainKind:'synthetic',returnPeriod:'',stormHours:'',amount:'',rainDuration:'',seed:'',intervals:'',duration:'',save:'',tstep:'',thinDepth:'',thinDepthOff:false,solver:'dg2',terrainSource:'',bathymetry:false,startUtc:'',confirm:false}
type Form = FloodDg2Form
const TERMINAL = ['succeeded','failed','timed_out']
const STATES = [...new Set(PRESET_ROI_CATALOG.map(p => p.state))]

export function RainDg2Panel({flood,onFloodChange,croppedRegion,onFlyToZone,onSelectPresetROI,onClose,onAnimationChange}:Props) {
  const {t,localizeText,locale} = useTranslation()
  const [collapsed,setCollapsed]=useState(false)
  const [form,setForm]=useState<Form>(initial)
  const [view,setView]=useState<{run?:FloodRoiRun;result?:FloodRoiResult;artifactName?:string;error?:string;roiKey:string}|null>(null)
  const latest=useRef({flood,onFloodChange})
  useEffect(()=>{latest.current={flood,onFloodChange}},[flood,onFloodChange])
  const roiKey=JSON.stringify(croppedRegion??null)
  const keyRef=useRef(roiKey)
  const controller=useRef<ReturnType<typeof createFloodRunController>|null>(null)
  useEffect(()=>{
    controller.current=createFloodRunController({start:startRoiFlood,status:getRoiFloodStatus,results:getRoiFloodResults,preview:getRoiFloodPreview},value=>{
    if(!value) {setView(null);return}
    setView(value)
    const {flood:prev,onFloodChange:change}=latest.current
    const frameIndex=value.result?.artifacts.find(a=>a.name===value.artifactName)?.frame_index
    const flowArrows=value.result?flowArrowFeatures(value.result,frameIndex):null
    if(value.rasterUrl && value.rasterBounds) change({...prev,enabled:true,rasterUrl:value.rasterUrl,rasterBounds:value.rasterBounds,flowArrows,showFlowArrows:prev.showFlowArrows??true,showRasterOnMap:true,stats:null,charts:null,statsSource:'backend',resultRoiKey:value.roiKey})
    })
    return ()=>{controller.current?.invalidate(); const {flood:prev,onFloodChange:change}=latest.current; if(prev.rasterUrl?.startsWith('blob:')) change({...prev,enabled:false,rasterUrl:null,rasterBounds:null,flowArrows:null,stats:null,charts:null,resultRoiKey:undefined})}
  },[])
  useEffect(()=>{
    if(keyRef.current===roiKey)return
    keyRef.current=roiKey
    controller.current?.invalidate()
    setForm(f=>({...f,useRoi:false,confirm:false}))
    const {flood:prev,onFloodChange:change}=latest.current
    if(prev.rasterUrl || prev.resultRoiKey) change({...prev,enabled:false,rasterUrl:null,rasterBounds:null,flowArrows:null,stats:null,charts:null,resultRoiKey:undefined})
  },[roiKey])
  // Any change withdraws the confirmation (except the non-urban declaration beside it): see withFormChange.
  const set=(name:keyof Form,value:string|boolean)=>setForm(f=>withFormChange(f,name,value))
  const roi=floodRoiPolygon(croppedRegion)
  const launch=async()=>{try {const req=buildRoiFloodRequest(form,roi,t);const {flood:prev,onFloodChange:change}=latest.current; change({...prev,enabled:false,rasterUrl:null,rasterBounds:null,flowArrows:null,stats:null,charts:null,resultRoiKey:undefined}); const outcome=await controller.current!.start(req,roiKey);if(outcome?.result){const first=outcome.result.artifacts.find(a=>a.frame_index===undefined||a.frame_index===null)??outcome.result.artifacts[0];if(first){await controller.current!.select(outcome.run,outcome.result,first.name,roiKey)}}}catch(e){setView({roiKey,error:e instanceof Error?e.message:String(e)})}}
  const choose=async(name:string)=>{if(!view?.run||!view.result)return;await controller.current!.select(view.run,view.result,name,roiKey)}
  const current=view?.roiKey===roiKey?view:null
  const busy=Boolean(current?.run&&!TERMINAL.includes(current.run.state))
  const failed=Boolean(current?.run&&['failed','timed_out'].includes(current.run.state))
  const mapActive=Boolean(flood.rasterUrl&&flood.resultRoiKey===roiKey)
  const artifacts=current?.result?.artifacts??[]
  // Animation of the frames (play/pause, time slider, speed, loop, rain); while it is on, the frame it shows is the
  // one every card, chart and download below describes.
  const playback=useFloodPlayback({runId:current?.run?.id,result:current?.result,preview:getRoiFloodPreview})
  // While the run is in progress the map shows the newest frame the solver has written (S5); on success the full
  // playback takes over and starts once, on failure the last frame stays with the error.
  const live=useLiveRunFrames({run:current?.run,preview:getRoiFloodLivePreview,showRain:playback.showRain})
  const mapAnimation=playback.animation??live.animation
  const notifyAnimation=useRef(onAnimationChange)
  useEffect(()=>{notifyAnimation.current=onAnimationChange},[onAnimationChange])
  useEffect(()=>{notifyAnimation.current?.(mapAnimation)},[mapAnimation])
  useEffect(()=>()=>notifyAnimation.current?.(null),[])
  const autoPlayed=useRef<string|null>(null)
  useEffect(()=>{
    const run=current?.run
    if(run?.state==='succeeded'&&current?.result&&live.seen&&playback.available&&autoPlayed.current!==run.id){autoPlayed.current=run.id;playback.play(0)}
  },[current?.run,current?.result,live.seen,playback])
  const selected=playback.current?.name??current?.artifactName??''
  const selectedArtifact=artifacts.find(a=>a.name===selected)
  const frame=current?.result?.frames.find(f=>f.frame_index===selectedArtifact?.frame_index)
  const stats=frame?.stats??(selectedArtifact?.frame_index==null?current?.result?.maximum.stats:undefined)
  const shownUrl=playback.current?.url??flood.rasterUrl
  // The selector shows a frame of the animation (paused there) or leaves it for a static frame or the maximum.
  const chooseView=(name:string)=>{const i=playback.frames?.findIndex(f=>f.name===name)??-1;if(playback.active&&i>=0){playback.seek(i);return}playback.stop();void choose(name)}
  const showMaximum=()=>{const max=artifacts.find(a=>a.frame_index==null);if(max)void choose(max.name)}
  const steps=formStepStatus(form,roi)
  // Until a custom domain is typed, the estimate assumes the ROI as domain (the usual choice).
  const cells=estimateDomainCells(form.domain.trim()?form:{...form,useRoi:true},roi)
  const overBudget=cells!=null&&cells>DG2_DEFAULT_MAX_CELLS
  const fmt=(v:number,digits=2)=>v.toLocaleString(locale,{maximumFractionDigits:digits})
  const amount=Number(form.amount), rainSeconds=Number(form.rainDuration)
  const rainInfo=form.amount.trim()&&form.rainDuration.trim()&&amount>0&&rainSeconds>0
    ? t(`= ${fmt(rainSeconds/60,1)} min · intensidad media ${fmt(amount/(rainSeconds/3600),1)} mm/h`,`= ${fmt(rainSeconds/60,1)} min · mean intensity ${fmt(amount/(rainSeconds/3600),1)} mm/h`)
    : null
  const stepNames:Record<keyof typeof steps,string>={zone:t('1 Zona','1 Area'),rain:t('2 Lluvia','2 Rain'),terrain:t('3 Terreno y fronteras','3 Terrain and boundaries'),solver:t('4 Opciones avanzadas','4 Advanced options'),confirm:t('confirmación','confirmation')}
  const missing=(Object.keys(steps) as Array<keyof typeof steps>).filter(k=>!steps[k]).map(k=>stepNames[k])
  const runLabel=(state:string)=>({created:t('En cola','Queued'),running:t('Simulando','Simulating'),succeeded:t('Terminada','Finished'),failed:t('Fallida','Failed'),timed_out:t('Tiempo agotado','Timed out')} as Record<string,string>)[state]??state
  const flowNote=(flowData:NonNullable<FloodRoiResult['flow']>,frameIndex:number)=>{
    const max=flowData.frames.find(f=>f.frame_index===frameIndex)?.max_speed_m_s??0
    if(flowData.channel_min_upslope_km2==null) return t(`Flechas: velocidad del solver (HU/H) donde hay al menos ${flowData.min_depth_m} m de agua; tamaño según rapidez, máximo ${max} m/s. Solución numérica, no observación.`,`Arrows: solver velocity (HU/H) where water is at least ${flowData.min_depth_m} m deep; size by speed, maximum ${max} m/s. Numerical solution, not observation.`)
    return t(`Flechas solo en desbordamiento: velocidad del solver (HU/H) donde hay al menos ${flowData.min_depth_m} m de agua fuera de la red de cauces (área drenada ≥ ${flowData.channel_min_upslope_km2} km², D8 con depresiones rellenas) y fuera del mar inicial; tamaño según rapidez, máximo ${max} m/s. Solución numérica, no observación.`,`Overflow-only arrows: solver velocity (HU/H) where water is at least ${flowData.min_depth_m} m deep outside the channel network (upslope area ≥ ${flowData.channel_min_upslope_km2} km², pit-filled D8) and outside the initial sea; size by speed, maximum ${max} m/s. Numerical solution, not observation.`)
  }
  const numberField=(key:keyof Form,label:string,hint?:string,extra:{min?:number;max?:number;step?:string}={})=><FloodField label={label} hint={hint} control={aria=><input className="ws-rain-input-field" type="number" inputMode="decimal" step={extra.step??'any'} min={extra.min} max={extra.max} value={String(form[key]??'')} onChange={e=>set(key,e.target.value)} {...aria}/>}/>
  const designStorm=form.rainKind==='design_storm'
  const anyTide=[form.boundaryNorth,form.boundaryEast,form.boundarySouth,form.boundaryWest].includes('tide')
  const runNotes=[...landSurfaceNotes(current?.run?.land_surface,t),...[designStormNote(current?.run?.design_storm,t),tideNote(current?.run?.tide,t),bathymetryNote(current?.run?.bathymetry,t)].filter((note):note is string=>Boolean(note))]
  const attributions=[...(current?.run?.land_surface?.attribution??[]),...(current?.run?.design_storm?.attribution?[current.run.design_storm.attribution]:[]),
    ...(current?.run?.tide?.attribution??[]),...(current?.run?.bathymetry?.attribution?[current.run.bathymetry.attribution]:[])]
  const focusResult=()=>{const b=flood.rasterBounds;if(b)onFlyToZone?.([(b[0]+b[2])/2,(b[1]+b[3])/2],14)}

  const status=busy
    ? <><Loader2 size={12} className="spin" aria-hidden="true"/>{t(`Simulando en el servidor… (${runLabel(current!.run!.state)} · ${current!.run!.stage})`,`Simulating on the server… (${runLabel(current!.run!.state)} · ${current!.run!.stage})`)}</>
    : failed ? <><AlertCircle size={12} aria-hidden="true"/>{t('La corrida no terminó; revisa el detalle abajo.','The run did not finish; see the details below.')}</>
    : mapActive ? <><CheckCircle2 size={12} aria-hidden="true"/>{t('Mapa de inundación activo en el visor','Flood map active in the viewer')}</>
    : !roi ? <><MapPin size={12} aria-hidden="true"/>{t('Paso 1: elige o dibuja una zona en el mapa','Step 1: choose or draw an area on the map')}</>
    : <><ShieldAlert size={12} aria-hidden="true"/>{t('Completa los pasos y lanza la corrida','Complete the steps and launch the run')}</>

  return <aside className={`ws-rain-overlay ${collapsed?'is-collapsed':''}`} aria-label={t('Panel de simulación de inundación DG2','DG2 flood simulation panel')}>
    <div className="ws-rain-overlay__header">
      <div className="ws-rain-overlay__title"><CloudRain size={16} aria-hidden="true"/><div><strong>{t('Simulación de inundación (DG2/FV1)','Flood simulation (DG2/FV1)')}</strong><div className="ws-rain-overlay__sub">{t('Lluvia sintética o tormenta de diseño sobre tu zona · LISFLOOD-FP','Synthetic rain or design storm over your area · LISFLOOD-FP')}</div></div></div>
      <div className="ws-rain-overlay__actions">
        <button type="button" className="ws-floating-toolbox__icon-btn" onClick={()=>setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed?t('Expandir panel','Expand panel'):t('Colapsar panel','Collapse panel')} title={collapsed?t('Expandir panel','Expand panel'):t('Colapsar panel','Collapse panel')}>{collapsed?<ChevronDown size={14}/>:<ChevronUp size={14}/>}</button>
        {onClose&&<button type="button" className="ws-floating-toolbox__icon-btn" onClick={onClose} aria-label={t('Cerrar panel y volver al mapa','Close panel and return to map')} title={t('Cerrar panel y volver al mapa','Close panel and return to map')}><X size={14}/></button>}
      </div>
    </div>
    <div className={`ws-rain-overlay__status ${mapActive?'is-ok':failed?'is-error':''}`} role="status" aria-live="polite"><span className="ws-rain-status-line">{status}</span></div>
    {!collapsed&&<div className="ws-rain-overlay__body">
      <ol className="ws-rain-progress" aria-label={t('Progreso del formulario','Form progress')}>
        {(Object.keys(steps) as Array<keyof typeof steps>).map(k=><li key={k} className={steps[k]?'is-done':''}>{steps[k]?<CheckCircle2 size={11} aria-hidden="true"/>:null}{stepNames[k]}<span className="ws-rain-visually-hidden">{steps[k]?t(': completo',': complete'):t(': pendiente',': pending')}</span></li>)}
      </ol>

      <FloodStep step={1} icon={<MapPin size={13} aria-hidden="true"/>} title={t('Zona','Area')} done={steps.zone}>
        <p className={`ws-rain-help ${roi?'is-ok':''}`}>{roi?t('ROI Polygon válida: lista para simular. No es automáticamente una cuenca.','Valid Polygon ROI: ready to simulate. Not automatically a basin.'):t('Dibuja una ROI Polygon válida en el mapa o elige una zona precargada.','Draw a valid Polygon ROI on the map or choose a preset area.')}</p>
        <FloodField label={t('Zona precargada','Preset area')} hint={t('Mueve el mapa y crea la ROI de esa zona.','Moves the map and creates that area as the ROI.')} control={aria=><select className="ws-rain-input-field" defaultValue="" onChange={e=>{const p=PRESET_ROI_CATALOG.find(p=>p.id===e.target.value);if(p){onSelectPresetROI?.(p);onFlyToZone?.(p.center,p.zoom)}}} {...aria}><option value="">{t('Elegir ROI precargada','Choose preset ROI')}</option>{STATES.map(state=><optgroup key={state} label={state}>{PRESET_ROI_CATALOG.filter(p=>p.state===state).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select>}/>
        <FloodCheck checked={form.useRoi} onChange={v=>set('useRoi',v)}>{t('Acepto usar la ROI como dominio computacional; no afirmo que sea una cuenca.','I opt in to using the ROI as computational domain; I do not claim it is a basin.')}</FloodCheck>
        {!form.useRoi&&<FloodCollapsible title={t('Usar otro dominio (GeoJSON)','Use another domain (GeoJSON)')}>
          <FloodField label={t('Dominio GeoJSON Polygon EPSG:4326 (debe cubrir la ROI)','Domain GeoJSON Polygon EPSG:4326 (must cover the ROI)')} hint={t('Pega solo {"type":"Polygon","coordinates":[...]} en longitud, latitud.','Paste only {"type":"Polygon","coordinates":[...]} in longitude, latitude.')} control={aria=><textarea className="ws-rain-input-field ws-rain-textarea" rows={3} value={form.domain} onChange={e=>set('domain',e.target.value)} {...aria}/>}/>
        </FloodCollapsible>}
        {roi&&<p className={`ws-rain-help ${overBudget?'ws-rain-warn':''}`} role={overBudget?'alert':undefined}>
          {cells==null
            ? t('Indica la resolución (opciones avanzadas o valores de ejemplo) para estimar el tamaño de la malla.','Enter the resolution (advanced options or example values) to estimate the grid size.')
            : overBudget
              ? t(`Zona grande: ~${fmt(cells,0)} celdas de ${form.resolution} m, más que el límite por defecto del servidor (${DG2_DEFAULT_MAX_CELLS}). La corrida probablemente será rechazada: dibuja una zona más pequeña (~1 km² a 30 m) o usa celdas más grandes.`,`Large area: ~${fmt(cells,0)} cells of ${form.resolution} m, above the server's default limit (${DG2_DEFAULT_MAX_CELLS}). The run will probably be rejected: draw a smaller area (~1 km² at 30 m) or use larger cells.`)
              : t(`Tamaño estimado: ~${fmt(cells,0)} celdas de ${form.resolution} m (límite por defecto del servidor: ${DG2_DEFAULT_MAX_CELLS}).`,`Estimated size: ~${fmt(cells,0)} cells of ${form.resolution} m (server default limit: ${DG2_DEFAULT_MAX_CELLS}).`)}
        </p>}
      </FloodStep>

      <section className="ws-rain-card ws-rain-quick">
        <button type="button" className="ws-rain-secondary-btn" onClick={()=>setForm(f=>exampleFormValues(f,roi))}><Wand2 size={13} aria-hidden="true"/>{t('Cargar valores de ejemplo','Load example values')}</button>
        <small className="ws-rain-field__hint">{t('Rellena lluvia, terreno y solver con valores ilustrativos para ver dónde se acumula el agua (no son recomendaciones físicas): tormenta de diseño de 100 años y 3 h (PXR-4), simulación de 4 h (14400 s) con un cuadro cada 300 s (49 cuadros para la animación), sin umbral de lámina delgada, Copernicus a 30 m, Manning según cobertura (WorldCover), número de curva con humedad previa automática, todos los lados libres, DG2 (si falla, el servidor pasa a FV1). Lagos, dominio y declaraciones quedan a tu elección.','Fills rain, terrain and solver with illustrative values to see where water accumulates (not physical recommendations): 100-year, 3 h design storm (PXR-4), 4 h simulation (14400 s) with a frame every 300 s (49 frames for the animation), no thin-depth threshold, Copernicus at 30 m, Manning from land cover (WorldCover), Curve Number with automatic antecedent moisture, all sides free, DG2 (if it fails, the server switches to FV1). Lakes, domain and declarations remain your choice.')}</small>
      </section>

      <FloodStep step={2} icon={<CloudRain size={13} aria-hidden="true"/>} title={t('Lluvia','Rain')} done={steps.rain}>
        <FloodField label={t('Tipo de lluvia','Rain type')} hint={designStorm?t('Lluvia del periodo de retorno elegido en el centroide del dominio, de PXR-4 (ERA5 1979–2018, celda de 0.25°, ODbL), repartida en bloques alternos de 10 min. Las curvas de reanálisis suavizan los picos convectivos cortos: probablemente subestima tormentas tropicales de 1–3 h; si hay curvas IDF locales, compáralas.','Rain of the chosen return period at the domain centroid, from PXR-4 (ERA5 1979–2018, 0.25° cell, ODbL), split into alternating 10-min blocks. Reanalysis curves smooth short convective peaks: it likely underestimates 1–3 h tropical storms; compare with local IDF curves where they exist.'):t('Lluvia hipotética que tú defines: total, duración y un perfil aleatorio reproducible.','Hypothetical rain you define: total, duration and a reproducible random profile.')} control={aria=><select className="ws-rain-input-field" value={form.rainKind??'synthetic'} onChange={e=>set('rainKind',e.target.value)} {...aria}><option value="synthetic">{t('Sintética','Synthetic')}</option><option value="design_storm">{t('Tormenta de diseño','Design storm')}</option></select>}/>
        {designStorm?<div className="ws-rain-form-grid">
          <FloodField label={t('Periodo de retorno (años)','Return period (years)')} hint={t('Probabilidad anual de 1/T de superar esa lluvia.','Annual probability 1/T of exceeding that rain.')} control={aria=><select className="ws-rain-input-field" value={form.returnPeriod??''} onChange={e=>set('returnPeriod',e.target.value)} {...aria}><option value="">—</option>{RETURN_PERIODS.map(T=><option key={T} value={String(T)}>{T}</option>)}</select>}/>
          {numberField('stormHours',t('Duración de la tormenta (h)','Storm duration (h)'),t('En horas, múltiplos de 10 min (máx. 24 h); la duración de simulación debe cubrirla.','In hours, multiples of 10 min (max 24 h); the simulation duration must cover it.'),{min:0,max:24})}
        </div>:<div className="ws-rain-form-grid">
          {numberField('amount',t('Lluvia hipotética (mm)','Hypothetical rainfall (mm)'),t('Total que cae sobre toda la zona.','Total falling over the whole area.'),{min:0})}
          {numberField('rainDuration',t('Duración de la lluvia (s)','Rainfall duration (s)'),rainInfo??t('En segundos: 600 s = 10 min.','In seconds: 600 s = 10 min.'),{min:0})}
          {numberField('intervals',t('Número de intervalos','Interval count'),t('Tramos de igual duración con intensidades distintas; el total se conserva.','Equal-length steps with different intensities; the total is kept.'),{min:1,step:'1'})}
          {numberField('seed',t('Semilla del perfil sintético (entero no negativo)','Synthetic profile seed (nonnegative integer)'),t('La misma semilla repite el mismo perfil.','The same seed repeats the same profile.'),{min:0,step:'1'})}
        </div>}
      </FloodStep>

      <FloodStep step={3} icon={<Mountain size={13} aria-hidden="true"/>} title={t('Terreno y fronteras','Terrain and boundaries')} done={steps.terrain}>
        <FloodField label={t('Terreno','Terrain')} hint={t('Modelo de elevación de 30 m vía NASA Earthdata. Copernicus GLO-30 (NISAR_DEM de ASF, TanDEM-X 2011–2015) cubre todo el mundo; NASADEM (SRTM 2000) cubre de 56° S a 60° N. Ambos se convierten a alturas EGM2008, el mismo datum del nivel del mar.','30 m elevation model via NASA Earthdata. Copernicus GLO-30 (ASF NISAR_DEM, TanDEM-X 2011–2015) covers the whole world; NASADEM (SRTM 2000) covers 56° S to 60° N. Both are converted to EGM2008 heights, the same datum as the sea level.')} control={aria=><select className="ws-rain-input-field" value={form.terrainSource} onChange={e=>set('terrainSource',e.target.value)} {...aria}><option value="">—</option><option value="copernicus">{t('Copernicus GLO-30 (recomendado)','Copernicus GLO-30 (recommended)')}</option><option value="nasadem">NASADEM</option></select>}/>
        <div className="ws-rain-scenarios" role="group" aria-label={t('Escenarios rápidos','Quick scenarios')}>
          <span className="ws-rain-field__label">{t('Escenario rápido:','Quick scenario:')}</span>
          <button type="button" className="ws-rain-chip" onClick={()=>setForm(f=>inlandPreset(f))}><Navigation size={11} aria-hidden="true"/>{t('Tierra adentro','Inland')}</button>
          {([['north',t('Mar al norte','Sea to the north')],['east',t('Mar al este','Sea to the east')],['south',t('Mar al sur','Sea to the south')],['west',t('Mar al oeste','Sea to the west')]] as const).map(([side,label])=><button key={side} type="button" className="ws-rain-chip" onClick={()=>setForm(f=>coastPreset(f,side))}><Waves size={11} aria-hidden="true"/>{label}</button>)}
        </div>
        <small className="ws-rain-field__hint">{t('Atajos que rellenan las fronteras (puedes ajustarlas abajo). Tierra adentro: el agua sale por los cuatro lados. Costa: ese lado es mar a 0 m (EGM2008) y la corrida empieza con el mar lleno.','Shortcuts that fill the boundaries (you can adjust them below). Inland: water leaves through all four sides. Coast: that side is sea at 0 m (EGM2008) and the run starts with the sea filled.')}</small>
        <fieldset className="ws-rain-sides"><legend>{t('Frontera por lado','Boundary per side')}</legend>
          {([['boundaryNorth',t('Norte','North')],['boundaryEast',t('Este','East')],['boundarySouth',t('Sur','South')],['boundaryWest',t('Oeste','West')]] as const).map(([key,label])=><label key={key} className="ws-rain-side"><span>{label}</span><select className="ws-rain-input-field" value={form[key]} onChange={e=>set(key,e.target.value)}><option value="">—</option><option value="closed">{t('cerrada (pared)','closed (wall)')}</option><option value="free">{t('libre (FREE)','free (FREE)')}</option><option value="fixed_level">{t('nivel fijo (HFIX)','fixed level (HFIX)')}</option><option value="tide">{t('Marea (EOT20)','Tide (EOT20)')}</option></select></label>)}
        </fieldset>
        <small className="ws-rain-field__hint">{t('Cerrada: pared, el agua no sale. Libre: el agua sale del dominio. Nivel fijo: mar con el nivel indicado abajo. Marea: nivel del mar que sube y baja con la marea astronómica de EOT20 (CC BY 4.0) en el punto medio de los lados de marea, en EGM2008 con la topografía dinámica media DTUUH22MDT; sin marea de tormenta ni oleaje.','Closed: a wall, water does not leave. Free: water leaves the domain. Fixed level: sea at the level below. Tide: sea level rising and falling with the EOT20 astronomical tide (CC BY 4.0) at the midpoint of the tide sides, in EGM2008 with the DTUUH22MDT mean dynamic topography; no storm surge or waves.')}</small>
        {anyTide&&<FloodField label={t('Inicio del evento (UTC)','Event start (UTC)')} hint={t('Fecha y hora UTC en que empieza la simulación: la marea se calcula de ese instante a inicio + duración de simulación.','UTC date and time when the simulation starts: the tide is computed from that instant to start + simulation duration.')} control={aria=><input className="ws-rain-input-field" type="datetime-local" step={60} value={form.startUtc??''} onChange={e=>set('startUtc',e.target.value)} {...aria}/>}/>}
        {numberField('seaLevel',t('Nivel del mar fijo (m, EGM2008; mismo para todos los lados de nivel fijo)','Fixed sea level (m, EGM2008; same for every fixed-level side)'),t('Solo se usa si algún lado es de nivel fijo. 0 y valores negativos son válidos.','Only used when a side has a fixed level. 0 and negative values are valid.'))}
        <FloodCheck checked={form.stillWater} onChange={v=>set('stillWater',v)}>{t('Iniciar con el mar lleno al nivel fijo (o al de la marea en t = 0; celdas bajo ese nivel conectadas al lado de mar).','Start with the sea filled to the fixed level (or the tide level at t = 0; cells below it connected to the sea side).')}</FloodCheck>
        <small className="ws-rain-field__hint">{t('En DG2 un lado de nivel fijo no llena un dominio seco: si el nivel está sobre el terreno, inicia con el mar lleno. El terreno (Copernicus o NASADEM) no tiene batimetría: con nivel 0 sobre un mar plano a 0 m la profundidad inicial es cero, salvo que marques el fondo marino de GEBCO.','In DG2 a fixed-level side does not fill a dry domain: if the level is above the terrain, start with the sea filled. The terrain (Copernicus or NASADEM) has no bathymetry: at level 0 over a flat 0 m sea the initial depth is zero, unless you tick the GEBCO sea floor.')}</small>
        <FloodCheck checked={form.bathymetry??false} onChange={v=>set('bathymetry',v)}>{t('Fondo marino: GEBCO (GEBCO_2026, ~450 m, dominio público; celdas de mar del terreno ≤ 0.5 m conectadas a un lado de mar).','Sea floor: GEBCO (GEBCO_2026, ~450 m, public domain; terrain sea cells ≤ 0.5 m connected to a sea side).')}</FloodCheck>
        {numberField('pressure',t('Presión atmosférica (hPa, 950–1040; opcional)','Atmospheric pressure (hPa, 950–1040; optional)'),t('Eleva el nivel del mar (fijo o marea) ~1 cm por hPa bajo 1013.25. Déjala vacía si no aplica.','Raises the sea level (fixed or tide) ~1 cm per hPa below 1013.25. Leave it empty if it does not apply.'),{min:950,max:1040})}
        <FloodField label={t('Rugosidad de Manning','Manning roughness')} hint={t('Según cobertura: n por celda de ESA WorldCover 2021 (10 m, CC BY 4.0, todo el mundo; tabla de flujo profundo, no calibrada). Si no se puede leer WorldCover, la corrida falla con un aviso: no se usa un valor uniforme en su lugar.','From land cover: per-cell n from ESA WorldCover 2021 (10 m, CC BY 4.0, worldwide; deep-flow table, not calibrated). If WorldCover cannot be read, the run fails with a notice: no uniform value is used instead.')} control={aria=><select className="ws-rain-input-field" value={form.manningMode??'uniform'} onChange={e=>set('manningMode',e.target.value)} {...aria}><option value="uniform">{t('uniforme (un solo valor)','uniform (one value)')}</option><option value="worldcover">{t('según cobertura (WorldCover)','from land cover (WorldCover)')}</option></select>}/>
        {form.manningMode!=='worldcover'&&numberField('manning',t('Rugosidad Manning n (s/m^1/3)','Manning n roughness (s/m^1/3)'),t('Resistencia del terreno al flujo: más alto, agua más lenta.','Terrain resistance to flow: higher means slower water.'),{min:0})}
        <FloodField label={t('Infiltración','Infiltration')} hint={form.infiltration==='curve_number'?t('Número de curva SCS por celda (cobertura ESA WorldCover + grupos de suelo HYSOGs250m de NASA Earthdata): cada celda recibe su lluvia neta. Los valores de tabla no están calibrados para la zona.','SCS Curve Number per cell (ESA WorldCover land cover + HYSOGs250m soil groups from NASA Earthdata): each cell receives its net rain. Table values are not calibrated for the area.'):t('Con coeficiente, DG2 recibe lluvia × C; el resto se cuenta como infiltrado. Es un coeficiente agregado, no un modelo físico de infiltración.','With the coefficient, DG2 receives rain × C; the rest counts as infiltrated. It is a lumped coefficient, not a physical infiltration model.')} control={aria=><select className="ws-rain-input-field" value={form.infiltration} onChange={e=>set('infiltration',e.target.value)} {...aria}><option value="">—</option><option value="unsupported">{t('no modelada (toda la lluvia escurre)','not modeled (all rain runs off)')}</option><option value="runoff_coefficient">{t('coeficiente de escorrentía 0.65–0.92 según duración (como terrapulseai_v2.1)','runoff coefficient 0.65–0.92 by duration (as in terrapulseai_v2.1)')}</option><option value="curve_number">{t('número de curva por celda (WorldCover + HYSOGs)','Curve Number per cell (WorldCover + HYSOGs)')}</option></select>}/>
        {form.infiltration==='curve_number'&&<FloodField label={t('Humedad previa del suelo','Antecedent soil moisture')} hint={t('Automática: humedad de NISAR SME2 (o SMAP L4 si no hay dato) antes del inicio de la corrida. I seco, II medio, III húmedo.','Automatic: NISAR SME2 soil moisture (or SMAP L4 when there is no data) before the run starts. I dry, II average, III wet.')} control={aria=><select className="ws-rain-input-field" value={form.moisture??''} onChange={e=>set('moisture',e.target.value)} {...aria}><option value="">—</option><option value="auto">{t('automática (NISAR SME2 / SMAP L4)','automatic (NISAR SME2 / SMAP L4)')}</option><option value="I">{t('I (seco)','I (dry)')}</option><option value="II">{t('II (medio)','II (average)')}</option><option value="III">{t('III (húmedo)','III (wet)')}</option></select>}/>}
        <FloodField label={t('Lagos','Lakes')} hint={t('HydroLAKES v1.0 (CC BY 4.0): profundidad media estimada, no batimetría medida.','HydroLAKES v1.0 (CC BY 4.0): estimated mean depth, not surveyed bathymetry.')} control={aria=><select className="ws-rain-input-field" value={form.lakes} onChange={e=>set('lakes',e.target.value)} {...aria}><option value="">—</option><option value="none">{t('no incluir','do not include')}</option><option value="hydrolakes">{t('HydroLAKES: lagos llenos al inicio, lecho excavado con su profundidad media','HydroLAKES: lakes full at start, bed dug to their mean depth')}</option></select>}/>
      </FloodStep>

      <section className="ws-rain-card ws-rain-step">
        <FloodCollapsible icon={<Settings2 size={12} aria-hidden="true"/>} title={t('4 Opciones avanzadas: terreno y solver','4 Advanced options: terrain and solver')}
          badge={<span className={`ws-rain-step__state ${steps.solver&&/^EPSG:\d+$/.test(form.crs)&&Number(form.resolution)>0&&form.resampling?'is-done':''}`}>{steps.solver&&/^EPSG:\d+$/.test(form.crs)&&Number(form.resolution)>0&&form.resampling?t('Completo','Complete'):t('Faltan valores','Values missing')}</span>}>
          <FloodField label={t('Método','Method')} hint={t('DG2 (Galerkin discontinuo de 2.º orden) es más preciso; FV1 (volúmenes finitos de 1.er orden) es más estable en terreno empinado. Si el método elegido falla, el servidor prueba automáticamente el otro y lo indica en los resultados.','DG2 (second-order discontinuous Galerkin) is more accurate; FV1 (first-order finite volumes) is more stable on steep terrain. If the chosen method fails, the server automatically tries the other one and says so in the results.')} control={aria=><select className="ws-rain-input-field" value={form.solver} onChange={e=>set('solver',e.target.value)} {...aria}><option value="dg2">{t('DG2 (más preciso)','DG2 (more accurate)')}</option><option value="fv1">{t('FV1 (estable, para terreno empinado)','FV1 (stable, for steep terrain)')}</option></select>}/>
          <div className="ws-rain-form-grid">
            <FloodField label={t('CRS métrico del terreno (EPSG:...)','Metric terrain CRS (EPSG:...)')} hint={t('Proyección en metros; en México, una zona UTM (Chiapas: EPSG:32615).','Projection in metres; in Mexico, a UTM zone (Chiapas: EPSG:32615).')} control={aria=><input className="ws-rain-input-field" type="text" spellCheck={false} value={form.crs} onChange={e=>set('crs',e.target.value)} {...aria}/>}/>
            {numberField('resolution',t('Resolución del terreno (m)','Terrain resolution (m)'),t('Tamaño de celda; define cuántas celdas tiene la malla.','Cell size; sets how many cells the grid has.'),{min:0})}
            <FloodField label={t('Remuestreo','Resampling')} hint={t('nearest conserva las alturas originales; bilinear las suaviza.','nearest keeps the original heights; bilinear smooths them.')} control={aria=><select className="ws-rain-input-field" value={form.resampling} onChange={e=>set('resampling',e.target.value)} {...aria}><option value="">—</option>{['nearest','bilinear'].map(v=><option key={v}>{v}</option>)}</select>}/>
            {numberField('duration',t('Duración de simulación (s, máximo 86400)','Simulation duration (s, max 86400)'),t('Tiempo simulado; debe cubrir toda la lluvia y conviene dejar más tiempo (p. ej. 1 h) para ver hacia dónde escurre y se acumula el agua.','Simulated time; it must cover the whole rain, and extra time (e.g. 1 h) shows where the water runs and accumulates.'),{min:0,max:86400})}
            {numberField('save',t('Intervalo de guardado de cuadros (s)','Frame save interval (s)'),t(`Cada cuánto se guarda un cuadro del mapa; el servidor admite hasta ${DG2_DEFAULT_MAX_FRAMES} cuadros (duración ÷ intervalo + 2).`,`How often a map frame is saved; the server allows up to ${DG2_DEFAULT_MAX_FRAMES} frames (duration ÷ interval + 2).`),{min:0})}
            {numberField('tstep',t('Paso inicial (s)','Initial timestep (s)'),t('Primer paso de tiempo; el solver lo ajusta después.','First timestep; the solver adapts it afterwards.'),{min:0})}
          </div>
          {form.solver!=='fv1'&&<><FloodField label={t('Umbral de lámina delgada DG2 (m, 0–1; dg2depththresh)','DG2 thin-depth threshold (m, 0–1; dg2depththresh)')} hint={t('Elimina profundidades negativas en láminas finas, pero cambia la solución; queda registrado en la corrida.','Removes negative depths on thin films but changes the solution; it is recorded with the run.')} control={aria=><input className="ws-rain-input-field" type="number" inputMode="decimal" step="any" min={0} max={1} value={form.thinDepth} disabled={form.thinDepthOff} onChange={e=>set('thinDepth',e.target.value)} {...aria}/>}/>
          <FloodCheck checked={form.thinDepthOff} onChange={v=>set('thinDepthOff',v)}>{t('Desactivar umbral (por defecto del solver): pueden aparecer profundidades negativas en láminas finas.','Disable threshold (solver default): negative depths may appear on thin films.')}</FloodCheck></>}
        </FloodCollapsible>
      </section>

      <section className="ws-rain-card ws-rain-launch">
        <div className="ws-rain-card__head"><ShieldAlert size={13} aria-hidden="true"/><h3>{t('Confirmar y simular','Confirm and simulate')}</h3></div>
        <FloodField label={t('El dominio','The domain')} hint={t('Informativo: las zonas urbanas se simulan, pero los resultados llevan el aviso de que edificios y drenaje no están representados. Con WorldCover el servidor también lo detecta.','Informational: urban areas are simulated, but the results carry a warning that buildings and drainage are not represented. With WorldCover the server also detects it.')} control={aria=><select className="ws-rain-input-field" value={form.nonurban?'nonurban':'urban'} onChange={e=>set('nonurban',e.target.value==='nonurban')} {...aria}><option value="urban">{t('incluye zona urbana','includes urban area')}</option><option value="nonurban">{t('no es urbano','is not urban')}</option></select>}/>
        <FloodCheck checked={form.confirm} onChange={v=>set('confirm',v)}>{t('Confirmo estas hipótesis: lluvia supuesta (sintética o tormenta de diseño) y exactitud no validada.','I confirm these assumptions: assumed rainfall (synthetic or design storm) and unvalidated accuracy.')}</FloodCheck>
        {missing.length>0&&<p className="ws-rain-help">{t(`Falta completar: ${missing.join(', ')}.`,`Still to complete: ${missing.join(', ')}.`)}</p>}
        {overBudget&&<p className="ws-rain-help ws-rain-warn">{t(`La malla estimada (~${fmt(cells!,0)} celdas) supera el límite por defecto de ${DG2_DEFAULT_MAX_CELLS}.`,`The estimated grid (~${fmt(cells!,0)} cells) exceeds the default limit of ${DG2_DEFAULT_MAX_CELLS}.`)}</p>}
        <button type="button" className="ws-rain-action-btn" disabled={!roi||!form.confirm||busy} onClick={launch}>
          {busy?<><Loader2 size={13} className="spin" aria-hidden="true"/>{t('Simulando…','Simulating…')}</>:<><Zap size={13} aria-hidden="true"/>{t(`Iniciar corrida ${solverLabel(form.solver)}`,`Start ${solverLabel(form.solver)} run`)}</>}
        </button>
        <small className="ws-rain-field__hint">{t('La corrida solo empieza al pulsar este botón; cambiar cualquier valor retira la confirmación.','The run only starts when you press this button; changing any value withdraws the confirmation.')}</small>
        {current?.error&&<p role="alert" className="ws-rain-error"><AlertCircle size={13} aria-hidden="true"/><span>{localizeText(current.error)}</span></p>}
      </section>

      {current?.run&&<section className={`ws-rain-card ws-rain-run ${failed?'is-error':''}`} aria-live="polite">
        <div className="ws-rain-card__head">{busy?<Loader2 size={13} className="spin" aria-hidden="true"/>:failed?<AlertCircle size={13} aria-hidden="true"/>:<CheckCircle2 size={13} aria-hidden="true"/>}<h3>{t('Corrida','Run')}: {runLabel(current.run.state)}</h3></div>
        {busy&&<FloodRunProgress run={current.run} showRain={playback.showRain} onShowRainChange={playback.setShowRain}/>}
        {!busy&&failed&&live.current&&<p className="ws-rain-help">{t(`El mapa conserva el último cuadro calculado (${simulatedTimeLabel(live.current.scheduledTimeS)}) antes del fallo.`,`The map keeps the last computed frame (${simulatedTimeLabel(live.current.scheduledTimeS)}) before the failure.`)}</p>}
        <p className="ws-rain-help">{t('Etapa','Stage')}: {current.run.stage} · <code>{current.run.id}</code></p>
        <p className="ws-rain-help">{t('Método:','Method:')} {solverLabel(current.run.requested_solver??'dg2')}{current.run.solver&&current.run.solver!==(current.run.requested_solver??'dg2')?t(` → ${solverLabel(current.run.solver)} (cambio automático)`,` → ${solverLabel(current.run.solver)} (automatic switch)`):''}</p>
        <p className="ws-rain-help">{t('Terreno:','Terrain:')} {terrainLabel(current.run.terrain_source)} · {t('alturas','heights')} {current.run.vertical_datum??'EGM96'}</p>
        {current.run.terrain_attribution&&<p className="ws-rain-help ws-rain-attribution"><small>{current.run.terrain_attribution}</small></p>}
        {(current.run.requested_solver??'dg2')==='dg2'&&<p className="ws-rain-help">{t('Umbral de lámina delgada DG2:','DG2 thin-depth threshold:')} {current.run.dg2_depth_thresh_m==null?t('desactivado','disabled'):`${current.run.dg2_depth_thresh_m} m`}</p>}
        {runNotes.map((note,i)=><p key={i} className="ws-rain-help">{note}</p>)}
        {current.run.losses&&<p className="ws-rain-help">{t('Infiltración:','Infiltration:')} {current.run.losses.infiltration==='curve_number'?t('número de curva (lluvia neta por celda)','Curve Number (net rain per cell)'):current.run.losses.runoff_coefficient==null?t('no modelada','not modeled'):t(`coeficiente ${current.run.losses.runoff_coefficient.toFixed(3)} (${Math.round((1-current.run.losses.runoff_coefficient)*100)} % se infiltra)`,`coefficient ${current.run.losses.runoff_coefficient.toFixed(3)} (${Math.round((1-current.run.losses.runoff_coefficient)*100)} % infiltrates)`)} · {t('Presión:','Pressure:')} {current.run.losses.atmospheric_pressure_hpa==null?t('no aplicada','not applied'):`${current.run.losses.atmospheric_pressure_hpa} hPa → +${current.run.losses.barometric_surge_m.toFixed(3)} m`}</p>}
        {attributions.length>0&&<p className="ws-rain-help ws-rain-attribution"><small>{attributions.join(' · ')}</small></p>}
        {failed&&<p role="alert" className="ws-rain-error"><AlertCircle size={13} aria-hidden="true"/><span>{t('Corrida fallida:','Run failed:')} {current.run.error?runErrorMessage(current.run.error,t):current.run.state}{failedAttemptsNotice(current.run.solver_attempts,t)?` · ${failedAttemptsNotice(current.run.solver_attempts,t)}`:''}</span></p>}
      </section>}

      {current?.result&&<section className="ws-rain-card ws-rain-card--results">
        <div className="ws-rain-card__head"><span className="ws-rain-step__num" aria-hidden="true">5</span><BarChart3 size={13} aria-hidden="true"/><h3>{t(`Resultados ${solverLabel(current.result.solver??'dg2')}: profundidad (m)`,`${solverLabel(current.result.solver??'dg2')} results: depth (m)`)}</h3></div>
        <p className="ws-rain-banner"><ShieldAlert size={13} aria-hidden="true"/><span>{current.result.rainfall_source==='design_storm'?t('Tormenta de diseño (PXR-4); exactitud hidráulica NO validada. No son observaciones.','Design storm (PXR-4); hydraulic accuracy NOT validated. Not observations.'):t('Lluvia sintética; exactitud hidráulica NO validada. No son observaciones.','Synthetic rainfall; hydraulic accuracy NOT validated. Not observations.')}</span></p>
        {urbanWarning(current.result,t)&&<p role="alert" className="ws-rain-help ws-rain-warn"><AlertCircle size={13} aria-hidden="true"/> {urbanWarning(current.result,t)}</p>}
        {solverFallbackNotice(current.result.solver_fallback,t)&&<p role="status" className="ws-rain-banner ws-rain-fallback"><Settings2 size={13} aria-hidden="true"/><span>{solverFallbackNotice(current.result.solver_fallback,t)}</span></p>}
        {negativeDepthWarning(current.result,t)&&<p role="alert" className="ws-rain-help ws-rain-warn"><AlertCircle size={13} aria-hidden="true"/> {negativeDepthWarning(current.result,t)}</p>}
        <FloodField label={t('Cuadro / máximo','Frame / maximum')} hint={t('Los cuadros se ordenan por índice; el tiempo programado no es tiempo físico observado.','Frames ordered by index; scheduled time is not observed physical time.')} control={aria=><select className="ws-rain-input-field" value={selected} onChange={e=>chooseView(e.target.value)} {...aria}><option value="">{t('Selecciona cuadro','Select frame')}</option>{artifacts.map(a=><option key={a.name} value={a.name}>{a.frame_index==null?t('Máximo','Maximum'):`#${a.frame_index} (${t('programado','scheduled')} ${a.scheduled_time_s??'—'} s · ${simulatedTimeLabel(a.scheduled_time_s)})`}</option>)}</select>}/>
        <FloodPlaybackControls playback={playback} onShowMaximum={showMaximum}/>
        <FloodResultSummary result={current.result} frameIndex={selectedArtifact?.frame_index}/>
        <FloodWaterBudget result={current.result}/>

        {mapActive&&<div className="ws-rain-map-controls">
          <div className="ws-rain-btn-row">
            <button type="button" className="ws-rain-secondary-btn" onClick={()=>latest.current.onFloodChange({...latest.current.flood,showRasterOnMap:!latest.current.flood.showRasterOnMap})}>{flood.showRasterOnMap?<EyeOff size={12} aria-hidden="true"/>:<Eye size={12} aria-hidden="true"/>}{flood.showRasterOnMap?t('Ocultar capa','Hide layer'):t('Mostrar capa','Show layer')}</button>
            {onFlyToZone&&flood.rasterBounds&&<button type="button" className="ws-rain-secondary-btn" onClick={focusResult}><Layers size={12} aria-hidden="true"/>{t('Enfocar resultado','Focus result')}</button>}
          </div>
          <FloodField label={`${t('Opacidad','Opacity')}: ${flood.waterOpacity??85} %`} control={aria=><input type="range" min="10" max="100" value={flood.waterOpacity??85} onChange={e=>latest.current.onFloodChange({...latest.current.flood,waterOpacity:Number(e.target.value)})} {...aria}/>}/>
          <small className="ws-rain-field__hint">{t('Escala por clases de profundidad (leyenda en el mapa): casi blanco semitransparente 0.002–0.01 m (escurrimiento en láminas durante la lluvia), azul muy claro 0.01–0.03 m (lámina delgada) a azul oscuro ≥ 2 m; menos de 0.002 m y sin dato transparentes.','Depth-class scale (legend on the map): semi-transparent near-white 0.002–0.01 m (runoff sheets during the rain), very light blue 0.01–0.03 m (thin sheet) to dark blue ≥ 2 m; below 0.002 m and nodata transparent.')}</small>
        </div>}

        {current.result.flow&&flood.resultRoiKey===roiKey&&<div className="ws-rain-map-controls">
          <button type="button" className="ws-rain-secondary-btn" onClick={()=>latest.current.onFloodChange({...latest.current.flood,showFlowArrows:!(latest.current.flood.showFlowArrows??true)})}><Navigation size={12} aria-hidden="true"/>{(flood.showFlowArrows??true)?t('Ocultar flechas de flujo','Hide flow arrows'):t('Mostrar flechas de flujo','Show flow arrows')}</button>
          {selectedArtifact&&<p className="ws-rain-help">{selectedArtifact.frame_index==null?t('El máximo no tiene flechas: no corresponde a un instante.','The maximum has no arrows: it is not a single instant.'):flowNote(current.result.flow,selectedArtifact.frame_index)}</p>}
        </div>}

        <div className="ws-rain-downloads">
          {selectedArtifact&&mapActive&&<p className="ws-rain-help"><a className="solar-api-link" href={shownUrl!} download={pngDownloadName(selectedArtifact.name)}><Download size={12} aria-hidden="true"/>{t('Descargar imagen PNG del cuadro','Download frame PNG image')}</a> {t('Para una imagen con mapa base y flechas usa la herramienta Capturar.','For an image with basemap and arrows use the Capture tool.')}</p>}
          {selectedArtifact&&<a className="solar-api-link" href={roiFloodArtifactUrl(current.run!.id,selectedArtifact.name)} download><Download size={12} aria-hidden="true"/>{t('Descargar COG original (requiere sesión)','Download original COG (session required)')}</a>}
        </div>

        {current.result.lakes&&current.result.lakes.length>0&&<p className="ws-rain-help">{t('Lagos (HydroLAKES v1.0, CC BY 4.0; profundidad estimada, no batimetría medida):','Lakes (HydroLAKES v1.0, CC BY 4.0; estimated depth, not surveyed bathymetry):')} {current.result.lakes.map(l=>l.skipped?`${l.name??`#${l.hylak_id}`} ${t('omitido (cortado por el borde del dominio)','skipped (cut by the domain edge)')}`:`${l.name??`#${l.hylak_id}`} · ${l.depth_avg_m} m · ${l.cells} ${t('celdas','cells')}`).join('; ')}</p>}
        {current.result.roads&&<p className="ws-rain-help">{(()=>{const roads=current.result.roads!;if(!roads.available)return t('Caminos (OpenStreetMap): no disponibles para esta corrida.','Roads (OpenStreetMap): not available for this run.');const exposure=selectedArtifact?.frame_index==null?roads.maximum:roads.frames?.find(f=>f.frame_index===selectedArtifact.frame_index);return t(`Caminos (OpenStreetMap): ${(roads.total_km??0).toFixed(2)} km en el dominio; cortados (≥ ${roads.thresholds_m?.cut} m) ${(exposure?.cut_km??0).toFixed(2)} km; precaución (${roads.thresholds_m?.caution}–${roads.thresholds_m?.cut} m) ${(exposure?.caution_km??0).toFixed(2)} km. © OpenStreetMap contributors.`,`Roads (OpenStreetMap): ${(roads.total_km??0).toFixed(2)} km in the domain; cut (≥ ${roads.thresholds_m?.cut} m) ${(exposure?.cut_km??0).toFixed(2)} km; caution (${roads.thresholds_m?.caution}–${roads.thresholds_m?.cut} m) ${(exposure?.caution_km??0).toFixed(2)} km. © OpenStreetMap contributors.`)})()}</p>}

        <FloodCollapsible title={t('Detalle técnico del cuadro','Technical detail of the frame')}>
          {stats&&<dl className="ws-rain-dl">{(['wet_cells','valid_cells','nodata_cells','min_m','max_m'] as const).filter(key=>typeof stats[key]==='number'&&Number.isFinite(stats[key])).map(key=><div key={key}><dt>{key}</dt><dd>{String(stats[key])} {key.endsWith('_m')?'m':''}</dd></div>)}</dl>}
          {(()=>{const fr=current.result.froude?.frames.find(f=>f.frame_index===selectedArtifact?.frame_index);const tc=current.result.time_of_concentration;return (fr||tc||(current.result.negative_depth?.clipped_cell_frames??0)>0)&&<dl className="ws-rain-dl">
            {fr&&<div><dt>{t('Número de Froude (h ≥ 0.15 m)','Froude number (h ≥ 0.15 m)')}</dt><dd>{fr.max==null?t('sin agua suficiente','not enough water'):t(`máx ${fr.max.toFixed(2)} · medio ${fr.mean!.toFixed(2)} · ${fr.supercritical_cells} de ${fr.cells} celdas supercríticas (Fr > 1)`,`max ${fr.max.toFixed(2)} · mean ${fr.mean!.toFixed(2)} · ${fr.supercritical_cells} of ${fr.cells} cells supercritical (Fr > 1)`)}</dd></div>}
            {(current.result.negative_depth?.clipped_cell_frames??0)>0&&<div><dt>{t('Profundidades negativas puestas en 0','Negative depths set to 0')}</dt><dd>{t(`${current.result.negative_depth!.clipped_cell_frames} valores de celda · mínimo ${current.result.negative_depth!.min_m} m · volumen añadido hasta ${((current.result.negative_depth!.max_added_volume_ratio??0)*100).toFixed(2)} % del agua de un cuadro`,`${current.result.negative_depth!.clipped_cell_frames} cell values · minimum ${current.result.negative_depth!.min_m} m · added volume up to ${((current.result.negative_depth!.max_added_volume_ratio??0)*100).toFixed(2)} % of the water of a frame`)}</dd></div>}
            {tc&&<div><dt>{t('Tiempo de concentración (Kirpich)','Time of concentration (Kirpich)')}</dt><dd>{t(`${tc.minutes.toFixed(1)} min · recorrido ${Math.round(tc.flow_length_m)} m · pendiente ${tc.slope_m_m.toFixed(4)} · área drenada ${tc.upslope_area_km2.toFixed(2)} km²`,`${tc.minutes.toFixed(1)} min · flow path ${Math.round(tc.flow_length_m)} m · slope ${tc.slope_m_m.toFixed(4)} · drained area ${tc.upslope_area_km2.toFixed(2)} km²`)}</dd></div>}
          </dl>})()}
        </FloodCollapsible>

        <FloodCollapsible defaultOpen icon={<BarChart3 size={12} aria-hidden="true"/>} title={t('Gráficas','Charts')}>
          <FloodDg2Charts result={current.result} frameIndex={selectedArtifact?.frame_index} cursorS={playback.current?.scheduledTimeS??null}/>
        </FloodCollapsible>
        {current.result.warnings?.filter(w=>w!==NEGATIVE_DEPTH_WARNING&&w!==URBAN_WARNING).map((w,i)=><p key={i} className="ws-rain-help ws-rain-warn">{localizeText(w)}</p>)}
      </section>}

      <FloodHowItWorks/>
    </div>}
  </aside>
}
