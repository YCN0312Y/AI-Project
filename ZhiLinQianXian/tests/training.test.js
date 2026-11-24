import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation} from '../js/state.js'
import {formationActivity} from '../js/base.js'
import {campaignDeployment} from '../js/campaign.js'
import {stationTroops} from '../js/villages.js'
import {Game} from '../js/game.js'

test('移除旧训练任务和等级后，保留编制、兵力、武器和驻地，人员可以调动',()=>{
  const s=freshSave()
  assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'squad',10).ok)
  assert(stationTroops(s,1,[2]).ok)
  const legacy=structuredClone(s)
  legacy.trainingTask={unitId:1,elapsed:5,duration:10}
  legacy.villageTrainingTasks={1:{villageId:1,unitId:2,elapsed:5,duration:10}}
  legacy.trainingSessions=3;legacy.reserveTrainingXp=600
  legacy.formations[0].trainingXp=6000;legacy.formations[1].trainingXp=3000
  const restored=normalizeSave(legacy)
  assert.deepEqual(restored,s)
  assert.equal(formationActivity(restored,1),null)
  assert.equal(formationActivity(restored,2),'garrison')
  assert.deepEqual(campaignDeployment(restored,[1]).units[0].groups,[{weapon:'rifle',troops:10}])
  assert(campaignDeployment(restored,[2],true).ok)
})

test('部队详情和驻村管理移除训练入口及等级显示',()=>{
  const s=freshSave(),labels=[]
  assert(setFormation(s,'squad',10).ok)
  assert(stationTroops(s,1,[1]).ok)
  const g=Object.create(Game.prototype)
  Object.assign(g,{save:s,buttons:[],villageId:1,formationDetailId:1,
    ctx:new Proxy({fillText:value=>labels.push(String(value))},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})})
  g.modal='village';g.drawModal()
  g.modal='formation-detail';g.drawModal()
  assert(g.buttons.some(button=>button.id==='formation-detail-edit'))
  assert(!g.buttons.some(button=>/train/.test(button.id)))
  assert(!labels.some(label=>/训练|新兵|火力 \+/.test(label)))
})
