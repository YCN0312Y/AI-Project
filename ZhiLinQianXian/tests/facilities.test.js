import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation,mergeFormations,unmergeFormation,removeFormation,settle,reinforceFormation,applyBattleLosses,splitGarrisonUnit,baseForces} from '../js/state.js'
import {donateFood,advanceLogistics,recruitmentInterval,mealCost,totalPersonnel,validateDonation} from '../js/logistics.js'
import {startProduction,startTreatment,recallFacility,advanceFacilities,recordBattleCasualties,finalizeBattleCasualties,WARDS} from '../js/facilities.js'
import {formationActivity,startFarming,cancelFarming} from '../js/base.js'
import {advanceEconomy} from '../js/economy.js'
import {createTraining} from '../js/training.js'
import {campaignDeployment,CampaignBattle} from '../js/campaign.js'
import {Game} from '../js/game.js'
import {stationTroops,placeVillageFacility} from '../js/villages.js'
import {availableWorkforce} from '../js/workforce.js'
import {MAP_REGIONS} from '../js/world-map.js'
import {occupyRegion,regionLocalUnits} from '../js/regions.js'
import {startGarrisonTransfer,advanceMarches,marchOrigin} from '../js/marching.js'

function ready(count=4,troops=10){
  const s=freshSave();s.coins=1000;s.cookedRice=1000;s.materials.ore=100;s.materials.wood=100
  for(let i=0;i<count;i++)assert(setFormation(s,'squad',troops).ok)
  return s
}
function wound(s,light,heavy){s.wounded={light,heavy};s.heavyTreatmentStages=[heavy,0,0]}
function game(s){
  const g=Object.create(Game.prototype);g.save=s;g.scene='lobby';g.modal=null;g.buttons=[];g.notify=()=>{};g.persist=()=>{}
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  return g
}
function draw(g){g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.x+b.w<=1170&&b.y>=130&&b.y+b.h<=680,b.id)}
function click(g,id){const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn()}

test('金币赠送先扣金币存入支持，等待10秒报名，不立即购买士兵，也不动食物',()=>{
  const s=freshSave(),troops=s.troops;assert(donateFood(s,'coins',20).ok)
  assert.equal(s.coins,580);assert.equal(s.mobilizationCoins,20);assert.equal(s.mobilizationFood,0);assert.equal(s.troops,troops)
  assert.equal(recruitmentInterval(s),10);advanceLogistics(s,9.9);assert.equal(s.troops,troops)
  advanceLogistics(s,.1);assert.equal(s.troops,troops+5);assert.equal(s.mobilizationCoins,15);assert.equal(s.coins,580)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const before=JSON.stringify(s);for(const count of [0,-1,1.5,10001,Infinity])assert.equal(donateFood(s,'coins',count).ok,false)
  assert.equal(validateDonation(s,'coins',581).ok,false);assert.equal(JSON.stringify(s),before)
})

test('赠金币与食物支持可合并、享受代耕减耗，切换报名速度保留进度且不绕过口味规则',()=>{
  const s=freshSave();s.millet=20;donateFood(s,'millet',5);donateFood(s,'millet',5)
  donateFood(s,'coins',10);assert.equal(s.donationStreak,2);assert.equal(validateDonation(s,'millet',1).ok,false)
  s.mobilizationFood=1;s.mobilizationCoins=0;advanceLogistics(s,10);assert.equal(s.recruitElapsed,10)
  donateFood(s,'coins',4);assert.equal(s.recruitElapsed,5);assert.equal(recruitmentInterval(s),10)
  advanceLogistics(s,5);assert.equal(s.mobilizationFood,0);assert.equal(s.mobilizationCoins,0)
  s.mobilizationDiscounts=1;donateFood(s,'coins',3);advanceLogistics(s,10)
  assert.equal(s.mobilizationCoins,0);assert.equal(s.mobilizationDiscounts,0)
  const old=normalizeSave({mobilizationCoins:10,recruitElapsed:7});assert.equal(old.recruitElapsed,7)
})

