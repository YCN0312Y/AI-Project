// 生成独立上传目录；源码中的本地测试入口保留。
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist/CommanderSim-release')
fs.mkdirSync(output, { recursive: true })
for (const dir of ['js', 'assets']) {
  fs.cpSync(path.join(root, dir), path.join(output, dir), { recursive: true })
}
fs.copyFileSync(path.join(root, 'game.json'), path.join(output, 'game.json'))
// 保留已配置的小游戏 AppID 和开发者工具编译设置，不复制个人工具缓存。
fs.copyFileSync(path.join(root, 'dist/CommanderSim/project.config.json'), path.join(output, 'project.config.json'))
fs.writeFileSync(path.join(output, 'game.js'), "import { Game } from './js/game'\n\nnew Game()\n")

let game = fs.readFileSync(path.join(output, 'js/game.js'), 'utf8').replace(/\r\n/g, '\n')
function replaceOnce(before, after) {
  if (!game.includes(before) || game.indexOf(before) !== game.lastIndexOf(before)) {
    throw new Error('上传版入口结构已变更，请检查：' + before)
  }
  game = game.replace(before, after)
}
replaceOnce("  startTestRun() {\n    this.startRun({ level: 29, coins: 2000, merit: 200000 })\n  }\n\n", '')
replaceOnce('  startRun(options = {}) {', '  startRun() {')
replaceOnce('this.merit = options.merit === undefined ? CFG.merit.start : options.merit', 'this.merit = CFG.merit.start')
replaceOnce('this.coins = options.coins === undefined ? 0 : options.coins', 'this.coins = 0')
replaceOnce('this.level = options.level === undefined ? 1 : options.level', 'this.level = 1')
replaceOnce("      if (pointsInRect(x, y, L.test, 5)) {\n        this.startTestRun()\n        return\n      }\n", '')
replaceOnce('    const testY = settingsY - step\n    const continueY = testY - step\n    const startY = testY - step * (hasResume ? 2 : 1)',
  '    const continueY = settingsY - step\n    const startY = settingsY - step * (hasResume ? 2 : 1)')
replaceOnce('      // 新的开始 → 继续游戏（如有）→ 测试关卡 → 设置 → 关于', '      // 新的开始 → 继续游戏（如有）→ 设置 → 关于')
replaceOnce('      test: { x: (this.W - bw) / 2, y: testY, w: bw, h: bh },\n', '')
replaceOnce("    this.drawButton(ctx, L.test, '测试关卡 · 第29关', false)\n", '')
if (/startTestRun|L\.test\b|testY|测试关卡|options\.(level|coins|merit)/.test(game)) throw new Error('上传版仍包含测试入口')
fs.writeFileSync(path.join(output, 'js/game.js'), game)
fs.writeFileSync(path.join(output, 'README.md'), `# 扩编战争 · 上传版

在微信开发者工具中以「小游戏」导入本目录，编译、预览后点击上传。
项目已保留现有小游戏 AppID，项目根目录包含 game.js、game.json、project.config.json。

主菜单包含新的开始、继续游戏（有存档时）、设置、关于。
新的开始从第 1 关进入，初始 300 军功、0 金币和一个班。
保留 50 关、10 级编制、军功兑换、机枪/手雷/迫击炮以及敌方特殊武器和死亡转交功能。
不包含本地测试关卡入口、调试全局对象、浏览器预览壳、测试脚本或个人开发者工具配置。

存档使用原有键名，继续游戏会读取设备上已有的战役进度。
`)
console.log('Release directory:', output)
