import {ALL_VILLAGES,mapLocation} from './world-map.js'
import {formationActivity} from './base.js'
import {freshPopulation,normalizePopulation} from './population.js'

export const freshVillages=()=>({...freshPopulation(),garrisons:{},facilityVillages:{armory:null,medical:null},villageTrainingTasks:{}})
export const isVillage=id=>ALL_VILLAGES.some(v=>v.id===id)
const roots=s=>s.formations.filter(u=>!s.formations.some(parent=>parent.children?.includes(u.id)))
function contains(s,root,id){const unit=s.formations.find(u=>u.id===root);return root===id||!!unit?.children?.some(child=>contains(s,child,id))}
export function villageOfFormation(s,id){
  for(const village of ALL_VILLAGES)if((s.garrisons?.[village.id]||[]).some(root=>contains(s,root,id)))return village.id
  return null
}
export const villageUnits=(s,id)=>roots(s).filter(u=>(s.garrisons?.[id]||[]).includes(u.id))
// 所有村庄（含原六村与外围村庄）均须无敌军且有我方驻军，才进入村庄管理与耕作。
export function villageControlled(s,id){
  const village=ALL_VILLAGES.find(v=>v.id===id)
  if(!village)return false
  return !(village.regionId&&(s.mapRegions?.[village.regionId]?.enemies||[]).some(u=>u.troops>0))&&villageUnits(s,id).length>0
}
export const controlledVillages=s=>ALL_VILLAGES.filter(v=>villageControlled(s,v.id))
// 只有被我方驻军的村庄才能参与发动群众。
export const garrisonedVillages=s=>ALL_VILLAGES.filter(v=>villageControlled(s,v.id)&&villageUnits(s,v.id).length>0)
export function normalizeVillages(s,raw){
  Object.assign(s,freshVillages())
  normalizePopulation(s,raw)
  for(const kind of ['armory','medical']){
    const id=raw?.facilityVillages?.[kind]
    if(isVillage(id)&&(kind!=='medical'||id!==s.facilityVillages.armory))s.facilityVillages[kind]=id
  }
  const taken=new Set(),available=new Set(roots(s).map(u=>u.id))
  for(const village of ALL_VILLAGES){
    const ids=raw?.garrisons?.[village.id]
    if(!Array.isArray(ids))continue
    const valid=ids.filter(id=>{if(!available.has(id)||taken.has(id)||formationActivity(s,id,true))return false;taken.add(id);return true})
    if(valid.length)s.garrisons[village.id]=valid
  }
}
export function reconcileVillageGarrisons(s){
  for(const v of ALL_VILLAGES){
    if(!s.garrisons[v.id])continue
    s.garrisons[v.id]=s.garrisons[v.id].filter(id=>!(s.farmTask?.unitIds||[]).includes(id)||s.farmTask.villageId===v.id)
    if(!s.garrisons[v.id].length)delete s.garrisons[v.id]
  }
}
export function stationTroops(s,villageId,ids){
  if(!isVillage(villageId))return {ok:false,message:'请选择有效的村庄'}
  const available=roots(s)
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!available.some(u=>u.id===id)))return {ok:false,message:'请选择不同的独立部队，上级会包含全部下属'}
  if(ids.some(id=>formationActivity(s,id)))return {ok:false,message:'所选部队已有驻地或正在执行任务，请先召回'}
  s.garrisons[villageId]=[...(s.garrisons[villageId]||[]),...ids];return {ok:true}
}
export function recallGarrison(s,villageId,id){
  if(!(s.garrisons?.[villageId]||[]).includes(id))return {ok:false,message:'该部队不在本村驻防'}
  if(formationActivity(s,id,true))return {ok:false,message:'请先结束本村训练、生产或医疗任务，再撤回驻军'}
  s.garrisons[villageId]=s.garrisons[villageId].filter(key=>key!==id)
  if(!s.garrisons[villageId].length)delete s.garrisons[villageId]
  return {ok:true}
}
export function placeVillageFacility(s,kind,id){
  if(!['armory','medical'].includes(kind)||!isVillage(id))return {ok:false,message:'请选择有效的设施和村庄'}
  const other=kind==='armory'?'medical':'armory'
  if(s.facilityVillages[other]===id)return {ok:false,message:'同一村庄不能同时设置兵工厂和医疗部'}
  const previous=s.facilityVillages[kind]
  if(previous===id)return {ok:true}
  const tasks=kind==='armory'?[s.armoryTask]:Object.values(s.medicalTasks||{})
  if(previous&&tasks.some(Boolean))return {ok:false,message:'请先召回设施工作人员，再迁移设施'}
  // 旧存档中尚无选址的任务，首次选址时一并带入原工作人员和进度。
  const ids=[...new Set(tasks.filter(Boolean).flatMap(t=>t.unitIds))]
  if(ids.some(root=>villageOfFormation(s,root)!==null&&villageOfFormation(s,root)!==id))return {ok:false,message:'原工作人员已在其他村驻防，请先撤回'}
  s.facilityVillages[kind]=id
  if(ids.length){s.garrisons[id]=[...new Set([...(s.garrisons[id]||[]),...ids])];for(const task of tasks.filter(Boolean))task.villageId=id}
  return {ok:true}
}
export const villageName=id=>isVillage(id)?mapLocation(id).name:'未选址'
