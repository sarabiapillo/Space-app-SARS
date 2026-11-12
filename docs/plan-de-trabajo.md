# Plan de trabajo — TerraPulse AI

Equipo de 6 integrantes. Actualizado: 2026-11-11.

Cada integrante tiene **una responsabilidad única** y es **dueño de un conjunto de archivos que nadie más edita**. Así cada quien trabaja en su rama y los merges no chocan. Los equipos se comunican mediante **contratos** (formatos de archivo y de API) que se acuerdan en la Fase 0. Mientras el contrato no cambie, nadie depende del código de otro para avanzar.

Reglas del proyecto: [AGENTS.md](../AGENTS.md). Instalación: [README.md](../README.md).

> **Fuera de alcance por ahora:** el asistente conversacional con IA (propuesta §7.1 y §9.4). No se implementa en este plan. La arquitectura no lo impide: si después se retoma, consumirá la misma API y los mismos `run.json` sin cambiar nada de lo que se construya aquí.

---

## 1. Lo que ya está hecho

| Área | Qué hay | Dónde |
|---|---|---|
| Entorno | Entorno conda `nisar` reproducible (Python 3.11, GDAL, rasterio, h5py, xarray, Django, DRF, asf_search, pytest) | `environment.yml` |
| Configuración | Secretos fuera del código, plantilla de variables, `.gitignore` | `.env.example`, `.gitignore` |
| Base de datos | PostGIS 3.4 en Docker, migraciones base de Django aplicadas | `docker-compose.yml` |
| Backend | Proyecto Django con GeoDjango y DRF; apps `scenes` y `analyses` creadas (todavía sin modelos) | `backend/` |
| Fuente de datos | Capa intercambiable: contrato `DataSource` / `SceneMeta` y fuente ASF (búsqueda) | `pipeline/sources/` |
| Comparabilidad | `check_pair`: bloquea si difieren producto, trayectoria, marco, dirección, polarización, CRID o madurez (o si alguno es desconocido) | `pipeline/compat.py` |
| Catálogo | `python -m pipeline.catalog`: consulta, agrupa en pilas y guarda un JSON trazable | `pipeline/catalog.py` |
| Pruebas | 20 pruebas `pytest` (compat y normalización de metadatos) | `pipeline/tests/` |
| Documentación | README de instalación, AGENTS.md actualizado, propuesta en PDF | `README.md`, `AGENTS.md`, `docs/` |

**Hallazgo clave.** Sobre la ROI de Chiapas hay **3 pilas GCOV comparables**, todas con CRID P05023, madurez PROVISIONAL y polarización HH+HV:

- T55/F80, descendente: 10 fechas.
- T62/F10, ascendente: 10 fechas.
- T156/F80, descendente: 8 fechas.

Van de junio a octubre de 2026, cada 12 días. El CRID cambió a P05036 el 2026-10-23, así que **no se deben formar pares que crucen esa fecha**. El detalle está en [AGENTS.md §4](../AGENTS.md).

**Lo que falta, en una frase:** recortar un par real a la ROI, convertirlo a dB, calcular el cambio, validarlo, servirlo por API, mostrarlo en el mapa y exportar un reporte reproducible.

---

## 2. Roles y archivos de cada uno

> **Regla de oro:** solo el dueño edita sus archivos. Si necesitas un cambio en archivos ajenos, abre un *issue* o pídeselo al dueño. No lo edites tú.

