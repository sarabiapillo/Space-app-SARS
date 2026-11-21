# Ríos, cauces, batimetría y niveles costeros (mareas, marea de tormenta, nivel del mar) para el simulador LISFLOOD-FP 8.0.3 DG2

Contexto (de la asignación, no de fuentes externas): DG2 en CPU, dominios de ~1–10 km², celdas de 30 m, terreno NASADEM 30 m (EGM96, sin batimetría; ríos = superficie del agua, mar = 0 m), frontera costera HFIX + sobreelevación por barómetro inverso, lagos HydroLAKES con lecho excavado estimado, sin caudal de entrada. Caso: Chiapas (Grijalva; lagunas costeras del Pacífico cerca de Pijijiapan / La Encrucijada). Fecha de consulta: 2026-11-20. Búsquedas web limitadas (~19 llamadas); lo no verificado está en "Gaps".

## 1. Redes fluviales, anchos y profundidad de cauce; compatibilidad con DG2 (canal subgrid)

### Takeaway
DG2 en LISFLOOD-FP 8.0 **no** integra el modelo de canal subgrid (solo ACC lo tiene), así que con DG2 la única vía es **"quemar" el cauce directamente en el DEM** (bajar las celdas del río a una cota de lecho estimada). Para eso, lo más útil y barato es: eje + ancho (GRWL o MERIT Hydro / SWORD) + profundidad por ley potencia ancho–profundidad (Neal et al. 2012) o por base de datos global de ancho/profundidad (Andreadis et al.), con incertidumbre de metro(s).

