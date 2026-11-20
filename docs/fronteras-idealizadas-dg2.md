# Frontera FREE idealizada para DG2

`format_free_boundary(dem_path, output_dir)` produce un `.bci` de preparación para revisión, no una condición observada ni una simulación lista. El llamador elige explícitamente el DEM computacional completo; la función no decide dominio ni salida hidráulica, no se conecta a HTTP y no ejecuta LISFLOOD-FP.

```python
from pipeline.hydrology.boundaries import format_free_boundary

format_free_boundary("terrain.tif", "prepared-boundary")
```

El GeoTIFF debe ser monobanda, proyectado con unidades métricas, norte-arriba, sin rotación, celdas cuadradas y con valores finitos válidos en cada celda del perímetro. Un borde con nodata se rechaza: no se presenta un muro de nodata como descarga libre. El destino debe ser nuevo; se escriben `boundary.bci` y `manifest.json`. El manifiesto identifica fuente/malla, método y semántica, y siempre marca `synthetic: true`, `idealized: true`, `hydraulic_ready: false`.

La salida asigna FREE a los cuatro lados del borde del dominio suministrado, no a un cauce o sección elegidos por el sistema. En LISFLOOD-FP 8.0 CPU DG2, el manual describe FREE como frontera de flujo uniforme/superficie libre, con pendiente opcional; el código admite pendiente omitida (`-1`, pendiente local) o explícita. No se inventa una pendiente. El uso de FREE no garantiza salida neta: según estado hidráulico puede permitir entrada o salida. Debe revisarse por el físico si esta idealización representa la pregunta; si se requiere Q(t) en m³/s por una sección nombrada o un nivel con datum definido, esta función no lo suministra.

## Evidencia del formato

Fuente local inspeccionada del ZIP 8.0 cotejado por el padre (solo lectura): `data/tools/lisflood-fp-8.0/inspection/input.cpp:1552–1613,1635–1659` lee N/E/S/W y coordenadas del segmento; `swe/dg2.cpp:613–619` maneja `FREE1` en la ruta DG2; `boundary.cpp:98–104` calcula flujo de borde. El manual extraído `USER_MANUAL_EXTRACTED.txt:1117–1138` define las columnas y FREE; `input.cpp:1638–1645` documenta pendiente local opcional o pendiente dada. La ruta CPU usa `dg2::solve` (identificación del padre). No se infiere que FREE sea solo salida ni se certifica el comportamiento del ejecutable.

La elevación del terreno (NASADEM, EGM96 de origen, o Copernicus GLO-30, elipsoidal) llega al solver como altura EGM2008, el datum de todas las alturas del simulador, y no es profundidad de agua. Una frontera idealizada no aporta h0, velocidades, caudal, Manning, nivel de referencia ni evidencia de exactitud. Antes de cualquier ejecución hacen falta decisión de dominio/frontera, parámetros físicos y revisión de compatibilidad de entradas. Ver [entradas para el físico](entradas-hidraulicas-para-fisico.md) y [verificación DG2](verificacion-dg2.md).
