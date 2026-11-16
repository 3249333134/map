const resolved = new Map()
const pending = new Map()
function keyFor(person) { return `cos-map-avatar:${person.id}:${person.avatar?.avatarVersion || person.avatar?.avatarKey || 'mika'}` }
function local(url) { return /^wxfile:\/\//.test(url) || url.indexOf('http://store/') === 0 || url.startsWith('/') }
function download(url) {
  if (local(url)) return Promise.resolve(url)
  return new Promise(resolve => wx.downloadFile({ url, success: result => resolve(result.statusCode === 200 ? result.tempFilePath : ''), fail: () => resolve('') }))
}
function load(person, callback) {
  const urls = (person.avatar?.avatarFrameUrls || []).filter(Boolean)
  const sources = urls.length ? urls : [person.avatar?.avatarUrl].filter(Boolean)
  if (!sources.length || typeof wx === 'undefined') return
  const key = keyFor(person)
  if (resolved.has(key)) { callback(person.id, resolved.get(key)); return }
  if (pending.has(key)) { pending.get(key).push(callback); return }
  pending.set(key, [callback])
  Promise.all(sources.map(download)).then(paths => {
    const valid = paths.filter(Boolean)
    if (valid.length) resolved.set(key, valid)
    const callbacks = pending.get(key) || []
    pending.delete(key)
    callbacks.forEach(listener => { if (valid.length) listener(person.id, valid) })
  })
}
function loadAll(people, callback) { people.slice(0, 50).forEach(person => load(person, callback)) }
module.exports = { loadAll }
