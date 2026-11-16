const crypto = require('node:crypto')
const idFor = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
class BusinessError extends Error { constructor(code, message) { super(message); this.code = code } }
const requireThat = (condition, code, message) => { if (!condition) throw new BusinessError(code, message) }
function text(value, max, required = false) {
  requireThat(typeof value === 'string' || value === undefined, 'INVALID', '文本格式不正确')
  const result = (value || '').trim()
  requireThat(result.length <= max && (!required || result.length), 'INVALID', `请填写${required ? '必填内容，' : ''}文字不超过 ${max} 字`)
  return result
}
function location(value) {
  requireThat(value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180, 'INVALID', '请选择有效地点')
  return { latitude: value.latitude, longitude: value.longitude, place: text(value.place, 120, true) }
}
function presenceInput(input) {
  const point = location(input)
  const mode = input.mode === 'current' ? 'current' : 'place'
  const movementMode = ['virtual', 'fuzzy'].includes(input.movementMode) ? input.movementMode : 'stationary'
  const shout = text(input.shout, 80)
  return { ...point, mode, movementMode, shout }
}
function contentInput(input, now) {
  const kind = input.kind === 'activity' ? 'activity' : 'post'
  const title = text(input.title, 40, kind === 'activity')
  const body = text(input.text, 2000, true)
  const point = location(input)
  const mediaIds = input.mediaIds || []
  requireThat(Array.isArray(mediaIds) && mediaIds.length <= 9 && new Set(mediaIds).size === mediaIds.length && mediaIds.every(id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)), 'INVALID', '最多选择九张图片')
  const category = ['日常', '散步', '户外'].includes(input.category) ? input.category : '日常'
  const result = { kind, title: title || body.slice(0, 24), text: body, ...point, category, mediaIds }
  if (kind === 'activity') {
    requireThat(Number.isFinite(input.startAt) && Number.isFinite(input.endAt) && input.startAt > now && input.endAt > input.startAt, 'INVALID', '活动开始时间必须晚于现在，结束时间必须晚于开始时间')
    requireThat(Number.isInteger(input.capacity) && input.capacity >= 1 && input.capacity <= 100, 'INVALID', '报名人数上限为 1–100 人')
    Object.assign(result, { startAt: input.startAt, endAt: input.endAt, capacity: input.capacity })
  }
  return result
}
module.exports = { idFor, BusinessError, requireThat, text, location, presenceInput, contentInput }
