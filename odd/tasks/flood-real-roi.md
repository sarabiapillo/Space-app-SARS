# Flood simulation with a validated user ROI
Scope: flood simulator only; preserve unrelated application mocks and concurrent uncommitted work.

## Specs
S1. «Quiero que elimines todo tipo de mocks, para que se realice una simulación tiene que haber sido seleccionada una ROI por el usuario previamente y que sea valida.»
S2. «Solo simulador de inundaciones»

## Tasks
T1 [S1-S2] Remove flood-only fixed eligibility polygons and hardcoded map overlays; route: bounded worker (map/mocks); commit: blocked (shared uncommitted MapCanvas and initialWorkspaces edits from another agent).
T2 [S1-S2] Remove invented flood results and zones; require the actual selected and valid user ROI for the backend request; route: bounded worker (panel/helper/tests); commit: pending (independent final check unavailable).
T3 [S1-S2] Document verified flood behavior and run integrated checks; route: inline; commit: pending (visual/remote result not verified).

## Log
L1. Quiero que elimines todo tipo de mocks, para que se realice una simulación tiene que haber sido seleccionada una ROI por el usuario previamente y que sea valida.
L2. Solo simulador de inundaciones
L3. Exploration: current RainDg2Panel creates a fixed 0.018-degree bbox instead of using the selected croppedRegion, falls back to generateFloodRaster on backend error, and exposes mock flood zones. The backend already validates Polygon GeoJSON in pipeline/hydrology/inputs.py; retain backend validation and preserve unrelated solar/catalog mocks.
L4. Partial implementation: static DG2 polygons removed; helper floodRoiPolygon and backend-only request added, but RainDg2Panel had undefined symbols and failed TypeScript until remaining legacy UI is removed. Worker continuation is running. Backend/analyses/simulate.py computes road impact from a fixed factor 2.2 rather than road geometries; do not present it as measured road impact.
L5. Panel continuation removed inherited zone presets, coordinate modal and local results; TypeScript and scoped ESLint passed with 3 helper tests. Backend input validation: python -m pytest -q pipeline/tests/test_flood_inputs.py passed (39 tests). Cleanup of orphan floodGenerator, unmeasured road figures and stale map results remains in progress.
L6. Removed unused floodGenerator.ts and user-facing unmeasured road metrics. Independent verifier found stale flood results could reappear after ROI A→B→A while flood panel was closed; App now invalidates saved result on any ROI change, MapCanvas guards the raster/compare layers by resultRoiKey, panel invalidates pending requests on unmount. RED/GREEN structural check captured. Frontend build and scoped ESLint passed; 8 focused web tests passed; LaTeX compiled in temporary directory. Independent recheck unavailable (subagent quota). No remote NASADEM simulation or visual E2E was run. Final independent verification attempt failed on verifier quota. Concurrent uncommitted changes by another agent overlap App.tsx, MapCanvas.tsx and initialWorkspaces.ts; cannot isolate a feature work-unit commit safely without coordinating their ownership.
