import { Game } from './js/game'

const game = new Game()

// 方便调试：在开发者工具 Console 里可以访问全局对象
if (typeof globalThis !== 'undefined') {
  globalThis.__commanderSim = game
}
