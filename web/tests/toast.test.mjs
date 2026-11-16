import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { scheduleToastDismiss, readyRoiToastKey } from '../src/utils/toastTimer.ts'

test('el aviso informativo se presenta como estado, no como alerta ni éxito', () => {
  const source = readFileSync(new URL('../src/components/Toast.tsx', import.meta.url), 'utf8')
  assert.match(source, /'success' \| 'error' \| 'info'/)
  assert.match(source, /app-toast--\$\{message\.kind\}/)
  assert.match(source, /role=\{message\.kind === 'error' \? 'alert' : 'status'\}/)
})

test('el aviso se cierra a los 3000 ms y puede cancelar el temporizador al cerrarse o reemplazarse', () => {
  let callback, delay, canceled = false
  const schedule = (fn, ms) => { callback = fn; delay = ms; return 7 }
  const clear = id => { assert.equal(id, 7); canceled = true }
  const closed = []
  const cancel = scheduleToastDismiss(3, id => closed.push(id), schedule, clear)
  assert.equal(delay, 3000)
  callback()
  assert.deepEqual(closed, [3])
  cancel()
  assert.equal(canceled, true)
})

test('el aviso de capas listas aparece una vez por carga completa de ROI', () => {
  assert.equal(readyRoiToastKey(null, 'roi:a', true, false, 2), null)
  assert.equal(readyRoiToastKey(null, 'roi:a', false, true, 2), null)
  assert.equal(readyRoiToastKey(null, 'roi:a', false, false, 0), null)
  assert.equal(readyRoiToastKey(null, 'roi:a', false, false, 2), 'roi:a')
  assert.equal(readyRoiToastKey('roi:a', 'roi:a', false, false, 2), null)
  assert.equal(readyRoiToastKey('roi:a', 'roi:b', false, false, 2), 'roi:b')
})
