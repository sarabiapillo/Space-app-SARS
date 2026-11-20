# Flood DG2: physicist feedback (image, flow arrows, boundaries)

Objective: address the physicist's three requests on the ROI DG2 flood simulation. Branch: `feature/flood-ui-dg2`.
Delivery: work-unit commits on the feature branch (ask-on-risk). Runners: `pytest` (conda `nisar`), `python backend/manage.py test`, `node --test` + `npm run build` + `npm run lint` in `web/`.

## Specs

- **S1** Image download. Physicist (verbatim): "que puede dscras uan imagens de eso". The results card offers a direct PNG download of the selected depth frame; the existing map capture tool (PNG/JPG) also includes the WebGL flood layer and the arrows.
- **S2** Flow arrows. Physicist (verbatim): "que muestre flechas para indicar el flujo". Arrows come from solver velocities (LISFLOOD-FP `voutput`, `.Vx/.Vy` = HU/H), not invented. Sign convention verified empirically: Vx positive east, Vy positive north. Arrows only where depth >= 0.03 m (same threshold as the PNG palette), because thin films give spurious HU/H speeds (up to 11 m/s at h < 0.03 m in the real run).
- **S3** Boundary conditions. Physicist (verbatim): "mejorar las condiciones de frontera"; reply: "Para la costa nivel fijo", "todo lo demás está bien". Per side (N/E/S/W): closed, free or fixed level (HFIX, metres on EGM96); optional still-water start: cells below the fixed level and connected to a fixed side start at that level (DG2 `startfile`, H = eta - z, H1x = -Z1x, H1y = -Z1y). Whole sides only; no HVAR, no river inflows (QFIX/QVAR), per L7.
- **S4** Overflow-only arrows. Physicist (verbatim): "que dibije uan linas que refrerencie el flujo del aguas pero no tanta solo en caso de desbodamiento". User chose option 1: arrows only where depth >= 0.15 m outside the D8 channel network (upslope area >= 0.12 km2, as in the terrapulseai_v2 simulator), and fewer arrows.
- **S5** Color scale. Physicist (verbatim): "la escala de colors mejorara". Class-based sequential blue scale 0.03-0.15, 0.15-0.5, 0.5-1, 1-2, >2 m with a legend.
- **S6** Charts. Physicist (verbatim): "has que meutesre graficas adecudas". DG2 charts: rainfall hyetograph, wet area and maximum depth over scheduled time, domain volume vs cumulative rain (mass balance), depth distribution of the selected frame.
- **S7** Infiltration as in the terrapulseai_v2.1 simulator (user: "agrega Infiltración y Presión atmosférica, como lo hace ese simulador"): runoff coefficient C = min(0.92, 0.65 + 0.27 (1 - exp(-D/24 h))), D = rain duration clamped to >= 0.5 h; DG2 receives rain x C. Optional, explicit (`infiltration: "runoff_coefficient"`).
- **S8** Atmospheric pressure as in that simulator: inverse-barometer surge = max(0, 1013.25 - p) x 100 / (1000 x 9.81) m, p in 950-1040 hPa, added to the fixed sea level (HFIX and still-water start). Deviation: not added to inland ponding (inverse barometer acts on open water); rejected without a fixed-level side.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | inline | done | `9ebd6d0`; browser: PNG download named `roi-0001.wd.png`, file is PNG |
| T2 | S2 | inline (backend: voutput + flow vectors in results/API) | done | `753d63b`; RED 10 -> GREEN 49; pipeline 440 pass (4 solar_api fail on base too); backend 10/10 |
| T3 | S2 | inline (frontend: MapLibre arrow layer + toggle) | done | `9ebd6d0`; node 99/99, build OK, lint 0 errors (6 warnings on base too); browser 16/16 |
| T4 | S3 | inline | done | `abc95bc`; RED 16 -> GREEN; native flat-sea test; real-DEM lake at rest: dry start 0% filled at 300 s, startfile 100% volume, +-3 cm |
| T5 | S4 | inline | done | `1710640`; RED 6 -> GREEN; real run 4-20 arrows/frame (was 39-64); pit filling: 1 -> 59 channel cells |
| T6 | S5 | inline | done | `c554030`; preview test 5 class colours; web/backend palette sync test |
| T7 | S6 | inline | done | `0bd1535`; RED -> GREEN; browser flow-check 23/23, compact 5/5; node 104/104 |
| T8 | S7, S8 | inline | done | commit below; RED -> GREEN (losses 15, runner); pipeline 488 pass (4 solar_api base); backend 14/14; node 106/106; browser 24/24; real coastal run dfaef3bb |

Route evidence: no Writer trigger (units depend on each other or are under ~100 lines; no parallel batch). Risk: T2 adds an optional result field and a solver keyword (`voutput` does not change `.wd`/`.max`: byte-identical in a real rerun).

