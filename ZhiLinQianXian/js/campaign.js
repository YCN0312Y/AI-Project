import { Battle } from './battle.js'
import { formationRoots, formationName,FORMATION_TYPES } from './state.js'
import { trainedCombatGroups } from './training.js'
import { WEAPONS,weaponById } from './weapons.js'
import { formationActivity,activityLabel } from './base.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const MELEE={id:'melee',range:34,interval:.65,damage:.42}
const MELEE_EXPOSURE=.5
function nearestEnemy(unit,enemies,range=Infinity){
  let target=null,best=range
  for(const enemy of enemies){
    if(enemy.hp<=0)continue
    const distance=Math.hypot(enemy.x-unit.x,enemy.y-unit.y)
    if(distance<best){target=enemy;best=distance}
  }
  return target
}
const shareCounts=(weights,total)=>{
  const sum=weights.reduce((a,b)=>a+b,0),shares=weights.map(n=>sum?n*total/sum:0),counts=shares.map(Math.floor)
  const order=shares.map((n,i)=>({i,r:n-counts[i]})).sort((a,b)=>b.r-a.r||a.i-b.i)
  for(let i=0,left=total-counts.reduce((a,b)=>a+b,0);i<left;i++)counts[order[i].i]++
  return counts
}

export function enemyUnitSpec(level,wave,index){
  const tiers=[{type:'squad',name:'班',min:7,max:12},{type:'platoon',name:'排',min:25,max:40},
    {type:'company',name:'连',min:100,max:150},{type:'battalion',name:'营',min:400,max:1000}]
  const kind=tiers[Math.min(3,Math.floor((level-1)/3))]
  const troops=kind.min+((level-1)*3+(wave-1)*2+index)%(kind.max-kind.min+1)
  const weapon=level>=7&&index%3===2?'mortar':level>=4&&index%3===1?'machinegun':'rifle'
  return {type:kind.type,name:`敌${index+1}${kind.name}`,troops,weapon}
}

// 每个独立编制对应一个战斗单位，合编部队的下属只汇总一次。
export function campaignDeployment(save, ids, ignoreGarrison=false) {
  if (!Array.isArray(ids) || !ids.length) return {ok:false,message:'请至少选择一支出战部队'}
  if (new Set(ids).size !== ids.length) return {ok:false,message:'同一支部队不能重复派遣'}
  const roots = formationRoots(save), units = []
  for (const id of ids) {
    const unit = roots.find(unit => unit.id === id)
    if (!unit) return {ok:false,message:'只能派遣独立部队，请重新选择'}
    const activity=formationActivity(save,id,ignoreGarrison)
    if(activity)return {ok:false,message:`${formationName(unit)}${activityLabel(activity)}，归队后才能出战`}
    const groups = trainedCombatGroups(save, id)
    const unarmed=unit.troops-groups.reduce((sum,group)=>sum+group.troops,0)
    if(unarmed>0)groups.push({weapon:null,troops:unarmed,trainingBonus:0})
    units.push({id,type:unit.type,name:formationName(unit),troops:unit.troops,groups})
  }
  return {ok:true,units,troops:units.reduce((sum, unit) => sum + unit.troops, 0)}
}

