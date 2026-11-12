const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MemoryRepository } = require('./support/memory-repository')
const { createService } = require('../cloudfunctions/api/lib/service')
const { idFor } = require('../cloudfunctions/api/lib/domain')
const { settleMedia } = require('../cloudfunctions/api/lib/moderation')
const { runJobs } = require('../cloudfunctions/api/lib/jobs')
function setup(overrides = {}) {
  const repo = new MemoryRepository()
  let stamp = 1800000000000
  let sequence = 0
  const now = () => stamp
  const moderation = { text: async () => 'pass', image: async () => `trace-${++sequence}`, ...overrides }
  const files = { urls: async ids => Object.fromEntries(ids.map(id => [id, 'https://signed.invalid/' + id])), seal: async (_, path) => `cloud://test.bucket/${path}` }
  const service = createService({ repo, moderation, files, admins: [idFor('user', 'admin')], now, random: () => `random-${++sequence}` })
  const call = (action, input = {}, who = 'alice') => service.execute(action, input, who)
  const profile = who => call('user.save', { nickname: who }, who)
  const post = (input = {}, who = 'alice') => call('content.create', { requestId: `request-${++sequence}`, title: '公园里', text: '一起散步', latitude: 30.65, longitude: 104.06, place: '成都公园', ...input }, who)
  return { repo, call, profile, post, moderation, now, advance: amount => { stamp += amount } }
}
test('身份不信任客户端，游客只能读公开内容，不能越权删帖或读取通知', async () => {
  const { call, profile, post, repo } = setup()
  await profile('alice'); await profile('bob')
  const { id } = await post({ ownerId: idFor('user', 'bob'), status: 'published', likes: 999 })
  const row = await call('content.get', { id })
  assert.equal(row.ownerId, idFor('user', 'alice')); assert.equal(row.likes, 0)
  assert.equal((await call('feed', {}, '')).items.length, 1)
  await assert.rejects(call('content.remove', { id }, 'bob'), { code: 'FORBIDDEN' })
  await assert.rejects(call('like.set', { id, active: true }, ''), { code: 'AUTH' })
  await call('like.set', { id, active: true }, 'bob')
  const notices = await repo.find('notifications', { ownerId: idFor('user', 'alice') })
  await assert.rejects(call('notifications.read', { id: notices[0]._id }, 'bob'), { code: 'FORBIDDEN' })
  await assert.rejects(call('admin.list', { isAdmin: true }, 'bob'), { code: 'FORBIDDEN' })
})
test('重复发布、点赞、收藏与评论只生效一次，通知不重复', async () => {
  const { call, profile, post, repo } = setup()
  await profile('alice'); await profile('bob')
  const input = { requestId: 'same-request-123' }
  const [a, b] = await Promise.all([post(input), post(input)])
  assert.equal(a.id, b.id); assert.equal((await repo.find('contents')).length, 1)
  await Promise.all([call('like.set', { id: a.id, active: true }, 'bob'), call('like.set', { id: a.id, active: true }, 'bob')])
  await call('favorite.set', { id: a.id, active: true }, 'bob'); await call('favorite.set', { id: a.id, active: true }, 'bob')
  const comment = { id: a.id, text: '想去', requestId: 'same-comment-123' }
  await Promise.all([call('comment.create', comment, 'bob'), call('comment.create', comment, 'bob')])
  const row = await call('content.get', { id: a.id }, 'bob')
  assert.equal(row.likes, 1); assert.equal(row.commentCount, 1); assert.equal(row.saved, true)
  assert.equal((await call('notifications.list', {}, 'alice')).items.length, 2)
  assert.equal((await call('mine', { section: 'favorites' }, 'bob')).items.length, 1)
})
test('活动并发报名不超员，取消报名恢复名额，取消活动产生通知', async () => {
  const { call, profile, post, now } = setup()
  for (const who of ['alice', 'bob', 'carol']) await profile(who)
  const { id } = await post({ kind: 'activity', capacity: 1, startAt: now() + 3600000, endAt: now() + 7200000 })
  const attempts = await Promise.allSettled(['bob', 'carol'].map(who => call('activity.signup', { id, active: true }, who)))
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  const winner = attempts[0].status === 'fulfilled' ? 'bob' : 'carol'
  assert.equal((await call('content.get', { id })).joinedCount, 1)
  await call('activity.signup', { id, active: false }, winner)
  assert.equal((await call('content.get', { id })).joinedCount, 0)
  await call('activity.signup', { id, active: true }, winner)
  await call('activity.cancel', { id }); await call('activity.cancel', { id })
  assert.equal((await call('notifications.list', {}, winner)).items.filter(row => row.type === 'activity_cancel').length, 1)
  await assert.rejects(call('activity.signup', { id, active: true }, winner === 'bob' ? 'carol' : 'bob'), { code: 'ACTIVITY_CLOSED' })
})
test('活动表单验证与文字审核失败不会泄漏公开内容', async () => {
  const { call, profile, post, moderation, now } = setup()
  await profile('alice')
  await assert.rejects(post({ kind: 'activity', capacity: 0, startAt: now() + 1000, endAt: now() + 2000 }), { code: 'INVALID' })
  await assert.rejects(post({ kind: 'activity', capacity: 5, startAt: now() - 1000, endAt: now() + 2000 }), { code: 'INVALID' })
  await assert.rejects(post({ latitude: 200 }), { code: 'INVALID' })
  moderation.text = async () => { throw new Error('provider unavailable') }
  const result = await post()
  assert.equal(result.status, 'review_error'); assert.equal((await call('feed', {}, '')).items.length, 0)
  await assert.rejects(call('content.get', { id: result.id }, 'bob'), { code: 'NOT_FOUND' })
  moderation.text = async () => 'risky'
  const rejected = await post()
  assert.equal(rejected.status, 'rejected')
  await assert.rejects(call('admin.resolve', { id: rejected.id, decision: 'approve' }, 'admin'), { code: 'REVIEW' })
})
test('审核中删除动态不会被晚到的审核结果重新公开', async () => {
  const { repo, call, profile, post, moderation } = setup()
  await profile('alice')
  let release, entered
  const ready = new Promise(resolve => { entered = resolve })
  moderation.text = async () => { entered(); return new Promise(resolve => { release = resolve }) }
  const operation = post({ requestId: 'delete-during-review' })
  await ready
  const rows = await repo.find('contents')
  await call('content.remove', { id: rows[0]._id })
  release('pass'); await operation
  assert.equal((await repo.get('contents', rows[0]._id)).status, 'deleted')
  assert.equal((await call('feed', {}, '')).items.length, 0)
})
test('图片须归属本人，先封存不可覆盖副本，全部审核完成才公开', async () => {
  const { repo, call, profile, post } = setup()
  await profile('alice'); await profile('bob')
  const image = await call('media.reserve')
  const original = `cloud://test.bucket/${image.cloudPath}`
  await assert.rejects(call('media.complete', { id: image.id, fileId: original }, 'bob'), { code: 'MEDIA' })
  await call('media.complete', { id: image.id, fileId: original })
  await call('media.complete', { id: image.id, fileId: original })
  const sealed = await repo.get('media', image.id)
  assert.match(sealed.fileId, /\/sealed\//); assert.notEqual(sealed.fileId, original)
  await assert.rejects(post({ mediaIds: [image.id] }, 'bob'), { code: 'MEDIA' })
  const result = await post({ mediaIds: [image.id] })
  assert.equal(result.status, 'pending'); assert.equal((await call('feed', {}, '')).items.length, 0)
  const task = (await repo.find('moderationTasks'))[0]
  await settleMedia(repo, task._id, 'pass'); await settleMedia(repo, task._id, 'risky')
  assert.equal((await repo.get('contents', result.id)).status, 'published')
  assert.equal((await call('feed', {}, 'bob')).items[0].images.length, 1)
})
test('早到审核回调可恢复，未知客户端字段不能批准内容', async () => {
  const { repo, call, profile, post, moderation } = setup()
  await profile('alice')
  const image = await call('media.reserve')
  await call('media.complete', { id: image.id, fileId: `cloud://test.bucket/${image.cloudPath}` })
  moderation.image = async () => { await settleMedia(repo, 'early-trace', 'pass'); return 'early-trace' }
  const result = await post({ mediaIds: [image.id], status: 'published' })
  assert.equal(result.status, 'published')
  assert.equal((await repo.get('moderationTasks', 'early-trace')).status, 'done')
})
test('地理查询、搜索与游标分页稳定，不返回不同用户的个人记录', async () => {
  const { call, profile, post } = setup()
  await profile('alice'); await profile('bob')
  for (let index = 0; index < 23; index++) await post({ title: `散步${index}` })
  await post({ latitude: 40, longitude: 116, title: '远方' }, 'bob')
  const first = await call('feed', { query: '散步', center: { latitude: 30.65, longitude: 104.06 } })
  const second = await call('feed', { query: '散步', center: { latitude: 30.65, longitude: 104.06 }, cursor: first.cursor })
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 3)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 23)
  assert.equal((await call('mine', {}, 'bob')).items.length, 1)
  assert.equal((await call('mine', {}, 'alice')).items.length, 20)
})
test('举报幂等、管理员可处理并留审计，后台只清理过期废弃图片', async () => {
  const { repo, call, profile, post, advance, now } = setup()
  await profile('alice'); await profile('bob')
  const result = await post()
  await call('report.create', { id: result.id, reason: '虚假信息' }, 'bob'); await call('report.create', { id: result.id, reason: '重复举报' }, 'bob')
  const report = (await call('admin.list', {}, 'admin')).reports[0]
  await call('admin.resolve', { id: result.id, reportId: report._id, decision: 'hide' }, 'admin')
  assert.equal((await repo.find('audit')).length, 1)
  assert.equal((await call('feed', {}, '')).items.length, 0)
  const image = await call('media.reserve')
  await call('media.complete', { id: image.id, fileId: `cloud://test.bucket/${image.cloudPath}` })
  advance(86400001)
  const removed = []
  await runJobs(repo, { deleteFile: async ({ fileList }) => { removed.push(...fileList); return { fileList: fileList.map(() => ({ status: 0 })) } } }, now)
  assert.ok(removed.some(id => id.includes('/sealed/')))
  assert.equal((await repo.get('media', image.id)).status, 'deleted')
})

