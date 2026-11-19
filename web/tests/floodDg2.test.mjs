import test from 'node:test'
import assert from 'node:assert/strict'
import { startRoiFlood, getRoiFloodStatus, getRoiFloodResults, getRoiFloodPreview, roiFloodArtifactUrl } from '../src/api/client.ts'
import { createFloodRunController } from '../src/utils/floodDg2.ts'
const id = '6c5b38f4-9d14-4c71-912b-04ed7629d94a'
const base = `/api/flood-roi-runs/${id}/`
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json'}})
test('POST session CSRF, status only before success, results and preview use owned route', async () => {
  const calls=[]; globalThis.document={cookie:'csrftoken=abc%20def'}
  globalThis.fetch=async (path,init) => {calls.push([path,init]); if(path.endsWith('start/')) return json({id,state:'created',stage:'created',status_url:base,results_url:base+'results/'},202); if(path===base) return json({id,state:'succeeded',stage:'succeeded'}); if(path.endsWith('results/')) return json({frames:[],maximum:{stats:{wet_cells:1}},artifacts:[]}); return new Response(new Blob(['png'],{type:'image/png'}),{headers:{'content-type':'image/png','X-Preview-CRS':'EPSG:3857','X-Preview-Bounds':'-93,16,-92,17','X-Preview-Units':'m'}}) }
  const req={roi:{type:'Polygon',coordinates:[]}}
  assert.equal((await startRoiFlood(req)).id,id)
  assert.equal(calls[0][1].credentials,'same-origin'); assert.equal(calls[0][1].headers['X-CSRFToken'],'abc def')
  assert.equal((await getRoiFloodStatus(id)).state,'succeeded')
  assert.equal((await getRoiFloodResults(id)).maximum.stats.wet_cells,1)
  assert.equal(roiFloodArtifactUrl(id,'roi-0000.wd.tif'),base+'artifacts/roi-0000.wd.tif/')
  const preview=await getRoiFloodPreview(id,'roi-0000.wd.tif'); assert.deepEqual(preview.bounds,[-93,16,-92,17]); assert.equal(preview.blob.type,'image/png'); assert.equal(calls[3][0],base+'artifacts/roi-0000.wd.tif/preview/')
})
test('rejects unsafe URLs, bad preview geometry, structured validation and login/service failures',async()=>{
  assert.throws(()=>roiFloodArtifactUrl(id,'../other'),/artefacto|artifact/i)
  globalThis.fetch=async()=>json({errors:{domain:['Dominio inválido.']}},400)
  await assert.rejects(startRoiFlood({}),/Dominio inválido/)
  globalThis.fetch=async()=>json({},403)
  await assert.rejects(getRoiFloodStatus(id),/admin\/login/)
  globalThis.fetch=async()=>json({},503)
  await assert.rejects(startRoiFlood({}),/503/)
  globalThis.fetch=async()=>new Response(new Blob(['png'],{type:'image/png'}),{headers:{'content-type':'image/png','X-Preview-CRS':'EPSG:3857','X-Preview-Bounds':'NaN,16,-92,17','X-Preview-Units':'m'}})
  await assert.rejects(getRoiFloodPreview(id,'max.wd.tif'),/preview/i)
})
test('controller publishes only successful result; selection replaces and revokes previews, then cleanup',async()=>{
  const events=[],revoked=[]; let statuses=0,results=0
  const api={start:async()=>({id,state:'created',stage:'created'}),status:async()=>({id,state:++statuses===1?'running':'succeeded',stage:'running'}),results:async()=>{results++;return {frames:[{frame_index:0,scheduled_time_s:0,stats:{max_m:1}}],maximum:{stats:{max_m:1}},artifacts:[{name:'roi-0000.wd.tif',frame_index:0},{name:'roi.max.tif'}]}},preview:async()=>({blob:new Blob(['png']),bounds:[-93,16,-92,17]})}
  let url=0; const controller=createFloodRunController(api,v=>events.push(v),{createObjectURL:()=>`blob:${++url}`,revokeObjectURL:u=>revoked.push(u)},async()=>{})
  const done=await controller.start({},'roi-a'); assert.equal(results,1); assert.deepEqual(events.slice(1,4).map(e=>e.run.state),['created','running','succeeded']); assert.equal(events[4].result.maximum.stats.max_m,1)
  await controller.select(done.run,done.result,'roi-0000.wd.tif','roi-a'); await controller.select(done.run,done.result,'roi.max.tif','roi-a'); assert.equal(events.at(-1).rasterUrl,'blob:2'); assert.deepEqual(revoked,['blob:1'])
  controller.invalidate(); assert.deepEqual(revoked,['blob:1','blob:2']);assert.equal(events.at(-1),null)
})
test('preview selection commits identity, raster, stats and download together after success only', async () => {
  const run = { id, state: 'succeeded', stage: 'succeeded' }
  const result = {
    maximum: { stats: { max_m: 3 } },
    frames: [{ frame_index: 0, stats: { max_m: 1 } }],
    artifacts: [{ name: 'roi.max.tif', frame_index: null }, { name: 'roi-0000.wd.tif', frame_index: 0 }],
  }
  let fail = false, release, serial = 0
  const events = [], revoked = []
  const controller = createFloodRunController({
    start: async () => run, status: async () => run, results: async () => result,
    preview: async (_, name) => {
      if (fail) throw Error('HTTP 403')
      if (name === 'roi-0000.wd.tif') await new Promise(resolve => { release = resolve })
      return { blob: new Blob([name]), bounds: [-93, 16, -92, 17] }
    },
  }, value => events.push(value), {
    createObjectURL: () => `blob:${++serial}`, revokeObjectURL: u => revoked.push(u),
  }, async () => {})
  const displayed = () => {
    const view = events.at(-1)
    const artifact = view.result.artifacts.find(a => a.name === view.artifactName)
    return {
      name: artifact?.name, raster: view.rasterUrl,
      stats: artifact?.frame_index == null ? view.result.maximum.stats : view.result.frames.find(f => f.frame_index === artifact.frame_index).stats,
      download: artifact && roiFloodArtifactUrl(id, artifact.name),
    }
  }
  await controller.start({}, 'roi-a')
  await controller.select(run, result, 'roi.max.tif', 'roi-a')
  const maximum = { name: 'roi.max.tif', raster: 'blob:1', stats: { max_m: 3 }, download: base + 'artifacts/roi.max.tif/' }
  assert.deepEqual(displayed(), maximum)
  fail = true
  await controller.select(run, result, 'roi-0000.wd.tif', 'roi-a')
  assert.equal(events.at(-1).error, 'HTTP 403')
  assert.deepEqual(displayed(), maximum)
  assert.deepEqual(revoked, [])
  fail = false
  const stale = controller.select(run, result, 'roi-0000.wd.tif', 'roi-a')
  await controller.select(run, result, 'roi.max.tif', 'roi-a')
  release(); await stale
  assert.equal(displayed().name, 'roi.max.tif')
  assert.equal(displayed().raster, 'blob:2')
  const frame = controller.select(run, result, 'roi-0000.wd.tif', 'roi-a')
  release(); await frame
  assert.deepEqual(displayed(), { name: 'roi-0000.wd.tif', raster: 'blob:3', stats: { max_m: 1 }, download: base + 'artifacts/roi-0000.wd.tif/' })
  controller.invalidate()
  assert.equal(events.at(-1), null)
  assert.deepEqual(revoked, ['blob:1', 'blob:2', 'blob:3'])
})

