import test from 'node:test'
import assert from 'node:assert/strict'
import { freshSave,normalizeSave,setFormation } from '../js/state.js'
import { RATIONS,advanceLogistics,donateFood,grantVillageSupplies,VILLAGE_SUPPLY_IDS } from '../js/logistics.js'
import { startFarming,advanceFarming,cancelFarming } from '../js/base.js'
import { advanceEconomy } from '../js/economy.js'
import { Game } from '../js/game.js'

test('口粮每300秒扣一次，每次仍按人数计算，欠餐按新餐次累计',()=>{
  assert.equal(RATIONS.interval,300);const s=freshSave();s.cookedRice=100
  advanceLogistics(s,299.9);assert.equal(s.cookedRice,100);assert.equal(s.hungerDebt,0)
  assert.equal(advanceLogistics(s,.1).consumed,12);assert.equal(s.cookedRice,88)
  const meals=advanceLogistics(s,600);assert.equal(meals.meals,2);assert.equal(meals.consumed,24);assert.equal(s.cookedRice,64)
  const hungry=freshSave();advanceLogistics(hungry,899);assert.equal(hungry.hungerDebt,2);advanceLogistics(hungry,1);assert.equal(hungry.hungerDebt,3)
})

test('旧60秒口粮计时按完成比例迁移，刷新不再次放大或重复扣粮',()=>{
  const old=normalizeSave({troops:120,cookedRice:40,mealElapsed:30,hungerDebt:1.5})
  assert.equal(old.mealElapsed,150);assert.equal(old.rationClockVersion,2);assert.equal(old.cookedRice,40);assert.equal(old.hungerDebt,1.5)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(old))),old)
  advanceLogistics(old,149.9);assert.equal(old.cookedRice,40);advanceLogistics(old,.1);assert.equal(old.cookedRice,28)
  const modern=freshSave();modern.mealElapsed=240;assert.equal(normalizeSave(modern).mealElapsed,240)
})

test('送粮动员和缺粮慢速报名都不再赠送乡亲物资，不额外扣金币或商城限额',()=>{
  const s=freshSave();s.millet=25;const coins=s.coins,stock={...s.shopStock}
  donateFood(s,'millet',25);assert.equal(s.villageSuppliesReceived,0)
  const result=advanceLogistics(s,50);assert.equal(result.recruited,25)
  assert.deepEqual(result.supplies,{})
  for(const id of VILLAGE_SUPPLY_IDS)assert.equal(s[id],0)
  assert.equal(s.troops,145);assert.equal(s.villageSuppliesReceived,0);assert.equal(s.coins,coins);assert.deepEqual(s.shopStock,stock)
  assert.equal(s.salt,0);assert.equal(s.oil,0);assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const slow=advanceLogistics(s,20);assert.equal(slow.recruited,5);assert.deepEqual(slow.supplies,{});assert.equal(s.villageSuppliesReceived,0)
})

test('代耕收成全留乡亲，不发物资；保留报名5人和减耗，编制与经验不变',()=>{
  const s=freshSave();setFormation(s,'squad',7);s.formations[0].trainingXp=420;const units=JSON.stringify(s.formations)
  assert(startFarming(s,'help',0,'millet',[1]).ok);assert.equal(advanceFarming(s,59.9),null)
  const saved=normalizeSave(JSON.parse(JSON.stringify(s))),result=advanceFarming(saved,.1)
  assert.equal(result.recruited,5);assert.equal(saved.troops,125);assert.equal(saved.recruitedTroops,5);assert.equal(saved.mobilizationDiscounts,7)
  assert.equal(result.amount,0);assert.deepEqual(result.supplies,{});assert.equal(saved.villageSuppliesReceived,0)
  for(const id of VILLAGE_SUPPLY_IDS)assert.equal(saved[id],0)
  assert.equal(JSON.stringify(saved.formations),units);assert.equal(advanceFarming(saved,60),null)
  assert(startFarming(saved,'help',1).ok);cancelFarming(saved);advanceFarming(saved,60);assert.equal(saved.troops,125)
  const cap=freshSave();cap.troops=9999998;startFarming(cap,'help',1);const limited=advanceFarming(cap,60)
  assert.equal(limited.recruited,2);assert.equal(cap.troops,10000000)
})

test('乡亲物资补给接口暂停但保留历史库存，自耕产出为原来的150%',()=>{
  const s=freshSave();for(const id of VILLAGE_SUPPLY_IDS)s[id]=9999999
  const result=grantVillageSupplies(s,20);assert.deepEqual(result,{})
  for(const id of VILLAGE_SUPPLY_IDS)assert.equal(s[id],9999999)
  const snapshot=JSON.stringify(s);for(const n of [0,-1,1.2,NaN,Infinity])assert.deepEqual(grantVillageSupplies(s,n),{})
  assert.equal(JSON.stringify(s),snapshot);assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const t=freshSave();startFarming(t,'self',5,'corn');advanceFarming(t,60);assert.equal(t.corn,15);assert.equal(t.troops,120);assert.equal(t.villageSuppliesReceived,0)
})

test('取消乡亲补给后整步和逐秒结算一致，界面显示每次需求与补给暂停提示',()=>{
  const a=freshSave();a.millet=25;donateFood(a,'millet',25);startFarming(a,'help',5)
  const b=structuredClone(a);advanceEconomy(a,300);for(let i=0;i<300;i++)advanceEconomy(b,1);assert.deepEqual(a,b)
  const labels=[],g=Object.create(Game.prototype);g.save=a;g.scene='lobby';g.buttons=[];g.notify=()=>{};g.persist=()=>{}
  g.ctx=new Proxy({fillText:value=>labels.push(String(value))},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  g.open('kitchen');g.drawModal();assert(labels.some(label=>label.includes('每次需')&&label.includes('5分钟/次')))
  g.open('recruitment');g.drawModal();assert(labels.some(label=>label.includes('暂停乡亲物资补给')))
})
