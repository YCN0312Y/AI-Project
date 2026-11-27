// 背景音乐管理：主菜单用紧张战场，战斗用军事进行曲。
// 音频由 tools/generate-bgm.js 程序化生成，原创无版权问题。
const SOURCES = {
  menu: 'assets/audio/menu-bgm.wav',
  battle: 'assets/audio/battle-bgm.wav',
}

const SFX = {
  shot: { src: 'assets/audio/sfx-shot.wav', volume: 0.34, gap: 70, pool: 2 },
  enemyShot: { src: 'assets/audio/sfx-enemy-shot.wav', volume: 0.27, gap: 110, pool: 1 },
  hit: { src: 'assets/audio/sfx-hit.wav', volume: 0.28, gap: 55, pool: 2 },
  hurt: { src: 'assets/audio/sfx-hurt.wav', volume: 0.4, gap: 120, pool: 1 },
  explosion: { src: 'assets/audio/sfx-explosion.wav', volume: 0.5, gap: 160, pool: 1 },
}

export class Bgm {
  constructor(enabled) {
    this.enabled = enabled !== false
    this.current = 'menu'
    this.paused = false
    this.contexts = {}
    this.ready = false

    if (typeof wx === 'undefined' || !wx.createInnerAudioContext) return
    try {
      // 游戏音频跟随媒体音量播放；不要让 iPhone 的静音拨片直接静音
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true })
      }
      this.contexts.menu = this.create('menu', 0.28)
      this.contexts.battle = this.create('battle', 0.32)
      this.ready = true
    } catch (e) {
      this.ready = false
    }
  }

  create(key, volume) {
    const a = wx.createInnerAudioContext()
    a.src = SOURCES[key]
    a.loop = true
    a.volume = volume
    a.autoplay = false
    if ('obeyMuteSwitch' in a) a.obeyMuteSwitch = false
    if (a.onError) {
      a.onError((err) => {
        console.warn('[BGM] 播放失败', key, err)
      })
    }
    return a
  }

  stopAll(exceptKey) {
    for (const key in this.contexts) {
      if (key === exceptKey) continue
      try {
        this.contexts[key].stop()
      } catch (e) {
        // 忽略
      }
    }
  }

  switchTo(key, restart) {
    this.current = key
    this.paused = false
    if (!this.enabled || !this.ready) return
    const a = this.contexts[key]
    if (!a) return
    this.stopAll(key)
    try {
      if (restart) a.stop()
      a.play()
    } catch (e) {
      // 忽略（部分浏览器/机型在无手势时拒绝播放）
    }
  }

  playMenu() {
    this.switchTo('menu', false)
  }

  playBattle() {
    this.switchTo('battle', false)
  }

  // 首次触摸时调用：绕过浏览器的自动播放限制
  unlock() {
    if (!this.enabled || !this.ready || this.paused) return
    const a = this.contexts[this.current]
    if (!a) return
    try {
      a.play()
    } catch (e) {
      // 忽略
    }
  }

  pause() {
    this.paused = true
    if (!this.ready) return
    const a = this.contexts[this.current]
    if (!a) return
    try {
      a.pause()
    } catch (e) {
      // 忽略
    }
  }

  resume() {
    if (!this.enabled || !this.ready) return
    this.paused = false
    const a = this.contexts[this.current]
    if (!a) return
    try {
      a.play()
    } catch (e) {
      // 忽略
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled
    if (!this.enabled) {
      this.pause()
      this.stopAll()
    } else {
      this.paused = false
      this.resume()
    }
  }
}

export class Sfx {
  constructor(enabled) {
    this.enabled = enabled !== false
    this.ready = false
    this.pools = {}
    this.next = {}
    this.last = {}
    if (typeof wx === 'undefined' || !wx.createInnerAudioContext) return

    try {
      for (const key in SFX) {
        const cfg = SFX[key]
        const pool = []
        for (let i = 0; i < cfg.pool; i++) {
          const a = wx.createInnerAudioContext()
          a.src = cfg.src
          a.loop = false
          a.volume = cfg.volume
          a.autoplay = false
          if ('obeyMuteSwitch' in a) a.obeyMuteSwitch = false
          if (a.onError) {
            a.onError((err) => {
              console.warn('[SFX] 播放失败', key, err)
            })
          }
          pool.push(a)
        }
        this.pools[key] = pool
        this.next[key] = 0
      }
      this.ready = true
    } catch (e) {
      this.ready = false
    }
  }

  play(name) {
    if (!this.ready || !this.enabled) return
    const cfg = SFX[name]
    const pool = this.pools[name]
    if (!cfg || !pool || pool.length === 0) return

    const now = Date.now()
    if (now - (this.last[name] || 0) < cfg.gap) return
    this.last[name] = now

    const idx = this.next[name] % pool.length
    this.next[name] += 1
    const a = pool[idx]
    try {
      a.stop()
      a.volume = cfg.volume
      a.play()
    } catch (e) {
      // 忽略
    }
  }

  // 首次触摸时静音预播放一次，解锁微信/浏览器的音效播放限制
  unlock() {
    if (!this.ready || !this.enabled) return
    for (const key in this.pools) {
      const cfg = SFX[key]
      const pool = this.pools[key]
      for (let i = 0; i < pool.length; i++) {
        const a = pool[i]
        try {
          a.volume = 0
          a.play()
          setTimeout(() => {
            try {
              a.pause()
              if (a.seek) a.seek(0)
              a.volume = cfg.volume
            } catch (e) {
              // 忽略
            }
          }, 30)
        } catch (e) {
          // 忽略
        }
      }
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled
    if (!this.enabled) {
      for (const key in this.pools) {
        const pool = this.pools[key]
        for (let i = 0; i < pool.length; i++) {
          try {
            pool[i].stop()
          } catch (e) {
            // 忽略
          }
        }
      }
    }
  }
}
