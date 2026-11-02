// 生成可直接部署的《扩编战争》静态网站。
// 用法：node tools/build-web.cjs
const fs = require('fs')
const path = require('path')
const { releaseGameSource } = require('./release-transforms.cjs')

const ROOT = path.resolve(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const WEB = path.join(ROOT, 'web')
const JS_DIR = path.join(ROOT, 'js')
const ASSETS_DIR = path.join(ROOT, 'assets')

const FORBIDDEN_MARKERS = [
  '__commanderSim',
  'window.__tap',
  'window.__drag',
  '__shimCanvas',
  '__enableAutoPause',
  'window.__',
  'startTestRun',
  '测试关卡',
  '测试入口',
  'L.test',
]

function walk(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    const stat = fs.statSync(file)
    if (stat.isDirectory()) out.push(...walk(file))
    else out.push(file)
  }
  return out
}

function addJsExtension(specifier) {
  if (/\.(?:mjs|cjs|js|json|css|html)$/i.test(specifier)) return specifier
  return specifier + '.js'
}

// 小游戏源码里的 import 不带 .js，静态站点必须补全，否则浏览器无法解析。
function rewriteImports(code) {
  return code
    .replace(/(\bfrom\s*['"])(\.[^'"]+)(['"])/g, (match, before, spec, after) => {
      return before + addJsExtension(spec) + after
    })
    .replace(
      /(\bimport\s*\(\s*['"])(\.[^'"]+)(['"]\s*\))/g,
      (match, before, spec, after) => before + addJsExtension(spec) + after
    )
}

function validateImports(file) {
  const code = fs.readFileSync(file, 'utf8')
  const re = /(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g
  let match
  while ((match = re.exec(code))) {
    const target = path.resolve(path.dirname(file), match[1])
    if (!fs.existsSync(target)) {
      throw new Error(`构建失败：${file} 引用的 ${match[1]} 不存在`)
    }
  }
}

function copyWebShell() {
  for (const file of walk(WEB)) {
    const rel = path.relative(WEB, file)
    const target = path.join(SITE, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(file, target)
  }
}

function copyGameScripts() {
  const outDir = path.join(SITE, 'js')
  fs.mkdirSync(outDir, { recursive: true })
  const targets = []
  for (const name of fs.readdirSync(JS_DIR)) {
    if (!name.endsWith('.js')) continue
    const sourceFile = path.join(JS_DIR, name)
    // 网站和微信上传包共用同一套发布转换：移除本地测试关卡入口与调试参数。
    const source =
      name === 'game.js'
        ? releaseGameSource(sourceFile)
        : fs.readFileSync(sourceFile, 'utf8')
    const target = path.join(outDir, name)
    fs.writeFileSync(target, rewriteImports(source))
    targets.push(target)
  }
  for (const target of targets) validateImports(target)
  return targets.length
}

function copyAssets() {
  const target = path.join(SITE, 'assets')
  fs.cpSync(ASSETS_DIR, target, { recursive: true })
  return walk(target).length
}

function checkForbiddenFiles() {
  const extensions = new Set(['.html', '.js', '.json', '.webmanifest', '.css', '.txt'])
  for (const file of walk(SITE)) {
    if (!extensions.has(path.extname(file).toLowerCase())) continue
    const code = fs.readFileSync(file, 'utf8')
    for (const marker of FORBIDDEN_MARKERS) {
      if (code.includes(marker)) {
        throw new Error(`构建失败：${file} 含有调试标记 ${marker}`)
      }
    }
  }
}

function main() {
  fs.rmSync(SITE, { recursive: true, force: true })
  fs.mkdirSync(SITE, { recursive: true })

  copyWebShell()
  const jsCount = copyGameScripts()
  const assetCount = copyAssets()

  fs.writeFileSync(path.join(SITE, '.nojekyll'), '')
  fs.writeFileSync(
    path.join(SITE, '404.html'),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./">' +
      '<title>扩编战争</title><p style="font-family:sans-serif;text-align:center;margin-top:20vh">' +
      '正在返回《扩编战争》…</p>'
  )

  checkForbiddenFiles()

  const files = walk(SITE)
  const bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0)
  console.log(`网站构建完成：${SITE}`)
  console.log(
    `  ${jsCount} 个游戏脚本，${assetCount} 个资源文件，共 ${(bytes / 1024 / 1024).toFixed(2)} MB`
  )
}

main()
