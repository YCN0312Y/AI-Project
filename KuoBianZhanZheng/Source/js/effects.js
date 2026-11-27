import { TAU, clamp, setFont } from './utils'

export class Effects {
  constructor() {
    this.parts = []
    this.rings = []
    this.texts = []
    this.quality = 1
  }

  // 手机端适当减少粒子数量；不影响命中判定和伤害数值。
  setQuality(quality) {
    this.quality = clamp(quality, 0.4, 1)
  }

  spark(x, y, color, count = 6, speed = 110) {
    const n = Math.max(2, Math.round(count * this.quality))
    const maxParts = Math.round(260 * this.quality)
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= maxParts) return
      const a = Math.random() * TAU
      const v = speed * (0.35 + Math.random() * 0.85)
      const life = 0.28 + Math.random() * 0.38
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        max: life,
        r: 1.2 + Math.random() * 2.2,
        color,
      })
    }
  }

  ring(x, y, color, r0, r1, life) {
    const maxRings = Math.round(40 * this.quality)
    if (this.rings.length >= maxRings) this.rings.shift()
    this.rings.push({ x, y, color, r0, r1, life, max: life })
  }

  text(x, y, str, color, size = 13, life = 0.7) {
    const maxTexts = Math.round(36 * this.quality)
    if (this.texts.length >= maxTexts) this.texts.shift()
    this.texts.push({ x, y, str, color, size, life, max: life, vy: -26 })
  }

  update(dt) {
    const drag = Math.pow(0.08, dt)

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= drag
      p.vy *= drag
      p.life -= dt
    }
    for (let i = 0; i < this.rings.length; i++) {
      this.rings[i].life -= dt
    }
    for (let i = 0; i < this.texts.length; i++) {
      const t = this.texts[i]
      t.y += t.vy * dt
      t.vy *= drag
      t.life -= dt
    }

    this.compact(this.parts)
    this.compact(this.rings)
    this.compact(this.texts)
  }

  compact(list) {
    let w = 0
    for (let i = 0; i < list.length; i++) {
      if (list[i].life > 0) list[w++] = list[i]
    }
    list.length = w
  }

  draw(ctx) {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]
      const a = clamp(p.life / p.max, 0, 1)
      ctx.globalAlpha = a
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, TAU)
      ctx.fill()
    }

    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i]
      const t = 1 - r.life / r.max
      const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - t, 2))
      ctx.globalAlpha = 1 - t
      ctx.strokeStyle = r.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(r.x, r.y, rad, 0, TAU)
      ctx.stroke()
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < this.texts.length; i++) {
      const t = this.texts[i]
      const a = clamp(t.life / t.max, 0, 1)
      ctx.globalAlpha = a
      ctx.fillStyle = t.color
      setFont(ctx, t.size, 'bold')
      ctx.fillText(t.str, t.x, t.y)
    }

    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  clear() {
    this.parts.length = 0
    this.rings.length = 0
    this.texts.length = 0
  }
}
