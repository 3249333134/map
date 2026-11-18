const config = require('../config/cloud')
const KEY = 'map-avatar-library-v1'
function indexPath() { return wx.env.USER_DATA_PATH + '/avatar-library-index.json' }

function read() {
  let entries
  try { entries = JSON.parse(wx.getFileSystemManager().readFileSync(indexPath(), 'utf8')) } catch (_) {}
  if (!Array.isArray(entries)) {
    entries = wx.getStorageSync(KEY)
    if (Array.isArray(entries)) write(entries)
  }
  if (!Array.isArray(entries)) return []
  return entries.map(entry => ({
    ...entry,
    frames: entry.frames.map(frame => {
      const name = frame.split('/').pop()
      return name.startsWith('avatar-library-') ? wx.env.USER_DATA_PATH + '/' + name : frame
    })
  }))
}
function write(entries) {
  const fs = wx.getFileSystemManager()
  const temporary = indexPath() + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(entries), 'utf8')
  fs.renameSync(temporary, indexPath())
  try { wx.setStorageSync(KEY, entries) } catch (_) {}
}
function nameOf(value) {
  const name = String(value || '').trim()
  if (!name || name.length > 20) throw new Error('请填写 1～20 字的形象名称')
  return name
}
function rename(id, name) {
  const entries = read()
  const entry = entries.find(row => row.id === id)
  if (!entry) throw new Error('形象不存在，请刷新后重试')
  entry.name = nameOf(name)
  write(entries)
}
async function keepFile(source, destination) {
  let path = source
  if (/^https:\/\//.test(source)) {
    path = await new Promise((resolve, reject) => wx.downloadFile({
      url: source, success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('形象下载失败')), fail: reject
    }))
  }
  await new Promise((resolve, reject) => wx.getFileSystemManager().copyFile({
    srcPath: path, destPath: destination, success: resolve, fail: reject
  }))
  return destination
}
async function add(frames, name, sourceId = '') {
  const existing = read().find(row => sourceId && row.sourceId === sourceId)
  if (existing) return existing
  const safeName = nameOf(name)
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  const paths = await Promise.all(frames.map((frame, index) => keepFile(frame, `${wx.env.USER_DATA_PATH}/avatar-library-${id}-${index}.png`)))
  const entry = { id, name: safeName, frames: paths, createdAt: Date.now(), sourceId }
  const entries = read()
  write([entry, ...entries])
  return entry
}
async function activate(entry, profile) {
  let ids = entry.frames
  if (!config.demoMode) {
    const api = require('./api')
    ids = await Promise.all(entry.frames.map(async filePath => {
      const reservation = await api.request('media.reserve', { extension: 'png' })
      const uploaded = await new Promise((resolve, reject) => wx.cloud.uploadFile({
        cloudPath: reservation.cloudPath, filePath, success: resolve, fail: reject
      }))
      await api.request('media.complete', { id: reservation.id, fileId: uploaded.fileID })
      return reservation.id
    }))
  }
  const saved = await require('./api').request('user.save', {
    nickname: profile.nickname, avatarKey: profile.avatarKey || 'mika', tags: profile.tags || [],
    avatarMediaId: ids[0], avatarFrameMediaIds: ids
  })
  wx.setStorageSync(KEY + '-active', { id: entry.id, avatarVersion: saved.avatarVersion })
  getApp().globalData.presenceDirty = true
  return saved
}
async function includeCurrent(profile) {
  if (!profile?.avatarFrameUrls?.some(Boolean)) return read()
  const entries = read()
  const active = wx.getStorageSync(KEY + '-active')
  if (active?.avatarVersion === profile.avatarVersion && entries.some(entry => entry.id === active.id)) return entries
  const found = entries.find(entry => entry.sourceId === profile.avatarVersion || entry.frames[0] === profile.avatarUrl)
  const entry = found || await add(profile.avatarFrameUrls.filter(Boolean), '我的形象', profile.avatarVersion)
  wx.setStorageSync(KEY + '-active', { id: entry.id, avatarVersion: profile.avatarVersion })
  return read()
}
function activeId(profile) {
  const active = wx.getStorageSync(KEY + '-active')
  return active?.avatarVersion === profile?.avatarVersion ? active.id : ''
}
module.exports = { read, add, rename, activate, includeCurrent, activeId }
