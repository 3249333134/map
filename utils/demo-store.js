// 本地演示数据层：仅在 demoMode 下使用，用本机存储模拟云端读写，方便完整走通流程。
const posts = require('../data/demo')
const cosplayers = require('../data/demo-cosplayers')

const STORAGE_KEY = 'map-demo-state-v2'
const ME = 'demo-user'
const HOUR = 60 * 60 * 1000
const AVATAR_KEYS = ['mika', 'sora', 'rin', 'luna', 'yuki', 'kira']
const CATEGORIES = ['日常', '散步', '户外']

let memory = null

function fail(code, message) { const error = new Error(message); error.code = code; throw error }
function clone(value) { return JSON.parse(JSON.stringify(value)) }
function avatarKeyOf(user) { return AVATAR_KEYS.includes(user?.avatarKey) ? user.avatarKey : 'mika' }
function avatarOf(user) {
  const avatarKey = avatarKeyOf(user)
  return { id: user.id, nickname: user.nickname, avatarKey, avatarUrl: user.avatarUrl || `/static/avatars/${avatarKey}.png`, avatarFrameUrls: user.avatarFrameUrls || [], avatarVersion: user.avatarMediaId || avatarKey, tags: user.tags || [] }
}
function publicUser(state, id) {
  const user = state.users[id]
  if (!user) return null
  return { ...avatarOf(user), isAdmin: false, blocked: false }
}
function at(dayOffset, hour) {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}
function relationKey(from, to) { return `${from}|${to}` }
function relation(state, from, to) { return state.friendships[relationKey(from, to)]?.status || '' }
function flagKey(id, owner = ME) { return `${id}|${owner}` }

