# Fuentes y estrategias para validar un simulador de inundación pluvial/costera (LISFLOOD-FP 8.0.3 DG2, dominios de ~1–10 km², 30 m)

Fecha de la investigación: 2026-11-20. Alcance: global primero, ejemplos en México. Contexto de partida (del encargo, no verificado aquí): el intento en Chiapas (jun–nov 2026) falló porque NISAR GCOV (repetición de 12 días por traza) y OPERA DSWx-S1 no mostraron agua abierta nueva 13–24 h después de tormentas de 40–118 mm (IMERG Late); el agua pluvial drena rápido en relieve accidentado.

Nota de método: las búsquedas se limitaron a ~16 llamadas. Todo lo que no se pudo confirmar con una fuente quedó en "Gaps". Algunos resultados de búsqueda son resúmenes de un buscador sobre páginas primarias; se indica cuando la página primaria no se leyó completa.

## 1. Catálogos de eventos con extensión cartografiada

### Takeaway
Para encontrar "un evento donde una observación coincide con la inundación", lo más productivo es invertir el orden: partir de catálogos que ya contienen una extensión observada (Copernicus GFM desde 2015, Copernicus EMS Rapid Mapping, Global Flood Database 2000–2018, DFO, GDACS) y luego simular ese evento. GFM es la fuente global más útil (Sentinel-1, 20 m, archivo 2015–presente, API); EMS da delineaciones vectoriales finas pero solo para activaciones (México tiene varias: EMSR479 Tabasco 2020, EMSR485 Chiapas, EMSR774 Veracruz 2024, EMSR845 oct-2025). MODIS/VIIRS (~250 m) son demasiado gruesos para dominios de 1–10 km².

