import { useEffect, useRef, useState } from 'react'
import { CloudRain, ChevronDown, ChevronUp, X } from 'lucide-react'
import type { FloodSimulationState, LngLat } from '../types/workspace'
import { floodRoiPolygon } from '../utils/floodRoi'
import { startRoiFlood, getRoiFloodStatus, getRoiFloodResults, getRoiFloodPreview, roiFloodArtifactUrl, type FloodRoiRun, type FloodRoiResult } from '../api/client'
import { createFloodRunController } from '../utils/floodDg2'
import { useTranslation } from '../i18n/useTranslation'
import { PRESET_ROI_CATALOG, type CatalogRoiPreset } from '../utils/roiCatalog'

interface Props {
  flood: FloodSimulationState
  onFloodChange: (next: FloodSimulationState) => void
  croppedRegion?: LngLat[] | null
  onFlyToZone?: (center: LngLat, zoom?: number) => void
  onSelectPresetROI?: (preset: CatalogRoiPreset) => void
  onClose?: () => void
}
const initial = {domain:'',useRoi:false,crs:'',resolution:'',resampling:'',manning:'',boundary:'',nonurban:false,amount:'',rainDuration:'',seed:'',intervals:'',duration:'',save:'',tstep:'',confirm:false}
type Form = typeof initial
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
    if(value.rasterUrl && value.rasterBounds) change({...prev,enabled:true,rasterUrl:value.rasterUrl,rasterBounds:value.rasterBounds,showRasterOnMap:true,stats:null,charts:null,statsSource:'backend',resultRoiKey:value.roiKey})
    })
    return ()=>{controller.current?.invalidate(); const {flood:prev,onFloodChange:change}=latest.current; if(prev.rasterUrl?.startsWith('blob:')) change({...prev,enabled:false,rasterUrl:null,rasterBounds:null,stats:null,charts:null,resultRoiKey:undefined})}
  },[])
  useEffect(()=>{
    if(keyRef.current===roiKey)return
    keyRef.current=roiKey
    controller.current?.invalidate()
    setForm(f=>({...f,useRoi:false,confirm:false}))
    const {flood:prev,onFloodChange:change}=latest.current
    if(prev.rasterUrl || prev.resultRoiKey) change({...prev,enabled:false,rasterUrl:null,rasterBounds:null,stats:null,charts:null,resultRoiKey:undefined})
  },[roiKey])
  const set=(name:keyof Form,value:string|boolean)=>setForm(f=>({...f,[name]:value,confirm:name==='confirm' && value===true}))
  const roi=floodRoiPolygon(croppedRegion)
  const buildRequest=()=>{
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
    if(!['nearest','bilinear'].includes(form.resampling)||!['free','closed'].includes(form.boundary))throw Error(t('Selecciona remuestreo y frontera.','Select resampling and boundary.'))
    if(!form.nonurban||!form.confirm)throw Error(t('Declara el dominio no urbano y confirma las hipótesis.','Declare a nonurban domain and confirm the assumptions.'))
    return {roi,domain,rainfall:{amount:positive(form.amount,'Lluvia'),unit:'mm',duration:positive(form.rainDuration,'Duración de lluvia'),duration_unit:'s'},rainfall_profile:{interval_count:integer(form.intervals,'Intervalos'),seed:integer(form.seed,'Semilla',true),distribution:'uniform_balanced'},terrain:{target_crs:form.crs,resolution_m:positive(form.resolution,'Resolución'),resampling:form.resampling},hydraulics:{manning:positive(form.manning,'Manning'),initial_condition:'dry_zero_velocity',boundary:form.boundary,infiltration:'unsupported',domain_nonurban:true},simulation:{duration_s:positive(form.duration,'Duración DG2',86400),save_interval_s:positive(form.save,'Guardado'),initial_tstep_s:positive(form.tstep,'Paso inicial')}}
  }
  const launch=async()=>{try {const req=buildRequest();const {flood:prev,onFloodChange:change}=latest.current; change({...prev,enabled:false,rasterUrl:null,rasterBounds:null,stats:null,charts:null,resultRoiKey:undefined}); const outcome=await controller.current!.start(req,roiKey);if(outcome?.result){const first=outcome.result.artifacts.find(a=>a.frame_index===undefined||a.frame_index===null)??outcome.result.artifacts[0];if(first){await controller.current!.select(outcome.run,outcome.result,first.name,roiKey)}}}catch(e){setView({roiKey,error:e instanceof Error?e.message:String(e)})}}
  const choose=async(name:string)=>{if(!view?.run||!view.result)return;await controller.current!.select(view.run,view.result,name,roiKey)}
  const current=view?.roiKey===roiKey?view:null
  const selected=current?.artifactName??''
  const artifacts=current?.result?.artifacts??[]
  const selectedArtifact=artifacts.find(a=>a.name===selected)
  const frame=current?.result?.frames.find(f=>f.frame_index===selectedArtifact?.frame_index)
  const stats=frame?.stats??(selectedArtifact?.frame_index==null?current?.result?.maximum.stats:undefined)
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
        {field('manning',t('Manning n','Manning n'))}<p>{t('Inicio seco y velocidad cero; infiltración no modelada.','Dry initial condition and zero velocity; infiltration not modeled.')}</p>
        <label>{t('Frontera','Boundary')}<select value={form.boundary} onChange={e=>set('boundary',e.target.value)}><option value="">—</option><option value="free">free</option><option value="closed">closed</option></select></label>
        <label style={{display:'block'}}><input type="checkbox" checked={form.nonurban} onChange={e=>set('nonurban',e.target.checked)}/>{t('Declaro que el dominio es no urbano','I declare the domain nonurban')}</label>
        {field('amount',t('Lluvia hipotética (mm)','Hypothetical rainfall (mm)'))}{field('rainDuration',t('Duración lluvia (s)','Rainfall duration (s)'))}{field('seed',t('Semilla del perfil sintético (entero no negativo)','Synthetic profile seed (nonnegative integer)'))}{field('intervals',t('Número de intervalos','Interval count'))}
        {field('duration',t('Duración de simulación (s, máximo 86400)','Simulation duration (s, max 86400)'))}{field('save',t('Intervalo solicitado de guardado (s)','Requested save interval (s)'))}{field('tstep',t('Paso inicial (s)','Initial timestep (s)'))}
        <label style={{display:'block'}}><input type="checkbox" checked={form.confirm} onChange={e=>set('confirm',e.target.checked)}/>{t('Confirmo estas hipótesis hipotéticas, lluvia sintética y exactitud no validada.','I confirm these hypothetical assumptions, synthetic rainfall and unvalidated accuracy.')}</label>
        <button type="button" className="ws-rain-action-btn" disabled={!roi||!form.confirm||Boolean(current?.run&&!['succeeded','failed','timed_out'].includes(current.run.state))} onClick={launch}>{t('Iniciar corrida DG2 (sin inicio automático)','Start DG2 run (no automatic launch)')}</button>
      </section>
      {current?.error&&<p role="alert" className="ws-rain-error">{localizeText(current.error)}</p>}
      {current?.run&&<section className="ws-rain-card" aria-live="polite"><h3>{t('Corrida','Run')}</h3><p>{current.run.id} · {current.run.state} · {current.run.stage}</p>{['failed','timed_out'].includes(current.run.state)&&<p role="alert">{t('Corrida fallida:','Run failed:')} {current.run.error??current.run.state}</p>}</section>}
      {current?.result&&<section className="ws-rain-card ws-rain-card--results"><h3>{t('Resultados DG2: profundidad (m)','DG2 results: depth (m)')}</h3><p>{t('Lluvia sintética; exactitud hidráulica NO validada. No son observaciones.','Synthetic rainfall; hydraulic accuracy NOT validated. Not observations.')}</p><p>{t('Los cuadros se ordenan por índice; el tiempo programado no es tiempo físico observado.','Frames ordered by index; scheduled time is not observed physical time.')}</p>
        <label>{t('Cuadro / máximo','Frame / maximum')}<select value={selected} onChange={e=>choose(e.target.value)}><option value="">{t('Selecciona cuadro','Select frame')}</option>{artifacts.map(a=><option key={a.name} value={a.name}>{a.frame_index==null?t('Máximo','Maximum'):`#${a.frame_index} (${t('programado','scheduled')} ${a.scheduled_time_s??'—'} s)`}</option>)}</select></label>
        {stats&&<dl>{(['wet_cells','valid_cells','nodata_cells','min_m','max_m'] as const).filter(key=>typeof stats[key]==='number'&&Number.isFinite(stats[key])).map(key=><div key={key}><dt>{key}</dt><dd>{String(stats[key])} {key.endsWith('_m')?'m':''}</dd></div>)}</dl>}
        {current.result.warnings?.map((w,i)=><p key={i}>{localizeText(w)}</p>)}
        {selectedArtifact&&<a href={roiFloodArtifactUrl(current.run!.id,selectedArtifact.name)} download>{t('Descargar COG original (requiere sesión)','Download original COG (session required)')}</a>}
        {flood.rasterUrl&&flood.resultRoiKey===roiKey&&<div><label>{t('Opacidad','Opacity')}<input type="range" min="10" max="100" value={flood.waterOpacity??85} onChange={e=>latest.current.onFloodChange({...latest.current.flood,waterOpacity:Number(e.target.value)})}/></label><button type="button" onClick={()=>latest.current.onFloodChange({...latest.current.flood,showRasterOnMap:!latest.current.flood.showRasterOnMap})}>{flood.showRasterOnMap?t('Ocultar capa','Hide layer'):t('Mostrar capa','Show layer')}</button><p>{t('Paleta fija: 0.03 m azul RGB(30,140,220) → 3 m rojo RGB(135,0,70); menos de 0.03 m y sin dato transparentes.','Fixed palette: 0.03 m blue RGB(30,140,220) → 3 m red RGB(135,0,70); below 0.03 m and nodata transparent.')}</p></div>}
      </section>}
    </div>}
  </aside>
}
