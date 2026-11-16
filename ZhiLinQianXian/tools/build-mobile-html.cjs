const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'preview', 'bootstrap.js');
const modules = new Map();

function collect(file) {
  const full = path.resolve(file);
  if (modules.has(full)) return;
  const code = fs.readFileSync(full, 'utf8');
  modules.set(full, null);
  const re = /^\s*import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  for (const m of code.matchAll(re)) {
    const dep = path.resolve(path.dirname(full), m[1]);
    collect(dep);
  }
  modules.set(full, code);
}

collect(entry);

function transform(file, code) {
  const dir = path.dirname(file);
  let idx = 0;
  let out = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g, (_, names, rel) => {
    const dep = path.relative(root, path.resolve(dir, rel)).replace(/\\/g, '/');
    const items = names.split(',').map(s => s.trim()).filter(Boolean).map(item => {
      const parts = item.split(/\s+as\s+/);
      return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : [parts[0].trim(), parts[0].trim()];
    });
    const decl = 'let ' + items.map(([, l]) => l).join(', ') + ';';
    const assign = items.map(([r, l]) => `${l}=m.${r}`).join(';');
    return `${decl}__bind('${dep}',m=>{${assign};});`;
  });
  const exported = [];
  out = out.replace(/(^|[;\n])\s*export\s+const\s+(\w+)\s*=/g, (_, p, n) => { exported.push(n); return `${p}const ${n} =`; });
  out = out.replace(/(^|[;\n])\s*export\s+let\s+(\w+)\s*=/g, (_, p, n) => { exported.push(n); return `${p}let ${n} =`; });
  out = out.replace(/(^|[;\n])\s*export\s+function\s+(\w+)/g, (_, p, n) => { exported.push(n); return `${p}function ${n}`; });
  out = out.replace(/(^|[;\n])\s*export\s+class\s+(\w+)/g, (_, p, n) => { exported.push(n); return `${p}class ${n}`; });
  if (exported.length) out += '\n' + exported.map(n => `__exp.${n}=${n};`).join('');
  return out;
}

const bundleParts = [];
bundleParts.push('(function(){');
bundleParts.push('const __mods={},__cache={},__binds=[];');
bundleParts.push('function __bind(id,fn){__binds.push([id,fn]);const m=__req(id);fn(m);}');
bundleParts.push('function __req(id){if(__cache[id])return __cache[id];const e=__cache[id]={};__mods[id](e,__req,__bind);return e;}');
for (const [file, code] of modules) {
  const id = path.relative(root, file).replace(/\\/g, '/');
  bundleParts.push(`__mods[${JSON.stringify(id)}]=function(__exp,__req,__bind){\n${transform(file, code)}\n};`);
}
bundleParts.push("for(const [id] of Object.entries(__mods))if(id!=='preview/bootstrap.js')__req(id);for(const [id,fn] of __binds)fn(__cache[id]);__req('preview/bootstrap.js');");
bundleParts.push('})();');

const shim = fs.readFileSync(path.join(root, 'preview', 'wx-shim.js'), 'utf8');
const bundled = bundleParts.join('\n');
// 语法检查打包后的脚本
new vm.Script(shim + '\n' + bundled);

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const safe = s => s.replace(/<\/script>/gi, '<\\/script>');
let html = indexHtml
  .replace('<script src="preview/wx-shim.js"></script>', `<script>\n${safe(shim)}\n</script>`)
  .replace('<script type="module" src="preview/bootstrap.js"></script>', `<script>\n${safe(bundled)}\n</script>`);

const outPath = path.join(root, '指挥前线-手机版.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('Built:', outPath, Math.round(html.length / 1024) + 'KB');
