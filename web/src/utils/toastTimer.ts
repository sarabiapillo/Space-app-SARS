export function readyRoiToastKey(
  previousKey: string | null,
  key: string,
  loading: boolean,
  error: boolean,
  manifestCount: number,
): string | null {
  return !loading && !error && manifestCount > 0 && previousKey !== key ? key : null
}

export function scheduleToastDismiss(
  id: number,
  onClose: (id: number) => void,
  schedule: (callback: () => void, delay: number) => number = window.setTimeout,
  clear: (timer: number) => void = window.clearTimeout,
): () => void {
  const timer = schedule(() => onClose(id), 3000)
  return () => clear(timer)
}