## Log

- **L1** (2026-11-19) User, after the three pending items were listed: "Si, encaralos".
- **L2** Prior commits for pending work: `dc44f8a` (rain-inclusive mass balance), `52cb9f6` (narrow-screen panel).
- **L3** Evidence: rerun of real job 727e18e2 with `voutput` in scratch: `.wd`/`.max` identical; corr(Vx, downhill east) 0.81/0.54, corr(Vy, downhill north) 0.65/0.64 on frames 1-2 (h > 0.05 m). Frame 3 ponded (corr ~0).
- **L4** Real outputs with voutput: 39-64 arrows per frame, flow JSON 6.7 KB. Arrow icon enlarged after the first screenshot (pixelRatio 2 was too small to read).
- **L5** Browser check `web/.browser-check/tooling/flow-check.mjs` (synthetic HTTP fixtures, not hydraulic validation): 16 assertions pass; screenshot shows north/east/SSW arrows sized by speed. RDD is off globally: no native review.
- **L6** Next: T4 waits for the user decision on boundary conditions.
- **L7** (2026-11-19) Physicist's answers relayed by the user: Q5 "Las ecuaciones mejoradas son las que ya tenemos"; Q3 "no hace falta, no tomaremos en cuenta las entradas de ríos". So S3 excludes QFIX/QVAR inflows; open: Q1 (observed problem), Q2 (coast: fixed level or tide/surge), Q4 (whole sides or partial segments). SIH CONAGUA hydrometric CSVs are daily with gaps, not suitable for hour-scale events (checked B01002).
- **L8** (2026-11-19) Physicist's reply to the boundary proposal (`docs/latex/propuesta_fronteras_dg2.pdf`), relayed verbatim: "Para la costa nivel fijo / que dibije uan linas que refrerencie el flujo del aguas pero no tanta solo en caso de desbodamiento / la escala de colors mejorara / y todo lo demasn esta bien / has que meutesre graficas adecudas / ya con eso". Reading: coast = HFIX fixed level; whole sides and startfile accepted ("todo lo demás está bien"); arrows fewer and only where there is overflow; better color scale; DG2 charts. Pending: definition of "desbordamiento" for the arrow filter.
- **L9** (2026-11-19) User: "Si, ve con la opción 1" (overflow = outside the D8 channel network). T4-T7 opened. Caveat: no coastal NASADEM tile cached; NASADEM has no bathymetry, so with eta = 0 over a flat 0 m sea the start depth is 0 and HFIX acts as a sea-level sink.
- **L10** T4 evidence: in DG2 8.0.3 HFIX copies the interior velocity, so a dry domain at rest gets no mass flux (0% of the sea filled in 300 s on the real DEM); the still-water start keeps 100% volume, eta within +-3 cm, speed <= 0.23 m/s where h >= 0.15 m; residual adjustment at partially submerged shore cells. H1 = -Z1 measured best of {-Z1, 0, +Z1}.
- **L11** T5 decision: priority-flood pit filling added to the v2 D8 area rule because the unfilled network had 1 channel cell of 1680 (option 1 would have collapsed into option 2); reported to the user.
- **L12** Suites: pipeline 467 pass (4 test_solar_api fail on base too); backend flood 14/14; web node 104/104, build OK, lint 0 errors (6 base warnings). Pending: real coastal run (needs a coastal NASADEM tile via Earthdata) and hydraulic validation with a real event. LaTeX proposal `docs/latex/propuesta_fronteras_dg2.{tex,pdf}` left uncommitted.
- **L13** (2026-11-19) User: "Haz la corrida real en la costa con Earthdata y la validación hidráulica". Coastal runs on n15w093 (La Encrucijada, nonurban mangrove coast): NASADEM ocean = 0 m (no voids); eta 0 run 3b547b35 succeeded (sea start depth 0, mass error 0.7 m3); eta 1 run fd0eee2f succeeded (977 sea cells, ~57,000 m3 left through free N/E sides the sea touches: setup issue). Validation not started: needs an event decision and components that do not exist.
- **L14** (2026-11-19) User: "lo que hace la simulacion de inundacion en terrapulseai_v2.1 lo hace tambien nuestro simulador? Por cierto, agrega Infiltración y Presión atmosférica, como lo hace ese simulador." v2.1 simulate.py identical to ours; its panel still calls it. T8 opened.
- **L15** T8 real coastal run dfaef3bb (n15w093, eta 0 + 990 hPa -> +0.237 m, N/E closed): sea started full in 971 cells and held; solver rain 18,412 m3 = 0.656 x 28,073 m3; mass error 5.6 m3. i18n test renamed: the panel now offers pressure through the ROI API, not the old simulator state.