test('审核回调丢失后显示可重试状态，旧回调不会覆盖新审核', async () => {
  const { repo, call, profile, post, advance, now } = setup()
  await profile('alice')
  const image = await call('media.reserve')
  await call('media.complete', { id: image.id, fileId: `cloud://test.bucket/${image.cloudPath}` })
  const result = await post({ mediaIds: [image.id] })
  const oldTrace = (await repo.get('media', image.id)).traceId
  advance(900001)
  await runJobs(repo, { deleteFile: async () => { throw new Error('不应删除审核中的图片') } }, now)
  assert.equal((await call('content.get', { id: result.id })).status, 'review_error')
  await assert.rejects(call('admin.resolve', { id: result.id, decision: 'approve' }, 'admin'), { code: 'REVIEW' })
  await call('content.reviewRetry', { id: result.id })
  const newTrace = (await repo.get('media', image.id)).traceId
  assert.notEqual(newTrace, oldTrace)
  await settleMedia(repo, oldTrace, 'pass', now)
  assert.equal((await call('content.get', { id: result.id })).status, 'pending')
  await settleMedia(repo, newTrace, 'pass', now)
  assert.equal((await call('content.get', { id: result.id })).status, 'published')
  const plain = await post()
  await repo.set('contents', plain.id, { ...await repo.get('contents', plain.id), status: 'pending', textApproved: false })
  advance(900001)
  await runJobs(repo, { deleteFile: async () => { throw new Error('不应删除有效图片') } }, now)
  assert.equal((await call('content.get', { id: plain.id })).status, 'review_error')
  await call('content.reviewRetry', { id: plain.id })
  assert.equal((await call('content.get', { id: plain.id })).status, 'published')
})

