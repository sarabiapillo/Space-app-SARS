# Ejecución DG2/FV1 por ROI: API y contrato frontend

**Ruta nueva autenticada**, independiente de los casos registrados. `POST /api/flood-scenarios/roi/start/` valida primero y devuelve `202`; adquisición NASADEM, preparación DG2, lluvia NetCDF y solver se ejecutan **fuera del request**. No valida precisión hidráulica ni observa inundación. Para el contrato anterior `prepare/` y casos registrados, véase [API de simulación](api-simulacion-inundacion.md).

## Operación del servidor (antes de llamar)

El servicio se configura por entorno, con rutas y hashes fijados en el servidor, y está habilitado por defecto para este despliegue; `FLOOD_ROI_DG2_ENABLED=false` lo deshabilita. **Antes de usarlo**, ejecutar la comprobación local sin red y, si se dispone de credenciales privadas, la comprobación Earthdata explícita siguiendo [Configuración y comprobación del servicio](configuracion-servicio-inundacion.md). Los presupuestos iniciales son pequeños y deben revisarse para la capacidad y el dominio físico; no se instalan binarios desde HTTP. La cuenta del servidor necesita acceso Earthdata NASADEM; nunca enviar credenciales en JSON. Solo el worker de un POST autenticado intenta adquirir datos: importar settings no inicia red. Una ROI fuera de latitudes NASADEM −56…60, una tesela inaccesible o una malla con huecos fallará sin rellenar elevación inventada. Una comprobación Earthdata exitosa no valida fidelidad hidráulica.

## Solicitud completa

`Content-Type: application/json`, sesión autenticada y CSRF cuando aplique. **Todos** los valores numéricos y de hipótesis abajo son ilustrativos, no parámetros físicos recomendados. `domain` debe cubrir la ROI, estar en GeoJSON Polygon EPSG:4326 y ser suficientemente amplio para la física que se quiera examinar; su selección corresponde al usuario informado. `domain_nonurban: true` es una declaración explícita, no una comprobación automática del terreno. El ejemplo es deliberadamente diminuto y atraviesa dos teselas NASADEM:

```json
{
  "roi": {"type":"Polygon","coordinates":[[[-92.9998,16.8],[-92.9995,16.8],[-92.9995,16.8003],[-92.9998,16.8003],[-92.9998,16.8]]]},
  "domain": {"type":"Polygon","coordinates":[[[-92.9999,16.7998],[-92.9993,16.7998],[-92.9993,16.8005],[-92.9999,16.8005],[-92.9999,16.7998]]]},
  "rainfall": {"amount":2,"unit":"mm","duration":1,"duration_unit":"s"},
  "rainfall_profile": {"interval_count":2,"seed":7,"distribution":"uniform_balanced"},
  "terrain": {"target_crs":"EPSG:32615","resolution_m":20,"resampling":"nearest"},
  "hydraulics": {"manning":0.02,"initial_condition":"dry_zero_velocity","boundary":"free","infiltration":"unsupported","domain_nonurban":true},
  "simulation": {"duration_s":2,"save_interval_s":1,"initial_tstep_s":0.1,"dg2_depth_thresh_m":null}
}
```

`simulation.dg2_depth_thresh_m` es **obligatorio**: `null` desactiva explícitamente el umbral (comportamiento por defecto de LISFLOOD-FP 8.0.3) o un número `0 < v ≤ 1` en metros activa `dg2depththresh v`, que trata como planas (sin pendiente DG2) las celdas con menos de `v` m de agua. Con umbral desaparecen muchos negativos en láminas finas, pero la solución cambia (en una prueba real de 900 s con 0.02 m la profundidad máxima pasó de 1.14 a 1.21 m), por lo que es una elección numérica que se registra con la corrida, no un valor físico recomendado.

### Método (`simulation.solver`) y cambio automático

`simulation.solver` es opcional: `"dg2"` (por defecto si falta, así que las solicitudes anteriores siguen igual) o `"fv1"`. Es el mismo binario LISFLOOD-FP 8.0.3; el `.par` empieza con la palabra clave `fv1` en lugar de `dg2` (`pars.cpp`, que fija para FV1 CFL 0.5 y umbral seco 1e-6 m). Con `"fv1"`:

