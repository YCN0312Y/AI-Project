import {formationActivity} from './base.js'
import {hungerStatus} from './logistics.js'
import {isVillage,unitVillage,villageRegionId} from './villages.js'
import {detachGarrison,garrisonSite,lineageRows,recallToStandby} from './state.js'
import {PROJECT_UNIT_LIMIT,removeTaskUnit,validateAllocations} from './workforce.js'
import {MATERIAL_LIMIT} from './gathering.js'
import {LEGACY_BULLET_IDS,restoreBulletCount} from './weapons.js'

export const FACILITY_INTERVAL=60
const LEGACY_ARMORY_INTERVAL=300
const ARMORY_CLOCK_VERSION=2
export const PRODUCTS=[
  {id:'rifle',name:'步枪',unit:'把',workers:7,recipe:{ore:10,wood:5}},
  {id:'pistol',name:'手枪',unit:'把',workers:5,recipe:{ore:5,wood:2}},
  {id:'grenades',name:'手雷',unit:'枚',workers:3,recipe:{ore:5}},
  {id:'bullets',name:'子弹',unit:'发',workers:1,batchSize:10,batchesPerCycle:10,recipe:{ore:1}},
]
const bounded=value=>Number.isFinite(value)?Math.max(0,Math.min(MATERIAL_LIMIT,Math.floor(value))):0
export const freshFacilities=()=>({armoryTasks:{},armoryClockVersion:ARMORY_CLOCK_VERSION,productionTotals:Object.fromEntries(PRODUCTS.map(product=>[product.id,0]))})
const armoryProducts=new Map(PRODUCTS.map(product=>[product.id,product]))
const productionStock=(s,product)=>product.unit==='把'?s.weaponCounts:s
export const productionInventory=(s,product)=>productionStock(s,product)[product.id]
export function productionCapacity(s,product,workers){
  const batchSize=product.batchSize||1
  const staffed=workers>=product.workers?(product.batchesPerCycle??Math.floor(workers/product.workers)):0
  const batches=Math.min(Math.floor((MATERIAL_LIMIT-productionInventory(s,product))/batchSize),staffed,...Object.entries(product.recipe).map(([id,cost])=>Math.floor(s.materials[id]/cost)))
  return Math.max(0,batches)*batchSize
}
function validateWorkers(s,ids,villageId=null){
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return {ok:false,message:'请至少选择一支不同的独立部队'}
  const children=new Set(s.formations.flatMap(unit=>unit.children||[]))
  if(ids.some(id=>!s.formations.some(unit=>unit.id===id)||children.has(id)))return {ok:false,message:'请选择独立编制，上级会带领全部下属'}
  if(villageId!==null&&(!isVillage(villageId)||ids.some(id=>unitVillage(s,id)!==villageId)))return {ok:false,message:'只能安排设施所在村庄的驻军工作'}
  if(ids.some(id=>formationActivity(s,id,villageId!==null)))return {ok:false,message:'所选部队正在执行其他任务，请先召回归队'}
  return {ok:true,workers:ids.reduce((sum,id)=>sum+s.formations.find(unit=>unit.id===id).troops,0)}
}
const wholeUnitAllocations=(s,ids)=>ids.map(unitId=>({unitId,troops:s.formations.find(unit=>unit.id===unitId).troops,type:'group'}))
function mergeBulletWork(s,current,task){
  if(current.allocations||task.allocations){
    const allocations=new Map()
    for(const assignment of [...(current.allocations??wholeUnitAllocations(s,current.unitIds)),...(task.allocations??wholeUnitAllocations(s,task.unitIds))]){
      const previous=allocations.get(assignment.unitId)
      allocations.set(assignment.unitId,previous?{unitId:assignment.unitId,troops:previous.troops+assignment.troops,type:'group'}:assignment)
    }
    current.allocations=[...allocations.values()]
  }
  current.unitIds=[...new Set([...current.unitIds,...task.unitIds])]
  current.workers+=task.workers
  current.elapsed=Math.max(current.elapsed,task.elapsed)
  delete current.cycleWorkers
}
export function normalizeFacilities(s,raw){
  const clean=freshFacilities()
  Object.assign(s,clean)
  for(const product of PRODUCTS)clean.productionTotals[product.id]=bounded(raw?.productionTotals?.[product.id])
  clean.productionTotals.bullets=restoreBulletCount(raw?.productionTotals)
  const restore=(task,product,savedInterval)=>{
    if(!task||!Number.isFinite(task.elapsed)||task.elapsed<0||task.elapsed>=savedInterval)return null
    const villageId=s.facilityVillages?.armory||null
    if(task.villageId!==undefined&&task.villageId!==villageId)return null
    const check=task.allocations!==undefined?validateAllocations(s,villageId,task.allocations,task.unitIds,true):validateWorkers(s,task.unitIds,villageId)
    if(!check.ok||task.workers!==check.workers)return null
    const elapsed=savedInterval===FACILITY_INTERVAL?task.elapsed:task.elapsed*FACILITY_INTERVAL/savedInterval
    return {unitIds:[...task.unitIds],workers:check.workers,elapsed,product,...(villageId?{villageId}:{}),...(check.allocations?{allocations:check.allocations}:{})}
  }
  const savedWork=id=>raw?.armoryTasks?.[id]??(raw?.armoryTask?.product===id?raw.armoryTask:null)
  for(const product of PRODUCTS){
    const id=product.id,sources=id==='bullets'&&!savedWork(id)?LEGACY_BULLET_IDS:[id]
    const oneMinute=raw?.armoryClockVersion===ARMORY_CLOCK_VERSION||(raw?.armoryClockVersion===1&&product.unit==='发')
    for(const source of sources){
      const saved=savedWork(source)
      const task=saved?.product===source?restore(saved,id,oneMinute?FACILITY_INTERVAL:LEGACY_ARMORY_INTERVAL):null
      if(!task)continue
      if(task.elapsed>0&&Number.isInteger(saved.cycleWorkers)&&saved.cycleWorkers>=product.workers&&saved.cycleWorkers<task.workers)task.cycleWorkers=saved.cycleWorkers
      if(clean.armoryTasks[id])mergeBulletWork(s,clean.armoryTasks[id],task)
      else clean.armoryTasks[id]=task
    }
  }
  Object.assign(s,clean);return clean
}
export function startProduction(s,ids,productId,villageId=s.facilityVillages?.armory||null,allocations=null){
  const product=armoryProducts.get(productId)
  if(!product)return {ok:false,message:'请选择有效的生产项目'}
  const id=product.id,current=s.armoryTasks[id]
  if(villageId!==(s.facilityVillages?.armory||null))return {ok:false,message:'请在兵工厂所在村庄安排生产'}
  if(Array.isArray(ids)){
    if(ids.some(id=>current?.unitIds.includes(id)))return {ok:false,message:'这支部队已在本产线工作'}
    if((current?.unitIds.length??0)+ids.length>PROJECT_UNIT_LIMIT)return {ok:false,message:`每条产线最多派 ${PROJECT_UNIT_LIMIT} 支部队`}
  }
  const check=allocations!==null?validateAllocations(s,villageId,allocations,ids):validateWorkers(s,ids,villageId)
  if(!check.ok)return check
  if(!current&&check.workers<product.workers)return {ok:false,message:`生产${product.name}至少需要${product.workers}人`}
  if(hungerStatus(s).disabled)return {ok:false,message:'部队极度饥饿，请先供餐再安排生产'}
  if(current){
    if(current.workers<product.workers)current.elapsed=0
    else if(current.elapsed>0)current.cycleWorkers??=current.workers
    if(current.allocations||check.allocations){
      current.allocations=[...(current.allocations??wholeUnitAllocations(s,current.unitIds)),...(check.allocations??wholeUnitAllocations(s,ids))]
    }
    current.unitIds.push(...ids)
    current.workers+=check.workers
    return {ok:true}
  }
  s.armoryTasks[id]={unitIds:[...ids],workers:check.workers,product:id,elapsed:0,...(villageId?{villageId}:{}),...(check.allocations?{allocations:check.allocations}:{})}
  return {ok:true}
}
export function recallFacility(s,kind,unitId=null){
  const task=s.armoryTasks[kind]
  if(!task)return false
  const recalled=unitId===null?[...task.unitIds]:[unitId]
  if(unitId!==null&&!removeTaskUnit(s,task,unitId))return false
  if(unitId===null||!task.unitIds.length)delete s.armoryTasks[kind]
  else if(task.cycleWorkers!==undefined&&task.cycleWorkers<armoryProducts.get(kind).workers){
    task.elapsed=0;delete task.cycleWorkers
  }
  for(const {unit} of lineageRows(s.formations)){
    if(!recalled.includes(unit.id)||unit.splitParent===undefined||formationActivity(s,unit.id,true))continue
    if(!s.formations.some(parent=>parent.id===unit.splitParent&&parent.id!==unit.id))continue
    const station=garrisonSite(s,unit.id)
    if(station===null&&unit.splitOrigin===undefined&&task.villageId)unit.splitOrigin=villageRegionId(task.villageId)
    const {destination,waitingForParent}=recallToStandby(s,unit.id)
    if(station===destination&&!waitingForParent)delete unit.splitOrigin
    else if(station!==null)detachGarrison(s,station,unit.id)
  }
  return true
}
export function facilityRunning(s,kind){
  const task=s.armoryTasks[kind],product=armoryProducts.get(kind)
  return !!task&&!!product&&productionCapacity(s,product,task.cycleWorkers??task.workers)>0
}
export function nextFacilityEvent(s){
  return Math.min(...PRODUCTS.filter(product=>facilityRunning(s,product.id)).map(product=>FACILITY_INTERVAL-s.armoryTasks[product.id].elapsed),Infinity)
}
export function advanceFacilities(s,seconds,canWork=!hungerStatus(s).disabled){
  const result={produced:[]}
  if(!canWork||!Number.isFinite(seconds)||seconds<=0)return result
  let remaining=seconds
  while(remaining>0){
    const active=PRODUCTS.filter(product=>facilityRunning(s,product.id))
    if(!active.length)break
    const step=Math.min(remaining,...active.map(product=>FACILITY_INTERVAL-s.armoryTasks[product.id].elapsed))
    for(const product of active)s.armoryTasks[product.id].elapsed+=step
    for(const product of active){
      const task=s.armoryTasks[product.id]
      if(task.elapsed<FACILITY_INTERVAL-1e-8)continue
      task.elapsed=Math.max(0,task.elapsed-FACILITY_INTERVAL)
      const amount=productionCapacity(s,product,task.cycleWorkers??task.workers)
      delete task.cycleWorkers
      if(!amount)continue
      const stock=productionStock(s,product)
      for(const [id,cost] of Object.entries(product.recipe))s.materials[id]-=cost*(amount/(product.batchSize||1))
      stock[product.id]+=amount
      s.productionTotals[product.id]=Math.min(MATERIAL_LIMIT,s.productionTotals[product.id]+amount)
      result.produced.push({product:product.id,amount})
    }
    remaining-=step
  }
  return result
}
