# Guía: generar las imágenes y capas web del par T62

> Para cualquier integrante del equipo. No hace falta descargar los `.h5` completos (~7 GB cada uno).
> Detalle técnico: [p1-etapa1-web.md](p1-etapa1-web.md). Dudas: P1.

Al terminar tendrás, para cada fecha del par de trabajo (GCOV T62/F10, 2026-06-18 y 2026-10-16):

- las figuras de inspección de la ROI (γ⁰ y σ⁰ en dB, histogramas, máscara, ángulo de incidencia);
- la carpeta `web/` que usa la interfaz: imágenes PNG para el mapa, COG con los valores en dB y el manifiesto `capas.json`;
- `graficas.json`: los números de las gráficas (histogramas, máscara, incidencia) para dibujarlas con Chart.js.

**Tiempo:** unos 4 minutos por fecha. **Datos que se bajan:** solo la zona de la ROI. **Espacio en disco:** ~500 MB por fecha.

---

## 1. Antes de empezar (una sola vez)

### 1.1 Código y entorno

```
git clone https://github.com/sarabiapillo/Space-app-SARS.git terrapulse
cd terrapulse
git checkout ETAPA-1
```

Si no tienes el entorno `nisar`, créalo como dice el [README](../README.md) §3. Comprueba que existe:

```
conda activate nisar
python -c "import h5py, rasterio, earthaccess; print('ok')"
```

### 1.2 Cuenta de NASA Earthdata

