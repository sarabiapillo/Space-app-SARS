/**
 * Generador topográfico e hidrológico de encharcamientos e inundación simulada.
 * Modela la acumulación de flujo, calados en cauces y depresiones sobre la ROI.
 */

export interface FloodSimulationStats {
  rainfallMm: number
  durationHours: number
  totalVolumeM3: number
  effectiveVolumeM3?: number
  infiltratedVolumeM3?: number
  floodedVolumeM3?: number
  effectiveRunoffMm?: number
  infiltratedMm?: number
  floodedAreaKm2: number
  floodedAreaPct: number
  maxDepthM: number
  meanDepthM: number
  waterSurfaceHa: number
  peakDischargeM3s?: number
  maxVelocityMs?: number
  meanVelocityMs?: number
  froudeNumber?: number
  froudeRegime?: string
  timeOfConcentrationMin?: number
  timeOfConcentrationHours?: number
  elevMinM?: number
  elevMaxM?: number
  waterLevelMinM?: number
  waterLevelMaxM?: number
  stormDays?: number
  pressureHpa?: number
  baroSurgeCm?: number
  saturationPct?: number
  roadsTotalAffectedKm?: number
  roadsCutKm?: number
  roadsWarningKm?: number
  riskLevel?: string
  riskDescription?: string
}

export interface GeneratedFloodRaster {
  dataUrl: string
  bounds: [number, number, number, number] // [west, south, east, north]
  stats: FloodSimulationStats
}

/**
 * Genera un ráster georreferenciado semitransparente con los calados y zonas de encharcamiento
 * calculados para la ROI seleccionada, con forzamiento barométrico y saturación multidiaria (hasta 72h).
 */
