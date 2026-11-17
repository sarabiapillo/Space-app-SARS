# TerraPulse AI — Modelación de Terremotos: Física de Ondas, Leyes de Atenuación y Zonificación de Riesgo Sísmico

> **Documento de especificación analítica y matemática del Simulador Sísmico de TerraPulse AI.**  
> Archivo fuente en LaTeX: [`docs/latex/ecuaciones_sismo.tex`](file:///var/www/terrapulseai/App/docs/latex/ecuaciones_sismo.tex).  
> Código de cálculo: [`web/src/utils/seismic.ts`](file:///var/www/terrapulseai/App/web/src/utils/seismic.ts).  
> Visualización 2D y sismograma: [`web/src/components/Seismic2DChart.tsx`](file:///var/www/terrapulseai/App/web/src/components/Seismic2DChart.tsx).

---

## 1. Parámetros Fundamentales de la Fuente Sísmica

Un evento sísmico en el simulador queda definido por el hipocentro $(\lambda_e, \phi_e, h)$, donde $\lambda_e$ es la longitud, $\phi_e$ la latitud y $h$ la profundidad focal (en km), junto con su magnitud de momento $M_w$.

El momento sísmico escalar $M_0$ (en $\text{dyn}\cdot\text{cm}$) se relaciona con la magnitud de momento $M_w$ mediante la ecuación clásica de Kanamori (1977):

$$M_w = \frac{2}{3} \log_{10}(M_0) - 10.7 \iff M_0 = 10^{\frac{3}{2}(M_w + 10.7)}$$

Para cualquier estación o punto de interés ubicado en $(\lambda, \phi)$, la distancia epicentral $D$ sobre el elipsoide se calcula mediante la fórmula de gran círculo (Haversine):

$$D = 2 R_T \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_e)\cos(\phi)\sin^2\left(\frac{\Delta \lambda}{2}\right)} \right)$$

donde $R_T \approx 6371\,\text{km}$ es el radio terrestre medio, $\Delta \phi = \phi - \phi_e$ y $\Delta \lambda = \lambda - \lambda_e$.

La distancia hipocentral $R$ entre el foco y la superficie se deduce por geometría pitagórica:

$$R = \sqrt{D^2 + h^2}$$

---

## 2. Propagación de Ondas Elásticas y Tiempos de Viaje

En un medio elástico lineal homogéneo e isótropo caracterizado por los parámetros de Lamé $\lambda$ y $\mu$, y la densidad volumétrica $\rho$, la ecuación de onda elástica de Navier:

$$\rho \frac{\partial^2 \mathbf{u}}{\partial t^2} = (\lambda + \mu)\nabla(\nabla \cdot \mathbf{u}) + \mu \nabla^2 \mathbf{u}$$

admite la descomposición de Helmholtz $\mathbf{u} = \nabla \Phi + \nabla \times \mathbf{\Psi}$, dando origen a dos frentes de onda de cuerpo:

1. **Ondas P (Primarias / Compresionales):**
   $$v_p = \sqrt{\frac{\lambda + 2\mu}{\rho}} \approx 6.0\,\text{km/s} \quad \text{(en corteza continental típica)}$$
2. **Ondas S (Secundarias / Cizalla):**
   $$v_s = \sqrt{\frac{\mu}{\rho}} \approx 3.5\,\text{km/s}$$

Bajo una relación de Poisson estándar $\nu = 0.25$, la razón entre velocidades satisface $v_p / v_s = \sqrt{3} \approx 1.732$.

### Tiempos de Llegada y Ventana de Alerta Sísmica Temprana

El tiempo transcurrido desde la ruptura hasta el arribo del primer impulso de onda $P$ y onda $S$ al sitio a distancia $R$ viene dado por:

$$t_P(R) = \frac{R}{v_p}$$

$$t_S(R) = \frac{R}{v_s}$$

La diferencia de tiempo $\Delta t = t_S - t_P$ representa la ventana previa a la llegada de la fase de mayor energía destructiva (onda $S$ y trenes de ondas superficiales de Rayleigh/Love):

$$\Delta t(R) = R \left( \frac{1}{v_s} - \frac{1}{v_p} \right) \approx R \left( \frac{1}{3.5} - \frac{1}{6.0} \right) \approx 0.119\,R\,\text{segundos} \quad (R \text{ en km})$$

