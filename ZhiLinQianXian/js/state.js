import { WEAPONS,restoreBulletCount } from './weapons.js'
import { FOODS,FISH,DISHES,freshLogistics,RECRUITMENT,RATIONS,HUNGER,recruitmentFoodCost,recruitmentSupport,VILLAGE_SUPPLY_IDS,normalizeVillageMobilization } from './logistics.js'
import { freshShop,normalizeShop,buyStock } from './shop.js'
import { freshBase,normalizeBase,farmWorkers,farmReserveWorkers,farmTasks,formationActivity,activityLabel,activeFormationIds } from './base.js'
import {applyProductionLosses,freshFacilities,normalizeFacilities} from './facilities.js'
import {freshVillages,normalizeVillages,reconcileVillageGarrisons,villageOfFormation,villageEnemyTroops} from './villages.js'
import {ALL_VILLAGES,FORMER_BASE_VILLAGE_ID,mapLocation,mapRegion,mapVillage} from './world-map.js'
import {freshRegions,generateStartingRegions,normalizeRegions} from './regions.js'
import {freshMarches,normalizeMarches,marchOrigin} from './marching.js'
import {freshGathering,normalizeGathering} from './gathering.js'
import {freshRaids,normalizeRaids} from './raids.js'
export const SAVE_KEY = 'zhihuiqianxian.save.v1'
const FORMATION_NUMBER_VERSION=1
export const FORMATION_TYPES = [
  {id:'squad',name:'班',min:7,max:12},
  {id:'platoon',name:'排',min:25,max:40},
  {id:'company',name:'连',min:100,max:150},
  {id:'battalion',name:'营',min:400,max:1000},
  {id:'regiment',name:'团',min:1000,max:3000},
  {id:'brigade',name:'旅',min:3000,max:6000},
  {id:'division',name:'师',min:8000,max:15000},
  {id:'army',name:'军',min:30000,max:80000},
]
// 驻军分出的部队带上级称呼：1排-1班、1连-1排-1班。
export const formationName = unit => `${unit.splitPrefix?unit.splitPrefix+'-':''}${unit.number??unit.id}${FORMATION_TYPES.find(v=>v.id===unit.type).name}`
// 按分出关系排成“上级在上、分出部队缩进在下”的列表，返回 [{unit,depth}]。
export function lineageRows(units){
  const ids=new Set(units.map(unit=>unit.id)),children=new Map(),roots=[],rows=[],visited=new Set()
  for(const unit of units){
    if(!ids.has(unit.splitParent)||unit.splitParent===unit.id){roots.push(unit);continue}
    if(!children.has(unit.splitParent))children.set(unit.splitParent,[])
    children.get(unit.splitParent).push(unit)
  }
  for(const siblings of children.values())if(siblings.every(unit=>Number.isSafeInteger(unit.number)))siblings.sort((left,right)=>left.number-right.number)
  const visit=(unit,depth)=>{
    if(visited.has(unit.id))return
    visited.add(unit.id);rows.push({unit,depth})
    for(const child of children.get(unit.id)||[])visit(child,depth+1)
  }
  for(const unit of roots)visit(unit,0)
  for(const unit of units)if(!visited.has(unit.id))visit(unit,0)
  return rows
}
function nextFormationNumber(s,type,excludeId=null,splitParent=null){
  const used=new Set(s.formations.filter(u=>u.type===type&&u.id!==excludeId&&(u.splitParent??null)===splitParent).map(u=>u.number))
  let number=1
  while(used.has(number))number++
  return number
}
function normalizeFormationNumbers(units,legacy){
  const scopes=new Map(),byId=new Map(units.map(unit=>[unit.id,unit]))
  for(const unit of units){
    const scope=unit.type+':'+(unit.splitParent??'independent')
    let used=scopes.get(scope)
    if(!used){used=new Set();scopes.set(scope,used)}
    if((legacy&&unit.splitParent!==undefined)||!Number.isSafeInteger(unit.number)||unit.number<1||used.has(unit.number)){
      unit.number=1;while(used.has(unit.number))unit.number++
    }
    used.add(unit.number)
  }
  for(const {unit,depth} of lineageRows(units))if(depth)unit.splitPrefix=formationName(byId.get(unit.splitParent))
}
export const formationParent = (s,id) => s.formations.find(u=>u.children?.includes(id))
export function formationRoots(s){
  const children=new Set(s.formations.flatMap(u=>u.children||[]))
  return s.formations.filter(u=>!children.has(u.id))
}
export const formationPool=s=>formationRoots(s).filter(unit=>unit.splitParent===undefined)
function formationHierarchy(s){
  const units=new Map(s.formations.map(unit=>[unit.id,unit])),children=new Map(),parents=new Map()
  const link=(parent,child)=>{
    if(parent===child||!units.has(parent)||!units.has(child))return
    if(!children.has(parent))children.set(parent,new Set())
    if(!parents.has(child))parents.set(child,new Set())
    children.get(parent).add(child);parents.get(child).add(parent)
  }
  for(const unit of s.formations){
    for(const child of unit.children||[])link(unit.id,child)
    if(unit.splitParent!==undefined)link(unit.splitParent,unit.id)
  }
  const count=ids=>{
    const seen=new Set(),queue=[...ids]
    let total=0
    while(queue.length){
      const id=queue.pop(),unit=units.get(id)
      if(!unit||seen.has(id))continue
      seen.add(id)
      if(!unit.children)total+=unit.troops
      for(const child of children.get(id)||[])queue.push(child)
    }
    return total
  }
  return {units,parents,count}
}
export const formationOccupancy=(s,id)=>formationHierarchy(s).count([id])
function formationGrowthLimit(s,id,type){
  const tree=formationHierarchy(s),seen=new Set(),queue=[id]
  let limit=null
  while(queue.length){
    const current=queue.pop(),unit=tree.units.get(current)
    if(!unit||seen.has(current))continue
    seen.add(current)
    const assigned=tree.count([current]),kind=FORMATION_TYPES.find(kind=>kind.id===(current===id?type:unit.type))
    const room=kind.max-assigned
    if(!limit||room<limit.room)limit={id:current,name:formationName(unit),assigned,maximum:kind.max,room}
    for(const parent of tree.parents.get(current)||[])queue.push(parent)
  }
  return {assigned:tree.count([id]),limit}
}
const formationLeaves = s => s.formations.filter(u=>!u.children)
const sumFormationWeapons = units => Object.fromEntries(WEAPONS.map(w=>[w.id,units.reduce((sum,u)=>sum+(u.weapons[w.id]||0),0)]))
const nextInternalId=s=>s.formations.reduce((n,unit)=>Math.max(n,unit.id),activeFormationIds(s).reduce((n,id)=>Math.max(n,id),0))+1
function refreshFormationParents(s,id){
  let parent=formationParent(s,id)
  while(parent){
    const children=parent.children.map(child=>s.formations.find(u=>u.id===child))
    parent.troops=children.reduce((sum,u)=>sum+u.troops,0);parent.weapons=sumFormationWeapons(children)
    parent=formationParent(s,parent.id)
  }
}
export function previewFormationMerge(s,ids){
  return checkFormationMerge(s,ids,false)
}
function checkFormationMerge(s,ids,restoreExisting){
  if(!Array.isArray(ids)||ids.length!==3||new Set(ids).size!==3)return {ok:false,message:'请选择三支不同的同级部队'}
  const units=ids.map(id=>s.formations.find(u=>u.id===id))
  if(units.some(u=>!u))return {ok:false,message:'所选部队不存在，请重新选择'}
  if(!restoreExisting&&units.some(unit=>unit.splitParent!==undefined))return {ok:false,message:'分队归属原上级，不能从编制池参与合编'}
  if(units.some(u=>formationActivity(s,u.id)))return {ok:false,message:'所选部队正在执行任务，归队后才能合编'}
  if(units.some(u=>formationParent(s,u.id)))return {ok:false,message:'所选部队已有上级，不能重复合编'}
  if(units.some(u=>u.type!==units[0].type))return {ok:false,message:'必须选择三支相同级别的部队'}
  const index=FORMATION_TYPES.findIndex(v=>v.id===units[0].type),kind=FORMATION_TYPES[index+1]
  if(index<0||!kind)return {ok:false,message:'军级已经是当前最高级编制'}
  const troops=units.reduce((sum,u)=>sum+u.troops,0),weapons=sumFormationWeapons(units)
  if(troops<1||troops>kind.max)return {ok:false,message:`合编${kind.name}不设人数下限，上限 ${kind.max} 人，当前合计 ${troops} 人，请先调整下属人数`,kind,troops,weapons}
  if(!restoreExisting){
    const occupied=formationHierarchy(s).count(ids)
    if(occupied>kind.max)return {ok:false,message:`包含分队共 ${occupied} 人，超过${kind.name}的 ${kind.max} 人上限`,kind,troops,weapons}
  }
  return {ok:true,kind,troops,weapons}
}
export function mergeFormations(s,ids){
  const preview=previewFormationMerge(s,ids)
  if(!preview.ok)return preview
  const unit={id:nextInternalId(s),number:nextFormationNumber(s,preview.kind.id),type:preview.kind.id,troops:preview.troops,weapons:preview.weapons,children:[...ids]}
  s.formations.push(unit);return {ok:true,unit}
}
export function unmergeFormation(s,id){
  const unit=s.formations.find(u=>u.id===id)
  if(formationActivity(s,id))return {ok:false,message:'部队正在执行任务，归队后才能解除合编'}
  if(!unit?.children)return {ok:false,message:'该部队不是合编部队'}
  if(formationParent(s,id))return {ok:false,message:'请先解除该部队所属的上级编制'}
  s.formations.splice(s.formations.indexOf(unit),1)
  return {ok:true}
}
export function formation(s){
  const totalWeapons=WEAPONS.reduce((sum,w)=>sum+s.weaponCounts[w.id],0)
  const leaves=formationLeaves(s),assignedTroops=leaves.reduce((sum,u)=>sum+u.troops,0)
  const assignedWeapons=sumFormationWeapons(leaves)
  return {troops:s.troops,totalWeapons,assignedWeapons,assignedTroops,farmingTroops:farmWorkers(s),armedTroops:Math.min(Object.values(assignedWeapons).reduce((sum,n)=>sum+n,0),s.troops,totalWeapons),unassignedTroops:s.troops-assignedTroops-farmReserveWorkers(s),availableSlots:Math.max(0,s.troops-farmReserveWorkers(s)-assignedTroops),spareWeapons:Math.max(0,totalWeapons-assignedTroops)}
}
export function formationResources(s,id=null){
  const others=formationLeaves(s).filter(u=>u.id!==id)
  return {troops:s.troops-farmReserveWorkers(s)-others.reduce((sum,u)=>sum+u.troops,0),weapons:Object.fromEntries(WEAPONS.map(w=>[w.id,Math.max(0,s.weaponCounts[w.id]-others.reduce((sum,u)=>sum+(u.weapons?.[w.id]||0),0))]))}
}
export function autoFormationWeapons(s,troops,id=null){
  const available=formationResources(s,id).weapons,result={}
  let remaining=troops
  for(const w of WEAPONS){result[w.id]=Math.min(remaining,available[w.id]);remaining-=result[w.id]}
  return result
}
export function formationMinimum(s,type,id=null){
  const kind=FORMATION_TYPES.find(v=>v.id===type),unit=s.formations.find(u=>u.id===id&&u.type===type)
  if(!kind)return undefined
  if(type==='squad'&&s.troops>0&&s.troops<7)return 1
  return unit?.battleDamaged||unit?.lowStrength?Math.min(kind.min,unit.troops):kind.min
}
export function reinforcementCapacity(s,id){
  const unit=s.formations.find(unit=>unit.id===id)
  if(!unit||unit.children)return null
  const kind=FORMATION_TYPES.find(kind=>kind.id===unit.type),available=formationResources(s,id)
  const {assigned,limit:limiting}=formationGrowthLimit(s,id,unit.type),limit=Math.max(0,limiting.room)
  const personnel=available.troops-unit.troops,weapons=Object.values(available.weapons).reduce((sum,count)=>sum+count,0)-Object.values(unit.weapons).reduce((sum,n)=>sum+n,0)
  return {current:unit.troops,maximum:kind.max,assigned,limiting,limit,personnel,weapons,capacity:Math.max(0,Math.min(limit,personnel))}
}
const capacityMessage=limit=>`${limit.name}及其下属、分队已占 ${limit.assigned} / ${limit.maximum} 人，最多可补 ${Math.max(0,limit.room)} 人`
export function reinforcementWeapons(s,id,count){
  const unit=s.formations.find(unit=>unit.id===id)
  if(!unit||unit.children)return null
  const available=formationResources(s,id).weapons,result={...unit.weapons}
  let remaining=unit.troops+count-Object.values(unit.weapons).reduce((sum,n)=>sum+n,0)
  // 原有士兵的武器保留，新增人数优先补充原部队使用的武器。
  const order=[...WEAPONS.filter(weapon=>unit.weapons[weapon.id]>0),...WEAPONS.filter(weapon=>!unit.weapons[weapon.id])]
  for(const weapon of order){const added=Math.min(remaining,available[weapon.id]-unit.weapons[weapon.id]);result[weapon.id]+=added;remaining-=added}
  return result
}
export function reinforcementAdditionalWeapons(s,id,count){
  const unit=s.formations.find(unit=>unit.id===id),total=reinforcementWeapons(s,id,count)
  return total?Object.fromEntries(WEAPONS.map(weapon=>[weapon.id,total[weapon.id]-unit.weapons[weapon.id]])):null
}
export function validateReinforcement(s,id,count,weapons=null,expectedTroops=null,replaceWeapons=false){
  const unit=s.formations.find(unit=>unit.id===id),space=reinforcementCapacity(s,id)
  if(!space)return {ok:false,message:'请选择一支现有基层部队补员，合编部队请进入下属操作'}
  if(expectedTroops!==null&&unit.troops!==expectedTroops)return {ok:false,message:'部队人数已变化，请重新打开补员界面'}
  if(!Number.isInteger(count)||count<0)return {ok:false,message:'补员人数必须为非负整数'}
  if(count>space.limit)return {ok:false,message:capacityMessage(space.limiting)}
  if(count>space.personnel)return {ok:false,message:`未编人员不足：需要补充 ${count} 人，当前仅有 ${space.personnel} 人`}
  // 修改配装时传入最终总数，允许卸下已有武器；库存总量不变，只释放配发占用。
  if(replaceWeapons)return validateFormation(s,unit.type,unit.troops+count,id,weapons??unit.weapons)
  // 新增配发可用于补入人员或缺枪士兵；原有已配武器始终保留，允许不增配。
  const extra=weapons===null?reinforcementAdditionalWeapons(s,id,count):weapons
  if(!extra||typeof extra!=='object'||Array.isArray(extra)||Object.keys(extra).some(id=>!WEAPONS.some(weapon=>weapon.id===id)))return {ok:false,message:'请选择有效的新增武器配发'}
  const spare=formationResources(s).weapons,combined={};let allocated=0
  for(const weapon of WEAPONS){
    const added=extra[weapon.id]??0
    if(!Number.isInteger(added)||added<0)return {ok:false,message:`新增${weapon.name}数量必须为非负整数`}
    if(added>spare[weapon.id])return {ok:false,message:`空闲${weapon.name}不足：需要新增 ${added} 把，可用 ${spare[weapon.id]} 把`}
    combined[weapon.id]=unit.weapons[weapon.id]+added;allocated+=added
  }
  if(allocated>unit.troops+count-Object.values(unit.weapons).reduce((sum,n)=>sum+n,0))return {ok:false,message:'新增武器不能超过尚未配枪的人数'}
  return validateFormation(s,unit.type,unit.troops+count,id,combined)
}
export function reinforceFormation(s,id,count,weapons=null,expectedTroops=null,replaceWeapons=false){
  const validation=validateReinforcement(s,id,count,weapons,expectedTroops,replaceWeapons)
  if(!validation.ok)return validation
  const unit=s.formations.find(unit=>unit.id===id)
  return setFormation(s,unit.type,unit.troops+count,id,validation.weapons)
}
export function formationEditActivity(s,id){
  return formationActivity(s,id,true)
}
export function validateFormation(s,type,troops,id=null,weapons=null,restoreDamaged=false){
  const kind=FORMATION_TYPES.find(v=>v.id===type),existing=id===null?null:s.formations.find(u=>u.id===id)
  if(id!==null&&!existing)return {ok:false,message:'该编制不存在，请重新选择'}
  const busy=existing?formationEditActivity(s,id):null
  if(busy)return {ok:false,message:`部队${activityLabel(busy)}，结束当前任务后才能修改编制或配发`}
  if(existing&&(type!==existing.type||troops<existing.troops)){
    const station=formationActivity(s,id)
    if(station==='garrison'||station==='region')return {ok:false,message:'驻防期间可以补员和调整配发，撤回后才能改编或减员'}
  }
  if(existing?.children)return {ok:false,message:'合编部队的人数和武器由下属决定，请修改下属部队'}
  const parent=existing?formationParent(s,id):null
  if(parent&&type!==existing.type)return {ok:false,message:'已编入上级的部队不能改变类型，请先解除合编'}
  if(!kind)return {ok:false,message:'请选择有效的编制类型'}
  const minimum=restoreDamaged?1:formationMinimum(s,type,id)
  if(!Number.isInteger(troops)||troops<minimum||troops>kind.max)return {ok:false,message:`${kind.name}人数必须为 ${minimum}—${kind.max} 之间的整数`}
  if(existing&&(troops>existing.troops||type!==existing.type)){
    const {limit}=formationGrowthLimit(s,id,type)
    if(troops-existing.troops>limit.room)return {ok:false,message:capacityMessage(limit)}
  }
  const available=formationResources(s,id)
  if(troops>available.troops)return {ok:false,message:`未编人员不足：需要 ${troops} 人，当前仅有 ${available.troops} 人`}
  const loadout=weapons===null?autoFormationWeapons(s,troops,id):weapons
  if(!loadout||typeof loadout!=='object'||Array.isArray(loadout)||Object.keys(loadout).some(key=>!WEAPONS.some(w=>w.id===key)))return {ok:false,message:'请选择有效的武器分配'}
  const clean={};let total=0
  for(const w of WEAPONS){
    const count=loadout[w.id]??0
    if(!Number.isInteger(count)||count<0)return {ok:false,message:`${w.name}数量必须为非负整数`}
    if(count>available.weapons[w.id])return {ok:false,message:`${w.name}不足：需要 ${count} 把，可用 ${available.weapons[w.id]} 把`}
    clean[w.id]=count;total+=count
  }
  if(total>troops)return {ok:false,message:`配发武器不能超过 ${troops} 人，当前分配 ${total} 把`}
  return {ok:true,weapons:clean}
}
export function setFormation(s,type,troops,id=null,weapons=null){
  const result=validateFormation(s,type,troops,id,weapons)
  if(!result.ok)return result
  const existing=s.formations.find(u=>u.id===id)
  if(existing){
    if(existing.type!==type)existing.number=nextFormationNumber(s,type,id,existing.splitParent??null)
    existing.type=type;existing.troops=troops;existing.weapons=result.weapons;refreshFormationParents(s,id)
  }
  else s.formations.push({id:nextInternalId(s),number:nextFormationNumber(s,type),type,troops,weapons:result.weapons,...(type==='squad'&&troops<7?{lowStrength:true}:{})})
  return {ok:true}
}
export function removeFormation(s,id){
  const i=s.formations.findIndex(u=>u.id===id)
  if(formationActivity(s,id))return false
  if(i<0||s.formations[i].children||formationParent(s,id))return false
  s.formations.splice(i,1);return true
}
// 按最大余数法分配幸存人数，保证下属、武器的整数总数与实际幸存人数一致。
function splitSurvivors(weights,count){
  const total=weights.reduce((sum,value)=>sum+value,0)
  const values=weights.map(value=>total?value*count/total:0),result=values.map(Math.floor)
  const order=values.map((value,i)=>({i,remainder:value-result[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i)
  const extra=count-result.reduce((sum,value)=>sum+value,0)
  for(let i=0;i<extra;i++)result[order[i].i]++
  return result
}
function removeFallenFormation(s,unit,fallen){
  const parent=formationParent(s,unit.id)
  fallen.push({unit,parent})
  if(!parent){
    const station=garrisonSite(s,unit.id)
    if(station!==null)detachGarrison(s,station,unit.id)
  }
  s.formations.splice(s.formations.indexOf(unit),1)
}
function inheritFallenFormations(s,fallen,battle){
  // 先处理下级，避免同一轮阵亡的分队被选中，也让幸存人员能沿原关系逐级继承。
  const tier=unit=>FORMATION_TYPES.findIndex(kind=>kind.id===unit.type)
  const successors=[]
  for(const {unit,parent} of fallen.sort((a,b)=>tier(a.unit)-tier(b.unit))){
    const branches=s.formations.filter(branch=>branch.splitParent===unit.id).sort((a,b)=>a.id-b.id)
    if(!branches.length)continue
    const [successor,...others]=branches
    successor.type=unit.type;successor.number=unit.number;successor.battleDamaged=true
    delete successor.lowStrength
    if(unit.splitParent!==undefined){successor.splitParent=unit.splitParent;successor.splitPrefix=unit.splitPrefix}
    else if(parent){successor.splitParent=parent.id;successor.splitPrefix=formationName(parent)}
    else{delete successor.splitParent;delete successor.splitPrefix}
    for(const branch of others)branch.splitParent=successor.id
    successors.push(successor)
  }
  if(!successors.length)return
  normalizeFormationNumbers(s.formations,false)
  for(const successor of new Set(successors)){
    for(const actor of battle.units)if(actor.id===successor.id){actor.type=successor.type;actor.name=formationName(successor)}
  }
}
function retainFormationSurvivors(s,id,count,fallen){
  const unit=s.formations.find(unit=>unit.id===id)
  if(!unit)return
  if(unit.children){
    const children=unit.children.map(id=>s.formations.find(unit=>unit.id===id))
    const survivors=splitSurvivors(children.map(unit=>unit.troops),count)
    children.forEach((child,i)=>retainFormationSurvivors(s,child.id,survivors[i],fallen))
    unit.children=unit.children.filter(id=>s.formations.some(unit=>unit.id===id))
    unit.troops=count;unit.weapons=sumFormationWeapons(s.formations.filter(child=>unit.children.includes(child.id)))
  }else{
    const counts=splitSurvivors([...WEAPONS.map(weapon=>unit.weapons[weapon.id]),unit.troops-Object.values(unit.weapons).reduce((sum,n)=>sum+n,0)],count)
    // 仅在基层扣阵亡士兵携带的武器；合编上级只汇总，避免同一把重复扣除。
    WEAPONS.forEach((weapon,i)=>{s.weaponCounts[weapon.id]-=unit.weapons[weapon.id]-counts[i]})
    unit.weapons=Object.fromEntries(WEAPONS.map((weapon,i)=>[weapon.id,counts[i]]));unit.troops=count
  }
  if(!count)removeFallenFormation(s,unit,fallen)
  else unit.battleDamaged=true
}
// 整支阵亡即时结算；行动结束时再按存活部队的实际剩余人数结算部分损失。
export function applyBattleLosses(s,battle,includeSurvivors=false){
  if(battle.mode!=='campaign'||!Array.isArray(battle.units))return 0
  const fallen=[]
  // 分遣Actor共用原编制身份，按实际阵亡武器结算，不能将主营的剩余人数当成整营。
  if(typeof battle.collectLosses==='function'){
    let lost=0
    const casualties=battle.collectLosses(includeSurvivors)
    if(battle.productionLosses){
      applyProductionLosses(s,battle.productionLosses)
      battle.productionLosses=[]
    }
    for(const [id,losses] of Object.entries(casualties)){
      const root=formationRoots(s).find(unit=>unit.id===Number(id));if(!root)continue
      const leaves=[],visit=unit=>{if(unit.children)unit.children.forEach(id=>visit(s.formations.find(child=>child.id===id)));else leaves.push(unit)}
      visit(root)
      const removed=new Map(leaves.map(unit=>[unit.id,0]))
      if(losses.unarmed){
        const unarmed=leaves.map(unit=>unit.troops-WEAPONS.reduce((sum,weapon)=>sum+unit.weapons[weapon.id],0))
        const count=Math.min(losses.unarmed,unarmed.reduce((sum,n)=>sum+n,0))
        const shares=splitSurvivors(unarmed,count)
        leaves.forEach((unit,i)=>removed.set(unit.id,shares[i]));lost+=count
      }
      for(const weapon of WEAPONS){
        const count=Math.min(losses[weapon.id]||0,leaves.reduce((sum,unit)=>sum+unit.weapons[weapon.id],0))
        const shares=splitSurvivors(leaves.map(unit=>unit.weapons[weapon.id]),count)
        leaves.forEach((unit,i)=>{unit.weapons[weapon.id]-=shares[i];removed.set(unit.id,removed.get(unit.id)+shares[i])})
        s.weaponCounts[weapon.id]-=count;lost+=count
      }
      for(const unit of leaves){const count=removed.get(unit.id);if(count){unit.troops-=count;unit.battleDamaged=true}}
      const refresh=unit=>{
        if(unit.children){unit.children=unit.children.filter(id=>refresh(s.formations.find(child=>child.id===id)));const children=s.formations.filter(child=>unit.children.includes(child.id));unit.troops=children.reduce((sum,child)=>sum+child.troops,0);unit.weapons=sumFormationWeapons(children);unit.battleDamaged=true}
        if(unit.troops<=0){removeFallenFormation(s,unit,fallen);return false}return true
      }
      if(!refresh(root))battle.lostUnits=(battle.lostUnits||0)+1
    }
    s.troops=Math.max(0,s.troops-lost);battle.lostTroops=(battle.lostTroops||0)+lost
    inheritFallenFormations(s,fallen,battle)
    return lost
  }
  let lost=0
  for(const actor of battle.units){
    if((actor.hp>0&&!includeSurvivors)||actor.lossApplied)continue
    actor.lossApplied=true
    const root=formationRoots(s).find(unit=>unit.id===actor.id)
    if(!root)continue
    const survivors=Math.max(0,Math.min(root.troops,Math.ceil(actor.hp))),casualties=root.troops-survivors
    if(!casualties)continue
    retainFormationSurvivors(s,root.id,survivors,fallen)
    s.troops=Math.max(0,s.troops-casualties)
    battle.lostTroops=(battle.lostTroops||0)+casualties
    if(!survivors)battle.lostUnits=(battle.lostUnits||0)+1
    lost+=casualties
  }
  inheritFallenFormations(s,fallen,battle)
  return lost
}
export const MODES = [
  {id:'campaign',name:'大地图',en:'WORLD MAP',color:'#b0c881',tag:'战区态势',desc:'查看战区，选择部队行动。'},
  {id:'recruitment',name:'发动群众',en:'MOBILIZATION',color:'#d9ac5a',tag:'兵员招募',desc:'慰问乡亲，招募人员加入部队。'},
  {id:'base',name:'根据地',en:'BASE AREA',color:'#87bac0',tag:'建设发展',desc:'安排耕地，建设部队根据地。'},
]
export const GOODS = [
  {id:'bullets',name:'子弹',category:'ammo',desc:'步枪、手枪、轻机枪、狙击枪通用',price:40,amount:30,unit:'发',icon:'ammo'},
  {id:'mortarAmmo',name:'迫击炮弹',category:'ammo',desc:'迫击炮开火时消耗',price:80,amount:5,unit:'发',icon:'shell'},
  {id:'grenades',name:'手雷',category:'ammo',desc:'投掷物资 · 库存储备',price:60,amount:1,unit:'枚',icon:'grenade'},
  {id:'bandages',name:'绷带',category:'medical',desc:'基础医疗物资 · 库存储备',price:30,amount:1,unit:'卷',icon:'bandage'},
  {id:'medkits',name:'医疗包',category:'medical',desc:'医疗物资储备',price:90,amount:1,unit:'个',icon:'medical'},
  ...FOODS,
]
export const MISSIONS = [
  {id:'first',name:'初战告捷',desc:'获得 1 次战斗胜利',field:'wins',goal:1,reward:160},
  {id:'hunter',name:'前线清剿',desc:'累计击败 30 名敌军',field:'kills',goal:30,reward:220},
  {id:'hold',name:'扩充队伍',desc:'累计招募 50 名士兵',field:'recruitedTroops',goal:50,reward:300},
]
// 旧坚守任务已经达成的目标仍可领取；保留原任务 id 避免重复领奖。
export const missionProgress=(s,mission)=>Math.max(s[mission.field]||0,mission.id==='hold'&&s.bestWave>=5?mission.goal:0)
// 用户指定的当前仓库调整：仅加载旧存档时执行一次，新游戏不自动获赠。
export function applyWarehouseFoodAdjustment(s){
  if(s.warehouseFoodAdjustmentVersion===1)return false
  for(const food of FOODS)s[food.id]=1000
  s.warehouseFoodAdjustmentVersion=1;return true
}
// 用户指定的单次仓库补给，仅正式预览的已有存档领取。
export function applyRequestedRiceSupply(s){
  if(s.warehouseRiceSupply20261117===true)return false
  s.rice=Math.min(10000000,(s.rice||0)+1000000)
  s.warehouseRiceSupply20261117=true;return true
}
export function freshSave(){return {...freshRaids(),...freshGathering(),...freshLogistics(),...freshShop(),...freshBase(),...freshFacilities(),...freshVillages(),...freshRegions(),...freshMarches(),baseVillageId:null,warehouseRiceSupply20261117:true,warehouseFoodAdjustmentVersion:1,name:'新晋指挥官',coins:600,troops:120,medkits:3,shells:2,bullets:0,mortarAmmo:0,grenades:0,bandages:0,stage:1,wins:0,kills:0,bestWave:0,expeditions:0,recruitedTroops:0,recruitmentCount:0,claimed:[],formations:[],formationNumberVersion:FORMATION_NUMBER_VERSION,weaponStockVersion:2,weaponCounts:Object.fromEntries(WEAPONS.map(w=>[w.id,w.id==='rifle'?120:0])),equippedWeapon:'rifle',settings:{effects:true,vibration:true,music:true}}}
export function createNewGameSave(random=Math.random){
  const s=freshSave()
  Object.assign(s,generateStartingRegions(random))
  for(const village of ALL_VILLAGES){
    const cap=s.villagePopulation[village.id],min=Math.ceil(cap*.7)
    s.villagePopulation[village.id]=min+Math.floor(random()*(cap-min+1))
  }
  return s
}
export function chooseStartingBase(s,villageId){
  if(s.baseVillageId!==null||!mapVillage(villageId)||villageEnemyTroops(s,villageId)>0)return false
  s.baseVillageId=villageId
  return true
}
export function baseRelocationError(s,villageId){
  if(s.baseVillageId===null)return '请先选择初始根据地'
  if(!mapVillage(villageId)||s.baseVillageId===villageId)return '请选择另一座村庄'
  if(villageEnemyTroops(s,villageId)>0)return '该村已被敌军占领'
  if(s.raidAlerts.some(alert=>alert.siteId===villageId))return '该村正在遭袭，请先击退敌军'
  return ''
}
export function relocateBase(s,villageId){
  const message=baseRelocationError(s,villageId)
  if(message)return {ok:false,message}
  s.baseVillageId=villageId
  syncIdleBranches(s)
  return {ok:true}
}
export function normalizeSave(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return createNewGameSave()
  const s=freshSave()
  s.baseVillageId=raw.baseVillageId===null||mapVillage(raw.baseVillageId)?raw.baseVillageId:FORMER_BASE_VILLAGE_ID
  s.warehouseRiceSupply20261117=raw.warehouseRiceSupply20261117===true
  s.warehouseFoodAdjustmentVersion=raw.warehouseFoodAdjustmentVersion===1?1:0
  Object.assign(s,normalizeShop(raw))
  if(Number.isFinite(raw.mobilizationDiscounts))s.mobilizationDiscounts=Math.max(0,Math.min(10000000,Math.floor(raw.mobilizationDiscounts)))
  if(typeof raw.name==='string'&&raw.name.trim())s.name=Array.from(raw.name.trim()).slice(0,12).join('')
  for(const key of new Set(['coins','shells','mobilizationFood','mobilizationCoins','lastMealShortage','lastMealServed','foodConsumed','dishesCooked','villageSuppliesReceived','donationStreak','troops','stage','wins','kills','bestWave','expeditions','recruitedTroops','recruitmentCount',FISH.id,...GOODS.map(item=>item.id),...DISHES.map(dish=>dish.id)])){
    if(Number.isFinite(raw[key]))s[key]=Math.max(0,Math.min(10000000,Math.floor(raw[key])))
  }
  s.bullets=restoreBulletCount(raw)
  if(Number.isSafeInteger(raw.villageSupplyCursor)&&raw.villageSupplyCursor>=0&&raw.villageSupplyCursor<VILLAGE_SUPPLY_IDS.length)s.villageSupplyCursor=raw.villageSupplyCursor
  for(const id of VILLAGE_SUPPLY_IDS)if(Number.isFinite(raw.lastVillageSupplies?.[id])&&raw.lastVillageSupplies[id]>0)s.lastVillageSupplies[id]=Math.min(10000000,Math.floor(raw.lastVillageSupplies[id]))
  if(typeof raw.mobilizationActive==='boolean')s.mobilizationActive=raw.mobilizationActive
  if(typeof raw.autoCooking==='boolean')s.autoCooking=raw.autoCooking
  if(Number.isFinite(raw.hungerDebt))s.hungerDebt=Math.max(0,Math.min(HUNGER.disabledAt,raw.hungerDebt))
  // 旧存档最后一餐已吃饱时，清除旧规则残留的历史欠餐；字段存在后不重复迁移。
  if(raw.lastMealServed===undefined&&raw.lastMealShortage===0&&s.foodConsumed>0){s.lastMealServed=Math.ceil(s.troops/RATIONS.soldiersPerPortion);s.hungerDebt=0}
  // 断粮时报名间隔是 20 秒，存档余下秒数上限需按当时的实际速率判断。
  const fed=recruitmentSupport(s)>=recruitmentFoodCost(s)
  for(const [key,interval] of [['recruitElapsed',fed?RECRUITMENT.interval:RECRUITMENT.starvedInterval],['mealElapsed',RATIONS.interval]]){
    const value=key==='mealElapsed'&&raw.rationClockVersion!==RATIONS.version?raw[key]*RATIONS.interval/60:raw[key]
    if(Number.isFinite(value)&&value>=0&&value<interval)s[key]=value
  }
  s.lastDonationFood=FOODS.some(food=>food.id===raw.lastDonationFood)?raw.lastDonationFood:null
  if(!s.lastDonationFood)s.donationStreak=0
  // 合法存档允许伤亡后低于初始兵力，含 0；缺失或非法负值仍使用初始值。
  if(!Number.isFinite(raw.troops)||raw.troops<0)s.troops=120
  s.stage=Math.max(1,Math.min(12,s.stage))
  s.claimed=Array.isArray(raw.claimed)?raw.claimed.filter(v=>MISSIONS.some(m=>m.id===v)):[]
  if(raw.weaponCounts&&typeof raw.weaponCounts==='object'&&!Array.isArray(raw.weaponCounts)){
    for(const w of WEAPONS)if(Number.isFinite(raw.weaponCounts[w.id]))s.weaponCounts[w.id]=Math.max(0,Math.min(10000000,Math.floor(raw.weaponCounts[w.id])))
    // 旧版初始赠送 1 把，补齐到 120 把；已有购买数量保留，只迁移一次。
    if(raw.weaponStockVersion!==2&&Number.isFinite(raw.weaponCounts.rifle)&&s.weaponCounts.rifle>0)s.weaponCounts.rifle=Math.min(10000000,s.weaponCounts.rifle+119)
  }else if(Array.isArray(raw.weapons)){
    for(const w of WEAPONS)if(w.id!=='rifle'&&raw.weapons.includes(w.id))s.weaponCounts[w.id]=1
  }
  // 全军覆没后允许没有任何武器，不能因刷新而凭空补发一把步枪。
  s.equippedWeapon=WEAPONS.find(w=>w.id===raw.equippedWeapon&&s.weaponCounts[w.id]>0)?.id||WEAPONS.find(w=>s.weaponCounts[w.id]>0)?.id||'rifle'
  // 载入时同样校验人数区间、总兵力和武器额度；不自动创建编制。
  if(Array.isArray(raw.formations)){
    const seen=new Set(),ordered=raw.formations.filter(u=>u&&Number.isSafeInteger(u.id)).sort((a,b)=>a.id-b.id)
    for(const unit of ordered){
      if(!unit||unit.children!==undefined||!Number.isSafeInteger(unit.id)||unit.id<1||seen.has(unit.id))continue
      const lowStrength=unit.type==='squad'&&unit.lowStrength===true
      const result=validateFormation(s,unit.type,unit.troops,null,unit.weapons===undefined?null:unit.weapons,unit.battleDamaged===true||lowStrength)
      if(!result.ok)continue
      s.formations.push({id:unit.id,number:unit.number,type:unit.type,troops:unit.troops,weapons:result.weapons,...(unit.battleDamaged===true?{battleDamaged:true}:{}),...(lowStrength?{lowStrength:true}:{}),...(Number.isSafeInteger(unit.splitParent)&&typeof unit.splitPrefix==='string'&&unit.splitPrefix.length<=60?{splitParent:unit.splitParent,splitPrefix:unit.splitPrefix}:{}),...(unit.splitOrigin!==undefined&&(typeof unit.splitOrigin==='string'||Number.isSafeInteger(unit.splitOrigin))?{splitOrigin:unit.splitOrigin}:{})});seen.add(unit.id)
    }
    // 由低到高恢复合编关系，汇总以实际下属为准；无效上级不会吞掉原部队。
    for(let level=1;level<FORMATION_TYPES.length;level++){
      for(const unit of ordered){
        if(unit?.type!==FORMATION_TYPES[level].id||!Array.isArray(unit.children)||!Number.isSafeInteger(unit.id)||unit.id<1||seen.has(unit.id))continue
        let preview=checkFormationMerge(s,unit.children,true)
        if(unit.battleDamaged===true){
          const children=unit.children.map(id=>s.formations.find(child=>child.id===id)),kind=FORMATION_TYPES[level]
          if(unit.children.length<1||unit.children.length>3||new Set(unit.children).size!==unit.children.length||children.some(child=>!child||child.type!==FORMATION_TYPES[level-1].id||formationParent(s,child.id)))continue
          const troops=children.reduce((sum,child)=>sum+child.troops,0)
          preview={ok:troops>0&&troops<=kind.max,kind,troops,weapons:sumFormationWeapons(children)}
        }
        if(!preview.ok||preview.kind.id!==unit.type)continue
        s.formations.push({id:unit.id,number:unit.number,type:unit.type,troops:preview.troops,weapons:preview.weapons,children:[...unit.children],...(unit.battleDamaged===true?{battleDamaged:true}:{})});seen.add(unit.id)
      }
    }
    s.formations.sort((a,b)=>a.id-b.id)
    normalizeFormationNumbers(s.formations,raw.formationNumberVersion!==FORMATION_NUMBER_VERSION)
  }
  normalizeVillages(s,raw)
  normalizeBase(s,raw)
  reconcileVillageGarrisons(s)
  normalizeFacilities(s,raw)
  normalizeVillageMobilization(s,raw)
  normalizeRegions(s,raw)
  normalizeMarches(s,raw)
  normalizeGathering(s,raw)
  normalizeRaids(s,raw)
  syncIdleBranches(s)
  for(const key of ['effects','vibration','music'])if(typeof raw.settings?.[key]==='boolean')s.settings[key]=raw.settings[key]
  return s
}
export function purchase(s,id){return buyStock(s,GOODS.find(item=>item.id===id))}
export function purchaseWeapon(s,id){return buyStock(s,WEAPONS.find(weapon=>weapon.id===id),true)}
export function equipWeapon(s,id){if(!WEAPONS.some(w=>w.id===id)||!(s.weaponCounts[id]>0))return false;s.equippedWeapon=id;return true}
export function claim(s,id){const m=MISSIONS.find(v=>v.id===id);if(!m||s.claimed.includes(id)||missionProgress(s,m)<m.goal)return false;s.claimed.push(id);s.coins+=m.reward;return true}
export function settle(s,battle){
  if(battle.settled)return null
  applyBattleLosses(s,battle,true)
  battle.settled=true
  const win=battle.won
  const coins=win?30+battle.level*10:Math.min(10,Math.floor(battle.kills/4))
  s.coins+=coins;s.kills+=battle.kills
  if(win)s.wins++
  if(battle.mode==='campaign'&&win&&!battle.regionId&&!battle.raidId)s.stage=Math.min(12,Math.max(s.stage,battle.level+1))
  if(battle.mode==='defense')s.bestWave=Math.max(s.bestWave,battle.wave)
  const capturedWeapons=Object.fromEntries(WEAPONS.map(weapon=>[weapon.id,0]))
  let capturedBullets=0
  if(battle.mode==='campaign'&&win){
    for(const weapon of WEAPONS){
      const count=Math.floor(battle.defeatedWeapons?.[weapon.id])
      if(!Number.isFinite(count)||count<=0)continue
      const added=Math.max(0,Math.min(count,10000000-s.weaponCounts[weapon.id]))
      s.weaponCounts[weapon.id]+=added;capturedWeapons[weapon.id]=added
      if(weapon.ammo==='bullets')capturedBullets+=count*2
    }
    capturedBullets=Math.max(0,Math.min(capturedBullets,10000000-s.bullets))
    s.bullets+=capturedBullets
  }
  return {coins,win,kills:battle.kills,wave:battle.wave,lostTroops:battle.lostTroops||0,lostUnits:battle.lostUnits||0,capturedWeapons,capturedBullets}
}
// 驻防地点节点：村庄用所属地区(或村庄)编号，地区驻防用地区编号；不在驻防则为 null。
export function garrisonSite(s,id){
  const village=villageOfFormation(s,id)
  if(village!==null)return ALL_VILLAGES.find(v=>v.id===village)?.regionId||village
  for(const [regionId,record] of Object.entries(s.mapRegions||{}))if((record.garrisonIds||[]).includes(id))return regionId
  return null
}
export function detachGarrison(s,siteId,id){
  const villageId=mapRegion(siteId)?.villageId
  if(villageId){
    const remaining=(s.garrisons[villageId]||[]).filter(unitId=>unitId!==id)
    if(remaining.length)s.garrisons[villageId]=remaining
    else delete s.garrisons[villageId]
  }else{
    const record=s.mapRegions[siteId]
    if(record)record.garrisonIds=record.garrisonIds.filter(unitId=>unitId!==id)
  }
}
function setBranchStandby(unit,destination){
  const origin=destination==='base'?undefined:destination
  if(unit.splitOrigin===origin)return false
  if(origin===undefined)delete unit.splitOrigin
  else unit.splitOrigin=origin
  return true
}
const travelling=activity=>activity==='march'||activity==='battle'
export function recallToStandby(s,id){
  const unit=s.formations.find(item=>item.id===id)
  if(!unit)return {ok:false,message:'该部队不存在'}
  const origin=s.formations.find(item=>item.id===unit.splitParent&&item.id!==id)
  let destination='base'
  if(origin){
    let host=origin,parent=formationParent(s,host.id)
    while(parent){host=parent;parent=formationParent(s,host.id)}
    const activity=formationActivity(s,host.id)
    if(travelling(activity)){
      destination=marchOrigin(s,id)
      setBranchStandby(unit,destination)
      return {ok:true,destination,waitingForParent:true,message:`${formationName(unit)}已撤离，在${mapLocation(destination,s).name}等待上级抵达或归队`}
    }
    destination=marchOrigin(s,host.id)
  }
  setBranchStandby(unit,destination)
  const place=mapLocation(destination,s).name
  return {ok:true,destination,message:origin?`${formationName(unit)}已返回${place}，在${formationName(origin)}身边待命`:`部队已撤回${place}待命`}
}
export function syncIdleBranches(s){
  const branches=s.formations.filter(unit=>unit.splitParent!==undefined)
  if(!branches.length)return false
  const byId=new Map(s.formations.map(unit=>[unit.id,unit]))
  const parents=new Map(s.formations.flatMap(unit=>(unit.children||[]).map(id=>[id,unit])))
  const visited=new Set(),activities=new Map()
  let changed=false
  const activity=id=>{
    if(!activities.has(id))activities.set(id,formationActivity(s,id))
    return activities.get(id)
  }
  const follow=unit=>{
    if(visited.has(unit.id))return
    visited.add(unit.id)
    if(parents.has(unit.id)||activity(unit.id))return
    let host=byId.get(unit.splitParent)
    if(host?.id===unit.id)return
    while(host&&parents.has(host.id))host=parents.get(host.id)
    if(host){
      if(travelling(activity(host.id)))return
      if(host.splitParent!==undefined)follow(host)
    }
    if(setBranchStandby(unit,host?marchOrigin(s,host.id):'base'))changed=true
  }
  for(const unit of branches)follow(unit)
  return changed
}
// 未派出的兵力与编制留守在根据地中心。
export function baseForces(s){
  const fieldWorkers=new Set(farmTasks(s).filter(task=>task.fieldId).flatMap(task=>task.unitIds||[]))
  const activeUnit=u=>{
    if(garrisonSite(s,u.id)!==null||u.splitOrigin!==undefined)return true
    if((s.marchingOrders||[]).some(o=>o.unitIds.includes(u.id)))return true
    if(formationActivity(s,u.id)==='battle')return true
    if(fieldWorkers.has(u.id))return true
    if(Object.values(s.armoryTasks||{}).some(task=>task.villageId&&task.unitIds.includes(u.id)))return true
    return false
  }
  const units=formationRoots(s).filter(u=>!activeUnit(u))
  const reserveFarmingBase=s.farmTask&&!s.farmTask.unitIds?s.farmTask.workers:0
  const unassigned=Math.max(0,formation(s).unassignedTroops+reserveFarmingBase)
  return {units,unassigned,troops:unassigned+units.reduce((sum,u)=>sum+u.troops,0)}
}
export const garrisonSplitTypes=(s,unit)=>!unit?[]:FORMATION_TYPES.filter((k,i)=>i<FORMATION_TYPES.findIndex(v=>v.id===unit.type)&&k.min<unit.troops)
export function splitGarrisonUnit(s,id,type,troops){
  const unit=s.formations.find(u=>u.id===id)
  if(!unit||formationParent(s,id))return {ok:false,message:'请选择驻防中的独立部队'}
  const activity=formationActivity(s,id)
  if(!['garrison','region'].includes(activity)||formationActivity(s,id,true))return {ok:false,message:'只有未在执行耕作或设施任务的驻军才能分出部队'}
  const origIdx=FORMATION_TYPES.findIndex(v=>v.id===unit.type),kindIdx=FORMATION_TYPES.findIndex(v=>v.id===type),kind=FORMATION_TYPES[kindIdx]
  if(kindIdx<0||kindIdx>=origIdx)return {ok:false,message:'只能分出低于当前编制的部队'}
  const maxTroops=Math.min(kind.max,unit.troops-1)
  if(!Number.isInteger(troops)||troops<kind.min||troops>maxTroops)return {ok:false,message:`${kind.name}人数须为 ${kind.min}—${maxTroops} 人，且原驻军至少保留 1 人`}
  const unitLeaves=node=>!node?[]:node.children?node.children.flatMap(cid=>unitLeaves(s.formations.find(u=>u.id===cid))):[node]
  const newWeapons=Object.fromEntries(WEAPONS.map(w=>[w.id,0]));let need=troops,totalLeft=unit.troops
  for(const leaf of unitLeaves(unit)){
    if(need<=0)break
    const maxTake=totalLeft-need<=0?leaf.troops-1:Math.min(need,leaf.troops-(totalLeft-leaf.troops===0?1:0))
    const take=Math.min(need,maxTake);if(take<=0)continue
    const remain=leaf.troops-take
    // 先按比例下取整转武器，再保证原叶节点剩余武器不超过剩余人数。
    let movedSum=0
    for(const w of WEAPONS){
      const n=Math.min(leaf.weapons[w.id],Math.floor(leaf.weapons[w.id]*take/leaf.troops))
      newWeapons[w.id]+=n;leaf.weapons[w.id]-=n;movedSum+=n
    }
    let remainWeapons=WEAPONS.reduce((n,w)=>n+leaf.weapons[w.id],0)
    for(const w of WEAPONS){
      while(leaf.weapons[w.id]>0&&(remainWeapons>remain||movedSum<take&&leaf.weapons[w.id]>remain)){
        leaf.weapons[w.id]--;newWeapons[w.id]++;remainWeapons--;movedSum++
      }
    }
    need-=take;totalLeft-=take;leaf.troops=remain
    if(remain===0)s.formations.splice(s.formations.indexOf(leaf),1)
    else if(remain<FORMATION_TYPES.find(v=>v.id===leaf.type).min)leaf.battleDamaged=true
  }
  const sync=node=>{
    if(!node.children)return node
    node.children=node.children.filter(cid=>s.formations.some(u=>u.id===cid)).map(cid=>sync(s.formations.find(u=>u.id===cid)).id)
    const kids=node.children.map(cid=>s.formations.find(u=>u.id===cid))
    node.troops=kids.reduce((n,u)=>n+u.troops,0);node.weapons=sumFormationWeapons(kids)
    const k=FORMATION_TYPES.find(v=>v.id===node.type)
    if(node.children.length<3||node.troops<k.min)node.battleDamaged=true
    return node
  }
  if(unit.children)sync(unit)
  // 编号按各上级分别计数：同一上级分出的第一个班叫“上级-1班”，第二个叫“上级-2班”。
  const number=nextFormationNumber(s,type,null,unit.id)
  const created={id:nextInternalId(s),number,type,troops,weapons:newWeapons,splitParent:unit.id,splitPrefix:formationName(unit),...(garrisonSite(s,unit.id)!==null?{splitOrigin:garrisonSite(s,unit.id)}:{})}
  s.formations.push(created)
  return {ok:true,unit:created}
}

export function rejoinFormation(s,id){
  const branch=s.formations.find(unit=>unit.id===id)
  const parent=branch&&s.formations.find(unit=>unit.id===branch.splitParent&&unit.id!==id)
  if(!parent)return {ok:false,message:'找不到这支分队的原上级'}
  if(branch.children||formationParent(s,id))return {ok:false,message:'请先解除分队已有的合编，再合回原上级'}
  if(s.formations.some(unit=>unit.splitParent===id))return {ok:false,message:'请先把这支分队下属的分队合回来'}
  let host=parent
  for(let unit=parent;unit;unit=formationParent(s,unit.id)){
    host=unit
    const kind=FORMATION_TYPES.find(kind=>kind.id===unit.type)
    if(unit.troops+branch.troops>kind.max)return {ok:false,message:`合回后${formationName(unit)}会超过 ${kind.max} 人的上限`}
  }
  if(formationActivity(s,id,true)||formationActivity(s,host.id,true))return {ok:false,message:'请先结束分队和上级正在执行的任务'}
  if(marchOrigin(s,id)!==marchOrigin(s,host.id))return {ok:false,message:'分队和上级需要在同一地点，请先撤回分队到上级身边'}
  const {units:byId,count:assigned}=formationHierarchy(s)
  const buildPlan=(unit,level,requested)=>{
    const kind=FORMATION_TYPES[level],occupied=unit===parent?parent.troops:unit?assigned([unit.id]):0
    const target=Math.max(0,Math.min(requested,kind.max-occupied))
    if(!unit?.children)return {unit,kind,added:target,children:null}
    const children=[]
    let remaining=target
    for(const childId of unit.children){
      if(!remaining)break
      const child=buildPlan(byId.get(childId),level-1,remaining)
      if(child.added>0){children.push(child);remaining-=child.added}
    }
    for(let index=unit.children.length;index<3&&remaining;index++){
      const child=buildPlan(null,level-1,remaining)
      children.push(child);remaining-=child.added
    }
    return {unit,kind,added:target-remaining,children}
  }
  const plan=buildPlan(parent,FORMATION_TYPES.findIndex(kind=>kind.id===parent.type),branch.troops)
  if(plan.added!==branch.troops)return {ok:false,message:'上级下属编制的空位不足，无法接收整支分队'}
  const weapons={...branch.weapons}
  const apply=({unit,kind,added,children})=>{
    if(!unit){
      unit={id:nextInternalId(s),number:nextFormationNumber(s,kind.id),type:kind.id,troops:0,weapons:sumFormationWeapons([])}
      s.formations.push(unit)
    }
    if(children){
      for(const child of children){
        const member=apply(child)
        if(!child.unit)unit.children.push(member.id)
      }
      const members=unit.children.map(member=>s.formations.find(item=>item.id===member))
      unit.troops=members.reduce((total,member)=>total+member.troops,0)
      unit.weapons=sumFormationWeapons(members)
    }else{
      let capacity=added
      for(const {id:weapon} of WEAPONS){
        const moved=Math.min(capacity,weapons[weapon]);unit.weapons[weapon]+=moved;weapons[weapon]-=moved;capacity-=moved
      }
      unit.troops+=added
      if(unit.troops<kind.min)unit.battleDamaged=true
    }
    return unit
  }
  apply(plan)
  refreshFormationParents(s,parent.id)
  const inheritGarrison=garrisonSite(s,host.id)===null
  const removeBranch=ids=>inheritGarrison?ids.map(unitId=>unitId===id?host.id:unitId):ids.filter(unitId=>unitId!==id)
  for(const [village,ids] of Object.entries(s.garrisons))if(ids.includes(id)){
    const remaining=removeBranch(ids)
    if(remaining.length)s.garrisons[village]=remaining
    else delete s.garrisons[village]
    if(inheritGarrison)delete host.splitOrigin
  }
  for(const region of Object.values(s.mapRegions))if(region.garrisonIds.includes(id)){
    region.garrisonIds=removeBranch(region.garrisonIds)
    if(inheritGarrison)delete host.splitOrigin
  }
  s.formations.splice(s.formations.indexOf(branch),1)
  return {ok:true,parent,troops:branch.troops,message:`${formationName(branch)}的 ${branch.troops} 人已合回${formationName(parent)}`}
}
