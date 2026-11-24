import {fitCamera,mapField} from '../js/world-map.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation,mergeFormations,unmergeFormation,removeFormation,reinforceFormation,formation,splitGarrisonUnit} from '../js/state.js'
import {stationTroops,recallGarrison,placeVillageFacility,transferArmory,villageOfFormation,villageUnits} from '../js/villages.js'
import {farmTaskAt,formationActivity,startFarming} from '../js/base.js'
import {startProduction} from '../js/facilities.js'
import {campaignDeployment} from '../js/campaign.js'
import {advanceEconomy} from '../js/economy.js'
import {Game} from '../js/game.js'
import {donateFood,validateDonation,mobilizationRecord,donationTaste,setMobilizationActive,advanceLogistics,migrateVillageMobilization,recruitmentInterval,totalPersonnel} from '../js/logistics.js'

const setup=(n=6)=>{const s=freshSave();s.materials.ore=100;s.materials.wood=100;for(let i=0;i<n;i++)assert(setFormation(s,'squad',10).ok);return s}
function game(s=setup()){
  const g=Object.create(Game.prototype);Object.assign(g,{save:s,scene:'lobby',modal:null,buttons:[],notify(message){this.message=message},persist(){}})
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  return g
}
const draw=g=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
const click=(g,id)=>{const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn()}

test('驻村不复制部队，合编全部下属同驻，任务互斥，撤回后恢复可用',()=>{
  const s=setup(),parent=mergeFormations(s,[1,2,3]).unit,before=structuredClone(s)
  assert(stationTroops(s,1,[parent.id,4]).ok)
  for(const id of [parent.id,1,2,3,4]){assert.equal(villageOfFormation(s,id),1);assert.equal(formationActivity(s,id),'garrison')}
  assert.equal(villageUnits(s,1).reduce((sum,u)=>sum+u.troops,0),40)
  assert.equal(s.troops,before.troops);assert.deepEqual(s.weaponCounts,before.weaponCounts)
  assert.equal(stationTroops(s,2,[4]).ok,false);assert.equal(stationTroops(s,2,[1]).ok,false)
  assert.equal(campaignDeployment(s,[parent.id]).ok,false);assert.equal(startFarming(s,'help',0,'millet',[4]).ok,false)
  assert.equal(removeFormation(s,4),false);assert.equal(unmergeFormation(s,parent.id).ok,false)
  assert(recallGarrison(s,1,parent.id).ok);assert.equal(villageOfFormation(s,1),null);assert(unmergeFormation(s,parent.id).ok)
  assert(recallGarrison(s,1,4).ok);assert.equal(campaignDeployment(s,[4]).ok,true)
})

test('村庄管理可给驻军补员和调整配发，保存后仍驻原村',()=>{
  const g=game(setup(1)),s=g.save;assert(stationTroops(s,1,[1]).ok)
  const initialTroops=s.troops,initialWeapons=s.weaponCounts.rifle,free=formation(s).unassignedTroops
  g.openVillage(1);draw(g);click(g,'village-edit-1');draw(g);assert.equal(g.modal,'formation-edit')
  click(g,'formation-plus');draw(g);click(g,'formation-plus');draw(g);click(g,'formation-save')
  assert.equal(g.modal,'village');assert.equal(villageUnits(s,1)[0].troops,12)
  assert.equal(formation(s).unassignedTroops,free-2);assert.equal(s.troops,initialTroops)
  assert.equal(reinforceFormation(s,1,1).ok,false)
  assert(reinforceFormation(s,1,0,{rifle:6},12,true).ok);assert.equal(s.weaponCounts.rifle,initialWeapons)
  assert.equal(setFormation(s,'squad',9,1).ok,false)
  const saved=normalizeSave(s);assert.equal(villageOfFormation(saved,1),1);assert.equal(villageUnits(saved,1)[0].weapons.rifle,6)
})