Para el Sistema de Alerta Sísmica Mexicano (SASMEX), al transmitirse la alarma por ondas de radio casi a la velocidad de la luz $c \approx 3\times 10^5\,\text{km/s} \gg v_s$, una urbe distante como la Ciudad de México ($D \approx 320\,\text{km}$) dispone de:

$$\Delta t \approx 38 - 60\,\text{segundos}$$

---

## 3. Leyes de Atenuación (GMPE) y Aceleración Pico del Terreno ($PGA$)

La aceleración pico del suelo ($PGA$, *Peak Ground Acceleration*) decrece con la distancia debido a dos efectos físicos:
- **Atenuación geométrica:** Dispersión esférica de la energía ($\propto 1/R$).
- **Atenuación anelástica:** Disipación por fricción interna y factor de calidad $Q(f)$, con coeficiente $\gamma = \frac{\pi f}{Q v_s}$.

El simulador implementa el modelo GMPE formulado para México (Ordaz et al., García et al., Boore-Atkinson):

$$\ln(PGA) = c_1 + c_2 M_w - c_3 \ln(R) - c_4 R + S_{\text{sitio}}$$

donde $PGA$ está en unidades de aceleración de la gravedad $g$ ($1\,g \approx 980.665\,\text{cm/s}^2$), y los coeficientes son:
- $c_1 = -1.85$ (constante de fuente)
- $c_2 = 0.92$ (escalamiento con magnitud)
- $c_3 = 1.15$ (atenuación geométrica corporal)
- $c_4 = 0.0032\,\text{km}^{-1}$ (amortiguamiento inelástico)
- $S_{\text{sitio}}$: factor de amplificación estratigráfica según $V_{s30}$.

### Efecto de Sitio y Amplificación por Suelo Blando

$$S_{\text{sitio}} = b_{\text{site}} \ln\left(\frac{V_{s30}}{V_{\text{ref}}}\right), \quad V_{\text{ref}} = 760\,\text{m/s} \text{ (Roca tipo B/C)}$$

En arcillas lacustres blandas de la cuenca de México ($V_{s30} < 180\,\text{m/s}$), el fenómeno de resonancia estratigráfica amplifica el movimiento hasta 3 a 4 veces con respecto a roca firme.

---

## 4. Escala de Intensidad Mercalli Modificada ($MMI$)

La correlación entre la aceleración física $PGA$ (en $\text{cm/s}^2$) y la percepción de daños en la escala Mercalli Modificada ($MMI$) sigue la formulación empírica de Worden et al. y Wald et al.:

$$MMI(PGA) = \begin{cases} 2.20 \log_{10}(PGA) + 1.00, & \text{si } PGA \le 4.22\,\text{cm/s}^2 \quad (\text{Nivel leve/moderado}) \\ 3.66 \log_{10}(PGA) - 1.66, & \text{si } PGA > 4.22\,\text{cm/s}^2 \quad (\text{Nivel fuerte/destructivo}) \end{cases}$$

---

## 5. Zonificación de Riesgo Sísmico en el Simulador

| Nivel de Riesgo | Color UI | Intensidad $MMI$ | $PGA$ Umbral | Efectos Estructurales y Poblacionales |
| :--- | :--- | :---: | :---: | :--- |
| **Zona Destructiva** | Rojo (`#ef4444`) | $\ge \text{VIII}$ | $\ge 0.34\,g$ | Daño severo a colapso en edificaciones de mampostería; fractura de tuberías y pánico generalizado. |
| **Zona de Daño Severo** | Naranja (`#f97316`) | $\text{VI - VII}$ | $0.12 - 0.34\,g$ | Daño moderado en estructuras convencionales; caída de muros, cornisas y objetos pesados. |
| **Zona Moderada** | Ámbar (`#f59e0b`) | $\text{IV - V}$ | $0.03 - 0.12\,g$ | Sentido ampliamente por la población; vibración como el paso de camión pesado; alarma general. |
| **Zona de Percepción** | Azul (`#3b82f6`) | $\text{II - III}$ | $0.005 - 0.03\,g$ | Sentido únicamente por personas en reposo o pisos altos; sin daños materiales. |

Los radios de afectación concéntricos se determinan invirtiendo numéricamente por el método de bisección:

