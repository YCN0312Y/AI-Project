import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation,settle,applyBattleLosses,MODES} from '../js/state.js'
import {CampaignBattle,campaignDeployment} from '../js/campaign.js'
import {fitCamera} from '../js/world-map.js'
import {startTreatment,recoverPendingBattleCasualties} from '../js/facilities.js'
import {advanceEconomy} from '../js/economy.js'
import {totalPersonnel} from '../js/logistics.js'
import {Game} from '../js/game.js'

function setup(){
  const s=freshSave();s.cookedRice=1000
  for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  return s
}
const battle=(s,ids=[1,2])=>new CampaignBattle(1,campaignDeployment(s,ids).units)

test('出战部队全灭战败全部阵亡，未参战人员和原医疗部伤员、疗程、派驻均保留',()=>{
  const s=setup();s.wounded={light:8,heavy:4};s.heavyTreatmentStages=[2,1,1];s.battleDeaths=3
  assert(startTreatment(s,'heavy',[3]).ok);const oldMedical=structuredClone(s.medicalTasks)
  const b=battle(s);for(const unit of b.units)unit.hp=0
  assert.equal(applyBattleLosses(s,b),20);assert.deepEqual(s.wounded,{light:8,heavy:4})
  assert.equal(s.pendingBattleCasualties.annihilated,true);assert.equal(s.pendingBattleCasualties.light,0);assert.equal(s.pendingBattleCasualties.heavy,0)
  b.done=true;const result=settle(s,b)
  assert.equal(result.directDeaths,20);assert.equal(result.woundedLight,0);assert.equal(result.woundedHeavy,0);assert.equal(b.annihilated,true)
  assert.equal(s.troops,100);assert.equal(s.weaponCounts.rifle,100);assert.equal(s.battleDeaths,23)
  assert.deepEqual(s.wounded,{light:8,heavy:4});assert.deepEqual(s.heavyTreatmentStages,[2,1,1]);assert.deepEqual(s.medicalTasks,oldMedical)
  assert.equal(s.formations.length,1);assert.equal(s.formations[0].id,3);assert.equal(s.pendingBattleCasualties,null)
  const before=JSON.stringify(s);assert.equal(settle(s,b),null);assert.equal(applyBattleLosses(s,b,true),0);assert.equal(JSON.stringify(s),before)
  assert.deepEqual(normalizeSave(s),s)
})

test('先损失一队的临时伤员不能提前治疗，最后全灭时本场全部转为阵亡',()=>{
  const s=setup();assert(startTreatment(s,'light',[3]).ok)
  const b=battle(s);b.units[0].hp=0;applyBattleLosses(s,b)
  assert.equal(s.pendingBattleCasualties.light,3);assert.equal(s.pendingBattleCasualties.heavy,2)
  assert.deepEqual(s.wounded,{light:0,heavy:0});assert.equal(totalPersonnel(s),115)
  advanceEconomy(s,300,()=>1);assert.equal(s.recoveredTroops,0);assert.equal(s.medicalTasks.light.elapsed,0)
  b.units[1].hp=0;applyBattleLosses(s,b);b.done=true
  const result=settle(s,b);assert.equal(result.directDeaths,20);assert.equal(result.woundedLight+result.woundedHeavy,0)
  assert.equal(s.recoveredTroops,0);assert.deepEqual(s.wounded,{light:0,heavy:0});assert.equal(s.troops,100)
})

test('旧伤员可在本场战斗中正常康复，全灭结算不扣回旧康复人员或旧剩余伤员',()=>{
  const s=setup();s.wounded.light=10;startTreatment(s,'light',[3])
  const b=battle(s);b.units[0].hp=0;applyBattleLosses(s,b)
  advanceEconomy(s,30,()=>1);assert.equal(s.recoveredTroops,5);assert.equal(s.wounded.light,5)
  b.units[1].hp=0;b.done=true;const result=settle(s,b)
  assert.equal(result.directDeaths,20);assert.equal(result.woundedLight,0);assert.equal(result.woundedHeavy,0)
  assert.equal(s.troops,105);assert.equal(s.wounded.light,5);assert.equal(s.recoveredTroops,5)
})

test('败退但仍有出战幸存者时保留正常轻重伤规则，战斗结束才送入医疗部',()=>{
  const s=setup(),b=battle(s);b.units[0].hp=0;applyBattleLosses(s,b)
  assert.equal(s.wounded.light,0);b.units[1].hp=6;b.done=true
  const result=settle(s,b)
  assert.equal(b.annihilated,false);assert.equal(result.lostTroops,14);assert.equal(result.directDeaths,7)
  assert.equal(result.woundedLight,4);assert.equal(result.woundedHeavy,3);assert.deepEqual(s.wounded,{light:4,heavy:3})
  assert.equal(s.troops,106);assert.equal(s.formations.find(unit=>unit.id===2).troops,6);assert.equal(s.pendingBattleCasualties,null)
})

