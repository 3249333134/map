const { idFor, requireThat, text, location, presenceInput, contentInput, BusinessError } = require('./domain')
const TABLES = ['users', 'contents', 'comments', 'reactions', 'favorites', 'members', 'notifications', 'reports', 'media', 'moderationTasks', 'audit', 'limits', 'presences', 'friendships']
function createService({ repo, moderation, files, admins = [], now = Date.now, random = () => require('node:crypto').randomUUID() }) {
  const admin = uid => admins.includes(uid)
  const uidOf = openid => { requireThat(openid, 'AUTH', '请在微信中登录后操作'); return idFor('user', openid) }
  async function member(uid) { const user = await repo.get('users', uid); requireThat(user && !user.blocked, 'PROFILE', '请先在“我的”中保存昵称'); return user }
  async function content(id, uid, publicOnly = false) {
    const row = await repo.get('contents', id)
    requireThat(row && row.status !== 'deleted' && (row.status === 'published' || (!publicOnly && (row.ownerId === uid || admin(uid)))), 'NOT_FOUND', '内容已删除、未公开或不存在')
    return row
  }
  async function notify(tx, receiver, actorId, type, targetId, eventId) {
    if (!receiver || receiver === actorId) return
    const id = idFor('notice', receiver, type, eventId)
    if (!await tx.get('notifications', id)) await tx.set('notifications', id, { ownerId: receiver, actorId, type, targetId, read: false, createdAt: now() })
  }
  async function hydrate(rows, uid) {
    const ids = new Set(rows.flatMap(row => row.mediaIds || []))
    const media = await Promise.all([...ids].map(id => repo.get('media', id)))
    const allowed = media.filter(row => row && row.status !== 'deleted' && (row.ownerId === uid || row.status === 'approved' || admin(uid)))
    const urls = await files.urls(allowed.map(row => row.fileId).filter(Boolean))
    const pictures = new Map(allowed.map(row => [row._id, urls[row.fileId] || '']))
    const authors = new Map()
    for (const ownerId of new Set(rows.map(row => row.ownerId))) {
      const user = await repo.get('users', ownerId)
      authors.set(ownerId, { id: ownerId, nickname: user ? user.nickname : '地图朋友' })
    }
    return Promise.all(rows.map(async row => ({ ...row, id: row._id, author: authors.get(row.ownerId), images: (row.mediaIds || []).map(id => pictures.get(id)).filter(Boolean), mine: row.ownerId === uid,
      liked: !!uid && !!(await repo.get('reactions', idFor(row._id, uid)))?.active,
      saved: !!uid && !!(await repo.get('favorites', idFor(row._id, uid)))?.active,
      joined: !!uid && !!(await repo.get('members', idFor(row._id, uid)))?.active
    })))
  }
  function pageResult(rows, limit) {
    const last = rows[rows.length - 1]
    return { rows, cursor: rows.length === limit && last ? Buffer.from(JSON.stringify([last.createdAt, last._id])).toString('base64url') : null }
  }
  async function listContents(input, uid) {
    const limit = 20
    const filter = { status: 'published', kind: input.kind === 'activity' ? 'activity' : 'post' }
    if (input.category && input.category !== '全部') filter.category = text(input.category, 10)
    if (input.query) filter.search = text(input.query, 60)
    if (input.center) {
      requireThat(Number.isFinite(input.center.latitude) && Number.isFinite(input.center.longitude) && Math.abs(input.center.latitude) <= 90 && Math.abs(input.center.longitude) <= 180, 'INVALID', '地图中心无效')
      filter.geo = { ...input.center, radius: 10000 }
    }
    const result = pageResult(await repo.find('contents', filter, { cursor: input.cursor, limit }), limit)
    return { items: await hydrate(result.rows, uid), cursor: result.cursor }
  }
  async function publicUser(user) {
    if (!user) return null
    const media = user.avatarMediaId ? await repo.get('media', user.avatarMediaId) : null
    const urls = media?.status === 'approved' && media.fileId ? await files.urls([media.fileId]) : {}
    return { id: user._id, nickname: user.nickname, avatarKey: user.avatarKey || 'mika', avatarVersion: media?.status === 'approved' ? media._id : user.avatarKey || 'mika', avatarUrl: media?.status === 'approved' ? urls[media.fileId] || '' : '', tags: user.tags || [] }
  }
  async function nearby(input, uid) {
    const center = input.center || { latitude: 30.651, longitude: 104.065 }
    requireThat(Number.isFinite(center.latitude) && Number.isFinite(center.longitude) && Math.abs(center.latitude) <= 90 && Math.abs(center.longitude) <= 180, 'INVALID', '地图中心无效')
    const rows = await repo.find('presences', { active: true, expiresAt: { $gt: now() }, geo: { ...center, radius: 10000 } }, { limit: 100 })
    const items = []
    for (const row of rows) {
      const user = await repo.get('users', row.ownerId)
      if (!user || user.blocked) continue
      const edge = uid ? await repo.get('friendships', idFor('friend', uid, row.ownerId)) : null
      items.push({ id: row.ownerId, isMine: row.ownerId === uid, latitude: row.latitude, longitude: row.longitude, place: row.place, mode: row.mode, shout: row.shout, expiresAt: row.expiresAt, updatedAt: row.updatedAt, avatar: await publicUser(user), friendStatus: edge?.status || '' })
    }
    return { items }
  }
  async function updatePresence(input, uid, openid) {
    await member(uid)
    const point = presenceInput(input)
    const verdict = await moderation.text(`${point.place}\n${point.shout}`, openid)
    requireThat(verdict === 'pass', 'REVIEW', '喊话或地点暂不能公开，请换一种表达')
    const updatedAt = now()
    const expiresAt = updatedAt + 2 * 60 * 60 * 1000
    const previous = await repo.get('presences', uid)
    await repo.set('presences', uid, { ...previous, ownerId: uid, ...point, location: repo.point(point.longitude, point.latitude), active: true, createdAt: previous?.createdAt || updatedAt, updatedAt, expiresAt })
    return { active: true, expiresAt }
  }
  async function friendRequest(targetId, uid) {
    await member(uid)
    requireThat(typeof targetId === 'string' && targetId !== uid && /^[a-f0-9]{32}$/.test(targetId), 'INVALID', '不能向这个用户发送好友申请')
    const target = await repo.get('users', targetId)
    requireThat(target && !target.blocked, 'NOT_FOUND', '这个用户暂不可用')
    const id = idFor('friend', uid, targetId)
    return repo.transaction(async tx => {
      const previous = await tx.get('friendships', id)
      if (previous?.status === 'pending' || previous?.status === 'accepted') return { status: previous.status }
      requireThat(previous?.status !== 'declined' || now() - (previous.updatedAt || previous.createdAt) >= 86400000, 'RATE_LIMIT', '对方已忽略申请，请稍后再试')
      const incomingId = idFor('friend', targetId, uid)
      const incoming = await tx.get('friendships', incomingId)
      if (incoming?.status === 'pending') {
        await tx.set('friendships', incomingId, { ...incoming, status: 'accepted', updatedAt: now() })
        await tx.set('friendships', id, { ownerId: uid, targetId, status: 'accepted', createdAt: now(), updatedAt: now() })
        await notify(tx, targetId, uid, 'friend_accepted', uid, incomingId)
        return { status: 'accepted' }
      }
      const row = { ownerId: uid, targetId, status: 'pending', createdAt: now(), version: (previous?.version || 0) + 1 }
      await tx.set('friendships', id, row)
      await notify(tx, targetId, uid, 'friend_request', uid, `${id}-${row.version}`)
      return { status: 'pending' }
    })
  }
  async function friendResponse(input, uid) {
    await member(uid)
    requireThat(typeof input.userId === 'string' && /^[a-f0-9]{32}$/.test(input.userId) && typeof input.accept === 'boolean', 'INVALID', '好友申请无效')
    const incomingId = idFor('friend', input.userId, uid)
    return repo.transaction(async tx => {
      const incoming = await tx.get('friendships', incomingId)
      if (incoming?.status === (input.accept ? 'accepted' : 'declined')) return { status: incoming.status }
      requireThat(incoming?.targetId === uid && incoming.status === 'pending', 'NOT_FOUND', '好友申请已处理或已失效')
      const outgoingId = idFor('friend', uid, input.userId)
      if (input.accept) {
        await tx.set('friendships', incomingId, { ...incoming, status: 'accepted', updatedAt: now() })
        await tx.set('friendships', outgoingId, { ownerId: uid, targetId: input.userId, status: 'accepted', createdAt: now(), updatedAt: now() })
        await notify(tx, input.userId, uid, 'friend_accepted', uid, incomingId)
        return { status: 'accepted' }
      }
      await tx.set('friendships', incomingId, { ...incoming, status: 'declined', updatedAt: now() })
      return { status: 'declined' }
    })
  }
  async function submit(input, uid, openid) {
    await member(uid)
    requireThat(typeof input.requestId === 'string' && /^[\w-]{8,80}$/.test(input.requestId), 'INVALID', '发布请求无效，请重新提交')
    const id = idFor('content', uid, input.requestId)
    const previous = await repo.get('contents', id)
    if (previous) return { id, status: previous.status }
    const values = contentInput(input, now())
    const createdAt = now()
    const row = { ...values, ownerId: uid, location: repo.point(values.longitude, values.latitude), searchText: `${values.title} ${values.text} ${values.place}`, status: 'pending', textApproved: false, moderationError: '', likes: 0, commentCount: 0, joinedCount: 0, cancelled: false, noticesDone: false, createdAt }
    await repo.transaction(async tx => {
      if (await tx.get('contents', id)) return
      const day = idFor('publish-limit', uid, Math.floor(createdAt / 86400000))
      const limit = await tx.get('limits', day)
      requireThat((limit?.count || 0) < 30, 'RATE_LIMIT', '今日发布较多，请明天再试')
      for (const mediaId of values.mediaIds) {
        const image = await tx.get('media', mediaId)
        requireThat(image && image.ownerId === uid && image.status === 'ready', 'MEDIA', '图片无效、已使用或上传尚未完成')
        await tx.set('media', mediaId, { ...image, targetId: id, status: 'pending' })
      }
      await tx.set('contents', id, row)
      await tx.set('limits', day, { count: (limit?.count || 0) + 1, createdAt })
    })
    await reviewContent(id, openid)
    return { id, status: (await repo.get('contents', id)).status }
  }
  async function reviewContent(id, openid) {
    const row = await repo.get('contents', id)
    if (!row || !['pending', 'review_error'].includes(row.status)) return
    await repo.transaction(async tx => { const current = await tx.get('contents', id); if (current && ['pending', 'review_error'].includes(current.status)) await tx.set('contents', id, { ...current, reviewStartedAt: now() }) })
    const transition = (status, moderationError = '') => repo.transaction(async tx => {
      const current = await tx.get('contents', id)
      if (current && ['pending', 'review_error'].includes(current.status)) await tx.set('contents', id, { ...current, status, moderationError })
    })
    try {
      const verdict = await moderation.text(`${row.title}\n${row.text}\n${row.place}`, openid)
      if (verdict === 'risky') { await transition('rejected', '文字未通过审核，请修改后重新发布'); return }
      await repo.transaction(async tx => { const current = await tx.get('contents', id); if (current && ['pending', 'review_error'].includes(current.status)) await tx.set('contents', id, { ...current, textApproved: verdict === 'pass', textVerdict: verdict }) })
      if (!row.mediaIds.length) { await transition(verdict === 'pass' ? 'published' : 'review', verdict === 'review' ? '文字等待人工复核' : ''); return }
      for (const mediaId of row.mediaIds) {
        const image = await repo.get('media', mediaId)
        if (['approved', 'rejected', 'review'].includes(image.status) || (image.status === 'checking' && now() - (image.checkingAt || image.createdAt) < 900000)) continue
        // mediaId 作为回调重试标识；只有平台注册的 traceId 可更新审核状态。
        const traceId = await moderation.image(image.fileId, openid)
        const early = await repo.transaction(async tx => {
          const callback = await tx.get('moderationTasks', traceId)
          const current = await tx.get('media', mediaId)
          if (current?.status === 'deleted') return null
          await tx.set('moderationTasks', traceId, { mediaId, targetId: id, status: 'waiting', createdAt: now() })
          await tx.set('media', mediaId, { ...current, status: 'checking', traceId, checkingAt: now() })
          return callback?.status === 'early' ? callback.suggest : null
        })
        if (early) await require('./moderation').settleMedia(repo, traceId, early, now)
      }
      const images = await Promise.all(row.mediaIds.map(mediaId => repo.get('media', mediaId)))
      const state = images.some(image => image?.status === 'rejected') ? 'rejected' : images.some(image => image?.status === 'review') ? 'review' : images.every(image => image?.status === 'approved') ? (verdict === 'pass' ? 'published' : 'review') : 'pending'
      await transition(state)
    } catch (_) {
      await repo.transaction(async tx => { const current = await tx.get('contents', id); if (current && ['pending', 'review_error'].includes(current.status)) await tx.set('contents', id, { ...current, status: 'review_error', moderationError: '审核服务暂不可用，可稍后重试' }) })
    }
  }
  async function changeFlag(table, input, uid) {
    await member(uid)
    requireThat(typeof input.active === 'boolean', 'INVALID', '请指定操作状态')
    return repo.transaction(async tx => {
      const row = await tx.get('contents', input.id)
      requireThat(row?.status === 'published', 'NOT_FOUND', '内容已不可用')
      const id = idFor(input.id, uid)
      const previous = await tx.get(table, id)
      if (!!previous?.active === input.active) return { active: input.active }
      await tx.set(table, id, { ownerId: uid, targetId: input.id, active: input.active, createdAt: previous?.createdAt || now() })
      if (table === 'reactions') {
        await tx.set('contents', input.id, { ...row, likes: Math.max(0, row.likes + (input.active ? 1 : -1)) })
        if (input.active) await notify(tx, row.ownerId, uid, 'like', input.id, id)
      }
      return { active: input.active }
    })
  }
  async function signup(input, uid) {
    await member(uid)
    requireThat(typeof input.active === 'boolean', 'INVALID', '报名状态无效')
    return repo.transaction(async tx => {
      const row = await tx.get('contents', input.id)
      requireThat(row?.kind === 'activity' && row.status === 'published', 'NOT_FOUND', '活动不存在或未公开')
      requireThat(row.ownerId !== uid, 'INVALID', '发起人无需报名自己的活动')
      const id = idFor(input.id, uid)
      const previous = await tx.get('members', id)
      if (!!previous?.active === input.active) return { active: input.active }
      if (input.active) requireThat(!row.cancelled && row.startAt > now() && row.joinedCount < row.capacity, 'ACTIVITY_CLOSED', '活动已满、取消或已经开始')
      await tx.set('members', id, { ownerId: uid, targetId: input.id, active: input.active, version: (previous?.version || 0) + 1, createdAt: previous?.createdAt || now() })
      await tx.set('contents', input.id, { ...row, joinedCount: Math.max(0, row.joinedCount + (input.active ? 1 : -1)) })
      await notify(tx, row.ownerId, uid, input.active ? 'signup' : 'withdraw', input.id, `${id}-${(previous?.version || 0) + 1}`)
      return { active: input.active }
    })
  }
  async function execute(action, input = {}, openid) {
    requireThat(input && typeof input === 'object' && !Array.isArray(input), 'INVALID', '请求参数无效')
    if (input.id !== undefined) requireThat(typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id), 'INVALID', '内容标识无效')
    if (input.cursor !== undefined && input.cursor !== null) requireThat(typeof input.cursor === 'string' && input.cursor.length <= 1024, 'INVALID', '分页参数无效')
    const uid = openid ? idFor('user', openid) : ''
    if (action === 'feed') return listContents(input, uid)
    if (action === 'content.get') {
      const row = await content(text(input.id, 80, true), uid)
      return (await hydrate([row], uid))[0]
    }
    if (action === 'comments.list') {
      await content(input.id, uid, true)
      const result = pageResult(await repo.find('comments', { targetId: input.id, status: 'published' }, { cursor: input.cursor, limit: 20 }), 20)
      return { items: result.rows.map(({ ownerId, ...row }) => row), cursor: result.cursor }
    }
    if (action === 'presence.nearby') return nearby(input, openid ? idFor('user', openid) : '')
    const actor = uidOf(openid)
    if (action === 'user.identity') return { id: actor }
    if (action === 'presence.me') { const row = await repo.get('presences', actor); return row ? { active: !!row.active, latitude: row.latitude, longitude: row.longitude, place: row.place, mode: row.mode, shout: row.shout || '', expiresAt: row.expiresAt } : null }
    if (action === 'presence.set') return updatePresence(input, actor, openid)
    if (action === 'presence.off') { await member(actor); await repo.set('presences', actor, { ...(await repo.get('presences', actor)), ownerId: actor, active: false, updatedAt: now() }); return { active: false } }
    if (action === 'friend.request') return friendRequest(input.userId, actor)
    if (action === 'friend.respond') return friendResponse(input, actor)
    if (action === 'friends.list') {
      await member(actor)
      const rows = await repo.find('friendships', { ownerId: actor, status: 'accepted' }, { cursor: input.cursor, limit: 20 })
      const items = []
      for (const row of rows) { const user = await repo.get('users', row.targetId); if (user && !user.blocked) items.push(await publicUser(user)) }
      return { items, cursor: pageResult(rows, 20).cursor }
    }
    if (action === 'user.me') { const user = await repo.get('users', actor); return user ? { ...(await publicUser(user)), isAdmin: admin(actor), blocked: !!user.blocked, avatarReviewStatus: user.avatarReviewStatus || '' } : null }
    if (action === 'user.save') {
      const nickname = text(input.nickname, 20, true)
      requireThat((await moderation.text(nickname, openid)) === 'pass', 'REVIEW', '昵称审核未通过，请修改后再试')
      const previous = await repo.get('users', actor)
      requireThat(!previous?.blocked, 'FORBIDDEN', '账号暂不能修改资料')
      const avatarKey = ['mika', 'sora', 'rin', 'luna', 'yuki', 'kira'].includes(input.avatarKey) ? input.avatarKey : (previous?.avatarKey || 'mika')
      const tags = input.tags === undefined ? (previous?.tags || []) : input.tags
      requireThat(Array.isArray(tags) && tags.length <= 5, 'INVALID', '最多添加五个角色或兴趣标签')
      const safeTags = [...new Set(tags.map(tag => text(tag, 12, true)))].filter(Boolean)
      if (safeTags.length && (await moderation.text(safeTags.join('、'), openid)) !== 'pass') throw new BusinessError('REVIEW', '角色标签未通过审核，请修改后再试')
      let avatarMediaId = previous?.avatarMediaId || ''
      let avatarReviewStatus = previous?.avatarReviewStatus || ''
      let avatarPendingMediaId = previous?.avatarPendingMediaId || ''
      let earlyAvatarVerdict = null
      let pendingAvatarMediaId = ''
      if (input.avatarMediaId !== undefined) {
        requireThat(input.avatarMediaId === '' || (typeof input.avatarMediaId === 'string' && /^[a-f0-9]{32}$/.test(input.avatarMediaId)), 'INVALID', '头像文件无效')
        if (input.avatarMediaId) {
          const media = await repo.get('media', input.avatarMediaId)
          requireThat(media?.ownerId === actor && media.status === 'ready', 'MEDIA', '头像上传尚未完成，请重试')
          const traceId = await moderation.image(media.fileId, openid)
          const early = await repo.transaction(async tx => {
            const callback = await tx.get('moderationTasks', traceId)
            await tx.set('users', actor, { ...previous, nickname, avatarKey, tags: safeTags, avatarMediaId, avatarPendingMediaId: input.avatarMediaId, avatarReviewStatus: 'pending', createdAt: previous?.createdAt || now() })
            await tx.set('moderationTasks', traceId, { type: 'profile_avatar', mediaId: input.avatarMediaId, userId: actor, status: 'waiting', createdAt: now() })
            await tx.set('media', input.avatarMediaId, { ...media, status: 'checking', traceId, checkingAt: now() })
            return callback?.status === 'early' ? callback.suggest : null
          })
          earlyAvatarVerdict = early
          pendingAvatarMediaId = input.avatarMediaId
          avatarPendingMediaId = input.avatarMediaId
          avatarReviewStatus = 'pending'
        } else { avatarMediaId = ''; avatarPendingMediaId = ''; avatarReviewStatus = '' }
      }
      const user = { ...previous, nickname, avatarKey, tags: safeTags, avatarMediaId, avatarPendingMediaId, avatarReviewStatus, createdAt: previous?.createdAt || now() }
      if (!pendingAvatarMediaId) await repo.set('users', actor, user)
      if (earlyAvatarVerdict && pendingAvatarMediaId) await require('./moderation').settleMedia(repo, (await repo.get('media', pendingAvatarMediaId)).traceId, earlyAvatarVerdict, now)
      const savedUser = await repo.get('users', actor)
      return { ...(await publicUser({ ...savedUser, _id: actor })), isAdmin: admin(actor), blocked: false, avatarReviewStatus: savedUser.avatarReviewStatus || '' }
    }
    if (action === 'content.create') return submit(input, actor, openid)
    if (action === 'content.reviewRetry') { const row = await content(input.id, actor); requireThat(row.ownerId === actor, 'FORBIDDEN', '只能重试自己的内容'); await reviewContent(input.id, openid); return { status: (await repo.get('contents', input.id)).status } }
    if (action === 'like.set') return changeFlag('reactions', input, actor)
    if (action === 'favorite.set') return changeFlag('favorites', input, actor)
    if (action === 'activity.signup') return signup(input, actor)
    if (action === 'comment.create') {
      const user = await member(actor)
      const row = await content(input.id, actor, true)
      const body = text(input.text, 500, true)
      requireThat(typeof input.requestId === 'string' && /^[\w-]{8,80}$/.test(input.requestId), 'INVALID', '评论请求无效')
      const id = idFor('comment', actor, input.requestId)
      if (await repo.get('comments', id)) return { id }
      requireThat((await moderation.text(body, openid)) === 'pass', 'REVIEW', '评论未通过审核，请修改后再试')
      await repo.transaction(async tx => {
        if (await tx.get('comments', id)) return
        const current = await tx.get('contents', input.id)
        requireThat(current?.status === 'published', 'NOT_FOUND', '内容已不可用')
        await tx.set('comments', id, { targetId: input.id, ownerId: actor, nickname: user.nickname, text: body, status: 'published', createdAt: now() })
        await tx.set('contents', input.id, { ...current, commentCount: current.commentCount + 1 })
        await notify(tx, row.ownerId, actor, 'comment', input.id, id)
      })
      return { id }
    }
    if (action === 'content.remove' || action === 'activity.cancel') {
      await member(actor)
      await repo.transaction(async tx => {
        const row = await tx.get('contents', input.id)
        requireThat(row && row.ownerId === actor, 'FORBIDDEN', '只能管理自己的内容')
        if (action === 'activity.cancel') {
          requireThat(row.kind === 'activity' && row.status !== 'deleted', 'INVALID', '活动不可用')
          await tx.set('contents', input.id, { ...row, cancelled: true })
        } else { requireThat(row.kind === 'post', 'INVALID', '活动请使用取消操作'); await tx.set('contents', input.id, { ...row, status: 'deleted' }) }
      })
      if (action === 'activity.cancel') await require('./jobs').cancellationNotices(repo, await repo.get('contents', input.id), now)
      // 后台任务分页补齐剩余通知。
      return { ok: true }
    }
    if (action === 'mine') {
      await member(actor)
      const kind = input.section || 'posts'
      if (['favorites', 'joined'].includes(kind)) {
        const links = await repo.find(kind === 'favorites' ? 'favorites' : 'members', { ownerId: actor, active: true }, { cursor: input.cursor, limit: 20 })
        const rows = (await Promise.all(links.map(link => repo.get('contents', link.targetId)))).filter(row => row?.status === 'published')
        return { items: await hydrate(rows, actor), cursor: pageResult(links, 20).cursor }
      }
      const rows = await repo.find('contents', { ownerId: actor, kind: kind === 'activities' ? 'activity' : 'post', status: { $in: ['pending', 'review_error', 'review', 'rejected', 'published'] } }, { cursor: input.cursor, limit: 20 })
      return { items: await hydrate(rows, actor), cursor: pageResult(rows, 20).cursor }
    }
    if (action === 'notifications.list') {
      const rows = await repo.find('notifications', { ownerId: actor }, { cursor: input.cursor, limit: 20 })
      const items = []
      for (const row of rows) {
        const author = row.actorId ? await publicUser(await repo.get('users', row.actorId)) : null
        const { ownerId, ...notice } = row
        const relation = row.type === 'friend_request' ? await repo.get('friendships', idFor('friend', row.actorId, actor)) : null
        items.push({ ...notice, actor: author, friendStatus: relation?.status || '' })
      }
      return { items, cursor: pageResult(rows, 20).cursor }
    }
    if (action === 'notifications.unread') return { count: (await repo.find('notifications', { ownerId: actor, read: false }, { limit: 99 })).length }
    if (action === 'notifications.read') {
      await repo.transaction(async tx => { const row = await tx.get('notifications', input.id); requireThat(row?.ownerId === actor, 'FORBIDDEN', '不能读取他人的通知'); await tx.set('notifications', input.id, { ...row, read: true }) })
      return { ok: true }
    }
    if (action === 'report.create') {
      await member(actor)
      await content(input.id, actor, true)
      const reason = text(input.reason, 300, true)
      const id = idFor('report', actor, input.id)
      await repo.transaction(async tx => { if (!await tx.get('reports', id)) await tx.set('reports', id, { ownerId: actor, targetId: input.id, reason, status: 'open', createdAt: now() }) })
      return { ok: true }
    }
    if (action === 'media.reserve') {
      await member(actor)
      const id = idFor('media', actor, random())
      const cloudPath = `private/${id}.jpg`
      const day = idFor('media-limit', actor, Math.floor(now() / 86400000))
      await repo.transaction(async tx => {
        const limit = await tx.get('limits', day)
        requireThat((limit?.count || 0) < 100, 'RATE_LIMIT', '今日上传较多，请明天再试')
        await tx.set('limits', day, { count: (limit?.count || 0) + 1, createdAt: now() })
        await tx.set('media', id, { ownerId: actor, cloudPath, status: 'reserved', createdAt: now() })
      })
      return { id, cloudPath }
    }
    if (action === 'media.complete') {
      const token = idFor(random())
      const cloudPath = `sealed/${input.id}-${token}.jpg`
      const acquired = await repo.transaction(async tx => {
        const image = await tx.get('media', input.id)
        requireThat(image?.ownerId === actor && typeof input.fileId === 'string' && input.fileId.startsWith('cloud://') && input.fileId.slice(input.fileId.indexOf('/', 8) + 1) === image.cloudPath, 'MEDIA', '图片与上传记录不匹配')
        if (image.status === 'ready' && image.originalFileId === input.fileId) return false
        requireThat(image.status === 'reserved', 'MEDIA', '图片正在处理或已经使用，请稍后重试')
        const expected = input.fileId.slice(0, input.fileId.indexOf('/', 8) + 1) + cloudPath
        await tx.set('media', input.id, { ...image, status: 'sealing', token, originalFileId: input.fileId, stagedFiles: [...(image.stagedFiles || []), expected] })
        return true
      })
      if (!acquired) return { id: input.id }
      try {
        // 审核并展示服务端不可变副本；客户端永远不能覆盖 sealed 目录。
        const fileId = await files.seal(input.fileId, cloudPath)
        await repo.transaction(async tx => { const image = await tx.get('media', input.id); requireThat(image?.token === token, 'MEDIA', '图片状态已变化，请重新上传'); await tx.set('media', input.id, { ...image, fileId, status: 'ready' }) })
        return { id: input.id }
      } catch (_) {
        await repo.transaction(async tx => { const image = await tx.get('media', input.id); if (image?.token === token && image.status === 'sealing') await tx.set('media', input.id, { ...image, status: 'reserved' }) })
        throw new BusinessError('MEDIA', '图片处理失败，请确认图片不超过 5MB 后重试')
      }
    }
    if (action.startsWith('admin.')) {
      requireThat(admin(actor), 'FORBIDDEN', '无管理权限')
      if (action === 'admin.list') {
        const reports = input.skipReports ? [] : await repo.find('reports', { status: 'open' }, { cursor: input.reportCursor, limit: 20 })
        const rows = input.skipContents ? [] : await repo.find('contents', { status: { $in: ['review', 'review_error', 'rejected', 'pending'] } }, { cursor: input.cursor, limit: 20 })
        return { items: await hydrate(rows, actor), cursor: pageResult(rows, 20).cursor, reports, reportCursor: pageResult(reports, 20).cursor }
      }
      if (action === 'admin.resolve') {
        requireThat(['approve', 'reject', 'hide', 'dismiss'].includes(input.decision), 'INVALID', '处理操作无效')
        const auditId = idFor('audit', random())
        await repo.transaction(async tx => {
          const report = input.reportId ? await tx.get('reports', input.reportId) : null
          const targetId = report?.targetId || input.id
          const row = await tx.get('contents', targetId)
          requireThat(row && (row.status !== 'deleted' || (report && input.decision === 'dismiss')), 'NOT_FOUND', '内容不存在')
          // 风险内容不能被人工批准绕过平台拒绝结果。
          if (input.decision === 'approve') {
            requireThat(row.status === 'review', 'REVIEW', '只有平台返回待复核的内容可人工批准，审核异常请先重试审核')
            for (const id of row.mediaIds) { const image = await tx.get('media', id); requireThat(image && ['approved', 'review'].includes(image.status), 'REVIEW', '图片尚未完成审核、已清理或已拒绝'); await tx.set('media', id, { ...image, status: 'approved' }) }
          }
          if (input.decision !== 'dismiss') await tx.set('contents', targetId, { ...row, status: input.decision === 'approve' ? 'published' : 'rejected', moderationError: text(input.note, 300) || '管理员已处理' })
          if (report) await tx.set('reports', input.reportId, { ...report, status: 'closed', decision: input.decision })
          await tx.set('audit', auditId, { actorId: actor, targetId, decision: input.decision, createdAt: now() })
        })
        return { ok: true }
      }
    }
    throw new BusinessError('UNKNOWN_ACTION', '不支持的操作')
  }
  return { execute, reviewContent }
}
module.exports = { createService, TABLES }
