const http = require('http')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const j = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))) }).on('error', rej))
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
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__plays=[];window.__playCalls=0;window.__touchCalls=0;
    (function(){const op=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){window.__playCalls++;if(window.__plays.indexOf(this)<0)window.__plays.push(this);return op.apply(this,arguments)};})();
  ` })
  await send('Page.navigate', { url: 'http://127.0.0.1:8136/?debug=1' })
  await sleep(3000)
  await ev(`window.__origTouch=window.game.touch.bind(window.game);window.game.touch=function(e){window.__touchCalls++;return window.__origTouch(e)};true`)
  const snap = `JSON.stringify({playCalls:window.__playCalls,touchCalls:window.__touchCalls,audio:(window.__plays||[]).map(a=>({paused:a.paused,t:+a.currentTime.toFixed(2)}))})`
  console.log('1) 未交互:', await ev(snap))

  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 200, id: 1 }] })
  await sleep(80)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(1600)
  console.log('2) CDP 触摸后:', await ev(snap))

  // 直接调用实例方法（不经浏览器手势）看看重试是否被 pending 卡住
  console.log('3) 直接调 play():', await ev(`(async()=>{const a=window.__plays[0];try{await a.play();return 'resolved paused='+a.paused}catch(e){return 'rejected '+e.name}})()`))
  console.log('JS 报错:', errs.length ? errs.join(' | ') : '无')
  process.exit(0)
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
