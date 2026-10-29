// 先启动 node dev/serve.js 8124，再执行 node dev/verify-enemy-weapons.cjs。
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('playwright')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0
      localStorage.setItem('commanderSim.save.v1', JSON.stringify({ musicOn: false, sfxOn: false }))
    })
    await page.goto('http://localhost:8124/dev/index.html')
    await page.waitForFunction(() => !!globalThis.__commanderSim)
    const result = await page.evaluate(async () => {
      const { Enemy } = await import('/js/enemy.js')
      const { Unit } = await import('/js/unit.js')
      const { CFG, TROOP_TIERS } = await import('/js/config.js')
      const g = globalThis.__commanderSim
      const check = (value, label) => { if (!value) throw new Error(label) }
      g.startRun()
      const boundaries = [[19, []], [20, ['mg']], [29, ['mg']], [30, ['grenade', 'mg']], [39, ['grenade', 'mg']], [40, ['mortar', 'grenade', 'mg']], [50, ['mortar', 'grenade', 'mg']]]
      for (const [level, modes] of boundaries) {
        g.setupLevel(level)
        const ranked = g.enemies.slice().sort((a, b) => b.troops - a.troops)
        check(ranked.filter(e => e.weapon !== 'rifle').length === modes.length, `weapon count level ${level}`)
        modes.forEach((mode, i) => check(ranked[i].weapon === mode, `ranking level ${level} ${mode}`))
      }
      // 持有者受伤或有更强增援时不抢装备；死亡才转交给最强空闲 Actor。
      g.setupLevel(40)
      const owner = g.enemies.find(e => e.weapon === 'mortar')
      const otherOwners = g.enemies.filter(e => ['grenade', 'mg'].includes(e.weapon))
      owner.troops = 1
      g.assignEnemyWeapons()
      check(owner.weapon === 'mortar', 'injured owner keeps weapon')
      const spare = new Enemy('grunt', 200, 200, 40, 10)
      g.enemies.push(spare)
      g.assignEnemyWeapons()
      check(spare.weapon === 'rifle', 'reinforcement does not steal weapon')
      g.damageEnemy(owner, 1, 0)
      check(owner.dead && spare.weapon === 'mortar', 'dead owner transfers mortar to strongest unarmed')
      check(otherOwners.every(e => e.weapon !== 'rifle'), 'other holders retained')
      for (const mode of ['grenade', 'mg']) {
        const holder = g.enemies.find(e => !e.dead && e.weapon === mode)
        const next = g.enemies.filter(e => !e.dead && e.weapon === 'rifle').sort((a, b) => b.troops - a.troops)[0]
        g.damageEnemy(holder, holder.troops, 0)
        check(next.weapon === mode, `${mode} transfers on death`)
      }
      // 敌人不足时不会给同一个 Actor 叠武器；增援到场再补齐。
      g.enemies = []
      for (const tier of [10, 9, 8]) {
        const dep = { reserve: 1, tier, doorX: 200, doorY: 200, nx: 1, ny: 0 }
        g.spawnDepartmentEnemy(dep, false)
      }
      check(g.enemies.map(e => e.weapon).join(',') === 'mortar,grenade,mg', 'reinforcements fill vacancies')
      g.updateWeaponMode(20)
      check(g.enemies.every(e => e.weapon !== 'rifle'), 'enemy weapons persist beyond player duration')

      const makePlayer = (x, y, slot = 0) => new Unit(10, slot, { x: 0, y: 0 }, x, y, 10000000)
      const resetCombat = () => {
        g.covers = []; g.bushes = []; g.arrows = []; g.grenades = []
        g.baseActivated = true
        g.units = [makePlayer(300, 300), makePlayer(330, 300, 1)]
        const enemy = new Enemy('grunt', 300, 200, 40, 9)
        enemy.cool = 0
        g.enemies = [enemy]
        return enemy
      }
      let enemy = resetCombat()
      enemy.weapon = 'mg'
      enemy.update(0, g)
      check(g.units.every(u => u.troops === 10000000 - 6561), 'enemy MG damages each target once')
      check(enemy.cool === 0.2 && enemy.troops === 78732, 'MG cooldown and no friendly fire')
      const tracer = g.arrows[0]
      check(tracer.hostile && tracer.damage === 0, 'hostile visual tracer')
      tracer.x = g.units[0].x; tracer.y = g.units[0].y
      tracer.update(0, g)
      check(g.units[0].troops === 10000000 - 6561, 'tracer does not double damage')
      const before = g.units.map(u => u.troops)
      g.units[0].hidden = true
      g.covers = [{ shape: 'rect', x: 315, y: 250, w: 60, h: 10 }]
      g.enemyFireMG(enemy)
      check(g.units.every((u, i) => u.troops === before[i]), 'MG respects stealth and walls')
      for (const [mode, multiplier, interval, radius] of [['grenade', 2, 0.5, 65], ['mortar', 3, 1, 100]]) {
        enemy = resetCombat()
        enemy.weapon = mode
        const ally = new Enemy('grunt', 300, 300, 40, 10)
        g.enemies.push(ally)
        g.units.push(makePlayer(300 + radius + 22, 300, 2))
        enemy.update(0, g)
        check(g.grenades.length === 1 && g.grenades[0].hostile, `${mode} enemy firing path`)
        const shell = g.grenades[0]
        check(shell.damage === 6561 * multiplier && shell.radius === radius && enemy.cool === interval, `${mode} damage/radius/cooldown`)
        g.explodeGrenade(shell)
        check(g.units.slice(0, 2).every(u => u.troops === 10000000 - 6561 * multiplier), `${mode} splash hits players`)
        check(g.units[2].troops === 10000000 && ally.troops === 236196, `${mode} outside radius and friendly fire`)
        enemy.update(interval - 0.01, g)
        check(g.grenades.length === 1, `${mode} does not fire early`)
        enemy.update(0.02, g)
        check(g.grenades.length === 2, `${mode} fires after interval`)
      }
      // 普通步枪和玩家武器仍使用原路径；敌方被击杀当帧不可继续攻击。
      enemy = resetCombat()
      enemy.update(0, g)
      check(g.arrows.length === 1 && g.arrows[0].damage === TROOP_TIERS[8].damage, 'enemy rifle unchanged')
      enemy.dead = true; enemy.cool = 0
      enemy.update(1, g)
      check(g.arrows.length === 1, 'dead enemy cannot shoot')
      g.startRun()
      g.setupLevel(40)
      g.banner = null
      g.render()
      return { checkedLevels: boundaries.map(b => b[0]), weapons: ['mg', 'grenade', 'mortar'], transfer: 'passed', damageAndCadence: 'passed' }
    })
    const output = path.resolve(__dirname, '../docs/verification')
    fs.mkdirSync(output, { recursive: true })
    await page.screenshot({ path: path.join(output, 'enemy-weapons-level-40.png') })
    assert.deepEqual(errors, [])
    console.log('PASS enemy weapons', result)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
