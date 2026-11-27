import test from 'node:test'
import assert from 'node:assert/strict'
import { freshSave,normalizeSave,setFormation } from '../js/state.js'
import { advanceLogistics,hungerStatus,cookDish,donateFood,RATIONS } from '../js/logistics.js'
import { advanceEconomy } from '../js/economy.js'
import { startFarming } from '../js/base.js'
import { CampaignBattle,campaignDeployment } from '../js/campaign.js'
import { Game } from '../js/game.js'

function prepared(){const s=freshSave();setFormation(s,'squad',10);return s}
function game(s){const g=Object.create(Game.prototype);g.save=s;g.scene='lobby';g.modal=null;g.buttons=[];g.notify=()=>{};g.persist=()=>{};g.ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});return g}

test('连续缺3餐效果下降，部分缺粮按比例累计，吃够一餐清除饥饿',()=>{
  const s=freshSave();advanceLogistics(s,RATIONS.interval-.1);assert.equal(s.hungerDebt,0)
  advanceLogistics(s,.1);assert.equal(s.hungerDebt,1);assert.equal(hungerStatus(s).disabled,false)
  s.cookedRice=6;advanceLogistics(s,RATIONS.interval);assert.equal(s.hungerDebt,1.5)
  advanceLogistics(s,RATIONS.interval);assert.equal(s.hungerDebt,2.5);assert.equal(hungerStatus(s).disabled,false)
  advanceLogistics(s,RATIONS.interval);assert.equal(s.hungerDebt,3);assert.equal(hungerStatus(s).disabled,true)
  advanceLogistics(s,RATIONS.interval*2);assert.equal(s.hungerDebt,3)
  s.cookedRice=72;advanceLogistics(s,RATIONS.interval);assert.equal(s.hungerDebt,0);assert.equal(hungerStatus(s).disabled,false)
  advanceLogistics(s,RATIONS.interval*2);assert.equal(s.hungerDebt,0);assert.equal(s.troops,120)
})

test('生食和赠送不解除失能，严重饥饿做好的熟食立刻吃，零人不记缺餐',()=>{
  const s=freshSave();s.autoCooking=false;s.hungerDebt=3;s.millet=100;donateFood(s,'millet',20);s.mobilizationActive=false
  advanceLogistics(s,RATIONS.interval);assert.equal(s.hungerDebt,3);assert.equal(s.millet,80)
  const cooked=cookDish(s,'cookedMillet',12)
  assert(cooked.ok);assert.equal(cooked.feeding.consumed,12);assert.equal(hungerStatus(s).disabled,false)
  assert.equal(s.cookedMillet,0);assert.equal(s.hungerDebt,0);assert.equal(s.mealElapsed,0)
  advanceLogistics(s,RATIONS.interval-.1);assert.equal(s.hungerDebt,0)
  s.troops=0;advanceLogistics(s,RATIONS.interval);assert.equal(s.hungerDebt,0)
})

test('饥饿存档保留小数欠餐，刷新不恢复，旧存档从正常开始并拒绝异常值',()=>{
  const s=freshSave();s.hungerDebt=2.5;assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  s.hungerDebt=3;assert.equal(hungerStatus(normalizeSave(s)).disabled,true)
  assert.equal(normalizeSave({}).hungerDebt,0);assert.equal(normalizeSave({hungerDebt:NaN}).hungerDebt,0)
  assert.equal(normalizeSave({hungerDebt:-10}).hungerDebt,0);assert.equal(normalizeSave({hungerDebt:100}).hungerDebt,3)
  const a=freshSave(),b=freshSave();advanceLogistics(a,RATIONS.interval*3);for(let i=0;i<RATIONS.interval*3;i++)advanceLogistics(b,1);assert.deepEqual(a,b)
})

