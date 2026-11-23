import {ALL_VILLAGES,mapField,mapLocation} from './world-map.js'
import {clearFarmTask,farmTasks,formationActivity} from './base.js'
import {freshPopulation,normalizePopulation} from './population.js'
import {detachGarrison,recallToStandby,syncIdleBranches} from './state.js'
import {recallFacility} from './facilities.js'
import {cancelTrainingTask} from './training.js'

export const freshVillages=()=>({...freshPopulation(),garrisons:{},facilityVillages:{armory:null},villageTrainingTasks:{}})
export const isVillage=id=>ALL_VILLAGES.some(v=>v.id===id)
export const villageRegionId=id=>{const site=ALL_VILLAGES.find(v=>v.id===id);return site?.regionId??site?.id}
export const villageEnemyTroops=(s,id)=>(s.mapRegions?.[villageRegionId(id)]?.enemies||[]).reduce((sum,unit)=>sum+unit.troops,0)
const roots=s=>s.formations.filter(u=>!s.formations.some(parent=>parent.children?.includes(u.id)))
function contains(s,root,id){const unit=s.formations.find(u=>u.id===root);return root===id||!!unit?.children?.some(child=>contains(s,child,id))}
export function villageOfFormation(s,id){
  for(const village of ALL_VILLAGES)if((s.garrisons?.[village.id]||[]).some(root=>contains(s,root,id)))return village.id
  return null
}
// 从本村驻军分出、尚未派往他处的部队仍留在本村（可进驻本村兵工厂、医院、田地或参训）。
export function localSplitVillage(s,id){
  const unit=s.formations.find(u=>u.id===id)
  if(!unit||unit.splitOrigin===undefined)return null
  if(isVillage(unit.splitOrigin))return unit.splitOrigin
  return ALL_VILLAGES.find(v=>v.regionId===unit.splitOrigin)?.id??null
}
export const unitVillage=(s,id)=>villageOfFormation(s,id)??localSplitVillage(s,id)
export const villageUnits=(s,id)=>roots(s).filter(u=>(s.garrisons?.[id]||[]).includes(u.id))
export function villageLocalUnits(s,id){
  const stationed=villageUnits(s,id),seen=new Set(stationed.map(u=>u.id))
  const splits=roots(s).filter(u=>!seen.has(u.id)&&localSplitVillage(s,u.id)===id&&!['march','battle'].includes(formationActivity(s,u.id,true)))
  return [...stationed,...splits]
}
// 所有村庄（含原六村与外围村庄）均须无敌军且有我方驻军，才进入村庄管理与耕作。
export function villageControlled(s,id){
  return isVillage(id)&&villageEnemyTroops(s,id)===0&&(s.baseVillageId===id||villageUnits(s,id).length>0)
}
export const controlledVillages=s=>ALL_VILLAGES.filter(v=>villageControlled(s,v.id))
// 只有被我方驻军的村庄才能参与发动群众。
export const garrisonedVillages=s=>ALL_VILLAGES.filter(v=>villageControlled(s,v.id)&&villageUnits(s,v.id).length>0)
export function normalizeVillages(s,raw){
  Object.assign(s,freshVillages())
  normalizePopulation(s,raw)
  const armory=raw?.facilityVillages?.armory
  if(isVillage(armory))s.facilityVillages.armory=armory
  const taken=new Set(),available=new Set(roots(s).map(u=>u.id))
  for(const village of ALL_VILLAGES){
    const ids=raw?.garrisons?.[village.id]
    if(!Array.isArray(ids))continue
    const valid=ids.filter(id=>{if(!available.has(id)||taken.has(id)||formationActivity(s,id,true))return false;taken.add(id);return true})
    if(valid.length)s.garrisons[village.id]=valid
  }
}
export function reconcileVillageGarrisons(s){
  const tasks=farmTasks(s)
  for(const v of ALL_VILLAGES){
    if(!s.garrisons[v.id])continue
    s.garrisons[v.id]=s.garrisons[v.id].filter(id=>!tasks.some(task=>task.unitIds?.includes(id)&&task.villageId!==v.id))
    if(!s.garrisons[v.id].length)delete s.garrisons[v.id]
  }
}
export function stationTroops(s,villageId,ids){
  if(!isVillage(villageId))return {ok:false,message:'请选择有效的村庄'}
  if(villageEnemyTroops(s,villageId)>0)return {ok:false,message:'该村已被敌军占领，请先击败守军'}
  const available=roots(s)
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!available.some(u=>u.id===id)))return {ok:false,message:'请选择不同的独立部队，上级会包含全部下属'}
  if(ids.some(id=>formationActivity(s,id)))return {ok:false,message:'所选部队已有驻地或正在执行任务，请先召回'}
  for(const id of ids){const u=s.formations.find(x=>x.id===id);if(u)delete u.splitOrigin}
  s.garrisons[villageId]=[...(s.garrisons[villageId]||[]),...ids];syncIdleBranches(s);return {ok:true}
}
export function recallGarrison(s,villageId,id){
  if(!(s.garrisons?.[villageId]||[]).includes(id))return {ok:false,message:'该部队不在本村驻防'}
  if(formationActivity(s,id,true))return {ok:false,message:'请先结束部队的当前任务，再撤回驻军'}
  const result=recallToStandby(s,id)
  if(!result.ok)return result
  detachGarrison(s,villageRegionId(villageId),id)
  syncIdleBranches(s)
  return result
}
export function placeVillageFacility(s,kind,id){
  if(kind!=='armory'||!isVillage(id))return {ok:false,message:'请选择有效的村庄设置兵工厂'}
  if(villageEnemyTroops(s,id)>0)return {ok:false,message:'请先夺回村庄，再设置兵工厂'}
  const previous=s.facilityVillages.armory
  if(previous===id)return {ok:true}
  if(previous!==null)return {ok:false,message:'请使用转移兵工厂选址'}
  const tasks=Object.values(s.armoryTasks)
  // 旧存档中尚无选址的任务，首次选址时一并带入原工作人员和进度。
  const ids=[...new Set(tasks.filter(Boolean).flatMap(t=>t.unitIds))]
  if(ids.some(root=>villageOfFormation(s,root)!==null&&villageOfFormation(s,root)!==id))return {ok:false,message:'原工作人员已在其他村驻防，请先撤回'}
  s.facilityVillages.armory=id
  if(ids.length){s.garrisons[id]=[...new Set([...(s.garrisons[id]||[]),...ids])];for(const task of tasks.filter(Boolean))task.villageId=id}
  return {ok:true}
}
export function armoryTransferError(s,id){
  const origin=s.facilityVillages.armory
  if(origin===null)return '请先设置兵工厂'
  if(villageEnemyTroops(s,origin)>0)return '请先夺回兵工厂所在村庄'
  if(id===origin)return '请选择其他村庄'
  if(!villageControlled(s,id))return '请选择我方控制的村庄'
  return ''
}
export function transferArmory(s,id){
  const message=armoryTransferError(s,id)
  if(message)return {ok:false,message}
  const origin=s.facilityVillages.armory,movingIds=[...new Set(Object.values(s.armoryTasks).flatMap(t=>t.unitIds))]
  for(const uid of movingIds){
    for(const task of farmTasks(s))if(task.unitIds?.includes(uid)&&task.villageId!==id)clearFarmTask(s,task.fieldId)
    if((s.garrisons[origin]||[]).includes(uid)){
      s.garrisons[origin]=s.garrisons[origin].filter(k=>k!==uid)
      if(!s.garrisons[origin].length)delete s.garrisons[origin]
      s.garrisons[id]=[...new Set([...(s.garrisons[id]||[]),uid])]
    }else{
      const unit=s.formations.find(u=>u.id===uid)
      if(unit&&unit.splitOrigin!==undefined)unit.splitOrigin=villageRegionId(id)
    }
  }
  for(const task of Object.values(s.armoryTasks))task.villageId=id
  s.facilityVillages.armory=id
  syncIdleBranches(s)
  return {ok:true}
}
export function removeVillageFacility(s,kind,id){
  if(kind!=='armory'||!isVillage(id)||s.facilityVillages.armory!==id)return {ok:false,message:'本村没有兵工厂'}
  if(villageEnemyTroops(s,id)>0)return {ok:false,message:'请先夺回村庄，再拆除兵工厂'}
  for(const product of Object.keys(s.armoryTasks))recallFacility(s,product)
  s.facilityVillages.armory=null
  syncIdleBranches(s)
  return {ok:true}
}
export function evacuateVillage(s,id){
  for(const task of farmTasks(s))if(task.villageId===id||mapField(task.fieldId)?.villageId===id)clearFarmTask(s,task.fieldId)
  if(s.facilityVillages.armory===id)for(const product of Object.keys(s.armoryTasks))recallFacility(s,product)
  cancelTrainingTask(s,id)
  const stationed=new Set(s.garrisons[id]||[])
  for(const unit of s.formations)if(stationed.has(unit.id)||localSplitVillage(s,unit.id)===id)delete unit.splitOrigin
  delete s.garrisons[id]
}
export const villageName=id=>isVillage(id)?mapLocation(id).name:'未选址'
