const api = require('../../utils/api')
const { blurLocation } = require('../../utils/location-blur')
const { navigate } = require('../../utils/navigation')
const { DEFAULT_SPEED, readSpeed, saveSpeed } = require('../../utils/movement-speed')
const library = require('../../utils/avatar-library')
function avatarSource(profile) { return profile?.avatarFrameUrls?.some(Boolean) ? 'ai' : profile?.avatarSource || '' }
Page({
  data: {
    movementSpeed: DEFAULT_SPEED,
    avatarLibrary: [], activeAvatarId: '', switchingAvatar: false,
    profile: null, nickname: '', tagsText: '', avatarKey: 'mika', avatarUrl: '', avatarSource: '', cloudConfigured: !!api.config.envId, demoMode: api.config.demoMode,
    error: '', loading: false, saving: false, previewOpen: false, previewFrames: [], presenceBusy: false, presence: null, presenceMode: 'place', movementMode: 'stationary', presencePlace: null, presenceShout: '',
  },
  onLoad(options = {}) {
    this.setData({ movementSpeed: readSpeed() })
    if (options.presence === '1') this.profileSection = '#map-presence'
    else if (options.setup === '1') this.profileSection = '#profile-details'
  },
  onReady() { this.ready = true; this.scrollToRequestedSection() },
  scrollToRequestedSection() {
    if (!this.ready || !this.profileSection) return
    wx.pageScrollTo({ selector: this.profileSection, duration: 200 })
    this.profileSection = null
  },
  viewOnMap() {
    const { latitude, longitude } = this.data.presence
    const app = getApp()
    app.globalData.center = { latitude, longitude }
    app.globalData.presenceDirty = true
    navigate('home')
  },
  onShow() { if (this.data.cloudConfigured || this.data.demoMode) this.load() },
  onUnload() { this.disposed = true },
  input(event) { this.setData({ nickname: event.detail.value }) },
  tagsInput(event) { this.setData({ tagsText: event.detail.value }) },
  previewAvatar() {
    if (this.data.avatarSource !== 'ai' || !this.data.avatarUrl) return
    const frames = (this.data.profile?.avatarFrameUrls || []).filter(Boolean)
    const urls = frames.includes(this.data.avatarUrl) ? frames : [this.data.avatarUrl, ...frames]
    this.setData({ previewFrames: urls, previewOpen: true })
  },
  closePreview() { this.setData({ previewOpen: false }) },
  aiAvatar() { wx.navigateTo({ url: '/pages/avatar/index' }) },
  previewLibraryAvatar(event) {
    const entry = this.data.avatarLibrary.find(row => row.id === event.currentTarget.dataset.id)
    if (entry) this.setData({ previewFrames: entry.frames, previewOpen: true })
  },
  chooseLibraryAvatar(event) {
    if (Date.now() < (this.ignoreAvatarTapUntil || 0)) return
    if (event.currentTarget.dataset.id === this.data.activeAvatarId) this.previewLibraryAvatar(event)
    else this.useAvatar(event)
  },
  async avatarOptions(event) {
    this.ignoreAvatarTapUntil = Date.now() + 700
    try {
      const result = await wx.showActionSheet({ itemList: ['预览动作', '重命名'] })
      if (this.disposed) return
      if (result.tapIndex === 0) this.previewLibraryAvatar(event)
      else if (result.tapIndex === 1) await this.renameAvatar(event)
    } catch (_) {
      // Closing the menu leaves the selected avatar unchanged.
    }
  },
  async renameAvatar(event) {
    const entry = this.data.avatarLibrary.find(row => row.id === event.currentTarget.dataset.id)
    if (!entry) return
    const result = await wx.showModal({ title: '形象名称', editable: true, placeholderText: '填写 1～20 字', content: entry.name })
    if (!result.confirm || this.disposed) return
    try {
      library.rename(entry.id, result.content)
      this.setData({ avatarLibrary: library.read() })
    } catch (error) { api.toast(error) }
  },
  async useAvatar(event) {
    if (this.data.switchingAvatar || this.data.saving) return
    const entry = this.data.avatarLibrary.find(row => row.id === event.currentTarget.dataset.id)
    if (!entry) return
    this.setData({ switchingAvatar: true, error: '' })
    try {
      const profile = await api.request('user.me')
      if (!profile?.nickname) throw new Error('请先保存昵称')
      const saved = await library.activate(entry, profile)
      if (!this.disposed) this.setData({ profile: saved, avatarUrl: saved.avatarUrl || '', avatarSource: avatarSource(saved), activeAvatarId: library.activeId(saved) })
      wx.showToast({ title: saved.avatarReviewStatus === 'pending' ? '形象审核中' : '已切换形象', icon: 'none' })
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ switchingAvatar: false }) }
  },
  async load() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '', avatarLibrary: library.read() })
    try {
      const profile = await api.request('user.me')
      if (!this.disposed) this.setData({ profile, nickname: profile?.nickname || this.data.nickname, tagsText: profile?.tags?.join('、') || this.data.tagsText, avatarKey: profile?.avatarKey || this.data.avatarKey, avatarUrl: profile?.avatarUrl || '', avatarSource: avatarSource(profile) })
      const avatarLibrary = await library.includeCurrent(profile)
      if (!this.disposed) this.setData({ avatarLibrary, activeAvatarId: library.activeId(profile) })
      if (profile) {
        const presence = await api.request('presence.me')
        if (!this.disposed) this.setData({ presence: presence?.active && presence.expiresAt > Date.now() ? presence : null, presenceMode: presence?.mode || this.data.presenceMode, movementMode: presence?.movementMode || this.data.movementMode, presencePlace: presence?.place ? { latitude: presence.latitude, longitude: presence.longitude, place: presence.place } : this.data.presencePlace, presenceShout: presence?.shout || this.data.presenceShout })
      }
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  async save() {
    if (this.data.saving || this.data.switchingAvatar) return
    this.setData({ saving: true, error: '' })
    try {
      const tags = this.data.tagsText.split(/[、,，]/).map(value => value.trim()).filter(Boolean).slice(0, 5)
      const values = { nickname: this.data.nickname, avatarKey: this.data.avatarKey, tags }
      const profile = await api.request('user.save', values)
      getApp().globalData.presenceDirty = true
      if (!this.disposed) this.setData({ profile, avatarUrl: profile.avatarUrl || '', avatarSource: avatarSource(profile) })
      wx.showToast({ title: profile.avatarReviewStatus === 'pending' ? '资料已保存，照片审核中' : '资料已保存', icon: 'none' })
      this.load()
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  },
  selectPresenceMode(event) { this.setData({ presenceMode: event.currentTarget.dataset.mode, presencePlace: null }) },
  speedChanging(event) { this.setData({ movementSpeed: event.detail.value }) },
  speedChanged(event) {
    try {
      const movementSpeed = saveSpeed(event.detail.value)
      this.setData({ movementSpeed })
    } catch (_) {
      this.setData({ movementSpeed: readSpeed() })
      wx.showToast({ title: '速度保存失败，请重试', icon: 'none' })
    }
  },
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
    if (!this.data.cloudConfigured && !this.data.demoMode) { wx.showToast({ title: '云环境未配置，地图互动暂不可用', icon: 'none' }); return }
    if (!this.data.profile?.nickname) { wx.showToast({ title: '先保存昵称和 Cos 形象', icon: 'none' }); return }
    if (this.data.movementMode !== 'fuzzy' && !this.data.presencePlace) { wx.showToast({ title: '请选择地图上显示的位置', icon: 'none' }); return }
    this.setData({ presenceBusy: true, error: '' })
    try {
      let point = this.data.presencePlace
      if (this.data.movementMode === 'fuzzy') {
        const gps = this.data.demoMode ? { latitude: 30.6532, longitude: 104.0641 } : await this.getGpsLocation()
        const blurred = blurLocation(gps.latitude, gps.longitude)
        point = { ...blurred, place: '约500米范围' }
      }
      const result = await api.request('presence.set', { ...point, mode: this.data.presenceMode, movementMode: this.data.movementMode, shout: this.data.presenceShout })
      this.setData({ presence: { ...point, mode: this.data.presenceMode, movementMode: this.data.movementMode, shout: this.data.presenceShout, active: true, expiresAt: result.expiresAt } })
      this.viewOnMap()
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
})