function seed() {
  const now = Date.now()
  const users = { [ME]: { id: ME, nickname: '地图朋友', avatarKey: 'mika', tags: [] } }
  cosplayers.forEach(person => {
    users[person.id] = { id: person.id, nickname: person.avatar.nickname, avatarKey: person.avatar.avatarKey, tags: person.avatar.tags }
  })

  const contents = {}
  const likes = [4, 7, 12, 3, 9, 5]
  posts.forEach((post, index) => {
    const ownerId = index === 4 ? ME : cosplayers[index % cosplayers.length].id
    contents[post.id] = {
      ...post, id: post.id, kind: 'post', ownerId, status: 'published', likes: likes[index],
      commentCount: 0, joinedCount: 0, cancelled: false, mediaIds: [],
      createdAt: now - (index + 1) * 2 * HOUR
    }
  })

  const activities = [
    { id: 7, title: '周末 Cos 摄影互勉', text: '湖边光线很舒服，欢迎自带相机，也欢迎想被拍的同好。', category: '户外', place: '成都 · 东湖公园', latitude: 30.6175, longitude: 104.0830, ownerId: 'demo-cos-1', capacity: 12, joinedCount: 5, startAt: at(1, 14), endAt: at(1, 17) },
    { id: 8, title: '太古里逛街拍照', text: '一起逛店、拍街景，结束后可以顺路喝杯咖啡。', category: '日常', place: '成都 · 太古里', latitude: 30.6488, longitude: 104.0712, ownerId: 'demo-cos-2', capacity: 8, joinedCount: 8, startAt: at(2, 15), endAt: at(2, 18) },
    { id: 9, title: '人民公园野餐聊天', text: '带上垫子和零食，认识附近的新朋友。', category: '散步', place: '成都 · 人民公园', latitude: 30.6587, longitude: 104.0550, ownerId: 'demo-cos-4', capacity: 20, joinedCount: 3, startAt: at(5, 11), endAt: at(5, 15) }
  ]
  activities.forEach((row, index) => {
    contents[row.id] = { ...row, kind: 'activity', status: 'published', likes: 0, commentCount: 0, cancelled: false, mediaIds: [], createdAt: now - (index + 1) * 3 * HOUR }
  })

  const comments = [
    { _id: 'c1', targetId: 1, nickname: '小满', text: '这家我也常去，下午的光很好拍。', createdAt: now - 40 * 60 * 1000 },
    { _id: 'c2', targetId: 3, nickname: '月见', text: '周末一起去公园坐着聊聊天？', createdAt: now - 25 * 60 * 1000 }
  ]
  const commentsById = { 1: 1, 3: 1 }
  Object.keys(commentsById).forEach(id => { contents[id].commentCount = commentsById[id] })

  const notifications = [
    { _id: 'n1', ownerId: ME, actorId: 'demo-cos-1', type: 'friend_request', targetId: 'demo-cos-1', read: false, createdAt: now - 6 * 60 * 1000 },
    { _id: 'n2', ownerId: ME, actorId: 'demo-cos-2', type: 'like', targetId: 5, read: false, createdAt: now - 45 * 60 * 1000 },
    { _id: 'n3', ownerId: ME, actorId: 'demo-cos-3', type: 'friend_accepted', targetId: 'demo-cos-3', read: true, createdAt: now - 3 * HOUR },
    { _id: 'n4', ownerId: ME, actorId: 'demo-cos-4', type: 'friend_request', targetId: 'demo-cos-4', read: false, createdAt: now - 18 * 60 * 1000 },
    { _id: 'n5', ownerId: ME, actorId: 'demo-cos-4', type: 'comment', targetId: 5, read: false, createdAt: now - 70 * 60 * 1000 }
  ]

  const friendships = {
    [relationKey(ME, 'demo-cos-3')]: { ownerId: ME, targetId: 'demo-cos-3', status: 'accepted', createdAt: now - 3 * HOUR },
    [relationKey('demo-cos-3', ME)]: { ownerId: 'demo-cos-3', targetId: ME, status: 'accepted', createdAt: now - 3 * HOUR },
    [relationKey('demo-cos-1', ME)]: { ownerId: 'demo-cos-1', targetId: ME, status: 'pending', createdAt: now - 6 * 60 * 1000 },
    [relationKey('demo-cos-4', ME)]: { ownerId: 'demo-cos-4', targetId: ME, status: 'pending', createdAt: now - 18 * 60 * 1000 }
  }

  const presences = {}
  cosplayers.forEach((person, index) => {
    presences[person.id] = {
      ownerId: person.id, latitude: person.latitude, longitude: person.longitude, place: person.place,
      mode: person.mode || 'place', shout: person.shout || '', active: true,
      createdAt: now - index * 10 * 60 * 1000, updatedAt: now, expiresAt: now + (2 + index) * HOUR
    }
  })

  return {
    version: 1,
    requests: {},
    users, contents, comments, notifications, friendships, presences,
    reactions: {}, favorites: {}, members: { [flagKey(8)]: { ownerId: ME, targetId: 8, active: true, createdAt: now - 20 * 60 * 1000 } },
    reports: {}
  }
}

function persist(state) {
  memory = state
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  try { wx.setStorageSync(STORAGE_KEY, state) } catch (_) {}
}

function read() {
  if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
    try {
      const saved = wx.getStorageSync(STORAGE_KEY)
      if (saved && saved.version === 1) return saved
    } catch (_) {}
  } else if (memory && memory.version === 1) return memory
  const state = seed()
  persist(state)
  return state
}

