const http = require('http')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function httpJson(url) {
  return new Promise((res, rej) => http.get(url, (r) => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>res(JSON.parse(b))) }).on('error', rej))
}
;(async () => {
  const list = await httpJson('http://127.0.0.1:9222/json/list')
  const page = list.find((t) => t.type === 'page')
  console.log('targets:', list.filter(t=>t.type==='page').map(t=>t.url))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j)})
  let id=0; const pend=new Map()
  const logs=[]
  ws.addEventListener('message',(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result||m.error);pend.delete(m.id)} else if(m.method==='Runtime.consoleAPICalled'||m.method==='Log.entryAdded'||m.method==='Runtime.exceptionThrown'){logs.push(JSON.stringify(m.params).slice(0,300))}})
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}))})
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
  await send('Page.navigate',{url:'http://localhost:8124/dev/index.html'})
  await sleep(3000)
  const ev = await send('Runtime.evaluate',{expression:'JSON.stringify({href:location.href, ready:document.readyState, scripts:[...document.scripts].map(s=>s.src), hasWx:typeof wx})',returnByValue:true})
  console.log(ev.result.value)
  console.log('logs:', logs.slice(-10).join('\n'))
  process.exit(0)
})()
