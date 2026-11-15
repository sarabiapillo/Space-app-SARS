# Preparar un DEM local para análisis de inundación

El módulo `pipeline.hydrology.dem_prepared` convierte registros NASADEM ya adquiridos en un GeoTIFF estructural recortado al polígono que proporciona quien llama. Es una preparación local, sin red ni integración HTTP; no elige ni delimita el dominio de simulación.

## Uso desde Python

```python
from pipeline.hydrology.dem_prepared import prepare_dem

output = prepare_dem(
    geometry_geojson, granules, "salida/dem-preparado",
    target_crs="EPSG:32631",       # ejemplo de CRS; el caller decide el apropiado
    resolution_m=30,
    resampling="bilinear",         # elección explícita: nearest o bilinear
    max_cells=2_000_000,
    target_vertical_datum="EGM96",
    code_version="<versión declarada por la aplicación>",
)
```

El polígono GeoJSON se interpreta en EPSG:4326. `granules` son registros `NASADEMGranule` retornados por el proveedor y adquiridos previamente. La carpeta destino debe ser nueva; no se sobrescribe. El código no realiza adquisición, autenticación, publicación ni elección geográfica automática.

## Contrato de salida

- `terrain.tif`: una banda float32, CRS y transformación proyectados explícitos, celdas cuadradas en metros, nodata NaN. Se enmascaran los centros de celda fuera del polígono.
- `manifest.json`: GeoJSON de entrada exacto con CRS EPSG:4326, teselas/miembros y SHA-256 calculados localmente, producto/versión, datums, CRS horizontales, resolución, transformación, nodata, remuestreo, regla de solape, conteo de cobertura y versión de código declarada.
- `hydraulic_ready` siempre es `false`. El manifiesto señala que dominio, fronteras y preparación DG2 siguen pendientes.

La cobertura se comprueba para centros de celdas seleccionados; exigir cobertura completa es una propiedad estructural discreta, no prueba de continuidad espacial ni aptitud hidrológica. Mosaicos con solape usan el primer valor válido en orden estable de latitud, longitud y tile ID; no promedian costuras. Los fixtures sintéticos ejercitan el borde compartido con elevaciones distintas y un gradiente horizontal para detectar desplazamiento de registro: la salida y el orden de registros son iguales aunque la colección entre invertida. El remuestreo es explícito. Para bilinear, se conserva además una máscara de validez independiente por vecino más cercano para evitar declarar válidos valores nodata interpolados. Un centro seleccionado que cae sobre `-32768` produce rechazo por cobertura incompleta tanto con nearest como con bilinear; la prueba confirma que no se crea destino y no se modifica el ZIP. Las celdas fuera del polígono permanecen nodata, incluso cuando hay elevaciones válidas alrededor.

## Límites científicos y de datos

**Decisión actual:** mantener NASADEM como fuente de terreno y no añadir proveedores por complejidad o por una supuesta garantía de precisión. La integridad del ZIP, la malla métrica, la cobertura y el nodata se comprueban técnicamente; **no garantizan precisión hidráulica**. Esa precisión requeriría contraste independiente del terreno y de los resultados para el caso concreto, además de condiciones físicas adecuadas.

El espaciado fuente es un segundo de arco, no una celda métrica constante. La resolución destino debe elegirse para el lugar y objetivo; remuestrear a celdas más pequeñas no añade detalle topográfico observado. Los `30` metros del ejemplo de uso no son una resolución global obligatoria ni una afirmación de exactitud. La [guía oficial NASADEM V1.3, §3 y tabla 1](https://lpdaac.usgs.gov/documents/2237/NASADEM_User_Guide_V13.pdf) documenta el producto y su datum; no certifica una simulación hidráulica de TerraPulse ni garantiza batimetría de cauces sumergidos.

Solo se aceptan `NASADEM_HGT` versión `001`, HGT coincidente con el tile y datum fuente EGM96. Se rechaza cualquier datum objetivo distinto: no hay conversión vertical. NASADEM HGT contiene elevaciones merged en metros EGM96. Las muestras `-32768` quedan excluidas por estar fuera del rango válido de la guía, sin afirmar que sean nodata oficial. No se rellenan huecos, corrigen sumideros, suavizan ni tallan cauces. La reproyección es horizontal y la elevación no se convierte salvo el efecto del remuestreo escogido.

El presupuesto `max_cells` limita la grilla destino antes de asignar sus arreglos. Cada ZIP se valida mediante `validate_hgt_zip`, que lee y resume el HGT para validar la dimensión declarada; esa lectura puede usar memoria temporal acotada por el validador. Los HGT son 3601×3601 int16; este módulo procesa las teselas de forma secuencial y no construye un lienzo geográfico global. Los datos de prueba son sintéticos, no elevaciones observadas.

Este archivo local no es una URL pública de teselas ni una capa servida por el frontend. No cambia el contrato HTTP actual: `can_simulate: false`; no hay endpoint, resultado, profundidad, velocidad ni lluvia en esta unidad. Un GeoTIFF preparado tampoco es el DEM ASCII ni los coeficientes `.dem1x/.dem1y` que requieren ciertos flujos DG2. Ver [evidencia y bloqueos del solver](verificacion-dg2.md) antes de cualquier ejecución.
