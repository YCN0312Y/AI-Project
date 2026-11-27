import test from 'node:test'
import assert from 'node:assert/strict'
import { freshSave,normalizeSave,setFormation,mergeFormations,unmergeFormation,settle,applyBattleLosses,formation,formationMinimum,reinforcementCapacity,reinforcementWeapons,reinforceFormation,validateReinforcement,purchaseWeapon } from '../js/state.js'
import { campaignDeployment,CampaignBattle,enemyUnitSpec } from '../js/campaign.js'
import { Game } from '../js/game.js'
import {fitCamera} from '../js/world-map.js'

const roster=(count=2,troops=60)=>Array.from({length:count},(_,i)=>({id:i+1,name:`${i+1}班`,troops,groups:[{weapon:'rifle',troops}]}))

test('敌我同武器和剩余兵力时单轮伤害相同，超过80人的敌军也按实际兵力开火',()=>{
  const expected={rifle:120,pistol:60,machinegun:60,sniper:28.8,mortar:21.6}
  for(const [weapon,damage] of Object.entries(expected)){
    for(const hostile of [false,true]){
      const troops=200
      const units=[{id:1,name:'我方编制',troops,groups:[{weapon,troops}]}]
      const battle=new CampaignBattle(1,units,[{name:'敌方编制',weapon,troops}])
      battle.spawn=0;battle.update(.01)
      const friendly=battle.units[0],enemy=battle.enemies[0]
      enemy.x=friendly.x+100;enemy.y=friendly.y
      const attacker=hostile?enemy:friendly,target=hostile?friendly:enemy
      attacker.hp=120
      enemy.cool=hostile?0:10;friendly.groups[0].cool=hostile?10:0
      battle.update(.01)
      assert(Math.abs(troops-target.hp-damage)<1e-9,`${weapon} ${hostile?'敌方':'我方'}伤害为 ${troops-target.hp}`)
    }
  }
})

test('主动出战只扣通用子弹，最后几发按实际发数结算，打空后靠近敌军近战',()=>{
  const s=freshSave(),g=game(s)
  s.bullets=3;s.mortarAmmo=20;assert(setFormation(s,'squad',10).ok)
  let stored;g.persist=()=>{stored=structuredClone(s)}
  g.start('campaign',1,[1])
  const b=g.battle,unit=b.units[0]
  b.pending=0;b.enemies=[{weapon:'rifle',hp:100,maxHp:100,cool:100,x:unit.x+100,y:unit.y}]
  g.updateBattle(.21)
  assert.equal(s.bullets,0);assert.equal(stored.bullets,0);assert.equal(s.mortarAmmo,20)
  assert.equal(b.enemies[0].hp,97);assert.equal(b.kills,3)
  assert.equal(b.meleeTroops(unit),10)
  let swung=false
  for(let tick=0;tick<30&&!swung;tick++){
    g.updateBattle(.05);swung=b.shots.some(shot=>!shot.hostile&&shot.kind==='melee')
  }
  assert(swung);assert(unit.x>340);assert.equal(s.mortarAmmo,20);assert.equal(s.weaponCounts.rifle,120)
})

