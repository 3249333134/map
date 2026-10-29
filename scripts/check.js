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
for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    if (!fs.existsSync(path.join(root, `${page}.${extension}`))) throw new Error(`缺少页面文件：${page}.${extension}`)
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, `${page}.json`), 'utf8'))
  for (const component of Object.values(config.usingComponents || {})) {
    if (!component.startsWith('tdesign-miniprogram/')) continue
    const built = path.join(root, 'miniprogram_npm', component)
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      if (!fs.existsSync(`${built}.${extension}`)) throw new Error(`UI 组件未构建：${component}`)
    }
  }
}
console.log('JSON、JavaScript 语法及页面文件检查通过')
