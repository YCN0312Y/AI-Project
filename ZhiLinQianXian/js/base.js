import { hungerStatus,RECRUITMENT,totalPersonnel,mobilizationRecord } from './logistics.js'
import { mapField } from './world-map.js'
import {villageOfFormation,unitVillage,villageLocalUnits,villageControlled} from './villages.js'
import {validateAllocations} from './workforce.js'
import {takeVillageRecruits} from './population.js'
import {gatheringEntries} from './gathering.js'
import {attachFarmTravel,farmRouteLength,farmTravelPosition,restoreFarmTravel,FARM_TRAVEL_SPEED} from './farm-travel.js'
export const FIELD_COOLDOWN=300
export const FARM={duration:60,minWorkers:1,maxWorkers:100,grainPerWorker:3}
export const CROPS=[{id:'millet',name:'谷子'},{id:'rice',name:'大米'},{id:'corn',name:'苞谷'}]
export const helpHarvestYield=workers=>Math.floor(workers*3/10)
export const freshBase=()=>({farmTask:null,fieldFarmTasks:{},fieldCooldowns:{},farmHarvested:0,helpedHarvests:0,mobilizationDiscounts:0})
export function farmTaskAt(s,fieldId=null){
  if(fieldId==null)return s.farmTask
  return Object.hasOwn(s.fieldFarmTasks,fieldId)?s.fieldFarmTasks[fieldId]:null
}
export const farmTasks=s=>s.farmTask?[s.farmTask,...Object.values(s.fieldFarmTasks)]:Object.values(s.fieldFarmTasks)
export const farmWorkers=s=>farmTasks(s).reduce((sum,task)=>sum+task.workers,0)
export const farmReserveWorkers=s=>farmTasks(s).reduce((sum,task)=>sum+(task.unitIds?0:task.workers),0)
function saveFarmTask(s,task){
  if(task.fieldId)s.fieldFarmTasks[task.fieldId]=task
  else s.farmTask=task
}
export function clearFarmTask(s,fieldId){
  if(fieldId)delete s.fieldFarmTasks[fieldId]
  else s.farmTask=null
}
const activities=new WeakMap()
export const activeFormationIds=s=>[...(activities.get(s)?.keys()||[])]
function family(s,id){
  const result=new Set(),visit=key=>{if(result.has(key))return;const unit=s.formations.find(unit=>unit.id===key);if(!unit)return;result.add(key);for(const child of unit.children||[])visit(child)}
  visit(id);return result
}
export function formationActivity(s,id,ignoreGarrison=false){
  const members=family(s,id),overlaps=key=>[...family(s,key)].some(key=>members.has(key))
  if((s.marchingOrders||[]).some(order=>order.unitIds.some(overlaps)))return 'march'
  for(const [key,kind] of activities.get(s)||[])if(overlaps(key))return kind
  if(farmTasks(s).some(task=>task.unitIds?.some(overlaps)))return 'farm'
  for(const [,task] of gatheringEntries(s))if(task.unitIds.some(overlaps))return 'gathering'
  if(Object.values(s.armoryTasks||{}).some(task=>task.unitIds.some(overlaps)))return 'armory'
  if((s.bandageTask?.unitIds||[]).some(overlaps))return 'bandages'
  for(const ward of ['light','heavy'])if((s.medicalTasks?.[ward]?.unitIds||[]).some(overlaps))return 'medical-'+ward
  if(s.trainingTask&&!s.trainingTask.settled&&overlaps(s.trainingTask.unitId))return 'training'
  if(Object.values(s.villageTrainingTasks||{}).some(task=>task&&!task.settled&&overlaps(task.unitId)))return 'training'
  if(!ignoreGarrison&&villageOfFormation(s,id)!==null)return 'garrison'
  if(!ignoreGarrison&&Object.values(s.mapRegions||{}).some(record=>(record.garrisonIds||[]).some(overlaps)))return 'region'
  return null
}
export const activityLabel=kind=>({march:'行军中',region:'地区驻防中',garrison:'驻村保护中',farm:'耕作中',gathering:'采集中',battle:'出战中',training:'训练中',armory:'军械生产中',bandages:'制作绷带中','medical-light':'轻伤部工作中','medical-heavy':'重伤部工作中'}[kind]||'空闲')
export function assignFormations(s,ids,kind,ignoreGarrison=false,allowedActivities=[]){
  if(!['battle','training'].includes(kind)||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return false
  const children=new Set(s.formations.flatMap(unit=>unit.children||[]))
  if(ids.some(id=>{
    if(!s.formations.some(unit=>unit.id===id)||children.has(id))return true
    const activity=formationActivity(s,id,ignoreGarrison)
    return activity&&!allowedActivities.includes(activity)
  }))return false
  const map=activities.get(s)||new Map();for(const id of ids)map.set(id,kind);activities.set(s,map);return true
}
export function releaseFormations(s,kind){const map=activities.get(s);if(map)for(const [id,value] of map)if(value===kind)map.delete(id)}
const reserve=s=>s.troops-s.formations.filter(unit=>!unit.children).reduce((sum,unit)=>sum+unit.troops,0)
export function normalizeBase(s,raw){
  Object.assign(s,freshBase())
  for(const key of ['farmHarvested','helpedHarvests','mobilizationDiscounts'])if(Number.isFinite(raw?.[key]))s[key]=Math.max(0,Math.min(10000000,Math.floor(raw[key])))
  if(raw?.fieldCooldowns&&typeof raw.fieldCooldowns==='object')for(const [id,v] of Object.entries(raw.fieldCooldowns))if(mapField(id)&&Number.isFinite(v)&&v>0)s.fieldCooldowns[id]=Math.min(FIELD_COOLDOWN,v)
  const legacy=restoreFarmTask(s,raw?.farmTask)
  if(legacy)saveFarmTask(s,legacy)
  for(const [fieldId,saved] of Object.entries(raw?.fieldFarmTasks||{})){
    if(!mapField(fieldId)||saved?.fieldId!==fieldId||farmTaskAt(s,fieldId))continue
    const task=restoreFarmTask(s,saved)
    if(task?.fieldId===fieldId)saveFarmTask(s,task)
  }
}
function restoreFarmTask(s,t){
  if(t&&['help','self'].includes(t.type)&&Number.isInteger(t.workers)&&t.workers>=1&&Number.isFinite(t.elapsed)&&t.elapsed>=0&&(t.elapsed<FARM.duration||t.phase==='returning'&&t.elapsed===FARM.duration)&&CROPS.some(crop=>crop.id===t.crop)){
    const children=new Set(s.formations.flatMap(unit=>unit.children||[])),ids=t.unitIds
    const field=mapField(t.fieldId)
    const allocation=t.allocations!==undefined&&t.type==='help'&&field?.crop===t.crop?validateAllocations(s,field.villageId,t.allocations,ids):null
    if(t.allocations!==undefined&&(!allocation?.ok||allocation.workers!==t.workers))return null
    const grouped=allocation?.ok||Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>s.formations.some(unit=>unit.id===id)&&!children.has(id)&&!formationActivity(s,id,true))&&ids.reduce((sum,id)=>sum+s.formations.find(unit=>unit.id===id).troops,0)===t.workers
    const local=grouped&&field&&ids.some(id=>unitVillage(s,id)===field.villageId)
    if(grouped||(!ids&&t.workers<=Math.min(FARM.maxWorkers,reserve(s)))){
      const task={type:t.type,workers:t.workers,crop:t.crop,elapsed:t.elapsed,...(grouped?{unitIds:[...ids]}:{}),...(t.type==='help'&&field?.crop===t.crop?{fieldId:field.id}:{}),...(local?{villageId:field.villageId}:{}),...(allocation?.ok?{allocations:allocation.allocations}:{})}
      if(restoreFarmTravel(task,t)){
        if(!t.phase&&task.type==='help'&&local&&ids.every(id=>unitVillage(s,id)===field.villageId)){attachFarmTravel(task);task.phase='working';task.travelled=farmRouteLength(task)}
        return task
      }
    }
  }
  return null
}
export function startFarming(s,type,workers,crop='millet',unitIds=null,fieldId=null,allocations=null){
  if(farmTaskAt(s,fieldId))return {ok:false,message:fieldId?'这块田已有代耕部队，请等待他们完成或归队':'已有耕作进行中，请先完成或取消'}
  if(!['help','self'].includes(type)||!CROPS.some(item=>item.id===crop))return {ok:false,message:'请选择有效的耕作方式和作物'}
  if(fieldId!==null){const field=mapField(fieldId);if(!field||type!=='help'||field.crop!==crop)return {ok:false,message:'请选择有效的乡亲田地'}
    const wait=fieldCooldown(s,fieldId);if(wait>0)return {ok:false,message:'田地刚完成耕作，还需休耕 '+Math.ceil(wait)+' 秒才能再耕'}}
  let allocation=null;const field=mapField(fieldId)
  if(field){
    const localIds=new Set(villageLocalUnits(s,field.villageId).map(unit=>unit.id))
    if(!villageControlled(s,field.villageId)||!Array.isArray(unitIds)||!unitIds.length||unitIds.some(id=>!localIds.has(id)))return {ok:false,message:'只有本村驻军和留在本村的分队可以帮助耕田'}
  }
  if(allocations!==null){
    allocation=type==='help'&&field?validateAllocations(s,field.villageId,allocations,unitIds):null
    if(!allocation?.ok)return allocation||{ok:false,message:'请从本村田地选择派遣部队'}
    workers=allocation.workers
  }else if(unitIds!==null){
    const children=new Set(s.formations.flatMap(unit=>unit.children||[]))
    if(!Array.isArray(unitIds)||!unitIds.length||new Set(unitIds).size!==unitIds.length)return {ok:false,message:'请选择不同的独立部队'}
    if(unitIds.some(id=>!s.formations.some(unit=>unit.id===id)||children.has(id)))return {ok:false,message:'只能派出独立编制，上级包含全部下属'}
    if(unitIds.some(id=>formationActivity(s,id,!!field&&unitVillage(s,id)===field.villageId)))return {ok:false,message:'所选部队正在执行任务，请选择空闲人员或派遣部分分队'}
    workers=unitIds.reduce((sum,id)=>sum+s.formations.find(unit=>unit.id===id).troops,0)
  }else{
    if(!Number.isInteger(workers)||workers<1||workers>FARM.maxWorkers)return {ok:false,message:'耕作人数须为 1—100 的整数'}
    if(workers>reserve(s))return {ok:false,message:`未编人员不足，当前可派 ${Math.max(0,reserve(s))} 人`}
  }
  if(hungerStatus(s).disabled)return {ok:false,message:'部队极度饥饿，请先到灶房供餐再耕作'}
  const local=field&&unitIds?.some(id=>unitVillage(s,id)===field.villageId)
  const task={type,workers,crop,elapsed:0,...(unitIds?{unitIds:[...unitIds]}:{}),...(fieldId?{fieldId}:{}),...(local?{villageId:field.villageId}:{}),...(allocation?{allocations:allocation.allocations}:{})}
  if(type==='help'&&local&&unitIds.every(id=>unitVillage(s,id)===field.villageId))attachFarmTravel(task)
  saveFarmTask(s,task)
  return {ok:true}
}
export const fieldCooldown=(s,id)=>s.fieldCooldowns?.[id]||0
function awardHelpHarvest(s,result,random){
  const available=CROPS.filter(crop=>s[crop.id]<10000000)
  const total=helpHarvestYield(result.workers)
  while(result.amount<total&&available.length){
    const index=Math.min(available.length-1,Math.floor(random()*available.length)),crop=available[index].id
    s[crop]++;result.amount++;result.supplies[crop]=(result.supplies[crop]||0)+1
    if(s[crop]>=10000000)available.splice(index,1)
  }
}
export function advanceFarmTasks(s,seconds,canWork=!hungerStatus(s).disabled,random=Math.random){
  const result={harvests:[],returnedFarms:[]}
  if(!Number.isFinite(seconds)||seconds<=0)return result
  for(const [id,cooldown] of Object.entries(s.fieldCooldowns)){
    const left=cooldown-seconds
    if(left>1e-7)s.fieldCooldowns[id]=left
    else delete s.fieldCooldowns[id]
  }
  for(const task of farmTasks(s)){
    const returning=task.phase==='returning'
    const harvest=advanceFarmTask(s,task,seconds,canWork,random)
    if(harvest)result.harvests.push(harvest)
    if(returning&&!farmTaskAt(s,task.fieldId))result.returnedFarms.push(task)
  }
  return result
}
export function advanceFarming(s,seconds,canWork,random){return advanceFarmTasks(s,seconds,canWork,random).harvests[0]||null}
function advanceFarmTask(s,task,seconds,canWork,random){
  if(task.phase&&task.phase!=='working'){
    task.travelled=Math.min(farmRouteLength(task),task.travelled+seconds*FARM_TRAVEL_SPEED*hungerStatus(s).speedMultiplier)
    if(task.travelled>=farmRouteLength(task)-1e-7){if(task.phase==='returning')clearFarmTask(s,task.fieldId);else task.phase='working'}
    return null
  }
  if(!canWork)return null
  task.elapsed=Math.min(FARM.duration,task.elapsed+seconds)
  if(task.elapsed<FARM.duration)return null
  const result={type:task.type,workers:task.workers,crop:task.crop,amount:0,recruited:0,supplies:{},...(task.fieldId?{fieldId:task.fieldId}:{})}
  if(task.type==='help'){
    s.mobilizationDiscounts=Math.min(10000000,s.mobilizationDiscounts+task.workers)
    s.helpedHarvests=Math.min(10000000,s.helpedHarvests+task.workers)
    const village=mapField(task.fieldId)?.villageId,room=RECRUITMENT.troopLimit-totalPersonnel(s)
    result.recruited=village?takeVillageRecruits(s,village,room,random):Math.max(0,Math.min(RECRUITMENT.batch,room))
    s.troops+=result.recruited;s.recruitedTroops=Math.min(RECRUITMENT.troopLimit,s.recruitedTroops+result.recruited)
    if(result.recruited)s.recruitmentCount=Math.min(RECRUITMENT.troopLimit,s.recruitmentCount+1)
    if(village&&result.recruited){const record=mobilizationRecord(s,village,true);record.recruitedTroops=Math.min(RECRUITMENT.troopLimit,record.recruitedTroops+result.recruited);record.recruitmentCount=Math.min(RECRUITMENT.troopLimit,record.recruitmentCount+1)}
    awardHelpHarvest(s,result,random)
  }else{
    result.amount=Math.min(task.workers*FARM.grainPerWorker,10000000-s[task.crop]);s[task.crop]+=result.amount
  }
  s.farmHarvested=Math.min(10000000,s.farmHarvested+result.amount)
  if(task.type==='help'&&task.fieldId){s.fieldCooldowns??={};s.fieldCooldowns[task.fieldId]=FIELD_COOLDOWN}
  if(task.phase){task.phase='returning';task.travelled=0}else clearFarmTask(s,task.fieldId)
  return result
}
export function cancelFarming(s,fieldId=null){
  const task=farmTaskAt(s,fieldId);if(!task||task.phase==='returning')return false
  if(task.phase){
    if(task.phase==='outbound'){
      const position=farmTravelPosition(task),points=[task.route[0]];let remaining=task.travelled
      for(let i=1;i<task.route.length;i++){const length=Math.hypot(task.route[i].x-task.route[i-1].x,task.route[i].y-task.route[i-1].y);if(remaining<=length)break;points.push(task.route[i]);remaining-=length}
      points.push(position);task.route=points
    }
    task.phase='returning';task.travelled=0
  }else clearFarmTask(s,fieldId)
  return true
}
