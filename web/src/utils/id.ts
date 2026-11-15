/** Genera un id único para una copia nueva. `randomUUID` requiere contexto seguro (https o localhost). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
