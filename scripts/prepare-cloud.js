const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../cloudfunctions')
for (const name of ['moderationCallback', 'cleanup']) {
  fs.cpSync(path.join(root, 'api/lib'), path.join(root, name, 'lib'), { recursive: true })
  const config = JSON.parse(fs.readFileSync(path.join(root, 'api/package.json'), 'utf8'))
  config.name = `map-social-${name.toLowerCase()}`
  fs.writeFileSync(path.join(root, name, 'package.json'), JSON.stringify(config, null, 2) + '\n')
  const lockFile = path.join(root, 'api/package-lock.json')
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
    lock.name = lock.packages[''].name = config.name
    fs.writeFileSync(path.join(root, name, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
  }
}
console.log('云函数共享代码准备完成；未创建或修改任何云资源')
