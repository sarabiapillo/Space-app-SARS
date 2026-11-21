# Visor de Relieve 3D de la ROI (`Terrain3DViewer`)

Módulo interactivo y completamente aislado en el cliente (`web/`) para visualizar el relieve topográfico tridimensional de la Región de Interés (ROI) activa en **TerraPulse AI**.

---

## 1. Propósito y Alcance

El visor genera una **maqueta o bloque topográfico 3D flotante** del terreno contenido en la ROI activa (compatible con la ROI oficial de Chiapas, las 43 ROIs del catálogo nacional, ubicaciones buscadas o cualquier polígono dibujado manualmente).

- **Aislamiento arquitectónico:** Se carga bajo demanda mediante `React.lazy` y `Suspense` cuando el usuario abre el modal **Relieve 3D**, sin desmontar el lienzo 2D de MapLibre GL ni alterar el estado de las capas SAR NISAR, la simulación hidráulica DG2, el simulador solar ni el simulador sísmico.
- **Uso exploratorio:** Esta vista está diseñada para inspección geomorfológica e interpretación visual del terreno. No reemplaza al proveedor científico NASADEM del pipeline (`pipeline/elevation/nasadem.py`) y sus cifras no se emplean como entrada de los cálculos de retrodispersión, radiación solar, hidráulica ni sismología.

---

## 2. Cómo se construye la maqueta 3D

### 2.1. Adquisición y decodificación de elevación (`AWS Terrarium / NASA SRTM`)
1. **Cálculo del rectángulo envolvente (`bboxFromGeometry`):** Extrae los límites `[west, south, east, north]` en `EPSG:4326` de cualquier geometría `Polygon`, `MultiPolygon` o anillo de recorte activo (con un límite operativo de `3°` por lado).
2. **Selección de nivel de detalle (`chooseZoom`):** Elige automáticamente el nivel de zoom óptimo $z \in [8, 13]$ cuyo número total de teselas Web Mercator no supere el presupuesto máximo (`36` teselas).
3. **Decodificación nativa 1:1 en metros (`decodeTerrariumTileNative`):**
   Cada tesela PNG de **AWS Terrarium** (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, derivada de datos abiertos SRTM/NASADEM) se carga sin conversión de espacio de color (`createImageBitmap(blob, { colorSpaceConversion: 'none' })`) en un lienzo de tamaño nativo `256 × 256` sin escalado RGB, convirtiendo cada píxel directamente a metros mediante:

   $$\text{elev\_m} = \left(256 \cdot R + G + \frac{B}{256}\right) - 32768$$

4. **Remuestreo bilineal en metros (`resampleElevationBilinear`):**
   El mosaico numérico ya expresado en metros (`Float32Array`) se recorta exactamente al rectángulo de la ROI y se remuestrea bilinealmente a una malla de **`161 × 161` vértices (`160 × 160` segmentos)**, evitando artefactos por interpolación de canales RGB.

### 2.2. Saneamiento costero y filtro anti-picos (`Despike 3×3`)
- **Nivelación del nivel del mar (`sanitizeElevationSample` / `sanitizeElevationGrid`):**
  - Se descartan píxeles con transparencia parcial (`alpha < 255`) o valores corruptos (`> 9000 m`).
  - Toda elevación negativa o batimetría oceánica (`< 0 m`, que en fosas marinas alcanza hasta `-9,651 m`) se recorta a **`0 m`**. Así el mar queda completamente plano en zonas costeras (p. ej. Acapulco) y no distorsiona la escala vertical ni la telemetría.
- **Filtro de mediana 3×3 (`despikeElevationGrid`):**
  - Para cada vértice evalúa la mediana de sus 8 vecinos inmediatos. Si la diferencia absoluta `|elev - medianaVecinos|` supera `80 m` en un solo paso de celda (típico artefacto aislado de `+256 m` por salto del byte `R`), el vértice se reemplaza por la mediana de sus vecinos sin aplanar las pendientes reales.
  - Los indicadores `minM`, `maxM` y $\Delta z$ se calculan **después** del saneamiento y del filtro anti-picos.

### 2.3. Bloque 3D y zócalo estilizado (`Three.js`)
- La superficie se construye con `THREE.PlaneGeometry(W, H, 160, 160)` respetando la proporción métrica horizontal ancho/alto de la ROI.
- Se cierra con 4 paredes laterales y una tapa inferior en tono gris pizarra oscuro (`#334155` / `#1e293b`), cuyo grosor está fijado al **`3.5 %` del lado horizontal mayor** de la maqueta independientemente de la exageración vertical.
- La escena utiliza iluminación de tres componentes (luz solar direccional cálida desde el noroeste, luz direccional suave de relleno y luz hemisférica cielo/tierra).

