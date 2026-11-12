// 连接微信开发者工具的本地自动化端口，不创建用户或写入云数据。
const assert = require('node:assert/strict')
const socket = new WebSocket(process.env.WECHAT_AUTO_URL || 'ws://127.0.0.1:9421')
const pending = new Map()
let sequence = 0
socket.addEventListener('message', event => {
  const value = JSON.parse(event.data)
  const task = pending.get(value.id)
  if (!task) return
  pending.delete(value.id); clearTimeout(task.timer)
  if (value.error) task.reject(new Error(value.error.message)); else task.resolve(value.result)
})
function call(method, params = {}) {
  const id = String(++sequence)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时，请确认项目已编译并开启自动化端口`)) }, 12000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
const pause = () => new Promise(resolve => setTimeout(resolve, 400))
async function pageData() { const page = await call('App.getCurrentPage'); const result = await call('Page.getData', { pageId: page.pageId }); return { page, data: result.data } }
async function tap(selector) { const { page } = await pageData(); const element = await call('Page.getElement', { pageId: page.pageId, selector }); assert.ok(element?.elementId, `缺少 ${selector}`); await call('Element.tap', { pageId: page.pageId, elementId: element.elementId }); await pause() }
async function main() {
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('不能连接微信开发者工具。先运行 cli auto --project D:/prj/map --auto-port 9421')), { once: true }) })
  const { page, data } = await pageData()
  assert.equal(page.path, 'pages/index/index', '请先打开地图首页')
  assert.equal(data.viewMode, 'browse')
  assert.equal(data.mapVisible, true)
  await tap('.panel-toggle')
  const first = await pageData()
  await tap('.panel-toggle')
  const second = await pageData()
  assert.notEqual(first.data.collapsed, second.data.collapsed)
  assert.ok(second.data.panelHeight >= 84)
  // 验证缺少配置时有真实说明，且未偷偷装载示例。
  if (data.dataError?.includes('尚未配置')) assert.equal(data.items.length, 0)
  console.log('开发者工具：WXML 已运行、两档切换正常、配置状态可读。')
  for (const route of ['activities', 'publish', 'notifications', 'me', 'about', 'admin', 'detail']) {
    await call('App.callWxMethod', { method: 'navigateTo', args: [{ url: `/pages/${route}/index${route === 'detail' ? '?id=runtime-check-missing' : ''}` }] })
    await pause()
    const opened = await pageData()
    assert.equal(opened.page.path, `pages/${route}/index`)
    if (data.dataError?.includes('尚未配置') && ['activities', 'notifications', 'me', 'admin', 'detail'].includes(route)) assert.ok(opened.data.error?.includes('尚未配置'), `${route} 未展示配置状态`)
    await call('App.callWxMethod', { method: 'navigateBack', args: [{ delta: 1 }] })
    await pause()
  }
  console.log('七个业务页面可加载并返回；未提交发布、互动或报名。')
  console.log('该检查不代表云端、双用户或真机验收通过。')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => { for (const task of pending.values()) clearTimeout(task.timer); socket.close() })
