import { WEAPONS } from './weapons.js'
import { formationRoots, formationName } from './state.js'
import { formationActivity } from './base.js'
import {hungerStatus} from './logistics.js'
import {isVillage,unitVillage} from './villages.js'
export const trainingTaskAt=(s,villageId=null)=>villageId?s.villageTrainingTasks?.[villageId]:s.trainingTask
export const trainingTasks=s=>[s.trainingTask,...Object.values(s.villageTrainingTasks||{})].filter(Boolean)

export const TRAINING_SECONDS_PER_SOLDIER = 1
export const trainingDuration=troops=>troops*TRAINING_SECONDS_PER_SOLDIER
export const TRAINING_XP = 30
export const TRAINING_LEVELS = [
  {xp:0,name:'新兵',bonus:0},
  {xp:60,name:'合格',bonus:.03},
  {xp:180,name:'熟练',bonus:.06},
  {xp:360,name:'精锐',bonus:.09},
  {xp:600,name:'老兵',bonus:.12},
]
const MAX_XP = TRAINING_LEVELS[TRAINING_LEVELS.length - 1].xp
function levelIndex(average) {
  let index = 0
  for (let i = 1; i < TRAINING_LEVELS.length; i++) if (average >= TRAINING_LEVELS[i].xp) index = i
  return index
}

function leavesOf(save, id) {
  if (id == null) return save.formations.filter(unit => !unit.children)
  const byId = new Map(save.formations.map(unit => [unit.id, unit]))
  const leaves = []
  function visit(unitId) {
    const unit = byId.get(unitId)
    if (!unit) return
    if (unit.children) unit.children.forEach(visit)
    else leaves.push(unit)
  }
  visit(id)
  return leaves
}

export function trainingStatus(save, id = null) {
  const leaves = leavesOf(save, id)
  const troops = id == null ? save.troops : leaves.reduce((sum, unit) => sum + unit.troops, 0)
  const xp = leaves.reduce((sum, unit) => sum + (unit.trainingXp || 0), 0) + (id == null ? (save.reserveTrainingXp || 0) : 0)
  const average = troops ? Math.min(MAX_XP, Math.floor(xp / troops)) : 0
  const index = levelIndex(average)
  const level = TRAINING_LEVELS[index], next = TRAINING_LEVELS[index + 1]
  return {troops,xp,average,index,name:level.name,bonus:level.bonus,nextXp:next?.xp ?? null,nextName:next?.name ?? null,
    ratio:next?(average-level.xp)/(next.xp-level.xp):1}
}

export function createTraining(save, id, villageId=null) {
  const unit = formationRoots(save).find(unit => unit.id === id)
  if(villageId!==null&&(!isVillage(villageId)||unitVillage(save,id)!==villageId))return null
  if (!unit || formationActivity(save,id,villageId!==null) || trainingStatus(save, id).nextXp === null) return null
  return {unitId:id,name:formationName(unit),troops:unit.troops,elapsed:0,duration:trainingDuration(unit.troops),settled:false,
    soldiers:leavesOf(save, id).map(unit => ({id:unit.id,troops:unit.troops})),...(villageId!==null?{villageId}:{})}
}

export function advanceTraining(session, dt) {
  if (session.settled || !Number.isFinite(dt) || dt <= 0) return
  session.elapsed = Math.min(session.duration, session.elapsed + dt)
}

export function completeTraining(save, session) {
  if (!session || session.settled || session.elapsed < session.duration || (trainingTaskAt(save,session.villageId)&&trainingTaskAt(save,session.villageId)!==session)) return null
  const unit = formationRoots(save).find(unit => unit.id === session.unitId)
  const current = unit ? leavesOf(save, unit.id) : []
  const expected = new Map(session.soldiers.map(unit => [unit.id, unit.troops]))
  session.settled = true
  if(save.trainingTask===session)save.trainingTask=null
  if(session.villageId&&save.villageTrainingTasks?.[session.villageId]===session)delete save.villageTrainingTasks[session.villageId]
  const busy=unit&&formationActivity(save,unit.id,!!session.villageId)
  if (!unit || (busy&&busy!=='training') || (session.villageId&&unitVillage(save,unit.id)!==session.villageId) || !current.length || current.length !== session.soldiers.length || current.some(unit => expected.get(unit.id) !== unit.troops)) return null
  const before = trainingStatus(save, unit.id)
  let gained = 0
  for (const soldierUnit of current) {
    const previous = soldierUnit.trainingXp || 0
    soldierUnit.trainingXp = Math.min(soldierUnit.troops * MAX_XP, previous + soldierUnit.troops * TRAINING_XP)
    gained += soldierUnit.trainingXp - previous
  }
  save.trainingSessions++
  return {name:session.name,troops:session.troops,gained,before,after:trainingStatus(save, unit.id),...(session.villageId?{villageId:session.villageId}:{})}
}

