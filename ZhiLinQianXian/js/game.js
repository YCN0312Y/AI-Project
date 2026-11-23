import { C,box,text,line,circle,icon,tank,poly,brackets,weaponArt,baseRegionMap,regionRoads,villageFields,mapFlag } from './art.js'
import { MAP_CORE,MAP_BOUNDS,MAP_VIEW,MAP_LOCAL_VILLAGES,MAP_REGIONS,MAP_REGION_ROADS,REGION_KINDS,MAP_TERRAIN_STYLES,MAP_FLAG_COLORS,mapBase,mapRegion,mapVillage,MAP_ROADS,MAP_TRAILS,MAP_FIELDS,mapField,mapLocation,mapMarkerScale,createCamera,mapToScreen,screenToMap,anchorCamera,zoomCamera,panCamera,fitCamera,focusCamera } from './world-map.js'
import {regionRecord,regionUnits,regionLocalUnits,regionEnemyTroops,regionOwner,regionDispatch,occupyRegion,recallRegion,resolveRegionBattle} from './regions.js'
import {startMarch,startGarrisonTransfer,advanceMarches,marchPosition,marchTarget,routeLength,MARCH_SPEED,takeMarchBattle} from './marching.js'
import {farmTravelPosition,farmRouteLength,FARM_TRAVEL_SPEED} from './farm-travel.js'
import { SAVE_KEY,MODES,GOODS,MISSIONS,FORMATION_TYPES,normalizeSave,formation,baseForces,formationName as unitName,lineageRows,formationRoots,formationPool,formationParent,previewFormationMerge,mergeFormations,unmergeFormation,formationResources,autoFormationWeapons,formationMinimum,validateFormation,setFormation,removeFormation,garrisonSplitTypes,splitGarrisonUnit,purchase,purchaseWeapon,claim,settle,applyBattleLosses,applyWarehouseFoodAdjustment,applyRequestedRiceSupply } from './state.js'
import { WEAPONS,weaponById } from './weapons.js'
import { Battle } from './battle.js'
import { CampaignBattle,campaignDeployment } from './campaign.js'
import { reinforcementCapacity,reinforcementWeapons,validateReinforcement,reinforceFormation,formationEditActivity,rejoinFormation,syncIdleBranches,formationOccupancy } from './state.js'
import { chooseStartingBase,baseRelocationError,relocateBase,missionProgress } from './state.js'
import { FOODS,FISH,DISHES,RECRUITMENT,RATIONS,foodStock,rationStock,mealCost,recruitmentInterval,validateDonation,mobilizationStatus,donationTaste,validateCooking,cookDish,hungerStatus,recruitmentFoodCost,mobilizationRecord,migrateVillageMobilization,serveMealNow,enableAllVillageMobilization,setAllVillagesMobilizing,donateAllVillages } from './logistics.js'
import { TRAINING_XP,trainingDuration,trainingStatus,startTrainingTask,cancelTrainingTask,completeTraining,trainedCombatGroups,trainingTaskAt } from './training.js'
import {stationTroops,recallGarrison,placeVillageFacility,removeVillageFacility,armoryTransferError,transferArmory,villageUnits,villageLocalUnits,villageOfFormation,villageName,isVillage,villageControlled,villageEnemyTroops,villageRegionId,controlledVillages,garrisonedVillages} from './villages.js'
import {availableWorkforce,dutyTypes,DUTY_TYPES,PROJECT_UNIT_LIMIT,taskWorkersFrom} from './workforce.js'
import {populationRule,villagePopulation} from './population.js'
import { syncShop,purchaseQuote,shopAvailable,shopSells } from './shop.js'
import { FARM,fieldCooldown,CROPS,helpHarvestYield,farmWorkers,farmTasks,farmTaskAt,farmLocalUnits,farmReserveAvailable,startFarming,cancelFarming,formationActivity,activityLabel,assignFormations,releaseFormations } from './base.js'
import { advanceEconomy } from './economy.js'
import {PRODUCTS,FACILITY_INTERVAL,facilityRunning,productionInventory,productionCapacity,startProduction,recallFacility} from './facilities.js'
import {MATERIALS,MATERIAL_LIMIT,GATHER_INTERVAL,gatheringOptions,gatheringName,gatheringStock,gatheringEntries,availableGatheringUnits,startGathering,stopGathering} from './gathering.js'
import {RAID_ALERT_LIMIT,advanceRaids,raidSite,raidOrigin,raidApproaching,raidMarch,raidReportStatus,raidRepelled,raidDeployment,assignRaidDefenders,makeRaidBattle,autoDefendRaid,finishRaid} from './raids.js'
import { initMusic,setMusicEnabled,setMusicPaused,updateMusic,unlockMusic,pumpMusic } from './music.js'
const inside=(p,b)=>p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h
const number=value=>value.toLocaleString()
const gatheringAction=id=>id===FISH.id?'捕鱼':`采集${gatheringName(id)}`
const recipeLabel=product=>Object.entries(product.recipe).map(([id,cost])=>`${cost} ${gatheringName(id)}`).join(' + ')
const rosterRowX=depth=>312+Math.min(depth,3)*28
const DISPATCH_VIEW={x:312,y:353,w:813,h:222}
const DISPATCH_ROW_HEIGHT=53,DISPATCH_CARD_HEIGHT=43
const FORMATION_LIST_VIEW={x:312,y:353,w:813,h:244}
const ORPHAN_ROSTER='orphan-branches'
const formationRosterParent=(s,unit)=>formationParent(s,unit.id)||s.formations.find(parent=>parent.id===unit.splitParent&&parent.id!==unit.id)
const orphanBranches=s=>formationRoots(s).filter(unit=>unit.splitParent!==undefined&&!formationRosterParent(s,unit))
function formationRosterRows(s,units){
  const levelOf=unit=>FORMATION_TYPES.findIndex(kind=>kind.id===unit.type)
  const rootLevels=new Map(units.map(unit=>[unit.id,levelOf(unit)]))
  return lineageRows(s.formations).flatMap(row=>{
    const {unit,depth}=row,rootLevel=rootLevels.get(unit.id)??rootLevels.get(unit.splitParent)
    if(rootLevel===undefined)return []
    rootLevels.set(unit.id,rootLevel)
    // 缩进按编制级别显示，折叠仍沿实际分队关系处理。
    const step=Math.min(28,84/Math.max(1,rootLevel))
    return [{...row,indent:Math.min(84,Math.max(depth,rootLevel-levelOf(unit))*step)}]
  })
}
function deploymentTiers(s){
  const units=new Map(s.formations.map(unit=>[unit.id,unit]))
  const mergedParents=new Map(s.formations.flatMap(unit=>(unit.children||[]).map(id=>[id,unit])))
  const tiers=new Map()
  return unit=>{
    const path=new Set()
    let current=unit,tier
    while(!path.has(current.id)){
      if(tiers.has(current.id)){tier=tiers.get(current.id);break}
      path.add(current.id)
      const parent=mergedParents.get(current.id)||units.get(current.splitParent)
      if(!parent){
        const original=current.splitPrefix?.split('-')[0].replace(/^\d+/,'')
        tier=FORMATION_TYPES.find(kind=>kind.name===original)?.id||current.type
        break
      }
      current=parent
    }
    tier||=unit.type
    for(const id of path)tiers.set(id,tier)
    return tier
  }
}
const filterDispatchRows=(rows,tier)=>!tier||tier==='all'?rows:rows.filter(row=>row.tier===tier)
function visibleRosterRows(rows,collapsed){
  let hiddenBelow=null
  const visible=[]
  rows.forEach((row,i)=>{
    if(hiddenBelow!==null&&row.depth>hiddenBelow)return
    const hasChildren=(rows[i+1]?.depth??-1)>row.depth
    const folded=hasChildren&&collapsed.has(row.unit.id)
    hiddenBelow=folded?row.depth:null
    visible.push({...row,hasChildren,folded})
  })
  return visible
}
function dispatchRows(s,combat,fromGarrison=false){
  const gatheringLabels=new Map(),tierOf=deploymentTiers(s)
  for(const [siteId,task] of gatheringEntries(s)){
    const location=mapRegion(siteId)?.name,label=`${location?location+' · ':''}${gatheringAction(task.material)}`
    for(const id of task.unitIds)gatheringLabels.set(id,label)
  }
  return lineageRows(formationRoots(s)).map(({unit,depth})=>{
    const activity=formationActivity(s,unit.id),station=villageOfFormation(s,unit.id)
    const stationed=['garrison','region'].includes(activity)
    const canSplit=stationed&&garrisonSplitTypes(s,unit).length>0
    const ready=!activity||fromGarrison&&stationed
    const activityStatus=activity==='gathering'?gatheringLabels.get(unit.id)||activityLabel(activity):activityLabel(activity)
    const ranged=combat&&WEAPONS.reduce((sum,weapon)=>sum+(s[weapon.ammo]>0?unit.weapons[weapon.id]:0),0)
    const status=activity?`${station?villageName(station)+' · ':''}${activityStatus}`:!combat?'待命 · 可调入':!ranged?'待命 · 仅近战':ranged<unit.troops?`待命 · ${unit.troops-ranged} 人近战`:'待命 · 可出战'
    return {unit,depth,canSplit,ready,status,tier:tierOf(unit)}
  })
}
function lineagePages(rows,pageSize=4){
  const pages=[]
  let page=[]
  for(let start=0;start<rows.length;){
    let end=start+1
    while(end<rows.length&&rows[end].depth>0)end++
    if(page.length&&page.length+Math.min(end-start,pageSize)>pageSize){pages.push(page);page=[]}
    for(let index=start;index<end;index++){
      page.push(rows[index])
      if(page.length===pageSize){pages.push(page);page=[]}
    }
    start=end
  }
  if(page.length||!pages.length)pages.push(page)
  return pages
}
function dispatchSelection(rows,ids){
  const ready=new Map(rows.filter(row=>row.ready).map(({unit})=>[unit.id,unit.troops])),selected=ids.filter(id=>ready.has(id))
  return {ids:selected,total:selected.reduce((sum,id)=>sum+ready.get(id),0)}
}
const mapGarrisonLines=(units,s=null)=>{
  const lines=[]
  for(const {unit} of lineageRows(units)){
    // 部分人员外出（代耕、生产等）时，村里只显示留守人数，并注明外派人数。
    const away=s?unit.troops-availableWorkforce(s,unit.id):0
    const name=away>0?`${unitName(unit)} ${unit.troops-away}人(外${away})`:`${unitName(unit)} ${unit.troops}人`,last=lines.length-1
    if(last>=0&&lines[last].length+name.length+1<=14)lines[last]+='、'+name
    else if(lines.length<2)lines.push(name)
    else{lines[1]=lines[1].split('、')[0]+'等'+units.length+'支';break}
  }
  return lines
}
const mapBaseLines=base=>{
  const lines=mapGarrisonLines(base.units)
  if(base.unassigned>0){
    const label=`未编 ${base.unassigned}人`,last=lines.length-1
    if(last>=0&&lines[last].length+label.length+1<=14)lines[last]+='、'+label
    else if(lines.length<2)lines.push(label)
    else if(base.units.length)lines[1]=lines[1].split('、')[0]+'等'+base.units.length+'支+未编'
  }
  return lines
}
export class Game {
  constructor(options={}){
    this.canvas=wx.createCanvas();this.ctx=this.canvas.getContext('2d',{alpha:false})
    let stored=null
    try{stored=wx.getStorageSync(SAVE_KEY);this.save=normalizeSave(stored)}catch{this.save=normalizeSave(null)}
    const adjusted=!!stored&&applyWarehouseFoodAdjustment(this.save)
    const supplied=!!stored&&options.applyRequestedRiceSupply===true&&applyRequestedRiceSupply(this.save)
    const removedMedical=!!stored&&Object.hasOwn(stored,'wounded')
    const migrated=!!stored&&migrateVillageMobilization(this.save)
    const renumbered=!!stored&&stored.formationNumberVersion!==this.save.formationNumberVersion
    const mergedBullets=!!stored&&!Number.isFinite(stored.bullets)
    const removedMerit=!!stored&&Object.hasOwn(stored,'xp')
    const globalized=enableAllVillageMobilization(this.save)
    this.choosingBase=this.save.baseVillageId===null
    this.scene='world-map';this.mapSelected=this.choosingBase?null:'base'
    this.mapCamera=this.choosingBase?fitCamera({}):createCamera(mapBase(this.save))
    this.modal=null;this.buttons=[];this.dirty=true;this.toast=null;this.pressed=false;this.last=0;this.acc=0;this.training=null
    if(adjusted||supplied||removedMedical||migrated||renumbered||mergedBullets||removedMerit||stored&&(globalized||stored.baseVillageId!==this.save.baseVillageId))this.persist()
    this.resize();wx.onWindowResize?.(()=>this.resize())
    initMusic(this.save);updateMusic(this.scene,true)
    wx.onTouchStart(e=>this.touch(e));wx.onTouchMove(e=>this.touchMove(e))
    wx.onTouchEnd(e=>this.touchEnd(e));wx.onTouchCancel?.(()=>this.cancelTouch())
    wx.onMouseWheel?.(e=>this.mouseWheel(e))
    this.logisticsActive=true;this.logisticsSaveElapsed=0
    wx.onHide?.(()=>{this.logisticsActive=false;if(this.scene==='battle'&&!this.battle.done){this.modal='pause';this.dirty=true}this.cancelTouch();this.persist();updateMusic(this.scene,false)})
    wx.onShow?.(()=>{this.logisticsActive=true;this.last=0;updateMusic(this.scene,true)})
    this.tick=this.tick.bind(this);requestAnimationFrame(this.tick)
  }
  persist(){if(this.choosingBase)return;try{wx.setStorageSync(SAVE_KEY,this.save)}catch{this.notify('存档空间不可用，本次进度暂存于内存')}}
  notify(message){this.toast={message,until:Date.now()+2500};this.dirty=true}
  resize(){
    const i=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();this.vw=i.windowWidth;this.vh=i.windowHeight
    this.dpr=Math.min(i.pixelRatio||1,1.5);this.canvas.width=Math.round(this.vw*this.dpr);this.canvas.height=Math.round(this.vh*this.dpr)
    const a=i.safeArea||{left:0,top:0,right:this.vw,bottom:this.vh}
    this.scale=Math.min((a.right-a.left)/1440,(a.bottom-a.top)/810);this.ox=a.left+(a.right-a.left-1440*this.scale)/2;this.oy=a.top+(a.bottom-a.top-810*this.scale)/2;this.cancelTouch();this.dirty=true
  }
  point(e){const t=e?.touches?.[0]||e?.changedTouches?.[0];return t?this.inputPoint(t):null}
  inputPoint(t){return {x:(t.clientX-this.ox)/this.scale,y:(t.clientY-this.oy)/this.scale}}
  command(e){
    const p=this.point(e)
    if(p&&p.y>150&&p.y<645){
      if(!this.battle.command(p.x,p.y)&&this.battle.units&&!this.battle.selectedUnit)this.notify('先点击一支部队，再点击地面下达移动命令')
    }
  }
  cancelTouch(){this.pressed=false;this.mapGesture=null;this.rosterGesture=null}
  touchMove(e){
    if(this.paused)return
    const gesture=this.rosterGesture
    if(gesture){
      const p=this.point(e)
      if(!p||e.touches.length!==1||gesture.cancelled)return
      if(Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>8/(this.scale||1))gesture.moved=true
      if(gesture.moved)this.scrollRoster(gesture.offset+(p.y-gesture.start.y)*gesture.direction)
      return
    }
    if(this.scene==='world-map'&&!this.modal){this.moveMapGesture(e);return}
    if(this.pressed&&this.scene==='battle'&&!this.modal&&!this.battle.units)this.command(e)
  }
  touchEnd(e){
    this.pressed=false
    if(this.paused)return
    if(this.rosterGesture){
      const gesture=this.rosterGesture,p=this.point(e)
      this.rosterGesture=null
      if(!gesture.cancelled&&!gesture.moved&&!e?.touches?.length&&p&&inside(p,gesture.view)&&this.modal===gesture.source&&Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)<=8/(this.scale||1)){
        const button=[...this.buttons].reverse().find(button=>inside(p,button))
        if(button){button.fn();this.dirty=true}
      }
      return
    }
    if(this.scene!=='world-map'||this.modal||!this.mapGesture)return
    const gesture=this.mapGesture
    if(e?.touches?.length){this.beginMapGesture(e,true);return}
    this.mapGesture=null
    const p=this.point(e)||gesture.last
    if(gesture.type==='pan'&&!gesture.moved&&Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)<=8/(this.scale||1)){
      const overAlerts=this.raidPanelBounds&&inside(p,this.raidPanelBounds)
      const b=[...this.buttons].reverse().find(b=>{
        if(b.id.startsWith('raid-alert-'))return inside(p,b)
        return !overAlerts&&/^(map-site-|map-field-|map-region-|map-raid-)/.test(b.id)&&(inside(p,b)||b.flagHit&&inside(p,b.flagHit))
      })
      if(b)b.fn()
    }
    this.dirty=true
  }
  beginMapGesture(e,moved=false){
    const points=e.touches.map(t=>this.inputPoint(t)),a=points[0]
    if(!a)return
    if(points.length>1){
      const b=points[1],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2}
      this.mapGesture={type:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:this.mapCamera.zoom,anchor:screenToMap(this.mapCamera,center)}
    }else this.mapGesture={type:'pan',start:a,last:a,moved}
  }
  moveMapGesture(e){
    const g=this.mapGesture;if(!g)return
    const points=e.touches.map(t=>this.inputPoint(t)),a=points[0];if(!a)return
    if(points.length>1){
      if(g.type!=='pinch'){this.beginMapGesture(e,true);return}
      const b=points[1],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2}
      anchorCamera(this.mapCamera,g.zoom*Math.hypot(a.x-b.x,a.y-b.y)/g.distance,g.anchor,center)
    }else{
      if(g.type!=='pan'){this.beginMapGesture(e,true);return}
      if(!g.moved&&Math.hypot(a.x-g.start.x,a.y-g.start.y)>8/(this.scale||1))g.moved=true
      if(g.moved){panCamera(this.mapCamera,a.x-g.last.x,a.y-g.last.y);g.last=a}
    }
    this.dirty=true
  }
  scrollRoster(offset){
    const state=this.rosterScroll
    if(!state||this.modal!==state.source)return
    this[state.key]=Math.min(state.max,Math.max(0,offset));this.dirty=true
  }
  mouseWheel(e){
    if(this.paused)return true
    const p=this.inputPoint(e),list=this.rosterScroll
    if(list&&this.modal===list.source&&inside(p,list.view)){
      const delta=e.deltaY*(e.deltaMode===1?16/(this.scale||1):e.deltaMode===2?list.view.h:1/(this.scale||1))
      if(!Number.isFinite(delta))return false
      this.rosterGesture=null;this.scrollRoster((this[list.key]||0)+delta);return true
    }
    if(this.scene!=='world-map'||this.modal||!inside(p,MAP_VIEW))return false
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?586:1)
    if(!Number.isFinite(delta))return false
    this.mapGesture=null;zoomCamera(this.mapCamera,Math.exp(-Math.max(-500,Math.min(500,delta))*.0015),p);this.dirty=true;return true
  }
  touch(e){
    unlockMusic()
    const p=this.point(e);if(!p)return
    if(this.paused){
      if(e.touches.length>1)return
      const b=[...this.buttons].reverse().find(b=>inside(p,b));if(b){b.fn();this.dirty=true}
      return
    }
    if(this.rosterGesture){if(e.touches.length>1)this.rosterGesture.cancelled=true;return}
    const list=this.rosterScroll
    if(list&&this.modal===list.source&&inside(p,list.view)){
      if(e.touches.length!==1)return
      const {view,max,thumbHeight,source,key}=list
      const direction=p.x>=view.x+view.w-7&&max>0?max/(view.h-thumbHeight):-1
      this.rosterGesture={start:p,offset:this[key]||0,source,view,direction,moved:false}
      return
    }
    if(this.scene==='world-map'&&!this.modal&&(this.mapGesture||inside(p,MAP_VIEW))){this.beginMapGesture(e,!!this.mapGesture);return}
    if(e.touches.length>1)return
    const b=[...this.buttons].reverse().find(b=>inside(p,b));if(b){b.fn();this.dirty=true;return}
    if(this.scene==='battle'&&!this.modal){this.pressed=!this.battle.units;this.command(e);this.dirty=true}
  }
  button(id,x,y,w,h,label,fn,style='dark',symbol){
    const c=this.ctx;const fill=style==='accent'?'#546c3c':style==='gold'?'#86672e':style==='dark'?'#31432d':C.raised
    const color=C.ink
    box(c,x,y,w,h,fill,2,style==='accent'?C.olive:style==='gold'?C.gold:C.line)
    line(c,x+7,y+5,x+w-7,y+5,'rgba(212,230,174,.12)')
    if(symbol)icon(c,symbol,x+27,y+h/2,22,color)
    text(c,label,x+w/2+(symbol?9:0),y+h/2,21,color,600,'center')
    this.buttons.push({id,x,y,w,h,fn})
  }
  togglePause(){
    this.paused=!this.paused
    if(this.paused){this.cancelTouch();if(this.modal==='settings')this.modal=null}
    setMusicPaused(this.paused)
    this.dirty=true
    this.notify(this.paused?'游戏已暂停 · 所有操作已锁定':'游戏已继续')
  }
  tick(now){
    pumpMusic()
    const activeElapsed=this.last?Math.min(60,Math.max(0,(now-this.last)/1000)):0
    const elapsed=Math.min(.05,activeElapsed);this.last=now
    if(this.logisticsActive&&!this.choosingBase&&!this.paused){this.updateLogistics(activeElapsed);this.updateMapMarches(activeElapsed)}
    if(this.toast&&Date.now()>this.toast.until){this.toast=null;this.dirty=true}
    if(this.scene==='battle'&&!this.modal&&!this.paused)this.updateBattle(elapsed)
    this.acc+=elapsed
    const frameInterval=this.scene==='battle'?1/60:this.scene==='world-map'&&(this.save.marchingOrders?.length||Object.keys(this.save.fieldFarmTasks).length||!this.modal&&this.save.raidAlerts.length)?1/30:0
    if(this.dirty&&this.acc>=frameInterval-.002){this.render();this.acc=0;this.dirty=false}
    requestAnimationFrame(this.tick)
  }
  updateLogistics(seconds,random=Math.random){
    const previous=hungerStatus(this.save)
    const result=advanceEconomy(this.save,seconds,random)
    const manualRaidId=this.scene==='battle'&&!this.battle?.done?this.battle?.raidId:null
    const raids=advanceRaids(this.save,seconds,random,manualRaidId)
    const raidReports=raids.due.map(id=>autoDefendRaid(this.save,id)).filter(Boolean)
    if(raids.changed||raidReports.length||this.scene==='world-map'&&!this.modal&&this.save.raidAlerts.length)this.dirty=true
    this.branchSyncElapsed=(this.branchSyncElapsed||0)+seconds
    let branchMoved=false
    if(this.branchSyncElapsed>=.25){this.branchSyncElapsed=0;branchMoved=syncIdleBranches(this.save)}
    if(branchMoved)this.dirty=true
    const returnedFarms=result.returnedFarms
    if(returnedFarms.length||this.scene==='world-map'&&!this.modal&&Object.keys(this.save.fieldFarmTasks).length)this.dirty=true
    const facilityEvent=result.produced.length||result.gathered.length||result.training
    if(result.training){this.trainingResult=result.training;this.training=null}
    const restocked=syncShop(this.save)
    const hunger=hungerStatus(this.save)
    this.syncBattleReadiness()
    this.logisticsSaveElapsed=(this.logisticsSaveElapsed||0)+seconds
    this.logisticsDrawElapsed=(this.logisticsDrawElapsed||0)+seconds
    const raidCountdown=this.scene==='world-map'&&this.save.raidAlerts.length&&(!this.modal||this.modal==='raid')&&this.logisticsDrawElapsed>=1
    if(raidCountdown||result.recruited||result.meals||result.populationGrown||result.harvests.length||facilityEvent||restocked||((['village','recruitment','farm','gathering','base-armory','training'].includes(this.modal)&&this.logisticsDrawElapsed>=.2||this.modal==='shop'&&this.logisticsDrawElapsed>=1||this.scene==='world-map'&&!this.modal&&Object.keys(this.save.fieldCooldowns||{}).length>0&&this.logisticsDrawElapsed>=1))){this.dirty=true;this.logisticsDrawElapsed=0}
    if(raids.changed||raidReports.length||branchMoved||returnedFarms.length||result.recruited||result.meals||result.harvests.length||facilityEvent||restocked||this.logisticsSaveElapsed>=5){this.persist();this.logisticsSaveElapsed=0}
    if(raids.alert)this.notify(`${raidSite(raids.alert.siteId).name}遭到敌袭 · ${raidOrigin(raids.alert).name}出兵 ${raids.alert.force} 人`)
    else if(raidReports.length)this.notify(raidReports.map(report=>raidSite(report.siteId).name+' · '+raidReportStatus(report)).join('、'))
    else if(!previous.disabled&&hunger.disabled)this.notify('部队极度饥饿，火力和行动能力下降，请及时供餐')
    else if(previous.disabled&&!hunger.disabled)this.notify('部队已进食，恢复正常战斗效果')
    else if(result.training)this.notify(result.training.name+'训练完成 · 获得 '+result.training.gained+' 点经验'+(result.training.villageId?'，继续在'+villageName(result.training.villageId)+'驻防':'，已自动归队'))
    else if(result.harvests.length>1){
      const totals=result.harvests.reduce((sum,harvest)=>({grain:sum.grain+harvest.amount,recruits:sum.recruits+harvest.recruited}),{grain:0,recruits:0})
      this.notify(`${result.harvests.length} 项耕作完成 · 得粮 ${totals.grain} 份 · 新兵 +${totals.recruits} 人`)
    }
    else if(result.harvests.length){
      const harvest=result.harvests[0]
      if(harvest.type==='help'){
        const grain=CROPS.filter(crop=>harvest.supplies[crop.id]).map(crop=>crop.name+' +'+number(harvest.supplies[crop.id])).join('、')
        const field=mapField(harvest.fieldId)
        this.notify((field?villageName(field.villageId)+' · ':'')+'代耕完成 · 新兵 +'+harvest.recruited+' · '+(grain||'得粮 0 份')+
          (harvest.amount<helpHarvestYield(harvest.workers)?'（仓库空间不足）':'')+(farmTaskAt(this.save,harvest.fieldId)?.phase==='returning'?' · 分队返村中':''))
      }else this.notify('自耕完成 · '+CROPS.find(crop=>crop.id===harvest.crop).name+' +'+harvest.amount+' 份')
    }
    else if(returnedFarms.length)this.notify('代耕分队已返回'+[...new Set(returnedFarms.map(task=>villageName(task.villageId)))].join('、')+'归队')
    else if(result.recruited)this.notify(`乡亲报名 +${result.recruited} 人`)
    else if(result.produced.length)this.notify('生产入库 · '+result.produced.map(item=>PRODUCTS.find(p=>p.id===item.product).name+' +'+item.amount).join(' · '))
    else if(result.gathered.length){
      const label=result.gathered.every(item=>item.material===FISH.id)?'捕鱼入库':'采集入库'
      this.notify(label+' · '+result.gathered.map(item=>gatheringName(item.material)+' +'+item.amount).join(' · '))
    }
    else if(result.meals&&this.save.lastMealShortage>0)this.notify(`本餐还缺 ${this.save.lastMealShortage} 份熟食，请补充食材或到灶房做饭`)
  }
  open(name){
    if(name!=='garrison-transfer')this.garrisonTransfer=null
    if(name==='defense')name='recruitment'
    if(name==='campaign'){this.openWorldMap();return}
    if(name==='recruitment'&&enableAllVillageMobilization(this.save))this.persist()
    this.modal=name
    if(name==='village'){this.villagePage=0}
    if(name==='village-station'){this.stationSelected=[];this.stationScroll=0;this.stationCollapsed=new Set();this.stationTier='all'}
    if(name==='warehouse'||name==='shop'){this.inventoryTab='weapons';this.goodsPage=0;if(name==='shop'&&syncShop(this.save))this.persist()}
    if(name==='farm'){this.farmSelected=[];this.farmPage=0;this.farmFieldId=null;this.farmReturnToMap=false}
    if(name==='base-armory'){this.setFacilityStaffing();this.factoryProduct=PRODUCTS.find(p=>this.save.armoryTasks[p.id])?.id||'rifle'}
    if(name==='formation')this.formationListType=null
    if(name==='training'){this.trainingPage=0;const roots=this.localVillage?lineageRows(villageLocalUnits(this.save,this.localVillage)).map(r=>r.unit):formationRoots(this.save);if(!roots.some(u=>u.id===this.trainingSelectedId&&!formationActivity(this.save,u.id,!!this.localVillage)))this.trainingSelectedId=roots.find(u=>!formationActivity(this.save,u.id,!!this.localVillage))?.id}
    if(name==='recruitment'){this.recruitQuantity=20;this.recruitFoodId=FOODS.find(food=>this.save[food.id]>0)?.id||FOODS[0].id}
    if(name==='kitchen')this.kitchenBatch=10
    this.dirty=true
  }
  start(mode,level=1,unitIds){
    if(this.scene==='battle'&&this.battle&&!this.battle.done){this.notify('请先结束当前战斗，再开始新的行动');return}
    if(mode==='defense'||mode==='recruitment'){this.home();this.open('recruitment');return}
    if(mode==='campaign'){
      if(!Number.isInteger(level)||level<1||level>this.save.stage){this.notify('先完成前一关');return}
      if(unitIds===undefined){this.openCampaignDeployment(level);return}
      const deployment=campaignDeployment(this.save,unitIds)
      if(!deployment.ok){this.notify(deployment.message);return}
      if(!assignFormations(this.save,unitIds,'battle')){this.notify('部队正在执行其他任务，请等待归队');return}
      this.scene='battle';this.modal=null;this.result=null;this.pressed=false;this.battleRosterPage=0
      this.battle=new CampaignBattle(level,deployment.units,null,this.save);this.syncBattleReadiness();updateMusic(this.scene);this.dirty=true;return
    }
    const f=formation(this.save)
    if(!f.armedTroops){this.notify('请先在「我的部队」中添加编制，再部署出战');return}
    const groups=trainedCombatGroups(this.save)
    this.scene='battle';this.modal=null;this.result=null;this.battle=new Battle(mode,level,f.armedTroops,groups[0].weapon,groups);this.syncBattleReadiness();updateMusic(this.scene);this.dirty=true
  }
  openCampaignDeployment(level){
    this.deploymentRegionId=null
    this.openWorldMap();this.modal='campaign-deploy';this.deploymentLevel=level;this.deploymentIds=[];this.deploymentScroll=0;this.deploymentCollapsed=new Set();this.deploymentTier='all';this.pressed=false;this.dirty=true
  }
  toggleDeployment(id){
    const attacking=regionEnemyTroops(this.save,this.deploymentRegionId)>0
    if(formationActivity(this.save,id,attacking)){this.notify('该部队正在执行任务，归队后才能出战');return}
    const index=this.deploymentIds.indexOf(id)
    if(index>=0)this.deploymentIds.splice(index,1)
    else this.deploymentIds.push(id)
    this.dirty=true
  }
  drawCampaignDeployment(){
    const c=this.ctx,s=this.save
    const region=mapRegion(this.deploymentRegionId),enemy=region&&regionEnemyTroops(s,region.id)
    const rows=dispatchRows(s,!region||enemy>0,enemy>0),{ids,total}=dispatchSelection(rows,this.deploymentIds)
    const tier=this.deploymentTier||'all',visible=filterDispatchRows(rows,tier)
    const readyIds=visible.filter(row=>row.ready).map(({unit})=>unit.id),empty=!rows.length
    text(c,region?`${region.name} · ${enemy?'进攻':'派驻'}部队`:`第 ${this.deploymentLevel} 关 · 派出部队`,312,275,23,C.ink,700)
    if(readyIds.length)this.button('deployment-all',864,260,125,37,tier==='all'?'全选可派':'全选本级',()=>{this.deploymentIds=[...new Set([...this.deploymentIds,...readyIds])]},'light')
    this.button('deployment-clear',1001,260,124,37,'清空选择',()=>{this.deploymentIds=[]},'light')
    const combatHint=hungerStatus(s).disabled?'极度饥饿削弱战力 · 缺弹或无枪时近战。':'战斗消耗仓库弹药，缺弹或无枪时近战。'
    const readyHint=enemy?'勾选可整支出击，也可分出部分。缺弹或无枪时近战。':region?'确认后出发，到达后驻防。':combatHint
    this.drawDispatchList('deployment',rows,ids,total,'campaign-deploy',id=>this.toggleDeployment(id),readyHint)
    this.button('deployment-back',312,615,230,42,region?'返回地区':'返回大地图',()=>region?this.openRegion(region.id):this.open('campaign'),'light')
    this.button('deployment-confirm',565,615,560,42,ids.length?`确认${region&&!enemy?'派驻':'出战'} · ${ids.length} 支 / ${number(total)} 人`:empty?'前往我的部队':'请选择派遣部队',()=>{
      const current=dispatchSelection(rows,this.deploymentIds).ids
      if(empty)this.open('formation')
      else if(!current.length)this.notify('请先选择要派出的部队')
      else if(region)this.dispatchRegion(region.id,current)
      else this.start('campaign',this.deploymentLevel,current)
    },ids.length||empty?'accent':'light')
  }
  drawScrollableRoster({source,key,view,rows,rowHeight,cardHeight},drawRow){
    const c=this.ctx,contentHeight=rows.length?(rows.length-1)*rowHeight+cardHeight:0
    const max=Math.max(0,contentHeight-view.h),scroll=Math.min(max,this[key]||0)
    const thumbHeight=max?Math.max(26,view.h*view.h/contentHeight):view.h
    this[key]=scroll;this.rosterScroll={source,key,view,max,thumbHeight}
    const first=Math.floor(scroll/rowHeight),last=Math.min(rows.length,Math.ceil((scroll+view.h)/rowHeight))
    const startButtons=this.buttons.length,right=view.x+view.w-10
    c.save();c.beginPath();c.rect(view.x,view.y,view.w,view.h);c.clip()
    for(let index=first;index<last;index++)drawRow(rows[index],view.y+index*rowHeight-scroll,right)
    c.restore()
    for(const button of this.buttons.splice(startButtons)){
      const top=Math.max(view.y,button.y),bottom=Math.min(view.y+view.h,button.y+button.h)
      if(bottom>top)this.buttons.push({...button,y:top,h:bottom-top})
    }
    if(max){
      const barX=view.x+view.w-6
      box(c,barX,view.y,5,view.h,C.line,2)
      box(c,barX,view.y+(view.h-thumbHeight)*scroll/max,5,thumbHeight,C.olive,2)
    }
    return max>0
  }
  drawDispatchList(prefix,rows,ids,total,source,onSelect,readyHint=null){
    const c=this.ctx,key=prefix+'Scroll',tierKey=prefix+'Tier',tier=this[tierKey]||'all'
    const collapsed=this[prefix+'Collapsed']||=new Set(),visible=visibleRosterRows(filterDispatchRows(rows,tier),collapsed)
    for(const [i,kind] of [{id:'all',name:'全部'},...FORMATION_TYPES].entries()){
      this.button(prefix+'-tier-'+kind.id,312+i*91,299,83,29,kind.name,()=>{
        if(tier===kind.id)return
        this[tierKey]=kind.id;this[key]=0
      },tier===kind.id?'accent':'light')
    }
    text(c,'部队编制',327,341,14,C.muted)
    text(c,'人数',580,341,14,C.muted)
    text(c,'状态',728,341,14,C.muted)
    text(c,`已选 ${ids.length} 支 · ${number(total)} 人`,1125,341,16,C.olive,600,'right')
    const scrollable=this.drawScrollableRoster({source,key,view:DISPATCH_VIEW,rows:visible,rowHeight:DISPATCH_ROW_HEIGHT,cardHeight:DISPATCH_CARD_HEIGHT},({unit,status,depth,ready,canSplit,hasChildren,folded},y,right)=>{
      const x=rosterRowX(depth),chosen=ids.includes(unit.id)
      box(c,x,y,right-x,DISPATCH_CARD_HEIGHT,chosen?'#31432d':C.raised,2,chosen?C.olive:C.line)
      if(ready){
        box(c,x+14,y+12,18,18,chosen?C.olive:null,2,C.olive)
        if(chosen)text(c,'✓',x+23,y+21,16,C.paper,700,'center')
        this.buttons.push({id:prefix+'-unit-'+unit.id,x,y,w:right-x,h:DISPATCH_CARD_HEIGHT,fn:()=>onSelect(unit.id)})
      }
      const labelX=x+43
      if(hasChildren){
        text(c,folded?'▸':'▾',labelX,y+21,18,C.olive,700)
        const toggleX=ready?x+38:x
        this.buttons.push({id:prefix+'-collapse-'+unit.id,x:toggleX,y,w:565-toggleX,h:DISPATCH_CARD_HEIGHT,fn:()=>{
          if(folded)collapsed.delete(unit.id)
          else collapsed.add(unit.id)
        }})
      }
      text(c,unitName(unit),labelX+(hasChildren?20:0),y+21,depth?17:20,C.ink,700)
      text(c,`${number(unit.troops)} 人`,580,y+21,17,C.olive,600)
      text(c,status,728,y+21,14,ready?C.muted:C.gold,500)
      if(canSplit)this.button(prefix+'-split-'+unit.id,1004,y+5,110,32,'分出部分',()=>this.openGarrisonSplit(unit.id,source),'accent')
    })
    if(!visible.length){
      text(c,tier==='all'?'暂无部队':'暂无此级别的部队',720,432,23,C.ink,600,'center')
      text(c,tier==='all'?'请先到「我的部队」组建编制。':'可切到「全部」或选择其他级别。',720,470,16,C.muted,400,'center')
    }
    text(c,readyHint||'合编部队一并派出其下属。',312,592,14,C.muted)
    const listHint=[scrollable?'上下滑动':'',visible.some(row=>row.hasChildren)?'点击上级名称折叠':''].filter(Boolean).join(' · ')
    if(listHint)text(c,listHint,1125,592,13,C.muted,500,'right')
  }
  syncBattleReadiness(){
    if(!this.battle)return
    const status=hungerStatus(this.save)
    this.battle.combatReady=true
    for(const key of ['damageMultiplier','intervalMultiplier','speedMultiplier'])this.battle[key]=status[key]
  }
  updateBattle(dt){
    this.syncBattleReadiness()
    const ammoBefore=this.battle.ammoSpent
    this.battle.update(dt)
    const lost=applyBattleLosses(this.save,this.battle)
    if(lost||this.battle.ammoSpent!==ammoBefore)this.persist()
    if(lost)this.notify(`部队退出战斗 · 减员 ${lost} 人`)
    this.dirty=true;if(this.battle.done)this.finish()
  }
  finish(){
    if(this.battle.settled)return
    this.result=settle(this.save,this.battle);releaseFormations(this.save,'battle')
    if(this.battle.regionId)this.result.region=resolveRegionBattle(this.save,this.battle)
    if(this.battle.raidId)this.result.raid=finishRaid(this.save,this.battle)
    this.persist();this.modal='result';this.pressed=false;this.dirty=true
  }
  home(){releaseFormations(this.save,'battle');this.openWorldMap()}
  startTraining(){
    if(this.scene==='battle'&&this.battle&&!this.battle.done){this.notify('请先结束当前战斗再开始训练');return}
    const result=startTrainingTask(this.save,this.trainingSelectedId,this.localVillage||null)
    if(!result.ok){this.notify(result.message);return}
    this.training=result.session;if(!this.localVillage)this.scene='world-map';this.modal='training';this.trainingResult=null;this.pressed=false
    this.persist();updateMusic(this.scene);this.notify(result.session.name+'开始训练 · 需 '+result.session.duration+' 秒，可离开训练场做其他事情');this.dirty=true
  }
  finishTraining(){
    const result=completeTraining(this.save,trainingTaskAt(this.save,this.localVillage))
    if(!result)return
    this.training=null;this.trainingResult=result;this.persist();this.notify(result.name+'训练完成，已自动归队');this.dirty=true
  }
  recallTraining(){
    if(!cancelTrainingTask(this.save,this.localVillage||null))return
    this.training=null;this.persist();this.notify(this.localVillage?'已停止训练，部队留在本村，本轮不发经验':'参训部队已召回，本轮不发经验');this.dirty=true
  }
  rename(){wx.showModal({title:'修改名称',editable:true,content:this.save.name,placeholderText:'输入名称，最多 12 个字',maxLength:12,success:r=>{
    if(!r.confirm)return
    const name=r.content?.trim()
    if(!name){this.notify('名称不能为空');return}
    if(Array.from(name).length>12){this.notify('名称最多 12 个字');return}
    this.save.name=name;this.persist();this.notify('指挥官名称已更新');this.dirty=true
  }})}
  render(){
    const c=this.ctx;c.setTransform(1,0,0,1,0,0);box(c,0,0,this.canvas.width,this.canvas.height,'#18231e');c.setTransform(this.dpr*this.scale,0,0,this.dpr*this.scale,this.ox*this.dpr,this.oy*this.dpr)
    c.save();c.beginPath();c.rect(0,0,1440,810);c.clip()
    this.buttons=[]
    if(this.scene==='lobby')this.drawLobby();else if(this.scene==='world-map')this.drawWorldMap();else this.drawBattle()
    if(this.modal){this.buttons=[];box(c,0,0,1440,810,'rgba(17,30,24,.72)');this.drawModal()}
    if(this.paused){
      this.buttons=[]
      box(c,0,0,1440,810,'rgba(12,20,16,.86)')
      box(c,460,260,520,290,C.panel,2,C.gold);brackets(c,460,260,520,290,C.gold)
      text(c,'游戏已暂停',720,332,32,C.ink,800,'center')
      text(c,'时间与所有操作已锁定，点击下方按钮恢复游戏',720,388,16,C.muted,500,'center')
      this.button('game-resume',550,446,340,58,'继续游戏',()=>this.togglePause(),'accent')
    }
    if(this.toast){box(c,430,30,580,48,C.panel,2,C.gold);text(c,this.toast.message,720,54,17,'#fff6d8',500,'center')}
    c.restore()
  }
  openWorldMap(){
    this.scene='world-map';this.modal=null;this.localVillage=null;this.garrisonTransfer=null;this.relocatingBase=false;this.relocatingArmory=false;this.cancelTouch()
    if(!this.choosingBase)this.mapSelected=mapLocation(this.mapSelected,this.save).id
    this.mapCamera||=this.choosingBase?fitCamera({}):createCamera(mapBase(this.save))
    updateMusic(this.scene);this.dirty=true
  }
  confirmStartingBase(){
    if(!this.choosingBase||!chooseStartingBase(this.save,this.mapSelected))return
    this.choosingBase=false;this.mapSelected='base';this.mapCamera=createCamera(mapBase(this.save))
    this.persist();this.notify('根据地已设在'+mapBase(this.save).name)
  }
  openBaseRelocation(villageId=null){
    this.openWorldMap()
    this.relocatingBase=true;this.mapSelected=villageId
  }
  confirmBaseRelocation(){
    if(!this.relocatingBase)return
    const result=relocateBase(this.save,this.mapSelected)
    if(!result.ok){this.notify(result.message);return}
    const home=mapBase(this.save)
    this.openWorldMap();this.mapSelected='base';focusCamera(this.mapCamera,home)
    this.persist();this.notify('根据地中心已迁至'+home.name)
  }
  openVillage(id){
    if(!isVillage(id))return
    if(!villageControlled(this.save,id)){this.openVillageStation(id,true);return}
    this.mapSelected=id;this.villageId=id;this.localVillage=id;this.villageStationFromMap=false;this.open('village')
  }
  openVillageStation(id,fromMap=false){
    if(!isVillage(id))return
    if(villageEnemyTroops(this.save,id)>0){this.openRegion(villageRegionId(id));return}
    this.mapSelected=id;this.villageId=id;this.villageStationFromMap=fromMap;this.open('village-station')
  }
  returnToVillage(){if(this.localVillage)this.openVillage(this.localVillage);else this.openWorldMap()}
  openMapField(id){
    if(this.garrisonTransfer){this.notify('请选择目的地的村庄或据点图标');return}
    const field=mapField(id);if(!field)return
    if(!farmTaskAt(this.save,id)&&!villageControlled(this.save,field.villageId)){this.notify('需要先占领并驻军「'+villageName(field.villageId)+'」，才能耕种它的田地');return}
    this.mapSelected=field.villageId;this.open('farm');this.farmReturnToMap=true
    this.farmFieldId=id
  }
  openRegion(id){
    const site=mapRegion(id);if(!site)return
    // 已占领的外围村庄直接进入完整的村庄管理。
    if(site.villageId&&regionOwner(this.save,id)==='player'){this.openWorldMap();this.openVillage(site.villageId);return}
    this.openWorldMap();this.mapSelected=id;this.regionId=id;this.regionPage=0;this.modal='region';this.dirty=true
  }
  openRegionDeployment(id){
    if(!mapRegion(id))return
    this.regionId=id;this.mapSelected=id;this.openCampaignDeployment(1);this.deploymentRegionId=id
  }
  openRegionAction(id){
    if(!regionEnemyTroops(this.save,id)&&regionLocalUnits(this.save,id).length)this.openRegion(id)
    else this.openRegionDeployment(id)
  }
  dispatchRegion(id,ids){
    if(this.scene==='battle'&&this.battle&&!this.battle.done){this.notify('请先结束当前战斗，再派遣新的部队');return}
    const result=startMarch(this.save,'region',id,ids)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.openWorldMap();this.notify(result.message)
  }
  openGarrisonTransfer(unitId,originId){
    this.openWorldMap()
    this.garrisonTransfer={unitId,originId};this.mapSelected=originId
  }
  selectGarrisonTransferTarget(id){
    id=mapVillage(id)?.regionId??id
    if(id===this.garrisonTransfer.originId||!mapRegion(id)){this.notify('请选择另一处村庄或据点');return}
    this.garrisonTransfer.targetId=id;this.mapSelected=id;this.open('garrison-transfer')
  }
  cancelGarrisonTransfer(){
    const origin=mapRegion(this.garrisonTransfer.originId)
    this.openWorldMap()
    if(origin.villageId)this.openVillage(origin.villageId)
    else this.openRegion(origin.id)
  }
  drawGarrisonTransfer(){
    const c=this.ctx,s=this.save,{originId,targetId,unitId}=this.garrisonTransfer
    const origin=mapRegion(originId),target=mapRegion(targetId),unit=regionUnits(s,originId).find(unit=>unit.id===unitId)
    const enemies=regionEnemyTroops(s,targetId)
    text(c,`${origin.name} → ${target.name}`,312,318,30,C.ink,700)
    text(c,unit?`${unitName(unit)} · ${number(unit.troops)} 人`:'部队已离开原驻地',312,370,20,unit?C.olive:C.gold,600)
    text(c,enemies?`敌军驻防 ${number(enemies)} 人 · 抵达即进入战斗，胜利后驻防。`:'部队将从原驻地沿道路出发，抵达后开始驻防。',312,424,17,enemies?C.gold:C.muted)
    this.button('transfer-reselect',312,615,220,42,'重新选地点',()=>{this.modal=null},'light')
    this.button('transfer-confirm',827,615,298,42,'确认转移',()=>{
      const result=startGarrisonTransfer(s,unitId,originId,targetId)
      if(!result.ok){this.notify(result.message);return}
      this.persist();this.openWorldMap();this.notify(result.message)
    },'accent')
  }
  beginRegionBattle(id,ids){
    const result=regionDispatch(this.save,id,ids)
    if(!result.ok){this.notify(result.message);return}
    if(!regionEnemyTroops(this.save,id)){
      const stationed=occupyRegion(this.save,id,ids)
      if(!stationed.ok){this.notify(stationed.message);return}
      this.persist();this.openRegion(id);this.notify(stationed.message);return
    }
    if(!assignFormations(this.save,ids,'battle')){this.notify('所选部队已被占用');return}
    this.battle=new CampaignBattle(1,result.units,regionRecord(this.save,id).enemies,this.save)
    this.battle.regionId=id;this.battle.regionName=mapRegion(id).name;this.battle.regionDeployedIds=[...ids]
    this.scene='battle';this.modal=null;this.result=null;this.battleRosterPage=0;this.pressed=false;this.syncBattleReadiness();updateMusic(this.scene);this.dirty=true
  }
  openRaid(id){
    const entry=this.save.raidAlerts.find(alert=>alert.id===id)||this.save.raidReports.find(report=>report.id===id)
    const site=raidSite(entry?.siteId)
    if(!site)return
    this.openRaidReport=null
    this.raidAlertId=id;this.mapSelected=site.regionId||site.id;focusCamera(this.mapCamera,site);this.open('raid')
  }
  showRaidRoute(alert){
    const march=raidMarch(alert)
    if(!march)return
    const xs=march.route.map(point=>point.x),ys=march.route.map(point=>point.y)
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys)
    const zoom=Math.min(.75,(MAP_VIEW.w-560)/Math.max(1,right-left),(MAP_VIEW.h-164)/Math.max(1,bottom-top))
    anchorCamera(this.mapCamera,zoom,{x:(left+right)/2,y:(top+bottom)/2},{x:840,y:MAP_VIEW.y+MAP_VIEW.h/2})
    this.modal=null;this.dirty=true
  }
  beginRaid(id){
    if(this.scene==='battle'&&this.battle&&!this.battle.done){this.notify('请先结束当前战斗');return}
    const deployment=raidDeployment(this.save,id)
    if(!deployment.ok){this.notify(deployment.message);return}
    if(!assignRaidDefenders(this.save,deployment)){this.notify('驻军状态已变化，请重新查看警报');return}
    this.battle=makeRaidBattle(deployment,this.save)
    this.scene='battle';this.modal=null;this.result=null;this.battleRosterPage=0;this.pressed=false;this.syncBattleReadiness()
    this.persist()
    updateMusic(this.scene)
    this.dirty=true
  }
  drawRaidAlerts(){
    const c=this.ctx,alerts=this.save.raidAlerts,expanded=this.raidPanelOpen!==false
    const entries=[...alerts,...this.save.raidReports].slice(0,RAID_ALERT_LIMIT)
    const left=24,top=266,width=238,height=entries.length?50+entries.length*62:79
    this.raidPanelBounds=expanded?{x:left,y:top,w:width,h:height}:null
    const toggleText=expanded?'‹':alerts.length?`› ${alerts.length}`:'›'
    this.button('raid-alert-toggle',expanded?left+width+6:left,top,52,41,toggleText,()=>{this.raidPanelOpen=!expanded},alerts.length?'gold':'dark')
    if(!expanded)return
    box(c,left,top,width,height,'#19251ef0',2,alerts.length?C.red:C.line)
    text(c,'驻地警报',39,top+21,18,C.ink,700)
    text(c,String(alerts.length),243,top+21,16,alerts.length?C.gold:C.muted,600,'right')
    line(c,33,top+41,253,top+41,C.line)
    if(!entries.length)text(c,'当前没有敌袭',39,top+61,14,C.muted)
    entries.forEach((entry,i)=>{
      const y=top+46+i*62,site=raidSite(entry.siteId),outcome=raidReportStatus(entry),origin=raidOrigin(entry)
      box(c,33,y,220,54,C.raised,2,C.line)
      text(c,site.name,44,y+17,17,C.ink,700)
      text(c,outcome||(origin?`${origin.name} · 来敌 ${entry.force} 人`:`来敌 ${entry.force} 人`),44,y+39,13,outcome?C.muted:C.red,600)
      text(c,outcome?'战报 ›':raidApproaching(entry)?'行军中 ›':'交战中 ›',243,y+17,14,C.olive,600,'right')
      this.buttons.push({id:'raid-alert-'+entry.id,x:33,y,w:220,h:54,fn:()=>this.openRaid(entry.id)})
    })
  }
  drawRaidDetail(){
    const c=this.ctx,id=this.raidAlertId,info=raidDeployment(this.save,id)
    const report=this.save.raidReports.find(report=>report.id===id)||this.openRaidReport
    if(report){
      this.openRaidReport=report
      text(c,`${raidSite(report.siteId).name} · ${raidReportStatus(report)}`,312,303,25,C.ink,700)
      const deployed=report.deployedTroops===undefined?'':` · 我方出战 ${number(report.deployedTroops)} 人${report.unarmedTroops?`（${number(report.unarmedTroops)} 人无武器）`:''}`
      text(c,`自动应敌战报 · 来敌 ${report.force} 人${deployed}`,312,352,19,C.gold,600)
      const origin=raidOrigin(report)
      const garrison=report.occupied?` · 敌军留驻 ${report.enemyTroops} 人`:''
      if(origin||garrison)text(c,(origin?`敌军出发地 · ${origin.name}`:'占领情况')+garrison,312,381,16,C.blue,600)
      if(report.outcome==='undefended')text(c,'本次没有可出战的驻地人员。',312,420,18,C.muted)
      else{
        text(c,`击败敌军 ${report.kills} 人 · 我方伤亡 ${report.lostTroops} 人`,312,410,18,C.ink)
        text(c,`金币 +${report.coins}`,312,452,18,C.gold)
        const captured=WEAPONS.filter(weapon=>report.capturedWeapons[weapon.id]>0).map(weapon=>`${weapon.name} ×${report.capturedWeapons[weapon.id]}`).join(' · ')
        if(captured)text(c,'缴获入库 · '+captured,312,494,17,C.olive)
      }
      this.button('raid-back',312,615,180,42,'返回大地图',()=>{this.modal=null},'light')
      return
    }
    if(!info.site){text(c,'这条驻地警报已解除。',720,410,24,C.muted,600,'center');return}
    box(c,312,269,813,160,C.raised,2,C.line)
    const origin=raidOrigin(info.alert),approaching=raidApproaching(info.alert)
    text(c,`${info.site.name} · ${approaching?'敌军行军中':'交战中'}`,334,293,25,C.ink,700)
    text(c,`${origin?`来自 ${origin.name} · `:''}来敌 ${info.alert.force} 人`,334,325,19,C.blue,600)
    const unarmed=info.unarmedTroops?`（${number(info.unarmedTroops)} 人无武器）`:''
    text(c,`我方可出战 ${info.units.length} 支 / ${number(info.troops)} 人${unarmed}`,334,356,19,C.gold,600)
    text(c,info.site.type==='village'?'村内可用士兵参战，兵工厂人员继续工作。':'本地驻军、待命和采集部队一起参战。',334,384,15,C.muted)
    text(c,'缺弹或无枪的士兵近战，承受的攻击伤害更大。',334,410,15,C.gold)
    text(c,`${Math.ceil(info.alert.responseSeconds)} 秒后自动结算 · 可在倒计时结束前接管`,312,455,18,C.ink)
    if(!info.ok)text(c,info.message,312,491,16,C.gold)
    this.button('raid-back',312,615,180,42,'返回大地图',()=>{this.modal=null},'light')
    if(approaching)this.button('raid-route',508,615,280,42,'查看行军路线',()=>this.showRaidRoute(info.alert),'light')
    this.button('raid-manual',827,615,298,42,'亲自指挥',()=>this.beginRaid(id),info.ok?'accent':'light')
  }
  drawRaidRoutes(markers){
    const c=this.ctx
    c.save();c.strokeStyle='#72a9edb8';c.lineWidth=2;c.setLineDash([7,6])
    for(const {march} of markers){
      if(!march)continue
      c.beginPath()
      march.route.forEach((point,i)=>{const p=mapToScreen(this.mapCamera,point);if(i)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y)})
      c.stroke()
    }
    c.restore()
  }
  drawRaidMarkers(markers){
    const c=this.ctx,markerScale=mapMarkerScale(this.mapCamera)
    for(const {alert,march} of markers){
      const p=mapToScreen(this.mapCamera,march?.position||raidSite(alert.siteId))
      if(p.x<-130||p.x>MAP_VIEW.w+130||p.y<MAP_VIEW.y-60||p.y>MAP_VIEW.y+MAP_VIEW.h+60)continue
      if(march){
        const blue='#9dc7ff'
        circle(c,p.x,p.y,19,'#183047');icon(c,'army',p.x,p.y,25,blue)
        box(c,p.x-58,p.y+20,116,42,'#182939f5',3,MAP_FLAG_COLORS.enemy)
        text(c,`敌军 ${alert.force} 人`,p.x,p.y+32,14,blue,700,'center')
        text(c,`来自${raidOrigin(alert).name}`,p.x,p.y+50,12,blue,500,'center')
        this.buttons.push({id:'map-raid-'+alert.id,x:p.x-58,y:p.y-19,w:116,h:81,fn:()=>this.openRaid(alert.id)})
      }else{
        const pulse=1-alert.responseSeconds%1,radius=30*markerScale+8+14*pulse
        c.beginPath();c.arc(p.x,p.y,radius,0,Math.PI*2);c.strokeStyle=`rgba(255,163,91,${.7-.5*pulse})`;c.lineWidth=2;c.stroke()
        const x=p.x+26*markerScale,y=p.y-35
        box(c,x,y,96,32,'#492b21f2',4,C.gold)
        line(c,x+9,y+23,x+23,y+9,C.gold,2);line(c,x+9,y+9,x+23,y+23,C.gold,2)
        line(c,x+9,y+17,x+15,y+23,C.gold,2);line(c,x+17,y+23,x+23,y+17,C.gold,2)
        text(c,'交战中',x+31,y+16,14,C.gold,700)
        this.buttons.push({id:'map-raid-'+alert.id,x,y,w:96,h:32,fn:()=>this.openRaid(alert.id)})
      }
    }
  }
  updateMapMarches(seconds){
    if(!this.save.marchingOrders?.length)return
    const arrived=advanceMarches(this.save,seconds)
    this.dirty=true
    if(arrived.length){this.persist();this.notify('部队已抵达'+arrived.map(r=>r.target.name).join('、')+'并完成驻防')}
    // 同时只进入一场战斗；其他抵达部队在原地等待，避免覆盖当前战场或编辑窗口。
    if(this.scene==='world-map'&&!this.modal&&!this.garrisonTransfer&&!this.relocatingBase&&!this.relocatingArmory){
      const waiting=this.save.marchingOrders.find(order=>order.status==='awaiting-battle')
      if(waiting){
        const taken=takeMarchBattle(this.save,waiting.id)
        this.beginRegionBattle(taken.regionId,taken.order.unitIds)
        if(this.scene!=='battle')this.save.marchingOrders.push(taken.order)
        this.persist()
      }
    }
  }
  drawMapMarches(){
    const c=this.ctx
    for(const order of this.save.marchingOrders||[]){
      const point=marchPosition(order),target=marchTarget(order)
      const eta=Math.ceil((routeLength(order.route)-order.travelled)/(MARCH_SPEED*hungerStatus(this.save).speedMultiplier))
      order.unitIds.forEach((id,i)=>{
        const unit=this.save.formations.find(u=>u.id===id);if(!unit)return
        const p=mapToScreen(this.mapCamera,{x:point.x+(i%3-(Math.min(3,order.unitIds.length)-1)/2)*100,y:point.y+Math.floor(i/3)*130})
        if(p.x<-100||p.x>1540||p.y<MAP_VIEW.y-80||p.y>MAP_VIEW.y+MAP_VIEW.h+80)return
        c.save();c.translate(p.x,p.y);c.scale(mapMarkerScale(this.mapCamera),mapMarkerScale(this.mapCamera))
        this.drawTacticalUnit({x:0,y:0,hp:unit.troops,maxHp:unit.troops,name:unitName(unit)},false,false)
        c.restore()
      })
      const label=mapToScreen(this.mapCamera,{x:point.x,y:point.y+Math.floor((order.unitIds.length-1)/3)*130})
      c.save();c.translate(label.x,label.y);c.scale(mapMarkerScale(this.mapCamera),mapMarkerScale(this.mapCamera))
      text(c,order.status==='awaiting-battle'?'抵达 · 等待交战':`→ ${target.name} · ${eta}秒`,0,47,11,C.gold,600,'center');c.restore()
    }
    for(const task of farmTasks(this.save)){
      if(!task.phase)continue
      const point=farmTravelPosition(task)
      const groups=task.allocations||(task.unitIds?task.unitIds.map(unitId=>({unitId,troops:this.save.formations.find(u=>u.id===unitId)?.troops||0})):[{troops:task.workers}])
      groups.forEach((group,i)=>{
        const unit=this.save.formations.find(u=>u.id===group.unitId)
        if(task.unitIds&&!unit)return
        const p=mapToScreen(this.mapCamera,{x:point.x+(i-(groups.length-1)/2)*115,y:point.y})
        c.save();c.translate(p.x,p.y);c.scale(mapMarkerScale(this.mapCamera),mapMarkerScale(this.mapCamera))
        this.drawTacticalUnit({x:0,y:0,hp:group.troops,maxHp:group.troops,name:unit?unitName(unit)+'分队':'未编人员'},false,false);c.restore()
      })
      const p=mapToScreen(this.mapCamera,point)
      c.save();c.translate(p.x,p.y);c.scale(mapMarkerScale(this.mapCamera),mapMarkerScale(this.mapCamera))
      text(c,task.phase==='returning'?'返回'+villageName(task.villageId):task.phase==='outbound'?'前往田地代耕':`代耕中 · 剩余${Math.ceil(FARM.duration-task.elapsed)}秒`,0,48,11,C.gold,600,'center');c.restore()
    }
  }
  drawRegion(){
    const c=this.ctx,s=this.save,site=mapRegion(this.regionId),owner=regionOwner(s,site.id),enemy=regionEnemyTroops(s,site.id),units=regionUnits(s,site.id)
    const localUnits=enemy?[]:regionLocalUnits(s,site.id),standby=localUnits.length-units.length
    const options=gatheringOptions(site),tasks=Object.values(s.gatheringTasks[site.id]||{}),river=site.type==='river'
    icon(c,site.type,345,284,40,MAP_TERRAIN_STYLES[site.type].color)
    text(c,`${site.villageId?populationRule(site.villageId).name:REGION_KINDS[site.type]} · ${owner==='enemy'?'敌军控制':owner==='player'?'我方驻防':'暂无驻军'}`,385,277,23,owner==='enemy'?C.gold:C.olive,700)
    text(c,enemy?`守军 ${enemy} 人 · ${regionRecord(s,site.id).enemies.length} 支部队`:`我方驻军 ${units.length} 支 / ${units.reduce((n,u)=>n+u.troops,0)} 人${standby?' · 待命 '+standby+' 支':''}`,385,312,18,C.muted)
    text(c,enemy?'选择部队进攻，击败全部守军后占领该地区。':river?'驻军可捕鱼，鲜鱼自动入库，可送灶房加工。':options.length>1?'可派不同驻军同时采集木头和干草，成果自动入库。':options.length?'驻军可采集矿石，成果自动入库。':'可派空闲编制进驻，占领后部队留在此处防守。',312,358,17,C.ink)
    if(!enemy&&options.length&&(localUnits.length||tasks.length))this.button('region-gather',895,337,230,39,river?(tasks.length?'查看捕鱼':'安排捕鱼'):tasks.length?`查看采集 · ${tasks.length} 项`:'安排采集',()=>{
      this.gatherMaterial=tasks[0]?.material||options[0].id;this.setFacilityStaffing();this.open('gathering')
    },'accent')
    const roster=lineagePages(lineageRows(localUnits),3),pages=roster.length;this.regionPage=Math.min(this.regionPage||0,pages-1)
    roster[this.regionPage].forEach(({unit,depth},i)=>{
      const x=rosterRowX(depth),y=394+i*50,stationed=units.includes(unit),busy=formationActivity(s,unit.id,true)
      const canSplit=stationed&&!busy&&garrisonSplitTypes(s,unit).length>0
      const task=tasks.find(task=>task.unitIds.includes(unit.id))
      box(c,x,y,1125-x,43,C.raised,2,C.line);text(c,unitName(unit),x+15,y+22,depth?17:20,C.ink,700)
      text(c,`${number(unit.troops)} 人`,580,y+22,17,C.olive,600)
      text(c,task?gatheringAction(task.material)+'中':busy?activityLabel(busy):stationed?'驻防中':'待命中',709,y+22,14,busy?C.gold:C.muted)
      if(stationed&&!busy)this.button('region-transfer-'+unit.id,815,y+4,96,34,'转移驻地',()=>this.openGarrisonTransfer(unit.id,site.id),'accent')
      if(canSplit)this.button('region-split-'+unit.id,919,y+4,96,34,'分出部队',()=>this.openGarrisonSplit(unit.id,'region'),'light')
      if(stationed)this.button('region-recall-'+unit.id,1023,y+4,96,34,'撤回待命',()=>{const r=recallRegion(s,site.id,unit.id);this.notify(r.message);if(r.ok)this.persist()},'light')
      if(!busy&&!canSplit&&unit.splitParent!==undefined)this.button('region-rejoin-'+unit.id,stationed?919:1023,y+4,96,34,'合回上级',()=>this.combineBranch(unit),'accent')
    })
    if(!localUnits.length){
      if(enemy)regionRecord(s,site.id).enemies.slice(0,3).forEach((u,i)=>text(c,`${u.name} · ${u.troops.toLocaleString()} 人 · ${weaponById(u.weapon).name}`,312,411+i*39,17,C.muted))
      else text(c,'尚未派驻我方部队',312,423,17,C.muted)
    }
    if(pages>1){this.button('region-prev',312,555,110,34,'上一页',()=>{this.regionPage=Math.max(0,this.regionPage-1)},'light');text(c,`${this.regionPage+1}/${pages}`,465,573,15,C.muted);this.button('region-next',520,555,110,34,'下一页',()=>{this.regionPage=Math.min(pages-1,this.regionPage+1)},'light')}
    this.button('region-back',312,615,230,42,'返回大地图',()=>this.openWorldMap(),'light')
    this.button('region-dispatch',565,615,560,42,enemy?'选择部队 · 进攻占领':units.length?'增派驻防部队':'选择部队 · 进驻占领',()=>this.openRegionDeployment(site.id),'accent')
  }
  drawGathering(){
    const c=this.ctx,s=this.save,id=this.regionId,tasks=s.gatheringTasks[id]||{},options=gatheringOptions(mapRegion(id)),material=this.gatherMaterial||options[0].id
    const task=tasks[material],name=gatheringName(material),action=gatheringAction(material),fishing=material===FISH.id,stock=gatheringStock(s,material)
    const deployed=task?.unitIds.length??0,slots=Math.max(0,PROJECT_UNIT_LIMIT-deployed),adding=task&&this.addingFacilityStaff&&slots>0
    options.forEach((option,i)=>this.button('gather-material-'+option.id,312+i*278,257,257,40,tasks[option.id]?`${option.name} · 已派 ${tasks[option.id].workers} 人`:option.name,()=>{
      if(this.gatherMaterial===option.id)return
      this.gatherMaterial=option.id;this.setFacilityStaffing()
    },material===option.id?'accent':'light'))
    if(fishing)this.button('gather-kitchen',895,257,230,40,'去灶房加工',()=>this.open('kitchen'),'light')
    text(c,`仓库 ${name} ${number(stock)} 份`,312,325,21,C.olive,700)
    text(c,fishing?'每人每分钟捕 1 份鲜鱼，自动入库。':'每人每分钟采集 1 份，自动入库；可以离开面板。',312,364,16,C.muted)
    if(options.length>1)text(c,'木头、干草可由不同部队同时采集。',1125,364,15,C.muted,400,'right')
    if(task&&!adding){
      const status=hungerStatus(s).disabled?`极度饥饿，${fishing?'捕鱼':'采集'}暂停`:stock>=MATERIAL_LIMIT?'仓库已满':`${action}中`
      text(c,`${task.workers} 人 · ${status}`,312,425,21,C.ink,700)
      text(c,`已派 ${deployed} / ${PROJECT_UNIT_LIMIT} 支`,1125,425,16,C.olive,600,'right')
      box(c,312,455,813,10,C.line,3);box(c,312,455,813*task.elapsed/GATHER_INTERVAL,10,C.olive,3)
      text(c,`本轮进度 ${Math.floor(task.elapsed)} / ${GATHER_INTERVAL} 秒`,312,484,15,C.muted)
      if(slots)this.button('gather-add',995,470,130,26,'加派部队',()=>this.setFacilityStaffing(true),'accent')
      this.drawActiveWorkerList(task,'gather-unit','gatherListPage',uid=>{
        if(stopGathering(s,id,material,uid)){this.setFacilityStaffing();this.persist();this.notify(`已停止该部队${action}`)}
      },slots?985:1125)
      this.button('gather-stop',565,615,560,42,`结束${action}`,()=>{
        if(stopGathering(s,id,material)){this.setFacilityStaffing();this.persist();this.notify(`${action}已结束`)}
      },'light')
    }else{
      const available=availableGatheringUnits(s,id)
      text(c,adding?`已派 ${deployed} 支 · 可再派 ${slots} 支。本轮已开始时，新部队从下轮计入产量。`:`每种材料最多派 ${PROJECT_UNIT_LIMIT} 支部队。`,312,389,14,C.muted)
      if(!available.length)text(c,'本地暂无空闲部队，可返回地区增派部队或结束现有任务。',312,462,17,C.muted)
      const workers=available.length?this.drawFacilityPicker(available,slots):0
      this.button('gather-start',565,615,560,42,adding?`确认加派 · ${workers} 人`:`派部队${action} · 每分钟 ${workers} 份`,()=>{
        const result=startGathering(s,id,[...this.facilitySelected],material)
        if(!result.ok){this.notify(result.message);return}
        this.setFacilityStaffing();this.persist();this.notify(adding?`已加派 ${workers} 人${action}`:`部队开始${action}，成果将自动入库`)
      },workers?'accent':'light')
    }
    this.button('gather-back',312,615,230,42,adding?'取消加派':'返回地区',()=>adding?this.setFacilityStaffing():this.openRegion(id),'light')
  }
  returnFromFarm(){if(this.farmReturnToMap)this.openWorldMap();else this.open('base')}
  drawWorldMap(){
    const c=this.ctx,v=MAP_VIEW,s=this.save,picking=this.choosingBase||this.relocatingBase||this.relocatingArmory,home=this.choosingBase?null:mapBase(s)
    this.mapCamera||=picking?fitCamera({}):createCamera(home)
    const selection=mapLocation(this.mapSelected,s)
    const selected=picking?mapVillage(this.mapSelected):[home.villageId,home.roadId].includes(selection.id)?home:selection
    if(!picking)this.mapSelected=selected.id
    const camera=this.mapCamera,sites=[...MAP_LOCAL_VILLAGES,...MAP_REGIONS]
    const raids=s.raidAlerts.map(alert=>({alert,march:raidMarch(alert)}))
    box(c,0,0,1440,810,C.paper)
    c.save();c.beginPath();c.rect(v.x,v.y,v.w,v.h);c.clip()
    const origin=mapToScreen(camera,{x:0,y:0})
    c.save();c.translate(origin.x,origin.y);c.scale(camera.zoom,camera.zoom)
    const territories=home?[home,...sites.filter(site=>site.id!==home.roadId&&regionOwner(s,site.id)==='player')]:[]
    const view={...screenToMap(camera,v),w:v.w/camera.zoom,h:v.h/camera.zoom}
    const fields=MAP_FIELDS.filter(field=>field.x+field.w/2>=view.x&&field.x-field.w/2<=view.x+view.w&&field.y+field.h/2>=view.y&&field.y-field.h/2<=view.y+view.h)
    baseRegionMap(c,MAP_CORE.w,MAP_CORE.h,MAP_BOUNDS,[...sites,...MAP_FIELDS],territories,view)
    villageFields(c,fields,new Set(Object.keys(s.fieldFarmTasks)))
    regionRoads(c,[...MAP_TRAILS,...MAP_ROADS,...MAP_REGION_ROADS],mapLocation,view)
    c.restore()
    if(!picking&&raids.length)this.drawRaidRoutes(raids)
    for(const field of fields){
      const p=mapToScreen(camera,field),w=field.w*camera.zoom,h=field.h*camera.zoom
      const x=Math.max(v.x,p.x-w/2),y=Math.max(v.y,p.y-h/2),right=Math.min(v.x+v.w,p.x+w/2),end=Math.min(v.y+v.h,p.y+h/2)
      if(right<=x||end<=y)continue
      const task=farmTaskAt(s,field.id),onField=!!task,arrived=onField&&(!task.phase||task.phase==='working')
      const finished=onField&&task.phase==='returning'&&task.elapsed>=FARM.duration,rest=Math.ceil(fieldCooldown(s,field.id)),working=arrived,labelScale=mapMarkerScale(camera)
      const canDispatch=villageControlled(s,field.villageId)&&(s.baseVillageId===field.villageId||villageUnits(s,field.villageId).length>0)
      c.save();c.translate(p.x,p.y);c.scale(labelScale,labelScale)
      box(c,-36,-20,72,40,'#26371ee8',2)
      if(working){
        text(c,'代耕中',0,-6,15,C.gold,600,'center')
        text(c,task.workers+'人耕作',0,12,11,C.gold,500,'center')
      }else if(finished||rest>0){
        text(c,finished?'完成':'休耕中',0,-6,15,C.olive,600,'center')
        text(c,rest>0?'再耕 '+Math.floor(rest/60)+':'+String(rest%60).padStart(2,'0'):'队伍返村',0,12,11,C.muted,500,'center')
      }else if(onField){
        text(c,'田地',0,-6,16,C.ink,600,'center')
        text(c,task.phase==='returning'?'队伍返村':'队伍赶来',0,12,11,C.olive,500,'center')
      }else if(canDispatch){
        text(c,'田地',0,-6,16,C.ink,600,'center')
        text(c,'点击派兵',0,12,11,C.olive,500,'center')
      }else{
        text(c,'田地',0,0,16,C.muted,600,'center')
      }
      c.restore()
      if(!picking)this.buttons.push({id:'map-field-'+field.id,x,y,w:right-x,h:end-y,fn:()=>this.openMapField(field.id)})
    }
    const base=home?baseForces(s):null
    for(const location of sites){
      const isBase=location.id===home?.roadId,site=isBase?home:location
      const position=mapToScreen(camera,site),p={x:0,y:0},markerScale=mapMarkerScale(camera)
      const garrison=isBase?base.units:site.strategic?regionUnits(s,site.id):villageUnits(s,site.id),stationLines=isBase?mapBaseLines(base):mapGarrisonLines(garrison,s)
      const owner=isBase?'player':regionOwner(s,site.id),style=MAP_TERRAIN_STYLES[site.type],isCity=site.type==='city',isVillageSite=site.type==='village'
      const siteVillageId=site.villageId??site.id
      const hasFacility=(isBase||isVillageSite)&&owner!=='enemy'&&s.facilityVillages.armory===siteVillageId
      const flagBottom=isBase?-43:isCity?-30:-24,flagHeight=hasFacility?74:44
      const canChoose=this.relocatingArmory?(isBase||isVillageSite)&&!armoryTransferError(s,siteVillageId):picking&&isVillageSite&&(this.relocatingBase?!baseRelocationError(s,siteVillageId):owner!=='enemy')
      const left=66,rightEdge=66,top=isBase?58:isCity?55:hasFacility?54:owner!=='neutral'?52:33,bottom=75+stationLines.length*14,color=isBase?C.red:style.color
      const visualTop=Math.max(top,owner!=='neutral'?-flagBottom+flagHeight+4:0)
      if(position.x<-rightEdge*markerScale||position.x>1440+left*markerScale||position.y<v.y-bottom*markerScale||position.y>v.y+v.h+visualTop*markerScale)continue
      c.save();c.translate(position.x,position.y);c.scale(markerScale,markerScale)
      if(isBase){
        box(c,p.x-39,p.y-39,78,78,'#482c27',6,C.red);brackets(c,p.x-43,p.y-43,86,86,C.red)
        icon(c,'warehouse',p.x,p.y,44,C.red)
      }else{
        const half=isCity?30:24
        box(c,p.x-half,p.y-half,half*2,half*2,style.fill,4,color)
        icon(c,site.type,p.x,p.y,isCity?38:29,color)
        if(canChoose&&selected?.id===siteVillageId)brackets(c,p.x-29,p.y-29,58,58,C.olive)
      }
      if(owner!=='neutral')mapFlag(c,p.x,p.y+flagBottom,MAP_FLAG_COLORS[owner],flagHeight)
      box(c,p.x-66,p.y+30,132,44+stationLines.length*14,isBase?'#482c27':style.fill,2,color)
      text(c,site.name,p.x,p.y+46,isBase?20:18,color,700,'center')
      stationLines.forEach((value,i)=>text(c,value,p.x,p.y+64+i*14,11,C.olive,600,'center'))
      const guard=owner==='enemy'&&isCity?regionRecord(s,site.id).enemies.map(u=>FORMATION_TYPES.find(kind=>kind.id===u.type)?.name).filter((name,i,all)=>all.indexOf(name)===i).join('/')+'级 ':''
      const villagePop=isVillageSite?`${populationRule(siteVillageId).name} ${villagePopulation(s,siteVillageId)}人`:''
      const status=isBase?`根据地中心 · 兵力 ${base.troops.toLocaleString()}人`:canChoose?`${populationRule(siteVillageId).name} · 可选`:isVillageSite?(owner==='player'?`${populationRule(siteVillageId).name} · ${villagePopulation(s,siteVillageId)}人`:owner==='enemy'?`${villagePop} · 敌${regionEnemyTroops(s,site.id)}人`:`${villagePop} · 无驻军`):`${REGION_KINDS[site.type]} · ${owner==='enemy'?guard+'敌军 '+regionEnemyTroops(s,site.id)+'人':owner==='player'?'我方驻防':'无驻军'}`
      text(c,status,p.x,p.y+64+stationLines.length*14,11,canChoose?C.olive:color,500,'center')
      if(hasFacility){
        const y=isBase?p.y-63:p.y-50
        box(c,p.x-27,y,54,19,C.panel,2,C.gold);text(c,'兵工厂',p.x,y+10,10,C.gold,600,'center')
      }
      c.restore()
      const x=Math.max(v.x,position.x-left*markerScale),y=Math.max(v.y,position.y-top*markerScale),right=Math.min(v.x+v.w,position.x+rightEdge*markerScale),end=Math.min(v.y+v.h,position.y+bottom*markerScale)
      const fx=Math.max(v.x,position.x-17*markerScale),fy=Math.max(v.y,position.y+(flagBottom-flagHeight)*markerScale),fr=Math.min(v.x+v.w,position.x+17*markerScale),fb=Math.min(v.y+v.h,position.y+flagBottom*markerScale)
      const flagHit=owner!=='neutral'&&fr>fx&&fb>fy?{x:fx,y:fy,w:fr-fx,h:fb-fy}:null
      const hit=right>x&&end>y?{x,y,w:right-x,h:end-y}:flagHit
      if(hit&&(!picking||canChoose))this.buttons.push({id:(!isBase&&site.strategic?'map-region-':'map-site-')+site.id,...hit,flagHit,fn:()=>{
        if(picking){this.mapSelected=siteVillageId;this.dirty=true;return}
        if(this.garrisonTransfer){this.selectGarrisonTransferTarget(location.id);return}
        this.mapSelected=site.id
        if(isBase){this.dirty=true;this.open('base')}
        else if(site.strategic)this.openRegionAction(site.id)
        else this.openVillage(site.id)
      }})
    }
    this.drawMapMarches()
    if(!picking&&raids.length)this.drawRaidMarkers(raids)
    c.restore()
    if(this.relocatingArmory){this.drawArmoryTransfer(selected);return}
    if(picking){this.drawBaseSelection(selected);return}
    this.drawRaidAlerts()
    box(c,0,0,1440,106,C.panel);line(c,0,105,1440,105,C.line)
    box(c,26,22,58,58,C.raised,2,C.line);icon(c,'army',55,50,34,C.olive)
    text(c,s.name,100,38,23,C.ink,700);text(c,'总指挥 · 兵力 '+s.troops.toLocaleString(),100,70,16,C.muted,500)
    this.buttons.push({id:'profile',x:20,y:16,w:330,h:73,fn:()=>this.open('army')})
    const transfer=this.garrisonTransfer
    text(c,transfer?'转移驻地':home.name+'战区',400,40,28,C.ink,800)
    text(c,transfer?'点击目的地的村庄或据点图标':'拖动 / 缩放 · 外围点位可派兵占领或交战',401,73,13,C.muted)
    icon(c,'coin',970,48,24,C.gold);text(c,s.coins.toLocaleString(),994,48,22,C.gold,700)
    this.button('map-recruitment',790,28,145,50,'发动群众',()=>this.open('recruitment'),'accent')
    this.button('map-base',1200,28,198,50,'根据地',()=>this.open('base'),'light')
    // 罗盘固定在视野边缘，始终指向地图北方。
    text(c,'N',1399,136,14,C.olive,700,'center');line(c,1399,152,1399,190,C.olive,2)
    poly(c,[[1399,147],[1393,160],[1405,160]],C.olive)
    box(c,0,692,1440,118,C.panel);line(c,0,692,1440,692,C.line)
    const isBase=selected.type==='base'
    const selectedEnemy=regionEnemyTroops(s,selected.id)>0
    circle(c,43,712,4,isBase?C.gold:C.olive)
    text(c,selected.name,60,712,22,C.ink,700)
    text(c,isBase?`根据地中心 · 兵力 ${base.troops.toLocaleString()} 人`:selected.strategic?`${selected.direction} · ${REGION_KINDS[selected.type]}`:selected.direction+' · 村庄',235,712,14,isBase?C.gold:C.olive,600)
    text(c,transfer?`从 ${mapLocation(transfer.originId).name} 出发 · 抵达敌占据点后自动交战`:selectedEnemy?'敌军占领 · 点击查看守军及进攻入口。':selected.strategic?'点击查看守军，选择部队占领或进攻。':isBase?`未派出兵力留守：${base.units.length} 支编制 · 未编 ${base.unassigned.toLocaleString()} 人`:'周边田地可派兵帮助乡亲耕种。',40,736,13,C.muted)
    this.button('map-location-action',455,704,180,40,transfer?'取消转移':selectedEnemy||selected.strategic?'查看地区':isBase?'进入根据地':'村庄管理',()=>{
      if(transfer)this.cancelGarrisonTransfer()
      else if(isBase)this.open('base')
      else if(selected.strategic)this.openRegionAction(selected.id)
      else this.openVillage(selected.id)
    },'accent')
    this.drawMapZoom(selected)
    text(c,'战备 · '+hungerStatus(s).label,1392,725,16,hungerStatus(s).disabled?C.red:C.muted,500,'right')
    this.drawMapNavigation()
  }
  drawMapZoom(selected){
    const c=this.ctx,camera=this.mapCamera
    this.button('map-zoom-out',658,704,44,40,'−',()=>zoomCamera(camera,1/1.25),'light')
    text(c,Math.round(camera.zoom*100)+'%',745,724,18,C.ink,600,'center')
    this.button('map-zoom-in',790,704,44,40,'＋',()=>zoomCamera(camera,1.25),'light')
    this.button('map-fit',850,704,80,40,'全图',()=>fitCamera(camera),'light')
    if(selected)this.button('map-focus',946,704,80,40,'定位',()=>focusCamera(camera,selected),'light')
  }
  drawBaseSelection(selected){
    const c=this.ctx,relocating=this.relocatingBase
    box(c,0,0,1440,106,C.panel);line(c,0,105,1440,105,C.line)
    text(c,relocating?'迁移根据地中心':'选择根据地中心',44,40,32,C.ink,800)
    text(c,relocating?`当前根据地 ${mapBase(this.save).name} · 点击地图上的安全村庄选择新址。`:'拖动或缩放地图，点击任意无敌军的村庄来选址。',44,77,16,C.muted)
    if(relocating)this.button('map-base-cancel',1190,26,200,46,'取消迁移',()=>{this.openWorldMap();this.mapSelected='base';this.open('base')},'light')
    box(c,0,692,1440,118,C.panel);line(c,0,692,1440,692,C.line)
    text(c,selected?selected.name:'请选择一个村庄',44,724,24,C.ink,700)
    if(selected){
      text(c,`${populationRule(selected.id).name} · 村民 ${number(villagePopulation(this.save,selected.id))} 人`,44,762,16,C.muted)
      const error=relocating?baseRelocationError(this.save,selected.id):''
      if(error)text(c,error,1090,729,16,C.gold)
      else this.button('map-base-confirm',1090,706,300,45,relocating?'确认迁移根据地':'确认根据地 · 开始游戏',()=>relocating?this.confirmBaseRelocation():this.confirmStartingBase(),'accent')
    }
    this.drawMapZoom(selected)
  }
  openArmoryTransfer(target=null){
    this.armoryTransferFrom=this.villageId
    this.openWorldMap();this.relocatingArmory=true;this.mapSelected=target
  }
  drawArmoryTransfer(selected){
    const c=this.ctx,s=this.save,origin=s.facilityVillages.armory
    box(c,0,0,1440,106,C.panel);line(c,0,105,1440,105,C.line)
    text(c,'转移兵工厂',44,40,32,C.ink,800)
    text(c,`当前位于${villageName(origin)} · 在地图上选择我方村庄`,44,77,16,C.muted)
    this.button('armory-transfer-cancel',1190,26,200,46,'取消转移',()=>{
      this.openWorldMap();this.openVillage(this.armoryTransferFrom)
    },'light')
    box(c,0,692,1440,118,C.panel);line(c,0,692,1440,692,C.line)
    text(c,selected?selected.name:'请选择目的村庄',44,724,24,C.ink,700)
    text(c,'迁移后，正在兵工厂工作的部队将随兵工厂一起迁往新址继续生产。',44,762,16,C.muted)
    if(selected){
      const error=armoryTransferError(s,selected.id)
      if(error)text(c,error,1090,729,16,C.gold)
      else this.button('armory-transfer-confirm',1090,706,300,45,'确认转移兵工厂',()=>{
        const result=transferArmory(s,selected.id)
        if(!result.ok){this.notify(result.message);return}
        this.openWorldMap();focusCamera(this.mapCamera,selected);this.openVillage(selected.id)
        this.persist();this.notify('兵工厂已迁至'+selected.name)
      },'accent')
    }
    this.drawMapZoom(selected)
  }
  drawLobby(){this.drawWorldMap()}
  drawMapNavigation(){
    const c=this.ctx,s=this.save,tabs=[['formation','我的部队'],['warehouse','仓库'],['shop','商城'],['kitchen','灶房'],['tasks','作战任务'],['settings','设置']]
    line(c,48,750,1392,750,C.line)
    tabs.forEach(([id,label],i)=>{
      const x=48+i*225;box(c,x,756,210,45,C.raised,2,C.line);icon(c,id,x+27,778,23,C.olive);text(c,label,x+57,778,18,C.ink,600)
      if(id==='tasks'&&MISSIONS.some(m=>missionProgress(s,m)>=m.goal&&!s.claimed.includes(m.id)))circle(c,x+194,766,4,C.red)
      this.buttons.push({id,x,y:756,w:210,h:45,fn:()=>this.open(id)})
    })
  }
  inputRecruitQuantity(){
    const coins=this.recruitFoodId==='coins'
    wx.showModal({title:coins?'设置赠送金币数量':'设置投放食品数量',editable:true,content:String(this.recruitQuantity),placeholderText:coins?'输入1—10000枚':'输入 1—10000 份',maxLength:5,inputLabel:coins?'金币数量':'食品份数',numberLabel:coins?'金币数量':'食品份数',confirmText:'确认数量',numberInput:true,minValue:RECRUITMENT.min,maxValue:RECRUITMENT.max,success:r=>{
      if(!r.confirm)return
      const count=Number(r.content?.trim())
      if(!Number.isInteger(count)||count<RECRUITMENT.min||count>RECRUITMENT.max){this.notify(coins?'每次可赠送1—10000枚金币':'每次可投放 1—10000 份食品');return}
      this.recruitQuantity=count;this.dirty=true
    }})
  }
  recruit(){
    const result=donateAllVillages(this.save,this.recruitFoodId,this.recruitQuantity)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.notify('已统一送出'+result.food.name+' '+result.count+result.food.unit+' · 所有村庄共同动员')
  }
  openFoodShop(){this.open('shop');this.inventoryTab='logistics'}
  drawRecruitment(){
    const c=this.ctx,s=this.save,f=formation(s),count=this.recruitQuantity,villages=garrisonedVillages(s),totalPop=villages.reduce((n,v)=>n+villagePopulation(s,v.id),0)
    const choices=[...FOODS,{id:'coins',name:'金币',unit:'枚'}],food=choices.find(food=>food.id===this.recruitFoodId)||FOODS[0],quote=validateDonation(s,food.id,count),taste=donationTaste(s)
    const stats=[['总兵力',s.troops,C.ink],['未编人员',f.unassignedTroops,C.olive],['驻军村人口',totalPop,C.gold],['累计报名',s.recruitedTroops,C.gold]]
    stats.forEach(([label,value,color],i)=>{const x=312+i*208;box(c,x,257,189,68,C.raised,2,C.line);text(c,label,x+15,275,14,C.muted);text(c,value.toLocaleString(),x+15,306,27,color,700)})
    box(c,312,339,260,240,C.raised,2,C.line)
    text(c,'驻军村庄 · 动员',325,357,16,C.olive,700)
    text(c,'村庄　　村民　　动员　　累计',325,378,11,C.muted)
    const recruitPages=Math.max(1,Math.ceil(villages.length/6));this.recruitPage=Math.min(this.recruitPage||0,recruitPages-1)
    if(recruitPages>1){text(c,`${this.recruitPage+1}/${recruitPages}`,526,357,11,C.muted,500,'center');this.button('recruit-prev',488,346,22,22,'‹',()=>{this.recruitPage=Math.max(0,this.recruitPage-1)},'light');this.button('recruit-next',542,346,22,22,'›',()=>{this.recruitPage=Math.min(recruitPages-1,this.recruitPage+1)},'light')}
    if(!villages.length){text(c,'暂无驻军村庄',442,445,14,C.muted,600,'center');text(c,'请先在地图村庄派驻部队',442,469,12,C.muted,400,'center')}
    villages.slice(this.recruitPage*6,this.recruitPage*6+6).forEach((v,i)=>{
      const m=mobilizationRecord(s,v.id),status=mobilizationStatus(s,v.id),y=399+i*27
      const label=status==='动员已暂停'?'暂停':status==='村民不足'?'待增长':status==='兵力已达上限'?'满额':recruitmentInterval(s,v.id)===10?'10秒':'20秒'
      const recruited=m.recruitedTroops>=10000?(m.recruitedTroops/10000).toFixed(1)+'万':String(m.recruitedTroops)
      text(c,v.name,325,y,14,C.ink,600);text(c,villagePopulation(s,v.id),399,y,12,C.muted)
      text(c,label,449,y,11,s.allVillagesMobilizing?C.olive:C.muted);text(c,recruited,555,y,11,C.gold,500,'right')
    })
    this.button('recruit-toggle',332,548,220,27,s.allVillagesMobilizing?'暂停驻军动员':'发动驻军村庄',()=>{if(!s.allVillagesMobilizing&&!villages.length){this.notify('请先派部队驻防至少一个村庄，才能发动群众');return}setAllVillagesMobilizing(s,!s.allVillagesMobilizing);this.persist()},'accent')
    text(c,'统一储备：食物 '+s.mobilizationFood+' · 金币 '+s.mobilizationCoins,600,348,15,C.ink,700)
    text(c,taste.name?`${taste.name} · 连续 ${taste.streak}/2 次`:'换着送食品',1120,348,12,taste.blocked?C.red:C.muted,500,'right')
    choices.forEach((item,i)=>{
      const x=600+(i%4)*134,y=368+Math.floor(i/4)*43,chosen=item.id===food.id
      box(c,x,y,123,36,chosen?'#3c4e30':C.raised,2,chosen?C.olive:C.line)
      text(c,item.name,x+10,y+18,16,chosen?C.ink:C.muted,600)
      text(c,String(s[item.id]),x+113,y+18,12,C.gold,500,'right')
      this.buttons.push({id:'recruit-food-'+item.id,x,y,w:123,h:36,fn:()=>{this.recruitFoodId=item.id}})
    })
    text(c,food.name+' · 持有 '+s[food.id]+' '+food.unit+' · 本次赠送',600,461,15,C.muted)
    this.button('recruit-minus',600,479,52,36,'−',()=>{this.recruitQuantity=Math.max(RECRUITMENT.min,count-1)},'light')
    this.button('recruit-quantity',664,479,397,36,count+' '+food.unit+' · 点击输入',()=>this.inputRecruitQuantity(),'dark')
    this.button('recruit-plus',1073,479,52,36,'＋',()=>{this.recruitQuantity=Math.min(RECRUITMENT.max,count+1)},'light')
    ;[10,20,50].forEach((quantity,i)=>this.button('recruit-preset-'+quantity,600+i*179,531,167,36,quantity+' '+food.unit,()=>{this.recruitQuantity=quantity},count===quantity?'accent':'light'))
    text(c,'统一赠送只扣一次 · 各村按规模招募并扣本村村民 · 有支持10秒，无支持20秒一批',312,596,14,C.muted)
    this.button('recruit-shop',312,622,230,35,'商城采购食品',()=>this.openFoodShop(),'light')
    this.button('recruit-confirm',600,622,320,35,quote.ok?'统一送出'+food.name+' '+count+food.unit:s[food.id]<count?(food.id==='coins'?'金币不足':'食品不足 · 先采购'):'乡亲吃腻了 · 换一样',()=>this.recruit(),quote.ok?'accent':'light')
    this.button('recruit-formation',936,622,189,35,this.localVillage?'返回村庄':'返回地图',()=>this.returnToVillage(),'light')
  }
  inputKitchenBatch(){
    wx.showModal({title:'设置做饭批数',editable:true,content:String(this.kitchenBatch),placeholderText:`输入 1—${RECRUITMENT.maxBatches} 批`,maxLength:5,inputLabel:'做饭批数',numberLabel:'做饭批数',confirmText:'确认批数',numberInput:true,minValue:1,maxValue:RECRUITMENT.maxBatches,success:r=>{
      if(!r.confirm)return
      const count=Number(r.content?.trim())
      if(!Number.isInteger(count)||count<1||count>RECRUITMENT.maxBatches){this.notify(`每次可做饭 1—${RECRUITMENT.maxBatches} 批`);return}
      this.kitchenBatch=count;this.dirty=true
    }})
  }
  cook(id){
    const previous=hungerStatus(this.save)
    const result=cookDish(this.save,id,this.kitchenBatch)
    if(!result.ok){this.notify(result.message);return}
    const hunger=hungerStatus(this.save)
    this.syncBattleReadiness()
    this.persist();this.notify(`${result.dish.name}出锅 +${result.dish.output*result.batches} 份 · `+(result.feeding.consumed?`部队立即进食 ${result.feeding.consumed} 份`+(previous.disabled&&!hunger.disabled?'，恢复正常战斗效果':''):'部队口粮已补充'))
  }
  drawKitchen(){
    const c=this.ctx,s=this.save,batch=this.kitchenBatch||10,need=mealCost(s),cooked=rationStock(s)
    text(c,'自动做饼、炒米、玉米。肉、蛋、鱼可手动加工。',312,263,14,C.muted)
    this.button('kitchen-auto',860,252,265,28,s.autoCooking?'自动做饭：开启':'自动做饭：关闭',()=>{s.autoCooking=!s.autoCooking;this.persist()},s.autoCooking?'accent':'light')
    text(c,`熟食储备 ${cooked} 份 · 每次需 ${need} 份（5分钟/次）· ${Math.ceil(RATIONS.interval-s.mealElapsed)} 秒后开饭`,312,286,15,hungerStatus(s).debt>0?C.red:C.olive,600)
    DISHES.forEach((dish,i)=>{
      const x=312+(i%2)*420,y=306+Math.floor(i/2)*88,quote=validateCooking(s,dish.id,batch)
      box(c,x,y,393,80,C.raised,2,quote.ok?C.line:C.red)
      icon(c,dish.icon,x+28,y+40,28,C.gold)
      text(c,dish.name,x+56,y+20,20,C.ink,700)
      text(c,`库存 ${s[dish.id]} 份 · 每批出 ${dish.output} 份`,x+56,y+43,13,C.olive,600)
      text(c,dish.recipe+(dish.autoCook?'':' · 仅手动'),x+56,y+64,12,C.muted)
      this.button('cook-'+dish.id,x+250,y+22,130,36,`做 ${batch} 批`,()=>this.cook(dish.id),quote.ok?'accent':'light')
    })
    text(c,'批量做饭：',312,588,14,C.muted)
    ;[1,5,10,20].forEach((n,i)=>this.button('kitchen-preset-'+n,410+i*92,572,82,32,n+' 批',()=>{this.kitchenBatch=n},batch===n?'accent':'light'))
    this.button('kitchen-batch',800,572,205,32,batch+' 批 · 点击输入',()=>this.inputKitchenBatch(),'dark')
    this.button('kitchen-feed',1025,572,100,32,'手动开饭',()=>{
      const result=serveMealNow(s);if(!result.ok){this.notify(result.message);return}
      this.syncBattleReadiness();this.persist();this.notify('已供餐 '+result.consumed+' 份'+(result.shortage?' · 本餐还缺 '+result.shortage+' 份':' · 本餐已吃饱'))
    },'accent')
    this.button('kitchen-shop',312,612,220,36,'商城采购食材',()=>this.openFoodShop(),'light')
    this.button('kitchen-warehouse',548,612,220,36,'查看熟食仓库',()=>{this.open('warehouse');this.inventoryTab='dishes'},'light')
    this.button('kitchen-recruit',784,612,220,36,'发动所有村庄',()=>this.open('recruitment'),'light')
    text(c,'状态：'+hungerStatus(s).label+' · '+(s.lastMealServed>0&&!s.lastMealShortage?'本餐已吃饱':'缺餐 '+hungerStatus(s).debt.toFixed(1)+'/3')+' · 严重饥饿有饭即吃，极饿仍可作战但效果下降',312,665,12,hungerStatus(s).disabled?C.red:C.muted)
  }
  drawTrainingSelection(){
    if(trainingTaskAt(this.save,this.localVillage)){this.drawTrainingTask();return}
    const c=this.ctx,s=this.save,units=this.localVillage?villageLocalUnits(s,this.localVillage):formationRoots(s)
    const roster=lineagePages(lineageRows(units)),pages=roster.length
    this.trainingPage=Math.max(0,Math.min(this.trainingPage||0,pages-1));const page=this.trainingPage
    text(c,`士兵综合训练 · 每人需1秒 · 完成后每人 +${TRAINING_XP} 经验`,312,271,20,C.ink,700)
    text(c,this.localVillage?'仅训练'+villageName(this.localVillage)+'驻军，完成后继续在本村保护乡亲。':'选择一支独立部队参训，所属下级士兵一同获得经验。',312,302,15,C.muted)
    if(!units.length){icon(c,'army',720,410,56,C.muted);text(c,'尚无可训练部队',720,478,26,C.ink,700,'center');text(c,this.localVillage?'请先返回村庄调入驻军，无枪部队也能训练':'请先到「我的部队」创建编制，无枪部队也能训练',720,518,17,C.muted,400,'center')}
    roster[page].forEach(({unit,depth},i)=>{
      const status=trainingStatus(s,unit.id),x=rosterRowX(depth),y=326+i*58,selected=unit.id===this.trainingSelectedId
      box(c,x,y,1125-x,51,C.raised,2,selected?C.blue:C.line)
      text(c,unitName(unit),x+15,y+26,depth?17:20,C.ink,700);text(c,`${number(unit.troops)} 人`,580,y+21,17,C.olive,600)
      text(c,'需 '+trainingDuration(unit.troops)+' 秒',580,y+41,11,C.muted)
      text(c,`${status.name} · ${status.average}${status.nextXp!==null?'/'+status.nextXp:' 满级'}`,728,y+26,17,C.blue,600)
      const busy=formationActivity(s,unit.id,!!this.localVillage)
      this.button('training-select-'+unit.id,1000,y+7,109,37,busy?activityLabel(busy):selected?'已选择':'选择',()=>{if(busy){this.notify('部队正在执行任务，归队后才能训练');return}this.trainingSelectedId=unit.id},selected?'accent':'light')
    })
    const selected=units.find(unit=>unit.id===this.trainingSelectedId)
    text(c,`已完成 ${s.trainingSessions} 轮 · `+(selected?`本轮需 ${trainingDuration(selected.troops)} 秒 · `:'')+'训练期间可以做其他事情',312,587,15,C.muted)
    this.button('training-formation',312,615,185,40,'我的部队',()=>this.open('formation'),'light')
    if(pages>1){
      this.button('training-prev',513,615,104,40,'上一页',()=>{this.trainingPage=Math.max(0,page-1)},'light')
      text(c,`${page+1}/${pages}`,715,636,16,C.muted,500,'center')
      this.button('training-next',819,615,104,40,'下一页',()=>{this.trainingPage=Math.min(pages-1,page+1)},'light')
    }
    this.button('training-start',940,615,185,40,'开始训练',()=>this.startTraining(),'accent')
    text(c,'离开训练场继续计时，完成后自动归队；主动召回取消本轮经验。',312,668,13,C.muted)
  }
  drawTrainingTask(){
    const c=this.ctx,t=trainingTaskAt(this.save,this.localVillage),paused=hungerStatus(this.save).disabled,ratio=t.elapsed/t.duration
    text(c,t.name+' · '+t.troops.toLocaleString()+' 人参训',312,276,25,C.ink,700)
    text(c,'每人1秒 · 本轮总时长 '+t.duration+' 秒 · 完成每人 +'+TRAINING_XP+' 经验',312,317,17,C.muted)
    box(c,312,350,813,152,C.raised,2,C.line)
    text(c,paused?'极度饥饿，训练暂停，供餐后继续':'训练进行中 · 可以离开此页面',334,380,22,paused?C.gold:C.olive,700)
    box(c,334,415,769,12,C.line,4);box(c,334,415,769*ratio,12,C.blue,4)
    text(c,Math.floor(t.elapsed)+' / '+t.duration+' 秒',334,466,18,C.muted)
    text(c,'剩余 '+Math.ceil(t.duration-t.elapsed)+' 秒',1103,466,20,C.blue,700,'right')
    text(c,'参训部队及其下属暂时占用，其他空闲部队仍可执行任务。',312,541,16,C.muted)
    text(c,'进度自动保存；完成后自动发放经验，不会强制切换当前页面。',312,574,15,C.muted)
    this.button('training-back',312,615,230,42,this.localVillage?'返回村庄':'返回大地图',()=>this.returnToVillage(),'light')
    this.button('training-home',565,615,265,42,'返回大厅',()=>this.home(),'accent')
    this.button('training-recall',850,615,275,42,this.localVillage?'停止训练 · 留在本村':'召回部队 · 取消本轮',()=>this.recallTraining(),'light')
  }
  drawTacticalUnit(unit,hostile=false,selected=false){
    const c=this.ctx,alive=unit.hp>0,color=hostile?C.red:selected?C.olive:alive?'#a6b99a':C.muted
    c.save();if(!alive)c.globalAlpha=.45
    box(c,unit.x-16,unit.y-10,32,20,hostile?'#402921':selected?'#3b5031':'#1c2c22',2,color)
    line(c,unit.x-10,unit.y-6,unit.x+10,unit.y+6,color,1.5)
    line(c,unit.x+10,unit.y-6,unit.x-10,unit.y+6,color,1.5)
    if(selected)brackets(c,unit.x-23,unit.y-17,46,34,C.olive)
    text(c,alive?`${Math.ceil(unit.hp)}人`:'已阵亡',unit.x,unit.y-27,11,hostile?C.red:selected?C.ink:C.muted,500,'center')
    box(c,unit.x-16,unit.y+13,32,2,'#17231b',1);box(c,unit.x-16,unit.y+13,32*Math.max(0,unit.hp)/unit.maxHp,2,color,1)
    text(c,unit.name,unit.x,unit.y+29,14,hostile?C.red:selected?C.olive:C.ink,600,'center')
    c.restore()
  }
  drawCampaignUnits(){
    const c=this.ctx,b=this.battle
    for(const unit of b.units){
      const alive=unit.hp>0,selected=b.selectedUnitId===unit.id&&alive
      if(selected&&Math.hypot(unit.target.x-unit.x,unit.target.y-unit.y)>5){
        c.save();c.globalAlpha=.65;c.setLineDash([4,7]);line(c,unit.x,unit.y,unit.target.x,unit.target.y,C.olive,1.5);c.restore()
        const tx=unit.target.x,ty=unit.target.y
        line(c,tx,ty-9,tx+9,ty,C.olive,1.5);line(c,tx+9,ty,tx,ty+9,C.olive,1.5)
        line(c,tx,ty+9,tx-9,ty,C.olive,1.5);line(c,tx-9,ty,tx,ty-9,C.olive,1.5)
        circle(c,tx,ty,2,C.olive)
      }
      this.drawTacticalUnit(unit,false,selected)
    }
  }
  drawCampaignRoster(){
    const c=this.ctx,b=this.battle,parents=new Map(this.save.formations.map(unit=>[unit.id,unit.splitParent]))
    const roster=lineagePages(lineageRows(b.units.map(actor=>({id:actor.id,splitParent:actor.parentActorId??parents.get(actor.id),actor})))),pages=roster.length
    this.battleRosterPage=Math.min(this.battleRosterPage||0,pages-1)
    const ammo=WEAPONS.map(weapon=>weapon.name+' '+number(this.save[weapon.ammo]||0)).join(' · ')
    text(c,hungerStatus(this.save).disabled?'极度饥饿：火力50% · 射速降低 · 移动速度70%':'剩余弹药 · '+ammo,42,689,16,hungerStatus(this.save).disabled?C.red:C.muted)
    this.button('battle-split',972,674,205,27,'分遣下级部队',()=>this.openBattleSplit(),'light')
    this.button('battle-recall',1190,674,205,27,'召回选中分遣部队',()=>{if(!b.recallUnit())this.notify('请先选中一支分遣部队');else this.notify('分遣部队正在返回，接触原部队后自动归队')},'light')
    roster[this.battleRosterPage].forEach(({unit:{actor:unit},depth},i)=>{
      const x=42+i*187,y=715,selected=b.selectedUnitId===unit.id,color=unit.hp<=0?C.muted:selected?C.olive:C.blue
      box(c,x,y,175,72,selected?'#31432d':C.raised,2,color)
      text(c,depth?'↳ '+unit.name:unit.name,x+14,y+18,depth?17:21,color,700)
      const melee=unit.hp>0?b.meleeTroops(unit):0,meleeOnly=melee===unit.groups.reduce((n,group)=>n+group.troops,0)
      text(c,unit.hp>0?`${Math.ceil(unit.hp)} / ${unit.maxHp} 人`:`阵亡 · 损失 ${unit.maxHp} 人`,x+14,y+41,15,unit.hp>0?C.muted:C.red)
      if(melee)text(c,meleeOnly?'近战':'部分近战',x+14,y+60,13,C.gold,600)
      this.buttons.push({id:'battle-unit-'+unit.id,x,y,w:175,h:72,fn:()=>{if(!b.selectUnit(unit.id))this.notify('该部队已阵亡，请选择其他部队')}})
    })
    if(pages>1){
      this.button('battle-roster-prev',801,715,96,32,'上一页',()=>{this.battleRosterPage=Math.max(0,this.battleRosterPage-1)},'light')
      this.button('battle-roster-next',801,755,96,32,'下一页',()=>{this.battleRosterPage=Math.min(pages-1,this.battleRosterPage+1)},'light')
      text(c,`${this.battleRosterPage+1}/${pages}`,850,690,13,C.muted,500,'center')
    }
  }
  openBattleSplit(){
    const unit=this.battle.selectedUnit,choices=this.battle.splitOptions()
    if(!unit||!choices.length){this.notify('请选中可分遣下级的部队，并为主力保留至少1人');return}
    this.splitDraft={actorId:unit.id,type:choices[0].id,troops:choices[0].min};this.modal='battle-split';this.dirty=true
  }
  drawBattleSplit(){
    const b=this.battle,d=this.splitDraft,unit=b.units.find(unit=>unit.id===d.actorId),choices=b.splitOptions(unit),kind=FORMATION_TYPES.find(kind=>kind.id===d.type)
    const max=Math.min(kind.max,Math.ceil(unit.hp)-1),c=this.ctx
    text(c,unit.name+' · 现有 '+Math.ceil(unit.hp)+' 人',312,274,23,C.ink,700)
    text(c,'选择任意下级编制，人员、武器与训练水平随分遣部队调走。',312,307,15,C.muted)
    choices.forEach((kind,i)=>this.button('split-type-'+kind.id,312+(i%4)*208,332+Math.floor(i/4)*43,191,34,kind.name,()=>{d.type=kind.id;d.troops=kind.min},d.type===kind.id?'accent':'light'))
    text(c,kind.name+'：'+kind.min+'—'+max+' 人 · 分遣后主力 '+(Math.ceil(unit.hp)-d.troops)+' 人',312,447,18,C.olive,600)
    this.button('split-minus',312,468,60,42,'−',()=>{d.troops=Math.max(kind.min,d.troops-1)},'light')
    this.button('split-count',384,468,669,42,d.troops+' 人 · 点击输入',()=>{
      wx.showModal({title:'设置分遣人数',editable:true,content:String(d.troops),inputLabel:'分遣人数',numberLabel:'分遣人数',numberInput:true,minValue:kind.min,maxValue:max,confirmText:'确认人数',success:r=>{
        if(!r.confirm)return
        const n=Number(r.content?.trim());if(!Number.isInteger(n)||n<kind.min||n>max){this.notify('人数须为 '+kind.min+'—'+max+' 的整数');return}d.troops=n;this.dirty=true
      }})
    },'dark')
    this.button('split-plus',1065,468,60,42,'＋',()=>{d.troops=Math.min(max,d.troops+1)},'light')
    text(c,'主力仍为'+unit.name+'，分遣只影响本场战斗。',312,551,17,C.muted)
    text(c,'选中分遣部队点击原部队，或使用召回；接触后自动归队。',312,581,15,C.muted)
    this.button('split-cancel',312,615,230,42,'取消',()=>{this.modal=null},'light')
    this.button('split-confirm',565,615,560,42,'确认分遣 · '+d.troops+' 人',()=>{
      b.selectUnit(d.actorId);const result=b.splitSelected(d.type,d.troops)
      if(!result.ok){this.notify(result.message);return}
      if(applyBattleLosses(this.save,b))this.persist()
      this.modal=null;this.notify(result.unit.name+'已分遣，点选后可独立移动作战')
    },'accent')
  }
  drawBattle(){
    const c=this.ctx,b=this.battle;box(c,0,0,1440,810,'#26352a')
    for(let x=0;x<1440;x+=60)line(c,x,116,x,665,'#344435')
    for(let y=130;y<670;y+=60)line(c,0,y,1440,y,'#344435')
    poly(c,[[0,510],[400,400],[800,460],[1440,250],[1440,320],[820,520],[430,460],[0,570]],'#454c38')
    for(let i=0;i<14;i++){const x=(i*337+90)%1440,y=140+(i*191)%480;box(c,x,y,38,16,'#536047',2);line(c,x+8,y+5,x+28,y+5,'#748266',2)}
    if(!b.units){c.save();c.setLineDash([5,6]);c.strokeStyle='#5a7d4d';c.beginPath();c.arc(b.target.x,b.target.y,28,0,Math.PI*2);c.stroke();c.setLineDash([]);c.restore()}
    if(b.artillery>4.65&&this.save.settings.effects)box(c,0,118,1440,540,'rgba(255,228,169,.5)')
    for(const e of b.enemies){
      if(b.units)this.drawTacticalUnit(e,true)
      else{
        if(e.heavy)tank(c,e.x,e.y,.8,'#ac7962',Math.PI)
        else{circle(c,e.x,e.y+7,13,'#a2a48c');circle(c,e.x,e.y,11,'#986453');circle(c,e.x,e.y-4,9,'#ba8c6d');line(c,e.x-19,e.y,e.x-2,e.y,'#4f4a39',4)}
        box(c,e.x-16,e.y-24,32,3,'#8a8f78');box(c,e.x-16,e.y-24,32*Math.max(0,e.hp/e.maxHp),3,C.red)
      }
    }
    if(b.units)this.drawCampaignUnits()
    else{
      const number=Math.max(1,Math.ceil(b.hp/b.maxHp*9))
      for(let i=0;i<number;i++){const x=b.x+(i%3-1)*24,y=b.y+(Math.floor(i/3)-1)*25;circle(c,x,y+5,11,'#a2ac90');circle(c,x,y,10,'#547348');circle(c,x,y-4,8,'#7f995a');line(c,x+3,y,x+21,y-1,'#354a38',4)}
      if(b.weapon.id==='mortar'||b.groups?.some(g=>g.weapon.id==='mortar'))weaponArt(c,'mortar',b.x+38,b.y+22,.65,weaponById('mortar').color)
    }
    for(const s of b.shots)line(c,s.x,s.y,s.tx,s.ty,s.hostile?'#b57859':s.kind==='melee'?C.gold:weaponById(s.kind).color,s.kind==='sniper'?3:2)
    if(this.save.settings.effects)for(const f of b.bursts){c.save();c.globalAlpha=f.life/.4;circle(c,f.x,f.y,(1-f.life/.4)*(f.radius||25)+6,'#e7c989');c.restore()}
    box(c,0,0,1440,116,C.paper);line(c,0,115,1440,115,C.line);text(c,b.regionName?b.regionName+(b.raidId?' · 驻地防守':' · 争夺战'):MODES.find(m=>m.id===b.mode)?.name||'战斗演练',42,37,25,'#f5f3e4',700);text(c,b.raidId?'驻军应敌':`第 ${b.level} 战区  /  波次 ${b.wave}${Number.isFinite(b.goal)?' / '+b.goal:''}`,42,80,16,'#bdc7b5')
    text(c,`部队兵力  ${Math.ceil(b.hp)} / ${b.maxHp}`,460,38,20,'#f3f2dd',600);box(c,460,70,360,9,'#51604d',4);box(c,460,70,360*b.hp/b.maxHp,9,'#b5c68a',4)
    text(c,`歼敌 ${b.kills}${b.units?' 人':''}`,900,45,18,'#f1eedc',600)
    text(c,`${b.units?'我军 '+b.units.filter(unit=>unit.hp>0).length+'/'+b.units.length+' 支 · ':''}${Math.floor(b.time)}s`,900,78,13,'#b4c1aa')
    this.button('pause',1250,30,146,55,'暂停',()=>this.open('pause'),'light')
    box(c,0,667,1440,143,C.paper);line(c,0,667,1440,667,C.olive)
    if(b.units){
      const selected=b.selectedUnit
      text(c,selected?`已选 ${selected.name} · 点击地面下达移动命令`:'点击战场中的部队，或底部部队卡片进行选择',42,139,16,selected?C.olive:C.muted,600)
      text(c,`敌军 ${b.enemies.length} 支 / ${b.enemies.reduce((sum,unit)=>sum+Math.ceil(unit.hp),0)} 人 · 待入场 ${b.pending} 支`,1390,139,15,C.red,600,'right')
      this.drawCampaignRoster()
    }else{
      text(c,b.groups?.length>1?`混编火力 · ${b.groups.length} 种武器协同作战`:`当前军械 · ${b.weapon.name}`,42,704,21,b.weapon.color,700);text(c,'点击或拖动战场移动部队 · 进入射程自动开火',42,743,16,C.muted)
    }
    if(b.breather>0)text(c,b.wave>=b.goal?'战场已清理':'警戒待命 · 下一波即将抵达',720,158,19,C.olive,700,'center')
  }
  drawWeapons(type){
    const c=this.ctx,s=this.save
    const items=type==='shop'?WEAPONS:WEAPONS.filter(w=>s.weaponCounts[w.id]>0)
    if(!items.length)this.drawEmptyInventory()
    items.forEach((w,i)=>{
      const x=312+(i%2)*420,y=312+Math.floor(i/2)*109,count=s.weaponCounts[w.id]
      if(type==='warehouse'){
        box(c,x,y,393,100,C.raised,2,C.line)
        weaponArt(c,w.id,x+52,y+49,.55,w.color)
        text(c,w.name,x+105,y+30,23,C.ink,700)
        text(c,`数量：${count} 把`,x+105,y+70,24,C.olive,700)
        return
      }
      box(c,x,y,393,100,C.raised,2,C.line)
      weaponArt(c,w.id,x+49,y+34,.48,w.color)
      text(c,w.name,x+100,y+33,23,C.ink,700)
      text(c,`持有 ${count} 把 · 待售 ${shopAvailable(s,w.id)} 把`,x+14,y+77,15,C.olive,700)
      const quote=purchaseQuote(s,w,true)
      this.button('buy-weapon-'+w.id,x+218,y+58,161,34,quote.available?`${w.price} 金币 / 把`:'已售罄',()=>this.buyShopItem(w,true),quote.available?'accent':'light')
    })
    text(c,type==='shop'?'货源限量 · 每 5 分钟补满 · 缴获武器不占商城额度':'枪械库存 · 仅显示已拥有的武器及数量',312,655,15,C.muted)
  }
  shopRestockLabel(){
    const seconds=Math.max(0,Math.ceil((this.save.shopNextRestockAt-Date.now())/1000))
    return `限量货源 · 每 5 分钟补满 · 下次补货 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`
  }
  buyShopItem(item,weapon=false){
    const quote=purchaseQuote(this.save,item,weapon)
    if(!quote.ok){this.notify(quote.message);return}
    const bought=weapon?purchaseWeapon(this.save,item.id):purchase(this.save,item.id)
    if(bought){this.persist();this.notify(`${item.name} +${quote.amount}${weapon?'把':item.unit} · 已入库`)}
    else this.notify('商品状态已更新，请重新选择')
  }
  drawBase(){
    const c=this.ctx,s=this.save,base=baseForces(s)
    const home=mapBase(s)
    icon(c,'warehouse',720,318,72,C.gold);text(c,home.name,720,392,34,C.ink,700,'center')
    text(c,`根据地指挥中心 · 留守兵力 ${base.troops.toLocaleString()} 人`,720,436,19,C.gold,700,'center')
    text(c,`未派出：${base.units.length} 支编制 / 未编 ${base.unassigned.toLocaleString()} 人`,720,474,17,C.ink,600,'center')
    const villages=controlledVillages(s),units=villages.flatMap(v=>villageUnits(s,v.id)),troops=units.reduce((sum,u)=>sum+u.troops,0)
    text(c,'名下 '+villages.length+' 个村庄 · 驻军 '+units.length+' 支 / '+troops.toLocaleString()+' 人',720,512,18,C.olive,600,'center')
    text(c,'未派出的编制与未编人员留守于此；村庄驻防与耕田请前往大地图。',720,553,15,C.muted,400,'center')
    this.button('base-home',312,615,192,42,'返回指挥部',()=>this.home(),'light')
    if(s.baseVillageId!=null)this.button('base-village',519,615,192,42,'本村管理',()=>this.openVillage(home.villageId),'light')
    this.button('base-map',726,615,192,42,'定位根据地',()=>{this.openWorldMap();this.mapSelected='base';focusCamera(this.mapCamera,home)},'light')
    if(s.baseVillageId!=null)this.button('base-relocate',933,615,192,42,'迁移根据地',()=>this.openBaseRelocation(),'accent')
  }
  manageVillageArmory(){
    const result=placeVillageFacility(this.save,'armory',this.villageId)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.localVillage=this.villageId;this.open('base-armory')
  }
  confirmArmoryRemoval(){
    const id=this.villageId
    wx.showModal({title:'拆除本村兵工厂',content:'会结束所有生产项目，保留已入库的成品和仓库材料。',confirmText:'拆除',success:response=>{
      if(!response.confirm)return
      const result=removeVillageFacility(this.save,'armory',id)
      if(!result.ok){this.notify(result.message);return}
      this.persist();this.notify('兵工厂已拆除')
    }})
  }
  drawVillage(){
    const c=this.ctx,s=this.save,id=this.villageId,units=villageUnits(s,id),troops=units.reduce((sum,u)=>sum+u.troops,0)
    // 本村驻军与分出留村的部队，缩进排在上级下面（含正在本村设施或田地工作的分队）。
    const roster=lineagePages(lineageRows(villageLocalUnits(s,id)),3),pages=roster.length;this.villagePage=Math.min(this.villagePage||0,pages-1)
    text(c,'驻军 '+units.length+' 支 / '+troops.toLocaleString()+' 人 · '+(troops?'守护本村乡亲':'尚未派驻保护部队'),312,277,22,troops?C.olive:C.gold,700)
    const rule=populationRule(id)
    text(c,rule.name+' · 村民 '+villagePopulation(s,id)+' / '+rule.cap+' 人',312,309,16,C.muted)
    this.button('village-station',312,335,180,38,'调入驻军',()=>this.open('village-station'),'accent')
    this.button('village-training',508,335,180,38,trainingTaskAt(s,id)?'查看本村训练':'训练本村驻军',()=>{this.localVillage=id;this.open('training')},'light')
    this.button('village-fields',704,335,180,38,'查看周边田地',()=>{this.openWorldMap();focusCamera(this.mapCamera,mapLocation(id))},'light')
    this.button('village-recruitment',900,335,225,38,'发动群众',()=>{this.localVillage=id;this.open('recruitment')},'accent')
    roster[this.villagePage].forEach(({unit,depth},i)=>{
      const y=391+i*48,busy=formationActivity(s,unit.id,true),x=rosterRowX(depth)
      box(c,x,y,1125-x,40,C.raised,2,C.line);text(c,unitName(unit),x+15,y+20,depth?17:20,C.ink,700)
      text(c,unit.troops.toLocaleString()+' 人 · 可派 '+availableWorkforce(s,unit.id),533,y+20,14,C.olive,600)
      if(!units.includes(unit)){
        text(c,busy?activityLabel(busy):'待命中 · 可在大地图调往他处',715,y+20,15,busy?C.gold:C.muted)
        if(!busy&&unit.splitParent!==undefined)this.button('village-rejoin-'+unit.id,1025,y+5,100,30,'合回上级',()=>this.combineBranch(unit),'accent')
        return
      }
      text(c,busy?activityLabel(busy):'驻防保护中',654,y+20,14,busy?C.gold:C.muted)
      if(!busy){
        this.button('village-edit-'+unit.id,733,y+5,92,30,'修改编制',()=>this.editFormation(unit,true),'accent')
        if(garrisonSplitTypes(s,unit).length)this.button('village-split-'+unit.id,833,y+5,92,30,'分出部队',()=>this.openGarrisonSplit(unit.id,'village'),'light')
        else if(unit.splitParent!==undefined)this.button('village-rejoin-'+unit.id,833,y+5,92,30,'合回上级',()=>this.combineBranch(unit),'accent')
        this.button('village-transfer-'+unit.id,933,y+5,92,30,'转移驻地',()=>this.openGarrisonTransfer(unit.id,villageRegionId(id)),'accent')
      }
      this.button('village-recall-'+unit.id,1033,y+5,92,30,'撤回驻军',()=>{
        const result=recallGarrison(s,id,unit.id);if(!result.ok){this.notify(result.message);return}
        this.persist()
        if(!villageUnits(s,id).length)this.openWorldMap()
        this.notify(result.message)
      },'light')
    })
    if(!units.length)text(c,'暂无驻军，点击“调入驻军”选择空闲的独立部队。',312,435,18,C.muted)
    if(pages>1){this.button('village-prev',312,540,100,30,'上一页',()=>{this.villagePage=Math.max(0,this.villagePage-1)},'light');this.button('village-next',428,540,100,30,'下一页',()=>{this.villagePage=Math.min(pages-1,this.villagePage+1)},'light');text(c,(this.villagePage+1)+' / '+pages,553,555,14,C.muted)}
    const armory=s.facilityVillages.armory
    if(armory===id){
      this.button('village-armory',312,582,255,36,'进入本村兵工厂',()=>this.manageVillageArmory(),'dark')
      this.button('village-transfer-armory',591,582,255,36,'转移兵工厂',()=>this.openArmoryTransfer(),'accent')
      this.button('village-remove-armory',870,582,255,36,'拆除兵工厂',()=>this.confirmArmoryRemoval(),'light')
    }else if(armory===null)this.button('village-armory',312,582,393,36,'将兵工厂设在本村',()=>this.manageVillageArmory(),'dark')
    else if(!armoryTransferError(s,id))this.button('village-transfer-armory',312,582,393,36,'将兵工厂迁入本村',()=>this.openArmoryTransfer(id),'dark')
    this.button('village-back',312,632,230,30,'返回大地图',()=>this.openWorldMap(),'light')
    if(s.baseVillageId!=null&&s.baseVillageId!==id)this.button('village-relocate-base',886,632,239,30,'设为根据地中心',()=>this.openBaseRelocation(id),'accent')
  }
  openGarrisonSplit(unitId,source='village'){
    const unit=this.save.formations.find(u=>u.id===unitId),types=garrisonSplitTypes(this.save,unit)
    if(!unit||!types.length){this.notify('当前部队不可再分出更低级编制');return}
    this.garrisonSplitId=unitId;this.garrisonSplitSource=source
    this.garrisonSplitType=types[types.length-1].id;this.garrisonSplitTroops=types[types.length-1].min
    this.open('garrison-split')
  }
  drawGarrisonSplit(){
    const c=this.ctx,s=this.save,unit=s.formations.find(u=>u.id===this.garrisonSplitId),types=garrisonSplitTypes(s,unit)
    if(!unit||!types.length){this.modal=this.garrisonSplitSource||'village';return}
    const kind=types.find(k=>k.id===this.garrisonSplitType)||types[types.length-1]
    this.garrisonSplitType=kind.id
    const max=Math.min(kind.max,unit.troops-1)
    this.garrisonSplitTroops=Math.max(kind.min,Math.min(max,this.garrisonSplitTroops||kind.min))
    text(c,`从 ${unitName(unit)}（${unit.troops}人）分出一支所属分队 · 原驻军保留 ${unit.troops-this.garrisonSplitTroops} 人`,312,282,18,C.ink,700)
    text(c,'选择分出编制（须低于原编制）',312,324,14,C.muted)
    types.forEach((k,i)=>this.button('gsplit-type-'+k.id,312+i*128,346,116,38,k.name,()=>{this.garrisonSplitType=k.id;this.garrisonSplitTroops=k.min},k.id===kind.id?'accent':'light'))
    text(c,`分出人数：${kind.min}—${max} 人（按比例带走配枪和训练经验）`,312,414,14,C.muted)
    this.button('gsplit-minus',312,442,56,40,'−',()=>{this.garrisonSplitTroops=Math.max(kind.min,this.garrisonSplitTroops-1)},'light')
    this.button('gsplit-count',380,442,270,40,this.garrisonSplitTroops+' 人 · 点击输入',()=>wx.showModal({title:'设置分出人数',editable:true,content:String(this.garrisonSplitTroops),placeholderText:`输入 ${kind.min}—${max} 人`,maxLength:5,inputLabel:'分出人数',numberLabel:'分出人数',confirmText:'确认',numberInput:true,minValue:kind.min,maxValue:max,success:r=>{
      if(!r.confirm)return
      const n=Number(String(r.content??'').trim())
      if(!Number.isInteger(n)||n<kind.min||n>max){this.notify(`人数须为 ${kind.min}—${max} 的整数`);return}
      this.garrisonSplitTroops=n;this.dirty=true
    }}),'dark')
    this.button('gsplit-plus',662,442,56,40,'＋',()=>{this.garrisonSplitTroops=Math.min(max,this.garrisonSplitTroops+1)},'light')
    const mid=Math.floor((kind.min+max)/2)
    ;[kind.min,mid,max].filter((v,i,a)=>a.indexOf(v)===i).forEach((v,i)=>this.button('gsplit-preset-'+v,736+i*126,442,116,40,v+' 人',()=>{this.garrisonSplitTroops=v},this.garrisonSplitTroops===v?'accent':'light'))
    text(c,'分出的新部队处于空闲待命状态，可直接派去作战、占领或驻防其他村庄。',312,516,14,C.olive)
    this.button('gsplit-back',312,615,230,42,'取消返回',()=>{this.modal=this.garrisonSplitSource||'village'},'light')
    this.button('gsplit-confirm',565,615,560,42,`确认分出 ${kind.name}（${this.garrisonSplitTroops} 人）`,()=>{
      const result=splitGarrisonUnit(s,unit.id,kind.id,this.garrisonSplitTroops)
      if(!result.ok){this.notify(result.message);return}
      const source=this.garrisonSplitSource||'village'
      if(source==='campaign-deploy'){
        const region=mapRegion(this.deploymentRegionId),combat=!region||regionEnemyTroops(s,region.id)>0
        this.deploymentIds=[...(this.deploymentIds||[]).filter(id=>id!==unit.id),result.unit.id]
        this.revealDispatchedUnit('deployment',dispatchRows(s,combat,!!region&&combat),result.unit.id)
      }else if(source==='village-station'){
        this.stationSelected=[...(this.stationSelected||[]),result.unit.id]
        this.revealDispatchedUnit('station',dispatchRows(s,false),result.unit.id)
      }
      this.persist();this.modal=source;this.notify(`已分出 ${unitName(result.unit)}（${result.unit.troops}人），现已待命`)
    },'accent')
  }
  revealDispatchedUnit(prefix,rows,id){
    const filtered=filterDispatchRows(rows,this[prefix+'Tier']),index=filtered.findIndex(row=>row.unit.id===id)
    if(index<0)return
    const collapsed=this[prefix+'Collapsed']||=new Set()
    let depth=filtered[index].depth
    for(let i=index-1;i>=0&&depth>0;i--)if(filtered[i].depth<depth){
      collapsed.delete(filtered[i].unit.id);depth=filtered[i].depth
    }
    const visible=visibleRosterRows(filtered,collapsed),top=visible.findIndex(row=>row.unit.id===id)*DISPATCH_ROW_HEIGHT
    const key=prefix+'Scroll',offset=this[key]||0
    this[key]=Math.min(top,Math.max(offset,top+DISPATCH_CARD_HEIGHT-DISPATCH_VIEW.h))
  }
  drawVillageStation(){
    const c=this.ctx,s=this.save,id=this.villageId,rows=dispatchRows(s,false)
    const {ids,total:troops}=dispatchSelection(rows,this.stationSelected)
    text(c,'向'+villageName(id)+'调入保护部队',312,275,21,C.ink,700)
    this.drawDispatchList('station',rows,ids,troops,'village-station',unitId=>{
      if(formationActivity(s,unitId)){this.notify('部队已有驻地或正在执行任务，请先召回');return}
      this.stationSelected=this.stationSelected.includes(unitId)?this.stationSelected.filter(key=>key!==unitId):[...this.stationSelected,unitId]
    },'可以派无枪编制，合编部队包含其下属。')
    this.button('station-back',312,615,230,42,this.villageStationFromMap?'返回大地图':'返回村庄',()=>this.villageStationFromMap?this.openWorldMap():this.openVillage(id),'light')
    this.button('station-confirm',565,615,560,42,ids.length?'出发行军 · '+number(troops)+' 人':'请选择调入部队',()=>{
      const current=dispatchSelection(rows,this.stationSelected).ids
      if(!current.length){this.notify('请先选择要调入的部队');return}
      const result=startMarch(s,'village',id,current);if(!result.ok){this.notify(result.message);return}
      this.persist();this.openWorldMap();this.notify(result.message)
    },ids.length?'accent':'light')
  }
  setFacilityStaffing(adding=false){
    this.addingFacilityStaff=adding;this.facilitySelected=[];this.facilityPage=0;this.dirty=true
  }
  drawFacilityPicker(stationed=null,limit=Infinity){
    const c=this.ctx,s=this.save,roots=stationed||(this.localVillage?villageLocalUnits(s,this.localVillage):formationRoots(s))
    const roster=lineagePages(lineageRows(roots),3),pages=roster.length
    this.facilityPage=Math.min(this.facilityPage||0,pages-1)
    const chosen=this.facilitySelected||[]
    roster[this.facilityPage].forEach(({unit,depth},i)=>{
      const x=rosterRowX(depth),y=410+i*45,busy=formationActivity(s,unit.id,!!stationed||!!this.localVillage),selected=chosen.includes(unit.id)
      box(c,x,y,1125-x,37,selected?'#31432d':C.raised,2,selected?C.olive:C.line)
      text(c,(selected?'☑ ':'☐ ')+unitName(unit),x+15,y+19,depth?16:18,C.ink,600)
      text(c,unit.troops+' 人'+(unit.children?' · 包含全部下属':''),580,y+19,15,C.muted)
      text(c,busy?activityLabel(busy):'可派驻',1108,y+19,14,busy?C.gold:C.olive,500,'right')
      this.buttons.push({id:'facility-unit-'+unit.id,x,y,w:1125-x,h:37,fn:()=>{
        if(busy){this.notify('该部队正在执行任务，请先召回归队');return}
        const current=this.facilitySelected||[]
        if(current.includes(unit.id))this.facilitySelected=current.filter(id=>id!==unit.id)
        else if(current.length<limit)this.facilitySelected=[...current,unit.id]
        else this.notify(`本次最多可选 ${limit} 支部队`)
      }})
    })
    if(!roots.length)text(c,this.localVillage?'本村暂无驻军，请先返回村庄调入部队。':'暂无独立编制，请先到我的部队组建。',312,462,19,C.muted)
    if(pages>1){
      this.button('facility-prev',312,554,100,29,'上一页',()=>{this.facilityPage=Math.max(0,this.facilityPage-1)},'light')
      this.button('facility-next',428,554,100,29,'下一页',()=>{this.facilityPage=Math.min(pages-1,this.facilityPage+1)},'light')
    }
    const workers=roots.filter(unit=>chosen.includes(unit.id)).reduce((sum,unit)=>sum+unit.troops,0)
    text(c,'已选 '+chosen.length+(Number.isFinite(limit)?' / '+limit:'')+' 支 · '+workers+' 人',pages>1?552:312,576,14,C.muted)
    return workers
  }
  openWorkDispatch(kind,id){
    if(!isVillage(id))return
    this.workKind=kind;this.workVillage=id;this.workPage=0;this.workPlan=[];this.workReturn=kind==='farm'?'farm':'base-armory';this.modal='work-dispatch';this.dirty=true
  }
  returnWorkDispatch(){this.modal=this.workReturn;this.dirty=true}
  drawWorkDispatch(){
    const c=this.ctx,s=this.save,units=villageLocalUnits(s,this.workVillage)
    const armoryTask=this.workKind==='armory'?s.armoryTasks[this.factoryProduct||'rifle']:null
    const roster=lineagePages(lineageRows(units)),pages=roster.length
    this.workPage=Math.min(this.workPage||0,pages-1)
    text(c,'从'+villageName(this.workVillage)+(this.workKind==='farm'?'本地部队':'驻军')+'中选择',312,277,22,C.ink,700)
    text(c,'派出编制和人数另行设置，原部队留村，人员不会复制。',312,309,16,C.muted)
    roster[this.workPage].forEach(({unit,depth},i)=>{
      const x=rosterRowX(depth),y=335+i*50,free=availableWorkforce(s,unit.id),planned=this.workPlan.find(a=>a.unitId===unit.id)
      const alreadyAssigned=armoryTask?.unitIds.includes(unit.id)
      box(c,x,y,1125-x,42,C.raised,2,C.line);text(c,unitName(unit),x+15,y+21,depth?17:20,C.ink,700)
      text(c,'可派 '+free+' 人'+(planned?' · 已选 '+planned.troops+' 人':' / 共 '+unit.troops+' 人'),580,y+21,16,C.olive)
      this.button('work-root-'+unit.id,979,y+5,132,30,alreadyAssigned?'已在本产线':planned?'调整派遣':free?'选择原部队':'暂无余员',()=>{
        if(alreadyAssigned){this.notify('这支部队已在本产线工作');return}
        if(this.workKind==='armory'&&!planned&&this.workPlan.length+(armoryTask?.unitIds.length??0)>=PROJECT_UNIT_LIMIT){this.notify(`每条产线最多派 ${PROJECT_UNIT_LIMIT} 支部队`);return}
        if(!free){this.notify('该部队人员已派完或正在训练');return}
        this.workUnitId=unit.id;this.workType=planned?.type||'group';this.workCount=planned?.troops||(free<=12?Math.max(1,Math.ceil(free/2)):7);this.modal='work-config'
      },free&&!alreadyAssigned?'accent':'light')
    })
    if(!units.length)text(c,'本村暂无驻军，请先返回村庄调入部队。',312,420,20,C.muted)
    if(pages>1){this.button('work-prev',312,550,100,30,'上一页',()=>{this.workPage=Math.max(0,this.workPage-1)},'light');this.button('work-next',428,550,100,30,'下一页',()=>{this.workPage=Math.min(pages-1,this.workPage+1)},'light')}
    const workers=this.workPlan.reduce((n,a)=>n+a.troops,0)
    text(c,'已选 '+this.workPlan.length+' 支分队 / '+workers+' 人 · '+(this.workKind==='farm'?'完工得粮 '+number(helpHarvestYield(workers))+' 份':'可继续选择其他原部队'),312,591,16,C.olive)
    this.button('work-back',312,615,230,42,'返回任务',()=>this.returnWorkDispatch(),'light')
    this.button('work-submit',565,615,560,42,'确认派遣名单 · '+workers+' 人',()=>this.submitWork(this.workPlan),this.workPlan.length?'accent':'light')
  }
  workRange(){
    const type=DUTY_TYPES.find(t=>t.id===this.workType)||DUTY_TYPES[0]
    return {min:type.min,max:Math.min(type.max,availableWorkforce(this.save,this.workUnitId))}
  }
  inputWorkCount(){
    const range=this.workRange()
    if(range.max<range.min){this.notify('可派人数不足，请改选临时分队');return}
    wx.showModal({title:'设置派遣人数',editable:true,content:String(this.workCount),inputLabel:'派遣人数',numberLabel:'派遣人数',numberInput:true,minValue:range.min,maxValue:range.max,maxLength:8,confirmText:'确认人数',success:r=>{
      if(!r.confirm)return;const count=Number(r.content?.trim())
      if(!Number.isInteger(count)||count<range.min||count>this.workRange().max){this.notify('人数不在可派范围内');return}this.workCount=count;this.dirty=true
    }})
  }
  drawWorkConfig(){
    const c=this.ctx,unit=this.save.formations.find(u=>u.id===this.workUnitId)
    if(!unit){text(c,'原部队已不存在，请返回重选',312,300,22,C.red);this.button('work-back',312,615,230,42,'返回重选',()=>{this.modal='work-dispatch'},'light');return}
    const free=availableWorkforce(this.save,unit.id),types=dutyTypes(unit),range=this.workRange()
    text(c,unitName(unit)+' · 原编制 '+unit.troops+' 人 · 可派 '+free+' 人',312,276,23,C.ink,700)
    text(c,'驻村是一个班时，选临时分队可只挑几个人去帮忙，其余留村；班、排等沿用对应人数区间。',312,310,15,C.muted)
    if(this.workPlan.some(a=>a.unitId===unit.id))this.button('work-remove',940,294,185,30,'移出派遣名单',()=>{this.workPlan=this.workPlan.filter(a=>a.unitId!==unit.id);this.modal='work-dispatch'},'light')
    types.forEach((type,i)=>this.button('work-type-'+type.id,312+i%4*208,329+Math.floor(i/4)*37,191,30,type.name,()=>{
      if(free<type.min){this.notify('人数不足，'+type.name+'至少需要 '+type.min+' 人');return}
      this.workType=type.id;this.workCount=Math.max(type.min,Math.min(this.workCount,type.max,free))
    },this.workType===type.id?'accent':'light'))
    this.button('work-minus',312,454,60,42,'−',()=>{this.workCount=Math.max(range.min,this.workCount-1)},'light')
    this.button('work-count',384,454,669,42,'派出 '+this.workCount+' 人 · 点击输入',()=>this.inputWorkCount(),'dark')
    this.button('work-plus',1065,454,60,42,'＋',()=>{this.workCount=Math.min(range.max,this.workCount+1)},'light')
    text(c,'本次范围 '+range.min+'—'+range.max+' 人 · 派出后可留用 '+Math.max(0,free-this.workCount)+' 人',312,531,18,C.olive,600)
    text(c,'原部队名称、总人数、武器和经验保留；任务结束自动回到原部队。',312,573,15,C.muted)
    this.button('work-back',312,615,230,42,'返回重选',()=>{this.modal='work-dispatch'},'light')
    const plan=()=>[...this.workPlan.filter(a=>a.unitId!==unit.id),{unitId:unit.id,troops:this.workCount,type:this.workType}]
    this.button('work-add',565,615,250,42,'加入名单 · 继续选',()=>{
      if(this.workCount<range.min||this.workCount>this.workRange().max){this.notify('派遣人数不在可用范围内');return}
      this.workPlan=plan();this.modal='work-dispatch'
    },'light')
    this.button('work-confirm',831,615,294,42,'确认派遣',()=>this.submitWork(plan()),'accent')
  }
  submitWork(allocations){
    const ids=allocations.map(a=>a.unitId),s=this.save;let result
    if(this.workKind==='farm'){const field=mapField(this.farmFieldId);result=startFarming(s,'help',0,field?.crop||'millet',ids,field?.id||null,allocations)}
    else result=startProduction(s,ids,this.factoryProduct||'rifle',this.workVillage,allocations)
    if(!result.ok){this.notify(result.message);return}
    if(this.workKind==='armory')this.setFacilityStaffing()
    this.persist();this.returnWorkDispatch();this.notify('已派出 '+allocations.length+' 支分队 / '+allocations.reduce((n,a)=>n+a.troops,0)+' 人，余员继续留守')
  }
  workNames(task){return task.allocations?task.allocations.map(a=>unitName(this.save.formations.find(u=>u.id===a.unitId))+'派出'+(DUTY_TYPES.find(t=>t.id===a.type)?.name||'分队')+' '+a.troops+'人').join('、'):task.unitIds.map(id=>unitName(this.save.formations.find(u=>u.id===id))).join('、')}
  drawActiveWorkerList(task,prefix,pageKey,onStop,pageRight=1125){
    const c=this.ctx,s=this.save,ids=task.unitIds||[],pages=Math.max(1,Math.ceil(ids.length/3))
    this[pageKey]=Math.min(this[pageKey]||0,pages-1)
    if(pages>1){
      text(c,`${this[pageKey]+1}/${pages}`,pageRight-46,483,12,C.muted,500,'center')
      this.button(prefix+'-prev',pageRight-92,470,26,24,'‹',()=>{this[pageKey]=Math.max(0,this[pageKey]-1)},'light')
      this.button(prefix+'-next',pageRight-26,470,26,24,'›',()=>{this[pageKey]=Math.min(pages-1,this[pageKey]+1)},'light')
    }
    ids.slice(this[pageKey]*3,this[pageKey]*3+3).forEach((uid,i)=>{
      const unit=s.formations.find(u=>u.id===uid);if(!unit)return
      const y=502+i*31,workers=taskWorkersFrom(task,uid,unit)
      box(c,312,y,813,27,C.raised,2,C.line)
      text(c,unitName(unit),326,y+14,15,C.ink,600)
      text(c,`${workers} 人`,540,y+14,14,C.olive,600)
      this.button(`${prefix}-stop-${uid}`,1015,y+2,102,23,'停止工作',()=>onStop(uid),'light')
    })
  }
  drawFacilityTask(kind,task,product,slots=0){
    const c=this.ctx,s=this.save,running=facilityRunning(s,kind)&&!hungerStatus(s).disabled
    const waiting=Object.entries(product.recipe).some(([id,cost])=>s.materials[id]<cost)?'材料不足，等待补充':'仓库空间不足，等待出库'
    text(c,'派驻 '+task.workers+' 人 · '+(hungerStatus(s).disabled?'极度饥饿，工作暂停':running?'工作进行中':waiting),312,425,21,running?C.olive:C.gold,700)
    box(c,312,455,813,10,C.line,3);box(c,312,455,813*task.elapsed/FACILITY_INTERVAL,10,C.olive,3)
    text(c,'本轮进度 '+Math.floor(task.elapsed)+' / '+FACILITY_INTERVAL+' 秒',312,484,15,C.muted)
    this.drawActiveWorkerList(task,'facility-unit','facilityTaskPage',uid=>{
      if(recallFacility(s,kind,uid)){this.facilitySelected=[];this.facilityPage=0;this.persist();this.notify(`已停止该部队生产${product.name}`)}
    })
    this.button('facility-recall',565,615,slots?315:560,42,`结束${product.name}生产`,()=>{
      if(recallFacility(s,kind)){this.facilitySelected=[];this.facilityPage=0;this.persist();this.notify(`已结束${product.name}生产`)}
    },'light')
  }
  drawArmory(){
    const c=this.ctx,s=this.save,id=this.factoryProduct||'rifle',product=PRODUCTS.find(p=>p.id===id),task=s.armoryTasks[id]
    const deployed=task?.unitIds.length??0,slots=Math.max(0,PROJECT_UNIT_LIMIT-deployed),adding=task&&this.addingFacilityStaff&&slots>0
    const gap=13,width=(813-(PRODUCTS.length-1)*gap)/PRODUCTS.length
    PRODUCTS.forEach((p,i)=>{
      const x=312+i*(width+gap)
      this.button('factory-product-'+p.id,x,257,width,40,p.name,()=>{
        if(p.id===id)return
        this.factoryProduct=p.id;this.setFacilityStaffing()
      },p.id===id?'accent':'light')
      if(s.armoryTasks[p.id])circle(c,x+width-10,264,4,C.olive)
    })
    const unit=product.unit,batch=product.batchSize||1,minutes=FACILITY_INTERVAL/60
    const rate=product.batchesPerCycle?`每条产线最多产 ${product.batchesPerCycle*batch} ${unit}`:`每 ${product.workers} 人产 ${batch} ${unit}`
    text(c,`每 ${minutes} 分钟 · ${rate}`,312,324,17,C.ink,600)
    text(c,deployed>PROJECT_UNIT_LIMIT?`已派 ${deployed} 支`:`已派 ${deployed} / ${PROJECT_UNIT_LIMIT} 支`,1125,324,15,C.olive,600,'right')
    text(c,`${product.name}库存 ${number(productionInventory(s,product))} · ${batch===1?'单件':`每 ${batch} ${unit}`}消耗 ${recipeLabel(product)} · 仓库矿石 ${number(s.materials.ore)} / 木头 ${number(s.materials.wood)}`,312,355,16,C.muted)
    if(task&&!adding){
      text(c,`按当前库存预计本轮可产 ${productionCapacity(s,product,task.cycleWorkers??task.workers)} ${unit}，各项目共用材料`,312,387,16,C.gold)
      this.drawFacilityTask(id,task,product,slots)
      if(slots)this.button('facility-add',895,615,230,42,'加派部队',()=>this.setFacilityStaffing(true),'accent')
    }else{
      text(c,adding?`可再派 ${slots} 支。本轮已开始时，新部队从下轮计入产量。`:'每种产品可派最多 5 支部队，各项目单独计时。',312,386,15,C.muted)
      if(this.localVillage)this.button('facility-detach',900,367,225,30,'派遣部分驻军',()=>this.openWorkDispatch('armory',this.localVillage),'accent')
      const workers=this.drawFacilityPicker(null,slots)
      this.button('facility-start',565,615,560,42,adding?`确认加派 · ${workers} 人`:`派驻生产 · 本轮可产 ${productionCapacity(s,product,workers)} ${unit}`,()=>{
        const result=startProduction(s,[...this.facilitySelected],id,this.localVillage||null)
        if(!result.ok){this.notify(result.message);return}
        this.setFacilityStaffing();this.persist();this.notify(adding?`已加派 ${workers} 人生产${product.name}`:`部队已驻厂，有材料时每 ${minutes} 分钟结算生产`)
      },'accent')
    }
    this.button('base-return',312,615,230,42,adding?'取消加派':this.localVillage?'返回村庄':'返回大地图',()=>adding?this.setFacilityStaffing():this.returnToVillage(),'light')
  }
  dispatchFarm(field,workers,unitIds=null){
    const result=startFarming(this.save,'help',workers,field.crop,unitIds,field.id)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.notify('部队已出发，抵达田地后开始耕作')
  }
  inputFarmReserve(field){
    const available=farmReserveAvailable(this.save)
    if(!available){this.notify('根据地暂无可派的未编人员');return}
    wx.showModal({title:'派未编人员代耕',editable:true,content:String(Math.min(30,available)),
      numberInput:true,minValue:1,maxValue:available,inputLabel:'派遣人数',numberLabel:'派遣人数',confirmText:'派出代耕',
      success:result=>{if(result.confirm)this.dispatchFarm(field,Number(result.content))}
    })
  }
  drawFarm(){
    const c=this.ctx,s=this.save,task=farmTaskAt(s,this.farmFieldId),kind=task?.type||'help'
    const field=mapField(task?.fieldId||this.farmFieldId)
    const homeField=field?.villageId===s.baseVillageId,units=field?farmLocalUnits(s,field.villageId):[]
    const selected=units.filter(unit=>this.farmSelected.includes(unit.id))
    const count=selected.reduce((sum,unit)=>sum+unit.troops,0)
    const population=field&&populationRule(field.villageId),recruits=population?population.min+'—'+population.max:5
    box(c,312,257,813,42,C.raised,2,C.line)
    text(c,field?field.name+' · 帮乡亲耕种':task?.type==='self'?'原有耕作任务 · 完成后归队':'帮助乡亲耕田',330,278,21,C.olive,700)
    text(c,kind==='help'?'完工得粮：出工人数 × 30%，向下取整；随机发谷子、大米、苞谷。':'原有自耕任务完成后归队。',312,325,15,C.muted)
    if(!task&&field){
      if(!homeField||villageLocalUnits(s,field.villageId).length)this.button('farm-detach',800,308,325,34,'★ 只派几个人（选本村部队）',()=>this.openWorkDispatch('farm',field.villageId),'accent')
      if(homeField){
        const available=farmReserveAvailable(s)
        this.button('farm-source-reserve',800,346,325,34,'派未编人员 · 可派 '+available+' 人',()=>this.inputFarmReserve(field),available?'accent':'light')
      }
    }
    text(c,'每轮 '+FARM.duration+' 秒 · '+hungerStatus(s).label,312,351,15,C.olive,600)
    if(!task&&field)text(c,homeField?'可派留守部队或未编人员代耕。':`可派${villageName(field.villageId)}驻军及留村待命的分队。`,312,380,16,C.ink)
    if(task){
      const travelling=task.phase&&task.phase!=='working',returning=task.phase==='returning'
      const remaining=travelling?Math.ceil((farmRouteLength(task)-task.travelled)/(FARM_TRAVEL_SPEED*hungerStatus(s).speedMultiplier)):Math.ceil(FARM.duration-task.elapsed)
      const progress=travelling?Math.min(1,task.travelled/(farmRouteLength(task)||1)):task.elapsed/FARM.duration
      text(c,(returning?'返村归队中':travelling?'正在前往田地':(task.type==='help'?'代耕':'自耕')+'进行中')+' · '+task.workers+' 人'+(!travelling&&hungerStatus(s).disabled?' · 饥饿暂停':''),312,423,24,C.ink,700)
      box(c,312,452,813,10,C.line,4);box(c,312,452,813*progress,10,C.olive,4)
      const names=task.unitIds?this.workNames(task):'未编人员'
      text(c,'派出：'+names.slice(0,45)+' · 剩余 '+remaining+' 秒',312,490,17,C.muted)
      text(c,returning?'抵达'+villageName(task.villageId)+'后'+(task.unitIds?'归入原部队':'恢复为可用的未编人员')+'，返程中仍占用派出人数':task.type==='help'?'完工：得粮 '+number(helpHarvestYield(task.workers))+' 份 · 减耗 '+task.workers+' 批 · 报名 '+recruits+' 人':'预计收获 '+CROPS.find(crop=>crop.id===task.crop).name+' '+task.workers*FARM.grainPerWorker+' 份',312,523,17,C.gold,600)
      this.button('farm-cancel',312,554,310,36,returning?'正在返回本村':'召回归队 · 本轮不发奖励',()=>{
        if(cancelFarming(s,this.farmFieldId)){this.persist();this.notify(farmTaskAt(s,this.farmFieldId)?.phase?'代耕人员开始返村':'已召回归队，可以执行其他任务')}
      },'light')
    }else if(field){
        const roster=lineagePages(lineageRows(units),3),pages=roster.length;this.farmPage=Math.min(this.farmPage||0,pages-1)
        roster[this.farmPage].forEach(({unit,depth},i)=>{
          const x=rosterRowX(depth),y=405+i*38,busy=formationActivity(s,unit.id,true),chosen=this.farmSelected.includes(unit.id),armed=Object.values(unit.weapons).reduce((a,b)=>a+b,0)
          box(c,x,y,1125-x,32,chosen?'#3c4e30':C.raised,2,chosen?C.olive:C.line)
          text(c,(chosen?'☑ ':'☐ ')+unitName(unit),x+15,y+16,depth?16:17,C.ink,600)
          text(c,unit.troops+' 人 · 配枪 '+armed+' 把',580,y+16,14,C.muted)
          text(c,busy?activityLabel(busy):'可派出',1108,y+16,14,busy?C.gold:C.olive,600,'right')
          this.buttons.push({id:'farm-unit-'+unit.id,x,y,w:1125-x,h:32,fn:()=>{
            if(busy){this.notify('该部队正在执行任务，请等待归队');return}
            this.farmSelected=chosen?this.farmSelected.filter(id=>id!==unit.id):[...this.farmSelected,unit.id]
          }})
        })
        if(!units.length)text(c,homeField?'暂无可选的留守编制。':'本村暂无驻军，请先派部队到本村驻扎。',312,454,17,C.muted)
        if(pages>1){this.button('farm-prev',312,522,100,25,'上一页',()=>{this.farmPage=Math.max(0,this.farmPage-1)},'light');this.button('farm-next',428,522,100,25,'下一页',()=>{this.farmPage=Math.min(pages-1,this.farmPage+1)},'light')}
        text(c,'已选 '+selected.length+' 支 / '+count+' 人 · 部队同一时间只能执行一项任务',pages>1?550:312,537,14,C.muted)
      text(c,'预计得粮 '+number(helpHarvestYield(count))+' 份 · 减耗 '+count+' 批 · 完工报名 '+recruits+' 人',312,573,16,C.gold)
      if(!homeField||units.length)this.button('farm-start',565,615,560,42,'派出代耕 · '+count+' 人',()=>this.dispatchFarm(field,count,[...this.farmSelected]),count?'accent':'light')
    }else{
      text(c,'请在大地图选择本村田地，再安排驻军代耕。',720,455,20,C.muted,500,'center')
    }
    this.button('farm-back',312,615,230,42,this.farmReturnToMap?'返回大地图':'返回根据地',()=>this.returnFromFarm(),'light')
    if(task)this.button('farm-kitchen',895,615,230,42,'前往灶房',()=>this.open('kitchen'),'light')
  }
  drawEmptyInventory(){
    const c=this.ctx
    icon(c,'warehouse',720,413,52,C.muted)
    text(c,'暂无此类库存',720,480,25,C.ink,600,'center')
    text(c,'可前往商城购买补给',720,521,17,C.muted,400,'center')
  }
  drawFormation(){
    const c=this.ctx,s=this.save,f=formation(s),number=v=>v.toLocaleString()
    const stats=[['总兵力',f.troops,C.ink],['已编人数',f.assignedTroops,C.olive],['未编人数',f.unassignedTroops,C.muted],['持枪人数',f.armedTroops,C.gold]]
    stats.forEach(([label,value,color],i)=>{
      const x=312+i*208;box(c,x,257,189,68,C.raised,2,C.line)
      text(c,label,x+15,275,14,C.muted);text(c,number(value),x+15,306,27,color,700)
    })
    const roots=formationPool(s),orphans=orphanBranches(s)
    FORMATION_TYPES.forEach((kind,i)=>{
      const units=roots.filter(u=>u.type===kind.id),x=312+(i%4)*208,y=345+Math.floor(i/4)*113
      box(c,x,y,189,100,C.raised,2,units.length?C.olive:C.line)
      text(c,kind.name,x+17,y+24,29,C.ink,700);text(c,`${units.length} 支`,x+171,y+28,23,units.length?C.olive:C.muted,700,'right')
      text(c,`${number(units.reduce((sum,u)=>sum+u.troops,0))} 人`,x+17,y+68,18,C.muted,600)
      this.buttons.push({id:'formation-category-'+kind.id,x,y,w:189,h:100,fn:()=>this.openFormationList(kind.id)})
    })
    const food=orphans.length?'':` · 熟食 ${rationStock(s)} 份 / 每次需 ${mealCost(s)} 份`
    text(c,`正式编制 ${roots.length} 支 · 耕作 ${farmWorkers(s)} 人 · ${hungerStatus(s).label} · 缺餐 ${hungerStatus(s).debt.toFixed(1)}/3${food}`,312,584,15,hungerStatus(s).disabled?C.red:C.muted)
    if(orphans.length)this.button('formation-orphan-roster',950,567,175,32,`待归属分队 ${orphans.length}`,()=>this.openFormationList(ORPHAN_ROSTER),'light')
    this.button('formation-add',312,610,185,40,'添加编制',()=>this.editFormation(),'accent')
    this.button('formation-merge',513,610,185,40,'组建上级',()=>this.openFormationMerge(),'light')
    this.button('formation-food',723,610,185,40,'去灶房做饭',()=>this.open('kitchen'),'light')
    this.button('formation-shop',940,610,185,40,'补充武器',()=>this.open('shop'),'light')
    text(c,`武器总数 ${number(f.totalWeapons)} 把 · 缺弹或无枪的士兵使用近战`,312,662,14,C.muted)
  }
  openFormationList(type){
    if(type!==this.formationListType){this.formationListScroll=0;this.formationListCollapsed=new Set()}
    this.formationListType=type;this.modal='formation-list';this.dirty=true
  }
  drawFormationBreadcrumb(unit=null){
    const chain=[],seen=new Set()
    for(let current=unit;current&&!seen.has(current.id);current=formationRosterParent(this.save,current)){
      seen.add(current.id);chain.unshift(current)
    }
    const top=chain[0],type=top?.splitParent!==undefined?ORPHAN_ROSTER:top?.type||this.formationListType
    const kind=FORMATION_TYPES.find(v=>v.id===type),label=kind?kind.name+'级部队':type===ORPHAN_ROSTER?'待归属分队':null
    const crumbs=[{label:'我的部队',fn:()=>this.open('formation')}]
    if(label)crumbs.push({label,fn:()=>this.openFormationList(type)})
    chain.forEach(item=>crumbs.push({label:unitName(item),fn:()=>this.openFormationChildren(item,this.formationDetailFromVillage)}))
    let x=312,y=265
    crumbs.forEach((crumb,i)=>{
      const w=Array.from(crumb.label).length*15+18
      if(x+w>1125){x=312;y+=25}
      text(this.ctx,crumb.label,x,y,15,i===crumbs.length-1?C.olive:C.muted,600)
      this.buttons.push({id:'formation-path-'+i,x,y:y-11,w:w-7,h:23,fn:crumb.fn})
      if(i<crumbs.length-1)text(this.ctx,'›',x+w-3,y,17,C.muted)
      x+=w+10
    })
  }
  drawFormationList(){
    const c=this.ctx,s=this.save,kind=FORMATION_TYPES.find(v=>v.id===this.formationListType)
    const units=kind?formationPool(s).filter(unit=>unit.type===kind.id):orphanBranches(s)
    const collapsed=this.formationListCollapsed||=new Set(),rows=visibleRosterRows(formationRosterRows(s,units),collapsed)
    this.drawFormationBreadcrumb()
    text(c,kind?`${kind.name}级部队 · ${units.length} 支`:`原上级已不在编 · ${units.length} 支分队`,312,317,25,C.ink,700)
    if(kind)this.button('formation-list-add',940,296,185,39,'添加'+kind.name,()=>{this.editFormation();this.formationDraft.type=kind.id;this.formationDraft.troops=kind.id==='squad'&&this.save.troops>0&&this.save.troops<7?this.save.troops:kind.min;this.formationDraft.weapons=autoFormationWeapons(this.save,this.formationDraft.troops)},'accent')
    if(!units.length){icon(c,'formation',720,426,46,C.muted);text(c,kind?'暂无此类独立部队':'暂无待归属分队',720,485,24,C.ink,600,'center');if(kind)text(c,'下属和分队请从所属上级查看',720,527,16,C.muted,400,'center')}
    const scrollable=this.drawScrollableRoster({source:'formation-list',key:'formationListScroll',view:FORMATION_LIST_VIEW,rows,rowHeight:58,cardHeight:50},({unit,depth,indent,hasChildren,folded},y,right)=>{
      const x=FORMATION_LIST_VIEW.x+indent,activity=formationActivity(s,unit.id),branch=unit.splitParent!==undefined
      const shortage=unit.troops<FORMATION_TYPES.find(type=>type.id===unit.type).min
      box(c,x,y,right-x,50,C.raised,2,C.line)
      if(hasChildren){
        text(c,folded?'▸':'▾',x+16,y+25,18,C.olive,700)
        this.buttons.push({id:'formation-collapse-'+unit.id,x,y,w:990-x,h:50,fn:()=>{
          if(folded)collapsed.delete(unit.id)
          else collapsed.add(unit.id)
        }})
      }
      text(c,unitName(unit),x+38,y+25,depth?18:23,C.ink,700)
      text(c,`${unit.troops.toLocaleString()} 人`,545,y+25,22,C.olive,700)
      const status=activity?activityLabel(activity):shortage?(unit.battleDamaged?'战损欠编':'欠编'):unit.children?`下属 ${unit.children.length} 支部队`:branch?'待命':'独立编制'
      text(c,branch?'分队 · '+status:status,740,y+25,17,shortage?C.gold:C.muted)
      this.button('formation-view-'+unit.id,1000,y+7,109,36,'查看',()=>this.openFormationChildren(unit),'light')
    })
    this.button('formation-list-back',312,615,185,39,'返回总览',()=>this.open('formation'),'light')
    const listHint=[scrollable?'上下滑动':'',rows.some(row=>row.hasChildren)?'点击上级名称展开或收起':''].filter(Boolean).join(' · ')
    if(listHint)text(c,listHint,1125,635,14,C.muted,500,'right')
  }
  editFormation(unit=null,fromVillage=false){
    const busy=unit?formationEditActivity(this.save,unit.id):null
    if(busy){this.notify(`部队${activityLabel(busy)}，结束当前任务后才能修改`);return}
    if(unit?.children){this.openFormationChildren(unit,fromVillage);return}
    const initial=this.save.troops>0&&this.save.troops<7?this.save.troops:7
    this.formationDraft=unit?{...unit,baseTroops:unit.troops,baseWeapons:{...unit.weapons},reinforcements:0,weaponAuto:true,weapons:{...unit.weapons}}:{id:null,type:'squad',troops:initial,weapons:autoFormationWeapons(this.save,initial)}
    this.formationReturnId=unit?.id
    this.formationEditorFromVillage=fromVillage
    this.formationError='';this.modal='formation-edit';this.dirty=true
  }
  returnFormationEditor(){
    const unit=this.save.formations.find(u=>u.id===this.formationReturnId)
    if(this.formationEditorFromVillage&&(!unit||!formationParent(this.save,unit.id)))this.modal='village'
    else if(unit)this.openFormationChildren(unit,this.formationEditorFromVillage)
    else if(this.formationListType)this.openFormationList(this.formationListType)
    else this.open('formation')
  }
  openFormationChildren(unit,fromVillage=false){this.formationDetailId=unit.id;this.formationDetailPage=0;this.formationDetailFromVillage=fromVillage;this.modal='formation-detail';this.dirty=true}
  combineBranch(unit){
    const result=rejoinFormation(this.save,unit.id)
    if(!result.ok){this.notify(result.message);return}
    if(this.modal==='formation-detail')this.openFormationChildren(result.parent,this.formationDetailFromVillage)
    this.persist();this.notify(result.message)
  }
  releaseFormation(unit){
    const result=unmergeFormation(this.save,unit.id)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.open('formation');this.notify(`已解除合编，${unit.children.length} 支下属部队恢复原编制，人员武器保留`)
  }
  openFormationMerge(){this.mergeType='squad';this.mergeSelected=[];this.mergePage=0;this.mergeError='';this.modal='formation-merge';this.dirty=true}
  drawFormationMerge(){
    const c=this.ctx,s=this.save,index=FORMATION_TYPES.findIndex(v=>v.id===this.mergeType),next=FORMATION_TYPES[index+1]
    text(c,'选择三支独立的同级部队，组建上一级编制。',312,265,17,C.ink,600)
    FORMATION_TYPES.slice(0,-1).forEach((kind,i)=>{
      this.button('merge-type-'+kind.id,312+i*116,284,105,38,kind.name,()=>{this.mergeType=kind.id;this.mergeSelected=[];this.mergePage=0;this.mergeError=''},kind.id===this.mergeType?'accent':'light')
    })
    const candidates=formationPool(s).filter(u=>u.type===this.mergeType),pages=Math.max(1,Math.ceil(candidates.length/4))
    this.mergePage=Math.max(0,Math.min(this.mergePage||0,pages-1))
    const page=this.mergePage,selected=this.mergeSelected.map(id=>s.formations.find(u=>u.id===id)).filter(Boolean)
    if(!candidates.length){
      box(c,312,341,468,207,C.raised,2,C.line);icon(c,'formation',546,401,44,C.muted)
      text(c,`暂无独立的${FORMATION_TYPES[index].name}级部队`,546,457,21,C.ink,600,'center')
      text(c,'先添加部队，或解除已有合编。',546,496,15,C.muted,400,'center')
    }
    candidates.slice(page*4,page*4+4).forEach((unit,i)=>{
      const y=341+i*51,checked=this.mergeSelected.includes(unit.id)
      box(c,312,y,468,45,C.raised,2,checked?C.olive:C.line)
      text(c,unitName(unit),328,y+23,21,C.ink,700);text(c,`${unit.troops.toLocaleString()} 人`,465,y+23,19,C.olive,600)
      this.button('merge-select-'+unit.id,666,y+5,99,35,checked?'已选择':'选择',()=>{
        if(checked)this.mergeSelected=this.mergeSelected.filter(id=>id!==unit.id)
        else if(this.mergeSelected.length<3)this.mergeSelected.push(unit.id)
        else{this.mergeError='最多选择三支部队，请先取消一支';return}
        this.mergeError=''
      },checked?'accent':'light')
    })
    if(pages>1){
      this.button('merge-prev',312,558,114,34,'上一页',()=>{this.mergePage=Math.max(0,page-1)},'light')
      text(c,`${page+1} / ${pages}`,490,576,16,C.muted,500,'center')
      this.button('merge-next',551,558,114,34,'下一页',()=>{this.mergePage=Math.min(pages-1,page+1)},'light')
    }
    const troops=selected.reduce((sum,u)=>sum+u.troops,0)
    box(c,798,341,327,251,C.raised,2,C.line)
    text(c,`合编预览 · 已选 ${selected.length} / 3`,818,365,18,C.ink,700)
    text(c,`${next.name} · ${troops.toLocaleString()} 人`,818,402,27,C.olive,700)
    text(c,`合编无人数下限 · 上限 ${next.max.toLocaleString()} 人`,818,433,14,C.muted)
    WEAPONS.forEach((w,i)=>text(c,`${w.name}：${selected.reduce((sum,u)=>sum+u.weapons[w.id],0)} 把`,818,460+i*24,15,w.color,600))
    const preview=previewFormationMerge(s,this.mergeSelected),message=this.mergeError||(!preview.ok?preview.message:'合编不设人数下限，原部队和武器配置完整保留。')
    text(c,message,312,606,15,this.mergeError||(selected.length===3&&!preview.ok)?C.red:C.muted)
    this.button('merge-cancel',312,625,185,37,'返回编制',()=>this.open('formation'),'light')
    this.button('merge-confirm',940,625,185,37,'确认合编',()=>{
      const result=mergeFormations(s,this.mergeSelected)
      if(!result.ok){this.mergeError=result.message;return}
      this.persist();this.openFormationChildren(result.unit);this.notify(`${unitName(result.unit)}已组建，兵力与武器不重复计算`)
    },'accent')
  }
  drawFormationChildren(){
    const c=this.ctx,s=this.save,unit=s.formations.find(u=>u.id===this.formationDetailId),parent=formationParent(s,unit.id)
    const rosterParent=formationRosterParent(s,unit)
    const children=(unit.children||[]).map(id=>s.formations.find(child=>child.id===id))
    const branches=s.formations.filter(child=>child.id!==unit.id&&child.splitParent===unit.id&&!unit.children?.includes(child.id)).sort((first,second)=>first.number-second.number)
    const related=[...children,...branches]
    const activity=formationActivity(s,unit.id),stationed=activity==='garrison'||activity==='region',fromVillage=this.formationDetailFromVillage
    this.drawFormationBreadcrumb(unit)
    const status=trainingStatus(s,unit.id)
    const occupied=formationOccupancy(s,unit.id),maximum=FORMATION_TYPES.find(kind=>kind.id===unit.type).max
    const stats=[[occupied>unit.troops?'本队人数':'总人数',unit.troops],occupied>unit.troops?['编制占用（含分队）',`${number(occupied)} / ${number(maximum)}`]:['直属部队',related.length],['训练水平',status.name]]
    stats.forEach(([label,value],i)=>{const x=312+i*278;box(c,x,301,257,69,C.raised,2,C.line);text(c,label,x+16,320,14,C.muted);text(c,value.toLocaleString(),x+16,351,27,C.olive,700)})
    box(c,312,388,488,200,C.raised,2,C.line);text(c,branches.length?(children.length?'直属部队与分队':'所属分队'):children.length?'直属部队':'部队信息',331,411,19,C.ink,700)
    if(related.length){
      const pages=Math.ceil(related.length/3),page=Math.min(this.formationDetailPage||0,pages-1)
      this.formationDetailPage=page
      related.slice(page*3,page*3+3).forEach((child,i)=>{
        const branch=branches.includes(child),x=branch?341:326,y=430+i*41
        box(c,x,y,786-x,36,C.panel,2,C.line);text(c,unitName(child),x+12,y+18,branch?16:20,C.ink,700)
        text(c,`${number(child.troops)} 人`,515,y+18,16,C.olive,700)
        text(c,branch?'分队':child.children?`下属${child.children.length}支`:'无下属',610,y+18,13,C.muted)
        this.button('child-view-'+child.id,686,y+3,87,30,'查看',()=>this.openFormationChildren(child,fromVillage),'light')
      })
      if(pages>1){
        this.button('formation-detail-prev',326,555,93,27,'上一页',()=>{this.formationDetailPage=Math.max(0,page-1)},'light')
        text(c,`${page+1} / ${pages}`,556,569,14,C.muted,500,'center')
        this.button('formation-detail-next',680,555,93,27,'下一页',()=>{this.formationDetailPage=Math.min(pages-1,page+1)},'light')
      }
    }
    else{
      icon(c,'army',555,465,45,C.olive);text(c,unitName(unit),555,520,29,C.ink,700,'center')
      text(c,`训练经验 ${status.average}/${status.nextXp??600} · 火力 +${Math.round(status.bonus*100)}%`,555,557,16,C.muted,500,'center')
    }
    box(c,819,388,306,200,C.raised,2,C.line);text(c,'武器配置',839,411,19,C.ink,700)
    WEAPONS.forEach((w,i)=>{text(c,w.name,839,445+i*28,16,C.muted);text(c,`${unit.weapons[w.id].toLocaleString()} 把`,1105,445+i*28,18,w.color,600,'right')})
    const branchHint=unit.splitParent!==undefined?(rosterParent?`由${unitName(rosterParent)}分出 · 只在所属上级下列出。`:'原上级已不在编 · 可在待归属分队查看。'):null
    text(c,stationed?`${activityLabel(activity)}：${unit.children?'选择下属部队补员或调整配发。':'可就地补员或调整配发。'}`:activity?activityLabel(activity)+'：结束当前任务后才能修改、配发、解散或执行其他任务。':parent?`隶属于${unitName(parent)}，人员与武器已计入上级。`:branchHint|| (unit.children?`解除合编将恢复 ${unit.children.length} 支部队，人员武器保持原样。`:unit.troops<FORMATION_TYPES.find(kind=>kind.id===unit.type).min?'欠编部队：保留实际人数，可修改编制补充未编人员。':'可在此修改人数、分配武器或解散部队。'),312,608,14,C.muted)
    this.button('children-back',312,625,185,37,rosterParent?'返回上级':fromVillage?'返回村庄':'返回分类',()=>{
      if(rosterParent)this.openFormationChildren(rosterParent,fromVillage)
      else if(fromVillage)this.openVillage(this.villageId)
      else this.openFormationList(unit.splitParent!==undefined?ORPHAN_ROSTER:unit.type)
    },'light')
    if(!parent&&unit.splitParent!==undefined&&rosterParent)this.button('formation-rejoin',513,625,185,37,'合回上级',()=>this.combineBranch(unit),'accent')
    else if(!parent)this.button('formation-train',513,625,185,37,'前往训练',()=>{this.trainingSelectedId=unit.id;this.open('training')},'light')
    if(unit.children){if(!parent)this.button('children-release',940,625,185,37,'解除合编',()=>this.releaseFormation(unit),'accent')}
    else{
      this.button('formation-detail-edit',734,625,185,37,'修改编制',()=>this.editFormation(unit,fromVillage),'accent')
      if(!parent)this.button('formation-detail-remove',940,625,185,37,'解散部队',()=>{
        if(removeFormation(s,unit.id)){
          this.persist()
          if(rosterParent)this.openFormationChildren(rosterParent,fromVillage)
          else this.openFormationList(unit.splitParent!==undefined?ORPHAN_ROSTER:unit.type)
          this.notify('部队已解散，人员和武器名额已释放')
        }else this.notify('部队正在执行任务，归队后才能解散')
      },'light')
    }
  }
  inputFormationTroops(){
    const draft=this.formationDraft,kind=FORMATION_TYPES.find(v=>v.id===draft.type),minimum=formationMinimum(this.save,draft.type,draft.id)
    if(draft.id!==null){
      const space=reinforcementCapacity(this.save,draft.id)
      if(!space){this.notify('当前编制已变化，请重新选择部队');return}
      wx.showModal({title:`补充兵力（现有 ${draft.baseTroops} 人，最多补 ${space.capacity} 人）`,editable:true,content:String(draft.reinforcements),placeholderText:'输入本次新增人数，不含原有士兵',maxLength:8,inputLabel:'补员人数',numberLabel:'补员人数',confirmText:'确认补员人数',numberInput:true,minValue:0,maxValue:space.capacity,success:r=>{
        if(!r.confirm)return
        const value=r.content?.trim()||''
        if(!/^\d+$/.test(value)){this.formationError='补员人数必须为非负整数';this.dirty=true;return}
        this.setFormationReinforcements(Number(value))
      }})
      return
    }
    wx.showModal({title:`设置${kind.name}人数（${minimum}—${kind.max}）`,editable:true,content:String(draft.troops),placeholderText:'输入整数人数',maxLength:8,inputLabel:'编制人数',confirmText:'确认人数',numberInput:true,minValue:minimum,maxValue:kind.max,maxAvailable:formationResources(this.save,draft.id).troops,success:r=>{
      if(!r.confirm)return
      const value=r.content?.trim()||'',troops=Number(value)
      if(!/^\d+$/.test(value)||!Number.isInteger(troops)||troops<minimum||troops>kind.max){this.formationError=`${kind.name}人数必须为 ${minimum}—${kind.max} 之间的整数`;this.dirty=true;return}
      draft.troops=troops;this.formationError='';this.dirty=true
    }})
  }
  setFormationReinforcements(count){
    const draft=this.formationDraft,validation=validateReinforcement(this.save,draft.id,count,null,draft.baseTroops)
    if(!validation.ok){this.formationError=validation.message;this.dirty=true;return}
    draft.reinforcements=count;draft.troops=draft.baseTroops+count
    if(draft.weaponAuto)draft.weapons=reinforcementWeapons(this.save,draft.id,count)
    this.formationError='';this.dirty=true
  }
  inputFormationWeapon(weapon){
    const draft=this.formationDraft,available=formationResources(this.save,draft.id).weapons[weapon.id]
    wx.showModal({title:`分配${weapon.name}（可用 ${available} 把）`,editable:true,content:String(draft.weapons[weapon.id]),placeholderText:'输入调整后的总配发数量，0为全部卸下',maxLength:8,inputLabel:'武器总数量',confirmText:'确认分配',numberInput:true,numberLabel:'武器总数量',minValue:0,maxValue:available,success:r=>{
      if(!r.confirm)return
      const value=r.content?.trim()||'',count=Number(value)
      if(!/^\d+$/.test(value)||!Number.isInteger(count)||count<0||count>available){this.formationError=`${weapon.name}最多可分配 ${available} 把`;this.dirty=true;return}
      draft.weapons[weapon.id]=count;draft.weaponAuto=false;this.formationError='';this.dirty=true
    }})
  }
  drawFormationEditor(){
    const c=this.ctx,draft=this.formationDraft,kind=FORMATION_TYPES.find(v=>v.id===draft.type),available=formationResources(this.save,draft.id)
    const minimum=formationMinimum(this.save,draft.type,draft.id),existing=draft.id!==null,space=existing?reinforcementCapacity(this.save,draft.id):null
    if(existing&&!space){
      text(c,'当前编制已变化，请返回重新选择部队。',312,293,20,C.muted)
      this.button('formation-cancel',312,621,185,37,'返回',()=>this.returnFormationEditor(),'light')
      return
    }
    const weaponStock=available.weapons
    if(existing){
      box(c,312,254,813,88,C.raised,2,C.line)
      text(c,`${unitName(draft)} · 补员与配发`,332,282,25,C.ink,700)
      const detached=space.assigned-space.current
      text(c,detached?`本队 ${number(space.current)} 人 + 分队 ${number(detached)} 人 · 已占 ${number(space.assigned)} / ${number(kind.max)} 人`:'原有士兵与训练经验保留，新增人员从未编人员中调入。',332,318,16,C.muted)
      text(c,`${kind.name}上限 ${kind.max} 人`,1105,282,20,C.olive,600,'right')
    }else FORMATION_TYPES.forEach((item,i)=>{
      const x=312+(i%4)*208,y=254+Math.floor(i/4)*52,selected=item.id===draft.type
      box(c,x,y,189,46,selected?'#546c3c':C.raised,2,selected?C.olive:C.line)
      text(c,item.name,x+17,y+15,20,C.ink,700)
      text(c,`${formationMinimum(this.save,item.id).toLocaleString()}—${item.max.toLocaleString()} 人`,x+17,y+35,13,C.muted)
      this.buttons.push({id:'formation-type-'+item.id,x,y,w:189,h:46,fn:()=>{
        if(formationParent(this.save,draft.id)&&item.id!==draft.type){this.formationError='已编入上级的部队不能改变类型，请先解除合编';return}
        draft.type=item.id;draft.troops=item.id==='squad'&&this.save.troops>0&&this.save.troops<7?this.save.troops:item.min;this.formationError=''
      }})
    })
    text(c,existing?`现有 ${draft.baseTroops} 人 · 本次最多补 ${space.capacity} 人 · ${kind.name}上限 ${kind.max} 人`:`设置${kind.name}人数 · 允许 ${minimum.toLocaleString()}—${kind.max.toLocaleString()} 人`,312,373,18,C.ink,700)
    this.button('formation-minus',312,390,70,46,'−',()=>{if(existing)this.setFormationReinforcements(Math.max(0,draft.reinforcements-1));else{draft.troops=Math.max(minimum,draft.troops-1);this.formationError=''}},'light')
    this.button('formation-count',398,390,641,46,existing?`补充 ${draft.reinforcements} 人 → 本队 ${draft.troops} 人 · 点击输入`:`${draft.troops.toLocaleString()} 人 · 点击输入`,()=>this.inputFormationTroops(),'dark')
    this.button('formation-plus',1055,390,70,46,'＋',()=>{if(existing)this.setFormationReinforcements(draft.reinforcements+1);else{draft.troops=Math.min(kind.max,draft.troops+1);this.formationError=''}},'light')
    const reinforcementHint=existing&&space.limiting.id!==draft.id?` · ${space.limiting.name}占用 ${number(space.limiting.assigned)} / ${number(space.limiting.maximum)} 人（含分队）`:''
    text(c,existing?`可用未编人员：${space.personnel} 人${reinforcementHint}`:`可用未编人员：${available.troops.toLocaleString()} 人`,312,454,15,draft.troops>available.troops?C.red:C.muted)
    const allocated=Object.values(draft.weapons).reduce((sum,n)=>sum+n,0)
    text(c,`配发 ${allocated} 把 · 未配 ${draft.troops-allocated} 人（可卸下原有武器）`,312,481,17,C.ink,700)
    box(c,980,460,145,29,C.raised,2,C.line);text(c,'自动配齐',1052,475,17,C.olive,600,'center')
    this.buttons.push({id:'formation-auto',x:980,y:460,w:145,h:29,fn:()=>{draft.weapons=autoFormationWeapons(this.save,draft.troops,draft.id);draft.weaponAuto=true;this.formationError=''}})
    this.button('formation-unarmed',819,460,145,29,existing?'全部卸下':'暂不配枪',()=>{draft.weapons=Object.fromEntries(WEAPONS.map(weapon=>[weapon.id,0]));draft.weaponAuto=false;this.formationError=''},'light')
    WEAPONS.forEach((w,i)=>{
      const x=312+i*166,y=494,count=draft.weapons[w.id],stock=weaponStock[w.id]
      box(c,x,y,149,88,C.raised,2,count?C.olive:C.line)
      text(c,w.name,x+12,y+16,18,C.ink,700)
      text(c,`可用 ${stock.toLocaleString()} 把`,x+12,y+38,13,C.muted)
      box(c,x+7,y+51,30,30,C.panel,2,C.line);text(c,'−',x+22,y+66,20,C.ink,600,'center')
      box(c,x+112,y+51,30,30,C.panel,2,C.line);text(c,'＋',x+127,y+66,20,C.ink,600,'center')
      text(c,String(count),x+74,y+67,count>9999?13:20,w.color,700,'center')
      this.buttons.push({id:'formation-weapon-minus-'+w.id,x:x+7,y:y+51,w:30,h:30,fn:()=>{draft.weapons[w.id]=Math.max(0,count-1);draft.weaponAuto=false;this.formationError=''}})
      this.buttons.push({id:'formation-weapon-count-'+w.id,x:x+39,y:y+51,w:71,h:30,fn:()=>this.inputFormationWeapon(w)})
      this.buttons.push({id:'formation-weapon-plus-'+w.id,x:x+112,y:y+51,w:30,h:30,fn:()=>{draft.weapons[w.id]=Math.min(stock,count+1);draft.weaponAuto=false;this.formationError=''}})
    })
    const validation=existing?validateReinforcement(this.save,draft.id,draft.reinforcements,draft.weapons,draft.baseTroops,true):validateFormation(this.save,draft.type,draft.troops,draft.id,draft.weapons),warning=this.formationError||(!validation.ok?validation.message:'')
    text(c,warning||(existing?'数量为最终总配发，可用数含原配。卸下武器回到可分配库存。':'每人最多配备一把武器。无枪士兵出战时使用近战。'),312,603,15,warning?C.red:C.muted)
    this.button('formation-cancel',312,621,185,37,'取消',()=>this.returnFormationEditor(),'light')
    this.button('formation-save',940,621,185,37,draft.id===null?'创建编制':draft.reinforcements?'确认补员':'保存修改',()=>{
      const result=existing?reinforceFormation(this.save,draft.id,draft.reinforcements,draft.weapons,draft.baseTroops,true):setFormation(this.save,draft.type,draft.troops,draft.id,draft.weapons)
      if(!result.ok){this.formationError=result.message;return}
      this.persist();if(draft.id===null)this.openFormationList(draft.type);else this.returnFormationEditor();this.notify(draft.id===null?'编制已创建':draft.reinforcements?`已补充 ${draft.reinforcements} 人，现有 ${draft.troops} 人`:'部队配发已更新')
    },'accent')
  }
  drawGoods(type){
    const c=this.ctx,s=this.save,category=this.inventoryTab
    const inventory=type==='shop'?GOODS:[...GOODS,FISH]
    const items=inventory.filter(item=>item.category===category&&(type==='shop'?shopSells(item.id):s[item.id]>0))
    if(category==='materials'){
      const stocked=MATERIALS.filter(material=>s.materials[material.id]>0)
      if(!stocked.length)text(c,'暂无采集材料',720,435,25,C.ink,700,'center')
      stocked.forEach((material,i)=>{
        const x=312+(i%2)*420,y=312+Math.floor(i/2)*80
        box(c,x,y,393,73,C.raised,2,C.line);icon(c,material.terrain,x+30,y+35,29,MAP_TERRAIN_STYLES[material.terrain].color)
        text(c,material.name,x+58,y+22,21,C.ink,700);text(c,`库存 ${number(s.materials[material.id])} 份`,x+58,y+51,16,C.olive,600)
      })
      text(c,'山地采集矿石 · 树林采集木头或干草 · 先派部队进驻采集点',312,655,15,C.muted)
      return
    }
    if(category==='dishes'){
      DISHES.forEach((dish,i)=>{
        const x=312+(i%2)*420,y=312+Math.floor(i/2)*80
        box(c,x,y,393,73,C.raised,2,C.line);icon(c,dish.icon,x+30,y+34,29,C.gold)
        text(c,dish.name,x+58,y+21,20,C.ink,700);text(c,`库存 ${s[dish.id]} 份`,x+58,y+51,15,C.olive,600)
        text(c,dish.recipe,x+380,y+21,12,C.muted,500,'right')
      })
      text(c,`熟食库存 ${rationStock(s)} 份 · 部队每次需 ${mealCost(s)} 份`,312,577,16,rationStock(s)<mealCost(s)?C.red:C.olive,600)
      text(c,'部队每 5 分钟从这里取饭，生食要先在灶房做成饭；熟食不可购买。',312,655,14,C.muted)
      this.button('dishes-kitchen',940,600,185,38,'去灶房做饭',()=>this.open('kitchen'),'accent')
      return
    }
    if(category==='logistics'){
      if(!items.length){icon(c,'grain',720,410,55,C.gold);text(c,'暂无食品库存',720,469,25,C.ink,600,'center');text(c,'采购后可送给乡亲，或送进灶房做成饭。',720,510,16,C.muted,400,'center')}
      items.forEach((item,i)=>{
        const x=312+(i%2)*420,y=312+Math.floor(i/2)*80
        box(c,x,y,393,73,C.raised,2,C.line);icon(c,item.icon,x+30,y+34,29,C.gold)
        text(c,item.name,x+58,y+21,20,C.ink,700);text(c,type==='shop'?`持有 ${s[item.id]} · 待售 ${shopAvailable(s,item.id)} 份`:`库存 ${s[item.id]} 份`,x+58,y+51,13,C.olive,600)
        if(item.id===FISH.id)text(c,'河流捕获 · 灶房加工',x+380,y+35,13,C.muted,500,'right')
        if(type==='shop'){const q=purchaseQuote(s,item);this.button('buy-'+item.id,x+220,y+24,159,34,q.amount?`${q.cost}金币 / ${q.amount}份`:'已售罄',()=>this.buyShopItem(item),q.amount?'accent':'light')}
      })
      text(c,'生食送乡亲或送灶房 · 有支持10秒报名一批 · 本村规模决定每批人数',312,655,14,C.muted)
      return
    }
    if(!items.length)this.drawEmptyInventory()
    items.forEach((item,i)=>{
      const x=312+(i%2)*420,y=312+Math.floor(i/2)*109
      box(c,x,y,393,100,C.raised,2,C.line);icon(c,item.icon,x+40,y+33,34,category==='medical'?C.olive:C.gold)
      text(c,item.name,x+76,y+23,21,C.ink,700)
      text(c,item.desc,x+76,y+47,13,C.muted)
      text(c,type==='shop'?`持有 ${s[item.id]} · 待售 ${shopAvailable(s,item.id)} ${item.unit}`:`持有 ${s[item.id]} ${item.unit}`,x+16,y+78,14,C.olive,600)
      if(type==='shop'){const q=purchaseQuote(s,item);this.button('buy-'+item.id,x+218,y+58,161,34,q.amount?`${q.cost}金币/${q.amount}${item.unit}`:'已售罄',()=>this.buyShopItem(item),q.amount?'accent':'light')}
    })
    const hint=category==='ammo'?'步枪、手枪、轻机枪、狙击枪共用子弹，迫击炮使用炮弹。':'医疗包和绷带作为物资储备。'
    text(c,hint,312,655,15,C.muted)
  }
  drawModal(){
    const c=this.ctx,s=this.save,type=this.modal
    const detail=s.formations.find(u=>u.id===this.formationDetailId)
    const region=mapRegion(this.regionId)
    const names={raid:'驻地警报',region:region?.name+' · 地区情报',gathering:region?.name+(region?.type==='river'?' · 捕鱼':' · 材料采集'),'garrison-transfer':'确认转移驻地','garrison-split':'从驻军分出部队','work-dispatch':'选择原驻村部队','work-config':'设置派遣编制',village:villageName(this.villageId)+' · 村庄管理','village-station':villageName(this.villageId)+' · 调入驻军',campaign:'主线战役','campaign-deploy':'选择派遣部队','battle-split':'战场分遣',recruitment:'发动群众',kitchen:'灶房',base:'根据地',farm:'耕地',
      'base-armory':'兵工厂',training:'训练场','training-result':'训练完成',formation:'我的部队','formation-list':'分类部队','formation-merge':'组建上级 · 三合一','formation-detail':detail?unitName(detail)+' · 部队详情':'部队详情','formation-edit':this.formationDraft?.id==null?'添加编制':'修改编制',warehouse:'物资仓库',shop:'商城',army:'总指挥',tasks:'作战任务',settings:'指挥设置',pause:'战斗暂停',result:this.battle?.won?'行动成功':'战斗结束',retreat:'结束本次行动？'}
    box(c,270,130,900,550,C.panel,2,C.line);box(c,270,130,6,550,C.olive,0);brackets(c,270,130,900,550,C.olive)
    const heading=type==='result'&&this.battle?.raidId?'驻地防守结果':type==='recruitment'?'发动群众 · 全部村庄':this.localVillage&&['training','base-armory'].includes(type)?villageName(this.localVillage)+' · '+names[type]:names[type]
    const dispatchSite=type==='campaign-deploy'&&mapRegion(this.deploymentRegionId)
    const dispatchHint=dispatchSite?`${REGION_KINDS[dispatchSite.type]} · ${regionRecord(s,dispatchSite.id).enemies.length?regionRecord(s,dispatchSite.id).enemies.slice(0,3).map(u=>`${u.name} ${u.troops.toLocaleString()}人`).join(' / '):'无敌军，可直接派驻占领'}`:null
    text(c,heading,312,179,30,C.ink,800);text(c,dispatchHint||(type==='shop'?this.shopRestockLabel():type==='farm'?'军民同心 · 完工后按出工人数分粮':type==='recruitment'?'军民同心 · 暂停乡亲物资补给':'FRONTLINE / COMMAND CENTER'),312,216,11,type==='shop'?C.gold:C.muted,500);line(c,312,242,1125,242,C.line)
    if(!['result','training-result'].includes(type))this.button('close',1080,157,48,44,'×',()=>{
      if(type==='work-dispatch')this.returnWorkDispatch()
      else if(type==='work-config')this.modal='work-dispatch'
      else if(type==='formation-edit')this.returnFormationEditor()
      else if(type==='formation-detail'&&this.formationDetailFromVillage)this.openVillage(this.villageId)
      else if(type==='campaign-deploy'){if(this.deploymentRegionId)this.openRegion(this.deploymentRegionId);else this.open('campaign')}
      else if(['formation-merge','formation-detail'].includes(type))this.open('formation')
      else if(type==='farm')this.returnFromFarm()
      else if(type==='gathering')this.openRegion(this.regionId)
      else if(type==='village')this.openWorldMap()
      else if(type==='village-station'){if(this.villageStationFromMap)this.openWorldMap();else this.openVillage(this.villageId)}
      else if(type==='garrison-split')this.modal=this.garrisonSplitSource||'village'
      else if(['base-armory','training','recruitment'].includes(type))this.returnToVillage()
      else this.modal=null
    },'light')
    if(type==='raid'){this.drawRaidDetail()
    }else if(type==='region'){this.drawRegion()
    }else if(type==='garrison-transfer'){this.drawGarrisonTransfer()
    }else if(type==='gathering'){this.drawGathering()
    }else if(type==='garrison-split'){this.drawGarrisonSplit()
    }else if(type==='work-dispatch'){this.drawWorkDispatch()
    }else if(type==='work-config'){this.drawWorkConfig()
    }else if(type==='village'){this.drawVillage()
    }else if(type==='village-station'){this.drawVillageStation()
    }else if(type==='formation'){
      this.drawFormation()
    }else if(type==='formation-list'){
      this.drawFormationList()
    }else if(type==='formation-merge'){
      this.drawFormationMerge()
    }else if(type==='formation-detail'){
      this.drawFormationChildren()
    }else if(type==='formation-edit'){
      this.drawFormationEditor()
    }else if(type==='battle-split'){
      this.drawBattleSplit()
    }else if(type==='campaign-deploy'){
      this.drawCampaignDeployment()
    }else if(type==='base'){this.drawBase()
    }else if(type==='farm'){this.drawFarm()
    }else if(type==='base-armory'){
      this.drawArmory()
    }else if(type==='training'){
      this.drawTrainingSelection()
    }else if(type==='recruitment'){
      this.drawRecruitment()
    }else if(type==='kitchen'){
      this.drawKitchen()
    }else if(type==='warehouse'||type==='shop'){
      const tabs=[['weapons','枪械区'],['ammo','弹药区'],['medical','医疗区'],['logistics','后勤区'],...(type==='warehouse'?[['dishes','熟食区'],['materials','材料区']]:[])]
      const step=type==='warehouse'?116:157,width=step-12
      tabs.forEach(([id,label],i)=>{
        this.button('tab-'+id,312+i*step,255,width,44,label,()=>{this.inventoryTab=id},this.inventoryTab===id?'accent':'light')
      })
      text(c,`金币 ${s.coins}`,1125,278,17,C.gold,600,'right')
      if(this.inventoryTab==='weapons'){this.drawWeapons(type);return}
      this.drawGoods(type)
    }else if(type==='army'){
      icon(c,'army',397,372,108,C.olive)
      text(c,s.name,510,346,30,C.ink,700)
      text(c,`部队兵力 ${number(s.troops)}    /    累计胜利 ${number(s.wins)}`,510,398,19,C.muted)
      this.button('rename',510,450,190,48,'修改名称',()=>this.rename(),'light')
    }else if(type==='tasks'){
      MISSIONS.forEach((m,i)=>{const y=270+i*112,done=s.claimed.includes(m.id),progress=missionProgress(s,m),ready=progress>=m.goal;icon(c,'tasks',345,y+40,30,C.olive);text(c,m.name,380,y+18,21,C.ink,700)
        const legacy=m.id==='hold'&&s.bestWave>=5&&s.recruitedTroops<m.goal
        text(c,legacy?'旧版坚守目标已完成，原奖励仍可领取':`${m.desc}  ${Math.min(progress,m.goal)} / ${m.goal}`,380,y+52,16,C.muted);text(c,`奖励 ${m.reward} 金币`,760,y+35,16,C.gold,600)
        this.button('claim-'+m.id,940,y+10,185,58,done?'已领取':ready?'领取奖励':'进行中',()=>{if(claim(s,m.id)){this.persist();this.notify(`获得 ${m.reward} 金币`)}else this.notify(done?'奖励已领取':'继续完成作战目标')},ready&&!done?'accent':'light');line(c,312,y+90,1125,y+90,C.line)})
    }else if(type==='settings'){
      ;[['effects','战斗特效','关闭爆炸粒子，减少画面开销'],['vibration','触感反馈','操作时的触感反馈'],['music','背景音乐','主界面播放军事进行曲，可随时关闭']].forEach(([key,label,sub],i)=>{const y=285+i*82;text(c,label,312,y,22,C.ink,700);text(c,sub,312,y+34,15,C.muted);this.button('toggle-'+key,935,y-14,190,56,s.settings[key]?'已开启':'已关闭',()=>{s.settings[key]=!s.settings[key];if(key==='music')setMusicEnabled(s.settings.music);this.persist()},s.settings[key]?'accent':'light')})
      text(c,'暂停游戏',312,531,22,C.ink,700);text(c,'停止推进一切时间，并锁定所有操作直到点击继续游戏',312,565,15,C.muted)
      this.button('settings-pause',935,517,190,56,'暂停游戏',()=>this.togglePause(),'gold')
      text(c,'进度自动保存在当前设备。战斗进行中退出不会保存战场。',312,612,15,C.muted);text(c,'指挥前线  /  原型版本 0.1.0',312,644,13,C.muted)
    }else if(type==='pause'){
      text(c,'部队正在等待你的下一道命令。',720,338,25,C.ink,600,'center');text(c,'离开战场会按当前战果结算。',720,393,17,C.muted,400,'center')
      this.button('resume',486,465,468,65,'继续战斗',()=>{this.modal=null},'accent');this.button('leave',486,548,468,60,'结束行动并结算',()=>this.open('retreat'),'light')
    }else if(type==='retreat'){
      const raid=this.battle.raidId
      text(c,raid&&!raidRepelled(this.battle)?'撤离后，存活的敌军会占领该据点。':'本次行动将结束，获得已击败敌军的战果奖励。',720,350,22,C.ink,600,'center');this.button('cancel',350,510,350,65,'继续作战',()=>{this.modal=null},'light');this.button('confirm-retreat',740,510,350,65,'结束并结算',()=>{this.battle.done=true;this.battle.won=!!raid&&raidRepelled(this.battle);this.finish()},'dark')
    }else if(type==='result'){
      const r=this.result,b=this.battle;icon(c,b.won?'flag':'shield',720,302,55,b.won?C.olive:C.gold)
      const outcome=b.raidId?`${b.regionName} · ${b.won?'已击退敌袭':r.raid?.occupied?'失守，敌军已占领':'未能击退敌袭，已结算战损'}`:b.regionId&&b.won?`${b.regionName}已占领，幸存部队留驻。`:b.won?'阵地已控制，行动目标达成。':'本次行动已结束，请整备后再战。'
      text(c,outcome,720,362,26,C.ink,700,'center');text(c,`歼敌 ${r.kills}${b.units?' 人':''}${b.raidId?`    ·    我方出战 ${number(b.maxHp)} 人`:`    ·    第 ${r.wave} 波`}    ·    ${Math.floor(b.time)} 秒`,720,410,18,C.muted,400,'center')
      text(c,`+ ${r.coins} 金币`,720,469,28,C.gold,700,'center')
      if(b.units)text(c,`我方伤亡 ${number(r.lostTroops)} 人`,720,515,17,r.lostTroops?C.red:C.muted,600,'center')
      if(b.mode==='campaign'){
        const captured=WEAPONS.filter(weapon=>r.capturedWeapons?.[weapon.id]>0).map(weapon=>`${weapon.name} ×${r.capturedWeapons[weapon.id]}`).join(' · ')
        text(c,captured?'缴获入库：'+captured:'本次无缴获武器',720,544,15,captured?C.olive:C.muted,600,'center')
      }
      this.button('home',312,563,280,65,'返回指挥部',()=>this.home(),'light')
      this.button('next',620,563,505,65,b.raidId?'查看驻地':b.regionId?'查看交战地区':b.won&&b.mode==='campaign'&&b.level<12?'进军下一关':'再次部署',()=>{
        if(b.raidId){
          const site=raidSite(b.raidSiteId)
          this.home()
          if(site?.type==='village')this.openVillage(site.id)
          else if(site)this.openRegion(site.id)
        }else if(b.regionId)this.openRegion(b.regionId)
        else this.start(b.mode,b.mode==='campaign'&&b.won?Math.min(12,b.level+1):b.level)
      },'accent','arrow')
    }else if(type==='training-result'){
      const r=this.trainingResult,after=r.after
      icon(c,'army',720,294,57,C.blue);text(c,`${r.name} · ${r.troops.toLocaleString()} 名士兵完成训练`,720,357,26,C.ink,700,'center')
      text(c,`获得 ${r.gained.toLocaleString()} 点士兵训练经验`,720,405,23,C.gold,700,'center')
      text(c,`${r.before.index===after.index?'训练等级：'+after.name:r.before.name+' → '+after.name} · 平均经验 ${after.average}/${after.nextXp??600}`,720,451,21,C.blue,700,'center')
      box(c,420,484,600,10,C.line,4);box(c,420,484,600*after.ratio,10,C.blue,4)
      text(c,after.nextName?`下一训练等级：${after.nextName}`:'已达到最高训练等级',720,521,16,C.muted,500,'center')
      this.button('training-home',312,580,280,62,'返回指挥部',()=>this.home(),'light')
      this.button('training-again',620,580,505,62,'返回训练场',()=>{this.home();this.open('training')},'accent')
    }
  }
}
