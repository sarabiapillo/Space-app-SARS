# P1 — Datos y adquisición

Documentación del trabajo de P1 al cierre de la Fase 1 (2026-11-14). Reglas del proyecto en
[AGENTS.md](../AGENTS.md); plan y roles en [plan-de-trabajo.md](plan-de-trabajo.md); resultados
científicos y fuentes de validación en [metodologia.md](metodologia.md).

## 1. Responsabilidad

Conseguir recortes NISAR reales de la ROI con sus metadatos, y garantizar que:

- cada recorte se puede rastrear hasta la escena, la URL y la versión del código que lo produjeron;
- el archivo descargado es la escena que dice el catálogo;
- las dos fechas de un par son comparables y comparten la misma malla;
- se conoce qué parte de la ROI cubre cada escena.

P1 **no** convierte a dB, no aplica máscaras ni calcula cambios: eso es de P2. Los recortes son un espejo fiel del producto.

## 2. Estado

| Criterio de la Fase 1 | Estado |
|---|---|
| `fetch_subset` funcionando con `.netrc`, solo Frequency A | ✅ Probado en remoto y en local |
| Dos recortes que cumplen el contrato C1 en `data/raw/` | ✅ Par T62/F10 |
| Misma malla confirmada | ✅ |
| Cobertura de la ROI medida | ✅ 99.57 % y 99.61 % |
| Par anotado en `config.yaml` | ✅ |
| Pruebas | ✅ 44 casos pasan con `pytest` (ver §9) |
| Mínimo de cobertura aceptable | ⏳ Lo fija P3 |

## 3. Archivos de P1

| Archivo | Qué hace |
|---|---|
| `pipeline/config.yaml` | ROI, fuente, producto, criterios de comparabilidad y par de trabajo (`pair`) |
| `pipeline/sources/base.py` | Contrato de una fuente: `DataSource` (`search`, `fetch_subset`, `fetch_subsets`) y `SceneMeta` |
| `pipeline/sources/asf.py` | Fuente ASF: búsqueda con `asf_search`, inicio de sesión en Earthdata y apertura remota o local del `.h5` |
| `pipeline/sources/subset.py` | Recorte independiente de la fuente: identidad, ventana, GeoTIFF, cobertura y `scene.json` |
| `pipeline/sources/__init__.py` | `get_source(name)`: elige la fuente según `source:` en `config.yaml` |
| `pipeline/catalog.py` | CLI: consulta la fuente, agrupa en pilas y guarda el catálogo en JSON |
| `pipeline/download.py` | CLI: recorta escenas del catálogo y compara el par |
| `pipeline/nisar_h5.py` | Lectura por ventanas de los `.h5` NISAR (malla, ventana de la ROI, lectura por franjas, dB, multilook) |
| `pipeline/etapa1.py`, `etapa1_figuras.py` | CLI de inspección de una escena local (figuras y valores de control) |
| `pipeline/tests/test_sources.py`, `test_nisar_h5.py`, `test_subset.py` | Pruebas con datos sintéticos |

`pipeline/compat.py` (comparabilidad) lo usa P1, pero es de P3.

## 4. Requisitos

1. Entorno `nisar` (ver [README](../README.md) §3).
2. Cuenta NASA Earthdata con sus credenciales en **una** de estas formas (README §7):
   - `EARTHDATA_USERNAME` y `EARTHDATA_PASSWORD` en el `.env` de la raíz del repo o como variables de entorno. **Tienen prioridad** y son la opción para el servidor; las variables del sistema no se sobrescriben con el archivo.
   - `%USERPROFILE%\.netrc` con `machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CONTRASEÑA`. En Windows, `earthaccess` busca `_netrc`; el pipeline usa `.netrc` si `_netrc` no existe.
3. Haber iniciado sesión una vez en ASF Vertex y aceptado sus términos.

Los comandos se ejecutan **desde la raíz del repo** y con `python -m`:

