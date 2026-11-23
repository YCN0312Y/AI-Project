import {fitCamera} from '../js/world-map.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { freshSave,normalizeSave,GOODS,purchase,purchaseWeapon,formation,setFormation,removeFormation,reinforceFormation,MODES,applyWarehouseFoodAdjustment } from '../js/state.js'
import { WEAPONS } from '../js/weapons.js'
import { SHOP_LIMITS,SHOP_INTERVAL,syncShop,purchaseQuote,buyStock,shopAvailable,shopSells } from '../js/shop.js'
import {farmTaskAt, startFarming,cancelFarming,advanceFarming } from '../js/base.js'
import { advanceEconomy } from '../js/economy.js'
import { donateFood,recruitmentFoodCost,advanceLogistics,RATIONS,FOODS,DISHES } from '../js/logistics.js'
import { Game } from '../js/game.js'
import { stationTroops } from '../js/villages.js'

test('在售商品按指定件数限量，售罄不扣金币或增加库存，武器和物资统一约束',()=>{
  assert.deepEqual(SHOP_LIMITS,{rifle:50,pistol:30,machinegun:10,sniper:1,mortar:3,bullets:190,mortarAmmo:5,grenades:50,bandages:100,medkits:20,millet:100,rice:100,corn:100,pork:30,eggs:30,salt:10,oil:10})
  for(const item of [...WEAPONS,...GOODS].filter(item=>shopSells(item.id))){
    const s=freshSave();s.coins=1000000;syncShop(s,1000);let total=0
    const weapon=WEAPONS.includes(item),before=weapon?s.weaponCounts[item.id]:s[item.id]
    while(shopAvailable(s,item.id,1001)>0){const quote=purchaseQuote(s,item,weapon,1001);assert(quote.ok);total+=quote.amount;assert(buyStock(s,item,weapon,1001))}
    assert.equal(total,SHOP_LIMITS[item.id]);assert.equal((weapon?s.weaponCounts[item.id]:s[item.id])-before,total)
    const snapshot=JSON.stringify(s);assert.equal(buyStock(s,item,weapon,1001),false);assert.equal(JSON.stringify(s),snapshot)
  }
})

test('仓库合并四类旧子弹，商城合并原在售子弹的剩余数量并沿用补货时间',()=>{
  const s=normalizeSave({coins:1000,rifleAmmo:10,pistolAmmo:20,machinegunAmmo:33,sniperAmmo:7,mortarAmmo:5,
    shopStock:{rifleAmmo:0,pistolAmmo:45,machinegunAmmo:50,sniperAmmo:10},shopNextRestockAt:1000})
  assert.equal(s.bullets,70);assert.equal(s.mortarAmmo,5)
  assert.equal(shopAvailable(s,'bullets',999),55);assert.equal(syncShop(s,999),false)
  for(const id of ['rifleAmmo','pistolAmmo','machinegunAmmo','sniperAmmo']){
    assert(!Object.hasOwn(s,id));assert(!Object.hasOwn(s.shopStock,id));assert.equal(purchase(s,id),false)
  }
  assert.equal(s.coins,1000)
  assert.deepEqual(normalizeSave(s),s)
  assert(syncShop(s,1000));assert.equal(shopAvailable(s,'bullets',1001),190);assert.equal(s.bullets,70)
})

test('物资按单件库存售出最后余数，比例计价向上取整；五分钟前不刷新，到期补满而不叠加',()=>{
  const s=freshSave();s.coins=10000;const ammo=GOODS.find(item=>item.id==='bullets');syncShop(s,1000)
  for(let i=0;i<6;i++)assert(buyStock(s,ammo,false,1001));assert.equal(s.bullets,180)
  const quote=purchaseQuote(s,ammo,false,1001);assert.equal(quote.amount,10);assert.equal(quote.cost,14)
  assert(buyStock(s,ammo,false,1001));assert.equal(s.bullets,190);assert.equal(s.coins,9746)
  assert.equal(syncShop(s,1000+SHOP_INTERVAL-1),false);assert.equal(s.shopStock.bullets,0)
  assert(syncShop(s,1000+SHOP_INTERVAL));assert.equal(s.shopStock.bullets,190);assert.equal(s.shopStock.rifle,50)
  const next=s.shopNextRestockAt;assert(syncShop(s,next+SHOP_INTERVAL*10));assert.equal(s.shopStock.bullets,190);assert(s.shopNextRestockAt>next+SHOP_INTERVAL*10)
})

