import test from 'node:test'
import assert from 'node:assert/strict'
import { freshSave,normalizeSave,setFormation,formation,formationResources,reinforceFormation,mergeFormations,unmergeFormation,removeFormation,settle } from '../js/state.js'
import {farmTaskAt, startFarming,advanceFarming,cancelFarming,formationActivity,assignFormations,releaseFormations } from '../js/base.js'
import { campaignDeployment } from '../js/campaign.js'
import { Game } from '../js/game.js'
import {stationTroops} from '../js/villages.js'
import {MAP_FIELDS} from '../js/world-map.js'

const empty={rifle:0,pistol:0,machinegun:0,sniper:0,mortar:0}
function game(s=freshSave()){
  const g=Object.create(Game.prototype);g.save=s;g.scene='lobby';g.modal=null;g.notify=()=>{};g.persist=()=>{};g.buttons=[]
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});return g
}
function draw(g){g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
function click(g,id){const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn()}

test('无枪和缺枪可以创建及补员，原有武器保留，可单独给缺枪人员补发',()=>{
  const s=freshSave();s.weaponCounts={...empty};assert(setFormation(s,'squad',9,null,{}).ok)
  assert.equal(formation(s).armedTroops,0);assert.equal(s.formations[0].troops,9)
  assert(reinforceFormation(s,1,3,{}).ok);assert.equal(s.formations[0].troops,12)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  assert.deepEqual(campaignDeployment(s,[1]).units[0].groups,[{weapon:null,troops:12}])
  s.weaponCounts.rifle=12;assert(reinforceFormation(s,1,0,{rifle:7}).ok);assert.equal(s.formations[0].weapons.rifle,7)
  assert.equal(campaignDeployment(s,[1]).units[0].groups.find(group=>!group.weapon).troops,5)
  assert(reinforceFormation(s,1,0,{rifle:5}).ok);assert(campaignDeployment(s,[1]).ok)
  assert.equal(reinforceFormation(s,1,0,{rifle:1}).ok,false)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('无武器编制遭遇伤亡时不凭空产生枪，部分配枪损失按武装与未武装人员一起分配',()=>{
  const s=freshSave();s.weaponCounts={...empty,rifle:3};setFormation(s,'squad',10)
  const b={mode:'campaign',units:[{id:1,hp:4}],won:false,level:1,wave:1,kills:0}
  settle(s,b);assert.equal(s.formations[0].troops,4);assert.equal(s.formations[0].weapons.rifle,1);assert.equal(s.weaponCounts.rifle,1)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const t=freshSave();t.weaponCounts={...empty};setFormation(t,'squad',10)
  settle(t,{mode:'campaign',units:[{id:1,hp:4}],won:false,level:1,wave:1,kills:0});assert.deepEqual(t.weaponCounts,empty);assert.deepEqual(t.formations[0].weapons,empty)
})

test('代耕和自耕均可派无枪合编，按全体人数产出，父子占用且存档恢复不重复扣未编人员',()=>{
  for(const type of ['help','self']){
    const s=freshSave();s.weaponCounts={...empty};for(let i=0;i<3;i++)assert(setFormation(s,'squad',7).ok)
    const root=mergeFormations(s,[1,2,3]).unit;const unassigned=formation(s).unassignedTroops
    assert(startFarming(s,type,0,'rice',[root.id]).ok);assert.equal(s.farmTask.workers,21);assert.equal(formation(s).unassignedTroops,unassigned)
    assert.equal(formation(s).farmingTroops,21);assert.equal(formationActivity(s,1),'farm');assert.equal(formationActivity(s,root.id),'farm')
    assert.equal(campaignDeployment(s,[root.id]).ok,false)
    assert.equal(unmergeFormation(s,root.id).ok,false);assert.equal(setFormation(s,'squad',8,1).ok,false);assert.equal(removeFormation(s,1),false)
    assert.equal(startFarming(s,type,0,'rice',[1]).ok,false)
    const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s);assert.equal(formationActivity(restored,root.id),'farm')
    const result=advanceFarming(restored,60);assert.equal(result.amount,type==='help'?6:63)
    assert.equal(formationActivity(restored,1),null);assert.equal(formation(restored).unassignedTroops,unassigned+(type==='help'?5:0))
    assert(unmergeFormation(restored,root.id).ok);assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
  }
})

test('整个编制耕作不受散兵100人上限限制，召回释放全部人员但不发奖励',()=>{
  const s=freshSave();s.troops=150;s.weaponCounts={...empty};assert(setFormation(s,'company',150).ok)
  assert(startFarming(s,'self',0,'corn',[1]).ok);assert.equal(s.farmTask.workers,150);assert.equal(formation(s).unassignedTroops,0)
  assert(cancelFarming(s));assert.equal(formationActivity(s,1),null);assert.equal(s.corn,0)
  assert(startFarming(s,'self',0,'corn',[1]).ok);assert.equal(advanceFarming(s,60).amount,450);assert.equal(s.corn,450)
})

test('耕作与出战双向互斥，其他空闲编制仍可出战，结算后释放占用',()=>{
  const s=freshSave();for(let i=0;i<3;i++)setFormation(s,'squad',10)
  assert(startFarming(s,'help',0,'millet',[1]).ok);assert.equal(campaignDeployment(s,[1]).ok,false)
  const g=game(s);g.start('campaign',1,[2]);assert.equal(g.scene,'battle');assert.equal(formationActivity(s,2),'battle')
  assert.equal(campaignDeployment(s,[2]).ok,false);assert(campaignDeployment(s,[3]).ok)
  assert(cancelFarming(s));assert.equal(startFarming(s,'self',0,'millet',[2]).ok,false)
  assert(startFarming(s,'self',0,'millet',[1]).ok);assert.equal(setFormation(s,'squad',11,2).ok,false)
  g.battle.done=true;g.battle.won=false;g.finish();assert.equal(formationActivity(s,2),null);assert.equal(formationActivity(s,1),'farm')
  cancelFarming(s);assert(startFarming(s,'self',0,'millet',[2]).ok)
})

test('耕作不能用重复/下属/不存在编制冒领产出，散兵耕作仍占未编额度',()=>{
  const s=freshSave();for(let i=0;i<3;i++)setFormation(s,'squad',7);const parent=mergeFormations(s,[1,2,3]).unit
  for(const ids of [[],[parent.id,parent.id],[parent.id,1],[999]]){const before=JSON.stringify(s);assert.equal(startFarming(s,'self',0,'millet',ids).ok,false);assert.equal(JSON.stringify(s),before)}
  assert(startFarming(s,'self',90,'millet').ok);assert.equal(formation(s).unassignedTroops,9)
  assert.equal(setFormation(s,'platoon',25).ok,false);assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('无枪创建与编制耕地界面可操作，显示占用并阻止上战场，召回归队后释放',()=>{
  const s=freshSave(),g=game(s);g.editFormation();draw(g);click(g,'formation-unarmed');click(g,'formation-save')
  assert.deepEqual(s.formations[0].weapons,empty)
  assert(stationTroops(s,MAP_FIELDS[0].villageId,[1]).ok)
  g.openMapField(MAP_FIELDS[0].id);draw(g);click(g,'farm-unit-1');draw(g);click(g,'farm-start')
  assert.deepEqual(farmTaskAt(s,MAP_FIELDS[0].id).unitIds,[1]);assert.equal(farmTaskAt(s,MAP_FIELDS[0].id).workers,7);draw(g)
  g.openCampaignDeployment(1);g.toggleDeployment(1);assert.deepEqual(g.deploymentIds,[])
  g.openMapField(MAP_FIELDS[0].id);draw(g);click(g,'farm-cancel');g.updateLogistics(1);assert.equal(farmTaskAt(s,MAP_FIELDS[0].id),null)
  g.open('formation');draw(g);g.openFormationList('squad');draw(g)
})

test('战中阵亡部队的内部编号在行动结束前不被新部队复用',()=>{
  const s=freshSave();setFormation(s,'squad',10);assert(assignFormations(s,[1],'battle'))
  s.formations=[];assert(setFormation(s,'squad',7,null,{}).ok);assert.equal(s.formations[0].id,2)
  assert.equal(formationActivity(s,2),null);releaseFormations(s,'battle')
})

test('已有旅卸下593把轻机枪，士兵保留，武器释放后可给别的编制使用',()=>{
  const s=freshSave();s.troops=4000;s.weaponCounts={...empty,machinegun:593};s.equippedWeapon='machinegun'
  assert(setFormation(s,'brigade',3000,null,{machinegun:593}).ok)
  assert(setFormation(s,'squad',10,null,{}).ok)
  assert(reinforceFormation(s,1,0,{},3000,true).ok)
  assert.equal(s.formations[0].troops,3000)
  assert.deepEqual(s.formations[0].weapons,empty);assert.equal(s.weaponCounts.machinegun,593)
  assert.equal(formationResources(s).weapons.machinegun,593)
  assert(reinforceFormation(s,2,0,{machinegun:10},10,true).ok)
  assert.equal(formationResources(s).weapons.machinegun,583);assert.equal(s.weaponCounts.machinegun,593)
  const before=JSON.stringify(s)
  for(const weapons of [{machinegun:3001},{machinegun:-1},{machinegun:1.5},{rifle:1},{laser:1}])assert.equal(reinforceFormation(s,1,0,weapons,3000,true).ok,false)
  assert.equal(reinforceFormation(s,1,0,{},2999,true).ok,false);assert.equal(JSON.stringify(s),before)
  assert.deepEqual(normalizeSave(s),s)
})

test('下属卸枪和重配同步上级，执行任务时不能卸枪，库存不重复增加',()=>{
  const s=freshSave();s.weaponCounts={...empty,rifle:20}
  for(let i=0;i<3;i++)assert(setFormation(s,'squad',10,null,i===2?{}:{rifle:10}).ok)
  const root=mergeFormations(s,[1,2,3]).unit
  assert(reinforceFormation(s,1,0,{},10,true).ok);assert.equal(root.weapons.rifle,10)
  assert(reinforceFormation(s,3,0,{rifle:10},10,true).ok);assert.equal(root.weapons.rifle,20)
  assert.equal(s.weaponCounts.rifle,20);assert.deepEqual(normalizeSave(s),s)
  assert(startFarming(s,'help',0,'rice',[root.id]).ok)
  const before=JSON.stringify(s);assert.equal(reinforceFormation(s,3,0,{},10,true).ok,false);assert.equal(JSON.stringify(s),before)
})

test('编辑已有武器可减号卸枪或全部卸下，取消不生效，补员不覆盖手动卸枪选择',()=>{
  const s=freshSave();setFormation(s,'squad',9)
  const g=game(s),stock={...s.weaponCounts};g.editFormation(s.formations[0]);draw(g)
  assert.equal(g.formationDraft.weapons.rifle,9);click(g,'formation-weapon-minus-rifle')
  assert.equal(g.formationDraft.weapons.rifle,8);assert.equal(s.formations[0].weapons.rifle,9)
  click(g,'formation-cancel');assert.equal(s.formations[0].weapons.rifle,9)
  g.editFormation(s.formations[0]);draw(g);click(g,'formation-unarmed');g.setFormationReinforcements(3)
  assert.deepEqual(g.formationDraft.weapons,empty);draw(g);click(g,'formation-save')
  assert.equal(s.formations[0].troops,12)
  assert.deepEqual(s.formations[0].weapons,empty);assert.deepEqual(s.weaponCounts,stock)
  assert.equal(formationResources(s).weapons.rifle,120);assert.deepEqual(normalizeSave(s),s)
})
