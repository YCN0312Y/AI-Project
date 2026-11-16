const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const port=Number(process.argv[2]||8136);
http.createServer((req,res)=>{
  let route;try{route=decodeURIComponent(new URL(req.url,'http://local').pathname)}catch{res.writeHead(400);return res.end()}
  const file=path.resolve(root,'.'+(route==='/'?'/index.html':route));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
  fs.readFile(file,(error,data)=>{if(error){
    // 预览面板或手动复制时可能把说明文字拼进 URL，这类非静态路径一律回到首页
    const ext=path.extname(file).toLowerCase();
    if(!['.html','.js','.png','.json','.css','.wav','.ico','.svg'].includes(ext)){res.writeHead(302,{Location:'/'});return res.end()}
    res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)});
}).listen(port,'0.0.0.0',()=>console.log(`指挥前线 http://localhost:${port}`));
