import type { FloodDesignStorm, FloodLandSurface, FloodRoiBathymetry, FloodRoiResult, FloodRoiRun, FloodRoiStats, FloodRoiTide, FloodRunProgress, FloodSolverAttempt, FloodSolverFallback, FloodWaterBudget } from '../api/client.ts'
import type { FlowArrowCollection } from '../types/workspace.ts'

/** Raw panel inputs; every physical and numerical value is typed by the user, with no defaults. */
export interface FloodDg2Form {
  domain: string; useRoi: boolean; crs: string; resolution: string; resampling: string; manning: string
  boundaryNorth: string; boundaryEast: string; boundarySouth: string; boundaryWest: string; seaLevel: string; stillWater: boolean
  /** 'unsupported', 'runoff_coefficient' or 'curve_number'; pressure in hPa, empty when not applied. */
  infiltration: string; pressure: string
  /** Antecedent soil moisture for the Curve Number: 'auto' (NISAR SME2 / SMAP L4), 'I', 'II' or 'III'. */
  moisture?: string
  /** 'uniform' (the typed n, previous behaviour when absent) or 'worldcover' (per-cell n from ESA WorldCover). */
  manningMode?: string
  /** 'synthetic' (previous behaviour when absent) or 'design_storm' (PXR-4 return period, alternating blocks). */
  rainKind?: string; returnPeriod?: string; stormHours?: string
  /** 'none' or 'hydrolakes' (HydroLAKES lakes full at start over a dug bed). */
  lakes: string
  /** Declared non-urban domain; informational since urban domains are allowed (with a warning). */
  nonurban: boolean; amount: string; rainDuration: string; seed: string; intervals: string
  duration: string; save: string; tstep: string; thinDepth: string; thinDepthOff: boolean
  /** 'dg2' (more accurate, default) or 'fv1' (stable on steep terrain); the thin-depth threshold only applies to DG2. */
  solver: string
  /** 'copernicus' (Copernicus GLO-30, NISAR_DEM from ASF/Earthdata, recommended) or 'nasadem'; empty until chosen. */
  terrainSource: string
  /** GEBCO_2026 sea floor on the sea cells (`terrain.bathymetry: 'gebco'`); off (previous behaviour) when absent. */
  bathymetry?: boolean
  /** Event start in UTC (`YYYY-MM-DDTHH:MM`, datetime-local read as UTC) for the tide window of tide sides. */
  startUtc?: string
  confirm: boolean
}
type Polygon = { type: 'Polygon'; coordinates: unknown }
type Translate = (es: string, en: string) => string

