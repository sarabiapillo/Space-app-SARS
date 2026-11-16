import { useMemo, useSyncExternalStore } from 'react'
import { getLanguage, setLanguage, subscribeLanguage, translate, localizeText, languageLocale } from './core.ts'

/** Subscribe without remounting map canvases or resetting form state. */
export function useTranslation() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'es' as const)
  return useMemo(() => ({
    language, setLanguage, t: translate, localizeText, locale: languageLocale(),
  }), [language])
}
