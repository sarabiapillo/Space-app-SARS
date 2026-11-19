# TerraPulse AI

*El pulso cambiante de nuestro planeta.*

Plataforma abierta que procesa observaciones de radar de la misión NASA–ISRO **NISAR**, detecta cambios en la superficie terrestre y presenta evidencia trazable: **dato original → procesamiento → métrica → interpretación**.

Proyecto para NASA Space Apps 2026 (*Be an Earth System Trend Detective*). Caso de estudio: Chiapas, México.

> **Estado (2026-11-14):** hay un par GCOV comparable recortado a la ROI (T62/F10, 2026-06-18 → 2026-10-16, ~99.6 % de cobertura). Todavía no hay mapa de cambio ni validación. Detalle en [docs/metodologia.md](docs/metodologia.md).

Plan del equipo, roles y reglas de ramas: [docs/plan-de-trabajo.md](docs/plan-de-trabajo.md). Adquisición de datos (P1), cómo correr los scripts y formato de los recortes: [docs/p1-datos.md](docs/p1-datos.md). Generar las imágenes y capas web del par T62 sin descargar los `.h5`: [docs/guia-capas-web.md](docs/guia-capas-web.md).

Antes de contribuir, lee [AGENTS.md](AGENTS.md). Ahí están las reglas científicas y de trabajo del proyecto, que aplican a personas y a agentes de IA por igual.

---

## Contenido