function findContent(state, id) {
  const key = Object.keys(state.contents).find(value => String(value) === String(id))
  return key === undefined ? null : state.contents[key]
}
function hydrate(state, row) {
  if (!row) return null
  const author = state.users[row.ownerId]
  return {
    ...clone(row),
    author: { id: row.ownerId, nickname: author?.nickname || '地图朋友' },
    images: (row.mediaIds || []).slice(),
    mine: row.ownerId === ME,
    liked: !!state.reactions[flagKey(row.id)]?.active,
    saved: !!state.favorites[flagKey(row.id)]?.active,
    joined: !!state.members[flagKey(row.id)]?.active
  }
}
function pageOf(rows, cursor) {
  const offset = Math.max(0, Number(cursor) || 0)
  const items = rows.slice(offset, offset + 20)
  const next = offset + items.length < rows.length ? String(offset + items.length) : null
  return { items, cursor: next }
}
function notify(state, receiver, actorId, type, targetId) {
  if (!receiver || receiver === actorId) return
  state.notifications.unshift({ _id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ownerId: receiver, actorId, type, targetId, read: false, createdAt: Date.now() })
}
function requireContent(state, id) {
  const row = findContent(state, id)
  if (!row || row.status === 'deleted') fail('NOT_FOUND', '内容已删除或不存在')
  return row
}
function requireProfile(state) {
  const user = state.users[ME]
  if (!user || !user.nickname) fail('PROFILE', '请先在“我的”中保存昵称')
  return user
}
function text(value, max, required = false) {
  if (typeof value !== 'string' && value !== undefined) fail('INVALID', '文本格式不正确')
  const result = (value || '').trim()
  if (result.length > max || (required && !result.length)) fail('INVALID', `请填写${required ? '必填内容，' : ''}文字不超过 ${max} 字`)
  return result
}
function pointOf(input) {
  if (!input || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) fail('INVALID', '请选择有效地点')
  const place = text(input.place, 120, true)
  return { latitude: input.latitude, longitude: input.longitude, place }
}
function expirePresence(state) {
  const now = Date.now()
  cosplayers.forEach(person => {
    const row = state.presences[person.id]
    if (!row || !row.active || row.expiresAt <= now) {
      state.presences[person.id] = {
        ownerId: person.id, latitude: person.latitude, longitude: person.longitude, place: person.place,
        mode: person.mode || 'place', shout: person.shout || '', active: true,
        createdAt: row?.createdAt || now, updatedAt: now, expiresAt: now + 2 * HOUR
      }
    }
  })
}
function listFeed(state, input = {}) {
  const kind = input.kind === 'activity' ? 'activity' : 'post'
  const query = (input.query || '').trim().toLowerCase()
  const rows = Object.values(state.contents)
    .filter(row => row.status === 'published' && row.kind === kind)
    .filter(row => !input.category || input.category === '全部' || row.category === input.category)
    .filter(row => !query || `${row.title} ${row.text} ${row.place}`.toLowerCase().includes(query))
    .sort((a, b) => b.createdAt - a.createdAt)
  const page = pageOf(rows, input.cursor)
  return { items: page.items.map(row => hydrate(state, row)), cursor: page.cursor }
}
function updatePresence(input) {
  const state = read()
  requireProfile(state)
  const point = pointOf(input)
  const now = Date.now()
  state.presences[ME] = {
    ownerId: ME, ...point, mode: input.mode === 'current' ? 'current' : 'place', movementMode: ['virtual', 'fuzzy'].includes(input.movementMode) ? input.movementMode : 'stationary',
    shout: text(input.shout, 80), active: true, createdAt: state.presences[ME]?.createdAt || now,
    updatedAt: now, expiresAt: now + 2 * HOUR
  }
  persist(state)
  return { active: true, expiresAt: state.presences[ME].expiresAt }
}
function createContent(input) {
  const state = read()
  requireProfile(state)
  const kind = input.kind === 'activity' ? 'activity' : 'post'
  const body = text(input.text, 2000, true)
  const point = pointOf(input)
  const title = text(input.title, 40, kind === 'activity') || body.slice(0, 24)
  const category = CATEGORIES.includes(input.category) ? input.category : '日常'
  const requestId = typeof input.requestId === 'string' ? input.requestId : ''
  if (requestId && state.requests[requestId]) return { id: state.requests[requestId], status: 'published' }
  const now = Date.now()
  if (kind === 'activity') {
    if (!Number.isFinite(input.startAt) || !Number.isFinite(input.endAt) || input.startAt <= now || input.endAt <= input.startAt) fail('INVALID', '请检查活动开始和结束时间')
    if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 100) fail('INVALID', '报名人数上限为 1–100 人')
  }
  const id = Math.max(0, ...Object.keys(state.contents).map(Number).filter(Number.isFinite)) + 1
  state.contents[id] = {
    id, kind, title, text: body, ...point, category, mediaIds: (input.mediaIds || []).slice(0, 9),
    ownerId: ME, status: 'published', likes: 0, commentCount: 0, joinedCount: 0, cancelled: false, createdAt: now,
    ...(kind === 'activity' ? { startAt: input.startAt, endAt: input.endAt, capacity: input.capacity } : {})
  }
  if (requestId) state.requests[requestId] = id
  persist(state)
  return { id, status: 'published' }
}
function toggleFlag(table, input) {
  const state = read()
  requireProfile(state)
  if (typeof input.active !== 'boolean') fail('INVALID', '请指定操作状态')
  const row = requireContent(state, input.id)
  if (table === 'reactions' && row.status !== 'published') fail('NOT_FOUND', '内容已不可用')
  const key = flagKey(input.id)
  const previous = state[table][key]
  if (!!previous?.active === input.active) return { active: input.active }
  state[table][key] = { ownerId: ME, targetId: input.id, active: input.active, createdAt: previous?.createdAt || Date.now() }
  if (table === 'reactions') {
    row.likes = Math.max(0, (row.likes || 0) + (input.active ? 1 : -1))
    if (input.active) notify(state, row.ownerId, ME, 'like', input.id)
  }
  persist(state)
  return { active: input.active }
}
function signup(input) {
  const state = read()
  requireProfile(state)
  if (typeof input.active !== 'boolean') fail('INVALID', '报名状态无效')
  const row = requireContent(state, input.id)
  if (row.kind !== 'activity' || row.status !== 'published') fail('NOT_FOUND', '活动不存在或未公开')
  if (row.ownerId === ME) fail('INVALID', '发起人无需报名自己的活动')
  const key = flagKey(input.id)
  const previous = state.members[key]
  if (!!previous?.active === input.active) return { active: input.active }
  if (input.active && (row.cancelled || row.startAt <= Date.now() || row.joinedCount >= row.capacity)) fail('ACTIVITY_CLOSED', '活动已满、取消或已经开始')
  state.members[key] = { ownerId: ME, targetId: input.id, active: input.active, createdAt: previous?.createdAt || Date.now() }
  row.joinedCount = Math.max(0, row.joinedCount + (input.active ? 1 : -1))
  notify(state, row.ownerId, ME, input.active ? 'signup' : 'withdraw', input.id)
  persist(state)
  return { active: input.active }
}
function addComment(input) {
  const state = read()
  const user = requireProfile(state)
  const row = requireContent(state, input.id)
  const body = text(input.text, 500, true)
  state.comments.push({ _id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, targetId: row.id, nickname: user.nickname, text: body, createdAt: Date.now() })
  row.commentCount = (row.commentCount || 0) + 1
  notify(state, row.ownerId, ME, 'comment', row.id)
  persist(state)
  return { id: 'demo-comment' }
}
function removeContent(input, action) {
  const state = read()
  requireProfile(state)
  const row = requireContent(state, input.id)
  if (row.ownerId !== ME) fail('FORBIDDEN', '只能管理自己的内容')
  if (action === 'activity.cancel') {
    if (row.kind !== 'activity') fail('INVALID', '活动不可用')
    row.cancelled = true
  } else {
    if (row.kind !== 'post') fail('INVALID', '活动请使用取消操作')
    row.status = 'deleted'
  }
  persist(state)
  return { ok: true }
}
function friendRequest(targetId) {
  const state = read()
  requireProfile(state)
  if (typeof targetId !== 'string' || targetId === ME || !state.users[targetId]) fail('INVALID', '不能向这个用户发送好友申请')
  const previous = relation(state, ME, targetId)
  if (previous === 'accepted' || previous === 'pending') return { status: previous }
  const now = Date.now()
  state.friendships[relationKey(ME, targetId)] = { ownerId: ME, targetId, status: 'accepted', createdAt: now }
  state.friendships[relationKey(targetId, ME)] = { ownerId: targetId, targetId: ME, status: 'accepted', createdAt: now }
  notify(state, ME, targetId, 'friend_accepted', targetId)
  persist(state)
  return { status: 'accepted' }
}
function friendResponse(input) {
  const state = read()
  requireProfile(state)
  if (typeof input.userId !== 'string' || typeof input.accept !== 'boolean') fail('INVALID', '好友申请无效')
  const incoming = state.friendships[relationKey(input.userId, ME)]
  if (!incoming || (incoming.status !== 'pending' && incoming.status !== 'declined')) fail('NOT_FOUND', '好友申请已处理或已失效')
  incoming.status = input.accept ? 'accepted' : 'declined'
  incoming.updatedAt = Date.now()
  if (input.accept) state.friendships[relationKey(ME, input.userId)] = { ownerId: ME, targetId: input.userId, status: 'accepted', createdAt: Date.now() }
  persist(state)
  return { status: incoming.status }
}
function listMine(input) {
  const state = read()
  requireProfile(state)
  const section = input.section || 'posts'
  let rows
  if (section === 'friends') {
    rows = Object.values(state.friendships)
      .filter(row => row.ownerId === ME && row.status === 'accepted')
      .map(row => publicUser(state, row.targetId))
      .filter(Boolean)
    const page = pageOf(rows, input.cursor)
    return { items: page.items, cursor: page.cursor }
  }
  if (section === 'favorites' || section === 'joined') {
    rows = Object.values(section === 'favorites' ? state.favorites : state.members)
      .filter(link => link.ownerId === ME && link.active)
      .map(link => findContent(state, link.targetId))
      .filter(row => row && row.status === 'published')
  } else {
    rows = Object.values(state.contents)
      .filter(row => row.ownerId === ME && row.status !== 'deleted' && row.kind === (section === 'activities' ? 'activity' : 'post'))
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  const page = pageOf(rows, input.cursor)
  return { items: page.items.map(row => hydrate(state, row)), cursor: page.cursor }
}
function nearby(input) {
  const state = read()
  expirePresence(state)
  persist(state)
  const now = Date.now()
  const items = Object.values(state.presences)
    .filter(row => row.active && row.expiresAt > now && state.users[row.ownerId])
    .map(row => ({
      id: row.ownerId, isMine: row.ownerId === ME, latitude: row.latitude, longitude: row.longitude,
      place: row.place, mode: row.mode, movementMode: row.movementMode || 'stationary', shout: row.shout || '', expiresAt: row.expiresAt, updatedAt: row.updatedAt,
      avatar: publicUser(state, row.ownerId), friendStatus: relation(state, ME, row.ownerId)
    }))
  return { items }
}
function notifications(input) {
  const state = read()
  const rows = state.notifications.filter(row => row.ownerId === ME).sort((a, b) => b.createdAt - a.createdAt)
  const page = pageOf(rows, input.cursor)
  return {
    items: page.items.map(row => {
      const { ownerId, ...notice } = row
      return { ...clone(notice), actor: publicUser(state, row.actorId), friendStatus: row.type === 'friend_request' ? relation(state, row.actorId, ME) : '' }
    }),
    cursor: page.cursor
  }
}
function saveUser(input) {
  const state = read()
  const previous = state.users[ME] || { id: ME }
  const nickname = text(input.nickname, 20, true)
  const tags = input.tags === undefined ? (previous.tags || []) : input.tags
  if (!Array.isArray(tags) || tags.length > 5) fail('INVALID', '最多添加五个角色或兴趣标签')
  const safeTags = [...new Set(tags.map(tag => text(tag, 12, true)))].filter(Boolean)
  const user = {
    ...previous, nickname, avatarKey: AVATAR_KEYS.includes(input.avatarKey) ? input.avatarKey : avatarKeyOf(previous), tags: safeTags,
    avatarReviewStatus: ''
  }
  if (typeof input.avatarMediaId === 'string') {
    user.avatarUrl = input.avatarMediaId
    user.avatarMediaId = input.avatarMediaId
    user.avatarFrameUrls = Array.isArray(input.avatarFrameMediaIds) ? input.avatarFrameMediaIds : []
    user.avatarSource = input.avatarMediaId ? 'ai' : ''
  }
  state.users[ME] = user
  persist(state)
  return { ...publicUser(state, ME), avatarSource: user.avatarSource || '', avatarReviewStatus: '' }
}

function request(action, input = {}) {
  const state = read()
  switch (action) {
    case 'feed': return listFeed(state, input)
    case 'content.get': { const row = findContent(state, input.id); if (!row || row.status === 'deleted') fail('NOT_FOUND', '示例不存在'); return hydrate(state, row) }
    case 'content.create': return createContent(input)
    case 'content.remove':
    case 'activity.cancel': return removeContent(input, action)
    case 'content.reviewRetry': return { status: 'published' }
    case 'comments.list': {
      const rows = state.comments.filter(row => String(row.targetId) === String(input.id)).sort((a, b) => a.createdAt - b.createdAt)
      const page = pageOf(rows, input.cursor)
      return { items: page.items.map(({ ownerId, ...row }) => clone(row)), cursor: page.cursor }
    }
    case 'comment.create': return addComment(input)
    case 'like.set': return toggleFlag('reactions', input)
    case 'favorite.set': return toggleFlag('favorites', input)
    case 'activity.signup': return signup(input)
    case 'presence.nearby': return nearby(input)
    case 'presence.me': { const row = state.presences[ME]; return row ? { active: !!row.active, latitude: row.latitude, longitude: row.longitude, place: row.place, mode: row.mode, movementMode: row.movementMode || 'stationary', shout: row.shout || '', expiresAt: row.expiresAt } : null }
    case 'presence.set': return updatePresence(input)
    case 'presence.off': { const row = state.presences[ME]; if (row) { row.active = false; row.updatedAt = Date.now() } persist(state); return { active: false } }
    case 'friend.request': return friendRequest(input.userId)
    case 'friend.respond': return friendResponse(input)
    case 'friends.list': return listMine({ section: 'friends', cursor: input.cursor })
    case 'user.me': { const user = state.users[ME]; return user ? { ...publicUser(state, ME), avatarSource: user.avatarSource || '', avatarReviewStatus: user.avatarReviewStatus || '' } : null }
    case 'user.save': return saveUser(input)
    case 'user.identity': return { id: ME }
    case 'mine': return listMine(input)
    case 'notifications.list': return notifications(input)
    case 'notifications.unread': return { count: state.notifications.filter(row => row.ownerId === ME && !row.read).length }
    case 'notifications.read': { const row = state.notifications.find(item => item._id === input.id && item.ownerId === ME); if (row) { row.read = true; persist(state) } return { ok: true } }
    case 'report.create': requireContent(state, input.id); return { ok: true }
    case 'media.reserve': return { id: `demo-media-${Date.now()}`, cloudPath: '' }
    case 'media.complete': return { id: input.id }
    default: return fail('DEMO_READONLY', '演示模式暂不支持该操作')
  }
}

module.exports = { request, reset() { memory = null; if (typeof wx !== 'undefined' && typeof wx.removeStorageSync === 'function') { try { wx.removeStorageSync(STORAGE_KEY) } catch (_) {} } } }
