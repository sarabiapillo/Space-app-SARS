/**
 * Generador topográfico e hidrológico de encharcamientos e inundación simulada.
 * Modela la acumulación de flujo, calados en cauces y depresiones sobre la ROI.
 */

export interface FloodSimulationStats {
  rainfallMm: number
  durationHours: number
  totalVolumeM3: number
  floodedAreaKm2: number
  floodedAreaPct: number
  maxDepthM: number
  meanDepthM: number
  waterSurfaceHa: number
}

export interface GeneratedFloodRaster {
  dataUrl: string
  bounds: [number, number, number, number] // [west, south, east, north]
  stats: FloodSimulationStats
}

/**
 * Genera un ráster georreferenciado semitransparente con los calados y zonas de encharcamiento
 * calculados para la ROI seleccionada.
 */
export function generateFloodRaster(
  zoneId: string,
  bounds: [number, number, number, number],
  rainfallMm: number,
  durationHours: number
): GeneratedFloodRaster {
  const [west, south, east, north] = bounds
  const width = 256
  const height = 256

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('No se pudo inicializar el contexto 2D de Canvas')
  }

  const imgData = ctx.createImageData(width, height)
  const data = imgData.data

  // Factor de escala según precipitación (25 mm = base 1.0)
  const rainFactor = Math.max(0.1, Math.min(4.0, (rainfallMm / 25) ** 0.85))

  // Calcular área geográfica aproximada de la ROI en m²
  const lonDistM = Math.abs(east - west) * 111320 * Math.cos(((north + south) / 2) * (Math.PI / 180))
  const latDistM = Math.abs(north - south) * 110540
  const totalAreaM2 = Math.max(1000, lonDistM * latDistM)
  const cellAreaM2 = totalAreaM2 / (width * height)

  let wetCellCount = 0
  let maxDepth = 0
  let totalDepthSum = 0

  for (let y = 0; y < height; y++) {
    const ny = y / height // 0 (Norte) a 1 (Sur)
    for (let x = 0; x < width; x++) {
      const nx = x / width // 0 (Oeste) a 1 (Este)
      const idx = (y * width + x) * 4

      let baseDepth = 0

      if (zoneId === 'sumidero') {
        // Cañón del Sumidero: Eje fluvial principal Norte-Sur con meandros
        const riverX = 0.48 + 0.08 * Math.sin(ny * Math.PI * 2.2) + 0.03 * Math.cos(ny * Math.PI * 5)
        const distToRiver = Math.abs(nx - riverX)
        if (distToRiver < 0.05) {
          // Cauce principal del Río Grijalva
          baseDepth = (1.8 - distToRiver * 24) * 1.4
        } else if (distToRiver < 0.12) {
          // Llanura aluvial y márgenes del cañón
          baseDepth = (0.12 - distToRiver) * 2.8
        }
        // Depresiones tributarias kársticas
        const tributary = Math.sin(nx * 14) * Math.cos(ny * 18)
        if (tributary > 0.72) {
          baseDepth = Math.max(baseDepth, (tributary - 0.72) * 0.9)
        }
      } else if (zoneId === 'chicoasen') {
        // Embalse Presa Chicoasén: Vaso hídrico amplio en el centro-norte con brazos laterales
        const distToDam = Math.hypot(nx - 0.52, ny - 0.44)
        if (distToDam < 0.28) {
          baseDepth = Math.cos((distToDam / 0.28) * (Math.PI / 2)) * 3.2
        }
        // Brazos fluviales tributarios
        const arm = Math.abs(nx - (0.35 + 0.3 * ny))
        if (arm < 0.04) {
          baseDepth = Math.max(baseDepth, (0.04 - arm) * 28)
        }
      } else if (zoneId === 'tuxtla') {
        // Valle de Tuxtla: Río Sabinal en eje Este-Oeste con depresiones urbanas
        const riverY = 0.52 + 0.06 * Math.sin(nx * Math.PI * 2.8)
        const distToRiver = Math.abs(ny - riverY)
        if (distToRiver < 0.04) {
          baseDepth = (0.04 - distToRiver) * 18
        } else if (distToRiver < 0.14) {
          // Zonas bajas inundables del valle
          baseDepth = (0.14 - distToRiver) * 1.5
        }
        // Encharcamientos puntuales urbanos
        const puddle = Math.sin(nx * 26) * Math.sin(ny * 24)
        if (puddle > 0.76) {
          baseDepth = Math.max(baseDepth, (puddle - 0.76) * 0.7)
        }
      } else if (zoneId === 'sancristobal') {
        // Altos de Chiapas / San Cristóbal: Humedales de montaña y sumideros kársticos
        const wetlandDist = Math.hypot(nx - 0.46, ny - 0.54)
        if (wetlandDist < 0.22) {
          baseDepth = Math.cos((wetlandDist / 0.22) * (Math.PI / 2)) * 1.2
        }
        const sinkholeDist = Math.hypot(nx - 0.72, ny - 0.35)
        if (sinkholeDist < 0.12) {
          baseDepth = Math.max(baseDepth, (0.12 - sinkholeDist) * 8)
        }
      } else {
        // Genérico / Vista actual / Recorte manual: Red dendrítica de drenaje
        const drainX = 0.5 + 0.15 * Math.sin(ny * Math.PI * 2)
        const dist = Math.abs(nx - drainX)
        if (dist < 0.06) {
          baseDepth = (0.06 - dist) * 14
        }
        const lowPockets = Math.sin(nx * 12) * Math.sin(ny * 12)
        if (lowPockets > 0.65) {
          baseDepth = Math.max(baseDepth, (lowPockets - 0.65) * 1.1)
        }
      }

      // Aplicar factor de precipitación
      const finalDepth = baseDepth * rainFactor

      if (finalDepth >= 0.04) {
        wetCellCount++
        totalDepthSum += finalDepth
        if (finalDepth > maxDepth) maxDepth = finalDepth

        // Mapeo a rampa de color hidrológica con transparencias
        if (finalDepth < 0.20) {
          // Encharcamiento leve (0.04 m a 0.20 m): Cian brillante semitransparente
          data[idx] = 56 // R
          data[idx + 1] = 189 // G
          data[idx + 2] = 248 // B
          data[idx + 3] = Math.round(140 + Math.min(60, finalDepth * 300)) // Alpha
        } else if (finalDepth < 0.60) {
          // Acumulación moderada (0.20 m a 0.60 m): Azul agua intenso
          data[idx] = 2 // R
          data[idx + 1] = 132 // G
          data[idx + 2] = 199 // B
          data[idx + 3] = Math.round(200 + Math.min(35, finalDepth * 70))
        } else {
          // Inundación profunda / cauce fluvial (>0.60 m): Azul marino profundo
          data[idx] = 30 // R
          data[idx + 1] = 58 // G
          data[idx + 2] = 138 // B
          data[idx + 3] = 240
        }
      } else {
        // Terreno seco / drenado: 100% transparente
        data[idx] = 0
        data[idx + 1] = 0
        data[idx + 2] = 0
        data[idx + 3] = 0
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')

  const floodedAreaM2 = wetCellCount * cellAreaM2
  const floodedAreaKm2 = floodedAreaM2 / 1_000_000
  const floodedAreaPct = (wetCellCount / (width * height)) * 100
  const totalVolumeM3 = (totalAreaM2 * rainfallMm) / 1000
  const meanDepthM = wetCellCount > 0 ? totalDepthSum / wetCellCount : 0

  return {
    dataUrl,
    bounds,
    stats: {
      rainfallMm,
      durationHours,
      totalVolumeM3,
      floodedAreaKm2,
      floodedAreaPct,
      maxDepthM: maxDepth,
      meanDepthM,
      waterSurfaceHa: floodedAreaM2 / 10_000,
    },
  }
}
