# TerraPulse AI

*El pulso cambiante de nuestro planeta.*

Plataforma abierta que procesa observaciones de radar de la misión NASA–ISRO **NISAR**, detecta cambios en la superficie terrestre y presenta evidencia trazable: **dato original → procesamiento → métrica → interpretación**.

Proyecto para NASA Space Apps 2026 (*Be an Earth System Trend Detective*). Caso de estudio: Chiapas, México.

> **Estado:** configuración inicial. Todavía no hay resultados ni un par de escenas comparables confirmado.

Plan del equipo, roles y reglas de ramas: [docs/plan-de-trabajo.md](docs/plan-de-trabajo.md).

Antes de contribuir, lee [AGENTS.md](AGENTS.md). Ahí están las reglas científicas y de trabajo del proyecto, que aplican a personas y a agentes de IA por igual.

---

## Contenido

1. [Requisitos previos](#1-requisitos-previos)
2. [Clonar el repositorio](#2-clonar-el-repositorio)
3. [Crear el entorno de Python](#3-crear-el-entorno-de-python)
4. [Configurar variables de entorno](#4-configurar-variables-de-entorno)
5. [Levantar la base de datos (PostGIS)](#5-levantar-la-base-de-datos-postgis)
6. [Preparar Django](#6-preparar-django)
7. [Configurar el acceso a datos NISAR (Earthdata)](#7-configurar-el-acceso-a-datos-nisar-earthdata)
8. [Verificar la instalación](#8-verificar-la-instalación)
9. [Problemas frecuentes](#9-problemas-frecuentes)
10. [Estructura del proyecto](#10-estructura-del-proyecto)

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

## 7. Configurar el acceso a datos NISAR (Earthdata)

GDAL, `asf_search` y `earthaccess` se autentican con un archivo `.netrc` que vive en tu carpeta personal, **fuera del repositorio**.

1. Crea una cuenta en https://urs.earthdata.nasa.gov/ si aún no tienes una.
2. Inicia sesión una vez en https://search.asf.alaska.edu/ con esa cuenta y acepta los términos de uso que te pida ASF.
3. Crea el archivo con este contenido, usando tus datos:

   ```
   machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CONTRASEÑA
   ```

   | Sistema | Ruta |
   |---|---|
   | Windows | `%USERPROFILE%\.netrc` (por ejemplo, `C:\Users\tu_usuario\.netrc`) |
   | Linux / macOS | `~/.netrc`, y luego ejecuta `chmod 600 ~/.netrc` |

   En Windows, revisa que el Bloc de notas no lo guarde como `.netrc.txt`.

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
AGENTS.md recomienda GDAL ≥ 3.13, que incluye el driver NISAR. Puedes comprobar tu versión con `gdalinfo --version`. Las versiones anteriores pueden leer los archivos `.h5` mediante el driver HDF5 genérico (`HDF5:"archivo.h5"://ruta/al/dataset`).

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
│   └── config.yaml      # ROI y criterios de comparabilidad
├── backend/             # Django + GeoDjango + DRF
│   ├── config/
│   ├── scenes/
│   └── analyses/
└── web/                 # Frontend (React + MapLibre), pendiente
```

`pipeline/` no depende de Django, así que el procesamiento SAR se puede probar desde la terminal sin levantar el servidor.

## Referencias

- Documentación NISAR (ASF): https://nisar-docs.asf.alaska.edu/
- ASF Data Search (Vertex): https://search.asf.alaska.edu/
- NASA Earthdata: https://www.earthdata.nasa.gov/
- Reto Space Apps 2026: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/
