const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })

/** "hace 5 min", "hace 3 h", "ayer", o la fecha si pasó más de una semana. */
export function formatRelative(iso: string, now: number): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return 'fecha desconocida'

  const seconds = Math.round((time - now) / 1000)
  const abs = Math.abs(seconds)

  if (abs < 45) return 'hace un momento'
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day')
  return dateFmt.format(time)
}
