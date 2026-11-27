// 商城货源独立于玩家仓库；五分钟补满，不叠加未购买的旧货。
export const SHOP_INTERVAL=300000
const legacyBulletLimits={rifleAmmo:100,pistolAmmo:70,sniperAmmo:20}
const stockBetween=(amount,cap)=>Number.isFinite(amount)?Math.max(0,Math.min(cap,Math.floor(amount))):cap
export const SHOP_LIMITS={rifle:50,pistol:30,machinegun:10,sniper:1,mortar:3,
  bullets:Object.values(legacyBulletLimits).reduce((sum,cap)=>sum+cap,0),mortarAmmo:5,grenades:50,
  millet:100,rice:100,corn:100,pork:30,eggs:30,salt:10,oil:10}
export const freshShop=()=>({shopStock:{...SHOP_LIMITS},shopNextRestockAt:0,shopFoodStockVersion:3})
export const shopSells=id=>Object.prototype.hasOwnProperty.call(SHOP_LIMITS,id)
export function normalizeShop(raw){
  const clean=freshShop(),saved=raw?.shopStock
  for(const [id,cap] of Object.entries(SHOP_LIMITS))clean.shopStock[id]=stockBetween(saved?.[id],cap)
  if(!Number.isFinite(saved?.bullets))clean.shopStock.bullets=Object.entries(legacyBulletLimits).reduce((sum,[id,cap])=>sum+stockBetween(saved?.[id],cap),0)
  if(Number.isSafeInteger(raw?.shopNextRestockAt)&&raw.shopNextRestockAt>=0)clean.shopNextRestockAt=raw.shopNextRestockAt
  return clean
}
export function syncShop(s,now=Date.now()){
  if(!Number.isFinite(now)||now<0)return false
  if(!s.shopNextRestockAt){s.shopNextRestockAt=now+SHOP_INTERVAL;return true}
  if(now<s.shopNextRestockAt)return false
  s.shopStock={...SHOP_LIMITS}
  s.shopNextRestockAt+= (Math.floor((now-s.shopNextRestockAt)/SHOP_INTERVAL)+1)*SHOP_INTERVAL
  return true
}
export function shopAvailable(s,id,now=Date.now()){
  if(!shopSells(id))return 0
  return s.shopNextRestockAt&&now>=s.shopNextRestockAt?SHOP_LIMITS[id]:(s.shopStock?.[id]??SHOP_LIMITS[id])
}
export function purchaseQuote(s,item,weapon=false,now=Date.now()){
  if(!item||!shopSells(item.id))return {ok:false,message:'商品不存在',amount:0,cost:0,available:0}
  const available=shopAvailable(s,item.id,now),pack=weapon?1:item.amount,amount=Math.min(pack,available)
  const cost=Math.ceil(item.price*amount/pack),owned=weapon?s.weaponCounts[item.id]:s[item.id]
  const message=!amount?'已售罄，等待五分钟补货':owned+amount>10000000?'仓库库存已达上限':!Number.isFinite(s.coins)||s.coins<cost?'金币不足，请通过战斗和任务获取金币':''
  return {ok:!message,message,amount,cost,available}
}
export function buyStock(s,item,weapon=false,now=Date.now()){
  const quote=purchaseQuote(s,item,weapon,now)
  if(!quote.ok)return false
  syncShop(s,now);s.shopStock[item.id]-=quote.amount;s.coins-=quote.cost
  if(weapon)s.weaponCounts[item.id]+=quote.amount
  else s[item.id]+=quote.amount
  return true
}
