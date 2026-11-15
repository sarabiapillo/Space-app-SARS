# Sugerencia opcional de cuenca

`pipeline.hydrology.watersheds.suggest_watershed` consulta, solo cuando se invoca explícitamente, el servicio experimental de [mghydro.com](https://mghydro.com/watersheds/help.html). No se conecta a la preparación HTTP existente ni inicia solicitudes al importar módulos.

```python
from pipeline.hydrology.watersheds import suggest_watershed

suggestion = suggest_watershed(
    latitude=43.253, longitude=-77.609, precision="high", timeout=30,
)
print(suggestion.geojson)  # FeatureCollection GeoJSON sugerida
```

Se debe proporcionar un punto WGS84 elegido y revisado por quien llama; no hay selección automática de desembocadura. `precision` acepta `high` o `low`; el tiempo de espera debe ser finito, positivo y no superar 300 segundos. El cliente solicita únicamente `lat`, `lng` y `precision` a `https://mghydro.com/app/watershed_api`, limita la respuesta a 2 MB y no reintenta. La respuesta contiene `source`, `query`, `geojson`, `suggested_only=True` y `hydraulic_ready=False`. Los errores HTTP, red, timeout, JSON o geometría generan `WatershedError`; parámetros inválidos generan `ValueError`. Ningún fallo se sustituye por una cuenca vacía ni por una fuente alternativa.

La geometría y propiedades del proveedor se conservan sin normalización; por ejemplo, `area_km2` puede ser una cadena formateada y no es un área validada por este proyecto. El servicio puede ajustar el punto de salida. Compare cualquier salida y desembocadura con fuentes independientes antes de usarla; la cobertura basada en MERIT-Hydro es casi global pero no incluye todas las islas. Las geometrías GeoJSON son una sugerencia, no se convierten automáticamente al esquema de ROI ni constituyen un dominio hidráulico o una capa servida para el frontend.

La integración es opcional y no afecta `HTTP /api/flood-scenarios/prepare/`, que permanece offline y sin cambios. No implementa solver, condiciones iniciales o profundidad de agua, lluvia, fronteras ni adquisición DEM. Esas decisiones científicas continúan pendientes. Use el servicio solo de forma puntual, de acuerdo con sus términos publicados; evite ráfagas o uso por lotes. El uso y redistribución de datos también están sujetos a los términos de sus datos subyacentes; este proyecto no atribuye licencias.

Fuentes del servicio: [ayuda de Watersheds](https://mghydro.com/watersheds/help.html) y [API experimental](https://mghydro.com/new-experimental-watersheds-api/).
