import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation} from '../js/state.js'
import {stationTroops,villageOfFormation,placeVillageFacility,recallGarrison} from '../js/villages.js'
import {availableWorkforce,validateAllocations} from '../js/workforce.js'
import {farmTaskAt,startFarming,cancelFarming,formationActivity} from '../js/base.js'
import {startProduction,recallFacility} from '../js/facilities.js'
import {startTrainingTask} from '../js/training.js'
import {advanceEconomy} from '../js/economy.js'
import {donateFood,advanceLogistics,mobilizationRecord,mobilizationStatus,enableAllVillageMobilization,setAllVillagesMobilizing,setMobilizationActive,donateAllVillages,serveMealNow} from '../js/logistics.js'
import {populationRule,villagePopulation,advancePopulation} from '../js/population.js'
import {MAP_FIELDS,MAP_SITES} from '../js/world-map.js'
import {Game} from '../js/game.js'

function setup(id=1){const s=freshSave();assert(setFormation(s,'platoon',40).ok);assert(stationTroops(s,id,[1]).ok);s.cookedRice=1000;s.materials.ore=100;s.materials.wood=100;return s}
const part=(troops,type='group')=>[{unitId:1,troops,type}]
const farm=(s,n=7)=>startFarming(s,'help',0,MAP_FIELDS[0].crop,[1],MAP_FIELDS[0].id,part(n,'squad'))
const clone=s=>normalizeSave(structuredClone(s))
function game(s=setup()){
  const g=Object.create(Game.prototype);Object.assign(g,{save:s,scene:'world-map',buttons:[],modal:null,notify(message){this.message=message},persist(){}})
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  return g
}
const draw=g=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
const click=(g,id)=>{const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn()}

test('同一驻军可派班代耕并另派人员生产，余员守村，原人数武器经验不复制或丢失',()=>{
  const s=setup();s.formations[0].trainingXp=2400;const original=structuredClone(s.formations[0]),weapons=structuredClone(s.weaponCounts)
  placeVillageFacility(s,'armory',1);assert(farm(s).ok);assert(startProduction(s,[1],'rifle',1,part(14)).ok)
  assert.equal(availableWorkforce(s,1),19);assert.deepEqual(s.formations[0],original);assert.deepEqual(s.weaponCounts,weapons)
  assert.equal(startTrainingTask(s,1,1).ok,false);assert.equal(recallGarrison(s,1,1).ok,false)
  const loaded=clone(s);assert.deepEqual(loaded,s);assert.equal(availableWorkforce(loaded,1),19)
  advanceEconomy(loaded,70,()=>0);assert.equal(farmTaskAt(loaded,MAP_FIELDS[0].id),null);assert.equal(availableWorkforce(loaded,1),26);assert.equal(villageOfFormation(loaded,1),1)
  assert.equal(loaded.villagePopulation[1],499);assert.equal(loaded.troops,121)
  advanceEconomy(loaded,230,()=>1);assert.equal(loaded.productionTotals.rifle,10)
  recallFacility(loaded,'rifle');assert.equal(availableWorkforce(loaded,1),40);assert.equal(formationActivity(loaded,1),'garrison')
  assert.deepEqual(loaded.formations[0],original);assert.deepEqual(clone(loaded),loaded)
})

test('驻村整编也可选择一支帮本村种地，其他驻军仍空闲；外村田地不能直接占用本村人员',()=>{
  const s=setup();setFormation(s,'squad',10);stationTroops(s,1,[2])
  assert(startFarming(s,'help',0,MAP_FIELDS[0].crop,[2],MAP_FIELDS[0].id).ok)
  assert.equal(farmTaskAt(s,MAP_FIELDS[0].id).villageId,1);assert.equal(availableWorkforce(s,1),40);assert.equal(availableWorkforce(s,2),0)
  assert.deepEqual(clone(s),s);cancelFarming(s,MAP_FIELDS[0].id);assert.equal(villageOfFormation(s,2),1)
  const foreign=MAP_FIELDS.find(f=>f.villageId===2)
  assert.equal(startFarming(s,'help',0,foreign.crop,[1],foreign.id,part(7)).ok,false)
})

