# Plan técnico — finalización del simulador solar de TerraPulse

**Estado:** propuesta de contrato para revisión; esta etapa solo actualiza el plan. Rama `feat/solar-radiation-simulator`; sin implementación nueva, commit, push ni cambios en frontend, P4/P5, GCOV o `pipeline/elevation/nasadem.py`. El frontend selecciona ROI y hora local; **no envía azimut, elevación ni irradiancia física**. El backend calcula posición solar y DNI de cielo despejado, aplica el porcentaje experimental, ejecuta el motor geométrico existente y entrega datos numéricos más mapas Inferno. No es radiación medida, temperatura ni energía acumulada.

## 1. Diagnóstico comprobado y límites de propiedad

| Área | Estado en esta rama | Límite de la siguiente implementación |
| --- | --- | --- |
| Terreno | `pipeline/solar/dem.py` ofrece `prepare_dem(zip_paths, roi_geojson)` → `PreparedDEM` (DEM, máscaras, afín métrica, CRS, procedencia); `terrain.py` ofrece `compute_prepared_terrain`. Hay pruebas offline y se documentó una sub-ROI NASADEM real, no validación de toda la ROI. | Reutilizar sin introducir caché persistente L2/L3 experimental (`preparation.py`). |
| Irradiancia | `pipeline/solar/radiation.py` recibe normales, máscara, `irradiance_w_m2`, `azimuth_deg`, `elevation_deg`, `albedo`; devuelve incidente y absorbida con NoData como NaN. | Mantener ecuaciones y validaciones. Los parámetros manuales pasan a ser **internos**, derivados por la orquestación; no forman parte del POST. |
| Exportación | `pipeline/solar/export.py` ya escribe `incident.tif`, `absorbed.tif`, `run.json` en una corrida nueva, relee TIFF Float32 con CRS, afín, máscara y tags W/m². Huellas HGT y versión del código son declaradas por el llamador: aún hay que verificarlas contra los bytes usados. | Reutilizar y endurecer el vínculo de procedencia; no reescribir el exportador sin necesidad. |
| Fuente DEM | `pipeline/elevation/nasadem.py`: `NASADEMProvider(cache_dir).acquire_roi(roi)` retorna **tupla de `NASADEMGranule`** (`tile_id`, `path`, identidad), no un dict. Descarga y caché local admiten **un solo proceso local**; sin garantía de checksum remoto auténtico. `pipeline/solar/acquire.py` es otra ruta heredada (`search`/`acquire`); no mezclarla con `acquire_roi` en este flujo. | El adaptador de servicio transforma `{g.tile_id: g.path for g in granules}` para `prepare_dem`, preserva identidad/procedencia, y no modifica ni duplica el proveedor. |
| Backend y frontend | `backend/config/urls.py` solo expone `admin/`; `scenes`/`analyses` son esqueletos. Django/DRF están declarados; no hay API solar ni previews. El panel frontend existe en trabajo de otro integrante, no en esta rama. | Crear fachada solar aparte tras aprobación; no editar selector, frontend ni módulos del equipo. |
| Dependencias | `environment.yml` declara Rasterio/earthaccess/Django/DRF, **no pvlib**. | Agregar/fijar `pvlib` y sus dependencias explícitamente en fase A, comprobando instalación y licencia de la LUT Inferno elegida; sin nuevos servicios. |

La ROI se resuelve desde el contrato compartido del equipo: ID, versión, geometría GeoJSON EPSG:4326 y permisos. **No existe aún un `roi_id` operativo aquí.** Pueden completarse A y B con geometrías sintéticas y la sub-ROI local, sin tocar el proveedor. El POST real queda condicionado a acordar resolución de ROI, autorización y límites.

## 2. Contrato de entrada del frontend (propuesto para ratificación del ROI)

`POST /api/solar/simulations`, JSON, sin parámetros físicos calculados por el frontend:

```json
{
  "roi_id": "region-001",
  "datetime_local": "2026-11-15T15:44:00",
  "timezone": "America/Mexico_City",
  "intensity_percent": 100,
  "albedo": 0.20,
  "irradiance_model": "clear_sky"
}
```

