import { CFG } from './config.js'
import { TAU } from './utils.js'
import { drawCrate } from './draw.js'

export class Crate {
  constructor(x, y) {
    this.x = x
    this.y = y
    this.r = CFG.crate.radius
    this.phase = Math.random() * TAU
    this.dead = false
  }

  draw(ctx, time) {
    drawCrate(ctx, this, time)
  }
}