```
conda activate nisar
cd C:\terrapulse
```

### Obtener los datos después de clonar

`data/` no está en git, así que un repo recién clonado no tiene recortes. Los datos se generan desde el servidor de ASF:

```
conda activate nisar
cd C:\terrapulse
python -m pipeline.catalog
python -m pipeline.download NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001 NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001
```

- `pipeline.catalog` va **primero**: `download` busca las escenas en `data/catalog/`. Sin catálogo falla con "No hay catálogos".
- `pipeline.download` lee el `.h5` **directamente del servidor** y baja solo los bloques de la ROI (~230 MB por escena). **No hace falta descargar el `.h5` completo** (~7 GB).
- Resultado: `data/raw/<scene_id>/` con 5 `.tif` y `scene.json` por escena. Tarda ~3–4 minutos y debe terminar con `COMPARABLE`. Los `scene_id` del par también están en `config.yaml → pair`.
- Los valores de los píxeles, la malla y la cobertura salen idénticos para todo el equipo. En `scene.json` solo cambian la fecha de creación y, si se trabaja en otro commit, el `code_version`.
- Para que `code_version` no termine en `-dirty`, ejecutarlo con el árbol de git limpio (`git status --short` sin salida).
- Si ASF reprocesa una escena, su `scene_id` cambia y el comando no la encontrará: revisar el catálogo nuevo y no mezclar versiones (CRID).

El `.h5` completo solo hace falta para `pipeline.etapa1` (inspección opcional, §5.3) o para trabajar sin internet con `--h5-local`. También se puede compartir la carpeta `data/raw/` (~460 MB) por fuera de git; cada `scene.json` conserva su procedencia.

## 5. Flujo

```
config.yaml ──► pipeline.catalog ──► data/catalog/*.json
                                          │
                                          ▼
                  .h5 (ASF, ~7 GB) ──► pipeline.download ──► data/raw/<scene_id>/  ──► P2
                                          │                    (5 .tif + scene.json)
                                          └─► comparación del par (COMPARABLE / NO COMPARABLE)

.h5 local ──► pipeline.etapa1 ──► data/explore/<granuleId>/   (opcional, inspección)
```

Diagrama detallado: artefacto "Flujo de datos P1" (privado, compartido desde la página).

### 5.1 Catálogo: `python -m pipeline.catalog`

No requiere `.netrc`. Tarda menos de un minuto.

1. Lee `roi.wkt` y `search.product` de `config.yaml`. `search.start`/`end` quedan en `null` a propósito para ver todas las pilas.
2. Busca escenas NISAR del producto que intersectan la ROI.
3. Repite la búsqueda filtrando por cada madurez (BETA, PROVISIONAL, VALIDATED), porque `asf_search` no la devuelve como propiedad. Una escena que no aparece en ningún filtro queda con madurez `None` y **no será comparable**.
4. Convierte cada resultado en `SceneMeta` sin rellenar campos que falten.
5. Agrupa en pilas por (producto, trayectoria, marco, dirección, polarizaciones, CRID, madurez).
6. Imprime las pilas (`CANDIDATA` si tienen 2 o más fechas) y guarda `data/catalog/catalog_<fuente>_<producto>_<UTC>.json` con la consulta, la versión del código y todas las escenas.

### 5.2 Recorte: `python -m pipeline.download`

```
python -m pipeline.download <scene_id> [<scene_id> ...] [opciones]
```

| Opción | Uso |
|---|---|
| `--capas HHHH HVHV mask ...` | Capas a recortar. Por defecto: `HHHH HVHV mask numberOfLooks rtcGammaToSigmaFactor` |
| `--h5-local "ruta.h5"` | Usar un `.h5` ya descargado (solo una escena) |
| `--catalogo ruta.json` | Usar un catálogo concreto; por defecto, el más reciente de `data/catalog/` |
| `--config ruta.yaml` | Otra configuración |