/** Return periods offered for design storms (years). */
export const RETURN_PERIODS = [2, 5, 10, 25, 50, 100]
/** Block length of the design-storm hyetograph: 10 min (PXR-4 is fitted from 1 h; shorter blocks are flagged extrapolated). */
export const DESIGN_STORM_STEP_S = 600
export const ANTECEDENT_MOISTURE = ['auto', 'I', 'II', 'III']
/** Boundary types per side: wall, FREE, fixed sea level (HFIX) and EOT20 tide (HVAR). */
export const BOUNDARY_TYPES = ['closed', 'free', 'fixed_level', 'tide']
/** `YYYY-MM-DDTHH:MM[:SS]` read as UTC → ISO 8601 with Z, or null; the server accepts 1900–2100. */
export function utcStart(raw: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw?.trim() ?? '')
  if (!match) return null
  const [, y, mo, d, h, mi, se = '00'] = match
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se))
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || +y < 1900 || +y > 2100) return null
  return `${y}-${mo}-${d}T${h}:${mi}:${se}Z`
}
const stormHoursValid = (raw: string | undefined) => {
  const hours = Number(raw)
  return Boolean(raw?.trim()) && Number.isFinite(hours) && hours > 0 && hours <= 24 && Math.abs(hours * 6 - Math.round(hours * 6)) < 1e-9
}

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
  if(!TERRAIN_SOURCES.includes(form.terrainSource))throw Error(t('Selecciona la fuente del terreno (Copernicus GLO-30 o NASADEM).','Select the terrain source (Copernicus GLO-30 or NASADEM).'))
  const sides={north:form.boundaryNorth,east:form.boundaryEast,south:form.boundarySouth,west:form.boundaryWest}
  if(Object.values(sides).some(v=>!BOUNDARY_TYPES.includes(v)))throw Error(t('Selecciona la frontera de cada lado (N, E, S, O).','Select the boundary of each side (N, E, S, W).'))
  const anyFixed=Object.values(sides).includes('fixed_level'), anyTide=Object.values(sides).includes('tide'), anySea=anyFixed||anyTide
  // One sea level for every fixed side (metres over EGM2008, the datum of every height); 0 and negative values are valid.
  const level=Number(form.seaLevel)
  if(anyFixed&&(!form.seaLevel.trim()||!Number.isFinite(level)||Math.abs(level)>10000))throw Error(t('Nivel del mar fijo: indica un número en metros (EGM2008).','Fixed sea level: enter a number in metres (EGM2008).'))
  if(form.stillWater&&!anySea)throw Error(t('El mar lleno al inicio requiere al menos un lado de nivel fijo o de marea.','A still-water start needs at least one fixed-level or tide side.'))
  // The sea starts at the tide level of t = 0, so a still-water start cannot mix tide and fixed-level sides.
  if(form.stillWater&&anyTide&&anyFixed)throw Error(t('Con marea y mar lleno al inicio, todos los lados de mar deben ser de marea.','With tide and a still-water start, every sea side must be a tide side.'))
  // EOT20 tide for the event window [start, start + duration]: the start time is required (synthetic or design rain).
  const start=anyTide?utcStart(form.startUtc):null
  if(anyTide&&!start)throw Error(t('Marea: indica el inicio del evento en UTC (AAAA-MM-DDTHH:MM, 1900–2100).','Tide: enter the event start in UTC (YYYY-MM-DDTHH:MM, 1900–2100).'))
  if(form.bathymetry&&!anySea)throw Error(t('El fondo marino de GEBCO requiere un lado de mar (nivel fijo o marea).','The GEBCO sea floor needs a sea side (fixed level or tide).'))
  if(!['none','hydrolakes'].includes(form.lakes))throw Error(t('Elige si incluir lagos (HydroLAKES).','Choose whether to include lakes (HydroLAKES).'))
  if(!['unsupported','runoff_coefficient','curve_number'].includes(form.infiltration))throw Error(t('Selecciona cómo tratar la infiltración.','Select how to treat infiltration.'))
  const curveNumber=form.infiltration==='curve_number'
  if(curveNumber&&!ANTECEDENT_MOISTURE.includes(form.moisture??''))throw Error(t('Elige la humedad previa del suelo (auto, I, II o III).','Choose the antecedent soil moisture (auto, I, II or III).'))
  const manningMode=form.manningMode||'uniform'
  if(!['uniform','worldcover'].includes(manningMode))throw Error(t('Elige cómo fijar la rugosidad de Manning.','Choose how to set the Manning roughness.'))
  const rainKind=form.rainKind||'synthetic'
  if(!['synthetic','design_storm'].includes(rainKind))throw Error(t('Selecciona el tipo de lluvia.','Select the rain type.'))
  // Inverse barometer (about 1 cm per hPa below 1013.25), as in the terrapulseai_v2.1 simulator; it only raises the fixed sea level.
  const pressure=Number(form.pressure)
  if(form.pressure.trim()&&(!Number.isFinite(pressure)||pressure<950||pressure>1040))throw Error(t('Presión atmosférica: indica entre 950 y 1040 hPa, o déjala vacía.','Atmospheric pressure: enter 950 to 1040 hPa, or leave it empty.'))
  if(form.pressure.trim()&&!anySea)throw Error(t('La presión atmosférica solo eleva un lado de mar (nivel fijo o marea).','Atmospheric pressure only raises a sea side (fixed level or tide).'))
  // A tide side sends only its type: the server uses EOT20 + the DTUUH22MDT mean dynamic topography (EGM2008).
  const boundary=Object.fromEntries(Object.entries(sides).map(([side,type])=>[side,type==='fixed_level'?{type,level_m:level}:{type}]))
  // The urban declaration is informational (urban domains run with a warning); the confirmation is required.
  if(!form.confirm)throw Error(t('Confirma las hipótesis antes de simular.','Confirm the assumptions before simulating.'))
  if(!['dg2','fv1'].includes(form.solver))throw Error(t('Selecciona el método de cálculo (DG2 o FV1).','Select the computation method (DG2 or FV1).'))
  // LISFLOOD-FP `dg2depththresh`: DG2 only; null when the user explicitly disables it or chooses FV1. The API caps it at 1 m.
  const thinDepth=form.solver==='fv1'||form.thinDepthOff?null:positive(form.thinDepth,'Umbral de lámina delgada DG2',1)
  const simulation={duration_s:positive(form.duration,'Duración DG2',86400),save_interval_s:positive(form.save,'Guardado'),initial_tstep_s:positive(form.tstep,'Paso inicial'),dg2_depth_thresh_m:thinDepth,solver:form.solver,...(start?{start_utc:start}:{})}
  let rain
  if(rainKind==='design_storm'){
    // The server computes the depth from PXR-4 at the domain centroid, so `rainfall` is null.
    const period=Number(form.returnPeriod)
    if(!RETURN_PERIODS.includes(period))throw Error(t('Elige el periodo de retorno (2, 5, 10, 25, 50 o 100 años).','Choose the return period (2, 5, 10, 25, 50 or 100 years).'))
    if(!stormHoursValid(form.stormHours))throw Error(t('Duración de la tormenta: indica horas en múltiplos de 10 min, hasta 24 h.','Storm duration: enter hours in multiples of 10 min, up to 24 h.'))
    const hours=Number(form.stormHours)
    if(simulation.duration_s<hours*3600)throw Error(t('La duración de simulación debe cubrir toda la tormenta de diseño.','The simulation duration must cover the whole design storm.'))
    rain={rainfall:null,rainfall_profile:{source:'design_storm',return_period_years:period,duration_h:hours,step_s:DESIGN_STORM_STEP_S}}
  } else {
    const rainDuration=positive(form.rainDuration,'Duración de lluvia')
    if(rainDuration>simulation.duration_s)throw Error(t(`La lluvia (${rainDuration} s) dura más que la simulación (${simulation.duration_s} s): alarga la simulación o acorta la lluvia.`,`The rain (${rainDuration} s) lasts longer than the simulation (${simulation.duration_s} s): lengthen the simulation or shorten the rain.`))
    rain={rainfall:{amount:positive(form.amount,'Lluvia'),unit:'mm',duration:rainDuration,duration_unit:'s'},rainfall_profile:{interval_count:integer(form.intervals,'Intervalos'),seed:integer(form.seed,'Semilla',true),distribution:'uniform_balanced'}}
  }
  // Same frame count as the server (floor(duration / save) + 2), checked before sending against its default limit.
  const frames=Math.floor(simulation.duration_s/simulation.save_interval_s)+2
  if(frames>DG2_DEFAULT_MAX_FRAMES){const minSave=Math.ceil(simulation.duration_s/(DG2_DEFAULT_MAX_FRAMES-2));throw Error(t(`Se guardarían ${frames} cuadros y el servidor admite máximo ${DG2_DEFAULT_MAX_FRAMES}: usa un intervalo de guardado de al menos ${minSave} s o una simulación más corta.`,`${frames} frames would be saved and the server allows at most ${DG2_DEFAULT_MAX_FRAMES}: use a save interval of at least ${minSave} s or a shorter simulation.`))}
  const manning=manningMode==='worldcover'?'worldcover':positive(form.manning,'Manning')
  return {roi,domain,...rain,terrain:{target_crs:form.crs,resolution_m:positive(form.resolution,'Resolución'),resampling:form.resampling,source:form.terrainSource,...(form.bathymetry?{bathymetry:'gebco'}:{})},hydraulics:{manning,initial_condition:form.stillWater?'still_water_at_fixed_level':'dry_zero_velocity',boundary,infiltration:form.infiltration,domain_nonurban:form.nonurban,lakes:form.lakes,...(curveNumber?{antecedent_moisture:form.moisture}:{}),...(form.pressure.trim()?{atmospheric_pressure_hpa:pressure}:{})},simulation}
}

/** Terrain sources of the API (`terrain.source`); heights of both end in EGM2008. */
export const TERRAIN_SOURCES = ['copernicus', 'nasadem']

/** Display name of a terrain source; runs created before the choice used NASADEM. */
export function terrainLabel(source: string | null | undefined) {
  return source === 'copernicus' ? 'Copernicus GLO-30' : 'NASADEM'
}

/** Default `FLOOD_ROI_DG2_MAX_CELLS` of the server (configurable there); about 1 km² at 30 m. */
export const DG2_DEFAULT_MAX_CELLS = 3000
/** Default `FLOOD_ROI_DG2_MAX_FRAMES` of the server: frames = floor(duration / save interval) + 2; up to 121 so the run
 * can be played as a fluid animation. */
export const DG2_DEFAULT_MAX_FRAMES = 121

type Side = 'north' | 'east' | 'south' | 'west'
const SIDE_KEYS: Record<Side, 'boundaryNorth' | 'boundaryEast' | 'boundarySouth' | 'boundaryWest'> = {north:'boundaryNorth',east:'boundaryEast',south:'boundarySouth',west:'boundaryWest'}

function outerRing(polygon: Polygon | null): [number, number][] | null {
  const ring = Array.isArray(polygon?.coordinates) ? (polygon!.coordinates as unknown[])[0] : null
  if(!Array.isArray(ring)||ring.length<3) return null
  const points = ring.filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  return points.length===ring.length ? points : null
}

function parsePolygon(raw: string): Polygon | null {
  try { const parsed=JSON.parse(raw); return parsed?.type==='Polygon'&&Array.isArray(parsed.coordinates)&&Object.keys(parsed).every(k=>['type','coordinates'].includes(k)) ? parsed : null }
  catch { return null }
}

/** WGS 84 / UTM zone EPSG code (326xx north, 327xx south) for a longitude and latitude. */
export function utmEpsgFor(lon: number, lat: number) {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1))
  return `EPSG:${lat >= 0 ? 326 : 327}${String(zone).padStart(2, '0')}`
}

/**
 * Applies one form change. Any value change withdraws the confirmation, so the user confirms the values
 * actually sent; the non-urban declaration sits beside the confirmation and leaves it as it is.
 */
export function withFormChange<F extends { confirm: boolean }>(form: F, name: keyof F & string, value: string | boolean): F {
  const confirm = name === 'confirm' ? value === true : name === 'nonurban' ? form.confirm : false
  return { ...form, [name]: value, confirm }
}