$$R_{\text{zona}} = \left\{ R \in \mathbb{R}^+ \;:\; PGA(R, M_w, h, S_{\text{sitio}}) = PGA_{\text{umbral}} \right\}$$

---

## 6. Formulación Analítica del Sismograma Sintético y Paquetes de Onda

La aceleración total registrada en la estación receptora se modela como:

$$a(t, D) = a_{\text{ruido}}(t) + a_P(t, D) + a_S(t, D)$$

### Onda P Compresional:
$$a_P(t, D) = A_P(D) \cdot \sin\big(2\pi f_P (t - t_P)\big) \cdot \cos\big(0.3\pi f_P (t - t_P)\big) \cdot \exp\left(-\frac{t - t_P}{\tau_P}\right) \cdot \mathcal{H}(t - t_P)$$

con $A_P(D) \approx 0.22 \cdot PGA(D)$, $f_P = 4.5\,\text{Hz}$ y $\tau_P \approx 3.2\,\text{s}$.

### Onda S de Corte y Ondas Superficiales:
$$a_S(t, D) = PGA(D) \cdot E_S(t - t_S) \cdot \Big[ 0.82 \sin\big(2\pi f_S (t - t_S)\big) + 0.18 \sin\big(4\pi f_S (t - t_S) + 0.6\big) \Big] \cdot \mathcal{H}(t - t_S)$$

donde la envolvente $E_S(\tau)$ es:

$$E_S(\tau) = \begin{cases} \dfrac{\tau}{\tau_{\text{rise}}}, & 0 \le \tau \le \tau_{\text{rise}} \\[8pt] \exp\left(-\dfrac{\tau - \tau_{\text{rise}}}{\tau_{\text{coda}}}\right), & \tau > \tau_{\text{rise}} \end{cases}$$

con tiempo de subida $\tau_{\text{rise}} = 1.8\,\text{s}$.

### Parámetros de Suelo y Resonancia Espectral:
- **Roca Firme ($V_{s30} > 760\,\text{m/s}$):** $f_S \approx 2.2\,\text{Hz}$, $\tau_{\text{coda}} \approx 9.0\,\text{s}$.
- **Suelo Intermedio ($360 - 760\,\text{m/s}$):** $f_S \approx 1.3\,\text{Hz}$, $\tau_{\text{coda}} \approx 14.0\,\text{s}$.
- **Suelo Blando Lacustre ($V_{s30} < 180\,\text{m/s}$, CDMX):** $f_S \approx 0.52\,\text{Hz}$ (período fundamental del suelo $T_0 \approx 2\,\text{s}$), $\tau_{\text{coda}} \approx 28.0\,\text{s}$. Genera oscilaciones armónicas cuasi-estacionarias de larga duración y resonancia con estructuras de mediana y gran altura.

---

## 7. Mapeo entre Fórmulas Matemáticas y Código TypeScript

| Magnitud / Concepto | Ecuación Matemática | Código en `seismic.ts` |
| :--- | :--- | :--- |
| Distancia Hipocentral | $R = \sqrt{D^2 + h^2}$ | `Math.sqrt(dist*dist + depthKm*depthKm)` |
| Aceleración Pico | $\ln(PGA) = c_1 + c_2 M_w - c_3 \ln R - c_4 R + S$ | `computePga_g(...)` |
| Conversión a CGS | $PGA_{\text{cgs}} = PGA_g \times 980.665$ | `pga_g * 980.665` |
| Intensidad Mercalli | $MMI = 3.66 \log_{10}(PGA_{\text{cgs}}) - 1.66$ | `pgaToMmi(pga_g)` |
| Tiempo Onda P | $t_P = R / 6.0$ | `tP = hypoDist / 6.0` |
| Tiempo Onda S | $t_S = R / 3.5$ | `tS = hypoDist / 3.5` |
| Ventana Alerta | $\Delta t = t_S - t_P$ | `Math.max(0, tS - tP)` |
| Sismograma Sintético | $a(t) = a_{\text{ruido}} + a_P(t) + a_S(t)$ | `generateSyntheticSeismogram(...)` |
| Radios Isosistas | $PGA(R) = PGA_{\text{umbral}}$ (Bisección) | `solveDistanceForPga(...)` |
| Anillos Geodésicos | Geometría esférica 64 puntos | `generateGeodesicCircle(epicenter, rKm, 64)` |
