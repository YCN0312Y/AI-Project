// 生成独立上传目录；源码中的本地测试入口保留。
const fs = require('node:fs')
const path = require('node:path')
const { releaseGameSource, readmeText } = require('./release-transforms')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist/CommanderSim-release')
fs.mkdirSync(output, { recursive: true })
for (const dir of ['js', 'assets']) {
  fs.cpSync(path.join(root, dir), path.join(output, dir), { recursive: true })
}
fs.copyFileSync(path.join(root, 'game.json'), path.join(output, 'game.json'))
// 保留已配置的小游戏 AppID 和开发者工具编译设置，不复制个人工具缓存。
fs.copyFileSync(
  path.join(root, 'dist/CommanderSim/project.config.json'),
  path.join(output, 'project.config.json')
)
fs.writeFileSync(path.join(output, 'game.js'), "import { Game } from './js/game'\n\nnew Game()\n")
fs.writeFileSync(path.join(output, 'js/game.js'), releaseGameSource(path.join(output, 'js/game.js')))
fs.writeFileSync(path.join(output, 'README.md'), readmeText())
console.log('Release directory:', output)
