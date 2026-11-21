# Guía para generar la simulación de inundación

> **Alcance de este documento:** esta guía existe únicamente para orientar a un agente de IA en la generación e integración de una simulación de inundación dentro de TerraPulse AI. No sustituye la metodología científica del proyecto, la documentación del modelo hidráulico seleccionado ni una validación hidrológica independiente.

> **Estado verificado (2026-11-19):** el mapa de ramas y las fases de abajo describen la propuesta original. Desde entonces ya existen el adaptador DG2, la API autenticada y el panel web; la sección [Estado actual](#estado-actual-que-debe-tenerse-en-cuenta) resume qué está implementado y qué sigue pendiente.

> **Rama de referencia para esta propuesta documental:** `simulacion-inundancion` (observada en `a5d95fc`). El código productor se consulta en sus ramas; esta guía no autoriza fusionarlas, cambiar el checkout de otra persona ni iniciar una simulación.

> **Trabajo paralelo:** las ramas no deben fusionarse como parte de esta guía. El agente debe consumir los contratos y artefactos de las ramas productoras, mantener sus cambios aislados y coordinar cualquier integración mediante Pull Requests aprobados por los equipos responsables.

## Referencia principal e instrucciones obligatorias

Antes de modificar el código, leer:

- [LISFLOOD-FP — University of Bristol](https://www.bristol.ac.uk/geography/research/hydrology/models/lisflood/).
- [LISFLOOD-FP Heritage](https://www.bristol.ac.uk/geography/research/hydrology/models/lisflood/heritage/).
- [`AGENTS.md`](../AGENTS.md).
- [`docs/metodologia.md`](./metodologia.md).
- [`pipeline/config.yaml`](../pipeline/config.yaml).

La página de Bristol describe LISFLOOD-FP como un modelo hidrodinámico bidimensional para simular la propagación de inundaciones sobre topografía compleja. El modelo calcula profundidad de agua por celda y por instante, y puede representar inundaciones fluviales, costeras y estuarinas.

### Reglas que el agente debe respetar

1. **No leer, copiar ni mostrar secretos.** El archivo `.env`, `.netrc`, tokens y contraseñas están fuera del alcance de esta tarea.
2. **No inventar datos.** Si falta DEM, lluvia, caudal, condición de frontera, escena, resolución o parámetro, detenerse y reportarlo; no rellenarlo con un valor ficticio.
3. **No afirmar causalidad.** NISAR observa cambios en la respuesta radar. No demuestra por sí solo la causa física de una inundación.
4. **No mezclar productos NISAR incompatibles.** Mantener las reglas de [`pipeline/compat.py`](../pipeline/compat.py): producto, trayectoria, marco, dirección, polarización, CRID y madurez deben coincidir.
5. **No implementar primero un solver hidráulico nuevo si existe una alternativa validada.** Priorizar un adaptador reproducible para LISFLOOD-FP u otro modelo documentado.
6. **No integrar el modelo hidráulico con Django prematuramente.** La simulación debe funcionar primero desde `pipeline/`.
7. **No usar EPSG:4326 para calcular distancias de celda.** Reproyectar el dominio a un CRS métrico apropiado.
8. **No presentar una simulación sin validación como verdad observada.** Debe etiquetarse como exploratoria hasta comparar sus resultados con datos independientes.

## Mapa de ramas analizadas

Referencias locales observadas para esta revisión (instantánea, no garantía de estado futuro). La documentación DG2 se actualiza en un worktree aislado de `simulacion-inundancion`, sin fusionar ramas ni cambiar el checkout principal:

| Referencia | Commit observado | Estado relevante | Uso para esta guía |
|---|---|---|---|
| `main` | `98f7e07` | Configuración inicial del proyecto | Base histórica; no contiene frontend funcional ni simulación |
| `ETAPA-1` / `origin/ETAPA-1` | `09cd24d` | Recorte remoto/local NISAR, inspección HDF5 y capas PNG/COG de observación | Fuente C1 y contexto/validación, no forzamiento ni profundidad DG2 |
| `origin/ETAPA-2` | `98f7e07` | Sin cambios respecto a `main` | No aporta implementación adicional actualmente |
| `origin/frontend` | `98f7e07` | Sin cambios respecto a `main` | No aporta frontend actualmente |
| `origin/feat/mapa-editable-sandbox` | `2bc437e` | Frontend React/TypeScript/Vite/MapLibre con ROI, anotaciones, capas mock y persistencia local; incorpora ETAPA-1 | Referencia actualizada para reutilizar la interfaz existente |
| `simulacion-inundancion` | `a5d95fc` | Documentos de propuesta DG2 y guía; código web y adquisición de la línea integrada | Rama de esta documentación; aún sin solver ni API hidráulica |

### Qué aporta cada rama

- **Datos y adquisición:** `ETAPA-1` contiene `pipeline/download.py`, `pipeline/nisar_h5.py`, `pipeline/sources/subset.py` y `pipeline/sources/asf.py` con recorte remoto/local, inspección y pruebas. En la rama de esta propuesta también están esos módulos. C1 entrega GeoTIFFs de la ROI y `scene.json`, todavía en potencia lineal y sin máscara científica aplicada; no son entradas hidráulicas listas.
- **Frontend existente (mismo stack para DG2):** [`web/package.json`](../web/package.json) declara React, TypeScript, Vite, MapLibre GL JS y lucide-react. [`MapCanvas.tsx`](../web/src/components/MapCanvas.tsx) permite dibujar ROI y mostrar imágenes; [`api/client.ts`](../web/src/api/client.ts) intenta `/api/` pero utiliza mocks marcados cuando falla, con `localStorage` para mapas. Ni un mock ni la visualización solar son hidráulica. No se propone reemplazar el frontend ni añadir librerías web para el primer caso.
- **Backend:** ninguna de las referencias revisadas contiene todavía una implementación funcional de modelos, endpoints o integración de simulaciones. [`backend/`](../backend) sigue siendo el esqueleto inicial.
- **Simulación:** ninguna rama revisada contiene todavía un solver hidráulico o un adaptador LISFLOOD-FP. Esta guía describe el trabajo que falta.

El agente debe verificar siempre el contenido del commit que produce cada artefacto. Los módulos C1 ya existen en la rama documental observada, pero la disponibilidad de DEM, lluvia, solver DG2 o API no se deduce de esa integración.

### Inspección segura entre ramas

Para consultar una rama sin cambiar de rama ni fusionarla:

```bash
git show origin/ETAPA-1:pipeline/sources/subset.py
git show origin/ETAPA-1:docs/p1-datos.md
git show origin/feat/mapa-editable-sandbox:web/src/components/MapCanvas.tsx
git show simulacion-inundancion:web/package.json
git diff --stat main...origin/ETAPA-1
git diff --stat main...simulacion-inundancion
```

No ejecutar `git merge`, `git rebase`, `git cherry-pick` ni `git checkout` sobre estas ramas como parte de la implementación de esta guía. Si una integración es necesaria, debe solicitarla el equipo responsable mediante un PR independiente.

Los módulos bajo `pipeline/hydrology/` descritos más adelante son rutas propuestas, no archivos que se afirme que existan.

## Decisiones pendientes antes de una simulación real

La dirección DG2 y el alcance de terreno no urbano están detallados en [el flujo DG2 independiente](flujo-dg2-simulacion-inundacion.pdf) y su [fuente LaTeX](flujo-dg2-simulacion-inundacion.tex). El mismo frontend React/TypeScript/Vite/MapLibre se reutilizaría; no se instala ningún solver ni se añade una librería de frontend. Para el cálculo físico se propone evaluar LISFLOOD-FP 8.0 DG2 CPU como programa externo, con adaptador Python independiente de Django; Rasterio/NumPy existentes preparan y validan rasters, no resuelven SWE. Solo se usaría un dominio donde la ausencia de infraestructura urbana modelada no distorsione el flujo.

No hay autorización para fijar estas elecciones por defecto. **PENDIENTE** significa que el equipo debe decidir y registrar evidencia y responsable por rol; no se asignan personas. Las recomendaciones son opciones condicionadas, no decisiones aprobadas. Mientras falten entradas reales, pueden desarrollarse y probarse benchmarks sintéticos; no puede afirmarse que se simuló un evento real.

| Decisión (estado) | Evidencia/recomendación, no decisión | Responsable por rol |
|---|---|---|
| Evento y dominio (PENDIENTE) | Elegir fenómeno y dominio hidráulico, que puede extenderse aguas arriba/abajo de la ROI de visualización/evaluación. | Equipo de ciencia/hidrología |
| Ruta DG2 comunicada; versión/artefacto (PENDIENTE) | El físico eligió DG2 para la propuesta de inundación no urbana. SWE completo, costo y estabilidad aún requieren justificación; LISFLOOD-FP 8.0 DG2 CPU es candidato externo, no binario aprobado ni instalado. ATS, ACC y FV1 quedan como alternativas separadas. | Equipo de modelado |
| DEM, datum vertical y geometría de cauces/canales (PENDIENTE) | Documentar fuente, datum, cobertura, calidad, batimetría y estructuras. | Equipo de datos geoespaciales |
| Lluvia/caudal, fronteras, infiltración y estado inicial (PENDIENTE) | Definir series, unidades, periodo y procedencia; evitar contar dos veces lluvia y escorrentía entrante. Infiltración es explícita, nunca cero silencioso. | Equipo de hidrología |
| Malla, tiempos y hardware (PENDIENTE) | Medir desempeño en dominio pequeño antes de prometer interacción. | Equipo de modelado/plataforma |
| Datos y tolerancias de validación (PENDIENTE) | Separar calibración de evaluación independiente; fijar métricas, máscaras y tolerancias. | Equipo de ciencia/validación |
| Licencia y distribución (PENDIENTE) | Verificar LICENSE del artefacto de la versión elegida antes de empaquetar/publicar. | Responsable de publicación/legal |

Evitar escribir un solver propio no significa aceptar una aproximación física sin justificarla: formulación, límites y evidencia deben corresponder al fenómeno.

## Resultado esperado

La implementación completa debe poder:

1. Preparar un dominio hidráulico reproducible.
2. Ejecutar una simulación con entradas y parámetros registrados.
3. Generar profundidad de agua y extensión inundada por tiempo.
4. Comparar la extensión simulada con una observación NISAR u otra fuente independiente.
5. Guardar un manifiesto con escenas, datos, ecuaciones, parámetros, versiones y métricas.
6. Exponer el resultado posteriormente al backend y al frontend sin duplicar la lógica científica.

## Estado actual que debe tenerse en cuenta

Estado verificado el 2026-11-20 en `feature/flood-ui-dg2`.

**Implementado (pruebas de software, no validación física):**

- **Adquisición de terreno:** el panel elige *Terreno* en el paso 3 (`terrain.source` en la API): **Copernicus GLO-30 (recomendado)** o **NASADEM**; *Cargar valores de ejemplo* elige Copernicus y una solicitud sin la clave usa NASADEM. [`pipeline/elevation/copernicus.py`](../pipeline/elevation/copernicus.py) lee por HTTPS solo las ventanas del dominio de la colección `NISAR_DEM` v1.2 de ASF (Copernicus GLO-30 2023_1, cobertura global, alturas elipsoidales WGS84) y [`pipeline/elevation/nasadem.py`](../pipeline/elevation/nasadem.py) descarga NASADEM (EGM96, 56° S–60° N); ambos vía Earthdata con la misma cuenta, y ambos dan elevación, no profundidad. Una comprobación real descargó y verificó contra CMR la tesela NASADEM `n16w094`, y el 2026-11-20 se leyeron ventanas `NISAR_DEM` sobre Tuxtla Gutiérrez y Nairobi.
- **Un solo datum vertical, EGM2008:** [`pipeline/elevation/vertical_datum.py`](../pipeline/elevation/vertical_datum.py) convierte el terreno antes del solver (NASADEM: `h + N_EGM96 − N_EGM2008`; Copernicus: `h − N_EGM2008`) con las rejillas públicas de la NGA, instaladas una vez con `python -m pipeline.elevation.vertical_datum prepare` (ver [configuración](configuracion-servicio-inundacion.md)). El nivel del mar fijo, el mar en reposo y los lagos se interpretan en EGM2008. Ejemplo medido sobre un dominio de ~1 km² en Tuxtla (30 m, bilineal): tras la conversión, Copernicus − NASADEM = +0.51 m de media (desviación 1.58 m); en Nairobi, −3.40 m (desviación 4.28 m). Son diferencias entre dos modelos de superficie de épocas distintas (SRTM 2000 frente a TanDEM-X 2011–2015), no una validación de ninguno.
- **Cadena hidráulica:** [`pipeline/hydrology/`](../pipeline/hydrology) prepara el DEM métrico y sus coeficientes DG2 con la utilidad oficial `generateDG2DEM`, genera lluvia sintética reproducible (±10 mm/h, acumulado conservado, uniforme dentro de la ROI) exportada a NetCDF, formatea una frontera FREE idealizada, ejecuta LISFLOOD-FP 8.0.3 DG2 CPU y convierte las salidas a COG ([`roi_runner.py`](../pipeline/hydrology/roi_runner.py), [`results.py`](../pipeline/hydrology/results.py)).
- **Superficie del terreno y lluvia de diseño (datos abiertos, todo el mundo):** en el paso 3, *Rugosidad de Manning* puede ser **uniforme** o **según cobertura (WorldCover)**: n por celda de ESA WorldCover 2021 (10 m, CC BY 4.0) escrito como `manningfile`, que leen DG2 y FV1, con `fpfric` = mediana para celdas sin dato. *Infiltración* añade **número de curva por celda** (WorldCover + grupos de suelo HYSOGs250m de ORNL DAAC/Earthdata, tabla GCN250): cada celda recibe su lluvia neta SCS-CN en el cubo `rain.nc` con abstracción inicial `Ia = 0.05 S` (retención convertida de la tabla `Ia = 0.2 S` con `S0.05 = 1.33·S0.20^1.15` en pulgadas, Hawkins et al. 2002 y Woodward et al. 2003; las lluvias cortas escurren más y antes), con *Humedad previa del suelo* automática (NISAR SME2, o SMAP L4 si no hay dato, antes del inicio de la corrida) o I/II/III. En el paso 2, *Tipo de lluvia* añade **tormenta de diseño**: periodo de retorno 2–100 años y duración en horas, calculada por el servidor con PXR-4 (ERA5, ODbL) en el centroide del dominio y repartida en bloques alternos de 10 min. Las zonas urbanas se admiten: la declaración *El dominio incluye zona urbana / no es urbano* es informativa y, si el dominio tiene zona construida según WorldCover o se declara urbano, los resultados muestran «zona urbana: edificios y drenaje no representados; profundidades indicativas» con la fracción construida. Si no se puede leer WorldCover, HYSOGs o la humedad del suelo, la corrida falla con un código propio (`landcover_unavailable`, `soils_unavailable`, `soil_moisture_unavailable`) en vez de usar valores uniformes. El hietograma muestra la lluvia **neta** que recibe el solver (media de la ROI). Detalle en el [contrato de la API](api-simulacion-roi.md).
- **Costa: marea y fondo marino (datos abiertos):** en el paso 3 cada lado puede ser **Marea (EOT20)**: el nivel del mar sigue la marea astronómica de EOT20 (CC BY 4.0) en el punto medio de los lados de marea, llevada a EGM2008 con la topografía dinámica media DTUUH22MDT (CC BY 4.0) y predicha con pyTMD 3.1.0, más la presión atmosférica si se indica; se escribe como serie `HVAR` en `boundary.bdy`, que leen DG2 y FV1 ([`tides.py`](../pipeline/hydrology/tides.py), [`boundaries.py`](../pipeline/hydrology/boundaries.py)). Con lluvia sintética o de diseño el panel pide el *Inicio del evento (UTC)* (`simulation.start_utc`); con lluvia observada se usa el inicio de la serie. Con mar lleno al inicio, el mar arranca al nivel de la marea en t = 0. La casilla **Fondo marino: GEBCO** (`terrain.bathymetry: "gebco"`) pone la elevación de GEBCO_2026 (~450 m, dominio público) más la misma MDT en las celdas de mar (DEM ≤ 0.5 m conectadas a un lado de mar) ([`bathymetry.py`](../pipeline/hydrology/bathymetry.py)). Las cachés EOT20 y DTUUH22MDT se instalan una vez en el servidor con `python -m pipeline.hydrology.tides prepare-eot20` y `prepare-mdt` ([configuración](configuracion-servicio-inundacion.md)). Es solo marea astronómica: sin marea de tormenta, oleaje ni caudal de ríos; la MDT costera es incierta al nivel del decímetro y el geoide XGM2019e de DTU se toma como EGM2008.
- **Solver:** compilado localmente en `data/tools/lisflood-fp-8.0/runtime/build/`; los hashes de `lisflood` y `generateDG2DEM` están fijados en el servidor y no se aceptan rutas ni binarios del cliente.
- **Método DG2 o FV1:** el panel ofrece *Método* en las opciones avanzadas: DG2 (más preciso, por defecto) o FV1 (estable, para terreno empinado; sin umbral de lámina delgada). Si el método elegido falla tras la preparación, el servidor repite la corrida con el otro y los resultados lo avisan. Las profundidades negativas se ponen en 0 y se juzgan por el volumen que añaden: < 1 % normal, 1–10 % con advertencia, > 10 % el intento falla (`negative_depth_artifacts`). Ver [API ROI](api-simulacion-roi.md#método-simulationsolver-y-cambio-automático).
- **Backend:** API autenticada y privada por propietario, `POST /api/flood-scenarios/roi/start/` más estado, resultados, COG y preview PNG EPSG:3857 en `/api/flood-roi-runs/<uuid>/` ([contrato](api-simulacion-roi.md), [configuración](configuracion-servicio-inundacion.md)).
- **Frontend:** el panel *Simulación de inundación (DG2/FV1)* ([`RainDg2Panel.tsx`](../web/src/components/RainDg2Panel.tsx), con piezas en [`web/src/components/flood/`](../web/src/components/flood)) sigue el estilo de `terrapulseai_v2.1`: pasos numerados con estado completo/pendiente (1 Zona, 2 Lluvia, 3 Terreno y fronteras, 4 Opciones avanzadas plegadas, confirmación y 5 Resultados), ayuda en lenguaje llano con unidades bajo cada campo, zonas precargadas agrupadas por estado, escenarios rápidos (*Tierra adentro*: cuatro lados libres; *Mar al norte/este/sur/oeste*: ese lado a nivel fijo 0 m EGM2008 con el mar lleno al inicio), estimación del número de celdas con aviso si supera el límite por defecto del servidor (3000), barra de estado y de progreso de la corrida, tarjetas de resumen (área inundada ≥ 0.03 m, lámina delgada de 0.01–0.03 m en corridas nuevas, profundidad máxima, agua en el dominio frente a lluvia, Froude, tiempo de concentración y caminos cortados) antes de las gráficas, y una sección plegable *Cómo funciona la simulación* con las fórmulas usadas. El botón *Cargar valores de ejemplo* rellena valores **ilustrativos, no recomendaciones**, pensados para **ver dónde se acumula el agua** en un dominio de ~1 km² (terreno Copernicus GLO-30, CRS UTM de la zona de la ROI, EPSG:32615 en Chiapas; 30 m, `nearest`, Manning según cobertura (WorldCover), número de curva con humedad previa automática, cuatro lados libres, **tormenta de diseño de 100 años y 3 h** (PXR-4; ~60 mm en el Sumidero), **14400 s** de simulación (la tormenta más 1 h para ver el escurrimiento), guardado cada **300 s** (49 cuadros, para la animación), paso inicial 1 s, **sin umbral de lámina delgada**, DG2 con cambio automático a FV1 si falla; si se cambia a lluvia sintética quedan 60 mm en 10800 s, 18 intervalos, semilla 7). En dos corridas reales del Sumidero (2026-11-20, 20 × 16 celdas de 30 m, 60 mm, AMC II, CN medio 78.6) DG2 simuló los 14400 s en 25–26 s de solver pero dejó artefactos de profundidad negativa y el servidor pasó a FV1, que tardó 7–50 s según la carga de la máquina: ambos dentro de los 120 s por intento. Lluvia neta 18.5 mm (C 0.31); en el máximo, 22 celdas ≥ 0.01 m, 6 ≥ 0.03 m, 5 ≥ 0.15 m y 3 ≥ 0.5 m (máx. 1.08 m). El balance del agua de esa corrida (resumida de nuevo con las clases y volúmenes por cuadro) corrige la lectura anterior de que el agua «sale por los lados libres»: de 9078 m³ de lluvia bruta, 6285 m³ (69 %) se infiltran o quedan retenidos, y de los 2793 m³ netos solo 0.4 m³ salen del dominio; durante la lluvia el agua escurre como láminas de 2–10 mm sobre 64–141 celdas (cuadros de 6000 a 10800 s) y al final se junta en las depresiones (último cuadro: 31 m³ en láminas y 2741 m³ encharcados en 24 celdas mojadas). La física es coherente; el mapa del máximo y la transparencia por debajo de 1 cm ocultaban la fase de láminas. Antes de enviar, el panel rechaza con un mensaje claro una lluvia sintética más larga que la simulación y más de 121 cuadros (`floor(duración / intervalo) + 2`, el límite por defecto del servidor), e indica el intervalo mínimo; lagos, dominio y declaraciones siguen siendo elección explícita del usuario y nada se envía hasta pulsar *Iniciar corrida DG2*. El panel exige entradas explícitas, sigue el ciclo de la corrida y muestra los cuadros georreferenciados en MapLibre, con advertencias de lluvia sintética y exactitud no validada. La frontera se elige **por lado** (cerrada, libre o nivel fijo del mar en m EGM2008) y, con nivel fijo, la corrida puede **arrancar con el mar lleno** a ese nivel. La profundidad se pinta en **siete clases de azul** (0.002–0.01 m de escurrimiento en láminas, casi blanco y semitransparente; 0.01–0.03 m de lámina delgada; 0.03–0.15, 0.15–0.5, 0.5–1, 1–2 y ≥ 2 m; menos de 0.002 m transparente) con leyenda en el mapa; el área inundada sigue contando desde 0.03 m y cada corrida guarda sus propias clases (`depth_classes_m`), así que las gráficas de corridas anteriores conservan sus cinco o seis clases. **Animación:** *Reproducir* carga una vista previa por cuadro y reproduce la corrida con fundido entre cuadros, deslizador con el tiempo simulado (`hh:mm`), velocidad 0.5×–4×, repetición, cursor de tiempo en las gráficas y **lluvia animada** sobre el mapa mientras el instante cae dentro de la lluvia (según la intensidad bruta; con movimiento reducido, solo la insignia «Lloviendo X mm/h»); *Ver máximo* vuelve al máximo. **Mientras la corrida está en curso**, la tarjeta de la corrida muestra una barra de progreso real (tiempo simulado / total) y el mapa el último cuadro que el solver terminó de escribir, con la lluvia de ese momento; si DG2 falla y el servidor pasa a FV1, la barra vuelve a cero con un aviso; al terminar arranca la animación completa y, si falla, queda el último cuadro con el error. La tarjeta **¿A dónde fue la lluvia?** reparte la lluvia bruta en infiltrada, láminas (< 3 cm), encharcada (≥ 3 cm) y salida por las fronteras ([API ROI](api-simulacion-roi.md#balance-del-agua-water_budget)). Sobre cada cuadro dibuja **flechas de flujo** solo donde hay desbordamiento (velocidad del solver `voutput` con al menos 0.15 m de agua fuera de la red de cauces D8 y del mar inicial; tamaño según rapidez; se pueden ocultar), muestra **cuatro gráficas**, cinco en corridas nuevas (hietograma de la lluvia que recibe el solver, con la bruta al lado si hay pérdidas; área inundada, área con láminas y profundidad máxima en el tiempo; agua en el dominio frente a lluvia acumulada; agua por tipo —láminas y encharcada— en cada cuadro; y área por clase de profundidad del cuadro elegido) y ofrece **descargar la imagen PNG** del cuadro. Para una imagen con mapa base y flechas, usar la herramienta *Capturar Región*, que incluye las capas de MapLibre.

**Pendiente:**

- Simulación real: el 2026-11-19 se completó una corrida NASADEM (`n16w094`) + DG2 de prueba sobre ~1 km² (1680 celdas de 30 m, 900 s simulados, 59–69 s de solver), con valores de prueba explícitos y `dg2_depth_thresh_m` = 0.02 m. Sin ese umbral DG2 produjo profundidades medias negativas en láminas finas y la corrida se rechazó (regla anterior; hoy se juzgan por volumen y, si fallan, se usa FV1). Los presupuestos por defecto (3000 celdas, 120 s de solver, tope del código) solo admiten dominios pequeños; la ROI de estudio completa no cabe.
- No hay validación hidráulica, máscara de inundación NISAR ni métricas contra observación (fases 3 y 6).
- Las pérdidas de lluvia (coeficiente o número de curva) son tablas y umbrales no calibrados para la zona; los edificios y el drenaje urbano no se representan; la tormenta de diseño PXR-4 viene de reanálisis (probablemente baja para tormentas convectivas cortas). La frontera FREE es idealizada y no medida; la marea EOT20 es solo astronómica y no se ha contrastado con mareógrafos de la zona; el tiempo de cada cuadro es el programado, no un tiempo físico observado.
- [`pipeline/config.yaml`](../pipeline/config.yaml) mantiene el fenómeno y los criterios específicos pendientes de verificación.

Todo resultado actual se marca `synthetic: true` y `hydraulic_accuracy_validated: false`; no presentarlo como inundación observada.

---

## Fase 0.5 — Coordinar el trabajo paralelo sin fusionar ramas

Esta fase es obligatoria antes de escribir el adaptador hidráulico.

### Contratos entre equipos

Usar los contratos definidos en `origin/ETAPA-1:docs/plan-de-trabajo.md` como interfaz de integración:

| Contrato | Productor | Consumidor de la simulación | Requisito |
|---|---|---|---|
| **C1** | Datos/adquisición | Procesamiento y simulación | `data/raw/<scene_id>/` con capas, malla, cobertura y `scene.json` |
| **C2** | Procesamiento SAR | Validación, backend y frontend | `data/processed/<run_id>/` con rasters y `run.json` |
| **C3** | Ciencia/validación | Backend y frontend | `validation.json` con métricas o estado exploratorio |
| **C4** | Backend/API | Frontend | Endpoints documentados para escenas, cambios, compatibilidad y reportes |
| **C5** | Plataforma/teselas | Frontend | Servicio de teselas para COGs y capas raster |

La simulación hidráulica debe añadir un contrato propio, **C6**, antes de conectar backend o frontend:

```text
data/processed/<simulation_id>/
├── water_depth_t*.tif
├── maximum_depth.tif
├── simulated_extent.tif       # instante/umbral en manifiesto
├── observed_extent.tif        # opcional, si existe observación válida
├── arrival_time.tif           # opcional, si se produce/documenta
├── simulation_manifest.json
└── validation.json
```

### Reglas para los agentes de cada equipo

1. El agente hidráulico no edita `web/` para conectar capas.
2. El agente de frontend no modifica ecuaciones, parámetros ni rasters científicos.
3. El agente de backend no recalcula resultados; carga manifiestos y expone contratos.
4. El agente de datos no transforma los recortes C1 a dB ni aplica máscaras científicas.
5. Si un contrato necesita cambiar, documentar la propuesta, actualizar productor y consumidores y pedir revisión cruzada.
6. Usar mocks sintéticos para permitir trabajo paralelo, marcándolos siempre como `synthetic` o `mock`.
7. No copiar archivos de una rama a otra manualmente para evitar la revisión del equipo dueño.
8. Registrar en cada manifiesto el commit o referencia de rama que produjo cada entrada.

### Orden de integración recomendado

La implementación puede avanzar en paralelo, pero la validación final debe respetar este orden:

1. C1 del par GCOV y la cobertura de la ROI ya están documentados en `ETAPA-1` y presentes en `simulacion-inundancion`; confirmar datos auxiliares y dominio antes de intentar hidráulica.
2. Procesamiento SAR genera C2 y la observación de inundación.
3. El agente hidráulico genera C6 a partir del DEM y las condiciones hidráulicas.
4. Validación genera C3 y el `validation.json` hidráulico.
5. Backend expone C2, C3 y C6 mediante C4.
6. Frontend consume C4 o C5 y distingue observación, simulación y validación.

C1 y las capas SAR de exploración ya tienen código en `simulacion-inundancion`. Para C2--C6 y API hidráulica, usar el contrato documentado y un mock explícito hasta tener implementación verificada; no confundir PNG/COG SAR con salidas DG2.

---

## Fase 0 — Confirmar que el caso de estudio es inundación

### Pasos

1. Confirmar que el equipo eligió `inundación` en lugar de humedales, vegetación o deformación. Hasta esa decisión, los benchmarks sintéticos no dependen de un evento real.
2. Seleccionar una pareja o serie temporal de escenas GCOV comparables.
3. Ejecutar `check_pair` y conservar el reporte de compatibilidad.
4. Verificar en los archivos HDF5:
   - cobertura real de la ROI;
   - resolución y espaciado;
   - polarizaciones disponibles;
   - georreferenciación;
   - valores nulos y máscaras de calidad.
5. Confirmar que existe una fuente independiente para validar la inundación: lluvia, caudal, inventario, Sentinel-2, observación de campo u otra fuente documentada.

### Criterio de salida

No continuar con la simulación y evaluación de un evento real si no existe una pareja comparable, cobertura confirmada y una estrategia de validación independiente. Este criterio no impide probar el adaptador con benchmarks sintéticos explícitos.

---

## Fase 1 — Preparar el entorno y la estructura

### Pasos

1. Verificar el entorno descrito en [`environment.yml`](../environment.yml).
2. Verificar GDAL y sus drivers disponibles.
3. Verificar que PostGIS funcione, sin poner credenciales en logs.
4. Mantener el código científico independiente de Django.
5. Crear módulos pequeños y testeables, por ejemplo:

```text
pipeline/
├── download.py
├── preprocess.py
├── change.py
├── validate.py
└── hydrology/
    ├── __init__.py
    ├── inputs.py
    ├── solver_adapter.py  # adaptador del solver externo seleccionado
    └── outputs.py
```

6. Añadir configuración explícita en [`pipeline/config.yaml`](../pipeline/config.yaml), sin valores inventados:

```yaml
hydrology:
  enabled: false
  formulation: null       # ATS, ACC o SWE completo: decisión pendiente
  solver: null
  solver_version: null
  crs: null
  time_reference_utc: null
  timestep_s: null        # política adaptativa o paso según el solver
  domain: null            # extensión computacional, distinta de ROI
  roi: null
  vertical_datum: null
  dem: null
  channel_geometry: null
  roughness: null
  rainfall: null
  inflow: null
  boundary_conditions: null
  infiltration: null     # explícita; no asumir cero
  initial_depth: null
  cell_size_m: null
  duration_s: null
  output_interval_s: null
  wet_depth_threshold_m: null
  mass_tolerance: null
  validation_tolerances: null
```

### Criterio de salida

El pipeline puede leer y validar la configuración, y falla explícitamente cuando falta una entrada obligatoria.

---

## Fase 2 — Adquirir y preparar las entradas

### 2.1 Escenas NISAR

Implementar el recorte en `DataSource.fetch_subset()` de [`pipeline/sources/base.py`](../pipeline/sources/base.py), con una implementación ASF que:

- use autenticación externa sin copiar credenciales al repositorio;
- descargue o recorte solamente la ROI;
- use Frequency A cuando corresponda;
- registre URL, escena, capa, tamaño, fecha y versión;
- no descargue la escena completa innecesariamente;
- produzca un GeoTIFF reproducible.

### 2.2 Datos hidráulicos

Reunir y registrar:

- DEM;
- uso/cobertura del suelo;
- coeficiente de Manning \(n\);
- lluvia o caudal;
- niveles o caudales de frontera;
- condición inicial;
- datos de validación.

Cada raster debe conservar CRS, transformación afín, resolución, nodata, fuente, fecha y licencia.

Definir el dominio hidráulico y sus aportes desde aguas arriba, no solo recortar a la ROI visible. Documentar datum vertical común entre DEM y niveles de frontera, representación del cauce/batimetría y estructuras relevantes (diques, puentes o barreras). Registrar la infiltración seleccionada y sus parámetros; si se omite, justificar y evaluar ese supuesto explícitamente. Al combinar lluvia e hidrogramas, identificar sus áreas contribuyentes para evitar contar dos veces la misma escorrentía.

### 2.3 Sistema de coordenadas

La ROI está definida en EPSG:4326, pero el cálculo hidráulico requiere metros. Reproyectar todos los datos a un CRS métrico adecuado para Chiapas, verificando la zona UTM y la cobertura real antes de fijar EPSG:32615 u otra alternativa.

### Criterio de salida

Las entradas tienen CRS/datum y transformaciones conocidos; las que interactúan se alinean a la malla computacional elegida, con máscara válida y método apropiado: continuo (elevación) frente a categórico (clases). La interpolación no crea información. Mantener separadas malla computacional y malla de evaluación; no exigir resolución nativa idéntica. Registrar cobertura y procedencia sin secretos.

---

## Fase 3 — Preprocesar NISAR y crear la observación de referencia

1. Leer el dataset correcto dentro del HDF5.
2. Aplicar máscaras de nulos, sombras, layover y píxeles inválidos cuando estén disponibles.
3. Convertir retrodispersión lineal a decibelios:

   \[
   \sigma^0_{\mathrm{dB}} = 10\log_{10}(\sigma^0)
   \]

4. Calcular el cambio entre escenas comparables:

   \[
   \Delta\sigma^0_{\mathrm{dB}} =
   \sigma^0_{\mathrm{dB},t_2}
   -
   \sigma^0_{\mathrm{dB},t_1}
   \]

5. Definir una regla documentada para obtener una máscara de agua o inundación.
6. No calcular diferencias sobre PNG de visualización.
7. Guardar umbrales, máscaras y parámetros junto con la salida.

NISAR mide respuesta radar, no profundidad, velocidad ni causa. Vegetación, layover y sombra introducen incertidumbre: la máscara derivada es observación limitada, no verdad del terreno. Lluvia/caudal ayudan a caracterizar el evento, pero no son verdad espacial de inundación. Comparar con adquisición en hora UTC real, no máximo del evento frente a instantánea; separar agua permanente de nueva inundación y excluir nodata. Calibración no equivale a evaluación independiente.

La máscara radar será una **observación de referencia**, no una entrada directa que determine automáticamente la dinámica hidráulica.

### Criterio de salida

Existe un raster observado con valores válidos, una máscara reproducible y un JSON que identifica las escenas y los parámetros usados.

---

## Fase 4 — Formular el modelo hidráulico

Las ecuaciones siguientes son aguas someras bidimensionales promediadas en profundidad e hidrostáticas (Saint-Venant), no Navier–Stokes 3D. Son referencia conceptual para SWE completo; **no son las ecuaciones ACC**. Decidir familia antes de implementar:

| Familia/esquema | Términos retenidos | Uso y cautela |
|---|---|---|
| ATS (difusiva) | Omite aceleración temporal local y advectiva. | Puede servir para propagación gradual si la inercia no domina; validar en el dominio. |
| ACC (inercia local) | Retiene aceleración temporal; omite aceleración advectiva. | Posible para flujos graduales mayormente subcríticos, condicionado a fenómeno, solver y validación; no universal. |
| FV1 / DG2 | Volúmenes finitos de primer orden / Galerkin discontinuo de segundo orden para SWE 2D completo. | Costos y propiedades distintos; DG2 no es automáticamente superior. Verificar capacidades de versión. |

FV1 y DG2 no integran automáticamente canales subgrid. Verificar soporte de la versión concreta para lluvia, infiltración, fronteras y salidas; no inferirlo por el nombre del esquema.

### 4.1 Variables

- \(h(x,y,t)\): profundidad de agua.
- \(u(x,y,t)\), \(v(x,y,t)\): velocidades promediadas verticalmente.
- \(z_b(x,y)\): elevación del terreno.
- \(\eta=h+z_b\): elevación de la superficie libre.
- \(g\): aceleración gravitacional.
- \(n\): rugosidad de Manning.

### 4.2 Conservación de masa

Sin fuentes:

\[
\frac{\partial h}{\partial t}
+
\frac{\partial(hu)}{\partial x}
+
\frac{\partial(hv)}{\partial y}
=0
\]

Con precipitación \(r\), infiltración \(i\) y otras fuentes \(q\):

\[
\frac{\partial h}{\partial t}
+
\frac{\partial(hu)}{\partial x}
+
\frac{\partial(hv)}{\partial y}
=r-i+q
\]

### 4.3 Conservación de momento en \(x\)

\[
\frac{\partial(hu)}{\partial t}
+
\frac{\partial}{\partial x}
\left(hu^2+\frac{1}{2}gh^2\right)
+
\frac{\partial(huv)}{\partial y}
=
-gh\frac{\partial z_b}{\partial x}
-ghS_{fx}
+S_x
\]

### 4.4 Conservación de momento en \(y\)

\[
\frac{\partial(hv)}{\partial t}
+
\frac{\partial(huv)}{\partial x}
+
\frac{\partial}{\partial y}
\left(hv^2+\frac{1}{2}gh^2\right)
=
-gh\frac{\partial z_b}{\partial y}
-ghS_{fy}
+S_y
\]

### 4.5 Fricción de Manning

\[
S_{fx}
=
\frac{n^2u\sqrt{u^2+v^2}}{h^{4/3}}
\]

\[
S_{fy}
=
\frac{n^2v\sqrt{u^2+v^2}}{h^{4/3}}
\]

Tratamiento de celdas secas y umbral húmedo siguen al solver y se registran. Controlar balance de masa incluyendo fuentes y fronteras; no ocultar errores con recorte ciego de profundidades negativas. Informar correcciones numéricas y su efecto.

### 4.6 Seleccionar formulación

No se prescribe universalmente esquema inercial/de almacenamiento ni SWE completo. Elegir según fenómeno (rapidez del frente y régimen esperado), dominio, costo, capacidades verificadas de la versión y aceptación acordada. ACC es alternativa condicionada, no decisión aprobada; ATS puede ser insuficiente si importa la inercia. No sustituir un solver validado por ecuaciones propias improvisadas.

La conservación discreta siguiente es ilustrativa, no receta de solver. Fuentes areales de profundidad (lluvia, infiltración y otros términos) usan m/s; no confundir caudal total (m³/s) con fuente areal. En las ecuaciones de momento escritas aquí, Sx/Sy tienen unidades m²/s²: documentar qué aportes o pérdidas de momento representan y cómo los trata el solver seleccionado.

La conservación de masa discreta sobre una celda puede representarse como:

\[
h_{i,j}^{t+\Delta t}
=
h_{i,j}^{t}
-
\frac{\Delta t}{\Delta x}
\left(q_{x,i+1/2,j}-q_{x,i-1/2,j}\right)
-
\frac{\Delta t}{\Delta y}
\left(q_{y,i,j+1/2}-q_{y,i,j-1/2}\right)
+
\Delta t(r-i+q)
\]

Los flujos entre celdas deben depender de:

- diferencia de elevación de la superficie del agua;
- profundidad disponible;
- gravedad;
- rugosidad;
- resolución espacial;
- paso temporal;
- condición de flujo seco/húmedo.

La fórmula exacta debe seguir la documentación y versión del solver utilizado. No copiar una ecuación simplificada de una fuente secundaria y presentarla como la implementación exacta de LISFLOOD-FP.

### 4.7 Estabilidad numérica

Como ilustración, un solver explícito puede restringir el paso temporal mediante una condición CFL del tipo:

\[
\Delta t
\le
C_{\mathrm{CFL}}
\min\left(
\frac{\Delta x}{|u|+\sqrt{gh}},
\frac{\Delta y}{|v|+\sqrt{gh}}
\right)
\]

donde \(C_{\mathrm{CFL}}\) debe estar dentro de los límites del solver seleccionado.

La expresión no prescribe el CFL de todos los esquemas; usar la regla propia del solver y registrar paso, diagnóstico, resolución y reducciones automáticas.

---

## Fase 5 — Integrar LISFLOOD-FP o el solver seleccionado

### Decisión recomendada

Priorizar un ejecutable reproducible de LISFLOOD-FP u otro modelo documentado, mediante el módulo propuesto `pipeline/hydrology/solver_adapter.py`. El equipo debe confirmar modelo, formulación, solver y versión; esta recomendación no los da por aprobados ni presupone un paquete Python. No acoplar la simulación directamente a las vistas Django.

### Pasos

1. Documentar la versión exacta del solver.
2. Documentar cómo se instala y cómo se invoca.
3. Generar archivos de entrada desde Python.
4. Ejecutar el solver sin credenciales ni rutas ocultas.
5. Capturar código de salida y errores.
6. Rechazar resultados incompletos o archivos ausentes.
7. Convertir las salidas al formato raster acordado.
8. Crear un manifiesto de ejecución.

### Adaptador mínimo

El adaptador debe aceptar:

```python
run_simulation(
    dem_path,
    roughness_path,
    boundary_config,
    initial_depth_path,
    output_dir,
    config,
) -> SimulationResult
```

`SimulationResult` debe identificar, como mínimo:

- profundidad máxima;
- profundidad por tiempo;
- extensión inundada;
- tiempo de llegada, si el solver lo produce;
- ruta del log;
- manifiesto;
- estado de validación.

---

## Fase 6 — Validar la simulación

Comparar la extensión simulada con una máscara observada independiente o derivada de NISAR con una regla documentada. Registrar la incertidumbre de esa referencia y usar el instante de adquisición, no la extensión máxima temporal como sustituto de una instantánea. El tiempo de llegada, si se produce o deriva, debe definir origen temporal, umbral de profundidad, intervalo de salida y convención para celdas nunca inundadas; si no puede calcularse, declarar su ausencia.

Para una clasificación binaria:

\[
\mathrm{Precision}=\frac{TP}{TP+FP}
\]

\[
\mathrm{Recall}=\frac{TP}{TP+FN}
\]

\[
F1=\frac{2\cdot\mathrm{Precision}\cdot\mathrm{Recall}}
{\mathrm{Precision}+\mathrm{Recall}}
\]

\[
\mathrm{IoU}=\frac{TP}{TP+FP+FN}
\]

También calcular, cuando sea posible:

- área observada y simulada;
- diferencia de área;
- error de profundidad;
- error del tiempo de llegada;
- sensibilidad a \(n\), DEM, caudal y paso temporal.

La partición de validación debe ser temporal o espacialmente independiente cuando haya suficientes eventos. No ajustar y evaluar con exactamente la misma observación sin marcar la limitación.

### Criterio de salida

El informe indica claramente:

- qué fue observado;
- qué fue simulado;
- qué parámetros se ajustaron;
- qué datos fueron independientes;
- qué errores se obtuvieron;
- qué limitaciones permanecen.

---

## Fase 7 — Persistir el resultado en el backend

Solo después de validar el pipeline científico:

1. Crear modelos para escenas, simulaciones y resultados.
2. Registrar el DEM, configuración, solver, fechas, parámetros y artefactos.
3. Usar PostGIS para ROI y geometrías vectoriales.
4. Guardar archivos raster fuera de la base de datos, con rutas controladas.
5. Crear endpoints DRF de solo lectura inicialmente.
6. No permitir que una petición web ejecute arbitrariamente procesos del sistema.

La lógica científica debe continuar viviendo en [`pipeline/`](../pipeline). Django debe orquestar, consultar y exponer resultados, no duplicar las ecuaciones.

---

## Fase 8 — Visualizar y documentar

La interfaz debe distinguir visualmente:

- retrodispersión NISAR;
- cambio radar;
- extensión simulada;
- profundidad simulada;
- incertidumbre;
- datos faltantes;
- validación.

No mezclar una máscara observada con una simulada en una sola capa sin leyenda explícita.

Cada figura o resultado debe enlazar a:

- escenas utilizadas;
- fecha y hora;
- parámetros;
- resolución;
- versión del código;
- versión del solver;
- fuente de cada entrada;
- advertencias científicas.

---

## Estructura de archivos de salida

Una ejecución puede producir (opcionales solo cuando existan y se documenten):

```text
data/processed/
└── flood_simulation_<id>/
    ├── water_depth_t000.tif
    ├── water_depth_t001.tif
    ├── maximum_depth.tif
    ├── simulated_extent.tif
    ├── observed_extent.tif  # opcional
    ├── arrival_time.tif     # opcional
    ├── validation.json
    ├── simulation_manifest.json
    └── solver.log
```

El manifiesto debe incluir:

```json
{
  "model": null,
  "formulation": null,
  "model_version": null,
  "solver": null,
  "solver_version": null,
  "infiltration": null,
  "code_version": null,
  "domain": null,
  "roi": null,
  "vertical_datum": null,
  "channel_geometry": null,
  "crs": null,
  "cell_size_m": null,
  "time_step_s": null,
  "duration_s": null,
  "time_reference_utc": null,
  "output_interval_s": null,
  "wet_depth_threshold_m": null,
  "mass_tolerance": null,
  "validation_tolerances": null,
  "simulated_extent_reference": null,
  "dem": null,
  "roughness": null,
  "rainfall": null,
  "boundary_conditions": null,
  "initial_conditions": null,
  "nisar_scenes": [],
  "parameters": {},
  "validation": null
}
```

Los `null` solo se completan con datos verificados; no convertirlos en cero, defaults externos ni resultados ficticios. Distinguir dominio de ROI; registrar hora UTC, intervalo de salida y definición de extensión (instante/umbral). Registrar fuente, revisión/checksum cuando sea significativo y disponible. El adaptador valida configuración y salidas completas, haciendo explícitos defaults. Pipeline independiente de Django; empezar con adaptador a ejecutable externo de versión verificada, sin presuponer paquete Python.

---

## Pruebas mínimas

Añadir pruebas enfocadas para:

- rechazo de configuración incompleta;
- rechazo de CRS geográfico para cálculo métrico;
- alineación de rasters;
- lago en reposo sobre lecho irregular; avance/retroceso wet-dry; benchmark de rotura de presa analítico o de referencia; conservación de masa forzada contabilizando fronteras y fuentes; convergencia de malla/tiempo con tolerancias fijadas previamente (pendientes, no inventar);
- profundidad nunca negativa;
- flujo nulo en dominio plano sin forzamiento y dirección esperada sobre pendiente;
- estabilidad temporal según criterio del solver;
- estos son casos propuestos, no pruebas que se afirmen existentes.
- cálculo correcto de Precision, Recall, F1 e IoU;
- reproducción del manifiesto;
- errores explícitos cuando el solver externo falla.

No usar escenas reales ni credenciales en pruebas unitarias. Usar dominios raster sintéticos pequeños.

---

## Checklist de aceptación

- [ ] Evento/dominio, formulación y versión del solver fueron decididos y registrados.
- [ ] DEM, datum vertical, geometría de canales/estructuras y calidad documentados.
- [ ] Forzamientos, fronteras, estado inicial e infiltración definidos explícitamente.
- [ ] Malla computacional y evaluación se distinguen; remuestreo y máscaras apropiados.
- [ ] Medir hardware/tiempos en dominio pequeño. ROI aprox. 55×27 km: ~1,65 M celdas a 30 m o ~14,86 M a 10 m; estimación geométrica, no benchmark.
- [ ] El caso de estudio fue confirmado como inundación.
- [ ] Existe una pareja de escenas NISAR comparable y verificada en HDF5.
- [ ] El DEM cubre la ROI y está en un CRS métrico.
- [ ] Rasters usados conjuntamente están alineados a la malla elegida; no se exige igual resolución nativa.
- [ ] La rugosidad y las condiciones de frontera tienen fuente documentada.
- [ ] Las ecuaciones y supuestos están registrados.
- [ ] El solver y su versión están registrados.
- [ ] La simulación genera profundidad y extensión por tiempo.
- [ ] El paso temporal y la estabilidad numérica fueron comprobados.
- [ ] Observación corresponde al instante UTC evaluado, distingue agua permanente/nueva inundación y excluye nodata; calibración y evaluación independiente separadas.
- [ ] Métricas comparadas con datos de evaluación apropiados y tolerancias predefinidas.
- [ ] Los resultados están marcados como exploratorios cuando corresponde.
- [ ] Se generó `simulation_manifest.json`.
- [ ] No se escribieron secretos en código, logs, JSON ni documentación.
- [ ] El pipeline funciona sin levantar Django.
- [ ] Las pruebas enfocadas pasan.

## Referencias hidráulicas y licencia

- Shaw et al. (2021), LISFLOOD-FP 8.0: https://doi.org/10.5194/gmd-14-3577-2021
- Sharifian et al. (2023), LISFLOOD-FP 8.1: https://doi.org/10.5194/gmd-16-2391-2023
- Artefacto 8.0 para evaluar DG2: https://zenodo.org/records/4073011; guía de ejecución de los desarrolladores: https://www.seamlesswave.com/LISFLOOD8.0
- Artefacto 8.1 citado para ACC/GPU (no prueba DG2 8.1): https://zenodo.org/records/6912932
- Se conservan las páginas de [Bristol](https://www.bristol.ac.uk/geography/research/hydrology/models/lisflood/) y [heritage](https://www.bristol.ac.uk/geography/research/hydrology/models/lisflood/heritage/) como resumen e historia.

Los metadatos Zenodo consultados indican GPL-2.0 para los artefactos, mientras las publicaciones/documentación mencionan GPLv3; no se inspeccionó el archivo LICENSE del release concreto. No resolver esa discrepancia por inferencia ni asumir restricciones comerciales: verificar licencia y obligaciones del artefacto seleccionado antes de distribuirlo. LISFLOOD-FP hidráulico no es LISFLOOD OS del JRC (modelo hidrológico distinto).

## Fuera de alcance de esta guía

- Implementar el frontend completo.
- Crear un asistente de IA para interpretar resultados.
- Procesar escenas NISAR incompatibles.
- Resolver todos los fenómenos del proyecto.
- Afirmar causalidad física a partir de una diferencia radar.
- Sustituir un modelo hidráulico validado por una implementación improvisada.
- Publicar resultados sin trazabilidad, métricas y limitaciones.
