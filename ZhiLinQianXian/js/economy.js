import { advanceLogistics,hungerStatus,recruitmentInterval,RATIONS,recruitmentContexts,mobilizationRecord } from './logistics.js'
import { advanceFarmTasks,farmTasks,FARM } from './base.js'
import {advanceFacilities,nextFacilityEvent} from './facilities.js'
import {nextFarmEvent} from './farm-travel.js'
import {advanceGathering,nextGatheringEvent} from './gathering.js'
// 按开饭和耕作完成的边界推进，使补粮、代耕减耗和饥饿暂停不会越过事件。
export function advanceEconomy(s,seconds,random=Math.random,productionPaused=false){
  const result={recruited:0,meals:0,consumed:0,shortage:0,harvests:[],returnedFarms:[],supplies:{},produced:[],gathered:[]}
  if(!Number.isFinite(seconds)||seconds<0)return result
  Object.assign(result,advanceLogistics(s,0,random))
  let remaining=seconds
  while(remaining>1e-8){
    const canWork=!hungerStatus(s).disabled
    const canProduce=canWork&&!productionPaused
    const farmRemaining=Math.min(Infinity,...farmTasks(s).map(task=>nextFarmEvent(s,task,FARM.duration,canWork)))
    const step=Math.min(remaining,RATIONS.interval-s.mealElapsed,farmRemaining,canProduce?nextFacilityEvent(s):Infinity,canWork?nextGatheringEvent(s):Infinity)
    const food=advanceLogistics(s,step,random)
    for(const key of ['recruited','meals','consumed','shortage','populationGrown'])result[key]+=food[key]
    for(const [id,n] of Object.entries(food.supplies))result.supplies[id]=(result.supplies[id]||0)+n
    const before=recruitmentContexts(s).map(id=>[id,recruitmentInterval(s,id)]),farming=advanceFarmTasks(s,step,canWork,random)
    const facilities=advanceFacilities(s,step,canProduce)
    result.gathered.push(...advanceGathering(s,step,canWork))
    result.produced.push(...facilities.produced)
    for(const [id,rate] of before){const after=recruitmentInterval(s,id);if(rate!==after)mobilizationRecord(s,id).recruitElapsed*=after/rate}
    result.returnedFarms.push(...farming.returnedFarms)
    for(const harvest of farming.harvests){
      result.harvests.push(harvest);result.recruited+=harvest.recruited
      for(const [id,n] of Object.entries(harvest.supplies))result.supplies[id]=(result.supplies[id]||0)+n
    }
    remaining-=step
  }
  return result
}