---

## 3. Controles y Funciones del Visor

### 3.1. Exageración vertical (`1.0×` a `5.0×`, por defecto `2.0×`)
Multiplica la escala vertical del relieve respecto a la escala horizontal y recalcula en vivo las posiciones de los vértices y sus normales de iluminación:
- **`1.0×`:** Proporción física real 1:1 entre distancia horizontal y altitud.
- **`2.0× – 3.0×`:** Resalta cañones, valles profundos y cordilleras (ideal para el Cañón del Sumidero o zonas montañosas).
- **`4.0× – 5.0×`:** Destaca variaciones suaves de relieve en planicies, cuencas aluviales y zonas costeras.

### 3.2. Opciones de Textura Superficial
Permite alternar en tiempo real el recubrimiento de la malla 3D sin volver a descargar las teselas:

| Modo | Descripción |
|---|---|
| **Satelital (Esri)** | Superpone el mosaico óptico de **Esri World Imagery** recortado y alineado al mismo bounding box de la ROI, combinado con el sombreado 3D de la escena. |
| **Hipsométrico (Elevación)** | Genera un mapa de color por altitud combinado con sombreado direccional Lambertiano (*hillshade* desde el noroeste, azimut $315^\circ$, elevación $42^\circ$):<br>• **Azul costero:** nivel del mar ($\le 0.5\text{ m}$).<br>• **Verdes:** tierras bajas y valles.<br>• **Ocre / Amarillo:** laderas medias.<br>• **Marrón / Blanco:** cumbres y alta montaña. |
| **Malla (Wireframe)** | Muestra la retícula geométrica triangular (`160 × 160`) en tono verde azulado técnico (`#0f766e`) para inspeccionar la estructura del modelo digital de elevación. |

*(Si la red no permite descargar la textura satelital pero sí la elevación, el visor cambia automáticamente al modo **Hipsométrico**).*

### 3.3. Navegación, Cámara y Captura
- **Rotación 360° e inclinación:** Clic izquierdo + arrastrar (`OrbitControls` con amortiguamiento suave y tope sobre el horizonte).
- **Desplazamiento lateral (Pan):** Clic derecho + arrastrar.
- **Acercar / Alejar (Zoom):** Rueda del mouse (`scroll`).
- **Restablecer cámara:** Devuelve la cámara y el pivote a la vista isométrica inicial centrada.
- **Capturar vista 3D (PNG):** Renderiza el cuadro actual del lienzo WebGL y descarga una imagen PNG (`terrapulse-relieve3d-<nombre-roi>.png`).

### 3.4. Telemetría de Relieve
El panel derecho reporta las métricas calculadas sobre la malla saneada de la ROI:
- **Elevación mínima ($h_{\min}$):** Altitud mínima en metros sobre el nivel del mar (`m`).
- **Elevación máxima ($h_{\max}$):** Altitud máxima en metros (`m`).
- **Desnivel ($\Delta z = h_{\max} - h_{\min}$):** Amplitud vertical total del terreno dentro del recorte (`m`).
- **Extensión:** Ancho y alto aproximados del rectángulo de la ROI en kilómetros (`km × km`).
- **Zoom de teselas:** Nivel de zoom Web Mercator (`z8`–`z13`) empleado para la elevación.
- **Fuentes:** Atribución explícita a `AWS Terrarium / NASA SRTM` (elevación) y `Esri World Imagery` (textura).

---

## 4. Archivos principales y Verificación

| Archivo | Función |
|---|---|
| `web/src/utils/terrain3d.ts` | Cálculo de bbox, descarga de teselas Terrarium y Esri, decodificación nativa 1:1, remuestreo bilineal en metros, saneamiento costero, filtro `despikeElevationGrid` y textura hipsométrica. |
| `web/src/components/Terrain3DViewer.tsx` | Escena Three.js, controles interactivos, telemetría, captura PNG y liberación completa de recursos WebGL (`renderer.dispose()`, `forceContextLoss()`, geometrías, materiales, texturas y `ResizeObserver`). |
| `web/src/i18n/terrainMessages.ts` | Catálogo bilingüe Español / Inglés del módulo. |
| `web/tests/terrain3d.test.mjs` | Suite de pruebas unitarias (decodificación Terrarium, bbox, selección de zoom, saneamiento costero, filtro anti-picos `+256 m`, i18n y limpieza WebGL). |
| `docs/features/roi-terrain-3d-viewer.tex` | Memoria técnica de la funcionalidad en LaTeX. |

Para ejecutar las pruebas unitarias del módulo desde `web/`:

```bash
node --test tests/terrain3d.test.mjs
```
