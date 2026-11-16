import { C,box,text,line,circle,icon,tank,poly,brackets,weaponArt,baseRegionMap,regionRoads,villageFields,mapFlag } from './art.js'
import { MAP_CORE,MAP_BOUNDS,MAP_VIEW,MAP_BASE,MAP_SITES,MAP_REGIONS,MAP_REGION_ROADS,REGION_KINDS,MAP_TERRAIN_STYLES,MAP_FLAG_COLORS,mapRegion,MAP_ROADS,MAP_TRAILS,MAP_FIELDS,mapField,mapLocation,mapMarkerScale,createCamera,mapToScreen,screenToMap,anchorCamera,zoomCamera,panCamera,fitCamera,focusCamera } from './world-map.js'
import {regionRecord,regionUnits,regionEnemyTroops,regionOwner,regionDispatch,occupyRegion,recallRegion,resolveRegionBattle} from './regions.js'
import { SAVE_KEY,MODES,GOODS,MISSIONS,FORMATION_TYPES,normalizeSave,rank,rankProgress,formation,formationName as unitName,formationRoots,formationParent,previewFormationMerge,mergeFormations,unmergeFormation,formationResources,autoFormationWeapons,formationMinimum,validateFormation,setFormation,removeFormation,garrisonSplitTypes,splitGarrisonUnit,purchase,purchaseWeapon,claim,settle,applyBattleLosses,applyWarehouseFoodAdjustment,applyRequestedRiceSupply } from './state.js'
import { WEAPONS,weaponById } from './weapons.js'
import { Battle } from './battle.js'
import { CampaignBattle,campaignDeployment } from './campaign.js'
import { reinforcementCapacity,reinforcementWeapons,validateReinforcement,reinforceFormation } from './state.js'
import { missionProgress } from './state.js'
import { FOODS,DISHES,RECRUITMENT,RATIONS,foodStock,rationStock,mealCost,recruitmentInterval,validateDonation,mobilizationStatus,donationTaste,validateCooking,cookDish,hungerStatus,recruitmentFoodCost,mobilizationRecord,migrateVillageMobilization,serveMealNow,enableAllVillageMobilization,setAllVillagesMobilizing,donateAllVillages } from './logistics.js'
import { TRAINING_XP,trainingDuration,trainingStatus,startTrainingTask,cancelTrainingTask,completeTraining,trainedCombatGroups,trainingTaskAt } from './training.js'
import {stationTroops,recallGarrison,placeVillageFacility,villageUnits,villageOfFormation,villageName,isVillage,villageControlled,controlledVillages,garrisonedVillages} from './villages.js'
import {availableWorkforce,dutyTypes,DUTY_TYPES} from './workforce.js'
import {populationRule,villagePopulation} from './population.js'
import { syncShop,purchaseQuote,shopAvailable } from './shop.js'
import { FARM,CROPS,farmWorkers,startFarming,cancelFarming,formationActivity,activityLabel,assignFormations,releaseFormations } from './base.js'
import { advanceEconomy } from './economy.js'
import {PRODUCTS,WARDS,facilityInterval,facilityRunning,startProduction,startTreatment,recallFacility,recoverPendingBattleCasualties} from './facilities.js'
import { initMusic,setMusicEnabled,updateMusic,unlockMusic,pumpMusic } from './music.js'
const inside=(p,b)=>p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h
const mapGarrisonLines=units=>{
  const lines=[]
  for(const unit of units){
    const name=`${unitName(unit)} ${unit.troops}人`,last=lines.length-1
    if(last>=0&&lines[last].length+name.length+1<=14)lines[last]+='、'+name
    else if(lines.length<2)lines.push(name)
    else{lines[1]=lines[1].split('、')[0]+'等'+units.length+'支';break}
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
    const recovered=!!stored&&recoverPendingBattleCasualties(this.save)
    const migrated=!!stored&&migrateVillageMobilization(this.save)
    const globalized=enableAllVillageMobilization(this.save)
    this.scene='world-map';this.mapSelected=MAP_BASE.id;this.mapCamera=createCamera();this.modal=null;this.buttons=[];this.dirty=true;this.toast=null;this.pressed=false;this.last=0;this.acc=0;this.training=null
    if(adjusted||supplied||recovered||migrated||stored&&globalized)this.persist()
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
  persist(){try{wx.setStorageSync(SAVE_KEY,this.save)}catch{this.notify('存档空间不可用，本次进度暂存于内存')}}
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
  cancelTouch(){this.pressed=false;this.mapGesture=null}
  touchMove(e){
    if(this.scene==='world-map'&&!this.modal){this.moveMapGesture(e);return}
    if(this.pressed&&this.scene==='battle'&&!this.modal&&!this.battle.units)this.command(e)
  }
  touchEnd(e){
    this.pressed=false
    if(this.scene!=='world-map'||this.modal||!this.mapGesture)return
    const gesture=this.mapGesture
    if(e?.touches?.length){this.beginMapGesture(e,true);return}
    this.mapGesture=null
    const p=this.point(e)||gesture.last
    if(gesture.type==='pan'&&!gesture.moved&&Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)<=8/(this.scale||1)){
      const b=[...this.buttons].reverse().find(b=>/^(map-site-|map-field-|map-region-)/.test(b.id)&&(inside(p,b)||b.flagHit&&inside(p,b.flagHit)))
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
  mouseWheel(e){
    if(this.scene!=='world-map'||this.modal)return false
    const p=this.inputPoint(e);if(!inside(p,MAP_VIEW))return false
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?586:1)
    if(!Number.isFinite(delta))return false
    this.mapGesture=null;zoomCamera(this.mapCamera,Math.exp(-Math.max(-500,Math.min(500,delta))*.0015),p);this.dirty=true;return true
  }
  touch(e){
    unlockMusic()
    const p=this.point(e);if(!p)return
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
  tick(now){
    pumpMusic()
    const activeElapsed=this.last?Math.min(60,Math.max(0,(now-this.last)/1000)):0
    const elapsed=Math.min(.05,activeElapsed);this.last=now
    if(this.logisticsActive)this.updateLogistics(activeElapsed)
    if(this.toast&&Date.now()>this.toast.until){this.toast=null;this.dirty=true}
    if(this.scene==='battle'&&!this.modal)this.updateBattle(elapsed)
    this.acc+=elapsed
    if(this.dirty&&(this.scene!=='battle'||this.acc>=1/60-.002)){this.render();this.acc=0;this.dirty=false}
    requestAnimationFrame(this.tick)
  }
  updateLogistics(seconds,random=Math.random){
    const previous=hungerStatus(this.save)
    const result=advanceEconomy(this.save,seconds,random)
    const facilityEvent=result.produced.length||result.treated.length||result.training
    if(result.training){this.trainingResult=result.training;this.training=null}
    const restocked=syncShop(this.save)
    const hunger=hungerStatus(this.save)
    this.syncBattleReadiness()
    this.logisticsSaveElapsed=(this.logisticsSaveElapsed||0)+seconds
    this.logisticsDrawElapsed=(this.logisticsDrawElapsed||0)+seconds
    if(result.recruited||result.meals||result.populationGrown||result.harvests.length||facilityEvent||restocked||((['village','recruitment','farm','base-armory','base-medical','training'].includes(this.modal)&&this.logisticsDrawElapsed>=.2||this.modal==='shop'&&this.logisticsDrawElapsed>=1))){this.dirty=true;this.logisticsDrawElapsed=0}
    if(result.recruited||result.meals||result.harvests.length||facilityEvent||restocked||this.logisticsSaveElapsed>=5){this.persist();this.logisticsSaveElapsed=0}
    if(!previous.disabled&&hunger.disabled)this.notify('部队极度饥饿，火力和行动能力下降，请及时供餐')
    else if(previous.disabled&&!hunger.disabled)this.notify('部队已进食，恢复正常战斗效果')
    else if(result.training)this.notify(result.training.name+'训练完成 · 获得 '+result.training.gained+' 点经验'+(result.training.villageId?'，继续在'+villageName(result.training.villageId)+'驻防':'，已自动归队'))
    else if(result.harvests.length)this.notify(result.harvests[0].type==='help'?'代耕完成 · 新兵 +'+result.harvests[0].recruited+' · 粮食收成全部留给乡亲':'自耕完成 · '+CROPS.find(crop=>crop.id===result.harvests[0].crop).name+' +'+result.harvests[0].amount+' 份')
    else if(result.recruited)this.notify(`乡亲报名 +${result.recruited} 人`)
    else if(result.produced.length)this.notify('兵工厂完工 · '+result.produced.map(item=>PRODUCTS.find(p=>p.id===item.product).name+' +'+item.amount).join(' · '))
    else if(result.treated.length)this.notify('本轮治疗完成 · 康复 '+result.treated.reduce((n,item)=>n+item.healed,0)+' 人 · 死亡 '+result.treated.reduce((n,item)=>n+item.dead,0)+' 人')
    else if(result.meals&&this.save.lastMealShortage>0)this.notify(`本餐还缺 ${this.save.lastMealShortage} 份熟食，请补充食材或到灶房做饭`)
  }
  open(name){
    if(name==='defense')name='recruitment'
    if(name==='campaign'){this.openWorldMap();return}
    if(name==='recruitment'&&enableAllVillageMobilization(this.save))this.persist()
    this.modal=name
    if(name==='village'){this.villagePage=0}
    if(name==='village-station'){this.stationSelected=[];this.stationPage=0}
    if(name==='warehouse'||name==='shop'){this.inventoryTab='weapons';this.goodsPage=0;if(name==='shop'&&syncShop(this.save))this.persist()}
    if(name==='farm'){this.farmType='help';this.farmCrop=mapField(this.save.farmTask?.fieldId)?.crop||'millet';this.farmQuantity=Math.max(1,Math.min(5,formation(this.save).unassignedTroops))}
    if(name==='farm'){this.farmSource='reserve';this.farmSelected=[];this.farmPage=0;this.farmFieldId=this.save.farmTask?.fieldId||null;this.farmReturnToMap=false}
    if(['base-armory','base-medical'].includes(name)){this.facilitySelected=[];this.facilityPage=0;this.factoryProduct='rifle';this.medicalWard='light'}
    if(name==='formation'){this.formationPage=0;this.formationListType=null}
    if(name==='training'){this.trainingPage=0;const roots=this.localVillage? villageUnits(this.save,this.localVillage):formationRoots(this.save);if(!roots.some(u=>u.id===this.trainingSelectedId&&!formationActivity(this.save,u.id,!!this.localVillage)))this.trainingSelectedId=roots.find(u=>!formationActivity(this.save,u.id,!!this.localVillage))?.id}
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
      this.battle=new CampaignBattle(level,deployment.units);this.syncBattleReadiness();updateMusic(this.scene);this.dirty=true;return
    }
    const f=formation(this.save)
    if(!f.armedTroops){this.notify('请先在「我的部队」中添加编制，再部署出战');return}
    const groups=trainedCombatGroups(this.save)
    this.scene='battle';this.modal=null;this.result=null;this.battle=new Battle(mode,level,f.armedTroops,groups[0].weapon,groups);this.syncBattleReadiness();updateMusic(this.scene);this.dirty=true
  }
  openCampaignDeployment(level){
    this.deploymentRegionId=null
    this.openWorldMap();this.modal='campaign-deploy';this.deploymentLevel=level;this.deploymentIds=[];this.deploymentPage=0;this.pressed=false;this.dirty=true
  }
  toggleDeployment(id){
    if(formationActivity(this.save,id)){this.notify('该部队正在执行任务，归队后才能出战');return}
    const index=this.deploymentIds.indexOf(id)
    if(index>=0)this.deploymentIds.splice(index,1)
    else this.deploymentIds.push(id)
    this.dirty=true
  }
  drawCampaignDeployment(){
    const c=this.ctx,s=this.save,roots=formationRoots(s),selected=roots.filter(unit=>this.deploymentIds.includes(unit.id))
    const total=selected.reduce((sum,unit)=>sum+unit.troops,0),pages=Math.max(1,Math.ceil(roots.length/4))
    this.deploymentPage=Math.min(this.deploymentPage,pages-1)
    const region=mapRegion(this.deploymentRegionId),enemy=region&&regionEnemyTroops(s,region.id)
    text(c,region?`${region.name} · ${enemy?'进攻':'派驻'}多少支部队？`:`第 ${this.deploymentLevel} 关 · 派出多少支部队？`,312,275,23,C.ink,700)
    text(c,`已选 ${selected.length} / ${roots.length} 支 · 派遣兵力 ${total.toLocaleString()} 人`,312,312,17,C.olive,600)
    this.button('deployment-all',864,260,125,37,'全部选择',()=>{this.deploymentIds=roots.filter(unit=>!formationActivity(s,unit.id)&&(region&&!enemy||Object.values(unit.weapons).reduce((sum,n)=>sum+n,0)===unit.troops)).map(unit=>unit.id)},'light')
    this.button('deployment-clear',1001,260,124,37,'清空选择',()=>{this.deploymentIds=[]},'light')
    roots.slice(this.deploymentPage*4,this.deploymentPage*4+4).forEach((unit,i)=>{
      const y=345+i*53,chosen=this.deploymentIds.includes(unit.id),act=formationActivity(s,unit.id)
      const canSplit=['garrison','region'].includes(act)&&!formationActivity(s,unit.id,true)&&garrisonSplitTypes(s,unit).length>0
      box(c,312,y,813,46,chosen?'#31432d':C.raised,2,chosen?C.olive:C.line)
      box(c,327,y+13,20,20,chosen?C.olive:null,2,C.olive)
      if(chosen)text(c,'✓',337,y+23,17,C.paper,700,'center')
      text(c,unitName(unit),367,y+23,21,C.ink,700)
      text(c,`${unit.troops.toLocaleString()} 人`,540,y+23,18,C.olive,600)
      text(c,act?activityLabel(act):Object.values(unit.weapons).reduce((sum,n)=>sum+n,0)<unit.troops?'未配齐武器':unit.children?`含 ${unit.children.length} 支直属下级`:'独立编制',718,y+23,15,act?C.gold:C.muted)
      this.buttons.push({id:'deployment-unit-'+unit.id,x:312,y,w:canSplit?680:813,h:46,fn:()=>this.toggleDeployment(unit.id)})
      if(canSplit)this.button('deployment-split-'+unit.id,1004,y+7,110,32,'分出部分',()=>this.openGarrisonSplit(unit.id,'campaign-deploy'),'accent')
      else text(c,chosen?'已选择':'点击选择',1108,y+23,15,chosen?C.olive:C.muted,500,'right')
    })
    if(!roots.length){text(c,'暂无可派遣的部队',720,417,25,C.ink,600,'center');text(c,'请先在「我的部队」添加编制并配发武器',720,460,17,C.muted,400,'center')}
    if(pages>1){
      this.button('deployment-prev',312,565,90,34,'上一页',()=>{this.deploymentPage=Math.max(0,this.deploymentPage-1)},'light')
      text(c,`${this.deploymentPage+1} / ${pages}`,445,582,15,C.muted,500,'center')
      this.button('deployment-next',488,565,90,34,'下一页',()=>{this.deploymentPage=Math.min(pages-1,this.deploymentPage+1)},'light')
    }
    text(c,region?enemy?`敌军 ${enemy} 人 · 胜利后幸存部队留驻`:'无敌军 · 确认即占领，驻防占用部队':hungerStatus(s).disabled?'极度饥饿仍可出战：火力减半，射速和移动速度下降':'战后按实际余员扣兵 · 合编包含全部下属',pages>1?600:312,581,region?12:14,hungerStatus(s).disabled?C.red:C.muted)
    this.button('deployment-back',312,615,230,42,region?'返回地区':'返回大地图',()=>region?this.openRegion(region.id):this.open('campaign'),'light')
    this.button('deployment-confirm',565,615,560,42,selected.length?`确认${region&&!enemy?'派驻':'出战'} · ${selected.length} 支 / ${total.toLocaleString()} 人`:roots.length?'请选择派遣部队':'前往我的部队',()=>{
      if(!roots.length)this.open('formation')
      else if(region)this.dispatchRegion(region.id,[...this.deploymentIds])
      else this.start('campaign',this.deploymentLevel,[...this.deploymentIds])
    },selected.length||!roots.length?'accent':'light')
  }
  syncBattleReadiness(){
    if(!this.battle)return
    const status=hungerStatus(this.save)
    this.battle.combatReady=true
    for(const key of ['damageMultiplier','intervalMultiplier','speedMultiplier'])this.battle[key]=status[key]
  }
  updateBattle(dt){
    this.syncBattleReadiness()
    this.battle.update(dt)
    const lost=applyBattleLosses(this.save,this.battle)
    if(lost){this.persist();this.notify(`部队退出战斗 · 减员 ${lost} 人，战后判定阵亡与伤员`)}
    this.dirty=true;if(this.battle.done)this.finish()
  }
  finish(){if(this.battle.settled)return;this.result=settle(this.save,this.battle);releaseFormations(this.save,'battle');if(this.battle.regionId)this.result.region=resolveRegionBattle(this.save,this.battle);this.persist();this.modal='result';this.pressed=false}
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
  rename(){wx.showModal({title:'修改指挥官名称',editable:true,content:this.save.name,placeholderText:'输入名称，最多 12 个字',maxLength:12,success:r=>{
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
    if(this.toast){box(c,430,30,580,48,C.panel,2,C.gold);text(c,this.toast.message,720,54,17,'#fff6d8',500,'center')}
    c.restore()
  }
  openWorldMap(){
    this.scene='world-map';this.modal=null;this.localVillage=null;this.cancelTouch()
    this.mapSelected=mapLocation(this.mapSelected).id
    this.mapCamera=this.mapCamera||createCamera()
    updateMusic(this.scene);this.dirty=true
  }
  openVillage(id){
    if(!isVillage(id))return
    if(!villageControlled(this.save,id)){this.openVillageStation(id,true);return}
    this.mapSelected=id;this.villageId=id;this.localVillage=id;this.villageStationFromMap=false;this.open('village')
  }
  openVillageStation(id,fromMap=false){
    if(!isVillage(id))return
    this.mapSelected=id;this.villageId=id;this.villageStationFromMap=fromMap;this.open('village-station')
  }
  returnToVillage(){if(this.localVillage)this.openVillage(this.localVillage);else this.openWorldMap()}
  openMapField(id){
    const field=mapField(id);if(!field)return
    if(!villageControlled(this.save,field.villageId)){this.notify('需要先占领并驻军「'+villageName(field.villageId)+'」，才能耕种它的田地');return}
    this.mapSelected=field.villageId;this.open('farm');this.farmReturnToMap=true;this.farmSource='units'
    if(this.save.farmTask){
      if(this.save.farmTask.fieldId!==id)this.notify('已有耕作任务，请先完成或召回当前人员')
      return
    }
    this.farmFieldId=id;this.farmCrop=field.crop
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
    if(regionUnits(this.save,id).length)this.openRegion(id)
    else this.openRegionDeployment(id)
  }
  dispatchRegion(id,ids){
    if(this.scene==='battle'&&this.battle&&!this.battle.done){this.notify('请先结束当前战斗，再派遣新的部队');return}
    const result=regionDispatch(this.save,id,ids)
    if(!result.ok){this.notify(result.message);return}
    if(!regionEnemyTroops(this.save,id)){
      const stationed=occupyRegion(this.save,id,ids)
      if(!stationed.ok){this.notify(stationed.message);return}
      this.persist();this.openRegion(id);this.notify(stationed.message);return
    }
    if(!assignFormations(this.save,ids,'battle')){this.notify('所选部队已被占用');return}
    this.battle=new CampaignBattle(1,result.units,regionRecord(this.save,id).enemies)
    this.battle.regionId=id;this.battle.regionName=mapRegion(id).name;this.battle.regionDeployedIds=[...ids]
    this.scene='battle';this.modal=null;this.result=null;this.battleRosterPage=0;this.pressed=false;this.syncBattleReadiness();updateMusic(this.scene);this.dirty=true
  }
  drawRegion(){
    const c=this.ctx,s=this.save,site=mapRegion(this.regionId),owner=regionOwner(s,site.id),enemy=regionEnemyTroops(s,site.id),units=regionUnits(s,site.id)
    icon(c,site.type,345,284,40,MAP_TERRAIN_STYLES[site.type].color)
    text(c,`${site.villageId?populationRule(site.villageId).name:REGION_KINDS[site.type]} · ${owner==='enemy'?'敌军控制':owner==='player'?'我方驻防':'暂无驻军'}`,385,277,23,owner==='enemy'?C.gold:C.olive,700)
    text(c,enemy?`守军 ${enemy} 人 · ${regionRecord(s,site.id).enemies.length} 支部队`:`我方 ${units.length} 支部队 · ${units.reduce((n,u)=>n+u.troops,0)} 人`,385,312,18,C.muted)
    text(c,enemy?'选择部队进攻，击败全部守军后占领该地区。':'可派空闲编制进驻，占领后部队留在此处防守。',312,358,17,C.ink)
    const pages=Math.max(1,Math.ceil(units.length/3));this.regionPage=Math.min(this.regionPage,pages-1)
    units.slice(this.regionPage*3,this.regionPage*3+3).forEach((unit,i)=>{
      const y=394+i*50,canSplit=!formationActivity(s,unit.id,true)&&garrisonSplitTypes(s,unit).length>0
      box(c,312,y,813,43,C.raised,2,C.line);text(c,`${unitName(unit)} · ${unit.troops} 人`,330,y+22,18,C.ink,600)
      if(canSplit)this.button('region-split-'+unit.id,846,y+4,116,34,'分出部队',()=>this.openGarrisonSplit(unit.id,'region'),'accent')
      this.button('region-recall-'+unit.id,972,y+4,140,34,'撤回待命',()=>{const r=recallRegion(s,site.id,unit.id);this.notify(r.message);if(r.ok)this.persist()},'light')
    })
    if(!units.length){
      if(enemy)regionRecord(s,site.id).enemies.slice(0,3).forEach((u,i)=>text(c,`${u.name} · ${u.troops.toLocaleString()} 人 · ${weaponById(u.weapon).name}`,312,411+i*39,17,C.muted))
      else text(c,'尚未派驻我方部队',312,423,17,C.muted)
    }
    if(pages>1){this.button('region-prev',312,555,110,34,'上一页',()=>{this.regionPage=Math.max(0,this.regionPage-1)},'light');text(c,`${this.regionPage+1}/${pages}`,465,573,15,C.muted);this.button('region-next',520,555,110,34,'下一页',()=>{this.regionPage=Math.min(pages-1,this.regionPage+1)},'light')}
    this.button('region-back',312,615,230,42,'返回大地图',()=>this.openWorldMap(),'light')
    this.button('region-dispatch',565,615,560,42,enemy?'选择部队 · 进攻占领':units.length?'增派驻防部队':'选择部队 · 进驻占领',()=>this.openRegionDeployment(site.id),'accent')
  }
  returnFromFarm(){if(this.farmReturnToMap)this.openWorldMap();else this.open('base')}
  drawWorldMap(){
    this.mapCamera||=createCamera();this.mapSelected=mapLocation(this.mapSelected).id
    const c=this.ctx,v=MAP_VIEW,camera=this.mapCamera,selected=mapLocation(this.mapSelected),s=this.save
    box(c,0,0,1440,810,C.paper)
    c.save();c.beginPath();c.rect(v.x,v.y,v.w,v.h);c.clip()
    const origin=mapToScreen(camera,{x:0,y:0})
    c.save();c.translate(origin.x,origin.y);c.scale(camera.zoom,camera.zoom)
    const territories=[MAP_BASE,...MAP_SITES.filter(v=>villageUnits(s,v.id).length>0),...MAP_REGIONS.filter(v=>regionOwner(s,v.id)==='player')]
    baseRegionMap(c,MAP_CORE.w,MAP_CORE.h,MAP_BOUNDS,[MAP_BASE,...MAP_SITES,...MAP_REGIONS,...MAP_FIELDS],territories)
    villageFields(c,MAP_FIELDS,this.save.farmTask?.fieldId)
    regionRoads(c,[...MAP_TRAILS,...MAP_ROADS,...MAP_REGION_ROADS],mapLocation)
    c.restore()
    for(const field of MAP_FIELDS){
      const p=mapToScreen(camera,field),w=field.w*camera.zoom,h=field.h*camera.zoom
      const x=Math.max(v.x,p.x-w/2),y=Math.max(v.y,p.y-h/2),right=Math.min(v.x+v.w,p.x+w/2),end=Math.min(v.y+v.h,p.y+h/2)
      if(right<=x||end<=y)continue
      const working=field.id===this.save.farmTask?.fieldId,labelScale=mapMarkerScale(camera)
      const fieldGarrisoned=villageControlled(s,field.villageId)&&villageUnits(s,field.villageId).length>0
      c.save();c.translate(p.x,p.y);c.scale(labelScale,labelScale)
      box(c,-36,-20,72,40,'#26371ee8',2)
      if(working){
        text(c,'代耕中',0,-6,15,C.gold,600,'center')
        text(c,this.save.farmTask.workers+'人耕作',0,12,11,C.gold,500,'center')
      }else if(fieldGarrisoned){
        text(c,'田地',0,-6,16,C.ink,600,'center')
        text(c,'点击派兵',0,12,11,C.olive,500,'center')
      }else{
        text(c,'田地',0,0,16,C.muted,600,'center')
      }
      c.restore()
      this.buttons.push({id:'map-field-'+field.id,x,y,w:right-x,h:end-y,fn:()=>this.openMapField(field.id)})
    }
    for(const site of [...MAP_SITES,...MAP_REGIONS,MAP_BASE]){
      const position=mapToScreen(camera,site),p={x:0,y:0},markerScale=mapMarkerScale(camera),chosen=site.id===selected.id,isBase=site.type==='base'
      const garrison=isBase?[]:site.strategic?regionUnits(s,site.id):villageUnits(s,site.id),stationLines=mapGarrisonLines(garrison)
      const owner=isBase?'player':site.strategic?regionOwner(s,site.id):garrison.length?'player':'neutral',style=MAP_TERRAIN_STYLES[site.type],isCity=site.type==='city',isVillageSite=site.type==='village'
      const siteVillageId=site.villageId??site.id,hasFacility=!isBase&&(s.facilityVillages.armory===siteVillageId||s.facilityVillages.medical===siteVillageId),flagBottom=isBase?-43:isCity?-30:-24,flagHeight=hasFacility?74:44
      const left=isBase?44:66,rightEdge=isBase?203:66,top=isBase?58:isCity?55:hasFacility?54:owner!=='neutral'?52:33,bottom=isBase?42:75+stationLines.length*14,color=isBase?C.red:style.color
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
      }
      if(owner!=='neutral')mapFlag(c,p.x,p.y+flagBottom,MAP_FLAG_COLORS[owner],flagHeight)
      const labelX=p.x+(isBase?129:0)
      box(c,isBase?p.x+55:p.x-66,p.y+(isBase?-15:30),isBase?148:132,isBase?54:44+stationLines.length*14,isBase?'#482c27':style.fill,2,color)
      text(c,site.name,labelX,p.y+(isBase?3:46),isBase?25:18,color,700,'center')
      stationLines.forEach((value,i)=>text(c,value,labelX,p.y+64+i*14,11,C.olive,600,'center'))
      const guard=owner==='enemy'&&isCity?regionRecord(s,site.id).enemies.map(u=>FORMATION_TYPES.find(kind=>kind.id===u.type)?.name).filter((name,i,all)=>all.indexOf(name)===i).join('/')+'级 ':''
      const villagePop=isVillageSite?`${populationRule(siteVillageId).name} ${villagePopulation(s,siteVillageId)}人`:''
      const status=isBase?'根据地中心':isVillageSite?(owner==='player'?`${populationRule(siteVillageId).name} · ${villagePopulation(s,siteVillageId)}人`:owner==='enemy'?`${villagePop} · 敌${regionEnemyTroops(s,site.id)}人`:`${villagePop} · 无驻军`):`${REGION_KINDS[site.type]} · ${owner==='enemy'?guard+'敌军 '+regionEnemyTroops(s,site.id)+'人':owner==='player'?'我方驻防':'无驻军'}`
      text(c,status,labelX,p.y+(isBase?25:64+stationLines.length*14),11,color,500,'center')
      if(hasFacility){
        box(c,p.x-27,p.y-50,54,19,C.panel,2,C.gold);text(c,this.save.facilityVillages.armory===siteVillageId?'兵工厂':'医疗部',p.x,p.y-40,10,C.gold,600,'center')
      }
      c.restore()
      const x=Math.max(v.x,position.x-left*markerScale),y=Math.max(v.y,position.y-top*markerScale),right=Math.min(v.x+v.w,position.x+rightEdge*markerScale),end=Math.min(v.y+v.h,position.y+bottom*markerScale)
      const fx=Math.max(v.x,position.x-17*markerScale),fy=Math.max(v.y,position.y+(flagBottom-flagHeight)*markerScale),fr=Math.min(v.x+v.w,position.x+17*markerScale),fb=Math.min(v.y+v.h,position.y+flagBottom*markerScale)
      const flagHit=owner!=='neutral'&&fr>fx&&fb>fy?{x:fx,y:fy,w:fr-fx,h:fb-fy}:null
      const hit=right>x&&end>y?{x,y,w:right-x,h:end-y}:flagHit
      if(hit)this.buttons.push({id:(site.strategic?'map-region-':'map-site-')+site.id,...hit,flagHit,fn:()=>{this.mapSelected=site.id;if(site.strategic)this.openRegionAction(site.id);else if(!isBase)this.openVillage(site.id);this.dirty=true}})
    }
    c.restore()
    box(c,0,0,1440,106,C.panel);line(c,0,105,1440,105,C.line)
    box(c,26,22,58,58,C.raised,2,C.line);icon(c,'army',55,50,34,C.olive)
    text(c,s.name,100,38,23,C.ink,700);text(c,rank(s)+' · 兵力 '+s.troops.toLocaleString(),100,70,16,C.muted,500)
    this.buttons.push({id:'profile',x:20,y:16,w:330,h:73,fn:()=>this.open('army')})
    text(c,'灶火岭战区',400,40,28,C.ink,800);text(c,'拖动 / 缩放 · 外围点位可派兵占领或交战',401,73,13,C.muted)
    icon(c,'coin',970,48,24,C.gold);text(c,s.coins.toLocaleString(),994,48,22,C.gold,700)
    this.button('map-recruitment',790,28,145,50,'发动群众',()=>this.open('recruitment'),'accent')
    this.button('map-base',1200,28,198,50,'根据地',()=>this.open('base'),'light')
    // 罗盘固定在视野边缘，始终指向地图北方。
    text(c,'N',1399,136,14,C.olive,700,'center');line(c,1399,152,1399,190,C.olive,2)
    poly(c,[[1399,147],[1393,160],[1405,160]],C.olive)
    box(c,0,692,1440,118,C.panel);line(c,0,692,1440,692,C.line)
    const isBase=selected.type==='base'
    circle(c,43,712,4,isBase?C.gold:C.olive)
    text(c,selected.name,60,712,22,C.ink,700)
    text(c,isBase?'根据地中心':selected.strategic?`${selected.direction} · ${REGION_KINDS[selected.type]}`:selected.direction+'方 · 村庄',235,712,14,isBase?C.gold:C.olive,600)
    text(c,selected.strategic?'点击查看守军，选择部队占领或进攻。':isBase?'点击村庄管理驻军、训练和动员。':'周边田地可派兵帮助乡亲耕种。',40,736,13,C.muted)
    this.button('map-location-action',455,704,180,40,selected.strategic?'查看地区':isBase?'进入根据地':'村庄管理',()=>{
      if(isBase)this.open('base')
      else if(selected.strategic)this.openRegionAction(selected.id)
      else this.openVillage(selected.id)
    },'accent')
    this.button('map-zoom-out',658,704,44,40,'−',()=>zoomCamera(camera,1/1.25),'light')
    text(c,Math.round(camera.zoom*100)+'%',745,724,18,C.ink,600,'center')
    this.button('map-zoom-in',790,704,44,40,'＋',()=>zoomCamera(camera,1.25),'light')
    this.button('map-fit',850,704,80,40,'全图',()=>fitCamera(camera),'light')
    this.button('map-focus',946,704,80,40,'定位',()=>focusCamera(camera,selected),'light')
    text(c,'战备 · '+hungerStatus(s).label,1392,725,16,hungerStatus(s).disabled?C.red:C.muted,500,'right')
    this.drawMapNavigation()
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
    text(c,'自动做饼、炒米、玉米；熟猪肉和荷包蛋仅手动制作。',312,263,14,C.muted)
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
    const c=this.ctx,s=this.save,units=this.localVillage?villageUnits(s,this.localVillage):formationRoots(s),pages=Math.max(1,Math.ceil(units.length/4))
    this.trainingPage=Math.max(0,Math.min(this.trainingPage||0,pages-1));const page=this.trainingPage
    text(c,`士兵综合训练 · 每人需1秒 · 完成后每人 +${TRAINING_XP} 经验`,312,271,20,C.ink,700)
    text(c,this.localVillage?'仅训练'+villageName(this.localVillage)+'驻军，完成后继续在本村保护乡亲。':'选择一支独立部队参训，所属下级士兵一同获得经验。',312,302,15,C.muted)
    if(!units.length){icon(c,'army',720,410,56,C.muted);text(c,'尚无可训练部队',720,478,26,C.ink,700,'center');text(c,this.localVillage?'请先返回村庄调入驻军，无枪部队也能训练':'请先到「我的部队」创建编制，无枪部队也能训练',720,518,17,C.muted,400,'center')}
    units.slice(page*4,page*4+4).forEach((unit,i)=>{
      const status=trainingStatus(s,unit.id),y=326+i*58,selected=unit.id===this.trainingSelectedId
      box(c,312,y,813,51,C.raised,2,selected?C.blue:C.line)
      text(c,unitName(unit),330,y+26,23,C.ink,700);text(c,`${unit.troops.toLocaleString()} 人`,493,y+26,20,C.olive,600)
      text(c,'需 '+trainingDuration(unit.troops)+' 秒',493,y+44,11,C.muted)
      text(c,`${status.name} · ${status.average}${status.nextXp!==null?'/'+status.nextXp:' 满级'}`,666,y+26,17,C.blue,600)
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
    const c=this.ctx,b=this.battle,pages=Math.max(1,Math.ceil(b.units.length/4))
    this.battleRosterPage=Math.min(this.battleRosterPage||0,pages-1)
    text(c,hungerStatus(this.save).disabled?'极度饥饿：火力50% · 射速降低 · 移动速度70%':'点选部队 → 点击地面移动 · 各部队进入射程自动开火',42,689,16,hungerStatus(this.save).disabled?C.red:C.muted)
    this.button('battle-split',972,674,205,27,'分遣下级部队',()=>this.openBattleSplit(),'light')
    this.button('battle-recall',1190,674,205,27,'召回选中分遣部队',()=>{if(!b.recallUnit())this.notify('请先选中一支分遣部队');else this.notify('分遣部队正在返回，接触原部队后自动归队')},'light')
    b.units.slice(this.battleRosterPage*4,this.battleRosterPage*4+4).forEach((unit,i)=>{
      const x=42+i*187,y=715,selected=b.selectedUnitId===unit.id,color=unit.hp<=0?C.muted:selected?C.olive:C.blue
      box(c,x,y,175,72,selected?'#31432d':C.raised,2,color)
      text(c,unit.name,x+14,y+21,21,color,700);text(c,unit.hp>0?`${Math.ceil(unit.hp)} / ${unit.maxHp} 人`:`阵亡 · 损失 ${unit.maxHp} 人`,x+14,y+51,15,unit.hp>0?C.muted:C.red)
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
    for(const s of b.shots)line(c,s.x,s.y,s.tx,s.ty,s.hostile?'#b57859':weaponById(s.kind).color,s.kind==='sniper'?3:2)
    if(this.save.settings.effects)for(const f of b.bursts){c.save();c.globalAlpha=f.life/.4;circle(c,f.x,f.y,(1-f.life/.4)*(f.radius||25)+6,'#e7c989');c.restore()}
    box(c,0,0,1440,116,C.paper);line(c,0,115,1440,115,C.line);text(c,b.regionName?b.regionName+' · 争夺战':MODES.find(m=>m.id===b.mode)?.name||'战斗演练',42,37,25,'#f5f3e4',700);text(c,`第 ${b.level} 战区  /  波次 ${b.wave}${Number.isFinite(b.goal)?' / '+b.goal:''}`,42,80,16,'#bdc7b5')
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
    const c=this.ctx,s=this.save
    icon(c,'warehouse',720,331,72,C.gold);text(c,'灶火岭',720,407,34,C.ink,700,'center')
    text(c,'根据地指挥中心',720,452,18,C.gold,600,'center')
    const villages=controlledVillages(s),units=villages.flatMap(v=>villageUnits(s,v.id)),troops=units.reduce((sum,u)=>sum+u.troops,0)
    text(c,'名下 '+villages.length+' 个村庄 · 驻军 '+units.length+' 支 / '+troops.toLocaleString()+' 人',720,503,20,C.olive,600,'center')
    text(c,'村庄驻防与日常事务请前往大地图管理，耕田直接点击田地。',720,553,16,C.muted,400,'center')
    this.button('base-home',312,615,230,42,'返回指挥部',()=>this.home(),'light')
    this.button('base-map',565,615,560,42,'前往大地图 · 管理村庄',()=>this.openWorldMap(),'accent')
  }
  manageVillageFacility(kind){
    const result=placeVillageFacility(this.save,kind,this.villageId)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.localVillage=this.villageId;this.open(kind==='armory'?'base-armory':'base-medical')
  }
  drawVillage(){
    const c=this.ctx,s=this.save,id=this.villageId,units=villageUnits(s,id),troops=units.reduce((sum,u)=>sum+u.troops,0)
    const pages=Math.max(1,Math.ceil(units.length/3));this.villagePage=Math.min(this.villagePage||0,pages-1)
    text(c,'驻军 '+units.length+' 支 / '+troops.toLocaleString()+' 人 · '+(troops?'守护本村乡亲':'尚未派驻保护部队'),312,277,22,troops?C.olive:C.gold,700)
    const rule=populationRule(id)
    text(c,rule.name+' · 村民 '+villagePopulation(s,id)+' / '+rule.cap+' 人',312,309,16,C.muted)
    this.button('village-station',312,335,180,38,'调入驻军',()=>this.open('village-station'),'accent')
    this.button('village-training',508,335,180,38,trainingTaskAt(s,id)?'查看本村训练':'训练本村驻军',()=>{this.localVillage=id;this.open('training')},'light')
    this.button('village-fields',704,335,180,38,'查看周边田地',()=>{this.openWorldMap();focusCamera(this.mapCamera,mapLocation(id))},'light')
    this.button('village-recruitment',900,335,225,38,'发动群众',()=>{this.localVillage=id;this.open('recruitment')},'accent')
    units.slice(this.villagePage*3,this.villagePage*3+3).forEach((unit,i)=>{
      const y=391+i*48,busy=formationActivity(s,unit.id,true)
      box(c,312,y,813,40,C.raised,2,C.line);text(c,unitName(unit),327,y+20,20,C.ink,700)
      text(c,unit.troops.toLocaleString()+' 人 · 可派 '+availableWorkforce(s,unit.id),500,y+20,14,C.olive,600)
      text(c,busy?activityLabel(busy):'驻防保护中',665,y+20,15,busy?C.gold:C.muted)
      if(!busy&&garrisonSplitTypes(s,unit).length)this.button('village-split-'+unit.id,855,y+5,114,30,'分出部队',()=>this.openGarrisonSplit(unit.id,'village'),'accent')
      this.button('village-recall-'+unit.id,979,y+5,132,30,'撤回驻军',()=>{
        const result=recallGarrison(s,id,unit.id);if(!result.ok){this.notify(result.message);return}
        this.persist()
        if(!villageUnits(s,id).length){this.openWorldMap();this.notify('驻军已全部撤回，重新驻军后才可管理该村')}
        else this.notify('部队已撤回，可安排其他任务')
      },'light')
    })
    if(!units.length)text(c,'暂无驻军，点击“调入驻军”选择空闲的独立部队。',312,435,18,C.muted)
    if(pages>1){this.button('village-prev',312,540,100,30,'上一页',()=>{this.villagePage=Math.max(0,this.villagePage-1)},'light');this.button('village-next',428,540,100,30,'下一页',()=>{this.villagePage=Math.min(pages-1,this.villagePage+1)},'light');text(c,(this.villagePage+1)+' / '+pages,553,555,14,C.muted)}
    else text(c,'驻军不限支数；可派部分分队耕田、生产或医疗，剩余人员留守。',312,553,15,C.muted)
    this.button('village-armory',312,582,393,36,s.facilityVillages.armory===id?'进入本村兵工厂':'将兵工厂设在本村',()=>this.manageVillageFacility('armory'),s.facilityVillages.medical===id?'light':'dark')
    this.button('village-medical',732,582,393,36,s.facilityVillages.medical===id?'进入本村医疗部':'将医疗部设在本村',()=>this.manageVillageFacility('medical'),s.facilityVillages.armory===id?'light':'dark')
    this.button('village-back',312,632,230,30,'返回大地图',()=>this.openWorldMap(),'light')
    text(c,'兵工厂与医疗部不能设在同一个村庄；迁移前须停止设施工作。',568,647,13,C.muted)
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
    text(c,`从 ${unitName(unit)}（${unit.troops}人）分出一支独立待命部队 · 原驻军保留 ${unit.troops-this.garrisonSplitTroops} 人`,312,282,18,C.ink,700)
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
        const region=mapRegion(this.deploymentRegionId),armed=Object.values(result.unit.weapons).reduce((n,v)=>n+v,0)===result.unit.troops
        if(armed||(region&&!regionEnemyTroops(s,region.id)))this.deploymentIds=[...(this.deploymentIds||[]),result.unit.id]
      }else if(source==='village-station'){
        this.stationSelected=[...(this.stationSelected||[]),result.unit.id]
      }
      this.persist();this.modal=source;this.notify(`已分出 ${unitName(result.unit)}（${result.unit.troops}人）待命，可前往派遣`)
    },'accent')
  }
  drawVillageStation(){
    const c=this.ctx,s=this.save,id=this.villageId,units=formationRoots(s),pages=Math.max(1,Math.ceil(units.length/4))
    this.stationPage=Math.min(this.stationPage||0,pages-1)
    text(c,'向'+villageName(id)+'调入保护部队 · 可以派无枪编制',312,275,21,C.ink,700)
    text(c,'上级包含全部下属，驻防期间不能同时去别处工作或作战。',312,309,15,C.muted)
    units.slice(this.stationPage*4,this.stationPage*4+4).forEach((unit,i)=>{
      const y=335+i*50,busy=formationActivity(s,unit.id),chosen=this.stationSelected.includes(unit.id),station=villageOfFormation(s,unit.id)
      const canSplit=['garrison','region'].includes(busy)&&!formationActivity(s,unit.id,true)&&garrisonSplitTypes(s,unit).length>0
      box(c,312,y,813,42,chosen?'#31432d':C.raised,2,chosen?C.olive:C.line)
      text(c,(chosen?'☑ ':'☐ ')+unitName(unit),327,y+21,20,C.ink,600);text(c,unit.troops+' 人',550,y+21,17,C.olive)
      text(c,station?villageName(station)+' · '+activityLabel(busy):busy?activityLabel(busy):'可调入',canSplit?990:1108,y+21,14,busy?C.gold:C.muted,500,'right')
      this.buttons.push({id:'station-unit-'+unit.id,x:312,y,w:canSplit?680:813,h:42,fn:()=>{
        if(busy){this.notify('部队已有驻地或正在执行任务，请先召回');return}
        this.stationSelected=chosen?this.stationSelected.filter(key=>key!==unit.id):[...this.stationSelected,unit.id]
      }})
      if(canSplit)this.button('station-split-'+unit.id,1004,y+5,110,32,'分出部分',()=>this.openGarrisonSplit(unit.id,'village-station'),'accent')
    })
    if(!units.length)text(c,'暂无编制，请先在“我的部队”中组建。',312,420,20,C.muted)
    if(pages>1){this.button('station-prev',312,550,100,30,'上一页',()=>{this.stationPage=Math.max(0,this.stationPage-1)},'light');this.button('station-next',428,550,100,30,'下一页',()=>{this.stationPage=Math.min(pages-1,this.stationPage+1)},'light')}
    const troops=units.filter(u=>this.stationSelected.includes(u.id)).reduce((n,u)=>n+u.troops,0)
    text(c,'已选 '+this.stationSelected.length+' 支 / '+troops.toLocaleString()+' 人',312,591,17,C.olive,600)
    this.button('station-back',312,615,230,42,this.villageStationFromMap?'返回大地图':'返回村庄',()=>this.villageStationFromMap?this.openWorldMap():this.openVillage(id),'light')
    this.button('station-confirm',565,615,560,42,'确认驻防 · '+troops.toLocaleString()+' 人',()=>{
      const result=stationTroops(s,id,[...this.stationSelected]);if(!result.ok){this.notify(result.message);return}
      this.persist();this.openVillage(id);this.notify('部队已进驻'+villageName(id)+'，保护村民')
    },'accent')
  }
  drawFacilityPicker(){
    const c=this.ctx,s=this.save,roots=this.localVillage?villageUnits(s,this.localVillage):formationRoots(s),pages=Math.max(1,Math.ceil(roots.length/3))
    this.facilityPage=Math.min(this.facilityPage||0,pages-1)
    const chosen=this.facilitySelected||[]
    roots.slice(this.facilityPage*3,this.facilityPage*3+3).forEach((unit,i)=>{
      const x=312,y=410+i*45,busy=formationActivity(s,unit.id,!!this.localVillage),selected=chosen.includes(unit.id)
      box(c,x,y,813,37,selected?'#31432d':C.raised,2,selected?C.olive:C.line)
      text(c,(selected?'☑ ':'☐ ')+unitName(unit),327,y+19,18,C.ink,600)
      text(c,unit.troops+' 人'+(unit.children?' · 包含全部下属':''),520,y+19,15,C.muted)
      text(c,busy?activityLabel(busy):'可派驻',1108,y+19,14,busy?C.gold:C.olive,500,'right')
      this.buttons.push({id:'facility-unit-'+unit.id,x,y,w:813,h:37,fn:()=>{
        if(busy){this.notify('该部队正在执行任务，请先召回归队');return}
        this.facilitySelected=selected?chosen.filter(id=>id!==unit.id):[...chosen,unit.id]
      }})
    })
    if(!roots.length)text(c,this.localVillage?'本村暂无驻军，请先返回村庄调入部队。':'暂无独立编制，请先到我的部队组建。',312,462,19,C.muted)
    if(pages>1){
      this.button('facility-prev',312,554,100,29,'上一页',()=>{this.facilityPage=Math.max(0,this.facilityPage-1)},'light')
      this.button('facility-next',428,554,100,29,'下一页',()=>{this.facilityPage=Math.min(pages-1,this.facilityPage+1)},'light')
    }
    const workers=roots.filter(unit=>chosen.includes(unit.id)).reduce((sum,unit)=>sum+unit.troops,0)
    text(c,'已选 '+chosen.length+' 支 / '+workers+' 人 · 派驻期间不可出战、耕作或训练',pages>1?552:312,576,14,C.muted)
    return workers
  }
  openWorkDispatch(kind,id){
    if(!isVillage(id))return
    this.workKind=kind;this.workVillage=id;this.workPage=0;this.workPlan=[];this.workReturn=kind==='farm'?'farm':kind==='armory'?'base-armory':'base-medical';this.modal='work-dispatch';this.dirty=true
  }
  returnWorkDispatch(){this.modal=this.workReturn;this.dirty=true}
  drawWorkDispatch(){
    const c=this.ctx,s=this.save,units=villageUnits(s,this.workVillage),pages=Math.max(1,Math.ceil(units.length/4))
    this.workPage=Math.min(this.workPage||0,pages-1)
    text(c,'从'+villageName(this.workVillage)+'驻军中选择原部队',312,277,22,C.ink,700)
    text(c,'派出编制和人数另行设置，原部队留村，人员不会复制。',312,309,16,C.muted)
    units.slice(this.workPage*4,this.workPage*4+4).forEach((unit,i)=>{
      const y=335+i*50,free=availableWorkforce(s,unit.id),planned=this.workPlan.find(a=>a.unitId===unit.id)
      box(c,312,y,813,42,C.raised,2,C.line);text(c,unitName(unit),327,y+21,20,C.ink,700)
      text(c,'可派 '+free+' 人'+(planned?' · 已选 '+planned.troops+' 人':' / 共 '+unit.troops+' 人'),540,y+21,16,C.olive)
      this.button('work-root-'+unit.id,979,y+5,132,30,planned?'调整派遣':free?'选择原部队':'暂无余员',()=>{
        if(!free){this.notify('该部队人员已派完或正在训练');return}
        this.workUnitId=unit.id;this.workType=planned?.type||'group';this.workCount=planned?.troops||Math.min(7,free);this.modal='work-config'
      },free?'accent':'light')
    })
    if(!units.length)text(c,'本村暂无驻军，请先返回村庄调入部队。',312,420,20,C.muted)
    if(pages>1){this.button('work-prev',312,550,100,30,'上一页',()=>{this.workPage=Math.max(0,this.workPage-1)},'light');this.button('work-next',428,550,100,30,'下一页',()=>{this.workPage=Math.min(pages-1,this.workPage+1)},'light')}
    const workers=this.workPlan.reduce((n,a)=>n+a.troops,0)
    text(c,'已选 '+this.workPlan.length+' 支分队 / '+workers+' 人 · 可继续选择其他原部队',312,591,16,C.olive)
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
    text(c,'临时分队可按人数派遣；班、排等沿用对应人数区间。',312,310,15,C.muted)
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
    else if(this.workKind==='armory')result=startProduction(s,ids,this.factoryProduct||'rifle',this.workVillage,allocations)
    else result=startTreatment(s,this.workKind,ids,this.workVillage,allocations)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.returnWorkDispatch();this.notify('已派出 '+allocations.length+' 支分队 / '+allocations.reduce((n,a)=>n+a.troops,0)+' 人，余员继续留守')
  }
  workNames(task){return task.allocations?task.allocations.map(a=>unitName(this.save.formations.find(u=>u.id===a.unitId))+'派出'+(DUTY_TYPES.find(t=>t.id===a.type)?.name||'分队')+' '+a.troops+'人').join('、'):task.unitIds.map(id=>unitName(this.save.formations.find(u=>u.id===id))).join('、')}
  drawFacilityTask(kind,task){
    const c=this.ctx,s=this.save,running=facilityRunning(s,kind)&&!hungerStatus(s).disabled
    const names=this.workNames(task)
    text(c,'派驻 '+task.workers+' 人 · '+(hungerStatus(s).disabled?'极度饥饿，工作暂停':running?'工作进行中':kind==='armory'?'仓库已满，等待出库':'暂无伤员，留守待命'),312,425,21,running?C.olive:C.gold,700)
    box(c,312,459,813,10,C.line,3);box(c,312,459,813*task.elapsed/facilityInterval(kind),10,C.olive,3)
    text(c,'本轮进度 '+Math.floor(task.elapsed)+' / '+facilityInterval(kind)+' 秒',312,495,16,C.muted)
    if(kind!=='armory')text(c,'本批治疗 '+(task.batch?.reduce((sum,n)=>sum+n,0)||0)+' 人',1125,495,16,C.olive,600,'right')
    text(c,'派驻：'+names.slice(0,48),312,529,16,C.muted)
    this.button('facility-recall',312,554,300,34,this.localVillage?'结束工作 · 留在本村驻防':'召回部队 · 保留已完成成果',()=>{if(recallFacility(s,kind)){this.persist();this.notify(this.localVillage?'已结束工作，部队继续驻村保护乡亲':'部队已归队，未完成的本轮计时取消')}},'light')
  }
  drawArmory(){
    const c=this.ctx,s=this.save,task=s.armoryTask,id=task?.product||this.factoryProduct||'rifle',product=PRODUCTS.find(p=>p.id===id)
    PRODUCTS.forEach((p,i)=>this.button('factory-product-'+p.id,312+i*278,257,257,40,p.name,()=>{if(task){this.notify('请先召回驻厂部队再切换项目');return}this.factoryProduct=p.id},p.id===id?'accent':'light'))
    text(c,'每5分钟产出：每7人1把步枪 · 每5人1把手枪 · 每3人1枚手雷',312,324,17,C.ink,600)
    const stock=id==='grenades'?s.grenades:s.weaponCounts[id]
    text(c,product.name+'库存 '+stock+' · 累计生产 '+s.productionTotals[id]+' · 无需额外金币或材料',312,355,16,C.muted)
    if(task){
      text(c,'本轮预计 '+Math.floor(task.workers/product.workers)+' '+(id==='grenades'?'枚':'把')+'，产出自动进入仓库',312,387,16,C.gold)
      this.drawFacilityTask('armory',task)
    }else{
      text(c,'选择派驻部队，可派无枪部队；不满生产比例的人数不额外产出。',312,386,15,C.muted)
      if(this.localVillage)this.button('facility-detach',900,367,225,30,'派遣部分驻军',()=>this.openWorkDispatch('armory',this.localVillage),'accent')
      const workers=this.drawFacilityPicker()
      this.button('facility-start',565,615,560,42,'派驻生产 · 每5分钟 '+Math.floor(workers/product.workers)+' '+(id==='grenades'?'枚':'把'),()=>{
        const result=startProduction(s,[...this.facilitySelected],id,this.localVillage||null)
        if(!result.ok){this.notify(result.message);return}this.persist();this.notify('部队已驻厂，生产将每5分钟自动结算')
      },'accent')
    }
    this.button('base-return',312,615,230,42,this.localVillage?'返回村庄':'返回大地图',()=>this.returnToVillage(),'light')
  }
  drawMedical(){
    const c=this.ctx,s=this.save,ward=this.medicalWard||'light',spec=WARDS[ward],task=s.medicalTasks[ward]
    for(const [i,key] of ['light','heavy'].entries())this.button('medical-ward-'+key,312+i*420,257,393,40,WARDS[key].name+' · '+s.wounded[key]+' 人',()=>{this.medicalWard=key;this.facilitySelected=[];this.facilityPage=0},key===ward?'accent':'light')
    text(c,ward==='heavy'?'每人需5名工作人员 · 每批最多2人 · 每轮2分钟 · 每人需3轮':'每人需2名工作人员 · 每批最多10人 · 每轮30秒 · 每人需1轮',312,324,17,C.ink,600)
    text(c,'每次治疗死亡概率 '+Math.round(spec.deathChance*100)+'% · 康复回到未编人员 · 累计康复 '+s.recoveredTroops+' / 死亡 '+s.medicalDeaths,312,354,15,C.muted)
    if(ward==='heavy')text(c,'未治疗 '+s.heavyTreatmentStages[0]+' 人 · 已治1轮 '+s.heavyTreatmentStages[1]+' 人 · 已治2轮 '+s.heavyTreatmentStages[2]+' 人',312,385,15,C.gold)
    else text(c,'战损中一半阵亡、一半入院；伤员均分为轻伤和重伤。',312,385,15,C.muted)
    if(task)this.drawFacilityTask(ward,task)
    else{
      if(this.localVillage)this.button('facility-detach',900,367,225,30,'派遣部分驻军',()=>this.openWorkDispatch(ward,this.localVillage),'accent')
      const workers=this.drawFacilityPicker(),capacity=Math.min(spec.capacity,Math.floor(workers/spec.workers))
      this.button('facility-start',565,615,560,42,'派驻'+spec.name+' · 每轮可治疗 '+capacity+' 人',()=>{
        const result=startTreatment(s,ward,[...this.facilitySelected],this.localVillage||null)
        if(!result.ok){this.notify(result.message);return}this.persist();this.notify('医疗部已派驻，无伤员时留守待命')
      },'accent')
    }
    this.button('base-return',312,615,230,42,this.localVillage?'返回村庄':'返回大地图',()=>this.returnToVillage(),'light')
  }
  inputFarmWorkers(){
    wx.showModal({title:'派出耕作人员',editable:true,content:String(this.farmQuantity),inputLabel:'耕作人数',numberLabel:'耕作人数',numberInput:true,minValue:1,maxValue:FARM.maxWorkers,maxAvailable:formation(this.save).unassignedTroops,confirmText:'确认人数',success:r=>{
      if(!r.confirm)return
      const count=Number(r.content?.trim())
      if(!Number.isInteger(count)||count<1||count>100){this.notify('耕作人数须为 1—100 的整数');return}
      this.farmQuantity=count;this.dirty=true
    }})
  }
  drawFarm(){
    const c=this.ctx,s=this.save,task=s.farmTask,kind=task?.type||this.farmType,source=task?(task.unitIds?'units':'reserve'):this.farmSource
    const roots=formationRoots(s),selected=roots.filter(unit=>this.farmSelected.includes(unit.id)),count=source==='units'?selected.reduce((sum,unit)=>sum+unit.troops,0):this.farmQuantity
    const field=mapField(task?.fieldId||this.farmFieldId)
    const population=field&&populationRule(field.villageId),recruits=population?population.min+'—'+population.max:5
    box(c,312,257,813,42,C.raised,2,C.line)
    text(c,field?field.name+' · 帮乡亲耕种':task?.type==='self'?'原有耕作任务 · 完成后归队':'帮助乡亲耕田',330,278,21,C.olive,700)
    text(c,kind==='help'?'收成留给乡亲；每人减耗1批，完工招募 '+recruits+' 人。':'原有自耕任务完成后归队。',312,325,15,C.muted)
    if(!task&&field)this.button('farm-detach',940,310,185,30,'派本村部分驻军',()=>this.openWorkDispatch('farm',field.villageId),'accent')
    text(c,'每轮 '+FARM.duration+' 秒 · 可派未编人员 '+formation(s).unassignedTroops+' 人 · '+hungerStatus(s).label,312,351,15,C.olive,600)
    this.button('farm-source-reserve',312,368,393,29,'派未编人员',()=>{if(!task)this.farmSource='reserve'},source==='reserve'?'accent':'light')
    this.button('farm-source-units',732,368,393,29,'派已有编制（包含全部下属）',()=>{if(!task)this.farmSource='units'},source==='units'?'accent':'light')
    if(task){
      text(c,(task.type==='help'?'代耕':'自耕')+'进行中 · '+task.workers+' 人'+(hungerStatus(s).disabled?' · 饥饿暂停':''),312,423,24,C.ink,700)
      box(c,312,452,813,10,C.line,4);box(c,312,452,813*task.elapsed/FARM.duration,10,C.olive,4)
      const names=task.unitIds?this.workNames(task):'未编人员'
      text(c,'派出：'+names.slice(0,45)+' · 剩余 '+Math.ceil(FARM.duration-task.elapsed)+' 秒',312,490,17,C.muted)
      text(c,task.type==='help'?'完工：减耗 '+task.workers+' 批 · 报名 '+recruits+' 人 · 不收粮食':'预计收获 '+CROPS.find(crop=>crop.id===task.crop).name+' '+task.workers*FARM.grainPerWorker+' 份',312,523,17,C.gold,600)
      this.button('farm-cancel',312,554,310,36,'召回归队 · 本轮不发奖励',()=>{if(cancelFarming(s)){this.persist();this.notify('已召回归队，可以执行其他任务')}},'light')
    }else{
      if(source==='units'){
        const pages=Math.max(1,Math.ceil(roots.length/3));this.farmPage=Math.min(this.farmPage,pages-1)
        roots.slice(this.farmPage*3,this.farmPage*3+3).forEach((unit,i)=>{
          const x=312,y=405+i*38,busy=formationActivity(s,unit.id,!!field&&villageOfFormation(s,unit.id)===field.villageId),chosen=this.farmSelected.includes(unit.id),armed=Object.values(unit.weapons).reduce((a,b)=>a+b,0)
          box(c,x,y,813,32,chosen?'#3c4e30':C.raised,2,chosen?C.olive:C.line)
          text(c,(chosen?'☑ ':'☐ ')+unitName(unit),327,y+16,17,C.ink,600)
          text(c,unit.troops+' 人 · 配枪 '+armed+' 把',558,y+16,14,C.muted)
          text(c,busy?activityLabel(busy):'可派出',1108,y+16,14,busy?C.gold:C.olive,600,'right')
          this.buttons.push({id:'farm-unit-'+unit.id,x,y,w:813,h:32,fn:()=>{
            if(busy){this.notify('该部队正在执行任务，请等待归队');return}
            this.farmSelected=chosen?this.farmSelected.filter(id=>id!==unit.id):[...this.farmSelected,unit.id]
          }})
        })
        if(!roots.length)text(c,'暂无独立编制，可改派未编人员或到「我的部队」组建。',312,454,17,C.muted)
        if(pages>1){this.button('farm-prev',312,522,100,25,'上一页',()=>{this.farmPage=Math.max(0,this.farmPage-1)},'light');this.button('farm-next',428,522,100,25,'下一页',()=>{this.farmPage=Math.min(pages-1,this.farmPage+1)},'light')}
        text(c,'已选 '+selected.length+' 支 / '+count+' 人 · 同时只能执行一项任务',pages>1?550:312,537,14,C.muted)
      }else{
        this.button('farm-minus',312,415,60,40,'−',()=>{this.farmQuantity=Math.max(1,count-1)},'light')
        this.button('farm-count',384,415,669,40,count+' 人 · 点击输入（1—100）',()=>this.inputFarmWorkers(),'dark')
        this.button('farm-plus',1065,415,60,40,'＋',()=>{this.farmQuantity=Math.min(100,count+1)},'light')
        text(c,'耕作人员暂时占用，不能同时编入出战部队。',312,502,16,C.muted)
      }
      text(c,'预计减耗 '+count+' 批 · 完工报名 '+recruits+' 人 · 粮食留给乡亲',312,573,16,C.gold)
      this.button('farm-start',565,615,560,42,'派出代耕 · '+count+' 人',()=>{
        const result=startFarming(s,'help',count,this.farmCrop,source==='units'?[...this.farmSelected]:null,this.farmFieldId)
        if(!result.ok){this.notify(result.message);return}
        this.persist();this.notify('耕作已开始，完成或召回归队后可执行其他任务')
      },'accent')
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
    const roots=formationRoots(s)
    FORMATION_TYPES.forEach((kind,i)=>{
      const units=roots.filter(u=>u.type===kind.id),x=312+(i%4)*208,y=345+Math.floor(i/4)*113
      box(c,x,y,189,100,C.raised,2,units.length?C.olive:C.line)
      text(c,kind.name,x+17,y+24,29,C.ink,700);text(c,`${units.length} 支`,x+171,y+28,23,units.length?C.olive:C.muted,700,'right')
      text(c,`${number(units.reduce((sum,u)=>sum+u.troops,0))} 人`,x+17,y+68,18,C.muted,600)
      this.buttons.push({id:'formation-category-'+kind.id,x,y,w:189,h:100,fn:()=>this.openFormationList(kind.id)})
    })
    text(c,`部队 ${roots.length} 支 · 耕作 ${farmWorkers(s)} 人 · ${hungerStatus(s).label} · 缺餐 ${hungerStatus(s).debt.toFixed(1)}/3 · 熟食 ${rationStock(s)} 份 / 每次需 ${mealCost(s)} 份`,312,584,15,hungerStatus(s).disabled?C.red:C.muted)
    this.button('formation-add',312,610,185,40,'添加编制',()=>this.editFormation(),'accent')
    this.button('formation-merge',513,610,185,40,'组建上级',()=>this.openFormationMerge(),'light')
    this.button('formation-food',723,610,185,40,'去灶房做饭',()=>this.open('kitchen'),'light')
    this.button('formation-shop',940,610,185,40,'补充武器',()=>this.open('shop'),'light')
    text(c,`编制可暂不配枪 · 武器总数 ${number(f.totalWeapons)} 把 · 出战前需配齐武器`,312,662,14,C.muted)
  }
  openFormationList(type){this.formationListType=type;this.formationPage=0;this.modal='formation-list';this.dirty=true}
  drawFormationBreadcrumb(unit=null){
    const chain=[]
    if(unit){let current=unit;while(current){chain.unshift(current);current=formationParent(this.save,current.id)}}
    const type=chain[0]?.type||this.formationListType,kind=FORMATION_TYPES.find(v=>v.id===type)
    const crumbs=[{label:'我的部队',fn:()=>this.open('formation')}]
    if(kind)crumbs.push({label:kind.name+'级部队',fn:()=>this.openFormationList(type)})
    chain.forEach(item=>crumbs.push({label:unitName(item),fn:()=>this.openFormationChildren(item)}))
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
    const c=this.ctx,s=this.save,kind=FORMATION_TYPES.find(v=>v.id===this.formationListType),units=formationRoots(this.save).filter(u=>u.type===kind.id)
    this.drawFormationBreadcrumb()
    text(c,`${kind.name}级部队 · ${units.length} 支`,312,317,25,C.ink,700)
    this.button('formation-list-add',940,296,185,39,'添加'+kind.name,()=>{this.editFormation();this.formationDraft.type=kind.id;this.formationDraft.troops=kind.id==='squad'&&this.save.troops>0&&this.save.troops<7?this.save.troops:kind.min;this.formationDraft.weapons=autoFormationWeapons(this.save,this.formationDraft.troops)},'accent')
    const pages=Math.max(1,Math.ceil(units.length/4))
    this.formationPage=Math.max(0,Math.min(this.formationPage||0,pages-1));const page=this.formationPage
    if(!units.length){icon(c,'formation',720,426,46,C.muted);text(c,'暂无此类独立部队',720,485,24,C.ink,600,'center');text(c,'已有下属请从所属上级进入查看',720,527,16,C.muted,400,'center')}
    units.slice(page*4,page*4+4).forEach((unit,i)=>{
      const y=353+i*58
      box(c,312,y,813,50,C.raised,2,C.line);text(c,unitName(unit),331,y+25,23,C.ink,700)
      text(c,`${unit.troops.toLocaleString()} 人`,545,y+25,22,C.olive,700)
      text(c,formationActivity(s,unit.id)?activityLabel(formationActivity(s,unit.id)):unit.troops<kind.min?(unit.battleDamaged?'战损欠编':'欠编'):unit.children?`下属 ${unit.children.length} 支部队`:'独立编制',740,y+25,17,unit.troops<kind.min?C.gold:C.muted)
      this.button('formation-view-'+unit.id,1000,y+7,109,36,'查看',()=>this.openFormationChildren(unit),'light')
    })
    this.button('formation-list-back',312,615,185,39,'返回总览',()=>this.open('formation'),'light')
    if(pages>1){
      this.button('formation-prev',626,615,114,36,'上一页',()=>{this.formationPage=Math.max(0,page-1)},'light')
      text(c,`${page+1} / ${pages}`,826,635,16,C.muted,500,'center')
      this.button('formation-next',1011,615,114,36,'下一页',()=>{this.formationPage=Math.min(pages-1,page+1)},'light')
    }
  }
  editFormation(unit=null){
    if(unit&&formationActivity(this.save,unit.id)){this.notify('部队正在执行任务，归队后才能修改');return}
    if(unit?.children){this.openFormationChildren(unit);return}
    const initial=this.save.troops>0&&this.save.troops<7?this.save.troops:7
    this.formationDraft=unit?{...unit,baseTroops:unit.troops,baseWeapons:{...unit.weapons},reinforcements:0,weaponAuto:true,weapons:{...unit.weapons}}:{id:null,type:'squad',troops:initial,weapons:autoFormationWeapons(this.save,initial)}
    this.formationReturnId=unit?.id
    this.formationError='';this.modal='formation-edit';this.dirty=true
  }
  returnFormationEditor(){
    const unit=this.save.formations.find(u=>u.id===this.formationReturnId)
    if(unit)this.openFormationChildren(unit)
    else if(this.formationListType)this.openFormationList(this.formationListType)
    else this.open('formation')
  }
  openFormationChildren(unit){this.formationDetailId=unit.id;this.modal='formation-detail';this.dirty=true}
  releaseFormation(unit){
    const result=unmergeFormation(this.save,unit.id)
    if(!result.ok){this.notify(result.message);return}
    this.persist();this.open('formation');this.notify(`已解除合编，${unit.children.length} 支下属部队恢复独立，人员武器保留`)
  }
  openFormationMerge(){this.mergeType='squad';this.mergeSelected=[];this.mergePage=0;this.mergeError='';this.modal='formation-merge';this.dirty=true}
  drawFormationMerge(){
    const c=this.ctx,s=this.save,index=FORMATION_TYPES.findIndex(v=>v.id===this.mergeType),next=FORMATION_TYPES[index+1]
    text(c,'选择三支独立的同级部队，组建上一级编制。',312,265,17,C.ink,600)
    FORMATION_TYPES.slice(0,-1).forEach((kind,i)=>{
      this.button('merge-type-'+kind.id,312+i*116,284,105,38,kind.name,()=>{this.mergeType=kind.id;this.mergeSelected=[];this.mergePage=0;this.mergeError=''},kind.id===this.mergeType?'accent':'light')
    })
    const candidates=formationRoots(s).filter(u=>u.type===this.mergeType),pages=Math.max(1,Math.ceil(candidates.length/4))
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
    this.drawFormationBreadcrumb(unit)
    const status=trainingStatus(s,unit.id)
    const stats=[['总人数',unit.troops],['直属部队',unit.children?.length||0],['训练水平',status.name]]
    stats.forEach(([label,value],i)=>{const x=312+i*278;box(c,x,301,257,69,C.raised,2,C.line);text(c,label,x+16,320,14,C.muted);text(c,value.toLocaleString(),x+16,351,27,C.olive,700)})
    box(c,312,388,488,200,C.raised,2,C.line);text(c,unit.children?'直属部队':'部队信息',331,411,19,C.ink,700)
    if(unit.children)unit.children.forEach((id,i)=>{
      const child=s.formations.find(u=>u.id===id),y=435+i*45
      box(c,326,y,460,39,C.panel,2,C.line);text(c,unitName(child),341,y+20,20,C.ink,700)
      text(c,`${child.troops.toLocaleString()} 人`,470,y+20,18,C.olive,700)
      text(c,child.children?`下属${child.children.length}支`:'无下属',573,y+20,13,C.muted)
      this.button('child-view-'+id,686,y+4,87,31,'查看',()=>this.openFormationChildren(child),'light')
    })
    else{
      icon(c,'army',555,465,45,C.olive);text(c,unitName(unit),555,520,29,C.ink,700,'center')
      text(c,`训练经验 ${status.average}/${status.nextXp??600} · 火力 +${Math.round(status.bonus*100)}%`,555,557,16,C.muted,500,'center')
    }
    box(c,819,388,306,200,C.raised,2,C.line);text(c,'武器配置',839,411,19,C.ink,700)
    WEAPONS.forEach((w,i)=>{text(c,w.name,839,445+i*28,16,C.muted);text(c,`${unit.weapons[w.id].toLocaleString()} 把`,1105,445+i*28,18,w.color,600,'right')})
    text(c,formationActivity(s,unit.id)?activityLabel(formationActivity(s,unit.id))+'：归队后才能修改、配发、解散或执行其他任务。':parent?`隶属于${unitName(parent)}，人员与武器已计入上级。`:unit.children?`解除合编将恢复 ${unit.children.length} 支独立部队，人员武器保持原样。`:unit.troops<FORMATION_TYPES.find(kind=>kind.id===unit.type).min?'欠编部队：保留实际人数，可修改编制补充未编人员。':'可在此修改人数、分配武器或解散部队。',312,608,14,C.muted)
    this.button('children-back',312,625,185,37,parent?'返回上级':'返回分类',()=>parent?this.openFormationChildren(parent):this.openFormationList(unit.type),'light')
    if(!parent)this.button('formation-train',513,625,185,37,'前往训练',()=>{this.trainingSelectedId=unit.id;this.open('training')},'light')
    if(unit.children){if(!parent)this.button('children-release',940,625,185,37,'解除合编',()=>this.releaseFormation(unit),'accent')}
    else{
      this.button('formation-detail-edit',734,625,185,37,'修改编制',()=>this.editFormation(unit),'accent')
      if(!parent)this.button('formation-detail-remove',940,625,185,37,'解散部队',()=>{
        if(removeFormation(s,unit.id)){this.persist();this.openFormationList(unit.type);this.notify('部队已解散，人员和武器名额已释放')}else this.notify('部队正在执行任务，归队后才能解散')
      },'light')
    }
  }
  inputFormationTroops(){
    const draft=this.formationDraft,kind=FORMATION_TYPES.find(v=>v.id===draft.type),minimum=formationMinimum(this.save,draft.type,draft.id)
    if(draft.id!==null){
      const space=reinforcementCapacity(this.save,draft.id)
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
    const weaponStock=available.weapons
    if(existing){
      box(c,312,254,813,88,C.raised,2,C.line)
      text(c,`${unitName(draft)} · 补员与配发`,332,282,25,C.ink,700)
      text(c,'原有士兵与训练经验保留，新增人员从未编人员中调入。',332,318,16,C.muted)
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
    this.button('formation-count',398,390,641,46,existing?`补充 ${draft.reinforcements} 人 → 合计 ${draft.troops} / ${kind.max} 人 · 点击输入`:`${draft.troops.toLocaleString()} 人 · 点击输入`,()=>this.inputFormationTroops(),'dark')
    this.button('formation-plus',1055,390,70,46,'＋',()=>{if(existing)this.setFormationReinforcements(Math.min(space.capacity,draft.reinforcements+1));else{draft.troops=Math.min(kind.max,draft.troops+1);this.formationError=''}},'light')
    text(c,existing?`可用未编人员：${space.personnel} 人 · 原有 ${draft.baseTroops} 人保留，补员仅增加人数`:`可用未编人员：${available.troops.toLocaleString()} 人`,312,454,15,draft.troops>available.troops?C.red:C.muted)
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
    text(c,warning||(existing?'数量为最终总配发，可用数含原配；卸下武器回到可分配库存。':'可以不配武器先建立编制，出战前再补齐；每人最多一把。'),312,603,15,warning?C.red:C.muted)
    this.button('formation-cancel',312,621,185,37,'取消',()=>this.returnFormationEditor(),'light')
    this.button('formation-save',940,621,185,37,draft.id===null?'创建编制':draft.reinforcements?'确认补员':'保存修改',()=>{
      const result=existing?reinforceFormation(this.save,draft.id,draft.reinforcements,draft.weapons,draft.baseTroops,true):setFormation(this.save,draft.type,draft.troops,draft.id,draft.weapons)
      if(!result.ok){this.formationError=result.message;return}
      this.persist();if(draft.id===null)this.openFormationList(draft.type);else this.returnFormationEditor();this.notify(draft.id===null?'编制已创建':draft.reinforcements?`已补充 ${draft.reinforcements} 人，现有 ${draft.troops} 人`:'部队配发已更新')
    },'accent')
  }
  drawGoods(type){
    const c=this.ctx,s=this.save,category=this.inventoryTab
    const items=GOODS.filter(item=>item.category===category&&(type==='shop'||s[item.id]>0))
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
    const hint=category==='ammo'?'弹药与手雷作为库存储备，当前自动射击不消耗弹药。':'医疗包和绷带作为物资储备；伤员统一在根据地医疗部治疗。'
    text(c,hint,312,655,15,C.muted)
  }
  drawModal(){
    const c=this.ctx,s=this.save,type=this.modal
    const detail=s.formations.find(u=>u.id===this.formationDetailId)
    const names={region:mapRegion(this.regionId)?.name+' · 地区情报','garrison-split':'从驻军分出部队','work-dispatch':'选择原驻村部队','work-config':'设置派遣编制',village:villageName(this.villageId)+' · 村庄管理','village-station':villageName(this.villageId)+' · 调入驻军',campaign:'主线战役','campaign-deploy':'选择派遣部队','battle-split':'战场分遣',recruitment:'发动群众',kitchen:'灶房',base:'根据地',farm:'耕地',
      'base-armory':'兵工厂','base-medical':'医疗部',training:'训练场','training-result':'训练完成',formation:'我的部队','formation-list':'分类部队','formation-merge':'组建上级 · 三合一','formation-detail':detail?unitName(detail)+' · 部队详情':'部队详情','formation-edit':this.formationDraft?.id==null?'添加编制':'修改编制',warehouse:'物资仓库',shop:'商城',army:'指挥官信息',tasks:'作战任务',settings:'指挥设置',pause:'战斗暂停',result:this.battle?.won?'行动成功':'战斗结束',retreat:'结束本次行动？'}
    box(c,270,130,900,550,C.panel,2,C.line);box(c,270,130,6,550,C.olive,0);brackets(c,270,130,900,550,C.olive)
    const heading=type==='recruitment'?'发动群众 · 全部村庄':this.localVillage&&['training','base-armory','base-medical'].includes(type)?villageName(this.localVillage)+' · '+names[type]:names[type]
    const dispatchSite=type==='campaign-deploy'&&mapRegion(this.deploymentRegionId)
    const dispatchHint=dispatchSite?`${REGION_KINDS[dispatchSite.type]} · ${regionRecord(s,dispatchSite.id).enemies.length?regionRecord(s,dispatchSite.id).enemies.slice(0,3).map(u=>`${u.name} ${u.troops.toLocaleString()}人`).join(' / '):'无敌军，可直接派驻占领'}`:null
    text(c,heading,312,179,30,C.ink,800);text(c,dispatchHint||(type==='shop'?this.shopRestockLabel():['farm','recruitment'].includes(type)?'军民同心 · 代耕不收粮食 · 暂停乡亲物资补给':'FRONTLINE / COMMAND CENTER'),312,216,11,type==='shop'?C.gold:C.muted,500);line(c,312,242,1125,242,C.line)
    if(!['result','training-result'].includes(type))this.button('close',1080,157,48,44,'×',()=>{
      if(type==='work-dispatch')this.returnWorkDispatch()
      else if(type==='work-config')this.modal='work-dispatch'
      else if(type==='formation-edit')this.returnFormationEditor()
      else if(type==='campaign-deploy'){if(this.deploymentRegionId)this.openRegion(this.deploymentRegionId);else this.open('campaign')}
      else if(['formation-merge','formation-detail'].includes(type))this.open('formation')
      else if(type==='farm')this.returnFromFarm()
      else if(type==='village')this.openWorldMap()
      else if(type==='village-station'){if(this.villageStationFromMap)this.openWorldMap();else this.openVillage(this.villageId)}
      else if(type==='garrison-split')this.modal=this.garrisonSplitSource||'village'
      else if(['base-armory','base-medical','training','recruitment'].includes(type))this.returnToVillage()
      else this.modal=null
    },'light')
    if(type==='region'){this.drawRegion()
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
    }else if(type==='base-medical'){
      this.drawMedical()
    }else if(type==='training'){
      this.drawTrainingSelection()
    }else if(type==='recruitment'){
      this.drawRecruitment()
    }else if(type==='kitchen'){
      this.drawKitchen()
    }else if(type==='warehouse'||type==='shop'){
      const tabs=[['weapons','枪械区'],['ammo','弹药区'],['medical','医疗区'],['logistics','后勤区'],...(type==='warehouse'?[['dishes','熟食区']]:[])]
      const step=tabs.length>4?140:157,width=tabs.length>4?130:145
      tabs.forEach(([id,label],i)=>{
        this.button('tab-'+id,312+i*step,255,width,44,label,()=>{this.inventoryTab=id},this.inventoryTab===id?'accent':'light')
      })
      text(c,`金币 ${s.coins}`,1125,278,17,C.gold,600,'right')
      if(this.inventoryTab==='weapons'){this.drawWeapons(type);return}
      this.drawGoods(type)
    }else if(type==='army'){
      const rp=rankProgress(s)
      icon(c,'army',397,356,108,C.olive);text(c,s.name,510,296,30,C.ink,700);text(c,`现任职务  ${rp.name}`,510,351,22,C.olive,600);text(c,`部队兵力  ${s.troops}    /    累计胜利  ${s.wins}`,510,398,19,C.muted)
      text(c,`军功 ${s.xp}`,397,445,22,C.gold,700,'center')
      text(c,rp.next?`还需 ${rp.nextMerit-s.xp} 军功晋升 ${rp.next}`:'已至最高职务：军长',510,445,16,C.muted);box(c,510,478,560,9,C.line,4);box(c,510,478,560*rp.ratio,9,C.olive,4)
      this.button('rename',312,568,240,60,'修改指挥官名称',()=>this.rename(),'light')
    }else if(type==='tasks'){
      MISSIONS.forEach((m,i)=>{const y=270+i*112,done=s.claimed.includes(m.id),progress=missionProgress(s,m),ready=progress>=m.goal;icon(c,'tasks',345,y+40,30,C.olive);text(c,m.name,380,y+18,21,C.ink,700)
        const legacy=m.id==='hold'&&s.bestWave>=5&&s.recruitedTroops<m.goal
        text(c,legacy?'旧版坚守目标已完成，原奖励仍可领取':`${m.desc}  ${Math.min(progress,m.goal)} / ${m.goal}`,380,y+52,16,C.muted);text(c,`奖励 ${m.reward} 金币`,760,y+35,16,C.gold,600)
        this.button('claim-'+m.id,940,y+10,185,58,done?'已领取':ready?'领取奖励':'进行中',()=>{if(claim(s,m.id)){this.persist();this.notify(`获得 ${m.reward} 金币`)}else this.notify(done?'奖励已领取':'继续完成作战目标')},ready&&!done?'accent':'light');line(c,312,y+90,1125,y+90,C.line)})
    }else if(type==='settings'){
      ;[['effects','战斗特效','关闭爆炸粒子，减少画面开销'],['vibration','触感反馈','操作时的触感反馈'],['music','背景音乐','主界面播放军事进行曲，可随时关闭']].forEach(([key,label,sub],i)=>{const y=290+i*100;text(c,label,312,y,23,C.ink,700);text(c,sub,312,y+37,16,C.muted);this.button('toggle-'+key,935,y-15,190,62,s.settings[key]?'已开启':'已关闭',()=>{s.settings[key]=!s.settings[key];if(key==='music')setMusicEnabled(s.settings.music);this.persist()},s.settings[key]?'accent':'light')})
      text(c,'进度自动保存在当前设备。战斗进行中退出不会保存战场。',312,575,16,C.muted);text(c,'指挥前线  /  原型版本 0.1.0',312,625,13,C.muted)
    }else if(type==='pause'){
      text(c,'部队正在等待你的下一道命令。',720,338,25,C.ink,600,'center');text(c,'离开战场会按当前战果结算。',720,393,17,C.muted,400,'center')
      this.button('resume',486,465,468,65,'继续战斗',()=>{this.modal=null},'accent');this.button('leave',486,548,468,60,'结束行动并结算',()=>this.open('retreat'),'light')
    }else if(type==='retreat'){
      text(c,'本次行动将结束，获得已击败敌军的战果奖励。',720,350,22,C.ink,600,'center');this.button('cancel',350,510,350,65,'继续作战',()=>{this.modal=null},'light');this.button('confirm-retreat',740,510,350,65,'结束并结算',()=>{this.battle.done=true;this.battle.won=false;this.finish()},'dark')
    }else if(type==='result'){
      const r=this.result,b=this.battle;icon(c,b.won?'flag':'shield',720,302,55,b.won?C.olive:C.gold)
      text(c,b.regionId&&b.won?`${b.regionName}已占领，幸存部队留驻。`:b.won?'阵地已控制，行动目标达成。':'本次行动已结束，请整备后再战。',720,362,26,C.ink,700,'center');text(c,`歼敌 ${r.kills}${b.units?' 人':''}    ·    第 ${r.wave} 波    ·    ${Math.floor(b.time)} 秒`,720,410,18,C.muted,400,'center')
      text(c,`+ ${r.coins} 金币       + ${r.xp} 军功`,720,469,28,C.gold,700,'center')
      if(b.units)text(c,b.annihilated?`出战部队全军覆灭 · 阵亡 ${r.directDeaths||0} 人 · 无人员撤回`:`战损 ${r.lostTroops} 人 · 阵亡 ${r.directDeaths||0} 人 · 轻伤 ${r.woundedLight||0} 人 · 重伤 ${r.woundedHeavy||0} 人`,720,515,15,r.lostTroops?C.red:C.muted,600,'center')
      if(b.mode==='campaign'){
        const captured=WEAPONS.filter(weapon=>r.capturedWeapons?.[weapon.id]>0).map(weapon=>`${weapon.name} ×${r.capturedWeapons[weapon.id]}`).join(' · ')
        text(c,captured?'缴获入库：'+captured:'本次无缴获武器',720,544,15,captured?C.olive:C.muted,600,'center')
      }
      this.button('home',312,563,280,65,'返回指挥部',()=>this.home(),'light')
      this.button('next',620,563,505,65,b.regionId?'查看交战地区':b.won&&b.mode==='campaign'&&b.level<12?'进军下一关':'再次部署',()=>b.regionId?this.openRegion(b.regionId):this.start(b.mode,b.mode==='campaign'&&b.won?Math.min(12,b.level+1):b.level),'accent','arrow')
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