test('刷新保留商店额度和时间，离线补满最多一轮，失败购买不修改存档',()=>{
  const s=freshSave();s.coins=1000;assert(purchaseWeapon(s,'sniper'));assert.equal(s.shopStock.sniper,0)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s)
  assert.equal(purchaseWeapon(restored,'sniper'),false)
  restored.coins=0;const empty=JSON.stringify(restored);assert.equal(purchase(restored,'rice'),false);assert.equal(JSON.stringify(restored),empty)
  assert(syncShop(restored,restored.shopNextRestockAt));assert.equal(restored.shopStock.sniper,1)
  const old=normalizeSave({troops:9,coins:91});assert.deepEqual(old.shopStock,SHOP_LIMITS);assert.equal(old.troops,9)
  const invalid=normalizeSave({shopStock:{sniper:99,rifle:-1,pistol:NaN},shopNextRestockAt:NaN});assert.equal(invalid.shopStock.sniper,1);assert.equal(invalid.shopStock.rifle,0);assert.equal(invalid.shopNextRestockAt,0)
})

test('自耕60秒产出所选生粮且只结算一次，取消释放人员，不能与编制重复占兵',()=>{
  const s=freshSave();s.reserveTrainingXp=72000;assert(setFormation(s,'squad',10).ok)
  const xp=s.reserveTrainingXp;assert(startFarming(s,'self',10,'rice').ok);assert.equal(formation(s).unassignedTroops,100);assert.equal(formation(s).farmingTroops,10)
  assert.equal(startFarming(s,'help',1).ok,false);assert.equal(setFormation(s,'company',110).ok,false)
  assert.equal(advanceFarming(s,59.9),null);assert.equal(s.rice,0)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s);assert.equal(restored.reserveTrainingXp,xp)
  assert.equal(advanceFarming(restored,.1).amount,30);assert.equal(restored.rice,30);assert.equal(restored.farmTask,null);assert.equal(formation(restored).unassignedTroops,110)
  assert.equal(advanceFarming(restored,60),null);assert.equal(restored.rice,30)
  assert(startFarming(restored,'self',10,'corn').ok);assert(cancelFarming(restored));assert.equal(restored.corn,0)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
})

test('耕作保留训练经验占比，后续组建、补员和解散不吞经验，零人不能耕作',()=>{
  const s=freshSave();s.reserveTrainingXp=72000;assert(startFarming(s,'help',20).ok)
  assert(setFormation(s,'squad',10).ok);assert.equal(s.formations[0].trainingXp,6000);assert.equal(s.reserveTrainingXp,66000)
  assert(reinforceFormation(s,1,2).ok);assert.equal(s.formations[0].trainingXp,7200)
  assert(removeFormation(s,1));assert.equal(s.reserveTrainingXp,72000);assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const zero=freshSave();zero.troops=0;assert.equal(startFarming(zero,'self',1).ok,false)
  for(const n of [0,-1,1.5,101,NaN,'5'])assert.equal(startFarming(zero,'self',n).ok,false)
})

test('代耕获得动员减耗资格，按3份招5人，使用后恢复5份，缺粮慢速不消耗资格',()=>{
  const s=freshSave();assert(startFarming(s,'help',2).ok);assert.equal(advanceFarming(s,60).amount,0);assert.equal(s.mobilizationDiscounts,2)
  s.millet=20;donateFood(s,'millet',11);assert.equal(recruitmentFoodCost(s),3)
  advanceLogistics(s,20);assert.equal(s.recruitedTroops,15);assert.equal(s.mobilizationFood,5);assert.equal(s.mobilizationDiscounts,0)
  advanceLogistics(s,10);assert.equal(s.recruitedTroops,20);assert.equal(s.mobilizationFood,0)
  s.mobilizationDiscounts=1;advanceLogistics(s,20);assert.equal(s.recruitedTroops,25);assert.equal(s.mobilizationDiscounts,1)
})

test('饥饿失能暂停耕作并禁止开工，供餐后继续；组合时钟分步与整步一致',()=>{
  const s=freshSave();assert(startFarming(s,'self',5,'millet').ok);s.hungerDebt=3
  advanceEconomy(s,30);assert.equal(s.farmTask.elapsed,0);assert.equal(s.millet,0)
  s.cookedRice=12;advanceEconomy(s,30);assert.equal(s.hungerDebt,0);assert.equal(s.farmTask.elapsed,30)
  advanceEconomy(s,30);assert.equal(s.farmTask,null);assert.equal(s.millet,15)
  const a=freshSave();a.cookedRice=100;a.millet=30;donateFood(a,'millet',30);startFarming(a,'help',5)
  const b=structuredClone(a);advanceEconomy(a,120,()=>0);for(let i=0;i<120;i++)advanceEconomy(b,1,()=>0);assert.deepEqual(a,b)
  const blocked=freshSave();blocked.hungerDebt=3;assert.equal(startFarming(blocked,'self',1).ok,false)
})

