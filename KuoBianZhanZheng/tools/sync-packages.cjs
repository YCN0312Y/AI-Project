// 把根目录源码同步到 Package 下的两个包：
//   KuoBianZhanZheng-Development  开发用完整包（含测试入口、调试对象）
//   KuoBianZhanZheng-WeChat-Game  上传包（去除测试入口；沿用各自 project.config.json）
// node tools/sync-packages.cjs
const fs = require('node:fs')
const path = require('node:path')
const { releaseGameSource, readmeText } = require(path.join(__dirname, 'release-transforms.cjs'))

const root = path.resolve(__dirname, '..')
const pkgs = path.join(root, 'Package')
const devDir = path.join(pkgs, 'KuoBianZhanZheng-Development')
const relDir = path.join(pkgs, 'KuoBianZhanZheng-WeChat-Game')

// 各包自带的私有文件不同步，避免抹掉 AppID / 编译缓存等配置
const keepFiles = new Set(['project.config.json', 'project.private.config.json'])

function syncPackage(dir, { release }) {
  fs.mkdirSync(dir, { recursive: true })
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isFile() && keepFiles.has(item.name)) continue
    if (item.isFile()) {
      fs.rmSync(path.join(dir, item.name))
    } else if (item.isDirectory() && item.name !== '.claude') {
      fs.rmSync(path.join(dir, item.name), { recursive: true, force: true })
    }
  }
  for (const item of ['js', 'assets']) {
    fs.cpSync(path.join(root, item), path.join(dir, item), { recursive: true })
  }
  for (const f of ['README.md', 'game.json']) {
    fs.copyFileSync(path.join(root, f), path.join(dir, f))
  }
  // 入口：开发包保留调试全局对象；上传包只留 new Game()
  fs.writeFileSync(
    path.join(dir, 'game.js'),
    release
      ? "import { Game } from './js/game'\n\nnew Game()\n"
      : "import { Game } from './js/game'\n\nconst game = new Game()\n\n" +
        '// 方便调试：在开发者工具的 Console 里可以访问全局对象\n' +
        'if (typeof globalThis !== \'undefined\') {\n  globalThis.__commanderSim = game\n}\n'
  )
  if (release) {
    fs.writeFileSync(path.join(dir, 'js/game.js'), releaseGameSource(path.join(root, 'js/game.js')))
    fs.writeFileSync(path.join(dir, 'README.md'), readmeText())
  }
  console.log('synced', path.relative(root, dir), release ? '(release)' : '(dev)')
}

syncPackage(devDir, { release: false })
syncPackage(relDir, { release: true })
