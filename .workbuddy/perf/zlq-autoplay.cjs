const http = require('http')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const j = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))) }).on('error', rej))
const STATE = `JSON.stringify((window.__plays||[]).map(a=>({paused:a.paused,t:+a.currentTime.toFixed(2),err:a.error&&a.error.code})))`
;(async () => {
  const list = await j('http://127.0.0.1:9224/json/list')
  const page = list.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, x) => { ws.addEventListener('open', r); ws.addEventListener('error', x) })
  let id = 0; const p = new Map(); const errs = []
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && p.has(m.id)) { p.get(m.id)(m.result || m.error); p.delete(m.id) }
    else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text)
  })
  const send = (m, q = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })) })
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__plays=[];(function(){const op=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){if(window.__plays.indexOf(this)<0)window.__plays.push(this);return op.apply(this,arguments)};})();
  ` })
  await send('Page.navigate', { url: 'http://127.0.0.1:8136/?debug=1' })
  await sleep(3000)
  console.log('1) 未交互（预期被浏览器拦截）:', await ev(STATE))

  // 用 CDP 发真实触摸事件，才算用户手势
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 200, id: 1 }] })
  await sleep(60)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(1600)
  console.log('2) 首次点击后（预期开始播放）:', await ev(STATE))
  console.log('JS 报错:', errs.length ? errs.join(' | ') : '无')
  process.exit(0)
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