- `dg2_depth_thresh_m` debe ser `null` (no se escribe `dg2depththresh`); un número se rechaza con `400`.
- El solver lee el DEM de medias de celda (`terrain.dem`) y, con mar o lagos llenos, solo `initial.wd`: no usa `terrain.dem1x/1y` ni `initial.wd1x/1y`, que solo carga DG2 (`swe/dg2new.cpp`), y por eso no se copian ni figuran en `input_hashes`.
- `voutput` también escribe `.Vx`/`.Vy`, así que hay flechas de flujo.
- En la corrida real fallida de Sumidero (20 × 16 celdas, 30 mm en 600 s, C 0.656), FV1 dio 0 celdas negativas en 0.46 s (DG2 ~10 s), máximo 0.71 m frente a 0.76 m y volumen final 2960 m³ frente a 2974 m³; las celdas con más de 3 cm coincidieron poco (14 frente a 27, IoU 0.28). FV1 es de primer orden: más estable en terreno empinado, menos preciso que DG2.

**Cambio automático.** Si el intento con el método elegido falla **después de la preparación** (el solver termina con error o agota su tiempo, las salidas son inválidas, o hay `negative_depth_artifacts`), el worker repite la simulación una vez con el otro método (DG2 → FV1 o FV1 → DG2) sobre las mismas entradas preparadas, en su propio directorio (`work/` el primero, `work-fallback/` el segundo; registros `solver.log` y `solver-fallback.log`), con el mismo presupuesto de tiempo por intento; `deadline_epoch_s` cubre dos intentos. Los fallos de adquisición o de preparación no activan el cambio, porque ambos métodos fallarían igual. El estado y los resultados devuelven `requested_solver` (el pedido), `solver` (el de los resultados mostrados o, si la corrida falla, el último intentado) y `solver_fallback` = `null` o `{"from","to","reason"}`, con `reason` en `negative_depth_artifacts`, `solver_failed`, `solver_timeout` u `output_invalid`. El estado también trae `solver_attempts`, la lista `[{"solver","outcome","reason"}]` de los intentos. Si ambos fallan, la corrida termina con el código del **primer** intento (`timed_out`/`solver_timeout`, `failed`/`negative_depth_artifacts`, o `failed`/`preparation_or_output_invalid` para `solver_failed` y `output_invalid`) y `solver_attempts` muestra los dos. Las corridas anteriores a esta función usaron DG2: se informan con `"dg2"`, `solver_fallback: null` y `solver_attempts: null`. El panel avisa del cambio en los resultados, por ejemplo: «Se cambió automáticamente de DG2 a FV1 porque DG2 dejó artefactos numéricos (profundidades negativas). Los resultados mostrados son de FV1.»

### Profundidades negativas: regla por volumen

DG2 puede producir profundidades medias **negativas** en láminas finas que escurren por terreno empinado (el solver solo garantiza positividad en las interfaces). Al leer las salidas del solver, **toda** profundidad negativa se pone en 0. En cada cuadro y en el máximo se mide el volumen que eso añade, `Σ(−h_neg)·celda²`, y se compara con el agua del dominio en ese cuadro después del recorte, `Σh·celda²`:

- razón < 1 %: resultado normal;
- 1–10 %: el resultado se conserva con la advertencia visible «artefactos numéricos en terreno muy empinado; profundidades poco confiables, la dirección del flujo sí vale» (en `warnings`);
- \> 10 %, o volumen añadido a un cuadro sin agua: el intento falla con el código `negative_depth_artifacts` (y se prueba el otro método, ver arriba).

Los resultados traen `negative_depth` = `{clipped_cell_frames, frames, min_m, max_added_volume_ratio, status, thresholds: {warning: 0.01, fail: 0.10}}`, con `status` `none` (sin negativos), `minor` (< 1 %) o `artifacts` (1–10 %). Reemplaza la tolerancia fija de 5 cm anterior; las corridas resumidas con ella conservan su `negative_depth` antiguo (`tolerance_m`, sin `status`). La profundidad inicial (`initial.wd`) se sigue leyendo estricta: un negativo ahí es un error de preparación.