export function startTrainingTask(save,id,villageId=null){
  if(trainingTaskAt(save,villageId))return {ok:false,message:'已有部队正在训练，请先完成或召回'}
  if(hungerStatus(save).disabled)return {ok:false,message:'部队极度饥饿，请先供餐再安排训练'}
  const session=createTraining(save,id,villageId)
  if(!session)return {ok:false,message:'请选择空闲、未满级的独立部队参训'}
  if(villageId!==null)save.villageTrainingTasks[villageId]=session;else save.trainingTask=session
  return {ok:true,session}
}
export function cancelTrainingTask(save,villageId=null){
  const task=trainingTaskAt(save,villageId);if(!task)return false
  task.settled=true;if(villageId!==null)delete save.villageTrainingTasks[villageId];else save.trainingTask=null;return true
}
export function reconcileVillageTraining(save,villageId){
  const session=trainingTaskAt(save,villageId)
  if(!session)return
  const survivors=formationRoots(save).find(unit=>unit.id===session.unitId)
  if(!survivors){cancelTrainingTask(save,villageId);return}
  session.troops=survivors.troops
  session.soldiers=leavesOf(save,survivors.id).map(unit=>({id:unit.id,troops:unit.troops}))
  session.duration=trainingDuration(survivors.troops)
  session.elapsed=Math.min(session.elapsed,session.duration)
}
export function advanceTrainingTask(save,seconds,canTrain=!hungerStatus(save).disabled,villageId=null){
  const session=trainingTaskAt(save,villageId)
  if(!session||!Number.isFinite(seconds)||seconds<0)return null
  if(session.settled){cancelTrainingTask(save,villageId);return null}
  if(canTrain)advanceTraining(session,seconds)
  return session.elapsed>=session.duration?completeTraining(save,session):null
}
export function normalizeTraining(save,raw){
  save.trainingTask=null;save.villageTrainingTasks={}
  const restore=(task,villageId=null)=>{
    if(!task||task.settled!==false||!Number.isFinite(task.elapsed)||task.elapsed<0)return null
    const current=createTraining(save,task.unitId,villageId)
    if(!current||task.troops!==current.troops||task.duration!==current.duration||task.elapsed>current.duration||!Array.isArray(task.soldiers)||task.soldiers.length!==current.soldiers.length)return null
    const expected=new Map(current.soldiers.map(unit=>[unit.id,unit.troops])),seen=new Set()
    for(const unit of task.soldiers){
      if(!unit||seen.has(unit.id)||expected.get(unit.id)!==unit.troops)return null
      seen.add(unit.id)
    }
    current.elapsed=task.elapsed
    if(villageId!==null)save.villageTrainingTasks[villageId]=current;else save.trainingTask=current
    return current
  }
  const legacy=restore(raw?.trainingTask)
  for(const [id,task] of Object.entries(raw?.villageTrainingTasks||{}))if(isVillage(Number(id))&&task?.villageId===Number(id))restore(task,Number(id))
  return legacy
}

export function trainedCombatGroups(save, id = null) {
  const leaves = leavesOf(save, id)
  return WEAPONS.map(weapon => {
    let troops = 0, bonus = 0
    for (const unit of leaves) {
      const count = unit.weapons[weapon.id]
      troops += count
      bonus += count * TRAINING_LEVELS[levelIndex(Math.floor((unit.trainingXp||0)/unit.troops))].bonus
    }
    return {weapon:weapon.id,troops,trainingBonus:troops?bonus/troops:0}
  }).filter(group => group.troops > 0)
}
