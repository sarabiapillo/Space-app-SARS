import { BookOpen } from 'lucide-react'
import { useTranslation } from '../../i18n/useTranslation'
import { FloodCollapsible } from './FloodFormParts'

/** Collapsible plain-language explanation of what the DG2 run computes and which formulas the results use. */
export function FloodHowItWorks() {
  const { t } = useTranslation()
  const items: Array<[string, string]> = [
    [t('1. Aguas someras 2D, conservación de masa (lo resuelve LISFLOOD-FP DG2 o FV1)', '1. 2D shallow water, mass conservation (solved by LISFLOOD-FP DG2 or FV1)'),
      '∂h/∂t + ∂(hu)/∂x + ∂(hv)/∂y = R(t)'],
    [t('2. Fricción de Manning en la ecuación de momento', '2. Manning friction in the momentum equation'),
      'S_f = n² · |u| · u / h^(4/3)'],
    [t('3. Lluvia efectiva con coeficiente de escorrentía (opcional; D = duración)', '3. Effective rain with a runoff coefficient (optional; D = duration)'),
      t('R = lluvia × C,  C = min(0.92, 0.65 + 0.27 · (1 − e^(−D / 24 h)))', 'R = rain × C,  C = min(0.92, 0.65 + 0.27 · (1 − e^(−D / 24 h)))')],
    [t('4. Barómetro inverso: solo eleva el nivel fijo del mar', '4. Inverse barometer: only raises the fixed sea level'),
      'Δh = max(0, 1013.25 − p) · 100 / (ρ · g) ≈ 1 cm/hPa'],
    [t('5. Número de Froude por celda (h ≥ 0.15 m; Fr > 1 es supercrítico)', '5. Froude number per cell (h ≥ 0.15 m; Fr > 1 is supercritical)'),
      'Fr = |v| / √(g · h),  g = 9.81 m/s²'],
    [t('6. Tiempo de concentración de Kirpich (L en m, ruta D8 más larga)', '6. Kirpich time of concentration (L in m, longest D8 path)'),
      't_c [min] = 0.0195 · L^0.77 · S^(−0.385)'],
  ]
  return (
    <FloodCollapsible className="ws-rain-howto" icon={<BookOpen size={12} aria-hidden="true" />} title={t('Cómo funciona la simulación', 'How the simulation works')}>
      <p className="ws-rain-help">
        {t('DG2 (Galerkin discontinuo de 2.º orden) o FV1 (volúmenes finitos de 1.er orden, más estable en terreno empinado) resuelve las ecuaciones de aguas someras sobre el terreno reproyectado (Copernicus GLO-30 o NASADEM, con todas las alturas en EGM2008: NASADEM se convierte desde EGM96 y Copernicus desde el elipsoide WGS84 con las rejillas del geoide de la NGA); si el método elegido falla, se usa automáticamente el otro. La lluvia es sintética y uniforme en la zona; el resultado es una solución numérica, no una observación, y su exactitud hidráulica no está validada.',
          'DG2 (second-order discontinuous Galerkin) or FV1 (first-order finite volumes, more stable on steep terrain) solves the shallow water equations over the reprojected terrain (Copernicus GLO-30 or NASADEM, with every height in EGM2008: NASADEM is converted from EGM96 and Copernicus from the WGS84 ellipsoid with the NGA geoid grids); if the chosen method fails, the other one is used automatically. Rain is synthetic and uniform over the area; the result is a numerical solution, not an observation, and its hydraulic accuracy is not validated.')}
      </p>
      <div className="ws-rain-eq-content">
        {items.map(([label, formula]) => (
          <div key={label} className="ws-rain-eq-item"><span>{label}</span><code>{formula}</code></div>
        ))}
      </div>
    </FloodCollapsible>
  )
}
