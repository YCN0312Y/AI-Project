// 程序化生成两条原创循环 BGM（无版权问题，不依赖外部音频素材）
// 生成：assets/audio/menu-bgm.wav（紧张战场）、assets/audio/battle-bgm.wav（军事进行曲）
// 用法：node tools/generate-bgm.js
const fs = require('fs')
const path = require('path')

const SR = 22050
const DUR = 16
const N = SR * DUR

function makeBuf() {
  return new Float32Array(N)
}

function addAt(buf, index, value) {
  const i = ((index % N) + N) % N
  buf[i] += value
}

// 音符：带包络；所有写入按循环缓冲区取模，尾音会绕回开头
function tone(buf, start, dur, freq, amp, timbre = 'sine') {
  const startI = Math.round(start * SR)
  const len = Math.max(1, Math.round(dur * SR))
  const attack = timbre === 'brass' ? 0.025 : 0.008
  const release = timbre === 'bell' ? dur : Math.min(0.25, dur * 0.35)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    let env
    if (t < attack) env = t / attack
    else if (t > dur - release) env = Math.max(0, (dur - t) / release)
    else env = 1
    if (timbre === 'bell') env *= Math.exp(-3.2 * t)
    if (timbre === 'pluck') env *= Math.exp(-4.5 * t)
    if (env <= 0) continue

    let v = 0
    if (timbre === 'sine') {
      v = Math.sin(2 * Math.PI * freq * t)
    } else if (timbre === 'brass') {
      v =
        Math.sin(2 * Math.PI * freq * t) +
        0.24 * Math.sin(2 * Math.PI * freq * 2 * t + 0.2) +
        0.1 * Math.sin(2 * Math.PI * freq * 3 * t + 0.5) +
        0.035 * Math.sin(2 * Math.PI * freq * 4 * t + 0.9)
      v *= 0.82
    } else if (timbre === 'bell') {
      v =
        Math.sin(2 * Math.PI * freq * t) +
        0.2 * Math.sin(2 * Math.PI * freq * 2.01 * t + 0.4) +
        0.06 * Math.sin(2 * Math.PI * freq * 3.98 * t + 0.9)
      v *= 0.82
    } else if (timbre === 'pluck') {
      v =
        Math.sin(2 * Math.PI * freq * t) +
        0.28 * Math.sin(2 * Math.PI * freq * 2 * t)
    } else {
      v = Math.sin(2 * Math.PI * freq * t)
    }
    addAt(buf, startI + i, v * amp * env)
  }
}

function noiseBurst(buf, start, dur, amp, decay = 5, high = false) {
  const startI = Math.round(start * SR)
  const len = Math.max(1, Math.round(dur * SR))
  let last = 0
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const env = Math.exp(-decay * t) * Math.min(1, t / 0.002)
    let n = Math.random() * 2 - 1
    if (high) {
      n = n - last
      last = n
    }
    addAt(buf, startI + i, n * amp * env)
  }
}

function kick(buf, start, amp = 0.8) {
  const startI = Math.round(start * SR)
  const len = Math.round(0.38 * SR)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const f = 80 * Math.exp(-9 * t) + 38
    const env = Math.exp(-7.5 * t)
    addAt(buf, startI + i, Math.sin(2 * Math.PI * f * t) * amp * env)
  }
}

function snare(buf, start, amp = 0.3, dur = 0.16, high = true) {
  noiseBurst(buf, start, dur, amp, 18, high)
  tone(buf, start, dur * 0.55, 185, amp * 0.18, 'sine')
}

function hat(buf, start, amp = 0.08) {
  noiseBurst(buf, start, 0.045, amp, 70, true)
}

function cymbal(buf, start, amp = 0.18, dur = 1.4) {
  noiseBurst(buf, start, dur, amp, 3.2, true)
  noiseBurst(buf, start, dur * 0.7, amp * 0.5, 2.2, false)
}

// 警报式扫频，用于主菜单的紧张感
function siren(buf, start, dur, amp) {
  const startI = Math.round(start * SR)
  const len = Math.max(1, Math.round(dur * SR))
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const p = i / len
    const f = 620 + 260 * Math.sin(Math.PI * 2 * 2.2 * t)
    const env =
      Math.min(1, t / 0.06) *
      Math.min(1, (dur - t) / Math.min(0.18, dur * 0.3))
    if (env <= 0) continue
    addAt(
      buf,
      startI + i,
      Math.sin(2 * Math.PI * f * t) * amp * env
    )
  }
}