`region-001` y los números son **ejemplos del contrato pedido, no un ROI existente ni mediciones**. `roi_id` es provisional: adaptar nombre, versión y autorización al contrato compartido en fase E; el cliente no envía geometría arbitraria ni rutas a disco. `datetime_local` es ISO 8601 **sin offset**, con segundos, y `timezone` es un identificador IANA; se forma un instante con esa zona, se convierte a UTC y se registran ambos y el offset aplicado. Rechazar formato inválido, hora inexistente (salto DST), hora ambigua (doble ocurrencia DST; pedir al usuario una hora inequívoca o acordar un campo explícito de desambiguación), zona desconocida o discordancia verificable con el ROI; **nunca** asumir UTC ni elegir silenciosamente un `fold`. La política de zona del ROI la confirma el servicio compartido: para ROI que cruce zonas, rechazar en el MVP. Fechas fuera de soporte astronómico o de las fuentes climatológicas también se rechazan con error tipado.

`intensity_percent`: número finito entre 0 y 100 inclusive, multiplicador experimental, **no** medida meteorológica. `albedo`: opcional, valor por defecto `0.20`, número finito en `[0,1]`; responder siempre el valor efectivo. `irradiance_model`: obligatorio y únicamente `"clear_sky"` en MVP. `palette` no es campo de entrada: Inferno es fija. Rechazar azimut, elevación o `irradiance_w_m2` enviados desde el navegador en lugar de aceptarlos por accidente. Validar límites de área/diámetro/píxeles y geometría ROI antes de asignar recursos. `Settings — Simulación Solar / Radiación` ofrece recorrido este-oeste, deslizador horario, indicador angular e intensidad porcentual; la semántica del valor actual **146° no está confirmada**: el frontend debe etiquetar explícitamente azimut, elevación o cénit calculados por backend, no interpretarlo sin acuerdo.

## 3. Cálculo astronómico y DNI (nuevo, separado del motor)

1. **Punto representativo:** obtener un punto dentro del polígono ROI (no confiar en un centroide que podría estar afuera), con coordenadas lon/lat EPSG:4326 y altitud de un píxel DEM válido que lo represente. Registrar método, coordenadas, elevación y datum NASADEM/EGM96; si no hay elevación válida o la ROI cruza zona horaria, fallar. Proponer **diámetro geodésico máximo de 10 km y variación angular máxima de 0,5°** entre punto y extremos muestreados a la hora solicitada como límites iniciales conservadores **pendientes de calibración/aprobación**; aun dentro del límite, el punto único no describe variación atmosférica/solar píxel a píxel. Fuera de esos límites, rechazar o diseñar simulación por sectores en otra fase; no fingir uniformidad.
2. **Tiempo y posición:** con `pvlib.location.Location` y un `DatetimeIndex` localizado correctamente, calcular `get_solarposition` en el punto. Usar azimut desde el **norte, horario** (`0°` norte, `90°` este), `apparent_elevation` y `apparent_zenith` en grados; exponer también `night = apparent_elevation <= 0`. Registrar versión pvlib, método, tiempo UTC, punto, altitud, presión y temperatura asumidas. pvlib estima presión desde altitud si no se proporciona; su temperatura por defecto de **12 °C es un supuesto**, no medición: fijarla explícitamente y declararla como tal, o acordar otra fuente verificable antes de implementar. Usar la misma convención *aparente* para elevación y cénit; comprobar relación y rango, sin afirmar precisión observacional.
3. **Cielo despejado:** usar el modelo **Ineichen/Perez** de `Location.get_clearsky(times, model="ineichen", solar_position=...)` y tomar `dni` en W/m², no `ghi` ni `dhi`. Requiere cénit aparente, masa de aire absoluta corregida por presión, altitud, irradiancia extraterrestre computada para el instante y turbidez Linke. La consulta `pvlib.clearsky.lookup_linke_turbidity` usa `LinkeTurbidities.h5` empaquetado con pvlib: **promedios mensuales históricos**, interpolados a día, no turbidez medida para esa fecha. Registrar valor, fuente/versión de datos y método de interpolación; presión derivada de altitud y temperatura asumida también deben figurar como supuestos. Si faltan datos o pvlib devuelve DNI no finita/negativa, error controlado, nunca sustituir por irradiancia inventada. Cielo despejado no equivale a pronóstico meteorológico ni a irradiancia observada.
4. **Intensidad y noche:** `DNI_ajustada = DNI_clear_sky × intensity_percent / 100` (W/m²). Validar `0 <= DNI_ajustada <= DNI_clear_sky`. Si `night`, forzar **ambas DNI a 0** y conservar los ángulos astronómicos reales en metadata; **no** pasar elevación negativa a `simulate_radiation` (la rechaza): pasar `irradiance_w_m2=0`, `elevation_deg=0` solo como entrada interna para producir cero en píxeles válidos, mientras se publica la elevación real negativa y `night=true`. Tratar horizonte (`<=0`) como noche también evita irradiación de laderas a elevación cero sin sombras. En noche, 0 W/m² válido sigue siendo distinto de NoData.
5. **Motor intacto:** pasar normales válidas, `irradiance_w_m2=DNI_ajustada`, azimut y elevación **calculados internamente**, albedo efectivo a `simulate_radiation`. Día: `G_i=DNI_ajustada max(0,n·s)`; `G_abs=(1-alpha)G_i`; noche: `G_i=G_abs=0` sobre píxeles válidos. No agregar difusa, sombras, Fourier, conducción ni temperatura. `radiation.py` no se cambia salvo error demostrado por pruebas.