test('客户端不能伪造审核回调或定时清理，不触及数据库', async () => {
  const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path')
  for (const name of ['moderationCallback', 'cleanup']) {
    let touched = false
    const cloud = { init() {}, getWXContext() { return { OPENID: 'client' } }, database() { touched = true } }
    const exported = {}
    const dependency = name => name === 'wx-server-sdk' ? cloud : name.includes('repository') ? { createRepository() { touched = true } } : name.includes('moderation') ? { settleMedia() { touched = true } } : { runJobs() { touched = true } }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions', name, 'index.js'), 'utf8'), { require: dependency, exports: exported })
    await assert.rejects(exported.main({ Event: 'wxa_media_check', trace_id: 'forged', result: { suggest: 'pass' }, Type: 'Timer' }), /FORBIDDEN/)
    assert.equal(touched, false)
  }
})
test('文字待复核时图片通过也不自动公开，平台拒绝不可人工绕过', async () => {
  const { repo, call, profile, post, moderation } = setup()
  await profile('alice')
  const image = await call('media.reserve')
  await call('media.complete', { id: image.id, fileId: `cloud://test.bucket/${image.cloudPath}` })
  moderation.text = async () => 'review'
  const result = await post({ mediaIds: [image.id] })
  await settleMedia(repo, (await repo.get('media', image.id)).traceId, 'pass')
  assert.equal((await call('content.get', { id: result.id })).status, 'review')
  assert.equal((await call('feed', {}, '')).items.length, 0)
  await call('admin.resolve', { id: result.id, decision: 'approve' }, 'admin')
  assert.equal((await call('feed', {}, '')).items.length, 1)
  moderation.text = async () => 'risky'
  const rejected = await post()
  await assert.rejects(call('admin.resolve', { id: rejected.id, decision: 'approve' }, 'admin'), { code: 'REVIEW' })
})
test('图片清理先锁定，不能与新发布并发产生已丢失的公开图片', async () => {
  const { repo, call, profile, post, advance, now } = setup()
  await profile('alice')
  const image = await call('media.reserve')
  await call('media.complete', { id: image.id, fileId: `cloud://test.bucket/${image.cloudPath}` })
  advance(86400001)
  await runJobs(repo, { deleteFile: async ({ fileList }) => {
    await assert.rejects(post({ mediaIds: [image.id] }), { code: 'MEDIA' })
    return { fileList: fileList.map(() => ({ status: 0 })) }
  } }, now)
  assert.equal((await repo.get('media', image.id)).status, 'deleted')
})
