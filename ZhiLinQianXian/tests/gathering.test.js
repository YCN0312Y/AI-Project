import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation,splitGarrisonUnit} from '../js/state.js'
import {formationActivity} from '../js/base.js'
import {MAP_REGIONS} from '../js/world-map.js'
import {occupyRegion,recallRegion,regionRecord,regionUnits} from '../js/regions.js'
import {marchOrigin,startMarch} from '../js/marching.js'
import {stationTroops,placeVillageFacility} from '../js/villages.js'
import {startGathering,stopGathering,GATHER_INTERVAL} from '../js/gathering.js'
import {startProduction,startBandageProduction,startTreatment,recallFacility,advanceFacilities} from '../js/facilities.js'
import {advanceEconomy} from '../js/economy.js'
import {autoCookMeal,serveMealNow} from '../js/logistics.js'
import {Game} from '../js/game.js'

const mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops).id
const forest=MAP_REGIONS.find(site=>site.type==='forest'&&!site.enemyTroops).id
const enemyMountain=MAP_REGIONS.find(site=>site.type==='mountain'&&site.enemyTroops).id
const river=MAP_REGIONS.find(site=>site.type==='river'&&!site.enemyTroops).id
function ready(count=5){
  const s=freshSave();s.cookedRice=1000
  for(let i=0;i<count;i++)assert(setFormation(s,'squad',10).ok)
  return s
}
const step=(s,seconds)=>advanceEconomy(s,seconds,()=>1)

test('材料采集要求正确地形和本地驻军，入库时保留驻军和刷新进度',()=>{
  let s=ready();assert(occupyRegion(s,mountain,[1]).ok);assert(occupyRegion(s,forest,[2]).ok)
  for(const [site,ids,material] of [[forest,[2],'ore'],[mountain,[1],'wood'],[mountain,[2],'ore'],[enemyMountain,[3],'ore'],[forest,[2,2],'wood']])assert.equal(startGathering(s,site,ids,material).ok,false)
  assert(startGathering(s,mountain,[1],'ore').ok);assert(startGathering(s,forest,[2],'grass').ok)
  assert.equal(startGathering(s,forest,[2],'wood').ok,false);assert.equal(formationActivity(s,1),'gathering');assert.equal(recallRegion(s,mountain,1).ok,false)
  step(s,GATHER_INTERVAL-1);assert.deepEqual(s.materials,{ore:0,wood:0,grass:0})
  const old=structuredClone(s);old.gatheringTasks[mountain]=old.gatheringTasks[mountain].ore;old.gatheringTasks[forest]=old.gatheringTasks[forest].grass
  assert.deepEqual(normalizeSave(old),s)
  s=normalizeSave(s);assert.equal(s.gatheringTasks[mountain].ore.elapsed,GATHER_INTERVAL-1);step(s,1)
  assert.deepEqual(s.materials,{ore:10,wood:0,grass:10})
  assert(stopGathering(s,forest,'grass'));assert.equal(formationActivity(s,2),'region');assert(startGathering(s,forest,[2],'wood').ok)
  step(s,GATHER_INTERVAL);assert.deepEqual(s.materials,{ore:20,wood:10,grass:10})
  const invalid=structuredClone(s);invalid.gatheringTasks[forest].wood.unitIds=[1]
  assert.equal(normalizeSave(invalid).gatheringTasks[forest],undefined)
})

test('同一树林的木头和干草各自占用部队、保存和结算，结束一项不影响另一项',()=>{
  let s=ready(2);assert(occupyRegion(s,forest,[1,2]).ok)
  assert(startGathering(s,forest,[1],'wood').ok);step(s,39)
  assert.equal(startGathering(s,forest,[1],'grass').ok,false)
  assert.equal(startGathering(s,forest,[2],'wood').ok,false)
  assert(startGathering(s,forest,[2],'grass').ok);step(s,15)
  const restored=normalizeSave(s);assert.deepEqual(restored,s);s=restored
  step(s,6);assert.deepEqual(s.materials,{ore:0,wood:10,grass:0})
  assert.equal(s.gatheringTasks[forest].grass.elapsed,21)
  assert(stopGathering(s,forest,'wood'));assert.equal(formationActivity(s,1),'region');assert.equal(formationActivity(s,2),'gathering')
  assert.equal(recallRegion(s,forest,2).ok,false)
  step(s,39);assert.deepEqual(s.materials,{ore:0,wood:10,grass:10})
})

