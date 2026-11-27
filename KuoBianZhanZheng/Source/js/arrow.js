import { drawArrow } from './draw'

export class Arrow {
  constructor(x, y, angle, speed, damage, scale, hostile, style) {
    this.x = x
    this.y = y
    this.vx = Math.cos(angle) * speed
    this.vy = Math.sin(angle) * speed
    this.speed = speed
    this.damage = damage
    this.scale = scale || 1
    this.hostile = !!hostile
    this.style = style || 'arrow'
    this.life = 0.9
    this.dead = false
  }

  update(dt, game) {
    // 分成两小步移动，防止高帧率/低帧率下穿透敌人
    const steps = 2
    const sdt = dt / steps

    for (let i = 0; i < steps; i++) {
      this.x += this.vx * sdt
      this.y += this.vy * sdt
      this.life -= sdt

      if (
        this.life <= 0 ||
        this.x < -40 || this.x > game.W + 40 ||
        this.y < -40 || this.y > game.H + 40
      ) {
        this.dead = true
        return
      }

      // 掩体挡下箭矢
      if (game.findCoverAt(this.x, this.y, 3)) {
        game.fx.spark(this.x, this.y, '#c8d2dc', 3, 60)
        this.dead = true
        return
      }

      if (this.hostile) {
        const unit = game.findUnitAt(this.x, this.y, 4)
        if (unit) {
          // 敌方机枪已在扫射时结算，零伤害曳光弹不能再次扣血。
          if (this.damage > 0) game.hurtUnit(unit, this.damage)
          game.fx.spark(this.x, this.y, '#ff9a8a', 3, 70)
          this.dead = true
          return
        }
      } else {
        const enemy = game.findEnemyAt(this.x, this.y, 4)
        if (enemy) {
          // 伤害在开火时已经结算，这里的箭矢只负责视觉
          if (this.damage > 0) {
            game.damageEnemy(enemy, this.damage, Math.atan2(this.vy, this.vx))
          }
          this.dead = true
          return
        }
      }
    }
  }

  draw(ctx) {
    drawArrow(ctx, this)
  }
}
