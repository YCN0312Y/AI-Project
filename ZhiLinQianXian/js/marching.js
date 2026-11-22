import {MAP_BASE,MAP_ROADS,MAP_REGION_ROADS,ALL_VILLAGES,mapBase,mapRegion,mapLocation} from './world-map.js'
import {detachGarrison,formationRoots,garrisonSite} from './state.js'
import {activityLabel,formationActivity} from './base.js'
import {regionDispatch,regionUnits,regionEnemyTroops,occupyRegion} from './regions.js'
import {stationTroops} from './villages.js'
import {hungerStatus} from './logistics.js'

export const MARCH_SPEED=160
export const freshMarches=()=>({marchingOrders:[]})
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y)
export const routeLength=route=>route.slice(1).reduce((n,p,i)=>n+distance(route[i],p),0)
export const marchTarget=order=>order.kind==='region'?mapRegion(order.targetId):ALL_VILLAGES.find(v=>v.id===order.targetId)
const targetRegion=order=>order.kind==='region'?order.targetId:marchTarget(order)?.regionId??order.targetId

export function marchRoute(target,origin='base'){
  if(origin==='base')origin=MAP_BASE.roadId
  const destination=target.regionId||target.id,roads=[...MAP_ROADS,...MAP_REGION_ROADS],cost=new Map([[origin,0]]),previous=new Map(),done=new Set()
  while(true){
    const next=[...cost].filter(([id])=>!done.has(id)).sort((a,b)=>a[1]-b[1])[0]
    if(!next)break
    const [id,score]=next;if(id===destination)break;done.add(id)
    for(const road of roads){
      const to=road.from===id?road.to:road.to===id?road.from:null;if(to===null)continue
      const weight=distance(mapLocation(id),mapLocation(to)),candidate=score+weight
      if(candidate<(cost.get(to)??Infinity)){cost.set(to,candidate);previous.set(to,{from:id,road,reverse:road.to===id})}
    }
  }
  const steps=[];let id=destination
  while(previous.has(id)){const step=previous.get(id);steps.unshift(step);id=step.from}
  const from=mapLocation(origin)
  if(id!==origin||!steps.length)return [{x:from.x,y:from.y},{x:target.x,y:target.y}]
  const route=[]
  for(const {road,reverse} of steps){
    const a=mapLocation(road.from),b=mapLocation(road.to),[x1,y1,x2,y2]=road.controls
    const points=Array.from({length:25},(_,i)=>{const t=i/24,u=1-t;return {x:u*u*u*a.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*b.y}})
    if(reverse)points.reverse();route.push(...(route.length?points.slice(1):points))
  }
  return route
}

export function marchPosition(order){
  let left=order.travelled
  for(let i=1;i<order.route.length;i++){
    const a=order.route[i-1],b=order.route[i],length=distance(a,b)
    if(left<=length){const t=length?left/length:0;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}}
    left-=length
  }
  return {...order.route[order.route.length-1]}
}

// 出发地：已驻防则从驻地出发；刚从驻军分出的待命部队从原上级所在地出发；其余才从根据地出发。
export function marchOrigin(s,id){
  const site=garrisonSite(s,id);if(site!==null)return site
  const unit=s.formations.find(u=>u.id===id),origin=unit?.splitOrigin
  return origin!==undefined&&(ALL_VILLAGES.some(v=>(v.regionId||v.id)===origin)||mapRegion(origin))?origin:'base'
}
function queueMarch(s,kind,target,unitIds,origin){
  s.marchingOrders||=[]
  const order={id:s.marchingOrders.reduce((n,o)=>Math.max(n,o.id),0)+1,kind,targetId:target.id,unitIds,route:marchRoute(target,origin==='base'?mapBase(s).roadId:origin),travelled:0,status:'moving'}
  s.marchingOrders.push(order)
  return order
}
export function startMarch(s,kind,targetId,unitIds){
  const target=kind==='region'?mapRegion(targetId):kind==='village'?ALL_VILLAGES.find(v=>v.id===targetId):null
  if(!target)return {ok:false,message:'请选择有效的行军目标'}
  const regionId=kind==='region'?targetId:target.regionId??target.id
  const check=regionDispatch(s,regionId,unitIds);if(!check.ok)return check
  // 不同出发地的部队分别成队，各走各的路。
  const groups=new Map();for(const id of unitIds){const key=marchOrigin(s,id);groups.set(key,[...(groups.get(key)||[]),id])}
  const orders=[...groups].map(([origin,ids])=>queueMarch(s,kind,target,ids,origin))
  const names=[...groups.keys()].map(origin=>mapLocation(origin,s).name).join('、')
  return {ok:true,order:orders[0],orders,message:`部队已从${names}出发，正在前往${target.name}`}
}