### Cited Findings
- LISFLOOD-FP 8.0: "The DG2/FV1 solvers are parallelised for the multi-core CPU architecture, but do not integrate with the subgrid channel model." El solver ACC "has a version with CPU-specific optimisations and enhanced with a subgrid channel model." — [LISFLOOD-FP 8.0 (SEAMLESS-WAVE)](https://www.seamlesswave.com/LISFLOOD8.0.html)
- Shaw et al. (2021, GMD 14:3577) describen la misma división: DG2 y FV1 son puramente 2D y no se conectan al modelo subgrid de Neal et al. (2012a); ACC sí. — [Shaw et al. 2021, GMD](https://eprints.whiterose.ac.uk/id/eprint/175373/1/gmd-14-3577-2021.pdf); [preprint](https://gmd.copernicus.org/preprints/gmd-2020-340/gmd-2020-340-manuscript-version4.pdf)
- La misma página lista para DG2 la limitación "Restrictive time-step for applications that involve thin flows" (relevante: un cauce quemado y estrecho genera láminas finas en bordes). — [SEAMLESS-WAVE](https://www.seamlesswave.com/LISFLOOD8.0.html)
- Neal et al. (2012, WRR, DOI 10.1029/2012WR012514): modelo de canal subgrid que permite representar cauces más estrechos que la celda sin refinar la malla, pensado para áreas grandes y con pocos datos. — [Univ. Bristol](https://research-information.bris.ac.uk/en/publications/a-subgrid-channel-model-for-simulating-river-hydraulics-and-flood/)
- Estudios posteriores con LISFLOOD-FP estiman la profundidad del cauce con la ley potencia D = r·W^p (Neal et al. 2012), calibrando r y p. — [HESS preprint hess-2015-511](https://hess.copernicus.org/preprints/hess-2015-511/hess-2015-511.pdf) (la forma exacta en el artículo original no se verificó en el texto completo).
- HydroRIVERS v1: extraído de las capas HydroSHEDS a 15 arcosegundos (~450 m); incluye tramos con cuenca ≥ 10 km² o caudal medio ≥ 0.1 m³/s; atributos mayormente geométricos, orden de río y caudal medio de largo plazo estimado; **sin ancho ni profundidad**; "freely available for scientific, educational and commercial use"; formatos .gdb y .shp, por región o global. — [HydroSHEDS – HydroRIVERS](https://www.hydrosheds.org/products/hydrorivers)
- MERIT Hydro (2019): dirección de flujo, acumulación, elevaciones ajustadas hidrológicamente y **ancho de cauce**; cobertura N90–S60; doble licencia **CC-BY-NC 4.0 y ODbL 1.0** con términos específicos para uso comercial de derivados; disponible en Google Earth Engine. — [GEE catalog MERIT Hydro](https://developers.google.com/earth-engine/datasets/catalog/MERIT_Hydro_v1_0_1?hl=en)
- GRWL (Allen & Pavelsky 2018, Science 361:585): anchos de ríos desde Landsat; máscara de 30 m con clases río (255), lago/embalse (180), ríos de marea/delta (126), canal (86); el vector trae `width_m` (ancho mojado); la máscara es un producto intermedio "not explicitly validated". Licencia CC BY 4.0 según el catálogo comunitario de GEE (no confirmado en Zenodo). Hay un registro Zenodo V01.01 publicado 2026-02-12 no descrito. — [Zenodo GRWL](https://zenodo.org/records/1269595); [GEE community catalog](https://gee-community-catalog.org/projects/grwl/); [Zenodo 2026](https://zenodo.org/records/18624542)
- Base global simple de ancho y profundidad de cauce lleno (Zenodo, 2016): derivada de la topología HydroSHEDS con relaciones geomorfológicas área–caudal–ancho–profundidad; "primer intento" de cobertura casi global. — [Zenodo 61758](https://zenodo.org/records/61758)
- GWD-LR (2014): anchos de ríos grandes entre 60S y 60N (ancho de banco a banco y efectivo sin islas). — resultado de búsqueda sobre [USGS catalog](https://water.usgs.gov/catalog/datasets/abe81b10-43b7-4410-a729-1e9f58278167)
- Ancho de cauce lleno por ML (Lin et al. 2019): por tramo, desde anchos Landsat + MERIT Hydro, solo ríos > 30 m; R² 0.81 y 0.77 en pruebas. — [Reach Hydro](https://www.reachhydro.org/home/params/bankfull-river-widths)
- SWORD v17b: base de ríos de SWOT con **nodos cada 200 m y tramos ~10 km**, combina varios datasets globales; versión oficial para los productos RiverSP Version D; netCDF, GeoPackage y shapefile. — [Zenodo SWORD v17b](https://zenodo.org/records/15299138); [SWORD Product Description v17b](https://hydroweb.next.theia-land.fr/docs/collections/resources/swot/Product_Description_Document/SWOT_PRD/SWORD_ProductDescription_v17b.pdf)

### Inferences
- **Con DG2 no hay "canal subgrid"**: cualquier geometría de cauce debe entrar en el DEM (cota de lecho = superficie NASADEM − profundidad estimada en las celdas del río). A 30 m, solo cauces ≥ ~30–60 m de ancho ocupan al menos una celda completa; los cauces más estrechos quedarían sobreensanchados al quemarlos o se omiten. Alternativa: usar ACC + subgrid para corridas con río, a costa de perder DG2 (decisión de producto, no técnica).
- NASADEM muestra el río como su **superficie de agua el día de la toma (SRTM, febrero 2000)**; la profundidad a restar depende del estado del río en esa fecha, no del cauce lleno. Usar profundidad de cauce lleno (bankfull) sobreestima el volumen del cauce si el río estaba bajo. Incertidumbre de orden métrico.
- Prioridades (propuesta):
  - **Alta – GRWL (máscara 30 m + ancho)**: misma resolución que la malla, CC BY 4.0 (a confirmar), descarga estática; buen candidato para delimitar qué celdas quemar en ríos ≥ 30 m. Esfuerzo bajo-medio (rasterizar a la malla del dominio).
  - **Alta – Ley potencia ancho→profundidad (Neal et al. 2012) o base Andreadis/Zenodo 61758**: única forma global de dar profundidad; documentar r y p y marcar el resultado como no validado. Esfuerzo bajo.
  - **Media – MERIT Hydro (ancho, dirección de flujo)**: buen ancho global y red coherente, pero **CC-BY-NC** limita uso comercial; resolución 3″ (~90 m) según su documentación (no verificado aquí).
  - **Media – SWORD v17b**: ejes/nodos 200 m con ancho y cota del agua de SWOT; útil para ríos grandes (Grijalva), poco para arroyos.
  - **Baja – HydroRIVERS**: 15″ (~450 m) es demasiado grueso para dominios de 1–10 km²; sirve solo como topología/orden de río y caudal medio (útil si algún día se modelan entradas). Licencia permite uso comercial.
  - **Media-baja – OSM waterways**: no investigado aquí (ver Gaps); suele dar ejes precisos de cauces pequeños sin ancho fiable.

### Gaps
- No se verificó si LISFLOOD-FP 8.1/8.2 añadió canal subgrid a DG2 (la búsqueda solo encontró mención de un artículo 8.2 sin detalle). Revisar notas de versión.
- No se encontró un producto global de **batimetría fluvial** 2024–2026 (p. ej., profundidades estimadas con SWOT o ML); queda abierto.
- Licencia exacta de HydroSHEDS v2 y su estado de publicación no se verificaron.
- OSM waterways (licencia ODbL, etiquetas `waterway=river/stream`, `width`) no se investigó en esta ronda.
- Resolución exacta de MERIT Hydro (3″) y del ancho de SWORD/GRWL por nodo no se citaron de fuente primaria.
- No se encontró un método publicado específico de "channel burning" para DG2; los artículos usan ACC + subgrid.

## 2. SWOT: elevación y pendiente de la superficie del agua (ríos y lagos) como observación o frontera

### Takeaway
SWOT ofrece WSE, ancho y pendiente por tramo (~10 km) y nodo (200 m) de SWORD, y por lago (PLD), consultable como serie temporal con la API **Hydrocron** de PO.DAAC; sirve para validar niveles o fijar un nivel de agua de río/laguna en una fecha, no como hidrograma continuo (muestreo de varios días).

### Cited Findings
- Hydrocron "repackages hydrology datasets from the Surface Water and Ocean Topography (SWOT) satellite" para ver la serie temporal de un elemento con una sola llamada; sirve River Single-Pass Vector y Lake Single-Pass Vector **Version D (por defecto)**; Version 2.0 además incluye SoS River Discharge v3; `node_fields` devuelve un tramo y todos sus nodos; **Version 2.0 se retira de Hydrocron el 1 de diciembre de 2026**; algunos IDs de nodo/tramo difieren entre 2.0 y D. — [Hydrocron docs](https://podaac.github.io/hydrocron/)
- La API usa parámetros `feature`, `feature_id`, `start_time`, `end_time`; su base ingiere gránulos SWOT de tramos, nodos y lagos previos (prior lakes). — [Webinar Earthdata/PO.DAAC, julio 2025](https://earthdata.nasa.gov/s3fs-public/2025-07/ED%20Webinar%20-%20PODAAC%20SWOT%20Hydro%20Tools%20-%20July%202025.pdf)
- Productos L2 RiverSP Version D (nodo y tramo) en PO.DAAC; DOI del nodo 10.5067/SWOT-RIVERSP-D. — [PO.DAAC SWOT_L2_HR_RiverSP_node_D](https://podaac.jpl.nasa.gov/dataset/SWOT_L2_HR_RiverSP_node_D)
- SWORD v17b define los nodos (200 m) y tramos (~10 km) de los productos vectoriales Version D. — [Zenodo SWORD v17b](https://zenodo.org/records/15299138)

### Inferences
- **Uso 1 (alta-media):** validar o corregir la cota del agua que NASADEM tiene en el río (año 2000) con WSE SWOT actual en nodos dentro del dominio; también estimar la pendiente para la cota del lecho quemado (lecho = WSE − profundidad, siguiendo la pendiente).
- **Uso 2 (media):** nivel inicial / HFIX para lagunas costeras o lagos si están en la PLD y tienen paso SWOT cercano a la fecha.
- **No sirve como hidrograma** de entrada (el equipo no modela entradas, además).
- Esfuerzo bajo: una llamada HTTP por `feature_id`; requiere mapear el dominio a IDs de SWORD (intersección espacial con SWORD v17b).
- Las cotas SWOT están en un datum geoidal distinto a EGM96 (ver §4): hay que convertir antes de compararlas con NASADEM.

### Gaps
- No se verificó si Hydrocron requiere autenticación Earthdata ni la latencia de los productos (se cree que es de días, sin fuente).
- No se verificó el datum vertical de WSE en RiverSP (EGM2008 según conocimiento previo, sin cita en esta ronda).
- No se verificó si el Grijalva medio/bajo o las lagunas de La Encrucijada tienen nodos/lagos SWOT con observaciones válidas (ríos > ~50–100 m de ancho).
- No se verificó si existe un producto L2 RiverSP posterior a Version D en 2026.

## 3. Mareas: modelos globales, mareógrafos y herramientas para obtener una serie de nivel en un punto y fecha

### Takeaway
Para una frontera costera dinámica, lo más práctico es predecir la marea astronómica en el punto costero con **pyTMD / eo-tides** usando **FES2022** (alturas: uso libre, incluido comercial, con registro AVISO) o **EOT20** (CC-BY, descarga directa); TPXO es más restrictivo para uso comercial. Validar con mareógrafos (GESLA, UHSLC, SMN-UNAM).

### Cited Findings
- FES2022: alturas y marea de carga "available for all uses, as indicated in the licence agreement"; "The heights products can be used for any purpose (scientific, commercial,…)"; las corrientes de marea FES2022 no se distribuyen salvo bajo demanda y solo para estudios científicos. — [AVISO FES](https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes.html); [AVISO release FES22](https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes/release-fes22.html); [Ifremer Sextant](https://sextant.ifremer.fr/geonetwork/srv/api/records/b75834bc-50b4-4a78-8bd1-d20e5b24c9fd)
- Licencia general AVISO+ (Issue 19, feb. 2024) permite crear y distribuir productos de valor añadido "for any purpose (scientific, operational, commercial, etc.)". Cita requerida: "The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS and made freely available by AVISO". — [License Aviso.pdf](https://www.aviso.altimetry.fr/fileadmin/documents/data/License_Aviso.pdf)
- Herramienta oficial: `aviso-fes` (pyfes) de CNES. — [GitHub CNES/aviso-fes](https://github.com/CNES/aviso-fes); [Nota pyfes FES2022, 2026-03-20](https://www.aviso.altimetry.fr/fileadmin/documents/data/tools/Note_Pyfes_FES2022_Finite_Element_AVISO_20260320.pdf)
- TPXO: copyright de Oregon State University; el uso implica aceptar el acuerdo del README; pyTMD describe las herramientas OTIS/OTPS como licenciadas para uso **no comercial** (fuente secundaria). No se encontró el texto de licencia de TPXO10. — [README TPXO10 (TU Graz mirror)](https://ftp.tugraz.at/pub/ITSG/oceanAndAtmosphericTides/models/TPXO10_OCN/00README.txt); [pyTMD PyPI](https://pypi.org/project/pyTMD/1.0.6/)
- EOT20 (DGFI-TUM): modelo empírico de marea por análisis residual de altimetría multimisión 1992–2019; licencia **CC-BY**; DOI de datos 10.17882/79489. — [ESSD 13:3869 (2021)](https://essd.copernicus.org/articles/13/3869/2021/); [DGFI-TUM](https://www.dgfi.tum.de/en/news-archive/na_EOT20)
- pyTMD soporta más de 50 modelos de marea y permite definir esquemas nuevos con JSON (JOSS, CC BY 4.0). eo-tides integra pyTMD con pandas/xarray, soporta todos los modelos de pyTMD (incluido EOT20) y permite validar contra mareógrafos (p. ej., GESLA); su página PyPI advierte que es "work in progress, and not currently ready for operational use" (versión antigua 0.0.20). — [eo-tides PyPI](https://pypi.org/project/eo-tides/0.0.20); [JOSS pyTMD/eo-tides](https://www.theoj.org/joss-papers/joss.07786/10.21105.joss.07786.pdf)

### Inferences
- **Alta – FES2022 + pyTMD/pyfes:** mejor modelo abierto de alturas de marea con uso comercial permitido; requiere cuenta AVISO+ y descarga de los atlas (varios GB). Esfuerzo medio: función `tide_level(lon, lat, t0, t1, dt)` que genera la serie para una frontera HVAR/BCI en LISFLOOD-FP en vez de HFIX.
- **Alta (alternativa sin registro) – EOT20 + pyTMD:** CC-BY, descarga directa; menos preciso en costa según la literatura general (no verificado aquí). Bueno como opción por defecto reproducible.
- **Baja – TPXO10:** posible restricción comercial y licencia no clara; evitar salvo para comparación.
- El punto de evaluación debe estar mar adentro (celda "mojada" del modelo), no en la laguna: los modelos globales no resuelven bocas de lagunas como La Encrucijada.
- Marea predicha está referida a nivel medio del mar del modelo, no a EGM96: ver §4 para sumar el offset.
- La marea astronómica sola omite la marea de tormenta; sumar el barómetro inverso actual (ya implementado) a la marea es una aproximación razonable para dominios pequeños, pero no incluye el viento (setup).

### Gaps
- No se verificaron licencia ni acceso de **GESLA-3/4**, **UHSLC** ni **NOAA CO-OPS** (CO-OPS cubre sobre todo EE. UU.; no relevante para Chiapas salvo comparación).
- No se verificó la resolución de EOT20 ni de FES2022 en esta ronda.
- No se verificó la versión actual de eo-tides (2026) ni si sigue con la advertencia de "no operacional".
- No se encontró licencia explícita de TPXO10.

## 4. Nivel del mar y marea de tormenta: reanálisis, pronósticos y conversión de datum (EGM96 vs MSL)

### Takeaway
**GTSM (Deltares) vía Copernicus CDS** da series de 10 min de nivel total, residuo de tormenta, marea y nivel medio en puntos costeros cada ~0.1°, referidas a MSL 1986–2005: es la mejor fuente global para una frontera costera histórica. CMEMS da pronóstico a 10 días (1/12°, horario). La diferencia de datum entre MSL y EGM96 (topografía dinámica media) es un error sistemático que hay que corregir con un MDT (p. ej., DTU22MDT).

### Cited Findings
- CDS "Global sea level change time series from 1950 to 2050": basado en **GTSM 3.0**, niveles cada **10 minutos**, puntos costeros a **0.1°**; reanálisis forzado con ERA5, futuro con 5 modelos CMIP6 HighResMIP (SSP5-8.5); variables: nivel total, residuo de tormenta (surge), marea y nivel medio; referencia vertical **MSL 1986–2005**; licencia Copernicus Product License. Fuentes difieren en el periodo del reanálisis (hasta 2024 según una); existe un dataset de reanálisis ERA5 en versión 2. — [CDS sis-water-level-change-timeseries-cmip6](https://cds.climate.copernicus.eu/datasets/sis-water-level-change-timeseries-cmip6); [CDS sis-water-level-change-timeseries (doc)](https://cds.climate.copernicus.eu/datasets/sis-water-level-change-timeseries?tab=doc); [ECMWF Confluence](https://confluence.ecmwf.int/x/LiI7E)
- CMEMS GLOBAL_ANALYSISFORECAST_PHY_001_024: 0.083° (1/12°), salidas horarias (altura de superficie del mar, temperatura, corrientes), diarias y mensuales; **10 días de pronóstico actualizado diariamente**; variable "Sea surface height above geoid"; ventana deslizante (~2 años; extensión listada 2020-11-01 a 2026-11-30). La página no aclara si la SSH horaria incluye marea ni los términos de licencia. — [CMEMS product page](https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_PHY_001_024/description)
- Desajuste de datum: datasets globales de nivel extremo están referidos a MSL, mientras SRTM (base de NASADEM) está referido al geoide EGM96; corregirlo **aumentó en 60 %** la exposición global estimada a inundación para uno de los datasets (GTSR). — [ESSD 18:2285 (2026)](https://essd.copernicus.org/articles/18/2285/2026/essd-18-2285-2026.html)
- MDT geodésica = MSS − geoide (mismo sistema de marea y elipsoide). **DTU22MDT**: geodésica a partir de DTU21MSS y el geoide XGM2019e (grado y orden 2160), periodo 1993–2012; DTUUH22MDT combina con derivadores. — [OSTST 2022 DTUUH22MDT](https://ostst.aviso.altimetry.fr/fileadmin/user_upload/OSTST2022/Presentations/GEO2022-The_DTUUH22MDT_combined_mean_dynamic_topography_model.pdf); [DTU Space datasets](https://www.space.dtu.dk/english/research-divisions/geodesy-and-earth-observation/research-areas/hydrosphere/Datasets)
- En la costa, un solo mareógrafo restringe poco la MDT; un contraste con MDT oceanográfica mostró un desajuste de ~9 cm, sobre todo por errores de geoide de escala corta. — [GOCE++ Coastal MDT](https://ftp.space.dtu.dk/pub/Altimetry/GOCE++/MEDERIC/GOCE++CoastalMDT_V07_All.pdf)
- CMEMS también distribuye una MDT global (SEALEVEL_GLO_PHY_MDT_008_063). — [CMEMS MDT](https://data.marine.copernicus.eu/product/SEALEVEL_GLO_PHY_MDT_008_063/description)

### Inferences
- **Alta – GTSM/CDS:** da en un solo paso marea + surge (incluye viento, a diferencia del barómetro inverso) en un punto costero cercano, a 10 min; reemplaza la combinación HFIX + barómetro inverso por una serie HVAR. Esfuerzo medio (API `cdsapi`, ya hay cuenta Copernicus si se usa ERA5). Limitación: ~0.1° y celdas costeras gruesas; no resuelve lagunas. Latencia del reanálisis no confirmada (puede no cubrir 2026).
- **Media – CMEMS 1/12°:** útil para pronóstico (10 días) o eventos recientes; requiere verificar si la SSH incluye marea (si no, sumar FES2022).
- **Alta (corrección obligatoria) – offset de datum:** nivel_EGM96 ≈ nivel_MSL + MDT_local + (EGM96 − geoide_del_MDT). Para la costa pacífica de Chiapas el término debe calcularse con DTU22MDT/CMEMS MDT y la diferencia EGM96–XGM2019e (o EGM2008) en el punto; ignorarlo puede sesgar la frontera en decenas de cm, comparable a la amplitud del surge por presión.
- COAST-RP (periodos de retorno de nivel costero) no se investigó; sería útil para escenarios "de diseño", no para fechas concretas.

### Gaps
- No se verificó el valor numérico de la MDT/offset EGM96→MSL en Chiapas.
- No se verificó el periodo exacto del reanálisis GTSM disponible en 2026 ni su latencia.
- No se verificó la licencia CMEMS (comercial) ni si la SSH horaria de 001_024 incluye marea.
- COAST-RP: sin información recogida (licencia, resolución, acceso).

## 5. Batimetría costera y de lagunas

### Takeaway
**GEBCO** (15″ ≈ 450 m, dominio público, uso comercial permitido con atribución) es la única batimetría global abierta; demasiado gruesa para lagunas, pero suficiente para dar profundidad al mar abierto frente a la costa en lugar del "0 m" plano de NASADEM. **DeltaDTM** (30 m, CC BY 4.0) mejora la tierra baja costera. La batimetría de lagunas (La Encrucijada) es una laguna de datos sin fuente global.

### Cited Findings
- GEBCO_2025: publicado en agosto de 2025 (aviso 6-ago-2025); malla de 15 arcosegundos (43200 × 86400); NetCDF4 (7.5 GB global + 4 GB grid TID de fuentes); descarga por áreas definidas por el usuario en varios formatos; "placed in the public domain and may be used free of charge", **uso comercial permitido** con atribución y sin implicar respaldo; no para navegación. Datum: se asume referido a MSL (aguas someras pueden tener otros datums) y "can be assumed to be relative to WGS84". Advierte que la resolución de la malla puede diferir mucho de la de los datos medidos subyacentes. — [GEBCO_2025 Grid](https://www.gebco.net/gebco2025-grid); [GEBCO release news](https://www.gebco.net/news/release-gebco2025-grid)
- **GEBCO_2026** "was published on 23rd April 2026", descargable global, por teselas o por área definida; compilado en el Seabed 2030 Global Centre (National Oceanography Centre, UK); distribuidor BODC. — [GEBCO gridded bathymetry data](https://www.gebco.net/data_and_products/gridded_bathymetry_data/)
- Existe ya un **GEBCO_2026 Grid** (registros de catálogo; UNH lo lista con CC BY 4.0) y GEBCO_2025 figura como versión anterior. Hay discrepancia de licencia entre registros (dominio público en gebco.net, OGL v3 en CEDA para 2025, CC BY 4.0 en UNH para 2026). — [data.gov.uk GEBCO_2026](https://www.data.gov.uk/dataset/the-gebco-2026-grid-the-2026-compilation-of-a-continuous-terrain-model-of-the-global-oceans-and); [UNH GEBCO_2026](https://scholars.unh.edu/ccom/1757); [CEDA GEBCO_2025](https://catalogue.ceda.ac.uk/uuid/05fba4c5b8fe4daea8ff751026daf438/)
- DeltaDTM (Pronk et al. 2024, Scientific Data): DTM costero global a 1″ (~30 m), corrige Copernicus DEM con lidar ICESat-2 y GEDI; MAE vertical 0.45 m (v1.1 reporta 0.43 m); licencia CC BY 4.0 en 4TU.ResearchData (el artículo dice "public domain"). — [4TU DeltaDTM](https://data.4tu.nl/datasets/1da2e70f-6c4d-4b03-86bd-b53e789cc629); [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10917791/)

### Inferences
- **Alta – GEBCO_2026 (o 2025) para celdas marinas:** sustituir el 0 m de NASADEM en mar abierto por la batimetría GEBCO reinterpolada a 30 m, convirtiendo MSL→EGM96 (§4). Esfuerzo bajo (subset por área). Mejora el tránsito de la onda de la frontera hacia la costa y evita una plataforma de lámina muy fina (que penaliza el paso de tiempo de DG2).
- **Media – DeltaDTM:** reduce el sesgo de vegetación/edificios en tierra baja costera (el mismo problema que NASADEM, que es DSM). Su datum vertical (EGM2008 según conocimiento previo, no verificado) difiere de EGM96: convertir. Cobertura solo de zona costera baja.
- **Laguna (La Encrucijada, Pijijiapan): batimetría no disponible globalmente**; opciones: profundidad constante supuesta y documentada (como el lecho excavado de HydroLAKES), o literatura local/cartas náuticas de SEMAR (no investigadas). Marcar resultado como exploratorio.
- EMODnet solo Europa: irrelevante para Chiapas.

### Gaps
- No se verificó el datum vertical exacto de DeltaDTM.
- No se encontraron batimetrías de las lagunas de Chiapas ni cartas náuticas SEMAR accesibles.
- No se verificó qué contiene GEBCO_2026 frente a 2025 en la costa de Chiapas (grid TID: ¿datos medidos o interpolados?).
- No se investigaron fusiones costeras tipo "DeltaDTM + GEBCO" ya publicadas.

## 6. Fuentes específicas de México (opcional): mareógrafos SMN-UNAM, SEMAR/INEGI y CONAGUA BANDAS

### Takeaway
El **Servicio Mareográfico Nacional (SMN, Instituto de Geofísica UNAM)** opera mareógrafos en Salina Cruz y Puerto Chiapas, útiles para validar la frontera costera; los datos se piden por formulario. **CONAGUA BANDAS** tiene estaciones hidrométricas del Grijalva bajo (no del Pacífico chiapaneco) y solo serviría si se modelan entradas.

### Cited Findings
- El SMN-UNAM tiene estaciones en el muelle del Recinto Portuario de Salina Cruz (Oaxaca) y en el muelle de API Puerto Madero/Puerto Chiapas (Tapachula); algunas estaciones tienen datos históricos y en tiempo real, otras no transmiten en tiempo real. — [UNAM Agenda Estadística 2024](https://www.planeacion.unam.mx/Agenda/2024/xls/205.pdf)
- Solicitud de datos mediante formato del SMN; portal www.mareografico.unam.mx; contacto mareografico@igeofisica.unam.mx; se pide citar al "Grupo de Trabajo del Servicio Mareográfico Nacional, Instituto de Geofísica, UNAM". — [Formato de solicitud SMN](https://www.mareografico.unam.mx/wp-content/uploads/2022/09/formato_solicitud_datos.pdf)
- En 2012 Puerto Chiapas no estaba activa por mantenimiento del puerto (pueden existir huecos). — [Póster SMN 2012](https://chalchiuhtlicue.geofisica.unam.mx/wp-content/uploads/2022/09/2012-11-09_POSTER_SMN_2012.pdf)
- Un aviso de enero de 2025 indica estaciones desmontadas en **Río Grijalva** y Puerto Morelos. — [Reporte Frente Frío 21 y 22, ene-2025](https://chalchiuhtlicue.geofisica.unam.mx/wp-content/uploads/2025/01/20250105_FrenteFrioNo21y22.pdf)
- El SMN registró el tsunami de Pijijiapan (2017-09-08) y meteotsunamis en Chiapas (2023), lo que confirma registros de alta frecuencia en la costa chiapaneca. — [Reporte tsunami Pijijiapan 2017](https://chalchiuhtlicue.geofisica.unam.mx/wp-content/uploads/2022/09/2017-09-08_Reporte_tsunami_Pijijiapan_2017_09_08.pdf); [Meteotsunami Chiapas 2023](https://chalchiuhtlicue.geofisica.unam.mx/wp-content/uploads/2023/06/20230613_Meteotsunami_Chiapas.pdf)
- BANDAS (Banco Nacional de Datos de Aguas Superficiales, CONAGUA) es la base de datos de caudales usada en estudios de avenidas máximas; en el Grijalva bajo hay estaciones como Tapijulapa, Teapa, Puyacatengo y Pichucalco; un estudio detectó posibles errores de reporte en caudales máximos de dos estaciones. — [UAQ RI001213](https://ri-ng.uaq.mx/bitstream/123456789/6050/1/RI001213.PDF); [CENAPRED](https://www1.cenapred.unam.mx/DIR_INVESTIGACION/2109/FRACCION_XLI/RI/190228_SRI_PAT27_Avenidas_maximasB.pdf); [Tesis UNAM](https://ru.dgb.unam.mx/bitstream/20.500.14330/TES01000343300/3/0343300_A1.pdf)

### Inferences
- **Media – SMN Puerto Chiapas / Salina Cruz:** la mejor verificación local de la marea predicha (FES2022/EOT20) y de GTSM; Puerto Chiapas está ~150 km al SE de Pijijiapan, por lo que la fase/amplitud puede diferir; no es dato de frontera directo. Esfuerzo: solicitud manual (latencia humana), no API.
- **Baja – BANDAS:** las entradas no se modelan; además las estaciones citadas están en el Grijalva bajo (Tabasco), fuera de la costa del Pacífico. Útil solo como contexto o si cambia la decisión sobre entradas.
- La ROI SAR del proyecto (−93.39 a −92.88, 16.65–16.90) está en la Depresión Central/Grijalva medio, lejos de la costa: la frontera costera aplica solo a dominios costeros separados (Pijijiapan/La Encrucijada).

### Gaps
- No se verificó si el SMN publica descarga directa (sin formulario) ni el intervalo de muestreo.
- No se verificó la presencia de Puerto Chiapas/Salina Cruz en GESLA-4 o UHSLC (alternativas de acceso abierto).
- No se encontraron estaciones mareográficas SEMAR/INEGI con datos abiertos ni la red geodésica de INEGI para ligar nivel de mareógrafo a EGM96/ITRF.
- No se encontró el listado de estaciones BANDAS del Grijalva medio (zona de la ROI) ni condiciones de uso de BANDAS.

## 7. Resumen por fuente y disponibilidad en NASA Earthdata (restricción añadida: el equipo ya tiene login Earthdata con ASF, LP DAAC, PO.DAAC y GES DISC autorizados)

### Takeaway
De todo lo útil para cauces, batimetría y niveles costeros, **solo SWOT (RiverSP/LakeSP + Hydrocron) y los productos de altimetría de PO.DAAC están en Earthdata**; los datasets clave de cauce (GRWL, MERIT Hydro, HydroRIVERS, SWORD), marea (FES2022, EOT20, TPXO), surge (GTSM/CDS, CMEMS) y batimetría (GEBCO, DeltaDTM) están **fuera de Earthdata** (Zenodo, AVISO, Copernicus, BODC, 4TU). Las grillas de altimetría de PO.DAAC (1/6°–semanal) son demasiado gruesas y lentas para una frontera de marea de minutos; sirven como contexto de anomalía del nivel del mar.

### Cited Findings
- Colecciones SWOT Version D en PO.DAAC/Earthdata: padre `SWOT_L2_HR_RiverSP_D` con subcolecciones `SWOT_L2_HR_RiverSP_node_D` y `SWOT_L2_HR_RiverSP_reach_D`; padre `SWOT_L2_HR_LakeSP_D` con `SWOT_L2_HR_LakeSP_obs_D`, `SWOT_L2_HR_LakeSP_prior_D` y `SWOT_L2_HR_LakeSP_unassigned_D` (DOI 10.5067/SWOT-LAKESP-D). Hydrocron usa esos mismos nombres. — [PO.DAAC RiverSP_D](https://podaac.jpl.nasa.gov/dataset/SWOT_L2_HR_RiverSP_D); [Earthdata catalog RiverSP_D](https://earthdata.nasa.gov/data/catalog/pocloud-swot-l2-hr-riversp-d-D); [Earthdata catalog LakeSP_D](https://earthdata.nasa.gov/data/catalog/pocloud-swot-l2-hr-lakesp-d-d); [PO.DAAC LakeSP_unassigned_D](https://podaac.jpl.nasa.gov/dataset/SWOT_L2_HR_LakeSP_unassigned_D); [Hydrocron versioning](https://podaac.github.io/hydrocron/user-guide/versioning.html)
- `NASA_SSH_REF_SIMPLE_GRID_V1` (PO.DAAC): mapas 2-D de anomalía de altura del mar cada 7 días desde 1992-10-25, NetCDF-4; `NASA_SSH_GMSL_INDICATOR`: nivel medio global derivado. — [PO.DAAC NASA-SSH simple grid](https://podaac.jpl.nasa.gov/dataset/NASA_SSH_REF_SIMPLE_GRID_V1); [PO.DAAC GMSL indicator](https://podaac.jpl.nasa.gov/dataset/NASA_SSH_GMSL_INDICATOR)
- MEaSUREs `SEA_SURFACE_HEIGHT_ALT_GRIDS_L4_2SATS_5DAY_6THDEG_V_JPL2205`: anomalía de SSH sobre una superficie media del mar, malla 1/6°, cada 5 días; activo (V1812 retirado). — [PO.DAAC MEaSUREs SSH V2205](https://podaac.jpl.nasa.gov/dataset/SEA_SURFACE_HEIGHT_ALT_GRIDS_L4_2SATS_5DAY_6THDEG_V_JPL2205)
- GEBCO lo distribuye BODC / Seabed 2030 (NOC, UK), no un DAAC de NASA (no se encontró en CMR). — [GEBCO](https://www.gebco.net/data_and_products/gridded_bathymetry_data/)

### Inferences
Tabla resumen (prioridad para el simulador DG2, dominios 1–10 km², 30 m). "Earthdata" = disponible con el login actual vía CMR/DAAC.

| Fuente | Qué aporta | Resolución / cobertura | Licencia (¿comercial?) | Acceso / latencia | Esfuerzo | Prioridad | Earthdata |
|---|---|---|---|---|---|---|---|
| GRWL máscara + vector | Celdas de cauce a quemar, ancho mojado | 30 m, global (ríos Landsat) | CC BY 4.0 (a confirmar en Zenodo) — sí | Zenodo, estático | Bajo-medio | **Alta** | no (Zenodo) |
| Ley ancho→profundidad (Neal 2012) / base Andreadis (Zenodo 61758) | Profundidad del lecho | Por tramo HydroSHEDS, global | Artículo / Zenodo (licencia no verificada) | Estático | Bajo | **Alta** (única opción global) | no |
| MERIT Hydro | Ancho, dirección de flujo, red | ~3″ (no verificado), N90–S60 | CC-BY-NC 4.0 / ODbL — comercial restringido | Web del autor / GEE | Medio | Media | no (sin espejo en Earthdata encontrado) |
| SWORD v17b | Ejes, nodos 200 m, tramos 10 km, IDs para SWOT | Global, ríos grandes | No verificada | Zenodo / Hydroweb | Bajo | Media | no (pero es la base de SWOT) |
| HydroRIVERS v1 | Topología, orden, caudal medio | 15″ (~450 m), global | Libre, incl. comercial | Descarga .gdb/.shp | Bajo | Baja | no |
| OSM waterways | Ejes de cauces pequeños | Variable | ODbL (no verificado) | Overpass / Geofabrik | Medio | Media-baja | no |
| **SWOT RiverSP (nodo/tramo) + Hydrocron** | WSE y pendiente actuales → cota y pendiente del lecho quemado; validación | Nodo 200 m / tramo 10 km; ríos anchos | Datos NASA (abiertos) | API Hydrocron; latencia no verificada | Bajo | **Alta-media** | **sí** (`SWOT_L2_HR_RiverSP_node_D`, `..._reach_D` / PO.DAAC) |
| **SWOT LakeSP** | Nivel de lagunas/lagos en una fecha (HFIX inicial) | Lagos PLD | Abiertos | PO.DAAC / Hydrocron | Bajo | Media | **sí** (`SWOT_L2_HR_LakeSP_prior_D`, `..._obs_D` / PO.DAAC) |
| FES2022 (alturas) | Serie de marea astronómica en el punto de frontera | Global (resolución no verificada) | Alturas: cualquier uso, incl. comercial | AVISO+ con registro; pyfes/pyTMD | Medio | **Alta** | no (AVISO) |
| EOT20 | Igual que FES2022, sin registro | Global | CC-BY — sí | SEANOE, descarga directa; pyTMD/eo-tides | Bajo-medio | **Alta** (opción por defecto reproducible) | no |
| TPXO10 | Marea | Global | OSU, no comercial (fuente secundaria) | Registro OSU | Medio | Baja | no |
| GTSM vía CDS | Marea + surge (con viento) + nivel medio, 10 min | Puntos costeros ~0.1°, 1950–2050 | Copernicus Product License | `cdsapi`; latencia del reanálisis no verificada | Medio | **Alta** | no (Copernicus CDS) |
| CMEMS GLO PHY 001_024 | Pronóstico 10 días, SSH horaria | 1/12° | No verificada | `copernicusmarine` (no verificado) | Medio | Media | no (Copernicus Marine) |
| DTU22MDT / CMEMS MDT | Offset MSL↔geoide (corrección de datum) | Global | No verificada | DTU FTP / CMEMS | Bajo | **Alta** (corrección obligatoria) | no |
| NASA-SSH simple grid / MEaSUREs SSH | Anomalía del nivel del mar (contexto estacional) | Semanal / 5 días, 1/6° (MEaSUREs) | Abiertos | PO.DAAC, CMR | Bajo | Baja (demasiado grueso para frontera) | **sí** (`NASA_SSH_REF_SIMPLE_GRID_V1`, `SEA_SURFACE_HEIGHT_ALT_GRIDS_L4_2SATS_5DAY_6THDEG_V_JPL2205` / PO.DAAC) |
| GEBCO_2026 | Batimetría marina frente a la costa | 15″ (~450 m), global | Dominio público, comercial con atribución (registros discrepan) | Descarga por área | Bajo | **Alta** | no (BODC) |
| DeltaDTM | Tierra baja costera sin vegetación | 30 m, franja costera | CC BY 4.0 | 4TU | Bajo-medio | Media | no (4TU) |
| SMN-UNAM mareógrafos | Validación local de la marea | Puerto Chiapas, Salina Cruz | Cita requerida | Formulario, latencia humana | Medio | Media | no |
| CONAGUA BANDAS | Caudales (solo si se modelan entradas) | Estaciones Grijalva bajo | No verificada | Portal CONAGUA | Medio | Baja | no |

- Según el propio `AGENTS.md` del proyecto, **OPERA DSWx** (agua superficial) está en Earthdata (LP DAAC / PO.DAAC) y ya está autorizado; podría servir para delimitar el ancho real de cauces y lagunas a 30 m y como verificación del área inundada, alternativa con login a GRWL. No se verificó en esta ronda su resolución ni short name.
- Preferencia práctica con el login actual: **SWOT (cotas) + OPERA DSWx (máscara de agua)** dentro de Earthdata; para marea, surge y batimetría no hay sustituto en Earthdata y hay que salir a AVISO/SEANOE, CDS y GEBCO.

### Gaps
- No se verificó si existe en CMR algún espejo de MERIT Hydro, HydroSHEDS, GRWL o modelos de marea (la búsqueda no encontró ninguno; no es prueba de ausencia).
- No se verificó el short name de OPERA DSWx (HLS/S1) ni su utilidad sobre cauces estrechos del Grijalva.
- No se verificó si Hydrocron exige token Earthdata.