/** Fills the form with illustrative example values (not recommendations) so the user can review and run a
 * test where water visibly accumulates: a 100-year, 3-hour PXR-4 design storm (synthetic fallback: 60 mm in 3 h),
 * simulated one hour longer (14400 s) with a frame every 300 s (49 frames for the animation, server limit 121) and no DG2 thin-depth
 * threshold (the automatic FV1 fallback covers DG2 failures). The domain, lakes, the urban declaration and the
 * confirmation stay the user's; the CRS is the UTM zone of the ROI centre (EPSG:32615, the study area, without a
 * ROI); the terrain is Copernicus GLO-30, Manning comes from ESA WorldCover and losses from the Curve Number with
 * automatic antecedent moisture. */
export function exampleFormValues(form: FloodDg2Form, roi: Polygon | null): FloodDg2Form {
  const ring = outerRing(roi)
  const lons = ring?.map(p => p[0]) ?? [], lats = ring?.map(p => p[1]) ?? []
  const crs = ring ? utmEpsgFor((Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2) : 'EPSG:32615'
  return {...form, crs, resolution:'30', resampling:'nearest', manning:'0.05',
    boundaryNorth:'free', boundaryEast:'free', boundarySouth:'free', boundaryWest:'free', seaLevel:'', stillWater:false, pressure:'',
    amount:'60', rainDuration:'10800', intervals:'18', seed:'7', duration:'14400', save:'300', tstep:'1', thinDepth:'0.02', thinDepthOff:true, solver:'dg2', terrainSource:'copernicus',
    rainKind:'design_storm', returnPeriod:'100', stormHours:'3', manningMode:'worldcover', infiltration:'curve_number', moisture:'auto', confirm:false}
}

/** Coastal scenario: the sea side keeps a fixed level of 0 m (EGM2008) and starts full; the other sides are free. */
export function coastPreset(form: FloodDg2Form, seaSide: Side): FloodDg2Form {
  const sides = Object.fromEntries((Object.keys(SIDE_KEYS) as Side[]).map(side => [SIDE_KEYS[side], side === seaSide ? 'fixed_level' : 'free']))
  return {...form, ...sides, seaLevel:'0', stillWater:true, confirm:false}
}

/** Inland scenario: water may leave through every side (FREE); no sea level, still water or pressure. */
export function inlandPreset(form: FloodDg2Form): FloodDg2Form {
  return {...form, boundaryNorth:'free', boundaryEast:'free', boundarySouth:'free', boundaryWest:'free', seaLevel:'', stillWater:false, pressure:'', confirm:false}
}

/** Approximate DEM cells (bounding box of the domain / resolution², local metres per degree), as the server
 * counts them on the projected bounding box; null when the domain or the resolution is not valid yet. */
export function estimateDomainCells(form: FloodDg2Form, roi: Polygon | null): number | null {
  if(!roi) return null
  const ring = outerRing(form.useRoi ? roi : parsePolygon(form.domain))
  const resolution = Number(form.resolution)
  if(!ring || !form.resolution.trim() || !Number.isFinite(resolution) || resolution <= 0) return null
  const lons = ring.map(p => p[0]), lats = ring.map(p => p[1])
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2 * Math.PI / 180
  const width = (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos(midLat)
  const height = (Math.max(...lats) - Math.min(...lats)) * 110574
  return Math.ceil(width / resolution) * Math.ceil(height / resolution)
}

/** Which steps of the panel look complete (display only; buildRoiFloodRequest still validates everything). */
export function formStepStatus(form: FloodDg2Form, roi: Polygon | null) {
  const num = (raw: string) => raw.trim() ? Number(raw) : NaN
  const positive = (raw: string, max = Infinity) => num(raw) > 0 && num(raw) <= max
  const integer = (raw: string, min: number) => Number.isSafeInteger(num(raw)) && num(raw) >= min
  const sides = [form.boundaryNorth, form.boundaryEast, form.boundarySouth, form.boundaryWest]
  const anyFixed = sides.includes('fixed_level'), anyTide = sides.includes('tide'), anySea = anyFixed || anyTide
  const pressure = num(form.pressure)
  return {
    zone: Boolean(roi) && (form.useRoi || parsePolygon(form.domain) !== null),
    rain: (form.rainKind || 'synthetic') === 'design_storm'
      ? RETURN_PERIODS.includes(num(form.returnPeriod ?? '')) && stormHoursValid(form.stormHours)
      : positive(form.amount) && positive(form.rainDuration) && integer(form.intervals, 1) && integer(form.seed, 0),
    terrain: TERRAIN_SOURCES.includes(form.terrainSource) && /^EPSG:\d+$/.test(form.crs) && positive(form.resolution) && ['nearest','bilinear'].includes(form.resampling)
      && (form.manningMode === 'worldcover' || positive(form.manning))
      && sides.every(v => BOUNDARY_TYPES.includes(v)) && (!anyFixed || Number.isFinite(num(form.seaLevel)))
      && (!form.stillWater || (anySea && !(anyTide && anyFixed))) && ['unsupported','runoff_coefficient','curve_number'].includes(form.infiltration) && ['none','hydrolakes'].includes(form.lakes)
      && (form.infiltration !== 'curve_number' || ANTECEDENT_MOISTURE.includes(form.moisture ?? ''))
      && (!anyTide || utcStart(form.startUtc) !== null) && (!form.bathymetry || anySea)
      && (!form.pressure.trim() || (anySea && pressure >= 950 && pressure <= 1040)),
    solver: positive(form.duration, 86400) && positive(form.save) && positive(form.tstep) && ['dg2','fv1'].includes(form.solver)
      && (form.solver === 'fv1' || form.thinDepthOff || positive(form.thinDepth, 1)),
    confirm: form.confirm,
  }
}

/** Lower bound (m) from which a cell counts as flooded; the thinner classes (0.0005–0.002 m wet surface, 0.002–0.01 m
 * runoff and 0.01–0.03 m thin sheet in new runs) are sheets of water. */
export const FLOODED_MIN_DEPTH_M = .03

/** Cells of the classes at or above FLOODED_MIN_DEPTH_M and of the thinner classes, using the run's own bounds
 * (`depth_classes_m`; runs without it predate the sheet classes, so every class counts as flooded). */
function splitDepthCells(stats: FloodRoiStats | undefined, bounds: number[] | null | undefined) {
  if(!Array.isArray(stats?.depth_class_cells)) return null
  const cells = stats.depth_class_cells as number[]
  const thin = (i: number) => Array.isArray(bounds) && bounds[i] != null && bounds[i] < FLOODED_MIN_DEPTH_M
  const sum = (keep: (i: number) => boolean) => cells.reduce((a, n, i) => keep(i) ? a + n : a, 0)
  return {flooded: sum(i => !thin(i)), thin: cells.some((_, i) => thin(i)) ? sum(thin) : null}
}

/** Headline numbers of the selected frame (or the maximum when `frameIndex` is null) for the result cards.
 * Flooded area counts the depth classes from 0.03 m, as the area chart does; `thinSheetHa` adds the classes below
 * 0.03 m (0.0005–0.03 m in new runs, 0.002–0.03 m or 0.01–0.03 m in earlier ones; null for runs without them); null
 * where older runs lack inputs. */
export function dg2Summary(result: Pick<FloodRoiResult, 'frames' | 'maximum' | 'grid' | 'mass_balance' | 'froude' | 'time_of_concentration' | 'roads'> & Partial<Pick<FloodRoiResult, 'depth_classes_m'>>, frameIndex: number | null | undefined) {
  const stats = frameIndex == null ? result.maximum.stats : result.frames.find(f => f.frame_index === frameIndex)?.stats
  const split = splitDepthCells(stats, result.depth_classes_m)
  const classes = split ? split.flooded : null
  const cellsize = result.grid?.cellsize_m
  const valid = Number(stats?.valid_cells)
  const max = Number(stats?.max_m)
  const last = result.mass_balance?.series?.at(-1)
  const fr = frameIndex == null ? undefined : result.froude?.frames.find(f => f.frame_index === frameIndex)
  const roads = result.roads
  const exposure = roads?.available ? (frameIndex == null ? roads.maximum : roads.frames?.find(f => f.frame_index === frameIndex)) : null
  return {
    floodedHa: classes != null && cellsize ? classes * cellsize ** 2 / 1e4 : null,
    floodedPct: classes != null && valid > 0 ? classes * 100 / valid : null,
    thinSheetHa: split?.thin != null && cellsize ? split.thin * cellsize ** 2 / 1e4 : null,
    maxDepthM: stats?.max_m != null && Number.isFinite(max) ? max : null,
    domainM3: last ? last[1] : null,
    rainM3: last ? last[2] : null,
    froude: fr ? {max: fr.max, supercritical: fr.supercritical_cells, cells: fr.cells} : null,
    tcMin: result.time_of_concentration?.minutes ?? null,
    roads: !roads ? null : !roads.available ? 'unavailable' as const : {cutKm: exposure?.cut_km ?? 0, cautionKm: exposure?.caution_km ?? 0, totalKm: roads.total_km ?? 0},
  }
}

/** Display name of a LISFLOOD-FP solver keyword. */
export function solverLabel(solver: string | null | undefined) {
  return solver === 'fv1' ? 'FV1' : solver === 'dg2' ? 'DG2' : '—'
}

/** Plain-language reason why one solver attempt failed (public reason codes of the ROI worker). */
function attemptReason(solver: string, reason: string | null | undefined, t: Translate) {
  const name = solverLabel(solver)
  switch (reason) {
    case 'negative_depth_artifacts': return t(`${name} dejó artefactos numéricos (profundidades negativas)`, `${name} left numerical artifacts (negative depths)`)
    case 'solver_timeout': return t(`${name} agotó su tiempo de cálculo`, `${name} ran out of computation time`)
    case 'solver_failed': return t(`${name} terminó con error`, `${name} ended with an error`)
    case 'output_invalid': return t(`${name} produjo salidas inválidas`, `${name} produced invalid outputs`)
    default: return t(`${name} falló`, `${name} failed`)
  }
}

/** Notice shown with the results when the server switched solver automatically; null without a fallback. */
export function solverFallbackNotice(fallback: FloodSolverFallback | null | undefined, t: Translate) {
  if (!fallback) return null
  const from = solverLabel(fallback.from), to = solverLabel(fallback.to)
  return t(`Se cambió automáticamente de ${from} a ${to} porque ${attemptReason(fallback.from, fallback.reason, t)}. Los resultados mostrados son de ${to}.`,
    `Switched automatically from ${from} to ${to} because ${attemptReason(fallback.from, fallback.reason, t)}. The results shown are from ${to}.`)
}

/** For a failed run: both attempts and their reasons; null unless both solvers were tried. */
export function failedAttemptsNotice(attempts: FloodSolverAttempt[] | null | undefined, t: Translate) {
  if (!attempts || attempts.length < 2) return null
  const parts = attempts.map(a => attemptReason(a.solver, a.reason, t)).join('; ')
  return t(`Se intentaron los dos métodos: ${parts}.`, `Both methods were tried: ${parts}.`)
}

/** Server warning (verbatim) when negative depths set to 0 add 1–10 % of the water of a frame. */
export const NEGATIVE_DEPTH_WARNING = 'artefactos numéricos en terreno muy empinado; profundidades poco confiables, la dirección del flujo sí vale'

/** Visible warning for results whose negative depths reached the 'artifacts' status; null otherwise. */
export function negativeDepthWarning(result: Pick<FloodRoiResult, 'negative_depth'>, t: Translate) {
  const negative = result.negative_depth
  if (negative?.status !== 'artifacts') return null
  const pct = negative.max_added_volume_ratio == null ? '—' : String(Math.round(negative.max_added_volume_ratio * 1000) / 10)
  return t(`${NEGATIVE_DEPTH_WARNING} (las profundidades negativas puestas en 0 añadieron hasta ${pct} % del agua de un cuadro).`,
    `numerical artifacts on very steep terrain; depths unreliable, the flow direction is still valid (negative depths set to 0 added up to ${pct} % of the water of a frame).`)
}

/** Server warning (verbatim) for domains with built-up land (ESA WorldCover) or declared urban. */
export const URBAN_WARNING = 'zona urbana: edificios y drenaje no representados; profundidades indicativas'

const pct = (ratio: number) => String(Math.round(ratio * 100))
const mm = (value: number) => String(Math.round(value * 10) / 10)

/** Visible urban warning with the built-up share of the domain (or the user's declaration); null otherwise. */
export function urbanWarning(result: Pick<FloodRoiResult, 'land_surface' | 'warnings'>, t: Translate) {
  const urban = result.land_surface?.urban
  if (!urban?.warning && !result.warnings?.includes(URBAN_WARNING)) return null
  if (urban?.built_up_fraction != null && (urban.built_up_cells ?? 0) + urban.built_up_fraction > 0) {
    return t(`${URBAN_WARNING} (${pct(urban.built_up_fraction)} % del dominio construido según ESA WorldCover).`,
      `urban area: buildings and drainage not represented; indicative depths (${pct(urban.built_up_fraction)} % of the domain built-up according to ESA WorldCover).`)
  }
  return t(`${URBAN_WARNING} (dominio declarado urbano).`, 'urban area: buildings and drainage not represented; indicative depths (domain declared urban).')
}

/** One line per land-surface choice of a run: Manning and, with the Curve Number, the moisture and losses. */
export function landSurfaceNotes(land: FloodLandSurface | null | undefined, t: Translate) {
  if (!land) return []
  const notes = [land.manning === 'worldcover'
    ? t(`Manning por celda (ESA WorldCover); celdas sin dato: n = ${land.manning_fpfric ?? '—'}`, `Per-cell Manning (ESA WorldCover); cells without data: n = ${land.manning_fpfric ?? '—'}`)
    : t(`Manning uniforme n = ${land.manning_value}`, `Uniform Manning n = ${land.manning_value}`)]
  const cn = land.curve_number
  if (land.infiltration === 'curve_number' && cn) {
    const source = cn.amc_source === 'request' ? t('elegida', 'chosen') : cn.amc_source ?? t('sin observación: AMC II supuesta', 'no observation: AMC II assumed')
    const amc = cn.amc ? `AMC ${cn.amc} (${source})` : t('pendiente', 'pending')
    const losses = cn.mean_runoff_coefficient == null || cn.gross_rain_mm == null || cn.mean_net_rain_mm == null ? ''
      : t(`: ${pct(cn.mean_runoff_coefficient)} % de la lluvia escurre (${mm(cn.gross_rain_mm)} mm → ${mm(cn.mean_net_rain_mm)} mm netos)`,
        `: ${pct(cn.mean_runoff_coefficient)} % of the rain runs off (${mm(cn.gross_rain_mm)} mm → ${mm(cn.mean_net_rain_mm)} mm net)`)
    // Initial abstraction ratio (0.05 with the Hawkins et al. 2002 retention conversion); absent in older runs.
    const lambda = (cn as {initial_abstraction_ratio?: number | null}).initial_abstraction_ratio
    const ia = lambda == null ? '' : `, Ia = ${lambda}·S`
    notes.push(t(`Número de curva (WorldCover + HYSOGs250m${ia}), humedad previa ${amc}${losses}`, `Curve Number (WorldCover + HYSOGs250m${ia}), antecedent moisture ${amc}${losses}`))
  }
  return notes
}

/** Design-storm summary (return period, duration, depth and range flags); null for other rain. */
export function designStormNote(storm: FloodDesignStorm | null | undefined, t: Translate) {
  if (!storm) return null
  const hours = String(Math.round(storm.duration_s / 3600 * 100) / 100), minutes = String(Math.round(storm.step_s / 60 * 10) / 10)
  let note = t(`Tormenta de diseño: periodo de retorno ${storm.return_period_years} años, ${hours} h, ${mm(storm.total_mm)} mm (bloques alternos de ${minutes} min, PXR-4).`,
    `Design storm: ${storm.return_period_years}-year return period, ${hours} h, ${mm(storm.total_mm)} mm (alternating blocks of ${minutes} min, PXR-4).`)
  if (storm.extrapolated) note += t(' Bloques menores de 1 h extrapolados;', ' Blocks shorter than 1 h extrapolated;')
  if (!storm.within_stated_accuracy) note += storm.extrapolated ? t(' fuera del rango de exactitud declarado (2–360 h).', ' outside the stated accuracy range (2–360 h).')
    : t(' Fuera del rango de exactitud declarado (2–360 h).', ' Outside the stated accuracy range (2–360 h).')
  return note
}

const metres = (value: number) => String(Math.round(value * 100) / 100)
const sideNames = (sides: string[], t: Translate) => sides.map(side => ({north: t('norte', 'north'), east: t('este', 'east'), south: t('sur', 'south'), west: t('oeste', 'west')} as Record<string, string>)[side] ?? side).join(', ')
/** "el lado sur" / "los lados sur, oeste" and "the south side" / "the south, west sides". */
const sidePhrase = (sides: string[], t: Translate) => sides.length > 1
  ? t(`los lados ${sideNames(sides, t)}`, `the ${sideNames(sides, t)} sides`) : t(`el lado ${sideNames(sides, t)}`, `the ${sideNames(sides, t)} side`)

/** Tide line of a run: sides, window and the levels the solver received (after preparation); null without tide sides. */
export function tideNote(tide: FloodRoiTide | null | undefined, t: Translate) {
  if (!tide) return null
  const where = sidePhrase(tide.sides, t)
  const window = `${tide.start_utc} → ${tide.end_utc}`
  if (tide.min_m == null || tide.max_m == null) return t(`Marea EOT20 en ${where}, ${window} (pendiente).`, `EOT20 tide on ${where}, ${window} (pending).`)
  const node = tide.node ? ` (${tide.node[0].toFixed(3)}, ${tide.node[1].toFixed(3)})` : ''
  return t(`Marea EOT20 en ${where}, ${window}: nivel de ${metres(tide.min_m)} a ${metres(tide.max_m)} m EGM2008 (inicio ${metres(tide.start_level_m ?? tide.min_m)} m), nodo oceánico${node}. Solo marea astronómica: sin marea de tormenta, oleaje ni anomalías.`,
    `EOT20 tide on ${where}, ${window}: level from ${metres(tide.min_m)} to ${metres(tide.max_m)} m EGM2008 (start ${metres(tide.start_level_m ?? tide.min_m)} m), ocean node${node}. Astronomical tide only: no storm surge, waves or anomalies.`)
}

/** GEBCO sea-floor line of a run; null when not requested. */
export function bathymetryNote(bathymetry: FloodRoiBathymetry | null | undefined, t: Translate) {
  if (!bathymetry) return null
  if (bathymetry.replaced_cells == null) return t('Fondo marino GEBCO_2026 en las celdas de mar (pendiente).', 'GEBCO_2026 sea floor on the sea cells (pending).')
  return t(`Fondo marino GEBCO_2026 (~450 m) en ${bathymetry.replaced_cells} celdas de mar conectadas a ${sidePhrase(bathymetry.sea_sides, t)}${bathymetry.min_elevation_m != null ? `, hasta ${metres(bathymetry.min_elevation_m)} m EGM2008` : ''}.`,
    `GEBCO_2026 sea floor (~450 m) on ${bathymetry.replaced_cells} sea cells connected to ${sidePhrase(bathymetry.sea_sides, t)}${bathymetry.min_elevation_m != null ? `, down to ${metres(bathymetry.min_elevation_m)} m EGM2008` : ''}.`)
}

/** Plain-language text for the dataset error codes of a failed run; other codes are shown as they are. */
export function runErrorMessage(code: string | null | undefined, t: Translate) {
  switch (code) {
    case 'landcover_unavailable': return t('No se pudo leer la cobertura del suelo (ESA WorldCover); no se usó un valor uniforme en su lugar.', 'Land cover (ESA WorldCover) could not be read; no uniform value was used instead.')
    case 'soils_unavailable': return t('No se pudieron leer los grupos de suelo (HYSOGs250m, NASA Earthdata).', 'Soil groups (HYSOGs250m, NASA Earthdata) could not be read.')
    case 'soil_moisture_unavailable': return t('No se pudo consultar la humedad del suelo (NISAR SME2 / SMAP L4); elige la humedad previa I, II o III.', 'Soil moisture (NISAR SME2 / SMAP L4) could not be queried; choose antecedent moisture I, II or III.')
    case 'tide_unavailable': return t('No se pudo calcular la marea (EOT20 / DTUUH22MDT no instalados en el servidor o sin océano a menos de 10 km del lado de marea).', 'The tide could not be computed (EOT20 / DTUUH22MDT not installed on the server, or no ocean within 10 km of the tide side).')
    case 'bathymetry_unavailable': return t('No se pudo leer el fondo marino (GEBCO_2026).', 'The sea floor (GEBCO_2026) could not be read.')
    case 'negative_depth_artifacts': return t('Ni DG2 ni FV1 dieron un resultado confiable: los dos dejaron profundidades negativas que suman más del 10 % del agua. Prueba celdas más grandes, una zona menos empinada o menos lluvia.', 'Neither DG2 nor FV1 gave a reliable result: both left negative depths adding up to more than 10 % of the water. Try larger cells, a less steep area or less rain.')
    default: return code ?? ''
  }
}

/** Caption of the hyetograph: the net rain the solver received when losses are modelled. */
export function hyetographCaption(result: Pick<FloodRoiResult, 'land_surface' | 'rainfall_source'>, t: Translate) {
  const source = result.rainfall_source
  const kind = source === 'design_storm' ? t('tormenta de diseño', 'design storm') : source === 'observed' ? t('observada', 'observed') : t('sintética', 'synthetic')
  if (['curve_number', 'runoff_coefficient'].includes(result.land_surface?.infiltration ?? '')) {
    return t(`Hietograma de la lluvia neta que recibe el solver, media de la ROI (${kind}, mm/h)`, `Hyetograph of the net rain the solver receives, ROI mean (${kind}, mm/h)`)
  }
  if (source === 'design_storm') return t('Hietograma de la tormenta de diseño (mm/h)', 'Design-storm hyetograph (mm/h)')
  if (source === 'observed') return t('Hietograma de la lluvia observada (mm/h)', 'Observed rainfall hyetograph (mm/h)')
  return t('Hietograma de la lluvia sintética (mm/h)', 'Synthetic rainfall hyetograph (mm/h)')
}

/** Solver-velocity arrows of one frame as GeoJSON; null for the maximum or runs without velocities. */
export function flowArrowFeatures(result: Pick<FloodRoiResult, 'flow'>, frameIndex: number | null | undefined): FlowArrowCollection | null {
  if(frameIndex==null) return null
  const frame=result.flow?.frames.find(f=>f.frame_index===frameIndex)
  if(!frame) return null
  return {type:'FeatureCollection',features:frame.arrows.map(([lon,lat,speed,bearing])=>({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{speed,bearing}}))}
}

/** Depth classes of the preview PNG. Kept in sync with _DEPTH_CLASSES and _DEPTH_CLASS_ALPHA in
 * backend/analyses/roi_flood_runs.py by a test. Below 0.0005 m the image is transparent. Sheets thinner than 3 cm are
 * semi-transparent cyan (`alpha` 0–1), more opaque the thicker they are: the 0.0005–0.002 m wet surface the rain leaves
 * over most of the area, the 0.002–0.01 m runoff sheet and the 0.01–0.03 m thin sheet. Ponded water (≥ 0.03 m, the
 * flooded area) is opaque ColorBrewer Blues, light to dark, so it stays stronger than any sheet on a satellite map. */
export const DEPTH_CLASSES: ReadonlyArray<{min: number; max: number | null; rgb: [number, number, number]; alpha?: number}> = [
  {min:.0005,max:.002,rgb:[103,232,249],alpha:115/255},
  {min:.002,max:.01,rgb:[34,211,238],alpha:165/255},
  {min:.01,max:.03,rgb:[6,182,212],alpha:210/255},
  {min:.03,max:.15,rgb:[107,174,214]},
  {min:.15,max:.5,rgb:[66,146,198]},
  {min:.5,max:1,rgb:[33,113,181]},
  {min:1,max:2,rgb:[8,81,156]},
  {min:2,max:null,rgb:[8,48,107]},
]

/** File name for the depth preview PNG of an artifact such as `roi-0001.wd.tif`. */
export function pngDownloadName(artifactName: string) {
  return artifactName.replace(/\.tif$/,'')+'.png'
}

const minutesLabel = (seconds: number) => String(Math.round(seconds / 60 * 100) / 100)

/** CSS colour of a depth class of the palette: rgb, or rgba with two decimals for the semi-transparent ones. */
export function depthClassColor(c: {rgb: [number, number, number]; alpha?: number}) {
  return c.alpha == null ? `rgb(${c.rgb.join(',')})` : `rgba(${c.rgb.join(',')},${Math.round(c.alpha * 100) / 100})`
}

/** Data for the DG2 charts; each part is null when the run lacks its inputs (older runs).
 * `frameIndex` null selects the maximum for the depth distribution. `hyetographGross` is the gross rain per interval
 * when it differs from the net rain the solver received; `frameVolumes` the sheet (< 0.03 m) and ponded water of
 * each frame (m³). */
export function dg2ChartData(result: Pick<FloodRoiResult, 'frames' | 'maximum' | 'grid' | 'depth_classes_m' | 'rainfall_segments' | 'mass_balance'> & Partial<Pick<FloodRoiResult, 'rainfall_gross_segments'>>, frameIndex: number | null | undefined) {
  const cellArea = (result.grid?.cellsize_m ?? 0) ** 2
  const classes = (stats: FloodRoiStats | undefined) => Array.isArray(stats?.depth_class_cells) ? stats.depth_class_cells as number[] : null
  const segments = result.rainfall_segments
  const hyetograph = segments?.length ? {labels: segments.map(s => `${minutesLabel(s.start_s)}–${minutesLabel(s.end_s)}`), mmPerHour: segments.map(s => s.intensity_mm_h)} : null
  const gross = result.rainfall_gross_segments
  const hyetographGross = segments?.length && gross?.length === segments.length
    && gross.every((g, i) => g.start_s === segments[i].start_s && g.end_s === segments[i].end_s)
    && gross.some((g, i) => Math.abs(g.intensity_mm_h - segments[i].intensity_mm_h) > 1e-9) ? gross.map(g => g.intensity_mm_h) : null
  const counted = result.frames.every(f => classes(f.stats))
  const splits = counted ? result.frames.map(f => splitDepthCells(f.stats, result.depth_classes_m)!) : []
  const evolution = counted && cellArea ? {
    minutes: result.frames.map(f => (f.scheduled_time_s ?? 0) / 60),
    wetAreaHa: splits.map(split => split.flooded * cellArea / 1e4),
    // Area of the sheet classes (below 0.03 m) over time; null for runs without them.
    sheetAreaHa: splits.every(split => split.thin != null) && splits.length ? splits.map(split => split.thin! * cellArea / 1e4) : null,
    maxDepthM: result.frames.map(f => Number(f.stats.max_m ?? 0)),
  } : null
  const volumed = result.frames.length > 0 && result.frames.every(f => typeof f.stats.sheet_volume_m3 === 'number' && typeof f.stats.ponded_volume_m3 === 'number')
  const frameVolumes = volumed ? {
    minutes: result.frames.map(f => (f.scheduled_time_s ?? 0) / 60),
    sheetM3: result.frames.map(f => f.stats.sheet_volume_m3 as number),
    pondedM3: result.frames.map(f => f.stats.ponded_volume_m3 as number),
  } : null
  const series = result.mass_balance?.series
  const volume = series?.length ? {minutes: series.map(r => r[0] / 60), domainM3: series.map(r => r[1]), rainM3: series.map(r => r[2])} : null
  const stats = frameIndex == null ? result.maximum.stats : result.frames.find(f => f.frame_index === frameIndex)?.stats
  const cells = classes(stats)
  const bounds = result.depth_classes_m
  const distribution = cells && bounds && cellArea ? {
    labels: bounds.map((low, i) => i + 1 < bounds.length ? `${low}–${bounds[i + 1]}` : `≥ ${low}`),
    areaHa: cells.map(n => n * cellArea / 1e4),
    // Colour of each of the run's own classes (older runs start at 0.03 m); grey for a bound the palette lacks.
    colors: bounds.map(low => {const c = DEPTH_CLASSES.find(d => d.min === low); return c ? depthClassColor(c) : 'rgb(148,163,184)'}),
  } : null
  return {hyetograph, hyetographGross, evolution, volume, frameVolumes, distribution}
}

/** Simulated time of a frame as hh:mm (hh:mm:ss when it is not a whole minute); '—' without a time. */
export function simulatedTimeLabel(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const total = Math.max(0, Math.round(seconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  const rest = total % 60
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total % 3600 / 60))}${rest ? `:${pad(rest)}` : ''}`
}

/** Animation speeds; 1× shows PLAYBACK_BASE_FPS frames per second whatever the save interval of the run. */
export const PLAYBACK_SPEEDS = [.5, 1, 2, 4]
export const PLAYBACK_BASE_FPS = 2
/** Time on screen of each frame (ms) at a speed. */
export function playbackIntervalMs(speed: number) { return 1000 / (PLAYBACK_BASE_FPS * speed) }
/** Cross-fade between two frames: 80 % of the frame interval, at most 600 ms; none with reduced motion. */
export function playbackFadeMs(speed: number, reducedMotion: boolean) { return reducedMotion ? 0 : Math.round(Math.min(600, .8 * playbackIntervalMs(speed))) }

export interface PlaybackState { index: number; playing: boolean; loop: boolean }
/** One timer tick: the next frame; at the last one, back to the first with `loop` or stop. Paused: unchanged. */
export function playbackStep(state: PlaybackState, count: number): PlaybackState {
  if (!state.playing) return state
  if (state.index + 1 < count) return {...state, index: state.index + 1}
  if (state.loop && count > 1) return {...state, index: 0}
  return {...state, index: Math.max(0, count - 1), playing: false}
}

type Segment = {start_s: number; end_s: number; intensity_mm_h: number}
/** Rain intensity (mm/h) of the interval containing `seconds` ([start, end)); 0 outside the rain, null without segments. */
export function rainIntensityAt(segments: Segment[] | null | undefined, seconds: number) {
  if (!segments?.length) return null
  return segments.find(s => s.start_s <= seconds && seconds < s.end_s)?.intensity_mm_h ?? 0
}

/** Strength of the rain drawn on the map for a gross intensity, growing with mm/h and saturating at 100 mm/h: drops per
 * 10 000 px² of the rained area, a fall-speed factor and the opacity of the rain-curtain tint over the domain; null
 * when it does not rain. Illustrative, not a radar picture. */
export function rainEffect(mmPerHour: number | null | undefined) {
  if (mmPerHour == null || !Number.isFinite(mmPerHour) || mmPerHour <= 0) return null
  const strength = Math.min(1, Math.sqrt(mmPerHour / 100))
  return {density: Math.round((4 + 16 * strength) * 10) / 10, speed: .8 + .7 * Math.min(1, mmPerHour / 100), tint: Math.round((.1 + .14 * strength) * 100) / 100}
}

/** Drops drawn on a rained box of `width` × `height` px: `density` per 10 000 px², at least 12 and at most 1500. */
export function rainDrops(density: number, width: number, height: number) {
  return Math.min(1500, Math.max(12, Math.round(density * Math.max(0, width) * Math.max(0, height) / 1e4)))
}

/** Gross rain (mm) fallen from the start of the hyetograph to `seconds`, and in the whole storm; null without segments. */
export function rainAccumulatedAt(segments: Segment[] | null | undefined, seconds: number) {
  if (!segments?.length || !Number.isFinite(seconds)) return null
  const fallen = (until: number) => segments.reduce((sum, s) => sum + s.intensity_mm_h * Math.max(0, Math.min(until, s.end_s) - s.start_s) / 3600, 0)
  return {mm: fallen(seconds), totalMm: fallen(Infinity)}
}

/** Rain of a run in progress from its status: gross mm/h at the simulated time, and the rain fallen so far and in the
 * whole storm (mm); servers that predate the last two omit them (null). */
export function liveRain(progress: Pick<FloodRunProgress, 'rain_mm_h' | 'rain_accumulated_mm' | 'rain_total_mm'> | null | undefined) {
  const finite = (v: number | null | undefined) => v != null && Number.isFinite(v) ? v : null
  return {mmPerHour: finite(progress?.rain_mm_h), soFarMm: finite(progress?.rain_accumulated_mm), totalMm: finite(progress?.rain_total_mm)}
}

/** Box of the map (px) where the rain is drawn: the domain corners projected on the map, clamped to the map size, with
 * a clip path (relative to the box) that follows the corners. null without corners (the rain covers the whole map);
 * 'offscreen' when the domain is outside the map view. */
export function rainAreaBox(points: ReadonlyArray<readonly [number, number]> | null | undefined, width: number, height: number) {
  if (!points || points.length < 3 || points.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const left = Math.max(0, Math.min(...xs)), top = Math.max(0, Math.min(...ys))
  const right = Math.min(width, Math.max(...xs)), bottom = Math.min(height, Math.max(...ys))
  if (!(right - left >= 1 && bottom - top >= 1)) return 'offscreen' as const
  const px = (v: number) => `${Math.round(v * 10) / 10}px`
  return {left, top, width: right - left, height: bottom - top, clipPath: `polygon(${points.map(([x, y]) => `${px(x - left)} ${px(y - top)}`).join(', ')})`}
}

/** Where the rain badge goes (px, its centre and top): centred just above the rained box, or inside its top edge when
 * there is no room above, with the centre kept 170 px off the map edges; null without a box on screen (the badge then
 * keeps its default place at the bottom of the map). */
export function rainBadgePosition(box: ReturnType<typeof rainAreaBox>, mapWidth: number) {
  if (!box || box === 'offscreen') return null
  const centre = box.left + box.width / 2
  const left = mapWidth >= 340 ? Math.min(Math.max(centre, 170), mapWidth - 170) : centre
  return {left: Math.round(left), top: Math.round(box.top >= 42 ? box.top - 34 : box.top + 8)}
}

/** Text of the rain badge on the map: gross intensity and, when known, the rain fallen so far of the whole storm
 * (amounts below 10 mm with one decimal, larger ones rounded). */
export function rainBadgeText(rain: {mmPerHour: number; soFarMm?: number | null; totalMm?: number | null}, t: Translate, locale?: string) {
  const rate = rain.mmPerHour.toLocaleString(locale, {maximumFractionDigits: 1})
  const amount = (mm: number) => mm.toLocaleString(locale, {maximumFractionDigits: Math.abs(mm) < 10 ? 1 : 0})
  if (rain.soFarMm == null || rain.totalMm == null) return t(`Lloviendo ${rate} mm/h`, `Raining ${rate} mm/h`)
  return t(`Lloviendo ${rate} mm/h · acumulado ${amount(rain.soFarMm)} mm de ${amount(rain.totalMm)} mm`,
    `Raining ${rate} mm/h · ${amount(rain.soFarMm)} mm of ${amount(rain.totalMm)} mm so far`)
}

/** Rain fallen so far of the whole storm for a text next to the intensity (" · acumulado 12 mm de 56 mm"); '' when unknown. */
export function rainSoFarSuffix(soFarMm: number | null | undefined, totalMm: number | null | undefined, t: Translate, locale?: string) {
  if (soFarMm == null || totalMm == null) return ''
  const amount = (mm: number) => mm.toLocaleString(locale, {maximumFractionDigits: Math.abs(mm) < 10 ? 1 : 0})
  return t(` · acumulado ${amount(soFarMm)} mm de ${amount(totalMm)} mm`, ` · ${amount(soFarMm)} mm of ${amount(totalMm)} mm so far`)
}

/** Identity colours of the water-budget parts (validated as a categorical set on the panel surface: CVD ΔE ≥ 9,
 * normal-vision ΔE ≥ 24); the per-frame volume chart reuses the sheet and ponded colours. */
export const WATER_BUDGET_COLORS = {infiltrated: '#eb6834', sheet: '#1baf7a', ponded: '#2a78d6', final: '#2a78d6', left: '#e87ba4'} as const

/** Parts of the water-budget bar (m³ and % of the bar): infiltrated, sheets (< 0.03 m) and ponded water of the last
 * frame (or the final water unsplit for older runs) and the water that left through the boundaries; null without water. */
export function waterBudgetView(budget: FloodWaterBudget | null | undefined) {
  if (!budget) return null
  const split = budget.sheet_m3 != null && budget.ponded_m3 != null
  const raw: Array<['infiltrated' | 'sheet' | 'ponded' | 'final' | 'left', number]> = [['infiltrated', budget.infiltrated_m3 ?? 0],
    ...(split ? [['sheet', budget.sheet_m3!], ['ponded', budget.ponded_m3!]] as Array<['sheet' | 'ponded', number]> : [['final', budget.final_water_m3 ?? 0]] as Array<['final', number]>),
    ['left', budget.boundary_outflow_m3 ?? 0]]
  const total = raw.reduce((a, [, v]) => a + Math.max(0, v), 0)
  if (!(total > 0)) return null
  return {split, parts: raw.map(([key, m3]) => ({key, m3, pct: Math.max(0, m3) * 100 / total}))}
}

/** Where the time cursor of the charts goes at `seconds`: fraction of the hyetograph time span (null outside the rain),
 * position of the frame shown (the last one at or before `seconds`) and the nearest mass-balance row (ties: later). */
export function chartCursor(result: Pick<FloodRoiResult, 'frames' | 'rainfall_segments' | 'mass_balance'>, seconds: number | null | undefined) {
  const none = {hyetographFraction: null, frameIndex: null, volumeIndex: null}
  if (seconds == null || !Number.isFinite(seconds)) return none
  const segments = result.rainfall_segments
  const t0 = segments?.[0]?.start_s ?? 0, t1 = segments?.at(-1)?.end_s ?? 0
  const hyetographFraction = segments?.length && t1 > t0 && seconds >= t0 && seconds < t1 ? (seconds - t0) / (t1 - t0) : null
  let frameIndex: number | null = null
  for (let i = 0; i < result.frames.length; i++) if ((result.frames[i].scheduled_time_s ?? 0) <= seconds) frameIndex = i
  let volumeIndex: number | null = null, best = Infinity
  const series = result.mass_balance?.series ?? []
  for (let i = 0; i < series.length; i++) { const d = Math.abs(series[i][0] - seconds); if (d <= best) { best = d; volumeIndex = i } }
  return {hyetographFraction, frameIndex, volumeIndex}
}

/** Most preview pixels the animation keeps in memory (frames x grid cells, RGBA); larger runs keep the frame selector. */
export const ANIMATION_MAX_PIXELS = 16_000_000
/** Frame artifacts of a run in frame order (the maximum excluded). */
export function animationFrames(result: Pick<FloodRoiResult, 'artifacts'>) {
  return result.artifacts.filter(a => a.frame_index != null).sort((a, b) => a.frame_index! - b.frame_index!)
}
/** True when the run has at least two frames and their previews fit ANIMATION_MAX_PIXELS. */
export function animationAvailable(result: Pick<FloodRoiResult, 'artifacts' | 'grid'>) {
  const frames = animationFrames(result).length, shape = result.grid?.shape
  return frames >= 2 && Array.isArray(shape) && frames * shape[0] * shape[1] <= ANIMATION_MAX_PIXELS
}

/** One preloaded animation frame: its preview PNG as an object URL and its geographic bounds. */
export interface AnimationFrame { name: string; frameIndex: number; scheduledTimeS: number | null; url: string; bounds: [number, number, number, number] }

/** What the map draws while the animation is on: every preloaded frame (one image layer each, so changing frame never
 * reloads an image), the frame shown, the cross-fade, its flow arrows and the gross rain intensity at that time. */
export interface FloodMapAnimation {
  frames: ReadonlyArray<AnimationFrame>
  index: number
  fadeMs: number
  flowArrows: FlowArrowCollection | null
  /** Gross rain (mm/h) at the simulated time shown; 0 when it does not rain, null when the run has no hyetograph. */
  rainMmH: number | null
  /** Gross rain (mm) fallen up to the simulated time shown and in the whole storm; null when unknown. */
  rainSoFarMm: number | null
  rainTotalMm: number | null
  showRain: boolean
  /** Frames of a run still in progress (shown before the results exist); the newest one is the frame shown. */
  live?: boolean
}

/** Progress bar of a run in progress: % of the simulated time, hh:mm labels, frames so far, the attempt's solver and
 * the solver it restarted from after a switch; null while there is no progress (preparing, older servers). */
export function runProgressView(run: Pick<FloodRoiRun, 'state' | 'progress'> | null | undefined) {
  const p = run?.progress
  if (!p || !(p.duration_s > 0) || !Number.isFinite(p.simulated_s)) return null
  const fraction = Math.min(1, Math.max(0, p.simulated_s / p.duration_s))
  return {pct: Math.round(fraction * 1000) / 10, simulated: simulatedTimeLabel(Math.min(p.simulated_s, p.duration_s)), total: simulatedTimeLabel(p.duration_s),
    frames: p.frames_available, solver: p.solver, restartedFrom: p.restarted_from, rainMmH: p.rain_mm_h ?? null,
    latestFrameIndex: p.latest_frame_index, latestFrameTimeS: p.latest_frame_time_s}
}

/** Index of the live frame to fetch next: the newest complete frame, unless it (or a later one) is already shown. */
export function liveFrameToFetch(progress: Pick<FloodRunProgress, 'latest_frame_index'> | null | undefined, fetched: number[]) {
  const latest = progress?.latest_frame_index
  if (latest == null || fetched.some(index => index >= latest)) return null
  return latest
}

/** Fetches the preview of every frame (`concurrency` at a time) and returns them in frame order. On abort or on any
 * failure it rejects and revokes every object URL it created, so nothing is left behind. */
export async function preloadFramePreviews(
  preview: (id: string, name: string, signal: AbortSignal) => Promise<{blob: Blob; bounds: [number, number, number, number]}>,
  runId: string, artifacts: FloodRoiResult['artifacts'],
  {signal, urls = URL, onProgress, concurrency = 4}: {signal: AbortSignal; urls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>; onProgress?: (done: number) => void; concurrency?: number},
): Promise<AnimationFrame[]> {
  const frames: AnimationFrame[] = new Array(artifacts.length), created: string[] = []
  let next = 0, done = 0, stopped = false
  const aborted = () => new DOMException('Animation preload aborted', 'AbortError')
  const worker = async () => {
    while (next < artifacts.length && !stopped) {
      if (signal.aborted) throw aborted()
      const artifact = artifacts[next++]
      const image = await preview(runId, artifact.name, signal)
      if (stopped) return
      if (signal.aborted) throw aborted()
      const url = urls.createObjectURL(image.blob); created.push(url)
      frames[artifacts.indexOf(artifact)] = {name: artifact.name, frameIndex: artifact.frame_index ?? 0, scheduledTimeS: artifact.scheduled_time_s ?? null, url, bounds: image.bounds}
      onProgress?.(++done)
    }
  }
  try {
    await Promise.all(Array.from({length: Math.max(1, Math.min(concurrency, artifacts.length))}, worker))
    if (signal.aborted) throw aborted()
    return frames
  } catch (e) {
    stopped = true
    for (const url of created) urls.revokeObjectURL(url)
    throw e
  }
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
