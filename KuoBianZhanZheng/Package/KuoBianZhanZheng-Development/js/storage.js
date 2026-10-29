import { LEVELS, TROOP_TIERS } from './config'

const KEY = 'commanderSim.save.v1'
const CAMPAIGN_KEY = 'commanderSim.campaign.v1'
const CHECKPOINT_KEY = 'commanderSim.checkpoint.v1'

const DEFAULT_SAVE = {
  bestScore: 0,
  bestWave: 0,
  bestTroops: 0,
  totalKills: 0,
  plays: 0,
  musicOn: true,
  sfxOn: true,
}

export function loadSave() {
  try {
    const raw = wx.getStorageSync(KEY)
    if (!raw || typeof raw !== 'object') return Object.assign({}, DEFAULT_SAVE)
    return {
      bestScore: Math.max(0, Number(raw.bestScore) || 0),
      bestWave: Math.max(0, Number(raw.bestWave) || 0),
      bestTroops: Math.max(0, Number(raw.bestTroops) || 0),
      totalKills: Math.max(0, Number(raw.totalKills) || 0),
      plays: Math.max(0, Number(raw.plays) || 0),
      musicOn: raw.musicOn !== false,
      sfxOn: raw.sfxOn !== false,
    }
  } catch (e) {
    return Object.assign({}, DEFAULT_SAVE)
  }
}

export function writeSave(data) {
  try {
    wx.setStorageSync(KEY, {
      bestScore: data.bestScore,
      bestWave: data.bestWave,
      bestTroops: data.bestTroops,
      totalKills: data.totalKills,
      plays: data.plays,
      musicOn: data.musicOn !== false,
      sfxOn: data.sfxOn !== false,
    })
  } catch (e) {
    // 存储失败不影响游戏进行
  }
}

function safeNumber(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseArmy(rawArmy) {
  const army = []
  if (!Array.isArray(rawArmy)) return army
  for (let i = 0; i < rawArmy.length && army.length < 20; i++) {
    const u = rawArmy[i]
    if (!u || typeof u !== 'object') continue
    let tier = Math.round(safeNumber(u.tier, 1))
    let troops = Math.round(safeNumber(u.troops, 0))
    let troopsMax = Math.round(safeNumber(u.troopsMax, troops))
    // 旧版第 11 级已删除：转为当前方面军，避免整支部队被过滤、存档无法继续。
    if (tier === 11 && TROOP_TIERS.length === 10) {
      tier = 10
      troops = Math.min(troops, TROOP_TIERS[9].troops)
      troopsMax = Math.min(troopsMax, TROOP_TIERS[9].troops)
    }
    const slot = Math.round(safeNumber(u.slot, i))
    if (tier < 1 || tier > TROOP_TIERS.length || troops <= 0) continue
    army.push({
      tier,
      troops,
      troopsMax: Math.max(troops, troopsMax),
      slot: Math.max(0, Math.min(19, slot)),
    })
  }
  return army
}

// 战役/关卡快照的公共字段
function parseArmyState(raw) {
  if (!raw || typeof raw !== 'object') return null
  const army = parseArmy(raw.army)
  if (army.length === 0) return null
  return {
    level: Math.max(1, Math.min(LEVELS.length, Math.round(safeNumber(raw.level, 1)))),
    army,
    merit: Math.max(0, Math.round(safeNumber(raw.merit, 0))),
    meritProgress: Math.max(
      0, Math.round(safeNumber(raw.meritProgress, 0))
    ),
    coins: Math.max(0, Math.round(safeNumber(raw.coins, 0) * 100) / 100),
    score: Math.max(0, Math.round(safeNumber(raw.score, 0))),
    kills: Math.max(0, Math.round(safeNumber(raw.kills, 0))),
    peakTroops: Math.max(0, Math.round(safeNumber(raw.peakTroops, 0))),
  }
}

// 战役进度：保存当前关卡和该关卡里我方的部队/军功/金币等
export function loadCampaign() {
  try {
    return parseArmyState(wx.getStorageSync(CAMPAIGN_KEY))
  } catch (e) {
    return null
  }
}

// 关卡开场快照：进入新关卡时记录，失败重试时恢复
export function loadCheckpoint() {
  try {
    return parseArmyState(wx.getStorageSync(CHECKPOINT_KEY))
  } catch (e) {
    return null
  }
}

export function writeCampaign(data) {
  try {
    wx.setStorageSync(CAMPAIGN_KEY, {
      level: data.level,
      army: data.army,
      merit: data.merit,
      meritProgress: data.meritProgress || 0,
      coins: data.coins,
      score: data.score,
      kills: data.kills,
      peakTroops: data.peakTroops,
    })
  } catch (e) {
    // 忽略
  }
}

export function clearCampaign() {
  try {
    wx.removeStorageSync(CAMPAIGN_KEY)
  } catch (e) {
    // 忽略
  }
}

export function writeCheckpoint(data) {
  try {
    wx.setStorageSync(CHECKPOINT_KEY, {
      level: data.level,
      army: data.army,
      merit: data.merit,
      meritProgress: data.meritProgress || 0,
      coins: data.coins,
      score: data.score,
      kills: data.kills,
      peakTroops: data.peakTroops,
    })
  } catch (e) {
    // 忽略
  }
}

export function clearCheckpoint() {
  try {
    wx.removeStorageSync(CHECKPOINT_KEY)
  } catch (e) {
    // 忽略
  }
}
