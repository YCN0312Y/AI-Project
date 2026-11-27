import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation,mergeFormations,unmergeFormation,removeFormation,reinforceFormation,splitGarrisonUnit,baseForces} from '../js/state.js'
import {donateFood,advanceLogistics,recruitmentInterval,validateDonation} from '../js/logistics.js'
import {startProduction,recallFacility,advanceFacilities} from '../js/facilities.js'
import {formationActivity,startFarming,cancelFarming} from '../js/base.js'
import {advanceEconomy} from '../js/economy.js'
import {campaignDeployment} from '../js/campaign.js'
import {Game} from '../js/game.js'
import {stationTroops,placeVillageFacility} from '../js/villages.js'
import {availableWorkforce} from '../js/workforce.js'
import {MAP_REGIONS} from '../js/world-map.js'
import {occupyRegion,regionLocalUnits} from '../js/regions.js'
import {startGarrisonTransfer,advanceMarches,marchOrigin} from '../js/marching.js'

function ready(count=4,troops=10){
  const s=freshSave();s.coins=1000;s.cookedRice=1000;s.materials.ore=200;s.materials.wood=200
  for(let i=0;i<count;i++)assert(setFormation(s,'squad',troops).ok)
  return s
}
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

test('工厂每分钟按10人步枪、5人手枪、3人手雷和2人子弹生产，产出不占商城限额',()=>{
  for(const [product,amount] of [['rifle',1],['pistol',2],['grenades',3],['bullets',5]]){
    const s=ready(),before=structuredClone(s.shopStock),coins=s.coins
    const stock=['rifle','pistol'].includes(product)?s.weaponCounts:s,initial=stock[product]
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
  assert(['步枪','手枪','手雷','子弹','已派 1 支'].every(name=>labels.includes(name)))
  assert.deepEqual(advanceFacilities(s,16).produced,[{product:'rifle',amount:1}])
  assert.equal(s.armoryTasks.pistol.elapsed,16);assert.equal(s.armoryTasks.grenades.elapsed,16)
  assert.deepEqual(normalizeSave(s),s)
  click(g,'facility-recall');assert.equal(s.armoryTasks.grenades,undefined)
  assert.equal(formationActivity(s,3),'garrison');assert.equal(placeVillageFacility(s,'armory',2).ok,false)
  assert.deepEqual(advanceFacilities(s,44).produced,[{product:'pistol',amount:2}])
})

test('在运行产线追加整编和分队超过五支，保留原进度和本轮产量',()=>{
  const s=ready(6),g=game(s)
  assert(stationTroops(s,1,[1,2,3,4,5,6]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  g.openVillage(1);draw(g);click(g,'village-armory');draw(g)
  click(g,'facility-unit-1');draw(g);click(g,'facility-start');draw(g)
  advanceFacilities(s,40)
  assert(startProduction(s,[2],'rifle',1,[{unitId:2,troops:5,type:'group'}]).ok)
  draw(g);click(g,'facility-add');draw(g)
  click(g,'facility-unit-3');click(g,'facility-next');draw(g)
  click(g,'facility-unit-4');click(g,'facility-unit-5');click(g,'facility-unit-6');draw(g)
  assert.deepEqual(g.facilitySelected,[3,4,5,6])
  click(g,'facility-start');draw(g)
  assert(g.buttons.some(button=>button.id==='facility-add'))
  assert.equal(startProduction(s,[6],'rifle',1).ok,false)
  assert.equal(availableWorkforce(s,2),5);assert.equal(availableWorkforce(s,6),0)
  const restored=normalizeSave(s);assert.deepEqual(restored,s)
  assert.deepEqual(restored.armoryTasks.rifle.unitIds,[1,2,3,4,5,6])
  assert.deepEqual(advanceFacilities(restored,20).produced,[{product:'rifle',amount:1}])
  assert.deepEqual(advanceFacilities(restored,60).produced,[{product:'rifle',amount:5}])
  assert(recallFacility(restored,'rifle'));assert.equal(availableWorkforce(restored,2),10)
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

test('通用子弹可与现有产线并行，多支部队同线生产，产出计入共享库存',()=>{
  const s=ready(3),g=game(s),labels=[];g.ctx.fillText=value=>labels.push(String(value))
  s.materials.ore=200
  assert(startProduction(s,[1],'rifle').ok)
  g.open('base-armory');draw(g);click(g,'factory-product-bullets');draw(g)
  click(g,'facility-unit-2');draw(g);click(g,'facility-start');draw(g)
  click(g,'facility-add');draw(g);click(g,'facility-unit-3');draw(g);click(g,'facility-start')
  assert.deepEqual(s.armoryTasks.bullets.unitIds,[2,3])
  assert.deepEqual(normalizeSave(s),s)
  assert.deepEqual(advanceFacilities(s,59).produced,[])
  assert.deepEqual(advanceFacilities(s,1).produced,[{product:'rifle',amount:1},{product:'bullets',amount:10}])
  assert.equal(s.bullets,10)
  advanceFacilities(s,240)
  assert.equal(s.bullets,50);assert.equal(s.productionTotals.rifle,5);assert.equal(s.materials.ore,145)
  assert.equal(s.weaponCounts.bullets,undefined);assert.equal(s.productionTotals.bullets,50)
  g.open('warehouse');g.inventoryTab='ammo';labels.length=0;draw(g)
  assert.deepEqual(labels.filter(label=>label.endsWith('子弹')),['子弹'])
})

test('旧弹药工单保留进度，两名人员每轮产一发，矿石余量刷新后继续使用',()=>{
  const s=ready(1),work=[{unitId:1,troops:2,type:'group'}]
  assert(stationTroops(s,1,[1]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  assert(startProduction(s,[1],'bullets',1,work).ok)
  const old=structuredClone(s);delete old.armoryClockVersion;delete old.bulletOreCredit;old.materials.ore=1
  old.armoryTasks={rifleAmmo:{...old.armoryTasks.bullets,product:'rifleAmmo',elapsed:225}}
  const restored=normalizeSave(old)
  assert.equal(restored.armoryTasks.bullets.elapsed,45);assert.deepEqual(normalizeSave(restored),restored)
  advanceFacilities(restored,14);assert.equal(restored.bullets,0)
  advanceFacilities(restored,1);assert.equal(restored.bullets,1);assert.equal(restored.materials.ore,0)
  const reloaded=normalizeSave(restored);assert.deepEqual(reloaded,restored)
  advanceFacilities(reloaded,540);assert.equal(reloaded.bullets,10);assert.equal(reloaded.bulletOreCredit,0)
  assert.deepEqual(advanceFacilities(reloaded,60).produced,[])
})

test('子弹按人数可超过旧每分钟100发的上限',()=>{
  const s=freshSave();s.troops=240;s.materials.ore=20
  for(let i=0;i<6;i++)assert(setFormation(s,'platoon',40,null,{}).ok)
  assert(startProduction(s,s.formations.map(unit=>unit.id),'bullets').ok)
  assert.deepEqual(advanceFacilities(s,60).produced,[{product:'bullets',amount:120}])
  assert.equal(s.materials.ore,8);assert.equal(s.bullets,120)
})

test('旧版武器工单按比例迁移，已是一分钟的弹药工单不再次缩短',()=>{
  const s=ready(2)
  assert(startProduction(s,[1],'rifle').ok);assert(startProduction(s,[2],'bullets').ok)
  s.armoryClockVersion=1;s.armoryTasks.rifle.elapsed=225
  s.armoryTasks.pistolAmmo={...s.armoryTasks.bullets,product:'pistolAmmo',elapsed:45};delete s.armoryTasks.bullets
  const restored=normalizeSave(s)
  assert.equal(restored.armoryTasks.rifle.elapsed,45);assert.equal(restored.armoryTasks.bullets.elapsed,45)
  assert.deepEqual(normalizeSave(restored),restored)
  assert.deepEqual(advanceFacilities(restored,15).produced,[{product:'rifle',amount:1},{product:'bullets',amount:5}])
})

test('旧版并行弹药工单保留派驻人数、产量记录与最接近完成的本轮进度',()=>{
  const s=ready(2)
  assert(stationTroops(s,1,[1,2]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  const crew=(unitId,troops)=>({unitId,troops,type:'group'})
  s.armoryTasks={
    rifleAmmo:{product:'rifleAmmo',unitIds:[1],workers:3,elapsed:18,villageId:1,allocations:[crew(1,3)]},
    machinegunAmmo:{product:'machinegunAmmo',unitIds:[1,2],workers:5,elapsed:45,villageId:1,allocations:[crew(1,2),crew(2,3)]}
  }
  s.productionTotals={rifleAmmo:130,pistolAmmo:10,machinegunAmmo:85}
  const restored=normalizeSave(s)
  assert.deepEqual(restored.armoryTasks,{bullets:{product:'bullets',unitIds:[1,2],workers:8,elapsed:45,villageId:1,allocations:[crew(1,5),crew(2,3)]}})
  assert.equal(restored.productionTotals.bullets,225)
  assert.deepEqual(normalizeSave(restored),restored)
  assert.deepEqual(advanceFacilities(restored,15).produced,[{product:'bullets',amount:4}])
  assert.equal(restored.bullets,4);assert.equal(restored.productionTotals.bullets,229)
})

test('同一驻军可分派不同人员并行生产，超派被拒绝，撤一项只释放该项人员',()=>{
  const s=freshSave(),allocation=troops=>[{unitId:1,troops,type:'group'}]
  assert(setFormation(s,'platoon',25).ok);s.materials.ore=200;s.materials.wood=200
  assert(stationTroops(s,1,[1]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  assert(startProduction(s,[1],'rifle',1,allocation(10)).ok)
  assert(startProduction(s,[1],'pistol',1,allocation(5)).ok)
  assert.equal(startProduction(s,[1],'grenades',1,allocation(11)).ok,false)
  assert.equal(availableWorkforce(s,1),10);assert.deepEqual(normalizeSave(s),s)
  assert(recallFacility(s,'pistol'));assert.equal(availableWorkforce(s,1),15)
  assert(startProduction(s,[1],'grenades',1,allocation(3)).ok);assert.equal(availableWorkforce(s,1),12)
  assert.deepEqual(advanceFacilities(s,60).produced,[{product:'rifle',amount:1},{product:'grenades',amount:1}])
})

test('工厂可派无枪编制及合编，多选按总人数生产，占用全部下属且不能重复派工',()=>{
  const s=ready();for(const unit of s.formations)unit.weapons={rifle:0,pistol:0,machinegun:0,sniper:0,mortar:0}
  const root=mergeFormations(s,[1,2,3]).unit
  assert(startProduction(s,[root.id,4],'grenades').ok);assert.equal(s.armoryTasks.grenades.workers,40)
  assert.equal(formationActivity(s,1),'armory');assert.equal(formationActivity(s,root.id),'armory')
  assert.equal(advanceFacilities(s,300).produced[0].amount,13)
  assert.equal(startFarming(s,'help',0,'rice',[root.id]).ok,false)
  assert.equal(campaignDeployment(s,[root.id]).ok,false)
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

test('极度饥饿暂停生产，生产恢复沿用当前进度',()=>{
  const s=ready();assert(startProduction(s,[1],'rifle').ok)
  advanceFacilities(s,30);s.hungerDebt=3
  assert.deepEqual(advanceFacilities(s,60).produced,[]);assert.equal(s.armoryTasks.rifle.elapsed,30)
  s.hungerDebt=0;assert.equal(advanceFacilities(s,30).produced[0].amount,1)
})

test('恢复存档拒绝错误人数、重复名单和越界生产计时',()=>{
  const s=ready();assert(startProduction(s,[1],'rifle').ok);advanceFacilities(s,5)
  const task=s.armoryTasks.rifle
  for(const invalid of [{...task,workers:99},{...task,elapsed:60},{...task,unitIds:[1,1]}])assert.equal(normalizeSave({...s,armoryTasks:{rifle:invalid}}).armoryTasks.rifle,undefined)
  assert.deepEqual(normalizeSave(s),s)
})

test('工厂、耕作和出战互斥，其他空闲部队仍能工作',()=>{
  const s=ready()
  assert(startFarming(s,'help',0,'rice',[1]).ok);assert.equal(startProduction(s,[1],'rifle').ok,false)
  const g=game(s);g.start('campaign',1,[3]);assert.equal(startProduction(s,[3],'pistol').ok,false)
  assert(startProduction(s,[4],'pistol').ok);assert.equal(campaignDeployment(s,[4]).ok,false)
  assert(recallFacility(s,'pistol'));assert(campaignDeployment(s,[4]).ok)
  cancelFarming(s);assert(startProduction(s,[1],'rifle').ok)
})

test('金币赠送、生产派驻和召回界面可操作，按钮不超出面板，旧战斗按钮消失',()=>{
  const s=ready(),g=game(s);let saves=0;g.persist=()=>{saves++}
  assert(setFormation(s,'squad',7).ok);assert(stationTroops(s,1,[5]).ok)
  g.open('recruitment');draw(g);click(g,'recruit-food-coins');draw(g);click(g,'recruit-confirm')
  assert.equal(s.mobilizationCoins,20);assert.equal(s.coins,980)
  g.openWorldMap();g.open('base-armory');draw(g);click(g,'factory-product-pistol');click(g,'facility-unit-1');draw(g);click(g,'facility-start')
  assert.equal(s.armoryTasks.pistol.product,'pistol');draw(g);click(g,'facility-recall');assert.deepEqual(s.armoryTasks,{})
  g.start('campaign',1,[1]);g.buttons=[];g.drawCampaignRoster();assert.equal(g.buttons.some(b=>['heal','strike'].includes(b.id)),false)
  g.open('pause');draw(g);assert.equal(g.buttons.some(b=>b.id==='battle-kitchen'),false)
  assert.equal(typeof g.useArtillery,'undefined');assert.equal(typeof g.useMedical,'undefined');assert(saves>=3)
})

test('本村驻军分出的下级部队可派往本村兵工厂并从存档恢复',()=>{
  const s=freshSave();s.coins=1000;s.cookedRice=1000;assert(setFormation(s,'platoon',40).ok)
  assert(stationTroops(s,2,[1]).ok)
  const squad=splitGarrisonUnit(s,1,'squad',10).unit
  s.materials.ore=100;s.materials.wood=100
  assert(placeVillageFacility(s,'armory',2).ok)
  const g=game(s);g.localVillage=2;g.open('base-armory');draw(g)
  assert(g.buttons.some(b=>b.id==='facility-unit-'+squad.id))
  click(g,'facility-unit-'+squad.id);draw(g);click(g,'facility-start')
  assert.deepEqual(s.armoryTasks.rifle.unitIds,[squad.id])
  const restored=normalizeSave(structuredClone(s));assert.deepEqual(restored.armoryTasks.rifle.unitIds,[squad.id])
  g.open('village');g.villageId=2;const labels=[];g.ctx.fillText=v=>labels.push(String(v));draw(g)
  assert(labels.includes('1排-1班'));assert(labels.includes('军械生产中'))
  assert(recallFacility(s,'rifle'));assert.equal(formationActivity(s,squad.id),null)
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