El sobre acepta exactamente estas siete secciones. La lluvia es hipotética, perfil temporal sintético conservativo con semilla, uniforme dentro de la ROI y cero fuera; no es precipitación observada. La frontera (ver abajo), terreno métrico, duración, paso inicial y frecuencia de guardado deben elegirse expresamente. El estado inicial (seco, o mar en reposo al nivel fijo) y la velocidad cero **no** provienen de NISAR. Infiltración no modelada; NASADEM es elevación EGM96 y **no** profundidad. La malla se expande a un rectángulo métrico completo antes de comprobar cobertura; presupuestos de celdas, lluvia, cuadros y teselas se validan antes de crear trabajo.

### Frontera por lado y mar en reposo

`hydraulics.boundary` acepta `"closed"` o `"free"` (los cuatro lados iguales, como antes) o un objeto con exactamente `north`, `east`, `south` y `west`, cada uno `{"type":"closed"}`, `{"type":"free"}` o `{"type":"fixed_level","level_m":<m>}`:

```json
"hydraulics": {"manning":0.05,"initial_condition":"still_water_at_fixed_level","infiltration":"unsupported","domain_nonurban":true,
  "boundary":{"north":{"type":"closed"},"east":{"type":"free"},"south":{"type":"fixed_level","level_m":0},"west":{"type":"closed"}}}
```

- **closed:** no se escribe línea en el `.bci`; LISFLOOD-FP la trata como pared reflejante.
- **free:** `FREE` transmisiva idealizada. DG2 ignora la pendiente de `FREE`.
- **fixed_level:** `HFIX`, superficie libre fija `level_m` en metros sobre el datum vertical del DEM (NASADEM: EGM96); en el borde `h = max(0, level − z)`. `|level_m| ≤ 10000`.

`hydraulics.initial_condition` es `"dry_zero_velocity"` o `"still_water_at_fixed_level"`. La segunda exige al menos un lado `fixed_level` y el mismo nivel en todos ellos: las celdas con elevación media bajo ese nivel y conectadas (4 vecinos) a una celda de borde de un lado de nivel fijo arrancan con `H = nivel − z` y pendientes `H1x = −Z1x`, `H1y = −Z1y` (superficie libre plana), mediante `startfile initial.wd` de DG2. Las depresiones interiores no conectadas quedan secas.

Comprobado con el solver sobre el DEM real de la corrida NASADEM (577 celdas bajo 845.25 m, sin lluvia, 300 s): **sin** `startfile`, el lado `HFIX` no llenó nada (0 % del volumen a los 300 s), porque en DG2 8.0.3 la frontera copia la velocidad interior y un dominio seco en reposo no recibe flujo de masa; **con** `startfile`, el mar conservó el 100 % del volumen, la superficie quedó a ±3 cm del nivel y la rapidez donde hay al menos 0.15 m fue ≤ 0.23 m/s. El ajuste residual ocurre en la orilla (celdas parcialmente sumergidas, mojado y secado de DG2). Por eso, si el nivel está sobre el terreno, conviene iniciar con el mar lleno. NASADEM no tiene batimetría: con nivel 0 sobre un mar plano a 0 m la profundidad inicial es cero y el lado `HFIX` actúa como sumidero a nivel del mar. El estado de la corrida devuelve `boundary` (lados normalizados) e `initial_condition`; ambos son `null` en corridas anteriores a esta función.

### Infiltración y presión atmosférica

Se portaron del simulador de inundación de la rama `terrapulseai_v2.1` (`backend/analyses/simulate.py`), con las mismas fórmulas:

