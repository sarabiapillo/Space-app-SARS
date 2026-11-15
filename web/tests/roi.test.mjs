import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rectangleFromCorners } from '../src/utils/roi.ts'

test('dos esquinas generan un rectángulo, cualquiera que sea el orden', () => {
  const expected = [[-93.1, 16.7], [-93, 16.7], [-93, 16.8], [-93.1, 16.8]]
  for (const [a, b] of [[expected[0], expected[2]], [expected[2], expected[0]], [expected[1], expected[3]], [expected[3], expected[1]]]) {
    assert.deepEqual(rectangleFromCorners(a, b), expected)
  }
})

test('rechaza rectángulos degenerados, fuera de límites y excesivos', () => {
  for (const [a, b] of [[[0, 0], [0, 1]], [[0, 0], [1, 0]], [[NaN, 0], [1, 1]], [[181, 0], [182, 1]], [[0, 86], [1, 87]], [[0, 0], [2, 2]]]) {
    assert.throws(() => rectangleFromCorners(a, b))
  }
})
