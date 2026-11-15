# P1 — Inspección de escenas (Etapa 1) en remoto y capas para la web

> Responsable: P1. Código: `pipeline/etapa1.py`, `pipeline/web_export.py`, `pipeline/etapa1_figuras.py`.
> Pruebas: `pipeline/tests/test_etapa1.py`. Documento general de P1: [p1-datos.md](p1-datos.md).

## 1. Qué resuelve

Antes, `pipeline.etapa1` necesitaba el `.h5` **completo** en disco (~7 GB por escena). Por eso solo había figuras de inspección de la escena 2026-10-28, y no del par de trabajo T62.

Ahora `etapa1` acepta también un **`scene_id` del catálogo**. En ese caso abre el `.h5` en el servidor de ASF por HTTPS, igual que `pipeline.download`, y solo baja los bloques (*chunks*) de la ROI y los metadatos.

Además genera una carpeta `web/` con lo que necesita la interfaz web para mostrar la escena en el mapa:

- un COG por capa (para TiTiler);
- un PNG ya proyectado a Web Mercator (para la fuente `image` de MapLibre);
- un manifiesto `capas.json` con las esquinas, la escala de color y la procedencia.

## 2. Uso

Desde la raíz del repo, con el entorno `nisar` y las credenciales de Earthdata en `.env` o `.netrc` (README §7):

```
conda activate nisar
cd C:\terrapulse
python -m pipeline.catalog                       # solo si no hay catálogo en data/catalog/
python -m pipeline.etapa1 <scene_id>             # remoto: lee solo la ROI
python -m pipeline.etapa1 "H5 FILES\archivo.h5"  # local: igual que antes
```

**Par de trabajo T62**, con la misma escala web en las dos fechas (necesario para el deslizador antes/después, ver §5):

```
python -m pipeline.etapa1 NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001 --escala-web -22 0
python -m pipeline.etapa1 NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001 --escala-web -22 0
```

Cómo decide el modo: si el argumento es un archivo existente o termina en `.h5`, es **local**. Si no, se busca como `scene_id` en el catálogo más reciente (o en `--catalogo`) y se abre en **remoto**.

### Opciones

| Opción | Qué hace |
|---|---|
| `--catalogo RUTA` | Catálogo donde buscar el `scene_id` (default: el más reciente de `data/catalog/`) |
| `--escala-web VMIN VMAX` | Escala fija en dB para los PNG web. Usar **la misma** en todas las fechas que se vayan a comparar |
| `--sin-web` | No genera la carpeta `web/` |
| `--sin-vista` | Omite la figura A (vista general) |
| `--vista-remota` | En remoto, genera la figura A de todos modos (ver §6) |
| `--sin-figuras` | Solo datos: GeoTIFF, CSV, JSON y `web/` (sin matplotlib) |
| `--multilook N` | Multilook N×N (default 2 en GCOV) |
| `--salida RUTA` | Carpeta de salida (default `data/explore/`) |

## 3. Qué pasa en remoto

1. Busca el `scene_id` en el catálogo y toma su URL.
2. Inicia sesión en Earthdata con `earthdata_https_fs()` (`.env` primero, luego `.netrc`), la misma función que usa `download`.
3. Abre el `.h5` con `h5py` sobre un archivo HTTPS de `fsspec` (peticiones de 8 MiB con caché de bloques).
4. **Verifica la identidad**: `granuleId`, CRID, trayectoria, marco y dirección del archivo deben coincidir con el catálogo. Si no coinciden, se detiene (`check_identity`, la misma de `download`).
5. Sigue exactamente el mismo código que en local: ventana de la ROI, máscara, γ⁰ y σ⁰, multilook, estadísticas, píxeles de control, incidencia y figuras.
6. Omite la vista general (figura A), salvo con `--vista-remota`.

Como el código posterior a la apertura es el mismo, los valores son idénticos a los del modo local. La prueba `test_remote_run_by_scene_id` lo comprueba.

## 4. Salidas

```
data/explore/<granuleId>/
├── metadatos.json        + "procedencia" (local/remoto, URL, catálogo, identidad verificada) y "web"
├── LEEME_validacion.txt
├── geotiff/              igual que antes (lineal y dB, máscara, factor, looks)
├── figuras/              B, B2, C, D, E (y A en local)
├── control/
└── web/                  NUEVO: para la interfaz web
    ├── capas.json                          manifiesto (§4.1)
    ├── gamma0_HHHH_ml2_dB.tif / .png       γ⁰ HH en dB, multilook 2×2 (píxel de 20 m)
    ├── gamma0_HVHV_ml2_dB.tif / .png
    ├── sigma0_HHHH_ml2_dB.tif / .png       σ⁰ = γ⁰ · rtcGammaToSigmaFactor
    └── sigma0_HVHV_ml2_dB.tif / .png
```

