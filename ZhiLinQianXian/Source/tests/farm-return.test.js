import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,setFormation,normalizeSave,reinforceFormation} from '../js/state.js'
import {stationTroops,recallGarrison,villageOfFormation,evacuateVillage} from '../js/villages.js'
import {farmTaskAt,startFarming,cancelFarming,FARM,formationActivity} from '../js/base.js'
import {availableWorkforce} from '../js/workforce.js'
import {advanceEconomy} from '../js/economy.js'
import {MAP_FIELDS,mapLocation} from '../js/world-map.js'
import {farmTravelPosition,farmRouteLength,FARM_TRAVEL_SPEED} from '../js/farm-travel.js'
const field=MAP_FIELDS.find(f=>f.villageId===1)
function setup(){const s=freshSave();s.cookedRice=100;setFormation(s,'platoon',40);stationTroops(s,1,[1]);return s}
const begin=s=>startFarming(s,'help',0,field.crop,[1],field.id,[{unitId:1,troops:7,type:'squad'}])
const step=(s,seconds)=>advanceEconomy(s,seconds,()=>0)

test('本村分队从村出发，到田后才耕作，完工返回村并恢复原上级全部可派人数',()=>{
  const s=setup(),parent=structuredClone(s.formations[0]),guns=structuredClone(s.weaponCounts);assert(begin(s).ok)
  assert.equal(farmTaskAt(s,field.id).phase,'outbound');assert.deepEqual(farmTravelPosition(farmTaskAt(s,field.id)),{x:mapLocation(1).x,y:mapLocation(1).y});assert.equal(availableWorkforce(s,1),33)
  const travel=farmRouteLength(farmTaskAt(s,field.id))/FARM_TRAVEL_SPEED;step(s,travel);assert.equal(farmTaskAt(s,field.id).phase,'working');assert.equal(farmTaskAt(s,field.id).elapsed,0)
  step(s,FARM.duration);assert.equal(farmTaskAt(s,field.id).phase,'returning');assert.equal(s.helpedHarvests,7);assert.equal(availableWorkforce(s,1),33)
  assert.equal(recallGarrison(s,1,1).ok,false);step(s,travel/2);assert.equal(availableWorkforce(s,1),33)
  step(s,travel/2+.001);assert.equal(farmTaskAt(s,field.id),null);assert.equal(availableWorkforce(s,1),40);assert.equal(formationActivity(s,1),'garrison');assert.equal(villageOfFormation(s,1),1)
  assert.deepEqual(s.formations,[parent]);assert.deepEqual(s.weaponCounts,guns);assert.equal(s.troops,121)
  step(s,100);assert.equal(s.helpedHarvests,7)
})

test('30人代耕随机分到三种粮食，总共9份，返村刷新不重复发放',()=>{
  const s=setup(),rolls=[0,.5,.9];let index=0
  assert(startFarming(s,'help',0,field.crop,[1],field.id,[{unitId:1,troops:30,type:'group'}]).ok)
  const travel=farmRouteLength(farmTaskAt(s,field.id))/FARM_TRAVEL_SPEED
  step(s,travel+FARM.duration-1)
  assert.equal(s.millet+s.rice+s.corn,0)
  const result=advanceEconomy(s,1,()=>rolls[index++%rolls.length])
  assert.deepEqual(result.supplies,{millet:3,rice:3,corn:3})
  assert.equal(result.harvests[0].amount,9);assert.equal(s.farmHarvested,9)
  assert.equal(farmTaskAt(s,field.id).phase,'returning')
  const restored=normalizeSave(s);step(restored,travel+1)
  assert.equal(restored.millet+restored.rice+restored.corn,9);assert.equal(farmTaskAt(restored,field.id),null)
})

test('往返和耕作阶段刷新保留归属与进度，返村只合入一次且不补发奖励',()=>{
  let s=setup();begin(s);step(s,1);s=normalizeSave(s);assert.equal(farmTaskAt(s,field.id).phase,'outbound')
  step(s,3);assert.equal(farmTaskAt(s,field.id).phase,'working');assert.deepEqual(normalizeSave(s),s)
  step(s,59);assert.equal(farmTaskAt(s,field.id).phase,'returning');const before=structuredClone(s),loaded=normalizeSave(s);assert.deepEqual(loaded,before)
  step(loaded,10);assert.equal(farmTaskAt(loaded,field.id),null);assert.equal(loaded.helpedHarvests,7);assert.equal(loaded.formations.length,1);assert.equal(loaded.formations[0].troops,40)
})

