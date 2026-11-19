import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rectangleFromCorners,
  roiGenerationNotice,
  isRectangularEffectiveRoi,
  isAcceptableEffectiveRoi,
  MIN_LOCATION_RADIUS_KM,
  MAX_LOCATION_RADIUS_KM,
  DEFAULT_LOCATION_RADIUS_KM,
  automaticCropRing,
  geometryToOuterRing,
  isAnalysisRoiActive,
  deduplicateLocationResults,
  formatLocationResultLabel,
  getLocationResultKey,
} from '../src/utils/roi.ts'
import { generateLocationRoi, searchGcov } from '../src/api/client.ts'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
} })

const { getInitialSavedMaps } = await import('../src/hooks/useSavedMaps.ts')
const { createInitialCopies } = await import('../src/mocks/initialWorkspaces.ts')
const { buildInverseEffectiveRoiMaskGeoJSON } = await import('../src/utils/geojson.ts')

test('confirmed MultiPolygon mask retains every island and hole in the visible geometry', () => {
  const roi = { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[.5, .5], [1, .5], [1, 1], [.5, 1], [.5, .5]]],
    [[[3, 0], [4, 0], [4, 1], [3, 1], [3, 0]]],
  ] }
  const features = buildInverseEffectiveRoiMaskGeoJSON(roi).features
  assert.deepEqual(features[0].geometry.coordinates.slice(1), [roi.coordinates[0][0], roi.coordinates[1][0]])
  assert.deepEqual(features[1].geometry.coordinates, [roi.coordinates[0][1]])
  assert.deepEqual(features[2].geometry.coordinates, roi.coordinates[0][0])
  assert.deepEqual(features[3].geometry.coordinates, roi.coordinates[0][1])
  assert.deepEqual(features[4].geometry.coordinates, roi.coordinates[1][0])
  const source = readFileSync(new URL('../src/components/MapCanvas.tsx', import.meta.url), 'utf8')
  assert.match(source, /buildInverseEffectiveRoiMaskGeoJSON\(effectiveRoi\)/)
  assert.match(source, /source\.setData\(effectiveRoi \? \{ type: 'Feature', properties: \{\}, geometry: effectiveRoi \}/)
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /effectiveRoi: geometry, effectiveRoiMetadata: metadata/)
})