Fuentes para la selección de modelo: [pvlib `Location.get_solarposition`](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.location.Location.get_solarposition.html) (hora localizada, azimut, presión/temperatura), [`Location.get_clearsky`](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.location.Location.get_clearsky.html) (Ineichen, `ghi/dni/dhi`), [`clearsky.ineichen`](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.ineichen.html) (masa de aire/turbidez/altitud), y [`lookup_linke_turbidity`](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.lookup_linke_turbidity.html) (datos históricos empaquetados). Las APIs y valores se verifican contra la versión fijada antes de codificar; no se ha ejecutado pvlib en este repositorio.

## 4. Contrato de salida y rutas HTTP (propuesta)

Respuesta síncrona `201 Created` con `Location: /api/solar/simulations/{id}` **solo si** ambos TIFF, PNG y manifiesto están completos y vinculados. Ejemplo de **forma**, con `<...>` como marcadores de tipos/valores por resolver; ninguna cifra astronómica se inventa:

```json
{
  "id": "<id-opaco-de-corrida>",
  "status": "ready",
  "roi": {"id": "<id-validado>", "version": "<version-ROI>"},
  "datetime_local": "2026-11-15T15:44:00",
  "timezone": "America/Mexico_City",
  "datetime_utc": "<instante-ISO-8601-UTC>",
  "solar_position": {
    "representative_point_lonlat": ["<lon>", "<lat>"],
    "azimuth_deg": "<numero>", "elevation_deg": "<numero>", "zenith_deg": "<numero>",
    "night": "<booleano>"
  },
  "irradiance": {
    "model": "clear_sky", "clear_sky_method": "ineichen",
    "dni_clear_sky_w_m2": "<numero>", "dni_adjusted_w_m2": "<numero>",
    "intensity_percent": 100, "albedo": 0.2,
    "atmospheric_assumptions": {
      "linke_turbidity": "<numero>", "linke_source": "<version-de-datos-pvlib>",
      "altitude_m": "<numero>", "altitude_datum": "EGM96",
      "pressure_pa": "<numero>", "temperature_c_assumed": 12
    }
  },
  "raster": {
    "crs": "<CRS-nativo-EPSG-o-WKT2>", "transform_gdal": ["<x0>", "<dx>", 0, "<y0>", 0, "<dy-negativo>"],
    "width": "<int>", "height": "<int>", "bounds_native": ["<x_min>", "<y_min>", "<x_max>", "<y_max>"],
    "resolution_m": ["<dx>", "<dy-positivo>"], "dtype": "float32", "units": "W/m2", "nodata": "mask+NaN"
  },
  "preview": {
    "crs": "EPSG:4326", "bounds_lonlat": ["<west>", "<south>", "<east>", "<north>"],
    "width": "<int>", "height": "<int>", "palette": "inferno",
    "range_w_m2": [0, "<dni-ajustada>"], "zero_range": "<booleano>",
    "nodata_alpha": 0, "units": "W/m2"
  },
  "layers": {
    "incident": {"preview_url": "/api/solar/simulations/<id>/preview/incident", "export_url": "/api/solar/simulations/<id>/export/incident"},
    "absorbed": {"preview_url": "/api/solar/simulations/<id>/preview/absorbed", "export_url": "/api/solar/simulations/<id>/export/absorbed"}
  },
  "sample_url": "/api/solar/simulations/<id>/sample",
  "provenance": {"dem_product": "NASADEM_HGT", "dem_version": "001", "tile_ids": ["<id-verificado>"], "hgt_sha256": {"<id-verificado>": "<hash-verificado>"}, "code_version": "<version-real>", "pvlib_version": "<version-fijada>"},
  "warnings": ["Cielo despejado estimado con climatología; intensidad porcentual experimental; sin sombras, difusa ni medición de campo."]
}
```

