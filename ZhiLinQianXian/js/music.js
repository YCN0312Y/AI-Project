// 主界面背景音乐：军事进行曲循环。
// 微信小游戏与浏览器预览共用 wx.createInnerAudioContext 接口（浏览器端由 preview/wx-shim.js 提供）。
const SRC = 'audio/march.mp3'
const VOLUME = 0.35
const RETRY_MS = 500

let audio = null
let enabled = true    // 用户设置
let context = 'lobby' // 当前场景
let visible = true    // 是否在前台
let wanted = false    // 以上三项的合取：此刻是否应该播放
let playing = false
let failed = false
let lastTry = 0

function ensure() {
  if (audio || failed || typeof wx === 'undefined' || !wx.createInnerAudioContext) return audio
  try {
    audio = wx.createInnerAudioContext()
    audio.src = SRC
    audio.loop = true
    audio.volume = VOLUME
    audio.onError?.(() => { failed = true; playing = false })
  } catch {
    failed = true
  }
  return audio
}

function stop() {
  if (audio && playing) { try { audio.pause() } catch {} }
  playing = false
}

function play() {
  if (failed || playing) return
  const a = ensure()
  if (!a) return
  try {
    const r = a.play()
    if (r && typeof r.then === 'function') {
      r.then(() => {
        playing = true
        if (!wanted) stop()   // 启动期间场景已切走
      }).catch(() => {
        playing = false       // 浏览器自动播放策略拦截，等用户手势后重试
      })
    } else {
      playing = true          // 微信小游戏的 play() 不返回 Promise
    }
  } catch {
    playing = false
  }
}

function start() {
  lastTry = Date.now()
  play()
}

function apply() {
  wanted = enabled && visible && (context === 'lobby'||context === 'world-map')
  if (wanted) start()
  else stop()
}

export function initMusic(save) {
  enabled = save?.settings?.music !== false
}

export function setMusicEnabled(on) {
  enabled = !!on
  apply()
}

// 只在主界面（含其上打开的各面板）播放；进入战斗或切到后台时暂停。
export function updateMusic(scene, isVisible = true) {
  context = scene
  visible = isVisible
  apply()
}

// 浏览器要求用户交互后才能出声；每次触摸都补一次尝试。
export function unlockMusic() {
  if (wanted) start()
}

// 兜底：某些浏览器里点击事件当次的 play() 仍会被拒、手势稍后才生效，
// 所以由主循环低频重试，直到真正出声。播放成功或关闭音乐后立即停止重试。
export function pumpMusic() {
  if (!wanted || playing || failed) return
  const now = Date.now()
  if (now - lastTry < RETRY_MS) return
  lastTry = now
  play()
}
