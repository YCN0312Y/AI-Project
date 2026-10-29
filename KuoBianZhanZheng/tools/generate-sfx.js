// 生成短音效：枪声、敌人枪声、命中、受伤、爆炸
// 用法：node tools/generate-sfx.js
const fs = require('fs')
const path = require('path')

const SR = 22050

function make(dur) {
  return new Float32Array(Math.max(1, Math.round(dur * SR)))
}

function addTone(buf, start, dur, f0, f1, amp, decay) {
  const s = Math.round(start * SR)
  const n = Math.round(dur * SR)
  for (let i = 0; i < n && s + i < buf.length; i++) {
    const t = i / SR
    const p = i / n
    const f = f0 + (f1 - f0) * p
    const env = Math.exp(-decay * t) * Math.min(1, t / 0.002)
    buf[s + i] += Math.sin(2 * Math.PI * f * t) * amp * env
  }
}

function addNoise(buf, start, dur, amp, decay, high) {
  const s = Math.round(start * SR)
  const n = Math.round(dur * SR)
  let last = 0
  for (let i = 0; i < n && s + i < buf.length; i++) {
    const t = i / SR
    const env = Math.exp(-decay * t) * Math.min(1, t / 0.0015)
    let v = Math.random() * 2 - 1
    if (high) {
      v = v - last
      last = v
    }
    buf[s + i] += v * amp * env
  }
}

function normalize(buf, peak = 0.9) {
  let max = 0
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]))
  if (max > 0.0001) {
    const k = peak / max
    for (let i = 0; i < buf.length; i++) buf[i] *= k
  }
  return buf
}

function writeWav(file, buf) {
  const n = buf.length
  const dataSize = n * 2
  const out = Buffer.alloc(44 + dataSize)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + dataSize, 4)
  out.write('WAVE', 8)
  out.write('fmt ', 12)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(SR, 24)
  out.writeUInt32LE(SR * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2)
  }
  fs.writeFileSync(file, out)
}

function shot() {
  const b = make(0.17)
  addNoise(b, 0, 0.12, 0.9, 30, true)
  addNoise(b, 0, 0.09, 0.45, 45, false)
  addTone(b, 0, 0.16, 110, 45, 0.75, 24)
  addTone(b, 0.015, 0.035, 1800, 900, 0.14, 80)
  return normalize(b, 0.9)
}

function enemyShot() {
  const b = make(0.2)
  addNoise(b, 0, 0.14, 0.65, 22, true)
  addNoise(b, 0, 0.16, 0.32, 18, false)
  addTone(b, 0, 0.19, 85, 38, 0.6, 18)
  addTone(b, 0.02, 0.06, 420, 160, 0.12, 35)
  return normalize(b, 0.82)
}

function hitEnemy() {
  const b = make(0.11)
  addNoise(b, 0, 0.055, 0.55, 55, true)
  addNoise(b, 0, 0.08, 0.2, 40, false)
  addTone(b, 0, 0.07, 900, 420, 0.22, 55)
  addTone(b, 0, 0.1, 165, 90, 0.42, 32)
  return normalize(b, 0.82)
}

function hurt() {
  const b = make(0.3)
  addNoise(b, 0, 0.22, 0.35, 12, false)
  addTone(b, 0, 0.28, 150, 55, 0.7, 11)
  addTone(b, 0.015, 0.2, 420, 160, 0.22, 10)
  addNoise(b, 0.02, 0.06, 0.2, 45, true)
  return normalize(b, 0.85)
}

function explosion() {
  const b = make(0.7)
  addNoise(b, 0, 0.55, 0.9, 6.5, false)
  addNoise(b, 0, 0.22, 0.5, 18, true)
  addTone(b, 0, 0.55, 65, 28, 0.85, 4.5)
  // 碎裂声
  for (let k = 0; k < 6; k++) {
    addNoise(b, 0.04 + Math.random() * 0.2, 0.03, 0.18, 55, true)
  }
  return normalize(b, 0.94)
}

const outDir = path.join(__dirname, '..', 'assets', 'audio')
fs.mkdirSync(outDir, { recursive: true })
writeWav(path.join(outDir, 'sfx-shot.wav'), shot())
writeWav(path.join(outDir, 'sfx-enemy-shot.wav'), enemyShot())
writeWav(path.join(outDir, 'sfx-hit.wav'), hitEnemy())
writeWav(path.join(outDir, 'sfx-hurt.wav'), hurt())
writeWav(path.join(outDir, 'sfx-explosion.wav'), explosion())
console.log('SFX generated in', outDir)
