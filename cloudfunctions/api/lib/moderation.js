async function settleMedia(repo, traceId, suggest, now = Date.now) {
  return repo.transaction(async tx => {
    const task = await tx.get('moderationTasks', traceId)
    if (!task) { await tx.set('moderationTasks', traceId, { status: 'early', suggest, createdAt: now() }); return { queued: true } }
    if (task.status === 'done' || task.status === 'early') return { ignored: true }
    const image = await tx.get('media', task.mediaId)
    if (task.type === 'profile_avatar') {
      const user = await tx.get('users', task.userId)
      if (!image || !user || image.status === 'deleted' || image.traceId !== traceId) return { ignored: true }
      const state = suggest === 'pass' ? 'approved' : suggest === 'risky' ? 'rejected' : 'review'
      await tx.set('media', task.mediaId, { ...image, status: state })
      if (user.avatarPendingMediaId === task.mediaId) {
        if (state === 'approved') await tx.set('users', task.userId, { ...user, avatarMediaId: task.mediaId, avatarPendingMediaId: '', avatarReviewStatus: 'approved' })
        else await tx.set('users', task.userId, { ...user, avatarPendingMediaId: '', avatarReviewStatus: state })
      }
      await tx.set('moderationTasks', traceId, { ...task, status: 'done', completedAt: now() })
      return { ok: true }
    }
    const row = await tx.get('contents', task.targetId)
    if (!image || !row || image.status === 'deleted' || image.traceId !== traceId) return { ignored: true }
    const state = suggest === 'pass' ? 'approved' : suggest === 'risky' ? 'rejected' : 'review'
    const images = await Promise.all(row.mediaIds.map(id => id === task.mediaId ? { ...image, status: state } : tx.get('media', id)))
    await tx.set('media', task.mediaId, { ...image, status: state })
    await tx.set('moderationTasks', traceId, { ...task, status: 'done', completedAt: now() })
    if (['pending', 'review_error', 'review'].includes(row.status)) {
      const status = images.some(item => item?.status === 'rejected') ? 'rejected' : images.some(item => item?.status === 'review') ? 'review' : images.every(item => item?.status === 'approved') ? (row.textApproved ? 'published' : 'review') : 'pending'
      await tx.set('contents', row._id, { ...row, status, moderationError: status === 'review' ? '图片等待人工复核' : status === 'rejected' ? '图片审核未通过' : '' })
    }
    return { ok: true }
  })
}
function createModeration(cloud) {
  return {
    async text(content, openid) {
      const result = await cloud.openapi.security.msgSecCheck({ content, openid, scene: 1, version: 2 })
      if (result.errCode) throw new Error('TEXT_REVIEW_UNAVAILABLE')
      const suggest = result.result?.suggest
      if (!['pass', 'review', 'risky'].includes(suggest)) throw new Error('TEXT_REVIEW_INVALID')
      return suggest
    },
    async image(fileId, openid) {
      const response = await cloud.getTempFileURL({ fileList: [fileId] })
      const url = response.fileList[0]?.tempFileURL
      if (!url) throw new Error('IMAGE_UNAVAILABLE')
      const result = await cloud.openapi.security.mediaCheckAsync({ mediaUrl: url, mediaType: 2, openid, scene: 1, version: 2 })
      if (result.errCode || !result.traceId) throw new Error('IMAGE_REVIEW_UNAVAILABLE')
      return result.traceId
    }
  }
}
module.exports = { settleMedia, createModeration }