export function startGarrisonTransfer(s,unitId,originId,targetId){
  const origin=mapRegion(originId),target=mapRegion(targetId)
  if(!origin||regionEnemyTroops(s,originId)>0||!regionUnits(s,originId).some(unit=>unit.id===unitId))return {ok:false,message:'该部队已离开原驻地，请重新选择'}
  const activity=formationActivity(s,unitId,true)
  if(activity)return {ok:false,message:`部队${activityLabel(activity)}，请先结束当前任务`}
  if(!target||originId===targetId)return {ok:false,message:'请选择另一处村庄或据点'}
  if(regionEnemyTroops(s,targetId)>0)return {ok:false,message:'该据点由敌军占领，请选择可进驻的地点'}

  const order=queueMarch(s,'region',target,[unitId],origin.id)
  detachGarrison(s,origin.id,unitId)
  return {ok:true,order,message:`部队已从${origin.name}出发，前往${target.name}驻防`}
}

export function normalizeMarches(s,raw){
  s.marchingOrders=[]
  if(!Array.isArray(raw?.marchingOrders))return
  const roots=formationRoots(s),used=new Set()
  for(const order of raw.marchingOrders){
    if(!order||!['region','village'].includes(order.kind)||!marchTarget(order)||!Number.isSafeInteger(order.id)||order.id<1||used.has(order.id)||!['moving','awaiting-battle'].includes(order.status))continue
    const ids=order.unitIds,route=order.route
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!roots.some(u=>u.id===id)||formationActivity(s,id)))continue
    if(!Array.isArray(route)||route.length<2||route.length>10000||!route.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))||!Number.isFinite(order.travelled)||order.travelled<0)continue
    const target=marchTarget(order),restoredRoute=route.map(p=>({x:p.x,y:p.y}))
    const end=restoredRoute.at(-1)
    if(end.x!==target.x||end.y!==target.y)restoredRoute.push({x:target.x,y:target.y})
    const travelled=order.status==='awaiting-battle'?routeLength(restoredRoute):Math.min(order.travelled,routeLength(route))
    used.add(order.id);s.marchingOrders.push({id:order.id,kind:order.kind,targetId:order.targetId,unitIds:[...ids],route:restoredRoute,travelled,status:order.status})
  }
}

export function advanceMarches(s,seconds){
  const arrived=[]
  if(!Number.isFinite(seconds)||seconds<0)return arrived
  for(const order of [...(s.marchingOrders||[])]){
    const length=routeLength(order.route),regionId=targetRegion(order)
    if(order.status==='moving')order.travelled=Math.min(length,order.travelled+seconds*MARCH_SPEED*hungerStatus(s).speedMultiplier)
    if(order.travelled<length-1e-7)continue
    if(regionId&&regionEnemyTroops(s,regionId)>0){order.status='awaiting-battle';continue}
    // 先释放行军占用，再原子地转为驻防；人员/枪械始终只属于原编制。
    s.marchingOrders=s.marchingOrders.filter(o=>o!==order)
    const result=order.kind==='village'?stationTroops(s,order.targetId,order.unitIds):occupyRegion(s,order.targetId,order.unitIds)
    if(result.ok){for(const id of order.unitIds){const unit=s.formations.find(u=>u.id===id);if(unit)delete unit.splitOrigin};arrived.push({order,target:marchTarget(order)})}
    else s.marchingOrders.push(order)
  }
  return arrived
}

export function takeMarchBattle(s,id){
  const order=s.marchingOrders?.find(o=>o.id===id&&o.status==='awaiting-battle')
  if(!order)return null
  s.marchingOrders=s.marchingOrders.filter(o=>o!==order)
  return {order,regionId:targetRegion(order)}
}
