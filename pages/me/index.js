const api = require('../../utils/api')
Page({
  data: {
    profile: null, nickname: '', tagsText: '', avatarKey: 'mika', avatarChanged: false, avatarPhoto: null,
    avatarOptions: [{ id: 'mika', name: 'Mika' }, { id: 'sora', name: 'Sora' }, { id: 'rin', name: '凛' }, { id: 'luna', name: '月见' }, { id: 'yuki', name: 'Yuki' }, { id: 'kira', name: 'Kira' }],
    error: '', loading: false, saving: false, presenceBusy: false, presence: null, presenceMode: 'place', presencePlace: null, presenceShout: '',
    items: [], cursor: null, section: 'posts',
    tabs: [{ id: 'posts', label: '我的动态' }, { id: 'activities', label: '发起活动' }, { id: 'joined', label: '报名活动' }, { id: 'favorites', label: '我的收藏' }, { id: 'friends', label: '好友' }]
  },
  onLoad(options = {}) { this.setup = options.setup === '1'; this.showPresence = options.presence === '1' },
  onShow() { this.load() },
  onUnload() { this.disposed = true },
  input(event) { this.setData({ nickname: event.detail.value }) },
  tagsInput(event) { this.setData({ tagsText: event.detail.value }) },
  chooseAvatar(event) { this.setData({ avatarKey: event.currentTarget.dataset.id, avatarChanged: true, avatarPhoto: null }) },
  async chooseAvatarPhoto() {
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      const file = result.tempFiles[0]
      if (file) this.setData({ avatarPhoto: { path: file.tempFilePath }, avatarChanged: true })
    } catch (_) {}
  },
  async uploadAvatar() {
    let path = this.data.avatarPhoto.path
    try { path = (await wx.compressImage({ src: path, quality: 80 })).tempFilePath } catch (_) {}
    const info = await wx.getFileInfo({ filePath: path })
    if (info.size > 5 * 1024 * 1024) throw new Error('头像图片超过 5MB，请换一张图片')
    const reservation = await api.request('media.reserve')
    const fileId = await new Promise((resolve, reject) => wx.cloud.uploadFile({ cloudPath: reservation.cloudPath, filePath: path, success: result => resolve(result.fileID), fail: () => reject(new Error('头像上传失败，请检查网络后重试')) }))
    await api.request('media.complete', { id: reservation.id, fileId })
    return reservation.id
  },
  async load(more = false) {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const profile = await api.request('user.me')
      if (!this.disposed) this.setData({ profile, nickname: profile?.nickname || this.data.nickname, tagsText: profile?.tags?.join('、') || this.data.tagsText, avatarKey: profile?.avatarKey || this.data.avatarKey })
      if (profile) {
        const options = { cursor: more ? this.data.cursor : undefined }
        const result = this.data.section === 'friends' ? await api.request('friends.list', options) : await api.request('mine', { ...options, section: this.data.section })
        if (!this.disposed) this.setData({ items: more ? this.data.items.concat((result.items || []).map(item => this.data.section === 'friends' ? item : api.decorate(item))) : (result.items || []).map(item => this.data.section === 'friends' ? item : api.decorate(item)), cursor: result.cursor })
        const presence = await api.request('presence.me')
        if (!this.disposed) this.setData({ presence: presence?.active && presence.expiresAt > Date.now() ? presence : null, presenceMode: presence?.mode || this.data.presenceMode, presencePlace: presence?.place ? { latitude: presence.latitude, longitude: presence.longitude, place: presence.place } : this.data.presencePlace, presenceShout: presence?.shout || this.data.presenceShout })
      }
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  async save() {
    if (this.data.saving) return
    this.setData({ saving: true, error: '' })
    try {
      let avatarMediaId
      if (this.data.avatarChanged && this.data.avatarPhoto) avatarMediaId = await this.uploadAvatar()
      const tags = this.data.tagsText.split(/[、,，]/).map(value => value.trim()).filter(Boolean).slice(0, 5)
      const values = { nickname: this.data.nickname, avatarKey: this.data.avatarKey, tags }
      if (this.data.avatarChanged) values.avatarMediaId = avatarMediaId || ''
      const profile = await api.request('user.save', values)
      if (!this.disposed) this.setData({ profile, avatarChanged: false, avatarPhoto: null })
      if (this.setup && getCurrentPages().length > 1) wx.navigateBack()
      else { wx.showToast({ title: profile.avatarReviewStatus === 'pending' ? '资料已保存，照片审核中' : '资料已保存', icon: 'none' }); this.load() }
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  },
  selectPresenceMode(event) { this.setData({ presenceMode: event.currentTarget.dataset.mode, presencePlace: null }) },
  async choosePresencePlace() {
    try { const place = await wx.chooseLocation({}); this.setData({ presenceMode: 'place', presencePlace: { latitude: place.latitude, longitude: place.longitude, place: place.name || place.address } }) }
    catch (_) { wx.showToast({ title: '未选择地点，可稍后再试', icon: 'none' }) }
  },
  useCurrentLocation() {
    if (this.data.presenceBusy) return
    wx.getLocation({ type: 'gcj02', success: location => this.setData({ presenceMode: 'current', presencePlace: { latitude: location.latitude, longitude: location.longitude, place: '我的当前位置' } }), fail: () => wx.showToast({ title: '定位未开启，请检查系统位置权限', icon: 'none' }) })
  },
  presenceShoutInput(event) { this.setData({ presenceShout: event.detail.value }) },
  async activatePresence() {
    if (this.data.presenceBusy) return
    if (!this.data.profile?.nickname) { wx.showToast({ title: '先保存昵称和 Cos 形象', icon: 'none' }); return }
    if (!this.data.presencePlace) { wx.showToast({ title: '请选择地图上显示的位置', icon: 'none' }); return }
    this.setData({ presenceBusy: true, error: '' })
    try {
      const result = await api.request('presence.set', { ...this.data.presencePlace, mode: this.data.presenceMode, shout: this.data.presenceShout })
      this.setData({ presence: { ...this.data.presencePlace, mode: this.data.presenceMode, shout: this.data.presenceShout, active: true, expiresAt: result.expiresAt } })
      getApp().globalData.presenceDirty = true
      wx.showToast({ title: '已出现在附近地图，2 小时后自动结束', icon: 'none' })
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
