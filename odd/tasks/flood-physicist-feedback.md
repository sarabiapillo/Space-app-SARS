# Flood DG2: physicist feedback (image, flow arrows, boundaries)

Objective: address the physicist's three requests on the ROI DG2 flood simulation. Branch: `feature/flood-ui-dg2`.
Delivery: work-unit commits on the feature branch (ask-on-risk). Runners: `pytest` (conda `nisar`), `python backend/manage.py test`, `node --test` + `npm run build` + `npm run lint` in `web/`.

## Specs

- **S1** Image download. Physicist (verbatim): "que puede dscras uan imagens de eso". The results card offers a direct PNG download of the selected depth frame; the existing map capture tool (PNG/JPG) also includes the WebGL flood layer and the arrows.
- **S2** Flow arrows. Physicist (verbatim): "que muestre flechas para indicar el flujo". Arrows come from solver velocities (LISFLOOD-FP `voutput`, `.Vx/.Vy` = HU/H), not invented. Sign convention verified empirically: Vx positive east, Vy positive north. Arrows only where depth >= 0.03 m (same threshold as the PNG palette), because thin films give spurious HU/H speeds (up to 11 m/s at h < 0.03 m in the real run).
- **S3** Boundary conditions. Physicist (verbatim): "mejorar las condiciones de frontera". The DG2 solver supports FREE, HFIX, HVAR, QFIX and QVAR per boundary segment. The exact improvement is pending a user decision.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | inline | done | `9ebd6d0`; browser: PNG download named `roi-0001.wd.png`, file is PNG |
| T2 | S2 | inline (backend: voutput + flow vectors in results/API) | done | `753d63b`; RED 10 -> GREEN 49; pipeline 440 pass (4 solar_api fail on base too); backend 10/10 |
| T3 | S2 | inline (frontend: MapLibre arrow layer + toggle) | done | `9ebd6d0`; node 99/99, build OK, lint 0 errors (6 warnings on base too); browser 16/16 |
| T4 | S3 | inline | blocked: needs user decision | |

Route evidence: no Writer trigger (units depend on each other or are under ~100 lines; no parallel batch). Risk: T2 adds an optional result field and a solver keyword (`voutput` does not change `.wd`/`.max`: byte-identical in a real rerun).

## Log

- **L1** (2026-11-19) User, after the three pending items were listed: "Si, encaralos".
- **L2** Prior commits for pending work: `dc44f8a` (rain-inclusive mass balance), `52cb9f6` (narrow-screen panel).
- **L3** Evidence: rerun of real job 727e18e2 with `voutput` in scratch: `.wd`/`.max` identical; corr(Vx, downhill east) 0.81/0.54, corr(Vy, downhill north) 0.65/0.64 on frames 1-2 (h > 0.05 m). Frame 3 ponded (corr ~0).
- **L4** Real outputs with voutput: 39-64 arrows per frame, flow JSON 6.7 KB. Arrow icon enlarged after the first screenshot (pixelRatio 2 was too small to read).
- **L5** Browser check `web/.browser-check/tooling/flow-check.mjs` (synthetic HTTP fixtures, not hydraulic validation): 16 assertions pass; screenshot shows north/east/SSW arrows sized by speed. RDD is off globally: no native review.
- **L6** Next: T4 waits for the user decision on boundary conditions.
