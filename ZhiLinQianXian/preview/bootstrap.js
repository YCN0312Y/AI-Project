import { Game } from '../js/game.js'
import { SAVE_KEY, freshSave, setFormation } from '../js/state.js'

const local = ['localhost', '127.0.0.1'].includes(location.hostname)
const params = new URLSearchParams(location.search)
const demo = local && ['merge','command'].includes(params.get('demo')) ? params.get('demo') : null

if (demo) {
  // 每种演示使用独立存档，不占用正式部队。
  const read = wx.getStorageSync, write = wx.setStorageSync
  const prefix = demo === 'merge' ? 'zhilin.merge-demo.v1:' : 'zhilin.command-demo.v1:'
  wx.getStorageSync = key => read(prefix + key)
  wx.setStorageSync = (key, value) => write(prefix + key, value)
  if (!wx.getStorageSync(SAVE_KEY)) {
    const save = freshSave()
    save.name = demo === 'merge' ? '合编演示' : '部队指挥演示'
    for (let i = 0; i < 3; i++) setFormation(save, 'squad', 10)
    if (demo === 'command') {setFormation(save, 'platoon', 30); setFormation(save, 'platoon', 30)}
    wx.setStorageSync(SAVE_KEY, save)
  }
  document.title = (demo === 'merge' ? '三合一编制演示' : '部队指挥演示') + ' · 指挥前线'
}

const game = new Game({applyRequestedRiceSupply:!demo})
if (demo === 'merge') game.open('formation')
if (demo === 'command') game.open('campaign')
if (local && params.has('debug')) window.game = game
