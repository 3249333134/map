const api = require('../../utils/api')
const { syncTabBar, openProfileSettings } = require('../../utils/navigation')
function avatarSource(profile) { return profile?.avatarFrameUrls?.some(Boolean) ? 'ai' : profile?.avatarSource || '' }
Page({
  data: {
    profile: null, nickname: '', tagsText: '', avatarKey: 'mika', avatarUrl: '', avatarSource: '', cloudConfigured: !!api.config.envId, demoMode: api.config.demoMode,
    error: '', loading: false,
    items: [], cursor: null, section: 'posts',
    tabs: [{ id: 'posts', label: '我的动态' }, { id: 'activities', label: '发起活动' }, { id: 'joined', label: '报名活动' }, { id: 'favorites', label: '我的收藏' }, { id: 'friends', label: '好友' }]
  },
  openSettings() { openProfileSettings() },
  onShow() { syncTabBar(this, 'profile'); if (this.data.cloudConfigured || this.data.demoMode) this.load() },
  onUnload() { this.disposed = true },
  async load(more = false) {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const profile = await api.request('user.me')
      if (!this.disposed) this.setData({ profile, nickname: profile?.nickname || this.data.nickname, tagsText: profile?.tags?.join('、') || this.data.tagsText, avatarKey: profile?.avatarKey || this.data.avatarKey, avatarUrl: profile?.avatarUrl || '', avatarSource: avatarSource(profile) })
      if (profile) {
        const options = { cursor: more ? this.data.cursor : undefined }
        const result = this.data.section === 'friends' ? await api.request('friends.list', options) : await api.request('mine', { ...options, section: this.data.section })
        if (!this.disposed) this.setData({ items: more ? this.data.items.concat((result.items || []).map(item => this.data.section === 'friends' ? item : api.decorate(item))) : (result.items || []).map(item => this.data.section === 'friends' ? item : api.decorate(item)), cursor: result.cursor })
      }
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  tab(event) { if (this.data.loading) return; this.setData({ section: event.currentTarget.dataset.id, items: [], cursor: null }); this.load() },
  loadMore() { this.load(true) },
  open(event) { wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }) },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }) },
  about() { wx.navigateTo({ url: '/pages/about/index' }) }
})
