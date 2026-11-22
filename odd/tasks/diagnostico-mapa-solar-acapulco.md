# Diagnóstico del mapa solar de Acapulco
Estado: análisis local; sin cambios en producción, commits ni push.

## Specs
S1. «Calcula los SHA-256 de los archivos y comprueba que coincidan con los hashes declarados por producción»; «Verifica las estadísticas, distribución espacial de irradiancia, máscara NoData, resolución, CRS y continuidad del ráster».
S2. «Identifica si el frontend está utilizando la escala absoluta cuando debería utilizar el contraste adaptativo»; «Verifica los percentiles 2 y 98, la normalización de los colores, la leyenda y la correspondencia entre los valores del ráster y los colores del mapa».
S3. «Determina si las líneas oscuras son isolíneas legítimas, artefactos del cálculo de contornos, problemas de reproyección o errores de renderizado»; «Compara el PNG original sin isolíneas con la representación final».
S4. «Utiliza el `code_version` del manifiesto, los parámetros, la ROI y las características del ráster para determinar si existen diferencias entre ambos entornos»; «Cuando sea posible, reproduce localmente la simulación con exactamente la misma ROI y configuración».
S5. «Corrige únicamente los problemas demostrados»; «Mantén la paleta Inferno y los estilos actuales de la interfaz»; «Agrega pruebas de regresión y ejecuta las pruebas relevantes». Restricciones: «No modificar producción»; «No realizar commit ni push»; «No alterar las ecuaciones físicas sin justificación»; «No modificar los valores de `incident.tif` para mejorar artificialmente el contraste»; «No introducir datos de elevación ficticios».

## Tasks
T1 | S1-S4 | análisis local inline | commit: prohibido.
T2 | S2,S5 | regresión inline, conservar ediciones preexistentes | commit: prohibido.
T3 | S1-S5 | pruebas y entrega | commit: prohibido.

## Log
L1. Solicitud original del usuario:
# TerraPulse AI — Diagnóstico y corrección del mapa de calor solar

Ya recuperé mediante SSH y SCP los archivos de la simulación de Acapulco ejecutada en producción.

Los archivos están en el directorio `./terrapulse-diagnostico/` (localízalo en el entorno de trabajo si está en otra ubicación):

- `run.json`: metadatos obtenidos mediante la API pública.
- `incident.tif`: ráster numérico de irradiancia.
- `preview.png`: mapa de calor generado por el backend.
- `contours.json`: isolíneas generadas por la API.

## Contexto del problema

En producción, el mapa de calor de Acapulco aparece prácticamente uniforme en naranja y presenta numerosas líneas oscuras diagonales.

En desarrollo local, el mapa mostraba variaciones más pronunciadas sobre las montañas.

La simulación de producción tiene:

- RUN_ID: `0fdad8cdaecd47cf9fb6590ac2dbfa6b`
- Elevación solar: 45°
- Azimut: 180°
- Intensidad: 100 %
- DNI ajustada: 873.8584 W/m²
- Irradiancia mínima: 587.0734 W/m²
- Máxima: 637.3249 W/m²
- Media: 620.3242 W/m²
- Mediana: 617.9112 W/m²
- Celdas válidas: 56,094
- Resolución: 30.9222 m
- NASADEM: `n16w100`
- CRS: EPSG:32614

## Tareas

**1. Verifica los archivos recuperados.**

Calcula los SHA-256 de los archivos y comprueba que coincidan con los hashes declarados por producción:

- `incident.tif`: `06c2ac5d6fa724da6e8626a9f19be977c6cbe1eb8ea389d57baa7305eeea6028`
- `preview.png`: `024742fef10ea6e55d659d030cf86af347e8ab2e4afc7b73c5f3fddb30a22846`

**2. Analiza los resultados científicos.**

Inspecciona `incident.tif` con Rasterio o GDAL.

Verifica las estadísticas, distribución espacial de irradiancia, máscara NoData, resolución, CRS y continuidad del ráster.

Determina si los valores son consistentes con el modelo físico utilizado. No supongas que el cálculo es correcto únicamente porque devuelve valores válidos.

**3. Investiga la visualización.**

Compara `preview.png` con los datos numéricos del GeoTIFF.

Revisa:

- `web/src/utils/solarHeatmap.ts`
- `decodeInfernoPixels()`
- `scaleFor()`
- `renderHeatmap()`
- La integración del mapa en `RightPanel.tsx`

Identifica si el frontend está utilizando la escala absoluta cuando debería utilizar el contraste adaptativo.

Verifica los percentiles 2 y 98, la normalización de los colores, la leyenda y la correspondencia entre los valores del ráster y los colores del mapa.

**4. Investiga las líneas diagonales.**

Analiza `contours.json` y su representación en el frontend.

Determina si las líneas oscuras son isolíneas legítimas, artefactos del cálculo de contornos, problemas de reproyección o errores de renderizado.

Compara el PNG original sin isolíneas con la representación final.

**5. Compara producción y desarrollo.**

Utiliza el `code_version` del manifiesto, los parámetros, la ROI y las características del ráster para determinar si existen diferencias entre ambos entornos.

Cuando sea posible, reproduce localmente la simulación con exactamente la misma ROI y configuración.

Si necesitas una tesela NASADEM específica que no está disponible localmente, indícalo y no sustituyas silenciosamente los datos.

**6. Corrige únicamente los problemas demostrados.**

Si el problema está en el frontend, corrige la visualización sin alterar los resultados físicos.

Si encuentras un problema en el backend, explica primero la evidencia que lo demuestra.

Mantén la paleta Inferno y los estilos actuales de la interfaz.

Agrega pruebas de regresión y ejecuta las pruebas relevantes.

## Restricciones

- No modificar producción.
- No realizar commit ni push.
- No alterar las ecuaciones físicas sin justificación.
- No modificar los valores de `incident.tif` para mejorar artificialmente el contraste.
- No introducir datos de elevación ficticios.
- No eliminar funcionalidades existentes.
- No asumir que un mapa visualmente diferente necesariamente implica un cálculo incorrecto.

## Entregables

Al finalizar, proporciona:

1. Diagnóstico de la causa raíz, respaldado por evidencia.
2. Comparación entre los resultados de producción y los locales.
3. Explicación específica de las franjas diagonales.
4. Archivos modificados y justificación.
5. Resultados de las pruebas.
6. Qué cambios tendrían que desplegarse para resolver el problema en producción.

Prioriza la exactitud científica y la integridad de los datos sobre la apariencia visual.
L2. Los SHA-256 coinciden; PNG reproyectado desde TIFF coincide en los 58.000 píxeles; contornos regenerados son idénticos a contours.json. El frontend local ya contiene cambios sin commit de contraste y leyenda que se deben preservar. Reproducción con n16w100.zip local da DNI 872.8444, altitud 0 m y rango 45.53–865.69, contra 873.8584, 21.195 m y 587.07–637.32 en producción. El manifiesto no contiene hash de tesela; no se puede afirmar identidad del DEM.
L3. Regresión agregada a web/tests/solarHeatmap.test.mjs a partir de los conteos de índices Inferno observados del PNG de producción (sin depender del archivo recuperado para CI): p2–p98 602.484–629.792 W/m² y leyenda local. Pruebas frontend 19/19 y build OK; backend 60/60 después de establecer DJANGO_ALLOWED_HOSTS=testserver solo para pruebas. Primer intento backend 25 fallas por DisallowedHost, no por código solar. git diff --check OK. Sin commit ni push.
