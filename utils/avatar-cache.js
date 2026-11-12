const pending = new Map()
const resolved = new Map()
function keyFor(person) { return `cos-map-avatar:${person.id}:${person.avatar?.avatarVersion || person.avatar?.avatarKey || 'mika'}` }
function load(person, callback) {
  const url = person.avatar?.avatarUrl
  if (!url || typeof wx === 'undefined' || typeof wx.downloadFile !== 'function') return
  const key = keyFor(person)
  const cached = resolved.get(key)
  if (cached) { callback(person.id, cached); return }
  if (pending.has(key)) { pending.get(key).push(callback); return }
  pending.set(key, [callback])
  wx.downloadFile({ url, success: result => {
    if (result.statusCode !== 200 || !result.tempFilePath) { pending.delete(key); return }
    resolved.set(key, result.tempFilePath)
    const listeners = pending.get(key) || []
    pending.delete(key)
    listeners.forEach(listener => listener(person.id, result.tempFilePath))
  }, fail: () => pending.delete(key) })
}
function loadAll(people, callback) { people.slice(0, 50).forEach(person => load(person, callback)) }
module.exports = { loadAll }
