# DG2: evidencia verificada y ejecución pendiente

**DG2 sigue sin estar habilitado para ejecución.** No hay ejecutable verificado ni caso físico concreto. El usuario confirmó que el repositorio etiqueta el proyecto como GNU GPL v2.0-only. GNU GPL v2 §0 permite ejecutar el programa sin restricciones por esa licencia; distribución y modificación tienen obligaciones. Esto no autoriza redistribución. Esta revisión distingue formatos documentados de capacidades de un ejecutable.

## Estado de la revisión

| Aspecto | Evidencia observada | Lo que falta antes de ejecutar |
|---|---|---|
| Versión | [Zenodo 4073011](https://zenodo.org/api/records/4073011) identifica **LISFLOOD-FP 8.0**, archivo `LISFLOOD-FP-8.zip`, 52 973 472 bytes, checksum publicado `md5:00602cbba617a50a34478495d2688add`. | Se descargó y cotejó ese ZIP por tamaño y MD5 publicado. `VersionHistory.h:15–18` declara 8.0, incremento 3. Se revisaron textos y código del artefacto, sin compilar ni ejecutar. Falta verificar un ejecutable. |
| Licencia | El registro Zenodo 4073011 indica `gpl-2.0` para el candidato 8.0. La mención GPL v3.0 del sitio SEAMLESS-WAVE corresponde a la versión 8.1, no a 8.0. GNU GPL v2 §0 permite ejecutar el programa. | No se encontró archivo principal `COPYING` en el inventario inspeccionado: esto no prueba que ejecutar esté prohibido. La distribución y modificación tienen obligaciones GPL; no se autoriza aquí redistribuir. El usuario confirmó la etiqueta GNU GPL v2.0-only del repositorio. Revisar obligaciones antes de distribuir. |
| DEM del solver | [Formato DEM](https://www.seamlesswave.com/Merewether1-4.html): Esri ASCII raster, `ncols`, `nrows`, `xllcorner`, `yllcorner`, `cellsize`, `NODATA_value`; coordenadas y celdas cuadradas en metros. | Validar exportación contra release exacto. El GeoTIFF preparado por TerraPulse **no** es todavía este contrato de entrada. |
| Representación DG2 | [Preparación DG2](https://www.seamlesswave.com/Merewether2-4.html): `.dem`, `.dem1x`, `.dem1y` contienen promedio y coeficientes de pendiente; se generan con `generateDG2DEM` a partir de DEM `.raw` y parámetros. | Verificar utilidad del release exacto, proyección de coeficientes, alineación y salidas con benchmarks. No inventar coeficientes ni sustituirlos por una pendiente GIS. |
| Parámetros | [Archivo `.par`](https://www.seamlesswave.com/Merewether1-1.html): `dg2`, `DEMfile`, `sim_time`, `initial_tstep`, `bcifile`, `bdyfile`, `fpfric`/`manningfile`, `dynamicrainfile`, opciones de inicio/salida/limitador. La guía advierte que opciones desconocidas se ignoran y ausentes pueden activar defaults del código. | Un futuro adaptador debe validar los parámetros y evitar defaults físicos silenciosos. No se generó archivo `.par` ni línea de ejecución en esta fase. |
| Lluvia | [Entrada de lluvia](https://www.seamlesswave.com/Merewether1-8.html): TUFLOW NetCDF, acumulado en **mm por intervalo** y tesela, primer timestamp 0, duración que cubra la simulación, origen común con DEM y tamaño de tesela múltiplo entero de celda. | Cotejar lector/unidades/timestamp en código del release y definir distribución espacial/temporal de la lluvia hipotética. No confundir mm por intervalo con mm/h ni con m/s. |
| Infiltración | **No aplicada por la ruta CPU DG2 inspeccionada de este ZIP 8.0.** El manual excluye FV1/DG2 y el bucle DG2 no llama al código de infiltración heredado. El parser puede aceptar opciones que esa ruta no usa. | No anunciar infiltración ni pasar esas opciones como si funcionaran. No restar pérdidas a la lluvia como sustitución silenciosa ni generalizar el resultado a otros releases. Cualquier tratamiento exige decisión científica e implementación verificadas. |

La documentación web es evidencia de diseño y uso, **no una prueba funcional del binario**. Los ejemplos urbanos enlazados sirven únicamente para identificar interfaces: no amplían el alcance actual de TerraPulse a ciudades.

## Qué significa el DEM de NASADEM

La [guía oficial NASADEM V1.3, enero de 2025](https://lpdaac.usgs.gov/documents/2237/NASADEM_User_Guide_V13.pdf), §3 y tabla 1, distingue:

- `NASADEM_HGT` merged: 3601 × 3601 muestras, entero con signo de 16 bits, orden big-endian; elevaciones en **metros respecto del geoide EGM96**, no profundidad de agua ni altura elipsoidal.
- El producto SRTM-only de otro grupo contiene alturas respecto del elipsoide WGS84: no son intercambiables ni se convierten cambiando una etiqueta.
- La tabla indica rango HGT `−32767…32767` y `N/A` en nodata. `−32768` queda fuera de ese rango: debe tratarse como muestra inválida, nunca como cota ni como cero. No se afirma que la guía lo declare nodata del producto merged.
- El espaciado de un segundo de arco es angular, no una resolución métrica constante. Remuestrear a una celda más fina no crea detalle topográfico.

El proveedor existente entrega ZIP originales, no mosaicos, recortes o conversiones de datum. Su cobertura es limitada; regiones fuera de ella necesitan otra fuente. El producto no queda limitado a Chiapas ni toda ROI global garantiza datos.

Ver [proveedor NASADEM](nasadem-provider.md) para límites de confianza y caché exclusiva de un proceso. El checksum local sirve para rastrear bytes, no como autenticación criptográfica de NASA ni como demostración de exactitud de elevación.

## Decisiones científicas que siguen abiertas

Antes de un caso real se deben definir y validar, sin defaults implícitos:

1. **Dominio y terreno no urbano:** área contribuyente y salidas hidráulicas, no solo polígono de visualización. Si infraestructura omitida controla el flujo, rechazar o replantear el caso.
2. **Topografía:** CRS/resolución apropiados, datum vertical común para cotas y niveles, cobertura y nodata, cauces/batimetría, sesgos por vegetación y cambios desde la adquisición. Preparación estructural no certifica esos aspectos.
3. **Estado inicial y fronteras:** agua y velocidades/caudales iniciales; entradas/salidas, niveles y condiciones en el contorno. No asumir lecho seco ni borde cerrado. `pipeline.hydrology.boundaries.format_free_boundary` prepara cuatro bordes FREE idealizados a partir del DEM que el llamador elige; no selecciona un outlet ni garantiza salida neta. Ver [guía de fronteras](fronteras-idealizadas-dg2.md).
4. **Forzamientos:** lluvia hipotética del usuario con cantidad o intensidad **y duración**, distribución espacial y temporal explícita, rugosidad y tratamiento de infiltración. Los datos históricos o pronósticos no son entradas obligatorias.
5. **Aceptación:** benchmarks pertinentes, convergencia de malla/tiempo, estabilidad, wetting/drying, balance de masa, tolerancias justificadas y contraste independiente. No se inventan valores de aceptación ni resultados.

El backend actual solo prepara entradas: [contrato para frontend](api-simulacion-inundacion.md). NISAR no aporta por sí mismo DEM, lluvia, profundidad ni validación hidráulica.

## Cotejo del artefacto 8.0

El archivo oficial quedó en `data/tools/lisflood-fp-8.0/LISFLOOD-FP-8.zip` (ignorado por Git). Tamaño y MD5 coinciden con el registro citado; eso identifica los bytes revisados, no certifica exactitud hidráulica. Los localizadores siguientes se refieren a rutas internas de ese ZIP, extraídas como texto para inspección:

- **Versión y ruta activa:** `VersionHistory.h:15–18` declara 8.0 / incremento 3; `lisflood.cpp:745–748` selecciona `dg2::solve` en CPU. La alternativa `dg2new` está comentada: no atribuirle capacidades a la ruta activa.
- **DEM e inicio:** `swe/dg2/fields.cpp:88–99` lee el archivo base y sus coeficientes `1x`/`1y`; `preprocess/generateDG2DEM.cpp:47–69` parte del `.raw`. `swe/dg2.cpp:29–36` exige también coeficientes del estado inicial cuando se usa `startfile`. No se validó de punta a punta la combinación de `startelev` con esas pendientes.
- **Lluvia NetCDF:** `rain/rain.tpp:9,44–56` lee `rainfall_depth`, convierte segundos del modelo a **horas** de la coordenada temporal y divide el acumulado en mm por el intervalo en segundos y por 1000 para obtener m/s. `lisflood2/file_tool.cpp:324–333,373–382` exige `time`, `x`, `y` y obtiene la duración entre timestamps. El atributo de unidades de tiempo **no gobierna esta conversión**: un archivo en segundos se interpretaría mal. Los x/y son centros de celda, con y descendente (`rain/rain.tpp:19–24`).
- **Validaciones que deberá hacer un futuro exportador:** timestamps desde 0, al menos dos niveles, incrementos estrictamente positivos en horas, cobertura temporal completa y conversión de tasa a acumulado por intervalo. El lector puede prolongar la última tasa si se excede la serie. Debe verificarse también cobertura espacial completa, origen y múltiplos de celda: la comprobación de índices del lector es asimétrica (`rain/rain.tpp:96–110`) y no sustituye esos controles. No se escribió exportador NetCDF ni se ejecutó ese lector en esta fase.
- **Infiltración:** `USER_MANUAL_EXTRACTED.txt:690–694` (texto del DOCX incluido) la excluye en DG2. `infevap.cpp:14–80` opera sobre la representación heredada y se invoca desde `iterateq.cpp:153–154`, no desde `swe/dg2.cpp`. `pars.cpp:475–486` acepta opciones sin garantizar su aplicación en DG2. La carga de un archivo tampoco demuestra que el solver lo utilice.
- **Defaults que no adoptamos:** ausencia de inicio implica campos iniciales cero; ausencia de fronteras asigna `NONE0` a los bordes (`input.cpp:1535–1544`). El código trae parámetros de rugosidad, tiempo y wet/dry predeterminados. Ninguno se convierte aquí en una decisión física aprobada. Detectar extensión de agua con NISAR no suministra la profundidad inicial ni prueba sequedad donde falte observación fiable.

Se revisaron fuentes, no comportamiento de un ejecutable. No se instalaron dependencias, compiló, ejecutó ni modificó el solver. Su versión fuente y algunas interfaces están comprobadas; ejecutable, datos de inicio/frontera y validación física siguen pendientes. La falta de `COPYING` principal es un hecho de inventario, no una prohibición de ejecución por GPL.

## Siguiente habilitación

Mantener `can_simulate: false` y no publicar capas de profundidad/velocidad hasta resolver estos puntos. La preparación de GeoTIFF de terreno se verifica con fixtures offline y conserva sus límites; no instala ni ejecuta `generateDG2DEM`, DG2 ni otro solver.