1. Crea una cuenta en https://urs.earthdata.nasa.gov/ (gratis).
2. Entra una vez a **ASF Vertex** (https://search.asf.alaska.edu/) con esa cuenta y **acepta sus términos de uso**. Sin este paso el servidor responde "no autorizado".

### 1.3 Credenciales

Copia `.env.example` a `.env` en la raíz del repo, si aún no lo tienes, y llena estas dos líneas con **tu** usuario y contraseña:

```
EARTHDATA_USERNAME=tu_usuario
EARTHDATA_PASSWORD=tu_contraseña
```

- `.env` está en `.gitignore`: **nunca** lo subas a git ni pegues tu contraseña en chats o issues.
- Cada integrante usa su propia cuenta.
- Alternativa: un archivo `%USERPROFILE%\.netrc` con `machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CONTRASEÑA` (README §7). Si existen ambos, gana el `.env`.

---

## 2. Generar las capas

Abre **Anaconda Prompt** (o Miniforge Prompt) y ejecuta desde la **raíz del repo**:

```
conda activate nisar
cd C:\ruta\a\terrapulse

python -m pipeline.catalog

python -m pipeline.etapa1 NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001 --escala-web -22 0

python -m pipeline.etapa1 NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001 --escala-web -22 0
```

Qué hace cada comando:

| Comando | Qué hace |
|---|---|
| `python -m pipeline.catalog` | Consulta ASF y guarda el catálogo en `data/catalog/`. `etapa1` busca ahí la URL de cada escena. Si ya tienes un catálogo, puedes omitirlo |
| `python -m pipeline.etapa1 <scene_id> ...` | Abre el `.h5` en el servidor de NASA, verifica que es la escena del catálogo, baja solo la ROI y genera figuras y capas web |
| `--escala-web -22 0` | Pinta las imágenes de −22 dB (negro) a 0 dB (blanco) |

**No cambies `-22 0` en una sola fecha.** Las dos fechas deben usar la misma escala; si no, en el deslizador antes/después de la web se verá un cambio de brillo que solo sería de escala, no del terreno. Ese rango cubre los percentiles 2–98 de γ⁰ y σ⁰, HH y HV, medidos en la escena del 2026-06-18. Si el equipo decide otro rango, se regeneran **ambas** fechas con el nuevo valor.

### Lo que verás en la consola

```
[22:55:53] Modo remoto: NISAR_L2_PR_GCOV_023_..._001 (catálogo catalog_asf_GCOV_....json); solo se leen los bloques de la ROI
[22:56:03] GCOV malla A: 33480x34128 px de 10 m, EPSG:32615, capas HHHH, HVHV, magnitud gamma0
[22:56:03] Ventana ROI: filas 15866-18553, columnas 9173-14677 (2687x5504 px)
[22:56:31] Pixeles validos dentro del poligono ROI: 99.574 %
[22:57:24] HHHH: gamma0 leido (2687x5504) en 16.2 s
[22:58:06] HVHV: gamma0 leido (2687x5504) en 14.8 s
[22:58:30] Vista general omitida en modo remoto (...)
[22:59:10] Figuras listas
[22:59:35] Capas web listas en 25 s -> data/explore/<scene_id>/web
[22:59:35] Listo en 222.3 s -> data/explore/<scene_id>
```

- "Vista general omitida" es normal. Esa figura (A) necesita el archivo completo.
- Puede haber avisos `Warning` de rasterio. No son errores.
- La segunda fecha debe dar **99.61 %** de píxeles válidos y la misma ventana (2687 × 5504 px).

---

## 3. Dónde quedan los resultados

```
data/explore/<scene_id>/
├── figuras/             B_roi_gamma0_dB.png, B2_roi_sigma0_dB.png, C_histogramas_gamma0_dB.png,
│                        D_mascara.png, E_incidencia.png
├── web/                 lo que usa la interfaz web
│   ├── capas.json                   manifiesto: esquinas, escala, escena y procedencia
│   ├── gamma0_HHHH_ml2_dB.png/.tif  γ⁰ HH (PNG para ver en el mapa, COG con los valores)
│   ├── gamma0_HVHV_ml2_dB.png/.tif
│   ├── sigma0_HHHH_ml2_dB.png/.tif
│   └── sigma0_HVHV_ml2_dB.png/.tif
├── geotiff/             γ⁰ y σ⁰ lineales y en dB, máscara, factor, looks
├── control/             píxeles para comprobar a mano
├── graficas.json        datos de las gráficas para Chart.js y la base de datos
├── metadatos.json       todo lo calculado, con la versión del código y la URL de origen
└── LEEME_validacion.txt comprobaciones a mano
```

**Comprobación rápida:**

1. Abre `web/gamma0_HHHH_ml2_dB.png`: se ve el río Grijalva y el Cañón del Sumidero en oscuro, y Tuxtla Gutiérrez en claro.
2. En `web/capas.json`, ambas fechas deben tener `"vmin_dB": -22` y `"vmax_dB": 0`.
3. En `metadatos.json → procedencia`, debe decir `"modo": "remoto"` e `"identidad_verificada_contra_catalogo": true`.

**`data/` no se sube a git.** Cada quien lo genera con estos comandos; los valores salen idénticos para todos.

---

## 4. Para el frontend (P5/P6)

- Para mostrar una capa en MapLibre, usar el PNG y `esquinas_lonlat` de `capas.json` como fuente `image`. Las esquinas ya vienen en el orden del tipo `Footprint` (sup-izq, sup-der, inf-der, inf-izq).
- La leyenda va de gris negro = `vmin_dB` a blanco = `vmax_dB`, en dB.
- Los valores (cursor, histogramas) salen del COG `.tif`, nunca del PNG.
- Las gráficas de la escena (histogramas, máscara, incidencia por altura) salen de `graficas.json`. Formato y ejemplo de Chart.js en [p1-graficas-chartjs.md](p1-graficas-chartjs.md).
- Mostrar las `advertencias` del manifiesto junto a la capa.

Ejemplos de código y formato completo: [p1-etapa1-web.md](p1-etapa1-web.md) §4–5.

---

## 5. Si algo falla

| Mensaje | Qué hacer |
|---|---|
| `No se pudo iniciar sesión en Earthdata` | Revisa usuario y contraseña en `.env` (sin espacios ni comillas extra). El mensaje dice qué respondió Earthdata |
| `401` / `403` / "no autorizado" al abrir el archivo | Entra a ASF Vertex con tu cuenta y acepta los términos (§1.2) |
| `No hay catálogos en data/catalog` | Corre `python -m pipeline.catalog` |
| `No están en catalog_...json` | Copia el `scene_id` completo, sin espacios. Si ASF reprocesó la escena, su ID cambió: avisa a P1 |
| `El archivo no coincide con la escena del catálogo` | El servidor devolvió otro producto: no lo uses y avisa a P1 |
| `ModuleNotFoundError: No module named 'pipeline'` | Estás fuera de la raíz del repo. Haz `cd` a la carpeta `terrapulse` |
| `conda` no se reconoce | Usa Anaconda/Miniforge Prompt, no PowerShell ni CMD normales |
| `UnicodeEncodeError` en la consola | Ejecuta `set PYTHONIOENCODING=utf-8` y repite |
| Se corta la red a mitad | Vuelve a ejecutar el mismo comando: sobrescribe la carpeta de esa escena |

---

## 6. En Linux, macOS o el servidor

Los mismos comandos en una terminal con el entorno activado. Las credenciales pueden ir en `.env` o como variables de entorno del sistema o del hosting, que tienen prioridad:

```bash
conda activate nisar
cd ~/terrapulse
export EARTHDATA_USERNAME=...   # o en el .env / panel del hosting
export EARTHDATA_PASSWORD=...
python -m pipeline.catalog
python -m pipeline.etapa1 NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001 --escala-web -22 0
python -m pipeline.etapa1 NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001 --escala-web -22 0
```

En un servidor, las credenciales van en las variables del hosting, no en un archivo dentro de la imagen de Docker (AGENTS.md §12).
