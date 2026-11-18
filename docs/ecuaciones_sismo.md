# TerraPulse AI — Manual Técnico y Físico-Matemático: Simulación de Terremotos, Propagación de Ondas Elásticas, Atenuación GMPE y Zonificación de Riesgo Sísmico

> ⚠️ **Desactualizado (2026-11-18).** Este texto describe la versión del 17 de noviembre. La documentación vigente del módulo, con las correcciones (MMI continua en ~66 gal, saturación de campo cercano, Vs30, estación en el mapa, sismograma a 50 Hz, espectrograma y comparación con registros reales) y sus limitaciones, está en [`docs/latex/ecuaciones_sismo.tex`](latex/ecuaciones_sismo.tex). `docs/sismo.pdf` también corresponde a la versión anterior hasta que se recompile.

> **Recursos de Documentación:**
> - 📄 **PDF Compilado y Listo para Descarga/Revisión:** [`ecuaciones_sismo.pdf`](https://terrapulseai.cadenas-m.tech/ecuaciones_sismo.pdf) | [Archivo local](file:///var/www/terrapulseai/App/docs/ecuaciones_sismo.pdf)
> - 📝 **Código Fuente LaTeX:** [`docs/latex/ecuaciones_sismo.tex`](file:///var/www/terrapulseai/App/docs/latex/ecuaciones_sismo.tex)
> - 💻 **Motor de Cálculo en TypeScript:** [`web/src/utils/seismic.ts`](file:///var/www/terrapulseai/App/web/src/utils/seismic.ts)
> - 📊 **Componente de Gráficas y Sismograma:** [`web/src/components/Seismic2DChart.tsx`](file:///var/www/terrapulseai/App/web/src/components/Seismic2DChart.tsx)
> - 🗺️ **Visualización Espacial Vectorial:** [`web/src/components/MapCanvas.tsx`](file:///var/www/terrapulseai/App/web/src/components/MapCanvas.tsx)

---

## 1. Introducción y Visión General del Sistema

TerraPulse AI cuenta con un motor analítico en tiempo real de propagación de ondas sísmicas y modelación de riesgo enfocado en el régimen tectónico de México. Permite simular escenarios sísmicos interactivos evaluando aceleraciones máximas del terreno ($PGA$), escala de intensidad de daños estructurales ($MMI$), radios geodésicos de isosisma y el sismograma sintético completo $a(t, D)$ con alerta sísmica temprana ($\Delta t$).

---

## 2. Arquitectura y Flujo de Procesamiento

El ciclo de ejecución en el sistema sigue 6 etapas automáticas e integradas:

```
[Usuario / Presets Históricos] 
            │ (Epicentro [λ, φ], Mw, Profundidad h, Mecanismo, Vs30)
            ▼
[Motor Geodésico y de Foco]
            │ R = √(D² + h²), tiempos tP y tS, ventana Δt
            ▼
[Leyes de Atenuación GMPE (Ordaz / García / Boore-Atkinson)]
            │ ln(PGA) = c1 + c2 Mw - c3 ln(R) - c4 R + S_sitio
            ▼
[Conversión a Intensidad Mercalli Modificada (MMI)]
            │ MMI = 3.66 log10(PGA_cgs) - 1.66
            ▼
[Inversión Numérica por Bisección (Radios de Isosisma)]
            │ Búsqueda de r para umbrales: 0.34g, 0.12g, 0.03g, 0.005g
            ▼
[Pipeline de Visualización Dual]
     ┌──────┴─────────────────────────────────┐
     ▼                                        ▼
[MapLibre GL JS (Mapa Vectorial)]     [Chart.js (Análisis 2D y Onda)]
- Anillos geodésicos (64 nodos)        - Curva PGA vs Distancia
- Ondas concéntricas pulsantes         - Tiempos tP, tS y ventana Δt
- Marcador interactivo de epicentro    - Sismograma Sintético a(t, D)
```

---

## 3. Ecuaciones de Fuente Sísmica y Geometría

### Momento Sísmico Escalar ($M_0$):
$$M_w = \frac{2}{3} \log_{10}(M_0) - 10.7 \iff M_0 = 10^{\frac{3}{2}(M_w + 10.7)} \quad [\text{dyn}\cdot\text{cm}]$$

### Distancia Epicentral Ortodrómica (Haversine):
$$D = 2 R_T \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_e)\cos(\phi)\sin^2\left(\frac{\Delta \lambda}{2}\right)} \right)$$
con radio terrestre medio $R_T \approx 6371\,\text{km}$.

### Distancia Hipocentral Tridimensional ($R$):
$$R = \sqrt{D^2 + h^2}$$

---

## 4. Elastodinámica Continua y Tiempos de Viaje

A partir de la ecuación elástica de movimiento continuo de Navier:
$$\rho \frac{\partial^2 \mathbf{u}}{\partial t^2} = (\lambda + \mu)\nabla(\nabla \cdot \mathbf{u}) + \mu \nabla^2 \mathbf{u}$$

Se deduce la velocidad de propagación para ambos frentes de onda de cuerpo:
- **Onda Primaria ($P$, Compresional):**
  $$v_p = \sqrt{\frac{\lambda + 2\mu}{\rho}} \approx 6.0\,\text{km/s}$$
- **Onda Secundaria ($S$, Cizalla Cortante):**
  $$v_s = \sqrt{\frac{\mu}{\rho}} \approx 3.5\,\text{km/s}$$

Para un sólido de Poisson ($\nu = 0.25$):
$$\frac{v_p}{v_s} = \sqrt{3} \approx 1.732$$

### Tiempos de Llegada y Ventana Operativa de Alerta Sísmica Temprana ($\Delta t$):
$$t_P = \frac{\sqrt{D^2 + h^2}}{6.0}, \qquad t_S = \frac{\sqrt{D^2 + h^2}}{3.5}$$

$$\Delta t(D) = t_S - t_P = \sqrt{D^2 + h^2} \left( \frac{1}{3.5} - \frac{1}{6.0} \right) \approx 0.119 \cdot \sqrt{D^2 + h^2}\,\text{segundos}$$

*Ejemplo práctico SASMEX:* Para un sismo de subducción en la costa de Guerrero o Michoacán a $D = 320\,\text{km}$ de la Ciudad de México ($h = 15\,\text{km}$):
$$t_P \approx 53.4\,\text{s}, \qquad t_S \approx 91.5\,\text{s}, \qquad \Delta t \approx 38.1\,\text{segundos}$$
Dado que la alerta radial viaja a la velocidad de la luz $c \approx 3\times 10^5\,\text{km/s}$, la población en CDMX dispone de entre 40 y 60 segundos de aviso previo a las sacudidas destructivas.

---

## 5. Leyes de Predicción de Movimiento del Suelo (GMPE)

El simulador implementa el modelo regional calibrado para México (Ordaz et al., García et al., Boore-Atkinson):

$$\ln(PGA) = c_1 + c_2 M_w - c_3 \ln(R) - c_4 R + S_{\text{sitio}}$$

donde $PGA$ se expresa en unidades de gravedad terrestre ($g$), y $PGA_{\text{cgs}} = PGA_g \times 980.665\,\text{cm/s}^2$ (Gals).

### Coeficientes Calibrados según Mecanismo:
- **Subducción Interplaca:** $c_1 = -1.85$, $c_2 = 0.92$, $c_3 = 1.15$, $c_4 = 0.0032\,\text{km}^{-1}$.
- **Intraplaca Profundo (Slab de Cocos):** $c_1 = -1.55$, $c_2 = 0.96$, $c_3 = 1.25$, $c_4 = 0.0040\,\text{km}^{-1}$.
- **Cortical Somero:** $c_1 = -1.95$, $c_2 = 0.88$, $c_3 = 1.05$, $c_4 = 0.0028\,\text{km}^{-1}$.

### Efecto de Sitio ($V_{s30}$):
$$S_{\text{sitio}} = -0.45 \ln\left( \frac{V_{s30}}{760} \right)$$
- Roca Firme ($V_{s30} \ge 760\,\text{m/s}$): $S_{\text{sitio}} = 0.0$.
- Suelo Firme/Aluvial ($V_{s30} \approx 450\,\text{m/s}$): $S_{\text{sitio}} \approx 0.23$.
- Suelo Blando Lacustre ($V_{s30} \le 100\,\text{m/s}$, Lago CDMX): $S_{\text{sitio}} \approx 0.91$, cuadruplicando la respuesta espectral por resonancia estratigráfica.

---

## 6. Escala Mercalli Modificada ($MMI$)

Correlación de Worden et al. y Wald et al.:
$$MMI(PGA_{\text{cgs}}) = \begin{cases} 2.20 \log_{10}(PGA_{\text{cgs}}) + 1.00, & \text{si } PGA_{\text{cgs}} \le 4.22\,\text{cm/s}^2 \\ 3.66 \log_{10}(PGA_{\text{cgs}}) - 1.66, & \text{si } PGA_{\text{cgs}} > 4.22\,\text{cm/s}^2 \end{cases}$$

---

## 7. Zonificación de Riesgo e Inversión por Bisección

| Nivel de Riesgo | Color UI | Intensidad $MMI$ | Umbral $PGA$ | Efectos en Infraestructura |
| :--- | :--- | :---: | :---: | :--- |
| **Zona Destructiva** | Rojo (`#ef4444`) | $\ge \text{VIII}$ | $\ge 0.34\,g$ | Colapso severo de mampostería, ruptura de ductos y puentes. |
| **Zona de Daño Severo** | Naranja (`#f97316`) | $\text{VI - VII}$ | $0.12 - 0.34\,g$ | Daño moderado en muros, grietas estructurales, caída de objetos. |
| **Zona Moderada** | Ámbar (`#f59e0b`) | $\text{IV - V}$ | $0.03 - 0.12\,g$ | Sentido ampliamente, balanceo de lámparas, alarma general. |
| **Zona de Percepción** | Azul (`#3b82f6`) | $\text{II - III}$ | $0.005 - 0.03\,g$ | Sentido en reposo o pisos superiores, límite instrumental. |

Para cada umbral, el radio $R_{\text{zona}}$ se resuelve numéricamente mediante el método de bisección en el intervalo $[0, 1500\,\text{km}]$ en 30 iteraciones con error inferior a 10 metros.

---

## 8. Formulación del Sismograma Sintético $a(t, D)$

La aceleración oscilatoria continua se modela como:
$$a(t, D) = a_{\text{ruido}}(t) + a_P(t, D) + a_S(t, D)$$

### Onda P ($t \ge t_P$):
$$a_P(t, D) = 0.22 \cdot PGA(D) \cdot \sin(2\pi f_P (t - t_P)) \cdot \cos(0.3\pi f_P (t - t_P)) \cdot \exp\left(-\frac{t - t_P}{3.2}\right) \cdot \mathcal{H}(t - t_P)$$
con $f_P = 4.5\,\text{Hz}$.

### Onda S y Ondas Superficiales ($t \ge t_S$):
$$a_S(t, D) = PGA(D) \cdot E_S(t - t_S) \cdot \Big[ 0.82 \sin(2\pi f_S (t - t_S)) + 0.18 \sin(4\pi f_S (t - t_S) + 0.6) \Big] \cdot \mathcal{H}(t - t_S)$$

con función envolvente $E_S(\tau)$:
$$E_S(\tau) = \begin{cases} \dfrac{\tau}{1.8}, & 0 \le \tau \le 1.8\,\text{s} \\[8pt] \exp\left(-\dfrac{\tau - 1.8}{\tau_{\text{coda}}}\right), & \tau > 1.8\,\text{s} \end{cases}$$

### Resonancia de la Cuenca del Valle de México:
- Roca Firme: $f_S = 2.2\,\text{Hz}$, $\tau_{\text{coda}} = 9\,\text{s}$.
- Suelo Blando Lacustre (CDMX): $f_S = 0.52\,\text{Hz}$ ($T_0 \approx 2.0\,\text{s}$), $\tau_{\text{coda}} = 28\,\text{s}$. Esta vibración casi armónica de período largo resuena con estructuras de 8 a 22 pisos, explicando el daño observado en los sismos de 1985 y 2017.

---

## 9. Mapeo entre Fórmulas Matemáticas y Código TypeScript

| Concepto Físico | Ecuación Matemática | Función en `seismic.ts` |
| :--- | :--- | :--- |
| Distancia Hipocentral | $R = \sqrt{D^2 + h^2}$ | `Math.sqrt(dist*dist + depthKm*depthKm)` |
| Aceleración Pico | $\ln(PGA) = c_1 + c_2 M_w - c_3 \ln R - c_4 R + S$ | `computePga_g(...)` |
| Aceleración en CGS | $PGA_{\text{cgs}} = PGA_g \times 980.665$ | `pga_g * 980.665` |
| Intensidad Mercalli | $MMI = 3.66 \log_{10}(PGA_{\text{cgs}}) - 1.66$ | `pgaToMmi(pga_g)` |
| Tiempo Onda P | $t_P = R / 6.0$ | `tP = hypoDist / 6.0` |
| Tiempo Onda S | $t_S = R / 3.5$ | `tS = hypoDist / 3.5` |
| Alerta Temprana | $\Delta t = t_S - t_P$ | `Math.max(0, tS - tP)` |
| Sismograma $a(t)$ | $a(t) = a_{\text{ruido}} + a_P(t) + a_S(t)$ | `generateSyntheticSeismogram(...)` |
| Radios Isosistas | Bisección numérica $PGA(r) = PGA_{\text{umbral}}$ | `solveDistanceForPga(...)` |
| Anillo Geodésico | Proyección esférica de 64 vértices | `generateGeodesicCircle(center, rKm, 64)` |
