export const LEGACY_BULLET_IDS=['rifleAmmo','pistolAmmo','machinegunAmmo','sniperAmmo']
export function restoreBulletCount(record){
  const count=value=>Number.isFinite(value)?Math.max(0,Math.floor(value)):0
  const total=Number.isFinite(record?.bullets)?count(record.bullets):LEGACY_BULLET_IDS.reduce((sum,id)=>sum+count(record?.[id]),0)
  return Math.min(10000000,total)
}

// 游戏内平衡数值。伤害基于部队兵力计算，不对应现实武器参数。
export const WEAPONS = [
  {id:'rifle',ammo:'bullets',name:'步枪',role:'均衡火力',desc:'标准配装，兼顾射速与射程',price:40,interval:.24,damage:1,damagePerRound:1,range:470,splash:0,color:'#b0c881'},
  {id:'pistol',ammo:'bullets',name:'手枪',role:'近距速射',desc:'轻便配装，适合近距离交战',price:30,interval:.2,damage:.65,damagePerRound:.5,range:320,splash:0,color:'#a7bdac'},
  {id:'machinegun',ammo:'bullets',name:'轻机枪',role:'快速压制',desc:'更快射速，适合连续迎敌',price:500,interval:.14,damage:.8,damagePerRound:.5,range:420,splash:0,color:'#d9ac5a'},
  {id:'sniper',ammo:'bullets',name:'狙击枪',role:'远程点杀',desc:'更远射程，单发伤害较高',price:700,interval:.85,damage:4,range:720,splash:0,color:'#87bac0'},
  {id:'mortar',ammo:'mortarAmmo',name:'迫击炮',role:'范围打击',desc:'低射速，打击目标附近敌军',price:1000,interval:1.1,damage:3,range:560,splash:110,color:'#df8060'},
]
export const weaponById = id => WEAPONS.find(w=>w.id===id)||WEAPONS[0]
