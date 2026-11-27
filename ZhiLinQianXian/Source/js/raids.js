import {ALL_VILLAGES,MAP_REGIONS,OCCUPIABLE_SITES,mapRegion} from './world-map.js'
import {CampaignBattle,combatGroups,shareCounts} from './campaign.js'
import {formationRoots,formationName,FORMATION_TYPES,settle,syncIdleBranches,baseReserveTroops,BASE_RESERVE_ACTOR_ID} from './state.js'
import {hungerStatus,RECRUITMENT} from './logistics.js'
import {WEAPONS} from './weapons.js'
import {activeFormationIds,assignFormations,formationActivity} from './base.js'
import {unitVillage,villageLocalUnits,evacuateVillage} from './villages.js'
import {availableWorkforce,taskWorkersFrom} from './workforce.js'
import {roadMarch,marchPosition,routeLength,marchOrigin} from './marching.js'
import {normalizeEnemyUnits,regionEnemyTroops,regionLocalUnits,regionOwner,regionRecord,survivingEnemyUnits} from './regions.js'
import {reconcileGathering} from './gathering.js'

export const RAID_INTERVAL=300
export const RAID_RESPONSE_WINDOW=20
export const RAID_TRAVEL_SECONDS=12
export const RAID_ALERT_LIMIT=3
export const ENEMY_OCCUPATION_INTERVAL=300
const RAID_ARRIVAL_SECONDS=RAID_RESPONSE_WINDOW-RAID_TRAVEL_SECONDS
const RAID_REPORT_MS=10000
const MIN_RAID_INTERVAL=60
const RAID_ENEMY_INTERVAL=.45
const RAID_ENEMY_GROUP_LIMIT=8
const cityFormations=()=>FORMATION_TYPES.slice(FORMATION_TYPES.findIndex(kind=>kind.id==='regiment'))
const minimumForce=site=>site.type==='city'?cityFormations()[0].min:1
const villageDefenseDuties=['farm','armory']
const regionDefenseDuties=['gathering']
const defenseDuties=site=>site.type==='village'?villageDefenseDuties:regionDefenseDuties
export const freshRaids=()=>({raidElapsed:0,raidSerial:0,raidAlerts:[],raidReports:[],enemyOccupationElapsed:0,enemyOccupation:null})
const raidSites=[...ALL_VILLAGES,...MAP_REGIONS.filter(site=>!site.villageId)]
const sitesById=new Map(raidSites.map(site=>[site.id,site]))
export const raidSite=id=>sitesById.get(id)
export const raidOrigin=alert=>mapRegion(alert?.originId)
const raidRoutes=new WeakMap()
function dispatchRaidTroops(s,originId,force){
  const record=regionRecord(s,originId),sentUnits=[]
  const shares=shareCounts(record.enemies.map(unit=>unit.troops),force)
  record.enemies.forEach((unit,index)=>{
    const troops=shares[index]
    if(!troops)return
    sentUnits.push({...unit,troops})
    unit.troops-=troops
  })
  record.enemies=record.enemies.filter(unit=>unit.troops>0)
  return sentUnits
}
function returnRaidTroops(s,originId,sentUnits){
  if(!originId||regionOwner(s,originId)==='player')return
  const record=regionRecord(s,originId)
  for(const sent of sentUnits||[]){
    const existing=record.enemies.find(unit=>unit.name===sent.name&&unit.type===sent.type&&unit.weapon===sent.weapon)
    if(existing)existing.troops+=sent.troops
    else record.enemies.push({...sent})
  }
}
const resolveRaidOrigin=(s,target,engagedRegionId,leaveBehind=0)=>{
  const minimum=minimumForce(target)+leaveBehind
  let nearest=null,best=Infinity
  for(const site of OCCUPIABLE_SITES){
    if(site.id===engagedRegionId||site.id===(target.regionId||target.id)||regionEnemyTroops(s,site.id)<minimum)continue
    const distance=Math.hypot(site.x-target.x,site.y-target.y)
    if(distance<best){nearest=site;best=distance}
  }
  return nearest
}
const chooseSite=(sites,random)=>sites.length?sites[Math.min(sites.length-1,Math.floor(random()*sites.length))]:null
function chooseCityExpedition(s,targets,random,engagedRegionId,leaveBehind=0){
  const cities=targets.filter(site=>site.type==='city')
  if(!cities.length)return null
  const target=chooseSite(cities,random),origin=resolveRaidOrigin(s,target,engagedRegionId,leaveBehind)
  return origin?{target,origin}:null
}
export const raidApproaching=alert=>!!raidOrigin(alert)&&alert.responseSeconds>RAID_ARRIVAL_SECONDS+1e-8
function raidMarchPath(alert){
  let path=raidRoutes.get(alert)
  if(!path){
    const {route,stops}=roadMarch(raidSite(alert.siteId),alert.originId),length=routeLength(route)
    const checkpoints=stops.map(({siteId,pointIndex})=>({
      site:raidSite(mapRegion(siteId)?.villageId??siteId),
      responseSeconds:RAID_RESPONSE_WINDOW-RAID_TRAVEL_SECONDS*routeLength(route.slice(0,pointIndex+1))/length
    }))
    path={route,length,checkpoints};raidRoutes.set(alert,path)
  }
  return path
}
export function raidMarch(alert){
  if(!raidApproaching(alert))return null
  const path=raidMarchPath(alert)
  const progress=(RAID_RESPONSE_WINDOW-alert.responseSeconds)/RAID_TRAVEL_SECONDS
  return {route:path.route,position:marchPosition({route:path.route,travelled:path.length*progress})}
}
export function raidInterception(s,alert,untilResponseSeconds=RAID_ARRIVAL_SECONDS,manualSiteId){
  if(!raidApproaching(alert))return null
  for(const checkpoint of raidMarchPath(alert).checkpoints){
    const {site,responseSeconds}=checkpoint
    if(!site||responseSeconds>=alert.responseSeconds||responseSeconds+1e-8<untilResponseSeconds)continue
    if(raidDefenders(s,site).length||site.id===manualSiteId&&raidHasPresence(s,site))return site
  }
  return null
}
export const raidOutcomeLabel={won:'已击退敌袭',lost:'防守失败',undefended:'无可应敌驻军'}
export const raidReportStatus=report=>report.occupied?'失守 · 敌军占领':raidOutcomeLabel[report.outcome]
const validRaid=raid=>raid&&Number.isSafeInteger(raid.id)&&raid.id>=1&&raidSite(raid.siteId)&&Number.isInteger(raid.force)&&raid.force>=1&&raid.force<=RECRUITMENT.troopLimit
const reportCount=value=>Number.isSafeInteger(value)&&value>0?value:0
const reportVisible=(report,now)=>Number.isSafeInteger(report.expiresAt)&&report.expiresAt>now
const interceptedTarget=alert=>raidSite(alert.interceptedTargetId)
const isRaidBase=(s,site)=>site.type==='village'&&site.id===s.baseVillageId
function raidCanOccupy(s,alert,site){
  const owner=regionOwner(s,site.regionId||site.id)
  if(isRaidBase(s,site))return owner==='player'
  return !!(alert.occupation||site.type==='city'||interceptedTarget(alert))&&owner==='neutral'
}
function raidReport(alert,outcome,result={}){
  const {id,siteId,force}=alert
  const counts=['kills','lostTroops','coins','capturedBullets']
  const capturedWeapons=Object.fromEntries(WEAPONS.map(weapon=>[weapon.id,reportCount(result.capturedWeapons?.[weapon.id])]))
  const recoveredWeapons=Object.fromEntries(WEAPONS.map(weapon=>[weapon.id,reportCount(result.recoveredWeapons?.[weapon.id])]))
  const deploymentCounts=Number.isSafeInteger(result.deployedTroops)?{deployedTroops:reportCount(result.deployedTroops),unarmedTroops:reportCount(result.unarmedTroops)}:{}
  const origin=raidOrigin(alert)
  const intercepted=interceptedTarget(alert)
  const occupation=outcome!=='won'&&result.occupied===true?{occupied:true,enemyTroops:reportCount(result.enemyTroops),...(result.baseLost===true?{baseLost:true}:{})}:{}
  return {id,siteId,force,outcome,expiresAt:result.expiresAt,...(origin?{originId:origin.id}:{}),...(intercepted?{interceptedTargetId:intercepted.id}:{}),...deploymentCounts,...occupation,...Object.fromEntries(counts.map(key=>[key,reportCount(result[key])])),capturedWeapons,recoveredWeapons}
}
const factoryWorkersAt=(s,villageId)=>Object.values(s.armoryTasks).filter(task=>task.villageId===villageId)
const raidLocalUnits=(s,site)=>{
  if(site.type==='village'){
    if(s.mapRegions[site.regionId||site.id]?.enemies.length)return []
    const base=isRaidBase(s,site)
    const factoryIds=new Set(factoryWorkersAt(s,site.id).flatMap(task=>task.unitIds))
    if(!base&&!s.garrisons[site.id]?.length&&!factoryIds.size)return []
    const local=villageLocalUnits(s,site.id)
    const localIds=new Set(local.map(unit=>unit.id))
    return [...local,...formationRoots(s).filter(unit=>!localIds.has(unit.id)&&(factoryIds.has(unit.id)||base&&marchOrigin(s,unit.id)==='base'))]
  }
  const record=s.mapRegions[site.id]
  return record&&!record.enemies.length?regionLocalUnits(s,site.id):[]
}
const raidHasPresence=(s,site)=>raidLocalUnits(s,site).length>0||isRaidBase(s,site)&&baseReserveTroops(s)>0
export function normalizeRaids(s,raw){
  Object.assign(s,freshRaids())
  if(Number.isFinite(raw?.raidElapsed))s.raidElapsed=Math.max(0,Math.min(RAID_INTERVAL,raw.raidElapsed))
  if(Number.isFinite(raw?.enemyOccupationElapsed))s.enemyOccupationElapsed=Math.max(0,Math.min(ENEMY_OCCUPATION_INTERVAL,raw.enemyOccupationElapsed))
  if(Number.isSafeInteger(raw?.raidSerial)&&raw.raidSerial>=0)s.raidSerial=raw.raidSerial
  const ids=new Set(),locations=new Set(),directTargets=new Set()
  for(const alert of Array.isArray(raw?.raidAlerts)?raw.raidAlerts:[]){
    if(s.raidAlerts.length>=RAID_ALERT_LIMIT)break
    if(!validRaid(alert)||ids.has(alert.id))continue
    ids.add(alert.id)
    s.raidSerial=Math.max(s.raidSerial,alert.id)
    const responseSeconds=Number.isFinite(alert.responseSeconds)?Math.max(0,Math.min(RAID_RESPONSE_WINDOW,alert.responseSeconds)):RAID_RESPONSE_WINDOW
    const target=raidSite(alert.siteId),savedOrigin=raidOrigin(alert)
    const origin=savedOrigin&&savedOrigin.id!==(target.regionId||target.id)?savedOrigin:resolveRaidOrigin(s,target)
    const sentUnits=normalizeEnemyUnits(alert.sentUnits,origin?.type==='city')
    const dispatched=!!savedOrigin&&savedOrigin===origin&&sentUnits.reduce((sum,unit)=>sum+unit.troops,0)===alert.force
    const occupation=alert.occupation===true&&dispatched
    const originalTarget=dispatched?interceptedTarget(alert):null
    const minimum=originalTarget?1:minimumForce(target)
    const canOccupy=dispatched&&raidCanOccupy(s,alert,target)
    if(!originalTarget&&directTargets.has(target.id)||alert.force<minimum||!raidHasPresence(s,target)&&!canOccupy){
      if(dispatched)returnRaidTroops(s,origin.id,sentUnits)
      continue
    }
    if(!origin)continue
    const force=dispatched?alert.force:Math.min(alert.force,regionEnemyTroops(s,origin.id))
    if(force<minimum)continue
    locations.add(alert.siteId)
    if(!originalTarget)directTargets.add(alert.siteId)
    s.raidAlerts.push({id:alert.id,siteId:alert.siteId,force,responseSeconds:originalTarget?Math.min(RAID_ARRIVAL_SECONDS,responseSeconds):responseSeconds,originId:origin.id,sentUnits:dispatched?sentUnits:dispatchRaidTroops(s,origin.id,force),...(occupation?{occupation:true}:{}),...(originalTarget?{interceptedTargetId:originalTarget.id}:{})})
  }
  const order=raw?.enemyOccupation,origin=raidOrigin(order)
  if(origin&&validRaid(order)&&!ids.has(order.id)&&!locations.has(order.siteId)){
    const target=raidSite(order.siteId),sentUnits=normalizeEnemyUnits(order.sentUnits,origin.type==='city')
    if(origin.id!==(target.regionId||target.id)&&sentUnits.reduce((sum,unit)=>sum+unit.troops,0)===order.force){
      ids.add(order.id);s.raidSerial=Math.max(s.raidSerial,order.id)
      if(order.force<minimumForce(target))returnRaidTroops(s,origin.id,sentUnits)
      else{
        const responseSeconds=Number.isFinite(order.responseSeconds)?Math.max(RAID_ARRIVAL_SECONDS,Math.min(RAID_RESPONSE_WINDOW,order.responseSeconds)):RAID_RESPONSE_WINDOW
        s.enemyOccupation={id:order.id,siteId:order.siteId,originId:origin.id,force:order.force,responseSeconds,sentUnits}
      }
    }
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
export function advanceRaids(s,seconds,random=Math.random,manualRaidId=null,engagedRegionId=null){
  const result={alert:null,intercepted:[],changed:false,due:[]}
  if(s.raidReports.length){
    const now=Date.now()
    if(s.raidReports.some(report=>!reportVisible(report,now))){
      s.raidReports=s.raidReports.filter(report=>reportVisible(report,now));result.changed=true
    }
  }
  if(!Number.isFinite(seconds)||seconds<=0)return result
  const fighting=manualRaidId?activeFormationIds(s,'battle'):[]
  const manualSiteId=s.raidAlerts.find(alert=>alert.id===manualRaidId)?.siteId
  for(const alert of [...s.raidAlerts]){
    if(alert.id===manualRaidId)continue
    const site=raidSite(alert.siteId)
    const nextResponse=Math.max(0,alert.responseSeconds-seconds)
    const checkpoint=raidInterception(s,alert,nextResponse,manualSiteId)
    if(checkpoint){
      alert.interceptedTargetId=site.id
      alert.siteId=checkpoint.id
      alert.responseSeconds=RAID_ARRIVAL_SECONDS
      result.intercepted.push(alert);result.changed=true
      continue
    }
    if(site.id===manualSiteId)continue
    if(!raidHasPresence(s,site)){
      if(raidCanOccupy(s,alert,site)){
        alert.responseSeconds=nextResponse
        if(!raidApproaching(alert))result.due.push(alert.id)
        continue
      }
      if(engagedRegionId!=null&&alert.originId===engagedRegionId)continue
      returnRaidTroops(s,alert.originId,alert.sentUnits)
      s.raidAlerts=s.raidAlerts.filter(entry=>entry.id!==alert.id);result.changed=true;continue
    }
    alert.responseSeconds=nextResponse
    const shared=site.type==='village'&&fighting.some(id=>unitVillage(s,id)===site.id||factoryWorkersAt(s,site.id).some(task=>task.unitIds.includes(id)))
    if(alert.responseSeconds<=1e-8&&!shared)result.due.push(alert.id)
  }
  if(s.raidAlerts.length>=RAID_ALERT_LIMIT)return result
  const splitLocations=new Set(s.formations.map(unit=>unit.splitOrigin))
  const garrisonedSites=raidSites.filter(site=>{
    const record=s.mapRegions[site.regionId||site.id]
    if(record?.enemies.length)return false
    if(isRaidBase(s,site))return raidDefenders(s,site).length>0
    return site.type==='village'?s.garrisons[site.id]?.length||factoryWorkersAt(s,site.id).length:record?.garrisonIds.length||splitLocations.has(site.id)
  })
  if(!garrisonedSites.length){s.raidElapsed=0;return result}
  const interval=Math.max(MIN_RAID_INTERVAL,Math.round(RAID_INTERVAL/(1+(garrisonedSites.length-1)*.25)))
  s.raidElapsed=Math.min(interval,s.raidElapsed+seconds)
  if(s.raidElapsed<interval)return result
  const occupied=new Set(s.raidAlerts.map(alert=>alert.siteId))
  if(s.enemyOccupation)occupied.add(s.enemyOccupation.siteId)
  const targets=garrisonedSites.filter(site=>!occupied.has(site.id))
  if(!targets.length){s.raidElapsed=0;return result}
  const city=chooseCityExpedition(s,targets,random,engagedRegionId)
  const target=city?.target||chooseSite(targets.filter(site=>site.type!=='city'),random)
  const origin=city?.origin||(target&&resolveRaidOrigin(s,target,engagedRegionId))
  if(!origin){s.raidElapsed=0;return result}
  const defenders=raidDefenders(s,target).reduce((total,unit)=>total+unit.troops,0)||raidLocalUnits(s,target).reduce((total,unit)=>total+unit.troops,0)
  if(!defenders){s.raidElapsed=0;return result}
  const desired=Math.max(minimumForce(target),Math.round(defenders*(.9+.2*random())))
  const force=Math.min(RECRUITMENT.troopLimit,desired,regionEnemyTroops(s,origin.id))
  const sentUnits=dispatchRaidTroops(s,origin.id,force)
  result.alert={id:++s.raidSerial,siteId:target.id,originId:origin.id,force,responseSeconds:RAID_RESPONSE_WINDOW,sentUnits}
  s.raidElapsed=0;s.raidAlerts.push(result.alert);result.changed=true
  return result
}
export function advanceEnemyOccupation(s,seconds,random=Math.random,engagedRegionId=null){
  if(!Number.isFinite(seconds)||seconds<=0)return null
  s.enemyOccupationElapsed=Math.min(ENEMY_OCCUPATION_INTERVAL,s.enemyOccupationElapsed+seconds)
  const order=s.enemyOccupation
  if(order){
    order.responseSeconds=Math.max(RAID_ARRIVAL_SECONDS,order.responseSeconds-seconds)
    if(raidApproaching(order))return null
    const site=raidSite(order.siteId),regionId=site.regionId||site.id
    if(regionId===engagedRegionId)return null
    const owner=regionOwner(s,regionId)
    if(owner==='enemy'||site.type==='village'&&site.id===s.baseVillageId){
      if(order.originId===engagedRegionId)return null
      returnRaidTroops(s,order.originId,order.sentUnits)
      s.enemyOccupation=null
      return {canceled:true}
    }
    if(owner==='player'||raidLocalUnits(s,site).length){
      if(s.raidAlerts.length>=RAID_ALERT_LIMIT)return null
      order.occupation=true
      s.raidAlerts.push(order)
      s.enemyOccupation=null
      return {alert:order}
    }
    captureRaidSite(s,site,occupationUnits(order),true)
    s.enemyOccupation=null
    return {occupied:order}
  }

  if(s.enemyOccupationElapsed<ENEMY_OCCUPATION_INTERVAL)return null
  s.enemyOccupationElapsed=0
  const occupied=new Set(s.raidAlerts.map(alert=>alert.siteId))
  const targets=raidSites.filter(site=>!occupied.has(site.id)&&regionOwner(s,site.regionId||site.id)==='neutral'&&!raidLocalUnits(s,site).length)
  if(!targets.length)return null
  const city=chooseCityExpedition(s,targets,random,engagedRegionId,1)
  if(city)return dispatchOccupation(s,city.origin,city.target)
  const ordinary=targets.filter(site=>site.type!=='city')
  if(!ordinary.length)return null
  const origins=OCCUPIABLE_SITES.filter(site=>site.id!==engagedRegionId&&regionEnemyTroops(s,site.id)>1)
  if(!origins.length)return null
  const origin=chooseSite(origins,random)
  const target=ordinary.reduce((nearest,site)=>Math.hypot(site.x-origin.x,site.y-origin.y)<Math.hypot(nearest.x-origin.x,nearest.y-origin.y)?site:nearest)
  return dispatchOccupation(s,origin,target)
}
function dispatchOccupation(s,origin,target){
  const force=Math.min(RECRUITMENT.troopLimit,Math.max(minimumForce(target),Math.floor(regionEnemyTroops(s,origin.id)/4)))
  const sentUnits=dispatchRaidTroops(s,origin.id,force)
  s.enemyOccupation={id:++s.raidSerial,siteId:target.id,originId:origin.id,force,responseSeconds:RAID_RESPONSE_WINDOW,sentUnits}
  return {dispatched:s.enemyOccupation}
}
export function raidDeployment(s,id){
  const alert=s.raidAlerts.find(alert=>alert.id===id),site=raidSite(alert?.siteId)
  if(!site)return {ok:false,message:'这条驻地警报已处理'}
  const units=raidDefenders(s,site)
  const troops=units.reduce((total,unit)=>total+unit.troops,0)
  const unarmedTroops=units.reduce((total,unit)=>total+unit.groups.reduce((sum,group)=>sum+(group.weapon===null?group.troops:0),0),0)
  return {ok:!!units.length,site,alert,units,troops,unarmedTroops,message:'驻地暂无可出战人员'}
}
export function raidDefenders(s,site){
  const units=[]
  const allowed=defenseDuties(site)
  const base=isRaidBase(s,site)&&regionOwner(s,site.regionId||site.id)==='player'
  for(const unit of raidLocalUnits(s,site)){
    const activity=formationActivity(s,unit.id,true)
    if(activity&&!allowed.includes(activity))continue
    const local=site.type!=='village'||unitVillage(s,unit.id)===site.id||base&&marchOrigin(s,unit.id)==='base'
    const standing=local?availableWorkforce(s,unit.id):0
    const inventory=combatGroups(unit.weapons,unit.troops)
    const groups=[]
    let unassigned=unit.troops
    for(const task of Object.values(s.armoryTasks)){
      const workers=Math.min(unassigned,taskWorkersFrom(task,unit.id,unit))
      if(!workers)continue
      const shares=shareCounts(inventory.map(group=>group.troops),workers)
      unassigned-=workers
      inventory.forEach((group,i)=>{
        if(shares[i]&&site.type==='village'&&task.villageId===site.id)groups.push({...group,troops:shares[i],production:task.product})
        group.troops-=shares[i]
      })
    }
    if(standing){
      const shares=shareCounts(inventory.map(group=>group.troops),Math.min(unassigned,standing))
      inventory.forEach((group,i)=>{if(shares[i])groups.push({...group,troops:shares[i]})})
    }
    const troops=groups.reduce((sum,group)=>sum+group.troops,0)
    if(!troops)continue
    units.push({id:unit.id,type:unit.type,name:formationName(unit),troops,groups})
  }
  const reserve=base?baseReserveTroops(s):0
  if(reserve>0)units.push({id:BASE_RESERVE_ACTOR_ID,type:'squad',name:'未编留守人员',troops:reserve,groups:[{weapon:null,troops:reserve}]})
  return units
}
export function assignRaidDefenders(s,deployment){
  const ids=deployment.units.filter(unit=>unit.id!==BASE_RESERVE_ACTOR_ID).map(unit=>unit.id)
  return ids.length?assignFormations(s,ids,'battle',true,defenseDuties(deployment.site)):deployment.ok
}
function raidEnemyUnits(alert){
  if(raidSite(alert.siteId).type==='city'){
    const formations=cityFormations(),regiment=formations[0]
    const kind=formations.reverse().find(formation=>formation.min<=alert.force)||regiment
    return [{name:`敌1${kind.name}`,troops:alert.force,type:kind.id,weapon:'rifle'}]
  }
  const count=Math.min(RAID_ENEMY_GROUP_LIMIT,Math.ceil(alert.force/30))
  return Array.from({length:count},(_,i)=>{
    const troops=Math.floor(alert.force/count)+(i<alert.force%count?1:0)
    const type=FORMATION_TYPES.find(kind=>troops<=kind.max)?.id||'army'
    return {name:`来袭敌${i+1}队`,troops,type,weapon:'rifle'}
  })
}
const occupationUnits=order=>raidSite(order.siteId).type==='city'?raidEnemyUnits(order):order.sentUnits
export function makeRaidBattle(deployment,ammoStock=null){
  const {alert,site,units,troops}=deployment
  const battle=new CampaignBattle(1,units,raidEnemyUnits(alert),ammoStock)
  // 攻击间隔随来袭兵力变化，单轮伤害由战斗引擎统一计算。
  const pressure=Math.min(1,alert.force/(Math.max(1,troops)*.9))**2
  battle.enemyIntervalMultiplier=1+(RAID_ENEMY_INTERVAL-1)*pressure
  battle.raidId=alert.id;battle.raidSiteId=site.id;battle.regionName=site.name
  return battle
}
export function resolveRaidAutomatically(battle){
  battle.autoRaidExchange=true
  const step=.05,limit=180/step
  for(let tick=0;tick<limit&&!battle.done;tick++){
    for(const unit of battle.units){
      if(unit.hp<=0)continue
      const range=battle.attackRange(unit)
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
export function settleRaid(s,battle){
  if(!battle.settled&&!battle.won&&!raidRepelled(battle))battle.loseRemainingFactoryWorkers()
  return settle(s,battle)
}
function captureRaidSite(s,site,enemies,keepMarching=false){
  const id=site.regionId||site.id,record=regionRecord(s,id)
  if(!enemies.length||!record)return {occupied:false}
  const enemyTroops=enemies.reduce((total,unit)=>total+unit.troops,0)
  const baseLost=isRaidBase(s,site)
  record.enemies=enemies
  record.garrisonIds=[]
  if(baseLost)s.baseVillageId=null
  if(site.type==='village')evacuateVillage(s,site.id)
  else{
    delete s.gatheringTasks[id]
    for(const unit of s.formations)if(unit.splitOrigin===id)delete unit.splitOrigin
  }
  if(!keepMarching)s.marchingOrders=s.marchingOrders.filter(order=>order.kind==='village'?order.targetId!==site.id:order.targetId!==id)
  syncIdleBranches(s)
  return {occupied:true,enemyTroops,...(baseLost?{baseLost:true}:{})}
}
export function autoDefendRaid(s,id){
  const deployment=raidDeployment(s,id)
  if(!deployment.alert||!deployment.site)return null
  const {alert,site}=deployment
  if(regionOwner(s,site.regionId||site.id)==='enemy'){
    s.raidAlerts=s.raidAlerts.filter(entry=>entry.id!==id)
    returnRaidTroops(s,alert.originId,alert.sentUnits)
    return null
  }
  const deploymentCounts={deployedTroops:deployment.troops,unarmedTroops:deployment.unarmedTroops}
  let report
  if(deployment.ok){
    const battle=makeRaidBattle(deployment,s)
    const hunger=hungerStatus(s)
    for(const key of ['damageMultiplier','intervalMultiplier','speedMultiplier'])battle[key]=hunger[key]
    resolveRaidAutomatically(battle)
    const result=settleRaid(s,battle)
    const occupation=finishRaid(s,battle)
    report=raidReport(deployment.alert,battle.won?'won':'lost',{...result,...deploymentCounts,...occupation})
  }else{
    s.raidAlerts=s.raidAlerts.filter(alert=>alert.id!==id)
    const enemies=alert.occupation?occupationUnits(alert):raidEnemyUnits(alert)
    const occupation=captureRaidSite(s,site,enemies,alert.occupation===true||site.type==='city')
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
  const fought=unit=>battle.units.some(actor=>actor.rootId===unit.id&&actor.hp>0)
  if(site.type==='village'){
    const survivors=(s.garrisons[site.id]||[]).filter(id=>alive.has(id))
    if(battle.won&&!survivors.length&&!isRaidBase(s,site)){
      const survivor=villageLocalUnits(s,site.id).find(fought)
      if(survivor){survivors.push(survivor.id);delete survivor.splitOrigin}
    }
    if(survivors.length)s.garrisons[site.id]=survivors
    else delete s.garrisons[site.id]
  }else{
    const record=s.mapRegions[site.id]
    record.garrisonIds=record.garrisonIds.filter(id=>alive.has(id))
    if(battle.won&&!record.garrisonIds.length){
      const survivor=regionLocalUnits(s,site.id).find(fought)
      if(survivor){record.garrisonIds.push(survivor.id);delete survivor.splitOrigin}
    }
    reconcileGathering(s,site.id)
  }
  syncIdleBranches(s)
  return {occupied:false}
}