Por cada escena:

1. **Busca la escena** en el catálogo. Si no está, se detiene: cada recorte queda ligado a una consulta guardada.
2. **Abre el `.h5`.** En remoto: carga `.env`, inicia sesión en Earthdata (`EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` si están, y si no `.netrc`) y lo abre con `h5py` sobre HTTPS (`fsspec`, bloques de 8 MiB con caché). En local: lo abre del disco.
3. **Verifica la identidad.** `granuleId`, `compositeReleaseId`, `trackNumber`, `frameNumber` y `orbitPassDirection` del archivo deben coincidir con el catálogo. Si no coinciden, se detiene.
4. **Lee la malla** de `science/LSAR/GCOV/grids/frequencyA`: EPSG, coordenadas, espaciado, polarizaciones, capas de potencia (términos diagonales de la covarianza) y su magnitud (`gamma0`, leída del archivo).
5. **Calcula la ventana**: densifica la ROI, la transforma al CRS de la malla y toma el rectángulo de filas y columnas que la contiene.
6. **Lee cada capa** solo en esa ventana, por franjas alineadas a los chunks del HDF5. En remoto, solo se transfieren esos bloques (~230 MB por escena en lugar de ~7 GB).
7. **Escribe un GeoTIFF por capa**: CRS de la escena, la transformación de la ventana, LZW, teselas de 512. Primero escribe `.tif.part` y luego lo renombra, así un corte no deja archivos a medias.
8. **Mide la cobertura** con la capa `mask` dentro del **polígono** de la ROI (no del rectángulo).
9. **Escribe o actualiza `scene.json`.** Si ya existía con otra malla o ventana (por ejemplo, porque cambió la ROI), se detiene.

Con dos escenas o más, al final compara cada una contra la primera:

- `compat.check_pair` (catálogo): producto, trayectoria, marco, dirección, polarizaciones, CRID y madurez iguales y conocidos.
- `subset.compare_grids` (`.h5`): frecuencia, EPSG, espaciado, forma y transformación del recorte idénticos.

Imprime `COMPARABLE` (código de salida 0) o `NO COMPARABLE` con los motivos (código 2).

Volver a ejecutar sobre la misma escena reescribe las capas y actualiza `scene.json` sin duplicar nada.

### 5.3 Inspección: `python -m pipeline.etapa1`

```
python -m pipeline.etapa1 "H5 FILES\archivo.h5" [--sin-vista] [--sin-figuras]
```

Solo con archivos locales. Escribe en `data/explore/<granuleId>/`: `metadatos.json`, `LEEME_validacion.txt` (comprobaciones a mano con sus valores), `geotiff/` (γ⁰, σ⁰, dB con multilook 2×2, máscara, factor, looks), `figuras/` y `control/` (píxeles y bloques elegidos con semilla fija). `--sin-vista` omite la vista general, que obliga a leer la escena completa.

## 6. Contrato C1 (lo que recibe P2)

```
data/raw/<scene_id>/
├── HHHH.tif                  γ⁰ HH, potencia lineal, float32, nodata NaN
├── HVHV.tif                  γ⁰ HV, potencia lineal, float32, nodata NaN
├── mask.tif                  uint8 sin nodata: 0 = no válido, 255 = fuera de la adquisición, otro = subfranja válida
├── numberOfLooks.tif         float32, nodata NaN
├── rtcGammaToSigmaFactor.tif float32, nodata NaN   (σ⁰ = γ⁰ · factor)
└── scene.json
```

Todas las capas comparten CRS, transformación y forma. Los valores son los del producto: **sin dB, sin máscara aplicada y sin multilook**, en el rectángulo que contiene la ROI (el polígono se aplica en el procesamiento).

### Campos de `scene.json`

