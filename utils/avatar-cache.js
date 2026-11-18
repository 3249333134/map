const resolved = new Map()
const pending = new Map()
function keyFor(person) { return `cos-map-avatar:${person.id}:${person.avatar?.avatarVersion || person.avatar?.avatarKey || 'mika'}` }
function local(url) {
  return /^(wxfile:\/\/|http:\/\/(store|usr|tmp)\/|\/)/.test(url)
    || (wx.env?.USER_DATA_PATH && url.startsWith(wx.env.USER_DATA_PATH + '/'))
}
function download(url) {
  if (local(url)) return Promise.resolve(url)
  return new Promise(resolve => wx.downloadFile({ url, success: result => resolve(result.statusCode === 200 ? result.tempFilePath : ''), fail: () => resolve('') }))
}
function load(person, callback) {
  const urls = person.avatar?.avatarFrameUrls || []
  const sources = urls.some(Boolean) ? urls : [person.avatar?.avatarUrl].filter(Boolean)
  if (!sources.length || typeof wx === 'undefined') return
  const key = keyFor(person)
  if (resolved.has(key)) { callback(person.id, resolved.get(key)); return }
  if (pending.has(key)) { pending.get(key).push(callback); return }
  pending.set(key, [callback])
  Promise.all(sources.map(url => url ? download(url) : '')).then(paths => {
    const hasFrame = paths.some(Boolean)
    if (paths.every(Boolean)) resolved.set(key, paths)
    const callbacks = pending.get(key) || []
    pending.delete(key)
    if (hasFrame) callbacks.forEach(listener => listener(person.id, paths))
  })
}
function loadAll(people, callback) { people.slice(0, 50).forEach(person => load(person, callback)) }
module.exports = { loadAll }
