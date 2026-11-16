const api = require('../../utils/api')
const { back } = require('../../utils/navigation')
const DRAFT = 'map-social-text-draft-v1'
Page({
  data: { kind: 'post', title: '', text: '', category: '日常', categories: ['日常', '散步', '户外'], photos: [], location: null, date: '', startTime: '', endDate: '', endTime: '', capacity: '20', busy: false, progress: '', error: '', submitted: null, demoMode: api.config.demoMode },
  onLoad(options = {}) { const draft = wx.getStorageSync(DRAFT); if (draft && !options.kind) this.setData(draft); if (options.kind) this.setData({ kind: options.kind === 'activity' ? 'activity' : 'post' }); this.createRequest = draft && !options.kind && draft.requestId ? draft.requestId : api.requestId(); this.saveDraft() },
  onUnload() { this.disposed = true },
  field(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); this.saveDraft() },
  kind(event) { this.setData({ kind: event.currentTarget.dataset.kind }); this.saveDraft() },
  category(event) { this.setData({ category: this.data.categories[Number(event.detail.value)] }); this.saveDraft() },
  saveDraft() { const { kind, title, text, category, date, startTime, endDate, endTime, capacity, location } = this.data; wx.setStorageSync(DRAFT, { kind, title, text, category, date, startTime, endDate, endTime, capacity, location, requestId: this.createRequest }) },
  async choosePlace() {
    if (api.config.demoMode) { this.setData({ location: { latitude: 30.6532, longitude: 104.0641, place: '成都 · 春熙路（演示地点）' } }); this.saveDraft(); wx.showToast({ title: '已选择演示地点', icon: 'none' }); return }
    try { const place = await wx.chooseLocation({}); this.setData({ location: { latitude: place.latitude, longitude: place.longitude, place: place.name || place.address } }); this.saveDraft() } catch (_) { wx.showToast({ title: '未选择地点，可手动选点或检查位置权限', icon: 'none' }) }
  },
  async choosePhotos() {
    try { const result = await wx.chooseMedia({ count: 9 - this.data.photos.length, mediaType: ['image'], sizeType: ['compressed'] }); this.setData({ photos: this.data.photos.concat(result.tempFiles.map(file => ({ path: file.tempFilePath, mediaId: '' }))) }) } catch (_) {}
  },
  removePhoto(event) { if (!this.data.busy) this.setData({ photos: this.data.photos.filter((_, index) => index !== Number(event.currentTarget.dataset.index)) }) },
  async upload(photo, index) {
    if (photo.mediaId) return photo.mediaId
    if (api.config.demoMode) { photo.mediaId = photo.path; return photo.path }
    let compressed = photo.path
    try { compressed = (await wx.compressImage({ src: photo.path, quality: 75 })).tempFilePath } catch (_) {}
    const info = await wx.getFileInfo({ filePath: compressed })
    if (info.size > 5 * 1024 * 1024) throw new Error('图片超过 5MB，请选择更小的图片')
    const reservation = await api.request('media.reserve')
    const fileId = await new Promise((resolve, reject) => {
      const task = wx.cloud.uploadFile({ cloudPath: reservation.cloudPath, filePath: compressed, success: result => resolve(result.fileID), fail: () => reject(new Error('图片上传失败，可保留页面后重试')) })
      task.onProgressUpdate(value => { if (!this.disposed) this.setData({ progress: `上传第 ${index + 1} 张 · ${value.progress}%` }) })
    })
    await api.request('media.complete', { id: reservation.id, fileId })
    photo.mediaId = reservation.id
    return reservation.id
  },
  async submit() {
    if (this.data.busy || this.data.submitted) return
    this.setData({ busy: true, error: '' })
    try {
      if (!this.data.text.trim() || !this.data.location) throw new Error('请填写正文并选择公开地点')
      if (this.data.kind === 'activity' && (!this.data.title.trim() || !this.data.date || !this.data.endDate || !this.data.startTime || !this.data.endTime)) throw new Error('请填写活动名称、开始和结束时间')
      const startAt = new Date(`${this.data.date}T${this.data.startTime}:00`).getTime()
      const endAt = new Date(`${this.data.endDate}T${this.data.endTime}:00`).getTime()
      if (this.data.kind === 'activity' && (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt <= Date.now() || endAt <= startAt || !Number.isInteger(Number(this.data.capacity)) || Number(this.data.capacity) < 1 || Number(this.data.capacity) > 100)) throw new Error('请检查活动时间和 1–100 人的名额上限')
      await api.ensureProfile()
      const mediaIds = []
      for (let index = 0; index < this.data.photos.length; index++) mediaIds.push(await this.upload(this.data.photos[index], index))
      this.setData({ progress: '正在提交与审核…' })
      const result = await api.request('content.create', { kind: this.data.kind, title: this.data.title, text: this.data.text, category: this.data.category, ...this.data.location, mediaIds, requestId: this.createRequest, ...(this.data.kind === 'activity' ? { startAt, endAt, capacity: Number(this.data.capacity) } : {}) })
      wx.removeStorageSync(DRAFT)
      getApp().globalData.feedDirty = true
      if (!this.disposed) this.setData({ submitted: result, progress: '' })
    } catch (error) { if (!this.disposed) this.setData({ error: error.message, progress: '' }) }
    finally { if (!this.disposed) this.setData({ busy: false }) }
  },
  view() { wx.redirectTo({ url: `/pages/detail/index?id=${encodeURIComponent(this.data.submitted.id)}` }) }, back
})
