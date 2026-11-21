# Friendlier flood simulation UI (DG2 panel)

Objective: make the DG2 flood simulation panel friendlier, taking the `origin/terrapulseai_v2.1` flood UI as the reference the user likes.
Branch: `feature/flood-ui-dg2`. Delivery: `ask-on-risk`. Runners: `node --test` (web/tests), `tsc -b`, `eslint`, Playwright browser check.

## Specs

- S1 "eres un experto en desarrollo de sofware web, necesito que mejores la UI/UX de la simulacion de inundación para que sea más amigable."
- S2 "Por ejemplo, la interfaz que tiene la v2.1 me gusta." Reference: `origin/terrapulseai_v2.1` `web/src/components/RainDg2Panel.tsx`, `FloodCharts.tsx`, flood parts of `MapCanvas.tsx`.
- S3 Keep every current capability and the exact POST contract of `/api/flood-scenarios/roi/start/` (per-side boundaries, sea level, still water, infiltration, pressure, lakes, thin-depth threshold, charts, legend, overflow arrows, PNG download). Assumption: values stay explicit (a visible "load example values" action is allowed; no silent defaults sent to the server).

## Tasks

- [x] T1 S1-S3 redesign the DG2 panel after v2.1 (delegated: writer, parallel with the validation event search) — see commit below

## Log

- L1 (2026-11-20) User: "Si, busca un evento en la costa o en algún lugar donde puedas hacer la validación. Después, eres un experto en desarrollo de sofware web, necesito que mejores la UI/UX de la simulacion de inundación para que sea más amigable. Por ejemplo, la interfaz que tiene la v2.1 me gusta."
- L2 Route: T1 delegated to one bounded writer (Writer trigger (a): runs in parallel with the validation event search, disjoint surfaces web/ vs pipeline/scratch).
- L3 Writer result: steps 1-5 with Completo/Pendiente, example-values button, coast/inland presets, cell estimate warning (>3000), result cards, collapsible "Cómo funciona", phone layout. POST body unchanged (pinned by 2 tests). Checks: node 115/115, tsc 0, lint 0 errors (6 base warnings), browser 33/33. Deviation: example CRS = UTM zone of the ROI centre (EPSG:32615 for Chiapas). Parent spot check: node 115/115.
