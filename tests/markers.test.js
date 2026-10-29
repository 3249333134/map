const { test } = require('node:test')
const assert = require('node:assert/strict')
const { markersFor } = require('../utils/markers')
test('标记保持稳定 ID 和坐标，只有选中点高亮并常驻标题', () => {
  const points = [{ id: 7, title: '公园', latitude: 30, longitude: 104 }, { id: 9, title: '咖啡', latitude: 31, longitude: 105 }]
  const result = markersFor(points, 9)
  assert.deepEqual(result.map(marker => marker.id), [7, 9])
  assert.equal(result[1].latitude, 31)
  assert.equal(result[1].callout.display, 'ALWAYS')
  assert.equal(result[0].callout.display, 'BYCLICK')
  assert.ok(result[1].width > result[0].width)
  assert.deepEqual(markersFor([], 9), [])
})
