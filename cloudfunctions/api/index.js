const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { createRepository } = require('./lib/repository')
const { createService } = require('./lib/service')
const { createModeration } = require('./lib/moderation')
const repo = createRepository(cloud.database())
const files = {
  async urls(fileIds) {
    const result = {}
    for (let offset = 0; offset < fileIds.length; offset += 50) {
      const response = await cloud.getTempFileURL({ fileList: fileIds.slice(offset, offset + 50) })
      for (const file of response.fileList) if (file.status === 0) result[file.fileID] = file.tempFileURL
    }
    return result
  },
  async seal(fileId, cloudPath) {
    const env = cloud.getWXContext().ENV || process.env.TCB_ENV
    if (!env || !fileId.startsWith(`cloud://${env}.`)) throw new Error('INVALID_STORAGE_ENV')
    const response = await cloud.downloadFile({ fileID: fileId })
    if (!response.fileContent?.length || response.fileContent.length > 5 * 1024 * 1024) throw new Error('INVALID_IMAGE_SIZE')
    return (await cloud.uploadFile({ cloudPath, fileContent: response.fileContent })).fileID
  }
}
const service = createService({ repo, files, moderation: createModeration(cloud), admins: (process.env.ADMIN_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean) })
exports.main = async event => {
  try {
    if (!event || typeof event.action !== 'string') return { ok: false, code: 'INVALID', message: '请求格式无效' }
    return { ok: true, data: await service.execute(event.action, event.input || {}, cloud.getWXContext().OPENID) }
  } catch (error) {
    if (!error.code) console.error('api', event?.action, error)
    return { ok: false, code: error.code || 'SERVER_ERROR', message: error.code ? error.message : '服务暂不可用，请稍后重试' }
  }
}