| # | Rol | Responsabilidad única | Archivos que le pertenecen (solo él/ella los edita) | Rama base |
|---|---|---|---|---|
| **P1** | **Datos y adquisición** | Conseguir recortes NISAR reales de la ROI y sus metadatos, desde ASF hoy y desde la fuente del evento después | `pipeline/sources/**`, `pipeline/catalog.py`, `pipeline/inspect.py`, `pipeline/config.yaml`, `pipeline/tests/test_sources.py`, `pipeline/tests/test_inspect.py` | `p1/...` |
| **P2** | **Procesamiento SAR** | Convertir los recortes en dB, aplicar máscaras y producir los mapas de cambio | `pipeline/preprocess.py`, `pipeline/masks.py`, `pipeline/change.py`, `pipeline/run.py`, `pipeline/processing.yaml`, `pipeline/tests/test_preprocess.py`, `pipeline/tests/test_change.py` | `p2/...` |
| **P3** | **Ciencia, validación y documentación** | Elegir el fenómeno, validar con datos independientes y documentar qué significa cada resultado y qué no | `pipeline/compat.py`, `pipeline/validate.py`, `pipeline/auxiliary/**`, `pipeline/tests/test_compat.py`, `pipeline/tests/test_validate.py`, `docs/metodologia.md`, `docs/comparacion.md`, `AGENTS.md`, `README.md` | `p3/...` |
| **P4** | **Backend y API** | Guardar escenas y resultados en PostGIS y exponerlos por REST, incluidos los reportes | `backend/**` (modelos, serializers, vistas, `urls.py`, `settings.py`, comandos de gestión, migraciones), `docs/api.md` | `p4/...` |
| **P5** | **Frontend: estructura, Explorador y Comparador** | La aplicación web y los dos módulos de mapa | `web/` excepto `web/src/features/laboratorio/` y `web/src/features/exportacion/`. Es decir: `package.json`, lockfile, `vite.config.ts`, `web/src/App.tsx`, `routes`, `layout`, `api/`, `mocks/`, `components/`, `features/explorador/`, `features/comparador/` | `p5/...` |
| **P6** | **Plataforma, Laboratorio y Exportación** | Infraestructura (Docker, teselas, CI, despliegue) y los módulos de análisis visual y exportación | `docker-compose.yml`, `environment.yml`, `.gitignore`, `.env.example`, `.github/**`, `infra/**`, `web/src/features/laboratorio/**`, `web/src/features/exportacion/**` | `p6/...` |

### Archivos compartidos: dueño único y cómo pedir cambios

| Archivo | Dueño | Si otro necesita cambiarlo… |
|---|---|---|
| `environment.yml` (dependencias Python) | P6 | Pide la dependencia en un *issue*; P6 la agrega en un PR pequeño y avisa |
| `web/package.json` y lockfile (dependencias JS) | P5 | P6 pide la librería; P5 la instala |
| `backend/config/settings.py` y `urls.py` | P4 | Nadie más los toca. Si Exportación necesita un endpoint, P6 lo pide a P4 |
| `web/src/App.tsx` y rutas | P5 | En la Fase 0, P5 crea las 4 rutas con componentes vacíos que importan de cada `features/<modulo>/index.tsx`; después P6 solo edita dentro de sus carpetas |
| `pipeline/config.yaml` (ROI, búsqueda, comparabilidad) | P1 | Los parámetros de procesamiento van en `pipeline/processing.yaml` (P2), no aquí |
| `AGENTS.md`, `README.md` | P3 | Los demás envían el texto a P3 o comentan en su PR |

### Cobertura de los módulos de la propuesta

| Módulo (propuesta §9) | Dueño |
|---|---|
| Explorador global | P5 |
| Comparador temporal | P5 |
| Laboratorio científico | P6 |
| Exportación | P6 (interfaz) + P4 (endpoint del reporte) |
| ~~Asistente de investigación~~ | Fuera de alcance por ahora |

---

## 3. Contratos entre equipos (se acuerdan en la Fase 0)

Cada quien trabaja contra el contrato con datos simulados (*mocks*) sin esperar a los demás. **Un contrato solo se cambia con un PR que revisan su productor y todos sus consumidores.**

| ID | Contrato | Lo produce | Lo consume | Formato |
|---|---|---|---|---|
| **C1** | Recorte de escena | P1 | P2 | `data/raw/<scene_id>/<capa>.tif` (GeoTIFF, EPSG de la escena, nodata definido) + `data/raw/<scene_id>/scene.json` (= `SceneMeta.to_dict()` + capa, ROI, comando GDAL usado, fecha de descarga) |
| **C2** | Resultado de cambio | P2 | P3, P4, P6 | Carpeta `data/processed/<run_id>/` con `t1_db.tif`, `t2_db.tif`, `delta_db.tif`, `zscore.tif`, `change_mask.tif` (COG) y `run.json` (escenas, reporte de `compat`, parámetros, máscaras, estadísticas, `code_version`) |
| **C3** | Validación | P3 | P4, P6 | `data/processed/<run_id>/validation.json`: fuente auxiliar, fecha, resolución, métricas (precisión, recall, F1, IoU) **o** `"status": "exploratorio"` si no hay etiquetas |
| **C4** | API REST | P4 | P5, P6 | Documentada en `docs/api.md`: `GET /api/rois`, `GET /api/scenes?roi=&track=&maturity=`, `GET /api/changes`, `GET /api/changes/{id}` (con `run.json` y `validation.json` incrustados), `GET /api/compat?t1=&t2=`, `GET /api/changes/{id}/report` |
| **C5** | Teselas | P6 | P5, P6 | TiTiler: `/cog/tiles/{z}/{x}/{y}?url=<ruta COG>&rescale=…&colormap_name=…` |

