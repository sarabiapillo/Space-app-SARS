# Base de datos en Docker (PostGIS): crearla, cargarla y revisarla

> Para cualquier integrante del equipo. Actualizado: 2026-11-15.
> Archivos: `docker-compose.yml` (P6), `backend/` (P4). API que la consume: [api.md](api.md).

Al terminar tendrás PostgreSQL 16 + PostGIS 3.4 corriendo en un contenedor, con las tablas de Django creadas y, si quieres, con las inspecciones de la Etapa 1 cargadas.

```
data/explore/<escena>/metadatos.json + graficas.json  ──►  python manage.py load_explore  ──►  PostGIS (Docker)  ──►  /api/…
```

---

## 1. Requisitos (una sola vez)

| Qué | Para qué |
|---|---|
| **Docker Desktop** (Windows/macOS) o Docker Engine (Linux) | Corre el contenedor de PostGIS |
| Entorno conda `nisar` (README §3) | Django, GeoDjango y el driver `psycopg` |
| Archivo `.env` en la raíz (copia de `.env.example`) | Credenciales de la base y de Django. **No se sube a git** |

Variables de `.env` que usan la base y Django:

| Variable | Ejemplo | Notas |
|---|---|---|
| `POSTGRES_DB` | `terrapulse` | Nombre de la base |
| `POSTGRES_USER` | `terrapulse` | Usuario |
| `POSTGRES_PASSWORD` | *(la que elijas)* | Solo se aplica **la primera vez** que se crea el volumen (§7) |
| `POSTGRES_HOST` | `localhost` | Desde Django en tu máquina |
| `POSTGRES_PORT` | `5432`, o `5433` si ya tienes PostgreSQL instalado (§2.1) | Puerto **de tu máquina**. Dentro del contenedor siempre es 5432 |
| `DJANGO_SECRET_KEY` | *(cadena larga al azar)* | Obligatoria |
| `DJANGO_DEBUG` | `True` en desarrollo | |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | |

Docker Compose lee el mismo `.env`, así que la contraseña se define en un solo lugar.

---

## 2. Levantar el contenedor

Abre Docker Desktop y espera a que diga *Engine running*. Luego, desde la raíz del repo:

```
docker compose up -d
docker compose ps                 # "db" debe aparecer como running
docker compose exec db pg_isready # debe decir "accepting connections"
```

`docker-compose.yml` define:
- **Servicio `db`:** imagen `postgis/postgis:16-3.4`. El puerto `${POSTGRES_PORT:-5432}` de tu máquina va al 5432 del contenedor.
- **Volumen `pgdata`:** ahí viven los datos. Sobreviven a `docker compose down` y a reiniciar la computadora.

### 2.1 ¿Ya tienes PostgreSQL instalado en tu computadora?

Si en Windows tienes un servicio como `postgresql-x64-18`, ese PostgreSQL ocupa el puerto 5432. Entonces Django se conecta a él en lugar de al contenedor, y verás:

```
FATAL: la autentificación password falló para el usuario «terrapulse»
(o: password authentication failed for user "terrapulse")
```

Para comprobarlo en PowerShell:

```
Get-NetTCPConnection -LocalPort 5432 -State Listen | ForEach-Object { (Get-Process -Id $_.OwningProcess).ProcessName }
Get-Service *postgres*
```

Si aparece `postgres` además de `com.docker.backend` / `wslrelay`, hay conflicto. **Solución recomendada** (no toca tu otro PostgreSQL):

1. En `.env`: `POSTGRES_PORT=5433`
2. `docker compose up -d`. Esto recrea el contenedor con el puerto nuevo y conserva los datos del volumen.

La otra opción es detener el servicio de Windows (`Stop-Service postgresql-x64-18`, como administrador), si no lo usas.

---

## 3. Crear las tablas

Desde `backend/`, con el entorno `nisar` activado:

```
cd backend
python manage.py migrate
python manage.py createsuperuser   # opcional: para entrar a /admin/
```

`migrate` crea:
- las tablas de Django (usuarios, sesiones, admin);
- la extensión PostGIS, que GeoDjango activa sola;
- las tablas de la app `scenes`.

| Tabla | Modelo | Qué guarda |
|---|---|---|
| `scenes_roi` | `ROI` | Nombre y polígono de la región (EPSG:4326) |
| `scenes_scene` | `Scene` | Una escena NISAR: granuleId, producto, trayectoria, marco, dirección, polarizaciones, frecuencia, banda, EPSG, CRID, madurez, fecha y huella |
| `scenes_sceneinspection` | `SceneInspection` | Una corrida de `etapa1`: versión del código, % válido en la ROI, estadísticas, procedencia, advertencias y carpeta de origen |
| `scenes_scenechart` | `SceneChart` | Cada gráfica de `graficas.json` tal cual (`jsonb`) |

