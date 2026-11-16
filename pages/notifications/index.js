const api = require('../../utils/api')
const labels = { like: '有人赞了你的内容', comment: '你的内容有新评论', signup: '有人报名了你的活动', withdraw: '有人取消了报名', activity_cancel: '你报名的活动已取消', friend_request: '想和你成为好友', friend_accepted: '通过了你的好友申请' }
const icons = { like: 'heart', comment: 'chat', signup: 'user', withdraw: 'user', activity_cancel: 'info-circle', friend_request: 'user', friend_accepted: 'check-circle' }
const tones = { like: 'tone-like', comment: 'tone-comment', signup: 'tone-friend', withdraw: 'tone-plain', activity_cancel: 'tone-warm', friend_request: 'tone-friend', friend_accepted: 'tone-friend' }
Page({
  data: { items: [], cursor: null, loading: false, error: '', unread: 0 },
  onShow() { this.load() }, onUnload() { this.disposed = true }, onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }, onReachBottom() { if (this.data.cursor) this.loadMore() }, loadMore() { this.load(true) },
  async load(more = false) {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const [result, unread] = await Promise.all([api.request('notifications.list', { cursor: more === true ? this.data.cursor : undefined }), api.request('notifications.unread')])
      if (this.disposed) return
      const rows = result.items.map(item => ({
        ...item,
        label: labels[item.type] || '互动通知',
        icon: icons[item.type] || 'notification',
        tone: tones[item.type] || 'tone-plain',
        readText: item.read ? '已读' : '未读',
        friendNotice: item.type === 'friend_request' || item.type === 'friend_accepted',
        responseText: item.friendStatus === 'accepted' ? '已成为好友' : item.friendStatus === 'declined' ? '已忽略' : '',
        actorName: item.actor?.nickname || '',
        timeText: new Date(item.createdAt).toLocaleString()
      }))
      this.setData({ items: more === true ? this.data.items.concat(rows) : rows, cursor: result.cursor, unread: unread.count })
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  async open(event) {
    const row = this.data.items.find(item => item._id === event.currentTarget.dataset.id)
    if (!row || row.type.startsWith('friend_')) return
    try {
      await api.request('notifications.read', { id: row._id })
      this.setData({ items: this.data.items.map(item => item._id === row._id ? { ...item, read: true, readText: '已读' } : item), unread: Math.max(0, this.data.unread - (row.read ? 0 : 1)) })
      wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(row.targetId)}` })
    } catch (error) { api.toast(error) }
  },
  async respondFriend(event) {
    const row = this.data.items.find(item => item._id === event.currentTarget.dataset.id)
    if (!row || row.type !== 'friend_request' || row.friendBusy) return
    this.setData({ items: this.data.items.map(item => item._id === row._id ? { ...item, friendBusy: true } : item) })
    try {
      const result = await api.request('friend.respond', { userId: row.actorId, accept: event.currentTarget.dataset.accept === 'true' })
      await api.request('notifications.read', { id: row._id })
      this.setData({ items: this.data.items.map(item => item._id === row._id ? { ...item, read: true, readText: '已读', friendStatus: result.status, friendBusy: false, responseText: result.status === 'accepted' ? '已成为好友' : '已忽略' } : item), unread: Math.max(0, this.data.unread - (row.read ? 0 : 1)) })
      getApp().globalData.presenceDirty = true
      if (result.status === 'accepted') wx.showToast({ title: '已添加为好友', icon: 'success' })
    } catch (error) {
      this.setData({ items: this.data.items.map(item => item._id === row._id ? { ...item, friendBusy: false } : item) })
      api.toast(error)
    }
  }
})
