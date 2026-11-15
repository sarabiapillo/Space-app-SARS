# Metodología

> **Borrador.** Se documenta conforme se ejecuta el pipeline (AGENTS.md §6). Dueño: P3.
> Todo lo que aquí aparece como "verificado" se comprobó con el comando indicado y la fecha
> anotada; lo que aún no se ha comprobado se marca como **pendiente**.

## Región de interés (ROI)

Chiapas, México. Polígono en EPSG:4326 (`pipeline/config.yaml → roi`):

```
POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))
```

## Escenas utilizadas

Fuente: catálogo de ASF consultado con `python -m pipeline.catalog` el 2026-11-14
(`data/catalog/catalog_asf_GCOV_20261114T231456Z.json`). Recortes obtenidos con
`python -m pipeline.download` (lectura remota por ventanas; solo se transfieren los bloques de la ROI).

**Par de trabajo (Fase 1):**

| | t1 | t2 |
|---|---|---|
| Producto | NISAR L2 GCOV | NISAR L2 GCOV |
| Fecha | 2026-06-18 | 2026-10-16 |
| Trayectoria / marco / dirección | 62 / 10 / ASCENDING | 62 / 10 / ASCENDING |
| Polarizaciones (Frequency A, leídas del .h5) | HH, HV | HH, HV |
| CRID / madurez | P05023 / PROVISIONAL | P05023 / PROVISIONAL |
| Píxeles válidos en el polígono ROI (capa `mask`) | 99.57 % | 99.61 % |
| Escena | `NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001` | `NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001` |

Cada recorte está en `data/raw/<scene_id>/` con su `scene.json` (procedencia, URL, ventana, malla, cobertura).

**Por qué T62 y no T55.** La pila T55/F80 DESCENDING P05023 tiene las mismas fechas, pero su marco
solo cubre la mitad este de la ROI: 50.3 % de píxeles válidos (32.6 % fuera de la adquisición,
17.1 % no válidos), con datos solo al este de lon ≈ −93.14. Se conserva en `data/raw/` como respaldo.
La pila T156/F80 no se ha recortado (cobertura **pendiente**).

**Escena sin pareja.** GCOV T62/F10 2026-10-28 (P05036, VALIDATED) se inspeccionó en la Etapa 1
(`data/explore/`), pero es la única fecha de su pila: el CRID cambió de P05023 a P05036 el 2026-10-23
y no se mezclan versiones de procesamiento.

## Comparabilidad

Verificada para el par de trabajo con `compat.check_pair` (catálogo) y `sources/subset.compare_grids` (.h5):

- Mismo producto, trayectoria, marco, dirección, polarizaciones, CRID y madurez.
- Misma malla en ambas fechas: EPSG:32615 (UTM 15N), 10 × 10 m, recorte de 2687 × 5504 px con
  idéntica transformación geográfica. No se requiere remuestreo.
- La identidad de cada archivo (granuleId, CRID, trayectoria, marco, dirección) se contrastó con el catálogo al recortar.

## Preprocesamiento y máscaras

**Pendiente** (`preprocess.py`, `masks.py`, P2). Datos de partida y advertencias que declara el producto:

- Las capas `HHHH` y `HVHV` son potencia lineal γ⁰ (convención leída del .h5). σ⁰ = γ⁰ · `rtcGammaToSigmaFactor`.
- `noiseCorrectionApplied = False`: valores bajos, sobre todo en HV, pueden estar cerca del piso de ruido.
- `shadowMaskingApplied = False`: la máscara de sombra/layover se debe aplicar aparte.
- Capas de potencia guardadas con mantisa de 16 bits (~5 cifras significativas).
- Los recortes se entregan sin dB, sin máscara y sin multilook; es el rectángulo que contiene la ROI.

## Métrica de cambio

**Pendiente** (`change.py`, P2). Prevista: Δσ⁰_dB = σ⁰_dB,t2 − σ⁰_dB,t1, razón y z-score respecto a la pila.
Un cambio en la retrodispersión describe un cambio en la respuesta radar; no identifica por sí solo su causa.

## Validación

**Pendiente: depende del fenómeno, que aún no se decide.** Fuentes auxiliares candidatas encontradas
en NASA Earthdata (CMR) para la ROI entre 2026-06-01 y 2026-10-31. Consulta del 2026-11-14,
**solo búsqueda en el catálogo**: aún no se ha descargado ni inspeccionado su contenido sobre la ROI.

