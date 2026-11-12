const { collections, indexes } = require('../deployment/database')
const databaseRules = require('../deployment/database.rules.json')
const storageRules = require('../deployment/storage.rules.json')
const functionRules = require('../deployment/functions.rules.json')
const fs = require('node:fs')
const path = require('node:path')

// 默认只输出计划。仅 --apply 创建缺失集合和索引；权限独立使用 --permissions。
async function initialize(manager, envId, { permissions = false, log = console.log } = {}) {
  const common = manager.commonService()
  if (permissions) {
    const backup = { envId, savedAt: new Date().toISOString(), database: {} }
    for (const name of collections) backup.database[name] = await common.call({ Action: 'DescribeSafeRule', Param: { EnvId: envId, CollectionName: name } })
    backup.storage = await manager.storage.getStorageAcl({ withRule: true })
    backup.functions = await common.call({ Action: 'DescribeSecurityRule', Param: { EnvId: envId, ResourceType: 'FUNCTION' } })
    const backupDir = path.resolve(__dirname, '../.local')
    fs.mkdirSync(backupDir, { recursive: true })
    fs.writeFileSync(path.join(backupDir, `permissions-${Date.now()}.json`), JSON.stringify(backup, null, 2))
    for (const name of collections) await common.call({ Action: 'ModifySafeRule', Param: { EnvId: envId, CollectionName: name, AclTag: 'CUSTOM', Rule: JSON.stringify(databaseRules) } })
    await manager.storage.setStorageAcl('CUSTOM', storageRules)
    await common.call({ Action: 'ModifySecurityRule', Param: { EnvId: envId, ResourceType: 'FUNCTION', AclTag: 'CUSTOM', Rule: JSON.stringify(functionRules) } })
    log('权限已提交，原规则已备份到 .local；请等规则生效后运行运行时验收。')
    return
  }
  for (const name of collections) {
    await manager.database.createCollectionIfNotExists(name)
    const current = await manager.database.describeCollection(name)
    for (const wanted of indexes[name]) {
      const sameName = (current.Indexes || []).find(item => item.Name === wanted.IndexName)
      if (sameName) {
        const keys = sameName.Keys.map(item => [item.Name, String(item.Direction)])
        const desired = wanted.MgoKeySchema.MgoIndexKeys.map(item => [item.Name, item.Direction])
        if (JSON.stringify(keys) !== JSON.stringify(desired) || (sameName.Unique === true || sameName.Unique === 'true')) throw new Error(`索引定义冲突 ${name}/${wanted.IndexName}；已停止，不会替换已有索引`)
        continue
      }
      await manager.database.updateCollection(name, { CreateIndexes: [wanted] })
      log(`已添加 ${name}/${wanted.IndexName}`)
    }
  }
  log('初始化完成；未写入示例、删除集合或替换已有索引。请继续部署权限与云函数。')
}
async function main(args) {
  const apply = args.includes('--apply')
  const permissions = args.includes('--permissions')
  const envId = process.env.CLOUDBASE_ENV_ID || ''
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', envId: envId || '未指定', collections, indexes, permissions: { database: databaseRules, storage: storageRules, functions: functionRules } }, null, 2))
    console.log('未连接或修改云环境。--apply 只添加缺失集合和索引；--apply --permissions 单独提交权限（先备份）。')
    return
  }
  if (!envId || !process.env.TENCENTCLOUD_SECRETID || !process.env.TENCENTCLOUD_SECRETKEY) throw new Error('请在当前进程环境变量中配置 CLOUDBASE_ENV_ID、TENCENTCLOUD_SECRETID、TENCENTCLOUD_SECRETKEY；不要写进客户端或提交到 Git')
  const CloudBase = require('@cloudbase/manager-node')
  const manager = new CloudBase({ envId, secretId: process.env.TENCENTCLOUD_SECRETID, secretKey: process.env.TENCENTCLOUD_SECRETKEY, token: process.env.TENCENTCLOUD_SESSIONTOKEN, region: process.env.CLOUDBASE_REGION })
  console.log(`目标环境：${envId}；操作：${permissions ? '提交权限' : '添加缺失集合和索引'}`)
  await initialize(manager, envId, { permissions })
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error('初始化未完成：', error.message); process.exitCode = 1 })
module.exports = { initialize }
