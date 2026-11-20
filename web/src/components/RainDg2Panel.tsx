import { useEffect, useRef, useState } from 'react'
import { CloudRain, ChevronDown, ChevronUp, X } from 'lucide-react'
import type { FloodSimulationState, LngLat } from '../types/workspace'
import { floodRoiPolygon } from '../utils/floodRoi'
import { startRoiFlood, getRoiFloodStatus, getRoiFloodResults, getRoiFloodPreview, roiFloodArtifactUrl, type FloodRoiRun, type FloodRoiResult } from '../api/client'
import { buildRoiFloodRequest, createFloodRunController, flowArrowFeatures, pngDownloadName, type FloodDg2Form } from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation'
import { FloodDg2Charts } from './FloodDg2Charts'
import { PRESET_ROI_CATALOG, type CatalogRoiPreset } from '../utils/roiCatalog'

interface Props {
  flood: FloodSimulationState
  onFloodChange: (next: FloodSimulationState) => void
  croppedRegion?: LngLat[] | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
  onSelectPresetROI?: (preset: CatalogRoiPreset) => void
  onClose?: () => void
}
const initial: FloodDg2Form = {domain:'',useRoi:false,crs:'',resolution:'',resampling:'',manning:'',boundaryNorth:'',boundaryEast:'',boundarySouth:'',boundaryWest:'',seaLevel:'',stillWater:false,infiltration:'',pressure:'',lakes:'',nonurban:false,amount:'',rainDuration:'',seed:'',intervals:'',duration:'',save:'',tstep:'',thinDepth:'',thinDepthOff:false,confirm:false}
type Form = FloodDg2Form
export function RainDg2Panel({flood,onFloodChange,croppedRegion,onFlyToZone,onSelectPresetROI,onClose}:Props) {
  const {t,localizeText} = useTranslation()
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
  const set=(name:keyof Form,value:string|boolean)=>setForm(f=>({...f,[name]:value,confirm:name==='confirm' && value===true}))
  const roi=floodRoiPolygon(croppedRegion)
  const buildRequest=()=>buildRoiFloodRequest(form,roi,t)
  const launch=async()=>{try {const req=buildRequest();const {flood:prev,onFloodChange:change}=latest.current; change({...prev,enabled:false,rasterUrl:null,rasterBounds:null,flowArrows:null,stats:null,charts:null,resultRoiKey:undefined}); const outcome=await controller.current!.start(req,roiKey);if(outcome?.result){const first=outcome.result.artifacts.find(a=>a.frame_index===undefined||a.frame_index===null)??outcome.result.artifacts[0];if(first){await controller.current!.select(outcome.run,outcome.result,first.name,roiKey)}}}catch(e){setView({roiKey,error:e instanceof Error?e.message:String(e)})}}
  const choose=async(name:string)=>{if(!view?.run||!view.result)return;await controller.current!.select(view.run,view.result,name,roiKey)}
  const current=view?.roiKey===roiKey?view:null
  const selected=current?.artifactName??''
  const artifacts=current?.result?.artifacts??[]
  const selectedArtifact=artifacts.find(a=>a.name===selected)
  const frame=current?.result?.frames.find(f=>f.frame_index===selectedArtifact?.frame_index)
  const stats=frame?.stats??(selectedArtifact?.frame_index==null?current?.result?.maximum.stats:undefined)
  const flowNote=(flow:NonNullable<FloodRoiResult['flow']>,frameIndex:number)=>{
    const max=flow.frames.find(f=>f.frame_index===frameIndex)?.max_speed_m_s??0
    if(flow.channel_min_upslope_km2==null) return t(`Flechas: velocidad del solver (HU/H) donde hay al menos ${flow.min_depth_m} m de agua; tamaño según rapidez, máximo ${max} m/s. Solución numérica, no observación.`,`Arrows: solver velocity (HU/H) where water is at least ${flow.min_depth_m} m deep; size by speed, maximum ${max} m/s. Numerical solution, not observation.`)
    return t(`Flechas solo en desbordamiento: velocidad del solver (HU/H) donde hay al menos ${flow.min_depth_m} m de agua fuera de la red de cauces (área drenada ≥ ${flow.channel_min_upslope_km2} km², D8 con depresiones rellenas) y fuera del mar inicial; tamaño según rapidez, máximo ${max} m/s. Solución numérica, no observación.`,`Overflow-only arrows: solver velocity (HU/H) where water is at least ${flow.min_depth_m} m deep outside the channel network (upslope area ≥ ${flow.channel_min_upslope_km2} km², pit-filled D8) and outside the initial sea; size by speed, maximum ${max} m/s. Numerical solution, not observation.`)
  }
  const field=(key:keyof Form,label:string,kind='number')=><label style={{display:'block',margin:'6px 0'}}>{label}<input className="ws-rain-select" style={{width:'100%'}} type={kind} value={String(form[key])} onChange={e=>set(key,e.target.value)}/></label>
  return <aside className={`ws-rain-overlay ${collapsed?'is-collapsed':''}`} aria-label={t('Panel de simulación de inundación DG2','DG2 flood simulation panel')}>
    <div className="ws-rain-overlay__header"><div className="ws-rain-overlay__title"><CloudRain size={16}/><strong>{t('Inundación ROI / DG2','ROI flood / DG2')}</strong></div><div><button type="button" onClick={()=>setCollapsed(!collapsed)} aria-label={t('Colapsar o expandir','Collapse or expand')}>{collapsed?<ChevronDown size={14}/>:<ChevronUp size={14}/>}</button>{onClose&&<button type="button" onClick={onClose} aria-label={t('Cerrar panel','Close panel')}><X size={14}/></button>}</div></div>
    {!collapsed&&<div className="ws-rain-overlay__body">
      <section className="ws-rain-card"><h3>{t('ROI seleccionada y dominio computacional','Selected ROI and computational domain')}</h3><p>{roi?t('ROI Polygon válida; no es automáticamente una cuenca.','Valid Polygon ROI; not automatically a basin.'):t('Dibuja una ROI Polygon válida.','Draw a valid Polygon ROI.')}</p>
        <select className="ws-rain-select" defaultValue="" onChange={e=>{const p=PRESET_ROI_CATALOG.find(p=>p.id===e.target.value);if(p){onSelectPresetROI?.(p);onFlyToZone?.(p.center,p.zoom)}}}><option value="">{t('Elegir ROI precargada','Choose preset ROI')}</option>{PRESET_ROI_CATALOG.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label style={{display:'block'}}>{t('Dominio GeoJSON Polygon EPSG:4326 (debe cubrir ROI)','Domain GeoJSON Polygon EPSG:4326 (must cover ROI)')}<textarea className="ws-rain-select" value={form.domain} onChange={e=>set('domain',e.target.value)} disabled={form.useRoi}/></label>
        <label><input type="checkbox" checked={form.useRoi} onChange={e=>set('useRoi',e.target.checked)}/>{t('Acepto usar la ROI como dominio computacional; no afirmo que sea una cuenca.','I opt in to using the ROI as computational domain; I do not claim it is a basin.')}</label>
      </section>
      <section className="ws-rain-card"><h3>{t('Hipótesis explícitas (sin valores físicos recomendados)','Explicit hypotheses (no recommended physical values)')}</h3>
        {field('crs',t('CRS métrico del terreno (EPSG:...)','Metric terrain CRS (EPSG:...)'),'text')}{field('resolution',t('Resolución terreno (m)','Terrain resolution (m)'))}
        <label>{t('Remuestreo','Resampling')}<select value={form.resampling} onChange={e=>set('resampling',e.target.value)}><option value="">—</option>{['nearest','bilinear'].map(v=><option key={v}>{v}</option>)}</select></label>
        {field('manning',t('Manning n','Manning n'))}<label style={{display:'block',margin:'6px 0'}}>{t('Infiltración','Infiltration')} <select value={form.infiltration} onChange={e=>set('infiltration',e.target.value)}><option value="">—</option><option value="unsupported">{t('no modelada (toda la lluvia escurre)','not modeled (all rain runs off)')}</option><option value="runoff_coefficient">{t('coeficiente de escorrentía 0.65–0.92 según duración (como terrapulseai_v2.1)','runoff coefficient 0.65–0.92 by duration (as in terrapulseai_v2.1)')}</option></select></label><p>{t('Con coeficiente, DG2 recibe lluvia × C; el resto se cuenta como infiltrado. Es un coeficiente agregado, no un modelo físico de infiltración.','With the coefficient, DG2 receives rain × C; the rest counts as infiltrated. It is a lumped coefficient, not a physical infiltration model.')}</p>
        <label style={{display:'block',margin:'6px 0'}}>{t('Lagos','Lakes')} <select value={form.lakes} onChange={e=>set('lakes',e.target.value)}><option value="">—</option><option value="none">{t('no incluir','do not include')}</option><option value="hydrolakes">{t('HydroLAKES: lagos llenos al inicio, lecho excavado con su profundidad media','HydroLAKES: lakes full at start, bed dug to their mean depth')}</option></select></label>
        <fieldset style={{border:'none',padding:0,margin:'6px 0'}}><legend>{t('Frontera por lado','Boundary per side')}</legend>
          {([['boundaryNorth',t('Norte','North')],['boundaryEast',t('Este','East')],['boundarySouth',t('Sur','South')],['boundaryWest',t('Oeste','West')]] as const).map(([key,label])=><label key={key} style={{display:'block'}}>{label} <select value={form[key]} onChange={e=>set(key,e.target.value)}><option value="">—</option><option value="closed">{t('cerrada (pared)','closed (wall)')}</option><option value="free">{t('libre (FREE)','free (FREE)')}</option><option value="fixed_level">{t('nivel fijo (HFIX)','fixed level (HFIX)')}</option></select></label>)}
          {field('seaLevel',t('Nivel del mar fijo (m, EGM96; mismo para todos los lados de nivel fijo)','Fixed sea level (m, EGM96; same for every fixed-level side)'))}
          <label style={{display:'block'}}><input type="checkbox" checked={form.stillWater} onChange={e=>set('stillWater',e.target.checked)}/>{t('Iniciar con el mar lleno al nivel fijo (celdas bajo ese nivel conectadas al lado de nivel fijo).','Start with the sea filled to the fixed level (cells below it connected to the fixed-level side).')}</label>
          {field('pressure',t('Presión atmosférica (hPa, 950–1040; opcional): eleva el nivel fijo del mar ~1 cm por hPa bajo 1013.25','Atmospheric pressure (hPa, 950–1040; optional): raises the fixed sea level ~1 cm per hPa below 1013.25'))}
          <p>{t('En DG2 un lado de nivel fijo no llena un dominio seco: si el nivel está sobre el terreno, inicia con el mar lleno. NASADEM no tiene batimetría: con nivel 0 sobre un mar plano a 0 m la profundidad inicial es cero.','In DG2 a fixed-level side does not fill a dry domain: if the level is above the terrain, start with the sea filled. NASADEM has no bathymetry: at level 0 over a flat 0 m sea the initial depth is zero.')}</p>
        </fieldset>
        <label style={{display:'block'}}><input type="checkbox" checked={form.nonurban} onChange={e=>set('nonurban',e.target.checked)}/>{t('Declaro que el dominio es no urbano','I declare the domain nonurban')}</label>
        {field('amount',t('Lluvia hipotética (mm)','Hypothetical rainfall (mm)'))}{field('rainDuration',t('Duración lluvia (s)','Rainfall duration (s)'))}{field('seed',t('Semilla del perfil sintético (entero no negativo)','Synthetic profile seed (nonnegative integer)'))}{field('intervals',t('Número de intervalos','Interval count'))}
        {field('duration',t('Duración de simulación (s, máximo 86400)','Simulation duration (s, max 86400)'))}{field('save',t('Intervalo solicitado de guardado (s)','Requested save interval (s)'))}{field('tstep',t('Paso inicial (s)','Initial timestep (s)'))}
        <label style={{display:'block',margin:'6px 0'}}>{t('Umbral de lámina delgada DG2 (m, 0–1; dg2depththresh)','DG2 thin-depth threshold (m, 0–1; dg2depththresh)')}<input className="ws-rain-select" style={{width:'100%'}} type="number" value={form.thinDepth} disabled={form.thinDepthOff} onChange={e=>set('thinDepth',e.target.value)}/></label>
        <label style={{display:'block'}}><input type="checkbox" checked={form.thinDepthOff} onChange={e=>set('thinDepthOff',e.target.checked)}/>{t('Desactivar umbral (por defecto del solver): pueden aparecer profundidades negativas en láminas finas.','Disable threshold (solver default): negative depths may appear on thin films.')}</label>
        <p>{t('El umbral elimina profundidades negativas en láminas finas, pero cambia la solución; queda registrado en la corrida.','The threshold removes negative depths on thin films but changes the solution; it is recorded with the run.')}</p>
        <label style={{display:'block'}}><input type="checkbox" checked={form.confirm} onChange={e=>set('confirm',e.target.checked)}/>{t('Confirmo estas hipótesis hipotéticas, lluvia sintética y exactitud no validada.','I confirm these hypothetical assumptions, synthetic rainfall and unvalidated accuracy.')}</label>
        <button type="button" className="ws-rain-action-btn" disabled={!roi||!form.confirm||Boolean(current?.run&&!['succeeded','failed','timed_out'].includes(current.run.state))} onClick={launch}>{t('Iniciar corrida DG2 (sin inicio automático)','Start DG2 run (no automatic launch)')}</button>
      </section>
      {current?.error&&<p role="alert" className="ws-rain-error">{localizeText(current.error)}</p>}
      {current?.run&&<section className="ws-rain-card" aria-live="polite"><h3>{t('Corrida','Run')}</h3><p>{current.run.id} · {current.run.state} · {current.run.stage}</p><p>{t('Umbral de lámina delgada DG2:','DG2 thin-depth threshold:')} {current.run.dg2_depth_thresh_m==null?t('desactivado','disabled'):`${current.run.dg2_depth_thresh_m} m`}</p>{current.run.losses&&<p>{t('Infiltración:','Infiltration:')} {current.run.losses.runoff_coefficient==null?t('no modelada','not modeled'):t(`coeficiente ${current.run.losses.runoff_coefficient.toFixed(3)} (${Math.round((1-current.run.losses.runoff_coefficient)*100)} % se infiltra)`,`coefficient ${current.run.losses.runoff_coefficient.toFixed(3)} (${Math.round((1-current.run.losses.runoff_coefficient)*100)} % infiltrates)`)} · {t('Presión:','Pressure:')} {current.run.losses.atmospheric_pressure_hpa==null?t('no aplicada','not applied'):`${current.run.losses.atmospheric_pressure_hpa} hPa → +${current.run.losses.barometric_surge_m.toFixed(3)} m`}</p>}{['failed','timed_out'].includes(current.run.state)&&<p role="alert">{t('Corrida fallida:','Run failed:')} {current.run.error??current.run.state}</p>}</section>}
      {current?.result&&<section className="ws-rain-card ws-rain-card--results"><h3>{t('Resultados DG2: profundidad (m)','DG2 results: depth (m)')}</h3><p>{t('Lluvia sintética; exactitud hidráulica NO validada. No son observaciones.','Synthetic rainfall; hydraulic accuracy NOT validated. Not observations.')}</p><p>{t('Los cuadros se ordenan por índice; el tiempo programado no es tiempo físico observado.','Frames ordered by index; scheduled time is not observed physical time.')}</p>
        <label>{t('Cuadro / máximo','Frame / maximum')}<select value={selected} onChange={e=>choose(e.target.value)}><option value="">{t('Selecciona cuadro','Select frame')}</option>{artifacts.map(a=><option key={a.name} value={a.name}>{a.frame_index==null?t('Máximo','Maximum'):`#${a.frame_index} (${t('programado','scheduled')} ${a.scheduled_time_s??'—'} s)`}</option>)}</select></label>
        {stats&&<dl>{(['wet_cells','valid_cells','nodata_cells','min_m','max_m'] as const).filter(key=>typeof stats[key]==='number'&&Number.isFinite(stats[key])).map(key=><div key={key}><dt>{key}</dt><dd>{String(stats[key])} {key.endsWith('_m')?'m':''}</dd></div>)}</dl>}
        {(()=>{const fr=current.result.froude?.frames.find(f=>f.frame_index===selectedArtifact?.frame_index);const tc=current.result.time_of_concentration;return (fr||tc)&&<dl>
          {fr&&<div><dt>{t('Número de Froude (h ≥ 0.15 m)','Froude number (h ≥ 0.15 m)')}</dt><dd>{fr.max==null?t('sin agua suficiente','not enough water'):t(`máx ${fr.max.toFixed(2)} · medio ${fr.mean!.toFixed(2)} · ${fr.supercritical_cells} de ${fr.cells} celdas supercríticas (Fr > 1)`,`max ${fr.max.toFixed(2)} · mean ${fr.mean!.toFixed(2)} · ${fr.supercritical_cells} of ${fr.cells} cells supercritical (Fr > 1)`)}</dd></div>}
          {tc&&<div><dt>{t('Tiempo de concentración (Kirpich)','Time of concentration (Kirpich)')}</dt><dd>{t(`${tc.minutes.toFixed(1)} min · recorrido ${Math.round(tc.flow_length_m)} m · pendiente ${tc.slope_m_m.toFixed(4)} · área drenada ${tc.upslope_area_km2.toFixed(2)} km²`,`${tc.minutes.toFixed(1)} min · flow path ${Math.round(tc.flow_length_m)} m · slope ${tc.slope_m_m.toFixed(4)} · drained area ${tc.upslope_area_km2.toFixed(2)} km²`)}</dd></div>}
        </dl>})()}
        {current.result.lakes&&current.result.lakes.length>0&&<p>{t('Lagos (HydroLAKES v1.0, CC BY 4.0; profundidad estimada, no batimetría medida):','Lakes (HydroLAKES v1.0, CC BY 4.0; estimated depth, not surveyed bathymetry):')} {current.result.lakes.map(l=>l.skipped?`${l.name??`#${l.hylak_id}`} ${t('omitido (cortado por el borde del dominio)','skipped (cut by the domain edge)')}`:`${l.name??`#${l.hylak_id}`} · ${l.depth_avg_m} m · ${l.cells} ${t('celdas','cells')}`).join('; ')}</p>}
        {current.result.roads&&<p>{(()=>{const roads=current.result.roads!;if(!roads.available)return t('Caminos (OpenStreetMap): no disponibles para esta corrida.','Roads (OpenStreetMap): not available for this run.');const exposure=selectedArtifact?.frame_index==null?roads.maximum:roads.frames?.find(f=>f.frame_index===selectedArtifact.frame_index);return t(`Caminos (OpenStreetMap): ${(roads.total_km??0).toFixed(2)} km en el dominio; cortados (≥ ${roads.thresholds_m?.cut} m) ${(exposure?.cut_km??0).toFixed(2)} km; precaución (${roads.thresholds_m?.caution}–${roads.thresholds_m?.cut} m) ${(exposure?.caution_km??0).toFixed(2)} km. © OpenStreetMap contributors.`,`Roads (OpenStreetMap): ${(roads.total_km??0).toFixed(2)} km in the domain; cut (≥ ${roads.thresholds_m?.cut} m) ${(exposure?.cut_km??0).toFixed(2)} km; caution (${roads.thresholds_m?.caution}–${roads.thresholds_m?.cut} m) ${(exposure?.caution_km??0).toFixed(2)} km. © OpenStreetMap contributors.`)})()}</p>}
        <FloodDg2Charts result={current.result} frameIndex={selectedArtifact?.frame_index}/>
        {current.result.warnings?.map((w,i)=><p key={i}>{localizeText(w)}</p>)}
        {selectedArtifact&&flood.rasterUrl&&flood.resultRoiKey===roiKey&&<p><a href={flood.rasterUrl} download={pngDownloadName(selectedArtifact.name)}>{t('Descargar imagen PNG del cuadro','Download frame PNG image')}</a> · {t('para una imagen con mapa base y flechas usa la herramienta Capturar.','for an image with basemap and arrows use the Capture tool.')}</p>}
        {selectedArtifact&&<a href={roiFloodArtifactUrl(current.run!.id,selectedArtifact.name)} download>{t('Descargar COG original (requiere sesión)','Download original COG (session required)')}</a>}
        {current.result.flow&&flood.resultRoiKey===roiKey&&<div><button type="button" onClick={()=>latest.current.onFloodChange({...latest.current.flood,showFlowArrows:!(latest.current.flood.showFlowArrows??true)})}>{(flood.showFlowArrows??true)?t('Ocultar flechas de flujo','Hide flow arrows'):t('Mostrar flechas de flujo','Show flow arrows')}</button>{selectedArtifact&&<p>{selectedArtifact.frame_index==null?t('El máximo no tiene flechas: no corresponde a un instante.','The maximum has no arrows: it is not a single instant.'):flowNote(current.result.flow,selectedArtifact.frame_index)}</p>}</div>}
        {flood.rasterUrl&&flood.resultRoiKey===roiKey&&<div><label>{t('Opacidad','Opacity')}<input type="range" min="10" max="100" value={flood.waterOpacity??85} onChange={e=>latest.current.onFloodChange({...latest.current.flood,waterOpacity:Number(e.target.value)})}/></label><button type="button" onClick={()=>latest.current.onFloodChange({...latest.current.flood,showRasterOnMap:!latest.current.flood.showRasterOnMap})}>{flood.showRasterOnMap?t('Ocultar capa','Hide layer'):t('Mostrar capa','Show layer')}</button><p>{t('Escala por clases de profundidad (leyenda en el mapa): azul claro 0.03–0.15 m a azul oscuro ≥ 2 m; menos de 0.03 m y sin dato transparentes.','Depth-class scale (legend on the map): light blue 0.03–0.15 m to dark blue ≥ 2 m; below 0.03 m and nodata transparent.')}</p></div>}
      </section>}
    </div>}
  </aside>
}
