import { Game } from '../js/game.js'
import { SAVE_KEY, freshSave, setFormation } from '../js/state.js'
import { FORMER_BASE_VILLAGE_ID } from '../js/world-map.js'

const local = ['localhost', '127.0.0.1'].includes(location.hostname)
const params = new URLSearchParams(location.search)
const demo = local && ['merge','command','march','start'].includes(params.get('demo')) ? params.get('demo') : null

if (demo) {
  // 每种演示使用独立存档，不占用正式部队。
  const read = wx.getStorageSync, write = wx.setStorageSync
  const prefix = {merge:'zhilin.merge-demo.v1:',command:'zhilin.command-demo.v1:',march:'zhilin.march-demo.v1:',start:'zhilin.start-demo.v1:'}[demo]
  wx.getStorageSync = key => read(prefix + key)
  wx.setStorageSync = (key, value) => write(prefix + key, value)
  if (demo!=='start'&&!wx.getStorageSync(SAVE_KEY)) {
    const save = freshSave()
    save.baseVillageId = FORMER_BASE_VILLAGE_ID
    save.name = {merge:'合编演示',command:'部队指挥演示',march:'行军演示'}[demo]
    for (let i = 0; i < 3; i++) setFormation(save, 'squad', 10)
    if (demo === 'command') {setFormation(save, 'platoon', 30); setFormation(save, 'platoon', 30)}
    wx.setStorageSync(SAVE_KEY, save)
  }
  document.title = {merge:'三合一编制演示',command:'部队指挥演示',march:'地图行军演示',start:'开局选址演示'}[demo] + ' · 指挥前线'
}

function startGame() {
  const game = new Game({applyRequestedRiceSupply:local&&!demo})
  if (demo === 'merge') game.open('formation')
  if (demo === 'command') game.open('campaign')
  if (local && params.has('debug')) window.game = game
}

if (location.origin === 'http://localhost:8136' && !demo) {
  import('/preview/local-restart.js')
    .then(({restartCurrentSave}) => restartCurrentSave(localStorage))
    .catch(error => console.warn('本机重置未执行', error))
    .then(startGame)
} else {
  startGame()
}