| Archivo | Formato | Para qué |
|---|---|---|
| `*.tif` | **COG** float32, dB, NaN = sin dato, UTM (EPSG del producto), DEFLATE, bloques de 512, vistas reducidas por vecino más cercano | Lo sirve TiTiler (contrato C5). Es la fuente de **valores**: consultas de píxel, histogramas |
| `*.png` | RGBA 8 bits, **EPSG:3857**, gris lineal entre `vmin_dB` y `vmax_dB`, alfa 0 donde no hay dato | Fuente `image` de MapLibre con `esquinas_lonlat`. **Solo para ver** |
| `capas.json` | JSON | Dice qué capas hay, dónde están, sus esquinas, su escala y de qué escena salen |

El COG contiene exactamente los mismos valores que `geotiff/<magnitud>_<capa>_ml2_dB.tif` (la prueba `test_local_run_writes_web_layers` lo verifica).

¿Por qué el PNG en EPSG:3857? MapLibre dibuja una fuente `image` estirándola entre cuatro esquinas en Web Mercator. Si la imagen ya está en Web Mercator y orientada al norte, cada píxel cae donde debe. Una imagen en UTM quedaría ligeramente girada y desplazada.

### 4.1 Manifiesto `web/capas.json` (versión `explore-web-1`)

```jsonc
{
  "version": "explore-web-1",
  "tipo": "inspeccion_una_fecha",
  "creado_utc": "…",
  "version_codigo": "…",                    // commit de git
  "escena": {
    "granuleId": "NISAR_L2_PR_GCOV_…",
    "producto": "GCOV",
    "fecha_inicio": "2026-06-18T11:40:10…",  // zeroDopplerStartTime del .h5
    "trayectoria": 62, "marco": 10, "direccion": "Ascending",
    "crid": "P05023",
    "madurez_catalogo": "PROVISIONAL",      // null en modo local (el .h5 no la trae)
    "frecuencia": "A",
    "polarizaciones": ["HH", "HV"]
  },
  "roi_wkt_4326": "POLYGON((…))",
  "procedencia": { "modo": "remoto", "url": "https://…", "catalogo": "catalog_….json", "identidad_verificada_contra_catalogo": true, … },
  "capas": [
    {
      "id": "gamma0_HHHH_ml2_dB",
      "capa": "HHHH", "magnitud": "gamma0", "simbolo": "γ⁰",
      "multilook": 2, "pixel_m": 20,
      "unidades": "dB",
      "cog": "data/explore/<granuleId>/web/gamma0_HHHH_ml2_dB.tif",
      "png": "data/explore/<granuleId>/web/gamma0_HHHH_ml2_dB.png",
      "crs_cog": "EPSG:32615", "crs_png": "EPSG:3857",
      "forma_cog": [filas, columnas], "forma_png": [filas, columnas],
      "esquinas_lonlat": [[lon, lat], [lon, lat], [lon, lat], [lon, lat]],  // sup-izq, sup-der, inf-der, inf-izq
      "escala": { "vmin_dB": -22, "vmax_dB": 0, "colormap": "gray", "metodo": "fija (--escala-web)" },
      "rango_datos_dB": [min, max],
      "pct_pixeles_validos": 0
    }
  ],
  "figuras": ["data/explore/<granuleId>/figuras/B_roi_gamma0_dB.png", "…"],
  "metadatos": "data/explore/<granuleId>/metadatos.json",
  "advertencias": ["Una sola fecha: …", "Los PNG son solo para ver; …", "Para comparar dos fechas …"]
}
```

Las rutas son relativas a la raíz del repo, con `/`.

## 5. Cómo la consume la interfaz web

El Explorador hoy dibuja una imagen de referencia (`/nisar_chiapas.jpg`) con cuatro esquinas aproximadas (`NISAR_FOOTPRINT` en `web/src/mocks/initialWorkspaces.ts`). Con el manifiesto se reemplaza por datos reales sin cambiar el tipo de capa.

**Opción A: imagen (funciona ya, sin servidor de teselas).** Requiere servir `data/explore/` como archivos estáticos (en desarrollo, un *proxy* de Vite o copiar la carpeta `web/` a `web/public/`; en producción, el backend o un *bucket*):

```ts
const man = await fetch(`${BASE}/data/explore/${granuleId}/web/capas.json`).then(r => r.json())
const capa = man.capas.find((c) => c.id === 'gamma0_HHHH_ml2_dB')
map.addSource('nisar', { type: 'image', url: `${BASE}/${capa.png}`, coordinates: capa.esquinas_lonlat })
map.addLayer({ id: 'nisar', type: 'raster', source: 'nisar', paint: { 'raster-opacity': 0.7 } })
// leyenda: gris de capa.escala.vmin_dB (negro) a capa.escala.vmax_dB (blanco), en dB
```

`esquinas_lonlat` ya tiene el orden que pide MapLibre, el mismo del tipo `Footprint` del frontend.

**Opción B: teselas con TiTiler (contrato C5).** Cuando P6 levante TiTiler, se usa el COG y la escala del manifiesto:

