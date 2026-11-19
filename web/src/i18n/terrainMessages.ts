// Catálogo de mensajes del módulo aislado "Relieve 3D" (utils/terrain3d.ts y Terrain3DViewer).
// Solo texto de interfaz y errores; nunca se traducen cifras, fuentes ni nombres de ROI.
export const terrainMessages: Record<string, string> = {
  'Relieve 3D': '3D Relief',
  'sin elevación válida': 'no valid elevation',
  '{n} teselas no disponibles': '{n} tiles unavailable',
  'canvas 2d': '2D canvas unavailable',
  'Selecciona primero una ROI para ver su relieve 3D.': 'Select an ROI first to view its 3D relief.',
  'La ROI es demasiado grande para el relieve 3D (máximo 3° por lado).': 'The ROI is too large for the 3D relief (maximum 3° per side).',
}
