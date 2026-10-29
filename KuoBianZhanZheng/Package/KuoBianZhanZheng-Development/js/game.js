import { CFG, COLORS, GAME_TITLE, LEVELS, TROOP_TIERS } from './config'
import {
  TAU,
  clamp,
  rand,
  randInt,
  dist,
  pointsInRect,
  setFont,
  fillRoundRect,
  strokeRoundRect,
  fillCircle,
  pruneDead,
  formatNumber,
  segmentHitsCircle,
  segmentHitsRect,
} from './utils'
import {
  loadSave,
  writeSave,
  loadCampaign,
  writeCampaign,
  clearCampaign,
  loadCheckpoint,
  writeCheckpoint,
  clearCheckpoint,
} from './storage'
import {
  createBackground,
  drawEmblem,
  drawCover,
  drawBushes,
  drawGrenade,
  drawUnitBadge,
} from './draw'
import { Unit } from './unit'
import { Enemy } from './enemy'
import { Arrow } from './arrow'
import { Crate } from './crate'
import { Effects } from './effects'
import { Bgm, Sfx } from './audio'

export class Game {
  constructor() {
    this.canvas = wx.createCanvas()
    this.ctx = this.canvas.getContext('2d')

    this.W = 375
    this.H = 667
    this.dpr = 1
    this.safeTop = 0
    this.safeBottom = 0
    this.playTop = 64
    this.playBottom = 560
    this.bgCanvas = null

    this.save = loadSave()
    this.resume = loadCampaign()
    this.checkpoint = loadCheckpoint()
    this.audio = new Bgm(this.save.musicOn !== false)
    this.sfx = new Sfx(this.save.sfxOn !== false)
    this.sfxUnlocked = false
    this.settingsOpen = false
    this.aboutOpen = false
    this.state = 'menu'
    this.levelMode = true
    this.level = 1
    this.victory = false
    this.mapDecor = null
    this.levelReserve = 0
    this.levelEnemyTotal = 0
    this.levelEnemyTroops = 0
    this.baseActivated = false
    this.releaseTimer = 0
    this.departments = []
    this.levelMidY = 0
    this.levelGateX = 0
    this.time = 0
    this.shake = 0
    this.lastVibrate = 0

    this.fx = new Effects()
    this.units = []
    this.enemies = []
    this.arrows = []
    this.crates = []
    this.covers = []
    this.grenades = []
    this.bushes = []
    this._units = []
    this.flow = null
    this.flowTimer = 0

    this.formation = this.buildFormation(
      CFG.squad.maxUnits,
      CFG.squad.formationX,
      CFG.squad.formationY
    )
    this.freeSlots = []
    this.target = { x: this.W / 2, y: this.H * 0.55 }
    this.drag = null

    this.wave = 0
    this.wavePhase = 'prep'
    this.waveTimer = 0
    this.spawnQueue = []
    this.spawnTimer = 0
    this.spawnInterval = CFG.wave.spawnBase
    this.score = 0
    this.kills = 0
    this.merit = CFG.merit.start
    this.meritTimer = CFG.merit.passiveInterval
    this.meritProgress = 0
    this.coins = 0
    this.weaponMode = null
    this.weaponUnit = null
    this.weaponTimer = 0
    this.peakTroops = 0
    this.newBest = false
    this.newTroopBest = false
    this.banner = null
    this.levelNotice = null
    this.cardFlash = TROOP_TIERS.map(() => 0)
    this.panelMsg = null

    this.resize()
    this.bindInput()
    this.bindLifecycle()
    this.loadEmblem()
    this.loadGrass()
    this.loadShrub()

    if (wx.onShareAppMessage) {
      try {
        wx.onShareAppMessage(() => ({ title: this.shareTitle() }))
      } catch (e) {
        // 分享能力不可用时忽略
      }
    }
    if (wx.showShareMenu) {
      try {
        wx.showShareMenu({ withShareTicket: false })
      } catch (e) {
        // 忽略
      }
    }

    this.last = Date.now()
    this.tick = this.tick.bind(this)
    this.audio.playMenu()
    requestAnimationFrame(this.tick)
  }

  // ---------- 基础 ----------

  loadEmblem() {
    if (typeof wx === 'undefined' || !wx.createImage) return
    try {
      const img = wx.createImage()
      img.onload = () => {
        this.emblemImage = img
        this.emblemReady = true
      }
      img.onerror = () => {
        this.emblemReady = false
      }
      let src = 'assets/images/emblem.png'
      if (
        typeof location !== 'undefined' &&
        location.pathname &&
        location.pathname.indexOf('/dev/') !== -1
      ) {
        src = '/' + src
      }
      img.src = src
    } catch (e) {
      this.emblemReady = false
    }
  }

  loadGrass() {
    if (typeof wx === 'undefined' || !wx.createImage) return
    try {
      const img = wx.createImage()
      img.onload = () => {
        this.grassImage = img
        this.grassReady = true
      }
      img.onerror = () => {
        this.grassReady = false
      }
      let src = 'assets/images/grass.png'
      if (
        typeof location !== 'undefined' &&
        location.pathname &&
        location.pathname.indexOf('/dev/') !== -1
      ) {
        src = '/' + src
      }
      img.src = src
    } catch (e) {
      this.grassReady = false
    }
  }

  loadShrub() {
    if (typeof wx === 'undefined' || !wx.createImage) return
    try {
      const img = wx.createImage()
      img.onload = () => {
        this.shrubImage = img
        this.shrubReady = true
      }
      img.onerror = () => {
        this.shrubReady = false
      }
      let src = 'assets/images/shrub.png'
      if (
        typeof location !== 'undefined' &&
        location.pathname &&
        location.pathname.indexOf('/dev/') !== -1
      ) {
        src = '/' + src
      }
      img.src = src
    } catch (e) {
      this.shrubReady = false
    }
  }

  resize() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.W = info.windowWidth || 375
    this.H = info.windowHeight || 667
    this.dpr = Math.min(info.pixelRatio || 1, 2)

    const sa = info.safeArea
    this.safeTop = sa && typeof sa.top === 'number' ? Math.max(0, sa.top) : 0
    this.safeBottom =
      sa && typeof sa.bottom === 'number' ? Math.max(0, this.H - sa.bottom) : 0
    this.playTop = this.safeTop + 62

    this.canvas.width = Math.round(this.W * this.dpr)
    this.canvas.height = Math.round(this.H * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.bgCanvas = createBackground(this.W, this.H, this.dpr)

    this.playBottom = this.troopPanelLayout().panel.y - 10
    this.flow = null
    this.flowGrid = null

    if (this.covers && this.covers.length) {
      for (let i = 0; i < this.covers.length; i++) {
        const c = this.covers[i]
        const hw = c.shape === 'rect' ? c.w / 2 : c.r
        const hh = c.shape === 'rect' ? c.h / 2 : c.r
        c.x = clamp(c.x, hw + 20, this.W - hw - 20)
        c.y = clamp(
          c.y,
          this.playTop + hh + 20,
          this.playBottom - hh - 20
        )
      }
    }

    if (this.target) {
      this.target.x = clamp(this.target.x, 30, this.W - 30)
      this.target.y = clamp(
        this.target.y,
        this.playTop + 20,
        this.playBottom - 20
      )
    }
    this.drag = null
  }

  // 居中的 5 列编制阵型，按距中心远近分配槽位
  buildFormation(n, sx, sy) {
    const cols = 5
    const rows = Math.ceil(n / cols)
    const slots = []
    for (let i = 0; i < n; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = (col - (cols - 1) / 2) * sx
      const y = (row - (rows - 1) / 2) * sy
      slots.push({ x, y, d: x * x + y * y })
    }
    slots.sort((a, b) => a.d - b.d)
    return slots.map((s) => ({ x: s.x, y: s.y }))
  }