```
/cog/tiles/{z}/{x}/{y}?url=<ruta del COG>&rescale=<vmin_dB>,<vmax_dB>&colormap_name=greys_r
```

Con TiTiler también se pueden pedir valores por punto (`/cog/point/{lon},{lat}`) para un panel de "valor en dB bajo el cursor". Los valores salen del COG, no del PNG.

**Comparador (deslizador antes/después).** Las dos fechas deben dibujarse con **la misma** escala; si no, una diferencia de brillo en pantalla puede ser solo un cambio de escala. Generar ambas con el mismo `--escala-web`. La interfaz puede verificarlo comparando `escala.vmin_dB` y `escala.vmax_dB` de los dos manifiestos y avisar si no coinciden. Aun así, el deslizador es **visual**: el mapa de cambio (Δσ⁰) lo calcula P2 sobre los recortes C1 y llega por C2.

**Ficha de la escena.** El bloque `escena` del manifiesto tiene los campos del tipo `EscenaNisar` del frontend (`granuleId`, `producto`, `crid`, dirección, madurez), leídos del `.h5` y del catálogo, no escritos a mano. `procedencia` y `version_codigo` sirven para mostrar de dónde sale cada imagen (AGENTS.md §2.3). Las `advertencias` deben mostrarse junto a la capa.

**Relación con los contratos.** El manifiesto es una **propuesta de P1** para la vista de inspección; no reemplaza a C2 (resultados de cambio) ni a C4 (API). Cuando P4 defina la API, puede exponerlo tal cual (por ejemplo, `GET /api/scenes/{id}/explore`) o cargarlo en el modelo `Scene`. Si P4/P5 piden otro formato, se cambia aquí y se sube la `version`.

## 6. Tiempos y límites

- Remoto, sin vista general: ~3 min 45 s por escena (medido, §7). Salida: ~500 MB por escena (`geotiff/` ~410 MB, `web/` ~86 MB, figuras ~1 MB).
- **Vista general (figura A) en remoto:** toma 1 de cada 50 píxeles de toda la escena, pero esos píxeles caen en casi todos los bloques del archivo, así que obligaría a bajar casi toda la capa (varios GB). Por eso se omite salvo con `--vista-remota`.
- Cada ejecución remota vuelve a bajar los bloques de la ROI; no reutiliza `data/raw/` porque también necesita el cubo de incidencia y los metadatos del `.h5`.
- La escala por defecto (percentiles 2–98) es **de cada escena**: sirve para ver una fecha, no para comparar dos (usar `--escala-web`).
- Las vistas reducidas del COG usan vecino más cercano: no promedian dB. Para estadísticas, usar la resolución completa.
- En modo local, `madurez_catalogo` queda en `null`: el `.h5` no la trae y no se deduce del CRID (AGENTS.md §5).
- `data/` no va a git: cada quien genera `data/explore/` con los comandos de §2, o se comparte por fuera.

## 7. Verificación

**Pruebas** (`pytest pipeline/tests/test_etapa1.py`, con HDF5 sintéticos y sin red):

| Prueba | Qué comprueba |
|---|---|
| `test_local_run_writes_web_layers` | Se crean las 4 capas; el COG es idéntico al GeoTIFF de `geotiff/`; el PNG es RGBA con transparencia donde no hay dato; las esquinas están en el orden de MapLibre y sobre la ROI |
| `test_fixed_web_scale_is_recorded` | `--escala-web` queda en todas las capas del manifiesto |
| `test_remote_run_by_scene_id` | El `scene_id` se resuelve en el catálogo y se abre su URL con caché de bloques; la procedencia queda en `metadatos.json`; los valores son idénticos a los del modo local |
| `test_remote_identity_mismatch_stops` | Si el archivo no es la escena del catálogo, se detiene |
| `test_missing_h5_path_is_an_error` | Una ruta `.h5` inexistente da error claro (no se confunde con un `scene_id`) |

**Con datos reales (2026-11-14), escena t1 del par T62 (2026-06-18), en remoto:**

- Tiempo total: 222 s (lectura de HH y HV: ~15 s cada una; capas web: 25 s). Sin descargar el `.h5`.
- Píxeles válidos en el polígono ROI: 99.574 %, igual que `pipeline.download`.
- `geotiff/gamma0_HHHH.tif` es **idéntico** a `data/raw/<scene_id>/HHHH.tif` del recorte C1: misma transformación y mismos valores en los 14 694 370 píxeles válidos.
- PNG web: 2750 × 1352 px; esquinas de lon −93.3924 a −92.8757 y lat 16.6536 a 16.8968, que coinciden con la ROI.
- Percentiles 2–98 en dB: γ⁰ HH −13.7 a −1.0, γ⁰ HV −19.9 a −7.6, σ⁰ HH −15.3 a −2.5, σ⁰ HV −21.3 a −9.4. De ahí la escala común recomendada `--escala-web -22 0`.
- Guía para el equipo: [guia-capas-web.md](guia-capas-web.md).
