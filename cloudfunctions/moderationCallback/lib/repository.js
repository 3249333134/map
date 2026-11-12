function createRepository(db) {
  const command = db.command
  function adapter(context) {
    return {
      async get(table, id) {
        try { return (await context.collection(table).doc(id).get()).data || null }
        catch (error) { if (/(-502005|not exist|not found|does not exist)/i.test(error.message || '') && !/permission/i.test(error.message || '')) return null; throw error }
      },
      async set(table, id, data) { const { _id, ...fields } = data; await context.collection(table).doc(id).set({ data: fields }); return { ...fields, _id: id } },
      async find(table, filter = {}, { cursor, limit = 20 } = {}) {
        const conditions = []
        const plain = {}
        for (const [key, value] of Object.entries(filter)) {
          if (key === 'search') { if (value) plain.searchText = db.RegExp({ regexp: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }); continue }
          if (key === 'geo') { plain.location = command.geoWithin({ centerSphere: [[value.longitude, value.latitude], value.radius / 6378137] }); continue }
          plain[key] = value && typeof value === 'object' && '$in' in value ? command.in(value.$in) : value && typeof value === 'object' && '$lt' in value ? command.lt(value.$lt) : value && typeof value === 'object' && '$gt' in value ? command.gt(value.$gt) : value
        }
        conditions.push(plain)
        if (cursor) {
          let parsed
          try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) } catch (_) { throw new Error('INVALID_CURSOR') }
          if (!Array.isArray(parsed) || !Number.isFinite(parsed[0]) || typeof parsed[1] !== 'string') throw new Error('INVALID_CURSOR')
          conditions.push(command.or([{ createdAt: command.lt(parsed[0]) }, { createdAt: parsed[0], _id: command.lt(parsed[1]) }]))
        }
        const rows = (await context.collection(table).where(command.and(conditions)).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit).get()).data
        return rows
      }
    }
  }
  return { ...adapter(db), point: (longitude, latitude) => db.Geo.Point(longitude, latitude), transaction: work => db.runTransaction(transaction => work(adapter(transaction))) }
}
module.exports = { createRepository }
