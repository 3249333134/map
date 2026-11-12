const config = require('../config/cloud')
const samples = require('../data/demo')
const demoCosplayers = require('../data/demo-cosplayers')
function error(code, message) { return Object.assign(new Error(message), { code }) }
async function request(action, input = {}) {
  if (config.demoMode) {
    if (action === 'presence.nearby') return { items: demoCosplayers }
    if (action === 'user.me') return { id: 'demo-user', nickname: '地图朋友', avatarKey: 'mika', avatarUrl: '/static/avatars/mika.png', tags: [], isAdmin: false, blocked: false }
    if (action === 'friends.list') return { items: [], cursor: null }
    if (action === 'mine') return { items: [], cursor: null }
    if (action === 'presence.me') return null
    if (action === 'notifications.list') return { items: [], cursor: null }
    if (action === 'notifications.unread') return { count: 0 }
    if (action === 'feed') {
      const items = input.kind === 'activity' ? [] : samples.filter(item => (!input.category || input.category === '全部' || item.category === input.category) && `${item.title}${item.text}${item.place}`.includes(input.query || ''))
      return { items, cursor: null }
    }
    if (action === 'content.get') { const item = samples.find(row => String(row.id) === String(input.id)); if (item) return { ...item, images: [], demo: true }; throw error('NOT_FOUND', '示例不存在') }
    throw error('DEMO_READONLY', '当前是只读演示模式，请配置云环境后使用此功能')
  }
  if (!config.envId) throw error('CLOUD_NOT_CONFIGURED', '尚未配置云环境，请先完成部署后重试')
  if (!wx.cloud) throw error('CLOUD_UNAVAILABLE', '当前微信版本不支持云开发，请升级后重试')
  let response
  try { response = await wx.cloud.callFunction({ name: 'api', data: { action, input } }) }
  catch (_) { throw error('NETWORK', '连接云服务失败，请检查网络或云函数部署后重试') }
  if (!response.result?.ok) throw error(response.result?.code || 'SERVER_ERROR', response.result?.message || '服务暂不可用')
  return response.result.data
}
function toast(error) { wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none', duration: 2500 }) }
async function ensureProfile() {
  const profile = await request('user.me')
  if (profile && !profile.blocked) return profile
  const result = await wx.showModal({ title: '设置昵称', content: '设置昵称后即可发布、互动和报名，不需要手机号。', confirmText: '去设置' })
  if (result.confirm) wx.navigateTo({ url: '/pages/me/index?setup=1' })
  throw error('PROFILE', profile?.blocked ? '账号暂不能操作' : '请先设置昵称')
}
function requestId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}` }
function decorate(item) {
  return { ...item, statusText: ({ pending: '审核中', review: '待复核', review_error: '审核服务异常，可重试', rejected: '未通过审核', deleted: '已删除', published: '已公开' })[item.status] || '', timeText: item.startAt ? `${new Date(item.startAt).toLocaleString()} — ${new Date(item.endAt).toLocaleString()}` : '', activityClosed: !!item.cancelled || item.startAt <= Date.now() || item.joinedCount >= item.capacity }
}
module.exports = { request, toast, ensureProfile, requestId, decorate, config }
