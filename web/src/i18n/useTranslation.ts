import { useMemo, useSyncExternalStore } from 'react'
import { getLanguage, setLanguage, subscribeLanguage, translate, localizeText, languageLocale, type TranslationValues } from './core.ts'

/** Subscribe without remounting map canvases or resetting form state. */
export function useTranslation() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
  return useMemo(() => ({
    language, setLanguage,
    t: (es: string, en: string, values?: TranslationValues) => translate(es, en, values),
    localizeText: (value: string | null | undefined) => localizeText(value),
    locale: languageLocale(),
  }), [language])
}
