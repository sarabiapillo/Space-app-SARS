import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setLanguage, localizeText } from '../src/i18n/core.ts'

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.(tsx?|jsx?)$/.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL)
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        if (existsSync(fileURLToPath(new URL(base.href + suffix)))) return next(specifier + suffix, context)
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.endsWith('.tsx')) return next(url, context)
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText }
  },
})
test('header publicly renders an accessible language selector and responds to the selected language', async () => {
  const { Header } = await import('../src/components/Header.tsx')
  const props = { viewMode: 'general', onViewModeChange() {}, canShowEdited: false, hasConfirmedROI: false, onDuplicate() {}, onExportJson() {}, opacity: 100, onOpacityChange() {}, exploreLayerId: 'gamma0_HHHH_ml2_dB', onExploreLayerChange() {}, dateViewMode: 't1', onDateViewModeChange() {}, colormapId: 'inferno', onColormapChange() {}, activeTool: 'mover', solar: { enabled: false }, onSolarChange() {}, activeDockTab: 'map', onDockTabChange() {}, floatingToolsOpen: true, onToggleFloatingTools() {}, isCaptureMode: false, onStartCaptureMode() {}, onOpenTeamPage() {} }
  try {
    setLanguage('es')
    const es = renderToStaticMarkup(React.createElement(Header, props))
    assert.match(es, /aria-label="Idioma"[^>]*><option value="es" selected="">Español<\/option><option value="en">English<\/option>/)
    assert.match(es, />Archivo<\/button>/)
    setLanguage('en')
    const en = renderToStaticMarkup(React.createElement(Header, props))
    assert.match(en, /aria-label="Language"[^>]*><option value="es">Español<\/option><option value="en" selected="">English<\/option>/)
    assert.match(en, />File<\/button>/)
    assert.match(en, /Data maturity|No calculated data for a region of interest/)
  } finally { setLanguage('es') }
})
test('shell offers an accessible native language selector in the existing menu bar', () => {
  const header = source('components/Header.tsx')
  assert.match(header, /useTranslation\(/)
  assert.match(header, /<select[\s\S]*?aria-label=\{t\('Idioma', 'Language'\)\}[\s\S]*?<option value="es">Español<\/option>[\s\S]*?<option value="en">English<\/option>/)
  assert.match(header, /onChange=\{\(e\) => setLanguage\(e\.target\.value as Language\)\}/)
})
test('curated shell translations preserve unknown user names and protocol values', () => {
  setLanguage('en')
  assert.equal(localizeText('Madurez desconocida'), 'Unknown data maturity')
  assert.equal(localizeText('Mi mapa personal'), 'Mi mapa personal')
  assert.equal(localizeText('PROVISIONAL'), 'PROVISIONAL')
  assert.equal(localizeText('Copia 3 - Mi mapa personal'), 'Copia 3 - Mi mapa personal')
  setLanguage('es')
})
test('shell subscribes to language changes without remounting map or changing saved names', () => {
  for (const file of ['App.tsx', 'components/Sidebar.tsx', 'components/TeamLandingPage.tsx', 'components/DuplicateMapModal.tsx']) assert.match(source(file), /useTranslation\(/)
  assert.match(source('App.tsx'), /activeMapName=\{isEditing && activeCopy \? activeCopy\.nombre : null\}/)
  assert.match(source('components/Sidebar.tsx'), /setEditingName\(map\.nombre\)/)
})
