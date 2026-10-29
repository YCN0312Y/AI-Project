import {
  TAU,
  rand,
  formatCompact,
  fillCircle,
  fillEllipse,
  fillRoundRect,
  strokeRoundRect,
} from './utils'

// 静态背景只绘制一次，之后每帧直接贴图，省性能
export function createBackground(w, h, dpr) {
  const canvas = wx.createCanvas()
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 土地/泥地底色
  ctx.fillStyle = '#1d150f'
  ctx.fillRect(0, 0, w, h)

  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#4a3523')
  g.addColorStop(0.45, '#33261a')
  g.addColorStop(1, '#17110c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // 大块土色斑驳
  const soil = ['#5b422b', '#6b4e31', '#3d2d1f', '#7a5b3a', '#4a3827', '#8a6a44']
  for (let i = 0; i < 44; i++) {
    const x = rand(-w * 0.05, w * 1.05)
    const y = rand(-h * 0.05, h * 1.05)
    ctx.globalAlpha = rand(0.035, 0.105)
    fillEllipse(ctx, x, y, rand(24, 150), rand(14, 78), soil[i % soil.length])
    ctx.globalAlpha = 1
  }

  // 深浅不一的干土 / 湿土
  for (let i = 0; i < 50; i++) {
    ctx.globalAlpha = rand(0.04, 0.12)
    fillEllipse(
      ctx,
      rand(0, w), rand(0, h),
      rand(8, 42), rand(4, 22),
      i % 3 === 0 ? '#1a120c' : '#7b5d3b'
    )
    ctx.globalAlpha = 1
  }

  // 车辙 / 踩踏出的土路
  ctx.lineCap = 'round'
  for (let i = 0; i < 5; i++) {
    const y0 = rand(0, h)
    ctx.strokeStyle = i % 2 === 0
      ? 'rgba(25, 16, 10, 0.20)'
      : 'rgba(150, 118, 78, 0.08)'
    ctx.lineWidth = rand(1.5, 4)
    ctx.beginPath()
    ctx.moveTo(-20, y0)
    ctx.bezierCurveTo(
      w * 0.3, y0 + rand(-60, 60),
      w * 0.7, y0 + rand(-60, 60),
      w + 20, y0 + rand(-40, 40)
    )
    ctx.stroke()
  }

  // 碎石 / 土块
  for (let i = 0; i < 70; i++) {
    const x = rand(6, w - 6)
    const y = rand(6, h - 6)
    const rx = rand(1.5, 5.5)
    const ry = rx * rand(0.55, 0.9)
    ctx.globalAlpha = rand(0.1, 0.3)
    fillEllipse(ctx, x, y + ry * 0.5, rx * 1.15, ry * 0.6, '#120c07')
    ctx.globalAlpha = rand(0.2, 0.6)
    fillEllipse(
      ctx, x, y, rx, ry,
      i % 4 === 0 ? '#8b7458' : i % 3 === 0 ? '#6f5a43' : '#5b4834'
    )
    ctx.globalAlpha = 1
  }

  // 干草 / 杂草
  ctx.lineCap = 'round'
  for (let i = 0; i < 130; i++) {
    const x = rand(4, w - 4)
    const y = rand(6, h - 4)
    const len = rand(3, 9)
    ctx.strokeStyle = i % 5 === 0
      ? 'rgba(92, 108, 58, 0.24)'
      : `rgba(150, 128, 76, ${rand(0.1, 0.28).toFixed(2)})`
    ctx.lineWidth = rand(0.7, 1.3)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + rand(-3, 3), y - len)
    ctx.moveTo(x, y)
    ctx.lineTo(x + rand(1, 5), y - len * rand(0.5, 0.9))
    ctx.stroke()
  }

  // 零散的小石子
  for (let i = 0; i < 24; i++) {
    ctx.globalAlpha = rand(0.08, 0.18)
    fillEllipse(
      ctx, rand(8, w - 8), rand(8, h - 8),
      rand(2, 7), rand(1.5, 4), '#a08a6d'
    )
    ctx.globalAlpha = 1
  }

  // 暗角
  const vg = ctx.createRadialGradient(
    w / 2, h * 0.48, Math.min(w, h) * 0.32,
    w / 2, h * 0.5, Math.max(w, h) * 0.78
  )
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)

  return canvas
}

