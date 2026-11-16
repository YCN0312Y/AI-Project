import { advanceLogistics,hungerStatus,recruitmentInterval,RATIONS,recruitmentContexts,mobilizationRecord } from './logistics.js'
import { advanceFarming,FARM } from './base.js'
import {advanceFacilities,nextFacilityEvent} from './facilities.js'
import {advanceTrainingTask,trainingTasks} from './training.js'
// 按开饭和耕作完成的边界推进，使补粮、代耕减耗和饥饿暂停不会越过事件。
export function advanceEconomy(s,seconds,random=Math.random){
  const result={recruited:0,meals:0,consumed:0,shortage:0,harvests:[],supplies:{},produced:[],treated:[],training:null}
  if(!Number.isFinite(seconds)||seconds<0)return result
  Object.assign(result,advanceLogistics(s,0,random))
  for(const task of trainingTasks(s)){const completed=advanceTrainingTask(s,0,undefined,task.villageId);if(completed)result.training=completed}
  let remaining=seconds
  while(remaining>1e-8){
    const canWork=!hungerStatus(s).disabled
    const trainingRemaining=canWork?Math.min(...trainingTasks(s).map(task=>task.duration-task.elapsed),Infinity):Infinity
    const step=Math.min(remaining,RATIONS.interval-s.mealElapsed,s.farmTask&&canWork?FARM.duration-s.farmTask.elapsed:Infinity,canWork?nextFacilityEvent(s):Infinity,trainingRemaining)
    const food=advanceLogistics(s,step,random)
    for(const key of ['recruited','meals','consumed','shortage','populationGrown'])result[key]+=food[key]
    for(const [id,n] of Object.entries(food.supplies))result.supplies[id]=(result.supplies[id]||0)+n
    const before=recruitmentContexts(s).map(id=>[id,recruitmentInterval(s,id)]),harvest=advanceFarming(s,step,canWork,random)
    const facilities=advanceFacilities(s,step,canWork,random)
    for(const task of trainingTasks(s)){const training=advanceTrainingTask(s,step,canWork,task.villageId);if(training)result.training=training}
    result.produced.push(...facilities.produced);result.treated.push(...facilities.treated)
    for(const [id,rate] of before){const after=recruitmentInterval(s,id);if(rate!==after)mobilizationRecord(s,id).recruitElapsed*=after/rate}
    if(harvest){
      result.harvests.push(harvest);result.recruited+=harvest.recruited
      for(const [id,n] of Object.entries(harvest.supplies))result.supplies[id]=(result.supplies[id]||0)+n
    }
    remaining-=step
  }
  return result
}
