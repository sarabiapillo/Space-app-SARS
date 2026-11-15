# Profundidades DG2 offline para el frontend

`pipeline.hydrology.results` lee salidas ASCII existentes; no ejecuta el solver ni publica HTTP. El caso T030 es **sintético**, no representa la ROI del usuario ni acredita precisión hidráulica.

## Uso

```python
from pipeline.hydrology.results import summarize_results, read_depth_ascii, export_depth_cog

metadata = summarize_results("data/tools/lisflood-fp-8.0/runtime/smoke-t030/results", save_interval_s=1)
# Para un resultado con coordenadas métricas proyectadas verificadas:
# exported = export_depth_cog("salida.max", "nuevo-cog.tif", crs="EPSG:32615", code_version="version-explicita")
```

`read_depth_ascii(path, max_cells=4_000_000)` acepta exactamente seis líneas de encabezado ESRI ASCII (`ncols`, `nrows`, `xllcorner`, `yllcorner`, `cellsize`, `NODATA_value`) y una matriz completa, limitada antes de asignarla. Devuelve `values` NumPy, `nodata`, `grid`, `bounds` y `stats`. Nodata es **desconocido**, nunca seco; profundidad cero significa seco solo en celdas válidas. Profundidades y cellsize se expresan en metros; la profundidad es agua **sobre el lecho local**, no elevación NASADEM.

`summary_results` no existe: usar `summarize_results(directory, *, save_interval_s, crs=None, max_cells=4_000_000)`. Los sufijos `*-0000.wd`, `*-0001.wd`, etc. son índices de cuadro, **no marcas temporales físicas**: DG2 no registra el tiempo real de cada cuadro ASCII y puede avanzar el paso antes de guardar. `frames` se ordena por `frame_index` (entero); `time_s` es siempre `null` y `scheduled_time_s = frame_index × save_interval_s` expresa exclusivamente el tiempo **programado/solicitado**, nunca el observado. `time_axis.status: "actual_times_unavailable"` explica esta limitación. No interpolar ni sincronizar físicamente los cuadros con observaciones; la animación puede avanzar por índice sin mostrar segundos físicos. Un paso inicial pequeño no prueba que los tiempos reales coincidan con lo programado. `.max` indica máxima profundidad, no otro instante. Se rechazan mallas/nodata diferentes. La salida incluye `frames` (archivo, SHA256, índice, tiempo real desconocido, tiempo programado, estadísticas), `time_axis`, `maximum` (archivo, SHA256, estadísticas), `grid` (shape `[filas,columnas]`, esquina inferior izquierda, tamaño de celda, límites `[izq,abajo,der,arriba]`, nodata y CRS), `units`, `synthetic:true`, `hydraulic_accuracy_validated:false`, `warnings`. `stats` informa `valid_cells`, `nodata_cells`, `wet_cells`, `min_m`, `max_m`; los extremos son `null` si no hay celdas válidas. JSON serializable sin NaN salvo `values`, que solo devuelve el lector individual.

## Georreferenciación y advertencias

El benchmark usa coordenadas locales: `grid.crs` es `null`. **No** dibujarlo en un mapa mundial. `export_depth_cog(path, output_path, *, crs, code_version, max_cells=4_000_000)` exige CRS proyectado en metros explícito y verificado; no reproyecta, conserva la malla affine y el nodata, rechaza destino existente y devuelve SHA256 de entrada/salida y versión. Solo servir el COG en un mapa si el CRS corresponde realmente al dominio de esa ejecución. El frontend debe mostrar las cifras como resultados de modelo no validado, no observaciones NISAR; no hay velocidad, llegada de onda ni métricas de validación.

El archivo `.mass` contiene Qerror/Verror no nulos: su interpretación y balance quedan **pendientes**, sin afirmar confiabilidad. También queda pendiente la advertencia `getfattr` del log del smoke. Estos avisos no son certificación hidráulica. La API HTTP de resultados expone estos mismos límites temporales; ver `docs/api-simulacion-inundacion.md`.
