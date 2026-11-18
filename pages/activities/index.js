const api = require('../../utils/api')
const { syncTabBar } = require('../../utils/navigation')
Page({
  data: { items: [], cursor: null, loading: false, error: '', query: '' },
  onShow() { syncTabBar(this, 'service'); this.load() }, onUnload() { this.disposed = true; this.version = (this.version || 0) + 1 },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }, onReachBottom() { if (this.data.cursor) this.loadMore() },
  input(event) { this.setData({ query: event.detail.value }) }, search() { this.load() },
  loadMore() { this.load(true) },
  decorate(item) {
    const row = api.decorate(item)
    const start = new Date(item.startAt)
    return {
      ...row,
      dayText: String(start.getDate()).padStart(2, '0'),
      monthText: `${start.getMonth() + 1}月`,
      fillPercent: Math.min(100, Math.round(((item.joinedCount || 0) / (item.capacity || 1)) * 100)),
      stateText: item.cancelled ? '已取消' : item.joined ? '已报名' : item.activityClosed ? '已满或已开始' : '可报名'
    }
  },
  async load(more = false) {
    if (more === true && (this.data.loading || !this.data.cursor)) return
    const version = this.version = (this.version || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.request('feed', { kind: 'activity', query: this.data.query, center: getApp().globalData.center, cursor: more === true ? this.data.cursor : undefined })
      if (!this.disposed && version === this.version) this.setData({ items: more === true ? this.data.items.concat(result.items.map(item => this.decorate(item))) : result.items.map(item => this.decorate(item)), cursor: result.cursor })
    } catch (error) { if (!this.disposed && version === this.version) this.setData({ error: error.message }) }
    finally { if (!this.disposed && version === this.version) this.setData({ loading: false }) }
  },
  open(event) { wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }) },
  publish() { wx.navigateTo({ url: '/pages/publish/index?kind=activity' }) }
})