test('极度饥饿仍可出征，战斗效果下降，供餐后恢复正常',()=>{
  const s=prepared();assert(campaignDeployment(s,[1]).ok)
  advanceLogistics(s,RATIONS.interval*3);assert(campaignDeployment(s,[1]).ok)
  const g=game(s);g.start('campaign',1,[1]);assert.equal(g.scene,'battle');assert.equal(g.battle.damageMultiplier,.5)
  assert.equal(g.battle.intervalMultiplier,1.5);assert.equal(g.battle.speedMultiplier,.7)
  s.cookedRice=12;g.updateLogistics(.01)
  assert.equal(g.battle.damageMultiplier,1);assert.equal(g.battle.speedMultiplier,1)
})

test('极度饥饿仍射击和移动，炮火已移除，供餐后恢复正常效果',()=>{
  const s=prepared(),g=game(s);s.settings.vibration=false;s.bullets=40;g.start('campaign',1,[1]);const b=g.battle,unit=b.units[0]
  b.pending=0;b.enemies=[{weapon:'rifle',troops:100,maxHp:100,hp:100,x:unit.x+100,y:unit.y,cool:0}]
  unit.groups[0].cool=0;const hp=unit.hp
  g.updateLogistics(RATIONS.interval*3);assert.equal(b.combatReady,true)
  const shells=s.shells;assert.equal(b.strike(),false);assert.equal(s.shells,shells);assert.equal(b.enemies[0].hp,100)
  assert(b.selectUnit(1));assert(b.moveSelected(unit.x-20,unit.y));const x=unit.x
  g.updateBattle(.01);assert(b.enemies[0].hp<100);assert(unit.hp<hp);assert(unit.x<x)
  assert.equal(b.shots.some(shot=>!shot.hostile),true)
  s.cookedRice=12;g.updateLogistics(.01);assert.equal(b.combatReady,true)
  g.updateBattle(.01);assert(b.enemies[0].hp<100);assert.equal(s.hungerDebt,0)
})

test('UI显示饥饿状态与供餐提示，结算和保存依旧使用现有流程',()=>{
  const s=prepared(),g=game(s),labels=[];g.ctx.fillText=value=>labels.push(String(value));s.hungerDebt=3
  g.openCampaignDeployment(1);g.deploymentIds=[1];g.drawModal()
  assert(labels.some(label=>label.includes('极度饥饿')))
  g.open('formation');g.buttons=[];g.drawModal();assert(labels.some(label=>label.includes('缺餐 3.0/3')))
  g.open('kitchen');g.buttons=[];g.drawModal();assert(labels.some(label=>label.includes('严重饥饿有饭即吃')))
  let stored;g.persist=()=>{stored=structuredClone(s)};g.updateLogistics(RATIONS.interval);assert.equal(stored.hungerDebt,3)
  g.scene='battle';g.open('pause');g.buttons=[];g.drawModal()
  assert.equal(g.buttons.some(button=>button.id==='battle-kitchen'),false)
  g.scene='lobby';g.open('kitchen')
  g.battle={combatReady:false}
  s.rice=12;g.kitchenBatch=12;g.cook('cookedRice');assert.equal(s.hungerDebt,0)
  assert.equal(stored.hungerDebt,0);assert.equal(stored.cookedRice,0)
  assert.equal(g.battle.combatReady,true)
})

test('严重饥饿即使不足一餐也立即进食，按份量恢复并重新计时，刷新不重复扣饭',()=>{
  const s=freshSave();s.hungerDebt=3;s.mealElapsed=299;s.cookedRice=3;s.cookedCorn=3
  const result=advanceLogistics(s,0)
  assert.equal(result.consumed,6);assert.equal(s.hungerDebt,2.5);assert.equal(s.foodConsumed,6)
  assert.equal(s.mealElapsed,0);assert.equal(s.lastMealShortage,6)
  const loaded=normalizeSave(JSON.parse(JSON.stringify(s)))
  assert.equal(advanceLogistics(loaded,.1).consumed,0);assert.equal(loaded.hungerDebt,2.5)
  loaded.rice=6;const cooked=cookDish(loaded,'cookedRice',6)
  assert.equal(cooked.feeding.consumed,6);assert.equal(loaded.hungerDebt,0)
  assert.equal(loaded.lastMealShortage,0);assert.equal(loaded.lastMealServed,12)
  loaded.rice=12;cookDish(loaded,'cookedRice',12);assert.equal(loaded.cookedRice,12)
  advanceLogistics(loaded,299.9);assert.equal(loaded.cookedRice,12)
  advanceLogistics(loaded,.1);assert.equal(loaded.cookedRice,0);assert.equal(loaded.hungerDebt,0)
})

