// Catálogo de mensajes del módulo aislado "Relieve 3D" (utils/terrain3d.ts y Terrain3DViewer).
// Solo texto de interfaz y errores; nunca se traducen cifras, fuentes ni nombres de ROI.
export const terrainMessages: Record<string, string> = {
  'Relieve 3D': '3D Relief',
  'sin elevación válida': 'no valid elevation',
  '{n} teselas no disponibles': '{n} tiles unavailable',
  'canvas 2d': '2D canvas unavailable',
  'Selecciona primero una ROI para ver su relieve 3D.': 'Select an ROI first to view its 3D relief.',
  'La ROI es demasiado grande para el relieve 3D (máximo 3° por lado).': 'The ROI is too large for the 3D relief (maximum 3° per side).',
  'Máscara SAR (Geometría)': 'SAR Mask (Geometry)',
  'Geometría de órbita NISAR': 'NISAR orbit geometry',
  'Ascendente (T62/F10)': 'Ascending (T62/F10)',
  'Descendente (T55/F80)': 'Descending (T55/F80)',
  'Confiable (≤ 15°)': 'Reliable (≤ 15°)',
  'Pendiente crítica (> 15°)': 'Critical slope (> 15°)',
  'Layover / Escorzo (≥ θᵢ)': 'Layover / Foreshortening (≥ θᵢ)',
  'Sombra radar (sin retorno)': 'Radar shadow (no return)',
  'Aproximación geométrica exploratoria a partir del DEM (θᵢ ≈ 43°); ilustra por qué el producto GCOV reporta shadowMaskingApplied = False.': 'Exploratory geometric approximation from the DEM (θᵢ ≈ 43°); illustrates why the GCOV product reports shadowMaskingApplied = False.',
}
