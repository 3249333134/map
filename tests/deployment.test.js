const { test } = require('node:test')
const assert = require('node:assert/strict')
const { initialize } = require('../scripts/init-cloud')
const { collections, indexes } = require('../deployment/database')
test('初始化跳过同名同定义索引，不删除或重建已有索引，不写示例', async () => {
  const writes = []
  const db = { async createCollectionIfNotExists(name) { assert.ok(collections.includes(name)) }, async describeCollection(name) { return { Indexes: indexes[name].map(index => ({ Name: index.IndexName, Keys: index.MgoKeySchema.MgoIndexKeys, Unique: false })) } }, async updateCollection(...args) { writes.push(args) } }
  await initialize({ database: db, commonService() { return {} } }, 'test', { log() {} })
  assert.equal(writes.length, 0)
  db.describeCollection = async () => ({ Indexes: [] })
  await initialize({ database: db, commonService() { return {} } }, 'test', { log() {} })
  assert.ok(writes.length > collections.length)
  assert.ok(writes.every(([, change]) => change.CreateIndexes?.length === 1 && !change.DropIndexes))
})
test('同名索引有冲突时停止，保留已有索引', async () => {
  let mutations = 0
  const database = { async createCollectionIfNotExists() {}, async describeCollection() { return { Indexes: [{ Name: 'created_page', Keys: [{ Name: 'wrong', Direction: '1' }], Unique: false }] } }, async updateCollection() { mutations++ } }
  await assert.rejects(initialize({ database, commonService() { return {} } }, 'test', { log() {} }), /索引定义冲突/)
  assert.equal(mutations, 0)
})
