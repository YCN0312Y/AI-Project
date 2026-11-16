import { hungerStatus,RECRUITMENT,totalPersonnel,mobilizationRecord } from './logistics.js'
import { mapField } from './world-map.js'
import {villageOfFormation} from './villages.js'
import {validateAllocations} from './workforce.js'
import {takeVillageRecruits} from './population.js'
export const FARM={duration:60,minWorkers:1,maxWorkers:100,grainPerWorker:3}
export const CROPS=[{id:'millet',name:'谷子'},{id:'rice',name:'大米'},{id:'corn',name:'苞谷'}]
export const freshBase=()=>({farmTask:null,farmHarvested:0,helpedHarvests:0,mobilizationDiscounts:0})
export const farmWorkers=s=>s.farmTask?.workers||0
export const farmReserveWorkers=s=>s.farmTask?.unitIds?0:farmWorkers(s)
const activities=new WeakMap()
export const activeFormationIds=s=>[...(activities.get(s)?.keys()||[])]
function family(s,id){
  const result=new Set(),visit=key=>{if(result.has(key))return;const unit=s.formations.find(unit=>unit.id===key);if(!unit)return;result.add(key);for(const child of unit.children||[])visit(child)}
  visit(id);return result
}
export function formationActivity(s,id,ignoreGarrison=false){
  const members=family(s,id),overlaps=key=>[...family(s,key)].some(key=>members.has(key))
  if((s.farmTask?.unitIds||[]).some(overlaps))return 'farm'
  if((s.armoryTask?.unitIds||[]).some(overlaps))return 'armory'
  for(const ward of ['light','heavy'])if((s.medicalTasks?.[ward]?.unitIds||[]).some(overlaps))return 'medical-'+ward
  if(s.trainingTask&&!s.trainingTask.settled&&overlaps(s.trainingTask.unitId))return 'training'
  if(Object.values(s.villageTrainingTasks||{}).some(task=>task&&!task.settled&&overlaps(task.unitId)))return 'training'
  for(const [key,kind] of activities.get(s)||[])if(overlaps(key))return kind
  if(!ignoreGarrison&&villageOfFormation(s,id)!==null)return 'garrison'
  if(!ignoreGarrison&&Object.values(s.mapRegions||{}).some(record=>(record.garrisonIds||[]).some(overlaps)))return 'region'
  return null
}
export const activityLabel=kind=>({region:'地区驻防中',garrison:'驻村保护中',farm:'耕作中',battle:'出战中',training:'训练中',armory:'军械生产中','medical-light':'轻伤部工作中','medical-heavy':'重伤部工作中'}[kind]||'空闲')
export function assignFormations(s,ids,kind){
  if(!['battle','training'].includes(kind)||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return false
  const children=new Set(s.formations.flatMap(unit=>unit.children||[]))
  if(ids.some(id=>!s.formations.some(unit=>unit.id===id)||children.has(id)||formationActivity(s,id)))return false
  const map=activities.get(s)||new Map();for(const id of ids)map.set(id,kind);activities.set(s,map);return true
}
export function releaseFormations(s,kind){const map=activities.get(s);if(map)for(const [id,value] of map)if(value===kind)map.delete(id)}
const reserve=s=>s.troops-s.formations.filter(unit=>!unit.children).reduce((sum,unit)=>sum+unit.troops,0)
export function normalizeBase(s,raw){
  const clean=freshBase()
  for(const key of ['farmHarvested','helpedHarvests','mobilizationDiscounts'])if(Number.isFinite(raw?.[key]))clean[key]=Math.max(0,Math.min(10000000,Math.floor(raw[key])))
  const t=raw?.farmTask
  if(t&&['help','self'].includes(t.type)&&Number.isInteger(t.workers)&&t.workers>=1&&Number.isFinite(t.elapsed)&&t.elapsed>=0&&t.elapsed<FARM.duration&&CROPS.some(crop=>crop.id===t.crop)){
    const children=new Set(s.formations.flatMap(unit=>unit.children||[])),ids=t.unitIds
    const field=mapField(t.fieldId)
    const allocation=t.allocations!==undefined&&t.type==='help'&&field?.crop===t.crop?validateAllocations(s,field.villageId,t.allocations,ids):null
    if(t.allocations!==undefined&&(!allocation?.ok||allocation.workers!==t.workers))return clean
    const grouped=allocation?.ok||Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>s.formations.some(unit=>unit.id===id)&&!children.has(id))&&ids.reduce((sum,id)=>sum+s.formations.find(unit=>unit.id===id).troops,0)===t.workers
    const local=grouped&&field&&ids.some(id=>villageOfFormation(s,id)===field.villageId)
    if(grouped||(!ids&&t.workers<=Math.min(FARM.maxWorkers,reserve(s))))clean.farmTask={type:t.type,workers:t.workers,crop:t.crop,elapsed:t.elapsed,...(grouped?{unitIds:[...ids]}:{}),...(t.type==='help'&&field?.crop===t.crop?{fieldId:field.id}:{}),...(local?{villageId:field.villageId}:{}),...(allocation?.ok?{allocations:allocation.allocations}:{})}
  }
  return clean
}
export function startFarming(s,type,workers,crop='millet',unitIds=null,fieldId=null,allocations=null){
  if(s.farmTask)return {ok:false,message:'已有耕作进行中，请先完成或取消'}
  if(!['help','self'].includes(type)||!CROPS.some(item=>item.id===crop))return {ok:false,message:'请选择有效的耕作方式和作物'}
  if(fieldId!==null){const field=mapField(fieldId);if(!field||type!=='help'||field.crop!==crop)return {ok:false,message:'请选择有效的乡亲田地'}}
  let allocation=null;const field=mapField(fieldId)
  if(allocations!==null){
    allocation=type==='help'&&field?validateAllocations(s,field.villageId,allocations,unitIds):null
    if(!allocation?.ok)return allocation||{ok:false,message:'请从本村田地选择派遣部队'}
    workers=allocation.workers
  }else if(unitIds!==null){
    const children=new Set(s.formations.flatMap(unit=>unit.children||[]))
    if(!Array.isArray(unitIds)||!unitIds.length||new Set(unitIds).size!==unitIds.length)return {ok:false,message:'请选择不同的独立部队'}
    if(unitIds.some(id=>!s.formations.some(unit=>unit.id===id)||children.has(id)))return {ok:false,message:'只能派出独立编制，上级包含全部下属'}
    if(unitIds.some(id=>formationActivity(s,id,!!field&&villageOfFormation(s,id)===field.villageId)))return {ok:false,message:'所选部队正在执行任务，请选择空闲人员或派遣部分分队'}
    workers=unitIds.reduce((sum,id)=>sum+s.formations.find(unit=>unit.id===id).troops,0)
  }else{
    if(!Number.isInteger(workers)||workers<1||workers>FARM.maxWorkers)return {ok:false,message:'耕作人数须为 1—100 的整数'}
    if(workers>reserve(s))return {ok:false,message:`未编人员不足，当前可派 ${Math.max(0,reserve(s))} 人`}
  }
  if(hungerStatus(s).disabled)return {ok:false,message:'部队极度饥饿，请先到灶房供餐再耕作'}
  const local=field&&unitIds?.some(id=>villageOfFormation(s,id)===field.villageId)
  s.farmTask={type,workers,crop,elapsed:0,...(unitIds?{unitIds:[...unitIds]}:{}),...(fieldId?{fieldId}:{}),...(local?{villageId:field.villageId}:{}),...(allocation?{allocations:allocation.allocations}:{})};return {ok:true}
}
export function advanceFarming(s,seconds,canWork=!hungerStatus(s).disabled,random=Math.random){
  const task=s.farmTask
  if(!task||!Number.isFinite(seconds)||seconds<=0||!canWork)return null
  task.elapsed=Math.min(FARM.duration,task.elapsed+seconds)
  if(task.elapsed<FARM.duration)return null
  const result={type:task.type,workers:task.workers,crop:task.crop,amount:0,recruited:0,supplies:{}}
  if(task.type==='help'){
    s.mobilizationDiscounts=Math.min(10000000,s.mobilizationDiscounts+task.workers)
    s.helpedHarvests=Math.min(10000000,s.helpedHarvests+task.workers)
    const village=mapField(task.fieldId)?.villageId,room=RECRUITMENT.troopLimit-totalPersonnel(s)
    result.recruited=village?takeVillageRecruits(s,village,room,random):Math.max(0,Math.min(RECRUITMENT.batch,room))
    s.troops+=result.recruited;s.recruitedTroops=Math.min(RECRUITMENT.troopLimit,s.recruitedTroops+result.recruited)
    if(result.recruited)s.recruitmentCount=Math.min(RECRUITMENT.troopLimit,s.recruitmentCount+1)
    if(village&&result.recruited){const record=mobilizationRecord(s,village,true);record.recruitedTroops=Math.min(RECRUITMENT.troopLimit,record.recruitedTroops+result.recruited);record.recruitmentCount=Math.min(RECRUITMENT.troopLimit,record.recruitmentCount+1)}
  }else{
    result.amount=Math.min(task.workers*FARM.grainPerWorker,10000000-s[task.crop]);s[task.crop]+=result.amount
    s.farmHarvested=Math.min(10000000,s.farmHarvested+result.amount)
  }
  s.farmTask=null;return result
}
export function cancelFarming(s){if(!s.farmTask)return false;s.farmTask=null;return true}