- `hydraulics.infiltration`: `"unsupported"` (toda la lluvia escurre) o `"runoff_coefficient"`. Con coeficiente, DG2 recibe lluvia × C, con C = min(0.92, 0.65 + 0.27·(1 − e^(−D/24 h))) y D la duración de la lluvia (mínimo 0.5 h); el resto se cuenta como infiltrado. Es un coeficiente agregado tipo Horton, no un modelo físico de infiltración. Por ejemplo, 600 s de lluvia dan C ≈ 0.656 (34 % se infiltra) y 72 h dan C ≈ 0.907.
- `hydraulics.atmospheric_pressure_hpa` (opcional, 950–1040 hPa): barómetro invertido, sobreelevación = max(0, 1013.25 − p)·100 / (1000·9.81) m, unos 1.02 cm por hPa bajo la presión estándar. Se **suma al nivel fijo del mar** (líneas `HFIX` y mar lleno al inicio) y exige al menos un lado de nivel fijo. A diferencia del simulador de `terrapulseai_v2.1`, no se suma a los encharcamientos tierra adentro: el barómetro invertido actúa sobre agua abierta.

El estado de la corrida devuelve `losses` = `{infiltration, runoff_coefficient, atmospheric_pressure_hpa, barometric_surge_m}` (`null` en corridas anteriores). El hietograma de resultados muestra la lluvia que recibió el solver, es decir, la efectiva cuando hay coeficiente.

### Lluvia observada (validación)

El uso normal es la lluvia hipotética. Para validar el simulador contra un evento real, `rainfall_profile` acepta también una serie observada:

```json
"rainfall": {"amount":2,"unit":"mm","duration":3600,"duration_unit":"s"},
"rainfall_profile": {"source":"observed","provenance":{"product":"GPM_3IMERGHHL"},
  "segments":[{"start_s":0,"end_s":1800,"mm":1.5},{"start_s":1800,"end_s":3600,"mm":0.5}]}
```

- `segments`: lluvia en mm por intervalo, contiguos desde 0 s, a lo sumo 10 000. Se aplica uniforme en la ROI.
- `rainfall` debe coincidir con el total y la duración de la serie; si no, la solicitud se rechaza.
- `provenance`: objeto obligatorio con el origen de la serie.
- Con `infiltration: "runoff_coefficient"`, cada intervalo se multiplica por C.
- La corrida queda con `synthetic: false`, y la procedencia de la lluvia guarda `observed: true` y la serie.

Para obtener la serie de IMERG cada 30 min sobre el dominio, se usa `python -m pipeline.hydrology.imerg <oeste> <sur> <este> <norte> <inicio_utc> <fin_utc> <salida.json>`. Calcula la media de las celdas de 0.1° que tocan el dominio. Por defecto (`--product auto`) usa IMERG Final (`GPM_3IMERGHH`, ajustado con pluviómetros) si cubre todo el evento; si no, Late (`GPM_3IMERGHHL`, unas 14 h de retraso) y si no, Early (`GPM_3IMERGHHE`, unas 4 h). Final llega unos 3.5 meses tarde. La procedencia guarda qué versión se usó y cuáles se probaron. Hace falta autorizar GES DISC en el perfil de Earthdata.

## Respuestas y animación

`202` (valores ilustrativos; UUID asignado por servidor):

```json
{"id":"6c5b38f4-9d14-4c71-912b-04ed7629d94a","state":"created","stage":"created","simulation_duration_s":2,"save_interval_s":1,"dg2_depth_thresh_m":null,"requested_solver":"dg2","solver":"dg2","solver_fallback":null,"solver_attempts":[],"boundary":{"north":{"type":"free"},"east":{"type":"free"},"south":{"type":"free"},"west":{"type":"free"}},"initial_condition":"dry_zero_velocity","synthetic":true,"hydraulic_accuracy_validated":false,"status_url":"/api/flood-roi-runs/6c5b38f4-9d14-4c71-912b-04ed7629d94a/","results_url":"/api/flood-roi-runs/6c5b38f4-9d14-4c71-912b-04ed7629d94a/results/"}
```