test('途中和田间召回沿原路返村，途中人数不能提前另派，无完工奖励',()=>{
  for(const seconds of [0,1,10]){
    const s=setup();begin(s);step(s,seconds);const p=farmTravelPosition(farmTaskAt(s,field.id));assert(cancelFarming(s,field.id));assert.equal(farmTaskAt(s,field.id).phase,'returning');assert.deepEqual(farmTravelPosition(farmTaskAt(s,field.id)),p)
    assert.equal(availableWorkforce(s,1),33);assert.equal(cancelFarming(s,field.id),false);assert.deepEqual(normalizeSave(s),s)
    step(s,10);assert.equal(farmTaskAt(s,field.id),null);assert.equal(s.helpedHarvests,0);assert.equal(availableWorkforce(s,1),40)
  }
})

test('旧本村代耕任务迁移为田间耕作并返村，整段与逐秒推进结果一致',()=>{
  const s=setup();begin(s);s.farmTask=farmTaskAt(s,field.id);delete s.fieldFarmTasks
  delete s.farmTask.phase;delete s.farmTask.route;delete s.farmTask.travelled;s.farmTask.elapsed=59
  const loaded=normalizeSave(s);assert.equal(farmTaskAt(loaded,field.id).phase,'working');assert.equal(farmTaskAt(loaded,field.id).elapsed,59)
  step(loaded,1);assert.equal(farmTaskAt(loaded,field.id).phase,'returning');step(loaded,10);assert.equal(availableWorkforce(loaded,1),40)
  const a=setup();begin(a);const b=structuredClone(a);step(a,70);for(let i=0;i<70;i++)step(b,1)
  for(const key of ['mealElapsed','populationClock']){
    assert(Math.abs(a[key]-b[key])<1e-8);a[key]=b[key]
  }
  assert(Math.abs(a.fieldCooldowns[field.id]-b.fieldCooldowns[field.id])<1e-8)
  a.fieldCooldowns[field.id]=b.fieldCooldowns[field.id]
  assert.deepEqual(a,b)
})

test('多块田独立结算收成、休耕和返村，单村撤离只结束本村任务',()=>{
  const s=setup(),second=MAP_FIELDS.find(field=>field.villageId===2)
  assert(setFormation(s,'squad',10).ok);assert(stationTroops(s,second.villageId,[2]).ok)
  assert(begin(s).ok);assert(startFarming(s,'help',0,second.crop,[2],second.id).ok)
  assert.equal(begin(s).ok,false)
  const loaded=normalizeSave(s);assert.deepEqual(loaded,s)
  const evacuated=normalizeSave(s);evacuateVillage(evacuated,1)
  assert.equal(farmTaskAt(evacuated,field.id),null);assert.equal(formationActivity(evacuated,2),'farm')
  const result=step(loaded,80)
  assert.deepEqual(result.harvests.map(harvest=>[harvest.fieldId,harvest.amount]).sort(),[[field.id,2],[second.id,3]].sort())
  assert.deepEqual(result.returnedFarms.map(task=>task.villageId).sort(),[1,2])
  assert.equal(loaded.farmHarvested,5);assert(loaded.fieldCooldowns[field.id]>0);assert(loaded.fieldCooldowns[second.id]>0)
  assert.equal(formationActivity(loaded,1),'garrison');assert.equal(formationActivity(loaded,2),'garrison')
  assert(!step(loaded,30).harvests.length)
})

test('极饿会暂停田间耕作，但不会把已经完成的返程困住',()=>{
  const s=setup();begin(s);step(s,63);assert.equal(farmTaskAt(s,field.id).phase,'returning');s.cookedRice=0;s.hungerDebt=3
  step(s,10);assert.equal(farmTaskAt(s,field.id),null);assert.equal(availableWorkforce(s,1),40)
})

test('本村代耕返程时不可修改原编制，归队后可直接补员并保持驻防',()=>{
  const s=freshSave();s.cookedRice=100;assert(setFormation(s,'platoon',35).ok);assert(stationTroops(s,1,[1]).ok)
  assert(begin(s).ok);step(s,63);assert.equal(farmTaskAt(s,field.id).phase,'returning')
  assert.equal(reinforceFormation(s,1,2).ok,false);assert.equal(s.formations[0].troops,35)
  step(s,10);assert(reinforceFormation(s,1,2).ok);assert.equal(s.formations[0].troops,37);assert.equal(villageOfFormation(s,1),1)
})
