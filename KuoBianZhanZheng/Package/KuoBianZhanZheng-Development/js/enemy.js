import { CFG, COLORS, TROOP_TIERS } from './config'
import { TAU, rand, clamp } from './utils'
import { drawUnitToken } from './draw'

// 敌方编制单位：同样有班/排/连……人数与标签，并使用远程武器
// 兵力就是生命值；攻击伤害由编制等级决定（班=1，之后每级 ×3）
export class Enemy {
  constructor(type, x, y, wave, tier, troops) {
    const t = CFG.enemy.types[type]
    const info = TROOP_TIERS[tier - 1]

    const spMul = Math.min(
      CFG.wave.maxSpeedMul,
      1 + CFG.wave.speedGrowth * (wave - 1)
    )
    const power = Math.pow(
      (troops === undefined ? info.troops : Math.max(1, Math.round(troops))) /
        CFG.squad.baseTroops,
      CFG.squad.powerExponent
    )

    this.type = type
    this.x = x
    this.y = y
    this.tier = tier
    this.tierName = info.name
    // 敌方标签色条用兵种色，和红色的我方标签区分开
    this.tierColor = COLORS[type].accent
    this.troopsMax =
      troops === undefined ? info.troops : Math.max(1, Math.round(troops))
    this.troops = this.troopsMax
    this.power = power

    this.r = Math.min(22, t.radius + (tier - 1) * 1.2)
    // 实际移动/挤位用的碰撞半径比画出来的身体小，避免三级以上编制
    // 在 30~40px 的门缝、战壕里互相卡死；视觉尺寸仍用 this.r
    this.cr = Math.max(6, Math.min(10, this.r * 0.65))
    this.speed = t.speed * spMul
    this.range = t.range
    this.attackInterval = t.attackInterval
    this.weapon = 'rifle'
    this.score = Math.max(t.score, Math.round(t.score * power))

    this.cool = rand(0.1, 0.35)
    this.phase = Math.random() * TAU
    this.hitFlash = 0
    this.kx = 0
    this.ky = 0
    this.moving = true
    this.dead = false
    this.aimAngle = Math.PI / 2

    this.stuckTime = 0
    this.lastCheckX = x
    this.lastCheckY = y
    this.wasTryingToMove = false
    this.detourTimer = 0
    this.detourSign = 1

    this.aggro = true
    this.homeX = x
    this.homeY = y
    this.aggroRange = CFG.enemy.aggroRange

    this.searching = false
    this.searchTimer = 0
    this.searchAngle = 0
    this.searchLegTimer = 0
    this.searchWait = 0
    this.lastSeenX = x
    this.lastSeenY = y

    this.colors = COLORS[type]
    this.badgeBg = 'rgba(20, 24, 30, 0.84)'
    this.isEnemy = true
  }

  update(dt, game) {
    if (this.dead) return
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6)

    // 卡住检测：想移动但几乎没前进，就短暂侧移换路
    const moved = Math.hypot(
      this.x - this.lastCheckX,
      this.y - this.lastCheckY
    )
    this.lastCheckX = this.x
    this.lastCheckY = this.y
    if (this.wasTryingToMove && moved < 0.03) {
      this.stuckTime += dt
    } else {
      this.stuckTime = Math.max(0, this.stuckTime - dt)
    }
    if (this.stuckTime > 0.7) {
      this.stuckTime = 0
      this.detourTimer = 0.45
      this.detourSign = -this.detourSign
    }
    if (this.detourTimer > 0) this.detourTimer -= dt
    if (this.avoidTimer > 0) this.avoidTimer = Math.max(0, this.avoidTimer - dt)

    // 受击击退
    if (this.kx !== 0 || this.ky !== 0) {
      this.x += this.kx * dt
      this.y += this.ky * dt
      const damp = Math.exp(-9 * dt)
      this.kx *= damp
      this.ky *= damp
      if (Math.abs(this.kx) < 1 && Math.abs(this.ky) < 1) {
        this.kx = 0
        this.ky = 0
      }
    }

    // 驻守状态：没有发现玩家时留在原位
    if (!this.aggro) {
      // 基地尚未激活时，屋内的驻军保持待命，不主动索敌
      const insideIdleBase =
        game.levelMode && !game.baseActivated && this.y < game.levelMidY
      if (!insideIdleBase) {
        const nearest = game.findNearestUnit(this.x, this.y, true)
        if (nearest) {
          const nd = Math.hypot(nearest.x - this.x, nearest.y - this.y)
          if (
            nd <= this.aggroRange &&
            !game.lineBlocked(this.x, this.y, nearest.x, nearest.y)
          ) {
            this.aggro = true
          }
        }
      }

      if (!this.aggro) {
        const hx = this.homeX - this.x
        const hy = this.homeY - this.y
        const hd = Math.sqrt(hx * hx + hy * hy)
        if (hd > 2) {
          const ux = hx / hd
          const uy = hy / hd
          const nav = game.steerEnemy(
            this, { x: this.homeX, y: this.homeY }, ux, uy
          )
          const mx = nav ? nav.x : ux
          const my = nav ? nav.y : uy
          if (mx !== 0 || my !== 0) {
            const step = Math.min(hd, this.speed * 0.5 * dt)
            this.x += mx * step
            this.y += my * step
            this.moving = true
          } else {
            this.moving = false
          }
        } else {
          this.moving = false
        }
        this.wasTryingToMove = false
        return
      }
    }