test('工厂每分钟按7人步枪、5人手枪、3人手雷生产，连续轮次产出不占商城限额',()=>{
  for(const [product,amount] of [['rifle',1],['pistol',2],['grenades',3]]){
    const s=ready(),before=structuredClone(s.shopStock),coins=s.coins,stock=product==='grenades'?s:s.weaponCounts,initial=stock[product]
    assert(startProduction(s,[1],product).ok);advanceFacilities(s,59.9);assert.equal(stock[product],initial)
    assert.equal(advanceFacilities(s,.1).produced[0].amount,amount);assert.equal(stock[product],initial+amount)
    advanceFacilities(s,120);assert.equal(stock[product],initial+amount*3);assert.equal(s.productionTotals[product],amount*3)
    assert.deepEqual(s.shopStock,before);assert.equal(s.coins,coins)
  }
})

test('旧武器项目迁移保留进度，兵工厂可同时派驻三项并单独结束',()=>{
  const before=ready(3)
  assert(stationTroops(before,1,[1,2,3]).ok);assert(placeVillageFacility(before,'armory',1).ok)
  assert(startProduction(before,[1],'rifle').ok);advanceFacilities(before,44)
  const legacy=structuredClone(before);legacy.armoryTask=legacy.armoryTasks.rifle;legacy.armoryTask.elapsed=220;delete legacy.armoryTasks;delete legacy.armoryClockVersion
  const s=normalizeSave(legacy);assert.deepEqual(s,before)
  const g=game(s),labels=[];g.ctx.fillText=value=>labels.push(String(value));g.localVillage=1
  g.open('base-armory');draw(g);click(g,'factory-product-pistol');draw(g)
  click(g,'facility-unit-1');assert.deepEqual(g.facilitySelected,[])
  click(g,'facility-unit-2');draw(g);click(g,'facility-start');draw(g)
  click(g,'factory-product-grenades');draw(g);click(g,'facility-unit-3');draw(g);click(g,'facility-start');draw(g)
  assert(['步枪','手枪','手雷','步枪子弹','手枪子弹','● 已派工'].every(name=>labels.includes(name)))
  assert.deepEqual(advanceFacilities(s,16).produced,[{product:'rifle',amount:1}])
  assert.equal(s.armoryTasks.pistol.elapsed,16);assert.equal(s.armoryTasks.grenades.elapsed,16)
  assert.deepEqual(normalizeSave(s),s)
  click(g,'facility-recall');assert.equal(s.armoryTasks.grenades,undefined)
  assert.equal(formationActivity(s,3),'garrison');assert.equal(placeVillageFacility(s,'armory',2).ok,false)
  assert.deepEqual(advanceFacilities(s,44).produced,[{product:'pistol',amount:2}])
})

test('并行生产按完成时刻消耗共享材料，一次推进与逐秒相同',()=>{
  const s=ready(2);s.materials={ore:15,wood:7,grass:0}
  assert(startProduction(s,[2],'pistol').ok);advanceFacilities(s,50)
  assert(startProduction(s,[1],'rifle').ok)
  const split=normalizeSave(s)
  assert.deepEqual(advanceFacilities(s,60).produced,[{product:'pistol',amount:2}])
  for(let i=0;i<60;i++)advanceFacilities(split,1)
  assert.deepEqual(s,split);assert.deepEqual(s.materials,{ore:5,wood:3,grass:0})
  assert.equal(s.armoryTasks.rifle.elapsed,10)
})