test('派遣拒绝重复人员、人数区间错误、过高级编制和伪造存档，合法另一任务不受影响',()=>{
  const s=setup();placeVillageFacility(s,'armory',1);assert(farm(s).ok)
  for(const allocations of [[...part(3),...part(4)],part(6,'squad'),part(30,'company'),part(34),part(0)]){
    const before=structuredClone(s);assert.equal(startProduction(s,[1],'rifle',1,allocations).ok,false);assert.deepEqual(s,before)
  }
  assert(startProduction(s,[1],'rifle',1,part(14)).ok)
  for(const changes of [{workers:15},{allocations:part(35)},{unitIds:[999]},{unitIds:undefined},{villageId:2}]){
    const raw=structuredClone(s);Object.assign(raw.armoryTasks.rifle,changes);const loaded=clone(raw)
    assert.equal(loaded.armoryTasks.rifle,undefined);assert(farmTaskAt(loaded,MAP_FIELDS[0].id));assert.equal(availableWorkforce(loaded,1),33);assert.equal(loaded.troops,120)
  }
  const missing=structuredClone(s);delete farmTaskAt(missing,MAP_FIELDS[0].id).unitIds;assert.equal(farmTaskAt(clone(missing),MAP_FIELDS[0].id),null)
})

test('六村人口增长上限小5中10大20，人口上限和剩余计时刷新保留',()=>{
  const s=freshSave();assert.deepEqual(MAP_SITES.map(v=>v.size).sort(),['large','large','medium','medium','small','small'])
  for(const v of MAP_SITES)s.villagePopulation[v.id]=0
  advanceLogistics(s,59);for(const v of MAP_SITES)assert.equal(villagePopulation(s,v.id),0)
  const loaded=clone(s);assert.equal(loaded.populationClock,59);advanceLogistics(loaded,1,()=>1)
  for(const v of MAP_SITES)assert.equal(villagePopulation(loaded,v.id),populationRule(v.id).growth)
  for(const v of MAP_SITES)loaded.villagePopulation[v.id]=populationRule(v.id).cap-1
  advanceLogistics(loaded,60,()=>1);for(const v of MAP_SITES)assert.equal(villagePopulation(loaded,v.id),populationRule(v.id).cap)
  loaded.villagePopulation[1]=0;loaded.populationClock=60;advanceLogistics(loaded,0,()=>1);assert.equal(loaded.villagePopulation[1],5);assert.equal(loaded.populationClock,0)
  const raw=structuredClone(loaded);raw.villagePopulation[1]=99999;raw.villagePopulation[2]=-5
  const cleaned=clone(raw);assert.equal(cleaned.villagePopulation[1],500);assert.equal(cleaned.villagePopulation[2],0);assert.equal(clone(cleaned).villagePopulation[2],0)
})

test('招募按小1—3中3—5大5—10随机，每个报名者从本村人口转入全军',()=>{
  for(const [id,min,max] of [[1,1,3],[2,3,5],[3,5,10]]){
    const s=freshSave(),initial=villagePopulation(s,id);donateFood(s,'coins',20,id)
    assert.equal(advanceLogistics(s,10,()=>0).recruited,min);assert.equal(villagePopulation(s,id),initial-min)
    assert.equal(advanceLogistics(s,10,()=>1).recruited,max);assert.equal(villagePopulation(s,id),initial-min-max)
    assert.equal(s.troops,120+min+max);assert.equal(mobilizationRecord(s,id).recruitedTroops,min+max)
    assert.equal(s.villagePopulation[id]+s.troops,initial+120);assert.deepEqual(clone(s),s)
  }
})

