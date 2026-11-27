// 通过 CDP 驱动无头 Chrome，测量《扩编战争》网页版的帧率与 CPU 热点。
// 用法：MODE=test THROTTLE=4 node cdp-perf.cjs <url> [seconds]
const fs = require('fs')
const path = require('path')

const URL_TO_OPEN = process.argv[2] || 'http://localhost:8124/dev/index.html'
const SAMPLE_SECONDS = Number(process.argv[3] || 6)
const MODE = process.env.MODE || 'start'
const THROTTLE = Number(process.env.THROTTLE || 0)

const VW = 390
const VH = 844

function httpJson(url) {
  return new Promise((resolve, reject) => {
    require('http')
      .get(url, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await httpJson('http://127.0.0.1:9222/json/list')
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('没有找到可调试页面')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let seq = 0

  const errors = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push((d.exception && d.exception.description) || d.text)
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })

  await new Promise((r, j) => {
    ws.addEventListener('open', r)
    ws.addEventListener('error', j)
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description
      throw new Error('evaluate failed: ' + (d || JSON.stringify(r.exceptionDetails)))
    }
    return r.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Profiler.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: VW,
    height: VH,
    deviceScaleFactor: 3,
    mobile: true,
  })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  if (THROTTLE > 0) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })

  await send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(2500)
  await evaluate('localStorage.clear(); true')
  await send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(3500)

  const boot = await evaluate(
    '({ canvas: !!document.querySelector("canvas"), w: document.querySelector("canvas") && document.querySelector("canvas").width, h: document.querySelector("canvas") && document.querySelector("canvas").height })'
  )
  console.log('页面状态:', JSON.stringify(boot), '| 模式:', MODE, '| CPU 降速:', THROTTLE || 1, 'x')

  // 统一用真实触摸事件驱动，新旧版本都能工作
  async function tap(x, y) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    })
    await sleep(45)
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(60)
  }

  async function drag(x1, y1, x2, y2, steps) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x1, y: y1, id: 1 }],
    })
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      await send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, id: 1 }],
      })
      await sleep(20)
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  await evaluate(`(() => {
    window.__frames = [];
    window.__frameLoop = function (t) {
      window.__frames.push(t);
      if (window.__frames.length < 60000) requestAnimationFrame(window.__frameLoop);
    };
    requestAnimationFrame(window.__frameLoop);
    return true;
  })()`)

  // 菜单布局：新的开始 / 测试关卡
  const bh = VH < 720 ? 44 : 56
  const step = bh + 12
  const aboutY = VH - 28 - bh
  const settingsY = aboutY - step
  const testY = settingsY - step
  const startY = testY - step
  const centerY = (MODE === 'test' ? testY : MODE === 'settings' ? settingsY : startY) + bh / 2
  await tap(VW / 2, centerY)
  await sleep(2600)

  if (MODE === 'test') {
    // 撑满 20 个编制槽位：2 个军团 + 18 个班，制造接近后期的战场密度
    const cardRowY = VH - 8 - (16 + 36 + 6 + 36 + 6 + 50 + 44 + 20) + 8 + 36 + 6 + 36 + 6 + 22
    const bottomRowY = cardRowY + 50
    const cardX = (i) => 16 + i * (41.25 + 4) + 20.625
    const bottomX = (i) => 16 + i * (68.4 + 4) + 34.2
    for (let i = 0; i < 2; i++) await tap(bottomX(3), bottomRowY)
    for (let i = 0; i < 18; i++) await tap(cardX(0), cardRowY)
    await sleep(1200)
  }

  if (process.env.COUNT === '1') {
    await evaluate(`(() => {
      window.__calls = {};
      const list = ['fill','stroke','fillRect','strokeRect','drawImage','fillText','beginPath','arc','arcTo','clip','save','restore','setTransform','measureText','clearRect','quadraticCurveTo','createLinearGradient','createRadialGradient'];
      for (const m of list) {
        const orig = CanvasRenderingContext2D.prototype[m];
        if (!orig || orig.__wrapped) continue;
        const wrapped = function (...a) { window.__calls[m] = (window.__calls[m] || 0) + 1; return orig.apply(this, a) };
        wrapped.__wrapped = true;
        CanvasRenderingContext2D.prototype[m] = wrapped;
      }
      return true;
    })()`)
  }

  await evaluate('window.__frames.length = 0')
  await send('Profiler.setSamplingInterval', { interval: 150 })
  await send('Profiler.start')
  await drag(195, 620, 260, 300, 20)
  await sleep(SAMPLE_SECONDS * 500)
  await drag(260, 300, 150, 520, 16)
  await sleep(SAMPLE_SECONDS * 500)
  const prof = await send('Profiler.stop')

  const frames = await evaluate('window.__frames.slice()')
  const gaps = []
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1])
  gaps.sort((a, b) => a - b)
  const avg = gaps.reduce((s, v) => s + v, 0) / (gaps.length || 1)
  const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] || 0
  console.log(
    `\n帧间隔：${gaps.length} 帧 | 平均 ${avg.toFixed(1)}ms (${(1000 / avg).toFixed(1)} fps)` +
      ` | p50 ${pct(0.5).toFixed(1)} | p90 ${pct(0.9).toFixed(1)} | p99 ${pct(0.99).toFixed(1)}` +
      ` | 最长 ${(gaps[gaps.length - 1] || 0).toFixed(1)}ms`
  )
  const over = gaps.filter((g) => g > 20).length
  const over34 = gaps.filter((g) => g > 34).length
  console.log(
    `>20ms: ${over}/${gaps.length} (${((over / (gaps.length || 1)) * 100).toFixed(1)}%)` +
      `  >34ms(掉帧): ${over34} (${((over34 / (gaps.length || 1)) * 100).toFixed(1)}%)`
  )

  const p = prof.profile
  const byId = new Map()
  p.nodes.forEach((n) => byId.set(n.id, n))
  const self = new Map()
  const total = p.timeDeltas.reduce((s, v) => s + v, 0)
  for (let i = 0; i < p.samples.length; i++) {
    const node = byId.get(p.samples[i])
    if (!node) continue
    const cf = node.callFrame
    const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').split('/').slice(-1)[0]}:${cf.lineNumber + 1}`
    self.set(key, (self.get(key) || 0) + (p.timeDeltas[i] || 0))
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  console.log(`\nCPU 自身耗时 Top（总采样 ${(total / 1000).toFixed(0)}ms）：`)
  for (const [k, v] of rows) {
    console.log(`  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(5)}ms  ${k}`)
  }

  if (process.env.COUNT === '1') {
    const calls = await evaluate('window.__calls')
    const total = Object.values(calls).reduce((a, b) => a + b, 0)
    const per = (v) => (v / gaps.length).toFixed(1)
    console.log('\n每帧平均绘制调用（' + gaps.length + ' 帧）：')
    console.log('  合计 ' + per(total))
    Object.entries(calls).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      console.log('  ' + k.padEnd(20) + per(v))
    })
  }

  if (errors.length) {
    console.log('\n⚠ 运行时报错 ' + errors.length + ' 条：')
    errors.slice(0, 5).forEach((e) => console.log('  ' + String(e).split('\n')[0]))
  } else {
    console.log('\n运行期无 JS 报错')
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const tag = process.env.TAG || 'shot'
  fs.writeFileSync(path.join(__dirname, tag + '.png'), Buffer.from(shot.data, 'base64'))
  console.log('\n截图:', path.join(__dirname, tag + '.png'))

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('测量失败:', e.message || e)
  process.exit(1)
})
