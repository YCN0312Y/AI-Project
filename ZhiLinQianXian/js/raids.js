import {ALL_VILLAGES,MAP_REGIONS,OCCUPIABLE_SITES,mapRegion} from './world-map.js'
import {CampaignBattle,campaignDeployment} from './campaign.js'
import {formationRoots,formationName,settle,syncIdleBranches} from './state.js'
import {hungerStatus} from './logistics.js'
import {WEAPONS} from './weapons.js'
import {assignFormations,formationActivity} from './base.js'
import {villageLocalUnits,evacuateVillage} from './villages.js'
import {availableWorkforce} from './workforce.js'
import {cancelTrainingTask,trainedCombatGroups,trainingTaskAt} from './training.js'
import {marchRoute,marchPosition,routeLength} from './marching.js'
import {regionRecord,survivingEnemyUnits} from './regions.js'

export const RAID_INTERVAL=300
export const RAID_RESPONSE_WINDOW=20
export const RAID_TRAVEL_SECONDS=12
export const RAID_ALERT_LIMIT=3
const RAID_REPORT_MS=10000
const RAID_FORCE_LIMIT=120
const villageDefenseDuties=['farm','armory','bandages','medical-light','medical-heavy','training']
export const freshRaids=()=>({raidElapsed:0,raidSerial:0,raidAlerts:[],raidReports:[]})
const raidSites=[...ALL_VILLAGES,...MAP_REGIONS.filter(site=>!site.villageId)]
const sitesById=new Map(raidSites.map(site=>[site.id,site]))
export const raidSite=id=>sitesById.get(id)
export const raidOrigin=alert=>mapRegion(alert?.originId)
const raidRoutes=new WeakMap()
const resolveRaidOrigin=(s,target)=>{
  let nearest=null,best=Infinity
  for(const site of OCCUPIABLE_SITES){
    if(site.id===(target.regionId||target.id)||!s.mapRegions[site.id]?.enemies.length)continue
    const distance=Math.hypot(site.x-target.x,site.y-target.y)
    if(distance<best){nearest=site;best=distance}
  }
  return nearest
}
export const raidApproaching=alert=>!!raidOrigin(alert)&&alert.responseSeconds>RAID_RESPONSE_WINDOW-RAID_TRAVEL_SECONDS+1e-8
export function raidMarch(alert){
  if(!raidApproaching(alert))return null
  let path=raidRoutes.get(alert)
  if(!path){
    const route=marchRoute(raidSite(alert.siteId),alert.originId)
    path={route,length:routeLength(route)};raidRoutes.set(alert,path)
  }
  const progress=(RAID_RESPONSE_WINDOW-alert.responseSeconds)/RAID_TRAVEL_SECONDS
  return {route:path.route,position:marchPosition({route:path.route,travelled:path.length*progress})}
}
export const raidOutcomeLabel={won:'已击退敌袭',lost:'防守失败',undefended:'无可应敌驻军'}
export const raidReportStatus=report=>report.occupied?'失守 · 敌军占领':raidOutcomeLabel[report.outcome]
const validRaid=raid=>raid&&Number.isSafeInteger(raid.id)&&raid.id>=1&&raidSite(raid.siteId)&&Number.isInteger(raid.force)&&raid.force>=1&&raid.force<=RAID_FORCE_LIMIT
const reportCount=value=>Number.isSafeInteger(value)&&value>0?value:0
const reportVisible=(report,now)=>Number.isSafeInteger(report.expiresAt)&&report.expiresAt>now
function raidReport(alert,outcome,result={}){
  const {id,siteId,force}=alert
  const counts=['kills','lostTroops','directDeaths','woundedLight','woundedHeavy','coins','xp']
  const capturedWeapons=Object.fromEntries(WEAPONS.map(weapon=>[weapon.id,reportCount(result.capturedWeapons?.[weapon.id])]))
  const deploymentCounts=Number.isSafeInteger(result.deployedTroops)?{deployedTroops:reportCount(result.deployedTroops),unarmedTroops:reportCount(result.unarmedTroops)}:{}
  const origin=raidOrigin(alert)
  const occupation=outcome!=='won'&&result.occupied===true?{occupied:true,enemyTroops:reportCount(result.enemyTroops)}:{}
  return {id,siteId,force,outcome,expiresAt:result.expiresAt,...(origin?{originId:origin.id}:{}),...deploymentCounts,...occupation,...Object.fromEntries(counts.map(key=>[key,reportCount(result[key])])),capturedWeapons}
}
const raidGarrison=(s,site)=>{
  if(!site||site.type==='village'&&site.id===s.baseVillageId)return []
  if(site.type==='village'){
    if(s.mapRegions[site.regionId||site.id]?.enemies.length)return []
    return s.garrisons[site.id]||[]
  }
  const record=s.mapRegions[site.id]
  return record&&!record.enemies.length?record.garrisonIds:[]
}
export function normalizeRaids(s,raw){
  Object.assign(s,freshRaids())
  if(Number.isFinite(raw?.raidElapsed))s.raidElapsed=Math.max(0,Math.min(RAID_INTERVAL,raw.raidElapsed))
  if(Number.isSafeInteger(raw?.raidSerial)&&raw.raidSerial>=0)s.raidSerial=raw.raidSerial
  const ids=new Set(),locations=new Set()
  for(const alert of Array.isArray(raw?.raidAlerts)?raw.raidAlerts:[]){
    if(s.raidAlerts.length>=RAID_ALERT_LIMIT)break
    if(!validRaid(alert)||ids.has(alert.id)||locations.has(alert.siteId)||!raidGarrison(s,raidSite(alert.siteId)).length)continue
    const responseSeconds=Number.isFinite(alert.responseSeconds)?Math.max(0,Math.min(RAID_RESPONSE_WINDOW,alert.responseSeconds)):RAID_RESPONSE_WINDOW
    const target=raidSite(alert.siteId),savedOrigin=raidOrigin(alert)
    const origin=savedOrigin&&savedOrigin.id!==(target.regionId||target.id)?savedOrigin:resolveRaidOrigin(s,target)
    ids.add(alert.id);locations.add(alert.siteId);s.raidSerial=Math.max(s.raidSerial,alert.id)
    s.raidAlerts.push({id:alert.id,siteId:alert.siteId,force:alert.force,responseSeconds,...(origin?{originId:origin.id}:{})})
  }
  const now=Date.now()
  for(const report of Array.isArray(raw?.raidReports)?raw.raidReports:[]){
    if(s.raidReports.length>=RAID_ALERT_LIMIT)break
    if(!validRaid(report)||ids.has(report.id)||!Object.hasOwn(raidOutcomeLabel,report.outcome))continue
    ids.add(report.id);s.raidSerial=Math.max(s.raidSerial,report.id)
    if(!reportVisible(report,now))continue
    s.raidReports.push(raidReport(report,report.outcome,report))
  }
}
export function advanceRaids(s,seconds,random=Math.random,manualRaidId=null){
  const result={alert:null,changed:false,due:[]}
  if(s.raidReports.length){
    const now=Date.now()
    if(s.raidReports.some(report=>!reportVisible(report,now))){
      s.raidReports=s.raidReports.filter(report=>reportVisible(report,now));result.changed=true
    }
  }
  if(!Number.isFinite(seconds)||seconds<=0)return result
  for(const alert of [...s.raidAlerts]){
    if(alert.id===manualRaidId)continue
    if(!raidGarrison(s,raidSite(alert.siteId)).length){
      s.raidAlerts=s.raidAlerts.filter(entry=>entry.id!==alert.id);result.changed=true;continue
    }
    alert.responseSeconds=Math.max(0,alert.responseSeconds-seconds)
    if(alert.responseSeconds<=1e-8)result.due.push(alert.id)
  }
  if(s.raidAlerts.length>=RAID_ALERT_LIMIT)return result
  if(!Object.values(s.garrisons).some(ids=>ids.length)&&!Object.values(s.mapRegions).some(record=>record.garrisonIds.length)){
    s.raidElapsed=0;return result
  }
  s.raidElapsed=Math.min(RAID_INTERVAL,s.raidElapsed+seconds)
  if(s.raidElapsed<RAID_INTERVAL)return result
  const occupied=new Set(s.raidAlerts.map(alert=>alert.siteId)),roots=new Map(formationRoots(s).map(unit=>[unit.id,unit]))
  const targets=raidSites.filter(site=>!occupied.has(site.id)&&raidGarrison(s,site).some(id=>roots.has(id)))
  if(!targets.length){s.raidElapsed=0;return result}
  const target=targets[Math.min(targets.length-1,Math.floor(random()*targets.length))]
  const origin=resolveRaidOrigin(s,target)
  if(!origin){s.raidElapsed=0;return result}
  const defenders=raidGarrison(s,target).reduce((total,id)=>total+(roots.get(id)?.troops||0),0)
  result.alert={id:++s.raidSerial,siteId:target.id,originId:origin.id,force:Math.max(4,Math.min(RAID_FORCE_LIMIT,Math.round(defenders*.65))),responseSeconds:RAID_RESPONSE_WINDOW}
  s.raidElapsed=0;s.raidAlerts.push(result.alert);result.changed=true
  return result
}
export function raidDeployment(s,id){
  const alert=s.raidAlerts.find(alert=>alert.id===id),site=raidSite(alert?.siteId)
  if(!site)return {ok:false,message:'这条驻地警报已处理'}
  const village=site.type==='village'
  const units=village&&raidGarrison(s,site).length?villageDefenders(s,site.id):raidGarrison(s,site).flatMap(id=>{
    const result=campaignDeployment(s,[id],true)
    return result.ok?result.units:[]
  })
  const troops=units.reduce((total,unit)=>total+unit.troops,0)
  const unarmedTroops=units.reduce((total,unit)=>total+(unit.groups.find(group=>group.weapon===null)?.troops||0),0)
  return {ok:!!units.length,site,alert,units,troops,unarmedTroops,message:village?'暂无可出战的本村士兵':'暂无空闲且配齐武器的驻军'}
}
function villageDefenders(s,villageId){
  const units=[]
  for(const unit of villageLocalUnits(s,villageId)){
    const activity=formationActivity(s,unit.id,true)
    if(activity&&!villageDefenseDuties.includes(activity))continue
    const troops=availableWorkforce(s,unit.id,true)
    if(!troops)continue
    const groups=[]
    let remaining=troops
    for(const group of trainedCombatGroups(s,unit.id)){
      if(!remaining)break
      const count=Math.min(remaining,group.troops)
      groups.push({...group,troops:count});remaining-=count
    }
    if(remaining)groups.push({weapon:null,troops:remaining,trainingBonus:0})
    units.push({id:unit.id,type:unit.type,name:formationName(unit),troops,groups})
  }
  return units
}
function interruptRaidTraining(s,deployment){
  if(deployment.site.type!=='village')return
  const villageId=deployment.site.id,training=trainingTaskAt(s,villageId)
  if(training&&deployment.units.some(unit=>unit.id===training.unitId))cancelTrainingTask(s,villageId)
}
export function assignRaidDefenders(s,deployment){
  const allowed=deployment.site.type==='village'?villageDefenseDuties:[]
  if(!assignFormations(s,deployment.units.map(unit=>unit.id),'battle',true,allowed))return false
  interruptRaidTraining(s,deployment)
  return true
}
function raidEnemyUnits(alert){
  const count=Math.ceil(alert.force/30)
  return Array.from({length:count},(_,i)=>{
    const troops=Math.floor(alert.force/count)+(i<alert.force%count?1:0)
    return {name:`来袭敌${i+1}队`,troops,type:troops<=12?'squad':'platoon',weapon:'rifle'}
  })
}
export function makeRaidBattle(deployment){
  const {alert,site,units}=deployment
  const battle=new CampaignBattle(1,units,raidEnemyUnits(alert))
  battle.raidId=alert.id;battle.raidSiteId=site.id;battle.regionName=site.name
  return battle
}
export function resolveRaidAutomatically(battle){
  const step=.05,limit=180/step
  for(let tick=0;tick<limit&&!battle.done;tick++){
    for(const unit of battle.units){
      if(unit.hp<=0)continue
      const range=Math.max(0,...unit.groups.map(group=>group.weapon?.range||0))
      if(!range)continue
      let target=null,distance=Infinity
      for(const enemy of battle.enemies){
        const gap=Math.hypot(enemy.x-unit.x,enemy.y-unit.y)
        if(enemy.hp>0&&gap<distance){target=enemy;distance=gap}
      }
      unit.target={x:unit.x,y:unit.y}
      if(target&&distance>=range){
        const approach=(distance-range+20)/distance
        unit.target={x:unit.x+(target.x-unit.x)*approach,y:unit.y+(target.y-unit.y)*approach}
      }
    }
    battle.update(step)
  }
  if(!battle.done){battle.won=raidRepelled(battle);battle.done=true}
}
export const raidRepelled=battle=>battle.pending===0&&!battle.enemies.some(unit=>unit.hp>0)
function captureRaidSite(s,site,enemies){
  const id=site.regionId||site.id,record=regionRecord(s,id)
  if(!enemies.length||!record)return {occupied:false}
  const enemyTroops=enemies.reduce((total,unit)=>total+unit.troops,0)
  record.enemies=site.type==='city'?[{name:'敌占守备团',type:'regiment',weapon:'rifle',troops:enemyTroops}]:enemies
  record.garrisonIds=[]
  if(site.type==='village')evacuateVillage(s,site.id)
  else{
    delete s.gatheringTasks[id]
    for(const unit of s.formations)if(unit.splitOrigin===id)delete unit.splitOrigin
  }
  s.marchingOrders=s.marchingOrders.filter(order=>order.kind==='village'?order.targetId!==site.id:order.targetId!==id)
  syncIdleBranches(s)
  return {occupied:true,enemyTroops}
}
export function autoDefendRaid(s,id){
  const deployment=raidDeployment(s,id)
  if(!deployment.alert||!deployment.site)return null
  const deploymentCounts={deployedTroops:deployment.troops,unarmedTroops:deployment.unarmedTroops}
  let report
  if(deployment.ok){
    const battle=makeRaidBattle(deployment)
    const hunger=hungerStatus(s)
    for(const key of ['damageMultiplier','intervalMultiplier','speedMultiplier'])battle[key]=hunger[key]
    resolveRaidAutomatically(battle)
    // 自动应敌一次结算完毕，保留玩家正在指挥的另一场战斗的伤亡记录。
    const pending=s.pendingBattleCasualties
    try{
      interruptRaidTraining(s,deployment)
      const result=settle(s,battle)
      const occupation=finishRaid(s,battle)
      report=raidReport(deployment.alert,battle.won?'won':'lost',{...result,...deploymentCounts,...occupation})
    }finally{s.pendingBattleCasualties=pending}
  }else{
    s.raidAlerts=s.raidAlerts.filter(alert=>alert.id!==id)
    const occupation=captureRaidSite(s,deployment.site,raidEnemyUnits(deployment.alert))
    report=raidReport(deployment.alert,'undefended',{...deploymentCounts,...occupation})
  }
  report.expiresAt=Date.now()+RAID_REPORT_MS
  s.raidReports=[report,...s.raidReports].slice(0,RAID_ALERT_LIMIT)
  return report
}
export function finishRaid(s,battle){
  const site=raidSite(battle.raidSiteId)
  if(!site)return
  s.raidAlerts=s.raidAlerts.filter(alert=>alert.id!==battle.raidId)
  if(!battle.won){
    const occupation=captureRaidSite(s,site,survivingEnemyUnits(battle))
    if(occupation.occupied)return occupation
  }
  const alive=new Set(formationRoots(s).map(unit=>unit.id))
  if(site.type==='village'){
    const survivors=(s.garrisons[site.id]||[]).filter(id=>alive.has(id))
    if(survivors.length)s.garrisons[site.id]=survivors
    else delete s.garrisons[site.id]
  }else s.mapRegions[site.id].garrisonIds=s.mapRegions[site.id].garrisonIds.filter(id=>alive.has(id))
  syncIdleBranches(s)
  return {occupied:false}
}