En la respuesta real, todos los campos `<numero>`/coordenadas/afines/bounds/DNI son **números JSON finitos**, enteros positivos para dimensiones, booleanos reales para `night`/`zero_range`, strings ISO 8601 para fechas. No devolver literales de ejemplo ni `NaN`/`Infinity` en JSON. El valor predeterminado de `albedo` y `intensity_percent` aplicado se reflejan siempre; `datetime_local` y `timezone` corresponden a la petición efectiva y `datetime_utc` al mismo instante. El frontend no recalcula DNI, ángulos ni irradiancia a partir de píxeles RGB. La respuesta ready/`run.json` deben tener identidad, punto representativo, fuente y supuestos atmosféricos **reales** para esa corrida; si falta procedencia, no publicar ready. El valor **146°** del panel requiere validación semántica con su dueño: no asignarlo arbitrariamente a `azimuth_deg`.

| Ruta | Contrato |
| --- | --- |
| `POST /api/solar/simulations` | Entrada anterior; `201 ready` con JSON y `Location`, bajo límites de tiempo/memoria. Sin `202` ficticio si no hay ejecutor durable. |
| `GET /api/solar/simulations/{id}` | Mismo JSON inmutable de corrida ready, con bounds y escala para ambas capas; control de permisos del ROI. |
| `GET /api/solar/simulations/{id}/preview/{layer}` | `image/png` RGBA, `layer=incident|absorbed`; la imagen sin metadatos de `GET /{id}` no está georreferenciada. |
| `GET /api/solar/simulations/{id}/sample?lon=…&lat=…` | WGS84 EPSG:4326; transforma al CRS raster e indexa el TIFF físico: `200 {"status":"valid","incident_w_m2":<n>,"absorbed_w_m2":<n>,"pixel":{"row":<int>,"col":<int>}}`; `outside_coverage`/`nodata` con valores `null`, sin confundir 0 con ausencia. |
| `GET /api/solar/simulations/{id}/export/{layer}` | `image/tiff` del original numérico `incident.tif` o `absorbed.tif`, opcional en la interfaz; sin paths de cliente. |

Errores estructurados `{ "error": {"code":"...", "message":"..."} }`: entrada/fecha/zona/hora DST inválidas `400/422`, ROI ausente o no autorizado `404/403` según política del equipo, diámetro/recursos excedidos `413`, solicitud simultánea `429`, proveedor/modelo atmosférico no disponible `503`, timeout `504`, error interno saneado `500`. IDs o capas inexistentes `404`; no revelar si un ROI ajeno existe. Cero y noche son **respuestas ready** con valores físicos cero, no errores.

## 5. Productos científicos y preview Inferno