test('controller never queries result for failed and timed_out runs',async()=>{
  for(const state of ['failed','timed_out']) {let results=0;const events=[];const controller=createFloodRunController({start:async()=>({id,state:'created',stage:'created'}),status:async()=>({id,state,stage:state,error:'acquisition_failed'}),results:async()=>{results++;return {}},preview:async()=>{throw Error('unexpected')}},v=>events.push(v),undefined,async()=>{})
    await controller.start({},'roi-a');assert.equal(results,0);assert.equal(events.at(-1).run.state,state);controller.invalidate()
  }
})
test('controller invalidation aborts stale ROI and revokes object URLs; no results until success',async()=>{
  let release; const pending=new Promise(resolve=>{release=resolve}); let results=0, changes=[]; const revoked=[]
  const controller=createFloodRunController({start:async()=>({id,state:'created',stage:'created'}),status:async()=>{await pending; return {id,state:'succeeded',stage:'results'}},results:async()=>{results++;return {frames:[],maximum:{stats:{}},artifacts:[]}},preview:async()=>({blob:new Blob(['png']),bounds:[-93,16,-92,17]})},v=>changes.push(v),{createObjectURL:()=> 'blob:preview',revokeObjectURL:u=>revoked.push(u)},()=>Promise.resolve())
  const job=controller.start({},'roi-a'); await Promise.resolve(); controller.invalidate(); release(); await job
  assert.equal(results,0); assert.equal(changes.some(v=>v?.rasterUrl),false); assert.deepEqual(revoked,[])
})

