import {ALL_VILLAGES} from './world-map.js'
import {unitVillage,villageLocalUnits} from './villages.js'
import {farmTasks,formationActivity} from './base.js'
const TYPES=[['squad','班',7,12],['platoon','排',25,40],['company','连',100,150],['battalion','营',400,1000],['regiment','团',1000,3000],['brigade','旅',3000,6000],['division','师',8000,15000],['corps','军',30000,80000]]
export const DUTY_TYPES=[{id:'group',name:'临时分队',min:1,max:10000000},...TYPES.map(([id,name,min,max])=>({id,name,min,max}))]
const tasks=s=>[...farmTasks(s),...Object.values(s.armoryTasks||{}),s.bandageTask,...Object.values(s.medicalTasks||{})].filter(Boolean)
export const taskWorkersFrom=(task,id,unit)=>task?.allocations?task.allocations.find(a=>a.unitId===id)?.troops||0:(task?.unitIds||[]).includes(id)?unit.troops:0
export function availableWorkforce(s,id,includeTrainees=false){
  const unit=s.formations.find(u=>u.id===id);if(!unit)return 0
  if(formationActivity(s,id,true)==='battle')return 0
  if(!includeTrainees){
    const members=new Set(),visit=key=>{if(members.has(key))return;members.add(key);for(const child of s.formations.find(u=>u.id===key)?.children||[])visit(child)};visit(id)
    if([s.trainingTask,...Object.values(s.villageTrainingTasks||{})].some(t=>t&&!t.settled&&members.has(t.unitId)))return 0
  }
  return Math.max(0,unit.troops-tasks(s).reduce((n,t)=>n+taskWorkersFrom(t,id,unit),0))
}
export const dutyTypes=unit=>DUTY_TYPES.filter(t=>t.id==='group'||TYPES.findIndex(v=>v[0]===t.id)<=TYPES.findIndex(v=>v[0]===unit.type))
export function validateAllocations(s,villageId,allocations,ids){
  if(!ALL_VILLAGES.some(v=>v.id===villageId)||!Array.isArray(allocations)||!allocations.length)return {ok:false,message:'请选择本村部队和派遣编制'}
  const roots=villageLocalUnits(s,villageId),seen=new Set(),clean=[]
  for(const a of allocations){
    const unit=roots.find(u=>u.id===a?.unitId),type=unit&&dutyTypes(unit).find(t=>t.id===a.type)
    if(!unit||seen.has(a.unitId)||unitVillage(s,a.unitId)!==villageId||!type||!Number.isInteger(a.troops)||a.troops<type.min||a.troops>type.max)return {ok:false,message:'派遣编制或人数无效，请检查人数区间'}
    if(a.troops>availableWorkforce(s,a.unitId))return {ok:false,message:'原部队可派人数不足，不能重复派出已在工作的人员'}
    seen.add(a.unitId);clean.push({unitId:a.unitId,troops:a.troops,type:a.type})
  }
  if(!Array.isArray(ids)||ids.length!==clean.length||ids.some((id,i)=>id!==clean[i].unitId))return {ok:false,message:'派遣名单与原部队不一致'}
  return {ok:true,workers:clean.reduce((n,a)=>n+a.troops,0),allocations:clean,unitIds:clean.map(a=>a.unitId)}
}
