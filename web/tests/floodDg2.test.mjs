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
const filledForm = (overrides={}) => ({domain:'',useRoi:true,crs:'EPSG:32615',resolution:'30',resampling:'nearest',manning:'0.05',boundaryNorth:'free',boundaryEast:'free',boundarySouth:'free',boundaryWest:'free',seaLevel:'',stillWater:false,infiltration:'unsupported',pressure:'',lakes:'none',nonurban:true,amount:'20',rainDuration:'600',seed:'7',intervals:'4',duration:'900',save:'300',tstep:'1',thinDepth:'',thinDepthOff:true,solver:'dg2',terrainSource:'nasadem',confirm:true,...overrides})

test('request builder keeps every previous field and sends an explicitly disabled thin-depth threshold as null', () => {
  assert.deepEqual(buildRoiFloodRequest(filledForm(), square, tr), {roi:square,domain:square,
    rainfall:{amount:20,unit:'mm',duration:600,duration_unit:'s'},
    rainfall_profile:{interval_count:4,seed:7,distribution:'uniform_balanced'},
    terrain:{target_crs:'EPSG:32615',resolution_m:30,resampling:'nearest',source:'nasadem'},
    hydraulics:{manning:.05,initial_condition:'dry_zero_velocity',boundary:{north:{type:'free'},east:{type:'free'},south:{type:'free'},west:{type:'free'}},infiltration:'unsupported',domain_nonurban:true,lakes:'none'},
    simulation:{duration_s:900,save_interval_s:300,initial_tstep_s:1,dg2_depth_thresh_m:null,solver:'dg2'}})
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

test('request builder sends infiltration by runoff coefficient and an atmospheric pressure that raises the sea', () => {
  const hydraulics = buildRoiFloodRequest(filledForm({infiltration:'runoff_coefficient',boundaryWest:'fixed_level',seaLevel:'0',pressure:'990'}), square, tr).hydraulics
  assert.equal(hydraulics.infiltration, 'runoff_coefficient')
  assert.equal(hydraulics.atmospheric_pressure_hpa, 990)
  assert.equal('atmospheric_pressure_hpa' in buildRoiFloodRequest(filledForm(), square, tr).hydraulics, false)
})

test('request builder rejects a missing infiltration choice, a pressure out of 950-1040 hPa, and a pressure without a fixed sea level', () => {
  assert.throws(() => buildRoiFloodRequest(filledForm({infiltration:''}), square, tr), /infiltración/)
  for (const pressure of ['940', '1050', 'abc']) {
    assert.throws(() => buildRoiFloodRequest(filledForm({boundaryWest:'fixed_level',seaLevel:'0',pressure}), square, tr), /Presión atmosférica/)
  }
  assert.throws(() => buildRoiFloodRequest(filledForm({pressure:'990'}), square, tr), /nivel fijo/)
})

test('request builder sends the lakes choice explicitly and rejects a missing one', () => {
  assert.equal(buildRoiFloodRequest(filledForm({lakes:'hydrolakes'}), square, tr).hydraulics.lakes, 'hydrolakes')
  assert.throws(() => buildRoiFloodRequest(filledForm({lakes:''}), square, tr), /lagos/)
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
  assert.equal(backend.length, 6)
  assert.deepEqual(DEPTH_CLASSES.map(c => [c.min, c.rgb]), backend)
  assert.deepEqual(DEPTH_CLASSES.map(c => c.max), [.03, .15, .5, 1, 2, null])
  // The 0.01-0.03 m thin-sheet class is the lightest blue of the sequence.
  assert.deepEqual(DEPTH_CLASSES[0], {min:.01, max:.03, rgb:[222,235,247]})
})

test('depth classes of a run: new runs chart the 1-3 cm class, older five-class runs keep their own bounds', async () => {
  const { dg2ChartData, dg2Summary } = await import('../src/utils/floodDg2.ts')
  const base = { grid: { cellsize_m: 30 }, rainfall_segments: null, mass_balance: null }
  const fresh = { ...base, depth_classes_m: [.01, .03, .15, .5, 1, 2],
    frames: [{ frame_index: 0, scheduled_time_s: 0, stats: { max_m: .2, valid_cells: 100, depth_class_cells: [40, 6, 3, 0, 0, 0] } }],
    maximum: { stats: { max_m: .2, valid_cells: 100, depth_class_cells: [50, 8, 4, 0, 0, 0] } } }
  const chart = dg2ChartData(fresh, null)
  assert.deepEqual(chart.distribution.labels, ['0.01–0.03', '0.03–0.15', '0.15–0.5', '0.5–1', '1–2', '≥ 2'])
  assert.deepEqual(chart.distribution.colors, ['rgb(222,235,247)', 'rgb(198,219,239)', 'rgb(107,174,214)', 'rgb(33,113,181)', 'rgb(8,81,156)', 'rgb(8,48,107)'])
  // Flooded area still counts from 0.03 m; the 1-3 cm sheet is reported apart.
  assert.deepEqual(chart.evolution.wetAreaHa, [9 * 900 / 1e4])
  const summary = dg2Summary(fresh, null)
  assert.deepEqual([summary.floodedHa, summary.floodedPct, summary.thinSheetHa], [12 * 900 / 1e4, 12, 50 * 900 / 1e4])
  const old = { ...base, depth_classes_m: [.03, .15, .5, 1, 2],
    frames: [{ frame_index: 0, scheduled_time_s: 0, stats: { max_m: .2, valid_cells: 100, depth_class_cells: [6, 3, 0, 0, 0] } }],
    maximum: { stats: { max_m: .2, valid_cells: 100, depth_class_cells: [8, 4, 0, 0, 0] } } }
  assert.deepEqual(dg2ChartData(old, null).distribution.labels, ['0.03–0.15', '0.15–0.5', '0.5–1', '1–2', '≥ 2'])
  assert.deepEqual(dg2ChartData(old, null).distribution.colors, ['rgb(198,219,239)', 'rgb(107,174,214)', 'rgb(33,113,181)', 'rgb(8,81,156)', 'rgb(8,48,107)'])
  assert.deepEqual([dg2Summary(old, null).floodedHa, dg2Summary(old, null).thinSheetHa], [12 * 900 / 1e4, null])
  assert.deepEqual(dg2ChartData(old, null).evolution.wetAreaHa, [9 * 900 / 1e4])
})

test('DG2 chart data: hyetograph, wet area and maximum depth over time, volume balance and depth distribution', async () => {
  const { dg2ChartData } = await import('../src/utils/floodDg2.ts')
  const result = {
    grid: { cellsize_m: 30 }, depth_classes_m: [.03, .15, .5, 1, 2],
    rainfall_segments: [{ start_s: 0, end_s: 300, intensity_mm_h: 113 }, { start_s: 300, end_s: 600, intensity_mm_h: 127 }],
    frames: [
      { frame_index: 0, scheduled_time_s: 0, stats: { max_m: 0, depth_class_cells: [0, 0, 0, 0, 0] } },
      { frame_index: 1, scheduled_time_s: 300, stats: { max_m: .8, depth_class_cells: [100, 10, 5, 0, 0] } },
    ],
    maximum: { stats: { max_m: 1.2, depth_class_cells: [120, 20, 8, 2, 0] } },
    mass_balance: { series: [[100, 1000, 1200], [600, 20000, 24000]] },
  }
  const data = dg2ChartData(result, 1)
  assert.deepEqual(data.hyetograph, { labels: ['0–5', '5–10'], mmPerHour: [113, 127] })
  assert.deepEqual(data.evolution, { minutes: [0, 5], wetAreaHa: [0, 115 * 900 / 1e4], maxDepthM: [0, .8] })
  assert.deepEqual(data.volume, { minutes: [100 / 60, 10], domainM3: [1000, 20000], rainM3: [1200, 24000] })
  assert.deepEqual(data.distribution.labels, ['0.03–0.15', '0.15–0.5', '0.5–1', '1–2', '≥ 2'])
  assert.deepEqual(data.distribution.areaHa, [9, .9, .45, 0, 0])
  assert.deepEqual(dg2ChartData(result, null).distribution.areaHa, [10.8, 1.8, .72, .18, 0])  // maximum
})

test('DG2 chart data is null where older runs lack the inputs', async () => {
  const { dg2ChartData } = await import('../src/utils/floodDg2.ts')
  const data = dg2ChartData({ grid: { cellsize_m: 30 }, frames: [{ frame_index: 0, scheduled_time_s: 0, stats: { max_m: 0 } }], maximum: { stats: {} } }, 0)
  assert.equal(data.hyetograph, null)
  assert.equal(data.volume, null)
  assert.equal(data.distribution, null)
  assert.equal(data.evolution, null)
})

test('request builder keeps the exact body for a coastal form with every hydraulic option set', () => {
  const form = filledForm({boundaryNorth:'closed',boundaryEast:'free',boundarySouth:'fixed_level',boundaryWest:'closed',seaLevel:'0',stillWater:true,infiltration:'runoff_coefficient',lakes:'hydrolakes',pressure:'990',amount:'50',rainDuration:'120',intervals:'2',duration:'180',save:'60',manning:'0.04',thinDepth:'0.02',thinDepthOff:false})
  assert.deepEqual(buildRoiFloodRequest(form, square, tr), {roi:square,domain:square,
    rainfall:{amount:50,unit:'mm',duration:120,duration_unit:'s'},
    rainfall_profile:{interval_count:2,seed:7,distribution:'uniform_balanced'},
    terrain:{target_crs:'EPSG:32615',resolution_m:30,resampling:'nearest',source:'nasadem'},
    hydraulics:{manning:.04,initial_condition:'still_water_at_fixed_level',boundary:{north:{type:'closed'},east:{type:'free'},south:{type:'fixed_level',level_m:0},west:{type:'closed'}},infiltration:'runoff_coefficient',domain_nonurban:true,lakes:'hydrolakes',atmospheric_pressure_hpa:990},
    simulation:{duration_s:180,save_interval_s:60,initial_tstep_s:1,dg2_depth_thresh_m:.02,solver:'dg2'}})
})

const emptyForm = () => ({domain:'',useRoi:false,crs:'',resolution:'',resampling:'',manning:'',boundaryNorth:'',boundaryEast:'',boundarySouth:'',boundaryWest:'',seaLevel:'',stillWater:false,infiltration:'',pressure:'',lakes:'',nonurban:false,amount:'',rainDuration:'',seed:'',intervals:'',duration:'',save:'',tstep:'',thinDepth:'',thinDepthOff:false,solver:'dg2',terrainSource:'',confirm:false})

test('example values fill the illustrative numbers and land-surface choices, never the user declarations', async () => {
  const { exampleFormValues } = await import('../src/utils/floodDg2.ts')
  const filled = exampleFormValues({...emptyForm(), confirm:true, pressure:'990'}, square)
  // A 100-year, 3-hour design storm, simulated one hour longer (14400 s) with a frame every 1200 s (14 frames),
  // no DG2 thin-depth threshold: enough water to see where it accumulates on a ~1 km² hillside.
  assert.deepEqual(filled, {...emptyForm(), crs:'EPSG:32615', resolution:'30', resampling:'nearest', manning:'0.05',
    boundaryNorth:'free', boundaryEast:'free', boundarySouth:'free', boundaryWest:'free', seaLevel:'', stillWater:false, pressure:'',
    amount:'60', rainDuration:'10800', intervals:'18', seed:'7', duration:'14400', save:'1200', tstep:'1', thinDepth:'0.02', thinDepthOff:true, solver:'dg2', terrainSource:'copernicus',
    rainKind:'design_storm', returnPeriod:'100', stormHours:'3', manningMode:'worldcover', infiltration:'curve_number', moisture:'auto', confirm:false})
  // Lakes, the domain, the urban declaration and the confirmation stay the user's explicit choice.
  assert.throws(() => buildRoiFloodRequest({...filled, useRoi:true, nonurban:true, confirm:true}, square, tr), /lagos/)
  assert.throws(() => buildRoiFloodRequest({...filled, useRoi:true, nonurban:true, lakes:'none'}, square, tr), /Confirma/)
  const body = buildRoiFloodRequest({...filled, useRoi:true, nonurban:true, confirm:true, lakes:'none'}, square, tr)
  assert.deepEqual(body.rainfall, null)
  assert.deepEqual(body.rainfall_profile, {source:'design_storm', return_period_years:100, duration_h:3, step_s:600})
  assert.deepEqual(body.simulation, {duration_s:14400, save_interval_s:1200, initial_tstep_s:1, dg2_depth_thresh_m:null, solver:'dg2'})
  assert.deepEqual([body.terrain.source, body.terrain.resolution_m, body.hydraulics.manning, body.hydraulics.infiltration, body.hydraulics.antecedent_moisture],
    ['copernicus', 30, 'worldcover', 'curve_number', 'auto'])
  assert.deepEqual(Object.values(body.hydraulics.boundary), [{type:'free'}, {type:'free'}, {type:'free'}, {type:'free'}])
  // Server limits: floor(14400 / 1200) + 2 = 14 frames <= 20 and the 3 h storm fits in the 4 h simulation.
  assert.ok(Math.floor(14400 / 1200) + 2 <= 20 && 3 * 3600 <= 14400)
  // Switching the example to synthetic rain keeps a consistent 60 mm in 3 h.
  const synthetic = buildRoiFloodRequest({...filled, rainKind:'synthetic', useRoi:true, nonurban:true, confirm:true, lakes:'none'}, square, tr)
  assert.deepEqual(synthetic.rainfall, {amount:60, unit:'mm', duration:10800, duration_unit:'s'})
})

test('pre-send checks: rain longer than the simulation and more than 20 frames are refused with a clear message', () => {
  assert.throws(() => buildRoiFloodRequest(filledForm({rainDuration:'3600', duration:'1800', save:'600'}), square, tr),
    /La lluvia \(3600 s\) dura más que la simulación \(1800 s\)/)
  assert.throws(() => buildRoiFloodRequest(filledForm({duration:'7200', save:'300'}), square, tr),
    /26 cuadros.*máximo 20.*intervalo de guardado de al menos 400 s/)
  // At the limit: floor(5400 / 300) + 2 = 20 frames, rain as long as the simulation.
  const body = buildRoiFloodRequest(filledForm({rainDuration:'5400', duration:'5400', save:'300'}), square, tr)
  assert.deepEqual([body.simulation.duration_s, body.simulation.save_interval_s, body.rainfall.duration], [5400, 300, 5400])
  assert.throws(() => buildRoiFloodRequest(filledForm({rainKind:'design_storm', returnPeriod:'100', stormHours:'3', duration:'7200', save:'1200'}), square, tr),
    /debe cubrir toda la tormenta/)
  assert.equal(tr('x','y'), 'x')
})

test('terrain source: Copernicus or NASADEM is sent as terrain.source and must be chosen', () => {
  assert.deepEqual(buildRoiFloodRequest(filledForm({terrainSource:'copernicus'}), square, tr).terrain,
    {target_crs:'EPSG:32615',resolution_m:30,resampling:'nearest',source:'copernicus'})
  // Only terrain.source differs between the two choices.
  const nasadem = buildRoiFloodRequest(filledForm(), square, tr), copernicus = buildRoiFloodRequest(filledForm({terrainSource:'copernicus'}), square, tr)
  assert.deepEqual({...copernicus, terrain:{...copernicus.terrain, source:'nasadem'}}, nasadem)
  for (const terrainSource of ['', 'srtm', 'Copernicus']) assert.throws(() => buildRoiFloodRequest(filledForm({terrainSource}), square, tr), /fuente del terreno/)
})

test('terrain labels name the source and the EGM2008 datum of every height', async () => {
  const { terrainLabel } = await import('../src/utils/floodDg2.ts')
  assert.equal(terrainLabel('copernicus'), 'Copernicus GLO-30')
  assert.equal(terrainLabel('nasadem'), 'NASADEM')
  assert.equal(terrainLabel(undefined), 'NASADEM')  // runs created before the choice used NASADEM
  assert.throws(() => buildRoiFloodRequest(filledForm({boundaryWest:'fixed_level',seaLevel:'x'}), square, tr), /EGM2008/)
})

test('example CRS is the UTM zone of the ROI centre, EPSG:32615 without a ROI', async () => {
  const { exampleFormValues, utmEpsgFor } = await import('../src/utils/floodDg2.ts')
  assert.equal(utmEpsgFor(-93.1, 16.8), 'EPSG:32615')
  assert.equal(utmEpsgFor(-115.3, 32.5), 'EPSG:32611')
  assert.equal(utmEpsgFor(-70, -33), 'EPSG:32719')
  assert.equal(exampleFormValues(emptyForm(), null).crs, 'EPSG:32615')
  const baja = {type:'Polygon',coordinates:[[[-115.4,32.4],[-115.3,32.4],[-115.3,32.5],[-115.4,32.4]]]}
  assert.equal(exampleFormValues(emptyForm(), baja).crs, 'EPSG:32611')
})

test('scenario presets: coast sets one fixed sea side at 0 m with still water; inland frees every side', async () => {
  const { coastPreset, inlandPreset } = await import('../src/utils/floodDg2.ts')
  const coast = coastPreset(filledForm({pressure:'', confirm:true}), 'south')
  assert.deepEqual([coast.boundaryNorth, coast.boundaryEast, coast.boundarySouth, coast.boundaryWest, coast.seaLevel, coast.stillWater, coast.confirm], ['free', 'free', 'fixed_level', 'free', '0', true, false])
  const hydraulics = buildRoiFloodRequest({...coast, confirm:true}, square, tr).hydraulics
  assert.deepEqual(hydraulics.boundary, {north:{type:'free'},east:{type:'free'},south:{type:'fixed_level',level_m:0},west:{type:'free'}})
  assert.equal(hydraulics.initial_condition, 'still_water_at_fixed_level')
  const inland = inlandPreset({...coast, pressure:'990'})
  assert.deepEqual([inland.boundaryNorth, inland.boundaryEast, inland.boundarySouth, inland.boundaryWest, inland.seaLevel, inland.stillWater, inland.pressure, inland.confirm], ['free', 'free', 'free', 'free', '', false, '', false])
  assert.equal(buildRoiFloodRequest({...inland, confirm:true}, square, tr).hydraulics.initial_condition, 'dry_zero_velocity')
})

test('cell estimate follows the domain bounding box and resolution; the study ROI exceeds the 3000-cell default', async () => {
  const { estimateDomainCells, DG2_DEFAULT_MAX_CELLS } = await import('../src/utils/floodDg2.ts')
  assert.equal(DG2_DEFAULT_MAX_CELLS, 3000)
  const cells = estimateDomainCells(filledForm(), square)
  assert.ok(cells >= 1200 && cells <= 1500, `about 36 x 37 cells at 30 m, got ${cells}`)
  assert.ok(estimateDomainCells(filledForm({resolution:'10'}), square) > cells * 8)
  const studyRoi = {type:'Polygon',coordinates:[[[-93.3919,16.6539],[-92.8757,16.6539],[-92.8757,16.8964],[-93.3919,16.8964],[-93.3919,16.6539]]]}
  assert.ok(estimateDomainCells(filledForm(), studyRoi) > 1_000_000)
  // Explicit domain instead of the ROI.
  assert.equal(estimateDomainCells(filledForm({useRoi:false, domain:JSON.stringify(square)}), studyRoi), cells)
  for (const form of [filledForm({resolution:''}), filledForm({resolution:'-5'}), filledForm({useRoi:false, domain:'not json'})]) assert.equal(estimateDomainCells(form, square), null)
  assert.equal(estimateDomainCells(filledForm(), null), null)
})

test('step status marks which panel steps are complete', async () => {
  const { formStepStatus, exampleFormValues } = await import('../src/utils/floodDg2.ts')
  assert.deepEqual(formStepStatus(emptyForm(), square), {zone:false, rain:false, terrain:false, solver:false, confirm:false})
  const ready = {...exampleFormValues(emptyForm(), square), useRoi:true, infiltration:'unsupported', lakes:'none', nonurban:true, confirm:true}
  assert.deepEqual(formStepStatus(ready, square), {zone:true, rain:true, terrain:true, solver:true, confirm:true})
  assert.equal(formStepStatus(ready, null).zone, false)
  assert.equal(formStepStatus({...ready, boundarySouth:'fixed_level', seaLevel:''}, square).terrain, false)
  assert.equal(formStepStatus({...ready, thinDepth:'', thinDepthOff:true}, square).solver, true)
  assert.equal(formStepStatus({...ready, terrainSource:''}, square).terrain, false)
})

test('result summary: flooded area, maximum depth, volumes, Froude, time of concentration and road cuts', async () => {
  const { dg2Summary } = await import('../src/utils/floodDg2.ts')
  const result = {
    grid:{cellsize_m:30},
    frames:[{frame_index:1, scheduled_time_s:60, stats:{max_m:2.2, valid_cells:50, depth_class_cells:[10,6,3,2,1]}}],
    maximum:{stats:{max_m:3.1, valid_cells:50, depth_class_cells:[12,9,5,3,2]}},
    mass_balance:{series:[[20,500,600],[120,1500,2400]]},
    froude:{min_depth_m:.15, frames:[{frame_index:1, cells:20, max:1.4, mean:.6, supercritical_cells:3}]},
    time_of_concentration:{minutes:12.34, flow_length_m:900, slope_m_m:.02, upslope_area_km2:.5, outlet:[0,0]},
    roads:{available:true, total_km:4, thresholds_m:{caution:.15, cut:.3}, maximum:{caution_km:.5, cut_km:1.25}, frames:[{frame_index:1, caution_km:.2, cut_km:.75}]},
  }
  assert.deepEqual(dg2Summary(result, null), {floodedHa:31*900/1e4, floodedPct:62, thinSheetHa:null, maxDepthM:3.1, domainM3:1500, rainM3:2400, froude:null, tcMin:12.34, roads:{cutKm:1.25, cautionKm:.5, totalKm:4}})
  assert.deepEqual(dg2Summary(result, 1), {floodedHa:22*900/1e4, floodedPct:44, thinSheetHa:null, maxDepthM:2.2, domainM3:1500, rainM3:2400, froude:{max:1.4, supercritical:3, cells:20}, tcMin:12.34, roads:{cutKm:.75, cautionKm:.2, totalKm:4}})
  const old = dg2Summary({grid:{cellsize_m:30}, frames:[], maximum:{stats:{max_m:1}}}, null)
  assert.deepEqual(old, {floodedHa:null, floodedPct:null, thinSheetHa:null, maxDepthM:1, domainM3:null, rainM3:null, froude:null, tcMin:null, roads:null})
  assert.equal(dg2Summary({...result, roads:{available:false}}, null).roads, 'unavailable')
})

test('changing a value withdraws the confirmation, but the non-urban declaration beside it does not', async () => {
  const { withFormChange } = await import('../src/utils/floodDg2.ts')
  const confirmed = { amount: '30', nonurban: false, confirm: true }
  assert.equal(withFormChange(confirmed, 'nonurban', true).confirm, true)
  assert.equal(withFormChange(confirmed, 'nonurban', true).nonurban, true)
  assert.equal(withFormChange(confirmed, 'amount', '80').confirm, false)
  assert.equal(withFormChange({ ...confirmed, confirm: false }, 'confirm', true).confirm, true)
  assert.equal(withFormChange(confirmed, 'confirm', false).confirm, false)
})

test('request builder sends the chosen solver; FV1 sends no thin-depth threshold even when one is typed', () => {
  assert.equal(buildRoiFloodRequest(filledForm(), square, tr).simulation.solver, 'dg2')
  for (const thin of [{thinDepth:'0.02',thinDepthOff:false}, {thinDepth:'',thinDepthOff:false}, {thinDepth:'',thinDepthOff:true}]) {
    const simulation = buildRoiFloodRequest(filledForm({solver:'fv1',...thin}), square, tr).simulation
    assert.deepEqual(simulation, {duration_s:900,save_interval_s:300,initial_tstep_s:1,dg2_depth_thresh_m:null,solver:'fv1'})
  }
  for (const solver of ['', 'fv2', undefined]) assert.throws(() => buildRoiFloodRequest(filledForm({solver}), square, tr), /método/)
})

test('example values keep DG2 and the solver step ignores the thin-depth field for FV1', async () => {
  const { exampleFormValues, formStepStatus } = await import('../src/utils/floodDg2.ts')
  assert.equal(exampleFormValues({...emptyForm(), solver:'fv1'}, square).solver, 'dg2')
  const ready = {...exampleFormValues(emptyForm(), square), useRoi:true, infiltration:'unsupported', lakes:'none', nonurban:true, confirm:true}
  assert.equal(formStepStatus({...ready, solver:'fv1', thinDepth:'', thinDepthOff:false}, square).solver, true)
  assert.equal(formStepStatus({...ready, solver:'dg2', thinDepth:'', thinDepthOff:false}, square).solver, false)
  assert.equal(formStepStatus({...ready, solver:''}, square).solver, false)
})

const en = (es, english) => english
test('automatic solver fallback notice names both methods and the reason in plain words', async () => {
  const { solverFallbackNotice } = await import('../src/utils/floodDg2.ts')
  assert.equal(solverFallbackNotice({from:'dg2',to:'fv1',reason:'negative_depth_artifacts'}, tr),
    'Se cambió automáticamente de DG2 a FV1 porque DG2 dejó artefactos numéricos (profundidades negativas). Los resultados mostrados son de FV1.')
  assert.equal(solverFallbackNotice({from:'dg2',to:'fv1',reason:'negative_depth_artifacts'}, en),
    'Switched automatically from DG2 to FV1 because DG2 left numerical artifacts (negative depths). The results shown are from FV1.')
  assert.equal(solverFallbackNotice({from:'fv1',to:'dg2',reason:'solver_timeout'}, tr),
    'Se cambió automáticamente de FV1 a DG2 porque FV1 agotó su tiempo de cálculo. Los resultados mostrados son de DG2.')
  assert.match(solverFallbackNotice({from:'dg2',to:'fv1',reason:'solver_failed'}, tr), /porque DG2 terminó con error/)
  assert.match(solverFallbackNotice({from:'dg2',to:'fv1',reason:'output_invalid'}, en), /because DG2 produced invalid outputs/)
  assert.equal(solverFallbackNotice(null, tr), null)
  assert.equal(solverFallbackNotice(undefined, tr), null)
})

test('a run where both solvers failed lists each attempt and its reason', async () => {
  const { failedAttemptsNotice } = await import('../src/utils/floodDg2.ts')
  const attempts = [{solver:'dg2',outcome:'failed',reason:'negative_depth_artifacts'},{solver:'fv1',outcome:'failed',reason:'output_invalid'}]
  assert.equal(failedAttemptsNotice(attempts, tr), 'Se intentaron los dos métodos: DG2 dejó artefactos numéricos (profundidades negativas); FV1 produjo salidas inválidas.')
  assert.equal(failedAttemptsNotice([attempts[0]], tr), null)
  assert.equal(failedAttemptsNotice(null, tr), null)
})

test('negative-depth artifacts warning only when the volume rule marks the result as artifacts', async () => {
  const { negativeDepthWarning, NEGATIVE_DEPTH_WARNING } = await import('../src/utils/floodDg2.ts')
  assert.equal(NEGATIVE_DEPTH_WARNING, 'artefactos numéricos en terreno muy empinado; profundidades poco confiables, la dirección del flujo sí vale')
  const artifacts = {status:'artifacts', max_added_volume_ratio:.055, clipped_cell_frames:2, frames:[1], min_m:-.033, thresholds:{warning:.01,fail:.1}}
  assert.equal(negativeDepthWarning({negative_depth:artifacts}, tr), `${NEGATIVE_DEPTH_WARNING} (las profundidades negativas puestas en 0 añadieron hasta 5.5 % del agua de un cuadro).`)
  assert.match(negativeDepthWarning({negative_depth:artifacts}, en), /^numerical artifacts on very steep terrain; depths unreliable, the flow direction is still valid/)
  for (const negative_depth of [{...artifacts, status:'minor'}, {...artifacts, status:'none'}, null, undefined]) assert.equal(negativeDepthWarning({negative_depth}, tr), null)
})

// --- Land surface (WorldCover Manning, Curve Number), design storms and urban domains ---------------------------

test('request builder keeps the exact body when the new choices are at their previous behaviour', () => {
  const legacy = buildRoiFloodRequest(filledForm(), square, tr)
  assert.deepEqual(buildRoiFloodRequest(filledForm({rainKind:'synthetic', manningMode:'uniform', moisture:'', returnPeriod:'', stormHours:''}), square, tr), legacy)
})

test('request builder sends WorldCover Manning and Curve Number with antecedent moisture', () => {
  const body = buildRoiFloodRequest(filledForm({manningMode:'worldcover', manning:'', infiltration:'curve_number', moisture:'auto'}), square, tr)
  assert.equal(body.hydraulics.manning, 'worldcover')
  assert.equal(body.hydraulics.infiltration, 'curve_number')
  assert.equal(body.hydraulics.antecedent_moisture, 'auto')
  for (const moisture of ['I', 'II', 'III']) assert.equal(buildRoiFloodRequest(filledForm({infiltration:'curve_number', moisture}), square, tr).hydraulics.antecedent_moisture, moisture)
  assert.throws(() => buildRoiFloodRequest(filledForm({infiltration:'curve_number', moisture:''}), square, tr), /humedad/)
  assert.ok(!('antecedent_moisture' in buildRoiFloodRequest(filledForm({moisture:'auto'}), square, tr).hydraulics))
  assert.throws(() => buildRoiFloodRequest(filledForm({manningMode:'uniform', manning:''}), square, tr), /Manning/)
})

test('request builder sends a design storm with rainfall null; the simulation must cover it', () => {
  const body = buildRoiFloodRequest(filledForm({rainKind:'design_storm', returnPeriod:'10', stormHours:'1', duration:'3600', amount:'', rainDuration:'', seed:'', intervals:''}), square, tr)
  assert.equal(body.rainfall, null)
  assert.deepEqual(body.rainfall_profile, {source:'design_storm', return_period_years:10, duration_h:1, step_s:600})
  assert.throws(() => buildRoiFloodRequest(filledForm({rainKind:'design_storm', returnPeriod:'10', stormHours:'1', duration:'900'}), square, tr), /simulación/)
  for (const returnPeriod of ['', '3', '1']) assert.throws(() => buildRoiFloodRequest(filledForm({rainKind:'design_storm', returnPeriod, stormHours:'1', duration:'3600'}), square, tr), /periodo de retorno/)
  for (const stormHours of ['', '0', '25', '0.05']) assert.throws(() => buildRoiFloodRequest(filledForm({rainKind:'design_storm', returnPeriod:'10', stormHours, duration:'86400'}), square, tr), /Duración de la tormenta/)
})

test('the urban declaration is informational: an urban domain is sent, not refused', () => {
  assert.equal(buildRoiFloodRequest(filledForm({nonurban:false}), square, tr).hydraulics.domain_nonurban, false)
  assert.equal(buildRoiFloodRequest(filledForm({nonurban:true}), square, tr).hydraulics.domain_nonurban, true)
  assert.throws(() => buildRoiFloodRequest(filledForm({confirm:false}), square, tr), /confirma/i)
})

test('example values pick Copernicus, WorldCover Manning and Curve Number with auto moisture, still DG2', async () => {
  const { exampleFormValues, formStepStatus } = await import('../src/utils/floodDg2.ts')
  const filled = exampleFormValues(emptyForm(), square)
  assert.deepEqual([filled.terrainSource, filled.manningMode, filled.infiltration, filled.moisture, filled.solver, filled.rainKind], ['copernicus', 'worldcover', 'curve_number', 'auto', 'dg2', 'design_storm'])
  const ready = {...filled, useRoi:true, lakes:'none', confirm:true}
  assert.deepEqual(formStepStatus(ready, square), {zone:true, rain:true, terrain:true, solver:true, confirm:true})
  const body = buildRoiFloodRequest(ready, square, tr)
  assert.deepEqual([body.hydraulics.manning, body.hydraulics.infiltration, body.hydraulics.antecedent_moisture], ['worldcover', 'curve_number', 'auto'])
  assert.equal(formStepStatus({...ready, rainKind:'design_storm', returnPeriod:'', stormHours:''}, square).rain, false)
  assert.equal(formStepStatus({...ready, rainKind:'design_storm', returnPeriod:'25', stormHours:'2'}, square).rain, true)
  assert.equal(formStepStatus({...ready, infiltration:'curve_number', moisture:''}, square).terrain, false)
})

test('urban warning, land-surface notes, design storm and dataset errors are shown in plain words', async () => {
  const { urbanWarning, URBAN_WARNING, landSurfaceNotes, designStormNote, runErrorMessage, hyetographCaption } = await import('../src/utils/floodDg2.ts')
  assert.equal(URBAN_WARNING, 'zona urbana: edificios y drenaje no representados; profundidades indicativas')
  const land = {manning:'worldcover', manning_value:null, manning_fpfric:.035, infiltration:'curve_number',
    curve_number:{antecedent_moisture:'auto', amc:'III', amc_source:'SMAP L4', mean_runoff_coefficient:.42, gross_rain_mm:30, mean_net_rain_mm:12.6},
    urban:{declared_nonurban:true, built_up_fraction:.31, built_up_cells:12, warning:true}, attribution:['© ESA WorldCover project 2021']}
  assert.equal(urbanWarning({land_surface:land, warnings:[URBAN_WARNING]}, tr), `${URBAN_WARNING} (31 % del dominio construido según ESA WorldCover).`)
  assert.equal(urbanWarning({land_surface:{...land, urban:{declared_nonurban:false, built_up_fraction:null, built_up_cells:null, warning:true}}}, tr), `${URBAN_WARNING} (dominio declarado urbano).`)
  assert.equal(urbanWarning({land_surface:{...land, urban:{...land.urban, warning:false}}}, tr), null)
  assert.equal(urbanWarning({}, tr), null)
  assert.deepEqual(landSurfaceNotes(land, tr), ['Manning por celda (ESA WorldCover); celdas sin dato: n = 0.035',
    'Número de curva (WorldCover + HYSOGs250m), humedad previa AMC III (SMAP L4): 42 % de la lluvia escurre (30 mm → 12.6 mm netos)'])
  assert.deepEqual(landSurfaceNotes({...land, manning:'uniform', manning_value:.05, infiltration:'unsupported', curve_number:null}, tr), ['Manning uniforme n = 0.05'])
  // Runs since the lambda 0.05 default say which initial abstraction they used; older runs say nothing.
  assert.equal(landSurfaceNotes({...land, curve_number:{...land.curve_number, initial_abstraction_ratio:.05}}, tr)[1],
    'Número de curva (WorldCover + HYSOGs250m, Ia = 0.05·S), humedad previa AMC III (SMAP L4): 42 % de la lluvia escurre (30 mm → 12.6 mm netos)')
  assert.deepEqual(landSurfaceNotes(null, tr), [])
  assert.equal(designStormNote({return_period_years:10, duration_s:3600, step_s:600, total_mm:61.24, extrapolated:true, within_stated_accuracy:false, attribution:'PXR v2.1.0 ODbL'}, tr),
    'Tormenta de diseño: periodo de retorno 10 años, 1 h, 61.2 mm (bloques alternos de 10 min, PXR-4). Bloques menores de 1 h extrapolados; fuera del rango de exactitud declarado (2–360 h).')
  assert.equal(designStormNote(null, tr), null)
  assert.match(runErrorMessage('landcover_unavailable', tr), /WorldCover/)
  assert.match(runErrorMessage('soils_unavailable', tr), /HYSOGs/)
  assert.match(runErrorMessage('soil_moisture_unavailable', tr), /humedad del suelo/)
  assert.equal(runErrorMessage('solver_timeout', tr), 'solver_timeout')
  assert.equal(hyetographCaption({land_surface:land, rainfall_source:'design_storm'}, tr), 'Hietograma de la lluvia neta que recibe el solver, media de la ROI (tormenta de diseño, mm/h)')
  assert.equal(hyetographCaption({}, tr), 'Hietograma de la lluvia sintética (mm/h)')
  assert.equal(hyetographCaption({land_surface:{...land, infiltration:'runoff_coefficient'}, rainfall_source:'synthetic'}, tr), 'Hietograma de la lluvia neta que recibe el solver, media de la ROI (sintética, mm/h)')
})

test('tide sides: the builder sends {type:"tide"}, the UTC start time and the optional GEBCO sea floor', async () => {
  const { utcStart } = await import('../src/utils/floodDg2.ts')
  const body = buildRoiFloodRequest(filledForm({boundarySouth:'tide',stillWater:true,startUtc:'2026-10-16T12:00',bathymetry:true,pressure:'1003'}), square, tr)
  assert.deepEqual(body.hydraulics.boundary, {north:{type:'free'},east:{type:'free'},south:{type:'tide'},west:{type:'free'}})
  assert.equal(body.hydraulics.initial_condition, 'still_water_at_fixed_level')
  assert.equal(body.hydraulics.atmospheric_pressure_hpa, 1003)  // the pressure raises the tide too
  assert.equal(body.simulation.start_utc, '2026-10-16T12:00:00Z')
  assert.deepEqual(body.terrain, {target_crs:'EPSG:32615',resolution_m:30,resampling:'nearest',source:'nasadem',bathymetry:'gebco'})
  // GEBCO over a fixed-level sea, without a tide: no start time is sent.
  const fixed = buildRoiFloodRequest(filledForm({boundaryWest:'fixed_level',seaLevel:'0',bathymetry:true,startUtc:'2026-10-16T12:00'}), square, tr)
  assert.equal('start_utc' in fixed.simulation, false)
  assert.equal(fixed.terrain.bathymetry, 'gebco')
  assert.deepEqual(['2026-10-16T12:00:30', '2026-02-30T00:00', '1899-12-31T23:00', '2026-10-16 12:00', ''].map(utcStart),
    ['2026-10-16T12:00:30Z', null, null, null, null])
})

test('tide sides need a start time, cannot share a still-water start with a fixed level, and GEBCO needs a sea side', () => {
  assert.throws(() => buildRoiFloodRequest(filledForm({boundarySouth:'tide'}), square, tr), /Marea: indica el inicio del evento en UTC/)
  assert.throws(() => buildRoiFloodRequest(filledForm({boundarySouth:'tide',boundaryWest:'fixed_level',seaLevel:'0',stillWater:true,startUtc:'2026-10-16T12:00'}), square, tr), /todos los lados de mar deben ser de marea/)
  assert.throws(() => buildRoiFloodRequest(filledForm({bathymetry:true}), square, tr), /GEBCO requiere un lado de mar/)
})

test('step status counts the tide start time and the GEBCO sea side', async () => {
  const { formStepStatus } = await import('../src/utils/floodDg2.ts')
  assert.equal(formStepStatus(filledForm({boundarySouth:'tide'}), square).terrain, false)
  assert.equal(formStepStatus(filledForm({boundarySouth:'tide',startUtc:'2026-10-16T12:00',stillWater:true,bathymetry:true}), square).terrain, true)
  assert.equal(formStepStatus(filledForm({bathymetry:true}), square).terrain, false)
})

test('run notes summarize the tide levels and GEBCO cells, and name their dataset errors', async () => {
  const { tideNote, bathymetryNote, runErrorMessage } = await import('../src/utils/floodDg2.ts')
  const tide = {model:'EOT20',sides:['south'],mdt:'DTUUH22MDT',start_utc:'2026-10-16T12:00:00Z',end_utc:'2026-10-16T12:20:00Z',step_s:600,
    event_time_basis:'simulation_start',point:[-92.4,14.7],node:[-92.375,14.625],mdt_m:.31,datum:'EGM2008',barometric_surge_m:0,
    start_level_m:.512,min_m:.4,max_m:.876,count:3,attribution:['EOT20']}
  assert.equal(tideNote(tide, tr), 'Marea EOT20 en el lado sur, 2026-10-16T12:00:00Z → 2026-10-16T12:20:00Z: nivel de 0.4 a 0.88 m EGM2008 (inicio 0.51 m), nodo oceánico (-92.375, 14.625). Solo marea astronómica: sin marea de tormenta, oleaje ni anomalías.')
  assert.match(tideNote({...tide, min_m:null, max_m:null}, tr), /\(pendiente\)/)
  assert.equal(tideNote(null, tr), null)
  assert.equal(bathymetryNote({source:'gebco',dataset:'GEBCO_2026 Grid',sea_sides:['south','west'],mdt:'DTUUH22MDT',mdt_m:.3,datum:'EGM2008',replaced_cells:42,min_elevation_m:-12.346,attribution:'GEBCO'}, tr),
    'Fondo marino GEBCO_2026 (~450 m) en 42 celdas de mar conectadas a los lados sur, oeste, hasta -12.35 m EGM2008.')
  assert.equal(bathymetryNote(undefined, tr), null)
  assert.match(runErrorMessage('tide_unavailable', tr), /EOT20/)
  assert.match(runErrorMessage('bathymetry_unavailable', tr), /GEBCO_2026/)
})

test('a run where both solvers left negative-depth artifacts is explained in plain words', async () => {
  const { runErrorMessage } = await import('../src/utils/floodDg2.ts')
  const t = (es) => es
  const message = runErrorMessage('negative_depth_artifacts', t)
  assert.notEqual(message, 'negative_depth_artifacts')
  assert.match(message, /Ni DG2 ni FV1/)
})