const { buildRoiFloodRequest } = await import('../src/utils/floodDg2.ts')
const tr = es => es
const square = {type:'Polygon',coordinates:[[[-93.3,16.67],[-93.29,16.67],[-93.29,16.68],[-93.3,16.68],[-93.3,16.67]]]}
const filledForm = (overrides={}) => ({domain:'',useRoi:true,crs:'EPSG:32615',resolution:'30',resampling:'nearest',manning:'0.05',boundaryNorth:'free',boundaryEast:'free',boundarySouth:'free',boundaryWest:'free',seaLevel:'',stillWater:false,nonurban:true,amount:'20',rainDuration:'600',seed:'7',intervals:'4',duration:'900',save:'300',tstep:'1',thinDepth:'',thinDepthOff:true,confirm:true,...overrides})

test('request builder keeps every previous field and sends an explicitly disabled thin-depth threshold as null', () => {
  assert.deepEqual(buildRoiFloodRequest(filledForm(), square, tr), {roi:square,domain:square,
    rainfall:{amount:20,unit:'mm',duration:600,duration_unit:'s'},
    rainfall_profile:{interval_count:4,seed:7,distribution:'uniform_balanced'},
    terrain:{target_crs:'EPSG:32615',resolution_m:30,resampling:'nearest'},
    hydraulics:{manning:.05,initial_condition:'dry_zero_velocity',boundary:{north:{type:'free'},east:{type:'free'},south:{type:'free'},west:{type:'free'}},infiltration:'unsupported',domain_nonurban:true},
    simulation:{duration_s:900,save_interval_s:300,initial_tstep_s:1,dg2_depth_thresh_m:null}})
})

test('request builder sends per-side boundaries with one fixed sea level and a still-water start', () => {
  const hydraulics = buildRoiFloodRequest(filledForm({boundaryNorth:'closed',boundaryEast:'free',boundarySouth:'fixed_level',boundaryWest:'fixed_level',seaLevel:'0',stillWater:true}), square, tr).hydraulics
  assert.deepEqual(hydraulics.boundary, {north:{type:'closed'},east:{type:'free'},south:{type:'fixed_level',level_m:0},west:{type:'fixed_level',level_m:0}})
  assert.equal(hydraulics.initial_condition, 'still_water_at_fixed_level')
  assert.equal(buildRoiFloodRequest(filledForm({boundaryWest:'fixed_level',seaLevel:'-0.5'}), square, tr).hydraulics.initial_condition, 'dry_zero_velocity')
})