| Campo | Contenido |
|---|---|
| `contrato` | `"C1"` |
| `scene` | `SceneMeta` del catálogo: `scene_id`, `product`, `track`, `frame`, `direction`, `polarizations`, `crid`, `maturity`, `start_time`, `frame_coverage`, `orbit_type`, `product_version`, `url`, `size_bytes`, `extra` |
| `identificacion_h5` | Lo que dice el propio archivo: `granuleId`, `compositeReleaseId`, `trackNumber`, `frameNumber`, `orbitPassDirection`, `absoluteOrbitNumber`, `zeroDopplerStartTime`/`EndTime`, `productVersion`, `isFullFrame`, `listOfFrequencies` |
| `roi` | `wkt` y `crs` usados para el recorte |
| `malla` | `frecuencia`, `epsg`, `dx_m`, `dy_m`, `forma_malla_completa`, `magnitud_potencia`, `polarizaciones`, `capas_potencia`, `ventana` (`fila0`, `fila1`, `col0`, `col1`), `forma_recorte`, `transform_recorte` (6 coeficientes afines), `roi_se_sale_de_la_escena` |
| `capas` | Por capa: `archivo`, `descripcion`, `dtype`, `nodata`, `unidades` (del atributo del `.h5`), `creado_utc` |
| `cobertura_roi` | `pixeles_en_poligono`, `pct_valido`, `pct_no_valido`, `pct_fuera_adquisicion`, `nota` |
| `procedencia` | `fuente`, `metodo`, y `url` + `block_size_bytes` (remoto) o `ruta_local` + `url_catalogo` (local) |
| `code_version` | Commit corto de git (`-dirty` si había cambios sin commit) |
| `actualizado_utc` | Última escritura |
| `advertencias` | Recordatorios para quien consuma el recorte |

**Cambio respecto al plan original:** C1 pedía "el comando GDAL usado". Se reemplazó por `procedencia`, porque el recorte se hace con `h5py`: el GDAL del entorno (3.12) no trae los drivers HDF5 ni NISAR.

## 7. Resultados

Catálogo del 2026-11-14 (`data/catalog/catalog_asf_GCOV_20261114T231456Z.json`): 39 escenas GCOV sobre la ROI.

**Par de trabajo:** GCOV T62/F10 ASCENDING, HH+HV, P05023, PROVISIONAL.

| | t1 | t2 |
|---|---|---|
| Fecha | 2026-06-18 | 2026-10-16 |
| `scene_id` | `NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001` | `NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001` |
| Píxeles válidos en el polígono ROI | 99.57 % | 99.61 % |
| Comparabilidad | COMPARABLE | |

- Malla: EPSG:32615 (UTM 15N), 10 × 10 m; malla completa de 33480 × 34128 px; recorte de 2687 × 5504 px, idéntico en ambas fechas.
- Tamaño en disco: ~230 MB por escena (5 capas). Tiempo: ~3 minutos por par.

**Otras escenas recortadas:**

| Escenas | Cobertura de la ROI | Uso |
|---|---|---|
| T55/F80 DESC, P05023, 2026-06-18 y 2026-10-16 | ~50 % (32.6 % fuera de la adquisición, 17 % no válido; datos solo al este de lon ≈ −93.14) | Respaldo. Es COMPARABLE, pero cubre la mitad |
| T62/F10 ASC, P05036, 2026-10-28 | 99.6 % | Sin pareja: única fecha P05036 de su pila |

**Verificación con datos reales.** El recorte de la escena del 2026-10-28 desde su `.h5` local se comparó contra la salida independiente de `etapa1.py`: misma transformación, misma forma y valores idénticos en los 14 699 442 píxeles válidos.

## 8. Decisiones tomadas