test('村民不足只招剩余人数，耗尽暂停招募不白扣储备，人口增长后恢复报名',()=>{
  const s=freshSave();s.villagePopulation[2]=2;donateFood(s,'coins',30,2)
  assert.equal(advanceLogistics(s,10,()=>1).recruited,2);assert.equal(villagePopulation(s,2),0);assert.equal(mobilizationStatus(s,2),'村民不足')
  const stock=mobilizationRecord(s,2).mobilizationCoins;advanceLogistics(s,49,()=>1)
  assert.equal(mobilizationRecord(s,2).mobilizationCoins,stock);assert.equal(s.recruitedTroops,2)
  advanceLogistics(s,1,()=>1);assert.equal(villagePopulation(s,2),10);advanceLogistics(s,10,()=>0)
  assert.equal(villagePopulation(s,2),7);assert.equal(s.recruitedTroops,5)
})

test('部分派遣、人口增长与招募随机在整段/分步推进一致，不重复结算',()=>{
  const a=setup();placeVillageFacility(a,'armory',1);farm(a);startProduction(a,[1],'rifle',1,part(7));donateFood(a,'coins',50,1)
  const b=structuredClone(a);advanceEconomy(a,300,()=>.4);for(let i=0;i<300;i++)advanceEconomy(b,1,()=>.4)
  const fieldId=MAP_FIELDS[0].id
  assert(Math.abs(a.fieldCooldowns[fieldId]-b.fieldCooldowns[fieldId])<1e-8)
  assert.deepEqual({...a,fieldCooldowns:{...a.fieldCooldowns,[fieldId]:b.fieldCooldowns[fieldId]}},b)
  assert.deepEqual(clone(a),a);assert.equal(a.productionTotals.rifle,5)
})

test('地图村名下展示多支驻军，村庄人口可见；分遣班耕田和工厂流程可用且不越界',()=>{
  const g=game(),s=g.save,labels=[];setFormation(s,'squad',10);stationTroops(s,1,[2]);g.ctx.fillText=value=>labels.push(String(value))
  g.openWorldMap();g.buttons=[];g.drawWorldMap();assert(labels.some(value=>value.includes('1排')&&value.includes('1班')))
  g.openVillage(1);draw(g);assert(labels.some(value=>value.includes('村民 500 / 500')))
  g.openMapField(MAP_FIELDS[0].id);draw(g);click(g,'farm-detach');draw(g);click(g,'work-root-1');draw(g);click(g,'work-type-squad');draw(g);click(g,'work-confirm')
  assert.equal(farmTaskAt(s,MAP_FIELDS[0].id).workers,7);assert.equal(farmTaskAt(s,MAP_FIELDS[0].id).allocations[0].type,'squad');assert.equal(s.formations[0].troops,40)
  g.openVillage(1);draw(g);click(g,'village-armory');draw(g);click(g,'facility-detach');draw(g);click(g,'work-root-1');draw(g);click(g,'work-confirm')
  assert.equal(s.armoryTasks.rifle.workers,7);assert.equal(availableWorkforce(s,1),26);assert.equal(g.modal,'base-armory')
})

test('兵工厂分遣可选临时人员小组，取消窗口不占兵，村庄驻军不限一支',()=>{
  const s=freshSave();for(let i=0;i<10;i++)setFormation(s,'squad',7)
  assert(stationTroops(s,2,s.formations.map(u=>u.id)).ok);assert.equal(s.garrisons[2].length,10)
  const g=game(s);g.openVillage(2);draw(g);click(g,'village-armory');draw(g);click(g,'factory-product-bullets');draw(g)
  click(g,'facility-detach');draw(g);click(g,'work-root-1');draw(g);click(g,'work-back')
  assert.equal(availableWorkforce(s,1),7);assert.equal(s.armoryTasks.bullets,undefined)
  draw(g);click(g,'work-root-1');draw(g)
  const previousWx=globalThis.wx;let dialog;globalThis.wx={showModal:options=>{dialog=options}}
  try{click(g,'work-count');assert.equal(dialog.maxValue,7);dialog.success({confirm:true,content:'2'})}finally{if(previousWx===undefined)delete globalThis.wx;else globalThis.wx=previousWx}
  click(g,'work-add');draw(g);click(g,'work-root-2');draw(g);g.workCount=2;click(g,'work-confirm')
  assert.equal(s.armoryTasks.bullets.workers,4);assert.equal(availableWorkforce(s,1),5);assert.equal(availableWorkforce(s,2),5)
  assert.deepEqual(clone(s),s)
})