function addDrone(buf, freq, amp) {
  // 频率取整到 16 秒整数周期，保证循环无缝
  const f = Math.round(freq * DUR) / DUR
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const mod = 0.72 + 0.28 * Math.sin(2 * Math.PI * (3 * t) / DUR - Math.PI / 2)
    buf[i] += Math.sin(2 * Math.PI * f * t) * amp * mod
  }
}

function addAir(buf, amp) {
  // 用整数周期的随机正弦叠加成循环风声
  const parts = 26
  for (let k = 0; k < parts; k++) {
    const f = (Math.round((40 + Math.random() * 980) * DUR) / DUR)
    const phase = Math.random() * Math.PI * 2
    const a = amp * (0.3 + Math.random() * 0.7) / parts
    for (let i = 0; i < N; i++) {
      const t = i / SR
      buf[i] += Math.sin(2 * Math.PI * f * t + phase) * a
    }
  }
}

function echoLoop(buf, delaySec, feedback) {
  const delay = Math.round(delaySec * SR)
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const d1 = (i - delay + N) % N
    const d2 = (i - delay * 2 + N) % N
    out[i] = buf[i] + buf[d1] * feedback + buf[d2] * feedback * 0.45
  }
  return out
}

function lowPassLoop(buf, cutoff) {
  const dt = 1 / SR
  const rc = 1 / (2 * Math.PI * cutoff)
  const alpha = dt / (rc + dt)
  // 先跑一遍让滤波器进入循环稳态，再从下一次循环开始记录
  let prev = 0
  for (let i = 0; i < N; i++) prev += alpha * (buf[i] - prev)
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    prev += alpha * (buf[i] - prev)
    out[i] = prev
  }
  return out
}

// 两级柔和低通：压掉刺耳的高频镲片/高音共鸣，保留进行曲的力度
function softenHighs(buf, cutoff) {
  let out = lowPassLoop(buf, cutoff)
  out = lowPassLoop(out, cutoff * 1.15)
  buf.set(out)
  return buf
}

function normalize(buf, peak = 0.86) {
  let max = 0
  for (let i = 0; i < N; i++) max = Math.max(max, Math.abs(buf[i]))
  if (max < 0.0001) return buf
  const k = peak / max
  for (let i = 0; i < N; i++) buf[i] *= k
  return buf
}

function writeWav(file, buf) {
  const dataSize = N * 2
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
  for (let i = 0; i < N; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]))
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  fs.writeFileSync(file, out)
}

// ---------- 主菜单：紧张战场（105 BPM，三全音/小二度 + 心跳 + 警报） ----------
function makeMenu() {
  let b = makeBuf()

  const beat = 60 / 105
  const bar = beat * 4
  const bars = 7 // 28 拍，正好 16 秒

  // 低频恐惧底色：D + Ab 三全音；不再叠加高音持续音，避免耳鸣般的尖鸣
  addDrone(b, 73.42, 0.09)   // D2
  addDrone(b, 103.83, 0.035) // Ab2
  addDrone(b, 36.71, 0.06)   // D1
  addDrone(b, 51.91, 0.022)  // Ab1
  addAir(b, 0.018)

  // 心跳：两拍一次的双重低鼓
  for (let t = 0; t < DUR; t += beat * 2) {
    kick(b, t, 0.5)
    kick(b, t + 0.14, 0.26)
  }

  // 每个八分音符的低音脉冲，D/Eb 交替
  let pulse = 0
  for (let t = 0; t < DUR; t += beat * 0.5) {
    const f = pulse % 2 === 0 ? 73.42 : 77.78
    tone(b, t, beat * 0.28, f, 0.055, 'sine')
    pulse += 1
  }

  // 类似时钟/金属的细碎敲击（压低高频，避免尖锐）
  for (let t = 0; t < DUR; t += beat * 0.5) {
    noiseBurst(b, t, 0.018, 0.01, 75, true)
  }

  // 每小节一次的低沉紧张和弦：D3 + Eb3 + Ab3
  for (let barI = 0; barI < bars; barI++) {
    const t = barI * bar
    tone(b, t, 0.22, 146.83, 0.05, 'brass') // D3
    tone(b, t, 0.22, 155.56, 0.032, 'brass') // Eb3
    tone(b, t, 0.34, 207.65, 0.025, 'bell')   // Ab3
  }

  // 远处的金属撞击（弱化）
  for (let barI = 0; barI < bars; barI += 2) {
    cymbal(b, barI * bar + bar * 0.72, 0.012, 2.2)
  }

  b = echoLoop(b, 0.29, 0.1)
  softenHighs(b, 3400)
  return normalize(b, 0.72)
}