Consultar `GET status_url` con la misma sesión. `state`/`stage`: `created`, `acquiring`, `preparing`, `running`, `results`, `succeeded`, `failed`, `timed_out`. En fallo hay `error` limitado a códigos seguros (`acquisition_failed`, `preparation_failed`, `preparation_or_output_invalid`, `negative_depth_artifacts`, `worker_stopped`, `worker_deadline`, `worker_launch_failed`, `preparation_timeout`, `solver_timeout` o `run_failed`); no se expone traceback ni rutas. Mostrar fallo de adquisición distinto de preparación/cobertura; los detalles de cobertura no se infieren del código general. `GET results_url` responde `409 {"errors":{"result":["Resultado no disponible."]}}` hasta éxito.

En éxito `results_url` devuelve `grid` (`shape`, `cellsize_m`, `xllcorner`, `yllcorner`, `bounds`, `nodata`, `crs` métrico), `units: "m above local bed"`, `frames` ordenados (`frame_index`, `time_s:null`, `scheduled_time_s`, `stats`, `source_sha256`), `maximum` (`stats`, `source_sha256`), `time_axis`, `warnings`, `mass_balance` (conservación numérica con la lluvia sumada de vuelta al `Verror` del solver; `null` en corridas anteriores o sin `.mass` legible; ver [API de simulación](api-simulacion-inundacion.md)), `flow` (flechas de flujo, ver abajo), datos para gráficas (`depth_classes_m` = `[0.03,0.15,0.5,1,2]`, límites inferiores de las clases de profundidad; `stats.depth_class_cells` en cada cuadro y en el máximo, con las celdas por clase; `rainfall_segments`, los segmentos de la lluvia sintética como `{start_s,end_s,intensity_mm_h}`; y `mass_balance.series`, filas `[tiempo_s, volumen_en_dominio_m3, lluvia_acumulada_m3]` del `.mass`; los tres son `null` o faltan en corridas anteriores), `negative_depth` (regla por volumen, arriba), `requested_solver`, `solver`, `solver_fallback`, `synthetic:true`, `hydraulic_accuracy_validated:false`, y `artifacts`. Ejemplo **ilustrativo de estructura, no medición**:

```json
{"grid":{"shape":[8,9],"cellsize_m":20,"xllcorner":500000,"yllcorner":1850000,"bounds":[500000,1850000,500180,1850160],"nodata":-9999,"crs":"EPSG:32615"},"units":"m above local bed","frames":[{"frame_index":0,"time_s":null,"scheduled_time_s":0,"stats":{"wet_cells":0},"source_sha256":"<sha256>"}],"maximum":{"stats":{"wet_cells":0},"source_sha256":"<sha256>"},"time_axis":{"status":"actual_times_unavailable","reason":"DG2 ASCII frames do not record actual physical timestamps; scheduled_time_s is requested, not observed."},"warnings":["<advertencia>"],"synthetic":true,"hydraulic_accuracy_validated":false,"artifacts":[{"name":"roi-0000.wd.tif","url":"/api/flood-roi-runs/<uuid>/artifacts/roi-0000.wd.tif/","sha256":"<sha256>","source_sha256":"<sha256>","geographic_bounds":[-93,16.8,-92.99,16.81],"frame_index":0,"time_s":null,"scheduled_time_s":0,"nodata":-9999,"units":"m"}]}
```

### Lagos (HydroLAKES)

`hydraulics.lakes` (opcional): `"none"` o `"hydrolakes"`. Con HydroLAKES v1.0 (Messager et al. 2016, Nature Communications 7:13603, CC BY 4.0; ~1.4 millones de lagos ≥ 10 ha en todo el mundo, con profundidad media estimada `Depth_avg`), los lagos que caben completos en el dominio arrancan llenos. NASADEM solo tiene la superficie del agua, así que el lecho se excava en el DEM antes de calcular los coeficientes DG2: nivel = mediana del DEM en el lago, bajado si hace falta a la celda vecina más baja para que no desborde al inicio; lecho en paraboloide según la distancia a la orilla, con media `Depth_avg` y máximo ≤ 3 × media. Es un cambio del terreno con una profundidad **estimada**, no batimetría medida, y queda registrado en `provenance.lakes`. Los lagos cortados por el borde del dominio se omiten y se informan (`skipped`), porque se vaciarían por la frontera. El servidor necesita el GeoPackage preparado una vez con `python -m pipeline.hydrology.lakes prepare HydroLAKES_polys_v10_shp.zip data/reference/hydrolakes/HydroLAKES_polys_v10.gpkg` (ruta configurable con `FLOOD_ROI_DG2_LAKES_PATH`); sin él, la opción se rechaza con `400`. El estado devuelve `lakes` (`"none"`/`"hydrolakes"`) y los resultados la lista `lakes`.

