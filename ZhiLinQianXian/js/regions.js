import {MAP_REGIONS,mapRegion} from './world-map.js'
import {formationRoots} from './state.js'
import {formationActivity} from './base.js'
import {campaignDeployment} from './campaign.js'
import {weaponById} from './weapons.js'
import {villageUnits,recallGarrison} from './villages.js'

function initialEnemies(site){
  if(site.type==='city')return [{name:'敌1'+({regiment:'团',brigade:'旅',division:'师',army:'军'})[site.enemyType],type:site.enemyType,weapon:'rifle',troops:site.enemyTroops}]
  const count=Math.ceil(site.enemyTroops/12)
  return Array.from({length:count},(_,i)=>({name:`敌${i+1}班`,type:'squad',weapon:i%3===2?'machinegun':'rifle',troops:Math.floor(site.enemyTroops/count)+(i<site.enemyTroops%count?1:0)}))
}
export const freshRegions=()=>({mapRegions:Object.fromEntries(MAP_REGIONS.map(site=>[site.id,{enemies:initialEnemies(site),garrisonIds:[]}]))})
export const regionRecord=(s,id)=>s.mapRegions?.[id]
// 外围村庄的驻军就是该村的村庄驻军（s.garrisons），其余据点仍用地区驻防记录。
export const regionUnits=(s,id)=>{const villageId=mapRegion(id)?.villageId;return villageId?villageUnits(s,villageId):formationRoots(s).filter(u=>(regionRecord(s,id)?.garrisonIds||[]).includes(u.id))}
export const regionEnemyTroops=(s,id)=>(regionRecord(s,id)?.enemies||[]).reduce((sum,u)=>sum+u.troops,0)
export const regionOwner=(s,id)=>regionEnemyTroops(s,id)>0?'enemy':regionUnits(s,id).length?'player':'neutral'
export function normalizeRegions(s,raw){
  Object.assign(s,freshRegions())
  const roots=formationRoots(s),taken=new Set(Object.values(s.garrisons||{}).flat())
  for(const site of MAP_REGIONS){
    const old=raw?.mapRegions?.[site.id],record=s.mapRegions[site.id]
    if(!old||typeof old!=='object')continue
    if(Array.isArray(old.enemies))record.enemies=old.enemies.slice(0,12).filter(u=>u&&Number.isSafeInteger(u.troops)&&u.troops>0&&u.troops<=80000&&(site.type==='city'?['regiment','brigade','division','army']:['squad','platoon','company','battalion','regiment','brigade','division','army']).includes(u.type)&&weaponById(u.weapon).id===u.weapon).map((u,i)=>({name:typeof u.name==='string'?Array.from(u.name).slice(0,16).join(''):`敌${i+1}部队`,type:u.type,weapon:u.weapon,troops:u.troops}))
    if(record.enemies.length||!Array.isArray(old.garrisonIds))continue
    for(const id of old.garrisonIds){
      if(!taken.has(id)&&roots.some(u=>u.id===id)&&!formationActivity(s,id)){
        // 旧存档中外围村庄的地区驻军迁入对应的村庄驻军。
        if(site.villageId)(s.garrisons[site.villageId]||=[]).push(id);else record.garrisonIds.push(id)
        taken.add(id)
      }
    }
  }
}
export function regionDispatch(s,id,ids){
  if(!mapRegion(id))return {ok:false,message:'请选择有效的地图地区'}
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return {ok:false,message:'请至少选择一支不同的独立部队'}
  const roots=formationRoots(s)
  if(ids.some(id=>!roots.some(u=>u.id===id)||formationActivity(s,id)))return {ok:false,message:'所选部队不空闲，请先结束任务或撤回驻军'}
  const units=roots.filter(u=>ids.includes(u.id))
  if(regionEnemyTroops(s,id)>0)return campaignDeployment(s,ids)
  return {ok:true,units,troops:units.reduce((sum,u)=>sum+u.troops,0)}
}
export function occupyRegion(s,id,ids){
  const result=regionDispatch(s,id,ids)
  if(!result.ok)return result
  if(regionEnemyTroops(s,id)>0)return {ok:false,message:'该地区有敌军，必须战胜守军才能占领'}
  const site=mapRegion(id),record=regionRecord(s,id)
  if(site.villageId)s.garrisons[site.villageId]=[...(s.garrisons[site.villageId]||[]),...ids];else record.garrisonIds.push(...ids)
  return {...result,message:'部队已进驻'+mapRegion(id).name}
}
export function recallRegion(s,id,unitId){
  const villageId=mapRegion(id)?.villageId;if(villageId){const result=recallGarrison(s,villageId,unitId);return result.ok?{ok:true,message:'部队已撤回待命'}:result}
  const record=regionRecord(s,id)
  if(!record?.garrisonIds.includes(unitId))return {ok:false,message:'该部队不在此处驻防'}
  if(formationActivity(s,unitId,true))return {ok:false,message:'请先结束该部队正在执行的任务'}
  record.garrisonIds=record.garrisonIds.filter(id=>id!==unitId)
  return {ok:true,message:'部队已撤回待命'}
}
export function resolveRegionBattle(s,battle){
  const record=regionRecord(s,battle.regionId)
  if(!record||battle.regionResolved)return null
  battle.regionResolved=true
  record.enemies=battle.won?[]:[...battle.enemies.filter(u=>u.hp>0).map(u=>({name:u.name,type:u.type,weapon:u.weapon,troops:Math.ceil(u.hp)})),...(battle.regionEnemyQueue||[]).map(u=>({...u}))]
  if(battle.won){
    const surviving=new Set(formationRoots(s).map(u=>u.id))
    const winners=battle.regionDeployedIds.filter(id=>surviving.has(id)),villageId=mapRegion(battle.regionId)?.villageId
    if(villageId)s.garrisons[villageId]=[...new Set([...(s.garrisons[villageId]||[]),...winners])];else record.garrisonIds=[...new Set([...record.garrisonIds,...winners])]
  }
  return {regionId:battle.regionId,occupied:regionOwner(s,battle.regionId)==='player'}
}