`export_radiation` escribe `incident.tif`, `absorbed.tif`, `run.json`: Float32, una banda por capa, CRS métrico, afín, dimensiones/resolución/extensión comunes, máscara válida y NoData NaN, tags `units=W/m2`, `model=direct-geometric-v1`, `layer`. Validar al releer y vincular hashes HGT a ZIP realmente usados, instante/posición/versión pvlib/fuente Linke/intensidad y modelo en manifiesto; el exportador actual no guarda todos esos nuevos campos, por lo que su extensión es **pendiente**. El valor cero válido permanece en raster. No publicar resultados parciales ni dar una huella declarada por comprobada.

Desde TIFF y máscara, generar preview PNG RGBA **reproyectada a EPSG:4326 norte-arriba**, con `bounds_lonlat=[west,south,east,north]` deducidos de la **grilla PNG final**, no del bbox del ROI ni del raster métrico. En MapLibre ImageSource: esquinas `[west,north]`, `[east,north]`, `[east,south]`, `[west,south]`; si tamaño/distorsión no permite alineación bajo tolerancia verificada, reducir alcance o evaluar tiles solo con mediciones. El PNG no lleva CRS intrínseco: usar su JSON de la misma corrida/versión. Muestreo siempre del GeoTIFF, nunca inferir W/m² desde el PNG. Raster y máscara reproyectados con criterio `nearest` documentado para que el color no mezcle NoData y cero.

Paleta **Inferno estándar** (LUT de versión fijada y cotejada con valores de referencia). Para cada píxel válido y ambas capas: si `DNI_ajustada>0`, `u=clip(G/DNI_ajustada,0,1)`; si `DNI_ajustada=0`, `u=0` sin división. `range_w_m2=[0,DNI_ajustada]` único para incidente/absorbida; `u=0` usa el color mínimo Inferno con alfa 255, NoData alfa 0. De noche, mapas válidos de cero, `zero_range=true` y leyenda «0 W/m²», distintos de los píxeles transparentes. El porcentaje es un control experimental; la leyenda científica está en W/m². No hay preview implementada hoy. Para tamaño grande, preview reducida georreferenciada bajo presupuesto de píxeles; tiles únicamente tras evidencia de necesidad.

## 6. Fases después de la aprobación (no autorizadas por este documento)

| Fase | Entregable acotado | Criterio de aceptación verificable |
| --- | --- | --- |
| **A. Posición solar** | Módulo puro separado de `radiation.py`, dependencia pvlib fijada, entrada instante IANA + punto interior ROI/altitud DEM; salida azimut, elevación aparente, cénit y noche. | Pruebas de azimut norte-horario y horas distintas con referencias astronómicas independientes (origen y tolerancia citados), conversión local↔UTC, día/noche/amanecer/mediodía/atardecer, DST inexistente/ambiguo, zona inválida, ROI grande/multizona y punto realmente interior. Registrar temperatura/presión supuestas y versión; sin modificar proveedor. |
| **B. DNI cielo despejado** | `ineichen` + Linke climatológica empaquetada, DNI, ajuste `[0,100]%`, noche forzada a cero y metadatos de supuestos. | Referencia `pvlib` fijada para fecha/lugar sintéticos y tolerancia numérica, noches `DNI=0`, intensidades 0/50/100, rechazo de DNI no finita/negativa, igualdad `ajustada=clear_sky×p/100` en día; documentar climatología/versión, sin inventar condiciones meteorológicas. |
| **C. Motor existente** | Orquestación `ROI/DEM+posición+DNI→normales→simulate_radiation`, sin `prepare_cached_terrain`. `acquire_roi` del proveedor compartido entrega granules, adaptador los convierte en `{tile_id:path}` para `prepare_dem`. | Raster sintético y NASADEM local offline: incident/absorbed vs ecuaciones aprobadas, albedo por defecto 0.20 y configurable, 0 físico vs NaN, noche con elevación astronómica negativa sin `ValueError` en motor, sin GCOV ni descargas repetidas por pruebas. |
| **D. GeoTIFF y Inferno** | Reutilizar `export_radiation`, extender manifiesto y producir dos previews PNG RGBA EPSG:4326 con la misma escala DNI ajustada. | Reabrir ambos TIFF y comparar píxeles válidos/CRS/afín/máscara/units; forzar error en segundo archivo y comprobar cero resultados visibles. Inferno en 0/medio/máximo, transparencia NoData, cero válido alfa 255, rango degenerado noche/intensidad 0; alineación de esquinas/centros dentro de medio píxel de preview; presupuesto medido. |
| **E. API DRF** | POST/GET/preview/sample/export, identidad opaca, ROI/permisos, servicio síncrono limitado y errores. | Tests HTTP desde interfaz pública: JSON exacto y tipos, ausencia de parámetros manuales, fecha/zona/DST, región ajena, IDs/path maliciosos, muestras coordenadas/no cobertura/NoData, noches, concurrencia, timeout, publicación atómica. Integración real exige contrato ROI del equipo y un único proceso de adquisición NASADEM; si no está, fase bloqueada. |
| **F. Handoff frontend e integración** | Documento de ejemplos y semántica de ángulos/porcentaje/leyenda; ejecución controlada con datos NASADEM locales o autorizados y presupuesto medido; sin editar frontend. | Flujo POST→GET→dos previews→sample→export con misma corrida, metadatos UTC/local/procedencia completos, alineación y valores físicos verificables; prueba real pendiente se declara pendiente si falta ROI/acceso, nunca se simula evidencia. Confirmación con dueño del panel del significado de 146°. |