test('location input offers debounced accessible names while keeping explicit Nominatim selection', () => {
  const source = readFileSync(new URL('../src/components/LocationSearch.tsx', import.meta.url), 'utf8')
  assert.match(source, /suggestLocations\(query\.trim\(\)/)
  assert.match(source, /window\.setTimeout\(/)
  assert.match(source, /clearTimeout\(/)
  assert.match(source, /query\.trim\(\)\.length < 3/)
  assert.match(source, /role="combobox"/)
  assert.match(source, /role="listbox"/)
  assert.match(source, /searchLocations\(searchQuery\)/)
  assert.match(source, /selectSuggestion/)
})

test('automatic ROI radius bounds default to 5 km and cap at 15 km', () => {
  assert.equal(DEFAULT_LOCATION_RADIUS_KM, 5)
  assert.equal(MIN_LOCATION_RADIUS_KM, 1)
  assert.equal(MAX_LOCATION_RADIUS_KM, 15)
})

test('automatic preview accepts bounded Polygon and MultiPolygon regardless of rectangular shape', () => {
  const rectangle = { type: 'Polygon', coordinates: [[[-93, 16], [-92.5, 16], [-92.5, 16.5], [-93, 16.5], [-93, 16]]] }
  const irregular = {
    type: 'Polygon',
    coordinates: [[[-93.2, 16.7], [-93.1, 16.7], [-93.05, 16.75], [-93.1, 16.8], [-93.2, 16.8], [-93.2, 16.7]]],
  }
  const multi = {
    type: 'MultiPolygon',
    coordinates: [
      [[[-93.18, 16.72], [-93.12, 16.72], [-93.12, 16.78], [-93.18, 16.78], [-93.18, 16.72]]],
      [[[-93.08, 16.72], [-93.02, 16.72], [-93.02, 16.78], [-93.08, 16.78], [-93.08, 16.72]]],
    ],
  }
  assert.equal(isAcceptableEffectiveRoi(rectangle, 'administrative_original'), true)
  assert.equal(isAcceptableEffectiveRoi(irregular, 'administrative_original'), true)
  assert.equal(isAcceptableEffectiveRoi(multi, 'administrative_original'), true)
  assert.equal(isAcceptableEffectiveRoi(rectangle, 'administrative_rectangle'), true)
  assert.equal(isAcceptableEffectiveRoi(irregular, 'administrative_rectangle'), false)
  assert.equal(isAcceptableEffectiveRoi(multi, 'administrative_rectangle'), false)
  assert.equal(isAcceptableEffectiveRoi({ ...rectangle, coordinates: [[[-93, 16], [-92.39, 16], [-92.39, 16.5], [-93, 16.5], [-93, 16]]] }, 'administrative_original'), false)
  assert.equal(isAcceptableEffectiveRoi({ ...rectangle, coordinates: [[[-93, 16], [-92.5, 16], [-92.5, 16.61], [-93, 16.61], [-93, 16]]] }, 'administrative_original'), false)
})

test('crop ring derivation keeps rectangles exact and approximates irregular Polygon/MultiPolygon by outer ring', () => {
  const rect = { type: 'Polygon', coordinates: [[[-93.2, 16.7], [-93, 16.7], [-93, 16.9], [-93.2, 16.9], [-93.2, 16.7]]] }
  assert.deepEqual(automaticCropRing(rect), [[-93.2, 16.7], [-93, 16.7], [-93, 16.9], [-93.2, 16.9]])
  assert.deepEqual(geometryToOuterRing(rect), [[-93.2, 16.7], [-93, 16.7], [-93, 16.9], [-93.2, 16.9]])

  const poly = {
    type: 'Polygon',
    coordinates: [[[-93.2, 16.7], [-93.1, 16.7], [-93.05, 16.75], [-93.1, 16.8], [-93.2, 16.8], [-93.2, 16.7]]],
  }
  assert.deepEqual(geometryToOuterRing(poly), [[-93.2, 16.7], [-93.1, 16.7], [-93.05, 16.75], [-93.1, 16.8], [-93.2, 16.8]])

  const multi = {
    type: 'MultiPolygon',
    coordinates: [
      [[[-93.18, 16.72], [-93.14, 16.72], [-93.14, 16.76], [-93.18, 16.76], [-93.18, 16.72]]],
      [[[-93.08, 16.72], [-93.02, 16.72], [-93.02, 16.78], [-93.08, 16.78], [-93.08, 16.72]]],
    ],
  }
  // Elige la parte de mayor área aproximada (la segunda, más grande).
  assert.deepEqual(geometryToOuterRing(multi), [[-93.08, 16.72], [-93.02, 16.72], [-93.02, 16.78], [-93.08, 16.78]])

  assert.equal(isAnalysisRoiActive(rect, null), true)
  assert.equal(isAnalysisRoiActive(null, [[0, 0], [1, 0], [1, 1]]), true)
  assert.equal(isAnalysisRoiActive(null, null), false)
  assert.equal(automaticCropRing({ type: 'MultiPolygon', coordinates: [] }), null)
})

test('effective Polygon with holes survives saved-map normalization and reload', () => {
  const [first] = createInitialCopies(0)
  const effectiveRoi = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
    ],
  }
  const saved = {
    ...first,
    nombre: 'Con ROI',
    effectiveRoi,
    effectiveRoiMetadata: {
      name: 'Zona',
      center: [2, 2],
      radius_km: 5,
      applied_radius_km: 5,
      source: 'nominatim',
      generation: 'administrative_original',
    },
  }
  const [loaded] = getInitialSavedMaps(JSON.stringify([saved]))
  assert.deepEqual(loaded.effectiveRoi, effectiveRoi)
  assert.deepEqual(loaded.effectiveRoiMetadata, saved.effectiveRoiMetadata)
})

test('effective MultiPolygon ROI with holes survives saved-map normalization', () => {
  const [first] = createInitialCopies(0)
  const effectiveRoi = { type: 'MultiPolygon', coordinates: [[[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[2,1],[2,2],[1,2],[1,1]]], [[[8,8],[9,8],[9,9],[8,9],[8,8]]]] }
  const saved = { ...first, nombre: 'Con ROI', effectiveRoi, effectiveRoiMetadata: { name: 'Zona', center: [2, 2], radius_km: 5, applied_radius_km: 4.25, source: 'nominatim', generation: 'administrative_original' } }
  const [loaded] = getInitialSavedMaps(JSON.stringify([saved]))
  assert.deepEqual(loaded.effectiveRoi, effectiveRoi)
  assert.deepEqual(loaded.effectiveRoiMetadata, saved.effectiveRoiMetadata)
})

test('notices use the actually applied radius and only alert for generated rectangles', () => {
  assert.match(roiGenerationNotice('point_geodesic_square', 3.25), /3.25 km/)
  assert.match(roiGenerationNotice('administrative_rectangle', 2), /rectángulo.*punto interior.*2 km/i)
  assert.equal(roiGenerationNotice('administrative_original', 5), null)
  assert.equal(roiGenerationNotice('administrative_bbox', 5), null)
})

test('small administrative Polygon is preserved from preview through persistence to GCOV search body', async () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [[[-93.2, 16.7], [-93.1, 16.7], [-93.05, 16.75], [-93.1, 16.8], [-93.2, 16.8], [-93.2, 16.7]]],
  }
  const response = {
    geometry: polygon,
    original_geometry: polygon,
    metadata: {
      name: 'San Cristóbal de las Casas',
      center: [-93.12, 16.74],
      radius_km: 5,
      applied_radius_km: 5,
      source: 'nominatim',
      generation: 'administrative_original',
    },
  }
  globalThis.fetch = async () => new Response(JSON.stringify(response), { status: 200 })
  const roiResult = await generateLocationRoi({ place_id: 1, query: 'San Cristóbal', radius_km: 5 })

  assert.equal(isAcceptableEffectiveRoi(roiResult.geometry, roiResult.metadata.generation), true)
  assert.deepEqual(roiResult.geometry, polygon)
  assert.equal(automaticCropRing(roiResult.geometry), null)
  assert.deepEqual(geometryToOuterRing(roiResult.geometry), polygon.coordinates[0].slice(0, -1))

  const [first] = createInitialCopies(0)
  const saved = {
    ...first,
    nombre: 'Mapa admin',
    effectiveRoi: roiResult.geometry,
    effectiveRoiMetadata: roiResult.metadata,
    croppedRegion: geometryToOuterRing(roiResult.geometry),
  }
  const [loaded] = getInitialSavedMaps(JSON.stringify([saved]))
  assert.deepEqual(loaded.effectiveRoi, polygon)

  let body
  globalThis.fetch = async (_path, init) => {
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({ scenes: [], count: 0, coverage_note: '' }))
  }
  await searchGcov(loaded.effectiveRoi)
  assert.deepEqual(body.roi, polygon)
})

