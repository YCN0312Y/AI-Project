import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation,settle,applyBattleLosses,MODES} from '../js/state.js'
import {CampaignBattle,campaignDeployment} from '../js/campaign.js'
import {fitCamera} from '../js/world-map.js'
import {advanceEconomy} from '../js/economy.js'
import {Game} from '../js/game.js'

function setup(){
  const s=freshSave();s.cookedRice=1000
  for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  return s
}
const battle=(s,ids=[1,2])=>new CampaignBattle(1,campaignDeployment(s,ids).units)

test('先后全灭的部队按实际人数累计伤亡，结算和重新加载均不重复扣减',()=>{
  const s=setup(),b=battle(s)
  b.units[0].hp=0;assert.equal(applyBattleLosses(s,b),10)
  const mid=normalizeSave(JSON.parse(JSON.stringify(s)))
  assert.equal(mid.troops,110);assert.equal(mid.weaponCounts.rifle,110)
  b.units[1].hp=0;b.done=true
  const result=settle(s,b)
  assert.equal(result.lostTroops,20);assert.equal(s.troops,100);assert.equal(s.weaponCounts.rifle,100)
  assert.deepEqual(s.formations.map(unit=>unit.id),[3])
  assert.equal(settle(s,b),null);assert.equal(applyBattleLosses(s,b,true),0)
  assert.deepEqual(normalizeSave(s),s)
})

test('胜利、失败或撤退后只合计伤亡，幸存人员保留',()=>{
  for(const won of [true,false]){
    const s=setup(),b=battle(s)
    b.units[0].hp=0;applyBattleLosses(s,b);b.units[1].hp=6;b.done=true;b.won=won
    const result=settle(s,b)
    assert.equal(result.lostTroops,14);assert.equal(s.troops,106)
    assert.equal(s.formations.find(unit=>unit.id===2).troops,6)
    for(const key of ['directDeaths','woundedLight','woundedHeavy'])assert(!Object.hasOwn(result,key))
    const g=Object.create(Game.prototype),labels=[]
    Object.assign(g,{save:s,battle:b,result,modal:'result',buttons:[]})
    g.ctx=new Proxy({fillText:value=>labels.push(String(value))},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
    g.drawModal()
    assert(labels.includes('我方伤亡 14 人'));assert(!labels.some(label=>/阵亡|轻伤|重伤/.test(label)))
  }
})

test('主营阵亡后按分遣部队的实存人数结算',()=>{
  const s=freshSave();s.troops=500;s.weaponCounts.rifle=500;assert(setFormation(s,'battalion',400).ok)
  const b=battle(s,[1]);b.selectUnit(1);b.splitSelected('platoon',30)
  b.units[0].hp=0;b.done=true
  assert.equal(settle(s,b).lostTroops,370);assert.equal(s.troops,130)
  assert.deepEqual(normalizeSave(s),s)
})

test('旧医疗数据加载后释放派驻人员，已经扣除的伤亡不会改变现有兵力',()=>{
  const raw=setup()
  raw.troops=110;raw.wounded={light:8,heavy:4};raw.heavyTreatmentStages=[2,1,1]
  raw.pendingBattleCasualties={total:10,light:3,heavy:2,dead:5,annihilated:false}
  raw.facilityVillages.medical=2;raw.garrisons[2]=[3]
  raw.medicalTasks={light:{unitIds:[3],elapsed:15,workers:10}};raw.bandageTask={unitIds:[3]}
  raw.raidReports=[{id:1,siteId:2,force:12,outcome:'won',lostTroops:6,directDeaths:3,woundedLight:2,woundedHeavy:1,expiresAt:Date.now()+10000}]
  const restored=normalizeSave(raw)
  for(const key of ['wounded','medicalTasks','heavyTreatmentStages','bandageTask','pendingBattleCasualties'])assert(!Object.hasOwn(restored,key))
  assert.deepEqual(restored.facilityVillages,{armory:null})
  assert.equal(restored.raidReports[0].lostTroops,6);assert(!Object.hasOwn(restored.raidReports[0],'woundedLight'))
  assert(campaignDeployment(restored,[3],true).ok)
  advanceEconomy(restored,60,()=>1)
  assert.equal(restored.troops,110);assert.deepEqual(restored.garrisons[2],[3])
})

test('只包含旧医疗物资的存档打开时立即清理并保存，其他物资保留',t=>{
  const s=setup();s.baseVillageId=1;s.coins=314;s.bullets=41;s.shopStock.bullets=13
  let stored={...structuredClone(s),medkits:7,bandages:18},writes=0
  stored.shopStock.medkits=4;stored.shopStock.bandages=8
  const oldWx=globalThis.wx,oldFrame=globalThis.requestAnimationFrame
  t.after(()=>{
    if(oldWx===undefined)delete globalThis.wx;else globalThis.wx=oldWx
    if(oldFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=oldFrame
  })
  globalThis.wx={createCanvas:()=>({getContext:()=>({setTransform(){}})}),getStorageSync:()=>structuredClone(stored),
    setStorageSync(_key,save){stored=structuredClone(save);writes++},
    getWindowInfo:()=>({windowWidth:1440,windowHeight:810,pixelRatio:1}),onTouchStart(){},onTouchMove(){},onTouchEnd(){}}
  globalThis.requestAnimationFrame=()=>{}
  const opened=new Game()
  assert.equal(writes,1);assert.deepEqual(opened.save,stored)
  for(const id of ['medkits','bandages']){assert(!Object.hasOwn(stored,id));assert(!Object.hasOwn(stored.shopStock,id))}
  assert.equal(stored.bullets,41);assert.equal(stored.shopStock.bullets,13);assert.equal(stored.coins,314)
  assert.deepEqual(stored.formations,s.formations)
  new Game();assert.equal(writes,1)
})

test('主页直接绘制大地图，三张大卡移除，常用入口保留且不改存档',()=>{
  const s=setup(),g=Object.create(Game.prototype),labels=[];g.save=s;g.scene='lobby';g.buttons=[];g.notify=()=>{};g.persist=()=>{}
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText:value=>labels.push(String(value))},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  const before=JSON.stringify(s);g.drawLobby();assert(labels.includes('禾川村战区'))
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