test('驻村合编通过下属补员，上级汇总自动更新并可返回本村',()=>{
  const g=game(setup(3)),s=g.save,parent=mergeFormations(s,[1,2,3]).unit;assert(stationTroops(s,1,[parent.id]).ok)
  g.openVillage(1);draw(g);click(g,'village-edit-'+parent.id);draw(g);click(g,'child-view-1');draw(g)
  click(g,'formation-detail-edit');draw(g);click(g,'formation-plus');draw(g);click(g,'formation-save')
  assert.equal(g.modal,'formation-detail');assert.equal(g.formationDetailId,1);assert.equal(parent.troops,31);assert.equal(parent.weapons.rifle,31)
  draw(g);click(g,'children-back');draw(g);click(g,'children-back');assert.equal(g.modal,'village');assert.deepEqual(s.garrisons[1],[parent.id])
})

test('村庄可把正在工作的兵工厂迁到我方新村，工作部队随迁继续生产，未工作驻军留守',()=>{
  const s=setup(),g=game(s)
  assert(stationTroops(s,1,[1,3]).ok);assert(stationTroops(s,2,[2]).ok)
  assert(placeVillageFacility(s,'armory',1).ok)
  assert(startProduction(s,[1],'rifle').ok)
  advanceEconomy(s,75)
  const before=structuredClone(s)
  assert.equal(transferArmory(s,3).ok,false);assert.deepEqual(s,before)
  g.openVillage(1);draw(g);click(g,'village-transfer-armory')
  fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap();click(g,'map-site-2')
  g.buttons=[];g.drawWorldMap();click(g,'armory-transfer-cancel')
  assert.equal(g.villageId,1);assert.equal(g.modal,'village');assert.deepEqual(s,before)
  g.openVillage(2);draw(g);click(g,'village-transfer-armory')
  g.buttons=[];g.drawWorldMap();click(g,'armory-transfer-confirm')
  assert.equal(g.villageId,2);assert.equal(g.modal,'village')
  assert.equal(s.facilityVillages.armory,2);assert.equal(s.armoryTasks.rifle.villageId,2);assert.equal(s.armoryTasks.rifle.elapsed,15)
  assert.equal(villageOfFormation(s,1),2);assert.equal(formationActivity(s,1),'armory')
  assert.equal(villageOfFormation(s,3),1);assert.equal(formationActivity(s,3),'garrison')
  assert.deepEqual(normalizeSave(s),s)
  advanceEconomy(s,45);assert.equal(s.productionTotals.rifle,2)
  assert.equal(startProduction(s,[3],'rifle',2).ok,false)
  assert(startProduction(s,[2],'rifle',2).ok)
  advanceEconomy(s,120);assert.equal(s.productionTotals.rifle,6)
  g.openVillage(2);draw(g);click(g,'village-armory');draw(g)
  click(g,'facility-unit-stop-1');assert.equal(formationActivity(s,1),'garrison')
  assert.deepEqual(s.armoryTasks.rifle.unitIds,[2])
})

test('迁厂只带走实际派驻的工人，同一编制在原村的代耕和留守继续',()=>{
  const s=setup(),field=mapField('field-1')
  const crew=troops=>[{unitId:1,troops,type:'group'}]
  assert(stationTroops(s,1,[1]).ok);assert(stationTroops(s,2,[2]).ok)
  assert(placeVillageFacility(s,'armory',1).ok)
  assert(startFarming(s,'help',0,field.crop,[1],field.id,crew(3)).ok)
  assert(startProduction(s,[1],'pistol',1,crew(7)).ok)
  advanceEconomy(s,20)
  const fieldBefore=structuredClone(farmTaskAt(s,field.id))
  assert(transferArmory(s,2).ok)
  assert.deepEqual(farmTaskAt(s,field.id),fieldBefore)
  assert.deepEqual(s.garrisons,{1:[1],2:[2]})
  const restored=normalizeSave(s);assert.deepEqual(restored,s)
  assert.equal(restored.armoryTasks.pistol.workers,7);assert.equal(restored.armoryTasks.pistol.elapsed,20)
  advanceEconomy(restored,40);assert.equal(restored.productionTotals.pistol,1)
  assert(transferArmory(restored,1).ok)
  assert(!Object.hasOwn(restored.armoryTasks.pistol.allocations[0],'remote'))
  assert.deepEqual(normalizeSave(restored),restored)
})