test('administrative_rectangle stays rectangular and carries applied radius notice', () => {
  const rect = {
    type: 'Polygon',
    coordinates: [[[-93.15, 16.7], [-93.05, 16.7], [-93.05, 16.8], [-93.15, 16.8], [-93.15, 16.7]]],
  }
  assert.equal(isRectangularEffectiveRoi(rect), true)
  assert.equal(isAcceptableEffectiveRoi(rect, 'administrative_rectangle'), true)
  assert.match(roiGenerationNotice('administrative_rectangle', 4.75), /4.75 km/)
})

test('point selection generates a rectangular geodesic ROI', () => {
  const rect = {
    type: 'Polygon',
    coordinates: [[[-93.15, 16.7], [-93.05, 16.7], [-93.05, 16.8], [-93.15, 16.8], [-93.15, 16.7]]],
  }
  assert.equal(isAcceptableEffectiveRoi(rect, 'point_geodesic_square'), true)
  assert.equal(isRectangularEffectiveRoi(rect), true)
  assert.match(roiGenerationNotice('point_geodesic_square', 5), /5 km/)
})

test('same-name different entities render distinguishable non-technical labels', () => {
  const city = {
    place_id: 101,
    name: 'Tuxtla Gutiérrez, Chiapas, México',
    category: 'place',
    type: 'city',
    address: { city: 'Tuxtla Gutiérrez', state: 'Chiapas', country: 'México' },
    geometry: { type: 'Point', coordinates: [-93.12, 16.75] },
    selectable_roi: false,
  }
  const municipality = {
    place_id: 102,
    name: 'Tuxtla Gutiérrez, Chiapas, México',
    category: 'boundary',
    type: 'administrative',
    address: { municipality: 'Tuxtla Gutiérrez', state: 'Chiapas', country: 'México' },
    geometry: { type: 'Polygon', coordinates: [[[-93.2, 16.7], [-93.05, 16.7], [-93.05, 16.8], [-93.2, 16.8], [-93.2, 16.7]]] },
    selectable_roi: true,
  }
  const village = {
    place_id: 103,
    name: 'San José, Chiapas, México',
    category: 'place',
    type: 'village',
    address: { village: 'San José', state: 'Chiapas', country: 'México' },
    geometry: { type: 'Point', coordinates: [-92.9, 16.6] },
    selectable_roi: false,
  }

  const cityLabel = formatLocationResultLabel(city)
  const municipalityLabel = formatLocationResultLabel(municipality)
  const villageLabel = formatLocationResultLabel(village)

  assert.equal(cityLabel.primary, 'Tuxtla Gutiérrez')
  assert.equal(municipalityLabel.primary, 'Tuxtla Gutiérrez')
  assert.equal(villageLabel.primary, 'San José')
  assert.doesNotMatch(cityLabel.primary, /administrative|village|town/)
  assert.doesNotMatch(municipalityLabel.primary, /administrative|village|town/)
  assert.doesNotMatch(villageLabel.primary, /administrative|village|town/)

  const deduped = deduplicateLocationResults([city, municipality, village, city])
  assert.equal(deduped.length, 3)
  assert.ok(deduped.find(r => r.place_id === 101))
  assert.ok(deduped.find(r => r.place_id === 102))
  assert.ok(deduped.find(r => r.place_id === 103))

  assert.notEqual(getLocationResultKey(city), getLocationResultKey(municipality))
})