### Cited Findings
**Copernicus Global Flood Monitoring (GFM, parte de GloFAS/CEMS)**
- GFM produjo el primer archivo global de inundaciones Sentinel-1 (2015–presente) a partir de un cubo global de retrodispersión de 20 m; los usuarios pueden pedir la serie completa o un subconjunto de los productos archivados — [resumen de búsqueda sobre documentación GFM/EODC](https://extwiki.eodc.eu/GFM/PDD/Introduction); [GFM en GloFAS](https://global-flood.emergency.copernicus.eu/technical-information/glofas-gfm)
- API REST en `https://api.gfm.eodc.eu/v2/` y catálogo STAC; una presentación de GloFAS 2026 describe la API como servicio para usuarios expertos y WMS-T como opción de acceso libre — [gfm intro GloFAS AM 2026](https://global-flood.emergency.copernicus.eu/media/events/9/gfm_intro_glofas_am_2026-tobias.pdf)
- GFM integra un ensamble de tres algoritmos de cartografía; TU Wien desarrolla uno de ellos; el servicio se ofrece "on an open and free basis", con monitoreo continuo casi en tiempo real; usa el archivo completo de Sentinel-1 más capas auxiliares (óptica, topografía, hidrología, cobertura) — [TU Wien open data GFM](https://tuwien.at/en/mg/geo/rs/open-data/gfm)
- GFM incorporó Sentinel-1C y luego Sentinel-1D (versión 4.1.1) — [GFM incluye Sentinel-1C](https://global-flood.emergency.copernicus.eu/news/223-gfm-now-includes-data-from-sentinel-1c/); [GFM 4.1.1 recibe Sentinel-1D](https://global-flood.emergency.copernicus.eu/news/246-gfm-version-411-welcomes-sentinel-1d/) (la página no se pudo leer; solo el título).
- GloFAS publicó un análisis GFM de las inundaciones del centro y este de México de octubre de 2025 (Poza Rica, Veracruz) — [GloFAS news 225](https://global-flood.emergency.copernicus.eu/news/225-flooding-in-central-and-eastern-mexico-october-2025/)
- Licencia: una presentación de EFAS enlaza CC BY 4.0, pero no queda claro que cubra los datos GFM/API; existe la licencia "CEMS-FLOODS datasets licence" — [búsqueda GFM](https://european-flood.emergency.copernicus.eu/sites/default/files/AM/AM2025/AM2025pdf/How%20to%20use%20GFM%20in%20and%20outside%20of%20EFAS.pdf); [CEMS-FLOODS licence](https://ewds.climate.copernicus.eu/licences/cems-floods)

**Copernicus EMS Rapid Mapping**
- EMSR845: inundación en México, activada 13/10/2025 tras lluvias desde el 11/10/2025 en varios estados; solicitó extensión de inundación y evaluación de daños; la noticia no nombra AOIs, sensores ni fechas de imagen — [EMSR845 noticia](https://mapping.emergency.copernicus.eu/news/flood-in-mexico-emsr845/); [EMSR845 activación](https://mapping.emergency.copernicus.eu/activations/EMSR845)
- Otras activaciones México: EMSR774 (inundaciones Veracruz, 29/10/2024), EMSR485 (lluvias intensas en Chiapas, con grading de daños), EMSR479 (inundación Tabasco, noviembre 2020); también un monitoreo del ciclón tropical Erick (junio 2025) — [EMSR774](https://mapping.emergency.copernicus.eu/activations/EMSR774); [EMSR485](https://emergency.copernicus.eu/mapping/list-of-components/EMSR485); [EMSR479](https://emergency.copernicus.eu/mapping/list-of-components/EMSR479); [Erick 2025](https://mapping.emergency.copernicus.eu/news/tropical-cyclone-erick-25-in-mexico/); [Veracruz 2024](https://mapping.emergency.copernicus.eu/news/floods-in-veracruz-mexico/)
- Hay imagen del día de la UE sobre el huracán Otis en Acapulco (2023) — [EU Space image of the day](https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-day/hurricane-otis-hits-acapulco)
- Términos: acceso libre a los datos de CEMS On-Demand Mapping sujeto a cumplimiento; parte de los datos puede estar restringida (Reg. UE 2021/696) y requerir registro; productos "as is"; las descargas incluyen paquetes vectoriales (`..._vector.zip`); el disclaimer advierte limitaciones por escala, resolución, fecha e interpretación de la imagen fuente — [Términos EMS](https://mapping.emergency.copernicus.eu/terms-and-conditions/); [ejemplo vector](https://emergency.copernicus.eu/mapping/download/196734/EMSR599_AOI01_GRA_PRODUCT_r1_RTP02_v1_vector.zip); [manual de producto](https://emergency.copernicus.eu/mapping/ems/product-user-manual-cems-rapid-mapping)

**Global Flood Database (Tellman et al. 2021)**
- 913 eventos 2000–2018 cartografiados con MODIS a partir de 3 054 eventos del catálogo DFO (compilado en gran parte de noticias); solo se mapearon los que tenían observaciones MODIS mayormente sin nubes; disponible en Google Earth Engine (`GLOBAL_FLOOD_DB_MODIS_EVENTS_V1`), 2000-02-17 a 2018-12-10 — [GEE catálogo](https://developers.google.com/earth-engine/datasets/catalog/GLOBAL_FLOOD_DB_MODIS_EVENTS_V1); [Nature 2021](https://www.nature.com/articles/s41586-021-03695-w)
- Licencia CC BY-NC 4.0 (vista en una versión localizada del catálogo GEE; confirmar en la versión inglesa) — [GEE catálogo (de)](https://developers.google.com/earth-engine/datasets/catalog/GLOBAL_FLOOD_DB_MODIS_EVENTS_V1?hl=de)

**Dartmouth Flood Observatory (DFO) y GDACS**
- Archivo "activo" de grandes inundaciones (fuentes: noticias, gobiernos, instrumentos, sensores remotos), cada evento con un polígono del área afectada; descarga gratuita para investigación y educación; existe un FeatureServer ArcGIS; cobertura 1985–presente según un listado — [DFO archivo](https://floodobservatory.colorado.edu/Archives/index.html); [ArcGIS FeatureServer](https://services1.arcgis.com/AXaYBvnJsB5Q7sDF/ArcGIS/rest/services/Global_Archive_of_large_flood_events/FeatureServer); [World Bank water data](https://wbwaterdata.org/dataset/the-dfdo-flood-observatory/resource/2f714da4-36d3-4e6a-a11b-914594b1d983)
- GDACS: API libre; lista de eventos con `eventlist=FL`, filtros de fecha y alerta; polígonos GeoJSON por evento (`/gdacsapi/api/polygons/getgeometry?eventtype=FL&eventid=...`) — [GDACS API quickstart](https://data.gdacs.org/Documents\2025\GDACS_API_quickstart_v1.pdf)
- GDACS publicó un mapa diario ECDM de las inundaciones de México del 14/10/2025 — [ECDM 20251014](https://www.gdacs.org/contentdata/maps/daily/FL/1103425/ECDM_20251014_Mexico_FLOODS.pdf)

**NASA LANCE MCDWD (MODIS) / VCDWD (VIIRS)**
- Productos NRT diarios globales de ~250 m; VIIRS (375 m) se remuestrea a la misma malla; compuestos de 1, 2 y 3 días; las sombras de nubes y de terreno se detectan a menudo como agua; se prefieren los compuestos de 2–3 días salvo urgencia; la capa FloodCS_1Day tiene filtrado de sombra de nube — [MCDWD User Guide RevD](https://www.earthdata.nasa.gov/s3fs-public/2024-04/MCDWD_UserGuide_RevD.pdf); [LAADS desc 2026](https://www.earthdata.nasa.gov/s3fs-public/2026-04/MCDWD_LAADS_Desc.pdf)
- El archivo MODIS se reprocesó 2003–2025 y el flujo NRT continúa desde enero de 2026 (MCDWD_L3_NRT) — [NASA MODIS NRT flood](https://earthdata.nasa.gov/learn/find-data/near-real-time/modis-nrt-global-flood-product)

### Tabla resumen de todas las fuentes (con columna Earthdata)

Restricción añadida por el equipo: ya tienen login NASA Earthdata (ASF, LP DAAC, PO.DAAC, GES DISC autorizados). La columna "Earthdata" se verificó con consultas públicas a la API de CMR el 2026-11-20 (`https://cmr.earthdata.nasa.gov/search/collections.json?short_name=...`); "inicio CMR" es el `time_start` de la colección. "n/v" = no verificado en esta sesión. Resolución, licencia y latencia vienen de las fuentes citadas en cada sección.

| Fuente | Qué valida | Resolución | Cobertura / revisita | Licencia | Acceso | Latencia | Esfuerzo | Prioridad | Earthdata (short name / DAAC) |
|---|---|---|---|---|---|---|---|---|---|
| Copernicus GFM | Extensión observada (S1) | 20 m | 2015–presente; cada pasada S1 (6 días con S1C/D) | Abierta y gratuita; licencia exacta n/v | API REST v2, STAC, WMS-T, portal GloFAS | NRT (cifra n/v) | Medio | **Alta** | No (Copernicus/EODC) |
| Copernicus EMS Rapid Mapping | Extensión/daños delineados por evento | Depende de la imagen (n/v por activación) | Solo activaciones (México: EMSR479, 485, 774, 845) | Acceso libre con términos CEMS; parte restringida | Descarga ZIP vectorial por AOI | Horas–días tras activación (n/v) | Bajo-medio | **Alta** (si hay activación) | No |
| Global Flood Database | Extensión máxima por evento | ~250 m (MODIS) | 913 eventos 2000–2018 | CC BY-NC 4.0 (confirmar) | Google Earth Engine | Histórico | Bajo | Baja (resolución, termina en 2018) | No (no aparece en CMR por palabra clave "Global Flood Database"/"Tellman") |
| DFO archivo | Índice de eventos + polígono de área afectada | Polígono regional | 1985–presente | Gratis para investigación/educación | Descarga, ArcGIS FeatureServer | Días | Bajo | Media (índice) | No |
| GDACS | Índice de eventos + polígonos | Regional | Global, continuo | Datos libres | API REST (`eventlist=FL`), GeoJSON | NRT | Bajo | Media (índice) | No |
| LANCE MCDWD (MODIS) | Agua/inundación diaria | ~250 m | Diaria, compuestos 1/2/3 días | NASA abierta (n/v) | LANCE / Earthdata | NRT | Bajo | Baja (resolución) | **Sí**: `MCDWD_L3_NRT`, `MCDWD_L3_F1_NRT`, `F1C`, `F2`, `F3` / LANCEMODIS (inicio CMR 2021-03) |
| LANCE VCDWD (VIIRS) | Agua/inundación diaria | 375 m → malla ~250 m | Diaria | NASA abierta (n/v) | LANCE / Earthdata | NRT | Bajo | Baja | **Sí**: `VCDWD_L3_NRT`, `VCDWDG_L3_NRT` (inicio 2025-04-15), `VCDWD_L3_F1/F1C/F2/F3_NRT` (inicio 2026-03-04) / LANCEMODIS |
| OPERA DSWx-S1 (ya usado) | Agua abierta en cada pasada S1 | 30 m | Desde 2023-12 (CMR); revisita S1 | NASA abierta | Earthdata / PO.DAAC cloud | n/v | Bajo | Media | **Sí**: `OPERA_L3_DSWX-S1_V1` / POCLOUD |
| OPERA DSWx-HLS (ya usado) | Agua abierta óptica | 30 m | Desde 2016 (CMR); 2–3 días, nubes | NASA abierta | Earthdata / PO.DAAC cloud | n/v | Bajo | Baja (nubes) | **Sí**: `OPERA_L3_DSWX-HLS_V1` / POCLOUD |
| OPERA RTC-S1 | γ⁰ S1 corregido por terreno para hacer el propio mapa de cambio | 30 m | Desde 2016-04 (CMR) | NASA abierta | Earthdata / ASF cloud | n/v | Medio | **Alta** (permite umbral propio y cambio respecto de escena seca, sin depender del tile DSWx) | **Sí**: `OPERA_L2_RTC-S1_V1` / ASF |
| OPERA DIST-ALERT-S1 | Alertas de perturbación (no agua) | n/v | Desde 2026-01-01 (CMR) | NASA abierta | Earthdata / ASF | n/v | Medio | Baja (no es producto de agua; contexto) | **Sí**: `OPERA_L3_DIST-ALERT-S1_V1` / ASF |
| OPERA DIST-ALERT-HLS | Perturbación de vegetación | 30 m | Desde 2023 (CMR) | NASA abierta | Earthdata / LP DAAC cloud | n/v | Medio | Baja | **Sí**: `OPERA_L3_DIST-ALERT-HLS_V1` / LPCLOUD |
| Sentinel-1 GRD/SLC (A/C/D) | Retrodispersión C para mapa propio | ~10–20 m (GRD) | 6 días con S1C/D desde jul-2026 | Copernicus abierta | ASF (asf_search) | Horas (n/v) | Medio | **Alta** | **Sí**: p. ej. `SENTINEL-1C_DP_GRD_HIGH`, `SENTINEL-1C_SLC` (inicio 2025-03-28), `SENTINEL-1D_DP_GRD_HIGH`, `SENTINEL-1D_SLC` (inicio 2026-04-15) / ASF |
| NISAR GCOV (ya usado) | Retrodispersión L (HH doble rebote bajo vegetación) | 10 m (recorte del proyecto) | 12 días por traza | NASA abierta | ASF | n/v | Medio | Media (oportunista) | **Sí**: `NISAR_L2_GCOV_PROVISIONAL_V1`, `NISAR_L2_GCOV_BETA_V1`, `NISAR_L2_GCOV_V1` / ASF |
| ICEYE Open Data | Extensión en escenas de desastre publicadas | Métrica | Solo escenas publicadas | Gratis sin registro (licencia n/v) | AWS S3 + STAC | Publicación n/v | Bajo | **Alta** si existe escena del evento | No |
| Capella Open Data | Ídem | Métrica | Solo escenas publicadas | CC BY 4.0 | AWS S3 + Console | Publicación n/v | Bajo | **Alta** si existe escena | No |
| HLS (Sentinel-2/Landsat) | Agua/contexto óptico | 30 m | 2–3 días, nubes | NASA abierta | Earthdata / LP DAAC | n/v | Bajo | Baja | **Sí**: `HLSS30` (inicio 2015-11-28; `HLSL30` n/v) / LPCLOUD |
| PlanetScope (E&R) | Agua óptica alta resolución | ~3 m | Diaria, nubes | Programa E&R (términos 2026 n/v) | Planet | Diaria | Medio | Media | No |
| SWOT | WSE en ríos/lagos anchos | Pixel cloud / raster 100 m y 250 m | Desde 2022-12 (CMR); ciclo 21 días (n/v) | NASA abierta | Earthdata / PO.DAAC | n/v | Alto | Baja | **Sí**: `SWOT_L2_HR_PIXC_2.0`, `SWOT_L2_HR_Raster_2.0`, `SWOT_L2_HR_Raster_250m_2.0`, `SWOT_L2_HR_RiverSP_2.0` / POCLOUD |
| GPM IMERG (forzante y fijación del evento) | Hora y magnitud de la lluvia | 0.1°, 30 min | Desde 1998 (CMR) | NASA abierta | Earthdata / GES DISC | Early ~horas, Late ~días (n/v) | Bajo | **Alta** (para elegir eventos, no para validar extensión) | **Sí**: `GPM_3IMERGHH` (Final), `GPM_3IMERGHHE` (Early), `GPM_3IMERGHHL` (Late) / GES_DISC |
| GPM GV GFMS IFloodS | Mapas de inundación del Global Flood Monitoring System (campaña) | n/v | Desde 2013-03 (campaña de validación, EE. UU.) | NASA abierta | GHRC DAAC | Histórico | Bajo | Baja (fuera de México) | **Sí**: `gpmtfmifld` / GHRC_DAAC |
| Declaratorias CENAPRED | Índice de municipios y fechas afectados (México) | Municipio | Histórico | Pública (formato n/v) | Atlas Nacional de Riesgos / INFOMEX | Días–semanas | Medio | **Alta** (México) | No |
| Fotos/medios/reportes PC | Presencia/profundidad puntual | Punto | Por evento | Variable | Manual | Horas | Alto | **Alta** (pluvial) | No |

Hallazgos derivados de CMR:
- La Global Flood Database **no** apareció en CMR (búsqueda por palabra clave "Global Flood Database" y "Tellman"); se accede por Google Earth Engine — [CMR keyword search](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=Global%20Flood%20Database); [GEE](https://developers.google.com/earth-engine/datasets/catalog/GLOBAL_FLOOD_DB_MODIS_EVENTS_V1)
- Sentinel-1D ya está en ASF/CMR con colecciones GRD y SLC desde 2026-04-15 — [CMR SENTINEL-1D](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=SENTINEL-1D*&options[short_name][pattern]=true)
- Existe un producto OPERA nuevo, `OPERA_L3_DIST-ALERT-S1_V1` (ASF, desde 2026-01-01), que es de perturbación, no de agua — [CMR OPERA DIST](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=OPERA_L3_DIST-ALERT*&options[short_name][pattern]=true)
- Las colecciones VIIRS de inundación LANCE (`VCDWD_*`) existen en CMR desde 2025-04-15 / 2026-03-04 — [CMR VCDWD](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=VCDWD*&options[short_name][pattern]=true)
- `MCDWD_L3_NRT` figura en CMR con inicio 2021-03-01, mientras que la página NASA dice que el NRT continúa desde enero 2026 tras el reprocesado 2003–2025; probablemente el archivo reprocesado está en otra colección (LAADS), no verificado — [CMR MCDWD](https://cmr.earthdata.nasa.gov/search/collections.json?short_name=MCDWD_L3_NRT); [NASA MODIS NRT flood](https://earthdata.nasa.gov/learn/find-data/near-real-time/modis-nrt-global-flood-product)

### Inferences
- Con la cuenta Earthdata ya autorizada, el camino de menor esfuerzo y mayor probabilidad es: IMERG (`GPM_3IMERGHHE/HHL`) para fijar el pico → listar pasadas `SENTINEL-1C/1D` y `NISAR_L2_GCOV_*` en ±48 h con `asf_search` → construir mapa de cambio propio con `OPERA_L2_RTC-S1_V1` (evita depender de que la ROI quede dentro de un tile DSWx bien procesado, que fue uno de los fallos en Chiapas) → contrastar con `OPERA_L3_DSWX-S1_V1`. Las fuentes fuera de Earthdata que más aportan son GFM (archivo 2015+) e ICEYE/Capella.
- Prioridad ALTA: GFM (20 m, archivo 2015+, global, API/STAC/WMS-T). Es el catálogo más directo para buscar "eventos con observación": consultar el archivo por bbox y fecha devuelve directamente pasadas Sentinel-1 con agua observada. Limitación esperable: 20 m frente a celdas de 30 m es comparable, pero en dominios de 1 km² hay pocas decenas de píxeles inundados.
- Prioridad ALTA para eventos de México con activación: EMS da vectores de extensión observada (normalmente de imagen de mayor resolución) con fecha de imagen documentada. Esfuerzo bajo-medio (descarga manual de ZIP por AOI).
- Prioridad MEDIA: GDACS/DFO como índice de eventos (dónde y cuándo), no como verdad de terreno a 30 m.
- Prioridad BAJA para validar a 30 m: Global Flood Database y MCDWD (≈250 m). Sirven solo para dominios grandes o para confirmar que hubo inundación en el periodo. Además, la GFD termina en 2018.
- Los eventos con extensión cartografiada son casi siempre fluviales/costeros grandes y persistentes; justo los que menos se ajustan a un dominio pequeño sin caudal de entrada (ver sección 5).

### Gaps
- No se confirmó la licencia exacta de los datos y la API de GFM, ni si el acceso a la API requiere registro (la presentación 2026 la llama "para usuarios expertos").
- No se leyó el contenido de la noticia GFM 4.1.1 (Sentinel-1D); la página no cargó.
- No se encontraron AOIs, sensores ni resolución de EMSR845, EMSR774, EMSR485, EMSR479. No se verificó si hubo activación EMS para Otis (Acapulco 2023) ni para Tabasco 2007.
- No se verificaron en esta sesión: International Charter / UN-SPIDER (activaciones en México), mapas de inundación VIIRS de NOAA (JPSS/GMU), ni el estado de fin de vida de Terra/Aqua MODIS.

## 2. Observaciones radar: revisita, latencia y cómo elegir una adquisición cercana al pico

### Takeaway
En 2026 Sentinel-1 volvió a la revisita nominal de 6 días con S1C+S1D (S1A retirado hacia julio de 2026), lo que mejora pero no resuelve el desfase con crecidas pluviales de horas. NISAR (12 días por traza) aporta banda L útil bajo vegetación, pero con muy poca probabilidad de captar un pico pluvial. Los programas abiertos de ICEYE y Capella (CC BY 4.0 para Capella) publican escenas de desastre de alta resolución, a menudo adquiridas cerca del pico; son la mejor opción radar para eventos puntuales, pero el catálogo depende de qué decidió publicar la empresa.

### Cited Findings
- Sentinel-1D lanzado el 4/11/2025 en Ariane 6 — [ESA](https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-1D_reaches_orbit_on_Ariane_6)
- Plan de constelación: apertura de datos S1D prevista para el 17/04/2026; de mediados de abril a fin de junio 2026 S1D repite la traza de S1C un día después; en la segunda mitad de junio se restablece la revisita de 6 días entre S1C y S1D (S1C sin adquisiciones ~2 semanas durante su maniobra); hacia inicios de julio 2026 queda la configuración final y S1A se retira; la órbita C/D desplaza el patrón de 6 días un día respecto de A/B — [Copernicus Data Space: S1D user data opening](https://dataspace.copernicus.eu/node/3176)
- Una fuente secundaria dice que ESA declaró S1D plenamente operativo el 1/5/2026 (no confirmado en fuente ESA) — [Exterra](https://www.exterrajsc.com/p/europes-copernicus-radar-constellation)
- Capella Open Data: lanzado en septiembre de 2021 con 60 escenas; agrega imágenes tras desastres; acceso por Capella Console o AWS (`capella-open-data/data/`, COG), sin cuenta AWS; licencia CC BY 4.0 — [AWS Registry Capella](https://registry.opendata.aws/capella_opendata/); [Capella soporte](https://support.capellaspace.com/what-is-the-capella-open-data-program)
- ICEYE Open Data: acceso gratuito sin registro, en AWS (`--no-sign-request`), con navegador de mapa y catálogo STAC filtrables por lugar y fecha; ICEYE destaca una entrada titulada "Bridging the Gap Between Flood Models and Actual Flood Events" — [AWS Registry ICEYE](https://registry.opendata.aws/iceye-opendata/); [ICEYE Open Data](https://www.iceye.com/downloads/datasets?hsLang=en); [ICEYE STAC docs](https://sar.iceye.com/6.0.6/opendata/opendata/)
- Banda L y vegetación inundada: para inundaciones con NISAR el canal más relevante es HH (más sensible a superficie y doble rebote), HV es más útil para volumen/vegetación — [ARSET 2026 surface water](https://www.earthdata.nasa.gov/s3fs-public/2026-10/arset-2026-surfacewater-part1.pdf) (atribución según resumen de búsqueda)
- El aumento de retrodispersión por doble rebote con la subida del agua es significativamente menor donde hay mucha biomasa leñosa; los mapas PALSAR tienden a subestimar inundación en bosque denso — [PMC7988656](https://pmc.ncbi.nlm.nih.gov/articles/PMC7988656)
- Un resumen EGU 2026 espera que los productos de inundación NISAR se basen sobre todo en umbrales de retrodispersión y propone usar la fase InSAR de banda L para captar inundación bajo dosel denso que la intensidad no detecta — [EGU26-9354](https://meetingorganizer.copernicus.org/EGU26/EGU26-9354.html); [PNNL, L-band InSAR flooded vegetation](https://www.pnnl.gov/publications/exploring-potential-using-l-band-insar-mapping-flooded-vegetation-tropical-wetlands)
- Descomposición Freeman-Durden (doble rebote) ha mostrado potencial para detectar inundación — [par.nsf.gov](https://par.nsf.gov/servlets/purl/10409062)

### Inferences
- Probabilidad de captar el pico: con revisita de 6 días (S1C/D, más ascendente+descendente) un píxel tiene, en el mejor caso, una pasada cada pocos días según latitud y geometría; para agua pluvial que drena en <12–24 h la probabilidad de coincidencia es baja. En terreno plano (costa, planicies de Tabasco) el agua persiste días y la probabilidad sube mucho.
- Cómo elegir la adquisición: (1) fijar el evento con lluvia horaria (IMERG Early/Late de 30 min) o con el pico de marea/oleaje; (2) listar todas las pasadas S1/NISAR en ±48 h con `asf_search` (bbox + ventana); (3) preferir la primera pasada posterior al pico, comprobar que la ROI no quede en el borde del swath/tile; (4) usar una escena "seca" de la misma órbita relativa como referencia (cambio, no umbral absoluto).
- ICEYE/Capella: prioridad ALTA cuando existan escenas del evento (resolución métrica, a menudo pocas horas tras el pico); esfuerzo bajo (STAC/S3). Pero no se puede planificar: hay que buscar eventos ya publicados, no esperar uno.
- NISAR: prioridad MEDIA. Ventaja real en vegetación inundada (HH ↑ por doble rebote) y en humedales tropicales, pero 12 días por traza lo hace oportunista. En ciudad el doble rebote existe también sin agua, lo que complica la detección urbana.
- SAOCOM y RCM: no se investigaron en esta sesión (ver Gaps).

### Gaps
- No se confirmó en fuente ESA que la reconfiguración final S1C/S1D de junio–julio 2026 se completara ni la fecha de retiro de S1A.
- No se cuantificó cuántas escenas de inundación contienen los archivos ICEYE/Capella ni si incluyen eventos en México.
- No se verificaron condiciones de acceso, revisita ni latencia de SAOCOM (CONAE) ni RCM (CSA) para usuarios externos.
- No se encontró un estudio NISAR que cuantifique en dB el aumento de HH por inundación bajo vegetación.

## 3. Óptico y otras fuentes (Sentinel-2/HLS, PlanetScope, SWOT, crowdsourcing, registros de México)

### Takeaway
El óptico falla justo cuando llueve (nubes); PlanetScope perdió su vía gratuita tropical (NICFI terminó en enero 2025) y queda el programa de Educación e Investigación (hasta 3 000 km²/mes, términos por confirmar). SWOT mide elevación del agua en ríos/lagos anchos, no extensión pluvial de pocos km², y su validación con LISFLOOD-FP tiene riesgo de circularidad. Para México, la fuente más prometedora de "verdad" pluvial no es satelital: declaratorias de emergencia/desastre (CENAPRED/Atlas Nacional de Riesgos), reportes de Protección Civil, fotos en medios y redes con profundidades estimadas.

### Cited Findings
- Los mosaicos tropicales PlanetScope dejaron de formar parte del programa NICFI el 24/01/2025 por fin de contrato; Planet imagery dejó de estar en Global Forest Watch el 1/4/2025; Planet ofrece el Tropical Forest Observatory como sucesor — [Planet community](https://community.planet.com/tropical-basemaps-85/nicfi-satellite-data-program-prolongs-public-access-to-high-resolution-rainforest-satellite-images-6020); [GFW blog](https://www.globalforestwatch.org/blog/data-and-tools/planet-imagery-changes-gfw)
- Programa Planet Education and Research: acceso gratuito hasta 3 000 km²/mes de PlanetScope y RapidEye para uso académico (guía de Yale, actualizada 21/7/2025) — [Yale geospatial](https://geospatial.yale.edu/planet-labs-satellite-imagery-earth-data-analytics); [Planet soporte E&R](https://support.planet.com/hc/en-us/sections/36500753886877-Education-Research)
- SWOT: rendimiento limitado en ríos < 50 m de ancho, sobre todo durante crecidas; caso Du Gouffre (Quebec, ~40 m) comparado con LISFLOOD-FP: sesgos −0.30 a 0.43 m, RMSE 0.22–0.54 m; los autores aclaran que no es una validación independiente de SWOT — [HESS 2026, Mzoughi et al.](https://hess.copernicus.org/articles/30/4141/2026/)
- Crítica pública: el estudio juzga SWOT por acuerdo con el modelo, no con observaciones directas — [EGUsphere review](https://egusphere.copernicus.org/preprints/2025/egusphere-2025-5449/)
- Error SWOT en India: ~0.18 m en ríos > 100 m y ~0.26 m en ríos más estrechos (Patidar et al. 2025, citado en HESS) — [HESS 2026](https://hess.copernicus.org/articles/30/4141/2026/hess-30-4141-2026.pdf)
- CENAPRED actualizó su base de datos de declaratorias de desastre, emergencia y contingencia climatológica, consultable como aplicativo en el Atlas Nacional de Riesgos; publica resúmenes anuales de impacto socioeconómico (p. ej. 2020, 2022) — [Informe CENAPRED](https://www1.cenapred.unam.mx/DIR_SERVICIOS_TECNICOS/SANI/-/Informe%20de%20de%20gobierno/Informe%20de%20gobierno%20escrito%20CENAPRED.docx); [Impacto 2022](https://www1.cenapred.unam.mx/es/Publicaciones/archivos/494-RESUMENEJECUTIVOIMPACTO2022.PDF); [Impacto 2020](https://www1.cenapred.unam.mx/es/Publicaciones/archivos/482-IMPACTO_SOCIOECONOMICO_2020.PDF)
- CENAPRED ha respondido por INFOMEX solicitudes de datos nacionales de inundaciones y de declaratorias por municipio — [INFOMEX SINAPROC](https://www1.cenapred.unam.mx/DIR_INVESTIGACION/2020/1er_Trimestre/FRACCION_XLI/RI/200227_RI_PAT19_17872_SINAPROC_INFOMEX.pdf)

### Inferences
- Sentinel-2/HLS: prioridad BAJA para pluvial (nubes durante y justo después de la tormenta); útil como contexto pre/post y para máscaras de cobertura. OPERA DSWx-HLS hereda la misma limitación (ya se usó).
- PlanetScope: prioridad MEDIA si se aprueba el acceso E&R (diaria, ~3 m, pero óptica: mismas nubes). Revisar términos actuales antes de planificar.
- SWOT: prioridad BAJA para este simulador (dominios pequeños sin ríos de entrada; SWOT da WSE en ríos anchos y lagos). Solo sería pertinente en un dominio costero/lagunar amplio.
- Declaratorias CENAPRED: prioridad ALTA como **índice de eventos y municipios afectados** en México (no dan extensión ni profundidad). Esfuerzo medio (aplicativo ANR o solicitud de transparencia).
- Fotos de medios/redes y reportes de Protección Civil: prioridad ALTA para pluvial si se acepta un dato puntual (presencia/ausencia o profundidad estimada en un punto); esfuerzo alto (búsqueda manual, georreferencia, estimación de profundidad).

### Gaps
- No se encontró URL directa ni formato de descarga (CSV/API) del aplicativo de declaratorias del Atlas Nacional de Riesgos.
- No se confirmó si los términos Planet E&R siguen vigentes en noviembre de 2026.
- No se investigaron registros de aseguradoras en México (AMIS) ni bases de reportes ciudadanos mexicanos.

## 4. Métodos para validar modelos pluviales cuando el satélite no capta el pico

### Takeaway
La literatura valida modelos pluviales con observaciones puntuales e indirectas: marcas de agua (high-water marks), fotos con profundidad estimada, reclamaciones de seguros georreferenciadas, quejas 311, reportes de calles mojadas/secas y sensores de profundidad en calle; las métricas son tasa de aciertos (hit ratio), CSI con tabla de contingencia y error en profundidad (MAE/RMSE en marcas). Para el desfase temporal se compara la **profundidad máxima simulada** con observaciones sin hora exacta, y para la incertidumbre de ubicación se usan buffers.

### Cited Findings
- Budapest (2023): profundidades estimadas a partir de fotos en medios en línea, comparadas con un modelo pluvial 2D — [PIK publicación](https://publications.pik-potsdam.de/pubman/item/item_28880_1/component/file_28881/1-s2.0-S0048969723035854-main.pdf)
- Observaciones de crowdsourcing inciertas y sin hora asociada pueden servir para calibrar un modelo hidráulico (LISFLOOD-FP) en cuencas sin aforo (caso fluvial) — [Monash, JH](https://users.monash.edu.au/~jpwalker/papers/JH_22_1.pdf); [Monash, marco simple de calibración](https://research.monash.edu/en/publications/a-simple-framework-for-calibrating-hydraulic-flood-inundation-mod/)
- Vesdre (Bélgica, 2025): CSI 0.86 a 2 m de resolución y MAE de 0.56 m en profundidad máxima frente a marcas de agua; señala que limitaciones de los datos observados y discrepancias estructurales influyen fuertemente en el resultado — [J. Hydrology 2025 (ORBi)](https://orbi.uliege.be/bitstream/2268/337908/1/1-s2.0-S0022169425019183-main.pdf)
- Las observaciones in situ de inundaciones pluviales urbanas (p. ej. niveles de agua) son raras o muy escasas — [HESS 2026](https://hess.copernicus.org/articles/30/5491/2026/)
- Ningbo (EGU26): extensión máxima simulada de un evento pluvial validada contra reclamaciones de seguros georreferenciadas, con método de buffer para la incertidumbre de ubicación — [EGU26-8473](https://meetingorganizer.copernicus.org/EGU26/EGU26-8473.html?pdf)
- Nueva York: hit ratio 0.6–0.8 frente a quejas 311 y 0.4–0.7 frente a reportes de calles mojadas/secas — [AMS 2020](https://ams.confex.com/ams/2020Annual/webprogram/Paper370525.html)
- Los modelos de riesgo pluvial casi nunca se prueban empíricamente por la rareza de eventos locales intensos y la falta de monitoreo — [EGU22-7833](https://meetingorganizer.copernicus.org/EGU22/EGU22-7833.html)
- Reclamaciones y redes sociales no permiten evaluar cuantitativamente la dinámica espaciotemporal; sensores de profundidad en calle a 1 m sí — [Univ. Cagliari](https://iris.unica.it/retrieve/37bde9ea-0cd2-4062-8b29-448821d74ffb/Increasing%20the%20fidelity%20of%20hyperlocal%20simulations%20of%20urban%20pluvial%20flooding%20through%20street%20flooding%20observations.pdf)
- Un trabajo usa 311 y Waze como proxies independientes de impacto — [arXiv 2512.17785](https://arxiv.org/pdf/2512.17785v2)
- Métricas binarias por píxel (CSI de tabla de contingencia) y la necesidad de considerar el tamaño de elemento del modelo al comparar con marcas de agua — [NOAA repository](https://repository.library.noaa.gov/view/noaa/34035/noaa_34035_DS1.pdf)

### Inferences
- Estrategia recomendada para pluvial con satélite fuera de fase: (a) validar **profundidad máxima** del modelo contra observaciones puntuales sin hora (fotos, marcas, reportes) con hit ratio y MAE; (b) validar **extensión** solo con una observación dentro de la ventana en que el modelo todavía tiene agua, comparando el campo simulado **a la hora de la pasada** (no el máximo) contra el mapa observado; (c) tolerancia espacial con buffer ≥ 1 celda (30 m) y exclusión de zonas sin capacidad de observación (sombra/layover, urbano denso, vegetación densa en banda C).
- Métricas: CSI = TP/(TP+FP+FN), tasa de aciertos = TP/(TP+FN), FAR = FP/(TP+FP), sesgo; reportarlas sobre la máscara "observable". Con pocos píxeles inundados (dominio 1 km²) las métricas son inestables; conviene reportar conteos absolutos e intervalos.
- Si la observación está en otro instante, una validación honesta también es "negativa": comprobar que el modelo predice ausencia de agua a la hora de la pasada y que la observación tampoco la ve (acuerdo en lo seco). Esto no valida el pico, pero sí el drenaje.
- Detección de vegetación inundada: en Sentinel-1 (banda C) la vegetación densa oculta el agua; en NISAR (L, HH) el doble rebote aumenta la señal, pero el efecto disminuye con biomasa leñosa alta (ver sección 2).

### Gaps
- No se encontró una métrica estándar de "CSI con tolerancia temporal" entre una pasada satelital y la serie simulada.
- No se confirmaron en esta sesión las referencias clásicas de Bates, Wing (validación 30 m EE. UU.) ni Martinis (umbral S1); quedan como referencias a verificar.

## 5. Qué tipo de evento en México es más validable y si cabe en el alcance del simulador

### Takeaway
Los eventos mexicanos con mejor observación (Tabasco 2020, Veracruz 2024, oct-2025 en Veracruz/Puebla/Hidalgo, Otis 2023) son mayormente fluviales o costeros, de gran escala y persistentes; un dominio de 1–10 km² sin caudal de entrada no los representa bien. Lo más validable dentro del alcance actual sería un evento pluvial en **terreno plano** (planicie costera o urbana, donde el agua se encharca días), o un sector pequeño donde el agua observada provenga de lluvia local y no de desbordamiento de río.

### Cited Findings
- EMSR479: inundación en Tabasco, noviembre de 2020 — [EMSR479](https://emergency.copernicus.eu/mapping/list-of-components/EMSR479)
- EMSR774: inundaciones en Veracruz, 29/10/2024 — [EMSR774](https://mapping.emergency.copernicus.eu/activations/EMSR774)
- EMSR845 (oct-2025): lluvias intensas en varios estados, inundaciones y deslaves graves; GloFAS/GFM cartografió Poza Rica (Veracruz) — [EMSR845](https://mapping.emergency.copernicus.eu/news/flood-in-mexico-emsr845/); [GloFAS news 225](https://global-flood.emergency.copernicus.eu/news/225-flooding-in-central-and-eastern-mexico-october-2025/)
- EMSR485: lluvias intensas en Chiapas (grading de daños) — [EMSR485](https://emergency.copernicus.eu/mapping/list-of-components/EMSR485)
- Huracán Otis en Acapulco (2023) observado por Copernicus — [EU Space](https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-day/hurricane-otis-hits-acapulco)
- Contexto del encargo: el simulador actual usa frontera FREE idealizada y no tiene entrada de río (según AGENTS.md del proyecto, "frontera FREE idealizada"; ningún hidrograma de entrada).

### Inferences
- Tabasco 2020 / Veracruz 2024 / Poza Rica 2025: muy validables (GFM + EMS + agua persistente durante días), pero **fuera de alcance** sin hidrograma de entrada fluvial ni marea; un dominio de 10 km² dentro de la planicie inundada sólo vería el desbordamiento como condición de borde, no como lluvia local. Para usarlos haría falta añadir caudal o nivel impuesto en la frontera (fuera del alcance actual).
- Otis (Acapulco 2023): dominante viento y oleaje/marea de tormenta en costa empinada; la inundación pluvial urbana fue de corta duración. Validable solo con fotos/reportes puntuales, no con satélite. Fuera de alcance sin condición de marea.
- Más validable dentro del alcance: un evento pluvial en planicie (p. ej. zonas bajas costeras o llanuras de Tabasco/Campeche/Yucatán, donde el drenaje es lento) con una pasada S1/GFM o una escena ICEYE/Capella publicada dentro de 24–48 h. Buscar primero en el archivo GFM y en los catálogos ICEYE/Capella por bbox y fecha, y cruzar con IMERG para confirmar que la lluvia local explica el agua.
- Alternativa global de bajo riesgo: elegir un evento fuera de México con escena ICEYE/Capella abierta de una inundación pluvial urbana o costera bien documentada, como demostración del método, y presentar el caso de Chiapas como "no validado" con la explicación del desfase temporal.

### Gaps
- No se verificó qué escenas de Tabasco 2007, Otis 2023 o eventos de Chiapas 2026 existen en los archivos ICEYE/Capella abiertos.
- No se verificó la cobertura del archivo GFM sobre la ROI de Chiapas en las fechas de las tormentas (jun–nov 2026).
- No se identificó un evento pluvial mexicano concreto en terreno plano con observación coincidente; requiere una búsqueda dirigida en GFM + IMERG.