const garrisonAll=s=>{for(const v of MAP_SITES){assert(setFormation(s,'squad',7).ok);assert(stationTroops(s,v.id,[s.formations.at(-1).id]).ok)}}
test('统一动员继承旧村储备进度，全部驻军村庄参与，任一入口暂停都作用于全村',()=>{
  const s=freshSave();garrisonAll(s);s.rice=30;donateFood(s,'rice',10,2);advanceLogistics(s,3,()=>0)
  assert(enableAllVillageMobilization(s));assert.equal(enableAllVillageMobilization(s),false)
  assert.equal(mobilizationRecord(s,2).recruitElapsed,3);assert.equal(mobilizationRecord(s,2).mobilizationFood,10)
  for(const v of MAP_SITES)assert.equal(mobilizationRecord(s,v.id).mobilizationActive,true)
  advanceLogistics(s,20,()=>0)
  for(const v of MAP_SITES)assert(mobilizationRecord(s,v.id).recruitedTroops>0,v.name)
  assert.equal(s.recruitedTroops,MAP_SITES.reduce((n,v)=>n+mobilizationRecord(s,v.id).recruitedTroops,0))
  assert.equal(s.mobilizationActive,false);setMobilizationActive(s,false,3);const troops=s.troops
  advanceLogistics(s,20,()=>0);assert.equal(s.troops,troops)
  for(const v of MAP_SITES)assert.equal(mobilizationRecord(s,v.id).mobilizationActive,false)
  assert.deepEqual(clone(s),s)
  const pending=freshSave();setMobilizationActive(pending,true,2);advanceLogistics(pending,5,()=>0);pending.mobilizationCoins=10
  enableAllVillageMobilization(pending);assert.equal(mobilizationRecord(pending,2).recruitElapsed,2.5)
})

test('统一赠送仅扣一份总数量，共用储备供各驻军村招募，没有额外全局第七路报名；未驻军村不参与动员',()=>{
  const s=freshSave();s.millet=100;assert.equal(donateAllVillages(s,'millet',30).ok,false);assert.equal(s.millet,100)
  for(let i=1;i<=5;i++){assert(setFormation(s,'squad',7).ok);assert(stationTroops(s,i,[s.formations.at(-1).id]).ok)}
  assert(donateAllVillages(s,'millet',30).ok);assert.equal(mobilizationStatus(s,6),'未驻军')
  assert.equal(s.millet,70);assert.equal(s.mobilizationFood,30)
  advanceLogistics(s,10,()=>0);assert.equal(s.recruitedTroops,13);assert.equal(s.troops,133)
  assert.equal(mobilizationRecord(s,6).recruitedTroops,0)
  assert(setFormation(s,'squad',7).ok);assert(stationTroops(s,6,[s.formations.at(-1).id]).ok)
  const before=structuredClone(s);assert.equal(donateAllVillages(s,'millet',10000).ok,false);assert.deepEqual(s,before)
  setAllVillagesMobilizing(s,false);assert.deepEqual(clone(s),s)
})

