// Auditoría estructural complementaria; no sustituye pruebas de interfaz.
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const findings = []
const neutral = /^(?:[\s\d\W_]|ROI|GCOV|NISAR|NASA|ISRO|CRID|EPSG|HH|HV|HHHH|HVHV|RTC|DEM|SAR|COG|PNG|JSON|GeoTIFF|GeoJSON|Chart\.js|MapLibre|TerraPulse AI|MonitosCH|dB|km|km²|m|m²|m³|mm|s|h|W\/m²|t1|t2|ASC|DESC|DNI|DHI|GHI)+$/u
const visibleAttributes = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label'])
const visibleProperties = new Set(['label', 'title', 'description', 'message', 'placeholder', 'ariaLabel'])
function walkFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walkFiles(path)
    else if (path.endsWith('.tsx')) inspect(path)
  }
}
function inspect(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function report(node, kind, value) {
    const text = value.replace(/\s+/g, ' ').trim()
    if (!text || neutral.test(text)) return
    findings.push({ file: relative(root, path), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, text })
  }
  function visit(node) {
    if (ts.isCallExpression(node) && /^(?:t|tr|translate|localizeText)$/.test(node.expression.getText(source))) return
    if (ts.isJsxText(node)) report(node, 'jsx', node.text)
    if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) report(node, 'attribute', node.initializer.text)
    if (ts.isPropertyAssignment(node) && visibleProperties.has(node.name.getText(source).replace(/^['"]|['"]$/g, '')) && ts.isStringLiteral(node.initializer)) report(node, 'property', node.initializer.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
}
walkFiles(root)
console.log(JSON.stringify({ findings: findings.length, items: findings }, null, 2))
// Se revisan manualmente las excepciones científicas y nombres propios.