**Primera tarea de la Fase 0:** P2 y P5 crean ejemplos *mock* de C2 y C4 (archivos pequeños, marcados como sintéticos) para que P4, P5 y P6 empiecen sin datos reales.

> Los mocks son **datos sintéticos de prueba**. Nunca se muestran como resultados ni se usan en la presentación (AGENTS.md §2.5).

---

## 4. Flujo de Git

1. **Antes de crear ramas:** se hace commit en `main` de todo lo que hay hoy en la carpeta del proyecto (configuración inicial, pipeline, documentos).
2. `main` está protegida: solo se modifica mediante Pull Request con **1 revisión aprobada** y pruebas en verde (la CI la configura P6).
3. Ramas con el prefijo del rol: `p1/recorte-asf`, `p2/conversion-db`, `p5/comparador-slider`…
4. Los PRs se mantienen pequeños (idealmente menos de 400 líneas). Al menos una vez al día: `git pull --rebase origin main`.
5. Un PR **solo toca archivos de su dueño**. Si toca otros, el revisor lo rechaza.
6. Se recomienda crear `.github/CODEOWNERS` (lo hace P6 en la Fase 0) con la tabla de la sección 2 y los usuarios de GitHub de cada integrante. Así GitHub pide automáticamente la revisión del dueño.
7. Mensajes de commit en español e imperativo: `Agrega recorte remoto a la ROI`.
8. **Nunca** se sube `.env`, `.netrc`, `data/` ni datos o resultados reales a git.

**Revisión cruzada recomendada:** P1↔P2 (pipeline), P3 revisa la parte científica de los PRs de P2, P4↔P6 (backend e infraestructura), P5↔P6 (frontend).

---

## 5. Fases y tareas

Las fechas se definen cuando se confirme el calendario del evento. Las fases son secuenciales; **dentro de cada fase los 6 trabajan en paralelo.**

### Fase 0: Arranque y contratos (todos, 1–2 días)

- [ ] **Todos:** clonar, seguir el README y pasar la checklist de instalación (§8 del README).
- [ ] **Todos los que descarguen datos (P1, P2, P3):** cuenta de Earthdata y `.netrc` propio.
- [ ] **Líder:** hacer commit en `main` del estado actual y proteger `main`.
- [ ] **P1 + P2:** acordar C1. **P2 + P3 + P4:** acordar C2 y C3. **P4 + P5 + P6:** acordar C4 y C5. Todo se escribe en `docs/api.md` (P4) y en el docstring de `pipeline/run.py` (P2).
- [ ] **P5:** crear `web/` con Vite + React + TypeScript + MapLibre GL y las 4 rutas vacías (Explorador, Comparador, Laboratorio, Exportación).
- [ ] **P6:** CI en GitHub Actions (`pytest`, `manage.py check`, `npm run build`, lint) y `CODEOWNERS`.

### Fase 1: Un par real, de principio a fin (antes del evento)

**Objetivo:** un mapa de Δσ⁰ real de un par de la pila T55/F80 (2026-06-18 → 2026-10-16, P05023), visible en la web.