export class CampaignBattle extends Battle {
  constructor(level, roster, regionEnemies=null, ammoStock=null) {
    const troops = roster.reduce((sum, unit) => sum + unit.troops, 0)
    super('campaign', level, troops)
    this.ammoStock=ammoStock;this.ammoSpent=0
    this.enemyDamageMultiplier=1;this.enemyIntervalMultiplier=1;this.enemyLargeUnitDamage=0
    this.armedTroops=roster.reduce((total,unit)=>total+unit.groups.reduce((sum,group)=>sum+(group.weapon===null?0:group.troops),0),0)
    const columns = Math.max(1, Math.ceil(Math.sqrt(roster.length / 2)))
    const rows = Math.ceil(roster.length / columns)
    this.units = roster.map((unit, i) => {
      const x = roster.length === 1 ? 340 : columns === 1 ? 280 : 150 + (i % columns) * 300 / (columns - 1)
      const y = rows === 1 ? 405 : 215 + Math.floor(i / columns) * 360 / (rows - 1)
      return {id:unit.id,rootId:unit.id,type:unit.type||'squad',name:unit.name,maxHp:unit.troops,hp:unit.troops,x,y,target:{x,y},
        groups:unit.groups.map(group => ({...group,weapon:group.weapon===null?null:weaponById(group.weapon),cool:.2}))}
    })
    this.selectedUnitId = null
    this.enemySequence = 0
    this.enemyUnitsDestroyed = 0
    this.defeatedWeapons = Object.fromEntries(WEAPONS.map(weapon=>[weapon.id,0]))
    this.lostTroops = 0; this.lostUnits = 0
    this.combatReady = true
    this.detachmentSequence=0;this.casualties={}
    if(regionEnemies){this.regionEnemyQueue=regionEnemies.map(u=>({...u}));this.goal=1;this.pending=this.regionEnemyQueue.length}
  }
  recordLosses(unit){
    const total=unit.groups.reduce((sum,group)=>sum+group.troops,0),survivors=Math.min(total,Math.max(0,Math.ceil(unit.hp)))
    if(survivors===total)return
    const counts=shareCounts(unit.groups.map(group=>group.troops),survivors)
    const losses=this.casualties[unit.rootId]??=Object.fromEntries(WEAPONS.map(w=>[w.id,0]))
    unit.groups.forEach((group,i)=>{
      const key=group.weapon?.id||'unarmed'
      losses[key]=(losses[key]||0)+group.troops-counts[i];group.troops=counts[i]
    })
    unit.groups=unit.groups.filter(group=>group.troops>0)
    if(survivors>0)unit.maxHp=survivors
  }
  collectLosses(includeSurvivors=false){
    for(const unit of this.units)if(includeSurvivors||unit.hp<=0)this.recordLosses(unit)
    const result=this.casualties;this.casualties={};return result
  }
  splitOptions(unit=this.selectedUnit){
    if(!unit)return []
    const level=FORMATION_TYPES.findIndex(kind=>kind.id===unit.type),available=Math.ceil(unit.hp)-1
    return FORMATION_TYPES.slice(0,Math.max(0,level)).filter(kind=>kind.min<=available)
  }
  splitSelected(type,troops){
    const parent=this.selectedUnit,kind=this.splitOptions(parent).find(kind=>kind.id===type)
    if(this.done||!kind||!Number.isInteger(troops)||troops<kind.min||troops>kind.max||troops>=Math.ceil(parent.hp))return {ok:false,message:'分遣人数须符合下级编制区间，并为主力保留至少1人'}
    if(this.units.filter(unit=>unit.hp>0).length>=32)return {ok:false,message:'战场最多同时指挥32支部队，请先召回分遣部队'}
    this.recordLosses(parent)
    parent.hp=Math.ceil(parent.hp);parent.maxHp=parent.hp
    const counts=shareCounts(parent.groups.map(group=>group.troops),troops),groups=[]
    parent.groups.forEach((group,i)=>{if(counts[i])groups.push({...group,troops:counts[i]});group.troops-=counts[i]})
    parent.groups=parent.groups.filter(group=>group.troops>0);parent.hp-=troops;parent.maxHp-=troops
    const sequence=++this.detachmentSequence,x=clamp(parent.x+(parent.x>1220?-70:70),75,1310),y=clamp(parent.y+(parent.y>545?-55:55),175,600)
    const unit={id:'det-'+sequence,rootId:parent.rootId,parentActorId:parent.id,type,name:`分遣${sequence}${kind.name}`,maxHp:troops,hp:troops,x,y,target:{x,y},groups}
    this.units.push(unit);this.selectedUnitId=unit.id;this.syncHealth()
    return {ok:true,unit}
  }
  recallUnit(id=this.selectedUnitId){
    const unit=this.units.find(unit=>unit.id===id&&unit.hp>0),parent=this.units.find(parent=>parent.id===unit?.parentActorId)
    if(this.done||!unit||!parent)return false
    unit.returningTo=parent.id;return true
  }
  joinUnit(unit,parent){
    this.recordLosses(unit);this.recordLosses(parent)
    const total=unit.groups.reduce((sum,g)=>sum+g.troops,0)+parent.groups.reduce((sum,g)=>sum+g.troops,0)
    parent.hp=total;parent.maxHp=total
    for(const incoming of unit.groups){
      const group=parent.groups.find(group=>group.weapon?.id===incoming.weapon?.id&&group.trainingBonus===incoming.trainingBonus)
      if(group)group.troops+=incoming.troops
      else parent.groups.push({...incoming})
    }
    for(const child of this.units)if(child.parentActorId===unit.id){child.parentActorId=parent.id;if(child.returningTo===unit.id)child.returningTo=parent.id}
    this.units=this.units.filter(actor=>actor!==unit)
    if(this.selectedUnitId===unit.id)this.selectedUnitId=parent.id
    this.syncHealth()
  }
  count() { return Math.min(8,3+Math.floor((this.level-1)/3)+Math.floor((this.wave-1)/2)) }
  get selectedUnit() { return this.units.find(unit => unit.id === this.selectedUnitId && unit.hp > 0) || null }
  selectUnit(id) {
    if (this.done || !this.units.some(unit => unit.id === id && unit.hp > 0)) return false
    this.selectedUnitId = id
    return true
  }
  command(x, y) {
    if (this.done || !Number.isFinite(x) || !Number.isFinite(y)) return false
    const hit = this.units.filter(unit => unit.hp > 0 &&
      (Math.hypot(unit.x - x, unit.y - y) <= 30 || (Math.abs(unit.x - x) <= 34 && y >= unit.y + 16 && y <= unit.y + 41)))
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]
    if(hit&&this.selectedUnit?.parentActorId===hit.id)return this.recallUnit()
    if (hit) return this.selectUnit(hit.id)
    return this.moveSelected(x, y)
  }
  moveSelected(x, y) {
    const unit = this.selectedUnit
    if (this.done || !unit || !Number.isFinite(x) || !Number.isFinite(y)) return false
    unit.target = {x:clamp(x, 75, 1310),y:clamp(y, 175, 600)}
    const parent=this.units.find(parent=>parent.id===unit.parentActorId)
    unit.returningTo=parent&&Math.hypot(parent.x-x,parent.y-y)<=38?parent.id:null
    return true
  }
  syncHealth() {
    this.hp = this.units.reduce((sum, unit) => sum + Math.max(0, unit.hp), 0)
    if (!this.selectedUnit) this.selectedUnitId = null
  }
  canFire(group){
    return !!group.weapon&&(!this.ammoStock||this.ammoStock[group.weapon.ammo]>0)
  }
  attackRange(unit){
    return Math.max(MELEE.range,...unit.groups.map(group=>this.canFire(group)?group.weapon.range:MELEE.range))
  }
  meleeTroops(unit){
    return unit.groups.reduce((count,group)=>count+(this.canFire(group)?0:group.troops),0)
  }
  update(dt) {
    if (this.done || !Number.isFinite(dt) || dt <= 0) return
    this.time += dt
    this.artillery = Math.max(0, this.artillery - dt)
    for (const unit of this.units) {
      if (unit.hp <= 0) continue
      const parent=this.units.find(parent=>parent.id===unit.returningTo)
      if(parent)unit.target={x:parent.x,y:parent.y}
      let {x,y}=unit.target
      // 近战部队到达指令位置后自动接近最近的敌人。移动命令和召回优先。
      const autoApproach=!parent&&Math.hypot(x-unit.x,y-unit.y)<=1&&this.attackRange(unit)===MELEE.range
      if(autoApproach){
        const enemy=nearestEnemy(unit,this.enemies)
        if(enemy&&Math.hypot(enemy.x-unit.x,enemy.y-unit.y)>=MELEE.range){x=enemy.x;y=enemy.y}
      }
      const dx=x-unit.x,dy=y-unit.y,distance=Math.hypot(dx,dy)
      if (distance > 1) {
        const step = Math.min(distance, 160 * this.speedMultiplier * dt)
        unit.x += dx / distance * step; unit.y += dy / distance * step
        if(autoApproach)unit.target={x:unit.x,y:unit.y}
      }
    }
    for(const unit of [...this.units]){
      const parent=this.units.find(parent=>parent.id===unit.parentActorId)
      if(unit.hp>0&&parent&&Math.hypot(unit.x-parent.x,unit.y-parent.y)<=28)this.joinUnit(unit,parent)
    }
    this.spawn -= dt
    if (this.pending > 0 && this.spawn <= 0 && this.enemies.length < 40) {
      const spec=this.regionEnemyQueue?this.regionEnemyQueue.shift():enemyUnitSpec(this.level,this.wave,this.enemySequence++)
      this.enemies.push({...spec,x:1340,y:195 + Math.random() * 380,hp:spec.troops,maxHp:spec.troops,cool:.7 + Math.random()})
      this.pending--; this.spawn = Math.max(.45, 1.3 - this.wave * .045)
    }
    for (const unit of this.units) {
      if (unit.hp <= 0) continue
      for (const group of unit.groups) {
        if(this.combatReady===false)continue
        group.cool -= dt
        if(group.cool>0)continue
        const ranged=this.canFire(group),weapon=ranged?group.weapon:MELEE
        const target=nearestEnemy(unit,this.enemies,weapon.range)
        if(!target)continue
        const strength=Math.max(0,unit.hp)/unit.maxHp
        const shooters=Math.ceil(group.troops*strength)
        if(ranged&&weapon.damagePerRound){
          const readyShooters=Math.ceil(group.troops*strength*this.damageMultiplier)
          let rounds=Math.min(readyShooters,this.ammoStock?this.ammoStock[weapon.ammo]:readyShooters)
          let aim=target
          while(rounds>0&&aim){
            const fired=Math.min(rounds,Math.ceil(aim.hp/weapon.damagePerRound))
            aim.hp-=fired*weapon.damagePerRound
            rounds-=fired
            if(this.ammoStock){this.ammoStock[weapon.ammo]-=fired;this.ammoSpent+=fired}
            this.shots.push({x:unit.x+15,y:unit.y-5,tx:aim.x,ty:aim.y,life:.12,hostile:false,kind:weapon.id})
            if(rounds>0)aim=nearestEnemy(unit,this.enemies,weapon.range)
          }
          group.cool=weapon.interval*this.intervalMultiplier/(1+(group.trainingBonus||0))
          continue
        }
        let firingShare=1
        if(ranged&&this.ammoStock){
          const used=Math.min(shooters,this.ammoStock[weapon.ammo])
          this.ammoStock[weapon.ammo]-=used;this.ammoSpent+=used
          firingShare=used/shooters
        }
        const baseStrength=ranged?this.armedTroops:this.maxHp
        const damage=(7+baseStrength*.025)*weapon.damage*(group.troops/baseStrength)*strength*firingShare*(1+(group.trainingBonus||0))*this.damageMultiplier
        group.cool = weapon.interval*this.intervalMultiplier
        if (weapon.splash) {
          for (const enemy of this.enemies) if (enemy.hp > 0 && Math.hypot(enemy.x - target.x, enemy.y - target.y) <= weapon.splash) enemy.hp -= damage
          if (this.bursts.length < 32) this.bursts.push({x:target.x,y:target.y,life:.4,radius:weapon.splash})
        } else target.hp -= damage
        this.shots.push({x:unit.x + 15,y:unit.y - 5,tx:target.x,ty:target.y,life:weapon.splash ? .25 : .12,hostile:false,kind:weapon.id})
      }
    }
    const alive = this.units.filter(unit => unit.hp > 0)
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue
      let target = null, distance = Infinity
      for (const unit of alive) {
        if (unit.hp <= 0) continue
        const d = Math.hypot(unit.x - enemy.x, unit.y - enemy.y)
        if (d < distance) { distance = d; target = unit }
      }
      if (!target) break
      const dx = target.x - enemy.x, dy = target.y - enemy.y, d = distance || 1
      const weapon=weaponById(enemy.weapon||'rifle')
      if (distance > Math.min(330,weapon.range*.7)) {enemy.x += dx / d * 55 * dt; enemy.y += dy / d * 42 * dt}
      enemy.cool -= dt
      if (distance < weapon.range && enemy.cool <= 0) {
        enemy.cool = Math.max(.6,weapon.interval*4)*this.enemyIntervalMultiplier
        const meleeShare=this.meleeTroops(target)/target.groups.reduce((total,group)=>total+group.troops,0)
        const enemyFirepower=1.2+Math.min(80,enemy.maxHp)*.09+Math.max(0,enemy.hp-80)*this.enemyLargeUnitDamage
        const damage=enemyFirepower*weapon.damage*this.enemyDamageMultiplier*(1+MELEE_EXPOSURE*meleeShare)
        target.hp = Math.max(0, target.hp - damage)
        this.shots.push({x:enemy.x,y:enemy.y,tx:target.x,ty:target.y,life:.15,hostile:true,kind:weapon.id})
      }
    }
    this.enemies = this.enemies.filter(enemy => {
      const casualties=enemy.maxHp-Math.ceil(Math.max(0,enemy.hp))
      this.kills+=casualties-(enemy.recordedTroopLosses||0)
      enemy.recordedTroopLosses=casualties
      if (enemy.hp > 0) return true
      this.enemyUnitsDestroyed++
      // 只记实际被击溃的部队，每名敌兵携带一把；跨波累计，胜利结算时才入库。
      const count=enemy.troops??enemy.maxHp
      if(Number.isFinite(count)&&count>0)this.defeatedWeapons[weaponById(enemy.weapon).id]+=Math.floor(count)
      if (this.bursts.length < 32) this.bursts.push({x:enemy.x,y:enemy.y,life:.4})
      return false
    })
    this.shots = this.shots.filter(shot => (shot.life -= dt) > 0)
    this.bursts = this.bursts.filter(burst => (burst.life -= dt) > 0)
    this.syncHealth()
    if (this.hp <= 0) {this.done = true; return}
    if (!this.pending && !this.enemies.length) {
      this.breather += dt
      if (this.breather > 1.5) {
        if (this.wave >= this.goal) {this.done = true; this.won = true}
        else {
          this.wave++; this.pending = this.count(); this.breather = 0; this.spawn = 1
          this.syncHealth()
        }
      }
    }
  }
  heal() {
    return false
  }
  strike(){return false}
}
