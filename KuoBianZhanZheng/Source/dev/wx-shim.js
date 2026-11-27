// 浏览器预览用的 wx API 垫片：让小游戏代码不修改就能在浏览器里运行。
// 这个文件只用于开发预览，不会打包进微信小游戏。
;(function () {
  const TOUCH = { start: [], move: [], end: [], cancel: [] }
  const SHOW = []
  const HIDE = []
  const RESIZE = []

  let created = 0
  let mainCanvas = null
  let activePointer = null

  function windowInfo() {
    return {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
      safeArea: {
        top: 0,
        left: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    }
  }

  function makeTouch(e) {
    return {
      identifier: e.pointerId === undefined ? 0 : e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      pageX: e.clientX,
      pageY: e.clientY,
    }
  }

  function emit(type, changed, active) {
    const evt = { touches: active, changedTouches: changed }
    const list = TOUCH[type]
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](evt)
      } catch (err) {
        console.error(err)
      }
    }
  }

  function attach(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (activePointer !== null) return
      activePointer = e.pointerId
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch (err) {
        // 合成事件不支持 pointer capture，忽略
      }
      const t = makeTouch(e)
      emit('start', [t], [t])
    })

    canvas.addEventListener('pointermove', (e) => {
      if (activePointer !== e.pointerId) return
      const t = makeTouch(e)
      emit('move', [t], [t])
    })

    function finish(e, type) {
      if (activePointer !== e.pointerId) return
      activePointer = null
      const t = makeTouch(e)
      emit(type, [t], [])
    }

    canvas.addEventListener('pointerup', (e) => finish(e, 'end'))
    canvas.addEventListener('pointercancel', (e) => finish(e, 'cancel'))
  }

  function createCanvas() {
    created += 1
    if (created === 1) {
      const c = document.createElement('canvas')
      c.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none'
      document.body.appendChild(c)
      mainCanvas = c
      attach(c)
      window.__shimCanvas = c
      return c
    }
    return document.createElement('canvas')
  }

  const wx = {
    createCanvas,
    createImage() {
      return new Image()
    },
    getWindowInfo: windowInfo,
    getSystemInfoSync: windowInfo,

    onTouchStart(cb) {
      TOUCH.start.push(cb)
    },
    onTouchMove(cb) {
      TOUCH.move.push(cb)
    },
    onTouchEnd(cb) {
      TOUCH.end.push(cb)
    },
    onTouchCancel(cb) {
      TOUCH.cancel.push(cb)
    },

    onShow(cb) {
      SHOW.push(cb)
    },
    onHide(cb) {
      HIDE.push(cb)
    },
    onWindowResize(cb) {
      RESIZE.push(cb)
    },

    setStorageSync(key, value) {
      localStorage.setItem('commanderSim:' + key, JSON.stringify(value))
    },
    getStorageSync(key) {
      const raw = localStorage.getItem('commanderSim:' + key)
      if (raw == null) return ''
      try {
        return JSON.parse(raw)
      } catch (e) {
        return ''
      }
    },
    removeStorageSync(key) {
      localStorage.removeItem('commanderSim:' + key)
    },

    createInnerAudioContext() {
      const el = new Audio()
      el.preload = 'auto'
      const listeners = {}
      const ctx = {
        autoplay: false,
        obeyMuteSwitch: true,
        _src: '',
        get src() {
          return this._src
        },
        set src(v) {
          this._src = v
          el.src = v.startsWith('assets/') ? '/' + v : v
          try {
            el.load()
          } catch (e) {
            // 忽略
          }
        },
        get loop() {
          return el.loop
        },
        set loop(v) {
          el.loop = !!v
        },
        get volume() {
          return el.volume
        },
        set volume(v) {
          el.volume = Math.max(0, Math.min(1, Number(v) || 0))
        },
        get paused() {
          return el.paused
        },
        get currentTime() {
          return el.currentTime
        },
        get duration() {
          return el.duration
        },
        play() {
          const p = el.play()
          if (p && p.catch) p.catch(() => {})
        },
        pause() {
          el.pause()
        },
        stop() {
          el.pause()
          try {
            el.currentTime = 0
          } catch (e) {
            // 忽略
          }
        },
        destroy() {
          el.pause()
          el.src = ''
        },
        onError(fn) {
          listeners.error = fn
          el.addEventListener('error', fn)
        },
        onPlay(fn) {
          el.addEventListener('play', fn)
        },
        onPause(fn) {
          el.addEventListener('pause', fn)
        },
        onEnded(fn) {
          el.addEventListener('ended', fn)
        },
        onCanplay(fn) {
          el.addEventListener('canplay', fn)
        },
        seek() {},
      }
      return ctx
    },

    vibrateShort() {},
    setKeepScreenOn() {},
    shareAppMessage(opts) {
      console.log('[wx.shareAppMessage]', opts)
    },
    onShareAppMessage() {},
    showShareMenu() {},
    showToast(opts) {
      console.log('[wx.showToast]', opts)
    },
  }

  window.wx = wx

  document.addEventListener('visibilitychange', () => {
    // 浏览器预览时标签页会频繁被判为 hidden，默认不模拟切后台暂停，
    // 需要测试时在控制台执行 window.__enableAutoPause = true
    if (!window.__enableAutoPause) return
    const list = document.hidden ? HIDE : SHOW
    for (let i = 0; i < list.length; i++) {
      try {
        list[i]()
      } catch (err) {
        console.error(err)
      }
    }
  })

  window.addEventListener('resize', () => {
    for (let i = 0; i < RESIZE.length; i++) {
      try {
        RESIZE[i]({ size: windowInfo() })
      } catch (err) {
        console.error(err)
      }
    }
  })

  // ---- 调试辅助：在控制台模拟触摸 ----

  function dispatch(type, x, y, pointerId) {
    if (!mainCanvas) return
    const ev = new PointerEvent(type, {
      pointerId,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    })
    mainCanvas.dispatchEvent(ev)
  }

  window.__tap = function (x, y) {
    const id = 99
    dispatch('pointerdown', x, y, id)
    setTimeout(() => dispatch('pointerup', x, y, id), 40)
  }

  window.__drag = function (x1, y1, x2, y2, steps) {
    const id = 100
    const n = steps || 12
    dispatch('pointerdown', x1, y1, id)
    for (let i = 1; i <= n; i++) {
      ;(function (step) {
        const t = step / n
        setTimeout(() => {
          dispatch('pointermove', x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, id)
          if (step === n) {
            setTimeout(() => dispatch('pointerup', x2, y2, id), 60)
          }
        }, step * 25)
      })(i)
    }
  }
})()