test('统一动员共享储备耗尽时按比例切换村庄进度，跨秒和整段推进一致',()=>{
  const a=freshSave();garrisonAll(a);a.cookedRice=1000;donateFood(a,'coins',5,1);advanceLogistics(a,7,()=>.5)
  donateAllVillages(a,'coins',10);a.villagePopulation[3]=1800
  const b=structuredClone(a);advanceEconomy(a,180,()=>.5);for(let i=0;i<180;i++)advanceEconomy(b,1,()=>.5)
  assert.deepEqual(a,b);assert.deepEqual(clone(a),a)
})

test('手动开饭可以主动用主食做饭，关闭自动做饭仍可手动供餐，吃饱不重复扣粮',()=>{
  const s=freshSave();s.autoCooking=false;s.hungerDebt=3;s.millet=12
  const first=serveMealNow(s,()=>0);assert(first.ok);assert.equal(first.consumed,12);assert.equal(s.millet,0)
  assert.equal(s.hungerDebt,0);assert.equal(s.lastMealServed,12);assert.equal(s.lastMealShortage,0);assert.equal(s.autoCooking,false)
  const before=structuredClone(s);assert.equal(serveMealNow(s).ok,false);assert.deepEqual(s,before)
  s.troops=130;s.millet=1;assert.equal(serveMealNow(s,()=>0).consumed,1);assert.equal(s.lastMealServed,13)
})

test('手动供餐只补当前剩余缺口，缺粮可先吃一部分，无食材不改进度或额外扣粮',()=>{
  const s=freshSave();s.hungerDebt=2;s.lastMealServed=5;s.lastMealShortage=7;s.cookedRice=3
  const result=serveMealNow(s,()=>0);assert(result.ok);assert.equal(result.consumed,3);assert.equal(s.lastMealServed,8);assert.equal(s.lastMealShortage,4)
  const before=structuredClone(s);assert.equal(serveMealNow(s).ok,false);assert.deepEqual(s,before)
  s.corn=4;assert.equal(serveMealNow(s,()=>0).consumed,4);assert.equal(s.hungerDebt,0);assert.equal(s.lastMealServed,12)
})

test('每分钟村民增长随机可为0，分别不超过5/10/20，刷新不重抽已完成分钟',()=>{
  const s=freshSave();for(const v of MAP_SITES)s.villagePopulation[v.id]=0
  advancePopulation(s,60,()=>0);for(const v of MAP_SITES)assert.equal(villagePopulation(s,v.id),0)
  advancePopulation(s,60,()=>1);for(const v of MAP_SITES)assert.equal(villagePopulation(s,v.id),populationRule(v.id).growth)
  const loaded=clone(s);advanceLogistics(loaded,0,()=>1);assert.deepEqual(loaded,s)
  advancePopulation(loaded,60,()=>.5);for(const v of MAP_SITES)assert.equal(villagePopulation(loaded,v.id),populationRule(v.id).growth+Math.floor((populationRule(v.id).growth+1)*.5))
})

test('村庄说明行只列等级人口，地图可直接开统一动员，灶房手动开饭按钮可用',()=>{
  const g=game(setup(3)),labels=[];g.ctx.fillText=value=>labels.push(String(value));g.openVillage(3);draw(g)
  assert(labels.includes('大村庄 · 村民 2000 / 2000 人'));assert.equal(labels.some(v=>v.includes('村民')&&(v.includes('每分钟')||v.includes('每批招募'))),false)
  g.openWorldMap();g.buttons=[];g.drawWorldMap();click(g,'map-recruitment');draw(g)
  assert(labels.includes('驻军村庄 · 动员'));assert(labels.includes('青山村'))
  click(g,'recruit-toggle');assert(g.save.allVillagesMobilizing);click(g,'recruit-toggle');assert.equal(g.save.allVillagesMobilizing,false)
  g.save.millet=12;g.save.hungerDebt=3;g.open('kitchen');draw(g);click(g,'kitchen-feed')
  assert.equal(g.save.hungerDebt,0);assert.equal(g.save.lastMealServed,12)
})
