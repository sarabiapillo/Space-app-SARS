# Cómo usar el mapa de cambio en la web

> Guía de uso (2026-11-18). Detalles técnicos: [`api-roi-jobs.md`](api-roi-jobs.md) y [`latex/mapa_cambio.tex`](latex/mapa_cambio.tex).

El mapa de cambio indica, píxel por píxel, **cuántos decibeles cambió la señal del radar NISAR entre dos fechas** sobre la región que dibujes en el mapa. Sirve para ver **dónde** cambió la superficie, pero no **por qué** (ver [Qué no dice](#qué-no-dice)).

---

## 1. Arrancar el sistema

Se necesitan dos terminales de WSL.

**Terminal 1: backend (Django)**

```bash
cd ~/terrapulse
conda activate nisar
docker compose up -d                                   # PostGIS (para guardar la copia de gráficas; el mapa de cambio funciona sin él)
PYTHONPATH=.:backend python backend/manage.py runserver
```

**Terminal 2: frontend (Vite)**

```bash
cd ~/terrapulse/web
npm run dev
```

Abre en el navegador la dirección que imprime Vite (normalmente `http://localhost:5173`).

**Requisito:** el backend lee las escenas de ASF, así que necesita tus credenciales de Earthdata, ya sea en `.env` (`EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD`) o en `~/.netrc`.

---

## 2. Calcular el mapa de cambio de una región

1. **Dibuja la región.** Usa la herramienta **Recortar ROI**: un clic en una esquina y otro en la esquina opuesta. También puedes buscar un lugar y usar **Confirmar región de análisis**.
   - Máximo **0.6° por lado** (unos 65 km).
2. **Confirma la región y espera.** El sistema:
   - busca en ASF las escenas GCOV que cubren la región;
   - elige el **par de fechas comparables más reciente** (misma trayectoria, marco, dirección, polarización, versión de procesamiento y madurez);
   - lee solo la parte de cada escena que cae en la región y calcula el cambio.

   La primera vez tarda **1–2 minutos**. Si vuelves a pedir la misma región el mismo día, se reutiliza el resultado.
3. Cuando termine, pulsa el botón **Cambio Δ** de la cinta superior (junto a **t1**, **t2** y **Swipe**).
   - Si el botón está **deshabilitado**, esa región no tiene un par comparable (solo hay una fecha).
4. **Elige la polarización** (HH o HV) con el selector de capa de siempre: el mapa de cambio sigue esa elección.

---

## 3. Cómo leerlo

| Color | Significado |
|---|---|
| 🔵 Azul | En la segunda fecha (t2) **regresó menos señal** que en la primera (t1). |
| ⚪ Blanco | Sin cambio. |
| 🔴 Rojo | En t2 **regresó más señal**. |

- La escala de color va de **−6 a +6 dB** y no cambia con el umbral.
- La **barra de color** (a la derecha del mapa) muestra:
  - **↓ ≥ umbral:** km² y % de la región donde la señal **bajó** al menos el umbral;
  - **↑ ≥ umbral:** km² y % donde **subió** al menos el umbral;
  - **Mediana** del cambio en dB;
  - el aviso **"Exploratorio: no identifica la causa"**.

---

## 4. Controles: resolución y umbral

Están en la misma barra de color, debajo de las cifras. Cada cambio se recalcula en el servidor en **menos de 2 segundos**, sin volver a descargar de ASF.

### Resolución

| Opción | Píxel | Qué conviene saber |
|---|---|---|
| 20 m | 2 × 2 | Más detalle, pero mucho ruido (*speckle*): aparece "nieve". |
| **50 m** (por defecto) | 5 × 5 | Buen equilibrio: el ruido baja a menos de la mitad. Se pierden objetos de menos de ~50 m. |
| 100 m | 10 × 10 | Muy limpio; solo se ven cambios grandes (parcelas, manchas extensas). |

### Umbral

Opciones de **±1.5 a ±6 dB**. El umbral **solo decide qué píxeles cuentan en las cifras de km²** y en el mapa de clases; no cambia los colores.

- **Umbral bajo:** detecta cambios sutiles, pero cuenta más ruido como cambio.
- **Umbral alto:** solo cuenta cambios fuertes.

### Ruido de la ROI y aviso

Debajo de los controles aparecen:

- **Ruido de la ROI** (≈ X dB): cuánto varía la señal en esa región aunque no haya cambio real. Depende del terreno, del par de fechas y de la resolución.
- **umbral = N× ruido:** cuántas veces el umbral supera ese ruido.
- **|z| > 3:** % de píxeles que se alejan más de 3 veces del ruido de la propia región (referencia).
- **⚠️ Aviso:** aparece si el umbral es **menor que 3 veces el ruido**. Significa que parte de lo marcado puede ser speckle: **sube la resolución o el umbral**.

> El umbral se mantiene en **dB fijos** para que las cifras de distintas regiones se puedan comparar. El ruido y el |z| indican qué tan confiable es ese umbral en cada región.

---

## 5. Ejemplo con datos reales

Región de 9.3 km² cerca de Tuxtla Gutiérrez, par 2026-10-28 → 2026-11-09 (12 días), umbral ±3 dB, polarización HH:

| Resolución | Ruido | Baja / sube ≥ 3 dB | Aviso |
|---|---|---|---|
| 20 m | 1.53 dB | 2.96 % / 2.88 % | ⚠️ sí |
| 50 m | 0.70 dB | 0.00 % / 0.03 % | no |
| 100 m | 0.39 dB | 0.00 % / 0.00 % | no |

A 20 m, casi el 3 % de la región aparece como "cambio" en cada sentido, con porcentajes casi iguales de subida y bajada: esa simetría es la huella del ruido, y el sistema lo avisa. A 50 m lo marcado prácticamente desaparece.

**Para una presentación:** muestra la misma región a 20 m y luego a 50 m. Se ve claramente cómo el multilook limpia el ruido y por qué el sistema lo usa por defecto.

---

## 6. Qué no dice

- Es **exploratorio**: todavía no hay validación con una fuente independiente (paso 6 del plan de trabajo).
- Un cambio en dB describe un cambio en la **respuesta del radar**, no su causa. Una subida o una bajada puede deberse a agua, humedad del suelo, vegetación, obras, cultivos o efectos del relieve.
- Todavía no se excluyen sombras, *layover* ni pendientes fuertes, que pueden producir valores raros en zonas montañosas.
- Las cifras de km² son **conteos de píxeles sobre un umbral**, no áreas validadas.

---

## 7. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| **Cambio Δ** deshabilitado | La región solo tiene una fecha comparable | Prueba otra región o espera nuevas adquisiciones. |
| Error al cargar la región | Región mayor que 0.6° por lado, sin cobertura NISAR o sin credenciales | Reduce la región; revisa `.env` o `.netrc` en el servidor. |
| "Servidor ocupado" | Ya hay 3 regiones calculándose | Reintenta en unos minutos. |
| Mucho "ruido" o "nieve" en el mapa | Resolución de 20 m o umbral bajo | Usa 50 o 100 m o sube el umbral; fíjate en el aviso. |
| "Ese mapa de cambio se está calculando" | Otra petición pidió la misma combinación | Espera unos segundos y vuelve a elegirla. |

---

## 8. Alternativa: caso fijo de Chiapas desde la terminal

```bash
cd ~/terrapulse
conda activate nisar
python -m pipeline.change                          # par de pipeline/config.yaml, 50 m, ±3 dB
python -m pipeline.change --multilook 10 --umbral 4
```

Los resultados quedan en `data/processed/cambio_GCOV_T062_F010_P05023_20260618_20261016_gamma0/`:

- `delta_<pol>_dB.tif`: cambio en dB;
- `zscore_<pol>.tif`: z-score robusto;
- `cambio_<pol>.tif`: clases (−1 baja, 0 estable, +1 sube);
- `change.json`: escenas, parámetros, métricas y advertencias (trazabilidad completa);
- `web/`: imágenes y `capas.json` para la interfaz.