test('苍狼峰本地待命的分出排能独自采矿，刷新后继续并在停工后回到上级所在地',()=>{
  const site=MAP_REGIONS.find(site=>site.name==='苍狼峰').id
  let s=ready(0)
  s.troops=400
  assert(setFormation(s,'battalion',400,null,{}).ok)
  regionRecord(s,site).enemies=[]
  assert(occupyRegion(s,site,[1]).ok)
  const company=splitGarrisonUnit(s,1,'company',100).unit
  assert(occupyRegion(s,site,[company.id]).ok)
  assert(recallRegion(s,site,1).ok)
  const platoon=splitGarrisonUnit(s,company.id,'platoon',40).unit
  const g=Object.create(Game.prototype),labels=[]
  Object.assign(g,{save:s,scene:'world-map',modal:null,buttons:[],persist(){},notify(){}})
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText(value,x){labels.push({value:String(value),x})}},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  const draw=()=>{g.buttons=[];labels.length=0;g.drawModal()}
  const click=id=>{const button=g.buttons.find(b=>b.id===id);assert(button,id);button.fn()}

  assert.deepEqual(regionUnits(s,site).map(unit=>unit.id),[company.id])
  assert.equal(startGathering(s,mountain,[platoon.id],'ore').ok,false)
  g.openRegion(site);draw();click('region-gather');draw()
  const companyLabel=labels.find(label=>label.value==='☐ 1营-1连')
  const platoonLabel=labels.find(label=>label.value==='☐ 1营-1连-1排')
  assert(companyLabel&&platoonLabel&&platoonLabel.x>companyLabel.x)
  click('facility-unit-'+platoon.id);draw()
  assert(labels.some(label=>label.value==='派部队采集矿石 · 每分钟 40 份'))
  click('gather-start');draw()
  assert.deepEqual(s.gatheringTasks[site].ore.unitIds,[platoon.id])
  assert.equal(formationActivity(s,company.id),'region')
  assert.equal(formationActivity(s,platoon.id),'gathering')
  assert.equal(startMarch(s,'region',mountain,[platoon.id]).ok,false)

  assert(recallRegion(s,site,company.id).ok);assert(occupyRegion(s,mountain,[company.id]).ok)
  step(s,GATHER_INTERVAL-1);s=g.save=normalizeSave(s)
  assert.equal(s.gatheringTasks[site].ore.elapsed,GATHER_INTERVAL-1)
  assert.equal(marchOrigin(s,platoon.id),site)
  assert.deepEqual(step(s,1).gathered,[{material:'ore',amount:40}])
  g.openRegion(site);draw();click('region-gather');draw();click('gather-stop')
  assert.equal(s.gatheringTasks[site],undefined)
  assert.equal(formationActivity(s,platoon.id),null)
  assert.equal(marchOrigin(s,platoon.id),mountain)
})

test('制造依照各游戏配方扣原料，缺料停工，补料后重新计时且不扣商店额度',()=>{
  const recipes=[['rifle',{ore:10,wood:5,grass:8},{ore:0,wood:0,grass:8}],['pistol',{ore:8,wood:3,grass:8},{ore:3,wood:1,grass:8}],['grenades',{ore:7,wood:0,grass:8},{ore:2,wood:0,grass:8}]]
  for(const [product,materials,expected] of recipes){
    const s=ready(1),shop=structuredClone(s.shopStock),coins=s.coins;assert(startProduction(s,[1],product).ok)
    advanceFacilities(s,300);assert.equal(s.armoryTasks[product].elapsed,0);assert.equal(s.productionTotals[product],0)
    s.materials=materials;advanceFacilities(s,59);assert.equal(s.productionTotals[product],0)
    assert.deepEqual(advanceFacilities(s,1).produced,[{product,amount:1}]);assert.deepEqual(s.materials,expected)
    advanceFacilities(s,300);assert.equal(s.productionTotals[product],1);assert.deepEqual(s.shopStock,shop);assert.equal(s.coins,coins)
  }
})

test('预先派驻的生产在采集材料入库后才推进，整段与逐秒推进一致',()=>{
  const s=ready();assert(occupyRegion(s,mountain,[1]).ok);assert(occupyRegion(s,forest,[2,3]).ok)
  assert(stationTroops(s,1,[4]).ok);assert(stationTroops(s,2,[5]).ok);assert(placeVillageFacility(s,'armory',1).ok);assert(placeVillageFacility(s,'medical',2).ok)
  assert(startGathering(s,mountain,[1],'ore').ok);assert(startGathering(s,forest,[2],'wood').ok);assert(startGathering(s,forest,[3],'grass').ok)
  assert(startProduction(s,[4],'rifle').ok);assert(startBandageProduction(s,[5]).ok);assert.equal(startTreatment(s,'light',[5]).ok,false)
  assert.equal(placeVillageFacility(s,'medical',3).ok,false)
  step(s,60);assert.equal(s.bandageTask.elapsed,0);assert.equal(s.armoryTasks.rifle.elapsed,0);assert.deepEqual(s.materials,{ore:10,wood:10,grass:10})
  const split=normalizeSave(s);step(s,300);for(let i=0;i<300;i++)step(split,1);assert.deepEqual(s,split)
  assert.equal(s.bandages,50);assert.equal(s.productionTotals.rifle,5);assert.deepEqual(s.materials,{ore:10,wood:35,grass:10})
  assert(recallFacility(s,'bandages'));assert.equal(formationActivity(s,5),'garrison')
})

