const api = require('../../utils/api')
const { blurLocation } = require('../../utils/location-blur')
Page({
  data: {
    profile: null, nickname: '', tagsText: '', avatarKey: 'mika', avatarChanged: false, avatarUrl: '', avatarSource: '',
    avatarOptions: [{ id: 'mika', name: 'Mika' }, { id: 'sora', name: 'Sora' }, { id: 'rin', name: '凛' }, { id: 'luna', name: '月见' }, { id: 'yuki', name: 'Yuki' }, { id: 'kira', name: 'Kira' }],
    error: '', loading: false, saving: false, presenceBusy: false, presence: null, presenceMode: 'place', movementMode: 'stationary', presencePlace: null, presenceShout: '',
    items: [], cursor: null, section: 'posts',
    tabs: [{ id: 'posts', label: '我的动态' }, { id: 'activities', label: '发起活动' }, { id: 'joined', label: '报名活动' }, { id: 'favorites', label: '我的收藏' }, { id: 'friends', label: '好友' }]
  },
  onLoad(options = {}) { this.setup = options.setup === '1'; this.showPresence = options.presence === '1' },
  onShow() { this.load() },
  onUnload() { this.disposed = true },
  input(event) { this.setData({ nickname: event.detail.value }) },
  tagsInput(event) { this.setData({ tagsText: event.detail.value }) },
  chooseAvatar(event) { this.setData({ avatarKey: event.currentTarget.dataset.id, avatarChanged: true, avatarSource: '', avatarUrl: '' }) },
  aiAvatar() { wx.navigateTo({ url: '/pages/avatar/index' }) },
  async load(more = false) {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const profile = await api.request('user.me')
      if (!this.disposed) this.setData({ profile, nickname: profile?.nickname || this.data.nickname, tagsText: profile?.tags?.join('、') || this.data.tagsText, avatarKey: profile?.avatarKey || this.data.avatarKey, avatarUrl: profile?.avatarUrl || '', avatarSource: profile?.avatarSource || '' })
      if (profile) {
        const options = { cursor: more ? this.data.cursor : undefined }
        const result = this.data.section === 'friends' ? await api.request('friends.list', options) : await api.request('mine', { ...options, section: this.data.section })
        if (!this.disposed) this.setData({ items: more ? this.data.items.concat((result.items || []).map(item => this.data.section === 'friends' ? item : api.decorate(item))) : (result.items || []).map(item => this.data.section === 'friends' ? item : api.decorate(item)), cursor: result.cursor })
        const presence = await api.request('presence.me')
        if (!this.disposed) this.setData({ presence: presence?.active && presence.expiresAt > Date.now() ? presence : null, presenceMode: presence?.mode || this.data.presenceMode, movementMode: presence?.movementMode || this.data.movementMode, presencePlace: presence?.place ? { latitude: presence.latitude, longitude: presence.longitude, place: presence.place } : this.data.presencePlace, presenceShout: presence?.shout || this.data.presenceShout })
      }
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  async save() {
    if (this.data.saving) return
    this.setData({ saving: true, error: '' })
    try {
      const tags = this.data.tagsText.split(/[、,，]/).map(value => value.trim()).filter(Boolean).slice(0, 5)
      const values = { nickname: this.data.nickname, avatarKey: this.data.avatarKey, tags }
      if (this.data.avatarChanged) values.avatarMediaId = ''
      const profile = await api.request('user.save', values)
      if (!this.disposed) this.setData({ profile, avatarChanged: false, avatarUrl: profile.avatarUrl || '', avatarSource: profile.avatarSource || '' })
      if (this.setup && getCurrentPages().length > 1) wx.navigateBack()
      else { wx.showToast({ title: profile.avatarReviewStatus === 'pending' ? '资料已保存，照片审核中' : '资料已保存', icon: 'none' }); this.load() }
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  },
  selectPresenceMode(event) { this.setData({ presenceMode: event.currentTarget.dataset.mode, presencePlace: null }) },
  selectMovementMode(event) {
    const movementMode = event.currentTarget.dataset.mode
    this.setData({ movementMode, presencePlace: movementMode === 'fuzzy' ? null : this.data.presencePlace, presenceMode: movementMode === 'fuzzy' ? 'current' : this.data.presenceMode })
  },
  async choosePresencePlace() {
    if (api.config.demoMode) { this.setData({ presenceMode: 'place', presencePlace: { latitude: 30.6532, longitude: 104.0641, place: '成都 · 春熙路（演示地点）' } }); wx.showToast({ title: '已选择演示地点', icon: 'none' }); return }
    try { const place = await wx.chooseLocation({}); this.setData({ presenceMode: 'place', presencePlace: { latitude: place.latitude, longitude: place.longitude, place: place.name || place.address } }) }
    catch (_) { wx.showToast({ title: '未选择地点，可稍后再试', icon: 'none' }) }
  },
  useCurrentLocation() {
    if (this.data.presenceBusy) return
    if (api.config.demoMode) { this.setData({ presenceMode: 'current', presencePlace: { latitude: 30.6532, longitude: 104.0641, place: '春熙路附近（演示位置）' } }); wx.showToast({ title: '已使用演示位置', icon: 'none' }); return }
    wx.getLocation({ type: 'gcj02', success: location => this.setData({ presenceMode: 'current', presencePlace: { latitude: location.latitude, longitude: location.longitude, place: '我的当前位置' } }), fail: () => wx.showToast({ title: '定位未开启，请检查系统位置权限', icon: 'none' }) })
  },
  presenceShoutInput(event) { this.setData({ presenceShout: event.detail.value }) },
  getGpsLocation() { return new Promise((resolve, reject) => wx.getLocation({ type: 'gcj02', success: resolve, fail: reject })) },
  async activatePresence() {
    if (this.data.presenceBusy) return
    if (!this.data.profile?.nickname) { wx.showToast({ title: '先保存昵称和 Cos 形象', icon: 'none' }); return }
    if (this.data.movementMode !== 'fuzzy' && !this.data.presencePlace) { wx.showToast({ title: '请选择地图上显示的位置', icon: 'none' }); return }
    this.setData({ presenceBusy: true, error: '' })
    try {
      let point = this.data.presencePlace
      if (this.data.movementMode === 'fuzzy') {
        const gps = await this.getGpsLocation()
        const blurred = blurLocation(gps.latitude, gps.longitude)
        point = { ...blurred, place: '约500米范围' }
      }
      const result = await api.request('presence.set', { ...point, mode: this.data.presenceMode, movementMode: this.data.movementMode, shout: this.data.presenceShout })
      this.setData({ presence: { ...point, mode: this.data.presenceMode, movementMode: this.data.movementMode, shout: this.data.presenceShout, active: true, expiresAt: result.expiresAt } })
      getApp().globalData.presenceDirty = true
      wx.showToast({ title: this.data.movementMode === 'fuzzy' ? '已开启约500米模糊跟随' : this.data.movementMode === 'virtual' ? '已开启虚拟漫游' : '已出现在附近地图，2 小时后自动结束', icon: 'none' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ presenceBusy: false }) }
  },
  async stopPresence() {
    if (this.data.presenceBusy) return
    this.setData({ presenceBusy: true })
    try { await api.request('presence.off'); this.setData({ presence: null }); getApp().globalData.presenceDirty = true; wx.showToast({ title: '已从地图隐去', icon: 'success' }) }
    catch (error) { this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ presenceBusy: false }) }
  },
  tab(event) { if (this.data.loading) return; this.setData({ section: event.currentTarget.dataset.id, items: [], cursor: null }); this.load() },
  loadMore() { this.load(true) },
  open(event) { wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }) },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }) },
  about() { wx.navigateTo({ url: '/pages/about/index' }) }
})
