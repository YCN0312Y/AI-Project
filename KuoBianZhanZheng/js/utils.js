export const TAU = Math.PI * 2

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function rand(a, b) {
  return a + Math.random() * (b - a)
}

export function randInt(a, b) {
  return Math.floor(rand(a, b + 1))
}

export function dist(ax, ay, bx, by) {
  const dx = ax - bx
  const dy = ay - by
  return Math.sqrt(dx * dx + dy * dy)
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

export function pointsInRect(px, py, r, pad = 0) {
  return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

export function setFont(ctx, size, weight = 'bold') {
  ctx.font = `${weight} ${size}px sans-serif`
}

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function fillRoundRect(ctx, x, y, w, h, r, color) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = color
  ctx.fill()
}

export function strokeRoundRect(ctx, x, y, w, h, r, color, width = 1) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

export function fillCircle(ctx, x, y, r, color) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.fillStyle = color
  ctx.fill()
}

export function fillEllipse(ctx, x, y, rx, ry, color) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, ry / rx)
  ctx.beginPath()
  ctx.arc(0, 0, rx, 0, TAU)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

// 线段是否穿过圆（用于箭矢视线/掩体判定）
export function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy

  if (len2 === 0) {
    const ddx = x1 - cx
    const ddy = y1 - cy
    return ddx * ddx + ddy * ddy <= r * r
  }

  let t = ((cx - x1) * dx + (cy - y1) * dy) / len2
  t = clamp(t, 0, 1)
  const px = x1 + dx * t
  const py = y1 + dy * t
  const ddx = px - cx
  const ddy = py - cy
  return ddx * ddx + ddy * ddy <= r * r
}

// 线段是否穿过矩形（Liang-Barsky，用于房屋掩体的视线判定）
export function segmentHitsRect(x1, y1, x2, y2, left, top, right, bottom) {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  const p = [-dx, dx, -dy, dy]
  const q = [x1 - left, right - x1, y1 - top, bottom - y1]

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false
    } else {
      const r = q[i] / p[i]
      if (p[i] < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return true
}

// 原地删除数组中的 dead 元素，避免每帧产生新数组
export function pruneDead(arr) {
  let w = 0
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (!v.dead) arr[w++] = v
  }
  arr.length = w
}

// 12345 -> "12,345"
export function formatNumber(n) {
  const v = Math.max(0, Math.floor(n))
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 26,244 -> "2.6万"；2,916 -> "2.9k"
export function formatCompact(n) {
  const v = Math.max(0, Math.floor(n))
  if (v >= 10000) {
    return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  }
  if (v >= 1000) {
    return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return String(v)
}
