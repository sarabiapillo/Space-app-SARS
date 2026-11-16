import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLanguage, setLanguage, subscribeLanguage, translate, localizeText, languageLocale, LANGUAGE_STORAGE_KEY } from '../src/i18n/core.ts'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
}
globalThis.document = { documentElement: { lang: 'es' } }

test('Spanish remains the default and English uses contextual scientific wording', () => {
  assert.equal(getLanguage(), 'es')
  assert.equal(translate('Retrodispersión', 'Backscatter'), 'Retrodispersión')
  setLanguage('en')
  assert.equal(translate('Retrodispersión', 'Backscatter'), 'Backscatter')
  assert.equal(languageLocale(), 'en-US')
  assert.equal(document.documentElement.lang, 'en')
  setLanguage('es')
  assert.equal(languageLocale(), 'es-MX')
})

test('the language preference persists without modifying saved maps or payloads', () => {
  const saved = '{"name":"Mi mapa","scene":"GCOV","roi":[[-93,16]]}'
  storage.set('terrapulse-maps-v1', saved)
  setLanguage('en')
  assert.equal(storage.get(LANGUAGE_STORAGE_KEY), 'en')
  assert.equal(storage.get('terrapulse-maps-v1'), saved)
  setLanguage('es')
  assert.equal(storage.get(LANGUAGE_STORAGE_KEY), 'es')
})

test('switching language notifies subscribers once; invalid values are ignored', () => {
  let calls = 0
  const unsubscribe = subscribeLanguage(() => { calls++ })
  setLanguage('en')
  setLanguage('en')
  setLanguage('xx')
  assert.equal(getLanguage(), 'en')
  assert.equal(calls, 1)
  unsubscribe()
  setLanguage('es')
  assert.equal(calls, 1)
})

test('interpolation preserves numbers, identifiers and user-provided names', () => {
  setLanguage('en')
  assert.equal(translate('Escena {id}: {value} dB', 'Scene {id}: {value} dB', { id: 'NISAR_P05023', value: -12.5 }), 'Scene NISAR_P05023: -12.5 dB')
  assert.equal(translate('Mapa {name}', 'Map {name}', { name: 'Mi región <Chiapas>' }), 'Map Mi región <Chiapas>')
  assert.equal(localizeText('NISAR_P05023'), 'NISAR_P05023')
  setLanguage('es')
})

test('translation works when browser storage is blocked', () => {
  const previous = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
  assert.doesNotThrow(() => setLanguage('en'))
  assert.equal(getLanguage(), 'en')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous, writable: true })
  setLanguage('es')
})
