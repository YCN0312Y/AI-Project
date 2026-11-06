// node dev/verify-mobile-perf.cjs; requires Playwright and dev/serve.js on port 8124.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const output = path.join(__dirname, 'perf-results')
fs.mkdirSync(output, { recursive: true })

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  try {
    for (const version of ['before', 'after']) {
      const snapshot = path.join(output, 'game-before.txt')
      if (version === 'before' && !fs.existsSync(snapshot)) continue
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
        isMobile: true, hasTouch: true,
      })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      if (version === 'before') {
        await page.route(/\/js\/game(?:\.js)?$/, route => route.fulfill({
          contentType: 'text/javascript', body: fs.readFileSync(snapshot, 'utf8'),
        }))
      }
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0
        localStorage.setItem('commanderSim.save.v1', JSON.stringify({ musicOn: false, sfxOn: false }))
        let seed = 42
        Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
      })
      await page.goto('http://localhost:8124/dev/index.html')
      await page.waitForFunction(() => !!window.__commanderSim, null, { polling: 50 })
      const timing = await page.evaluate(() => {
        const source = window.__commanderSim
        return [60, 90, 120, 144, 30].map(hz => {
          const g = Object.create(Object.getPrototypeOf(source))
          let now = 0, simulated = 0, measured = 0, frames = 0
          Object.assign(g, { last: 0, lastRender: 0, frameAcc: 0, time: 0,
            frameBudget: () => 1000 / 60, noteRefreshSample: () => {},
            nowMs: () => now, update: dt => { simulated += dt },
            trackPerf: () => {}, render: () => {},
            trackFps: dt => { measured += dt; frames++ } })
          for (let i = 1; i <= hz * 3; i++) { now = i * 1000 / hz; g.tick(now) }
          // 一次 200ms 卡顿后应立即恢复真实帧间隔，不持续追偿。
          now += 200; g.tick(now)
          let recovery = 0
          g.update = dt => { recovery = dt }
          now += 1000 / 60; g.tick(now)
          return { hz, simulated, measured, frames, recovery, backlog: g.frameAcc }
        })
      })
      if (version === 'after') {
        for (const t of timing) {
          assert(Math.abs(t.simulated - 3.05) < 0.035, JSON.stringify(t))
          assert(Math.abs(t.measured - 3.2166667) < 0.035, JSON.stringify(t))
          assert(Math.abs(t.recovery - 1 / 60) < 0.001, JSON.stringify(t))
          assert(t.backlog < 1000 / 60, JSON.stringify(t))
        }
      }
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      const render = await page.evaluate(() => {
        const g = window.__commanderSim
        g.startRun({ level: 50, coins: 2000, merit: 200000 })
        g.levelNotice = null; g.banner = null
        g.render()
        const ctx = g.ctx
        let texts = 0
        const proto = CanvasRenderingContext2D.prototype
        const original = proto.fillText
        proto.fillText = function (...args) { texts++; return original.apply(this, args) }
        const samples = []
        for (let i = 0; i < 120; i++) {
          const begin = performance.now()
          g.time += 1 / 60; g.render()
          samples.push(performance.now() - begin)
        }
        proto.fillText = original
        samples.sort((a, b) => a - b)
        return { textCallsPerFrame: texts / 120,
          medianMs: samples[60], p95Ms: samples[114], dpr: g.dpr,
          enemies: g.enemies.length, width: ctx.canvas.width }
      })
      if (version === 'after') {
        const checks = await page.evaluate(() => {
          const g = window.__commanderSim
          const check = (condition, label) => { if (!condition) throw new Error(label) }
          const draw = () => g.drawTroopPanel(g.ctx)
          let paints = 0
          const original = g.paintTroopPanel
          g.paintTroopPanel = function (ctx) { paints++; return original.call(this, ctx) }
          draw(); const initial = paints
          draw(); check(paints === initial, 'idle panel reused')
          for (const mutate of [
            () => { g.merit += 100 }, () => { g.coins += 0.5 },
            () => { g.panelMsg = { text: '验证提示', color: '#fff' } },
            () => { g.panelMsg = null }, () => { g.addUnit(2, true) },
            () => { g.cardFlash[0] = 0.5 }, () => { g.cardFlash.fill(0) },
            () => { g.weaponMode = 'mg'; g.weaponTimer = 10 },
            () => { g.weaponTimer = 9.9 }, () => { g.weaponMode = null },
          ]) {
            const previous = paints; mutate(); draw()
            check(paints > previous, 'changed panel repainted')
          }
          const layout = g.troopPanelLayout()
          check(g.troopPanelLayout() === layout, 'layout reused')
          g.safeBottom = 20
          check(g.troopPanelLayout() !== layout, 'safe area invalidates layout')
          g.safeBottom = 0
          g.dprCap = 1; g.applyRenderScale(3, g.bgCanvas); draw()
          check(g._panelLayer.width === g.canvas.width, 'resolution invalidates panel')
          // 对比缓存绘制和直接绘制，允许离屏透明混合造成的微小舍入差。
          g.shake = 0
          g.render()
          const cached = g.ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data
          g.drawTroopPanel = g.paintTroopPanel
          g.render()
          const direct = g.ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data
          let difference = 0
          for (let i = 0; i < direct.length; i++) difference += Math.abs(direct[i] - cached[i])
          const meanDifference = difference / direct.length
          check(meanDifference < 1, `panel image difference ${meanDifference}`)
          return { paints, meanDifference }
        })
        results.push({ checks })
        await page.screenshot({ path: path.join(output, 'mobile-level-50.png') })
      }
      assert.deepEqual(errors, [])
      results.push({ version, timing, render })
      await page.close()
    }
    // 生产外壳：确认启动、触屏开局和实际 rAF 运行，无测试入口。
    const page = await browser.newPage({ viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('http://localhost:8124/site/index.html')
    await page.waitForSelector('#boot', { state: 'detached' })
    assert.equal(await page.evaluate(() => typeof window.__commanderSim), 'undefined')
    await page.touchscreen.tap(195, 652)
    await page.waitForTimeout(1200)
    assert(await page.evaluate(() => !!localStorage.getItem('commanderSim:commanderSim.campaign.v1')),
      'touch starts a campaign in production')
    await page.screenshot({ path: path.join(output, 'production-mobile.png') })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify(results, null, 2))
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