test('现有熟食立即解除失能并在同一轮恢复耕作，整步与逐秒推进一致',()=>{
  const s=freshSave();assert(startFarming(s,'self',10,'rice').ok)
  s.hungerDebt=3;s.cookedRice=36;s.mealElapsed=280
  const a=structuredClone(s),b=structuredClone(s)
  const result=advanceEconomy(a,60)
  for(let i=0;i<60;i++)advanceEconomy(b,1)
  assert.deepEqual(a,b);assert.equal(result.consumed,12);assert.equal(a.hungerDebt,0)
  assert.equal(result.harvests.length,1);assert.equal(a.rice,30);assert.equal(a.cookedRice,24)
})

test('7410人即使欠3餐，自动吃够741份后库存为0也保持正常到下一饭点',()=>{
  const s=freshSave();s.troops=7410;s.rice=741;s.hungerDebt=3;s.lastMealShortage=741;s.mealElapsed=299.9
  assert.equal(advanceLogistics(s,.1).consumed,741)
  assert.equal(s.cookedRice,0);assert.equal(s.rice,0);assert.equal(s.hungerDebt,0)
  assert.equal(s.lastMealShortage,0);assert.equal(s.lastMealServed,741);assert.equal(s.foodConsumed,741)
  const loaded=normalizeSave(JSON.parse(JSON.stringify(s)))
  advanceLogistics(loaded,299.9);assert.equal(loaded.hungerDebt,0);assert.equal(loaded.lastMealShortage,0)
  advanceLogistics(loaded,.1);assert.equal(loaded.hungerDebt,1);assert.equal(loaded.lastMealShortage,741)
})

test('部分供餐进度跨刷新保留，饥饿降低后仍可补齐本餐，补齐只扣剩余份数',()=>{
  const s=freshSave();s.hungerDebt=2.2;s.cookedRice=3
  advanceLogistics(s,0);assert(Math.abs(s.hungerDebt-1.95)<1e-8)
  assert.equal(s.lastMealShortage,9);assert.equal(s.lastMealServed,3)
  const loaded=normalizeSave(JSON.parse(JSON.stringify(s)));loaded.rice=20
  const cooked=cookDish(loaded,'cookedRice',20)
  assert.equal(cooked.feeding.consumed,9);assert.equal(loaded.cookedRice,11)
  assert.equal(loaded.hungerDebt,0);assert.equal(loaded.lastMealShortage,0);assert.equal(loaded.lastMealServed,12)
  const before=JSON.stringify(loaded);advanceLogistics(loaded,0);assert.equal(JSON.stringify(loaded),before)
})

test('旧存档最后已吃饱则清除历史欠餐，未吃饱的旧存档不伪造吃饭，迁移只发生一次',()=>{
  const raw=freshSave();delete raw.lastMealServed
  raw.hungerDebt=2;raw.lastMealShortage=0;raw.foodConsumed=12;raw.mealElapsed=100
  const s=normalizeSave(raw);assert.equal(s.hungerDebt,0);assert.equal(s.lastMealServed,12)
  advanceLogistics(s,200);assert.equal(s.hungerDebt,1);assert.equal(s.lastMealServed,0)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  raw.lastMealShortage=5;const partial=normalizeSave(raw);assert.equal(partial.hungerDebt,2);assert.equal(partial.lastMealServed,0)
})
