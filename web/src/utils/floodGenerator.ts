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
        // Cañón del Sumidero: El cauce del Río Grijalva discurre en el fondo de la garganta (nx ≈ 0.52 - 0.54)
        // con paredes verticales de más de 800m a ambos lados.
        const canyonCenter = 0.52 + 0.04 * Math.sin(ny * Math.PI * 1.8) + 0.02 * Math.cos(ny * Math.PI * 3.6)
        const distToCanyon = Math.abs(nx - canyonCenter)
        if (distToCanyon < 0.045) {
          // Fondo del cañón (cauce navegable y remansos profundos)
          const profile = Math.cos((distToCanyon / 0.045) * (Math.PI / 2))
          baseDepth = profile * 2.85
        } else if (distToCanyon < 0.09) {
          // Terrazas aluviales y pie de pared
          const profile = (0.09 - distToCanyon) / 0.045
          baseDepth = profile * 0.45
        }
        // Cañadas tributarias laterales
        const tributary1 = Math.abs((ny - 0.35) - 0.5 * (nx - 0.52))
        if (tributary1 < 0.015 && nx > 0.52) {
          baseDepth = Math.max(baseDepth, (0.015 - tributary1) * 22)
        }
      } else if (zoneId === 'chicoasen') {
        // Presa Chicoasén: Vaso de almacenamiento encajonado en el cañón hacia el norte
        const lakeCenter = 0.50 + 0.05 * (ny - 0.5)
        const distToLake = Math.hypot(nx - lakeCenter, (ny - 0.48) * 0.7)
        if (distToLake < 0.22) {
          const profile = Math.cos((distToLake / 0.22) * (Math.PI / 2))
          baseDepth = profile * 3.4
        }
        // Brazos y garganta de entrada
        const gorge = Math.abs(nx - 0.48)
        if (gorge < 0.035 && ny > 0.35) {
          baseDepth = Math.max(baseDepth, (0.035 - gorge) * 38)
        }
      } else if (zoneId === 'tuxtla') {
        // Valle de Tuxtla: Río Sabinal en el eje central Este-Oeste (ny ≈ 0.48 - 0.52)
        // recibiendo escorrentías del Cerro Mactumatzá y ladera norte
        const riverY = 0.50 + 0.035 * Math.sin(nx * Math.PI * 2.2)
        const distToRiver = Math.abs(ny - riverY)
        if (distToRiver < 0.035) {
          const profile = (0.035 - distToRiver) / 0.035
          baseDepth = profile * 1.6
        } else if (distToRiver < 0.12) {
          const profile = (0.12 - distToRiver) / 0.085
          baseDepth = profile * 0.35
        }
        // Vados y arroyos urbanos tributarios (Pochota, San Roque)
        const streamX = Math.abs(nx - (0.35 + 0.15 * ny))
        if (streamX < 0.018 && ny > 0.3) {
          baseDepth = Math.max(baseDepth, (0.018 - streamX) * 16)
        }
      } else if (zoneId === 'sancristobal') {
        // Altos de Chiapas / San Cristóbal: Valle plano intramontano (polje kárstico)
        const basinDist = Math.hypot(nx - 0.50, ny - 0.52)
        if (basinDist < 0.20) {
          baseDepth = Math.cos((basinDist / 0.20) * (Math.PI / 2)) * 1.35
        }
        // Sumideros kársticos
        const sinkDist = Math.hypot(nx - 0.68, ny - 0.38)
        if (sinkDist < 0.08) {
          baseDepth = Math.max(baseDepth, (0.08 - sinkDist) * 12)
        }
      } else {
        // Genérico / Selección personalizada: Red dendrítica natural de drenaje hacia la depresión
        const mainAxis = Math.abs(ny - (0.45 + 0.1 * Math.sin(nx * Math.PI * 2)))
        if (mainAxis < 0.04) {
          baseDepth = (0.04 - mainAxis) * 20
        } else if (mainAxis < 0.12) {
          baseDepth = (0.12 - mainAxis) * 2.2
        }
      }

      // Aplicar factor de precipitación
      const finalDepth = baseDepth * rainFactor

      if (finalDepth >= 0.03) {
        wetCellCount++
        totalDepthSum += finalDepth
        if (finalDepth > maxDepth) maxDepth = finalDepth

        // Escala continua y agradable de azul hidrológico (cerúleo suave -> turquesa -> azur -> cobalto oceánico)
        let r = 0
        let g = 0
        let b = 0
        let a = 0

        if (finalDepth < 0.15) {
          // 0.03m a 0.15m: Lámina tenue / Azul cerúleo suave cristalino
          const t = (finalDepth - 0.03) / 0.12
          r = Math.round(125 * (1 - t) + 56 * t)
          g = Math.round(211 * (1 - t) + 189 * t)
          b = Math.round(252 * (1 - t) + 248 * t)
          a = Math.round(75 + 65 * t)
        } else if (finalDepth < 0.40) {
          // 0.15m a 0.40m: Acumulación moderada / Azul turquesa laguna
          const t = (finalDepth - 0.15) / 0.25
          r = Math.round(56 * (1 - t) + 14 * t)
          g = Math.round(189 * (1 - t) + 165 * t)
          b = Math.round(248 * (1 - t) + 233 * t)
          a = Math.round(140 + 40 * t)
        } else if (finalDepth < 1.00) {
          // 0.40m a 1.00m: Calado profundo / Azul azur cobalto
          const t = (finalDepth - 0.40) / 0.60
          r = Math.round(14 * (1 - t) + 2 * t)
          g = Math.round(165 * (1 - t) + 132 * t)
          b = Math.round(233 * (1 - t) + 199 * t)
          a = Math.round(180 + 35 * t)
        } else {
          // >= 1.00m: Cauce principal / cañón hídrico / Azul marino profundo
          const t = Math.min(1.0, (finalDepth - 1.0) / 2.0)
          r = Math.round(2 * (1 - t) + 23 * t)
          g = Math.round(132 * (1 - t) + 37 * t)
          b = Math.round(199 * (1 - t) + 84 * t)
          a = Math.round(215 + 25 * t)
        }

        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
        data[idx + 3] = a
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
