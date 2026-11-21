# Suelo, cobertura e infiltración para el simulador pluvial (LISFLOOD-FP 8.0.3 DG2)

Notas de investigación, 2026-11-20. Contexto: dominios de ~1-10 km², celdas de 30 m, hoy n de Manning uniforme y coeficiente de escorrentía agregado C = min(0.92, 0.65 + 0.27·(1 − e^(−D/24 h))) uniforme; lluvia en NetCDF por celda. Restricción añadida: el equipo tiene cuenta NASA Earthdata (ASF, LP DAAC, PO.DAAC, GES DISC autorizados); cada fuente lleva columna "Earthdata". Las comprobaciones en CMR se hicieron con la API pública `https://cmr.earthdata.nasa.gov/search/collections.json` el 2026-11-20.

## ¿LISFLOOD-FP 8 DG2 admite infiltración interna o pérdidas por celda? (pregunta de arquitectura, va primero porque condiciona todo lo demás)

### Takeaway
No. En el código fuente 8.0 compilado en el repo, el solver DG2 (y FV1) solo suma lluvia al tirante y nunca llama a la rutina de infiltración; la infiltración (`infiltration`/`inf`, escalar) existe solo en el camino clásico `IterateQ`, y la infiltración distribuida (`infilfile`) solo en el modelo de subred (SGM). Para DG2 la ruta correcta es escribir **lluvia neta por celda** en el NetCDF; `manningfile` sí funciona en DG2.