1. [Requisitos previos](#1-requisitos-previos)
2. [Clonar el repositorio](#2-clonar-el-repositorio)
3. [Crear el entorno de Python](#3-crear-el-entorno-de-python)
4. [Configurar variables de entorno](#4-configurar-variables-de-entorno)
5. [Levantar la base de datos (PostGIS)](#5-levantar-la-base-de-datos-postgis)
6. [Preparar Django](#6-preparar-django)
7. [Cuentas y acceso a datos (Earthdata)](#7-cuentas-y-acceso-a-datos-earthdata)
8. [Verificar la instalación](#8-verificar-la-instalación)
9. [Problemas frecuentes](#9-problemas-frecuentes)
10. [Estructura del proyecto](#10-estructura-del-proyecto)
11. [Caso de estudio: ROI y escenas](#11-caso-de-estudio-roi-y-escenas)

---

## 1. Requisitos previos

Instala lo siguiente antes de empezar:

| Herramienta | Para qué | Enlace |
|---|---|---|
| **Git** | Clonar el repositorio | https://git-scm.com/downloads |
| **Miniforge** (conda) | Entorno de Python con GDAL | https://github.com/conda-forge/miniforge |
| **Docker Desktop** | Base de datos PostGIS | https://www.docker.com/products/docker-desktop/ |
| **Cuenta NASA Earthdata** | Descargar productos NISAR | https://urs.earthdata.nasa.gov/users/new |

Recomendado: **VS Code** con la extensión de Python.

> Usa Miniforge y no `pip` solo. GDAL, rasterio y geopandas dependen de bibliotecas nativas que en Windows solo se instalan bien desde conda-forge.

## 2. Clonar el repositorio

```bash
git clone https://github.com/sarabiapillo/Space-app-SARS.git terrapulse
cd terrapulse
```

## 3. Crear el entorno de Python

Abre **Miniforge Prompt** en Windows, o una terminal en Linux/macOS, dentro de la carpeta del proyecto:

```bash
conda env create -f environment.yml
conda activate nisar
```

Esto crea el entorno `nisar` (Python 3.11) con GDAL, rasterio, h5py, xarray, geopandas, Django, DRF, asf_search, earthaccess, celery y pytest.

Si [environment.yml](environment.yml) cambia más adelante, actualiza tu entorno con:

```bash
conda env update -n nisar -f environment.yml
```

**VS Code:** abre la paleta (`Ctrl+Shift+P`) → *Python: Select Interpreter* → elige `nisar`. Si no lo eliges, el editor marcará los imports como no encontrados.

## 4. Configurar variables de entorno

Copia la plantilla y edítala:

```bash
# Windows
copy .env.example .env
# Linux / macOS
cp .env.example .env
```

Genera tu propia clave secreta de Django y pégala en `DJANGO_SECRET_KEY`:

```bash
python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"
```

Cambia también `POSTGRES_PASSWORD`. Docker Compose usa el mismo `.env` para crear la base, así que la contraseña queda definida en un solo lugar.

> ⚠️ **`.env` nunca se sube a git** (está en [.gitignore](.gitignore)). No compartas su contenido en issues, chats ni capturas.

## 5. Levantar la base de datos (PostGIS)

Abre Docker Desktop y espera a que termine de arrancar. Luego, desde la raíz del proyecto:

```bash
docker compose up -d
docker compose ps        # el servicio "db" debe aparecer como "running"
```

> **¿Tienes PostgreSQL instalado en tu computadora?** Ocupa el mismo puerto (5432) y Django se conectará a él en lugar de al contenedor. Verás un error como *"password authentication failed for user terrapulse"*. Tienes dos opciones:
> - **Detener el servicio local.** En Windows: `services.msc` → `postgresql-x64-NN` → *Detener*. Ponlo en *Manual* para que no vuelva a arrancar al reiniciar.
> - **Usar otro puerto.** Pon `POSTGRES_PORT=5433` en `.env` y ejecuta `docker compose up -d` de nuevo.

## 6. Preparar Django

```bash
cd backend
python manage.py check          # debe decir: "System check identified no issues"
python manage.py migrate
python manage.py createsuperuser   # opcional, para entrar a /admin
python manage.py runserver
```

Abre http://127.0.0.1:8000/admin/ para comprobar que el servidor responde.

## 7. Cuentas y acceso a datos (Earthdata)

Una sola cuenta **NASA Earthdata Login** da acceso a todo lo que usa el proyecto: NISAR (ASF) y las fuentes auxiliares candidatas (precipitación, óptico, OPERA). Algunos archivos (DAAC) piden además autorizarlos una vez en tu perfil.

| Datos | Archivo (DAAC) | Qué hay que hacer además de la cuenta |
|---|---|---|
| NISAR GCOV (fuente principal) | ASF | Iniciar sesión una vez en https://search.asf.alaska.edu/ y aceptar los términos de uso |
| GPM IMERG (precipitación) | GES DISC | **Autorizar la aplicación** "NASA GESDISC DATA ARCHIVE" en https://urs.earthdata.nasa.gov/ → *Applications* → *Authorized Apps* → *Approve More Applications*. Sin esto la descarga devuelve **403 Forbidden** |
| HLS (óptico, Landsat/Sentinel-2) y OPERA DIST | LP DAAC | Nada adicional (comprobado el 2026-11-14) |
| OPERA DSWx (agua superficial) | PO.DAAC | Nada adicional (comprobado el 2026-11-14) |

Recursos de agencias socias del reto (**opcionales**, no se usan hoy; ver [docs/metodologia.md](docs/metodologia.md)): **SAOCOM** (CONAE) requiere registrarse en su catálogo con un perfil *ONE CLICK*; **RCM** y **RADARSAT-1** (CSA) tienen sus propias condiciones de acceso. Son sitios no estadounidenses: cada uno tiene sus condiciones de uso de datos y hay que respetarlas.

El pipeline acepta las credenciales de dos formas. Si están las dos, **gana `.env`**:

- **`.env` (recomendado en servidor):** agrega a tu `.env` (ver paso 4)
  ```
  EARTHDATA_USERNAME=tu_usuario
  EARTHDATA_PASSWORD='tu_contraseña'
  ```
  Usa comillas simples si la contraseña tiene caracteres especiales. En un servidor (Docker, EC2) es mejor definirlas como variables de entorno del sistema: las variables del sistema tienen prioridad y el archivo no las sobrescribe.
- **`.netrc` (cómodo en tu computadora):** un archivo en tu carpeta personal, **fuera del repositorio**:

1. Crea una cuenta en https://urs.earthdata.nasa.gov/ si aún no tienes una.
2. Haz las autorizaciones de la tabla anterior (como mínimo, la de ASF).
3. Si usas `.netrc`, créalo con este contenido, usando tus datos:

   ```
   machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CONTRASEÑA
   ```

   | Sistema | Ruta |
   |---|---|
   | Windows | `%USERPROFILE%\.netrc` (por ejemplo, `C:\Users\tu_usuario\.netrc`) |
   | Linux / macOS | `~/.netrc`, y luego ejecuta `chmod 600 ~/.netrc` |

   En Windows, revisa que el Bloc de notas no lo guarde como `.netrc.txt`.

   > En Windows, `earthaccess` busca `_netrc` (con guion bajo) en lugar de `.netrc`. No hace falta duplicar el archivo: el pipeline usa `.netrc` automáticamente si no existe `_netrc`.

> ⚠️ **Nunca** copies `.netrc` dentro del proyecto ni pegues su contenido en el código, los issues o los commits.

## 8. Verificar la instalación

Con `nisar` activado, desde la raíz del proyecto:

```bash
python -c "from osgeo import gdal; import rasterio, h5py, xarray, rioxarray, geopandas, asf_search, earthaccess, django, rest_framework; print('OK - GDAL', gdal.__version__)"
gdalinfo --version
docker compose ps
pytest                      # pruebas del pipeline
python -m pipeline.catalog  # consulta el catálogo NISAR sobre la ROI (no requiere .netrc)
```

Para probar el acceso con tu `.netrc`, recorta el par de trabajo a `data/raw/` (unos 3–4 minutos; solo se descargan los bloques de la ROI, no los ~7 GB de cada producto):

```bash
python -m pipeline.download NISAR_L2_PR_GCOV_023_062_A_010_4005_DHDH_A_20260618T114010_20260618T114044_P05023_N_F_J_001 NISAR_L2_PR_GCOV_033_062_A_010_4005_DHDH_A_20261016T114006_20261016T114041_P05023_N_F_J_001
```

Al final debe imprimir `COMPARABLE`.

Checklist:

- [ ] Todos los imports funcionan.
- [ ] `docker compose ps` muestra `db` en ejecución.
- [ ] `python manage.py check` termina sin errores.
- [ ] `python manage.py migrate` termina sin errores.
- [ ] Existe tu `.netrc`, fuera del repositorio.

## 9. Problemas frecuentes

**`DLL load failed ... Una directiva de Control de aplicaciones bloqueó este archivo`** (Windows)
*Smart App Control* o una política de Windows está bloqueando bibliotecas del entorno conda. Afecta, por ejemplo, a pandas, geopandas y earthaccess. Revísalo en *Seguridad de Windows → Control de aplicaciones y navegador → Smart App Control*. Ten en cuenta que, si lo desactivas, no se puede volver a activar sin reinstalar Windows. La alternativa es trabajar dentro de WSL2.

**`password authentication failed for user "terrapulse"`**
Hay otro PostgreSQL ocupando el puerto 5432. Consulta el [paso 5](#5-levantar-la-base-de-datos-postgis).
También puede pasar que hayas cambiado `POSTGRES_PASSWORD` después de crear el contenedor. La contraseña solo se aplica la primera vez, así que tienes que recrear el volumen con `docker compose down -v`, y luego `docker compose up -d`. **Esto borra los datos de la base.**

**`Falta la variable de entorno ...`**
No existe el archivo `.env` o le falta esa variable. Consulta el [paso 4](#4-configurar-variables-de-entorno).

**`Warning: Cannot find ... (GDAL_DATA is not defined)`**
Activa el entorno con `conda activate nisar` en lugar de llamar directamente al `python.exe` del entorno. La activación define `GDAL_DATA` y el `PATH`.

**El driver NISAR de GDAL no aparece**
El GDAL del entorno (3.12 de conda-forge) no trae el driver NISAR ni el HDF5 genérico, así que `gdalwarp` no puede leer los `.h5`. No hace falta: el pipeline lee los `.h5` con `h5py` (`pipeline/nisar_h5.py`, `pipeline/sources/subset.py`), tanto locales como remotos.

**`Sin credenciales de Earthdata` o `No se pudo iniciar sesión en Earthdata`**
Revisa que exista `%USERPROFILE%\.netrc` (o `~/.netrc`) con la línea del paso 7 y que el usuario y la contraseña sean correctos. El mensaje de error incluye el motivo que dio Earthdata.

**`403 Forbidden` al descargar precipitación (GPM IMERG)**
Falta autorizar la aplicación de GES DISC en tu perfil de Earthdata (tabla del paso 7).

## 10. Estructura del proyecto

```
terrapulse/
├── AGENTS.md            # Reglas del proyecto (léelo primero)
├── README.md
├── environment.yml      # Entorno conda "nisar"
├── docker-compose.yml   # PostGIS
├── .env.example         # Plantilla de variables de entorno
├── docs/                # Propuesta, metodología, comparación
├── data/                # Datos locales — NO va a git
│   ├── raw/
│   └── processed/
├── pipeline/            # Procesamiento SAR en Python puro (sin Django)
│   ├── config.yaml      # ROI, comparabilidad y par de trabajo
│   ├── catalog.py       # consulta el catálogo y agrupa pilas
│   ├── download.py      # recorta escenas a la ROI en data/raw/
│   ├── nisar_h5.py      # lectura por ventanas de los .h5 NISAR
│   ├── etapa1.py        # inspección de una escena (figuras y control)
│   ├── elevation/       # proveedor NASADEM para la simulación de inundación
│   ├── hydrology/       # cadena DG2: DEM, lluvia sintética, solver y resultados
│   └── sources/         # fuentes de datos intercambiables (ASF) y recorte
├── backend/             # Django + GeoDjango + DRF
│   ├── config/
│   ├── scenes/
│   └── analyses/
└── web/                 # Frontend React + TypeScript + Vite + MapLibre; la inundación DG2 usa la API real
```

`pipeline/` no depende de Django, así que el procesamiento SAR se puede probar desde la terminal sin levantar el servidor.

**Simulación de inundación (exploratoria).** Existe una cadena DG2 no urbana: `pipeline/elevation/` adquiere NASADEM y `pipeline/hydrology/` prepara el DEM DG2, genera lluvia sintética reproducible, ejecuta LISFLOOD-FP 8.0.3 DG2 (CPU, compilado localmente en `data/tools/lisflood-fp-8.0/`; GPLv2, sin redistribuirlo) y convierte las salidas a COG. El backend la expone mediante la API autenticada descrita en [docs/api-simulacion-roi.md](docs/api-simulacion-roi.md) y el panel web *Inundación ROI / DG2* la consume. Configuración y comprobación del servicio: [docs/configuracion-servicio-inundacion.md](docs/configuracion-servicio-inundacion.md). Los resultados son **sintéticos y sin validación hidráulica**. Ya se completó una simulación real NASADEM + DG2 de prueba sobre un dominio de ~1 km²; los presupuestos por defecto solo admiten dominios pequeños, no la ROI completa. Diseño y ecuaciones: [flujo DG2](docs/flujo-dg2-simulacion-inundacion.tex) y [simulación DG2](docs/simulacion-inundacion-dg2.tex).

## 11. Caso de estudio: ROI y escenas

**ROI** (Chiapas, México; EPSG:4326; en `pipeline/config.yaml`):

```
POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))
```

Cobertura de la ROI por pila GCOV P05023 PROVISIONAL (píxeles válidos dentro del polígono, según la capa `mask` del producto; verificado el 2026-11-14):

| Pila | Dirección | Cobertura de la ROI | Uso |
|---|---|---|---|
| **T62 / F10** | Ascendente | **~99.6 %** | **Par de trabajo:** 2026-06-18 → 2026-10-16 |
| T55 / F80 | Descendente | ~50 % (solo al este de lon ≈ −93.14) | Respaldo |
| T156 / F80 | Descendente | Sin verificar | — |

En la malla de los recortes (EPSG:32615, UTM 15N, 10 m), la ROI ocupa 2687 × 5504 px. El detalle de escenas, comparabilidad y fuentes de validación candidatas está en [docs/metodologia.md](docs/metodologia.md).

## Referencias

- Documentación NISAR (ASF): https://nisar-docs.asf.alaska.edu/
- ASF Data Search (Vertex): https://search.asf.alaska.edu/
- NASA Earthdata: https://www.earthdata.nasa.gov/
- Reto Space Apps 2026: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/
