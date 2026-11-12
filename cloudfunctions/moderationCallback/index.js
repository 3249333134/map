const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { createRepository } = require('./lib/repository')
const { settleMedia } = require('./lib/moderation')
exports.main = async event => {
  // 仅允许微信云调用消息推送；禁止客户端通过 callFunction 伪造审核结果。
  if (cloud.getWXContext().OPENID || event?.Event !== 'wxa_media_check' || !event.trace_id) throw new Error('FORBIDDEN_CALLBACK')
  return settleMedia(createRepository(cloud.database()), event.trace_id, event.result?.suggest || 'review')
}