test('村庄可拆除正在工作的兵工厂，取消时保留工单，确认后释放人员',()=>{
  const s=setup(),g=game(s),oldWx=globalThis.wx
  let confirmation
  globalThis.wx={showModal:options=>{confirmation=options}}
  try{
    assert(stationTroops(s,1,[1,2]).ok);assert(placeVillageFacility(s,'armory',1).ok)
    assert(startProduction(s,[1],'rifle').ok);assert(startProduction(s,[2],'pistol').ok)
    advanceEconomy(s,75)
    const before=structuredClone(s)
    g.openVillage(1);draw(g);click(g,'village-remove-armory')
    confirmation.success({confirm:false});assert.deepEqual(s,before)
    click(g,'village-remove-armory');confirmation.success({confirm:true});draw(g)
    assert.equal(s.facilityVillages.armory,null);assert.deepEqual(s.armoryTasks,{})
    for(const key of ['garrisons','weaponCounts','materials','productionTotals','troops'])assert.deepEqual(s[key],before[key])
    assert.equal(formationActivity(s,1),'garrison');assert.deepEqual(normalizeSave(s),s)
  }finally{if(oldWx===undefined)delete globalThis.wx;else globalThis.wx=oldWx}
})

test('旧兵工厂首次选址保留人员和生产进度',()=>{
  const s=setup();s.cookedRice=100;assert(startProduction(s,[1],'pistol').ok)
  advanceEconomy(s,3)
  assert(placeVillageFacility(s,'armory',4).ok)
  assert.equal(s.armoryTasks.pistol.elapsed,3)
  assert.equal(villageOfFormation(s,1),4);assert.deepEqual(normalizeSave(s),s)
})

test('非法驻军及冲突存档不重复占兵，非法跨村设施人员不能恢复',()=>{
  const s=setup();s.garrisons={1:[1,1,999],2:[1,2]};s.facilityVillages={armory:1,medical:1}
  const loaded=normalizeSave(s);assert.deepEqual(loaded.garrisons,{1:[1],2:[2]});assert.deepEqual(loaded.facilityVillages,{armory:1})
  assert(startProduction(loaded,[1],'rifle',1).ok)
  const invalid=structuredClone(loaded);invalid.armoryTasks.rifle.unitIds=[2]
  assert.equal(normalizeSave(invalid).armoryTasks.rifle,undefined)
  const farm=setup();startFarming(farm,'help',0,'millet',[1]);farm.garrisons={1:[1]}
  const cleaned=normalizeSave(farm);assert(cleaned.farmTask);assert.deepEqual(cleaned.garrisons,{})
})

test('兵工厂和口粮的边界推进一致，极度饥饿时暂停生产',()=>{
  const a=setup();a.cookedRice=100;stationTroops(a,1,[1]);stationTroops(a,2,[2]);stationTroops(a,3,[3]);placeVillageFacility(a,'armory',3)
  startProduction(a,[3],'pistol',3)
  const b=structuredClone(a);advanceEconomy(a,300);for(let i=0;i<300;i++)advanceEconomy(b,1);assert.deepEqual(a,b)
  assert.equal(a.productionTotals.pistol,10)
  a.hungerDebt=3;a.cookedRice=0;advanceEconomy(a,5);assert.equal(a.armoryTasks.pistol.elapsed,0)
  assert.equal(villageOfFormation(a,3),3)
})