test('胜利仍按正常战损分类送医，不因其他队伍阵亡误判全军覆灭',()=>{
  const s=setup(),b=battle(s);b.units[0].hp=0;b.units[1].hp=4;b.done=true;b.won=true
  const result=settle(s,b);assert.equal(result.lostTroops,16);assert.equal(result.directDeaths,8)
  assert.equal(result.woundedLight,4);assert.equal(result.woundedHeavy,4);assert.equal(b.annihilated,false)
})

test('主营及其分遣Actor都阵亡才视为全灭，分遣存活时保留伤员',()=>{
  for(const detachedLives of [false,true]){
    const s=freshSave();s.troops=500;s.weaponCounts.rifle=500;setFormation(s,'battalion',400)
    const b=battle(s,[1]);b.selectUnit(1);const detached=b.splitSelected('platoon',30).unit
    b.units[0].hp=0;applyBattleLosses(s,b);assert.equal(s.wounded.light+s.wounded.heavy,0)
    if(!detachedLives)detached.hp=0
    b.done=true;const result=settle(s,b)
    assert.equal(b.annihilated,!detachedLives)
    assert.equal(result.directDeaths,detachedLives?185:400)
    assert.equal(result.woundedLight+result.woundedHeavy,detachedLives?185:0)
    assert.equal(s.troops,detachedLives?130:100);assert.deepEqual(normalizeSave(s),s)
  }
})

test('战中刷新恢复待结算伤亡一次，全灭快照不产生伤员，正常快照不丢失伤员',()=>{
  for(const annihilated of [false,true]){
    const s=setup(),b=battle(s);b.units[0].hp=0;if(annihilated)b.units[1].hp=0
    applyBattleLosses(s,b)
    const loaded=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(loaded,s)
    assert(recoverPendingBattleCasualties(loaded));assert.equal(loaded.pendingBattleCasualties,null)
    assert.deepEqual(loaded.wounded,annihilated?{light:0,heavy:0}:{light:3,heavy:2})
    assert.equal(loaded.battleDeaths,annihilated?20:5)
    const once=JSON.stringify(loaded);assert.equal(recoverPendingBattleCasualties(loaded),false);assert.equal(JSON.stringify(loaded),once)
    assert.deepEqual(normalizeSave(loaded),loaded)
  }
})

test('非法待结算伤亡不制造伤员，人数上限计入本场临时伤员',()=>{
  const s=setup();s.wounded.light=5
  for(const pending of [{total:10,light:8,heavy:8,dead:0,annihilated:false},{total:10,light:-1,heavy:2,dead:9,annihilated:false},{total:10,light:3,heavy:2,dead:5,annihilated:'false'}]){
    const loaded=normalizeSave({...s,pendingBattleCasualties:pending});assert.equal(loaded.pendingBattleCasualties,null);assert.equal(recoverPendingBattleCasualties(loaded),false);assert.equal(loaded.wounded.light,5)
  }
  const capped=normalizeSave({troops:9999998,pendingBattleCasualties:{total:10,light:3,heavy:2,dead:5,annihilated:false}})
  assert.equal(totalPersonnel(capped),10000000);recoverPendingBattleCasualties(capped);assert.equal(totalPersonnel(capped),10000000)
})

test('主页直接绘制大地图，三张大卡移除，常用入口保留且不改存档',()=>{
  const s=setup(),g=Object.create(Game.prototype),labels=[];g.save=s;g.scene='lobby';g.buttons=[];g.notify=()=>{};g.persist=()=>{}
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText:value=>labels.push(String(value))},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  const before=JSON.stringify(s);g.drawLobby();assert(labels.includes('灶火岭战区'))
  for(const id of ['campaign','recruitment','base'])assert.equal(g.buttons.some(b=>b.id===id),false)
  for(const id of ['profile','formation','warehouse','shop','kitchen','tasks','settings','map-base'])assert(g.buttons.some(b=>b.id===id),id)
  assert.equal(labels.includes('选择指挥行动'),false)
  for(const b of g.buttons)assert(b.x>=0&&b.y>=0&&b.x+b.w<=1440&&b.y+b.h<=810,b.id)
  for(let i=0;i<g.buttons.length;i++)for(let j=i+1;j<g.buttons.length;j++){
    const a=g.buttons[i],b=g.buttons[j];assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,a.id+' / '+b.id)
  }
  g.home();fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap()
  assert.equal(g.scene,'world-map');assert.equal(g.modal,null)
  assert.equal(g.buttons.filter(b=>b.id.startsWith('map-site-')).length,7)
  assert.equal(MODES.find(mode=>mode.id==='campaign').name,'大地图');assert.equal(JSON.stringify(s),before)
})
