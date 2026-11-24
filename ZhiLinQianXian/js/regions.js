import {OCCUPIABLE_SITES,mapRegion} from './world-map.js'
import {FORMATION_TYPES,detachGarrison,formationRoots,recallToStandby,syncIdleBranches} from './state.js'
import {formationActivity} from './base.js'
import {campaignDeployment} from './campaign.js'
import {weaponById} from './weapons.js'
import {RECRUITMENT} from './logistics.js'
import {villageUnits,villageLocalUnits,recallGarrison,evacuateVillage} from './villages.js'

function initialEnemies(site,troops=site.enemyTroops){
  if(!troops)return []
  if(site.type==='city'){
    const kind=FORMATION_TYPES.find(kind=>kind.id===site.enemyType)
    return [{name:'敌1'+kind.name,type:kind.id,weapon:'rifle',troops}]
  }
  const count=Math.ceil(troops/12)
  return Array.from({length:count},(_,i)=>({name:`敌${i+1}班`,type:'squad',weapon:i%3===2?'machinegun':'rifle',troops:Math.floor(troops/count)+(i<troops%count?1:0)}))
}
export const freshRegions=()=>({mapRegions:Object.fromEntries(OCCUPIABLE_SITES.map(site=>[site.id,{enemies:initialEnemies(site),garrisonIds:[]}]))})
export function generateStartingRegions(random){
  const mapRegions=Object.fromEntries(OCCUPIABLE_SITES.map(site=>[site.id,{enemies:[],garrisonIds:[]}]))
  const roll=(min,max)=>min+Math.floor(random()*(max-min+1))
  const coreVillages=OCCUPIABLE_SITES.filter(site=>!site.strategic)
  const strategicSites=type=>OCCUPIABLE_SITES.filter(site=>site.strategic&&site.type===type)
  const groups=[
    [coreVillages,roll(2,3)],
    ...['village','mountain','forest','river','city'].map(type=>{
      const sites=strategicSites(type)
      const [min,max]=type==='city'?[.7,.9]:[.45,.65]
      return [sites,roll(Math.ceil(sites.length*min),Math.floor(sites.length*max))]
    })
  ]
  for(const [sites,count] of groups){
    for(let i=0;i<count;i++){
      const index=roll(i,sites.length-1)
      const site=sites[index]
      sites[index]=sites[i]
      if(site.type==='city'){
        const kind=FORMATION_TYPES.find(kind=>kind.id===site.enemyType)
        const min=Math.max(kind.min,Math.ceil(site.enemyTroops*.75)),max=Math.min(kind.max,Math.floor(site.enemyTroops*1.25))
        mapRegions[site.id].enemies=initialEnemies(site,roll(min,max))
      }else{
        mapRegions[site.id].enemies=initialEnemies(site,site.strategic?roll(12,96):roll(7,30))
      }
    }
  }
  return {mapRegions}
}
export const regionRecord=(s,id)=>s.mapRegions?.[id]
// 外围村庄的驻军就是该村的村庄驻军（s.garrisons），其余据点仍用地区驻防记录。
export const regionUnits=(s,id)=>{const villageId=mapRegion(id)?.villageId;return villageId?villageUnits(s,villageId):formationRoots(s).filter(u=>(regionRecord(s,id)?.garrisonIds||[]).includes(u.id))}
export function regionLocalUnits(s,id){
  const villageId=mapRegion(id)?.villageId
  if(villageId)return villageLocalUnits(s,villageId)
  const stationed=regionUnits(s,id),stationedIds=new Set(stationed.map(unit=>unit.id))
  return [...stationed,...formationRoots(s).filter(unit=>!stationedIds.has(unit.id)&&unit.splitOrigin===id&&!['march','battle'].includes(formationActivity(s,unit.id,true)))]
}
export const regionEnemyTroops=(s,id)=>(regionRecord(s,id)?.enemies||[]).reduce((sum,u)=>sum+u.troops,0)
export const regionOwner=(s,id)=>regionEnemyTroops(s,id)>0?'enemy':(s.baseVillageId!=null&&mapRegion(id)?.villageId===s.baseVillageId)||regionUnits(s,id).length?'player':'neutral'
export function normalizeEnemyUnits(units,city=false){
  if(!Array.isArray(units))return []
  const types=city?['regiment','brigade','division','army']:['squad','platoon','company','battalion','regiment','brigade','division','army']
  return units.slice(0,12).filter(unit=>unit&&Number.isSafeInteger(unit.troops)&&unit.troops>0&&unit.troops<=RECRUITMENT.troopLimit&&types.includes(unit.type)&&weaponById(unit.weapon).id===unit.weapon)
    .map((unit,index)=>({name:typeof unit.name==='string'?Array.from(unit.name).slice(0,16).join(''):`敌${index+1}部队`,type:unit.type,weapon:unit.weapon,troops:unit.troops}))
}
export function normalizeRegions(s,raw){
  Object.assign(s,freshRegions())
  const roots=formationRoots(s),taken=new Set(Object.values(s.garrisons||{}).flat())
  for(const site of OCCUPIABLE_SITES){
    const old=raw?.mapRegions?.[site.id],record=s.mapRegions[site.id]
    if(!old||typeof old!=='object')continue
    if(Array.isArray(old.enemies))record.enemies=normalizeEnemyUnits(old.enemies,site.type==='city')
    if(record.enemies.length){
      const villageId=site.villageId
      if(villageId&&(s.garrisons[villageId]?.length||s.facilityVillages.armory===villageId))evacuateVillage(s,villageId)
      continue
    }
    if(!Array.isArray(old.garrisonIds))continue
    for(const id of old.garrisonIds){
      if(!taken.has(id)&&roots.some(u=>u.id===id)&&!formationActivity(s,id)){
        // 旧存档中外围村庄的地区驻军迁入对应的村庄驻军。
        if(site.villageId)(s.garrisons[site.villageId]||=[]).push(id);else record.garrisonIds.push(id)
        taken.add(id)
      }
    }
  }
}
export function regionDispatch(s,id,ids,fromGarrison=false){
  if(!mapRegion(id))return {ok:false,message:'请选择有效的地图地区'}
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return {ok:false,message:'请至少选择一支不同的独立部队'}
  const roots=formationRoots(s)
  if(ids.some(id=>!roots.some(u=>u.id===id)||formationActivity(s,id,fromGarrison)))return {ok:false,message:'所选部队无法出发，请检查当前任务和驻防状态'}
  const units=roots.filter(u=>ids.includes(u.id))
  if(regionEnemyTroops(s,id)>0)return campaignDeployment(s,ids,fromGarrison)
  return {ok:true,units,troops:units.reduce((sum,u)=>sum+u.troops,0)}
}
export function occupyRegion(s,id,ids){
  const result=regionDispatch(s,id,ids)
  if(!result.ok)return result
  if(regionEnemyTroops(s,id)>0)return {ok:false,message:'该地区有敌军，必须战胜守军才能占领'}
  const site=mapRegion(id),record=regionRecord(s,id)
  for(const uid of ids){const u=s.formations.find(x=>x.id===uid);if(u)delete u.splitOrigin}
  if(site.villageId)s.garrisons[site.villageId]=[...(s.garrisons[site.villageId]||[]),...ids];else record.garrisonIds.push(...ids)
  syncIdleBranches(s)
  return {...result,message:'部队已进驻'+mapRegion(id).name}
}
export function recallRegion(s,id,unitId){
  const villageId=mapRegion(id)?.villageId;if(villageId)return recallGarrison(s,villageId,unitId)
  const record=regionRecord(s,id)
  if(!record?.garrisonIds.includes(unitId))return {ok:false,message:'该部队不在此处驻防'}
  if(formationActivity(s,unitId,true))return {ok:false,message:'请先结束该部队正在执行的任务'}
  const result=recallToStandby(s,unitId)
  if(!result.ok)return result
  detachGarrison(s,id,unitId)
  syncIdleBranches(s)
  return result
}
export function survivingEnemyUnits(battle){
  return [...battle.enemies.filter(unit=>unit.hp>0).map(unit=>({name:unit.name,type:unit.type,weapon:unit.weapon,troops:Math.ceil(unit.hp)})),...(battle.regionEnemyQueue||[]).map(unit=>({...unit}))]
}
export function resolveRegionBattle(s,battle){
  const record=regionRecord(s,battle.regionId)
  if(!record||battle.regionResolved)return null
  battle.regionResolved=true
  record.enemies=battle.won?[]:survivingEnemyUnits(battle)
  if(battle.won){
    const surviving=new Set(formationRoots(s).map(u=>u.id))
    const winners=battle.regionDeployedIds.filter(id=>surviving.has(id)),villageId=mapRegion(battle.regionId)?.villageId
    for(const uid of winners){const u=s.formations.find(x=>x.id===uid);if(u)delete u.splitOrigin}
    if(villageId)s.garrisons[villageId]=[...new Set([...(s.garrisons[villageId]||[]),...winners])];else record.garrisonIds=[...new Set([...record.garrisonIds,...winners])]
  }
  syncIdleBranches(s)
  return {regionId:battle.regionId,occupied:regionOwner(s,battle.regionId)==='player'}
}
