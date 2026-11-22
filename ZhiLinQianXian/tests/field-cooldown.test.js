import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,setFormation,normalizeSave,splitGarrisonUnit} from '../js/state.js'
import {stationTroops} from '../js/villages.js'
import {farmTaskAt,startFarming,FARM,FIELD_COOLDOWN,fieldCooldown} from '../js/base.js'
import {advanceEconomy} from '../js/economy.js'
import {MAP_FIELDS} from '../js/world-map.js'
import {farmRouteLength,FARM_TRAVEL_SPEED} from '../js/farm-travel.js'
const field=MAP_FIELDS.find(f=>f.villageId===1)
const setup=()=>{const s=freshSave();s.cookedRice=1000;setFormation(s,'platoon',40);stationTroops(s,1,[1]);return s}
const begin=s=>startFarming(s,'help',0,field.crop,[1],field.id,[{unitId:1,troops:7,type:'group'}])
const step=(s,n)=>advanceEconomy(s,n,()=>0)
test('田地接受本村驻军与本村待命分队，拒绝外村和未驻村人员',()=>{
  const s=setup()
  assert(setFormation(s,'squad',10).ok);assert(stationTroops(s,2,[2]).ok)
  const detached=splitGarrisonUnit(s,1,'squad',7).unit
  assert(setFormation(s,'squad',10).ok)
  const snapshot=structuredClone(s)
  assert.equal(startFarming(s,'help',5,field.crop,null,field.id).ok,false)
  for(const id of [2,4]){
    assert.equal(startFarming(s,'help',0,field.crop,[id],field.id).ok,false)
    assert.equal(startFarming(s,'help',0,field.crop,[id],field.id,[{unitId:id,troops:5,type:'group'}]).ok,false)
  }
  assert.deepEqual(s,snapshot)
  for(const allocations of [null,[{unitId:detached.id,troops:5,type:'group'}]]){
    const restored=normalizeSave(s)
    assert(startFarming(restored,'help',0,field.crop,[detached.id],field.id,allocations).ok)
    assert.equal(farmTaskAt(restored,field.id).phase,'outbound')
    assert.deepEqual(normalizeSave(restored),restored)
  }
  assert(stationTroops(s,2,[detached.id]).ok)
  assert.equal(startFarming(s,'help',0,field.crop,[detached.id],field.id).ok,false)
  assert(begin(s).ok)
})
test('田地完工后休耕5分钟才能再耕，召回无奖励则不休耕',()=>{
  const s=setup(),travel=farmRouteLength((begin(s),farmTaskAt(s,field.id)))/FARM_TRAVEL_SPEED
  step(s,travel+FARM.duration);assert.equal(farmTaskAt(s,field.id).phase,'returning');assert.equal(fieldCooldown(s,field.id),FIELD_COOLDOWN)
  step(s,travel+1);assert.equal(farmTaskAt(s,field.id),null);assert.equal(begin(s).ok,false)
  assert.equal(normalizeSave(s).fieldCooldowns[field.id],fieldCooldown(s,field.id))
  step(s,FIELD_COOLDOWN-travel-1+.01);assert.equal(fieldCooldown(s,field.id),0);assert.equal(begin(s).ok,true)
  const t=setup();begin(t);step(t,1);assert.equal(fieldCooldown(t,field.id),0)
})
