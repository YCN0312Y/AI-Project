const http = require('http')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function httpJson(url){return new Promise((res,rej)=>http.get(url,(r)=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(JSON.parse(b)))}).on('error',rej))}
;(async()=>{
  const list = await httpJson('http://127.0.0.1:9222/json/list')
  const page = list.find(t=>t.type==='page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j)})
  let id=0; const pend=new Map(); const logs=[]
  ws.addEventListener('message',(ev)=>{const m=JSON.parse(ev.data)
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result||m.error);pend.delete(m.id)}
    else if(m.method==='Runtime.exceptionThrown'){logs.push('EXC: '+(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text))}
    else if(m.method==='Log.entryAdded'){logs.push('LOG: '+m.params.entry.text+' '+(m.params.entry.url||''))}
    else if(m.method==='Runtime.consoleAPICalled'){logs.push('CON: '+m.params.args.map(a=>a.value||a.description).join(' ').slice(0,200))}})
  const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))})
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
  await send('Page.navigate',{url:'http://127.0.0.1:8125/'})
  await sleep(3000)
  const r = await send('Runtime.evaluate',{expression:'JSON.stringify({canvas:!!document.querySelector("canvas"), href:location.href, scripts:[...document.scripts].map(s=>s.src||"inline")})',returnByValue:true})
  console.log(r.result.value)
  console.log(logs.join('\n') || '(无日志)')
  process.exit(0)
})()