test('地图进入村庄可滚动选择驻军与选址，关闭事务返回本村，界面按钮不越界',()=>{
  const g=game();g.openWorldMap();g.buttons=[];g.drawWorldMap();click(g,'map-site-1');assert.equal(g.modal,'village-station');draw(g)
  click(g,'station-unit-1');g.scrollRoster(g.rosterScroll.max);draw(g);click(g,'station-unit-5');click(g,'station-confirm')
  assert.equal(g.save.garrisons[1],undefined);g.updateMapMarches(10000);g.openVillage(1);assert.deepEqual(g.save.garrisons[1],[1,5]);assert.equal(g.modal,'village');draw(g)
  assert(!g.buttons.some(button=>button.id==='village-training'))
  click(g,'village-armory');assert.equal(g.save.facilityVillages.armory,1);draw(g)
  assert(g.buttons.some(b=>b.id==='facility-unit-1'));assert.equal(g.buttons.some(b=>b.id==='facility-unit-2'),false)
  click(g,'facility-unit-1');draw(g);click(g,'facility-start');assert(g.save.armoryTasks.rifle);draw(g);click(g,'base-return');assert.equal(g.modal,'village')
  draw(g);assert.equal(g.buttons.some(b=>b.id==='village-medical'),false);assert.equal(g.modal,'village')
  click(g,'village-back');assert.equal(g.modal,null);assert.equal(g.localVillage,null)
})

test('根据地不再提供帮助耕田、兵工厂、医疗部、训练场，地图田地仍可独立派兵',()=>{
  const g=game(),labels=[];g.ctx.fillText=value=>labels.push(String(value));g.open('base');draw(g)
  for(const id of ['base-farm','base-base-armory','base-base-medical','base-training'])assert.equal(g.buttons.some(b=>b.id===id),false)
  for(const label of ['帮助耕田','兵工厂','医疗部','训练场'])assert.equal(labels.includes(label),false)
  stationTroops(g.save,1,[2])
  click(g,'base-map');fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap();click(g,'map-field-field-1');assert.equal(g.modal,'farm');draw(g)
  assert(!g.buttons.some(button=>button.id==='farm-unit-1'));click(g,'farm-unit-2');draw(g);click(g,'farm-start');assert.equal(farmTaskAt(g.save,'field-1').type,'help');assert.equal(farmTaskAt(g.save,'field-1').fieldId,'field-1')
})

test('留村待命的分队同时出现在田地整队名单和部分派遣名单',()=>{
  const s=freshSave(),g=game(s),labels=[]
  g.ctx.fillText=(value,x,y)=>labels.push({value:String(value),x,y})
  assert(setFormation(s,'platoon',35).ok);assert(stationTroops(s,1,[1]).ok)
  const branch=splitGarrisonUnit(s,1,'squad',10).unit
  assert(setFormation(s,'squad',10).ok);assert(stationTroops(s,2,[3]).ok)
  g.openMapField('field-1');draw(g)
  const parent=labels.find(label=>label.value.includes('☐ 1排')),child=labels.find(label=>label.value.includes('☐ 1排-1班'))
  assert(parent&&child&&child.x>parent.x&&child.y>parent.y)
  assert(g.buttons.some(button=>button.id==='farm-unit-'+branch.id))
  assert(!g.buttons.some(button=>button.id==='farm-unit-3'))
  click(g,'farm-detach');draw(g);assert(g.buttons.some(button=>button.id==='work-root-'+branch.id))
  assert(!g.buttons.some(button=>button.id==='work-root-3'))
  click(g,'work-root-'+branch.id);draw(g);click(g,'work-confirm')
  assert.deepEqual(farmTaskAt(s,'field-1').unitIds,[branch.id]);assert.equal(farmTaskAt(s,'field-1').workers,5)
})

