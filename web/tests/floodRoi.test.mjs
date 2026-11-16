import test from 'node:test'
import assert from 'node:assert/strict'
import { floodRoiPolygon } from '../src/utils/floodRoi.ts'

test('serializes a selected triangle as a closed Polygon', () => {
  assert.deepEqual(floodRoiPolygon([[-1,0],[0,0],[0,1]]), {
    type:'Polygon', coordinates:[[[-1,0],[0,0],[0,1],[-1,0]]],
  })
})
test('rejects non-adjacent edge intersections including collinear touches', () => {
  assert.equal(floodRoiPolygon([[0,0],[2,0],[2,2],[1,0],[0,2]]), null)
})
test('rejects missing, degenerate, out-of-range, and self-crossing ROIs', () => {
  assert.equal(floodRoiPolygon(null), null)
  assert.equal(floodRoiPolygon([]), null)
  assert.equal(floodRoiPolygon([[0,0],[1,1],[2,2]]), null)
  assert.equal(floodRoiPolygon([[0,0],[181,0],[1,1],[0,0]]), null)
  assert.equal(floodRoiPolygon([[179,0],[-179,0],[179,1]]), null)
  assert.equal(floodRoiPolygon([[0,0],[1,1],[0,1],[1,0],[0,0]]), null)
})
