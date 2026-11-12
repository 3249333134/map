const api = require('../../utils/api')
Page({
  data: { items: [], cursor: null, loading: false, error: '', query: '' },
  onShow() { this.load() }, onUnload() { this.disposed = true; this.version = (this.version || 0) + 1 },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }, onReachBottom() { if (this.data.cursor) this.loadMore() },
  input(event) { this.setData({ query: event.detail.value }) }, search() { this.load() },
  loadMore() { this.load(true) },
  async load(more = false) {
    if (more === true && (this.data.loading || !this.data.cursor)) return
    const version = this.version = (this.version || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.request('feed', { kind: 'activity', query: this.data.query, center: getApp().globalData.center, cursor: more === true ? this.data.cursor : undefined })
      if (!this.disposed && version === this.version) this.setData({ items: more === true ? this.data.items.concat(result.items.map(api.decorate)) : result.items.map(api.decorate), cursor: result.cursor })
    } catch (error) { if (!this.disposed && version === this.version) this.setData({ error: error.message }) }
    finally { if (!this.disposed && version === this.version) this.setData({ loading: false }) }
  },
  open(event) { wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }) },
  publish() { wx.navigateTo({ url: '/pages/publish/index?kind=activity' }) }
})
