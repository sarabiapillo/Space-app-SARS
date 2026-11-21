# Open rainfall sources for a pluvial flood simulator (LISFLOOD-FP DG2, ~1–10 km² domains)

Scope note: research done 2026-11-20 with web search (17 search calls, no full-text fetches). Most claims below come from official product pages, data repositories or abstracts as surfaced by search; where only a snippet or third-party page was available this is stated. Current pipeline baseline: synthetic rain (user amount/duration, seeded profile) or GPM IMERG V07 Late half-hourly (GPM_3IMERGHHL) averaged over the 0.1° cells touching the domain.

## Satellite and merged precipitation products (replaying real events)

### Takeaway
IMERG V07 remains the best default for replaying events anywhere (0.1°/30 min, free, already integrated), but it has no gauge input in Early/Late and is documented to strongly underestimate hourly extremes over Mexico (−61 % relative bias for extreme hourly events in a V03-era study). GSMaP (0.1°/hourly, gauge-adjusted NRT variant, commercial use allowed with prior notice) is the most valuable second satellite source; MSWEP is technically attractive (0.1°, NRT ~3 h, V3 hourly) but CC BY-NC, so it is unsuitable for any commercial deployment. CHIRPS is daily at best and its daily values are disaggregated, so it is of little use for sub-daily pluvial forcing.

### Cited Findings