// ---------- 战斗：热血军事进行曲（150 BPM） ----------
function makeBattle() {
  let b = makeBuf()
  addDrone(b, 73.42, 0.035)
  addDrone(b, 110.0, 0.018)

  const beat = 60 / 150
  const bar = beat * 4
  const bars = 10
  const step = beat / 4

  // 低音 8 分音符：D D F F G G A G F D
  const roots = [73.42, 73.42, 87.31, 87.31, 98.0, 98.0, 110.0, 98.0, 87.31, 73.42]
  for (let barI = 0; barI < bars; barI++) {
    const t = barI * bar
    const r = roots[barI]
    const pattern = [r, r * 2, r * 1.5, r * 2, r, r * 1.5, r * 2, r * 2]
    for (let k = 0; k < 8; k++) {
      tone(b, t + k * beat * 0.5, beat * 0.42, pattern[k], 0.1, 'brass')
    }
    // 每小节强拍铜管和弦
    tone(b, t, beat * 0.32, r * 2, 0.055, 'brass')
    tone(b, t, beat * 0.32, r * 3, 0.03, 'brass')
  }

  // 鼓组：快速 16 分推进
  for (let barI = 0; barI < bars; barI++) {
    const t = barI * bar

    for (let s = 0; s < 16; s++) {
      const tt = t + s * step
      if (s % 4 === 0) {
        kick(b, tt, s % 8 === 0 ? 0.62 : 0.46)
      }
      if (s === 14 && barI % 2 === 1) kick(b, tt, 0.3)

      if (s === 4 || s === 12) {
        snare(b, tt, 0.14)
      } else if (s % 2 === 1 && s !== 15) {
        snare(b, tt, 0.022, 0.07)
      }

      if (s % 2 === 0) hat(b, tt, s % 4 === 0 ? 0.014 : 0.008)
    }

    if (barI === 0 || barI === 5) cymbal(b, t, 0.08, 1.5)

    // 每 4 小节末尾来一段军鼓滚奏
    if (barI === 3 || barI === 8) {
      for (let k = 0; k < 8; k++) {
        snare(b, t + beat * (2 + k * 0.25), 0.045 + k * 0.005, 0.07)
      }
    }
  }

  // 主旋律：8 分音符铜管，快、亮、往上冲
  const melody = [
    [293.66, 349.23, 440.0, 587.33, 440.0, 349.23, 329.63, 293.66],
    [293.66, 392.0, 466.16, 587.33, 523.25, 466.16, 440.0, 392.0],
    [440.0, 587.33, 698.46, 659.25, 587.33, 523.25, 440.0, 349.23],
    [329.63, 440.0, 523.25, 659.25, 587.33, 523.25, 440.0, 392.0],
    [293.66, 349.23, 440.0, 587.33, 698.46, 587.33, 523.25, 440.0],
    [392.0, 466.16, 587.33, 698.46, 659.25, 587.33, 523.25, 466.16],
    [440.0, 523.25, 659.25, 880.0, 698.46, 659.25, 587.33, 523.25],
    [587.33, 523.25, 466.16, 440.0, 392.0, 349.23, 329.63, 293.66],
    [293.66, 349.23, 440.0, 587.33, 880.0, 698.46, 587.33, 440.0],
    [392.0, 466.16, 587.33, 698.46, 880.0, 698.46, 587.33, 466.16],
  ]

  for (let barI = 0; barI < bars; barI++) {
    const t = barI * bar
    for (let k = 0; k < 8; k++) {
      const f = melody[barI][k]
      const amp = k === 0 ? 0.16 : 0.135
      tone(b, t + k * beat * 0.5, beat * 0.43, f, amp, 'brass')
    }
  }

  b = echoLoop(b, 0.2, 0.07)
  softenHighs(b, 3800)
  return normalize(b, 0.8)
}

const outDir = path.join(__dirname, '..', 'assets', 'audio')
fs.mkdirSync(outDir, { recursive: true })
const menu = makeMenu()
const battle = makeBattle()
writeWav(path.join(outDir, 'menu-bgm.wav'), menu)
writeWav(path.join(outDir, 'battle-bgm.wav'), battle)
console.log('menu-bgm.wav', fs.statSync(path.join(outDir, 'menu-bgm.wav')).size)
console.log('battle-bgm.wav', fs.statSync(path.join(outDir, 'battle-bgm.wav')).size)
