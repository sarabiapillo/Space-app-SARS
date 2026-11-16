import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Render the real views; only the browser's canvas boundary is replaced.
export const capturedCharts = []
const reactModule = import.meta.resolve('react')
globalThis.__terrapulseTestCharts = capturedCharts
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react-chartjs-2') return { url: 'test:chart-canvas', shortCircuit: true }
    if (specifier.startsWith('.') && !/\.(tsx?|jsx?)$/.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL)
      for (const extension of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        if (existsSync(fileURLToPath(new URL(base.href + extension)))) return next(specifier + extension, context)
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url === 'test:chart-canvas') return { format: 'module', shortCircuit: true, source: `
      import {createElement} from ${JSON.stringify(reactModule)};
      function Canvas(props) { globalThis.__terrapulseTestCharts.push(props); return createElement('canvas'); }
      export { Canvas as Bar, Canvas as Line, Canvas as Doughnut };
    ` }
    if (!url.endsWith('.tsx')) return next(url, context)
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
    }).outputText }
  },
})

export const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
