import { shellMessages } from './shellMessages.ts'
import { mapMessages } from './mapMessages.ts'
import { chartMessages } from './chartMessages.ts'
import { simulationMessages } from './simulationMessages.ts'
import { terrainMessages } from './terrainMessages.ts'

export type Language = 'es' | 'en'
export type TranslationValues = Record<string, string | number>
export const LANGUAGE_STORAGE_KEY = 'terrapulse:language:v1'

function readPreference(): Language {
  try { return globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'es' }
  catch { return 'es' }
}

let language: Language = readPreference()
const listeners = new Set<() => void>()

export function getLanguage(): Language { return language }
export function languageLocale(): string { return language === 'en' ? 'en-US' : 'es-MX' }
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setLanguage(next: Language): void {
  if (next !== 'es' && next !== 'en') return
  const changed = next !== language
  language = next
  try { globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, next) } catch { /* Storage may be blocked. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  if (changed) listeners.forEach(listener => listener())
}

/** Explicit context-specific pairs; never translate data or identifiers. */
export function translate(es: string, en: string, values: TranslationValues = {}): string {
  return (language === 'en' ? en : es).replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token)
}

/** Curated display-only translations for API messages and scientific labels. */
export function localizeText(value: string | null | undefined): string {
  if (value == null) return ''
  const messages: Record<string, string> = { ...shellMessages, ...mapMessages, ...chartMessages, ...simulationMessages, ...terrainMessages }
  if (Object.hasOwn(messages, value)) return language === 'en' ? messages[value] : value
  for (const [spanish, english] of Object.entries(messages)) {
    const [source, target] = language === 'en' ? [spanish, english] : [english, spanish]
    if (value === source) return target
    if (!source.includes('{')) continue
    const names: string[] = []
    const escaped = source.split(/(\{\w+\})/g).map(part => {
      if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]+?)' }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }).join('')
    const match = new RegExp('^' + escaped + '$').exec(value)
    if (match) return target.replace(/\{(\w+)\}/g, (token, key: string) => {
      const index = names.indexOf(key)
      return index < 0 ? token : match[index + 1]
    })
  }
  return value
}
