const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'miniprogram_npm'].includes(entry.name)) continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'))
    else if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file])
  }
}
walk(root)
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const seen = new Set()
function checkComponents(config, source) {
  for (const component of Object.values(config.usingComponents || {})) {
    const built = component.startsWith('tdesign-miniprogram/') ? path.join(root, 'miniprogram_npm', component) : component.startsWith('/') ? path.join(root, component.slice(1)) : path.resolve(path.dirname(source), component)
    if (seen.has(built)) continue
    seen.add(built)
    for (const extension of ['js', 'json', 'wxml', 'wxss']) if (!fs.existsSync(`${built}.${extension}`)) throw new Error(`组件缺失：${built}.${extension}`)
    checkComponents(JSON.parse(fs.readFileSync(`${built}.json`, 'utf8')), `${built}.json`)
  }
}
for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    if (!fs.existsSync(path.join(root, `${page}.${extension}`))) throw new Error(`缺少页面文件：${page}.${extension}`)
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, `${page}.json`), 'utf8'))
  checkComponents(config, path.join(root, `${page}.json`))
}
for (const name of ['cleanup', 'moderationCallback']) for (const file of fs.readdirSync(path.join(root, 'cloudfunctions/api/lib'))) {
  if (!fs.readFileSync(path.join(root, 'cloudfunctions/api/lib', file)).equals(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'lib', file)))) throw new Error('云函数共享代码不同步，请运行 npm run cloud:prepare')
}
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
if (!project.packOptions.ignore.some(item => item.value === 'cloudfunctions' && item.type === 'folder')) throw new Error('云端代码必须排除在客户端包外')
console.log('JSON、JavaScript、页面和组件引用、云函数同步及客户端打包排除检查通过')
