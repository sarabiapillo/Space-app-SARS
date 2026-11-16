import { languageLocale, translate as tr } from '../i18n/core.ts'

const formats = new Map<string, { relative: Intl.RelativeTimeFormat; date: Intl.DateTimeFormat }>()
function displayFormats(locale: string) {
  let format = formats.get(locale)
  if (!format) {
    format = {
      relative: new Intl.RelativeTimeFormat(locale === 'es-MX' ? 'es' : locale, { numeric: 'auto', style: 'short' }),
      date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    }
    formats.set(locale, format)
  }
  return format
}

/** "hace 5 min", "hace 3 h", "ayer", o la fecha si pasó más de una semana. */
export function formatRelative(iso: string, now: number): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return tr('fecha desconocida', 'unknown date')

  const seconds = Math.round((time - now) / 1000)
  const abs = Math.abs(seconds)

  if (abs < 45) return tr('hace un momento', 'just now')
  const { relative, date } = displayFormats(languageLocale())
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day')
  return date.format(time)
}
