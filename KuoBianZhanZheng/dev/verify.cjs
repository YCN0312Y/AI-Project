// 浏览器回归：node dev/verify.cjs（需 playwright；预览服务默认 8124）。
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('playwright')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0 // 手动推进，避免战斗干扰断言。
      localStorage.setItem('commanderSim.save.v1', JSON.stringify({ musicOn: false, sfxOn: false }))
    })
    await page.goto('http://localhost:8124/dev/index.html')
    await page.waitForFunction(() => !!globalThis.__commanderSim)
    const result = await page.evaluate(async () => {
      const { CFG, LEVELS, TROOP_TIERS } = await import('/js/config.js')
      const storage = await import('/js/storage.js')
      const { Enemy } = await import('/js/enemy.js')
      const g = globalThis.__commanderSim
      const check = (value, label) => { if (!value) throw new Error(label) }
      check(LEVELS.length === 50 && TROOP_TIERS.length === 10, '50 levels / 10 tiers')
      for (let n = 1; n <= 50; n++) {
        check(LEVELS[n - 1].counts.every((v, t) => v === Math.max(0, n - t * 2)), `level ${n}`)
      }
      const expected = [[78732, 6561], [236196, 19683]]
      expected.forEach(([cost, damage], i) => {
        const t = TROOP_TIERS[i + 8]
        check(t.cost === cost && t.troops === cost && t.damage === damage, `tier ${i + 9}`)
      })
      g.startRun()
      check(g.cardFlash.length === 10, 'flash array')
      const tap = rect => g.onTouchStart({ touches: [{ identifier: 1, clientX: rect.x + rect.w / 2, clientY: rect.y + rect.h / 2 }] })
      for (let i = 0; i < CFG.coins.exchanges.length; i++) {
        const offer = CFG.coins.exchanges[i]
        g.coins = offer.coins - 0.01
        g.merit = 0
        tap(g.troopPanelLayout().exchanges[i])
        check(g.merit === 0 && g.coins === offer.coins - 0.01, `insufficient exchange ${i}`)
        g.coins = offer.coins + 0.25
        tap(g.troopPanelLayout().exchanges[i])
        check(g.merit === offer.merit && g.coins === 0.25, `exchange ${i}`)
        check(storage.loadCampaign().merit === offer.merit, `exchange saved ${i}`)
      }
      for (let i = 8; i < 10; i++) {
        g.merit = TROOP_TIERS[i].cost
        tap(g.troopPanelLayout().cards[i])
        check(g.merit === 0 && g.units.some(u => u.tier === i + 1), `recruit ${i + 1}`)
        const unit = g.units.find(u => u.tier === i + 1)
        g.covers = []
        g.bushes = []
        const enemy = new Enemy('grunt', unit.x, unit.y - 30, 1, 10)
        g.enemies = [enemy]
        check(g.volley(unit) && enemy.troops === 236196 - expected[i - 8][1], `actual damage ${i + 1}`)
      }
      for (let tier = 8; tier <= 10; tier++) {
        g.units = []
        g.freeSlots = g.formation.map((_, i) => i).reverse()
        for (let i = 0; i < 3; i++) g.addUnit(tier, true)
        g.tryMergePlayer()
        check(tier === 10 ? g.units.length === 3 : g.units.length === 1 && g.units[0].tier === tier + 1, `merge ${tier}`)
      }
      check(TROOP_TIERS[8].name === '军团' && TROOP_TIERS[9].name === '方面军', 'renamed tiers')
      g.covers = []
      g.bushes = []
      g.baseActivated = true
      for (let tier = 1; tier <= 10; tier++) {
        g.units = []
        g.freeSlots = g.formation.map((_, i) => i).reverse()
        g.addUnit(tier, true)
        const unit = g.units[0]
        unit.x = 300; unit.y = 300
        for (const mode of ['mg', 'grenade', 'mortar']) {
          const enemies = [0, 20].map(dx => new Enemy('grunt', 300 + dx, 270, 1, 10))
          g.enemies = enemies
          if (mode === 'mg') check(g.fireMG(unit), 'machine gun fires')
          else {
            g.grenades = []
            unit.weapon = mode; unit.cool = 0
            g.target = { x: unit.x - unit.ox, y: unit.y - unit.oy }
            unit.update(0, g)
            check(g.grenades.length === 1 && g.grenades[0].kind === mode, mode + ' unit firing path')
            check(unit.cool === CFG.weapons[mode].interval, mode + ' cooldown')
            g.explodeGrenade(g.grenades[0])
          }
          const multiplier = mode === 'mg' ? 1 : mode === 'grenade' ? 2 : 3
          check(enemies.every(e => e.troops === 236196 - TROOP_TIERS[tier - 1].damage * multiplier), mode + ' area damage tier ' + tier)
        }
      }
      g.startRun()
      g.coins = CFG.weapons.mortar.cost - 0.01
      tap(g.troopPanelLayout().weaponRow.mortar)
      check(g.weaponMode === null, 'insufficient mortar funds')
      g.coins = 50
      tap(g.troopPanelLayout().weaponRow.mortar)
      check(g.weaponMode === 'mortar' && g.weaponUnit.weapon === 'mortar' && g.coins === 50 - CFG.weapons.mortar.cost, 'mortar button purchase')
      const paid = g.coins
      tap(g.troopPanelLayout().weaponRow.mortar)
      check(g.coins === paid, 'active mortar no duplicate charge')
      g.updateWeaponMode(CFG.weapons.duration + 0.1)
      check(g.weaponMode === null && g.units[0].weapon === 'rifle', 'mortar expires')
      g.units = []
      g.freeSlots = g.formation.map((_, i) => i).reverse()
      for (let i = 0; i < 3; i++) g.addUnit(10, true)
      g.setupLevel(50)
      g.saveCampaign()
      check(storage.loadCampaign().level === 50 && storage.loadCampaign().army.every(u => u.tier === 10), 'late campaign restore')
      storage.writeCheckpoint(storage.loadCampaign())
      check(storage.loadCheckpoint().level === 50 && storage.loadCheckpoint().army.length === 3, 'late checkpoint restore')
      g.checkpoint = null
      g.units = []
      g.retryLevel()
      check(g.level === 50 && g.units.length === 3 && g.units.every(u => u.tier === 10), 'retry restores tier 10 army')
      const old = { ...storage.loadCampaign(), level: 30, army: [{ tier: 8, troops: 10000, troopsMax: 26244, slot: 0 }] }
      storage.writeCampaign(old)
      check(storage.loadCampaign().level === 30 && storage.loadCampaign().army[0].troops === 10000, 'v1 save compatible')
      storage.writeCampaign({ ...old, army: [{ tier: 11, troops: 708588, troopsMax: 708588, slot: 0 }] })
      const migrated = storage.loadCampaign().army[0]
      check(migrated.tier === 10 && migrated.troops === 236196 && migrated.troopsMax === 236196, 'removed tier save migration')
      g.setupLevel(30)
      g.victory = true
      g.nextLevel()
      check(g.level === 31, '30 to 31 transition')
      g.setupLevel(49)
      g.victory = true
      g.nextLevel()
      check(g.level === 50, '49 to 50 transition')
      g.victory = true
      g.nextLevel()
      check(g.level === 50, '50 is final')
      g.startRun()
      g.merit = 1500000
      g.coins = 166.25
      g.render()
      return { levels: LEVELS.length, tiers: TROOP_TIERS.length, lastCounts: LEVELS[49].counts }
    })
    const output = path.resolve(__dirname, '../docs/verification')
    fs.mkdirSync(output, { recursive: true })
    for (const [width, height] of [[1280, 900], [375, 667], [320, 568]]) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(100) // 等待浏览器 resize 事件完成，避免截图前清空画布。
      const layout = await page.evaluate(() => {
        const g = globalThis.__commanderSim
        g.resize()
        const l = g.troopPanelLayout()
        const rects = [...l.cards, ...l.exchanges, l.weaponRow.mg, l.weaponRow.mortar, l.weaponRow.grenade]
        const inside = rects.every(r => r.w > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= g.W && r.y + r.h <= g.H)
        const overlaps = rects.some((a, i) => rects.slice(i + 1).some(b => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h))
        let minRoomH = Infinity
        for (let n = 0; n < 10; n++) {
          g.setupLevel(50)
          minRoomH = Math.min(minRoomH, ...g.departments.map(d => d.h))
        }
        g.setupLevel(1)
        g.banner = null
        g.render()
        return { inside, overlaps, minRoomH, rightOfGrenade: l.cards[8].x > l.weaponRow.grenade.x, exchangeAbove: l.exchanges[0].y < l.cards[0].y, mortarRight: l.weaponRow.grenade.x + l.weaponRow.grenade.w < l.weaponRow.mortar.x }
      })
      assert(layout.inside && !layout.overlaps && layout.rightOfGrenade && layout.exchangeAbove && layout.mortarRight, JSON.stringify(layout))
      assert(layout.minRoomH >= 30, `rooms too short: ${JSON.stringify(layout)}`)
      console.log(`${width}x${height}`, layout)
      await page.screenshot({ path: path.join(output, `layout-${width}.png`) })
      await page.evaluate(() => {
        const g = globalThis.__commanderSim
        g.setupLevel(50)
        g.banner = null
        g.render()
      })
      await page.screenshot({ path: path.join(output, `level-50-${width}.png`) })
    }
    const click = await page.evaluate(() => {
      const g = globalThis.__commanderSim
      g.coins = 100
      g.merit = 0
      const r = g.troopPanelLayout().exchanges[4]
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    })
    await page.mouse.click(click.x, click.y)
    assert.equal(await page.evaluate(() => globalThis.__commanderSim.merit), 12000)
    for (const [width, height] of [[1280, 900], [375, 667], [320, 568]]) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(100)
      await page.evaluate(() => {
        const g = globalThis.__commanderSim
        g.toMenu()
        g.resize()
        const l = g.menuLayout()
        const rects = [l.start, l.continue, l.test, l.settings, l.about].filter(Boolean)
        if (rects.some(r => r.y < 0 || r.y + r.h > g.H)) throw new Error('menu outside screen')
        if (rects.some((a, i) => rects.slice(i + 1).some(b => a.y < b.y + b.h && b.y < a.y + a.h))) throw new Error('menu overlaps')
        g.render()
      })
      await page.screenshot({ path: path.join(output, `test-menu-${width}.png`) })
    }
    const testButton = await page.evaluate(() => {
      const r = globalThis.__commanderSim.menuLayout().test
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    })
    await page.mouse.click(testButton.x, testButton.y)
    const testStart = await page.evaluate(async () => {
      const g = globalThis.__commanderSim
      const { loadCampaign, loadCheckpoint } = await import('/js/storage.js')
      const check = (value, label) => { if (!value) throw new Error(label) }
      check(g.state === 'playing' && g.level === 29 && g.coins === 2000 && g.merit === 200000, 'test button starts correct state')
      check(g.units.length === 1 && g.units[0].troops === 12, 'test starter army')
      check(loadCampaign().level === 29 && loadCampaign().coins === 2000 && loadCheckpoint().merit === 200000, 'test saves initialized resources')
      check(g.enemies.filter(e => e.weapon === 'mg').length === 1, 'level 29 enemy weapon')
      g.coins = 0; g.merit = 0; g.units = []
      g.retryLevel()
      check(g.level === 29 && g.coins === 2000 && g.merit === 200000 && g.units.length === 1, 'test retry restores resources')
      g.victory = true
      g.nextLevel()
      check(g.level === 30 && g.enemies.some(e => e.weapon === 'grenade'), 'test progresses into level 30')
      g.startRun()
      check(g.level === 1 && g.coins === 0 && g.merit === 300, 'normal new game unchanged')
      g.startTestRun()
      g.banner = null
      g.render()
      return { level: g.level, coins: g.coins, merit: g.merit }
    })
    await page.screenshot({ path: path.join(output, 'test-level-29.png') })
    console.log('PASS test menu', testStart)
    assert.deepEqual(errors, [])
    console.log('PASS', result)
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
