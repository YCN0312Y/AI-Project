import {mapField,mapLocation} from './world-map.js'
import {hungerStatus} from './logistics.js'
export const FARM_TRAVEL_SPEED=160
export const farmRouteLength=t=>t.route.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-t.route[i].x,p.y-t.route[i].y),0)
export function attachFarmTravel(task){
  const field=mapField(task.fieldId),village=mapLocation(task.villageId),dx=field.x-village.x,dy=field.y-village.y,length=Math.hypot(dx,dy)||1
  task.route=Array.from({length:25},(_,i)=>{const t=i/24,u=1-t,bend=Math.sin(Math.PI*t)*55;return {x:village.x+dx*t-dy/length*bend,y:village.y+dy*t+dx/length*bend}})
  task.phase='outbound';task.travelled=0
}
const snap=n=>Math.round(n*1e6)/1e6
export function farmTravelPosition(task){
  const route=task.phase==='returning'?[...task.route].reverse():task.route
  let remaining=task.phase==='working'?farmRouteLength(task):task.travelled
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],length=Math.hypot(b.x-a.x,b.y-a.y)
    if(remaining<=length){const t=length?remaining/length:0;return {x:snap(a.x+(b.x-a.x)*t),y:snap(a.y+(b.y-a.y)*t)}}
    remaining-=length
  }
  return {x:snap(route[route.length-1].x),y:snap(route[route.length-1].y)}
}
export function nextFarmEvent(s,task,duration,canWork){
  if(task.phase&&task.phase!=='working')return Math.max(1e-7,(farmRouteLength(task)-task.travelled)/(FARM_TRAVEL_SPEED*hungerStatus(s).speedMultiplier))
  return canWork?Math.max(0,duration-task.elapsed):Infinity
}
export function restoreFarmTravel(task,raw){
  if(!raw.phase)return true
  if(!task.villageId||!['outbound','working','returning'].includes(raw.phase)||!Array.isArray(raw.route)||raw.route.length<2||raw.route.length>1000||!raw.route.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))||!Number.isFinite(raw.travelled)||raw.travelled<0)return false
  const village=mapLocation(task.villageId),field=mapField(task.fieldId),first=raw.route[0],last=raw.route.at(-1)
  const movedField=raw.phase!=='returning'&&(last.x!==field.x||last.y!==field.y)
  if(first.x!==village.x||first.y!==village.y||movedField){
    const length=farmRouteLength(raw),progress=length?Math.min(1,raw.travelled/length):0
    attachFarmTravel(task);task.travelled=progress*farmRouteLength(task)
  }else{
    task.route=raw.route.map(p=>({x:p.x,y:p.y}))
    task.travelled=Math.min(raw.travelled,farmRouteLength(task))
  }
  task.phase=raw.phase
  return true
}