  // 本局随机生成掩体（房屋 + 石块/沙袋），避开玩家出生区域和彼此
  makeCovers() {
    const out = []
    const C = CFG.covers
    const top = this.playTop + C.margin
    const bottom = this.playBottom - C.margin
    const cx = this.W / 2
    const cy = (this.playTop + this.playBottom) / 2

    // 先生成房屋（矩形碰撞）
    for (let i = 0; i < C.houses; i++) {
      for (let attempt = 0; attempt < 160; attempt++) {
        const w = rand(C.houseMinW, C.houseMaxW)
        const h = rand(C.houseMinH, C.houseMaxH)
        const x = rand(w / 2 + 20, this.W - w / 2 - 20)
        const yTop = top + h / 2
        const yBottom = Math.max(yTop + 1, bottom - h / 2)
        const y = rand(yTop, yBottom)
        if (dist(x, y, cx, cy) < C.centerClear + Math.min(w, h) / 2) continue

        const candidate = {
          shape: 'rect',
          x,
          y,
          w,
          h,
          kind: 'house',
          phase: Math.random() * TAU,
        }

        let ok = true
        for (let j = 0; j < out.length; j++) {
          if (this.coversOverlap(candidate, out[j], C.minGap)) {
            ok = false
            break
          }
        }
        if (!ok) continue

        out.push(candidate)
        break
      }
    }

    // 再生成沙袋掩体
    for (let i = 0; i < C.count; i++) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const r = rand(C.minRadius, C.maxRadius)
        const x = rand(r + 20, this.W - r - 20)
        const y = rand(top + r, Math.max(top + r + 1, bottom - r))
        if (dist(x, y, cx, cy) < C.centerClear + r) continue

        const candidate = {
          shape: 'circle',
          x,
          y,
          r,
          kind: 'sandbag',
          phase: Math.random() * TAU,
        }

        let ok = true
        for (let j = 0; j < out.length; j++) {
          if (this.coversOverlap(candidate, out[j], C.minGap)) {
            ok = false
            break
          }
        }
        if (!ok) continue

        out.push(candidate)
        break
      }
    }

    return out
  }

  bindInput() {
    wx.onTouchStart((e) => this.onTouchStart(e))
    wx.onTouchMove((e) => this.onTouchMove(e))
    wx.onTouchEnd((e) => this.onTouchEnd(e))
    if (wx.onTouchCancel) {
      wx.onTouchCancel(() => {
        this.drag = null
      })
    }
  }

  bindLifecycle() {
    if (wx.onHide) {
      wx.onHide(() => {
        if (this.state === 'playing') this.state = 'paused'
        this.drag = null
        this.audio.pause()
        this.saveCampaign()
      })
    }
    if (wx.onShow) {
      wx.onShow(() => {
        this.last = Date.now()
      })
    }
    if (wx.onWindowResize) {
      wx.onWindowResize(() => this.resize())
    }
    if (wx.setKeepScreenOn) {
      try {
        wx.setKeepScreenOn({ keepScreenOn: true })
      } catch (e) {
        // 忽略
      }
    }
  }

  tick() {
    const now = Date.now()
    let dt = (now - this.last) / 1000
    this.last = now
    if (!(dt > 0)) dt = 1 / 60
    if (dt > 0.05) dt = 0.05

    this.time += dt
    this.update(dt)
    this.render()
    requestAnimationFrame(this.tick)
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 30)
    this.fx.update(dt)

    if (this.banner) {
      this.banner.life -= dt
      if (this.banner.life <= 0) this.banner = null
    }
    if (this.panelMsg) {
      this.panelMsg.life -= dt
      if (this.panelMsg.life <= 0) this.panelMsg = null
    }
    for (let i = 0; i < this.cardFlash.length; i++) {
      const v = this.cardFlash[i]
      if (v > 0) this.cardFlash[i] = Math.max(0, v - dt * 3)
      else if (v < 0) this.cardFlash[i] = Math.min(0, v + dt * 3)
    }

    if (this.state === 'playing' && !this.levelNotice) this.updatePlay(dt)
  }

  // ---------- 对局流程 ----------

  startTestRun() {
    this.startRun({ level: 29, coins: 2000, merit: 200000 })
  }

  startRun(options = {}) {
    clearCampaign()
    clearCheckpoint()
    this.resume = null
    this.checkpoint = null
    this.state = 'playing'
    this.settingsOpen = false
    this.aboutOpen = false
    this.audio.playBattle()
    this.wave = 0
    this.wavePhase = 'prep'
    this.waveTimer = CFG.wave.prepFirst
    this.spawnQueue = []
    this.spawnTimer = 0
    this.spawnInterval = CFG.wave.spawnBase
    this.score = 0
    this.kills = 0
    this.merit = options.merit === undefined ? CFG.merit.start : options.merit
    this.meritTimer = CFG.merit.passiveInterval
    this.meritProgress = 0
    this.coins = options.coins === undefined ? 0 : options.coins
    this.weaponMode = null
    this.weaponUnit = null
    this.weaponTimer = 0
    this.peakTroops = 0
    this.newBest = false
    this.newTroopBest = false
    this.victory = false
    this.shake = 0
    this.drag = null
    this.panelMsg = null
    this.cardFlash = TROOP_TIERS.map(() => 0)

    this.units.length = 0
    this.enemies.length = 0
    this.arrows.length = 0
    this.crates.length = 0
    this.grenades.length = 0
    this.fx.clear()

    this.freeSlots = this.formation.map((_, i) => i).reverse()
    this.levelMode = true
    this.level = options.level === undefined ? 1 : options.level
    this.victory = false
    this.mapDecor = null
    this.levelReserve = 0
    this.levelEnemyTotal = 0
    this.levelEnemyTroops = 0
    this.baseActivated = false
    this.releaseTimer = 0
    this.departments = []
    this.levelMidY = 0
    this.levelGateX = 0
    this.setupLevel(this.level)
    this.flow = null
    this.flowTimer = 0

    // 初始免费获得一个班，从入口进入基地
    this.addUnit(1, true)
    this.peakTroops = this.totalTroops()
    this.saveLevelCheckpoint()
    this.saveCampaign()
    this.last = Date.now()
  }

  hasResume() {
    return !!(
      this.resume &&
      this.resume.level > 1 &&
      Array.isArray(this.resume.army) &&
      this.resume.army.length > 0
    )
  }

  armySnapshot() {
    const army = []
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      army.push({
        tier: u.tier,
        troops: u.troops,
        troopsMax: u.troopsMax,
        slot: u.slot,
      })
    }
    return army
  }

  saveCampaign() {
    if (!this.levelMode) return
    const army = this.armySnapshot()
    if (army.length === 0) return

    this.resume = {
      level: this.level,
      army,
      merit: this.merit,
      meritProgress: this.meritProgress || 0,
      coins: this.coins,
      score: this.score,
      kills: this.kills,
      peakTroops: this.peakTroops,
    }
    writeCampaign(this.resume)
  }

  // 进入新关卡时记录开场状态；失败重试时恢复这份快照
  saveLevelCheckpoint() {
    if (!this.levelMode) return
    const army = this.armySnapshot()
    if (army.length === 0) return

    this.checkpoint = {
      level: this.level,
      army,
      merit: this.merit,
      meritProgress: this.meritProgress || 0,
      coins: this.coins,
      score: this.score,
      kills: this.kills,
      peakTroops: this.peakTroops,
    }
    writeCheckpoint(this.checkpoint)
  }

  hasLevelCheckpoint() {
    return !!(
      this.checkpoint &&
      this.checkpoint.level === this.level &&
      Array.isArray(this.checkpoint.army) &&
      this.checkpoint.army.length > 0
    )
  }

  // 按快照重建我方编制（等级、当前兵力、编制上限、阵位）
  restoreArmyFrom(army) {
    this.units.length = 0
    const used = new Set()
    for (let i = 0; i < army.length; i++) {
      const spec = army[i]
      let slot = Number.isInteger(spec.slot) ? spec.slot : -1
      if (slot < 0 || slot >= this.formation.length || used.has(slot)) {
        slot = this.formation.findIndex((_, idx) => !used.has(idx))
      }
      if (slot < 0) continue

      const unit = new Unit(
        spec.tier,
        slot,
        this.formation[slot],
        0,
        0,
        spec.troops
      )
      unit.troopsMax = Math.max(spec.troops, spec.troopsMax || spec.troops)
      unit.weapon = 'rifle'
      unit.lastTarget = null
      unit.hidden = false
      this.units.push(unit)
      used.add(slot)
    }

    if (this.units.length === 0) return false
    this.freeSlots = this.formation
      .map((_, i) => i)
      .filter((i) => !used.has(i))
      .reverse()
    return true
  }

  continueRun() {
    const c = loadCampaign() || this.resume
    if (!c || !Array.isArray(c.army) || c.army.length === 0) {
      this.startRun()
      return
    }

    this.state = 'playing'
    this.settingsOpen = false
    this.aboutOpen = false
    this.levelMode = true
    this.level = c.level
    this.victory = false
    this.shake = 0
    this.drag = null
    this.panelMsg = null
    this.cardFlash = TROOP_TIERS.map(() => 0)
    this.newBest = false
    this.newTroopBest = false
    this.weaponMode = null
    this.weaponUnit = null
    this.weaponTimer = 0
    this.mapDecor = null
    this.baseActivated = false
    this.releaseTimer = 0
    this.departments = []
    this.levelReserve = 0
    this.levelEnemyTotal = 0
    this.levelEnemyTroops = 0
    this.levelMidY = 0
    this.levelGateX = 0

    this.merit = c.merit
    this.meritTimer = CFG.merit.passiveInterval
    this.meritProgress = Number.isFinite(c.meritProgress) ? c.meritProgress : 0
    this.coins = Number.isFinite(c.coins) ? c.coins : 0
    this.score = c.score
    this.kills = c.kills
    this.peakTroops = c.peakTroops

    this.units.length = 0
    this.enemies.length = 0
    this.arrows.length = 0
    this.crates.length = 0
    this.grenades.length = 0
    this.fx.clear()

    this.setupLevel(c.level)
    this.flow = null
    this.flowTimer = 0

    if (!this.restoreArmyFrom(c.army)) {
      this.startRun()
      return
    }

    this.placeUnitsAtEntrance()
    this.peakTroops = Math.max(this.peakTroops, this.totalTroops())
    // 若是旧存档没有本关开场快照，就用当前恢复状态补一份；
    // 已有同关快照时保留，失败重试仍回到最初进入本关的状态。
    if (!this.checkpoint || this.checkpoint.level !== c.level) {
      this.saveLevelCheckpoint()
    }
    this.audio.playBattle()
    this.state = 'playing'
    this.last = Date.now()
    this.saveCampaign()
  }

  // 失败后重试本关：恢复到刚进入这一关时的军功、金币、编制和兵力
  retryLevel() {
    const cp =
      this.checkpoint && this.checkpoint.level === this.level
        ? this.checkpoint
        : loadCheckpoint()
    if (
      !cp ||
      cp.level !== this.level ||
      !Array.isArray(cp.army) ||
      cp.army.length === 0
    ) {
      this.continueRun()
      return
    }

    this.checkpoint = cp
    this.state = 'playing'
    this.settingsOpen = false
    this.aboutOpen = false
    this.levelMode = true
    this.level = cp.level
    this.victory = false
    this.shake = 0
    this.drag = null
    this.panelMsg = null
    this.banner = null
    this.levelNotice = null
    this.cardFlash = TROOP_TIERS.map(() => 0)
    this.newBest = false
    this.newTroopBest = false
    this.weaponMode = null
    this.weaponUnit = null
    this.weaponTimer = 0
    this.mapDecor = null
    this.baseActivated = false
    this.releaseTimer = 0
    this.departments = []
    this.levelReserve = 0
    this.levelEnemyTotal = 0
    this.levelEnemyTroops = 0
    this.levelMidY = 0
    this.levelGateX = 0

    this.merit = cp.merit
    this.meritTimer = CFG.merit.passiveInterval
    this.meritProgress = Number.isFinite(cp.meritProgress)
      ? cp.meritProgress
      : 0
    this.coins = Number.isFinite(cp.coins) ? cp.coins : 0
    this.score = cp.score
    this.kills = cp.kills
    this.peakTroops = cp.peakTroops

    this.enemies.length = 0
    this.arrows.length = 0
    this.crates.length = 0
    this.grenades.length = 0
    this.fx.clear()

    this.setupLevel(cp.level)
    this.flow = null
    this.flowTimer = 0

    if (!this.restoreArmyFrom(cp.army)) {
      this.continueRun()
      return
    }

    this.placeUnitsAtEntrance()
    this.peakTroops = Math.max(cp.peakTroops || 0, this.totalTroops())
    this.audio.playBattle()
    this.state = 'playing'
    this.last = Date.now()
    // 快照本身保留，连续失败重试仍然回到同一份开场状态
    this.saveCampaign()
  }

  // 按关卡表生成关卡：基地占场景一半，内部布局随机
  // counts 表示各部数量：班部 1 = 1 个班（12 兵力），不是 12 个班
  setupLevel(level) {
    const levelData = LEVELS[clamp(level - 1, 0, LEVELS.length - 1)]
    const counts = levelData.counts
    this.level = levelData.level
    this.wave = levelData.level
    this.covers = []
    this.flowGrid = null
    this.mapDecor = { zones: [], labels: [] }
    this.levelMode = true
    this.victory = false
    this.departments = []
    this.enemies.length = 0
    this.bushes = []

    const W = this.W
    const left = 12
    const right = W - 12
    const top = this.playTop + 10
    const bottom = this.playBottom - 10
    const wallT = 7
    const scale = clamp(W / 375, 0.8, 1.4)
    const mapH = bottom - top
    const centerX = W / 2
    // 敌军基地占整个游戏场景高度的一半；同时给下半图留出最低限度的进攻空间
    const midY = Math.min(
      top + this.H * 0.5,
      bottom - Math.max(64 * scale, mapH * 0.18)
    )
    this.levelMidY = midY

    const addWall = (x0, y0, x1, y1) => {
      const w = Math.abs(x1 - x0)
      const h = Math.abs(y1 - y0)
      if (w < 1 || h < 1) return
      this.covers.push({
        shape: 'rect',
        kind: 'wall',
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        w,
        h,
        phase: 0,
      })
    }

    // 房间：四面墙，可同时在多个方向留大开口
    const addRoom = (cx, cy, w, h, doorSides, doorW) => {
      const x0 = cx - w / 2
      const x1 = cx + w / 2
      const y0 = cy - h / 2
      const y1 = cy + h / 2
      const sides = Array.isArray(doorSides) ? doorSides : [doorSides]
      const has = (side) => sides.indexOf(side) !== -1
      // 左右侧开口沿 y 轴；上下侧开口沿 x 轴
      const dwSide = Math.min(h * 0.9, Math.max(44, doorW))
      const dwEnd = Math.min(w * 0.55, 70 * scale)

      if (has('top')) {
        addWall(x0, y0, cx - dwEnd / 2, y0 + wallT)
        addWall(cx + dwEnd / 2, y0, x1, y0 + wallT)
      } else {
        addWall(x0, y0, x1, y0 + wallT)
      }

      if (has('bottom')) {
        addWall(x0, y1 - wallT, cx - dwEnd / 2, y1)
        addWall(cx + dwEnd / 2, y1 - wallT, x1, y1)
      } else {
        addWall(x0, y1 - wallT, x1, y1)
      }

      if (has('left')) {
        addWall(x0, y0, x0 + wallT, cy - dwSide / 2)
        addWall(x0, cy + dwSide / 2, x0 + wallT, y1)
      } else {
        addWall(x0, y0, x0 + wallT, y1)
      }

      if (has('right')) {
        addWall(x1 - wallT, y0, x1, cy - dwSide / 2)
        addWall(x1 - wallT, cy + dwSide / 2, x1, y1)
      } else {
        addWall(x1 - wallT, y0, x1, y1)
      }

      return {
        x0: x0 + wallT,
        y0: y0 + wallT,
        x1: x1 - wallT,
        y1: y1 - wallT,
        cx,
        cy,
      }
    }

    // 外围墙 + 底部入口
    addWall(left, top, right, top + wallT)
    addWall(left, top, left + wallT, bottom)
    addWall(right - wallT, top, right, bottom)
    const entranceHalf = Math.min(48 * scale, (right - left) * 0.15)
    addWall(left, bottom - wallT, centerX - entranceHalf, bottom)
    addWall(centerX + entranceHalf, bottom - wallT, right, bottom)

    // 半图分界墙：敌军基地前墙，基地大门位置每局随机
    const gateHalf = Math.min(46 * scale, (right - left) * 0.14)
    const gateX = centerX + rand(-0.09, 0.09) * W
    this.levelGateX = gateX
    addWall(left, midY - wallT / 2, gateX - gateHalf, midY + wallT / 2)
    addWall(gateX + gateHalf, midY - wallT / 2, right, midY + wallT / 2)

    // 敌军基地内部随机布局：
    // 中央通道随大门位置偏移，左右两侧各放两栋班部，
    // 建筑宽度、高度、前后位置、与通道的距离都随机。
    const innerLeft = left + wallT + rand(16, 26) * scale
    const innerRight = right - wallT - rand(16, 26) * scale
    const baseTop = top + wallT + rand(16, 28) * scale
    const baseBottom = midY - wallT / 2 - rand(16, 28) * scale
    const corrHalf = rand(36, 48) * scale
    const corridorLeft = gateX - corrHalf
    const corridorRight = gateX + corrHalf

    // 按关卡表统计存在的部：每个部建筑里驻 1 个对应编制的单位
    const present = []
    let totalUnits = 0
    let totalTroops = 0
    for (let t = 0; t < counts.length; t++) {
      const count = counts[t]
      if (count <= 0) continue
      const info = TROOP_TIERS[t]
      present.push({
        tier: t + 1,
        count,
        name: info.name + '部',
        troops: info.troops,
      })
      totalUnits += count
      totalTroops += count * info.troops
    }
    this.levelEnemyTotal = totalUnits
    this.levelEnemyTroops = totalTroops
    this.levelReserve = totalUnits

    const availH = baseBottom - baseTop

    let columns = [
      {
        x0: innerLeft,
        x1: Math.max(innerLeft + 64 * scale, corridorLeft),
        side: 'right',
      },
      {
        x0: Math.min(innerRight - 64 * scale, corridorRight),
        x1: innerRight,
        side: 'left',
      },
    ]

    // 把各部建筑随机分到左右两列，并随机堆叠顺序、高度、宽度和靠通道程度
    const shuffled = present.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    // 后期部建筑较多。短屏改为四列开放侧门，避免房间纵向挤成负高度。
    const compactBase = availH < Math.ceil(present.length / 2) * 42
    if (compactBase) {
      const passageW = 28
      const columnW = (innerRight - innerLeft - passageW * 3) / 4
      columns = Array.from({ length: 4 }, (_, i) => ({
        x0: innerLeft + i * (columnW + passageW),
        x1: innerLeft + i * (columnW + passageW) + columnW,
        side: i % 2 === 0 ? 'right' : 'left',
      }))
    }
    const sideLists = columns.map(() => [])
    shuffled.forEach((item, i) => sideLists[i % columns.length].push(item))
    if (Math.random() < 0.5) sideLists.reverse()

    const specs = []
    for (let c = 0; c < columns.length; c++) {
      const list = sideLists[c]
      if (list.length === 0) continue

      const col = columns[c]
      const colW = col.x1 - col.x0
      const gap = Math.max(4, Math.min(rand(22, 32) * scale,
        (availH - list.length * 36) / Math.max(1, list.length - 1)))
      const usableH = availH - gap * (list.length - 1)
      const minRoomH = Math.min(36, usableH / list.length)
      const weights = list.map(() => rand(0.8, 1.2))
      const weightSum = weights.reduce((a, b) => a + b, 0)

      let cursor = baseTop
      for (let r = 0; r < list.length; r++) {
        const item = list[r]
        const h = minRoomH + ((usableH - minRoomH * list.length) * weights[r]) / weightSum
        const cy = cursor + h / 2
        cursor += h + gap

        const bw = Math.min(
          colW,
          Math.max(56 * scale, colW * rand(0.66, 0.86))
        )
        const nearCorridor = Math.random() < 0.55
        const bx0 = nearCorridor
          ? col.side === 'right' ? col.x1 - bw : col.x0
          : rand(col.x0, col.x1 - bw)

        // 内侧门不一定保留，部分房间只开上/下方向
        const doorSides = []
        if (compactBase || Math.random() < 0.45) doorSides.push(col.side)

        const endSides = []
        if (r > 0) endSides.push('top')
        if (r < list.length - 1) endSides.push('bottom')
        if (endSides.length > 0) {
          if (Math.random() < 0.75) {
            doorSides.push(endSides[Math.floor(Math.random() * endSides.length)])
          }
          if (endSides.length === 2 && Math.random() < 0.25) {
            const other = endSides[0] === doorSides[doorSides.length - 1]
              ? endSides[1]
              : endSides[0]
            if (doorSides.indexOf(other) === -1) doorSides.push(other)
          }
        }
        if (doorSides.length === 0) {
          doorSides.push(
            endSides.length > 0
              ? endSides[Math.floor(Math.random() * endSides.length)]
              : col.side
          )
        }

        specs.push({
          ...item,
          cx: bx0 + bw / 2,
          cy,
          w: bw,
          h,
          side: col.side,
          doorSides,
        })
      }
    }

    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]
      addRoom(s.cx, s.cy, s.w, s.h, s.doorSides, s.h)
      // 储备兵从真实存在的一个门口出现；优先内侧，没有内侧就走上/下门
      let spawnSide = s.doorSides.indexOf(s.side) !== -1 ? s.side : s.doorSides[0]
      let doorX = s.cx
      let doorY = s.cy
      let nx = 0
      let ny = 0
      if (spawnSide === 'right') {
        doorX = s.cx + s.w / 2
        nx = 1
      } else if (spawnSide === 'left') {
        doorX = s.cx - s.w / 2
        nx = -1
      } else if (spawnSide === 'top') {
        doorY = s.cy - s.h / 2
        ny = -1
      } else {
        doorY = s.cy + s.h / 2
        ny = 1
      }
      this.departments.push({
        cx: s.cx,
        cy: s.cy,
        w: s.w,
        h: s.h,
        tier: s.tier,
        count: s.count,
        name: s.name,
        labelY: s.cy - s.h * 0.3,
        reserveY: s.cy + s.h * 0.36,
        doorX,
        doorY,
        nx,
        ny,
        reserve: Math.max(0, s.count - 1),
      })
      this.levelReserve -= 1 // 屋内先出现的 1 个单位
    }

    this.baseActivated = false
    this.releaseTimer = 0

    // 每个部屋内先出现 1 个对应编制的单位，其余作为储备
    for (let i = 0; i < this.departments.length; i++) {
      const dep = this.departments[i]
      const spawnPadX = Math.max(0, Math.min(5, dep.w / 2 - wallT - 10))
      const spawnPadY = Math.max(0, Math.min(4, dep.h / 2 - wallT - 10))
      const e = new Enemy(
        'grunt',
        dep.cx + rand(-spawnPadX, spawnPadX),
        dep.cy + rand(-spawnPadY, spawnPadY),
        this.level,
        dep.tier
      )
      e.aggro = false
      e.hideBadge = true
      e.homeX = e.x
      e.homeY = e.y
      this.enemies.push(e)
    }

    // 草丛：不阻挡玩家移动，玩家躲进去后敌人会失去锁定；敌人不能进入草丛
    const bushBlocked = (x, y, r) => {
      for (let i = 0; i < this.bushes.length; i++) {
        if (dist(x, y, this.bushes[i].x, this.bushes[i].y) <
            this.bushes[i].r + r + 10 * scale) {
          return true
        }
      }
      // 整个草丛圆范围内都不能和墙壁碰撞体重叠
      for (let i = 0; i < this.covers.length; i++) {
        if (this.coverBlocksPoint(this.covers[i], x, y, r + 5 * scale)) {
          return true
        }
      }
      // 不要挡住部屋门口/基地大门，避免敌人被草丛堵死
      for (let i = 0; i < this.departments.length; i++) {
        const d = this.departments[i]
        if (
          Math.abs(x - d.cx) < d.w / 2 + r * 1.05 + 8 * scale &&
          Math.abs(y - d.cy) < d.h / 2 + r * 1.05 + 8 * scale
        ) {
          return true
        }
      }
      if (
        Math.abs(x - this.levelGateX) <
          gateHalf + r * 1.1 + 14 * scale &&
        Math.abs(y - this.levelMidY) < r * 1.1 + 20 * scale
      ) {
        return true
      }
      return false
    }
    const addBush = (x, y, r, kind) => {
      this.bushes.push({ x, y, r, kind, phase: rand(0, TAU) })
    }

    let bushTries = 0
    let bushCount = 0
    while (bushCount < 4 && bushTries < 220) {
      bushTries += 1
      const kind = this.bushes.length % 2 === 0 ? 'shrub' : 'grass'
      const r = (kind === 'shrub' ? rand(28, 40) : rand(23, 34)) * scale
      const x = rand(left + 40, right - 40)
      const y = rand(midY + 26, bottom - 34)
      if (dist(x, y, centerX, bottom - 40 * scale) < 46 * scale) continue
      if (bushBlocked(x, y, r)) continue
      addBush(x, y, r, kind)
      bushCount += 1
    }

    bushTries = 0
    bushCount = 0
    while (bushCount < 4 && bushTries < 200) {
      bushTries += 1
      const kind = this.bushes.length % 2 === 0 ? 'shrub' : 'grass'
      const r = (kind === 'shrub' ? rand(28, 40) : rand(23, 34)) * scale
      const x = rand(innerLeft + 24 * scale, innerRight - 24 * scale)
      const y = rand(baseTop + 20 * scale, midY - 24 * scale)
      if (bushBlocked(x, y, r)) continue
      addBush(x, y, r, kind)
      bushCount += 1
    }

    // 小屏幕随机布局下，上面的候选点可能全被墙体/房间挤掉；
    // 在下方开阔区兜底补足，保证每局都能看到并利用草丛。
    let fallbackTries = 0
    while (this.bushes.length < 4 && fallbackTries < 500) {
      fallbackTries += 1
      const kind = this.bushes.length % 2 === 0 ? 'shrub' : 'grass'
      const r = (kind === 'shrub' ? rand(24, 32) : rand(20, 27)) * scale
      const x = rand(left + 30, right - 30)
      const y = rand(midY + 34, bottom - 38)
      if (dist(x, y, centerX, bottom - 40 * scale) < 44 * scale) continue
      if (
        Math.abs(x - this.levelGateX) < gateHalf + r + 6 * scale &&
        Math.abs(y - this.levelMidY) < r + 10 * scale
      ) {
        continue
      }
      let blocked = false
      for (let i = 0; i < this.covers.length; i++) {
        if (this.coverBlocksPoint(this.covers[i], x, y, r + 3 * scale)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      for (let i = 0; i < this.bushes.length; i++) {
        const b = this.bushes[i]
        if (dist(x, y, b.x, b.y) < b.r + r + 6 * scale) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      addBush(x, y, r, kind)
    }

    // 下半图：玩家进攻区、巡逻区
    const lowerTop = midY + wallT / 2 + 10
    const lowerH = bottom - lowerTop
    const zones = [
      { x: W * 0.12, y: lowerTop + lowerH * 0.14, w: W * 0.27, h: lowerH * 0.26 },
      { x: W * 0.61, y: lowerTop + lowerH * 0.14, w: W * 0.27, h: lowerH * 0.26 },
    ]
    this.mapDecor.zones = zones

    const labels = [
      { text: '敌军基地', x: centerX, y: top + wallT + 8, size: 9 },
      { text: '入口', x: centerX, y: bottom + 2, size: 10 },
    ]
    for (let i = 0; i < zones.length; i++) {
      labels.push({
        text: '巡逻区',
        x: zones[i].x + zones[i].w / 2,
        y: zones[i].y + zones[i].h / 2,
        size: 10,
      })
    }
    this.mapDecor.labels = labels


    this.target.x = centerX
    this.target.y = bottom - 8 * scale
    this.assignEnemyWeapons()

    this.banner = {
      text: `第${this.level}关`,
      sub: `敌军 ${totalUnits} 部 · 总兵力 ${formatNumber(totalTroops)}`,
      life: 2.8,
      max: 2.8,
      color: '#eaf3ff',
    }

    const notices = {
      20: {
        text: '强力机枪敌人来袭',
        sub: '从本关开始，部分敌军会使用机枪扫射',
        color: '#ffcf6a',
      },
      30: {
        text: '强力手雷敌人来袭',
        sub: '从本关开始，部分敌军会投掷手雷',
        color: '#ff9f7a',
      },
      40: {
        text: '强力迫击炮敌人来袭',
        sub: '从本关开始，部分敌军会使用迫击炮',
        color: '#ff7a7a',
      },
    }
    this.levelNotice = notices[this.level] || null
  }

  // 只补发空缺武器；受伤、增援不会抢走仍存活持有者的装备。
  assignEnemyWeapons() {
    const modes = !this.levelMode || this.level < 20 ? []
      : this.level < 30 ? ['mg']
        : this.level < 40 ? ['grenade', 'mg'] : ['mortar', 'grenade', 'mg']
    const alive = this.enemies.filter(e => !e.dead && e.troops > 0)
    const held = new Set()
    for (const enemy of alive) {
      if (modes.includes(enemy.weapon) && !held.has(enemy.weapon)) {
        held.add(enemy.weapon)
      } else enemy.weapon = 'rifle'
    }
    const candidates = alive.filter(e => e.weapon === 'rifle')
      .sort((a, b) => b.troops - a.troops)
    for (const mode of modes) {
      if (held.has(mode)) continue
      const enemy = candidates.shift()
      if (!enemy) break
      enemy.weapon = mode
      enemy.cool = Math.min(enemy.cool, CFG.weapons[mode].interval)
    }
  }

  levelEnemiesRemaining() {
    let alive = 0
    for (let i = 0; i < this.enemies.length; i++) {
      if (!this.enemies[i].dead) alive += 1
    }
    return this.levelReserve + alive
  }

  levelEnemyTroopsRemaining() {
    let sum = 0
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (!e.dead) sum += e.troops
    }
    for (let i = 0; i < this.departments.length; i++) {
      const dep = this.departments[i]
      if (dep.reserve > 0) {
        sum += dep.reserve * TROOP_TIERS[dep.tier - 1].troops
      }
    }
    return sum
  }

  activateBase() {
    if (this.baseActivated) return
    this.baseActivated = true
    this.releaseTimer = 0.35
    // 基地激活后，屋内驻军一起出击
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].aggro = true
      this.enemies[i].hideBadge = false
    }
    this.banner = {
      text: '敌军出击',
      sub: '清剿班部，消灭基地内的全部敌军',
      life: 1.8,
      max: 1.8,
      color: '#ffb4a8',
    }
  }

  updateLevelSpawns(dt) {
    if (!this.baseActivated) {
      // 以指挥目标点是否进入基地为准，避免出生编队前排单位刚生成就触发敌军
      if (this.target.y < this.levelMidY + 20) this.activateBase()
      if (!this.baseActivated) return
    }

    if (this.levelReserve <= 0) return

    this.releaseTimer -= dt
    if (this.releaseTimer > 0) return

    let alive = 0
    for (let i = 0; i < this.enemies.length; i++) {
      if (!this.enemies[i].dead) alive += 1
    }
    if (alive >= CFG.level.activeCap) {
      this.releaseTimer = 0.25
      return
    }

    const batch = Math.max(1, CFG.level.spawnBatch || 1)
    let spawned = 0
    for (let n = 0; n < batch; n++) {
      if (alive + spawned >= CFG.level.activeCap) break

      const candidates = []
      for (let i = 0; i < this.departments.length; i++) {
        const dep = this.departments[i]
        if (dep.reserve > 0) candidates.push(dep)
      }
      if (candidates.length === 0) {
        this.levelReserve = 0
        break
      }

      const dep = candidates[randInt(0, candidates.length - 1)]
      this.spawnDepartmentEnemy(dep, false)
      spawned += 1
    }

    if (spawned > 0) this.releaseTimer = CFG.level.spawnInterval
    else this.releaseTimer = 0.25
  }

  spawnDepartmentEnemy(dep, idle) {
    if (!dep || dep.reserve <= 0) return null

    const x = dep.doorX + dep.nx * 20 + rand(-4, 4)
    const y = dep.doorY + dep.ny * 20 + rand(-4, 4)
    const e = new Enemy('grunt', x, y, this.level, dep.tier)
    e.aggro = !idle
    e.homeX = x
    e.homeY = y
    this.enemies.push(e)

    dep.reserve -= 1
    this.levelReserve = Math.max(0, this.levelReserve - 1)
    this.assignEnemyWeapons()
    this.fx.ring(x, y, '#ff8a80', 2, 18, 0.35)
    return e
  }

  addUnit(tierLevel, free) {
    if (this.units.length >= CFG.squad.maxUnits) return false

    const info = TROOP_TIERS[tierLevel - 1]
    const slot = this.freeSlots.pop()
    if (slot === undefined) return false

    const off = this.formation[slot]
    const x = this.target.x + off.x + rand(-6, 6)
    const y = this.target.y + off.y + rand(-6, 6)
    const unit = new Unit(tierLevel, slot, off, x, y)
    this.resolveCoverCollision(unit)
    unit.x = clamp(unit.x, 16, this.W - 16)
    unit.y = clamp(unit.y, this.playTop + 8, this.playBottom - 12)
    this.units.push(unit)

    this.peakTroops = Math.max(this.peakTroops, this.totalTroops())

    this.fx.ring(unit.x, unit.y, info.color, 4, 34, 0.45)
    this.fx.spark(unit.x, unit.y, info.color, free ? 6 : 10, 120)
    this.fx.text(
      unit.x, unit.y - unit.r - 27,
      `+${formatNumber(info.troops)} 兵力`,
      info.color, 13, 0.9
    )
    this.shake = Math.min(5, this.shake + 0.8)
    if (!free) this.vibrate()
    return true
  }

  onRecruitTap(index) {
    const info = TROOP_TIERS[index]

    if (this.units.length >= CFG.squad.maxUnits) {
      this.cardFlash[index] = -0.45
      this.showPanelMsg('编制已满 · 最多 20 个单位', COLORS.danger)
      this.vibrate()
      return
    }
    if (this.merit < info.cost) {
      this.cardFlash[index] = -0.45
      this.showPanelMsg(
        `军功不足 · 还需 ${formatNumber(info.cost - this.merit)}`,
        COLORS.danger
      )
      this.vibrate()
      return
    }

    this.merit -= info.cost
    if (this.addUnit(info.level, false)) {
      this.cardFlash[index] = 0.45
      this.tryMergePlayer()
    } else {
      this.merit += info.cost
    }
  }

  // 三个同等级的我方单位自动合成一个下一级单位，兵力相加
  tryMergePlayer() {
    if (!CFG.merge.player) return false
    const req = Math.max(2, CFG.merge.required)
    let didAny = false
    let guard = 0

    while (guard++ < 100) {
      let did = false
      for (let tier = 1; tier < TROOP_TIERS.length; tier++) {
        const group = []
        for (let i = 0; i < this.units.length; i++) {
          const u = this.units[i]
          if (!u.dead && u.tier === tier) {
            group.push(u)
            if (group.length >= req) break
          }
        }
        if (group.length >= req) {
          this.mergePlayerUnits(group.slice(0, req))
          did = true
          didAny = true
          break
        }
      }
      if (!did) break
    }
    return didAny
  }

  mergePlayerUnits(group) {
    const tier = group[0].tier
    const activeInGroup =
      !!this.weaponUnit && group.indexOf(this.weaponUnit) !== -1
    const inheritWeapon =
      activeInGroup && this.weaponMode ? this.weaponMode : 'rifle'
    let sum = 0
    let cx = 0
    let cy = 0

    for (let i = 0; i < group.length; i++) {
      const u = group[i]
      sum += u.troops
      cx += u.x
      cy += u.y
      u.dead = true
      this.freeSlots.push(u.slot)
    }
    cx /= group.length
    cy /= group.length
    pruneDead(this.units)

    const slot = this.freeSlots.pop()
    if (slot === undefined) return

    const mx = clamp(cx, 30, this.W - 30)
    const my = clamp(cy, this.playTop + 30, this.playBottom - 30)
    const merged = new Unit(
      tier + 1,
      slot,
      this.formation[slot],
      mx,
      my,
      sum
    )
    merged.weapon = inheritWeapon
    if (activeInGroup) this.weaponUnit = merged
    this.resolveCoverCollision(merged)
    merged.x = clamp(merged.x, 16, this.W - 16)
    merged.y = clamp(merged.y, this.playTop + 8, this.playBottom - 12)
    this.units.push(merged)

    this.fx.ring(merged.x, merged.y, merged.tierColor, 8, 52, 0.5)
    this.fx.spark(merged.x, merged.y, merged.tierColor, 16, 170)
    this.fx.text(
      merged.x, merged.y - 32,
      `合体 · ${merged.tierName} ${formatNumber(sum)}`,
      merged.tierColor, 15, 1.1
    )
    this.shake = Math.min(8, this.shake + 2)
    this.vibrate()
  }

  // 敌方按「同兵种 + 同等级」三个合成一个下一级单位
  tryMergeEnemies() {
    if (!CFG.merge.enemy) return false
    const req = Math.max(2, CFG.merge.required)
    let didAny = false
    let guard = 0

    while (guard++ < 200) {
      let did = false
      const groups = {}

      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (e.dead || e.tier >= TROOP_TIERS.length) continue
        const key = `${e.type}|${e.tier}`
        if (!groups[key]) groups[key] = []
        if (groups[key].length < req) groups[key].push(e)
      }

      for (const key in groups) {
        if (groups[key].length >= req) {
          this.mergeEnemyUnits(groups[key].slice(0, req))
          did = true
          didAny = true
          break
        }
      }
      if (!did) break
    }
    return didAny
  }

  mergeEnemyUnits(group) {
    const tier = group[0].tier
    const type = group[0].type
    let sum = 0
    let cx = 0
    let cy = 0

    for (let i = 0; i < group.length; i++) {
      const e = group[i]
      sum += e.troops
      cx += e.x
      cy += e.y
      e.dead = true
    }
    cx /= group.length
    cy /= group.length
    pruneDead(this.enemies)

    const merged = new Enemy(type, cx, cy, this.wave, tier + 1, sum)
    this.resolveCoverCollision(merged)
    this.enemies.push(merged)

    this.fx.ring(merged.x, merged.y, merged.tierColor, 8, 52, 0.5)
    this.fx.spark(merged.x, merged.y, merged.tierColor, 12, 150)
    this.fx.text(
      merged.x, merged.y - 32,
      `合体 · ${merged.tierName} ${formatNumber(sum)}`,
      merged.tierColor, 14, 1.0
    )
  }

  showPanelMsg(text, color) {
    this.panelMsg = { text, color: color || COLORS.text, life: 1.3 }
  }

  totalTroops() {
    let sum = 0
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (!u.dead) sum += u.troops
    }
    return sum
  }

  totalEnemyTroops() {
    let sum = 0
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (!e.dead) sum += e.troops
    }
    return sum
  }

  // 当前兵力最多的 Actor
  strongestUnit() {
    let best = null
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      if (!best || u.troops > best.troops) best = u
    }
    return best
  }

  highestTier() {
    let tier = 0
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (!u.dead && u.tier > tier) tier = u.tier
    }
    return tier
  }

  updatePlay(dt) {
    pruneDead(this.units)
    pruneDead(this.enemies)
    pruneDead(this.arrows)

    this.updateUnitStealth()
    this.updateWeaponMode(dt)
    this.updatePassiveMerit(dt)
    if (!this.levelMode) this.updateWaves(dt)
    else this.updateLevelSpawns(dt)
    this.assignEnemyWeapons()

    for (let i = 0; i < this.units.length; i++) {
      this.units[i].update(dt, this)
    }
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      this.resolveCoverCollision(u)
      u.x = clamp(u.x, 16, this.W - 16)
      u.y = clamp(u.y, this.playTop + 8, this.playBottom - 12)
    }
    pruneDead(this.units)

    this.updateUnitStealth()

    this.flowTimer -= dt
    if (this.flowTimer <= 0) this.rebuildFlow()

    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(dt, this)
    }
    this.separateEnemies()
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead) continue
      this.resolveCoverCollision(e)
    }
    pruneDead(this.enemies)

    for (let i = 0; i < this.arrows.length; i++) {
      this.arrows[i].update(dt, this)
    }
    pruneDead(this.arrows)

    for (let i = 0; i < this.grenades.length; i++) {
      const gr = this.grenades[i]
      if (gr.dead) continue
      gr.t += dt
      if (gr.t >= gr.dur) {
        gr.dead = true
        this.explodeGrenade(gr)
      }
    }
    pruneDead(this.grenades)

    this.updateCrates()

    this.peakTroops = Math.max(this.peakTroops, this.totalTroops())

    if (this.units.length === 0) {
      this.gameOver()
      return
    }
    if (this.levelMode && this.levelReserve === 0 && this.enemies.length === 0) {
      this.levelVictory()
    }
  }

  separateEnemies() {
    const es = this.enemies
    for (let i = 0; i < es.length; i++) {
      const a = es[i]
      if (a.dead) continue
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j]
        if (b.dead) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const min = (a.cr || a.r) + (b.cr || b.r)
        const d2 = dx * dx + dy * dy
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2)
          const push = (min - d) * 0.5
          const nx = dx / d
          const ny = dy / d
          a.x -= nx * push
          a.y -= ny * push
          b.x += nx * push
          b.y += ny * push
        }
      }
    }
  }

  // ---------- 波次 ----------

  updateWaves(dt) {
    if (this.wavePhase === 'prep') {
      this.waveTimer -= dt
      if (this.waveTimer <= 0) this.startWave()
      return
    }

    if (this.wavePhase === 'spawning') {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0 && this.spawnQueue.length > 0) {
        if (this.enemies.length < CFG.enemy.maxAlive) {
          this.spawnEnemy(this.spawnQueue.shift())
          this.spawnTimer = this.spawnInterval
        } else {
          this.spawnTimer = 0.25
        }
      }
      if (this.spawnQueue.length === 0) this.wavePhase = 'clearing'
      return
    }

    if (this.wavePhase === 'clearing' && this.enemies.length === 0) {
      this.waveCleared()
    }
  }

  startWave() {
    this.wave += 1
    const n = this.wave
    this.wavePhase = 'spawning'
    this.spawnQueue = this.buildWave(n)
    this.spawnInterval = Math.max(
      CFG.wave.minSpawn,
      CFG.wave.spawnBase - n * CFG.wave.spawnDecay
    )
    this.spawnTimer = this.spawnInterval

    if (this.spawnQueue.length > 0) {
      this.spawnEnemy(this.spawnQueue.shift())
    }

    const tier = this.enemyTierForWave(n)
    const tierName = TROOP_TIERS[tier - 1].name
    this.banner = {
      text: `第 ${n} 波`,
      sub: n % 5 === 0
        ? `敌军编制 · ${tierName} · 重装兵来袭`
        : `敌军编制 · ${tierName}`,
      life: 1.6,
      max: 1.6,
      color: n % 5 === 0 ? '#ffb4a8' : '#eaf3ff',
    }
  }

  enemyTierForWave(wave) {
    const step = Math.max(1, CFG.enemy.tierEveryWaves)
    return Math.min(
      CFG.enemy.maxTier,
      1 + Math.floor((wave - 1) / step)
    )
  }

  buildWave(n) {
    const baseCount =
      CFG.wave.countBase + Math.round(CFG.wave.countGrowth * (n - 1))
    const count = Math.min(
      CFG.wave.maxCountPerWave,
      Math.round(baseCount * CFG.wave.countMultiplier)
    )

    const bruteChance = n >= 5 ? Math.min(0.26, 0.12 + (n - 5) * 0.02) : 0
    const runnerChance = n >= 2 ? Math.min(0.42, 0.24 + (n - 2) * 0.015) : 0

    const queue = []
    for (let i = 0; i < count; i++) {
      const r = Math.random()
      if (r < bruteChance) queue.push('brute')
      else if (r < bruteChance + runnerChance) queue.push('runner')
      else queue.push('grunt')
    }
    return queue
  }

  spawnEnemy(type) {
    const pad = 34
    let x
    let y
    const edge = randInt(0, 3)

    if (edge === 0) {
      x = rand(10, this.W - 10)
      y = -pad
    } else if (edge === 1) {
      x = this.W + pad
      y = rand(this.playTop, this.playBottom)
    } else if (edge === 2) {
      x = rand(10, this.W - 10)
      y = this.H + pad
    } else {
      x = -pad
      y = rand(this.playTop, this.playBottom)
    }

    this.enemies.push(new Enemy(type, x, y, this.wave, this.enemyTierForWave(this.wave)))
    this.tryMergeEnemies()
  }

  waveCleared() {
    const bonus = 30 + this.wave * 15
    const meritBonus = CFG.merit.waveBase + this.wave * CFG.merit.waveGrowth
    this.score += bonus
    this.merit += meritBonus
    this.healUnits(CFG.squad.healOnWave)

    const crateCount = Math.min(
      CFG.crate.maxOnField,
      CFG.crate.afterWave + Math.floor(this.wave / CFG.crate.afterWaveEvery)
    )
    for (let i = 0; i < crateCount; i++) {
      if (this.crates.length >= CFG.crate.maxOnField) break
      this.spawnCrate()
    }

    this.fx.ring(
      this.target.x, this.target.y,
      'rgba(130, 230, 170, 0.9)', 20, 90, 0.5
    )
    this.fx.text(this.target.x, this.target.y - 34, '部队整补', COLORS.heal, 14, 0.9)

    this.banner = {
      text: `第 ${this.wave} 波 清除`,
      sub: `+${formatNumber(bonus)} 分 · +${formatNumber(meritBonus)} 军功 · 收集补给箱`,
      life: 2,
      max: 2,
      color: COLORS.heal,
    }
    this.wavePhase = 'prep'
    this.waveTimer = CFG.wave.prepBetween
  }

  // ---------- 补给箱 ----------

  spawnCrate() {
    for (let i = 0; i < 24; i++) {
      const x = rand(36, this.W - 36)
      const y = rand(this.playTop + 50, Math.max(this.playTop + 60, this.playBottom - 36))
      if (this.findCoverAt(x, y, 20)) continue
      if (dist(x, y, this.target.x, this.target.y) < 80) continue

      let ok = true
      for (let j = 0; j < this.crates.length; j++) {
        const c = this.crates[j]
        if (!c.dead && dist(x, y, c.x, c.y) < 70) {
          ok = false
          break
        }
      }
      if (!ok) continue

      this.crates.push(new Crate(x, y))
      return
    }

    this.spawnCrateAt(
      rand(36, this.W - 36),
      rand(this.playTop + 50, Math.max(this.playTop + 60, this.playBottom - 36))
    )
  }

  spawnCrateAt(x, y) {
    let cx = clamp(x, 40, this.W - 40)
    let cy = clamp(y, this.playTop + 40, this.playBottom - 40)

    for (let i = 0; i < this.covers.length; i++) {
      const p = this.pushPointOutOfCover(this.covers[i], cx, cy, 18)
      cx = p.x
      cy = p.y
    }

    cx = clamp(cx, 40, this.W - 40)
    cy = clamp(cy, this.playTop + 40, this.playBottom - 40)
    this.crates.push(new Crate(cx, cy))
  }

  updateCrates() {
    for (let i = 0; i < this.crates.length; i++) {
      const c = this.crates[i]
      if (c.dead) continue
      const unit = this.findNearestUnit(c.x, c.y)
      if (!unit) continue
      if (dist(unit.x, unit.y, c.x, c.y) < c.r + unit.r + CFG.crate.pickupPad) {
        c.dead = true
        this.collectCrate(c)
      }
    }
    pruneDead(this.crates)
  }

  collectCrate(c) {
    const gain = CFG.crate.merit
    this.merit += gain
    this.healUnits(CFG.crate.healPct)

    this.fx.ring(c.x, c.y, 'rgba(140, 210, 255, 0.95)', 4, 46, 0.45)
    this.fx.spark(c.x, c.y, '#9fd0ff', 14, 150)
    this.fx.text(c.x, c.y - 20, `+${formatNumber(gain)} 军功`, COLORS.merit, 15, 0.9)
    this.shake = Math.min(6, this.shake + 1.5)
    this.vibrate()
  }

  // ---------- 查找与战斗 ----------

  updateUnitStealth() {
    for (let i = 0; i < this.bushes.length; i++) {
      this.bushes[i].playerInside = false
    }
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      let hidden = false
      for (let j = 0; j < this.bushes.length; j++) {
        const b = this.bushes[j]
        const dx = u.x - b.x
        const dy = u.y - b.y
        const rr = b.r - 2
        if (dx * dx + dy * dy < rr * rr) {
          hidden = true
          b.playerInside = true
          break
        }
      }
      u.hidden = hidden
    }
  }

  findNearestUnit(x, y, skipHidden) {
    let best = null
    let bd = Infinity
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      if (skipHidden && u.hidden) continue
      const dx = u.x - x
      const dy = u.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bd) {
        bd = d2
        best = u
      }
    }
    return best
  }

  findNearestVisibleUnit(x, y, range) {
    let best = null
    let bd = range * range
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead || u.hidden) continue
      const dx = u.x - x
      const dy = u.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bd && !this.lineBlocked(x, y, u.x, u.y)) {
        bd = d2
        best = u
      }
    }
    return best
  }

  // 掩体是静态的，网格只建一次；每帧只重新跑从玩家出发的 BFS。
  // 网格足够细，能穿过门缝、房间之间的窄道，不会把可走的路误判成墙。
  ensureFlowGrid() {
    const cell = Math.max(6, CFG.enemy.flowCell)
    const top = this.playTop
    const cols = Math.max(1, Math.ceil(this.W / cell))
    const rows = Math.max(1, Math.ceil((this.playBottom - top) / cell))
    const clearance = CFG.enemy.flowClearance
    const cached = this.flowGrid
    if (
      cached &&
      cached.cell === cell &&
      cached.top === top &&
      cached.cols === cols &&
      cached.rows === rows &&
      cached.clearance === clearance
    ) {
      return cached
    }

    const blocked = new Uint8Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      const cellY = top + y * cell + cell / 2
      for (let x = 0; x < cols; x++) {
        const cellX = x * cell + cell / 2
        const idx = y * cols + x
        for (let k = 0; k < this.covers.length; k++) {
          if (this.coverBlocksPoint(this.covers[k], cellX, cellY, clearance)) {
            blocked[idx] = 1
            break
          }
        }
        // 草丛对敌人是实心的，寻路场也要绕开
        if (!blocked[idx] && this.bushBlocksPoint(cellX, cellY, clearance + 4)) {
          blocked[idx] = 1
        }
      }
    }

    this.flowGrid = { cell, top, cols, rows, clearance, blocked }
    return this.flowGrid
  }

  // 从所有我方单位出发做 BFS，生成绕过掩体的寻路场
  rebuildFlow() {
    const grid = this.ensureFlowGrid()
    const { cell, top, cols, rows, blocked } = grid
    const n = cols * rows

    if (!this.flowDist || this.flowDist.length !== n) {
      this.flowDist = new Int32Array(n)
      this.flowQueue = new Int32Array(n)
    }
    const dist = this.flowDist
    dist.fill(-1)
    const queue = this.flowQueue
    let head = 0
    let tail = 0

    const seedCell = (cx, cy, d) => {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
      const idx = cy * cols + cx
      if (blocked[idx] || dist[idx] >= 0) return
      dist[idx] = d
      queue[tail++] = idx
    }

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead || u.hidden) continue
      const cx = clamp(Math.floor(u.x / cell), 0, cols - 1)
      const cy = clamp(Math.floor((u.y - top) / cell), 0, rows - 1)
      if (!blocked[cy * cols + cx]) {
        seedCell(cx, cy, 0)
        continue
      }
      // 玩家贴着墙时格子可能被算作“墙内”，从最近的空格子起步
      let seeded = false
      for (let rad = 1; rad <= 4 && !seeded; rad++) {
        for (let oy = -rad; oy <= rad && !seeded; oy++) {
          for (let ox = -rad; ox <= rad && !seeded; ox++) {
            if (Math.max(Math.abs(ox), Math.abs(oy)) !== rad) continue
            const nx = cx + ox
            const ny = cy + oy
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            if (!blocked[ny * cols + nx]) {
              seedCell(nx, ny, 0)
              seeded = true
            }
          }
        }
      }
    }

    while (head < tail) {
      const idx = queue[head++]
      const x = idx % cols
      const y = (idx / cols) | 0
      const nd = dist[idx] + 1

      if (x > 0) {
        const ni = idx - 1
        if (!blocked[ni] && dist[ni] < 0) {
          dist[ni] = nd
          queue[tail++] = ni
        }
      }
      if (x < cols - 1) {
        const ni = idx + 1
        if (!blocked[ni] && dist[ni] < 0) {
          dist[ni] = nd
          queue[tail++] = ni
        }
      }
      if (y > 0) {
        const ni = idx - cols
        if (!blocked[ni] && dist[ni] < 0) {
          dist[ni] = nd
          queue[tail++] = ni
        }
      }
      if (y < rows - 1) {
        const ni = idx + cols
        if (!blocked[ni] && dist[ni] < 0) {
          dist[ni] = nd
          queue[tail++] = ni
        }
      }
    }

    this.flow = { cell, top, cols, rows, blocked, dist }
    this.flowTimer = CFG.enemy.flowRefresh
  }

  flowDirection(x, y) {
    const f = this.flow
    if (!f) return null

    const cx = Math.floor(x / f.cell)
    const cy = Math.floor((y - f.top) / f.cell)
    if (cx < 0 || cy < 0 || cx >= f.cols || cy >= f.rows) return null

    let best = -1
    let bx = 0
    let by = 0

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= f.cols || ny >= f.rows) continue

        const ni = ny * f.cols + nx
        if (f.blocked[ni] || f.dist[ni] < 0) continue
        if (dx !== 0 && dy !== 0) {
          if (
            f.blocked[cy * f.cols + nx] ||
            f.blocked[ny * f.cols + cx]
          ) {
            continue
          }
        }

        const d = f.dist[ni]
        if (best < 0 || d < best) {
          best = d
          bx = nx
          by = ny
        }
      }
    }

    if (best < 0) return null

    const tx = bx * f.cell + f.cell / 2
    const ty = f.top + by * f.cell + f.cell / 2
    const dx = tx - x
    const dy = ty - y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    return { x: dx / d, y: dy / d }
  }

  // 判断敌人沿某个方向迈一步是否会撞上掩体
  enemyStepClear(enemy, dirX, dirY, lookAhead) {
    const rad = enemy.cr || enemy.r
    const dist = Math.max(16, lookAhead || rad + 12)
    for (let k = 1; k <= 3; k++) {
      const t = k / 3
      const px = enemy.x + dirX * dist * t
      const py = enemy.y + dirY * dist * t
      if (
        px < 12 + rad ||
        px > this.W - 12 - rad ||
        py < this.playTop + 6 + rad ||
        py > this.playBottom - 6 - rad
      ) {
        return false
      }
      if (this.findCoverAt(px, py, rad + 1)) return false
      if (this.bushBlocksPoint(px, py, (enemy.r || rad) + 3)) return false
    }
    return true
  }

  departmentAt(x, y) {
    for (let i = 0; i < this.departments.length; i++) {
      const d = this.departments[i]
      const hw = d.w / 2 - 7
      const hh = d.h / 2 - 7
      if (hw <= 0 || hh <= 0) continue
      if (Math.abs(x - d.cx) < hw && Math.abs(y - d.cy) < hh) return d
    }
    return null
  }

  // 敌人在部屋里、目标在屋外时，先朝本屋真实存在的门口走；
  // 敌人在屋外、目标（或驻守点）在屋里时，朝那栋屋的门口走；
  // 否则寻路场可能把它带向墙或屋角，出不去/进不来。
  roomExitDirection(enemy, target) {
    const dep = this.departmentAt(enemy.x, enemy.y)
    const targetDep = target ? this.departmentAt(target.x, target.y) : null
    if (dep && targetDep === dep) return null

    const rad = enemy.cr || enemy.r
    let useDep = null
    if (dep) useDep = dep
    else if (targetDep) useDep = targetDep
    if (!useDep) return null

    const tx = useDep.doorX + useDep.nx * (rad + 6)
    const ty = useDep.doorY + useDep.ny * (rad + 6)
    const dx = tx - enemy.x
    const dy = ty - enemy.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    if (d < 3) return null
    return { x: dx / d, y: dy / d }
  }

  // 沿寻路场前进；如果前方被墙挡住，改为沿墙向目标方向找一条可行的路。
  // 返回 null 表示按原方向走；返回 {x:0,y:0} 表示附近无路可走，原地等待。
  steerEnemy(enemy, target, moveX, moveY) {
    const rad = enemy.cr || enemy.r

    if (moveX !== 0 || moveY !== 0) {
      const len = Math.sqrt(moveX * moveX + moveY * moveY) || 1
      const ux = moveX / len
      const uy = moveY / len
      if (this.enemyStepClear(enemy, ux, uy, Math.max(18, rad + 14))) {
        return { x: ux, y: uy }
      }
    }

    // 寻路场走不通时才退回“从部屋门口出去”，避免与寻路场来回打架
    const exit = this.roomExitDirection(enemy, target)
    if (exit) {
      const d = Math.max(18, rad + 12)
      if (this.enemyStepClear(enemy, exit.x, exit.y, d)) return exit
    }

    let baseX = moveX
    let baseY = moveY
    if (baseX === 0 && baseY === 0 && target) {
      baseX = target.x - enemy.x
      baseY = target.y - enemy.y
    }
    const baseAngle = Math.atan2(baseY, baseX)
    const targetAngle = target
      ? Math.atan2(target.y - enemy.y, target.x - enemy.x)
      : baseAngle
    const hasPrev = enemy.avoidTimer > 0
    const prevAngle = enemy.avoidAngle || 0

    let best = null
    let bestScore = -Infinity
    for (let i = 0; i < 20; i++) {
      const off = (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2)) *
        (Math.PI / 10)
      const angle = baseAngle + off
      const ux = Math.cos(angle)
      const uy = Math.sin(angle)
      if (!this.enemyStepClear(enemy, ux, uy, Math.max(20, rad + 16))) {
        continue
      }
      let score = Math.cos(off) * 1.2
      score += Math.cos(angle - targetAngle) * 0.6
      if (hasPrev) score += Math.cos(angle - prevAngle) * 0.35
      if (score > bestScore) {
        bestScore = score
        best = { x: ux, y: uy }
      }
    }

    if (!best) return { x: 0, y: 0 }
    enemy.avoidAngle = Math.atan2(best.y, best.x)
    enemy.avoidTimer = 0.45
    return best
  }

  findEnemyAt(x, y, pad) {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead) continue
      const dx = e.x - x
      const dy = e.y - y
      const rr = e.r + pad
      if (dx * dx + dy * dy < rr * rr) return e
    }
    return null
  }

  findUnitAt(x, y, pad) {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      const dx = u.x - x
      const dy = u.y - y
      const rr = u.r + pad
      if (dx * dx + dy * dy < rr * rr) return u
    }
    return null
  }

  // 草丛对敌人是实心的：敌人不能进入草丛，也不能和草丛图片重叠
  bushBlocksPoint(x, y, pad) {
    for (let i = 0; i < this.bushes.length; i++) {
      const b = this.bushes[i]
      const rr = b.r * 1.1 + (pad || 0)
      const dx = x - b.x
      const dy = y - b.y
      if (dx * dx + dy * dy < rr * rr) return true
    }
    return false
  }

  resolveBushCollision(entity) {
    for (let pass = 0; pass < 2; pass++) {
      let moved = false
      for (let i = 0; i < this.bushes.length; i++) {
        const b = this.bushes[i]
        let dx = entity.x - b.x
        let dy = entity.y - b.y
        const min = b.r * 1.1 + entity.r + 4
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min) continue
        let d = Math.sqrt(d2)
        if (d < 0.001) {
          dx = 1
          dy = 0
          d = 1
        }
        entity.x = b.x + (dx / d) * min
        entity.y = b.y + (dy / d) * min
        moved = true
      }
      if (!moved) break
    }
  }

  coverBlocksPoint(c, x, y, pad) {
    if (c.shape === 'rect') {
      return (
        x > c.x - c.w / 2 - pad &&
        x < c.x + c.w / 2 + pad &&
        y > c.y - c.h / 2 - pad &&
        y < c.y + c.h / 2 + pad
      )
    }
    const dx = x - c.x
    const dy = y - c.y
    const rr = c.r + pad
    return dx * dx + dy * dy < rr * rr
  }

  // 两个掩体是否重叠（含间距），支持圆和矩形
  coversOverlap(a, b, gap) {
    const ar = a.shape === 'rect'
    const br = b.shape === 'rect'
    if (ar && br) {
      return (
        Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap &&
        Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap
      )
    }
    if (ar || br) {
      const rect = ar ? a : b
      const circle = ar ? b : a
      const px = clamp(circle.x, rect.x - rect.w / 2, rect.x + rect.w / 2)
      const py = clamp(circle.y, rect.y - rect.h / 2, rect.y + rect.h / 2)
      return dist(circle.x, circle.y, px, py) < circle.r + gap
    }
    return dist(a.x, a.y, b.x, b.y) < a.r + b.r + gap
  }

  findCoverAt(x, y, pad) {
    for (let i = 0; i < this.covers.length; i++) {
      if (this.coverBlocksPoint(this.covers[i], x, y, pad || 0)) {
        return this.covers[i]
      }
    }
    return null
  }

  // 把一个半径为 radius 的点从掩体里推出去，支持圆和矩形
  pushPointOutOfCover(c, x, y, radius) {
    if (c.shape === 'rect') {
      const left = c.x - c.w / 2 - radius
      const right = c.x + c.w / 2 + radius
      const top = c.y - c.h / 2 - radius
      const bottom = c.y + c.h / 2 + radius
      if (x > left && x < right && y > top && y < bottom) {
        const dl = x - left
        const dr = right - x
        const dt = y - top
        const db = bottom - y
        const m = Math.min(dl, dr, dt, db)
        if (m === dl) x = left
        else if (m === dr) x = right
        else if (m === dt) y = top
        else y = bottom
      }
      return { x, y }
    }

    let dx = x - c.x
    let dy = y - c.y
    const min = c.r + radius
    const d2 = dx * dx + dy * dy
    if (d2 < min * min) {
      let d = Math.sqrt(d2)
      if (d < 0.001) {
        dx = 1
        dy = 0
        d = 1
      }
      x = c.x + (dx / d) * min
      y = c.y + (dy / d) * min
    }
    return { x, y }
  }

  // 玩家单位移动：先尝试直线，卡住时沿 X/Y 轴滑行，避免大编制卡在墙角
  movePlayerUnit(unit, mx, my) {
    const want2 = mx * mx + my * my
    if (want2 < 0.000001) return false

    const ox = unit.x
    const oy = unit.y
    unit.x = ox + mx
    unit.y = oy + my
    this.resolveCoverCollision(unit)

    let dx = unit.x - ox
    let dy = unit.y - oy
    if (dx * dx + dy * dy >= want2 * 0.25) return true

    unit.x = ox
    unit.y = oy
    let bestX = ox
    let bestY = oy
    let bestScore = 0.02
    const options = []
    if (Math.abs(mx) > 0.01) options.push([mx, 0])
    if (Math.abs(my) > 0.01) options.push([0, my])
    const want = Math.sqrt(want2)

    for (let i = 0; i < options.length; i++) {
      const sx = options[i][0]
      const sy = options[i][1]
      unit.x = ox + sx
      unit.y = oy + sy
      this.resolveCoverCollision(unit)
      const gx = unit.x - ox
      const gy = unit.y - oy
      const score = (gx * mx + gy * my) / want
      if (score > bestScore) {
        bestScore = score
        bestX = unit.x
        bestY = unit.y
      }
      unit.x = ox
      unit.y = oy
    }

    unit.x = bestX
    unit.y = bestY
    return bestScore > 0.02
  }

  resolveCoverCollision(entity) {
    // 多个掩体相邻时，一次推出可能被推进另一个掩体，迭代几次
    const radius = entity.cr || entity.r
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      for (let i = 0; i < this.covers.length; i++) {
        const p = this.pushPointOutOfCover(
          this.covers[i], entity.x, entity.y, radius
        )
        if (p.x !== entity.x || p.y !== entity.y) moved = true
        entity.x = p.x
        entity.y = p.y
      }
      if (!moved) break
    }
    // 敌方单位额外不能进入草丛；我方仍可进草隐蔽
    if (entity.isEnemy) this.resolveBushCollision(entity)
  }

  // 两点之间的连线是否被掩体挡住
  lineBlocked(x1, y1, x2, y2) {
    for (let i = 0; i < this.covers.length; i++) {
      const c = this.covers[i]
      if (c.shape === 'rect') {
        if (
          segmentHitsRect(
            x1, y1, x2, y2,
            c.x - c.w / 2, c.y - c.h / 2,
            c.x + c.w / 2, c.y + c.h / 2
          )
        ) {
          return true
        }
      } else if (segmentHitsCircle(x1, y1, x2, y2, c.x, c.y, c.r)) {
        return true
      }
    }
    return false
  }

  findTargetForUnit(unit) {
    const range2 = CFG.squad.range * CFG.squad.range
    let target = null
    let best = range2

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead) continue
      // 基地未激活时，玩家不能隔空点掉屋内的驻军；必须先进入基地
      if (this.levelMode && !this.baseActivated && e.y < this.levelMidY) continue
      const dx = e.x - unit.x
      const dy = e.y - unit.y
      const d2 = dx * dx + dy * dy
      if (d2 <= best && !this.lineBlocked(unit.x, unit.y, e.x, e.y)) {
        best = d2
        target = e
      }
    }
    return target
  }

  findTargetsForUnit(unit) {
    const range2 = CFG.squad.range * CFG.squad.range
    const targets = []
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead) continue
      // 基地未激活时，玩家不能隔空点掉屋内的驻军；必须先进入基地
      if (this.levelMode && !this.baseActivated && e.y < this.levelMidY) continue
      const dx = e.x - unit.x
      const dy = e.y - unit.y
      if (dx * dx + dy * dy > range2) continue
      if (this.lineBlocked(unit.x, unit.y, e.x, e.y)) continue
      targets.push(e)
    }
    return targets
  }

  // 单发步枪
  volley(unit) {
    const target = this.findTargetForUnit(unit)
    if (!target) return false

    const damage = TROOP_TIERS[unit.tier - 1].damage
    const angle = Math.atan2(target.y - unit.y, target.x - unit.x)
    unit.lastTarget = target
    unit.aimAngle = angle
    this.spawnVisualArrow(unit, target)
    this.sfx.play('shot')
    this.damageEnemy(target, damage, angle)
    return true
  }

  // 机枪：同时扫射攻击圈内所有有视线的敌人
  fireMG(unit) {
    const targets = this.findTargetsForUnit(unit)
    if (targets.length === 0) return false

    const base = TROOP_TIERS[unit.tier - 1].damage
    const per = Math.max(1, Math.round(base * CFG.weapons.mg.damageRatio))

    let nearest = targets[0]
    let nearestD2 = Infinity
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i]
      const dx = e.x - unit.x
      const dy = e.y - unit.y
      const d2 = dx * dx + dy * dy
      if (d2 < nearestD2) {
        nearestD2 = d2
        nearest = e
      }
    }

    unit.lastTarget = nearest
    unit.aimAngle = Math.atan2(
      nearest.y - unit.y, nearest.x - unit.x
    )

    for (let i = 0; i < targets.length; i++) {
      const e = targets[i]
      const angle = Math.atan2(e.y - unit.y, e.x - unit.x)
      this.spawnTracer(unit, angle + rand(-0.025, 0.025))
      this.damageEnemy(e, per, angle)
    }

    this.sfx.play('shot')
    this.shake = Math.min(5, this.shake + 0.4)
    return true
  }

  spawnTracer(unit, angle, hostile = false) {
    const sx = unit.x + Math.cos(angle) * unit.r * 2.35
    const sy = unit.y + Math.sin(angle) * unit.r * 2.35 - 2
    const scale = Math.min(2, unit.power)

    this.arrows.push(
      new Arrow(
        sx, sy, angle, CFG.weapons.mg.bulletSpeed, 0, scale, hostile, 'tracer'
      )
    )
    this.fx.spark(sx, sy, '#ffcf6a', 1, 45)
  }

  spawnVisualArrow(unit, enemy) {
    const a =
      Math.atan2(enemy.y - unit.y, enemy.x - unit.x) + rand(-0.04, 0.04)
    const sx = unit.x + Math.cos(a) * unit.r * 2.35
    const sy = unit.y + Math.sin(a) * unit.r * 2.35 - 2
    const scale = Math.min(2.2, unit.power)

    this.arrows.push(
      new Arrow(sx, sy, a, CFG.squad.bulletSpeed, 0, scale, false)
    )
    this.fx.spark(sx, sy, '#ffe08a', 1, 36)
  }

  enemyFireMG(enemy) {
    const damage = Math.max(1, Math.round(
      TROOP_TIERS[enemy.tier - 1].damage * CFG.weapons.mg.damageRatio
    ))
    for (const unit of this.units) {
      if (unit.dead || unit.hidden) continue
      if (Math.hypot(unit.x - enemy.x, unit.y - enemy.y) > enemy.range) continue
      if (this.lineBlocked(enemy.x, enemy.y, unit.x, unit.y)) continue
      const angle = Math.atan2(unit.y - enemy.y, unit.x - enemy.x)
      this.spawnTracer(enemy, angle, true)
      this.hurtUnit(unit, damage)
    }
    this.sfx.play('enemyShot')
  }

  enemyFireExplosive(enemy, target) {
    const weapon = CFG.weapons[enemy.weapon]
    this.grenades.push({
      kind: enemy.weapon,
      hostile: true,
      x0: enemy.x, y0: enemy.y,
      x1: target.x, y1: target.y,
      t: 0, dur: weapon.flightTime, radius: weapon.radius,
      damage: Math.max(1, Math.round(TROOP_TIERS[enemy.tier - 1].damage * weapon.damageMul)),
      dead: false,
    })
  }

  enemyShoot(enemy, target) {
    const baseAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x)
    enemy.aimAngle = baseAngle
    const a = baseAngle + rand(-0.05, 0.05)
    const sx = enemy.x + Math.cos(a) * enemy.r * 2.35
    const sy = enemy.y + Math.sin(a) * enemy.r * 2.35 - 2
    const casualty = TROOP_TIERS[enemy.tier - 1].damage
    const scale = Math.max(1.15, Math.min(2.4, enemy.power))

    this.arrows.push(
      new Arrow(sx, sy, a, CFG.enemy.arrowSpeed, casualty, scale, true)
    )
    this.sfx.play('enemyShot')
    this.fx.spark(sx, sy, '#ff8a80', 2, 40)
  }

  updateWeaponMode(dt) {
    if (!this.weaponMode) return

    if (!this.weaponUnit || this.weaponUnit.dead) {
      this.clearWeaponMode(false)
      return
    }

    this.weaponTimer -= dt
    if (this.weaponTimer <= 0) {
      this.clearWeaponMode(true)
    }
  }

  updatePassiveMerit(dt) {
    const interval = CFG.merit.passiveInterval
    const amount = CFG.merit.passiveAmount
    if (!(interval > 0) || !(amount > 0)) return
    if (!Number.isFinite(this.meritTimer)) this.meritTimer = interval

    this.meritTimer -= dt
    let ticks = 0
    while (this.meritTimer <= 0 && ticks < 20) {
      this.meritTimer += interval
      this.merit += amount
      ticks += 1
    }
  }

  clearWeaponMode(expired) {
    const unit = this.weaponUnit
    if (unit && !unit.dead) {
      unit.weapon = 'rifle'
      if (expired) {
        this.fx.text(
          unit.x, unit.y - 30,
          '武器到期 · 步枪',
          '#c8dcf2', 12, 0.9
        )
        this.showPanelMsg('武器到期，恢复步枪', 'rgba(200, 220, 240, 0.9)')
      }
    }
    this.weaponMode = null
    this.weaponUnit = null
    this.weaponTimer = 0
  }

  activateWeapon(mode) {
    const cfg = CFG.weapons[mode]
    if (!cfg) return

    const name = { mg: '机枪', grenade: '手雷', mortar: '迫击炮' }[mode]
    const unit = this.strongestUnit()
    if (!unit) {
      this.showPanelMsg('没有可装备的单位', COLORS.danger)
      return
    }

    if (this.weaponMode === mode && this.weaponUnit === unit) {
      this.showPanelMsg(
        `${name}剩余 ${Math.ceil(this.weaponTimer)} 秒`,
        COLORS.gold
      )
      return
    }

    if (this.coins < cfg.cost) {
      this.showPanelMsg(`金币不足 · 还需 ${cfg.cost - this.coins}`, COLORS.danger)
      this.vibrate()
      return
    }

    if (this.weaponUnit && !this.weaponUnit.dead) {
      this.weaponUnit.weapon = 'rifle'
    }
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (!u.dead && u !== unit && u.weapon !== 'rifle') {
        u.weapon = 'rifle'
      }
    }

    this.addCoins(-cfg.cost)
    this.weaponMode = mode
    this.weaponUnit = unit
    this.weaponTimer = CFG.weapons.duration
    unit.weapon = mode
    unit.cool = Math.min(unit.cool, 0.2)

    this.fx.ring(unit.x, unit.y, '#ffd27a', 6, 42, 0.45)
    this.fx.spark(unit.x, unit.y, '#ffd27a', 10, 120)
    this.fx.text(
      unit.x, unit.y - 32,
      `${name} · ${CFG.weapons.duration}秒 · ${unit.tierName} ${formatNumber(unit.troops)}`,
      COLORS.gold, 13, 1.1
    )
    this.vibrate()
  }

  // 金币支持 0.01 精度，统一在这里取整，避免浮点误差
  addCoins(amount) {
    const v = Number(amount) || 0
    this.coins = Math.max(0, Math.round((this.coins + v) * 100) / 100)
  }

  // 按兑换档位一次扣币、发放军功并保存进度。
  exchangeCoinForMerit(index = 0) {
    const offer = CFG.coins.exchanges[index]
    if (!offer) return false
    if (this.coins < offer.coins) {
      this.showPanelMsg('金币不足 · 击败敌军编制可获得金币', COLORS.danger)
      return false
    }
    this.addCoins(-offer.coins)
    this.merit += offer.merit
    this.showPanelMsg(`-${offer.coins} 金币 · +${offer.merit} 军功`, COLORS.merit)
    this.saveCampaign()
    this.vibrate()
    return true
  }

  // 手雷/迫击炮：共用抛射与范围伤害，倍率和发射间隔独立配置。
  fireGrenadeMode(unit, mode = 'grenade') {
    const weapon = CFG.weapons[mode]
    const target = this.findNearestEnemyAny(unit.x, unit.y, CFG.squad.range)
    if (!target) return false

    unit.lastTarget = target
    unit.aimAngle = Math.atan2(target.y - unit.y, target.x - unit.x)
    const damage = Math.max(
      1,
      Math.round(
        TROOP_TIERS[unit.tier - 1].damage * weapon.damageMul
      )
    )

    this.grenades.push({
      kind: mode,
      x0: unit.x,
      y0: unit.y,
      x1: target.x,
      y1: target.y,
      t: 0,
      dur: weapon.flightTime,
      radius: weapon.radius,
      damage,
      dead: false,
    })
    return true
  }

  findNearestEnemyAny(x, y, range) {
    let best = null
    let bd = range * range
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead) continue
      if (this.levelMode && !this.baseActivated && e.y < this.levelMidY) continue
      const dx = e.x - x
      const dy = e.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bd) {
        bd = d2
        best = e
      }
    }
    return best
  }

  explodeGrenade(gr) {
    const targets = gr.hostile ? this.units : this.enemies
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i]
      if (e.dead) continue
      const dx = e.x - gr.x1
      const dy = e.y - gr.y1
      const reach = gr.radius + e.r
      if (dx * dx + dy * dy <= reach * reach) {
        if (gr.hostile) this.hurtUnit(e, gr.damage)
        else this.damageEnemy(e, gr.damage, Math.atan2(dy, dx))
      }
    }

    this.fx.ring(gr.x1, gr.y1, '#ffb347', 8, gr.radius * 1.5, 0.55)
    this.fx.ring(gr.x1, gr.y1, 'rgba(255, 235, 180, 0.9)', 2, gr.radius, 0.35)
    this.fx.spark(gr.x1, gr.y1, '#ffcf6a', 26, 260)
    this.fx.spark(gr.x1, gr.y1, '#ff7a4d', 18, 180)
    this.sfx.play('explosion')
    this.shake = Math.min(14, this.shake + 5)
    this.vibrate(true)
  }

  damageEnemy(enemy, casualties, angle) {
    if (!enemy || enemy.dead) return
    enemy.aggro = true
    enemy.searching = false
    enemy.searchTimer = 0

    const dmg = Math.max(1, Math.round(casualties))
    const killed = Math.min(dmg, enemy.troops)
    enemy.troops -= dmg
    enemy.hitFlash = 1
    enemy.kx = clamp(enemy.kx + Math.cos(angle) * 5, -50, 50)
    enemy.ky = clamp(enemy.ky + Math.sin(angle) * 5, -50, 50)
    this.fx.spark(enemy.x, enemy.y, COLORS[enemy.type].hp, 2, 60)
    this.sfx.play('hit')

    if (killed > 0) {
      // 每消灭 10 点兵力 +1 军功；不足 10 点的部分累计到下一次
      const perMerit = Math.max(
        1, Math.round(CFG.merit.troopsPerMerit || 10)
      )
      this.meritProgress = (this.meritProgress || 0) + killed
      if (this.meritProgress >= perMerit) {
        const meritGain = Math.floor(this.meritProgress / perMerit)
        this.meritProgress -= meritGain * perMerit
        this.merit += meritGain
      }
    }

    if (enemy.troops <= 0) {
      enemy.troops = 0
      enemy.dead = true
      this.assignEnemyWeapons()
      this.kills += 1
      this.score += enemy.score
      // 击败一个编制单位时按等级发放金币（班 0.1 …… 军 2）
      const reward = Number(CFG.coins.rewards[enemy.tier - 1]) || 0
      if (reward > 0) {
        const beforeWhole = Math.floor(this.coins)
        this.addCoins(reward)
        const wholeGain = Math.floor(this.coins) - beforeWhole
        // 金币栏只显示整数；零头只更新进度条，攒满整币才飘字
        if (wholeGain > 0) {
          this.fx.text(
            enemy.x, enemy.y - 32,
            `+${wholeGain} 金币`,
            COLORS.gold, 12, 0.8
          )
        }
      }
      this.shake = Math.min(6, this.shake + 1.1)
      this.fx.spark(enemy.x, enemy.y, COLORS[enemy.type].body, 10, 140)
      this.fx.ring(enemy.x, enemy.y, COLORS[enemy.type].helmet, 2, 22, 0.35)
      if (
        Math.random() < CFG.crate.dropChance &&
        this.crates.length < CFG.crate.maxOnField
      ) {
        this.spawnCrateAt(enemy.x, enemy.y)
      }
    }
  }

  hurtUnit(unit, casualties) {
    if (!unit || unit.dead) return

    const before = unit.troops
    const dmg = Math.max(1, Math.round(casualties))
    unit.troops -= dmg
    unit.hitFlash = 1
    this.shake = Math.min(9, this.shake + 0.7)
    this.sfx.play('hurt')

    if (unit.troops <= 0) {
      unit.troops = 0
      unit.dead = true
      this.freeSlots.push(unit.slot)
      this.fx.spark(unit.x, unit.y, COLORS.player.body, 12, 160)
      this.fx.ring(unit.x, unit.y, unit.tierColor, 3, 28, 0.35)
      this.fx.text(
        unit.x, unit.y - 16,
        `-${formatNumber(before)} 兵力`,
        '#ff8a8a', 13, 0.7
      )
      this.shake = Math.min(12, this.shake + 3)
      this.vibrate()
    }
  }

  healUnits(pct) {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      u.troops = Math.min(
        u.troopsMax,
        u.troops + Math.round(u.troopsMax * pct)
      )
    }
  }

  gameOver() {
    this.finishRun(false)
  }

  levelVictory() {
    this.finishRun(true)
  }

  placeUnitsAtEntrance() {
    const tx = this.target.x
    const ty = this.target.y
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (u.dead) continue
      u.x = clamp(tx + u.ox, 16, this.W - 16)
      u.y = clamp(ty + u.oy, this.playTop + 8, this.playBottom - 12)
      this.resolveCoverCollision(u)
    }
  }

  nextLevel() {
    if (!this.victory || this.level >= LEVELS.length) return

    this.level += 1
    this.state = 'playing'
    this.victory = false
    this.baseActivated = false
    this.releaseTimer = 0
    this.enemies.length = 0
    this.arrows.length = 0
    this.crates.length = 0
    this.grenades.length = 0
    this.fx.clear()

    this.weaponMode = null
    this.weaponUnit = null
    this.weaponTimer = 0
    for (let i = 0; i < this.units.length; i++) {
      this.units[i].weapon = 'rifle'
    }

    this.drag = null
    this.panelMsg = null
    this.banner = null
    this.healUnits(CFG.level.healBetweenLevels || 0.25)
    this.meritTimer = CFG.merit.passiveInterval

    this.setupLevel(this.level)
    this.placeUnitsAtEntrance()
    this.flow = null
    this.flowTimer = 0
    this.peakTroops = Math.max(this.peakTroops, this.totalTroops())
    this.saveLevelCheckpoint()
    this.saveCampaign()
    this.last = Date.now()
  }

  finishRun(victory) {
    if (this.state !== 'playing') return

    this.state = 'gameover'
    this.victory = !!victory
    this.drag = null
    this.panelMsg = null
    this.peakTroops = Math.max(this.peakTroops, this.totalTroops())

    const prevBest = this.save.bestScore
    const prevBestTroops = this.save.bestTroops
    this.newBest = this.score > prevBest
    this.newTroopBest = this.peakTroops > prevBestTroops

    this.save.bestScore = Math.max(prevBest, this.score)
    this.save.bestWave = Math.max(this.save.bestWave, this.level)
    this.save.bestTroops = Math.max(prevBestTroops, this.peakTroops)
    this.save.totalKills += this.kills
    this.save.plays += 1
    writeSave(this.save)

    this.vibrate(true)
    if (victory) {
      this.fx.ring(
        this.target.x, this.target.y,
        'rgba(143, 240, 181, 0.9)', 10, 130, 0.8
      )
      this.fx.spark(this.target.x, this.target.y, '#8ff0b5', 24, 220)
    } else {
      this.shake = 12
      this.fx.ring(
        this.target.x, this.target.y,
        'rgba(255, 120, 120, 0.9)', 10, 120, 0.7
      )
      this.fx.spark(this.target.x, this.target.y, '#ff8a8a', 24, 220)
    }
  }

  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.drag = null
    this.audio.pause()
  }

  resumeBattle() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.last = Date.now()
    this.audio.resume()
  }

  toMenu() {
    this.saveCampaign()
    this.state = 'menu'
    this.settingsOpen = false
    this.aboutOpen = false
    this.drag = null
    this.banner = null
    this.panelMsg = null
    this.shake = 0
    this.audio.playMenu()
    this.units.length = 0
    this.enemies.length = 0
    this.arrows.length = 0
    this.crates.length = 0
    this.covers.length = 0
    this.grenades.length = 0
    this.bushes = []
    this.weaponMode = null
    this.weaponUnit = null
    this.weaponTimer = 0
    this.mapDecor = null
    this.victory = false
    this.departments = []
    this.levelReserve = 0
    this.flow = null
    this.fx.clear()
  }

  vibrate(force) {
    const now = Date.now()
    if (!force && now - this.lastVibrate < 220) return
    this.lastVibrate = now
    try {
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    } catch (e) {
      // 忽略
    }
  }

  share() {
    try {
      if (wx.shareAppMessage) wx.shareAppMessage({ title: this.shareTitle() })
    } catch (e) {
      // 忽略
    }
  }

  shareTitle() {
    if (this.state === 'gameover') {
      const progress = this.victory
        ? (this.level >= LEVELS.length
            ? `通关全部 ${LEVELS.length} 关`
            : `完成第 ${this.level} 关`)
        : `打到第 ${this.level} 关`
      return `我在《${GAME_TITLE}》${progress}，总兵力 ${formatNumber(this.peakTroops)}，得分 ${formatNumber(this.score)}，来挑战我！`
    }
    return `《${GAME_TITLE}》—— 指挥你的小兵，攻克敌军基地！`
  }

  // ---------- 输入 ----------

  touchX(t) {
    return typeof t.clientX === 'number' ? t.clientX : t.x
  }

  touchY(t) {
    return typeof t.clientY === 'number' ? t.clientY : t.y
  }

  findTouch(list, id) {
    if (!list || list.length === 0) return null
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i]
    }
    return list[0]
  }

  onTouchStart(e) {
    const t = e.touches && e.touches[0]
    if (!t) return

    const x = this.touchX(t)
    const y = this.touchY(t)

    if (this.audio) this.audio.unlock()
    if (this.sfx && !this.sfxUnlocked) {
      this.sfxUnlocked = true
      this.sfx.unlock()
    }

    if (this.state === 'playing' && this.levelNotice) {
      const L = this.noticeLayout()
      if (
        pointsInRect(x, y, L.close, 8) ||
        pointsInRect(x, y, L.done, 6) ||
        !pointsInRect(x, y, L.panel, 0)
      ) {
        this.levelNotice = null
      }
      return
    }

    if (this.state === 'menu') {
      if (this.settingsOpen) {
        const L = this.settingsLayout()
        if (pointsInRect(x, y, L.toggle, 8)) this.toggleMusic()
        else if (pointsInRect(x, y, L.sfxToggle, 8)) this.toggleSfx()
        else if (pointsInRect(x, y, L.close, 8)) this.settingsOpen = false
        else if (pointsInRect(x, y, L.done, 6)) this.settingsOpen = false
        else if (!pointsInRect(x, y, L.panel, 0)) this.settingsOpen = false
        return
      }
      if (this.aboutOpen) {
        const L = this.aboutLayout()
        if (
          pointsInRect(x, y, L.close, 8) ||
          pointsInRect(x, y, L.done, 6) ||
          !pointsInRect(x, y, L.panel, 0)
        ) {
          this.aboutOpen = false
        }
        return
      }
      const L = this.menuLayout()
      if (pointsInRect(x, y, L.test, 5)) {
        this.startTestRun()
        return
      }
      if (pointsInRect(x, y, L.settings, 8)) {
        this.settingsOpen = true
        this.aboutOpen = false
        return
      }
      if (pointsInRect(x, y, L.about, 8)) {
        this.aboutOpen = true
        this.settingsOpen = false
        return
      }
      if (L.continue && pointsInRect(x, y, L.continue, 8)) {
        this.continueRun()
        return
      }
      if (pointsInRect(x, y, L.start, 8)) this.startRun()
      return
    }

    if (this.state === 'paused') {
      const L = this.pauseLayout()
      if (pointsInRect(x, y, L.resume, 6)) this.resumeBattle()
      else if (pointsInRect(x, y, L.menu, 6)) this.toMenu()
      return
    }

    if (this.state === 'gameover') {
      const L = this.gameoverLayout()
      if (pointsInRect(x, y, L.restart, 6)) {
        if (this.victory && this.level < LEVELS.length) this.nextLevel()
        else if (
          !this.victory &&
          (this.hasLevelCheckpoint() || this.hasResume())
        ) {
          this.retryLevel()
        } else this.startRun()
      } else if (pointsInRect(x, y, L.menu, 6)) this.toMenu()
      else if (pointsInRect(x, y, L.share, 6)) this.share()
      return
    }

    if (this.state !== 'playing') return
    if (this.drag) return

    if (pointsInRect(x, y, this.pauseButtonRect(), 6)) {
      this.pause()
      return
    }

    const P = this.troopPanelLayout()
    if (pointsInRect(x, y, P.panel)) {
      for (let i = 0; i < P.cards.length; i++) {
        if (pointsInRect(x, y, P.cards[i], 1)) {
          this.onRecruitTap(i)
          return
        }
      }
      for (let i = 0; i < P.exchanges.length; i++) {
        if (pointsInRect(x, y, P.exchanges[i], 1)) {
          this.exchangeCoinForMerit(i)
          return
        }
      }
      if (pointsInRect(x, y, P.weaponRow.mg, 1)) {
        this.activateWeapon('mg')
        return
      }
      if (pointsInRect(x, y, P.weaponRow.grenade, 1)) {
        this.activateWeapon('grenade')
        return
      }
      if (pointsInRect(x, y, P.weaponRow.mortar, 1)) {
        this.activateWeapon('mortar')
        return
      }
      return
    }

    this.drag = {
      id: t.identifier,
      sx: x,
      sy: y,
      tx: this.target.x,
      ty: this.target.y,
    }
  }

  onTouchMove(e) {
    if (this.state !== 'playing' || !this.drag) return

    const t = this.findTouch(e.touches, this.drag.id)
    if (!t) return

    const nx = this.drag.tx + (this.touchX(t) - this.drag.sx)
    const ny = this.drag.ty + (this.touchY(t) - this.drag.sy)
    this.setTarget(nx, ny)
  }

  onTouchEnd(e) {
    if (!this.drag) return
    const list = e.changedTouches
    if (list && list.length > 0) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === this.drag.id) {
          this.drag = null
          return
        }
      }
    }
    if (!e.touches || e.touches.length === 0) this.drag = null
  }

  setTarget(x, y) {
    this.target.x = clamp(x, 30, this.W - 30)
    this.target.y = clamp(y, this.playTop + 20, this.playBottom - 20)
  }

  // ---------- 布局 ----------

  pauseButtonRect() {
    const s = 46
    return { x: this.W - 10 - s, y: this.safeTop + 8, w: s, h: s }
  }

  menuLayout() {
    const bw = Math.min(240, this.W - 80)
    const bh = this.H < 720 ? 44 : 56
    const step = bh + 12
    const hasResume = this.hasResume()
    const aboutY = this.H - this.safeBottom - 28 - bh
    const settingsY = aboutY - step
    const testY = settingsY - step
    const continueY = testY - step
    const startY = testY - step * (hasResume ? 2 : 1)
    return {
      // 新的开始 → 继续游戏（如有）→ 测试关卡 → 设置 → 关于
      start: { x: (this.W - bw) / 2, y: startY, w: bw, h: bh },
      test: { x: (this.W - bw) / 2, y: testY, w: bw, h: bh },
      settings: {
        x: (this.W - bw) / 2,
        y: settingsY,
        w: bw,
        h: bh,
      },
      about: {
        x: (this.W - bw) / 2,
        y: aboutY,
        w: bw,
        h: bh,
      },
      continue: hasResume
        ? { x: (this.W - bw) / 2, y: continueY, w: bw, h: bh }
        : null,
      hasResume,
    }
  }

  settingsLayout() {
    const pw = Math.min(this.W - 52, 330)
    const ph = 318
    const px = (this.W - pw) / 2
    const py = Math.max(this.safeTop + 30, (this.H - ph) / 2)
    return {
      panel: { x: px, y: py, w: pw, h: ph },
      close: { x: px + pw - 40, y: py + 10, w: 30, h: 30 },
      music: { x: px + 18, y: py + 78, w: pw - 36, h: 66 },
      toggle: { x: px + pw - 96, y: py + 94, w: 60, h: 32 },
      sfx: { x: px + 18, y: py + 150, w: pw - 36, h: 66 },
      sfxToggle: { x: px + pw - 96, y: py + 166, w: 60, h: 32 },
      done: { x: px + 30, y: py + ph - 78, w: pw - 60, h: 46 },
    }
  }

  aboutLayout() {
    const pw = Math.min(this.W - 60, 320)
    const ph = 330
    const px = (this.W - pw) / 2
    const py = Math.max(this.safeTop + 30, (this.H - ph) / 2)
    return {
      panel: { x: px, y: py, w: pw, h: ph },
      close: { x: px + pw - 40, y: py + 10, w: 30, h: 30 },
      done: { x: px + 30, y: py + ph - 70, w: pw - 60, h: 44 },
    }
  }

  noticeLayout() {
    const pw = Math.min(this.W - 60, 320)
    const ph = 240
    const px = (this.W - pw) / 2
    const py = Math.max(this.safeTop + 30, (this.H - ph) / 2)
    return {
      panel: { x: px, y: py, w: pw, h: ph },
      close: { x: px + pw - 40, y: py + 10, w: 30, h: 30 },
      done: { x: px + 30, y: py + ph - 70, w: pw - 60, h: 44 },
    }
  }

  toggleMusic() {
    this.save.musicOn = this.save.musicOn === false
    this.audio.setEnabled(this.save.musicOn)
    writeSave(this.save)
    this.vibrate()
  }

  toggleSfx() {
    this.save.sfxOn = this.save.sfxOn === false
    this.sfx.setEnabled(this.save.sfxOn)
    writeSave(this.save)
    this.vibrate()
  }

  pauseLayout() {
    const pw = Math.min(this.W - 64, 300)
    const ph = 260
    const px = (this.W - pw) / 2
    const py = Math.max(this.safeTop + 20, (this.H - ph) / 2)
    return {
      panel: { x: px, y: py, w: pw, h: ph },
      resume: { x: px + 24, y: py + 120, w: pw - 48, h: 52 },
      menu: { x: px + 24, y: py + 184, w: pw - 48, h: 44 },
    }
  }

  gameoverLayout() {
    const pw = Math.min(this.W - 44, 340)
    const ph = 340
    const px = (this.W - pw) / 2
    const py = Math.max(this.safeTop + 20, (this.H - ph) / 2)
    const bw = pw - 56
    const half = (bw - 12) / 2
    return {
      panel: { x: px, y: py, w: pw, h: ph },
      restart: { x: px + 28, y: py + 200, w: bw, h: 52 },
      menu: { x: px + 28, y: py + 266, w: half, h: 44 },
      share: { x: px + 28 + half + 12, y: py + 266, w: half, h: 44 },
    }
  }

  troopPanelLayout() {
    const margin = 8
    const pad = 8
    const headerH = 36
    const cardH = 44
    const gap = 4
    const rowGap = 6
    const exchangeH = 36
    const columns = 8
    const recruitRows = Math.ceil(8 / columns)
    const messageH = 20

    const panelW = this.W - margin * 2
    const panelH = pad * 2 + headerH + rowGap + exchangeH + rowGap +
      recruitRows * (cardH + rowGap) + cardH + messageH
    const x = margin
    const y = this.H - this.safeBottom - margin - panelH

    const innerX = x + pad
    const innerW = panelW - pad * 2
    const cardW = (innerW - gap * (columns - 1)) / columns
    const exchangeY = y + pad + headerH + rowGap
    const exchangeW = (innerW - gap * (CFG.coins.exchanges.length - 1)) /
      CFG.coins.exchanges.length
    const exchanges = CFG.coins.exchanges.map((_, i) => ({
      x: innerX + i * (exchangeW + gap), y: exchangeY, w: exchangeW, h: exchangeH,
    }))
    const cardY = exchangeY + exchangeH + rowGap

    const cards = []
    for (let i = 0; i < 8; i++) {
      cards.push({
        x: innerX + (i % columns) * (cardW + gap),
        y: cardY + Math.floor(i / columns) * (cardH + rowGap),
        w: cardW,
        h: cardH,
      })
    }

    // 最后一行：机枪、手雷、迫击炮、军团、方面军。
    const weaponY = cardY + recruitRows * (cardH + rowGap)
    const weaponW = (innerW - gap * 4) / 5
    const bottomCell = (i) => ({
      x: innerX + i * (weaponW + gap), y: weaponY, w: weaponW, h: cardH,
    })
    for (let i = 8; i < TROOP_TIERS.length; i++) cards.push(bottomCell(i - 5))
    const weaponRow = {
      coin: { x: innerX + innerW - 100, y: y + pad, w: 100, h: headerH },
      mg: bottomCell(0),
      grenade: bottomCell(1),
      mortar: bottomCell(2),
    }

    return {
      panel: { x, y, w: panelW, h: panelH },
      header: { x: innerX, y: y + pad, w: innerW, h: headerH },
      cards,
      exchanges,
      message: { x: innerX, y: weaponY + cardH, w: innerW, h: messageH },
      weaponRow,
    }
  }

  // ---------- 渲染 ----------

  render() {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

    if (this.bgCanvas) {
      ctx.drawImage(this.bgCanvas, 0, 0, this.W, this.H)
    } else {
      ctx.fillStyle = '#0a1118'
      ctx.fillRect(0, 0, this.W, this.H)
    }

    const shake = this.shake
    const ox = shake > 0.2 ? rand(-shake, shake) : 0
    const oy = shake > 0.2 ? rand(-shake, shake) : 0

    ctx.save()
    ctx.translate(ox, oy)

    if (this.mapDecor) this.drawLevelDecor(ctx)

    for (let i = 0; i < this.crates.length; i++) {
      this.crates[i].draw(ctx, this.time)
    }

    for (let i = 0; i < this.covers.length; i++) {
      drawCover(ctx, this.covers[i])
    }

    for (let i = 0; i < this.arrows.length; i++) {
      this.arrows[i].draw(ctx)
    }

    const units = this._units

    // 先画我方单位（会被草丛覆盖），再画草丛，最后画敌人（草丛不覆盖敌人）
    units.length = 0
    for (let i = 0; i < this.units.length; i++) units.push(this.units[i])
    units.sort((a, b) => a.y - b.y)
    for (let i = 0; i < units.length; i++) {
      units[i].draw(ctx, this.time, false)
    }

    drawBushes(
      ctx,
      this.bushes,
      this.time,
      this.grassReady ? this.grassImage : null,
      this.shrubReady ? this.shrubImage : null
    )

    units.length = 0
    for (let i = 0; i < this.enemies.length; i++) units.push(this.enemies[i])
    units.sort((a, b) => a.y - b.y)
    for (let i = 0; i < units.length; i++) {
      units[i].draw(ctx, this.time, false)
    }

    // 所有文字和标签都在掩体/草丛之上绘制
    this.drawLevelLabels(ctx)
    units.length = 0
    for (let i = 0; i < this.units.length; i++) units.push(this.units[i])
    for (let i = 0; i < this.enemies.length; i++) units.push(this.enemies[i])
    units.sort((a, b) => a.y - b.y)
    for (let i = 0; i < units.length; i++) {
      drawUnitBadge(ctx, units[i])
    }

    // 草丛中的我方单位给一个隐蔽提示
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      if (!u.hidden || u.dead) continue
      ctx.strokeStyle = 'rgba(143, 240, 181, 0.45)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(u.x, u.y, u.r + 4, 0, TAU)
      ctx.stroke()
      setFont(ctx, 9, 'bold')
      ctx.fillStyle = 'rgba(170, 245, 200, 0.9)'
      ctx.fillText('隐蔽', u.x, u.y - u.r - 8)
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    for (let i = 0; i < this.grenades.length; i++) {
      if (!this.grenades[i].dead) {
        drawGrenade(ctx, this.grenades[i], this.time)
      }
    }

    this.fx.draw(ctx)
    ctx.restore()

    if (this.state === 'playing' && this.drag) this.drawTarget(ctx)

    if (
      this.state === 'playing' ||
      this.state === 'paused' ||
      this.state === 'gameover'
    ) {
      this.drawHUD(ctx)
      this.drawTroopPanel(ctx)
    }

    if (this.banner && this.state === 'playing') this.drawBanner(ctx)
    if (this.levelNotice && this.state === 'playing') this.drawLevelNotice(ctx)

    if (this.state === 'menu') this.drawMenu(ctx)
    else if (this.state === 'paused') this.drawPause(ctx)
    else if (this.state === 'gameover') this.drawGameOver(ctx)

    if (this.state === 'menu' && this.settingsOpen) this.drawSettings(ctx)
    if (this.state === 'menu' && this.aboutOpen) this.drawAbout(ctx)
  }

  drawLevelDecor(ctx) {
    const d = this.mapDecor
    if (!d) return

    for (let i = 0; i < d.zones.length; i++) {
      const z = d.zones[i]
      if (ctx.setLineDash) ctx.setLineDash([6, 5])
      ctx.strokeStyle = 'rgba(150, 180, 220, 0.28)'
      ctx.lineWidth = 1.2
      ctx.strokeRect(z.x, z.y, z.w, z.h)
      if (ctx.setLineDash) ctx.setLineDash([])
    }
  }

  // 文字统一在掩体、草丛、单位之后绘制，保证不会被遮挡
  drawLevelLabels(ctx) {
    const d = this.mapDecor
    if (!d) return

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < d.labels.length; i++) {
      const l = d.labels[i]
      setFont(ctx, l.size, 'bold')
      ctx.fillStyle = 'rgba(190, 215, 245, 0.62)'
      ctx.fillText(l.text, l.x, l.y)
    }

    // 编制部门：按关卡表标出部名、部数和剩余储备
    for (let i = 0; i < this.departments.length; i++) {
      const dep = this.departments[i]
      const tierInfo = TROOP_TIERS[dep.tier - 1]
      setFont(ctx, 11, 'bold')
      ctx.fillStyle = tierInfo ? tierInfo.color : 'rgba(205, 228, 255, 0.72)'
      ctx.fillText(`${dep.name} ×${dep.count}`, dep.cx, dep.labelY)

      setFont(ctx, 9, '500')
      ctx.fillStyle = 'rgba(200, 215, 230, 0.72)'
      ctx.fillText(`待命 ${formatNumber(dep.reserve)}`, dep.cx, dep.reserveY)
    }

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawHUD(ctx) {
    const barY = this.safeTop + 8
    const pause = this.pauseButtonRect()
    const barX = 10
    const barW = this.W - 20 - pause.w - 10
    const barH = pause.h

    fillRoundRect(ctx, barX, barY, barW, barH, 14, 'rgba(8, 14, 22, 0.68)')
    strokeRoundRect(ctx, barX, barY, barW, barH, 14, 'rgba(120, 170, 220, 0.16)', 1)

    const colW = barW / 3
    const labels = this.levelMode
      ? ['关卡', '总兵力', '得分']
      : ['波次', '总兵力', '得分']
    const values = [
      this.levelMode ? `${this.level}/${LEVELS.length}` : String(this.wave),
      formatNumber(this.totalTroops()),
      formatNumber(this.score),
    ]

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < 3; i++) {
      const cx = barX + colW * (i + 0.5)
      setFont(ctx, 11, '500')
      ctx.fillStyle = 'rgba(143, 166, 189, 0.9)'
      ctx.fillText(labels[i], cx, barY + 13)

      setFont(ctx, values[i].length > 6 ? 14 : 17, 'bold')
      ctx.fillStyle = i === 1 ? '#a8d8ff' : '#f0f6ff'
      ctx.fillText(values[i], cx, barY + 31)
    }

    ctx.strokeStyle = 'rgba(120, 170, 220, 0.12)'
    ctx.lineWidth = 1
    for (let i = 1; i < 3; i++) {
      const x = barX + colW * i
      ctx.beginPath()
      ctx.moveTo(x, barY + 12)
      ctx.lineTo(x, barY + barH - 12)
      ctx.stroke()
    }

    fillRoundRect(ctx, pause.x, pause.y, pause.w, pause.h, 14, 'rgba(8, 14, 22, 0.68)')
    strokeRoundRect(
      ctx, pause.x, pause.y, pause.w, pause.h, 14,
      'rgba(120, 170, 220, 0.16)', 1
    )
    ctx.fillStyle = 'rgba(220, 235, 250, 0.9)'
    ctx.fillRect(pause.x + 17, pause.y + 15, 4, 16)
    ctx.fillRect(pause.x + 25, pause.y + 15, 4, 16)

    let pillText = null
    if (this.state === 'playing') {
      if (this.levelMode) {
        let alive = 0
        for (let i = 0; i < this.enemies.length; i++) {
          if (!this.enemies[i].dead) alive += 1
        }
        const suffix = alive > 0
          ? ` · 场上 ${alive}`
          : this.levelReserve > 0 ? ' · 增援中' : ''
        pillText =
          `敌军 ${formatNumber(this.levelEnemiesRemaining())}` +
          `/${formatNumber(this.levelEnemyTotal)} 部 · ` +
          `兵力 ${formatNumber(this.levelEnemyTroopsRemaining())}${suffix}`
      } else if (this.wavePhase === 'prep') {
        const sec = Math.max(1, Math.ceil(this.waveTimer))
        pillText = this.wave === 0 ? `敌军来袭 ${sec}` : `下一波 ${sec}`
      }
    }

    if (pillText) {
      setFont(ctx, 12, 'bold')
      const tw = ctx.measureText(pillText).width + 22
      const cx = this.W / 2
      const cy = barY + barH + 16

      fillRoundRect(ctx, cx - tw / 2, cy - 11, tw, 22, 11, 'rgba(8, 14, 22, 0.55)')
      ctx.fillStyle = 'rgba(200, 222, 245, 0.85)'
      ctx.fillText(pillText, cx, cy)
    }

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawTroopPanel(ctx) {
    const L = this.troopPanelLayout()
    const p = L.panel
    fillRoundRect(ctx, p.x, p.y, p.w, p.h, 16, 'rgba(8, 14, 22, 0.9)')
    strokeRoundRect(ctx, p.x, p.y, p.w, p.h, 16, 'rgba(120, 170, 220, 0.22)', 1)

    const h = L.header
    const headerMid = h.y + h.h / 2
    const messageMid = L.message.y + L.message.h / 2
    ctx.textBaseline = 'middle'

    ctx.textAlign = 'left'
    setFont(ctx, 11, 'bold')
    ctx.fillStyle = COLORS.merit
    ctx.fillText(`军功 ${formatNumber(this.merit)}`, h.x + 2, headerMid)

    ctx.textAlign = 'center'
    if (this.panelMsg) {
      setFont(ctx, 10, 'bold')
      ctx.fillStyle = this.panelMsg.color
      ctx.fillText(this.panelMsg.text, p.x + p.w / 2, messageMid, L.message.w)
    } else if (this.units.length >= CFG.squad.maxUnits) {
      setFont(ctx, 9, '500')
      ctx.fillStyle = 'rgba(255, 138, 138, 0.85)'
      ctx.fillText('编制已满 · 损失后可继续招募', p.x + p.w / 2, messageMid)
    } else {
      setFont(ctx, 9, '500')
      ctx.fillStyle = 'rgba(120, 145, 170, 0.8)'
      ctx.fillText('点击卡片招募 · 1 人 = 1 军功', p.x + p.w / 2, messageMid)
    }

    ctx.textAlign = 'right'
    setFont(ctx, 10, 'bold')
    if (this.units.length >= CFG.squad.maxUnits) {
      ctx.fillStyle = COLORS.danger
      ctx.fillText('编制已满', L.weaponRow.coin.x - 8, headerMid)
    } else {
      const tier = this.highestTier()
      ctx.fillStyle = 'rgba(168, 190, 214, 0.9)'
      ctx.fillText(
        tier ? `最高 · ${TROOP_TIERS[tier - 1].name}` : '最高 · -',
        L.weaponRow.coin.x - 8, headerMid
      )
    }

    for (let i = 0; i < TROOP_TIERS.length; i++) {
      const info = TROOP_TIERS[i]
      const r = L.cards[i]
      const affordable =
        this.merit >= info.cost && this.units.length < CFG.squad.maxUnits

      fillRoundRect(
        ctx, r.x, r.y, r.w, r.h, 8,
        affordable ? 'rgba(20, 36, 56, 0.95)' : 'rgba(13, 20, 29, 0.9)'
      )
      strokeRoundRect(
        ctx, r.x, r.y, r.w, r.h, 8,
        affordable ? info.color : 'rgba(80, 105, 130, 0.35)',
        affordable ? 1.4 : 1
      )

      ctx.fillStyle = info.color
      ctx.globalAlpha = affordable ? 0.9 : 0.35
      ctx.fillRect(r.x + 6, r.y + 2.5, r.w - 12, 2)
      ctx.globalAlpha = 1

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      setFont(ctx, 11, 'bold')
      ctx.fillStyle = affordable ? info.color : 'rgba(150, 170, 190, 0.55)'
      ctx.fillText(info.name, r.x + r.w / 2, r.y + 15)

      setFont(ctx, 10, 'bold')
      ctx.fillStyle = affordable ? '#eef5ff' : 'rgba(150, 170, 190, 0.5)'
      ctx.fillText(String(info.cost), r.x + r.w / 2, r.y + 32, r.w - 8)

      const flash = this.cardFlash[i]
      if (flash !== 0) {
        ctx.globalAlpha = Math.min(0.5, Math.abs(flash))
        fillRoundRect(
          ctx, r.x, r.y, r.w, r.h, 8,
          flash > 0 ? '#ffffff' : COLORS.danger
        )
        ctx.globalAlpha = 1
      }
    }

    // 金币余额在顶部，兑换在原编制卡上方，武器在最后一行。
    const wr = L.weaponRow
    const mgActive = this.weaponMode === 'mg'
    const grenadeActive = this.weaponMode === 'grenade'
    const mortarActive = this.weaponMode === 'mortar'
    const mgCost = CFG.weapons.mg.cost
    const grenadeCost = CFG.weapons.grenade.cost
    const mortarCost = CFG.weapons.mortar.cost
    const mgEnabled = mgActive || this.coins >= mgCost
    const grenadeEnabled = grenadeActive || this.coins >= grenadeCost
    const mortarEnabled = mortarActive || this.coins >= mortarCost
    const weaponLeft = Math.max(0, Math.ceil(this.weaponTimer))
    const weaponProgress = clamp(
      this.weaponTimer / CFG.weapons.duration, 0, 1
    )

    fillRoundRect(
      ctx, wr.coin.x, wr.coin.y, wr.coin.w, wr.coin.h, 10,
      'rgba(20, 26, 34, 0.95)'
    )
    strokeRoundRect(
      ctx, wr.coin.x, wr.coin.y, wr.coin.w, wr.coin.h, 10,
      'rgba(255, 215, 106, 0.35)', 1
    )
    fillCircle(ctx, wr.coin.x + 12, wr.coin.y + 12, 5, '#ffd76a')
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    setFont(ctx, 10, 'bold')
    ctx.fillStyle = COLORS.gold
    ctx.fillText(
      `金币 ${Math.floor(this.coins)}`, wr.coin.x + 21, wr.coin.y + 12
    )

    // 金币栏只显示整数，零头用下面的进度条表示
    const progress = clamp(this.coins - Math.floor(this.coins), 0, 1)
    fillRoundRect(
      ctx, wr.coin.x + 10, wr.coin.y + 24, wr.coin.w - 20, 4, 2,
      'rgba(60, 70, 85, 0.9)'
    )
    if (progress > 0) {
      fillRoundRect(
        ctx, wr.coin.x + 10, wr.coin.y + 24,
        (wr.coin.w - 20) * progress, 4, 2, '#ffd76a'
      )
    }

    for (let i = 0; i < L.exchanges.length; i++) {
      const offer = CFG.coins.exchanges[i]
      this.drawExchangeButton(ctx, L.exchanges[i], offer, this.coins >= offer.coins)
    }

    this.drawWeaponButton(
      ctx, wr.mg, '机枪',
      mgActive ? `剩余 ${weaponLeft}s` : `${mgCost} 金币`,
      mgActive, mgEnabled,
      mgActive ? weaponProgress : 0
    )
    this.drawWeaponButton(
      ctx, wr.grenade, '手雷',
      grenadeActive ? `剩余 ${weaponLeft}s` : `${grenadeCost} 金币`,
      grenadeActive, grenadeEnabled,
      grenadeActive ? weaponProgress : 0
    )
    this.drawWeaponButton(
      ctx, wr.mortar, '迫击炮',
      mortarActive ? `剩余 ${weaponLeft}s` : `${mortarCost} 金币`,
      mortarActive, mortarEnabled,
      mortarActive ? weaponProgress : 0
    )

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawExchangeButton(ctx, r, offer, enabled) {
    fillRoundRect(
      ctx, r.x, r.y, r.w, r.h, 8,
      enabled ? 'rgba(44, 34, 16, 0.95)' : 'rgba(13, 20, 29, 0.9)'
    )
    strokeRoundRect(
      ctx, r.x, r.y, r.w, r.h, 8,
      enabled ? 'rgba(255, 215, 106, 0.65)' : 'rgba(80, 105, 130, 0.35)',
      1
    )

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setFont(ctx, 11, 'bold')
    ctx.fillStyle = enabled ? '#ffe08a' : 'rgba(150, 170, 190, 0.55)'
    ctx.fillText('兑换军功', r.x + r.w / 2, r.y + 12)

    setFont(ctx, 9, 'bold')
    ctx.fillStyle = enabled
      ? 'rgba(255, 224, 138, 0.85)'
      : 'rgba(120, 140, 160, 0.5)'
    ctx.fillText(`${offer.coins}金币=${offer.merit}`, r.x + r.w / 2, r.y + 26, r.w - 6)
  }

  drawWeaponButton(ctx, r, title, sub, active, enabled, progress) {
    const bg = active
      ? 'rgba(64, 52, 20, 0.95)'
      : enabled
        ? 'rgba(20, 36, 56, 0.95)'
        : 'rgba(13, 20, 29, 0.9)'
    const border = active
      ? 'rgba(255, 215, 106, 0.85)'
      : enabled
        ? 'rgba(120, 180, 255, 0.5)'
        : 'rgba(80, 105, 130, 0.35)'

    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 8, bg)
    strokeRoundRect(ctx, r.x, r.y, r.w, r.h, 8, border, active ? 1.6 : 1)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setFont(ctx, 11, 'bold')
    ctx.fillStyle = active
      ? '#ffe08a'
      : enabled
        ? '#eaf3ff'
        : 'rgba(150, 170, 190, 0.55)'
    ctx.fillText(title, r.x + r.w / 2, r.y + 12)

    setFont(ctx, 9, 'bold')
    ctx.fillStyle = active
      ? 'rgba(255, 215, 106, 0.9)'
      : enabled
        ? 'rgba(160, 200, 240, 0.85)'
        : 'rgba(120, 140, 160, 0.5)'
    ctx.fillText(sub, r.x + r.w / 2, r.y + 26)

    if (active && progress > 0) {
      const p = clamp(progress, 0, 1)
      fillRoundRect(
        ctx, r.x + 6, r.y + r.h - 4, r.w - 12, 2.5, 1.25,
        'rgba(255, 215, 106, 0.22)'
      )
      fillRoundRect(
        ctx, r.x + 6, r.y + r.h - 4, (r.w - 12) * p, 2.5, 1.25,
        '#ffd76a'
      )
    }
  }

  drawTarget(ctx) {
    const x = this.target.x
    const y = this.target.y
    const a = 0.25 + 0.15 * Math.sin(this.time * 8)

    ctx.strokeStyle = `rgba(140, 200, 255, ${a})`
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, 22, 0, TAU)
    ctx.stroke()
    fillCircle(ctx, x, y, 3, `rgba(180, 220, 255, ${a + 0.15})`)
  }

  drawBanner(ctx) {
    const b = this.banner
    const t = 1 - b.life / b.max
    const inA = Math.min(1, t * 8)
    const outA = b.life < 0.35 ? Math.max(0, b.life / 0.35) : 1
    const a = Math.min(inA, outA)
    if (a <= 0.01) return

    const y = Math.max(this.safeTop + 110, this.H * 0.22)
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    setFont(ctx, 30, 'bold')
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillText(b.text, this.W / 2 + 2, y + 2)
    ctx.fillStyle = b.color || '#eaf3ff'
    ctx.fillText(b.text, this.W / 2, y)

    if (b.sub) {
      setFont(ctx, 13, '500')
      ctx.fillStyle = 'rgba(190, 210, 232, 0.9)'
      ctx.fillText(b.sub, this.W / 2, y + 30)
    }

    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawMenu(ctx) {
    ctx.fillStyle = 'rgba(6, 10, 16, 0.58)'
    ctx.fillRect(0, 0, this.W, this.H)

    const W = this.W
    const H = this.H
    const L = this.menuLayout()
    const titleY = Math.min(H * 0.3, L.start.y - 166)
    const emblemSize = titleY < 160 ? 64 : 108
    const emblemY = Math.max(this.safeTop + emblemSize / 2 + 8, titleY - 96)

    if (this.emblemReady && this.emblemImage) {
      const size = emblemSize
      ctx.save()
      ctx.beginPath()
      ctx.arc(W / 2, emblemY, size / 2, 0, TAU)
      ctx.clip()
      ctx.drawImage(
        this.emblemImage,
        W / 2 - size / 2,
        emblemY - size / 2,
        size,
        size
      )
      ctx.restore()
      ctx.strokeStyle = 'rgba(88, 166, 255, 0.28)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(W / 2, emblemY, size / 2 + 1, 0, TAU)
      ctx.stroke()
    } else {
      drawEmblem(ctx, W / 2, emblemY, emblemSize * 0.35, this.time)
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    setFont(ctx, 44, 'bold')
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillText(GAME_TITLE, W / 2 + 2, titleY + 3)
    ctx.fillStyle = '#f2f7ff'
    ctx.fillText(GAME_TITLE, W / 2, titleY)

    setFont(ctx, 14, '500')
    ctx.fillStyle = 'rgba(168, 190, 214, 0.95)'
    ctx.fillText('拖动屏幕指挥部队，合兵扩编攻克敌军基地', W / 2, titleY + 30, W - 24)

    const cw = Math.min(W - 64, 300)
    const ch = 104
    const cx = (W - cw) / 2
    const cy = titleY + 50
    fillRoundRect(ctx, cx, cy, cw, ch, 16, 'rgba(12, 22, 34, 0.7)')
    strokeRoundRect(ctx, cx, cy, cw, ch, 16, 'rgba(120, 170, 220, 0.18)', 1)

    setFont(ctx, 11, '500')
    ctx.fillStyle = 'rgba(143, 166, 189, 0.9)'
    ctx.fillText(this.save.plays > 0 ? '历史战绩' : '准备出征', W / 2, cy + 18)

    setFont(ctx, 16, 'bold')
    if (this.save.plays > 0) {
      ctx.fillStyle = '#f0f6ff'
      ctx.fillText(`最高分 ${formatNumber(this.save.bestScore)}`, W / 2, cy + 42)
    } else {
      ctx.fillStyle = '#a8d8ff'
      ctx.fillText('第一次上战场，祝你好运', W / 2, cy + 42)
    }

    setFont(ctx, 11, '500')
    ctx.fillStyle = 'rgba(150, 172, 196, 0.9)'
    if (this.save.plays > 0) {
      ctx.fillText(
        `最远 第 ${this.save.bestWave} 关 · 累计歼灭 ${formatNumber(this.save.totalKills)}`,
        W / 2, cy + 64
      )
      ctx.fillStyle = 'rgba(255, 215, 106, 0.9)'
      ctx.fillText(
        `最高兵力 ${formatNumber(this.save.bestTroops)}`,
        W / 2, cy + 84
      )
    } else {
      ctx.fillText('拖动指挥 · 单体自动攻击', W / 2, cy + 64)
      ctx.fillStyle = 'rgba(255, 215, 106, 0.9)'
      ctx.fillText('点击底部编制卡招募兵力', W / 2, cy + 84)
    }

    if (L.continue) {
      this.drawButton(
        ctx, L.continue,
        `继续游戏 · 第${this.resume.level}关`,
        true
      )
    }
    this.drawButton(ctx, L.settings, '设置', false)
    this.drawButton(ctx, L.start, '新的开始', !L.hasResume)
    this.drawButton(ctx, L.test, '测试关卡 · 第29关', false)
    this.drawButton(ctx, L.about, '关于', false)

    setFont(ctx, 11, '500')
    ctx.fillStyle = 'rgba(110, 132, 156, 0.7)'
    ctx.fillText('本地存档 · 战绩保存在本机', W / 2, H - 24)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawSettings(ctx) {
    ctx.fillStyle = 'rgba(4, 8, 12, 0.72)'
    ctx.fillRect(0, 0, this.W, this.H)

    const L = this.settingsLayout()
    const p = L.panel

    fillRoundRect(ctx, p.x, p.y, p.w, p.h, 20, 'rgba(12, 22, 34, 0.97)')
    strokeRoundRect(
      ctx, p.x, p.y, p.w, p.h, 20,
      'rgba(143, 240, 181, 0.2)', 1
    )

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setFont(ctx, 22, 'bold')
    ctx.fillStyle = '#f0f6ff'
    ctx.fillText('设置', p.x + p.w / 2, p.y + 36)

    // 关闭 X
    ctx.strokeStyle = 'rgba(190, 210, 230, 0.7)'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    const c = L.close
    ctx.beginPath()
    ctx.moveTo(c.x + 9, c.y + 9)
    ctx.lineTo(c.x + c.w - 9, c.y + c.h - 9)
    ctx.moveTo(c.x + c.w - 9, c.y + 9)
    ctx.lineTo(c.x + 9, c.y + c.h - 9)
    ctx.stroke()

    // 背景音乐 / 战斗音效
    this.drawSettingRow(
      ctx, L.music, L.toggle,
      this.save.musicOn !== false,
      '背景音乐',
      '菜单：紧张战场 · 战斗：热血军事进行曲'
    )
    this.drawSettingRow(
      ctx, L.sfx, L.sfxToggle,
      this.save.sfxOn !== false,
      '战斗音效',
      '玩家/敌人射击 · 命中 · 受伤 · 爆炸'
    )

    this.drawButton(ctx, L.done, '完成', true)

    setFont(ctx, 10, '500')
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(120, 145, 170, 0.8)'
    ctx.fillText('设置会自动保存', p.x + p.w / 2, p.y + p.h - 18)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawAbout(ctx) {
    ctx.fillStyle = 'rgba(4, 8, 12, 0.72)'
    ctx.fillRect(0, 0, this.W, this.H)

    const L = this.aboutLayout()
    const p = L.panel

    fillRoundRect(ctx, p.x, p.y, p.w, p.h, 20, 'rgba(12, 22, 34, 0.97)')
    strokeRoundRect(
      ctx, p.x, p.y, p.w, p.h, 20,
      'rgba(120, 180, 255, 0.22)', 1
    )

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setFont(ctx, 22, 'bold')
    ctx.fillStyle = '#f0f6ff'
    ctx.fillText('关于', p.x + p.w / 2, p.y + 36)

    // 关闭 X
    const c = L.close
    ctx.strokeStyle = 'rgba(190, 210, 230, 0.7)'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(c.x + 9, c.y + 9)
    ctx.lineTo(c.x + c.w - 9, c.y + c.h - 9)
    ctx.moveTo(c.x + c.w - 9, c.y + 9)
    ctx.lineTo(c.x + 9, c.y + c.h - 9)
    ctx.stroke()

    setFont(ctx, 17, 'bold')
    ctx.fillStyle = '#eaf3ff'
    ctx.fillText('制作人：渝常念', p.x + p.w / 2, p.y + 88)

    setFont(ctx, 12, '500')
    ctx.fillStyle = 'rgba(255, 215, 106, 0.9)'
    ctx.fillText('游戏版本：V1.1', p.x + p.w / 2, p.y + 116)

    setFont(ctx, 13, '500')
    ctx.fillStyle = 'rgba(168, 190, 214, 0.95)'
    ctx.fillText('纯AI制作，不喜勿喷！', p.x + p.w / 2, p.y + 148)

    ctx.strokeStyle = 'rgba(120, 170, 220, 0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p.x + 28, p.y + 174)
    ctx.lineTo(p.x + p.w - 28, p.y + 174)
    ctx.stroke()

    setFont(ctx, 11, '500')
    ctx.fillStyle = 'rgba(143, 166, 189, 0.9)'
    ctx.fillText('反馈/建议请发邮箱：', p.x + p.w / 2, p.y + 198)

    setFont(ctx, 13, 'bold')
    ctx.fillStyle = COLORS.gold
    ctx.fillText('ycn2182651251@gmail.com', p.x + p.w / 2, p.y + 222)

    this.drawButton(ctx, L.done, '知道了', true)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawLevelNotice(ctx) {
    const n = this.levelNotice
    if (!n) return

    ctx.fillStyle = 'rgba(4, 8, 12, 0.72)'
    ctx.fillRect(0, 0, this.W, this.H)

    const L = this.noticeLayout()
    const p = L.panel
    fillRoundRect(ctx, p.x, p.y, p.w, p.h, 20, 'rgba(12, 22, 34, 0.97)')
    strokeRoundRect(
      ctx, p.x, p.y, p.w, p.h, 20,
      'rgba(255, 190, 120, 0.35)', 1
    )

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setFont(ctx, 20, 'bold')
    ctx.fillStyle = '#f0f6ff'
    ctx.fillText('敌军情报', p.x + p.w / 2, p.y + 38)

    const c = L.close
    ctx.strokeStyle = 'rgba(190, 210, 230, 0.7)'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(c.x + 9, c.y + 9)
    ctx.lineTo(c.x + c.w - 9, c.y + c.h - 9)
    ctx.moveTo(c.x + c.w - 9, c.y + 9)
    ctx.lineTo(c.x + 9, c.y + c.h - 9)
    ctx.stroke()

    setFont(ctx, 20, 'bold')
    ctx.fillStyle = n.color || '#ffcf6a'
    ctx.fillText(n.text, p.x + p.w / 2, p.y + 100)

    setFont(ctx, 12, '500')
    ctx.fillStyle = 'rgba(168, 190, 214, 0.95)'
    ctx.fillText(n.sub, p.x + p.w / 2, p.y + 138)

    this.drawButton(ctx, L.done, '知道了', true)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawSettingRow(ctx, row, t, on, title, sub) {
    fillRoundRect(ctx, row.x, row.y, row.w, row.h, 12, 'rgba(20, 34, 48, 0.9)')
    strokeRoundRect(ctx, row.x, row.y, row.w, row.h, 12, 'rgba(120, 170, 220, 0.2)', 1)

    ctx.textAlign = 'left'
    setFont(ctx, 14, 'bold')
    ctx.fillStyle = '#eaf3ff'
    ctx.fillText(title, row.x + 14, row.y + 22)

    setFont(ctx, 10, '500')
    ctx.fillStyle = 'rgba(150, 180, 210, 0.85)'
    ctx.fillText(sub, row.x + 14, row.y + 44)

    fillRoundRect(
      ctx, t.x, t.y, t.w, t.h, 16,
      on ? 'rgba(47, 124, 246, 0.95)' : 'rgba(55, 68, 82, 0.95)'
    )
    strokeRoundRect(
      ctx, t.x, t.y, t.w, t.h, 16,
      on ? 'rgba(160, 205, 255, 0.6)' : 'rgba(130, 150, 170, 0.4)', 1
    )
    fillCircle(
      ctx,
      on ? t.x + t.w - 16 : t.x + 16,
      t.y + t.h / 2,
      11,
      on ? '#ffffff' : 'rgba(190, 205, 220, 0.85)'
    )
    setFont(ctx, 10, 'bold')
    ctx.textAlign = 'center'
    ctx.fillStyle = on ? '#eaf3ff' : 'rgba(190, 205, 220, 0.85)'
    ctx.fillText(on ? '开' : '关', t.x + t.w / 2, t.y + t.h / 2 + 0.5)
    ctx.textAlign = 'left'
  }

  drawPause(ctx) {
    ctx.fillStyle = 'rgba(5, 9, 14, 0.66)'
    ctx.fillRect(0, 0, this.W, this.H)

    const L = this.pauseLayout()
    const p = L.panel
    fillRoundRect(ctx, p.x, p.y, p.w, p.h, 20, 'rgba(12, 22, 34, 0.94)')
    strokeRoundRect(ctx, p.x, p.y, p.w, p.h, 20, 'rgba(120, 170, 220, 0.22)', 1)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setFont(ctx, 28, 'bold')
    ctx.fillStyle = '#f0f6ff'
    ctx.fillText('暂停', this.W / 2, p.y + 54)

    setFont(ctx, 13, '500')
    ctx.fillStyle = 'rgba(143, 166, 189, 0.9)'
    ctx.fillText('战斗已暂停，部队正在待命', this.W / 2, p.y + 88)

    this.drawButton(ctx, L.resume, '继续战斗', true)
    this.drawButton(ctx, L.menu, '返回主菜单', false)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawGameOver(ctx) {
    ctx.fillStyle = 'rgba(5, 9, 14, 0.72)'
    ctx.fillRect(0, 0, this.W, this.H)

    const L = this.gameoverLayout()
    const p = L.panel
    fillRoundRect(ctx, p.x, p.y, p.w, p.h, 20, 'rgba(12, 22, 34, 0.95)')
    strokeRoundRect(
      ctx, p.x, p.y, p.w, p.h, 20,
      this.victory
        ? 'rgba(143, 240, 181, 0.28)'
        : 'rgba(255, 120, 120, 0.22)',
      1
    )

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const allClear = this.victory && this.level >= LEVELS.length
    setFont(ctx, 30, 'bold')
    ctx.fillStyle = this.victory ? '#8ff0b5' : '#ff8a8a'
    ctx.fillText(
      allClear
        ? '全部关卡完成'
        : this.victory ? `第 ${this.level} 关完成` : '全军覆没',
      this.W / 2, p.y + 42
    )

    setFont(ctx, 14, '500')
    ctx.fillStyle = 'rgba(168, 190, 214, 0.95)'
    ctx.fillText(
      this.victory
        ? allClear ? `${LEVELS.length} 关敌军已全部清剿` : '敌军基地已清剿'
        : this.levelMode
          ? `第 ${this.level} 关 · 全军覆没`
          : `坚守到第 ${this.wave} 波`,
      this.W / 2, p.y + 78
    )

    const stats = [
      { label: '本局得分', value: formatNumber(this.score), color: COLORS.gold },
      { label: '最高兵力', value: formatNumber(this.peakTroops), color: '#a8d8ff' },
      { label: '歼灭敌军', value: formatNumber(this.kills), color: '#f0f6ff' },
    ]
    const colW = (p.w - 32) / 3
    for (let i = 0; i < 3; i++) {
      const sx = p.x + 16 + colW * (i + 0.5)
      setFont(ctx, 11, '500')
      ctx.fillStyle = 'rgba(143, 166, 189, 0.9)'
      ctx.fillText(stats[i].label, sx, p.y + 112)

      setFont(ctx, 19, 'bold')
      ctx.fillStyle = stats[i].color
      ctx.fillText(stats[i].value, sx, p.y + 140)
    }

    let record = ''
    let recordColor = 'rgba(143, 166, 189, 0.9)'
    if (this.newBest && this.newTroopBest) {
      record = '★ 双项新纪录！'
      recordColor = COLORS.gold
    } else if (this.newBest) {
      record = '★ 得分新纪录！'
      recordColor = COLORS.gold
    } else if (this.newTroopBest) {
      record = '★ 兵力新纪录！'
      recordColor = COLORS.gold
    } else {
      record = `历史最高分 ${formatNumber(this.save.bestScore)}`
    }
    setFont(ctx, 14, 'bold')
    ctx.fillStyle = recordColor
    ctx.fillText(record, this.W / 2, p.y + 176)

    const canNext = this.victory && this.level < LEVELS.length
    const canRetry =
      !this.victory && (this.hasLevelCheckpoint() || this.hasResume())
    this.drawButton(
      ctx, L.restart,
      canNext
        ? `进入第 ${this.level + 1} 关`
        : canRetry ? `重试第 ${this.level} 关` : '再来一局',
      true
    )
    this.drawButton(ctx, L.menu, '返回主菜单', false)
    this.drawButton(ctx, L.share, '分享战绩', false)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  drawButton(ctx, r, label, primary) {
    if (primary) {
      fillRoundRect(ctx, r.x, r.y + 2, r.w, r.h, r.h / 2, 'rgba(0, 0, 0, 0.35)')
      fillRoundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2, '#2f7cf6')
      strokeRoundRect(
        ctx, r.x, r.y, r.w, r.h, r.h / 2,
        'rgba(160, 205, 255, 0.5)', 1.5
      )
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(r.x + r.h * 0.55, r.y + 4)
      ctx.lineTo(r.x + r.w - r.h * 0.55, r.y + 4)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
    } else {
      fillRoundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2, 'rgba(20, 32, 46, 0.88)')
      strokeRoundRect(
        ctx, r.x, r.y, r.w, r.h, r.h / 2,
        'rgba(120, 170, 220, 0.25)', 1
      )
      ctx.fillStyle = '#c8dcf2'
    }

    setFont(ctx, primary ? 17 : 15, 'bold')
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5)
  }
}
