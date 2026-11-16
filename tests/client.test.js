const { test } = require('node:test')
const assert = require('node:assert/strict')
const config = require('../config/cloud')
const api = require('../utils/api')
function page(file) {
  let definition
  global.Page = value => { definition = value }
  delete require.cache[require.resolve(file)]
  require(file)
  const instance = { ...definition, data: structuredClone(definition.data), setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() } }
  return instance
}
test('未配置与断网明确报错，不回退到示例；演示模式可在本机走通写入', async () => {
  config.demoMode = false; config.envId = ''
  await assert.rejects(api.request('feed'), { code: 'CLOUD_NOT_CONFIGURED' })
  config.envId = 'test-only'
  global.wx = { cloud: { callFunction: async () => { throw new Error('offline') } } }
  await assert.rejects(api.request('feed'), { code: 'NETWORK' })
  config.demoMode = true
  const created = await api.request('content.create', { kind: 'post', title: '演示写入', text: '只保存在本机', category: '日常', latitude: 30.65, longitude: 104.06, place: '成都 · 春熙路', requestId: 'test-request-1' })
  assert.equal(created.status, 'published')
  const saved = await api.request('content.get', { id: created.id })
  assert.equal(saved.text, '只保存在本机')
  assert.equal(saved.mine, true)
  config.demoMode = false; config.envId = ''
})
test('云数据库字符串 ID 映射到稳定数字标记，过期查询不覆盖新筛选', async () => {
  config.demoMode = false; config.envId = 'test-only'
  const requests = []
  global.wx = { cloud: { callFunction: input => new Promise(resolve => requests.push({ input, resolve })) } }
  const instance = page('../pages/index/index.js')
  instance.resetScroll = () => {}; instance.scheduleMapFit = () => {}
  instance.data.query = '旧'; const old = instance.fetchFeed()
  instance.data.query = '新'; const recent = instance.fetchFeed()
  const item = { id: 'abcdef1234', title: '新的', latitude: 30.65, longitude: 104.06 }
  requests[1].resolve({ result: { ok: true, data: { items: [item], cursor: null } } }); await recent
  const marker = instance.data.items[0].markerId
  assert.equal(typeof marker, 'number')
  requests[0].resolve({ result: { ok: true, data: { items: [{ ...item, id: 'old-id' }], cursor: null } } }); await old
  assert.equal(instance.data.items[0].id, item.id)
  assert.equal(instance.assignMarkers([item])[0].markerId, marker)
  let selected
  instance.selectPoint = id => { selected = id }
  instance.markerTap({ detail: { markerId: marker } })
  assert.equal(selected, item.id)
  config.envId = ''
})
test('共享内容优先显示，不被较慢的首页请求覆盖', async () => {
  config.demoMode = false; config.envId = 'test-only'
  const requests = []
  global.wx = { cloud: { callFunction: input => new Promise(resolve => requests.push({ input, resolve })) } }
  const instance = page('../pages/index/index.js')
  instance.resetScroll = () => {}; instance.scheduleMapFit = () => {}; instance.selectPoint = () => {}
  const feed = instance.fetchFeed(); const shared = instance.openShared('shared-123')
  requests[1].resolve({ result: { ok: true, data: { id: 'shared-123', title: '分享内容' } } }); await shared
  requests[0].resolve({ result: { ok: true, data: { items: [], cursor: null } } }); await feed
  assert.equal(instance.data.items[0].id, 'shared-123')
  config.envId = ''
})