| Rol | Tareas | Listo cuando… |
|---|---|---|
| **P1** | Implementar `ASFSource.fetch_subset` (gdalwarp remoto con `.netrc`, solo Frequency A). Crear `inspect.py`: lee del `.h5` la resolución, el CRS, las capas disponibles, la máscara y la cobertura real de la ROI (% de píxeles válidos). Descargar HHHH y HVHV de las fechas elegidas a `data/raw/`. Tener listo el borrador de `sources/event.py`. | Hay 2 recortes que cumplen C1, `inspect` confirma la misma malla y una cobertura de la ROI por encima del mínimo que fije P3, y hay pruebas |
| **P2** | `preprocess.py`: GCOV (potencia) → dB y manejo de nodata/ceros. `masks.py`: máscara del producto (layover/sombra) y pendiente con DEM. `change.py`: Δ en dB, razón, z-score respecto a la pila, umbral por estadística de la región. `run.py` orquesta todo y escribe C2. | `python -m pipeline.run --t1 … --t2 …` genera C2; hay pruebas de la conversión a dB y de Δ con arreglos sintéticos |
| **P3** | **Decidir el fenómeno** con los criterios de AGENTS.md §4 y documentarlo. Elegir **una** fuente auxiliar (precipitación, Sentinel-2 o inventario de eventos) y escribir su descarga en `pipeline/auxiliary/`. Implementar `validate.py` (precisión, recall, F1 e IoU, o modo exploratorio). Escribir `metodologia.md` en paralelo. | Fenómeno decidido y escrito; `validate.py` con pruebas; fuente auxiliar descargable de forma reproducible |
| **P4** | Modelos `ROI`, `Scene`, `ChangeResult` (AGENTS.md §8). Serializers y endpoints de C4 (con filtros). Comando `python manage.py load_run <run_id>` que lee C2/C3 y los guarda. `GET /api/compat` usando `pipeline.compat`. | Endpoints funcionando con el mock de C2; pruebas de API; `docs/api.md` completo |
| **P5** | **Explorador:** mapa MapLibre con el polígono de la ROI, lista de escenas desde `/api/scenes` y filtros por trayectoria, fecha y madurez. **Comparador:** elegir t1 y t2, mostrar la insignia de comparabilidad (errores en rojo, advertencias en ámbar, desde `/api/compat`), deslizador antes/después y capa Δσ⁰ con leyenda en dB. | Funciona con mocks; cada vista muestra fecha, producto, polarización, unidad y escala (propuesta §9.2) |
| **P6** | Servicio TiTiler en `docker-compose.yml` (C5). **Laboratorio:** histograma de Δσ⁰, estadísticas y tabla de parámetros, con cada cifra enlazada a su `run.json`. Preparar el despliegue (Dockerfiles en `infra/`). | TiTiler sirve un COG de prueba; el Laboratorio funciona con el mock |

### Fase 2: Integración, validación y exportación

| Rol | Tareas |
|---|---|
| **P1** | Descargar más fechas de la pila para el z-score (línea base). Documentar en `scene.json` cada descarga. |
| **P2** | Ajustar umbrales y máscaras con P3. Exportar COG optimizado para teselas. Celery solo si el tiempo de cómputo lo justifica (se coordina con P4). |
| **P3** | Ejecutar la validación sobre el resultado real. Escribir los límites: qué **no** indica Δσ⁰ (AGENTS.md §2.4). Completar `comparacion.md` con la revisión de herramientas existentes. Redactar el texto fijo de "qué significa y qué no" que se mostrará en la interfaz y en el reporte. |
| **P4** | Cargar los resultados reales con `load_run`. Endpoint `GET /api/changes/{id}/report`, que devuelve los datos del reporte (escenas, parámetros, métricas, validación y limitaciones). |
| **P5** | Conectar con la API real (quitar mocks). Panel de advertencias que distinga observación, inferencia y predicción, con el texto de P3. |
| **P6** | **Exportación:** descarga de GeoTIFF, PNG del mapa y reporte PDF/HTML generado con `/api/changes/{id}/report`. Cada cifra del reporte se puede rastrear hasta su `run.json`. |

### Fase 3: Evento (adaptación a los recursos de los organizadores)

| Rol | Tareas |
|---|---|
| **P1** | Implementar `sources/event.py` con lo que entreguen los organizadores y cambiar `source:` en `config.yaml`. **Es el único cambio necesario en la cadena de datos.** |
| **P2** | Volver a correr `run.py` con la nueva fuente y comparar contra el resultado de ASF. |
| **P3** | Revisar si cambia la comparabilidad o la validación con los nuevos datos; actualizar la metodología. |
| **P4–P6** | Desplegar (P6), cargar resultados (P4) y pulir la interfaz (P5). |

### Fase 4: Cierre y presentación

