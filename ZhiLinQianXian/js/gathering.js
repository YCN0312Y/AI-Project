import {activeFormationIds,formationActivity} from './base.js'
import {regionLocalUnits,regionEnemyTroops} from './regions.js'
import {syncIdleBranches} from './state.js'
import {mapRegion} from './world-map.js'
import {FISH} from './logistics.js'
import {PROJECT_UNIT_LIMIT,removeTaskUnit} from './workforce.js'

export const MATERIAL_LIMIT=10000000
export const GATHER_INTERVAL=60
export const MATERIALS=[{id:'ore',name:'矿石',terrain:'mountain'},{id:'wood',name:'木头',terrain:'forest'},{id:'grass',name:'干草',terrain:'forest'}]
export const gatheringOptions=site=>site?.type==='river'?[FISH]:MATERIALS.filter(material=>material.terrain===site?.type)
export const gatheringName=id=>id===FISH.id?FISH.name:MATERIALS.find(material=>material.id===id).name
const stockStore=(s,id)=>id===FISH.id?s:s.materials
export const gatheringStock=(s,id)=>stockStore(s,id)[id]
export const freshGathering=()=>({materials:Object.fromEntries(MATERIALS.map(material=>[material.id,0])),gatheringTasks:{}})
export function* gatheringEntries(s){
  for(const [siteId,tasks] of Object.entries(s.gatheringTasks||{}))for(const task of Object.values(tasks))yield [siteId,task]
}

export const availableGatheringUnits=(s,siteId)=>regionLocalUnits(s,siteId).filter(unit=>!formationActivity(s,unit.id,true))
function gatheringWorkers(s,siteId,ids){
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return 0
  const available=new Map(availableGatheringUnits(s,siteId).map(unit=>[unit.id,unit.troops]))
  if(ids.some(id=>!available.has(id)))return 0
  return ids.reduce((total,id)=>total+available.get(id),0)
}
export function startGathering(s,siteId,ids,material){
  if(!gatheringOptions(mapRegion(siteId)).some(option=>option.id===material))return {ok:false,message:'这里无法采集这种材料'}
  if(regionEnemyTroops(s,siteId)>0)return {ok:false,message:'请先占领该地点'}
  const current=s.gatheringTasks[siteId]?.[material]
  if(Array.isArray(ids)&&(current?.unitIds.length??0)+ids.length>PROJECT_UNIT_LIMIT)return {ok:false,message:`每种材料最多派 ${PROJECT_UNIT_LIMIT} 支部队`}
  const workers=gatheringWorkers(s,siteId,ids)
  if(!workers)return {ok:false,message:'请选择在本地驻防或待命且未执行任务的部队'}
  const tasks=s.gatheringTasks[siteId]||={}
  if(current){
    if(current.elapsed>0)current.cycleWorkers??=current.workers
    current.unitIds.push(...ids)
    current.workers+=workers
  }else tasks[material]={unitIds:[...ids],workers,material,elapsed:0}
  return {ok:true}
}
export function stopGathering(s,siteId,material,unitId=null){
  const tasks=s.gatheringTasks[siteId],task=tasks?.[material]
  if(!task||unitId!==null&&!removeTaskUnit(s,task,unitId))return false
  if(unitId===null||!task.unitIds.length)delete tasks[material]
  if(!Object.keys(tasks).length)delete s.gatheringTasks[siteId]
  syncIdleBranches(s)
  return true
}
export function reconcileGathering(s,siteId){
  const tasks=s.gatheringTasks[siteId]
  if(!tasks)return
  const local=new Map(regionLocalUnits(s,siteId).map(unit=>[unit.id,unit.troops]))
  for(const task of Object.values(tasks)){
    task.unitIds=task.unitIds.filter(id=>local.has(id))
    task.workers=task.unitIds.reduce((total,id)=>total+local.get(id),0)
    if(!task.workers)delete tasks[task.material]
    if(task.cycleWorkers>=task.workers)delete task.cycleWorkers
  }
  if(!Object.keys(tasks).length)delete s.gatheringTasks[siteId]
}
export function normalizeGathering(s,raw){
  for(const {id} of MATERIALS){const amount=raw?.materials?.[id];s.materials[id]=Number.isFinite(amount)?Math.max(0,Math.min(MATERIAL_LIMIT,Math.floor(amount))):0}
  const present=new Set(s.formations.map(unit=>unit.id))
  for(const [site,saved] of Object.entries(raw?.gatheringTasks||{})){
    for(const {id:material} of gatheringOptions(mapRegion(site))){
      const task=saved?.material===material?saved:saved?.[material]
      if(task?.material!==material||!Number.isFinite(task.elapsed)||task.elapsed<0||task.elapsed>=GATHER_INTERVAL)continue
      if(regionEnemyTroops(s,site)>0)continue
      if(!Array.isArray(task.unitIds))continue
      const ids=task.unitIds.filter(id=>present.has(id))
      const workers=gatheringWorkers(s,site,ids)
      if(!workers)continue
      const restored={unitIds:ids,workers,material,elapsed:task.elapsed}
      if(task.elapsed>0&&Number.isInteger(task.cycleWorkers)&&task.cycleWorkers>0&&task.cycleWorkers<workers)restored.cycleWorkers=task.cycleWorkers
      const tasks=s.gatheringTasks[site]||={}
      tasks[material]=restored
    }
  }
}
export function nextGatheringEvent(s){
  let next=Infinity
  const fighting=new Set(activeFormationIds(s,'battle'))
  for(const [,task] of gatheringEntries(s))if(!task.unitIds.some(id=>fighting.has(id))&&gatheringStock(s,task.material)<MATERIAL_LIMIT)next=Math.min(next,GATHER_INTERVAL-task.elapsed)
  return next
}
export function advanceGathering(s,seconds,canWork){
  const gathered=[]
  if(!canWork||!Number.isFinite(seconds)||seconds<=0)return gathered
  const fighting=new Set(activeFormationIds(s,'battle'))
  for(const [,task] of gatheringEntries(s)){
    if(task.unitIds.some(id=>fighting.has(id)))continue
    const stock=stockStore(s,task.material),room=MATERIAL_LIMIT-stock[task.material]
    if(room<=0)continue
    task.elapsed+=seconds
    const rounds=Math.floor((task.elapsed+1e-8)/GATHER_INTERVAL)
    if(!rounds)continue
    const amount=Math.min(room,(task.cycleWorkers??task.workers)+task.workers*(rounds-1))
    delete task.cycleWorkers
    stock[task.material]+=amount
    task.elapsed=amount===room?0:Math.max(0,task.elapsed-rounds*GATHER_INTERVAL)
    gathered.push({material:task.material,amount})
  }
  return gathered
}