test('树林采集与医疗部绷带入口可操作，成果分别出现在仓库',()=>{
  const s=ready(3),g=Object.create(Game.prototype),labels=[]
  Object.assign(g,{save:s,scene:'lobby',modal:null,buttons:[],persist(){},notify(){}})
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText(value){labels.push(String(value))}},{get:(obj,key)=>obj[key]??(()=>{}),set:(obj,key,value)=>(obj[key]=value,true)})
  const draw=()=>{g.buttons=[];labels.length=0;g.drawModal();assert(g.buttons.every(b=>b.x+b.w<=1170&&b.y+b.h<=680))}
  const click=id=>{const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn()}
  assert(occupyRegion(s,forest,[1,3]).ok);assert(stationTroops(s,2,[2]).ok);assert(placeVillageFacility(s,'medical',2).ok)
  g.openRegion(forest);draw();click('region-gather');draw();assert(g.buttons.some(b=>b.id==='gather-material-wood'))
  click('gather-material-grass');click('facility-unit-1');draw();click('gather-start');draw()
  click('gather-material-wood');draw();assert(!g.buttons.some(b=>b.id==='facility-unit-1'));click('facility-unit-3');draw();click('gather-start');draw()
  assert(labels.includes('木头 · 已派 10 人'));assert(labels.includes('干草 · 已派 10 人'))
  step(s,60);assert.equal(s.materials.grass,10);assert.equal(s.materials.wood,10)
  click('gather-stop');assert(!s.gatheringTasks[forest].wood);assert(s.gatheringTasks[forest].grass)
  g.open('warehouse');draw();click('tab-materials');draw();assert(labels.includes('干草'));assert(labels.includes('木头'))
  g.openVillage(2);draw();click('village-medical');draw();click('medical-ward-bandages');draw();click('facility-unit-2');draw();click('facility-start')
  step(s,60);g.open('warehouse');draw();click('tab-medical');draw();assert.equal(s.bandages,10);assert(labels.includes('绷带'))
})

test('河流驻军后台捕鱼，鲜鱼刷新保留，可在后勤仓库查看并在灶房加工供餐',()=>{
  const g=Object.create(Game.prototype),labels=[]
  let s=ready(2);s.cookedRice=0
  Object.assign(g,{save:s,scene:'lobby',modal:null,buttons:[],persist(){},notify(){}})
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText(value){labels.push(String(value))}},{get:(obj,key)=>obj[key]??(()=>{}),set:(obj,key,value)=>(obj[key]=value,true)})
  const draw=()=>{g.buttons=[];labels.length=0;g.drawModal();assert(g.buttons.every(b=>b.x+b.w<=1170&&b.y+b.h<=680))}
  const click=id=>{const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn()}
  assert.equal(startGathering(s,river,[1],'fish').ok,false)
  assert(occupyRegion(s,river,[1]).ok);assert(occupyRegion(s,mountain,[2]).ok)
  assert.equal(startGathering(s,mountain,[2],'fish').ok,false)
  assert.equal(startGathering(s,river,[2],'fish').ok,false)
  g.openRegion(river);draw();assert(labels.includes('安排捕鱼'));click('region-gather');draw()
  click('facility-unit-1');draw();click('gather-start');draw()
  assert(labels.includes('10 人 · 捕鱼中'));assert.equal(recallRegion(s,river,1).ok,false)
  g.home();step(s,GATHER_INTERVAL-1);assert.equal(s.fish,0)
  s=g.save=normalizeSave(s);assert.equal(s.gatheringTasks[river].fish.elapsed,GATHER_INTERVAL-1)
  assert.deepEqual(step(s,1).gathered,[{material:'fish',amount:10}]);assert.equal(s.fish,10)
  assert.deepEqual(autoCookMeal(s,()=>0),{});assert.equal(s.cookedFish,0)
  g.open('warehouse');draw();click('tab-logistics');draw();assert(labels.includes('鲜鱼'))
  g.openRegion(river);draw();click('region-gather');draw();click('gather-kitchen');draw()
  click('kitchen-preset-5');draw();click('cook-cookedFish')
  assert.equal(s.fish,5);assert.equal(s.cookedFish,5);assert.deepEqual(normalizeSave(s),s)
  assert.equal(serveMealNow(s).consumed,5);assert.equal(s.cookedFish,0);assert.equal(s.fish,5)
  assert(stopGathering(s,river,'fish'));assert.equal(formationActivity(s,1),'region')
})