Los modelos están en `backend/scenes/models.py`. `ChangeResult` (resultados de cambio, C2) se agregará cuando P2 produzca `run.json`.

---

## 4. Cargar datos

La base **no** lee los `.h5`. Carga lo que ya produjo el pipeline:

```
# 1) Generar la inspección de cada fecha (desde la raíz del repo; ~4 min por fecha, en remoto)
python -m pipeline.etapa1 <scene_id> --escala-web -22 0

# 2) Cargarla (desde backend/)
python manage.py load_explore <scene_id> [<scene_id> ...]
python manage.py load_explore --todas          # todas las carpetas de data/explore/
```

Salida esperada:

```
NISAR_L2_PR_GCOV_023_062_A_010_…_001: inspección creada (código <commit>), 3 gráficas
```

- **Misma versión del código:** volver a cargarla reemplaza esa inspección.
- **Otra versión:** agrega una inspección nueva y conserva las anteriores.
- **Se detiene sin guardar nada** en estos casos:
  - falta `graficas.json` (carpetas generadas antes del 2026-11-15; hay que volver a correr `etapa1`);
  - `graficas.json` y `metadatos.json` son de corridas distintas;
  - las gráficas son de otra escena.

---

## 5. Revisar lo que hay

**Panel de Django:** `python manage.py runserver` y abrir http://localhost:8000/admin/.

**API:** http://localhost:8000/api/scenes (ver [api.md](api.md)).

**SQL directo**, dentro del contenedor y sin instalar nada:

```
docker compose exec db psql -U terrapulse -d terrapulse
```

```sql
\dt scenes_*
SELECT name, start_time, track, frame, crid, maturity FROM scenes_scene;
SELECT s.name, i.code_version, i.pct_valid_in_roi
  FROM scenes_sceneinspection i JOIN scenes_scene s ON s.id = i.scene_id;
SELECT chart_id, pg_column_size(data) AS bytes FROM scenes_scenechart;
\q
```

(Cambia `terrapulse` por tu `POSTGRES_USER` / `POSTGRES_DB` si usas otros.)

---

## 6. Pruebas

```
cd backend
python manage.py test scenes
```

- Django crea una base temporal `test_<POSTGRES_DB>`, corre las pruebas y la borra. Necesita el contenedor encendido.
- El usuario de la imagen `postgis/postgis` puede crear bases, así que no hay que dar permisos extra.

---

## 7. Operaciones frecuentes

| Quiero… | Comando | ¿Borra datos? |
|---|---|---|
| Apagar el contenedor | `docker compose stop` | No |
| Apagarlo y quitarlo | `docker compose down` | No (el volumen queda) |
| Encenderlo de nuevo | `docker compose up -d` | No |
| Ver los logs | `docker compose logs -f db` | No |
| Respaldar la base | `docker compose exec -T db pg_dump -U terrapulse -Fc terrapulse > respaldo.dump` | No |
| Restaurar un respaldo | `docker compose exec -T db pg_restore -U terrapulse -d terrapulse --clean < respaldo.dump` | Reemplaza lo que haya |
| Empezar de cero (o aplicar una contraseña nueva) | `docker compose down -v` y luego `docker compose up -d` y `python manage.py migrate` | **Sí, todo** |

**Nota:** `POSTGRES_PASSWORD` solo se usa al crear el volumen. Si la cambias después en `.env`, Django usará la nueva pero la base seguirá con la vieja, y fallará la autenticación. En ese caso usa `down -v` o cambia la contraseña con `ALTER USER` en `psql`.

Los respaldos (`*.dump`) contienen datos: no los subas a git.

---

## 8. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `failed to connect to the docker API … dockerDesktopLinuxEngine` | Docker Desktop no está abierto | Abrirlo y esperar a *Engine running* |
| `password authentication failed` / `la autentificación password falló` | Otro PostgreSQL en el puerto, o la contraseña cambió después de crear el volumen | §2.1, o §7 (`down -v`) |
| `port is already allocated` al hacer `up -d` | Otro programa usa `POSTGRES_PORT` | Elegir otro puerto en `.env` |
| `Falta la variable de entorno …` | `.env` incompleto | Completar con `.env.example` |
| `Could not find the GDAL library` | No está activo el entorno `nisar` | `conda activate nisar` |
| `load_explore`: `Falta …graficas.json` | La carpeta es de antes del 2026-11-15 | Volver a correr `python -m pipeline.etapa1 <scene_id>` |