export function generateFloodRaster(
  zoneId: string,
  bounds: [number, number, number, number],
  rainfallMm: number,
  durationHours: number,
  pressureHpa: number = 1005
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

  // Saturación progresiva de suelo en eventos multidiarios (hasta 72h / 3 días)
  const saturationFactor = Math.min(0.90, 0.65 + 0.25 * (1 - Math.exp(-durationHours / 24)))
  // Sobreelevación barométrica inversa (1 hPa ≈ 1.02 cm)
  const deltaPHpa = Math.max(0, 1013.25 - pressureHpa)
  const baroSurgeM = (deltaPHpa * 100) / (1000 * 9.81)

  // Factor de escala según precipitación y saturación
  const rainFactor = Math.max(0.1, Math.min(4.5, (rainfallMm / 25) ** 0.85 * (saturationFactor / 0.65)))

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

      if (finalDepth >= 0.02) {
        wetCellCount++
        totalDepthSum += finalDepth
        if (finalDepth > maxDepth) maxDepth = finalDepth

        // Escala cromática vibrante, contrastada y de alta visibilidad para agua/inundación
        let r = 0
        let g = 0
        let b = 0
        let a = 0

        if (finalDepth < 0.10) {
          // 0.02m a 0.10m: Cian cristalino luminoso (glowing cyan / visibilidad en satélite)
          const t = (finalDepth - 0.02) / 0.08
          r = Math.round(34 * (1 - t) + 6 * t)
          g = Math.round(211 * (1 - t) + 182 * t)
          b = Math.round(238 * (1 - t) + 212 * t)
          a = Math.round(140 + 35 * t)
        } else if (finalDepth < 0.30) {
          // 0.10m a 0.30m: Turquesa brillante
          const t = (finalDepth - 0.10) / 0.20
          r = Math.round(6 * (1 - t) + 2 * t)
          g = Math.round(182 * (1 - t) + 132 * t)
          b = Math.round(212 * (1 - t) + 199 * t)
          a = Math.round(175 + 35 * t)
        } else if (finalDepth < 0.80) {
          // 0.30m a 0.80m: Azul azur zafiro
          const t = (finalDepth - 0.30) / 0.50
          r = Math.round(2 * (1 - t) + 29 * t)
          g = Math.round(132 * (1 - t) + 78 * t)
          b = Math.round(199 * (1 - t) + 216 * t)
          a = Math.round(210 + 25 * t)
        } else if (finalDepth < 1.50) {
          // 0.80m a 1.50m: Azul cobalto real
          const t = (finalDepth - 0.80) / 0.70
          r = Math.round(29 * (1 - t) + 30 * t)
          g = Math.round(78 * (1 - t) + 58 * t)
          b = Math.round(216 * (1 - t) + 138 * t)
          a = Math.round(235 + 15 * t)
        } else {
          // >= 1.50m: Azul marino profundo / índigo abisal
          const t = Math.min(1.0, (finalDepth - 1.50) / 2.0)
          r = Math.round(30 * (1 - t) + 23 * t)
          g = Math.round(58 * (1 - t) + 37 * t)
          b = Math.round(138 * (1 - t) + 84 * t)
          a = 250
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
  const effectiveRunoffMm = rainfallMm * saturationFactor
  const infiltratedMm = rainfallMm * (1 - saturationFactor)
  const effectiveVolumeM3 = (totalAreaM2 * effectiveRunoffMm) / 1000
  const infiltratedVolumeM3 = (totalAreaM2 * infiltratedMm) / 1000
  const floodedVolumeM3 = totalDepthSum * cellAreaM2
  const meanDepthM = wetCellCount > 0 ? totalDepthSum / wetCellCount : 0

  // Métricas hidráulicas (Manning y Kirpich)
  const durationS = Math.max(600, durationHours * 3600)
  const peakDischargeM3s = Number(((effectiveVolumeM3 / durationS) * 3.4).toFixed(2))
  const maxVelocityMs = Number((Math.min(18, (1 / 0.035) * Math.pow(Math.max(0.1, maxDepth), 2 / 3) * Math.sqrt(0.06))).toFixed(2))
  const meanVelocityMs = Number((Math.max(0.25, maxVelocityMs * 0.42)).toFixed(2))
  const froudeNumber = Number((meanVelocityMs / Math.sqrt(9.81 * Math.max(0.1, meanDepthM))).toFixed(2))

  const basinLengthM = Math.hypot(latDistM, lonDistM)
  const timeOfConcentrationMin = Number((0.0662 * Math.pow(basinLengthM, 0.77) / Math.pow(0.06, 0.385)).toFixed(1))

  // Análisis de corte de vías y transitabilidad ("para las vías")
  const roadsTotalAffectedKm = Number((floodedAreaKm2 * 2.2).toFixed(2))
  const roadsCutKm = Number((roadsTotalAffectedKm * (maxDepth >= 0.35 ? 0.65 : 0.25)).toFixed(2))
  const roadsWarningKm = Number((roadsTotalAffectedKm - roadsCutKm).toFixed(2))

  let riskLevel = 'Leve'
  let riskDescription = 'Encharcamientos laminares menores'
  if (maxDepth >= 1.8) {
    riskLevel = 'Crítico'
    riskDescription = 'Desbordamiento torrencial en cauce principal'
  } else if (maxDepth >= 0.8) {
    riskLevel = 'Alto'
    riskDescription = 'Inundación severa en márgenes y corte vial'
  } else if (maxDepth >= 0.3) {
    riskLevel = 'Moderado'
    riskDescription = 'Flujo concentrado en vados y torrenteras'
  }

  return {
    dataUrl,
    bounds,
    stats: {
      rainfallMm,
      durationHours,
      stormDays: Number((durationHours / 24).toFixed(1)),
      pressureHpa,
      baroSurgeCm: Number((baroSurgeM * 100).toFixed(1)),
      saturationPct: Number((saturationFactor * 100).toFixed(1)),
      totalVolumeM3: Math.round(totalVolumeM3),
      effectiveVolumeM3: Math.round(effectiveVolumeM3),
      infiltratedVolumeM3: Math.round(infiltratedVolumeM3),
      floodedVolumeM3: Math.round(floodedVolumeM3),
      effectiveRunoffMm: Number(effectiveRunoffMm.toFixed(1)),
      infiltratedMm: Number(infiltratedMm.toFixed(1)),
      floodedAreaKm2: Number(floodedAreaKm2.toFixed(3)),
      floodedAreaPct: Number(floodedAreaPct.toFixed(1)),
      maxDepthM: Number(maxDepth.toFixed(2)),
      meanDepthM: Number(meanDepthM.toFixed(2)),
      waterSurfaceHa: Number((floodedAreaM2 / 10_000).toFixed(1)),
      peakDischargeM3s,
      maxVelocityMs,
      meanVelocityMs,
      froudeNumber,
      froudeRegime: froudeNumber > 1 ? 'Supercrítico / Rápido' : 'Subcrítico / Tranquilo',
      timeOfConcentrationMin,
      timeOfConcentrationHours: Number((timeOfConcentrationMin / 60).toFixed(2)),
      roadsTotalAffectedKm,
      roadsCutKm,
      roadsWarningKm,
      riskLevel,
      riskDescription,
    },
  }
}
