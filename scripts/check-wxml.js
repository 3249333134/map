const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const compiler = process.env.WXML_COMPILER || 'D:/tool/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'
if (!fs.existsSync(compiler)) throw new Error('未找到微信 WXML 编译器，请设置 WXML_COMPILER 为已安装开发者工具中的 wcc.exe 路径')
const files = []
function walk(directory) { for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) { const name = path.join(directory, item.name); if (item.isDirectory()) walk(name); else if (name.endsWith('.wxml')) files.push(name) } }
walk('pages'); walk('components'); walk('custom-tab-bar')
const output = path.join(os.tmpdir(), `map-wxml-${process.pid}.js`)
try { execFileSync(compiler, [...files, '-o', output], { cwd: root, stdio: 'pipe' }); console.log(`${files.length} 个页面和组件的 WXML 原生编译通过`) }
catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1 }
finally { if (fs.existsSync(output)) fs.unlinkSync(output) }