    // 玩家进入草丛后：丢失目标，进入搜索巡逻
    if (this.searching) {
      const seen = game.findNearestVisibleUnit(this.x, this.y, this.range)
      if (seen) {
        this.searching = false
        this.searchTimer = 0
        this.lastSeenX = seen.x
        this.lastSeenY = seen.y
      } else {
        this.updateSearch(dt, game)
        return
      }
    }

    // 射程内且有清晰视线：停下射击
    const visible = game.findNearestVisibleUnit(this.x, this.y, this.range)
    if (visible) {
      this.lastSeenX = visible.x
      this.lastSeenY = visible.y
      this.aimAngle = Math.atan2(visible.y - this.y, visible.x - this.x)
      this.moving = false
      this.wasTryingToMove = false
      this.cool -= dt
      if (this.cool <= 0) {
        if (this.weapon === 'mg') game.enemyFireMG(this)
        else if (this.weapon === 'grenade' || this.weapon === 'mortar') {
          game.enemyFireExplosive(this, visible)
        } else game.enemyShoot(this, visible)
        this.cool = this.weapon === 'rifle'
          ? this.attackInterval : CFG.weapons[this.weapon].interval
      }
      return
    }

    const target = game.findNearestUnit(this.x, this.y, true)
    if (!target) {
      if (!this.searching) this.startSearch(game)
      this.updateSearch(dt, game)
      return
    }

    this.lastSeenX = target.x
    this.lastSeenY = target.y
    this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x)
    const dx = target.x - this.x
    const dy = target.y - this.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const charge = d > 170 ? 1.24 : 1

    // 优先沿着 BFS 寻路场绕过掩体
    const flow = game.flowDirection(this.x, this.y)
    let mx = 0
    let my = 0

    if (flow) {
      mx = flow.x
      my = flow.y
      if (this.detourTimer > 0) {
        mx = -flow.y * this.detourSign
        my = flow.x * this.detourSign
      }
    } else if (this.detourTimer > 0) {
      mx = (-dy / d) * this.detourSign
      my = (dx / d) * this.detourSign
    } else {
      mx = dx / d
      my = dy / d
    }

    // 沿寻路场走；前方撞墙时先尝试真实门口，再沿墙找方向，绝不直接顶墙
    const nav = game.steerEnemy(this, target, mx, my)
    if (nav) {
      mx = nav.x
      my = nav.y
    }

    if (mx === 0 && my === 0) {
      this.moving = false
      this.wasTryingToMove = false
      return
    }

    const step = this.speed * charge * dt
    this.x += mx * step
    this.y += my * step
    this.moving = true
    this.wasTryingToMove = true
  }

  startSearch(game) {
    this.searching = true
    this.searchTimer = CFG.enemy.searchTime || 10
    this.searchWait = 0
    this.searchLegTimer = 0
    this.pickSearchHeading(game)
  }

  pickSearchHeading(game) {
    // 每次重新随机一个方向，让搜索呈现真正的随机游走，而不是一直朝同一边
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU)
      const lookX = clamp(this.x + Math.cos(a) * 46, 22, game.W - 22)
      const lookY = clamp(
        this.y + Math.sin(a) * 46,
        game.playTop + 22,
        game.playBottom - 22
      )
      if (game.findCoverAt(lookX, lookY, this.r + 4)) continue
      if (game.bushBlocksPoint(lookX, lookY, this.r + 2)) continue
      if (lookX === 22 || lookX === game.W - 22 ||
          lookY === game.playTop + 22 || lookY === game.playBottom - 22) {
        continue
      }
      this.searchAngle = a
      this.searchLegTimer = rand(0.65, 1.5)
      return
    }

    this.searchAngle = rand(0, TAU)
    this.searchLegTimer = rand(0.4, 0.8)
  }

  updateSearch(dt, game) {
    this.searchTimer -= dt
    if (this.searchTimer <= 0) {
      this.searching = false
      this.aggro = false
      this.searchWait = 0
      this.moving = false
      this.wasTryingToMove = false
      return
    }

    if (this.searchWait > 0) {
      this.searchWait -= dt
      this.moving = false
      this.wasTryingToMove = false
      return
    }

    this.searchLegTimer -= dt
    if (this.searchLegTimer <= 0) {
      this.searchWait = rand(0.12, 0.38)
      this.pickSearchHeading(game)
      this.moving = false
      this.wasTryingToMove = false
      return
    }

    const hx = Math.cos(this.searchAngle)
    const hy = Math.sin(this.searchAngle)
    const step = this.speed * 0.58 * dt
    const nx = this.x + hx * step
    const ny = this.y + hy * step

    if (
      nx < 22 || nx > game.W - 22 ||
      ny < game.playTop + 22 || ny > game.playBottom - 22 ||
      game.bushBlocksPoint(nx, ny, this.cr || this.r)
    ) {
      this.searchWait = rand(0.1, 0.3)
      this.pickSearchHeading(game)
      this.moving = false
      this.wasTryingToMove = false
      return
    }

    this.aimAngle = this.searchAngle
    this.x = nx
    this.y = ny
    this.moving = true
    this.wasTryingToMove = true

    // 撞墙卡住时立即换一个随机方向
    if (this.detourTimer > 0) {
      this.detourTimer = 0
      this.searchWait = rand(0.1, 0.25)
      this.pickSearchHeading(game)
    }
  }

  draw(ctx, time, showBadge = true) {
    drawUnitToken(ctx, this, time, showBadge)
  }
}