| Decisión | Motivo |
|---|---|
| Recortar con `h5py` en lugar de `gdalwarp` | El GDAL 3.12 de conda-forge no trae los drivers HDF5 ni NISAR. `h5py` ya estaba en el entorno: no se agregaron dependencias |
| Leer el `.h5` remoto por ventanas | Evita descargar ~7 GB por escena (AGENTS.md §5) |
| Par T62 en lugar de T55 | T55 solo cubre ~50 % de la ROI |
| No aplicar dB, máscara ni multilook en el recorte | Separar adquisición (P1) de procesamiento (P2); el recorte se puede comparar contra el producto valor por valor |
| Verificar la identidad del archivo contra el catálogo | Un recorte con la identidad equivocada rompe la trazabilidad (AGENTS.md §2.3) |
| Medir la cobertura sobre el polígono | El rectángulo incluye zonas fuera de la ROI |
| No crear `sources/event.py` | Los recursos del reto para NISAR son ASF/Earthdata, los mismos que ya usa `ASFSource` |
| `search.start`/`end` en `null` | Que el catálogo siga mostrando todas las pilas (por ejemplo, fechas P05036 nuevas) |

## 9. Pruebas

```
pytest
```

Todas usan HDF5 **sintéticos** y no necesitan red. Las de P1 son 28 casos (de 44 en total):

| Archivo | Funciones de prueba | Qué cubre |
|---|---|---|
| `test_sources.py` | 4 | Normalización de resultados de ASF a `SceneMeta` |
| `test_nisar_h5.py` | 17 | Malla, ventana de la ROI, lectura por franjas, potencia, dB, multilook, estadísticas |
| `test_subset.py` | 7 | El recorte copia valores exactos y la georreferencia; cobertura sobre el polígono; rechazo por identidad y por capa inexistente; acumulación de capas en `scene.json`; detección de mallas desplazadas; ruta local de `ASFSource` |

## 10. Problemas frecuentes

| Error | Solución |
|---|---|
| `No se pudo iniciar sesión en Earthdata` | Revisa `%USERPROFILE%\.netrc` y las credenciales; el mensaje incluye el motivo de Earthdata |
| `No están en catalog_...json` | Corre `python -m pipeline.catalog` o revisa que el `scene_id` esté completo |
| `El archivo no coincide con la escena del catálogo` | El `.h5` no es la escena pedida (revisa el ID o `--h5-local`) |
| `ya tiene otra malla/ventana` | Cambió la ROI: borra `data/raw/<scene_id>/` y vuelve a recortar |
| `Capas no disponibles en el archivo` | Esa escena no tiene la capa (por ejemplo, una escena solo HV); revisa `--capas` |
| `ModuleNotFoundError: pipeline` | Ejecuta desde `C:\terrapulse` con `python -m pipeline.<script>` |
| `UnicodeEncodeError` en la consola de Windows | Define `set PYTHONIOENCODING=utf-8` antes de ejecutar |

## 11. Limitaciones y pendientes

- **`code_version` de los recortes:** el par T62 se regeneró el 2026-11-15 con el árbol limpio y registra `19de237`. Los recortes de respaldo (T55) y la escena P05036 conservan versiones anteriores con `-dirty`; regenerarlos si se van a usar.
- **Mínimo de cobertura:** lo fija P3.
- **Línea base para el z-score (Fase 2):** recortar más fechas de la pila T62 P05023 con `pipeline.download <scene_id>` (~1.5 min por fecha), cuando P2 diga cuántas necesita.
- **Pila T156/F80:** su cobertura de la ROI no se ha verificado.
- **Antes del evento:** volver a correr `pipeline.catalog` por si aparecen fechas nuevas (por ejemplo, T62 P05036 para emparejar la escena del 2026-10-28).
- **Advertencias del producto** que P2 debe atender: sin corrección de ruido (`noiseCorrectionApplied = False`), sin máscara de sombra/layover (`shadowMaskingApplied = False`), potencias con mantisa de 16 bits (~5 cifras significativas). Productos PROVISIONAL: calibrados y parcialmente validados, no completamente validados.
- `etapa1.py` solo trabaja con archivos locales.
