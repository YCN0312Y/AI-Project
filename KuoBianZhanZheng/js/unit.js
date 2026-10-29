import { CFG, COLORS, TROOP_TIERS } from './config'
import { TAU, clamp } from './utils'
import { drawUnitToken } from './draw'

// 一个「编制单位」：班里 12 人、排里 36 人……
// 兵力就是生命值；攻击伤害由编制等级决定（班=1，之后每级 ×3）
export class Unit {
  constructor(tier, slot, offset, x, y, troops) {
    const info = TROOP_TIERS[tier - 1]

    this.tier = tier
    this.tierName = info.name
    this.tierColor = info.color
    this.slot = slot
    this.ox = offset.x
    this.oy = offset.y
    this.x = x
    this.y = y

    this.troopsMax =
      troops === undefined ? info.troops : Math.max(1, Math.round(troops))
    this.troops = this.troopsMax

    this.power = Math.pow(
      this.troopsMax / CFG.squad.baseTroops,
      CFG.squad.powerExponent
    )

    this.r = clamp(9 + tier * 1.4, 10, 20)
    // 移动碰撞体比视觉体型小：大编制（师/军）也能穿过房间之间的窄通道
    this.cr = Math.max(6, Math.min(8, 6 + tier * 0.3))
    this.colors = {
      body: COLORS.player.body,
      helmet: COLORS.player.helmet,
      hp: COLORS.player.hp,
    }
    this.badgeBg = 'rgba(46, 12, 14, 0.82)'
    this.isEnemy = false
    this.weapon = 'rifle'

    this.speed = CFG.squad.speed * (0.94 + Math.random() * 0.1)
    this.fireInterval = CFG.squad.fireInterval * (0.96 + Math.random() * 0.08)
    this.cool = Math.random() * 0.4
    this.phase = Math.random() * TAU
    this.hitFlash = 0
    this.moving = false
    this.dead = false
    this.aimAngle = -Math.PI / 2
  }

  update(dt, game) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6)

    if (this.lastTarget) {
      if (this.lastTarget.dead) this.lastTarget = null
      else {
        this.aimAngle = Math.atan2(
          this.lastTarget.y - this.y,
          this.lastTarget.x - this.x
        )
      }
    }

    const tx = clamp(game.target.x + this.ox, 16, game.W - 16)
    const ty = clamp(
      game.target.y + this.oy,
      game.playTop + 8,
      game.playBottom - 12
    )

    const dx = tx - this.x
    const dy = ty - this.y
    const d = Math.sqrt(dx * dx + dy * dy)

    if (d > 0.6) {
      const boost = d > 50 ? 1.35 : 1
      const step = Math.min(d, this.speed * boost * dt)
      this.moving = game.movePlayerUnit(
        this, (dx / d) * step, (dy / d) * step
      )
    } else {
      this.moving = false
    }

    this.cool -= dt
    if (this.cool <= 0 && !this.hidden) {
      let fired = false
      if (this.weapon === 'mg') fired = game.fireMG(this)
      else if (this.weapon === 'grenade' || this.weapon === 'mortar') {
        fired = game.fireGrenadeMode(this, this.weapon)
      }
      else fired = game.volley(this)

      if (fired) {
        if (this.weapon === 'mg') this.cool = CFG.weapons.mg.interval
        else if (this.weapon === 'grenade' || this.weapon === 'mortar') {
          this.cool = CFG.weapons[this.weapon].interval
        } else {
          this.cool = this.fireInterval
        }
      } else {
        this.cool = 0.08
      }
    }
  }

  draw(ctx, time, showBadge = true) {
    drawUnitToken(ctx, this, time, showBadge)
  }
}
