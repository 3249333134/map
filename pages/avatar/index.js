const api = require('../../utils/api')
const config = require('../../config/cloud')
const { navigate } = require('../../utils/navigation')
const library = require('../../utils/avatar-library')

const styles = [
  { id: 'adventure', name: '热血冒险', hint: '海贼王式的热血冒险感', color: '#f5a14b' },
  { id: 'mecha', name: '未来机甲', hint: 'EVA式的未来科幻感', color: '#8e83d6' },
  { id: 'fantasy', name: '幻想旅者', hint: '原神式的幻想旅者感', color: '#69b7a3' }
]

Page({
  data: {
    server: config.avatarServer || 'http://127.0.0.1:8765', styles,
    style: 'fantasy', franchise: '', character: '', prompt: '', referencePath: '',
    frames: [], avatarName: '', frameIndex: 0, previewOpen: false, generating: false, saving: false, error: ''
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
  inputAvatarName(event) { this.setData({ avatarName: event.detail.value }) },
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
    if (this.data.generating || this.data.saving) return
    this.libraryEntry = null
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
        }))).then(async paths => {
          if (this.disposed) return
          const name = this.data.avatarName.trim() || this.data.character.trim() || '新形象'
          this.libraryEntry = await library.add(paths, name)
          if (this.disposed) return
          paths = this.libraryEntry.frames
          this.setData({ avatarName: name })
          this.setData({ frames: paths, frameIndex: 0, generating: false })
          this.frameTimer = setInterval(() => this.setData({ frameIndex: (this.data.frameIndex + 1) % paths.length }), 500)
        }).catch(() => this.finishError('形象保存失败，请检查本机存储空间后重试'))
      },
      fail: error => {
        const message = error?.errMsg || ''
        if (/domain|域名|https|ssl|certificate/i.test(message)) {
          this.finishError('生成服务地址被微信拦截。模拟器需关闭本地项目的域名校验后重新编译，真机需使用已配置的 HTTPS 服务。')
        } else if (/timeout|timed out|超时/i.test(message)) {
          this.finishError('等待形象生成超时。请稍后重试，或检查本机生成服务与 Agnes AI 的网络连接。')
        } else {
          this.finishError(`连接不到生成服务（${this.data.server}）。如果在模拟器中，请确认电脑上的生成服务正在运行（npm run avatar-server）。`)
        }
      }
    })
  },
  finishError(message) { if (!this.disposed) this.setData({ generating: false, error: message }) },
  previewImage() { if (this.data.frames.length) this.setData({ previewOpen: true }) },
  closePreview() { this.setData({ previewOpen: false }) },
  async save() {
    if (this.data.saving || !this.data.frames.length) return
    this.setData({ saving: true, error: '' })
    try {
      const profile = this.profile || await api.request('user.me')
      if (!profile?.nickname) throw new Error('请先在“我的”填写昵称')
      if (!this.libraryEntry) this.libraryEntry = await library.add(this.data.frames, this.data.avatarName)
      library.rename(this.libraryEntry.id, this.data.avatarName)
      await library.activate(this.libraryEntry, profile)
      wx.showToast({ title: '动漫形象已保存', icon: 'none' })
      setTimeout(() => { if (getCurrentPages().length > 1) wx.navigateBack(); else navigate('profile') }, 500)
    } catch (error) { if (!this.disposed) this.setData({ error: error.message }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  }
})