test('步枪子弹和手枪子弹可与现有产线并行，产出按发计入弹药库存',()=>{
  const s=ready(3),g=game(s),labels=[];g.ctx.fillText=value=>labels.push(String(value))
  s.materials.ore=200
  assert(startProduction(s,[1],'rifle').ok)
  g.open('base-armory');draw(g);click(g,'factory-product-rifleAmmo');draw(g)
  click(g,'facility-unit-2');draw(g);click(g,'facility-start');draw(g)
  click(g,'factory-product-pistolAmmo');draw(g);click(g,'facility-unit-3');draw(g);click(g,'facility-start')
  assert.deepEqual(normalizeSave(s),s)
  assert.deepEqual(advanceFacilities(s,59).produced,[])
  assert.deepEqual(advanceFacilities(s,1).produced,[{product:'rifle',amount:1},{product:'rifleAmmo',amount:100},{product:'pistolAmmo',amount:100}])
  assert.equal(s.rifleAmmo,100);assert.equal(s.pistolAmmo,100)
  advanceFacilities(s,240)
  assert.equal(s.rifleAmmo,500);assert.equal(s.pistolAmmo,500);assert.equal(s.productionTotals.rifle,5);assert.equal(s.materials.ore,50)
  assert.equal(s.weaponCounts.rifleAmmo,undefined);assert.equal(s.productionTotals.pistolAmmo,500)
  g.open('warehouse');g.inventoryTab='ammo';labels.length=0;draw(g)
  assert(labels.includes('步枪子弹')&&labels.includes('手枪子弹'))
})

