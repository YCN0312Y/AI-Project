const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const release = path.join(root, 'dist/CommanderSim-release')
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}canvas{position:fixed;inset:0;width:100%;height:100%}</style>
<script src="/dev/wx-shim.js"></script><script type="module">
import { Game } from '/js/game';
// 仅此验证页面捕获实例；发行包不会写入调试对象。
const original = Game.prototype.bindInput;
Game.prototype.bindInput = function () { window.qaGame = this; original.call(this) };
await import('/game.js');
</script>`
async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0
      localStorage.setItem('commanderSim.save.v1', JSON.stringify({ musicOn: false, sfxOn: false }))
    })
    await page.route('http://release.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
      let file = url.pathname === '/dev/wx-shim.js' ? path.join(root, 'dev/wx-shim.js') : path.join(release, url.pathname)
      if (!path.extname(file)) file += '.js'
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'missing' })
      const type = { '.js': 'text/javascript', '.png': 'image/png', '.wav': 'audio/wav' }[path.extname(file)] || 'application/octet-stream'
      return route.fulfill({ contentType: type, body: fs.readFileSync(file) })
    })
    await page.goto('http://release.test/')
    await page.waitForFunction(() => !!window.qaGame, null, { polling: 100, timeout: 10000 })
    const menu = await page.evaluate(() => {
      const g = window.qaGame
      if (g.startTestRun !== undefined || g.menuLayout().test !== undefined || window.__commanderSim !== undefined) throw new Error('test entry remains')
      g.render()
      return g.menuLayout()
    })
    const output = path.join(root, 'docs/verification')
    fs.mkdirSync(output, { recursive: true })
    await page.screenshot({ path: path.join(output, 'release-menu.png') })
    await page.mouse.click(menu.start.x + menu.start.w / 2, menu.start.y + menu.start.h / 2)
    const result = await page.evaluate(() => {
      const g = window.qaGame
      const initial = { state: g.state, level: g.level, coins: g.coins, merit: g.merit, troops: g.totalTroops() }
      if (g.state !== 'playing' || g.level !== 1 || g.coins !== 0 || g.merit !== 300 || g.totalTroops() !== 12) throw new Error('incorrect normal start')
      g.setupLevel(40)
      if (g.enemies.filter(e => e.weapon !== 'rifle').length !== 3) throw new Error('enemy weapons missing')
      g.saveCampaign()
      g.toMenu()
      const l = g.menuLayout()
      if (!l.continue || l.test) throw new Error('continue menu incorrect')
      g.continueRun()
      if (g.level !== 40) throw new Error('continue failed')
      return initial
    })
    assert.deepEqual(errors, [])
    console.log('PASS release', result)
  } finally { await browser.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
