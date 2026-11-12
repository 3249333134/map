const { idFor } = require('./domain')
async function cancellationNotices(repo, activity, now = Date.now) {
  const members = await repo.find('members', { targetId: activity._id, active: true }, { cursor: activity.noticeCursor || undefined, limit: 20 })
  for (const member of members) {
    const id = idFor('activity-cancel', activity._id, member.ownerId)
    await repo.transaction(async tx => { if (!await tx.get('notifications', id)) await tx.set('notifications', id, { ownerId: member.ownerId, actorId: activity.ownerId, type: 'activity_cancel', targetId: activity._id, read: false, createdAt: now() }) })
  }
  const last = members[members.length - 1]
  await repo.transaction(async tx => {
    const current = await tx.get('contents', activity._id)
    if (!current) return
    await tx.set('contents', activity._id, { ...current, noticesDone: members.length < 20, noticeCursor: last ? Buffer.from(JSON.stringify([last.createdAt, last._id])).toString('base64url') : '' })
  })
}
async function runJobs(repo, cloud, now = Date.now) {
  // 也覆盖在提交文字审核前中断的无图内容，避免永久停在审核中。
  const stalled = await repo.find('contents', { status: 'pending', createdAt: { $lt: now() - 900000 } }, { limit: 20 })
  for (const row of stalled) await repo.transaction(async tx => {
    const current = await tx.get('contents', row._id)
    if (current?.status === 'pending' && now() - (current.reviewStartedAt || current.createdAt) >= 900000) await tx.set('contents', row._id, { ...current, status: 'review_error', moderationError: '审核结果暂未返回，请稍后重试' })
  })
  const state = await repo.get('limits', 'cleanup-cursor')
  const media = await repo.find('media', {}, { cursor: state?.cursor || undefined, limit: 50 })
  let removed = 0
  for (const image of media) {
    const target = image.targetId ? await repo.get('contents', image.targetId) : null
    const avatarOwners = await repo.find('users', { avatarMediaId: image._id }, { limit: 1 })
    const pendingAvatarOwners = image.status === 'checking' ? await repo.find('users', { avatarPendingMediaId: image._id }, { limit: 10 }) : []
    if (pendingAvatarOwners.length && now() - (image.checkingAt || image.createdAt) >= 900000) {
      for (const owner of pendingAvatarOwners) await repo.transaction(async tx => {
        const user = await tx.get('users', owner._id)
        if (user?.avatarPendingMediaId === image._id) await tx.set('users', owner._id, { ...user, avatarPendingMediaId: '', avatarReviewStatus: 'review_error' })
      })
    }
    if (image.status === 'checking' && now() - (image.checkingAt || image.createdAt) >= 900000 && target?.status === 'pending') {
      await repo.transaction(async tx => { const current = await tx.get('contents', target._id); if (current?.status === 'pending') await tx.set('contents', target._id, { ...current, status: 'review_error', moderationError: '图片审核结果暂未返回，请稍后重试' }) })
    }
    const disposable = await repo.transaction(async tx => {
      const current = await tx.get('media', image._id)
      if (!current || current.status === 'deleted') return null
      if (avatarOwners.length) return null
      const bound = current.targetId ? await tx.get('contents', current.targetId) : null
      const expired = now() - current.createdAt > 86400000 && (!bound || ['deleted', 'rejected'].includes(bound.status))
      if (!expired) return null
      // 先锁定，防止检查后新发布的内容引用正在清理的图片。
      await tx.set('media', image._id, { ...current, status: 'deleting' })
      return current
    })
    if (!disposable) continue
    const fileList = [...new Set([disposable.fileId, disposable.originalFileId, ...(disposable.stagedFiles || [])].filter(Boolean))]
    if (fileList.length) {
      const result = await cloud.deleteFile({ fileList })
      if (result.fileList?.some(item => item.status !== 0 && item.status !== -503003)) continue
    }
    await repo.transaction(async tx => { const current = await tx.get('media', image._id); if (current?.status === 'deleting') await tx.set('media', image._id, { ...current, status: 'deleted', fileId: '' }) })
    removed++
  }
  const last = media[media.length - 1]
  await repo.set('limits', 'cleanup-cursor', { cursor: media.length === 50 ? Buffer.from(JSON.stringify([last.createdAt, last._id])).toString('base64url') : '', createdAt: now() })
  const activities = await repo.find('contents', { kind: 'activity', cancelled: true, noticesDone: false }, { limit: 5 })
  for (const activity of activities) await cancellationNotices(repo, activity, now)
  return { removed, cancellations: activities.length }
}
module.exports = { runJobs, cancellationNotices }
