import {formationActivity} from './base.js'
import {hungerStatus,RECRUITMENT} from './logistics.js'
import {isVillage,villageOfFormation} from './villages.js'
import {validateAllocations} from './workforce.js'

export const FACILITY_INTERVAL=300
export const PRODUCTS=[{id:'rifle',name:'步枪',workers:7},{id:'pistol',name:'手枪',workers:5},{id:'grenades',name:'手雷',workers:3}]
export const WARDS={light:{name:'轻伤部',workers:2,capacity:10,interval:30,sessions:1,deathChance:.1},heavy:{name:'重伤部',workers:5,capacity:2,interval:120,sessions:3,deathChance:.4}}
export const CASUALTY_RULES={woundedFraction:.5,heavyFraction:.5}
const bounded=value=>Number.isFinite(value)?Math.max(0,Math.min(10000000,Math.floor(value))):0
export const freshFacilities=()=>({armoryTask:null,medicalTasks:{light:null,heavy:null},wounded:{light:0,heavy:0},pendingBattleCasualties:null,heavyTreatmentStages:[0,0,0],productionTotals:{rifle:0,pistol:0,grenades:0},medicalDeaths:0,recoveredTroops:0,battleDeaths:0})
export const facilityInterval=kind=>kind==='armory'?FACILITY_INTERVAL:WARDS[kind].interval
function medicalBatch(s,ward,workers){
  const spec=WARDS[ward],selected=ward==='heavy'?[0,0,0]:[0]
  let count=Math.min(s.wounded[ward],spec.capacity,Math.floor(workers/spec.workers))
  for(const stage of ward==='heavy'?[2,1,0]:[0]){selected[stage]=Math.min(count,ward==='heavy'?s.heavyTreatmentStages[stage]:s.wounded.light);count-=selected[stage]}
  return selected.some(n=>n>0)?selected:null
}
function validateWorkers(s,ids,villageId=null){
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return {ok:false,message:'请至少选择一支不同的独立部队'}
  const children=new Set(s.formations.flatMap(unit=>unit.children||[]))
  if(ids.some(id=>!s.formations.some(unit=>unit.id===id)||children.has(id)))return {ok:false,message:'请选择独立编制，上级会带领全部下属'}
  if(villageId!==null&&(!isVillage(villageId)||ids.some(id=>villageOfFormation(s,id)!==villageId)))return {ok:false,message:'只能安排设施所在村庄的驻军工作'}
  if(ids.some(id=>formationActivity(s,id,villageId!==null)))return {ok:false,message:'所选部队正在执行其他任务，请先召回归队'}
  return {ok:true,workers:ids.reduce((sum,id)=>sum+s.formations.find(unit=>unit.id===id).troops,0)}
}
export function normalizeFacilities(s,raw){
  const clean=freshFacilities()
  Object.assign(s,clean)
  let room=RECRUITMENT.troopLimit-s.troops
  for(const ward of ['light','heavy']){clean.wounded[ward]=Math.min(room,bounded(raw?.wounded?.[ward]));room-=clean.wounded[ward]}
  const pending=raw?.pendingBattleCasualties
  if(pending&&typeof pending.annihilated==='boolean'&&['total','light','heavy','dead'].every(key=>Number.isInteger(pending[key])&&pending[key]>=0&&pending[key]<=RECRUITMENT.troopLimit)&&pending.total>0&&pending.light+pending.heavy+pending.dead===pending.total){
    const light=pending.annihilated?0:Math.min(room,pending.light),heavy=pending.annihilated?0:Math.min(room-light,pending.heavy)
    clean.pendingBattleCasualties={total:pending.total,light,heavy,dead:pending.total-light-heavy,annihilated:pending.annihilated}
  }
  let heavy=clean.wounded.heavy
  for(const stage of [2,1]){clean.heavyTreatmentStages[stage]=Math.min(heavy,bounded(raw?.heavyTreatmentStages?.[stage]));heavy-=clean.heavyTreatmentStages[stage]}
  clean.heavyTreatmentStages[0]=heavy
  for(const key of ['medicalDeaths','recoveredTroops','battleDeaths'])clean[key]=bounded(raw?.[key])
  for(const product of PRODUCTS)clean.productionTotals[product.id]=bounded(raw?.productionTotals?.[product.id])
  const restore=(task,extra,kind)=>{
    if(!task||!Number.isFinite(task.elapsed)||task.elapsed<0||task.elapsed>=facilityInterval(kind))return null
    const villageId=s.facilityVillages?.[kind==='armory'?'armory':'medical']||null
    if(task.villageId!==undefined&&task.villageId!==villageId)return null
    const check=task.allocations!==undefined?validateAllocations(s,villageId,task.allocations,task.unitIds):validateWorkers(s,task.unitIds,villageId)
    if(!check.ok||task.workers!==check.workers)return null
    return {unitIds:[...task.unitIds],workers:check.workers,elapsed:task.elapsed,...extra,...(villageId?{villageId}:{}),...(check.allocations?{allocations:check.allocations}:{})}
  }
  const product=PRODUCTS.find(p=>p.id===raw?.armoryTask?.product)
  if(product){const task=restore(raw.armoryTask,{product:product.id},'armory');if(task&&task.workers>=product.workers)s.armoryTask=clean.armoryTask=task}
  for(const ward of ['light','heavy']){
    const task=restore(raw?.medicalTasks?.[ward],{ward},ward)
    if(task&&task.workers>=WARDS[ward].workers){
      const batch=raw.medicalTasks[ward].batch,available=ward==='heavy'?s.heavyTreatmentStages:[s.wounded.light]
      const valid=Array.isArray(batch)&&batch.length===available.length&&batch.every((n,i)=>Number.isInteger(n)&&n>=0&&n<=available[i])&&batch.some(n=>n>0)&&batch.reduce((a,b)=>a+b,0)<=Math.min(WARDS[ward].capacity,Math.floor(task.workers/WARDS[ward].workers))
      task.batch=valid?[...batch]:null
      if(!valid)task.elapsed=0
      s.medicalTasks[ward]=clean.medicalTasks[ward]=task
    }
  }
  Object.assign(s,clean);return clean
}
export function startProduction(s,ids,productId,villageId=s.facilityVillages?.armory||null,allocations=null){
  if(s.armoryTask)return {ok:false,message:'兵工厂已有部队驻厂，请先召回后调整'}
  if(villageId!==(s.facilityVillages?.armory||null))return {ok:false,message:'请在兵工厂所在村庄安排生产'}
  const product=PRODUCTS.find(p=>p.id===productId),check=allocations!==null?validateAllocations(s,villageId,allocations,ids):validateWorkers(s,ids,villageId)
  if(!check.ok)return check
  if(!product)return {ok:false,message:'请选择有效的生产项目'}
  if(check.workers<product.workers)return {ok:false,message:`生产${product.name}至少需要${product.workers}人`}
  if(hungerStatus(s).disabled)return {ok:false,message:'部队极度饥饿，请先供餐再安排生产'}
  s.armoryTask={unitIds:[...ids],workers:check.workers,product:productId,elapsed:0,...(villageId?{villageId}:{}),...(check.allocations?{allocations:check.allocations}:{})};return {ok:true}
}
export function startTreatment(s,ward,ids,villageId=s.facilityVillages?.medical||null,allocations=null){
  if(!WARDS[ward])return {ok:false,message:'请选择轻伤部或重伤部'}
  if(s.medicalTasks[ward])return {ok:false,message:'该部门已派驻部队，请先召回后调整'}
  if(villageId!==(s.facilityVillages?.medical||null))return {ok:false,message:'请在医疗部所在村庄安排治疗'}
  const check=allocations!==null?validateAllocations(s,villageId,allocations,ids):validateWorkers(s,ids,villageId)
  if(!check.ok)return check
  if(check.workers<WARDS[ward].workers)return {ok:false,message:`${WARDS[ward].name}至少需要${WARDS[ward].workers}人`}
  if(hungerStatus(s).disabled)return {ok:false,message:'部队极度饥饿，请先供餐再安排医疗工作'}
  s.medicalTasks[ward]={unitIds:[...ids],workers:check.workers,ward,elapsed:0,batch:medicalBatch(s,ward,check.workers),...(villageId?{villageId}:{}),...(check.allocations?{allocations:check.allocations}:{})};return {ok:true}
}
export function recallFacility(s,kind){
  if(kind==='armory'){if(!s.armoryTask)return false;s.armoryTask=null;return true}
  if(!s.medicalTasks?.[kind])return false
  s.medicalTasks[kind]=null;return true
}
export function facilityRunning(s,kind){
  if(kind==='armory')return !!s.armoryTask&&(s.armoryTask.product==='grenades'?s.grenades:s.weaponCounts[s.armoryTask.product])<10000000
  return !!s.medicalTasks?.[kind]&&s.wounded[kind]>0&&s.troops<RECRUITMENT.troopLimit
}
export function nextFacilityEvent(s){
  return Math.min(...['armory','light','heavy'].filter(kind=>facilityRunning(s,kind)).map(kind=>facilityInterval(kind)-(kind==='armory'?s.armoryTask:s.medicalTasks[kind]).elapsed),Infinity)
}
export function advanceFacilities(s,seconds,canWork=!hungerStatus(s).disabled,random=Math.random){
  const result={produced:[],treated:[]}
  if(!canWork||!Number.isFinite(seconds)||seconds<=0)return result
  for(const kind of ['armory','light','heavy']){
    const task=kind==='armory'?s.armoryTask:s.medicalTasks?.[kind]
    if(!task||!facilityRunning(s,kind))continue
    if(kind!=='armory'&&!task.batch)task.batch=medicalBatch(s,kind,task.workers)
    task.elapsed+=seconds
    while(task.elapsed>=facilityInterval(kind)-1e-8&&facilityRunning(s,kind)){
      task.elapsed=Math.max(0,task.elapsed-facilityInterval(kind))
      if(kind==='armory'){
        const product=PRODUCTS.find(p=>p.id===task.product),stock=product.id==='grenades'?s:s.weaponCounts
        const amount=Math.min(10000000-stock[product.id],Math.floor(task.workers/product.workers))
        stock[product.id]+=amount;s.productionTotals[product.id]=Math.min(10000000,s.productionTotals[product.id]+amount)
        result.produced.push({product:product.id,amount})
      }else{
        const spec=WARDS[kind],count=task.batch.reduce((sum,n)=>sum+n,0)
        let dead=0,healed=0
        if(kind==='heavy'){
          // 优先完成已治疗的患者；先选出本轮患者，防止同一人在一轮内连治多次。
          const selected=task.batch
          for(const stage of [2,1,0]){
            s.heavyTreatmentStages[stage]-=selected[stage]
            for(let i=0;i<selected[stage];i++){
              if(random()<spec.deathChance)dead++
              else if(stage===spec.sessions-1)healed++
              else s.heavyTreatmentStages[stage+1]++
            }
          }
        }else for(let i=0;i<count;i++){if(random()<spec.deathChance)dead++;else healed++}
        s.wounded[kind]-=dead+healed;s.troops+=healed
        s.medicalDeaths=Math.min(10000000,s.medicalDeaths+dead);s.recoveredTroops=Math.min(10000000,s.recoveredTroops+healed)
        result.treated.push({ward:kind,attempted:count,healed,dead})
        task.batch=medicalBatch(s,kind,task.workers)
      }
    }
    if(!facilityRunning(s,kind))task.elapsed=0
  }
  return result
}
export function battleAnnihilated(battle){
  return battle.mode==='campaign'&&!battle.won&&Array.isArray(battle.units)&&battle.units.length>0&&battle.units.every(unit=>Number.isFinite(unit.hp)&&unit.hp<=0)
}
export function recordBattleCasualties(s,battle,count){
  const before=battle.classifiedCasualties||0,total=before+count
  const woundedBefore=Math.floor(before*CASUALTY_RULES.woundedFraction),woundedTotal=Math.floor(total*CASUALTY_RULES.woundedFraction)
  const wounded=woundedTotal-woundedBefore,heavy=Math.floor(woundedTotal*CASUALTY_RULES.heavyFraction)-Math.floor(woundedBefore*CASUALTY_RULES.heavyFraction),light=wounded-heavy,dead=count-wounded
  battle.classifiedCasualties=total;battle.directDeaths=(battle.directDeaths||0)+dead;battle.woundedLight=(battle.woundedLight||0)+light;battle.woundedHeavy=(battle.woundedHeavy||0)+heavy
  const annihilated=battleAnnihilated(battle)
  s.pendingBattleCasualties={total,light:annihilated?0:battle.woundedLight,heavy:annihilated?0:battle.woundedHeavy,dead:annihilated?total:battle.directDeaths,annihilated}
  return {light,heavy,dead}
}
function applyCasualties(s,record){
  const room=RECRUITMENT.troopLimit-s.troops-s.wounded.light-s.wounded.heavy
  const light=record.annihilated?0:Math.min(room,record.light),heavy=record.annihilated?0:Math.min(room-light,record.heavy),dead=record.total-light-heavy
  s.wounded.light+=light;s.wounded.heavy+=heavy;s.heavyTreatmentStages[0]+=heavy;s.battleDeaths=Math.min(10000000,s.battleDeaths+dead)
  return {light,heavy,dead}
}
export function finalizeBattleCasualties(s,battle){
  if(battle.casualtiesFinalized)return
  const record={total:battle.classifiedCasualties||0,light:battle.woundedLight||0,heavy:battle.woundedHeavy||0,annihilated:battleAnnihilated(battle)}
  const result=applyCasualties(s,record)
  battle.directDeaths=result.dead;battle.woundedLight=result.light;battle.woundedHeavy=result.heavy;battle.annihilated=record.annihilated
  battle.casualtiesFinalized=true;s.pendingBattleCasualties=null
}
export function recoverPendingBattleCasualties(s){
  if(!s.pendingBattleCasualties)return false
  const record=s.pendingBattleCasualties;s.pendingBattleCasualties=null
  applyCasualties(s,record);return true
}