test('各村食物金币、口味与动员计时独立，失败不扣物资，暂停一村不影响其他村',()=>{
  const s=setup();s.millet=100;s.rice=100
  assert(donateFood(s,'millet',10,1).ok);assert(donateFood(s,'millet',10,1).ok)
  const before=structuredClone(s);assert.equal(donateFood(s,'millet',10,1).ok,false);assert.deepEqual(s,before)
  assert(donateFood(s,'millet',10,2).ok);assert(donateFood(s,'coins',10,2).ok)
  assert.equal(donationTaste(s,1).streak,2);assert.equal(donationTaste(s,2).streak,1)
  assert.equal(mobilizationRecord(s,1).mobilizationCoins,0);assert.equal(mobilizationRecord(s,2).mobilizationCoins,10)
  assert.equal(s.mobilizationFood,0);assert.equal(s.mobilizationActive,false)
  assert.equal(advanceLogistics(s,4,()=>0).recruited,0);setMobilizationActive(s,false,1)
  assert.equal(advanceLogistics(s,6,()=>0).recruited,3);assert.equal(mobilizationRecord(s,1).recruitElapsed,4);assert.equal(mobilizationRecord(s,1).mobilizationFood,20)
  setMobilizationActive(s,true,1);assert.equal(advanceLogistics(s,6,()=>0).recruited,1)
  assert.equal(mobilizationRecord(s,1).recruitedTroops,1);assert.equal(mobilizationRecord(s,2).recruitedTroops,3);assert.equal(s.recruitedTroops,4)
  const saved=structuredClone(s);assert.equal(validateDonation(s,'coins',100,99).ok,false);assert.deepEqual(s,saved)
})

test('多村同时报名共用总人数上限，其他村不白扣储备，满额进度可保存后继续',()=>{
  const s=freshSave();s.troops=9999999;s.autoCooking=false
  for(let id=1;id<=6;id++)assert(donateFood(s,'coins',10,id).ok)
  assert.equal(advanceLogistics(s,10,()=>.99).recruited,1);assert.equal(totalPersonnel(s),10000000)
  assert.equal(mobilizationRecord(s,1).mobilizationCoins,5)
  for(let id=2;id<=6;id++){assert.equal(mobilizationRecord(s,id).mobilizationCoins,10);assert.equal(mobilizationRecord(s,id).recruitElapsed,10)}
  const loaded=normalizeSave(structuredClone(s));assert.deepEqual(loaded,s)
  loaded.troops-=1;assert.equal(advanceLogistics(loaded,.01,()=>.99).recruited,1)
  assert.equal(mobilizationRecord(loaded,2).mobilizationCoins,5);assert.equal(mobilizationRecord(loaded,3).mobilizationCoins,10)
  assert.equal(advanceLogistics(loaded,20).recruited,0)
})

test('多村动员、共享代耕减耗和口粮按相同边界推进，整段与逐秒结果一致',()=>{
  const a=setup();a.cookedRice=1000;a.millet=100;a.mobilizationDiscounts=2
  donateFood(a,'millet',10,1);donateFood(a,'coins',15,2);setMobilizationActive(a,true,3)
  startFarming(a,'help',2);stationTroops(a,4,[1])
  const b=structuredClone(a);advanceEconomy(a,120,()=>.5);for(let i=0;i<120;i++)advanceEconomy(b,1,()=>.5)
  assert.deepEqual(a,b)
  assert(mobilizationRecord(a,1).recruitedTroops>0);assert(mobilizationRecord(a,2).recruitedTroops>0);assert(mobilizationRecord(a,3).recruitedTroops>0)
  assert.deepEqual(normalizeSave(structuredClone(a)),a)
})

test('旧全局动员一次迁入柳树村，赠送物资、进度和历史累计不丢失、不复制',()=>{
  const raw=freshSave();raw.millet=30;donateFood(raw,'millet',20);donateFood(raw,'coins',10);advanceLogistics(raw,7)
  raw.recruitedTroops=50;raw.recruitmentCount=10;delete raw.villageMobilizationVersion
  const loaded=normalizeSave(raw),before=structuredClone(loaded);assert.equal(loaded.villageMobilizationVersion,0)
  assert(migrateVillageMobilization(loaded));const first=mobilizationRecord(loaded,1)
  assert.equal(first.mobilizationFood,20);assert.equal(first.mobilizationCoins,10);assert.equal(first.recruitElapsed,7);assert.equal(first.lastDonationFood,'millet')
  assert.equal(loaded.mobilizationFood,0);assert.equal(loaded.mobilizationCoins,0);assert.equal(loaded.mobilizationActive,false)
  assert.equal(loaded.millet,before.millet);assert.equal(loaded.coins,before.coins);assert.equal(loaded.recruitedTroops,50)
  assert.equal(migrateVillageMobilization(loaded),false);assert.equal(advanceLogistics(loaded,3,()=>0).recruited,1)
  assert.equal(loaded.recruitedTroops,51);assert.equal(first.recruitedTroops,1)
  const restored=normalizeSave(structuredClone(loaded));assert.equal(migrateVillageMobilization(restored),false);assert.deepEqual(restored,loaded)
})