// 小兵：圆身体 + 头盔弧 + 步枪（枪口朝向当前攻击目标）
export function drawFighter(ctx, x, y, r, colors, time, phase, flash, moving, aimAngle) {
  const bob = Math.sin(time * 7 + phase) * (moving ? 1.8 : 0.8)
  const by = y + bob
  const aim = typeof aimAngle === 'number' ? aimAngle : -0.25

  fillEllipse(ctx, x, y + r * 0.82, r * 0.95, r * 0.36, 'rgba(0,0,0,0.34)')

  // 身体
  ctx.beginPath()
  ctx.arc(x, by, r, 0, TAU)
  ctx.fillStyle = colors.body
  ctx.fill()
  ctx.lineWidth = Math.max(1, r * 0.15)
  ctx.strokeStyle = 'rgba(6, 12, 20, 0.6)'
  ctx.stroke()

  // 头盔
  ctx.beginPath()
  ctx.arc(x, by - r * 0.18, r * 0.76, Math.PI * 1.04, Math.PI * 1.96)
  ctx.strokeStyle = colors.helmet
  ctx.lineWidth = Math.max(1.8, r * 0.28)
  ctx.lineCap = 'round'
  ctx.stroke()

  // 眼睛
  const er = Math.max(0.9, r * 0.12)
  ctx.fillStyle = 'rgba(10, 18, 28, 0.9)'
  ctx.beginPath()
  ctx.arc(x - r * 0.3, by + r * 0.08, er, 0, TAU)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x + r * 0.3, by + r * 0.08, er, 0, TAU)
  ctx.fill()

  // 步枪：以身体边缘为握持点，沿攻击方向旋转
  ctx.save()
  const handX = x + Math.cos(aim) * r * 0.55
  const handY = by + Math.sin(aim) * r * 0.55
  ctx.translate(handX, handY)
  ctx.rotate(aim)
  fillRoundRect(ctx, -r * 0.4, -r * 0.12, r * 0.55, r * 0.32, r * 0.1, '#5a412b')
  fillRoundRect(ctx, r * 0.05, -r * 0.1, r * 0.98, r * 0.28, r * 0.07, '#4b5864')
  fillRoundRect(ctx, r * 0.98, -r * 0.055, r * 0.95, r * 0.15, r * 0.05, '#28313a')
  fillRoundRect(ctx, r * 0.45, r * 0.15, r * 0.3, r * 0.4, r * 0.05, '#333c45')
  ctx.fillStyle = 'rgba(215, 232, 245, 0.72)'
  ctx.fillRect(r * 0.14, -r * 0.105, r * 0.86, Math.max(0.7, r * 0.035))
  fillCircle(ctx, r * 1.95, r * 0.015, Math.max(0.8, r * 0.06), '#d7e2ea')
  fillCircle(ctx, r * 0.18, r * 0.03, Math.max(1, r * 0.13), '#2a2e33')
  ctx.restore()

  if (flash > 0) {
    ctx.globalAlpha = Math.min(0.8, flash)
    fillCircle(ctx, x, by, r, '#ffffff')
    ctx.globalAlpha = 1
  }
}

export function drawHpBar(ctx, x, y, w, frac, color) {
  const h = 3
  fillRoundRect(ctx, x - w / 2, y, w, h, 1.5, 'rgba(4, 9, 14, 0.7)')
  if (frac > 0.02) {
    fillRoundRect(ctx, x - w / 2, y, Math.max(2, w * frac), h, 1.5, color)
  }
}

