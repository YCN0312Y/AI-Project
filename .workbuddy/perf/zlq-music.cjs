const http = require('http'), fs = require('fs')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const j = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))) }).on('error', rej))
const OUT = 'F:/YU/AIProject/.workbuddy/perf/'
// new Audio() 创建的元素不在 DOM 里，用 play 调用钩子拿到实例
const AUDIO_STATE = `JSON.stringify((window.__plays||[]).map(a=>({src:a.getAttribute('src'),loop:a.loop,volume:a.volume,paused:a.paused,t:+a.currentTime.toFixed(2),readyState:a.readyState,err:a.error&&a.error.code})))`
const RES = `JSON.stringify(performance.getEntriesByType('resource').filter(e=>e.name.includes('march.mp3')).map(e=>({file:e.name.split('/').pop(),bytes:e.transferSize})))`

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
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result && r.result.value
  }
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__plays=[];
    (function(){const op=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){if(window.__plays.indexOf(this)<0)window.__plays.push(this);return op.apply(this,arguments)};})();
  ` })
  await send('Page.navigate', { url: 'http://127.0.0.1:8136/?debug=1' })
  await sleep(3200)

  console.log('1) 加载后:', await ev(AUDIO_STATE), '| music=', await ev('window.game?.save?.settings?.music'))
  console.log('   资源请求:', await ev(RES))

  await ev(`window.game.touch({touches:[{clientX:10,clientY:10}]})`)
  await sleep(1800)
  console.log('2) 触摸后 1.8s:', await ev(AUDIO_STATE))

  await ev(`window.game.open('settings')`)
  await sleep(700)
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(OUT + 'zlq-settings-music.png', Buffer.from(s.data, 'base64'))

  await ev(`window.game.buttons.find(b=>b.id==='toggle-music').fn()`)
  await sleep(500)
  console.log('3) 关闭后:', await ev(AUDIO_STATE), '| music=', await ev('window.game.save.settings.music'))

  await ev(`window.game.buttons.find(b=>b.id==='toggle-music').fn()`)
  await sleep(800)
  console.log('4) 重开后:', await ev(AUDIO_STATE), '| music=', await ev('window.game.save.settings.music'))

  await ev(`window.game.start('campaign',1)`)
  await sleep(500)
  console.log('5) 进入战斗:', await ev(AUDIO_STATE))
  await ev(`window.game.home()`)
  await sleep(800)
  console.log('6) 返回大厅:', await ev(AUDIO_STATE))

  console.log('JS 报错:', errs.length ? errs.join(' | ') : '无')
  process.exit(0)
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