- [ ] **P3:** metodología, limitaciones y comparación finales. AGENTS.md y README al día.
- [ ] **P5 + P6:** demo de extremo a extremo grabada (respaldo por si falla la red).
- [ ] **P6:** despliegue público y reporte exportado de ejemplo.
- [ ] **Todos:** revisar que **cada cifra mostrada** se pueda rastrear hasta escenas, fechas, parámetros y código.

Con esto se cumplen los 7 puntos del **alcance mínimo viable** (propuesta §14), que no incluye el asistente conversacional.

---

## 6. Frontend en detalle

**Stack:** Vite + React + TypeScript + MapLibre GL. Teselas raster con TiTiler. Gráficas: una sola librería, que elige P5 y aprueba P6.

```
web/
├── package.json             # P5
├── vite.config.ts           # P5
└── src/
    ├── App.tsx, routes.tsx  # P5 (crea las 4 rutas en la Fase 0)
    ├── layout/              # P5: barra, navegación, tema
    ├── api/                 # P5: cliente tipado de C4 (lo usan todos los módulos)
    ├── mocks/               # P5: datos sintéticos de C4 (marcados como tales)
    ├── components/          # P5: componentes compartidos (Mapa base, Leyenda, InsigniaCompat)
    └── features/
        ├── explorador/      # P5
        ├── comparador/      # P5
        ├── laboratorio/     # P6
        └── exportacion/     # P6
```

**Para no chocar:** P6 **usa** `api/` y `components/` pero no los edita. Si necesita un endpoint o un componente compartido nuevo, lo pide a P5. Todo lo que solo usa un módulo vive dentro de la carpeta de ese módulo.

| Módulo | Contenido mínimo | Dueño |
|---|---|---|
| **Explorador** | Mapa con la ROI, escenas filtrables (fecha, trayectoria, dirección, madurez, CRID), detalle de metadatos por escena | P5 |
| **Comparador** | Selector t1/t2, insignia de comparabilidad con los motivos, deslizador antes/después en dB, capa Δσ⁰ con leyenda y unidad | P5 |
| **Laboratorio** | Histograma de Δσ⁰, estadísticas (media, desviación, percentiles, % de píxeles con cambio), parámetros y máscaras usados, enlace a `run.json` | P6 |
| **Exportación** | Descarga de GeoTIFF, PNG y reporte con trazabilidad y limitaciones | P6 |

**Reglas de interfaz** (propuesta §9 y AGENTS.md):

- Toda cifra muestra su unidad, fecha y fuente.
- Un resultado sin validación lleva la etiqueta **"Exploratorio"**.
- Nunca se dice "inundación" o "deforestación" como hecho: se dice "cambio en la retrodispersión" más la hipótesis y su evidencia.
- Los PNG de vista previa de ASF son solo para referencia visual; no se usan como capa de análisis.

---

## 7. Dependencias críticas y riesgos

| Riesgo | Afecta a | Mitigación |
|---|---|---|
| El recorte remoto con GDAL 3.12 falla (no tiene driver NISAR) | P1 → todos | Probar el recorte primero (es la tarea 1 de P1). Plan B: driver HDF5 genérico o actualizar GDAL (P6) |
| Smart App Control bloquea DLL en Windows | Quien use Windows | Trabajar en WSL2 o Docker; P6 documenta la alternativa |
| No hay etiquetas para validar | P3 | Marcar como exploratorio y contrastar cualitativamente con la fuente auxiliar (AGENTS.md §6) |
| La fuente del evento tiene otro formato | P1 | Capa `sources/` ya aislada; `inspect.py` detecta diferencias |
| Alguien edita archivos ajenos | Todos | CODEOWNERS + revisión obligatoria |
| Se cambia un contrato sin avisar | Todos | Solo por PR revisado por productor y consumidores |

---

## 8. Resumen rápido por persona

- **P1, Datos:** "Consigo los recortes reales y sus metadatos, hoy de ASF y en el evento de donde nos digan."
- **P2, Procesamiento:** "Convierto los recortes en dB y en mapas de cambio trazables."
- **P3, Ciencia:** "Decido qué medimos, lo valido con datos independientes y escribo qué significa y qué no."
- **P4, Backend:** "Guardo todo en PostGIS y lo sirvo por una API documentada, incluidos los datos del reporte."
- **P5, Frontend:** "Construyo la app, el mapa, el Explorador y el Comparador."
- **P6, Plataforma:** "Teselas, CI, despliegue, Laboratorio y Exportación."