### Cited Findings
- El despachador llama a `fv1::solve` o `dg2::solve` para los solvers nuevos; `IterateQ` (donde vive la infiltración) solo se ejecuta para los demás solvers — código local `data/tools/lisflood-fp-8.0/runtime/source/lisflood.cpp:738-760` (línea 738 tiene `IterateQ` comentado en la rama DG2).
- `FPInfiltration` solo se invoca en `iterateq.cpp:153` (`if (Statesptr->calc_infiltration == ON) FPInfiltration(...)`); resta `InfilRate * Tstep` del tirante en celdas mojadas sin canal — `runtime/source/iterateq.cpp:153`, `runtime/source/infevap.cpp:14-39`.
- Palabras clave del archivo `.par`: `infiltration` o `inf` (tasa escalar, activa `calc_infiltration`) e `infilfile` (activa `calc_distributed_infiltration`) — `runtime/source/pars.cpp:475-485`. El archivo distribuido se lee en mm/h y se convierte a m/s (`/60/60/1000`) — `runtime/source/input.cpp:881-904`. Solo lo consume el modelo de subred: `runtime/source/lisflood2/sgm_fast.cpp:3112`. Historial: "JUN 21 2019 7.0.6 Added distributed infiltration to SG model (JCN)" — `runtime/source/VersionHistory.h:72`.
- DG2 aplica la lluvia dinámica con `rain.update_H(...)` (`runtime/source/swe/dg2.cpp:52,62`), que hace `H += rate_at_cell(i,j) * Tstep` en toda celda con DEM válido, sin pérdidas ni recorte a cero — `runtime/source/rain/rain.tpp:157-185`. En `swe/` no aparece ninguna referencia a `infil` ni `evap`.
- Fricción por celda en DG2: si `Arrptr->Manningsn` está cargado se usa `Manningsn[j*xsz+i]`, si no `FPn` — `runtime/source/swe/dg2/friction.cpp:11-23` (igual en `swe/fv1.cpp:111-139`); la palabra clave es `manningfile` — `runtime/source/pars.cpp:234`.
- El artículo de LISFLOOD-FP 8.0 confirma que DG2/FV1 cargan lluvia variable en espacio y tiempo en formato NetCDF de TUFLOW y que son puramente 2D (sin canal de subred) — [Shaw et al. 2021, GMD 14, 3577](https://gmd.copernicus.org/articles/14/3577/2021/).

### Inferences
- La lluvia neta precalculada (lluvia − pérdidas por celda y por paso de tiempo) es la única vía sin modificar el solver. Su limitación física: no representa la **infiltración de escorrentía que llega desde aguas arriba** (run-on) sobre suelos permeables, porque la pérdida se descuenta antes de que el agua se mueva. Esto sesga al alza el tirante en zonas bajas permeables (p. ej. cultivos al pie de ladera urbana).
- Como `update_H` no recorta a cero, un valor negativo en el NetCDF restaría agua y podría producir tirantes negativos; la lluvia neta debe cumplir `≥ 0` siempre (validarlo antes de escribir el cubo).
- Alternativa más fiel pero con otro solver: ACC/SGM admite infiltración, pero solo como tasa constante en el tiempo (sin Green-Ampt ni CN) y `infilfile` solo en SGM; cambiar de solver no se justifica solo por esto.
- Opción intermedia (inferencia, no implementada en ningún lugar verificado): escribir lluvia neta con un método que dependa de la lámina acumulada (CN incremental o Green-Ampt), que es lo que hacen modelos hidrológicos de evento; sigue sin capturar run-on.

### Gaps
- No se encontró en línea el manual de usuario 8.0 (seamlesswave.com) para confirmar si la documentación oficial menciona la ausencia de infiltración en DG2; la conclusión se basa en el código fuente local, que es la evidencia primaria.

## Mapas de cobertura del suelo: resolución, licencia, acceso sin Earth Engine y cadencia

### Takeaway
ESA WorldCover 2021 (10 m, CC BY 4.0, COG en AWS sin cuenta) es la mejor base global para Manning y para fracción construida; Esri/Impact Observatory 10 m (CC BY 4.0, anual 2017-2023, Planetary Computer/AWS) es el complemento cuando se necesita un año más reciente. MODIS MCD12Q1 es la única cobertura vía Earthdata pero a 500 m es inútil para celdas de 30 m.

### Cited Findings
| Fuente | Qué aporta | Resolución / cobertura | Licencia | Acceso | Cadencia / latencia | Earthdata | Prioridad |
|---|---|---|---|---|---|---|---|
| ESA WorldCover 2020 v100 / 2021 v200 | 11 clases (árbol, arbusto, pasto, cultivo, construido, desnudo, nieve, agua, humedal herbáceo, manglar, musgo) | 10 m global, COG EPSG:4326 en teselas de 3×3° (2651 teselas) | CC BY 4.0, "free of charge … no restriction on use" | AWS S3 `esa-worldcover` (eu-central-1, sin login), Zenodo, Terrascope (login gratuito), WMS/WMTS, GEE `ESA/WorldCover/v200` | Solo 2020 y 2021; la página no anuncia años nuevos. Exactitud global 74.4 % (2020) y 76.7 % (2021) | No | **Alta** |
| Esri / Impact Observatory 10 m Annual LULC (9 clases, v2) | Uso/cobertura anual | 10 m global | CC BY 4.0 | Microsoft Planetary Computer, AWS Open Data, Living Atlas | Anual 2017-2023 (v2) | No | Media |
| Google Dynamic World | Probabilidades por clase casi en tiempo real (escena Sentinel-2) | 10 m | Sin verificar | Earth Engine (sin verificar otra vía) | Casi tiempo real | No | Baja |
| MODIS MCD12Q1 v061 | Cobertura anual IGBP | 500 m global | (NASA, datos abiertos) | LP DAAC `LPCLOUD` | Anual, en curso | **Sí** (MCD12Q1 v061 / LP DAAC) | Baja (demasiado gruesa) |
| OPERA DIST-ALERT-HLS / DIST-ANN-HLS v1; DIST-ALERT-S1 v1 | Alertas de perturbación de vegetación (para actualizar el mapa de cobertura tras desmonte/incendio) | 30 m | (NASA, abiertos) | LP DAAC / ASF | En curso | **Sí** (OPERA_L3_DIST-ALERT-HLS_V1 / LPCLOUD; OPERA_L3_DIST-ALERT-S1_V1 / ASF) | Baja-media |

- WorldCover: licencia, versiones, bucket S3, teselas COG y exactitudes — [ESA WorldCover data access](https://esa-worldcover.org/en/data-access).
- Esri/IO 10 m: "all years are available under a Creative Commons BY-4.0"; v2 9 clases 2017-2023 — [Planetary Computer io-lulc-annual-v02](https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02); [AWS Registry io-lulc](https://registry.opendata.aws/io-lulc/); [Esri Living Atlas](https://livingatlas.arcgis.com/landcover/).
- MCD12Q1 v061 500 m anual en LPCLOUD; OPERA DIST en LPCLOUD y ASF — consulta CMR propia (2026-11-20), [CMR collections API](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=MCD12Q1).
- Un estudio de 2025 que comparó productos de cobertura en modelación 2D encontró que Dynamic World generó más zonas con Manning alto (manchas de inundación mayores) y Esri 10 m Annual más zonas de rugosidad baja — [Natural Hazards, doi 10.1007/s11069-025-07517-4](https://api.crossref.org/works/10.1007/s11069-025-07517-4) (dato tomado del resumen del buscador; no se leyó el texto completo).
- Soliman et al. (2022) propusieron una tabla de Manning para Esri LULC 2020 porque el producto no la traía (a diferencia de NLCD) — [Water 14(23):3963](https://www.mdpi.com/2073-4441/14/23/3963).

### Inferences
- Para 30 m: reclasificar WorldCover 10 m a Manning y **promediar n en 3×3 píxeles** (o tomar la clase mayoritaria) al bajar a 30 m; promediar n es más estable que la moda en bordes.
- WorldCover es de 2021: en Chiapas puede haber cambio de cultivo/desmonte posterior; Esri/IO 2023 o una revisión con OPERA DIST cubre ese hueco.
- Prioridad alta para WorldCover porque ya está identificada, es CC BY 4.0, no exige cuenta y tiene clase "manglar" y "humedal" separadas, útiles para Manning.

### Gaps
- Licencia y vías de descarga de Dynamic World fuera de Earth Engine: no verificadas.
- Copernicus Global Land Cover 100 m (CGLS-LC100) e INEGI Uso de suelo y vegetación (Serie VII, 1:250 000): no se recuperaron fuentes en esta sesión; no se pueden afirmar licencia, años ni escala.
- Si Esri/IO publicó 2024-2025: no verificado.

## Tablas publicadas cobertura → n de Manning y propuesta para WorldCover

### Takeaway
Hay dos familias de valores incompatibles: los de **flujo profundo** (HEC-RAS 2D, Chow; n ≈ 0.03-0.2) y los de **flujo laminar somero** (Kalyanapu 2009; pasto n ≈ 0.37), que no deben mezclarse. Para WorldCover existe una tabla directa (plugin QGIS de Azzam, adoptada por GRASS `r.manning`), pero asigna n = 0.018 a "construido", lo que solo es válido si los edificios están en el DEM; si no, conviene una rugosidad "de bloque" urbana de 0.08-0.16 (rango HEC-RAS).

### Cited Findings
- Tabla WorldCover (mín/normal/máx) de `r.manning`, tomada del plugin QGIS "Manning's Roughness Generator" (Azzam) para WorldCover 2021: 10 árbol 0.070/0.094/0.124; 20 arbusto 0.045/0.066/0.096; 30 pasto 0.028/0.033/0.043; 40 cultivo 0.025/0.035/0.045; 50 construido 0.016/0.018/0.020; 60 desnudo/escaso 0.010/0.023/0.035; 70 nieve 0.010/0.020/0.030; 80 agua 0.025/0.035/0.045; 90 humedal herbáceo 0.060/0.090/0.120; 95 manglar 0.150/0.225/0.300; 100 musgo/liquen 0.040/0.060/0.080 — [GRASS r.manning source](https://raw.githubusercontent.com/OSGeo/grass-addons/grass8/src/raster/r.manning/r.manning.py); [r.manning manual](https://grass.osgeo.org/grass86/manuals/addons/r.manning.html).
- Tabla NLCD de HEC-RAS 2D User's Manual 6.6 ("deep flow", profundidad > 0.3 m), mín/normal/máx: agua 0.025/0.035/0.050; urbano abierto 0.030/0.040/0.050; urbano baja intensidad 0.060/0.085/0.120; media 0.080/0.100/0.160; alta 0.120/0.160/0.200; suelo desnudo 0.023/0.030/0.030; bosque caducifolio 0.100/0.140/0.200; perennifolio 0.080/0.120/0.160; mixto 0.080/0.130/0.200; arbusto 0.070/0.100/0.160; pastizal 0.025/0.035/0.050; pasto/heno 0.025/0.035/0.050; cultivos 0.020/0.030/0.050; humedal leñoso 0.045/0.100/0.150; humedal herbáceo 0.050/0.060/0.085 — [GRASS r.manning source](https://raw.githubusercontent.com/OSGeo/grass-addons/grass8/src/raster/r.manning/r.manning.py) (los valores "normal" se estimaron con multiplicadores 0.75/1.33 sobre los rangos, siguiendo a Chow).
- Tabla Kalyanapu et al. (2009) para flujo somero (NLCD): pastizal 0.368, bosque perennifolio 0.32, arbusto 0.40, cultivo 0.16 (McCuen 2005, labranza convencional), urbano baja/media 0.068, urbano alta 0.040, desnudo 0.011; los rangos son estimados con 0.75/1.33 — [GRASS r.manning source](https://raw.githubusercontent.com/OSGeo/grass-addons/grass8/src/raster/r.manning/r.manning.py); cita original: Kalyanapu, Burian & McPherson (2009), J. Spatial Hydrology 9:51-71 — [GRASS wiki NLCD](https://grasswiki.osgeo.org/wiki/NLCD_Land_Cover).
- AutoCF usa WorldCover 10 m 2021 y convierte clases a Manning con mapeos configurables y sobrescrituras por polígono con información local — [AutoCF, arXiv](https://arxiv.org/pdf/2609.35753).
- LISFLOOD (JRC, modelo hidrológico, no LISFLOOD-FP) usa tablas de Manning basadas en Corine — [Copernicus EFAS Dataset_hydro](https://european-flood.emergency.copernicus.eu/sites/default/files/Manuals/Dataset_hydro.pdf).

### Inferences
Tabla propuesta para el simulador (WorldCover → n, flujo pluvial de profundidad típica 0.05-1 m, celdas 30 m). "Rango" es el intervalo para análisis de sensibilidad:

| Clase WorldCover | n propuesto | Rango sensibilidad | Base |
|---|---|---|---|
| 10 Árbol | 0.10 | 0.07-0.14 | Azzam 0.094; HEC-RAS bosque 0.12-0.14 |
| 20 Arbusto | 0.07 | 0.045-0.10 | Azzam 0.066; HEC-RAS 0.10 |
| 30 Pastizal | 0.035 | 0.025-0.05 | Azzam 0.033; HEC-RAS 0.035 |
| 40 Cultivo | 0.035 | 0.02-0.05 | Azzam 0.035; HEC-RAS 0.030 |
| 50 Construido, **edificios fuera del DEM** (caso NASADEM 30 m) | 0.10 | 0.06-0.16 | HEC-RAS urbano baja-media 0.085-0.10 (rugosidad de bloque) |
| 50 Construido, edificios representados (DEM elevado / huecos) | 0.016-0.02 | 0.013-0.025 | Azzam 0.018 (asfalto/concreto) |
| 60 Desnudo / escaso | 0.025 | 0.011-0.035 | Azzam 0.023; HEC-RAS 0.030 |
| 80 Agua permanente | 0.035 | 0.025-0.045 | Azzam / HEC-RAS 0.035 |
| 90 Humedal herbáceo | 0.07 | 0.05-0.12 | HEC-RAS 0.06; Azzam 0.09 |
| 95 Manglar | 0.15 | 0.10-0.30 | Azzam 0.225 (rango 0.15-0.30); HEC-RAS humedal leñoso 0.10 |
| 100 Musgo/liquen; 70 Nieve | 0.06; 0.02 | — | Azzam (irrelevantes en Chiapas) |

- Elección de la rama urbana: NASADEM (derivado de SRTM, 30 m) no resuelve edificios individuales, así que el efecto de bloqueo debe entrar como rugosidad alta; el valor 0.018 de Azzam subestimaría la resistencia. Es una decisión de modelado, no un dato; debe quedar en los metadatos del resultado.
- No usar Kalyanapu (n ≈ 0.3-0.4 en pasto/bosque) salvo para láminas < ~3 cm: con DG2 sobre ladera esos valores frenarían de más el flujo una vez que la lámina supera la rugosidad de la vegetación.
- Como la tabla HEC-RAS ya fija "normal" con multiplicadores, los números son orientativos; con todo, la mancha de inundación es sensible al producto y a la tabla (estudio 2025 citado arriba), lo que justifica correr al menos el extremo bajo y alto del rango.

### Gaps
- No se pudo leer el texto de Chow (1959) ni tablas específicas de estudios LISFLOOD-FP con ESA CCI; los valores de Chow aparecen solo indirectamente (multiplicadores 0.75/1.33 en `r.manning`).
- No se encontró un estudio de calibración de Manning por cobertura en México o Centroamérica.
- Enfoques de resistencia de edificios (porosidad, "building block") no se revisaron con fuente primaria en esta sesión.

## Número de curva, grupos hidrológicos y propiedades hidráulicas del suelo; cálculo de escorrentía por celda

### Takeaway
GCN250 (CN a 250 m para condición seca, media y húmeda, CC BY 4.0) da directamente un CN por celda; HYSOGs250m (en ORNL DAAC, vía Earthdata) es su insumo de suelos. Para Green-Ampt, Ksat de HiHydroSoil v2.0 o del mapa CoGTF de Gupta (2021) más θs/ψ por textura (Rawls). Ambos métodos se pueden convertir a lluvia neta incremental por celda y paso de tiempo para el NetCDF.

### Cited Findings
| Fuente | Qué aporta | Resolución | Licencia | Acceso | Earthdata | Prioridad |
|---|---|---|---|---|---|---|
| GCN250 (Jaafar et al. 2019) | CN por celda para ARC seco, medio y húmedo (GCN250Dry/Average/Wet) | ~250 m global | CC BY 4.0 | GEE (comunidad); descarga original en el repositorio del artículo | No | **Alta** |
| HYSOGs250m (Ross et al. 2018) | Grupo hidrológico A-D (y duales) desde textura, profundidad a roca y nivel freático | 250 m global | (ORNL DAAC, abierto) | ORNL DAAC | **Sí** (`Global_Hydrologic_Soil_Group_1566` / ORNL_CLOUD) | **Alta** |
| HiHydroSoil v2.0 (FutureWater) | Ksat (cm/d), contenidos de agua de saturación, etc., varias profundidades | 250 m global | CC BY 4.0 | FutureWater / GEE comunidad | No | Media |
| Gupta et al. 2021 (CoGTF) | Ksat global por random forest con covariables | Global (resolución sin verificar) | Sin verificar | Sin verificar | No | Media |
| SoilGrids (ya identificada) | Arena/limo/arcilla → clase textural → parámetros Rawls | 250 m | (ya documentada por el equipo) | REST/WCS | No | Alta (como insumo de textura) |

- GCN250: Scientific Data 6:145 (2019); CN a ~250 m para condiciones antecedentes seca, media y húmeda; promedios globales 62, 78 y 90; combina ESA CCI-LC 2015 remuestreado a 250 m con HYSOGs250m; CC BY 4.0; activos GCN250Dry/Average/Wet en GEE — [Jaafar et al. 2019](https://www.nature.com/articles/s41597-019-0155-x); [GEE community catalog](https://gee-community-catalog.org/projects/gcn250/).
- HYSOGs250m: grupos hidrológicos globales desde textura, profundidad a roca y agua subterránea — [Ross et al. 2018, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5952866/); colección CMR `Global_Hydrologic_Soil_Group_1566` v1 en ORNL_CLOUD (consulta propia, [CMR](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=HYSOGs250m)).
- HiHydroSoil v2.0: 250 m global, CC BY 4.0, Ksat en cm/d — [FutureWater](https://www.futurewater.eu/2020/10/futurewater-releases-new-hihydrosoil-dataset-global-maps-of-soil-hydraulic-properties-at-250m-resolution/); [GEE community HiHydroSoil](https://gee-community-catalog.org/projects/hihydro_soil/). En una validación independiente HiHydroSoil v2.0 tuvo mayor error en Ksat que el mapa CoGTF de Gupta et al. (2021) — [Gupta et al. 2021, JAMES](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2020MS002242).
- Parámetros Green-Ampt por textura (Rawls et al., reproducidos por TxDOT; θs, θi, ψ en pulgadas, Ks en pulg/h): arena 0.437 / 0.417 / 1.95 / 9.28; arena franca 0.437 / 0.401 / 2.41 / 2.35; franco arenoso 0.453 / 0.412 / 4.33 / 0.86; franco 0.463 / 0.434 / 3.50 / 0.52; franco limoso 0.501 / 0.486 / 6.57 / 0.27; franco arcillo-arenoso 0.398 / 0.330 / 8.60 / 0.12; franco arcilloso 0.464 / 0.309 / 8.22 / 0.08; franco arcillo-limoso 0.471 / 0.432 / 10.75 / 0.08; arcillo-arenoso 0.430 / 0.321 / 9.41 / 0.05; arcillo-limoso 0.479 / 0.423 / 11.50 / 0.04; arcilla 0.475 / 0.385 / 12.45 / 0.02 — [TxDOT Hydraulic Design Manual, Green and Ampt](https://www.txdot.gov/manuals/des/hyd/chapter-4--hydrology/section-13--hydrograph-method/green-and-ampt-loss-model.html); artículo original Rawls, Brakensiek & Miller (1983), ~5000 horizontes — [ASCE 1983 PDF](https://dnrftp.state.co.us/DWR/DamSafety/HydrologyGuidelines_doNOTdelete/Guidelines_References/Rawls%20et%20al%20Green-Ampt%20Infiltration%20parameters%20from%20soils%20data%20ASCE%201983.pdf).
- Método CN (NRCS): Ia = 0.2S en las tablas; z = 254 en unidades métricas; la humedad antecedente se estima con al menos cinco días; la humedad puede cambiar durante la tormenta (de seca a media a húmeda); valores tabulados de NRCS (1986) — [TxDOT, NRCS Curve Number Loss Model](https://www.txdot.gov/manuals/des/hyd/chapter-4--hydrology/section-13--hydrograph-method/nrcs-curve-number-loss-model.html).
- Conversión de condición antecedente (SWAT+): CN1 = CN2 − 20·(100 − CN2) / (100 − CN2 + exp[2.533 − 0.0636·(100 − CN2)]); CN3 = CN2·exp[0.00673·(100 − CN2)]; I = seco (punto de marchitez), III = húmedo (capacidad de campo) — [SWAT+ docs](https://swatplus.gitbook.io/io-docs/theoretical-documentation/section-2-hydrology/chapter-2-1-surface-runoff/2-1.1-runoff-volume-scs-curve-number-procedure/2-1.1.1-scs-curve-number/2-1.1.1.2-antecedent-soil-moisture-condition).
- Comparación de fórmulas de conversión AMC: Sobhani fue la mejor para CN I y Hawkins para CN III; algunas fórmulas dan CN I negativos con CN II bajos — [Mishra, Jain & Suresh Babu 2008, Water Resour. Manage.](https://doi.org/10.1007/s11269-007-9233-5).
- Umbrales de lluvia antecedente de 5 días (ejemplo): AMC I < 0.5 pulg en temporada de reposo y < 1.4 pulg en temporada de crecimiento — [Illinois State Water Survey CR-288](https://www.isws.illinois.edu/pubdoc/CR/ISWSCR-288.pdf).

### Inferences
- Lluvia neta incremental con CN (por celda c y paso k): S = 25400/CN − 254 (mm), Ia = 0.2·S, Q(P) = (P − Ia)²/(P − Ia + S) si P > Ia, si no 0; neta_k = Q(P_k) − Q(P_{k−1}) con P acumulada. Siempre ≥ 0, como exige `update_H`.
- Orden de magnitud frente al C actual (0.65-0.92): con los promedios globales de GCN250 y un evento de 100 mm, CN 62 → Q ≈ 21 mm (C ≈ 0.21); CN 78 → Q ≈ 47 mm (C ≈ 0.47); CN 90 → Q ≈ 73 mm (C ≈ 0.73) (cálculo propio con la fórmula anterior). El C actual equivale a suelos casi saturados o muy impermeables en todo el dominio; probablemente sobrestima escorrentía en celdas boscosas o de cultivo, salvo en condición húmeda.
- Green-Ampt por celda: capacidad f(t) = Ks·(1 + ψ·Δθ/F(t)), Δθ = θs − θi, con θi de un producto de humedad (sección siguiente); lluvia neta = max(0, i − f). Es sensible a la intensidad (sub-horaria), cosa que CN ignora: CN reparte un volumen de evento, no responde a picos de intensidad.
- Validez a 30 m: GCN250 y HYSOGs250m son de 250 m, así que cada valor cubre ~70 celdas de 30 m; la variación fina vendrá solo de la cobertura (WorldCover) si se recalcula CN = f(clase WorldCover, HSG) en lugar de usar GCN250 directo. Recalcular con WorldCover + HYSOGs es mejor para 30 m, pero exige una tabla CN por clase (NRCS TR-55) y su verificación.
- Ia = 0.2S tiende a sobrestimar la abstracción inicial en eventos pequeños; la literatura propone 0.05S (Hawkins et al. 2002), pero esa cifra **no** se verificó en esta sesión.
- Recomendación de diseño: CN como método por defecto (global, con dato directo, interpretable) y Green-Ampt como opción avanzada cuando haya θi confiable; ambos con su incertidumbre declarada (sin validación hidráulica).

### Gaps
- Tabla CN de NRCS TR-55 por uso y HSG: la página de TxDOT confirma su estructura pero no se extrajeron los valores; deben copiarse de TR-55 (USDA 1986) antes de usarse.
- Coeficientes exactos y fuente primaria de Hawkins (1978/2002) para CN I/III e Ia/S = 0.05: no verificados.
- SoilKsatDB (Gupta et al.) y los mapas de Zhang/Schaap (Rosetta global): no se recuperó página de datos; licencia y resolución sin verificar. CMR no devolvió colecciones globales de Ksat.
- GCN250 se construyó con ESA CCI-LC 2015 (300 m): no refleja cambios de uso posteriores.

## Humedad antecedente del suelo: productos, resolución, latencia y cómo usarla

### Takeaway
El producto más alineado con el proyecto es **NISAR L3 SME2** (200 m, ASF, Earthdata): hay 29 gránulos PROVISIONAL sobre la ROI hasta 2026-10-16, incluido uno de la misma pasada del par GCOV de trabajo. Para lluvia casi en tiempo real, SMAP L4 (9 km, 3-horario) o GLDAS Early Product (0.25°) vía Earthdata; ERA5-Land (9 km, horario, ~5 días de retraso) como alternativa no-NASA. Todos son más gruesos que 30 m salvo SME2, que excluye zonas urbanas y agua.

### Cited Findings
| Fuente | Resolución | Latencia / revisita | Earthdata | Notas | Prioridad |
|---|---|---|---|---|---|
| NISAR L3 SME2 PROVISIONAL v1 / BETA v1 | 200 m (500 m en el Sahara) | Objetivo 72 h; revisita 12 días (6 con asc.+desc.) | **Sí** (`NISAR_L3_SME2_PROVISIONAL_V1`, `NISAR_L3_SME2_BETA_V1` / ASF) | Excluye hielo permanente, **zonas urbanas** y aguas interiores; meta 0.06 m³/m³ con VWC < 5 kg/m²; versión VALIDATED aún no disponible según ASF | **Alta** |
| SMAP L4 SPL4SMGP v008 | 9 km EASE-Grid, cada 3 h, superficie y zona radicular | Media ~2.5 días (sin confirmar en fuente primaria) | **Sí** (SPL4SMGP v008 / NSIDC) | Modelo + asimilación, sin huecos | Alta |
| SMAP L3 SPL3SMP v009 / SPL3SMP_E v006 | 36 km / 9 km diario | 1-3 días | **Sí** (NSIDC) | Huecos entre pasadas | Media |
| SMAP/Sentinel-1 SPL2SMAP_S v003 | 3 km (escena) | Sin verificar | **Sí** (NSIDC) | Cobertura irregular | Baja |
| GLDAS Noah 0.25° 3-horario v2.1 y Early Product (_EP) | 0.25°, 3 h | EP: sin verificar | **Sí** (`GLDAS_NOAH025_3H`, `GLDAS_NOAH025_3H_EP` / GES DISC) | Humedad por capas e infiltración modelada | Media |
| ERA5-Land | 9 km, horario | ~5 días | No (Copernicus CDS) | | Media |
| ESA CCI Soil Moisture | ~0.25° diario | Sin verificar | No | Climatología, no tiempo real | Baja |

- SME2: malla 200 m sobre toda tierra excepto hielo permanente, zonas urbanas y aguas interiores; Sahara a 500 m; archivado en ASF (Vertex, asf_search, Earthdata Search); "VALIDATED data is not yet available" para SME2; meta 0.06 m³/m³ con VWC < 5 kg/m²; latencia esperada 72 h — [ASF NISAR products overview](https://nisar-docs.asf.alaska.edu/products-overview/); [Earthdata NISAR Beta Soil Moisture](https://www.earthdata.nasa.gov/data/catalog/asf-nisar-l3-sme2-beta-v1-1); [NASA Open Data, Provisional SM](https://data.nasa.gov/dataset/nisar-provisional-soil-moisture-version-1-9951e); [SNWG fact sheet](https://www.earthdata.nasa.gov/s3fs-public/2025-01/Global_NISAR_Soil_Moisture_Nov2024.pdf?VersionId=INhktuvKjG_xGW5ToGOllknIcao6t_Sy). Revisita global 12 días (6 con ambas direcciones) — [prelaunch time-series ratio paper](https://www.researchgate.net/publication/382012530_NISAR_Time-Series_Ratio_Algorithm_for_Soil_Moisture_Retrieval_Pre-Launch_Evaluation_With_SMAPVEX12_Field_Campaign_Data). Evaluación preliminar 2026 de las versiones beta/provisional — [MDPI Remote Sensing 18(21):3777](https://www.mdpi.com/2072-4292/18/21/3777).
- Gránulos SME2 sobre la ROI (consulta CMR propia, bounding box de la ROI, 2026-11-20): `NISAR_L3_SME2_PROVISIONAL_V1` → 29 gránulos, el más reciente `NISAR_L3_PR_SME2_033_062_A_010_..._20261016T114006_..._P05023_N_F_J_001` (misma pista/marco/fecha que la escena t2 del par GCOV), además T55/F80 D y T156/F80 D hasta 2026-10-16; `NISAR_L3_SME2_BETA_V1` → 6 gránulos (2025-10-21 a 2026-01-13, CRID X05010) — [CMR granules API](https://cmr.earthdata.nasa.gov/search/granules.json?short_name=NISAR_L3_SME2_PROVISIONAL_V1&bounding_box=-93.3919,16.6539,-92.8757,16.8964).
- SMAP en CMR: SPL4SMGP v008 ("Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture"), SPL3SMP v009 (36 km diario), SPL3SMP_E v006 (9 km diario), SPL2SMAP_S v003 (3 km), todos NSIDC_CPRD en curso; GLDAS_NOAH025_3H v2.1 y GLDAS_NOAH025_3H_EP v2.1 en GES_DISC — consulta propia, [CMR collections API](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=SPL4SMGP).
- Latencia SMAP L4 media de ~2.5 días y de SMAP en general 1-3 días (según resumen del buscador de la literatura de SMAP L4) — [SMAP L4 Version 4 paper](https://www.researchgate.net/publication/335584494_Version_4_of_the_SMAP_Level-4_Soil_Moisture_Algorithm_and_Data_Product).
- Retraso actual de la humedad de ERA5-Land de unos 5 días — [NHESS 25, 4907 (2025)](https://nhess.copernicus.org/articles/25/4907/2025/).

### Inferences
- Cómo pasar de humedad a condición antecedente: calcular saturación relativa SR = (θ − θ_wp)/(θ_s − θ_wp) por celda (θ_wp y θ_s de SoilGrids/HiHydroSoil o de Rawls por textura) y elegir CN entre CN I (SR baja), CN II y CN III (SR cerca de capacidad de campo), o interpolar linealmente entre ellos. Los cortes de SR no tienen fuente en esta investigación: deben declararse como parámetros.
- Para Green-Ampt, usar θ del producto directamente como θi (acotado a [θ_r, θ_s]); el déficit Δθ = θs − θi controla la infiltración temprana.
- SME2 cubre la escala adecuada (200 m), pero con revisita de 6-12 días el dato puede tener una semana de antigüedad; para el "antecedente" del evento conviene combinarlo con lluvia observada (GPM IMERG, ya en la lista del proyecto) entre la pasada y el evento, o usar SMAP L4 para la dinámica temporal y SME2 para el patrón espacial.
- Como SME2 excluye zonas urbanas, las celdas urbanas se tratan con fracción impermeable (sección siguiente), no con humedad.
- SME2 se lee con el mismo flujo que ya usa el proyecto (ASF + `asf_search` + h5py); el esfuerzo de integración es bajo.

### Gaps
- Calidad de SME2 en vegetación tropical densa (VWC > 5 kg/m², probable en selva chiapaneca): la meta de exactitud no aplica ahí; banderas de calidad sin revisar en los gránulos.
- No se consultó la colección SME2 VALIDATED (`asf-nisar-l3-sme2-v1-1`) en CMR ni si existen gránulos P05036 posteriores a 2026-10-23.
- Latencia del GLDAS Early Product y licencia de ERA5-Land: no verificadas en esta sesión.

## Superficies impermeables y drenaje urbano

### Takeaway
Para fracción impermeable a 10 m: GHSL GHS-BUILT-S R2023A (m² construidos por celda, 2018 a 10 m) y GISA-10m (Huang et al. 2022, Zenodo); vía Earthdata solo GMIS de SEDAC (30 m, año 2010). Para drenaje urbano, la práctica nacional documentada es restar una tasa constante en celdas construidas: 12 mm/h en el mapa de inundación superficial de Inglaterra. No se encontró un conjunto abierto de redes de drenaje global ni para Chiapas.

### Cited Findings
| Fuente | Qué aporta | Resolución / año | Licencia | Acceso | Earthdata | Prioridad |
|---|---|---|---|---|---|---|
| GHS-BUILT-S R2023A (JRC) | Superficie construida (m²) por celda | 10 m para 2018 (Sentinel-2); serie 1975-2030 a otras resoluciones | Política de reutilización de la Comisión (texto exacto sin verificar) | JRC Data Catalogue; GEE `JRC/GHSL/P2023A/GHS_BUILT_S_10m` | No | **Alta** |
| GISA-10m (Huang et al. 2022) | Superficie impermeable binaria | 10 m global; OA > 86 % | Licencia del dato sin verificar (el artículo es CC BY 4.0) | Zenodo 10.5281/zenodo.5791855 | No | Media |
| GMIS (SEDAC) | % impermeable desde Landsat | 30 m, 2010 | (SEDAC, abierto) | SEDAC/ESDIS | **Sí** (`CIESIN_SEDAC_ULANDSAT_GMIS_V1`) | Baja (antigua) |
| HBASE (SEDAC) | Extensión construida | 30 m, 2010 | | SEDAC/ESDIS | **Sí** (`CIESIN_SEDAC_ULANDSAT_HBASE_V1`) | Baja |
| WorldCover clase 50 | Máscara binaria construido | 10 m, 2021 | CC BY 4.0 | AWS | No | Alta (ya disponible) |

- GHS-BUILT-S R2023A: Pesaresi & Politis (2023); 10 m para 2018 desde Sentinel-2; banda `built_surface` en m² por celda; condiciones de uso remiten al aviso de copyright de la Comisión — [GEE catalog](https://developers.google.com/earth-engine/datasets/catalog/JRC_GHSL_P2023A_GHS_BUILT_S_10m); [JRC Data Catalogue](https://data.jrc.ec.europa.eu/dataset/9f06f36f-4b11-47ec-abb0-4f8b7b1d72ea).
- GISA-10m: 10 m global, más de 2.7 millones de imágenes Sentinel ópticas y radar, exactitud global > 86 %, Zenodo DOI 10.5281/zenodo.5791855 — [Huang et al. 2022, ESSD 14:3649](https://essd.copernicus.org/articles/14/3649/2022/).
- GMIS y HBASE en CMR (ESDIS, 2010) — consulta propia, [CMR](https://cmr.earthdata.nasa.gov/search/collections.json?keyword=global%20impervious%20surface).
- Inglaterra: el mapa nacional de inundación superficial asume una capacidad de drenaje urbano por defecto modelada como "drainage rate" de 12 mm/h en zonas construidas; el informe de la Environment Agency la encontró robusta como estimación nacional y señaló que suponer capacidad de diseño local a partir de la lluvia local es cuestionable, sobre todo en redes antiguas — [EA, Improving surface water flood mapping: estimating local drainage rates](https://assets.publishing.service.gov.uk/media/603660e18fa8f5480ff52477/Improving_surface_water_flood_mapping_-_estimating_local_drainage_rates_-_report.pdf) (dato tomado del resumen del buscador; el PDF no pudo extraerse como texto).
- La práctica más común es suponer un único valor de capacidad, porque los datos explícitos de red suelen ser comercialmente sensibles — [J. Hydrology 2023 (White Rose)](https://eprints.whiterose.ac.uk/id/eprint/200376/1/1-s2.0-S0022169423006601-main.pdf).
- Modelo pluvial europeo del JRC: inundación pluvial definida como lluvia intensa que excede la capacidad del drenaje urbano; 571 ciudades, lluvia horaria de 10 años de periodo de retorno — [Water 9(4):296 (2017)](https://www.mdpi.com/2073-4441/9/4/296).
- Crítica general: las grandes zonas urbanas tienen drenaje superficial que "no se representa en absoluto" en los modelos globales de inundación — [Schubert et al. 2024, Earth's Future](https://cawaterlibrary.net/wp-content/uploads/2024/12/Earth-s-Future-2024-Schubert-NationalE28090Scale-Flood-Hazard-Data-Unfit-for-Urban-Risk-Management.pdf) (atribución exacta del pasaje según resumen del buscador).
- Sampson et al. (2015): modelo global ~90 m, 56°S-60°N, fluvial y pluvial; las defensas fluviales se representan aumentando la conveyance del cauce según estándares locales — [Univ. Bristol](https://research-information.bris.ac.uk/en/publications/a-high-resolution-global-flood-hazard-model/); Wing et al. (2017): modelo de 30 m del territorio continental de EE. UU., pluvial en todas las cuencas; estudios posteriores descartan celdas pluviales < 15 cm citando a Wing et al. — [NHESS 21:559 (2021)](https://nhess.copernicus.org/articles/21/559/2021/).

### Inferences
- Lluvia neta propuesta por celda con fracción impermeable f (de GHS-BUILT-S: m² / 100 m² por píxel de 10 m, promediado a 30 m): neta = f · max(0, P − d_urb) + (1 − f) · neta_permeable(P), con d_urb la tasa de drenaje (mm/h) aplicada solo donde f > 0 (o donde la clase WorldCover es 50).
- d_urb para Chiapas: no hay dato local; usar 12 mm/h (valor inglés) como caso base y un rango de sensibilidad (p. ej. 0 = sin drenaje, 12, 25 mm/h) declarado como supuesto. Un drenaje sobredimensionado anula la inundación pluvial urbana; uno nulo la exagera.
- `d_urb` restado de la lluvia se aplica antes del enrutamiento, así que tampoco drena agua que llega por escorrentía desde otras celdas (misma limitación que la infiltración precalculada).
- Prioridad alta para GHS-BUILT-S porque da fracción continua (no binaria) a 10 m y tiene serie temporal; WorldCover clase 50 sirve como respaldo sin descarga extra.

### Gaps
- Método de drenaje de Sampson et al. 2015 y de Fathom (p. ej., si se elimina lluvia hasta un periodo de retorno ligado al ingreso del país): no se pudo leer el texto completo (403 / PDF incorrecto); no afirmar ninguna cifra.
- Bates et al. 2021 (WRR): el PDF descargado no correspondía al artículo; tratamiento de infiltración y drenaje sin verificar.
- Detalle metodológico del modelo pluvial JRC 2017 (runoff, Manning, capacidad): la página devolvió 403.
- No se encontró ningún conjunto abierto de redes de drenaje urbano (global ni para Chiapas/INEGI).
- Licencias exactas de GHS-BUILT-S y del dato GISA-10m: sin verificar.
