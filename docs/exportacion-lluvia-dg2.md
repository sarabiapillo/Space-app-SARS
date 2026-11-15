# Exportación de lluvia para DG2

El exportador offline `pipeline.hydrology.rainfall_netcdf.export_rainfall_netcdf` convierte un perfil sintético ya generado y un DEM preparado en un NetCDF de forzamiento. No prepara terreno hidráulico, no fija condiciones iniciales/fronteras y no ejecuta el solver. NASADEM aporta elevaciones, no profundidad de agua.

## Uso

```python
from pipeline.hydrology.rainfall import generate_rainfall_profile
from pipeline.hydrology.rainfall_netcdf import export_rainfall_netcdf

profile = generate_rainfall_profile(
    {"rainfall": {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"},
     "roi": roi_geojson},
    interval_count=8, seed=27, distribution="uniform_balanced",
)
manifest_path = export_rainfall_netcdf(
    profile, "terrain.tif", "rainfall.nc",
    simulation_duration_s=10_800,
)
```

`simulation_duration_s` es obligatorio, finito y positivo, e independiente del intervalo de lluvia. Debe cubrir exactamente o superar el fin declarado del perfil; no se ajusta silenciosamente. Si el usuario elige una duración mayor, el exportador añade un nivel final sin lluvia. El máximo de valores 3D tiene un límite operativo `max_values` (predeterminado 50 millones), comprobado con las dimensiones del raster antes de leer sus celdas; no representa una decisión física. Se rechazan inicio distinto de cero, huecos/solapes, duración declarada incoherente y ROI que no quepa completa en la extensión del DEM (tolerancia numérica de 1e-9 del tamaño de celda).

## Contrato exportado

| Elemento | Contrato |
|---|---|
| Variable | `rainfall_depth(time,y,x)`, milímetros acumulados en cada intervalo; no es mm/h ni m/s. |
| Tiempo | Horas (el lector nativo 8.0 interpreta así la coordenada); inicio exacto en cero, cada inicio de segmento y el final de lluvia, más el final de simulación si hay cola seca. |
| Malla | Extensión rectangular completa del DEM, centros de celda en metros; x creciente, y decreciente. DEM proyectado, norte-arriba, sin rotación y celdas cuadradas de al menos 2×2. |
| Espacio | Intensidad temporal uniforme en centros de celda dentro de `profile['roi']`; cero fuera, incluso si el DEM excede la ROI. |
| Elevación | Se exige elevación DEM conocida en centros seleccionados. El raster no se convierte en profundidad de agua. |
| Archivos | NetCDF3 64-bit-offset (CDF-2) y manifiesto JSON adyacente con hashes de perfil/DEM, ROI, malla, duración y límites de interpretación. No sobrescribe archivos existentes ni admite una ruta `.json` que colisione con el manifiesto. |

El backend usa SciPy (`scipy.io.netcdf_file`), ya disponible en el entorno actual, y no requiere instalar `netCDF4` ni cambia dependencias. Si SciPy falta en otro entorno, solo falla la llamada de exportación; importar el resto del pipeline sigue siendo posible. El NetCDF y el manifiesto describen datos sintéticos (`synthetic: true`, `hydraulic_ready: false`): escribirlos no demuestra compatibilidad de ejecución, validez de una tormenta ni precisión hidráulica. No se generan `.par`, estado inicial, caudales, Manning ni infiltración, ni se ejecuta automáticamente DG2.

La distribución temporal procede de `generate_rainfall_profile`; aquí cada intensidad en m/s se integra sobre la duración real de su intervalo para producir mm acumulados. La lluvia cesa explícitamente al final del perfil y cualquier extensión de simulación queda seca.