export function drawArrow(ctx, b) {
  const nx = b.vx / b.speed
  const ny = b.vy / b.speed
  const s = Math.min(2.2, b.scale || 1)

  // 机枪曳光弹
  if (b.style === 'tracer') {
    ctx.lineCap = 'round'
    ctx.strokeStyle = b.hostile ? 'rgba(255, 100, 90, 0.28)' : 'rgba(255, 170, 70, 0.22)'
    ctx.lineWidth = 4.5 * s
    ctx.beginPath()
    ctx.moveTo(b.x - nx * 12 * s, b.y - ny * 12 * s)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    ctx.strokeStyle = b.hostile ? '#ff6f5f' : '#ffd27a'
    ctx.lineWidth = 1.6 * s
    ctx.beginPath()
    ctx.moveTo(b.x - nx * 9 * s, b.y - ny * 9 * s)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    fillCircle(ctx, b.x, b.y, 1.3 * s, '#fff3c4')
    return
  }

  const trail = b.hostile ? 'rgba(255, 100, 90, 0.28)' : 'rgba(255, 215, 90, 0.16)'
  const main = b.hostile ? '#ff6f5f' : '#ffd75e'
  const tip = b.hostile ? '#ffe0d8' : '#fff3bf'

  ctx.lineCap = 'round'
  ctx.strokeStyle = trail
  ctx.lineWidth = 5 * s
  ctx.beginPath()
  ctx.moveTo(b.x - nx * 15 * s, b.y - ny * 15 * s)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()

  ctx.strokeStyle = main
  ctx.lineWidth = 2 * s
  ctx.beginPath()
  ctx.moveTo(b.x - nx * 10 * s, b.y - ny * 10 * s)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()

  fillCircle(ctx, b.x, b.y, 1.6 * s, tip)
}

// 我方/敌方编制单位：士兵本体 + 可分离的“等级 人数”标签
// 标签单独绘制，保证在草丛、石头等掩体之上仍然可读
export function drawUnitToken(ctx, u, time, showBadge = true) {
  drawFighter(
    ctx, u.x, u.y, u.r,
    u.colors, time, u.phase, u.hitFlash, u.moving, u.aimAngle
  )
  if (showBadge) drawUnitBadge(ctx, u)
}

