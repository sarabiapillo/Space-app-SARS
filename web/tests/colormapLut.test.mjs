import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal browser stubs: a decodable 1x1 image and a canvas that yields a Blob.
const created = []
const revoked = []
let sequence = 0
globalThis.Image = class {
  width = 1
  height = 1
  naturalWidth = 1
  naturalHeight = 1
  set src(value) { this._src = value; queueMicrotask(() => this.onload()) }
  get src() { return this._src }
}
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([10, 10, 10, 255]) }), putImageData() {} }),
    toBlob: callback => callback(new Blob(['png'])),
    toDataURL: () => 'data:image/png;base64,',
  }),
}
URL.createObjectURL = () => { const url = `blob:test/${sequence++}`; created.push(url); return url }
URL.revokeObjectURL = url => { revoked.push(url) }

const { colorizePngWithLut, COLORIZED_URL_CACHE_LIMIT } = await import('../src/utils/colormapLut.ts')
const settle = () => new Promise(resolve => setImmediate(resolve))

test('grayscale keeps the original PNG URL and creates no blob', async () => {
  const before = created.length
  assert.equal(await colorizePngWithLut('/gray.png', 'grayscale'), '/gray.png')
  assert.equal(created.length, before)
})

test('same PNG and colormap reuse the cached blob URL', async () => {
  const first = await colorizePngWithLut('/reuse.png', 'inferno')
  assert.equal(await colorizePngWithLut('/reuse.png', 'inferno'), first)
  assert.notEqual(await colorizePngWithLut('/reuse.png', 'viridis'), first)
})

test('cache is bounded and revokes the least recently used blob on eviction', async () => {
  assert.ok(Number.isInteger(COLORIZED_URL_CACHE_LIMIT) && COLORIZED_URL_CACHE_LIMIT >= 4)
  const urls = []
  for (let i = 0; i < COLORIZED_URL_CACHE_LIMIT; i++) urls.push(await colorizePngWithLut(`/lru-${i}.png`, 'turbo'))
  // Touch the oldest entry: it becomes most recent and must survive the next eviction.
  assert.equal(await colorizePngWithLut('/lru-0.png', 'turbo'), urls[0])
  await colorizePngWithLut('/lru-overflow.png', 'turbo')
  await settle()
  assert.ok(!revoked.includes(urls[0]), 'recently used blob must not be revoked')
  assert.ok(revoked.includes(urls[1]), 'least recently used blob must be revoked')
  assert.notEqual(await colorizePngWithLut('/lru-1.png', 'turbo'), urls[1], 'evicted entry is recolorized, never a revoked URL')
})