test('弹药旧工单按比例迁移到60秒，一名驻军也可按整条产线结算',()=>{
  const s=ready(1),work=[{unitId:1,troops:1,type:'group'}]
  assert(stationTroops(s,1,[1]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  assert(startProduction(s,[1],'rifleAmmo',1,work).ok)
  const old=structuredClone(s);delete old.armoryClockVersion;old.armoryTasks.rifleAmmo.elapsed=225
  const restored=normalizeSave(old)
  assert.equal(restored.armoryTasks.rifleAmmo.elapsed,45);assert.deepEqual(normalizeSave(restored),restored)
  advanceFacilities(restored,14);assert.equal(restored.rifleAmmo,0)
  advanceFacilities(restored,1);assert.equal(restored.rifleAmmo,100)
  restored.materials.ore=4
  assert.deepEqual(advanceFacilities(restored,60).produced,[{product:'rifleAmmo',amount:40}])
  assert.equal(restored.materials.ore,0)
})

test('旧版武器工单按比例迁移，已是一分钟的弹药工单不再次缩短',()=>{
  const s=ready(2)
  assert(startProduction(s,[1],'rifle').ok);assert(startProduction(s,[2],'pistolAmmo').ok)
  s.armoryClockVersion=1;s.armoryTasks.rifle.elapsed=225;s.armoryTasks.pistolAmmo.elapsed=45
  const restored=normalizeSave(s)
  assert.equal(restored.armoryTasks.rifle.elapsed,45);assert.equal(restored.armoryTasks.pistolAmmo.elapsed,45)
  assert.deepEqual(normalizeSave(restored),restored)
  assert.deepEqual(advanceFacilities(restored,15).produced,[{product:'rifle',amount:1},{product:'pistolAmmo',amount:100}])
})

test('同一驻军可分派不同人员并行生产，超派被拒绝，撤一项只释放该项人员',()=>{
  const s=ready(1,12),allocation=troops=>[{unitId:1,troops,type:'group'}]
  assert(stationTroops(s,1,[1]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  assert(startProduction(s,[1],'rifle',1,allocation(7)).ok)
  assert(startProduction(s,[1],'pistol',1,allocation(5)).ok)
  assert.equal(startProduction(s,[1],'grenades',1,allocation(3)).ok,false)
  assert.equal(availableWorkforce(s,1),0);assert.deepEqual(normalizeSave(s),s)
  assert(recallFacility(s,'pistol'));assert.equal(availableWorkforce(s,1),5)
  assert(startProduction(s,[1],'grenades',1,allocation(3)).ok);assert.equal(availableWorkforce(s,1),2)
  assert.deepEqual(advanceFacilities(s,60).produced,[{product:'rifle',amount:1},{product:'grenades',amount:1}])
})

test('工厂可派无枪编制及合编，多选按总人数生产，占用全部下属且不能重复派工',()=>{
  const s=ready();for(const unit of s.formations)unit.weapons={rifle:0,pistol:0,machinegun:0,sniper:0,mortar:0}
  const root=mergeFormations(s,[1,2,3]).unit
  assert(startProduction(s,[root.id,4],'grenades').ok);assert.equal(s.armoryTasks.grenades.workers,40)
  assert.equal(formationActivity(s,1),'armory');assert.equal(formationActivity(s,root.id),'armory')
  assert.equal(advanceFacilities(s,300).produced[0].amount,13)
  assert.equal(startTreatment(s,'light',[1]).ok,false);assert.equal(startFarming(s,'help',0,'rice',[root.id]).ok,false)
  assert.equal(createTraining(s,root.id),null);assert.equal(campaignDeployment(s,[root.id]).ok,false)
  assert.equal(unmergeFormation(s,root.id).ok,false);assert.equal(removeFormation(s,4),false)
  assert.equal(reinforceFormation(s,4,0,{},10,true).ok,false)
  assert(recallFacility(s,'grenades'));assert.equal(formationActivity(s,1),null)
  assert(unmergeFormation(s,root.id).ok)
})

test('工厂的非法选择和人数不足不改变存档，库存满额暂停，释放空间后继续',()=>{
  const s=ready(1,7),before=JSON.stringify(s)
  for(const ids of [[],[1,1],[999]])assert.equal(startProduction(s,ids,'rifle').ok,false)
  assert.equal(startProduction(s,[1],'laser').ok,false);assert.equal(JSON.stringify(s),before)
  s.troops=6;s.formations=[];setFormation(s,'squad',6,null,{})
  assert.equal(startProduction(s,[1],'rifle').ok,false)
  assert(startProduction(s,[1],'grenades').ok);s.grenades=9999999
  advanceFacilities(s,300);assert.equal(s.grenades,10000000);assert.equal(s.productionTotals.grenades,1)
  advanceFacilities(s,600);assert.equal(s.armoryTasks.grenades.elapsed,0);assert.equal(s.grenades,10000000)
  s.grenades-=2;advanceFacilities(s,300);assert.equal(s.grenades,10000000)
})

test('轻伤每名需要2人、30秒一轮，最多10名，多余工作人员不突破批次上限',()=>{
  for(const [workers,expected] of [[7,3],[10,5],[20,10],[30,10]]){
    const s=ready(3,10);wound(s,25,0)
    const root=workers>=20?mergeFormations(s,[1,2,3]).unit:null
    if(workers===20){s.formations=[];setFormation(s,'platoon',25,null,{});s.formations[0].troops=20;s.formations[0].battleDamaged=true}
    if(workers===7){s.formations=[];setFormation(s,'squad',7,null,{})}
    const id=workers===30?root.id:s.formations[0].id
    assert(startTreatment(s,'light',[id]).ok)
    const active=s.troops;advanceFacilities(s,29.9,true,()=>1);assert.equal(s.troops,active)
    const result=advanceFacilities(s,.1,true,()=>1).treated[0]
    assert.equal(result.healed,expected);assert.equal(result.attempted,expected);assert.equal(s.wounded.light,25-expected)
    assert.equal(s.troops,active+expected)
  }
})

test('重伤每名需5人、每批最多2名、每轮2分钟；同一伤员跨3轮后才康复',()=>{
  const s=ready();wound(s,0,4);const active=s.troops
  assert(startTreatment(s,'heavy',[1]).ok)
  advanceFacilities(s,119.9,true,()=>1);assert.deepEqual(s.heavyTreatmentStages,[4,0,0])
  advanceFacilities(s,.1,true,()=>1);assert.deepEqual(s.heavyTreatmentStages,[2,2,0]);assert.equal(s.troops,active)
  advanceFacilities(s,120,true,()=>1);assert.deepEqual(s.heavyTreatmentStages,[2,0,2]);assert.equal(s.troops,active)
  const result=advanceFacilities(s,120,true,()=>1).treated[0]
  assert.equal(result.healed,2);assert.equal(s.troops,active+2);assert.equal(s.wounded.heavy,2);assert.deepEqual(s.heavyTreatmentStages,[2,0,0])
  assert.equal(s.medicalTasks.heavy.elapsed,0)
})

test('不足10名医疗工作人员时重伤按每5人1名治疗，少于5人不能开工',()=>{
  const s=ready(1,7);wound(s,0,3);assert(startTreatment(s,'heavy',[1]).ok)
  advanceFacilities(s,120,true,()=>1);assert.deepEqual(s.heavyTreatmentStages,[2,1,0])
  const tiny=freshSave();tiny.troops=4;setFormation(tiny,'squad',4,null,{})
  assert.equal(startTreatment(tiny,'heavy',[1]).ok,false)
  assert(startTreatment(tiny,'light',[1]).ok)
})

test('轻伤10%和重伤40%每次分别判定死亡，死亡不再扣一次现役兵力，只有三轮存活才回归',()=>{
  const s=ready();wound(s,10,2);assert(startTreatment(s,'light',[1,2]).ok);assert(startTreatment(s,'heavy',[3]).ok)
  const active=s.troops,rolls=Array.from({length:10},(_,i)=>i/10)
  const light=advanceFacilities(s,30,true,()=>rolls.shift()??1).treated[0]
  assert.equal(light.dead,1);assert.equal(light.healed,9);assert.equal(s.troops,active+9);assert.equal(s.wounded.light,0)
  const heavyRolls=[.39999,.4]
  const heavy=advanceFacilities(s,90,true,()=>heavyRolls.shift()).treated.find(r=>r.ward==='heavy')
  assert.equal(heavy.dead,1);assert.equal(heavy.healed,0);assert.deepEqual(s.heavyTreatmentStages,[0,1,0])
  advanceFacilities(s,240,true,()=>1);assert.equal(s.wounded.heavy,0);assert.equal(s.troops,active+10)
  assert.equal(s.medicalDeaths,2);assert.equal(s.recoveredTroops,10)
})

test('重伤疗程进度与驻扎计时保存，召回保留疗程，再派人不重复治疗已完成轮次',()=>{
  const s=ready();wound(s,0,2);startTreatment(s,'heavy',[1])
  advanceFacilities(s,150,true,()=>1);assert.deepEqual(s.heavyTreatmentStages,[0,2,0])
  const saved=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(saved,s)
  assert.equal(saved.medicalTasks.heavy.elapsed,30);assert(recallFacility(saved,'heavy'))
  assert.deepEqual(saved.heavyTreatmentStages,[0,2,0]);assert(startTreatment(saved,'heavy',[2]).ok)
  advanceFacilities(saved,120,true,()=>1);assert.deepEqual(saved.heavyTreatmentStages,[0,0,2]);assert.equal(saved.recoveredTroops,0)
  advanceFacilities(saved,120,true,()=>1);assert.equal(saved.recoveredTroops,2);assert.equal(saved.wounded.heavy,0)
})

test('治疗中途新来的伤员等待下一批，不搭便车完成当前轮次；批次与进度一起保存',()=>{
  const s=ready();wound(s,1,1);startTreatment(s,'light',[1]);startTreatment(s,'heavy',[2])
  advanceFacilities(s,29,true,()=>1);s.wounded.light+=4;s.wounded.heavy++;s.heavyTreatmentStages[0]++
  const saved=normalizeSave(JSON.parse(JSON.stringify(s)))
  const first=advanceFacilities(saved,1,true,()=>1).treated[0]
  assert.equal(first.attempted,1);assert.equal(saved.wounded.light,4)
  advanceFacilities(saved,90,true,()=>1);assert.deepEqual(saved.heavyTreatmentStages,[1,1,0])
  assert.equal(saved.recoveredTroops,5)
})

test('战损一半阵亡一半入院，入院按轻重均分，分段结算一致且重复结算不重复入院',()=>{
  const s=ready(),b=new CampaignBattle(1,campaignDeployment(s,[1,2,3]).units)
  b.units[0].hp=0;assert.equal(applyBattleLosses(s,b),10)
  b.units[1].hp=0;assert.equal(applyBattleLosses(s,b),10)
  assert.equal(s.troops,100);assert.deepEqual(s.wounded,{light:0,heavy:0});assert.equal(s.pendingBattleCasualties.light,5)
  const result=settle(s,b);assert.deepEqual(s.wounded,{light:5,heavy:5});assert.equal(s.battleDeaths,10)
  assert.deepEqual(s.heavyTreatmentStages,[5,0,0])
  assert.equal(result.directDeaths,10);assert.equal(result.woundedLight,5);assert.equal(result.woundedHeavy,5)
  assert.equal(settle(s,b),null);assert.deepEqual(normalizeSave(s),s)
  const a=freshSave(),c=freshSave(),ba={},bc={}
  recordBattleCasualties(a,ba,20);for(let i=0;i<20;i++)recordBattleCasualties(c,bc,1)
  finalizeBattleCasualties(a,ba);finalizeBattleCasualties(c,bc)
  assert.deepEqual(a.wounded,c.wounded);assert.equal(a.battleDeaths,c.battleDeaths)
})

test('伤员不占可编兵力但需要口粮，治疗后回到未编人员，招募不会突破总人数上限',()=>{
  const s=ready();wound(s,10,10);assert.equal(totalPersonnel(s),140);assert.equal(mealCost(s),14)
  startTreatment(s,'light',[1]);advanceFacilities(s,30,true,()=>1);assert.equal(s.troops,125);assert.equal(mealCost(s),14)
  const capped=freshSave();capped.troops=9999995;capped.wounded.light=5;donateFood(capped,'coins',10)
  assert.equal(advanceLogistics(capped,10).recruited,0);assert.equal(capped.mobilizationCoins,10)
})

test('无患者医疗部待命不白算进度，极度饥饿暂停工厂和医疗，供餐后继续',()=>{
  const s=ready();startProduction(s,[1],'rifle');startTreatment(s,'light',[2]);advanceFacilities(s,30,true,()=>1)
  assert.equal(s.armoryTasks.rifle.elapsed,30);assert.equal(s.medicalTasks.light.elapsed,0)
  wound(s,10,0);s.hungerDebt=3;s.cookedRice=0;advanceEconomy(s,60,()=>1)
  assert.equal(s.armoryTasks.rifle.elapsed,30);assert.equal(s.medicalTasks.light.elapsed,0)
  s.cookedRice=20;advanceEconomy(s,30,()=>1);assert.equal(s.productionTotals.rifle,1);assert.equal(s.wounded.light,5)
})

test('工厂、轻重医疗可并行，整段和逐秒结算一致，前台时钟准确保存',()=>{
  const a=ready();a.rice=1000;wound(a,20,4)
  startProduction(a,[1],'rifle');startTreatment(a,'light',[2]);startTreatment(a,'heavy',[3])
  const b=structuredClone(a);advanceEconomy(a,600,()=>1);for(let i=0;i<600;i++)advanceEconomy(b,1,()=>1)
  assert.deepEqual(a,b);assert.equal(a.productionTotals.rifle,10);assert.equal(a.recoveredTroops,22)
  assert.deepEqual(a.heavyTreatmentStages,[0,0,2]);assert.deepEqual(normalizeSave(a),a)
})

test('保存恢复拒绝任务共享部队、错误人数、下属ID、越界计时，不重复占用或伪造伤员',()=>{
  const s=ready();startProduction(s,[1],'rifle');wound(s,5,4);startTreatment(s,'heavy',[2]);advanceFacilities(s,125,true,()=>1)
  const raw=structuredClone(s);raw.medicalTasks.light={unitIds:[1],workers:10,elapsed:10,ward:'light'}
  const restored=normalizeSave(raw);assert(restored.armoryTasks.rifle);assert.equal(restored.medicalTasks.light,null);assert(restored.medicalTasks.heavy)
  const task=raw.armoryTasks.rifle
  for(const invalid of [{...task,workers:99},{...task,elapsed:60},{...task,unitIds:[1,1]}])assert.equal(normalizeSave({...s,armoryTasks:{rifle:invalid}}).armoryTasks.rifle,undefined)
  const bad=normalizeSave({troops:9999999,wounded:{light:20,heavy:40},heavyTreatmentStages:[100,-1,NaN]})
  assert.deepEqual(bad.wounded,{light:1,heavy:0});assert.deepEqual(bad.heavyTreatmentStages,[0,0,0])
})

test('工厂、医疗、耕作、出战与训练互斥，其他空闲部队仍能工作，归队后释放',()=>{
  const s=ready();startFarming(s,'help',0,'rice',[1]);assert.equal(startProduction(s,[1],'rifle').ok,false)
  startTreatment(s,'light',[2]);assert.equal(startTreatment(s,'heavy',[2]).ok,false);assert.equal(startProduction(s,[2],'pistol').ok,false)
  const g=game(s);g.start('campaign',1,[3]);assert.equal(startTreatment(s,'heavy',[3]).ok,false)
  assert(startProduction(s,[4],'pistol').ok);assert.equal(campaignDeployment(s,[4]).ok,false)
  assert(recallFacility(s,'light'));assert.equal(formationActivity(s,2),null);assert(startTreatment(s,'heavy',[2]).ok)
  cancelFarming(s);assert(startProduction(s,[1],'rifle').ok)
})

test('新增金币赠送、生产、医疗派驻和召回界面可操作，按钮不超出面板，旧战斗按钮消失',()=>{
  const s=ready(),g=game(s);let saves=0;g.persist=()=>{saves++}
  assert(setFormation(s,'squad',7).ok);assert(stationTroops(s,1,[5]).ok)
  g.open('recruitment');draw(g);click(g,'recruit-food-coins');draw(g);click(g,'recruit-confirm')
  assert.equal(s.mobilizationCoins,20);assert.equal(s.coins,980)
  g.openWorldMap();g.open('base-armory');draw(g);click(g,'factory-product-pistol');click(g,'facility-unit-1');draw(g);click(g,'facility-start')
  assert.equal(s.armoryTasks.pistol.product,'pistol');draw(g);click(g,'facility-recall');assert.deepEqual(s.armoryTasks,{})
  wound(s,10,2);g.open('base-medical');draw(g);click(g,'medical-ward-heavy');draw(g);click(g,'facility-unit-2');draw(g);click(g,'facility-start')
  assert.deepEqual(s.medicalTasks.heavy.unitIds,[2]);draw(g);click(g,'facility-recall');assert.equal(s.medicalTasks.heavy,null)
  g.start('campaign',1,[1]);g.buttons=[];g.drawCampaignRoster();assert.equal(g.buttons.some(b=>['heal','strike'].includes(b.id)),false)
  g.open('pause');draw(g);assert.equal(g.buttons.some(b=>b.id==='battle-kitchen'),false)
  assert.equal(typeof g.useArtillery,'undefined');assert.equal(typeof g.useMedical,'undefined');assert(saves>=5)
})

test('本村驻军分出的下级部队可派往本村兵工厂和医疗部（含部分派遣与刷新恢复）',()=>{
  const s=freshSave();s.coins=1000;s.cookedRice=1000;assert(setFormation(s,'platoon',40).ok)
  assert(stationTroops(s,2,[1]).ok)
  const squad=splitGarrisonUnit(s,1,'squad',10).unit
  assert(placeVillageFacility(s,'armory',2).ok)
  const g=game(s);g.localVillage=2;g.open('base-armory');draw(g)
  assert(g.buttons.some(b=>b.id==='facility-unit-'+squad.id))
  click(g,'facility-unit-'+squad.id);draw(g);click(g,'facility-start')
  assert.deepEqual(s.armoryTasks.rifle.unitIds,[squad.id])
  const restored=normalizeSave(structuredClone(s));assert.deepEqual(restored.armoryTasks.rifle.unitIds,[squad.id])
  g.open('village');g.villageId=2;const labels=[];g.ctx.fillText=v=>labels.push(String(v));draw(g)
  assert(labels.includes('1排-1班'));assert(labels.includes('军械生产中'))
  assert(recallFacility(s,'rifle'));assert.equal(formationActivity(s,squad.id),null)
  assert(placeVillageFacility(s,'medical',3).ok);assert.equal(startTreatment(s,'light',[squad.id],3).ok,false)
  assert(placeVillageFacility(s,'armory',1).ok)
  assert(placeVillageFacility(s,'medical',2).ok)
  g.localVillage=2;g.open('base-medical');draw(g)
  assert(g.buttons.some(b=>b.id==='facility-unit-'+squad.id))
  click(g,'facility-detach');draw(g)
  assert(g.buttons.some(b=>b.id==='work-root-'+squad.id))
  assert(startTreatment(s,'light',[squad.id],2,[{unitId:squad.id,troops:4,type:'group'}]).ok)
  assert.deepEqual(normalizeSave(structuredClone(s)).medicalTasks.light.unitIds,[squad.id])
})

test('分别结束连队两个排的生产时，各自从工厂驻地返回连队所在据点待命',()=>{
  const s=ready(0),g=game(s),site=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert(setFormation(s,'company',120).ok);assert(occupyRegion(s,site.id,[1]).ok)
  const first=splitGarrisonUnit(s,1,'platoon',30).unit,second=splitGarrisonUnit(s,1,'platoon',30).unit
  assert(stationTroops(s,2,[first.id,second.id]).ok);assert(placeVillageFacility(s,'armory',2).ok)
  assert(startProduction(s,[first.id],'rifle').ok);assert(startProduction(s,[second.id],'pistol').ok)
  advanceFacilities(s,60);const stock=structuredClone(s.weaponCounts)
  g.localVillage=2;g.open('base-armory');draw(g);click(g,'facility-recall')
  assert.equal(marchOrigin(s,first.id),site.id);assert.deepEqual(s.garrisons[2],[second.id]);assert(s.armoryTasks.pistol)
  draw(g);click(g,'factory-product-pistol');draw(g);click(g,'facility-recall')
  assert.equal(s.garrisons[2],undefined);assert.equal(marchOrigin(s,second.id),site.id)
  assert.deepEqual(regionLocalUnits(s,site.id).map(unit=>unit.id),[1,first.id,second.id])
  assert.equal(baseForces(s).troops,0);assert.equal(s.formations[0].troops,60)
  assert.deepEqual(s.weaponCounts,stock);assert.deepEqual(normalizeSave(s),s)
})

test('连队正在转驻时，结束生产的分队先在工厂所在地待命，连队抵达后同步归队',()=>{
  let s=ready(0);assert(setFormation(s,'company',120).ok);assert(stationTroops(s,1,[1]).ok)
  const branch=splitGarrisonUnit(s,1,'platoon',30).unit
  assert(stationTroops(s,2,[branch.id]).ok);assert(placeVillageFacility(s,'armory',2).ok)
  assert(startProduction(s,[branch.id],'rifle').ok)
  assert(startGarrisonTransfer(s,1,1,3).ok)
  assert(recallFacility(s,'rifle'));assert.equal(marchOrigin(s,branch.id),2);assert.equal(s.garrisons[2],undefined)
  s=normalizeSave(s);assert.equal(marchOrigin(s,branch.id),2)
  assert.equal(advanceMarches(s,10000).length,1)
  assert.deepEqual(s.garrisons[3],[1]);assert.equal(marchOrigin(s,branch.id),3)
})