test('按实际被击溃敌军逐类累计武器，跨波保留，胜利才入库且只领取一次',()=>{
  const s=freshSave();setFormation(s,'squad',10)
  const b=new CampaignBattle(7,campaignDeployment(s,[1]).units);b.pending=0
  const enemy=(weapon,troops,hp=0)=>({weapon,troops,hp,maxHp:troops,x:1300,y:300,cool:100})
  b.enemies=[enemy('rifle',7),enemy('machinegun',8),enemy('mortar',9),enemy('rifle',10,10)]
  b.update(.01);assert.deepEqual(b.defeatedWeapons,{rifle:7,pistol:0,machinegun:8,sniper:0,mortar:9})
  b.update(.01);assert.equal(b.defeatedWeapons.rifle,7);assert.equal(s.weaponCounts.rifle,120)
  b.wave=2;b.enemies.push(enemy('pistol',5),enemy('sniper',6));b.update(.01)
  b.done=true;b.won=true;const result=settle(s,b)
  assert.deepEqual(result.capturedWeapons,{rifle:7,pistol:5,machinegun:8,sniper:6,mortar:9})
  assert.deepEqual(s.weaponCounts,{rifle:127,pistol:5,machinegun:8,sniper:6,mortar:9})
  assert.equal(result.capturedBullets,52)
  const stock={...s.weaponCounts};assert.equal(settle(s,b),null);assert.deepEqual(s.weaponCounts,stock)
  assert.equal(s.bullets,52)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('失败或撤退即使击败敌军也不缴获，玩家阵亡武器仍正常扣除，非闯关不发缴获',()=>{
  for(const won of [false,true]){
    const s=freshSave();s.weaponCounts.machinegun=2;setFormation(s,'squad',10,null,{rifle:8,machinegun:2})
    const b=new CampaignBattle(1,campaignDeployment(s,[1]).units)
    b.defeatedWeapons={rifle:50,pistol:20,machinegun:10,sniper:0,mortar:0};b.units[0].hp=3.7;b.done=true;b.won=won
    if(won)b.mode='defense'
    const result=settle(s,b);assert(Object.values(result.capturedWeapons).every(count=>count===0))
    assert(Object.values(result.recoveredWeapons).every(count=>count===0))
    assert.equal(result.capturedBullets,0);assert.equal(s.bullets,0)
    assert.equal(s.weaponCounts.rifle,won?120:115);assert.equal(s.weaponCounts.machinegun,won?2:1)
    assert.equal(s.weaponCounts.pistol,0)
  }
})

test('缴获受仓库上限限制，显示实际入库数量；旧战斗没有缴获记录不凭空发武器',()=>{
  const s=freshSave();s.weaponCounts.rifle=9999998;setFormation(s,'squad',10)
  const b=new CampaignBattle(1,campaignDeployment(s,[1]).units);b.won=true;b.done=true;b.defeatedWeapons.rifle=7
  b.units[0].hp=6
  const result=settle(s,b);assert.equal(result.capturedWeapons.rifle,2);assert.equal(s.weaponCounts.rifle,10000000)
  assert.equal(result.recoveredWeapons.rifle,4)
  assert.equal(result.capturedBullets,14);assert.equal(s.bullets,14)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  s.bullets=9999997
  const capped=new CampaignBattle(1,campaignDeployment(s,[1]).units);capped.won=true;capped.done=true;capped.defeatedWeapons.rifle=7
  const loot=settle(s,capped);assert.equal(loot.capturedWeapons.rifle,0);assert.equal(loot.capturedBullets,3);assert.equal(s.bullets,10000000)
  const old=new CampaignBattle(1,campaignDeployment(s,[1]).units);delete old.defeatedWeapons;old.won=true;old.done=true
  assert(Object.values(settle(s,old).capturedWeapons).every(count=>count===0));assert.equal(s.weaponCounts.rifle,10000000)
})

test('胜利结算保存缴获和回收库存，结果界面分行显示且按钮仍在面板内',()=>{
  const s=freshSave();setFormation(s,'squad',10);const g=game(s);let saved;const labels=[]
  g.persist=()=>{saved=structuredClone(s)};g.ctx.fillText=value=>labels.push(String(value))
  g.battle=new CampaignBattle(1,campaignDeployment(s,[1]).units);g.battle.won=true;g.battle.done=true
  g.battle.units[0].hp=6
  g.battle.defeatedWeapons.rifle=12;g.battle.defeatedWeapons.machinegun=3;g.finish();drawModal(g)
  assert.equal(saved.weaponCounts.rifle,132);assert.equal(saved.weaponCounts.machinegun,3)
  assert.equal(saved.bullets,30)
  assert(labels.includes('缴获入库：步枪 ×12 · 轻机枪 ×3 · 子弹 30 发'))
  assert(labels.includes('打扫战场 · 回收己方武器 · 步枪 ×4'))
})

function game(save=freshSave()){
  const g=Object.create(Game.prototype)
  g.save=save;g.scene='lobby';g.modal=null;g.buttons=[];g.notify=()=>{};g.persist=()=>{}
  g.ctx=new Proxy({}, {get:(object,key)=>object[key]??(()=>{}),set:(object,key,value)=>(object[key]=value,true)})
  return g
}
function drawModal(g){g.buttons=[];if(g.scene==='world-map'&&!g.modal){g.drawWorldMap();for(const b of g.buttons)assert(b.x>=0&&b.y>=0&&b.x+b.w<=1440&&b.y+b.h<=810,b.id)}else{g.drawModal();for(const button of g.buttons)assert(button.x>=270&&button.y>=130&&button.x+button.w<=1170&&button.y+button.h<=680,button.id)}}
function click(g,id){const button=g.buttons.find(button=>button.id===id);assert(button,id);button.fn()}

test('只部署选中的独立部队，合编下属不重复参战，保留各部队武器',()=>{
  const s=freshSave();for(let i=0;i<4;i++)assert(setFormation(s,'squad',10).ok)

  const parent=mergeFormations(s,[1,2,3]).unit,before=JSON.stringify(s)
  for(const ids of [[],[4,4],[1],[parent.id,1],[999]])assert.equal(campaignDeployment(s,ids).ok,false)
  const only=campaignDeployment(s,[4]);assert(only.ok);assert.equal(only.troops,10);assert.equal(only.units.length,1)
  const all=campaignDeployment(s,[parent.id,4]);assert(all.ok);assert.equal(all.troops,40);assert.equal(all.units.length,2)
  assert.equal(all.units[0].groups[0].troops,30)
  assert.equal(JSON.stringify(s),before)
  const b=new CampaignBattle(1,all.units);b.units[0].hp=0;b.units[0].groups[0].cool=3
  assert.equal(JSON.stringify(s),before);assert.equal(all.units[0].groups[0].cool,undefined)
})

test('原战役部署仍支持空选保护、滚动、全选、清空、取消及重新部署，村庄不作关卡',()=>{
  const s=freshSave();s.stage=2;for(let i=0;i<6;i++)assert(setFormation(s,'squad',10).ok)
  const g=game(s),before=JSON.stringify(s)
  g.open('campaign');fitCamera(g.mapCamera);drawModal(g);click(g,'map-site-3');assert.equal(g.modal,'village-station');g.openWorldMap()
  g.start('campaign',3);assert.equal(g.modal,null);assert.equal(g.scene,'world-map')
  g.start('campaign',1);assert.equal(g.modal,'campaign-deploy');assert.equal(g.scene,'world-map');assert.equal(g.battle,undefined)
  drawModal(g);click(g,'deployment-confirm');assert.equal(g.scene,'world-map')
  click(g,'deployment-unit-1');g.scrollRoster(g.rosterScroll.max);drawModal(g);click(g,'deployment-unit-5')
  assert.deepEqual(g.deploymentIds,[1,5]);click(g,'deployment-all');assert.equal(g.deploymentIds.length,6)
  click(g,'deployment-clear');assert.equal(g.deploymentIds.length,0)
  click(g,'close');assert.equal(g.modal,null);assert.equal(g.scene,'world-map');assert.equal(JSON.stringify(s),before)
  g.start('campaign',2);drawModal(g);click(g,'deployment-unit-2');drawModal(g);click(g,'deployment-confirm')
  assert.equal(g.scene,'battle');assert.equal(g.battle.level,2);assert.deepEqual(g.battle.units.map(unit=>unit.id),[2]);assert.equal(g.battle.maxHp,10)
  g.battle.done=true;g.battle.won=false;g.result=settle(s,g.battle);g.open('result');drawModal(g);click(g,'next')
  assert.equal(g.modal,'campaign-deploy');assert.equal(g.scene,'world-map');assert.deepEqual(g.deploymentIds,[])
})

test('无编制时可前往我的部队，选中的编制被移除后拒绝部署，锁定关卡不可绕过',()=>{
  const g=game();g.start('campaign',1);drawModal(g);click(g,'deployment-confirm');assert.equal(g.modal,'formation')
  assert(setFormation(g.save,'squad',10).ok);g.start('campaign',1);g.toggleDeployment(1);g.save.formations=[]
  g.start('campaign',1,g.deploymentIds);assert.equal(g.scene,'world-map')
  g.start('campaign',2,[1]);assert.equal(g.scene,'world-map');assert.equal(g.battle,undefined)
})

test('点选单个单位后点击地面只移动该单位，拖动事件不持续改写目标',()=>{
  const b=new CampaignBattle(1,roster()),[first,second]=b.units
  b.pending=0;const original=JSON.stringify(second.target)
  assert.equal(b.command(900,400),false);assert.equal(b.selectedUnitId,null)
  assert(b.command(first.x,first.y));assert.equal(b.selectedUnitId,first.id)
  assert(b.command(850,400));assert.deepEqual(first.target,{x:850,y:400});assert.equal(JSON.stringify(second.target),original)
  const g=game();g.scene='battle';g.battle=b;g.scale=1;g.ox=0;g.oy=0
  g.touch({touches:[{clientX:800,clientY:400}]});assert.equal(g.pressed,false)
  g.pressed=true;g.touchMove({touches:[{clientX:1100,clientY:550}]});assert.deepEqual(first.target,{x:800,y:400})
  b.update(.5);assert(first.x>280);assert.equal(second.x,280);assert.equal(second.y,575)
  assert(b.command(second.x,second.y));assert.equal(b.selectedUnitId,second.id)
  assert(b.moveSelected(-100,1000));assert.deepEqual(second.target,{x:75,y:600})
  const before=JSON.stringify(second.target);assert.equal(b.moveSelected(NaN,0),false);assert.equal(JSON.stringify(second.target),before)
})

test('各单位从自己所在位置按射程开火，按武器间隔开火',()=>{
  const units=roster(2,10)
  const b=new CampaignBattle(1,units),[first,second]=b.units;b.pending=0
  first.x=200;first.y=300;first.target={x:200,y:300};second.x=1000;second.y=600;second.target={x:1000,y:600}
  b.enemies=[{x:400,y:300,hp:100,maxHp:100,cool:10}]
  b.update(.21);assert.equal(b.enemies[0].hp,90)
  assert.equal(first.groups[0].cool,first.groups[0].weapon.interval)
  b.enemies[0].x=800;b.enemies[0].y=600;const hp=b.enemies[0].hp
  b.update(.25);assert.equal(b.enemies[0].hp,hp-10)
})

test('手枪和轻机枪两发击败一人，打掉小队后将剩余射击分配给其他目标',()=>{
  for(const weapon of ['pistol','machinegun']){
    const [unit]=roster(1,10);unit.groups[0].weapon=weapon
    const stock={bullets:10},b=new CampaignBattle(1,[unit],[],stock),actor=b.units[0]
    const enemy=(offset,troops)=>({x:actor.x+offset,y:actor.y,hp:troops,maxHp:troops,cool:100})
    b.enemies=[enemy(50,1),enemy(100,2)]
    b.update(.21)
    assert.equal(b.kills,3);assert.equal(stock.bullets,4);assert.equal(b.ammoSpent,6)
  }
})

test('狙击枪也扣通用子弹，迫击炮继续扣独立炮弹',()=>{
  const [unit]=roster(1,10)
  unit.groups=[{weapon:'sniper',troops:5},{weapon:'mortar',troops:5}]
  const stock={bullets:3,mortarAmmo:8},b=new CampaignBattle(1,[unit],[],stock),actor=b.units[0]
  b.enemies=[{x:actor.x+100,y:actor.y,hp:100,maxHp:100,cool:100}]
  b.update(.21)
  assert.equal(stock.bullets,0);assert.equal(stock.mortarAmmo,3);assert.equal(b.ammoSpent,8)
  assert.equal(b.canFire(actor.groups[0]),false);assert(b.canFire(actor.groups[1]))
})

test('敌军攻击最近的存活单位，医疗和波间自动补兵已移除，退出单位不可复活',()=>{
  const b=new CampaignBattle(1,roster()),[first,second]=b.units;b.pending=0
  first.x=250;first.y=300;first.target={x:250,y:300};second.x=1000;second.y=500;second.target={x:1000,y:500}
  b.enemies=[{x:400,y:300,hp:1000,maxHp:1000,cool:0}]
  b.selectUnit(first.id);first.hp=1;b.update(.01)
  assert.equal(first.hp,0);assert.equal(second.hp,60);assert.equal(b.hp,60);assert.equal(b.selectedUnit,null);assert.equal(b.selectUnit(first.id),false)
  second.hp=20;b.syncHealth();assert.equal(typeof b.heal,'undefined');assert.equal(second.hp,20);assert.equal(first.hp,0);assert.equal(b.hp,20)
  b.enemies=[];b.breather=1.5;b.update(.01);assert.equal(b.wave,2);assert.equal(first.hp,0);assert.equal(second.hp,20)
  second.hp=0;b.update(.01);assert.equal(b.done,true);assert.equal(b.won,false);assert.equal(b.hp,0)
})

test('新战斗可完成首关，按战后实际余员扣兵，奖励只结算一次',()=>{
  const s=freshSave();assert(setFormation(s,'company',120).ok)
  const deployment=campaignDeployment(s,[1]),b=new CampaignBattle(1,deployment.units)
  for(let i=0;i<60*180&&!b.done;i++)b.update(1/60)
  assert(b.done);assert(b.won);assert(b.kills>0)
  const reward=settle(s,b);assert.equal(reward.coins,40);assert.equal(s.stage,2);assert.equal(settle(s,b),null)
  const survivors=Math.ceil(b.units[0].hp)
  assert.equal(s.troops,survivors);assert.equal(s.formations[0].troops,survivors)
  assert.equal(reward.lostTroops,120-survivors);assert.equal(reward.lostUnits,0)
  assert.equal(reward.capturedWeapons.rifle,b.kills)
  assert.equal(reward.recoveredWeapons.rifle,120-survivors)
  assert.equal(s.weaponCounts.rifle,120+b.kills)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const support=new CampaignBattle(1,roster());assert.equal(support.strike(),false)
  support.enemies=[{x:800,y:400,hp:150,maxHp:150,cool:100}];assert.equal(support.strike(),false);assert.equal(support.enemies[0].hp,150)
})

test('胜利或撤退时10人剩4人扣6人，欠编和混合武器保存并可继续出战',()=>{
  for(const won of [true,false]){
    const s=freshSave();s.weaponCounts.machinegun=2
    assert(setFormation(s,'squad',10,null,{rifle:8,machinegun:2}).ok)

    const b=new CampaignBattle(1,campaignDeployment(s,[1]).units);b.units[0].hp=3.7;b.done=true;b.won=won
    const result=settle(s,b)
    assert.equal(result.lostTroops,6);assert.equal(result.lostUnits,0);assert.equal(s.troops,114)
    assert.equal(s.formations[0].troops,4);assert.equal(s.formations[0].battleDamaged,true)
    assert.equal(s.formations[0].weapons.rifle,3);assert.equal(s.formations[0].weapons.machinegun,1)
    assert.equal(s.weaponCounts.rifle,won?120:115);assert.equal(s.weaponCounts.machinegun,won?2:1)
    assert.equal(formation(s).assignedTroops,4);assert.equal(formation(s).unassignedTroops,110)
    assert.equal(settle(s,b),null);assert.equal(s.troops,114)
    const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s)
    assert.equal(campaignDeployment(restored,[1]).troops,4)
    const again=new CampaignBattle(1,campaignDeployment(restored,[1]).units);again.units[0].hp=2
    assert.equal(settle(restored,again).lostTroops,2);assert.equal(restored.troops,112);assert.equal(restored.formations[0].troops,2)
    assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
  }
})

test('胜利时回收已即时扣除和战后结算的武器，未出战部队不受影响',()=>{
  const s=freshSave();for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  const b=new CampaignBattle(1,campaignDeployment(s,[1,2]).units)
  b.units[0].hp=0;assert.equal(applyBattleLosses(s,b),10);assert.equal(s.weaponCounts.rifle,110)
  b.units[1].hp=4;b.won=true
  const result=settle(s,b);assert.equal(result.lostTroops,16);assert.equal(result.lostUnits,1);assert.equal(s.troops,104)
  assert.deepEqual(s.formations.map(unit=>[unit.id,unit.troops]),[[2,4],[3,10]])
  assert.equal(result.recoveredWeapons.rifle,16);assert.equal(s.weaponCounts.rifle,120)
  assert.equal(settle(s,b),null);assert.equal(s.troops,104);assert.equal(s.weaponCounts.rifle,120)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('合编部队部分损失按实际幸存人数分配，残余多层编制刷新和解除均不丢失',()=>{
  const s=freshSave();for(let i=0;i<9;i++)assert(setFormation(s,'squad',12).ok)
  const platoons=[];for(let i=0;i<3;i++)platoons.push(mergeFormations(s,[i*3+1,i*3+2,i*3+3]).unit.id)
  const parent=mergeFormations(s,platoons).unit,b=new CampaignBattle(1,campaignDeployment(s,[parent.id]).units)
  b.units[0].hp=1
  assert.equal(settle(s,b).lostTroops,107);assert.equal(s.troops,13)
  assert.equal(s.formations.length,3);assert.equal(parent.children.length,1);assert.equal(parent.troops,1)
  assert.equal(formation(s).assignedTroops,1);assert.equal(formation(s).unassignedTroops,12)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s)
  assert.equal(campaignDeployment(restored,[parent.id]).troops,1)
  assert(unmergeFormation(restored,parent.id).ok);assert.equal(restored.formations.length,2)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
})

test('欠编部队可以保存、换装和逐步补员，新建编制仍严格校验原人数下限',()=>{
  const s=freshSave();assert(setFormation(s,'squad',10).ok)
  const b=new CampaignBattle(1,campaignDeployment(s,[1]).units);b.units[0].hp=4;settle(s,b)
  assert.equal(formationMinimum(s,'squad',1),4);assert.equal(setFormation(s,'squad',3,1).ok,false)
  assert.equal(setFormation(s,'squad',4).ok,false);assert(setFormation(s,'squad',4,1).ok)
  const g=game(s);g.editFormation(s.formations[0]);drawModal(g);click(g,'formation-minus');assert.equal(g.formationDraft.troops,4)
  click(g,'formation-save');assert.equal(s.formations[0].troops,4);assert.equal(g.modal,'formation-detail')
  assert(setFormation(s,'squad',7,1).ok);assert.equal(s.formations[0].troops,7);assert.equal(s.troops,114)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('部分战损不会让异常合编存档通过共享下属、重复下属或跨级校验',()=>{
  const s=freshSave();for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  for(const children of [[1,1],[],[999],[1,2,3,999]]){
    const raw={...s,formations:[...s.formations,{id:4,type:'platoon',troops:4,children,battleDamaged:true}]}
    assert.equal(normalizeSave(raw).formations.some(unit=>unit.id===4),false)
  }
  const raw={...s,formations:[...s.formations,{id:4,type:'company',troops:4,children:[1],battleDamaged:true}]}
  assert.equal(normalizeSave(raw).formations.some(unit=>unit.id===4),false)
})

function damagedSquad(){
  const s=freshSave();assert(setFormation(s,'squad',7).ok)
  const b=new CampaignBattle(1,campaignDeployment(s,[1]).units);b.units[0].hp=3;settle(s,b)
  return s
}

test('原有3人最多补9人到班上限12，超额失败不修改，原士兵和武器保留',()=>{
  const s=damagedSquad(),before=JSON.stringify(s),troops=s.troops
  assert.equal(reinforcementCapacity(s,1).capacity,9)
  assert.equal(reinforceFormation(s,1,12).ok,false);assert.equal(JSON.stringify(s),before)
  for(const count of [-1,1.5,NaN])assert.equal(reinforceFormation(s,1,count).ok,false)
  assert.equal(JSON.stringify(s),before)
  assert(reinforceFormation(s,1,9).ok);assert.equal(s.formations[0].troops,12)
  assert.equal(s.formations[0].weapons.rifle,12);assert.equal(s.weaponCounts.rifle,116)
  assert.equal(s.troops,troops);assert.equal(formation(s).unassignedTroops,104)
  assert.equal(reinforcementCapacity(s,1).capacity,0);assert.equal(reinforceFormation(s,1,1).ok,false)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('补员受未编人员和上级人数上限约束，允许无武器补入',()=>{
  const s=damagedSquad();s.troops=5
  assert.equal(reinforcementCapacity(s,1).capacity,2);assert.equal(reinforceFormation(s,1,3).ok,false)
  s.weaponCounts.rifle=3;assert.equal(reinforcementCapacity(s,1).capacity,2);assert(reinforceFormation(s,1,1).ok);assert.equal(s.formations[0].weapons.rifle,3)
  const big=freshSave();big.troops=8000;big.weaponCounts.rifle=8000
  for(let i=0;i<3;i++)assert(setFormation(big,'regiment',2000).ok)
  assert(mergeFormations(big,[1,2,3]).ok);assert.equal(reinforcementCapacity(big,1).capacity,0)
  assert.equal(reinforceFormation(big,1,1).ok,false);assert.equal(big.formations[0].troops,2000)
})

test('自动配发补员优先保留原有武器，重复使用旧编辑页面不能重复补兵',()=>{
  const s=damagedSquad();s.weaponCounts.sniper=3
  assert(setFormation(s,'squad',3,1,{sniper:3}).ok)
  const loadout=reinforcementWeapons(s,1,9)
  assert.equal(loadout.sniper,3);assert.equal(loadout.rifle,9)
  assert(reinforceFormation(s,1,2,null,3).ok);assert.equal(s.formations[0].troops,5)
  const before=JSON.stringify(s);assert.equal(reinforceFormation(s,1,2,null,3).ok,false);assert.equal(JSON.stringify(s),before)
})

test('已有编制输入新增人数，原有3人不被覆盖，超额提示、减号归零、预览和保存均正确',()=>{
  const s=damagedSquad(),g=game(s)
  g.editFormation(s.formations[0]);drawModal(g)
  assert.equal(g.formationDraft.baseTroops,3);assert.equal(g.formationDraft.reinforcements,0)
  assert.equal(g.buttons.some(button=>button.id.startsWith('formation-type-')),false)
  assert.equal(g.formationDraft.type,'squad');assert.equal(g.formationDraft.troops,3)
  const originalWx=globalThis.wx;let modal
  globalThis.wx={showModal:options=>{modal=options}}
  try{
    g.inputFormationTroops();assert.equal(modal.inputLabel,'补员人数');assert.equal(modal.minValue,0);assert.equal(modal.maxValue,9)
    modal.success({confirm:true,content:'12'});assert.equal(g.formationDraft.troops,3);assert(g.formationError.includes('最多可补 9'))
    modal.success({confirm:true,content:'9'});assert.equal(g.formationDraft.troops,12);assert.equal(s.formations[0].troops,3)
    drawModal(g);click(g,'formation-save');assert.equal(s.formations[0].troops,12);assert.equal(g.modal,'formation-detail')
    g.editFormation(s.formations[0]);drawModal(g);click(g,'formation-minus');assert.equal(g.formationDraft.reinforcements,0);assert.equal(g.formationDraft.troops,12)
  }finally{if(originalWx===undefined)delete globalThis.wx;else globalThis.wx=originalWx}
})

test('原有9人9把枪，补3人只新增3把，保存后12人12把且不重配现有士兵武器',()=>{
  const s=freshSave();assert(setFormation(s,'squad',9).ok)
  assert(validateReinforcement(s,1,3,{rifle:3}).ok)
  assert.equal(validateReinforcement(s,1,3,{rifle:12}).ok,false)
  const missing=validateReinforcement(s,1,3,{rifle:0});assert(missing.ok)
  assert(reinforceFormation(s,1,3,{rifle:3},9).ok)
  assert.equal(s.formations[0].troops,12);assert.equal(s.formations[0].weapons.rifle,12)
  assert.equal(s.weaponCounts.rifle,120);assert.equal(s.coins,600)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('新增配发仅占用空闲武器，不挪用现有士兵或其他部队，原有混合武器保持不变',()=>{
  const s=freshSave();s.weaponCounts={rifle:16,pistol:3,machinegun:3,sniper:0,mortar:0}
  assert(setFormation(s,'squad',9,null,{rifle:6,machinegun:3}).ok);assert(setFormation(s,'squad',10).ok)
  assert.equal(reinforcementCapacity(s,1).capacity,3)
  assert.equal(validateReinforcement(s,1,3,{rifle:3}).ok,false)
  assert.equal(validateReinforcement(s,1,3,{rifle:-1,pistol:4}).ok,false)
  assert(reinforceFormation(s,1,3,{pistol:3}).ok)
  assert.deepEqual(s.formations[0].weapons,{rifle:6,pistol:3,machinegun:3,sniper:0,mortar:0})
  assert.equal(s.formations[1].weapons.rifle,10);assert.equal(s.weaponCounts.rifle,16);assert.equal(s.weaponCounts.pistol,3)
})

test('补员界面武器表示最终总数，原有9把补3人默认共12把，输入和保存不重复配发',()=>{
  const s=freshSave();assert(setFormation(s,'squad',9).ok)
  const g=game(s),texts=[]
  g.ctx=new Proxy({fillText:value=>texts.push(String(value))},{get:(object,key)=>object[key]??(()=>{}),set:(object,key,value)=>(object[key]=value,true)})
  g.editFormation(s.formations[0]);assert.equal(g.formationDraft.baseWeapons.rifle,9);assert.equal(g.formationDraft.weapons.rifle,9)
  g.setFormationReinforcements(3);assert.equal(g.formationDraft.weapons.rifle,12);assert.equal(s.formations[0].weapons.rifle,9)
  const originalWx=globalThis.wx;let modal
  globalThis.wx={showModal:options=>{modal=options}}
  try{
    g.inputFormationWeapon({id:'rifle',name:'步枪'});assert.equal(modal.inputLabel,'武器总数量');assert.equal(modal.content,'12');assert.equal(modal.maxValue,120)
    modal.success({confirm:true,content:'12'});drawModal(g)
    assert(texts.some(value=>value.includes('配发 12 把')&&value.includes('未配 0 人')))
    assert.equal(texts.some(value=>value.includes('需要配发 12 把')),false)
    click(g,'formation-save');assert.equal(s.formations[0].weapons.rifle,12);assert.equal(s.formations[0].troops,12)
  }finally{if(originalWx===undefined)delete globalThis.wx;else globalThis.wx=originalWx}
})

test('敌方以具名编制入场，兵力符合对应范围，击溃后按整支人数记录歼敌',()=>{
  for(const [level,type,min,max] of [[1,'squad',7,12],[4,'platoon',25,40],[7,'company',100,150],[10,'battalion',400,1000]]){
    for(let index=0;index<20;index++){
      const spec=enemyUnitSpec(level,2,index)
      assert.equal(spec.type,type);assert(spec.troops>=min&&spec.troops<=max);assert(spec.name.startsWith('敌'))
    }
  }
  const b=new CampaignBattle(1,roster());b.update(1.01)
  const enemy=b.enemies[0];assert.equal(enemy.name,'敌1班');assert.equal(enemy.hp,enemy.troops);assert.equal(enemy.maxHp,enemy.troops)
  enemy.hp=0;b.pending=0;b.update(.01);assert.equal(b.kills,enemy.maxHp);assert.equal(b.enemyUnitsDestroyed,1)
  b.update(.01);assert.equal(b.kills,enemy.maxHp)
})

test('整支阵亡即时永久扣兵并移除编制，只扣一次，存活和未参战部队保持不变',()=>{
  const s=freshSave();for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)

  const b=new CampaignBattle(1,campaignDeployment(s,[1,2]).units)
  b.units[0].hp=.1;assert.equal(applyBattleLosses(s,b),0);assert.equal(s.troops,120)
  b.units[0].hp=0;assert.equal(applyBattleLosses(s,b),10);assert.equal(s.troops,110)
  assert.deepEqual(s.formations.map(unit=>unit.id),[2,3]);assert.equal(b.lostTroops,10);assert.equal(b.lostUnits,1)
  assert.equal(formation(s).assignedTroops,20);assert.equal(formation(s).unassignedTroops,90)
  assert.equal(s.weaponCounts.rifle,110)
  assert.equal(applyBattleLosses(s,b),0);assert.equal(s.troops,110)
  b.done=true;const result=settle(s,b);assert.equal(result.lostTroops,10);assert.equal(result.lostUnits,1)
  assert.equal(settle(s,b),null);assert.equal(s.troops,110)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('多层合编阵亡删除整棵下属树，兵力和配发武器按叶节点扣一次，保留未出战和空闲武器',()=>{
  const s=freshSave();for(let i=0;i<9;i++)assert(setFormation(s,'squad',12).ok)
  assert(setFormation(s,'squad',10).ok)
  const platoons=[];for(let i=0;i<3;i++)platoons.push(mergeFormations(s,[i*3+1,i*3+2,i*3+3]).unit.id)
  const parent=mergeFormations(s,platoons).unit
  const b=new CampaignBattle(1,campaignDeployment(s,[parent.id]).units);b.units[0].hp=0
  assert.equal(applyBattleLosses(s,b),108);assert.equal(s.troops,12);assert.deepEqual(s.formations.map(unit=>unit.id),[10])
  assert.equal(s.weaponCounts.rifle,12);assert.equal(formation(s).unassignedTroops,2)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  assert.equal(applyBattleLosses(s,b),0);assert.equal(s.troops,12)
})

test('全军阵亡允许总兵力为零，刷新不补回初始兵力，无关存档仍正常恢复',()=>{
  const s=freshSave();assert(setFormation(s,'company',120).ok)
  const b=new CampaignBattle(1,campaignDeployment(s,[1]).units);b.units[0].hp=0
  const result=settle(s,b);assert.equal(result.lostTroops,120);assert.equal(s.troops,0);assert.deepEqual(s.formations,[])
  assert.equal(s.weaponCounts.rifle,0);assert.equal(formation(s).totalWeapons,0)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  assert.equal(normalizeSave({troops:7}).troops,7);assert.equal(normalizeSave({troops:0}).troops,0)
  assert.equal(normalizeSave({troops:-1}).troops,120);assert.equal(normalizeSave({}).troops,120)
})

test('战斗更新时保存阵亡损失，中途刷新也保留；退出结算不再次扣除',()=>{
  const s=freshSave();assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'squad',10).ok)
  const g=game(s);g.start('campaign',1,[1,2]);let stored=null,saves=0
  g.persist=()=>{stored=JSON.parse(JSON.stringify(g.save));saves++}
  g.battle.pending=0;g.battle.enemies=[];g.battle.units[0].hp=0
  g.updateBattle(.01);assert.equal(stored.troops,110);assert.equal(saves,1)
  assert.equal(stored.weaponCounts.rifle,110)
  assert.deepEqual(normalizeSave(stored),s);assert.equal(campaignDeployment(normalizeSave(stored),[1]).ok,false)
  g.updateBattle(.01);assert.equal(saves,1)
  g.battle.done=true;g.finish();assert.equal(s.troops,110);assert.equal(g.result.lostTroops,10)
  assert.equal(s.weaponCounts.rifle,110)
})

test('混合武器全军覆没各类库存归零，重复结算和刷新不补枪，仍能正常购买',()=>{
  const s=freshSave();s.troops=10;s.weaponCounts={rifle:3,pistol:2,machinegun:2,sniper:2,mortar:1}
  assert(setFormation(s,'squad',10,null,{...s.weaponCounts}).ok)
  const b=new CampaignBattle(1,campaignDeployment(s,[1]).units);b.units[0].hp=0;b.done=true;b.won=false
  assert.equal(applyBattleLosses(s,b),10)
  const empty={rifle:0,pistol:0,machinegun:0,sniper:0,mortar:0}
  assert.deepEqual(s.weaponCounts,empty);assert.equal(s.troops,0)
  assert.equal(applyBattleLosses(s,b),0);assert.equal(settle(s,b).lostTroops,10);assert.equal(settle(s,b),null)
  assert.deepEqual(s.weaponCounts,empty)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s)
  assert.equal(formation(restored).totalWeapons,0);assert.equal(campaignDeployment(restored,[1]).ok,false)
  assert(purchaseWeapon(restored,'rifle'));assert.equal(restored.weaponCounts.rifle,1)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
})

test('合编胜利后各类阵亡配发武器回收为空闲，统计不重复计数',()=>{
  const s=freshSave();s.weaponCounts.pistol=8;s.weaponCounts.machinegun=9
  for(let i=0;i<3;i++)assert(setFormation(s,'squad',10,null,{rifle:6,pistol:2,machinegun:2}).ok)
  assert(setFormation(s,'squad',10).ok)
  const parent=mergeFormations(s,[1,2,3]).unit,before={...parent.weapons},stock={...s.weaponCounts},spare=formation(s).spareWeapons
  const b=new CampaignBattle(1,campaignDeployment(s,[parent.id]).units);b.units[0].hp=6.2;b.done=true;b.won=true
  const result=settle(s,b);assert.equal(result.lostTroops,23);assert.equal(parent.troops,7)
  for(const id of Object.keys(stock))assert.equal(result.recoveredWeapons[id],before[id]-parent.weapons[id])
  assert.deepEqual(s.weaponCounts,stock)
  assert.equal(formation(s).spareWeapons,spare+23);assert.equal(s.formations.find(unit=>unit.id===4).weapons.rifle,10)
  const after={...s.weaponCounts};assert.equal(applyBattleLosses(s,b,true),0);assert.equal(settle(s,b),null);assert.deepEqual(s.weaponCounts,after)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('战斗部队卡片跨页可点选，死亡单位不接收命令，暂停时不接收地图操作',()=>{
  const g=game();g.battle=new CampaignBattle(1,roster(6,10));g.scene='battle';g.battleRosterPage=0
  const draw=()=>{g.buttons=[];g.drawBattle();for(const button of g.buttons)assert(button.x>=0&&button.y>=0&&button.x+button.w<=1440&&button.y+button.h<=810,button.id)}
  draw();click(g,'battle-roster-next');draw();click(g,'battle-unit-5');assert.equal(g.battle.selectedUnitId,5)
  g.battle.units[5].hp=0;click(g,'battle-unit-6');assert.equal(g.battle.selectedUnitId,5)
  g.scale=1;g.ox=0;g.oy=0;click(g,'pause');drawModal(g)
  const target=JSON.stringify(g.battle.selectedUnit.target);g.touch({touches:[{clientX:900,clientY:250}]});assert.equal(JSON.stringify(g.battle.selectedUnit.target),target)
})

test('战斗分遣卡片紧跟原部队，地图上的 Actor 列表顺序保持原样',()=>{
  const g=game(),units=roster(3,25)
  units[0].type='platoon';g.battle=new CampaignBattle(1,units)
  assert(g.battle.selectUnit(1))
  const result=g.battle.splitSelected('squad',7);assert(result.ok)
  const actorIds=g.battle.units.map(unit=>unit.id);g.buttons=[];g.drawCampaignRoster()
  const cardIds=g.buttons.filter(button=>button.id.startsWith('battle-unit-')).map(button=>button.id)
  assert.deepEqual(cardIds,['battle-unit-1','battle-unit-det-1','battle-unit-2','battle-unit-3'])
  assert.deepEqual(g.battle.units.map(unit=>unit.id),actorIds)
})