export function drawUnitBadge(ctx, u) {
  // 部屋内的驻军只显示士兵本体，部门名称/数量由建筑标签显示
  if (u.dead) return
  const weaponName = u.isEnemy && { mg: '机枪', grenade: '手雷', mortar: '迫击炮' }[u.weapon]
  if (weaponName) {
    ctx.font = 'bold 10px sans-serif'
    const width = ctx.measureText(weaponName).width + 12
    const y = u.y + u.r + 6
    fillRoundRect(ctx, u.x - width / 2, y, width, 16, 5, 'rgba(80, 16, 12, 0.94)')
    ctx.fillStyle = '#ffc0a4'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(weaponName, u.x, y + 8)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  if (u.hideBadge) return

  const label = `${u.tierName} ${formatCompact(u.troops)}`
  ctx.font = 'bold 9px sans-serif'
  const tw = ctx.measureText(label).width
  const pw = tw + 13
  const ph = 14
  const px = u.x - pw / 2
  const py = u.y - u.r - 23

  fillRoundRect(ctx, px, py, pw, ph, 7, u.badgeBg || 'rgba(6, 12, 20, 0.8)')
  strokeRoundRect(
    ctx, px, py, pw, ph, 7,
    u.isEnemy ? 'rgba(200, 215, 230, 0.25)' : 'rgba(255, 140, 120, 0.3)', 1
  )

  // 编制色条
  ctx.fillStyle = u.tierColor
  ctx.fillRect(px + 3, py + 3.5, 2.5, ph - 7)

  ctx.fillStyle = '#eaf3ff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, u.x + 1.5, py + ph / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

export function drawCrate(ctx, c, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 4 + c.phase)
  const bob = Math.sin(time * 3 + c.phase) * 2

  // 地面光环
  ctx.strokeStyle = `rgba(120, 190, 255, ${0.18 + pulse * 0.22})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(c.x, c.y, c.r + 8 + pulse * 4, 0, TAU)
  ctx.stroke()

  fillEllipse(ctx, c.x, c.y + 20, c.r * 0.85, 4, 'rgba(0,0,0,0.3)')

  const s = 28
  const bx = c.x - s / 2
  const by = c.y - s / 2 + bob

  fillRoundRect(ctx, bx, by, s, s, 6, '#1d2f44')
  strokeRoundRect(ctx, bx, by, s, s, 6, 'rgba(110, 168, 255, 0.9)', 2)

  // 十字标记
  ctx.fillStyle = '#a8d6ff'
  ctx.fillRect(c.x - 2.5, by + 6, 5, 16)
  ctx.fillRect(bx + 6, by + 11.5, 16, 5)

  // 高光
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(bx + 6, by + 3)
  ctx.lineTo(bx + s - 8, by + 3)
  ctx.stroke()
}

// 手雷飞行轨迹
export function drawGrenade(ctx, g, time) {
  const t = Math.min(1, g.t / g.dur)
  const groundX = g.x0 + (g.x1 - g.x0) * t
  const groundY = g.y0 + (g.y1 - g.y0) * t
  const mortar = g.kind === 'mortar'
  const arc = Math.sin(Math.PI * t) * (mortar ? 80 : 46)
  const x = groundX
  const y = groundY - arc

  fillEllipse(ctx, groundX, groundY + 4, 5, 2, 'rgba(0,0,0,0.28)')

  if (mortar) {
    fillEllipse(ctx, x, y, 4, 7, '#b8c6d4')
    fillCircle(ctx, x, y - 5, 3, g.hostile ? '#ff6557' : '#ffbf66')
    ctx.fillStyle = '#657887'
    ctx.fillRect(x - 6, y + 4, 12, 3)
    return
  }

  ctx.beginPath()
  ctx.arc(x, y, 4, 0, TAU)
  ctx.fillStyle = g.hostile ? '#a94438' : '#3f4d38'
  ctx.fill()
  ctx.strokeStyle = 'rgba(20, 28, 18, 0.85)'
  ctx.lineWidth = 1.2
  ctx.stroke()

  fillCircle(ctx, x + 2.5, y - 4, 1.5, '#ffd36a')
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 22)
  fillCircle(ctx, x + 3.2, y - 5, 1, '#fff3c4')
  ctx.globalAlpha = 1
}

// 砖墙：红褐色砖块 + 灰缝，替代原来的蓝色围墙
function drawWall(ctx, c) {
  const x0 = c.x - c.w / 2
  const y0 = c.y - c.h / 2
  const w = c.w
  const h = c.h

  ctx.fillStyle = '#8a4d3c'
  ctx.fillRect(x0, y0, w, h)

  ctx.save()
  ctx.beginPath()
  ctx.rect(x0, y0, w, h)
  ctx.clip()

  ctx.strokeStyle = 'rgba(44, 24, 19, 0.72)'
  ctx.lineWidth = 1
  ctx.beginPath()
  if (w >= h) {
    // 横向墙：一排砖，竖缝错开
    const mid = y0 + h * 0.5
    ctx.moveTo(x0, mid)
    ctx.lineTo(x0 + w, mid)
    const step = 15
    for (let x = x0 + step * 0.5, row = 0; x < x0 + w; x += step, row++) {
      ctx.moveTo(x, y0)
      ctx.lineTo(x, mid)
    }
    for (let x = x0 + step, row = 0; x < x0 + w; x += step, row++) {
      ctx.moveTo(x, mid)
      ctx.lineTo(x, y0 + h)
    }
  } else {
    // 纵向墙：砖块沿纵向排列
    const mid = x0 + w * 0.5
    ctx.moveTo(mid, y0)
    ctx.lineTo(mid, y0 + h)
    const step = 15
    for (let y = y0 + step * 0.5; y < y0 + h; y += step) {
      ctx.moveTo(x0, y)
      ctx.lineTo(mid, y)
    }
    for (let y = y0 + step; y < y0 + h; y += step) {
      ctx.moveTo(mid, y)
      ctx.lineTo(x0 + w, y)
    }
  }
  ctx.stroke()

  // 砖面高光与斑驳
  ctx.fillStyle = 'rgba(238, 178, 142, 0.14)'
  if (w >= h) ctx.fillRect(x0 + 1, y0 + 1, Math.max(0, w - 2), 1)
  else ctx.fillRect(x0 + 1, y0 + 1, 1, Math.max(0, h - 2))

  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#3f2119'
  for (let i = 0; i < 6; i++) {
    const px = x0 + ((i * 37 + 11) % Math.max(1, w))
    const py = y0 + ((i * 19 + 5) % Math.max(1, h))
    ctx.fillRect(px, py, 2, 1)
  }
  ctx.globalAlpha = 1
  ctx.restore()

  ctx.strokeStyle = 'rgba(38, 20, 16, 0.8)'
  ctx.lineWidth = 1
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1)
}

// 草丛：优先使用美术图（小草丛 / 灌木丛）；没有图片时使用程序化草叶作为回退
export function drawBushes(ctx, bushes, time, grassImage, shrubImage) {
  const fallbackImage = grassImage || shrubImage
  if (grassImage || shrubImage) {
    for (let i = 0; i < bushes.length; i++) {
      const b = bushes[i]
      const isShrub = b.kind === 'shrub'
      const image = (isShrub ? shrubImage : grassImage) || fallbackImage
      if (!image) continue
      const aspect = image.width / image.height
      const width = b.r * (isShrub ? 2.2 : 2.05)
      const height = width / aspect
      const sway = Math.sin(time * 1.8 + b.phase) * 1.5

      fillEllipse(
        ctx, b.x + 2, b.y + b.r * 0.55,
        b.r * 0.9, b.r * 0.26, 'rgba(7, 12, 7, 0.28)'
      )

      ctx.save()
      ctx.translate(b.x + sway, b.y + b.r * 0.55)
      ctx.rotate(Math.sin(time * 0.9 + b.phase) * 0.014)
      if (Math.sin(b.phase) < 0) ctx.scale(-1, 1)
      // 玩家进入草丛时降低草丛透明度，方便看到自己的部队
      ctx.globalAlpha = b.playerInside ? 0.4 : 0.96
      ctx.drawImage(image, -width / 2, -height, width, height)
      ctx.restore()
    }
    return
  }

  const clumpColors = ['#2f4a2b', '#3a5a31', '#456837', '#527640']
  const bladeColors = [
    'rgba(96, 132, 68, 0.58)',
    'rgba(116, 154, 82, 0.62)',
    'rgba(143, 179, 94, 0.52)',
    'rgba(74, 108, 55, 0.62)',
    'rgba(170, 197, 112, 0.42)',
  ]

  for (let i = 0; i < bushes.length; i++) {
    const b = bushes[i]
    const r = b.r
    const sway = Math.sin(time * 1.9 + b.phase) * 2.2

    // 地面阴影与苔藓
    fillEllipse(ctx, b.x + 2, b.y + r * 0.56, r * 0.92, r * 0.27, 'rgba(7, 12, 7, 0.28)')
    ctx.globalAlpha = 0.28
    fillEllipse(ctx, b.x, b.y + r * 0.27, r * 0.86, r * 0.4, '#2c4027')
    ctx.globalAlpha = 1

    // 高低错落的草团，避免一个大圆饼
    const clumps = [
      { dx: -0.36, dy: 0.16, rx: 0.46, ry: 0.28, c: 0 },
      { dx: 0.33, dy: 0.18, rx: 0.44, ry: 0.26, c: 2 },
      { dx: -0.05, dy: 0.02, rx: 0.52, ry: 0.34, c: 1 },
      { dx: 0.14, dy: -0.18, rx: 0.36, ry: 0.28, c: 3 },
      { dx: -0.18, dy: -0.2, rx: 0.34, ry: 0.24, c: 0 },
      { dx: 0.4, dy: -0.05, rx: 0.3, ry: 0.24, c: 1 },
      { dx: -0.42, dy: -0.03, rx: 0.3, ry: 0.22, c: 2 },
    ]
    for (let c = 0; c < clumps.length; c++) {
      const p = clumps[c]
      ctx.globalAlpha = 0.46 + (c % 3) * 0.06
      fillEllipse(
        ctx,
        b.x + p.dx * r,
        b.y + p.dy * r + r * 0.1,
        p.rx * r,
        p.ry * r,
        clumpColors[p.c]
      )
    }
    ctx.globalAlpha = 1

    // 细草叶
    ctx.lineCap = 'round'
    const blades = 34
    for (let k = 0; k < blades; k++) {
      const a = (k / blades) * TAU + b.phase * 0.23
      const spread = 0.16 + ((k * 37) % 100) / 100 * 0.36
      const bx = b.x + Math.cos(a) * r * spread
      const by = b.y + r * 0.24 + Math.sin(a) * r * spread * 0.32
      const len = r * (0.5 + ((k * 53) % 100) / 100 * 0.52)
      const tipX =
        bx + Math.cos(a) * r * 0.22 + sway * (0.55 + (k % 4) * 0.18)
      const tipY = by - len + Math.sin(a) * r * 0.08

      ctx.strokeStyle = bladeColors[k % bladeColors.length]
      ctx.lineWidth = 0.8 + (k % 3) * 0.22
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.quadraticCurveTo(
        bx + Math.cos(a) * r * 0.08 + sway * 0.25,
        by - len * 0.58,
        tipX,
        tipY
      )
      ctx.stroke()

      if (k % 7 === 2) {
        fillCircle(ctx, tipX, tipY, 0.9, 'rgba(214, 207, 142, 0.65)')
      }
    }

    // 几根亮色高草
    ctx.strokeStyle = 'rgba(190, 214, 130, 0.5)'
    ctx.lineWidth = 1.1
    for (let k = 0; k < 5; k++) {
      const a = b.phase + k * 1.37
      const bx = b.x + Math.cos(a) * r * 0.26
      const by = b.y + r * 0.22
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.quadraticCurveTo(
        bx + sway * 0.4,
        by - r * 0.55,
        bx + Math.cos(a) * r * 0.2 + sway * 0.8,
        by - r * 0.9
      )
      ctx.stroke()
    }
  }
}

// 掩体：房屋（矩形）或石块/沙袋（圆形）
export function drawCover(ctx, c) {
  // 前沿哨卡的图标由场景装饰绘制，碰撞体只参与阻挡
  if (c.kind === 'outpost') return
  if (c.kind === 'wall') {
    drawWall(ctx, c)
    return
  }
  if (c.shape === 'rect') {
    drawHouse(ctx, c)
    return
  }

  const r = c.r
  fillEllipse(ctx, c.x, c.y + r * 0.7, r * 1.05, r * 0.4, 'rgba(0,0,0,0.35)')

  if (c.kind === 'sandbag') {
    const bagW = r * 1.1
    const bagH = r * 0.5
    for (let i = 0; i < 3; i++) {
      const n = i === 2 ? 1 : 2
      for (let j = 0; j < n; j++) {
        const bx = c.x + (j - (n - 1) / 2) * bagW * 0.92
        const by = c.y + r * 0.35 - i * bagH * 0.85
        fillRoundRect(
          ctx,
          bx - bagW / 2, by - bagH / 2, bagW, bagH, bagH / 2,
          i === 0 ? '#8a6a45' : i === 1 ? '#9a7950' : '#7b5c3b'
        )
        ctx.strokeStyle = 'rgba(48, 33, 20, 0.55)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(bx - bagW * 0.35, by)
        ctx.quadraticCurveTo(bx, by + bagH * 0.18, bx + bagW * 0.35, by)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = 'rgba(255, 230, 190, 0.18)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(c.x - r * 0.55, c.y - r * 0.42)
    ctx.lineTo(c.x + r * 0.4, c.y - r * 0.42)
    ctx.stroke()
  } else {
    const pts = 7
    ctx.beginPath()
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * TAU + 0.35
      const rr = r * (0.82 + 0.18 * Math.sin(c.phase + i * 2.1))
      const px = c.x + Math.cos(a) * rr
      const py = c.y + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = '#4c5661'
    ctx.fill()
    ctx.strokeStyle = 'rgba(16, 22, 30, 0.75)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.save()
    ctx.translate(c.x, c.y - r * 0.2)
    ctx.scale(1, 0.62)
    ctx.beginPath()
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * TAU + 0.35
      const rr = r * (0.62 + 0.12 * Math.sin(c.phase + i * 1.7))
      const px = Math.cos(a) * rr
      const py = Math.sin(a) * rr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = '#6d7985'
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = 'rgba(24, 32, 40, 0.5)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(c.x - r * 0.15, c.y - r * 0.1)
    ctx.lineTo(c.x - r * 0.35, c.y + r * 0.25)
    ctx.lineTo(c.x - r * 0.05, c.y + r * 0.5)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(105, 160, 125, 0.35)'
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    for (let i = 0; i < 3; i++) {
      const bx = c.x + (i - 1) * r * 0.5
      const by = c.y + r * 0.62
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(bx - 2, by - 5)
      ctx.moveTo(bx, by)
      ctx.lineTo(bx + 3, by - 4)
      ctx.stroke()
    }
  }
}

// 房屋掩体：矩形碰撞，顶视角小屋
function drawHouse(ctx, c) {
  const w = c.w
  const h = c.h
  const x0 = c.x - w / 2
  const y0 = c.y - h / 2

  fillRoundRect(ctx, x0 + 5, y0 + 8, w, h, 6, 'rgba(0,0,0,0.35)')

  const roofs = ['#7d5a40', '#6b6a52', '#5f6870', '#8a6a4a']
  const roof =
    roofs[Math.floor((c.phase / TAU) * roofs.length) % roofs.length]

  // 墙体
  fillRoundRect(ctx, x0, y0, w, h, 5, '#5a4638')
  // 屋顶
  fillRoundRect(ctx, x0 + 4, y0 + 3, w - 8, h - 13, 4, roof)

  // 屋脊
  ctx.strokeStyle = 'rgba(38, 25, 16, 0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x0 + 10, c.y - 4)
  ctx.lineTo(x0 + w - 10, c.y - 4)
  ctx.stroke()

  // 屋顶高光
  ctx.strokeStyle = 'rgba(255, 225, 180, 0.16)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x0 + 8, y0 + 7)
  ctx.lineTo(x0 + w - 8, y0 + 7)
  ctx.stroke()

  // 门
  fillRoundRect(ctx, c.x - 7, y0 + h - 16, 14, 16, 2, '#31241a')
  fillCircle(ctx, c.x + 3, y0 + h - 8, 1.2, 'rgba(240, 200, 120, 0.8)')

  // 窗户
  const winW = Math.max(8, w * 0.15)
  fillRoundRect(ctx, x0 + 10, y0 + 12, winW, 8, 2, '#f2c46d')
  fillRoundRect(ctx, x0 + w - 10 - winW, y0 + 12, winW, 8, 2, '#f2c46d')
  ctx.strokeStyle = 'rgba(70, 48, 28, 0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0 + 10 + winW / 2, y0 + 12)
  ctx.lineTo(x0 + 10 + winW / 2, y0 + 20)
  ctx.moveTo(x0 + w - 10 - winW / 2, y0 + 12)
  ctx.lineTo(x0 + w - 10 - winW / 2, y0 + 20)
  ctx.stroke()

  // 烟囱
  fillRoundRect(ctx, x0 + w - 22, y0 - 5, 10, 9, 2, '#4a382b')

  // 墙脚
  ctx.fillStyle = 'rgba(28, 19, 13, 0.5)'
  ctx.fillRect(x0 + 3, y0 + h - 4, w - 6, 3)
}

// 主菜单徽章：圆环 + 交叉步枪
export function drawEmblem(ctx, x, y, r, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.2)

  const rg = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.6)
  rg.addColorStop(0, `rgba(88, 166, 255, ${0.16 + pulse * 0.1})`)
  rg.addColorStop(1, 'rgba(88, 166, 255, 0)')
  ctx.fillStyle = rg
  ctx.beginPath()
  ctx.arc(x, y, r * 1.6, 0, TAU)
  ctx.fill()

  fillCircle(ctx, x, y, r, 'rgba(12, 22, 34, 0.85)')
  ctx.strokeStyle = `rgba(120, 180, 255, ${0.55 + pulse * 0.25})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.stroke()

  ctx.lineCap = 'round'
  for (let d = -1; d <= 1; d += 2) {
    const dx = d * r * 0.52
    const dy = r * 0.52

    // 枪身 + 枪管
    ctx.strokeStyle = '#c8ddf5'
    ctx.lineWidth = Math.max(2, r * 0.09)
    ctx.beginPath()
    ctx.moveTo(x - dx, y + dy)
    ctx.lineTo(x + dx, y - dy)
    ctx.stroke()

    // 枪托
    ctx.strokeStyle = '#8a6a4a'
    ctx.lineWidth = Math.max(3.5, r * 0.14)
    ctx.beginPath()
    ctx.moveTo(x - dx, y + dy)
    ctx.lineTo(x - dx + d * r * 0.24, y + dy - r * 0.24)
    ctx.stroke()

    // 弹匣
    ctx.strokeStyle = '#7d8e9e'
    ctx.lineWidth = Math.max(1.6, r * 0.07)
    ctx.beginPath()
    ctx.moveTo(x - dx + d * r * 0.14, y + dy - r * 0.14)
    ctx.lineTo(x - dx + d * r * 0.26, y + dy + r * 0.02)
    ctx.stroke()

    // 枪口
    fillCircle(ctx, x + dx, y - dy, Math.max(1.2, r * 0.075), '#eef5ff')
  }

  fillCircle(ctx, x, y, r * 0.16, '#58a6ff')
}