Comprobado en una corrida real en el Parque Nacional Lagunas de Montebello (lago HydroLAKES 1073769, 0.32 km², media 3.3 m): volumen inicial 1 063 260 m³ + lluvia 20 627 m³ = 1 083 900 m³ al final, error de balance 0.8 m³. Antes de omitir los lagos cortados por el borde y de limitar el nivel, la misma corrida perdía 17 % del agua de los lagos y producía profundidades negativas.

### Indicadores hidráulicos y caminos

- **`froude`**: por cuadro, número de Froude `Fr = |v| / sqrt(g·h)` (g = 9.81 m/s², velocidad `HU/H` del solver) sobre celdas con al menos 0.15 m de agua: `{frame_index, cells, max, mean, supercritical_cells}` (supercrítico: Fr > 1). Las láminas más delgadas se excluyen porque dan velocidades espurias.
- **`time_of_concentration`**: Kirpich (1940), `tc [min] = 0.0195·L^0.77·S^-0.385`, sobre el recorrido D8 más largo (depresiones rellenas) hasta la salida principal del dominio (la celda con mayor área drenada): `{minutes, flow_length_m, slope_m_m, upslope_area_km2, outlet:[lon,lat]}`. El simulador de `terrapulseai_v2.1` usa la diagonal del dominio como longitud. Kirpich se derivó para cuencas rurales pequeñas: es un indicador del dominio, no un valor calibrado.
- **`roads`**: caminos vehiculares reales de **OpenStreetMap** (© OpenStreetMap contributors, licencia ODbL), descargados por el worker desde la API Overpass para los límites geográficos del dominio. Para cada cuadro y para el máximo se mide la longitud de camino cuya celda tiene ≥ 0.35 m de agua (`cut_km`, corte) o entre 0.15 y 0.35 m (`caution_km`, precaución), con los umbrales del simulador de `terrapulseai_v2.1`; ese simulador suponía 2.2 km de camino por km² de llanura inundada en vez de usar caminos reales. Si Overpass falla, la corrida continúa y `roads` vale `{"available": false, "reason": "unavailable"}`. Los tres campos son `null` en corridas anteriores.

### Flechas de flujo (`flow`)

El worker agrega `voutput` al `.par`, y LISFLOOD-FP escribe por cuadro las velocidades `.Vx`/`.Vy` (`HU/H`, en m/s, **Vx positivo hacia el este y Vy positivo hacia el norte**; convención comprobada contra la pendiente de la superficie del agua en una corrida real). `voutput` no cambia la solución: `.wd` y `.max` salieron idénticos byte a byte con y sin él. `flow` es `null` en corridas anteriores a esta función. Cuando existe:

```json
{"units":"m/s","min_depth_m":0.15,"channel_min_upslope_km2":0.12,"max_arrows":150,"method":"depth-weighted block mean of LISFLOOD-FP voutput Vx/Vy (HU/H); ...","frames":[{"frame_index":1,"max_speed_m_s":3.089,"arrows":[[-93.295199,16.679151,0.071,198.1]]}]}
```

