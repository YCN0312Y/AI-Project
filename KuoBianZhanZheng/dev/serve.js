// 极简静态服务器，仅用于浏览器预览
// 用法：node dev/serve.js  →  http://localhost:8123/dev/index.html
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PORT = process.argv[2]
  ? Number(process.argv[2])
  : process.env.PORT
    ? Number(process.env.PORT)
    : 8123

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  fs.createReadStream(filePath).pipe(res)
}

// 小游戏里 import './xxx' 不带 .js 后缀；浏览器里由这个服务器补全
function tryServe(filePath, res) {
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      serveFile(filePath, res)
      return
    }

    if (!path.extname(filePath)) {
      const withExt = filePath + '.js'
      fs.stat(withExt, (err2, stat2) => {
        if (!err2 && stat2.isFile()) {
          serveFile(withExt, res)
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })
}

http
  .createServer((req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch (e) {
      res.writeHead(400)
      res.end('Bad request')
      return
    }

    if (urlPath === '/') urlPath = '/dev/index.html'

    const filePath = path.normalize(path.join(ROOT, urlPath))
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    tryServe(filePath, res)
  })
  .listen(PORT, () => {
    console.log(`扩编战争 dev server: http://localhost:${PORT}/dev/index.html`)
  })
