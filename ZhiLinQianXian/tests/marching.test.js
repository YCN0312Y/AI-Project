import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,setFormation,normalizeSave,removeFormation,mergeFormations} from '../js/state.js'
import {MAP_BASE,MAP_SITES,MAP_FIELDS,MAP_REGIONS,MAP_ROADS,MAP_REGION_ROADS,fitCamera} from '../js/world-map.js'
import {startMarch,startGarrisonTransfer,advanceMarches,marchPosition,routeLength,normalizeMarches,MARCH_SPEED} from '../js/marching.js'
import {formationActivity,startFarming} from '../js/base.js'
import {villageUnits,stationTroops} from '../js/villages.js'
import {occupyRegion,regionUnits,regionOwner} from '../js/regions.js'
import {startGathering} from '../js/gathering.js'
import {Game} from '../js/game.js'

const setup=()=>{const s=freshSave();for(let i=0;i<6;i++)assert(setFormation(s,'squad',10).ok);s.cookedRice=100;return s}
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a}/${b}`)
function game(s=setup()){
  const g=Object.create(Game.prototype);Object.assign(g,{save:s,scene:'world-map',modal:null,buttons:[],notify(message){this.message=message},persist(){this.saved=structuredClone(this.save)}})
  g.ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});g.openWorldMap();return g
}

test('原中心改成普通路网节点，分散的六村保有田地和各自道路',()=>{
  for(const site of MAP_SITES){
    const field=MAP_FIELDS.find(f=>f.villageId===site.id);assert(field);assert(Math.hypot(field.x-site.x,field.y-site.y)<450)
    assert([...MAP_ROADS,...MAP_REGION_ROADS].some(r=>r.from===site.id||r.to===site.id))
  }
  const homeRoads=MAP_ROADS.filter(r=>r.from===MAP_BASE.roadId||r.to===MAP_BASE.roadId)
  assert(homeRoads.length>0&&homeRoads.length<MAP_SITES.length)
})

test('派驻先生成行军而非瞬移，沿路移动，到达一次性销毁Actor并驻军，不复制兵力枪械',()=>{
  const s=setup(),before=structuredClone(s),r=startMarch(s,'village',1,[1,2]);assert(r.ok)
  assert.equal(villageUnits(s,1).length,0);assert.deepEqual(marchPosition(r.order),{x:1600,y:950})
  assert.equal(formationActivity(s,1),'march');assert.equal(removeFormation(s,1),false);assert.equal(startMarch(s,'village',2,[1]).ok,false)
  assert.equal(startFarming(s,'help',0,'millet',[1]).ok,false);assert.equal(mergeFormations(s,[1,2,3]).ok,false)
  advanceMarches(s,1);near(r.order.travelled,MARCH_SPEED);assert.notDeepEqual(marchPosition(r.order),{x:1600,y:950});assert.equal(villageUnits(s,1).length,0)
  assert.equal(advanceMarches(s,10000).length,1);assert.equal(s.marchingOrders.length,0);assert.equal(villageUnits(s,1).length,2)
  assert.equal(formationActivity(s,1),'garrison');assert.equal(advanceMarches(s,10000).length,0)
  assert.equal(s.troops,before.troops);assert.deepEqual(s.weaponCounts,before.weaponCounts);assert.deepEqual(s.formations,before.formations)
})

test('刷新保存路线和途中进度，无离线推进，合法状态恢复后继续行军',()=>{
  const s=setup();assert(startMarch(s,'village',2,[1]).ok);advanceMarches(s,2.5)
  const p=marchPosition(s.marchingOrders[0]),loaded=normalizeSave(structuredClone(s));assert.deepEqual(loaded,s);assert.deepEqual(marchPosition(loaded.marchingOrders[0]),p)
  assert.equal(formationActivity(loaded,1),'march');advanceMarches(loaded,1);assert.notDeepEqual(marchPosition(loaded.marchingOrders[0]),p)
  for(const seconds of [NaN,-1,0]){const before=structuredClone(loaded);advanceMarches(loaded,seconds);assert.deepEqual(loaded,before)}
  advanceMarches(loaded,10000);assert.equal(villageUnits(loaded,2).length,1)
})

test('驻军可从村庄直达其他据点再转驻其他村庄，刷新继续原路，不复制兵力武器',()=>{
  const s=setup(),site=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert(stationTroops(s,1,[1,2]).ok);assert(occupyRegion(s,site.id,[3]).ok)
  const before=structuredClone(s),source=MAP_SITES[0]
  const result=startGarrisonTransfer(s,1,source.id,site.id)
  assert(result.ok,result.message);assert.deepEqual(marchPosition(result.order),{x:source.x,y:source.y})
  assert.deepEqual(s.garrisons[source.id],[2]);assert.deepEqual(regionUnits(s,site.id).map(unit=>unit.id),[3])
  assert.equal(formationActivity(s,1),'march')
  assert.equal(startGarrisonTransfer(s,1,source.id,site.id).ok,false)
  advanceMarches(s,1)
  const loaded=normalizeSave(s);assert.deepEqual(loaded,s)
  assert.equal(advanceMarches(loaded,10000).length,1)
  assert.equal(advanceMarches(loaded,10000).length,0)
  assert.deepEqual(regionUnits(loaded,site.id).map(unit=>unit.id),[1,3])
  const onward=startGarrisonTransfer(loaded,1,site.id,2)
  assert(onward.ok);assert.deepEqual(marchPosition(onward.order),{x:site.x,y:site.y})
  advanceMarches(loaded,10000)
  assert.deepEqual(loaded.garrisons[2],[1]);assert.deepEqual(regionUnits(loaded,site.id).map(unit=>unit.id),[3])
  assert.equal(loaded.troops,before.troops);assert.deepEqual(loaded.weaponCounts,before.weaponCounts);assert.deepEqual(loaded.formations,before.formations)
})

test('转驻拒绝正在工作的驻军、原地和过期来源，失败时保留原驻防',()=>{
  const s=setup(),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert(occupyRegion(s,mountain.id,[1]).ok)
  const before=structuredClone(s)
  assert.match(startGarrisonTransfer(s,1,mountain.id,mountain.id).message,/另一处/)
  assert.match(startGarrisonTransfer(s,1,1,2).message,/原驻地/)
  assert.deepEqual(s,before)
  assert(startGathering(s,mountain.id,[1],'ore').ok)
  const working=structuredClone(s)
  assert.match(startGarrisonTransfer(s,1,mountain.id,2).message,/采集中/)
  assert.deepEqual(s,working)
})

test('空地允许无枪行军，同目标多次到达会增援，合编下属途中不可再次派遣',()=>{
  const s=setup(),target=MAP_REGIONS.find(v=>!v.enemyTroops),parent=mergeFormations(s,[1,2,3]).unit
  assert(startMarch(s,'region',target.id,[parent.id]).ok);for(const id of [parent.id,1,2,3])assert.equal(formationActivity(s,id),'march')
  assert(startMarch(s,'region',target.id,[4]).ok);advanceMarches(s,10000)
  assert.equal(regionUnits(s,target.id).length,2);assert.equal(regionOwner(s,target.id),'player')
  const loose=setup();loose.formations[0].weapons.rifle=0;assert(startMarch(loose,'village',1,[1]).ok);advanceMarches(loose,10000);assert.equal(villageUnits(loose,1)[0].weapons.rifle,0)
})

test('敌占目标到达前不进战场，抵达后自动进入原RTS且不提前改变归属',()=>{
  const g=game(),target=MAP_REGIONS.find(v=>v.enemyTroops)
  assert(stationTroops(g.save,1,[1]).ok)
  g.openGarrisonTransfer(1,1);g.selectGarrisonTransferTarget(target.id)
  assert.equal(g.modal,'garrison-transfer');assert.deepEqual(g.save.garrisons[1],[1])
  g.drawGarrisonTransfer();g.buttons.find(button=>button.id==='transfer-confirm').fn()
  assert.equal(g.scene,'world-map');assert.equal(g.battle,undefined);assert.equal(regionOwner(g.save,target.id),'enemy')
  assert.equal(g.save.garrisons[1],undefined)
  assert.deepEqual(marchPosition(g.save.marchingOrders[0]),{x:MAP_SITES[0].x,y:MAP_SITES[0].y})
  g.save=normalizeSave(g.save)
  g.updateMapMarches(.5);assert.equal(g.battle,undefined)
  g.updateMapMarches(10000);assert.equal(g.scene,'battle');assert.equal(g.battle.regionId,target.id);assert.equal(g.save.marchingOrders.length,0)
  assert.equal(formationActivity(g.save,1),'battle')
  g.battle.done=true;g.battle.won=true;g.finish()
  assert.deepEqual(regionUnits(g.save,target.id).map(unit=>unit.id),[1])
})

test('抵达时有其他战斗或编辑窗口则等待，不覆盖当前战场，关闭窗口后接战',()=>{
  const g=game(),target=MAP_REGIONS.find(v=>v.enemyTroops);g.dispatchRegion(target.id,[1]);g.modal='formation-edit'
  g.updateMapMarches(10000);assert.equal(g.modal,'formation-edit');assert.equal(g.battle,undefined);assert.equal(g.save.marchingOrders[0].status,'awaiting-battle')
  const loaded=normalizeSave(g.save);assert.equal(formationActivity(loaded,1),'march')
  g.modal=null;g.scene='battle';g.battle={done:false};const current=g.battle;g.updateMapMarches(1);assert.equal(g.battle,current)
  g.scene='world-map';g.updateMapMarches(0);assert.notEqual(g.battle,current);assert.equal(g.battle.regionId,target.id)
})

function convergeOnEnemy(){
  const g=game(),s=g.save,target=MAP_REGIONS.find(site=>site.enemyTroops)
  assert(stationTroops(s,1,[1]).ok);assert(stationTroops(s,5,[2]).ok)
  g.dispatchRegion(target.id,[1,2]);assert.equal(s.marchingOrders.length,2)
  const [near,far]=[...s.marchingOrders].sort((a,b)=>routeLength(a.route)-routeLength(b.route))
  assert(routeLength(far.route)>routeLength(near.route))
  g.updateMapMarches(routeLength(near.route)/MARCH_SPEED)
  assert.equal(g.modal,'march-attack');assert.equal(g.battle,undefined)
  assert.equal(near.status,'awaiting-battle');assert.equal(far.status,'moving')
  g.drawModal()
  return {g,target,firstId:near.unitIds[0],laterId:far.unitIds[0]}
}

test('近队抵达后可等待，刷新保留集结选择，到齐后全部出战',()=>{
  const {g,target,firstId,laterId}=convergeOnEnemy()
  g.buttons.find(button=>button.id==='march-attack-wait').fn()
  assert.equal(g.modal,null);assert.equal(formationActivity(g.save,firstId),'march')
  assert.equal(g.saved.marchingOrders.find(order=>order.unitIds.includes(firstId)).waitForAll,true)
  const restored=game(normalizeSave(g.saved))
  restored.updateMapMarches(0);assert.equal(restored.modal,null);assert.equal(restored.battle,undefined)
  restored.updateMapMarches(10000)
  assert.equal(restored.battle.regionId,target.id)
  assert.deepEqual(restored.battle.units.map(unit=>unit.id).sort(),[firstId,laterId].sort())
  assert.equal(restored.battle.maxHp,20);assert.deepEqual(restored.save.marchingOrders,[])
})

test('近队可立即开战，远队抵达时加入原战场并随幸存部队驻防',()=>{
  const {g,target,firstId,laterId}=convergeOnEnemy()
  g.buttons.find(button=>button.id==='march-attack-now').fn()
  const s=g.save,battle=g.battle
  assert.deepEqual(battle.units.map(unit=>unit.id),[firstId]);assert.equal(formationActivity(s,laterId),'march')
  battle.units[0].hp=7;battle.time=6;battle.selectUnit(firstId)
  const enemyQueue=battle.regionEnemyQueue
  g.updateMapMarches(10000);g.updateMapMarches(0)
  assert.equal(g.battle,battle);assert.equal(battle.regionEnemyQueue,enemyQueue)
  assert.equal(battle.time,6);assert.equal(battle.selectedUnitId,firstId)
  assert.deepEqual(battle.units.map(unit=>[unit.id,unit.hp]),[[firstId,7],[laterId,10]])
  assert.deepEqual(battle.regionDeployedIds,[firstId,laterId]);assert.equal(formationActivity(s,laterId),'battle')
  assert.equal(battle.hp,17);assert.equal(battle.maxHp,20);assert.equal(battle.armedTroops,20)
  assert.deepEqual(s.marchingOrders,[])
  battle.units[1].hp=8;battle.done=true;battle.won=true;g.finish()
  assert.equal(g.result.lostTroops,5);assert.equal(s.troops,115);assert.equal(s.weaponCounts.rifle,115)
  assert.deepEqual(regionUnits(s,target.id).map(unit=>unit.id).sort(),[firstId,laterId].sort())
})

test('先到部队在援军抵达前已占领目标时，援军到达后直接驻防',()=>{
  const {g,target,firstId,laterId}=convergeOnEnemy()
  g.buttons.find(button=>button.id==='march-attack-now').fn()
  g.battle.done=true;g.battle.won=true;g.finish()
  g.updateMapMarches(10000)
  assert.deepEqual(regionUnits(g.save,target.id).map(unit=>unit.id).sort(),[firstId,laterId].sort())
  assert.deepEqual(g.save.marchingOrders,[])
  assert.equal(g.modal,'result')
})

test('每个行军根编制复用战斗Actor绘制，抵达后不再绘制，缩放不改变实际进度',()=>{
  const g=game(),actors=[];g.drawTacticalUnit=unit=>actors.push(unit)
  assert(startMarch(g.save,'village',1,[1,2]).ok);g.drawMapMarches();assert.equal(actors.length,2);assert.equal(actors[0].hp,10)
  const p=marchPosition(g.save.marchingOrders[0]);fitCamera(g.mapCamera);actors.length=0;g.drawMapMarches();assert.deepEqual(marchPosition(g.save.marchingOrders[0]),p)
  g.updateMapMarches(10000);actors.length=0;g.drawMapMarches();assert.equal(actors.length,0)
})

test('非法和跨任务行军记录不会复制人员，饥饿降低行军速度但不会禁止出发',()=>{
  const s=setup();s.hungerDebt=3;assert(startMarch(s,'village',1,[1]).ok);advanceMarches(s,1);near(s.marchingOrders[0].travelled,MARCH_SPEED*.7)
  const bad=structuredClone(s);bad.marchingOrders.push({...structuredClone(bad.marchingOrders[0]),id:2})
  bad.marchingOrders.push({...structuredClone(bad.marchingOrders[0]),id:3,targetId:999})
  assert.equal(normalizeSave(bad).marchingOrders.length,1)
  const occupied=setup();stationTroops(occupied,1,[1]);normalizeMarches(occupied,s);assert.equal(occupied.marchingOrders.length,0)
  near(routeLength([{x:0,y:0},{x:3,y:4}]),5)
})
