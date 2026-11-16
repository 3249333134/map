const api = require('../../utils/api')
const config = require('../../config/cloud')

const styles = [
  { id: 'adventure', name: '热血冒险', hint: '海贼王式的热血冒险感', color: '#f5a14b' },
  { id: 'mecha', name: '未来机甲', hint: 'EVA式的未来科幻感', color: '#8e83d6' },
  { id: 'fantasy', name: '幻想旅者', hint: '原神式的幻想旅者感', color: '#69b7a3' }
]

Page({
  data: {
    server: config.avatarServer || 'http://127.0.0.1:8765', styles,
    style: 'fantasy', franchise: '', character: '', prompt: '', referencePath: '',
    frames: [], frameIndex: 0, generating: false, saving: false, error: ''
  },
  onLoad() { this.loadProfile() },
  onUnload() { this.disposed = true; clearInterval(this.frameTimer) },
  async loadProfile() {
    try { this.profile = await api.request('user.me') }
    catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
  },
  selectStyle(event) { this.setData({ style: event.currentTarget.dataset.id, error: '' }) },
  inputFranchise(event) { this.setData({ franchise: event.detail.value }) },
  inputCharacter(event) { this.setData({ character: event.detail.value }) },
  inputPrompt(event) { this.setData({ prompt: event.detail.value }) },
  async chooseReference() {
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      const file = result.tempFiles[0]
      const compressed = await new Promise((resolve, reject) => wx.compressImage({ src: file.tempFilePath, quality: 82, success: resolve, fail: reject }))
      const base64 = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
        filePath: compressed.tempFilePath, encoding: 'base64', success: result => resolve(result.data), fail: reject
      }))
      const mime = compressed.tempFilePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
      this.setData({ referencePath: file.tempFilePath, referenceDataUrl: `data:${mime};base64,${base64}`, error: '' })
    } catch (_) { wx.showToast({ title: '未选择图片', icon: 'none' }) }
  },
  removeReference() { this.setData({ referencePath: '', referenceDataUrl: '' }) },
  generate() {
    if (this.data.generating) return
    this.setData({ generating: true, error: '', frames: [], frameIndex: 0 })
    clearInterval(this.frameTimer)
    wx.request({
      url: `${this.data.server}/generate-anime`, method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { style: this.data.style, franchise: this.data.franchise, character: this.data.character, prompt: this.data.prompt, reference: this.data.referenceDataUrl || '' },
      timeout: 240000,
      success: result => {
        if (result.statusCode !== 200 || !result.data?.frames?.length) {
          this.finishError(result.statusCode === 503
            ? '生成服务还没有配置 Agnes AI API 密钥。请在项目根目录的 .env.local 配置 AGNES_API_KEY 后重启服务。'
            : (result.data?.error || '生成失败，请检查图像 API 配置、网络和额度后重试'))
          return
        }
        const frames = result.data.frames
        Promise.all(frames.map((data, index) => new Promise((resolve, reject) => {
          const filePath = `${wx.env.USER_DATA_PATH}/anime-sprite-${Date.now()}-${index}.png`
          wx.getFileSystemManager().writeFile({ filePath, data, encoding: 'base64', success: () => resolve(filePath), fail: reject })
        }))).then(paths => {
          if (this.disposed) return
          this.setData({ frames: paths, frameIndex: 0, generating: false })
          this.frameTimer = setInterval(() => this.setData({ frameIndex: (this.data.frameIndex + 1) % paths.length }), 500)
        }).catch(() => this.finishError('像素动作帧写入失败，请重试'))
      },
      fail: () => this.finishError(`连接不到生成服务（${this.data.server}）。请在电脑上启动 npm run avatar-server。`)
    })
  },
  finishError(message) { if (!this.disposed) this.setData({ generating: false, error: message }) },
  previewImage() { if (this.data.frames.length) wx.previewImage({ urls: this.data.frames }) },
  async saveFile(path) {
    return new Promise(resolve => wx.getFileSystemManager().saveFile({ tempFilePath: path, success: result => resolve(result.savedFilePath), fail: () => resolve(path) }))
  },
  async upload(path) {
    const reservation = await api.request('media.reserve', { extension: 'png' })
    const fileId = await new Promise((resolve, reject) => wx.cloud.uploadFile({
      cloudPath: reservation.cloudPath, filePath: path,
      success: result => resolve(result.fileID), fail: () => reject(new Error('头像上传失败，请检查网络后重试'))
    }))
    await api.request('media.complete', { id: reservation.id, fileId })
    return reservation.id
  },
  async save() {
    if (this.data.saving || !this.data.frames.length) return
    this.setData({ saving: true, error: '' })
    try {
      const profile = this.profile || await api.request('user.me')
      if (!profile?.nickname) throw new Error('请先在“我的”填写昵称')
      let avatarFrameMediaIds
      if (api.config.demoMode) avatarFrameMediaIds = await Promise.all(this.data.frames.map(path => this.saveFile(path)))
      else avatarFrameMediaIds = await Promise.all(this.data.frames.map(path => this.upload(path)))
      await api.request('user.save', {
        nickname: profile.nickname, avatarKey: profile.avatarKey || 'mika',
        tags: profile.tags || [], avatarMediaId: avatarFrameMediaIds[0], avatarFrameMediaIds
      })
      getApp().globalData.presenceDirty = true
      wx.showToast({ title: '动漫形象已保存', icon: 'none' })
      setTimeout(() => { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: '/pages/me/index' }) }, 500)
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  }
})