test('request builder rejects a missing side, a fixed side without a sea level, and a still-water start without a fixed side', () => {
  assert.throws(() => buildRoiFloodRequest(filledForm({boundaryNorth:''}), square, tr), /frontera/)
  for (const seaLevel of ['', 'abc', '20000']) {
    assert.throws(() => buildRoiFloodRequest(filledForm({boundaryWest:'fixed_level',seaLevel}), square, tr), /Nivel del mar/)
  }
  assert.throws(() => buildRoiFloodRequest(filledForm({stillWater:true}), square, tr), /nivel fijo/)
})

test('request builder sends an explicit thin-depth threshold in meters', () => {
  assert.equal(buildRoiFloodRequest(filledForm({thinDepth:'0.02',thinDepthOff:false}), square, tr).simulation.dg2_depth_thresh_m, .02)
})

test('request builder rejects a missing or out-of-range thin-depth threshold unless explicitly disabled', () => {
  for (const thinDepth of ['', '0', '-0.02', '1.5', 'abc']) {
    assert.throws(() => buildRoiFloodRequest(filledForm({thinDepth,thinDepthOff:false}), square, tr), /Umbral de lámina delgada DG2/)
  }
})

test('flow arrows for the selected frame become GeoJSON points with speed and bearing', async () => {
  const { flowArrowFeatures } = await import('../src/utils/floodDg2.ts')
  const result = { flow: { units: 'm/s', min_depth_m: .03, frames: [
    { frame_index: 0, max_speed_m_s: 0, arrows: [] },
    { frame_index: 1, max_speed_m_s: 2.5, arrows: [[-93.29, 16.67, 2.5, 90], [-93.28, 16.68, .4, 181.5]] },
  ] } }
  assert.deepEqual(flowArrowFeatures(result, 1), { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-93.29, 16.67] }, properties: { speed: 2.5, bearing: 90 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-93.28, 16.68] }, properties: { speed: .4, bearing: 181.5 } },
  ] })
  assert.deepEqual(flowArrowFeatures(result, 0), { type: 'FeatureCollection', features: [] })
})

test('no flow arrows for the maximum, a missing frame, or runs without solver velocities', async () => {
  const { flowArrowFeatures } = await import('../src/utils/floodDg2.ts')
  const result = { flow: { units: 'm/s', min_depth_m: .03, frames: [{ frame_index: 1, max_speed_m_s: 1, arrows: [[0, 0, 1, 0]] }] } }
  assert.equal(flowArrowFeatures(result, null), null)
  assert.equal(flowArrowFeatures(result, undefined), null)
  assert.equal(flowArrowFeatures(result, 7), null)
  assert.equal(flowArrowFeatures({ flow: null }, 1), null)
  assert.equal(flowArrowFeatures({}, 1), null)
})

test('PNG download name keeps the artifact stem', async () => {
  const { pngDownloadName } = await import('../src/utils/floodDg2.ts')
  assert.equal(pngDownloadName('roi-0001.wd.tif'), 'roi-0001.wd.png')
  assert.equal(pngDownloadName('roi.max.tif'), 'roi.max.png')
})

test('map legend depth classes match the backend preview palette exactly', async () => {
  const { DEPTH_CLASSES } = await import('../src/utils/floodDg2.ts')
  const { readFileSync } = await import('node:fs')
  const python = readFileSync(new URL('../../backend/analyses/roi_flood_runs.py', import.meta.url), 'utf8')
  const block = python.match(/_DEPTH_CLASSES = \[([\s\S]*?)\]\n/)[1]
  const backend = [...block.matchAll(/\(([\d.]+), \((\d+), (\d+), (\d+)\)\)/g)].map(m => [Number(m[1]), [Number(m[2]), Number(m[3]), Number(m[4])]])
  assert.equal(backend.length, 5)
  assert.deepEqual(DEPTH_CLASSES.map(c => [c.min, c.rgb]), backend)
  assert.deepEqual(DEPTH_CLASSES.map(c => c.max), [.15, .5, 1, 2, null])
})
