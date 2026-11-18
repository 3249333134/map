const { spawnSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const venv = path.join(root, 'server', '.venv')
const python = process.platform === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe')
  : path.join(venv, 'bin', 'python')
const command = process.argv[2] || 'serve'

function runSetup() {
  const basePython = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const created = spawnSync(basePython, ['-m', 'venv', '--without-pip', venv], { cwd: root, stdio: 'inherit' })
  if (created.error || created.status !== 0) {
    console.error('创建头像服务环境失败。请安装 Python 3.10 或更新版本后重试。')
    process.exit(created.status ?? 1)
  }
  const installed = spawnSync(basePython, ['-m', 'pip', '--python', python, 'install', '-r', 'server/requirements-avatar.txt'], { cwd: root, stdio: 'inherit' })
  if (installed.error || installed.status !== 0) {
    console.error('安装头像服务图像处理依赖失败，请检查网络后重新运行 npm run avatar-setup。')
    process.exit(installed.status ?? 1)
  }
  console.log('头像服务环境已准备。运行 npm run avatar-server 启动。')
}

if (command === 'setup') {
  runSetup()
} else if (command === 'serve') {
  if (!fs.existsSync(python)) {
    console.error('头像服务环境尚未准备。请先运行 npm run avatar-setup。')
    process.exit(1)
  }
  const child = spawn(python, ['server/generate_server.py', '--port', '8765'], { cwd: root, stdio: 'inherit' })
  child.on('error', error => { console.error(`启动头像服务失败：${error.message}`); process.exitCode = 1 })
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code || 0) })
} else {
  console.error('未知命令。使用 setup 或 serve。')
  process.exit(2)
}
