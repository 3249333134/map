class MemoryRepository {
  constructor() { this.tables = new Map(); this.queue = Promise.resolve() }
  point(longitude, latitude) { return { longitude, latitude } }
  async get(table, id) { return structuredClone(this.tables.get(table)?.get(id) || null) }
  async set(table, id, data) { if (!this.tables.has(table)) this.tables.set(table, new Map()); this.tables.get(table).set(id, structuredClone({ ...data, _id: id })); return this.get(table, id) }
  async find(table, filter = {}, { cursor, limit = 20 } = {}) {
    let rows = [...(this.tables.get(table)?.values() || [])].filter(row => Object.entries(filter).every(([key, value]) => {
      if (key === 'search') return row.searchText?.toLowerCase().includes(value.toLowerCase())
      if (key === 'geo') {
        const latitude = (row.latitude - value.latitude) * Math.PI / 180
        const longitude = (row.longitude - value.longitude) * Math.PI / 180
        const distance = 6378137 * 2 * Math.asin(Math.sqrt(Math.sin(latitude / 2) ** 2 + Math.cos(row.latitude * Math.PI / 180) * Math.cos(value.latitude * Math.PI / 180) * Math.sin(longitude / 2) ** 2))
        return distance <= value.radius
      }
      return value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key]) : value && typeof value === 'object' && '$lt' in value ? row[key] < value.$lt : row[key] === value
    }))
    rows.sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1))
    if (cursor) { const [time, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()); rows = rows.filter(row => row.createdAt < time || (row.createdAt === time && row._id < id)) }
    return structuredClone(rows.slice(0, limit))
  }
  transaction(work) {
    const result = this.queue.then(async () => { const snapshot = structuredClone(this.tables); try { return await work(this) } catch (error) { this.tables = snapshot; throw error } })
    this.queue = result.catch(() => {})
    return result
  }
}
module.exports = { MemoryRepository }