test('ROI timing is reset on a new job and visible after images load', () => {
  const hook = readFileSync(new URL('../src/hooks/useRoiLayers.ts', import.meta.url), 'utf8')
  const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8')
  assert.match(hook, /const started = performance\.now\(\)/)
  assert.match(hook, /preparationSeconds: Number\(\(\(performance\.now\(\) - started\) \/ 1000\)/)
  assert.match(hook, /update\(\{ loading: true,[^}]*preparationSeconds: null/)
  assert.match(sidebar, /roiLayers\.preparationSeconds\.toFixed\(1\)/)
  assert.match(sidebar, /roiLayers\.timings\.scene_processing_seconds/)
})

test('axes exceeding 0.6° are rejected before confirm for any generation', () => {
  const tooWide = {
    type: 'Polygon',
    coordinates: [[[-93, 16], [-92.3, 16], [-92.3, 16.5], [-93, 16.5], [-93, 16]]],
  }
  const tooTall = {
    type: 'Polygon',
    coordinates: [[[-93, 16], [-92.5, 16], [-92.5, 16.7], [-93, 16.7], [-93, 16]]],
  }
  assert.equal(isAcceptableEffectiveRoi(tooWide, 'administrative_original'), false)
  assert.equal(isAcceptableEffectiveRoi(tooTall, 'administrative_original'), false)
  assert.equal(isRectangularEffectiveRoi(tooWide), false)
  assert.equal(isRectangularEffectiveRoi(tooTall), false)
})

test('los mapas demo intactos no se muestran, pero se preservan los modificados y su ROI', () => {
  const [first, second] = createInitialCopies(0)
  assert.deepEqual(getInitialSavedMaps(null), [])
  assert.deepEqual(getInitialSavedMaps(JSON.stringify([first, second])), [])
  const edited = { ...first, nombre: 'Mi mapa', annotations: [{ id: 'nota-1', kind: 'etiqueta', position: [-93, 16.7], text: 'Observación propia' }], croppedRegion: [[-93.1, 16.7], [-93, 16.7], [-93, 16.8]] }
  const result = getInitialSavedMaps(JSON.stringify([first, edited, second]))
  assert.equal(result.length, 1)
  assert.equal(result[0].nombre, 'Mi mapa')
  assert.deepEqual(result[0].croppedRegion, edited.croppedRegion)
  assert.equal(result[0].annotations[0].text, 'Observación propia')
  assert.deepEqual(getInitialSavedMaps('{invalid'), [])
})

test('saved-map bootstrap filters raw seeded entries before normalization and does not write on mount', () => {
  const source = readFileSync(new URL('../src/hooks/useSavedMaps.ts', import.meta.url), 'utf8')
  const filterAt = source.indexOf('.filter((entry) => !isUnchangedSeededDemo(entry))')
  const normalizeAt = source.indexOf('.map(normalizeMap)', filterAt)
  assert.ok(filterAt >= 0 && normalizeAt > filterAt)
  assert.match(source, /copia-1-presa-malpaso/)
  assert.match(source, /copia-2-sierra/)
  assert.match(source, /croppedRegion \? \{ \.\.\.EMPTY_SCENE/)
  assert.match(source, /if \(!hasUserChanges\) return/)
  assert.match(source, /LEGACY_STORAGE_KEY = 'terrapulse_saved_maps_c1'/)
  assert.match(source, /STORAGE_KEY = 'terrapulse_saved_maps_c2'/)
  assert.match(source, /current === null \? localStorage\.getItem\(LEGACY_STORAGE_KEY\) : current/)
  assert.match(source, /entries\.some\(\(entry\) => normalizeMap\(entry\) === null\)/)
  assert.match(source, /croppedRegion/)
})

test('ROI bootstrap keeps user data and the original Esri basemap without injecting scene values', () => {
  const source = readFileSync(new URL('../src/components/MapCanvas.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../src/mocks/initialWorkspaces.ts', import.meta.url), 'utf8')
  assert.match(workspace, /centro: \[0, 0\]/)
  assert.match(source, /server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery/)
  assert.doesNotMatch(source, /tile\.openstreetmap\.org|NISAR_IMAGE_URL|DEFAULT_EXPLORE_ESQUINAS_LONLAT|CHIAPAS_CENTRO/)
  assert.doesNotMatch(source, /\[-28\.83, \+9\.78 dB\]|noiseCorrectionApplied = False|identidad_verificada_contra_catalogo \?\? true/)
})

test('paneles y galería no ofrecen escenas sintéticas sin ROI calculada', () => {
  const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const header = readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(sidebar, /ExploradorFeature|ComparadorFeature|Etapa1ChartsPanel|PILAS_GCOV_CHIAPAS/)
  assert.doesNotMatch(app, /RAW_SCENE_IDS|checkPairCompat|handleSelectStack|handleChangePair/)
  assert.doesNotMatch(app, /ScientificFiguresViewer|figuresOpen/)
  const rain = readFileSync(new URL('../src/components/RainDg2Panel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(rain, /escena\.pila|escena\.t1|escena\.t2/)
  assert.match(header, /disabled=\{!hasFirstScene\}/)
  assert.match(header, /disabled=\{!hasSecondScene \|\| !roiLayers\?\.comparable\}/)
})

test('dos esquinas generan un rectángulo, cualquiera que sea el orden', () => {
  const expected = [[-93.1, 16.7], [-93, 16.7], [-93, 16.8], [-93.1, 16.8]]
  for (const [a, b] of [[expected[0], expected[2]], [expected[2], expected[0]], [expected[1], expected[3]], [expected[3], expected[1]]]) {
    assert.deepEqual(rectangleFromCorners(a, b), expected)
  }
})

test('rechaza rectángulos degenerados, fuera de límites y excesivos', () => {
  for (const [a, b] of [[[0, 0], [0, 1]], [[0, 0], [1, 0]], [[NaN, 0], [1, 1]], [[181, 0], [182, 1]], [[0, 86], [1, 87]], [[0, 0], [2, 2]]]) {
    assert.throws(() => rectangleFromCorners(a, b))
  }
})