test('按实际帧间隔耕作不会在边界卡住，代耕完成当刻正确切换动员计时',()=>{
  const s=freshSave();s.cookedRice=200;startFarming(s,'self',5,'corn')
  for(let i=0;i<7201;i++)advanceEconomy(s,1/60)
  assert.equal(s.corn,15);assert.equal(s.farmTask,null)
  const t=freshSave();t.mobilizationActive=true;t.mobilizationFood=3;startFarming(t,'help',1)
  advanceEconomy(t,59);assert.equal(t.recruitElapsed,19);assert.equal(t.mobilizationFood,3)
  advanceEconomy(t,1);assert.equal(t.mobilizationDiscounts,1);assert.equal(t.recruitElapsed,0)
  assert.equal(advanceEconomy(t,10).recruited,5);assert.equal(t.mobilizationFood,0);assert.equal(t.mobilizationDiscounts,0)
})

test('根据地移除四项事务入口，田地继续从地图点击派人代耕',()=>{
  const g=Object.create(Game.prototype),labels=[];g.save=freshSave();g.scene='lobby';g.notify=()=>{};g.persist=()=>{}
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText:value=>labels.push(String(value))},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  const draw=()=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
  const click=id=>{const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn()}
  assert(MODES.some(m=>m.id==='base'));assert.equal(MODES.some(m=>m.id==='training'),false)
  g.buttons=[];g.drawLobby();click('map-base');draw()
  for(const id of ['base-training','base-farm','base-base-armory','base-base-medical'])assert.equal(g.buttons.some(b=>b.id===id),false)
  setFormation(g.save,'squad',7);stationTroops(g.save,1,[1])
  click('base-map');assert.equal(g.scene,'world-map');fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap();click('map-field-field-1');draw()
  assert.equal(g.buttons.some(b=>b.id==='farm-self'||b.id==='farm-source-reserve'),false);click('farm-unit-1');draw();click('farm-start')
  assert.equal(farmTaskAt(g.save,'field-1').type,'help');assert.equal(farmTaskAt(g.save,'field-1').fieldId,'field-1');draw();click('farm-cancel');g.updateLogistics(1);assert.equal(farmTaskAt(g.save,'field-1'),null)
  g.open('shop');draw();assert(labels.some(label=>label.includes('下次补货')))
})

test('商城食品货源恢复原上限，旧1000货源被限制，玩家仓库仍保留',()=>{
  const old=normalizeSave({coins:100,millet:23,shopStock:{millet:990,salt:980,sniper:0},shopFoodStockVersion:2,shopNextRestockAt:Date.now()+300000})
  assert.equal(old.shopStock.millet,100);assert.equal(old.shopStock.salt,10);assert.equal(old.shopStock.sniper,0);assert.equal(old.millet,23);assert.equal(old.coins,100)
  assert(purchase(old,'millet'));assert.equal(old.shopStock.millet,90);assert.equal(old.millet,33)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(old))),old)
})

test('现有存档七种生食各设1000，其他库存不变，消耗和重新读取不会再次补满',()=>{
  const raw=freshSave();delete raw.warehouseFoodAdjustmentVersion
  raw.millet=1500;raw.rice=7;raw.coins=321;raw.bullets=42
  for(const dish of DISHES)raw[dish.id]=17
  const s=normalizeSave(raw),before=structuredClone(s)
  assert.equal(applyWarehouseFoodAdjustment(s),true)
  for(const food of FOODS)assert.equal(s[food.id],1000,food.id)
  const expected=structuredClone(before)
  for(const food of FOODS)expected[food.id]=1000
  expected.warehouseFoodAdjustmentVersion=1
  assert.deepEqual(s,expected)
  assert(donateFood(s,'rice',10));assert.equal(s.rice,990)
  const loaded=normalizeSave(JSON.parse(JSON.stringify(s)))
  assert.equal(applyWarehouseFoodAdjustment(loaded),false)
  assert.equal(loaded.rice,990)
  assert.deepEqual(loaded.shopStock,SHOP_LIMITS)
})

test('全新存档不附送1000份食品',()=>{
  const s=normalizeSave(freshSave())
  assert.equal(applyWarehouseFoodAdjustment(s),false)
  for(const food of FOODS)assert.equal(s[food.id],0,food.id)
})
