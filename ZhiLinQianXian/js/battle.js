import { weaponById } from './weapons.js'
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v))
export class Battle {
  constructor(mode,level,troops,weapon='rifle',loadout=null){
    this.weapon=weaponById(weapon)
    this.groups=loadout?.map(g=>({weapon:weaponById(g.weapon),troops:g.troops,trainingBonus:Math.max(0,Math.min(.12,g.trainingBonus||0)),cool:.2}))||null
    Object.assign(this,{mode,level,maxHp:troops,hp:troops,x:340,y:405,target:{x:340,y:405},wave:1,kills:0,time:0,spawn:1,cool:0.2,enemies:[],shots:[],bursts:[],done:false,won:false,settled:false,breather:0,artillery:0})
    this.damageMultiplier=1;this.intervalMultiplier=1;this.speedMultiplier=1
    this.goal=mode==='defense'?Infinity:3+Math.floor(level/4)
    this.pending=this.count()
  }
  count(){return Math.min(18,4+this.level+this.wave*2)}
  command(x,y){this.target={x:clamp(x,75,1310),y:clamp(y,170,625)}}
  update(dt){
    if(this.done)return
    this.time+=dt;this.artillery=Math.max(0,this.artillery-dt)
    const dx=this.target.x-this.x,dy=this.target.y-this.y,d=Math.hypot(dx,dy)
    if(d>1){const step=Math.min(d,160*this.speedMultiplier*dt);this.x+=dx/d*step;this.y+=dy/d*step}
    this.spawn-=dt
    if(this.pending>0&&this.spawn<=0&&this.enemies.length<40){
      const heavy=this.wave>=3&&this.pending%4===0
      this.enemies.push({x:1360,y:180+Math.random()*420,hp:(heavy?75:26)+this.level*4+this.wave*2,maxHp:(heavy?75:26)+this.level*4+this.wave*2,cool:.7+Math.random(),heavy})
      this.pending--;this.spawn=Math.max(.45,1.3-this.wave*.045)
    }
    this.cool-=dt
    const groups=this.groups||[{weapon:this.weapon,troops:this.maxHp,cool:this.cool}]
    for(const group of groups){
      if(this.combatReady===false)continue
      if(this.groups)group.cool-=dt
      const w=group.weapon
      let target=null,best=w.range
      for(const e of this.enemies){const dist=Math.hypot(e.x-this.x,e.y-this.y);if(e.hp>0&&dist<best){target=e;best=dist}}
      if(!target||group.cool>0)continue
      const damage=(7+this.maxHp*.025)*w.damage*(group.troops/this.maxHp)*(1+(group.trainingBonus||0))*this.damageMultiplier
      group.cool=w.interval*this.intervalMultiplier;if(!this.groups)this.cool=group.cool
      if(w.splash){
        for(const e of this.enemies)if(e.hp>0&&Math.hypot(e.x-target.x,e.y-target.y)<=w.splash)e.hp-=damage
        if(this.bursts.length<32)this.bursts.push({x:target.x,y:target.y,life:.4,radius:w.splash})
      }else target.hp-=damage
      this.shots.push({x:this.x+15,y:this.y-5,tx:target.x,ty:target.y,life:w.splash ? .25 : .12,hostile:false,kind:w.id})
    }
    for(const e of this.enemies){
      if(e.hp<=0)continue
      const ex=this.x-e.x,ey=this.y-e.y,dist=Math.hypot(ex,ey)||1
      if(dist>(e.heavy?330:235)){e.x+=ex/dist*(e.heavy?43:64)*dt;e.y+=ey/dist*42*dt}
      e.cool-=dt
      if(dist<350&&e.cool<=0){e.cool=e.heavy?1.8:1.3;this.hp-=e.heavy?7:3+this.level*.35;this.shots.push({x:e.x,y:e.y,tx:this.x,ty:this.y,life:.15,hostile:true})}
    }
    this.enemies=this.enemies.filter(e=>{if(e.hp>0)return true;this.kills++;if(this.bursts.length<32)this.bursts.push({x:e.x,y:e.y,life:.4});return false})
    this.shots=this.shots.filter(s=>(s.life-=dt)>0);this.bursts=this.bursts.filter(s=>(s.life-=dt)>0)
    if(this.hp<=0){this.hp=0;this.done=true;return}
    if(!this.pending&&!this.enemies.length){
      this.breather+=dt
      if(this.breather>1.5){
        if(this.wave>=this.goal){this.done=true;this.won=true}
        else{this.wave++;this.pending=this.count();this.breather=0;this.spawn=1}
      }
    }
  }
  // 保留旧调用接口，战场医疗和炮火功能已撤除。
  heal(){return false}
  strike(){return false}
}
