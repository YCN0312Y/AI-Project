// 所有可调参数集中在这里，改数值就能调玩法与难度

export const GAME_TITLE = '扩编战争'

export const CFG = {
  squad: {
    baseTroops: 12,
    maxUnits: 20,
    speed: 250,
    range: 235,
    fireInterval: 0.5,
    bulletSpeed: 640,
    healOnWave: 0.35,
    powerExponent: 0.5, // 只用于箭矢视觉大小和敌人分值
    formationX: 46,
    formationY: 42,
  },

  merit: {
    start: 300,
    waveBase: 30,
    waveGrowth: 15,
    passiveInterval: 3, // 每 3 秒
    passiveAmount: 10, // 自动获得 10 军功
    troopsPerMerit: 10, // 每消灭 10 点敌方兵力获得 1 军功，不足 10 点累计
  },

  coins: {
    // 新增高级编制沿用军级的 2 金币击杀奖励。
    rewards: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2, 2],
    exchanges: [
      { coins: 1, merit: 100 },
      { coins: 5, merit: 510 },
      { coins: 10, merit: 1100 },
      { coins: 50, merit: 5500 },
      { coins: 100, merit: 12000 },
    ],
  },

  level: {
    activeCap: 24, // 场上同时存在的敌人编制单位上限
    spawnBatch: 3, // 每次从各部放出的编制单位数量
    spawnInterval: 0.5, // 放兵间隔
    healBetweenLevels: 0.25, // 过关后保留部队并回复 25% 兵力
  },

  weapons: {
    duration: 10, // 限时武器模式持续时间（秒）
    mg: {
      cost: 3,
      interval: 0.2, // 每 0.2 秒扫射一轮，命中攻击圈内所有有视线敌人
      bulletSpeed: 900,
      damageRatio: 1,
    },
    grenade: {
      cost: 5,
      radius: 65,
      damageMul: 2,
      flightTime: 0.45,
      interval: 0.5, // 每 0.5 秒投掷一颗
    },
    mortar: {
      cost: 20,
      radius: 100,
      damageMul: 3,
      flightTime: 0.45,
      interval: 1,
    },
  },

  enemy: {
    maxAlive: 56,
    tierEveryWaves: 3, // 每 3 波提升一级编制：1-3 波班、4-6 波排、7-9 波连……
    maxTier: 10,
    arrowSpeed: 430,
    aggroRange: 200, // 驻守敌人发现玩家的距离
    searchTime: 10, // 玩家进入草丛后，敌人搜索多久后回岗
    flowCell: 8, // 寻路网格大小（越小越容易穿过门缝和房间窄道）
    flowClearance: 6, // 掩体在网格上额外膨胀的距离
    flowRefresh: 0.2, // 寻路场刷新间隔（秒）
    types: {
      grunt: {
        speed: 86,
        radius: 10,
        score: 10,
        attackInterval: 1.1,
        range: 220,
      },
      runner: {
        speed: 150,
        radius: 9,
        score: 12,
        attackInterval: 0.9,
        range: 195,
      },
      brute: {
        speed: 58,
        radius: 15,
        score: 26,
        attackInterval: 1.5,
        range: 245,
      },
    },
  },

  wave: {
    prepFirst: 2.4,
    prepBetween: 3.6,
    speedGrowth: 0.03,
    maxSpeedMul: 1.55,
    countBase: 7,
    countGrowth: 3,
    maxCountPerWave: 600, // 安全上限，避免极端波次生成过多
    countMultiplier: 10, // 所有波次敌人数量倍率
    spawnBase: 0.8,
    spawnDecay: 0.04,
    minSpawn: 0.24,
  },

  crate: {
    merit: 40,
    healPct: 0.2,
    radius: 15,
    pickupPad: 8,
    maxOnField: 4,
    afterWave: 1,
    afterWaveEvery: 3,
    dropChance: 0.03,
  },

  merge: {
    required: 3, // 3 个同等级合成 1 个下一等级
    player: true,
    enemy: false, // 只有玩家单位可以合体，敌人不合体
  },

  covers: {
    count: 5, // 小掩体（石块/沙袋）
    houses: 2, // 房屋掩体
    minRadius: 17,
    maxRadius: 28,
    margin: 38,
    centerClear: 125,
    minGap: 24,
    houseMinW: 58,
    houseMaxW: 82,
    houseMinH: 44,
    houseMaxH: 62,
  },
}

// 兵力等级：一级 12 人，之后每级是上一级的 3 倍
// 伤害：一级 1 人，之后每级 ×3（1 / 3 / 9 / 27 / 81 / 243 / 729 / 2187）
// cost 单位是军功；目前按“1 人 = 1 军功”设计
export const TROOP_TIERS = [
  { level: 1, name: '班', troops: 12, cost: 12, damage: 1, color: '#7fc4ff' },
  { level: 2, name: '排', troops: 36, cost: 36, damage: 3, color: '#5aa8ff' },
  { level: 3, name: '连', troops: 108, cost: 108, damage: 9, color: '#4d7cff' },
  { level: 4, name: '营', troops: 324, cost: 324, damage: 27, color: '#8f7bff' },
  { level: 5, name: '团', troops: 972, cost: 972, damage: 81, color: '#b45cff' },
  { level: 6, name: '旅', troops: 2916, cost: 2916, damage: 243, color: '#dc6cff' },
  { level: 7, name: '师', troops: 8748, cost: 8748, damage: 729, color: '#ff8a5c' },
  { level: 8, name: '军', troops: 26244, cost: 26244, damage: 2187, color: '#ffd76a' },
  { level: 9, name: '军团', troops: 78732, cost: 78732, damage: 6561, color: '#ffb84d' },
  { level: 10, name: '方面军', troops: 236196, cost: 236196, damage: 19683, color: '#ff827c' },
]

// 50 关编制表。每个数字是“部/编制单位”的数量，不是兵力：
// 班部 1 = 1 个班（12 兵力），排部 1 = 1 个排（36 兵力），依此类推。
// 第 n 关：班部 n 个，之后每高一级编制少 2 个（排部 n-2、连部 n-4 ……）。
export const LEVELS = Array.from({ length: 50 }, (_, i) => {
  const level = i + 1
  return {
    level,
    counts: TROOP_TIERS.map((_, tier) => Math.max(0, level - tier * 2)),
  }
})

export const COLORS = {
  player: { body: '#e5484d', helmet: '#ff9f92', hp: '#5cd98f' },
  grunt: {
    body: '#f2f0ea',
    helmet: '#ffffff',
    accent: '#ff6f61',
    hp: '#ffd6d0',
  },
  runner: {
    body: '#e3ebf2',
    helmet: '#f8fbff',
    accent: '#ffad4d',
    hp: '#ffe3bb',
  },
  brute: {
    body: '#e9e1f7',
    helmet: '#fbf8ff',
    accent: '#b98bff',
    hp: '#eadcff',
  },

  arrow: '#ffd75e',
  text: '#eaf3ff',
  textDim: '#8fa6bd',
  accent: '#58a6ff',
  danger: '#ff6b6b',
  gold: '#ffd76a',
  merit: '#ffd76a',
  heal: '#8ff0b5',
}