test('从不同村庄进入同一个统一动员窗口，赠送只扣一次，暂停作用于所有村庄',()=>{
  const g=game();g.save.millet=100
  for(let i=1;i<=6;i++){assert(setFormation(g.save,'squad',7).ok);assert(stationTroops(g.save,i,[g.save.formations.at(-1).id]).ok)}
  g.openWorldMap();g.buttons=[];g.drawWorldMap()
  for(const id of ['campaign','recruitment','base'])assert.equal(g.buttons.some(b=>b.id===id),false)
  for(const id of ['profile','formation','warehouse','shop','kitchen','tasks','settings'])assert(g.buttons.some(b=>b.id===id),id)
  click(g,'map-site-1');draw(g);click(g,'village-recruitment');draw(g);click(g,'recruit-food-coins');draw(g);click(g,'recruit-confirm')
  assert.equal(g.save.mobilizationCoins,20);click(g,'close');assert.equal(g.modal,'village');assert.equal(g.villageId,1)
  g.openVillage(2);draw(g);click(g,'village-recruitment');draw(g);click(g,'recruit-food-millet');draw(g);click(g,'recruit-confirm')
  assert.equal(g.save.mobilizationFood,20);assert.equal(mobilizationRecord(g.save,2).mobilizationCoins,0)
  g.updateLogistics(10,()=>0);assert.equal(g.save.recruitedTroops,18);draw(g);click(g,'recruit-toggle');click(g,'close');g.home();g.updateLogistics(10,()=>0)
  assert.equal(mobilizationRecord(g.save,1).recruitedTroops,1);assert.equal(mobilizationRecord(g.save,2).recruitedTroops,3);assert.equal(g.save.recruitedTroops,18)
  assert.equal(g.scene,'world-map');assert.equal(g.localVillage,null)
})

test('实际构造即显示地图主页，自动迁移旧动员一次，返回主页保留地图和所有常用入口',()=>{
  const oldWx=globalThis.wx,oldFrame=globalThis.requestAnimationFrame,raw=freshSave();let stored,writes=0
  raw.settings.music=false;raw.millet=20;donateFood(raw,'millet',10);advanceLogistics(raw,4);delete raw.villageMobilizationVersion;delete raw.baseVillageId;stored=structuredClone(raw)
  const context=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  globalThis.wx={createCanvas:()=>({getContext:()=>context}),getStorageSync:()=>structuredClone(stored),setStorageSync:(key,value)=>{stored=structuredClone(value);writes++},getWindowInfo:()=>({windowWidth:1440,windowHeight:810,pixelRatio:1}),onTouchStart(){},onTouchMove(){},onTouchEnd(){}}
  globalThis.requestAnimationFrame=()=>{}
  try{
    const g=new Game();assert.equal(g.scene,'world-map');assert.equal(g.modal,null);assert.equal(writes,1);assert.equal(stored.villageMobilization[1].mobilizationFood,10)
    g.render();assert(g.buttons.some(b=>b.id==='map-site-base'));assert(g.buttons.some(b=>b.id==='warehouse'));assert.equal(g.buttons.some(b=>b.id==='campaign'),false)
    g.openVillage(1);g.home();g.render();assert.equal(g.scene,'world-map');assert.equal(g.modal,null)
    const again=new Game();assert.equal(writes,1);assert.equal(mobilizationRecord(again.save,1).mobilizationFood,10);assert.equal(mobilizationRecord(again.save,1).recruitElapsed,4)
  }finally{if(oldWx===undefined)delete globalThis.wx;else globalThis.wx=oldWx;if(oldFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=oldFrame}
})
