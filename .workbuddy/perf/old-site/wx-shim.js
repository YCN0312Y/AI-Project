// 《扩编战争》网站版 wx API 适配层。
// 只包含游戏实际使用的接口，不暴露任何调试入口。
;(function () {
  'use strict'

  const TOUCH = { start: [], move: [], end: [], cancel: [] }
  const SHOW = []
  const HIDE = []
  const RESIZE = []

  const STORAGE_PREFIX = 'commanderSim:'
  const STAGE_RATIO = 375 / 667
  const MAX_STAGE_WIDTH = 430

  let created = 0
  let mainCanvas = null
  let activePointer = null
  let stageWidth = 375
  let stageHeight = 667
  let safeProbe = null
  let toastEl = null
  let toastTimer = 0
  let keepScreenOn = false
  let wakeLock = null
  let resizeFrame = 0

  function emit(list, arg) {
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](arg)
      } catch (err) {
        console.error(err)
      }
    }
  }

  function readSafeInsets() {
    if (!safeProbe) {
      safeProbe = document.createElement('div')
      safeProbe.setAttribute('aria-hidden', 'true')
      safeProbe.style.cssText =
        'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;' +
        'pointer-events:none;' +
        'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
        'env(safe-area-inset-bottom) env(safe-area-inset-left);'
      document.body.appendChild(safeProbe)
    }
    const style = getComputedStyle(safeProbe)
    return {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    }
  }

  // 手机铺满屏幕；桌面/平板收成居中的竖屏战场，避免横屏比例破坏布局。
  function layoutCanvas() {
    if (!mainCanvas) return
    const vw = Math.max(1, window.innerWidth)
    const vh = Math.max(1, window.innerHeight)

    let width = vw
    let height = vh

    if (vw > 560) {
      width = Math.min(MAX_STAGE_WIDTH, Math.round(vh * STAGE_RATIO))
      height = Math.round(width / STAGE_RATIO)
      if (height > vh) {
        height = vh
        width = Math.round(height * STAGE_RATIO)
      }
    }

    stageWidth = Math.max(1, Math.round(width))
    stageHeight = Math.max(1, Math.round(height))
    mainCanvas.style.width = stageWidth + 'px'
    mainCanvas.style.height = stageHeight + 'px'
  }

  function windowInfo() {
    const rect = mainCanvas
      ? mainCanvas.getBoundingClientRect()
      : { left: 0, top: 0, right: stageWidth, bottom: stageHeight }
    const insets = readSafeInsets()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const left = Math.max(0, insets.left - rect.left)
    const right = Math.max(0, insets.right - (viewportWidth - rect.right))
    const top = Math.max(0, insets.top - rect.top)
    const bottom = Math.max(0, insets.bottom - (viewportHeight - rect.bottom))

    return {
      windowWidth: stageWidth,
      windowHeight: stageHeight,
      pixelRatio: window.devicePixelRatio || 1,
      safeArea: {
        left: left,
        top: top,
        right: Math.max(left, stageWidth - right),
        bottom: Math.max(top, stageHeight - bottom),
        width: Math.max(0, stageWidth - left - right),
        height: Math.max(0, stageHeight - top - bottom),
      },
    }
  }

  function makeTouch(e) {
    const rect = mainCanvas ? mainCanvas.getBoundingClientRect() : { left: 0, top: 0 }
    const x = Math.max(0, Math.min(stageWidth, e.clientX - rect.left))
    const y = Math.max(0, Math.min(stageHeight, e.clientY - rect.top))
    return {
      identifier: e.pointerId === undefined ? 0 : e.pointerId,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
    }
  }

  function attach(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (activePointer !== null) return
      activePointer = e.pointerId
      if (e.cancelable) e.preventDefault()
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch (err) {
        // 部分浏览器对合成事件不支持 pointer capture。
      }
      const t = makeTouch(e)
      emit(TOUCH.start, { touches: [t], changedTouches: [t] })
    })

    canvas.addEventListener('pointermove', (e) => {
      if (activePointer !== e.pointerId) return
      if (e.cancelable) e.preventDefault()
      const t = makeTouch(e)
      emit(TOUCH.move, { touches: [t], changedTouches: [t] })
    })

    function finish(e, type) {
      if (activePointer !== e.pointerId) return
      activePointer = null
      const t = makeTouch(e)
      emit(TOUCH[type], { touches: [], changedTouches: [t] })
    }

    canvas.addEventListener('pointerup', (e) => finish(e, 'end'))
    canvas.addEventListener('pointercancel', (e) => finish(e, 'cancel'))
    canvas.addEventListener('lostpointercapture', (e) => {
      if (activePointer !== e.pointerId) return
      activePointer = null
      const t = makeTouch(e)
      emit(TOUCH.cancel, { touches: [], changedTouches: [t] })
    })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  function createCanvas() {
    created += 1
    if (created === 1) {
      const canvas = document.createElement('canvas')
      canvas.style.cssText =
        'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
        'display:block;touch-action:none;z-index:2;background:#0a1118;'
      document.body.appendChild(canvas)
      mainCanvas = canvas
      layoutCanvas()
      attach(canvas)
      return canvas
    }
    return document.createElement('canvas')
  }

  function resolveAsset(src) {
    if (typeof src !== 'string' || src === '') return src
    if (/^(https?:|data:|blob:|file:)/i.test(src)) return src
    return new URL(src, document.baseURI).href
  }

  function showToast(message) {
    if (!message) return
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.setAttribute('role', 'status')
      toastEl.style.cssText =
        'position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));' +
        'z-index:80;max-width:min(86vw,380px);padding:10px 16px;border-radius:999px;' +
        'background:rgba(9,17,27,.94);border:1px solid rgba(120,170,220,.26);' +
        'color:#eaf3ff;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",' +
        '"Noto Sans SC","Microsoft YaHei",sans-serif;text-align:center;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:0;' +
        'transform:translate(-50%,8px);transition:opacity .2s ease,transform .2s ease;' +
        'pointer-events:none;white-space:normal;word-break:break-word;'
      document.body.appendChild(toastEl)
    }
    toastEl.textContent = String(message)
    toastEl.style.opacity = '1'
    toastEl.style.transform = 'translate(-50%,0)'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      if (!toastEl) return
      toastEl.style.opacity = '0'
      toastEl.style.transform = 'translate(-50%,8px)'
    }, 2400)
  }

  function fallbackCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast('链接已复制，发给朋友一起玩吧'),
        () => showToast(text)
      )
      return
    }
    showToast(text)
  }

  function shareGame(opts) {
    const title = (opts && opts.title) || document.title
    const url = location.href
    const data = { title: title, text: title, url: url }

    if (navigator.share) {
      navigator.share(data).catch((err) => {
        if (err && err.name === 'AbortError') return
        fallbackCopy(url)
      })
      return
    }
    fallbackCopy(url)
  }

  function requestWakeLock() {
    if (!keepScreenOn || wakeLock || document.hidden) return
    if (!navigator.wakeLock || !navigator.wakeLock.request) return
    try {
      navigator.wakeLock.request('screen').then(
        (lock) => {
          wakeLock = lock
          lock.addEventListener('release', () => {
            wakeLock = null
          })
        },
        () => {}
      )
    } catch (err) {
      // 不支持 Wake Lock 时忽略。
    }
  }

  function scheduleResize() {
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      layoutCanvas()
      emit(RESIZE, { size: windowInfo() })
    })
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
      try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
      } catch (err) {
        // 隐私模式或存储已满时不影响游戏运行。
      }
    },
    getStorageSync(key) {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key)
        if (raw == null) return ''
        try {
          return JSON.parse(raw)
        } catch (err) {
          return ''
        }
      } catch (err) {
        return ''
      }
    },
    removeStorageSync(key) {
      try {
        localStorage.removeItem(STORAGE_PREFIX + key)
      } catch (err) {
        // 忽略。
      }
    },

    createInnerAudioContext() {
      const el = new Audio()
      el.preload = 'auto'
      const ctx = {
        autoplay: false,
        obeyMuteSwitch: true,
        _src: '',
        get src() {
          return this._src
        },
        set src(value) {
          this._src = value
          try {
            el.src = resolveAsset(value)
            el.load()
          } catch (err) {
            // 资源不可用时保持静音，不阻断游戏。
          }
        },
        get loop() {
          return el.loop
        },
        set loop(value) {
          el.loop = !!value
        },
        get volume() {
          return el.volume
        },
        set volume(value) {
          el.volume = Math.max(0, Math.min(1, Number(value) || 0))
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
          const promise = el.play()
          if (promise && promise.catch) promise.catch(() => {})
        },
        pause() {
          el.pause()
        },
        stop() {
          el.pause()
          try {
            el.currentTime = 0
          } catch (err) {
            // 忽略。
          }
        },
        seek(position) {
          try {
            el.currentTime = Math.max(0, Number(position) || 0)
          } catch (err) {
            // 忽略。
          }
        },
        destroy() {
          el.pause()
          el.removeAttribute('src')
          try {
            el.load()
          } catch (err) {
            // 忽略。
          }
        },
        onError(fn) {
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
      }
      return ctx
    },

    setInnerAudioOption() {},
    vibrateShort() {
      if (navigator.vibrate) {
        try {
          navigator.vibrate(12)
        } catch (err) {
          // 忽略。
        }
      }
    },
    setKeepScreenOn(opts) {
      keepScreenOn = !!(opts && opts.keepScreenOn)
      if (keepScreenOn) requestWakeLock()
    },
    shareAppMessage(opts) {
      shareGame(opts)
    },
    onShareAppMessage() {},
    showShareMenu() {},
    showToast(opts) {
      showToast(typeof opts === 'string' ? opts : opts && opts.title)
    },
  }

  window.wx = wx

  document.addEventListener('visibilitychange', () => {
    emit(document.hidden ? HIDE : SHOW)
    if (!document.hidden) requestWakeLock()
  })

  window.addEventListener('pagehide', () => {
    emit(HIDE)
  })

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) emit(SHOW)
  })

  window.addEventListener('resize', scheduleResize)
  window.addEventListener('orientationchange', () => {
    setTimeout(scheduleResize, 180)
  })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleResize)
  }

  document.addEventListener('pointerdown', requestWakeLock, { passive: true })
  document.addEventListener('gesturestart', (e) => e.preventDefault())
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false })
})()
