# Flood hydraulic validation (DG2 vs a real event)

Objective: validate the DG2 flood simulator once against a real rain event (IMERG rain in, observed water out) and record the metrics.
Branch: `feature/flood-ui-dg2`. Delivery: `ask-on-risk`. Runners: `pytest` (pipeline), `manage.py test` (backend).

## Specs

- S1 Event: find a real rain event over the ROI with IMERG ("la búsqueda del evento real de IMERG") that has an independent water observation close in time (NISAR GCOV pass, or OPERA DSWx as agreement only).
- S2 Observation: build the observed water mask for the event from that source, with provenance (scenes, dates, thresholds).
- S3 Real rain: "hacer que el simulador lea esos datos de IMERG y los use en lugar de la lluvia inventada" — only for validation; synthetic scenarios stay the main use.
- S4 Domain: a domain that fits the solver budgets, pluvial (no river inflow: "no tomaremos en cuenta las entradas de ríos").
- S5 Metrics: `validate.py` with precision, recall, F1 and IoU of simulated maximum extent vs observed mask; Manning and infiltration fixed before comparing.
- S6 Report: results and limitations (IMERG Late, not Final, for 2026; observation timing; resolution).

## Tasks

- [ ] T1 S1 event search (inline, scratch scripts; evidence in Log) — blocked: no observable pluvial event in the ROI (L4-L6)
- [x] T2 S3 IMERG rainfall reader -> DG2 rainfall input (inline) — 582500f, 42b4bc4
- [ ] T3 S2 observed water mask (inline)
- [x] T4 S5 validate.py metrics (inline) — 2b04bd5
- [ ] T5 S4+S6 validation run and report (inline)

## Log

- L1 (2026-11-19) User: "Ok, entonces haz la validación y las cosas que faltan"
- L2 GES DISC authorized by the user after a 403. IMERG Final (GPM_3IMERGHH) has 0 granules for 2026-06..11; Late run (GPM_3IMERGDL/HHL) is available to 2026-11-18.
- L3 NISAR GCOV over the ROI (catalog 2026-11-20T01:14Z): T55/T62 every 12 days 2026-06-18..10-16 (P05023, no 08-05), T156 06-25..10-11; P05036 pairs T55/T62 10-28 & 11-09, T156 10-23 & 11-04. OPERA DSWx-S1: 76 dates, DSWx-HLS: 83 dates over the ROI.
- L4 IMERG Late daily over the ROI 2026-06..11: wettest days 07-28 (max cell 78.6 mm), 06-09, 09-23, 10-02, 10-08; 09-23..10-04 adds ~200 mm ROI mean.
- L5 NISAR T62 09-22 -> 10-04 (COMPARABLE, 99.6 % ROI valid): new open water (HH<-16 & HV<-22 dB, drop >3 dB, 3x3 median) = 645 px (6.5 ha) in 452 specks, largest 14 px. No observable flood. Rain in the 24 h before the 11:40 UTC pass: ~23 mm ROI mean, peak 8.2 mm/h 7.5 h before.
- L6 Rain the day before / day of each of the 34 NISAR passes: none falls within hours of a storm; best T156 09-17 00:49 UTC, but the 09-16 storm (max cell 48 mm) ended before 12:00 UTC 09-16 (>13 h earlier). Pluvial water in this hilly ROI drains long before the 12-day-revisit passes.
- L7 Full pipeline suite (solar excluded: pvlib missing in env): 376 passed, 1 failed test_dg2_runner::...without_t030 under load; passes alone 2/2 and on base. Backend: 30 tests, 1 error = pvlib import (same on base).
- L8 (2026-11-20) User: "Si, busca un evento en la costa o en algún lugar donde puedas hacer la validación."
- L9 Coast/Tabasco search: NISAR over Chiapas coast (T55, T62, T156, T163) and Tabasco (T55, T62, T156). Best event: 2026-10-15 coastal storm near Pijijiapan, IMERG Late 03:30-12:00 UTC, up to 118 mm/cell (peak ~33 mm/h), 40-100 mm on land cells; heaviest cell offshore.
- L10 NISAR T55 F81 10-04 -> 10-16 00:40 UTC (13 h after the storm, COMPARABLE): new open water on land (NASADEM > sea, outside pre-water) = 0.56 km² of 1616 km². No observable flood.
- L11 OPERA DSWx-S1 tile T15PVT: the 10-15 12:09 UTC pass (storm end) covers <1 % of the AOI (tile edge). 10-04 -> 10-16 12:01 UTC (24 h after): new water 6.9 km² vs vanished 9.0 km² of ~550 km² water: noise level, no flood.
- L12 Conclusion: no satellite observation in Jun-Nov 2026 captures pluvial open-water flooding in the ROI or on the coast; validation with open-water masks is not feasible for this period. Data kept in data/raw/validation-coast*, data/raw/validation-dswx, data/nasadem-validation.
