# API solar: escenario geométrico idealizado

> Estado: contrato de integración en desarrollo; pruebas de la versión nueva pendientes. Los ejemplos son solicitudes ilustrativas, **no** resultados medidos ni simulaciones verificadas.

La única magnitud publicada es **irradiancia solar directa incidente modelada** en W/m² por área de terreno. No representa temperatura, radiación absorbida, irradiación acumulada, medición meteorológica ni condiciones en tiempo real. Los ZIP NASADEM deben tener cobertura suficiente de la ROI. Los límites de adquisición y los supuestos de terreno/atmósfera se describen en `docs/features/solar-radiation-simulator.tex`.

## Solicitar una simulación

`POST /api/solar/simulations` con JSON:

```json
{
  "roi": {"type":"Polygon","coordinates":[[[-93.56,16.74],[-93.54,16.74],[-93.54,16.76],[-93.56,16.76],[-93.56,16.74]]]},
  "elevation_deg": 45,
  "azimuth_deg": 180,
  "intensity_percent": 100
}
```

Solo `roi` es obligatoria; los valores predeterminados de elevación, azimut desde norte en sentido horario y factor de intensidad son **45°**, **180°** y **100 % adimensional**, respectivamente. Elevación: 0°–90°; azimut: 0°–360°; intensidad: 0–100 %. No se requiere ni admite fecha, hora o zona horaria de la simulación nueva. Los timestamps administrativos de almacenamiento no son parámetros físicos. Las fechas SAR t1/t2 no se alteran. Los campos ambientales históricos solo describen corridas antiguas y no son entradas del escenario nuevo.

Una respuesta `201 Created` publica una corrida persistente con identificador, `position`, `clear_sky`, `raster`, `preview` y `layers`. `clear_sky.dni_adjusted_w_m2` es la DNI de entrada modelada en W/m², después del factor de intensidad; `analysis_summary.statistics.{min,max,mean}` se calcula sobre los píxeles válidos del GeoTIFF. Cuando la DNI es positiva, la razón media/DNI es adimensional y no puede exceder 1 bajo el modelo de proyección; con DNI cero no se define esa división. El manifiesto conserva ROI, parámetros efectivos, métodos y procedencia. La leyenda Inferno está ligada a `preview.range_w_m2` y se representa en W/m². Un color del PNG no es una medida numérica exacta; consultar TIFF o `/sample`.

## Consultas y exportación

| Método/ruta | Significado |
|---|---|
| `GET /api/solar/simulations/{id}` | Metadatos de la corrida, enlaces y supuestos |
| `GET /api/solar/simulations/{id}/preview/incident` | PNG RGBA Inferno, NoData transparente, remuestreo visual |
| `GET /api/solar/simulations/{id}/export/incident` | GeoTIFF Float32 nativo con CRS, afín y NoData |
| `GET /api/solar/simulations/{id}/sample?lon=...&lat=...` | Valor del píxel TIFF en W/m² o `outside_coverage` / `nodata` |
| `GET /api/solar/simulations/{id}/analysis` | Estadísticas e histograma desde TIFF, sin extrapolar NoData |
| `GET /api/solar/simulations/{id}/contours` | Isolíneas GeoJSON WGS84 de igual irradiancia en W/m² |

La ruta de isolíneas figura en `layers.incident.contours_url`. Las entidades llevan `properties.value_w_m2` y `units: W/m2`. Opcionalmente `?levels=...` pide entre 1 y 20 niveles explícitos dentro del rango del ráster. El servidor limita niveles × píxeles, vértices, tamaño GeoJSON y consultas simultáneas; puede devolver 413 ante una salida demasiado compleja y 429 si los cupos están ocupados. Las líneas no son vectores de flujo térmico ni prueba de precisión espacial subpíxel. El GeoTIFF es la fuente numérica de verdad; la consulta de píxel y las estadísticas no reconstruyen valores desde el PNG. Las series temporales, radiación difusa y mapas de temperatura no existen en este contrato. Las simulaciones históricas mantienen sus manifiestos y se leen sin migración destructiva; sus metadatos temporales describen exclusivamente aquellas corridas. **Limitación actual del cliente:** las corridas nuevas usan IDs de 32 dígitos hexadecimales, pero la rehidratación de copias del frontend exige UUID con guiones; tras recargar la página pierde el resultado solar guardado. No confundir el estado conservado en memoria entre copias con persistencia verificada tras recarga.

## Límites y seguridad

La API es sincrónica y usa almacenamiento local y bloqueo entre procesos; otro cálculo concurrente puede recibir 429. Los identificadores opacos son capacidades públicas, no autorización; no publicar corridas sensibles ni secretos Earthdata. Un TIFF nuevo se coteja contra la huella del manifiesto antes de servirlo; los históricos sin huella pueden ser legibles sin garantía equivalente. No existe validación radiométrica ni autenticidad criptográfica general del origen NASADEM. No enviar rutas del servidor en la petición. No hacer reintentos ciegos de POST tras un fallo ambiguo.

## Verificación

En entorno `nisar`, desde la raíz:

```bash
PYTHONPATH="$PWD/data/solar-pvlib-deps:$PWD/backend:$PWD" /home/juliox/miniforge3/envs/nisar/bin/python -m pytest -q pipeline/tests/test_solar_api.py pipeline/tests/test_solar_surface.py pipeline/tests/test_solar_analysis.py
cd web && node --test tests/solar*.test.mjs && npm run build
```

La ruta absoluta del intérprete es específica del entorno de desarrollo observado; usar el Python con dependencias instaladas en otra instalación. La suite solar ejecutada durante esta migración aprobó 247 pruebas y la suite web aprobó 118; el build web y ambos documentos LaTeX compilaron. Esas pruebas no cubren el ID real sin guiones ni el listener sísmico tras cambiar de dock. La validación funcional completa en navegador, descargas e interacción de isolíneas siguen pendientes; el simulador no debe declararse terminado. La interfaz visual y la descarga Earthdata real requieren comprobación separada; no se atribuyen a las pruebas sintéticas.