**GPM IMERG V07 (NASA)**
- IMERG Early is available ~4 h after observation, Late ~14 h after; Final (satellite-gauge) ~3.5 months after the observation month — [IMERG V07 Technical Documentation](https://gpm.nasa.gov/resources/documents/imerg-v07-technical-documentation); one NASA catalog page states "about 4 months" for Final — [Earthdata catalog GPM_3IMERGHHL](https://www.earthdata.nasa.gov/data/catalog/ges-disc-gpm-3imerghhl-07) (minor conflict on Final latency).
- In V07, Early and Late have no direct gauge input; they receive a monthly *climatological* calibration obtained by averaging the concluding calibrations computed in Final — [IMERG V07 Technical Documentation (copy, Univ. Hamburg ICDC)](https://www.cen.uni-hamburg.de/en/icdc/data/atmosphere/docs-atmo/imerg-v07-technical-documentation.pdf).
- Final half-hourly values are rescaled so that they sum to the Final monthly satellite–gauge combination (gauges enter only at monthly scale) — [IMERG V07 Technical Documentation](https://gpm.nasa.gov/resources/documents/imerg-v07-technical-documentation).
- NASA recommends Final for research unless latency requires Early/Late; V07 reprocessed the full TRMM–GPM record and supersedes earlier versions — [IMERG Final Run, NASA GPM](https://gpm.nasa.gov/taxonomy/term/1417).
- Mexico evaluation (Mayor et al., 2017, Remote Sensing 9(5):503; early IMERG version): first IMERG evaluation over Mexico; hourly mean correlation 0.35; better at daily/seasonal scales; extreme events "highly underestimated" with relative biases of −61 % (hourly) and −46 % (daily); errors smaller over higher terrain — [Mayor et al. 2017, MDPI Remote Sensing](https://www.mdpi.com/2072-4292/9/5/503).
- A 2024 Remote Sensing study evaluated IMERG Final V06 against gauges at hourly/daily scales in semiarid Zacatecas (2019–2021); its extreme-magnitude results were not visible in the snippet — [Remote Sensing 16(2):273](https://doi.org/10.3390/rs16020273).
- Continental evaluation of IMERG V07B at sub-daily scale exists (NCAR OpenSky listing); content not retrieved — [Continental evaluation of GPM IMERG V07B on a sub-daily scale](https://www.cgd.ucar.edu/opensky-publications/articles:43155/continental-evaluation-of-gpm-imerg-v07b-precipitation-on-a-sub-daily-scale).
- Direction of extreme bias is region-dependent: a Malaysia study found IMERG overestimates daily rates above the 95th percentile, while citing Mayor et al. for underestimation over Mexico — [da Silva et al., UEA eprints](https://ueaeprints.uea.ac.uk/80260/1/dasilvaetal_accepted.pdf).

**GSMaP (JAXA)**
- Product family: GSMaP_NRT (provisional, replaced when MVK is available), GSMaP_Gauge_NRT (gauge-calibrated near-real-time; v8 from 2021-12-01), GSMaP_Gauge (gauge-calibrated standard; v8 from 1998-01-01), GSMaP_NOW / Gauge_NOW (effective data within 30 min of observation; v8 from 2021-12-06) — [GSMaP FAQ 01](https://sharaku.eorc.jaxa.jp/GSMaP/faq/GSMaP_faq01.html); [GSMaP Hourly page](https://eolp.jaxa.jp/GSMaP_Hourly.html).
- Download requires G-Portal user registration; G-Portal data "may be used freely and free of charge by anyone without any restrictions, including for commercial purposes", limited to peaceful use, with source credit and prior notice for commercial use; recommended credit "GSMaP data by Japan Aerospace Exploration Agency (JAXA)" — [G-Portal EULA](https://gportal.jaxa.jp/gpr/index/eula); [GSMaP Terms of Use](https://sharaku.eorc.jaxa.jp/GSMaP/registration.html).
- The sharaku.eorc terms page points to a separate JAXA "Terms of Use of Research Data" that was not checked — [GSMaP registration/terms](https://sharaku.eorc.jaxa.jp/GSMaP/registration.html).
- GSMaP v7 operational hourly is also exposed in Google Earth Engine — [GEE catalog JAXA/GPM_L3/GSMaP/v7/operational](https://developers.google.cn/earth-engine/datasets/catalog/JAXA_GPM_L3_GSMaP_v7_operational?hl=th).

**MSWEP / MSWX (GloH2O)**
- MSWEP is licensed CC BY-NC 4.0; non-commercial users apply via a form; commercial affiliates must apply separately — [ICDC Univ. Hamburg, MSWEP](https://cen.uni-hamburg.de/en/icdc/data/atmosphere/mswep-precipitation-amount.html).
- MSWX is reported as CC BY-NC 4.0 by a third-party guide (not official) — [MSWX guide (third-party)](https://kaushikreddym.github.io/climdata/MSWX_guide/).
- MSWEP V2.8: 3-hourly, 0.1°, 1979–present; NRT variant latency ~3 h, built from ERA5, GDAS, GSMaP and IMERG — [UCAR Climate Data Guide, MSWEP](https://climatedataguide.ucar.edu/climate-data/global-high-resolution-precipitation-mswep); [ICDC MSWEP](https://www.cen.uni-hamburg.de/en/icdc/data/atmosphere/mswep-precipitation-amount.html).
- MSWEP V3 (preprint, 2026): 0.1° **hourly**, 1979–present, ML-based, latency ~2 h (vs 3–4 h for V2) — [arXiv 2602.01436](https://arxiv.org/abs/2602.01436).

**CHIRPS (UCSB Climate Hazards Center)**
- CHIRPS v3 operational since January 2025; CHIRPS v2 production ends after December 2026 — [UCAR Climate Data Guide, CHIRPS v3](https://climatedataguide.ucar.edu/climate-data/chirps-climate-hazards-infrared-precipitation-station-data-version-3); [CHC data](https://www.chc.ucsb.edu/data).
- CHIRPS v3 is pentad-based; daily products are obtained by partitioning pentads using ERA5 ("rnl") or IMERG ("sat"); CHC warns daily estimates are downscaled and "should be used with caution, particularly when investigating daily extremes" — [UCAR Climate Data Guide](https://climatedataguide.ucar.edu/climate-data/chirps-climate-hazards-infrared-precipitation-station-data-version-3); [CHC](https://chc.ucsb.edu/node/497).
- CHIRPS-GEFS: bias-corrected 0.05° version of GEFS 00 UTC ensemble-mean total precipitation; 5/10/15-day forecasts updated daily; v3-compatible since October 2025; no sub-daily version found — [CHC data](https://www.chc.ucsb.edu/data); [USGS FEWS CHIRPS 3.0](https://earlywarning.usgs.gov/fews/product/175).

**CMORPH and PERSIANN family**
- CMORPH CDR (NOAA, bias-corrected V1) produced manually once a month with 3–4 month latency; record listed 1998-01-01 to 2024-08-31; mirrored at NCAR RDA (d502002); access constraints "none" — [NCAR RDA d502002](https://rda.ucar.edu/datasets/d502002); [UCAR CKAN CMORPH CDR](https://ckanprod-alma.ucar.edu/dataset/noaa-climate-data-record-cdr-of-cpc-morphing-technique-cmorph-high-resolution-global-precipitat).
- PERSIANN-CCS: 0.04°, hourly, 60°S–60°N, ~1 h latency (2018 table); PDIR-Now intended to supersede it with 15–60 min latency — [HESS 22, 5801 (2018), Table 1](https://hess.copernicus.org/articles/22/5801/2018/hess-22-5801-2018-t01.pdf); [PDIR-Now, J. Hydrometeorol. (NTRS)](https://ntrs.nasa.gov/api/citations/20210016443/downloads/%5B15257541%20-%20Journal%20of%20Hydrometeorology%5D%20PERSIANN%20Dynamic%20Infrared%E2%80%93Rain%20Rate%20(PDIR-Now)%20A%20Near-Real-Time%2C%20Quasi-Global%20Satellite%20Precipitation%20Dataset.pdf).
- PERSIANN-CCS-CDR: 0.04°, 3-hourly, 1983–present, 60°S–60°N — [eScholarship](https://escholarship.org/content/qt60b479q9/qt60b479q9.pdf?t=rhsfkq).
- NCEI listed PERSIANN-CDR as "experiencing a pause in operations due to processing delays" — [NCEI PERSIANN CDR](https://www.ncei.noaa.gov/node/8306) (date of notice unknown).
- Global sub-daily evaluation (Xiong et al., 2025, per search summary) reports IMERG struggles with moderate-to-extreme events, especially >5 mm/h — cited via search summary of [UCAR OpenSky listing](https://www.cgd.ucar.edu/opensky-publications/articles:43155/continental-evaluation-of-gpm-imerg-v07b-precipitation-on-a-sub-daily-scale) (attribution uncertain; verify).

### Inferences
- Priority HIGH: keep IMERG (Late for NRT, **switch to Final whenever the event is older than ~4 months**, since only Final carries monthly gauge correction). Minimal integration effort (same GES DISC/Earthdata flow, product GPM_3IMERGHH instead of HHL).
- Priority HIGH/MEDIUM: GSMaP_Gauge_NRT / GSMaP_Gauge (hourly 0.1°) as an independent second estimate to show forcing uncertainty (ensemble of 2 products). Moderate effort: separate G-Portal account, SFTP/HTTP download, different binary/NetCDF format. Licence fits a public open platform.
- Priority MEDIUM (non-commercial only): MSWEP V2.8/V3 — gauge-informed and multi-source, likely better for extremes than single satellite products, but CC BY-NC and gated by application form; would block any commercial deployment and adds an approval step.
- Priority LOW: CHIRPS (daily, disaggregated daily values not suitable for flash pluvial floods); CMORPH CDR (3–4 month latency, record apparently ends 2024-08); PERSIANN-CCS/PDIR-Now (IR-only, useful only as very-low-latency fallback).
- Given the −61 % hourly extreme bias over Mexico, simulated depths from satellite forcing should be labelled as likely underestimates for convective storms; this matches the project's "no afirmar exactitud" principle.
- With a 1–10 km² domain, a single 0.1° (~11 km) IMERG/GSMaP cell or the mean of 1–4 cells already represents an area larger than the domain, so satellite rain is effectively an areal average, which smooths peak intensities.

### Gaps
- No V07-specific evaluation of IMERG over Mexico/Chiapas for sub-daily extremes was retrieved; Mayor et al. used an early IMERG version. Whether V07 reduced the extreme underestimation in southern Mexico is unverified.
- No published GSMaP vs IMERG comparison over Chiapas/Central America for hourly extremes was found in this pass.
- Exact GSMaP latency for Gauge_NRT (commonly cited as ~4 h for NRT) was not confirmed from an official page in this pass.
- Whether CMORPH CDR continues past 2024-08 (or a CMORPH2 replacement) was not confirmed.
- MSWEP V3 is a preprint; its public availability and licence for V3 were not confirmed.

## Reanalysis (ERA5 / ERA5-Land)

### Takeaway
ERA5 provides global hourly precipitation since 1940 with ~5-day latency under a CC-BY-type Copernicus licence, but its rain-rate distribution has too much light rain and too little heavy rain; it caps hourly intensities far below observed convective peaks. It is useful for context or long climatologies, not for driving pluvial flood peaks in convective tropical regions like Chiapas.

### Cited Findings
- ERA5 hourly data from 1940, updated daily with ~5-day latency (ERA5T, preliminary); final ERA5 replaces ERA5T ~2–3 months later; ERA5T can differ (e.g., Sep–Dec 2021 final differs from ERA5T) — [CDS ERA5 hourly time series](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels-timeseries); [Copernicus EQC](https://eqc.climate.copernicus.eu/node/4628).
- Copernicus licence: Creative Commons, CC BY (attribution only); hourly data DOI 10.24381/cds.bd0915c6 — [CEDA catalogue ERA5](https://catalogue.ceda.ac.uk/uuid/8177330a5f2443059b7107188c2ab3c1/).
- Regridded ERA5 hourly total precipitation on a 0.25° grid — [Hydroweb.next, C3S ERA5 hourly total precipitation](https://hydroweb.next.theia-land.fr/catalog/details/C3S_CDS_TOTAL_PRECIPITATION_ERA5_HOURLY).
- An ERA5-Land-T (near-real-time ERA5-Land) service was launched by C3S — [C3S, ERA5-Land-T service](https://climate.copernicus.eu/c3s-launches-new-era5-land-t-service).
- Heflin et al. (2026, JGR-Atmospheres, PNNL summary): ERA5 has too much light rain and too little heavy rain, underestimating tropical MCS precipitation intensity and share by 25–34 % in key regions; "should be used with caution for event-level precipitation features" — [PNNL publication summary](https://www.pnnl.gov/publications/era5-represented-tropical-storm-clouds-better-their-rainfall).
- Indian monsoon study (preprint): ERA5 hourly intensities cap near 25 mm/h while gauges exceed 110 mm/h; overestimates very light rain (<1.5 mm/h) — [arXiv 2603.24374](https://arxiv.org/pdf/2603.24374) (not peer-reviewed).
- ERA5 land diurnal peak too strong and 1–2 h too early compared with IMERG — [arXiv 2603.25936](https://arxiv.org/pdf/2603.25936) (preprint).
- Beck et al. (2019), as cited in a 2024 preprint: ERA5 outperforms IMERG over mountainous terrain but does worse where short-lived convection dominates — [GMD preprint gmd-2024-66](https://gmd.copernicus.org/preprints/gmd-2024-66/gmd-2024-66-manuscript-version2.pdf).

### Inferences
- Priority LOW for event replay in Chiapas (convective, tropical); MEDIUM as a fallback where satellite data are missing or as the basis for ERA5-derived return levels (see IDF section) with explicit underestimation warning.
- Integration effort moderate: CDS API (`cdsapi`) with a separate Copernicus account; queue-based requests can be slow.
- ERA5-Land (finer grid) inherits ERA5 precipitation forcing, so it likely does not fix the convective-intensity bias (inference; not verified in this pass).

### Gaps
- ERA5-Land grid spacing (commonly 0.1°) and whether its precipitation is simply interpolated ERA5 were not verified with a source in this pass.
- Current (2026) CDS licence wording and ERA5T revision schedule were not read directly.
- No ERA5 hourly-extremes evaluation specific to Mexico was found.

## Forecasts with open data ("what if tomorrow" scenarios)

### Takeaway
ECMWF open data (IFS and AIFS, CC-BY-4.0, 0.25°, reportedly 0.1° IFS since 2026-10-20) and NOAA GFS (0.25°, hourly to 120 h via NOMADS) and GEFS (0.25°, 3-hourly, ensemble) are freely accessible worldwide and suitable to build "tomorrow" scenarios. At 0.25°–0.1° grid spacing they cannot place a convective cell on a 1–10 km² domain; they are best used as an ensemble of plausible totals/timings, clearly labelled as forecasts. HRRR is CONUS-only and irrelevant for Chiapas.

### Cited Findings
- ECMWF real-time IFS and AIFS open-data subset is free under CC-BY-4.0 plus ECMWF Terms of Use; produced at 0.25° in GRIB2 unless stated otherwise — [ECMWF open data](https://ecmwf.int/en/forecasts/datasets/open-data).
- AIFS open data on a regular 0.25° grid — [ECMWF AIFS machine learning data](https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data); [Set IX – AIFS](https://ecmwf.int/en/forecasts/datasets/set-ix).
- One ECMWF page states that from 2026-10-20 a 0.1° IFS resolution is published alongside 0.25° (AIFS remains 0.25°); another ECMWF page still describes the 9 km subset as "later in 2026" — [ECMWF open data](https://ecmwf.int/en/forecasts/datasets/open-data); [ECMWF to achieve fully open data status in 2025](https://www.ecmwf.int/node/29328) (inconsistent; verify).
- GFS on NOMADS: `gfs_0p25_1hr` 1-hourly output to 120 h; 3-hourly 0.25° to 384 h; cycles 00/06/12/18 UTC — [NOMADS](https://nomads.ncep.noaa.gov); [NCO GFS NOMADS products](https://www.nco.ncep.noaa.gov/pmb/products/gfs/nomads/).
- GFS on AWS (NOAA Big Data Program/Open Data Dissemination): 0.25° and 0.5° analyses and forecasts; rolling archive — [NCEI GFS](https://www.ncei.noaa.gov/products/model-data/model-datasets/global-forcast-system-gfs); historical archive at [NCAR GDEX d084001](https://gdex.ucar.edu/datasets/d084001/).
- GEFS on AWS: 1.0/0.5/0.25°, 2017–present, 4 cycles/day, 3-hourly to +384 h; virtual Zarr copies by dynamical.org — [NCEI GEFS](https://ncei.noaa.gov/products/weather-climate-models/global-ensemble-forecast); [AWS registry dynamical-noaa-gefs](https://registry.opendata.aws/dynamical-noaa-gefs/).
- MRMS (radar+gauge, hourly since 2014) exists but covers CONUS only — per search summary of [AWS Public Sector Blog](https://aws.amazon.com/blogs/publicsector/what-if-swapping-your-weather-model-was-boring-how-dynamical-org-is-making-ai-weather-forecasting-accessible-on-aws/).

### Inferences
- Priority MEDIUM: GFS 0.25° hourly (NOMADS grib filter allows sub-region + single variable downloads, very low effort, no login) for a deterministic "tomorrow" scenario; ECMWF IFS open data (Python `ecmwf-opendata` client) as a second model. GEFS (3-hourly) or ECMWF ENS for an ensemble spread scenario.
- Forecast QPF should feed the same hyetograph/uniform-rain adapter as IMERG; outputs must be labelled "pronóstico" (prediction), consistent with AGENTS.md's observation/inference/prediction distinction.
- Coarse global NWP smooths convective peaks; a pragmatic approach is to use the forecast 24-h total to pick a return period/design storm shape rather than using the raw hourly series.
- HRRR: priority NONE for Chiapas (US-only).

### Gaps
- ECMWF open-data precipitation time step (e.g., 3-hourly vs 6-hourly beyond certain lead times) was not verified.
- Whether 0.1° IFS open data is actually live since 2026-10-20 is unconfirmed (conflicting ECMWF pages).
- Exact licence text for NOAA data (generally treated as public domain) was not read in this pass.
- No skill evaluation of GFS/ECMWF hourly QPF over southern Mexico was retrieved.

## Ground stations and radar in Mexico (optional add-on)

### Takeaway
Mexico has daily climatological records (CLICOM, ~5,500 stations, mirrored by UCAR/EOL) and automatic stations (EMAs, 10-min data) plus a radar network, but no well-documented, stable public API for sub-daily data or radar rasters was confirmed. The SMN publishes a "web-service-api" page whose endpoints and terms could not be verified, and the radar viewer has reportedly been unreachable outside Mexico. Treat Mexican ground/radar data as a later, best-effort add-on.

### Cited Findings
- CLICOM daily surface dataset from SMN distributed "as is", one file per state, via UCAR/EOL; GASIR data are the first operational review and CLICOM the final official set — [UCAR EOL CLICOM readme](https://data.eol.ucar.edu/datafile/nph-get/82.175/clicom_readme.html); [UCAR CLICOM dataset](https://data.ucar.edu/dataset/cbb31f33-0592-4c1b-9f1e-897f8eef77a3).
- A CONAGUA presentation mentions ~5,500 climatological stations — [gob.mx, Estaciones Meteorológicas](https://www.gob.mx/cms/uploads/attachment/file/449572/12.__EstacionesMeteorol_gicas_RH.pdf).
- ASF (Auditoría Superior) 2024 audit reports operational indicators for meteorological stations (percentage operating) — [ASF audit 2024-0103](https://www.asf.gob.mx/Trans/Informes/IR2024b/Documentos/Auditorias/2024_0103_a.pdf).
- A Tamaulipas state project cites the official CONAGUA/SMN API at `https://smn.conagua.gob.mx/es/web-service-api` as its data source (third-party reference) — [Tamaulipas documentation](https://documentacion.tamaulipas.gob.mx/books/servicio-de-informacion-meteorologica/page/referencias-y-fuentes-de-datos/export/pdf).
- SMN radar viewer URL reported on a Windy forum; same thread reports the SMN site unreachable via DNS outside Mexico — [Windy Community](https://community.windy.com/topic/41380/the-radar-in-mexico-city-does-not-work) (anecdotal).
- NMX-AA-166/1-SCFI-2013 sets specifications for automatic and conventional weather stations — per search summary of [mley.mx](https://mley.mx/normas/archivos/7796b93d18693a2c8c6daf18630cb16f9e258e6ecfdc461993fa630b5251a053.pdf).

### Inferences
- Priority LOW–MEDIUM (Mexico only): CLICOM daily is useful for validating/bias-checking IMERG daily totals near Chiapas and for local IDF fitting (annual maxima of 24-h rain), not for hyetograph shape.
- EMA 10-min data would be the most valuable ground source for event hyetographs, but access route, latency and licence are unconfirmed; requires manual verification from inside Mexico.
- Radar: no evidence of downloadable quantitative radar rainfall (QPE) grids; low priority.

### Gaps
- The SMN web-service-api endpoints, content (it may only serve municipal forecasts), rate limits and licence were not verified.
- EMA data access method (historical 10-min downloads, request process), latency and licence unknown.
- No documentation found of SMN radar QPE products or their coverage over Chiapas.
- Licence for Mexican government data (e.g., "Libre Uso MX") was not verified for SMN datasets.

## Design storms, IDF / return periods and design hyetographs

### Takeaway
Two open global datasets give return-period depths usable anywhere: GPEX (MSWEP-based, 0.1°, 3 h–10 d, CC BY 4.0) and PXR-2/PXR-4 (ERA5-based GEV parameters, ~31 km, 1–360 h, with a continuous IDF formula). Neither covers sub-hourly durations, and both inherit the underestimation of short convective extremes of their parent products, so they give conservative (likely low) depths for 1–3 h storms in Chiapas. In Mexico, SCT isoyetas give intensities for 5–240 min durations and return periods of 10/20+ years. A design hyetograph can then be built by the alternating block method from an IDF curve, or with Huff/SCS dimensionless curves from a total depth.

### Cited Findings
- GPEX (Gründemann et al., J. Hydrol. 621, 129558, 2023): global return levels derived from MSWEP for 8 durations from 3 h to 10 days, using GEV, POT and MEV; MEV gives more spatially coherent patterns; latest version v4 (2021-08-30); CC BY 4.0; NetCDF; DOI 10.4121/12764429 — [4TU.ResearchData GPEX](https://data.4tu.nl/datasets/9c547b34-f9d0-410c-be38-f0bdb46318cf); [TU Delft repository](https://repository.tudelft.nl/record/uuid:1130d41c-7314-434e-85d1-74eb226cd847).
- GPEX caveat: for 5- and 10-day durations MEV relies on few events per year and may overstate extremes — per search summary of [GPEX record](https://dx.doi.org/10.4121/12764429.v2).
- Courty et al. (2019, ERL 14:084045): PXR-2 = global maps of GEV parameters for 19 durations (1–360 h) at 31 km resolution from reanalysis annual maxima (ERA5); PXR-4 = universal IDF formula for a continuous range of durations, within ±20 % of PXR-2 for 2–360 h; data on Zenodo DOI 10.5281/zenodo.2651343 — [DOAJ abstract](https://doaj.org/article/f635f3242dab4e1f8d7462c826ece502); [Loughborough repository](https://repository.lboro.ac.uk/articles/Intensity-duration-frequency_curves_at_the_global_scale/9693518); [MIT RDI Zenodo record](https://rdi.libraries.mit.edu/record/zenodo:2651343).
- Mexico SCT/DGST isoyetas of rainfall intensity (mm/h) for return period 10 years (and 20 years), durations 5–240 min, reproduced by CENAPRED for Oaxaca — [CENAPRED Isoyetas Oaxaca (PDF)](https://www1.cenapred.unam.mx/SUBCUENTA/23a%20SESI%c3%93N%20ORDINARIA/PUNTO_Proyecto_Puentes/Actividades%205.1%20y%205.2/01%20Antes%20de%20la%20temporada%20de%20huracanes/05%20CAZADERO/Isoyetas%20Oaxaca.pdf).
- In Mexico IDF (IDT) curves are commonly built with Bell (1969) relationships / Chen's formula; a 2010 study fitted Chen + GEV and checked against 10 pluviograph stations — [Ingeniería, Investigación y Tecnología (Redalyc)](https://www.redalyc.org/pdf/404/40412515005.pdf); UNAM thesis summary [ru.dgb.unam.mx](https://ru.dgb.unam.mx/jspui/bitstream/20.500.14330/TES01000232618/3/0232618.pdf).
- Alternating block method: compute incremental depths for Δt, 2Δt, … from the IDF curve, place the maximum increment at the centre and the rest in descending order alternately right and left — [UT Austin CE374K Hydrologic Design lecture](https://www.caee.utexas.edu/prof/mckinney/ce374K/Overheads/21-HydrologicDesign.pdf).
- Huff curves: dimensionless curves grouped by quartile of peak; SCS developed dimensionless types I, IA, II, III for US regions — per search summary of [UT Austin lecture](https://www.caee.utexas.edu/prof/mckinney/ce374K/Overheads/21-HydrologicDesign.pdf) and [Duka et al. 2018, JESAM](https://ovcre.uplb.edu.ph/journals-uplb/index.php/JESAM/article/view/112).
- Duka et al. (2018): alternating-block hyetographs from official RIDF curves "do not always represent actual storms well"; other methods (actual normalized storms, four Huff patterns) fit some storms better — [JESAM, UPLB](https://ovcre.uplb.edu.ph/journals-uplb/index.php/JESAM/article/view/112).
- EGU24-6064 compared alternating-block versus actual Florida storm hyetographs via flood extent and depth — [EGU24-6064](https://meetingorganizer.copernicus.org/EGU24/EGU24-6064.html).
- GSDR-IDF (Scientific Data, 2026): IDF curves for each gauge of the Global Sub-Daily Rainfall dataset (>24,000 hourly records), durations 1/3/6/24 h, return levels 10/30/100 years, archived on Zenodo — per search summary pointing to [Zenodo record 15473689](https://zenodo.org/records/15473689) (record identity not opened; verify).
- BURGER: gauge-based ML regionalization of global sub-daily IDF, 0.1°, durations 1/3/6/12/24 h, return periods 2–10,000 years; restricted access, CC BY-NC-SA 4.0 — [Univ. Bristol, BURGER](https://research-information.bris.ac.uk/en/publications/burger-a-bottomup-regionalization-approach-for-global-subdaily-in/).
- No global IMERG-derived IDF dataset was found; regional studies exist (a 2022 Remote Sensing study derived IDF from IMERG Final half-hourly vs dense gauges, Gumbel fitting best; a 2023 Colombian study with IMERG V06B vs 110 gauges found large errors) — [Univ. Arizona, IDF using IMERG](https://experts.arizona.edu/en/publications/understanding-intensitydurationfrequency-idf-curves-using-imerg-s/); [Rev. Fac. Ing. Univ. Antioquia 2023](https://doaj.org/article/c4014b29453d4f6bb1f91544649f8364).
- Known alternating-block property: shorter-duration hyetographs are nested inside longer ones (same peak) — [Eng-Tips forum](https://www.eng-tips.com/viewthread.cfm?qid=430195) (anecdotal, consistent with the method).

### Inferences
- Priority HIGH: implement a "tormenta de diseño" mode: user picks return period T and duration D; depth from GPEX (3 h/6 h/12 h/24 h) or PXR-4 (continuous 1–360 h) at the domain centroid; hyetograph by alternating block (needs an IDF curve, which PXR-4 provides as a continuous formula) or by a dimensionless profile (Huff quartile or SCS type) when only a single depth is known. Integration effort low: static NetCDF/GeoTIFF files downloaded once, point lookup, no API.
- For sub-hourly (10–60 min) depths, the global datasets do not reach below 1 h (PXR) or 3 h (GPEX); extrapolation via PXR-4's formula below 2 h is outside its stated ±20 % validity range. Label sub-hourly design storms as extrapolated.
- Both datasets inherit parent biases (ERA5 and MSWEP smooth convective extremes), so return levels are likely conservative (low) for short durations in tropical convective climates; document as such and, where available (Mexico), compare with SCT isoyetas or CLICOM-fitted GEV.
- SCS Type II/III shapes are calibrated for US climates; Huff curves are empirical from Illinois; their transferability to Chiapas is unverified. Alternating block is climate-agnostic but produces a very peaky, conservative storm.
- Reproducibility: store T, D, depth source (dataset+version+DOI), hyetograph method and Δt in the run's JSON metadata, consistent with AGENTS.md traceability rules.

### Gaps
- No ERA5-based global return-level product other than PXR was confirmed in this pass (e.g., C3S/other ERA5 extreme indices); not verified.
- No validation of GPEX or PXR return levels against Mexican pluviograph-derived IDF curves was found.
- Digital availability of SCT isoyetas (georeferenced rasters vs scanned maps) is unknown; only scanned PDF reproductions were found.
- No study comparing SCS Type II, Huff and alternating block on the same tropical/Mexican data was found.
- GPEX v4 spatial resolution (presumed 0.1° from MSWEP) was not confirmed from the record page itself.

## Spatial downscaling vs uniform rain for ~1–10 km² domains

### Takeaway
For domains below ~4 km², standard practice (Australian Rainfall and Runoff) treats point IFD as areal IFD (ARF ≈ 1), and a Danish radar study finds uniform design rain significantly overestimates intensities only above ~10 km². Spatially uniform rain over the domain is therefore defensible for this simulator; disaggregating 0.1° satellite rain to sub-km patterns adds little information because the satellite cannot resolve sub-cell structure. The larger issue is the reverse: a 0.1° cell average underestimates the point peak, so an inverse ARF adjustment (or design storms) may matter more than spatial downscaling.

### Cited Findings
- ARR Project 2: for small catchments point IFD is taken as representative of areal IFD; "small" defined as < 4 km² — [ARR Project 2 Stage 3 Short-duration ARF report](https://arr.ga.gov.au/__data/assets/pdf_file/0018/40545/ARR_Project_2_Stage3_Short_ARF_Report.pdf).
- Thorndahl et al. (2019, Water 11(6):1120): design rainfall is typically assumed spatially homogeneous in urban drainage; for catchments larger than ~10 km² this leads to significant overestimation of design intensities; storm-to-storm ARF variability is very large, so mean values are recommended for small urban design — [Aalborg Univ. PDF](https://vbn.aau.dk/ws/files/307053540/Estimation_of_Storm_Centred_Areal_Reduction_Factors_from_Radar_Rainfall_for_Design_in_Urban_Hydrology.pdf); [MDPI review report](https://mdpi.com/2073-4441/11/6/1120/review_report).
- Flanders (2005): areal correction coefficients for small urban catchments depend on catchment size, aggregation level and intensity, and may be > 1 for small areas and limited intensities — [Areal rainfall correction coefficients for small urban catchments](https://redi.cedia.edu.ec/document/57403).
- 2026 Austrian preprint: ARFs remain highly uncertain especially for short durations and small areas — [EGUsphere 2026-186](https://egusphere.copernicus.org/preprints/2026/egusphere-2026-186/egusphere-2026-186.pdf) (not peer-reviewed).

### Inferences
- Priority LOW for spatial disaggregation of 0.1° rain inside 1–10 km² domains: keep uniform rain (current approach). Possibly MEDIUM for an optional temporal disaggregation (30 min → 5–10 min) since DG2 time steps are short and sub-hourly peaks drive pluvial depths.
- Using the mean of the 0.1° cells touching the domain likely damps the peak further; using the single cell containing the centroid (or an area-weighted mean) is a cleaner choice; this is a design decision, not established by the sources.
- Any "point-to-area" or "area-to-point" correction factor should be documented as a parameter, since ARF literature shows large uncertainty at these scales.

### Gaps
- No study was found quantifying flood-depth sensitivity to uniform vs spatially variable rain specifically for 1–10 km² 2D pluvial models.
- No published method for converting 0.1° satellite areal rain to point intensity (inverse ARF) suitable for global use was retrieved.
- Tropical/Mexican ARF studies were not found.

## Datasets available through NASA Earthdata/CMR (added constraint: team already has Earthdata login with GES DISC, LP DAAC, PO.DAAC, ASF authorized)

### Takeaway
Everything the team can use with zero new accounts lives at GES DISC: all three IMERG V07 runs (Early/Late/Final, half-hourly and daily), MERRA-2 hourly bias-corrected precipitation (0.5°×0.625°, ~3 weeks after month end), GLDAS-2.1 3-hourly forcing (0.25°), and GPM Level 2 swath products (DPR+GMI combined, ~5 km, only at overpass times). None of the non-NASA sources (GSMaP, MSWEP, CHIRPS, ERA5, ECMWF, GFS, GPEX, PXR) are distributed via Earthdata, and no IMERG-based global IDF product was found in Earthdata or elsewhere. The cheapest upgrade is switching IMERG run by event age (Late → Final), followed by design storms from GPEX/PXR (static files, no login).

### Cited Findings
- IMERG V07 Early half-hourly is in the Earthdata catalog as GPM_3IMERGHHE (GES DISC) — [Earthdata catalog GPM_3IMERGHHE V07](https://www.earthdata.nasa.gov/fr/data/catalog/ges-disc-gpm-3imerghhe-07); Late half-hourly as GPM_3IMERGHHL — [Earthdata catalog GPM_3IMERGHHL V07](https://www.earthdata.nasa.gov/data/catalog/ges-disc-gpm-3imerghhl-07); IMERG monthly GPM_3IMERGM — [Earthdata catalog GPM_3IMERGM V07](https://www.earthdata.nasa.gov/es/data/catalog/ges-disc-gpm-3imergm-07?page=6%2C0).
- MERRA-2 M2T1NXFLX (tavg1_2d_flx_Nx, V5.12.4): hourly time-averaged, 0.625°×0.5°, includes total precipitation and bias-corrected total precipitation (PRECTOTCORR, kg m⁻² s⁻¹), timestamps at hh:30 UTC, 1980–present, latency ~3 weeks after month end, Earthdata login required, GES DISC subsetter available — [data.gov M2T1NXFLX](https://catalog.data.gov/dataset/merra-2-tavg1_2d_flx_nx-2d1-hourlytime-averagedsingle-levelassimilationsurface-flux-diagno); [GEE MERRA-2 flx (units)](https://developers.google.com/earth-engine/datasets/catalog/NASA_GSFC_MERRA_flx_2); [Earthdata MERRA-2 project](https://www.earthdata.nasa.gov/data/projects/merra-2).
- GLDAS-2.1 Noah 0.25° 3-hourly (GLDAS_NOAH025_3H, 2000–present, 36 land fields) and Early Product (GLDAS_NOAH025_3H_EP); main stream waits for GPCP v1.3 (3–4 month latency), EP has ~1.5 month latency; Rainf_f_tavg in kg m⁻² s⁻¹ — [data.gov GLDAS_NOAH025_3H](https://catalog.data.gov/dataset/gldas-noah-land-surface-model-l4-3-hourly-0-25-x-0-25-degree-v2-1-gldas_noah025_3h-at-ges-); [data.nasa.gov GLDAS_NOAH025_3H_EP](https://data.nasa.gov/dataset/gldas-noah-land-surface-model-l4-3-hourly-0-25-x-0-25-degree-early-product-v2-1-gldas-noah-b2b4a); [Earthdata GLDAS_NOAH025_M](https://earthdata.nasa.gov/data/catalog/ges-disc-gldas-noah025-m-2.1).
- GPM_2BCMB V07 (DPR+GMI combined, L2B, "1.5 hours 5 km"): one orbit per file; NS swath 49 rays (KuPR), MS swath 25 rays (KaPR); coverage 70°S–70°N; DOI 10.5067/GPM/DPRGMI/CMB/2B/07; TRMM counterpart GPM_2BCMB_TRMM (1997–2015) — [data.gov GPM_2BCMB](https://catalog.data.gov/dataset/gpm-dpr-and-gmi-combined-precipitation-l2b-1-5-hours-5-km-v07-gpm_2bcmb-at-ges-disc); [Earthdata GPM_2BCMB](https://www.earthdata.nasa.gov/es/data/catalog/ges-disc-gpm-2bcmb-07?page=1).
- MEaSUREs GMI-only L2 ensemble (PRECIP_GMI_GPM), per-orbit, 2014–2020 — [data.nasa.gov MEaSUREs GMI ensemble](https://data.nasa.gov/dataset/nasa-measures-precipitation-ensemble-based-on-gmi-gpm-nasa-pps-l1c-v05-tbs-1-orbit-l2-swat-57e64).
- No global IMERG-based IDF dataset found; global IDF options are PXR (ERA5), GPEX (MSWEP), GSDR-IDF (gauges) and BURGER (gauges, restricted) — see design-storm section and [Univ. Bristol, BURGER](https://research-information.bris.ac.uk/en/publications/burger-a-bottomup-regionalization-approach-for-global-subdaily-in/).

### Source summary table (all sources in these notes)

Priorities are for this simulator (1–10 km² DG2 domains, global, Chiapas case study). "Earthdata" = distributed via NASA Earthdata/CMR with the team's existing login.

| Source | Use | Space / time | Coverage | Latency | Licence | Access | Earthdata | Effort | Priority |
|---|---|---|---|---|---|---|---|---|---|
| IMERG V07 Late HH | NRT replay (current) | 0.1° / 30 min | global (60°S–60°N full) | ~14 h | NASA open | GES DISC OPeNDAP/HTTPS | **yes** (GPM_3IMERGHHL / GES DISC) | done | HIGH (keep) |
| IMERG V07 Early HH | fastest NASA NRT | 0.1° / 30 min | global | ~4 h | NASA open | GES DISC | **yes** (GPM_3IMERGHHE / GES DISC) | trivial | MEDIUM |
| IMERG V07 Final HH | best NASA replay for events > ~4 months old (monthly gauge correction) | 0.1° / 30 min | global | ~3.5–4 months | NASA open | GES DISC | **yes** (GPM_3IMERGHH / GES DISC; short name inferred from naming, not checked in catalog) | trivial | HIGH |
| GPM_2BCMB (DPR+GMI) | snapshot check of rain structure at overpass | ~5 km swath / instantaneous | 70°S–70°N, overpass only | not checked | NASA open | GES DISC | **yes** (GPM_2BCMB / GES DISC) | high (swath, irregular) | LOW |
| MERRA-2 hourly | reanalysis fallback / context | 0.5°×0.625° / 1 h | global | ~3 weeks after month end | NASA open | GES DISC subsetter | **yes** (M2T1NXFLX, PRECTOTCORR / GES DISC) | low | LOW–MEDIUM |
| GLDAS-2.1 Noah | forcing climatology | 0.25° / 3 h | land 60°S–90°N | EP ~1.5 months; main 3–4 months | NASA open | GES DISC | **yes** (GLDAS_NOAH025_3H(_EP) / GES DISC) | low | LOW |
| NLDAS | — | — | North America only (does not reach Chiapas; inference, not verified) | — | — | GES DISC | yes (not applicable) | — | NONE |
| GSMaP Gauge_NRT / Gauge | second satellite estimate, gauge-adjusted | 0.1° / 1 h | global | NRT hours (not verified); NOW < 30 min | free incl. commercial with credit + prior notice | G-Portal (separate registration), GEE | no (JAXA G-Portal) | medium | HIGH–MEDIUM |
| MSWEP V2.8 / V3 | multi-source merged, better extremes (likely) | 0.1° / 3 h (V3: 1 h) | global | ~3 h (V3 ~2 h) | CC BY-NC 4.0 | application form | no (GloH2O) | medium | MEDIUM (non-commercial only) |
| CHIRPS v3 | daily totals check | 0.05° / pentad→daily | land 50°S–50°N (coverage not verified) | weeks (not verified) | not verified | CHC HTTP | no (UCSB CHC) | low | LOW |
| CMORPH CDR | historical replay | 8 km / 30 min (resolution not verified) | 60°S–60°N | 3–4 months; record listed to 2024-08 | access constraints none | NCAR RDA / NCEI | no (NOAA/NCAR) | medium | LOW |
| PERSIANN-CCS / PDIR-Now | ultra-low-latency fallback | 0.04° / 1 h | 60°S–60°N | 15–60 min | not verified | CHRS UCI | no (UC Irvine CHRS) | medium | LOW |
| ERA5 / ERA5T | reanalysis context, long record | 0.25° / 1 h | global | ~5 days | CC BY (Copernicus) | CDS API (new account) | no (Copernicus CDS) | medium | LOW |
| ECMWF IFS / AIFS open data | "tomorrow" forecast | 0.25° (IFS 0.1° reportedly since 2026-10-20) | global | real time | CC-BY-4.0 | `ecmwf-opendata` / HTTPS | no (ECMWF) | low–medium | MEDIUM |
| NOAA GFS | "tomorrow" deterministic | 0.25° / 1 h to 120 h | global | real time | US gov (licence text not read) | NOMADS grib filter, AWS | no (NOAA NOMADS/AWS) | low | MEDIUM |
| NOAA GEFS | forecast ensemble | 0.25° / 3 h to 384 h | global | real time | US gov | AWS, NOMADS | no (NOAA AWS) | medium | LOW–MEDIUM |
| CHIRPS-GEFS | bias-corrected forecast totals | 0.05° / 5–15-day totals | land | daily | not verified | CHC | no | low | LOW |
| HRRR / MRMS | — | 3 km / 1 h; radar QPE | CONUS only | — | — | AWS | no | — | NONE |
| GPEX | design depths (T, D ≥ 3 h) | 0.1° (presumed) / 3 h–10 d | global | static | CC BY 4.0 | 4TU download | no (4TU.ResearchData) | low | HIGH |
| PXR-2 / PXR-4 | design IDF (1–360 h), continuous formula | ~31 km | global | static | not verified (Zenodo) | Zenodo | no (Zenodo) | low | HIGH |
| GSDR-IDF | gauge IDF points for validation | gauge points / 1–24 h | where gauges exist | static | not verified | Zenodo | no | low | MEDIUM |
| BURGER | regionalized sub-daily IDF | 0.1° / 1–24 h | global | static | CC BY-NC-SA 4.0, restricted | on request | no | medium | LOW |
| SCT isoyetas (Mexico) | local design intensities 5–240 min | scanned maps | Mexico | static | not verified | PDFs (CENAPRED reproductions) | no | high (digitize) | MEDIUM (Mexico add-on) |
| CLICOM (SMN) | daily gauge validation, local GEV | stations / daily | Mexico | final set lags (not quantified) | "as is" | UCAR EOL files | no (UCAR EOL) | medium | LOW–MEDIUM |
| SMN EMAs / API / radar | sub-daily gauges, radar | stations 10 min (not verified) | Mexico | unknown | unknown | smn.conagua.gob.mx (unverified) | no | high / uncertain | LOW |

### Inferences
- With the existing login, the team can add IMERG Early and Final with the same reader as Late (only the short name changes), giving a three-run ensemble and an automatic "best available run" rule by event age.
- MERRA-2 PRECTOTCORR is gauge-corrected over land (based on its name "bias-corrected"; correction method not verified here) and hourly, making it a usable NASA-only alternative to ERA5 for reanalysis context without a Copernicus account; its ~50 km grid makes it unsuitable as primary pluvial forcing.
- GPM DPR/GMI swaths are only snapshots at overpass times; they could support a qualitative check of rain-cell location during a replayed event but cannot form a hyetograph.
- NLDAS covers North America at mid-latitudes and should not reach Chiapas (~16°N); this is from general knowledge and was not verified in this pass.

### Gaps
- The exact Earthdata short name of IMERG Final half-hourly V07 (presumed GPM_3IMERGHH) was not opened in the catalog in this pass.
- MERRA-2 PRECTOTCORR correction method (which gauge product, over land only?) and its skill for tropical hourly extremes were not verified.
- No Earthdata-hosted copy of GSMaP, CMORPH, PERSIANN, CHIRPS or any global IDF product was found; this is a negative search result, not an exhaustive CMR query.
- GLDAS forcing precipitation source for 2.1 (GPCP + others) and its sub-daily disaggregation were not checked.