Usar pruebas unitarias sintéticas para el motor nuevo y aislar las pruebas con NASADEM real; no usar resultados previos de sub-ROI como validación de todo Chiapas. Conservar pruebas existentes y documentación del cambio en la fase que corresponda.

## 7. Rendimiento, seguridad y decisiones abiertas

- **Presupuestos:** el preflight de `prepare_dem` (16 teselas, 30 millones de píxeles y estimación de 1 GB por defecto) **no** cubre memoria total de pvlib, matrices float64, dos TIFF, reproyección y PNG. Medir pico, bytes y latencia con sub-ROI antes de fijar límites de ROI/raster, longitud temporal, salida y timeout HTTP. Si la descarga o cálculo no cabe en un request síncrono, rechazar de forma tipada y consensuar un ejecutor durable; no introducir Celery/Redis por estar instalados. El deslizador horario puede solicitar nuevas simulaciones: reutilizar DEM/normales solo si ya están de forma segura en memoria y cabe en presupuesto; nunca usar L2/L3 persistente.
- **Proceso único NASADEM:** una sola instancia de adquisición sobre la caché del proveedor compartido, sin workers multiproceso ni escrituras concurrentes a esa raíz; bloquear/serializar adquisición del proceso y limitar trabajos globales/por usuario. `acquire_roi` autentica de forma no interactiva solo si faltan ZIP; no invocar en el mismo flujo `acquire_roi_tiles` (requiere otra responsabilidad de auth y recibos). No leer/escribir fuera de raíces controladas, no aceptar rutas del cliente, no exponer credenciales, tokens, paths ni URLs Earthdata privadas.
- **Entrega íntegra:** staging propio, dos TIFF/PNG/manifiesto verificados antes de marcar `ready`, ID aleatorio no interpretable como ruta, permisos del ROI en cada GET, errores saneados y limpieza solo de temporales del trabajo; proteger la consulta sin filtrar existencia de regiones ajenas. Politica de conservación de corridas y control de acceso por equipo todavía pendiente.
- **Decisiones que requieren acuerdo antes de E:** (1) contrato ROI real (`roi_id`, versión, geometría, autorización, zona horaria) y si el ROI cruza zonas; (2) aprobación/calibración de diámetro 10 km y variación 0,5° del modelo de punto único; (3) semántica real del indicador `146°` en frontend; (4) políticas/umbrales medidos de tiempo, disco, memoria, concurrencia y de ID de corrida; (5) versión fijada de `pvlib` y fuente/versión de Linke, temperatura/altitud/presión asumidas, licencia y LUT Inferno; (6) alineación/precisión/escala de PNG, opción de tiles si se justifica. Son elecciones de producto/operación, no autorización de modificar el proveedor ni el frontend.

**Siguiente paso:** validar con el integrante frontend este JSON, el indicador angular y el contrato ROI compartido. Detenerse antes de implementar hasta aprobación explícita. No commit ni push.