| Producto (short name) | Qué es | Resolución | Archivo (DAAC) | Disponibilidad sobre la ROI |
|---|---|---|---|---|
| `GPM_3IMERGDL` v07 | Precipitación diaria GPM IMERG (Late) | 0.1° (~11 km), 1 día | GES DISC | 153 días (01-jun → 31-oct) |
| `GPM_3IMERGDF` v07 | Precipitación diaria GPM IMERG (Final) | 0.1°, 1 día | GES DISC | 0: aún no publicada para 2026 |
| `HLSS30` v2.0 | Reflectancia de superficie Sentinel-2 armonizada | 30 m | LP DAAC | 64 fechas; 9 con nubes ≤ 20 % en el tile: 06-20, 06-30, 07-20, 08-01, 08-14, 08-17, 08-29, 09-30, 10-01 |
| `HLSL30` v2.0 | Reflectancia de superficie Landsat armonizada | 30 m | LP DAAC | 18 fechas; 6 con nubes ≤ 20 % en el tile: 06-21, 07-23, 08-08, 08-16, 09-01, 10-27 |
| `OPERA_L3_DSWX-HLS_V1` | Extensión de agua superficial (óptico) | 30 m | PO.DAAC | 80 fechas |
| `OPERA_L3_DSWX-S1_V1` | Extensión de agua superficial (Sentinel-1, banda C) | 30 m | PO.DAAC | 65 fechas |
| `OPERA_L3_DIST-ALERT-HLS_V1` | Alertas de perturbación de la vegetación (óptico) | 30 m | LP DAAC | 74 fechas |
| `OPERA_L3_DIST-ALERT-S1_V1` | Alertas de perturbación (Sentinel-1) | 30 m | — | 0 |

Notas:

- El porcentaje de nubes de HLS es del tile completo, no de la ROI: comprobarlo sobre la ROI antes de usar una fecha.
- Fechas ópticas cercanas al par: 2026-06-20 / 06-21 (t1 = 06-18) y 2026-10-01 / 10-27 (t2 = 10-16).
- IMERG (~11 km) sirve como **contexto** temporal (lluvia entre fechas y antes de cada adquisición), no como validación píxel a píxel.

**Fuente auxiliar sugerida según el fenómeno** (decisión de P3):

| Fenómeno | Referencia | Contexto |
|---|---|---|
| Inundación / humedales | OPERA DSWx (HLS y/o S1) | GPM IMERG |
| Vegetación / perturbación | OPERA DIST-ALERT-HLS, HLS (índices de vegetación) | GPM IMERG |
| Deformación | Ninguna de las anteriores | — |

**Precaución.** OPERA es otro producto derivado de satélite, con su propio error; no son etiquetas de campo.
Precisión, recall, F1 e IoU calculados contra OPERA miden el **acuerdo con OPERA**, no la exactitud real,
y así deben reportarse. Sin una referencia adecuada, el resultado se marca como **exploratorio**.

### Sensores evaluados y descartados (por ahora)

Recursos de agencias socias incluidos en la lista del reto:

| Sensor | Banda | Decisión | Motivo |
|---|---|---|---|
| RADARSAT-1 (CSA) | C | Descartado | Operó de 1995 a 2013: sin datos para 2026 |
| RCM (CSA) | C | Descartado por ahora | Otra banda y otra calibración: no comparable con NISAR; condiciones de acceso por verificar |
| SAOCOM (CONAE) | L | Posible contraste en la Fase 2 | Misma banda, pero otro sensor: nunca se mezcla en un Δσ⁰ con NISAR; cobertura de la ROI y fechas **pendientes** de consultar (requiere registro) |

Un segundo radar no confirma la causa física de un cambio de retrodispersión; la validación requiere datos
de otra naturaleza (AGENTS.md §6).

## Limitaciones

- Productos L-band PROVISIONAL: calibrados y parcialmente validados, no completamente validados.
- Sin corrección de ruido ni máscara de sombra/layover en el producto (ver Preprocesamiento).
- Un solo par y una sola geometría (ascendente); la pila tiene 10 fechas disponibles para una línea base.
- Fenómeno aún no decidido: hasta entonces, cualquier mapa de cambio es exploratorio.
