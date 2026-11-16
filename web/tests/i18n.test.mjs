import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useTranslation } from '../src/i18n/useTranslation.ts'
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

test('stored known messages follow language switches in both directions without translating their parameters', () => {
  const spanish = 'Error al conectar con la API de simulación'
  setLanguage('en')
  const stored = localizeText(spanish)
  assert.equal(stored, 'Error connecting to the simulation API')
  const source = 'No se pudo leer https://example.test/SCENE_P05023.json: HTTP 503'
  const translated = localizeText(source)
  assert.equal(translated, 'Could not read https://example.test/SCENE_P05023.json: HTTP 503')
  setLanguage('es')
  assert.equal(localizeText(stored), spanish)
  assert.equal(localizeText(translated), source)
  assert.equal(localizeText('My user map P05023'), 'My user map P05023')
})

test('the public React hook renders scientific labels in the selected language', () => {
  function Label() {
    const { language, t } = useTranslation()
    return createElement('span', { lang: language }, t('Calado: {value} m', 'Water depth: {value} m', { value: 0.25 }))
  }
  setLanguage('en')
  assert.equal(renderToStaticMarkup(createElement(Label)), '<span lang="en">Water depth: 0.25 m</span>')
  setLanguage('es')
  assert.equal(renderToStaticMarkup(createElement(Label)), '<span lang="es">Calado: 0.25 m</span>')
})

test('a new application session restores only a supported saved preference', () => {
  const moduleUrl = new URL('../src/i18n/core.ts', import.meta.url).href
  for (const [stored, expected] of [['en', 'en'], ['es', 'es'], ['unsupported', 'es']]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const values = new Map([['${LANGUAGE_STORAGE_KEY}', ${JSON.stringify(stored)}], ['saved-maps', 'untouched']]);
      globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
      const m = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify({ language: m.getLanguage(), maps: values.get('saved-maps'), count: values.size }));
    `], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(result.stdout.trim(), JSON.stringify({ language: expected, maps: 'untouched', count: 2 }))
  }
})

test('translation works when browser storage is blocked', () => {
  const previous = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
  assert.doesNotThrow(() => setLanguage('en'))
  assert.equal(getLanguage(), 'en')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous, writable: true })
  setLanguage('es')
})
