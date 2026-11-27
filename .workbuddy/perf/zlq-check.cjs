const http = require('http'), fs = require('fs')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const j = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))) }).on('error', rej))
const OUT = 'F:/YU/AIProject/.workbuddy/perf/'
;(async () => {
  const list = await j('http://127.0.0.1:9224/json/list')
  const page = list.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, x) => { ws.addEventListener('open', r); ws.addEventListener('error', x) })
  let id = 0; const p = new Map(); const errs = []
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && p.has(m.id)) { p.get(m.id)(m.result || m.error); p.delete(m.id) }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text)
  })
  const send = (m, q = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })) })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:8136/?debug=1' })
  await sleep(3200)
  const state = await send('Runtime.evaluate', { expression: `JSON.stringify({hasGame:!!window.game,troops:window.game?.save?.troops,xp:window.game?.save?.xp,rankText:window.game?.save ? (window.__rankProbe||'n/a') : ''})`, returnByValue: true })
  console.log('state:', state.result.value)
  console.log('errors after load:', errs.length ? errs.join(' | ') : 'none')

  await send('Runtime.evaluate', { expression: `window.game.open('army')`, returnByValue: true })
  await sleep(1200)
  let s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(OUT + 'zlq-army.png', Buffer.from(s.data, 'base64'))

  await send('Runtime.evaluate', { expression: `window.game.home()`, returnByValue: true })
  await sleep(1200)
  s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(OUT + 'zlq-lobby.png', Buffer.from(s.data, 'base64'))
  console.log('errors total:', errs.length ? errs.join(' | ') : 'none')
  console.log('screenshots written')
  process.exit(0)
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
