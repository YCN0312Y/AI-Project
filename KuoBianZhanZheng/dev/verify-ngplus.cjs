// 浏览器回归：node dev/verify-ngplus.cjs（需 playwright；预览服务默认 8124）。
// 验证通关全部关卡后，新一轮从第 1 关继承通关时的兵力与金币。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0
      localStorage.clear()
      localStorage.setItem('commanderSim.save.v1', JSON.stringify({ musicOn: false, sfxOn: false }))
    })
    await page.goto('http://localhost:8124/dev/index.html')
    await page.waitForFunction(() => !!globalThis.__commanderSim)
    const result = await page.evaluate(async () => {
      const { CFG, TROOP_TIERS } = await import('/js/config.js')
      const storage = await import('/js/storage.js')
      const g = globalThis.__commanderSim
      const check = (value, label) => { if (!value) throw new Error(label) }

      // 未通关：全新开局
      g.startRun()
      check(g.units.length === 1 && g.units[0].tier === 1, 'fresh start single squad')
      check(g.coins === 0 && g.merit === CFG.merit.start, 'fresh default resources')
      check(storage.loadClearance() === null, 'no clearance initially')

      // 通关第 50 关：记录快照
      g.units = []
      g.freeSlots = g.formation.map((_, i) => i).reverse()
      g.addUnit(10, true)
      g.addUnit(9, true)
      g.coins = 88.6
      g.setupLevel(50)
      g.state = 'playing'
      g.levelVictory()
      check(g.state === 'gameover' && g.victory, 'all cleared')
      const cl = storage.loadClearance()
      check(cl && cl.level === 50 && cl.army.length === 2, 'clearance saved')
      check(Math.abs(cl.coins - 88.6) < 1e-9, 'clearance coins')

      // 新一轮：继承
      g.startRun()
      check(g.ngPlus === true && g.units.length === 2, 'NG+ army inherited')
      check(g.units.some(u => u.tier === 10 && u.troops === TROOP_TIERS[9].troops), 'NG+ troops full')
      check(Math.abs(g.coins - 88.6) < 1e-9, 'NG+ coins inherited')
      check(g.merit === CFG.merit.start && g.level === 1 && g.score === 0, 'NG+ resets fresh stats')
      check(g.banner && g.banner.sub.includes('继承通关编队'), 'NG+ banner hint')
      check(storage.loadCampaign().level === 1, 'NG+ campaign checkpoint')
      // 指定关卡的启动不继承
      g.startRun({ level: 29, coins: 2000, merit: 200000 })
      check(g.units.length === 1 && g.coins === 2000 && g.ngPlus === false, 'explicit start no NG+')
      // 再通关一次覆盖快照
      g.units = []
      g.freeSlots = g.formation.map((_, i) => i).reverse()
      g.addUnit(10, true)
      g.coins = 150
      g.setupLevel(50)
      g.state = 'playing'
      g.levelVictory()
      check(Math.abs(storage.loadClearance().coins - 150) < 1e-9, 'clearance overwritten')
      g.startRun()
      // 继承的编队会替代初始免费班，数量与快照一致即可，重点是金币来自最新快照
      check(
        g.ngPlus === true && Math.abs(g.coins - 150) < 1e-9,
        'newest clearance kept'
      )
      check(g.units.every(u => u.tier === 10), 'newest army kept')
      return { ok: true }
    })
    assert.equal(result.ok, true)
    assert.deepEqual(errors, [], 'no page errors')
    // 主菜单 NG+ 提示
    await page.evaluate(() => { globalThis.__commanderSim.toMenu(); globalThis.__commanderSim.render() })
    const output = path.resolve(__dirname, '../docs/verification')
    fs.mkdirSync(output, { recursive: true })
    await page.screenshot({ path: path.join(output, 'ngplus-menu.png') })
    console.log('NG+ verify OK')
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
