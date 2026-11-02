// 发布版游戏代码的统一切换清单：dev 源码 → 上传版 js/game.js
// package-release.cjs（dist 输出）与 sync-packages.cjs（Package 目录）共用。
const fs = require('node:fs')
const path = require('node:path')

// 上传版 README 模板
function readmeText() {
  return `# 扩编战争 · 上传版

在微信开发者工具中以「小游戏」导入本目录，编译、预览后点击上传。
项目已保留现有小游戏 AppID，项目根目录包含 game.js、game.json、project.config.json。

主菜单包含新的开始、继续游戏（有存档时）、设置、关于。
新的开始从第 1 关进入，初始 300 军功、0 金币和一个班；
已通关的玩家会继承通关时的兵力与金币，直接从带编队的第 1 关重新开始。
保留 50 关、10 级编制、军功兑换、机枪/手雷/迫击炮以及敌方特殊武器和死亡转交功能。
战败结算会显示本关损失、击杀、金币、最高编制，并给出一句可执行的改进建议；胜利结算保持原布局。
不包含本地测试关卡入口、调试全局对象、浏览器预览壳、测试脚本或个人开发者工具配置。

存档使用原有键名，继续游戏会读取设备上已有的战役进度。
`
}

// 按顺序执行的一次性文本替换；before 必须在文件中恰好出现一次
const transforms = [
  ["  startTestRun() {\n    this.startRun({ level: 29, coins: 2000, merit: 200000 })\n  }\n\n", ''],
  ['  startRun(options = {}) {', '  startRun() {'],
  ['this.merit = options.merit === undefined ? CFG.merit.start : options.merit', 'this.merit = CFG.merit.start'],
  ['this.coins = options.coins === undefined ? 0 : options.coins', 'this.coins = 0'],
  ['this.level = options.level === undefined ? 1 : options.level', 'this.level = 1'],
  ['    // 通关后新一轮继承：仅在使用默认金币且从第 1 关开始时生效\n    this.inheritNgPlus(\n      options.coins === undefined,\n      options.level === undefined || options.level === 1\n    )\n',
    '    // 通关后新一轮继承：默认金币 + 从第 1 关开始时生效\n    this.inheritNgPlus(true, true)\n'],
  ["      if (pointsInRect(x, y, L.test, 5)) {\n        this.startTestRun()\n        return\n      }\n", ''],
  ['    const testY = settingsY - step\n    const continueY = testY - step\n    const startY = testY - step * (hasResume ? 2 : 1)',
    '    const continueY = settingsY - step\n    const startY = settingsY - step * (hasResume ? 2 : 1)'],
  ['      // 新的开始 → 继续游戏（如有）→ 测试关卡 → 设置 → 关于', '      // 新的开始 → 继续游戏（如有）→ 设置 → 关于'],
  ['      test: { x: (this.W - bw) / 2, y: testY, w: bw, h: bh },\n', ''],
  ["    this.drawButton(ctx, L.test, '测试关卡 · 第29关', false)\n", ''],
]

// 上传版中不允许再出现的调试痕迹
function assertClean(game) {
  if (/startTestRun|L\.test\b|testY|测试关卡|options\.(level|coins|merit)/.test(game)) {
    throw new Error('上传版仍包含测试入口或调试参数')
  }
}

// 从 dev 源码生成上传版 game.js 内容
function releaseGameSource(sourceFile) {
  let game = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n')
  for (const [before, after] of transforms) {
    if (!game.includes(before) || game.indexOf(before) !== game.lastIndexOf(before)) {
      throw new Error('上传版入口结构已变更，请检查：' + before)
    }
    game = game.replace(before, after)
  }
  assertClean(game)
  return game
}

module.exports = { releaseGameSource, readmeText }