Cada flecha es `[lon, lat, rapidez_m_s, rumbo_grados]`, con el rumbo medido en sentido horario desde el norte verdadero (geodésico, incluye la convergencia de la cuadrícula UTM). **Solo se dibuja el desbordamiento:** celdas con al menos `min_depth_m` = 0.15 m de agua, fuera de la red de cauces y fuera del mar inicial (si la corrida arrancó con agua en reposo). La red de cauces se calcula sobre el DEM que escribe el solver (`roi.dem`): depresiones rellenas por *priority-flood*, dirección D8 de máxima pendiente y cauce donde el área drenada, la celda incluida, alcanza `channel_min_upslope_km2` = 0.12 km² (la misma regla de área que el simulador de inundación de la rama `terrapulseai_v2`, que no rellena depresiones; sin relleno, en la corrida real NASADEM solo 1 de 1680 celdas era cauce, y con relleno, 59). La malla se agrupa en bloques cuadrados para dar a lo sumo `max_arrows` = 150 flechas por cuadro; la velocidad de cada bloque es momento total sobre profundidad total (`Σh·v / Σh`) de las celdas elegibles, ubicada en su centroide. En la corrida real quedaron de 4 a 20 flechas por cuadro (antes de este filtro, de 39 a 64). El umbral de 0.15 m también descarta las láminas delgadas, donde `HU/H` da rapideces espurias (hasta 11 m/s con menos de 3 cm). Las corridas anteriores a este filtro devuelven `min_depth_m` 0.03 y no traen `channel_min_upslope_km2`. El máximo (`.max`) no tiene flechas: no hay un instante único. Las flechas son una **visualización de la solución numérica**, no velocidades observadas.

El servidor entrega COG TIFF **solo al propietario** y únicamente cuando figura en los artefactos de un trabajo exitoso; descarga completa (`Content-Type: image/tiff`, `Content-Length`, `ETag` SHA256); **no implementa HTTP Range**. Comprobar el SHA256 al recibirlo. `geographic_bounds` es EPSG:4326 para encuadre, no cambia el CRS del raster: **NO** pasar COG UTM directo a MapLibre `image` ni tratarlo como tesela XYZ/3857.

Para mostrarlo en MapLibre, solicitar con la misma sesión `GET /api/flood-roi-runs/<uuid>/artifacts/<name>/preview/` (nombre del artefacto declarado, más `preview/`). Devuelve `image/png` RGBA reproyectado a EPSG:3857, con `X-Preview-CRS: EPSG:3857`, `X-Preview-Bounds: west,south,east,north` en EPSG:4326 calculados del raster reproyectado, `X-Preview-Units: m`, `X-Preview-Classes: 0.03,0.15,0.5,1,2` (límite inferior de cada clase, en m), `Cache-Control: private, max-age=3600` y ETag derivado del SHA256 del COG y la versión de la paleta. La paleta usa cinco clases de profundidad en azules secuenciales, de claro a oscuro: 0.03–0.15 m RGB(198,219,239), 0.15–0.5 m RGB(107,174,214), 0.5–1 m RGB(33,113,181), 1–2 m RGB(8,81,156) y ≥ 2 m RGB(8,48,107). La paleta anterior (degradado continuo 0.03–3 m de azul verdoso a rojo oscuro, cabecera `X-Preview-Value-Range`) ya no se sirve. Seco (<0.03 m) y nodata son transparentes **solo en la imagen**: el TIFF numérico y las estadísticas conservan la distinción. El PNG es una visualización, **no un artefacto científico para cálculos**. No hay URL pública de teselas; se requiere sesión y autorización por propietario en cada solicitud. Raster dañado o geometría inválida devuelve `400` acotado, mientras que acceso ajeno, archivo no declarado, enlace simbólico o hash alterado devuelve `404` sin rutas internas. Límites fijos del servidor: 128 MiB de archivo, 8 millones de celdas de origen y 2048 píxeles por lado / 4 millones de celdas de salida. Animar en orden de `frame_index`, no etiquetar `scheduled_time_s` como tiempo físico observado: `time_s` es siempre null; el máximo no tiene instante propio.

Errores: sin autenticación `401/403`, otro propietario/UUID/artefacto inexistente o adulterado `404`, JSON inválido/duplicado o entrada/cobertura/presupuesto rechazado `400` (sin crear trabajo), servicio sin configuración válida `503`. No hay acceso público a `data/`, ni descarga de ASCII por esta API. Los resultados de prueba con proveedor HGT sintético y solver DG2 real verifican integración y cuatro COG, **no** disponibilidad Earthdata real ni fidelidad física.
