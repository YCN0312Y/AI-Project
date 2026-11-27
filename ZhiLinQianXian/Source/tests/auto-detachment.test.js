import test from 'node:test'
import assert from 'node:assert/strict'
import {freshSave,normalizeSave,setFormation,mergeFormations,settle,applyBattleLosses} from '../js/state.js'
import {autoCookMeal,advanceLogistics,FOODS,DISHES,RATIONS,cookDish,rationStock} from '../js/logistics.js'
import {advanceEconomy} from '../js/economy.js'
import {CampaignBattle,campaignDeployment} from '../js/campaign.js'
import {Game} from '../js/game.js'

test('自动灶房只在饭点做本餐缺口并立即供餐，已有熟食足够时不动原料',()=>{
  const s=freshSave();s.rice=100;s.cookedRice=5
  advanceLogistics(s,299.9);assert.equal(s.rice,100);assert.equal(s.cookedRice,5)
  const result=advanceLogistics(s,.1)
  assert.equal(result.consumed,12);assert.equal(s.rice,93);assert.equal(s.cookedRice,0);assert.equal(s.dishesCooked,7);assert.equal(s.hungerDebt,0)
  s.cookedCorn=20;advanceLogistics(s,300);assert.equal(s.rice,93);assert.equal(s.cookedCorn,8)
  const loaded=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(loaded,s)
  advanceLogistics(loaded,0);assert.deepEqual(loaded,s)
})

test('自动灶房只随机选择饼、炒米、玉米，原料不足时先供现有份量',()=>{
  const allowed=['cookedMillet','cookedRice','cookedCorn']
  for(let i=0;i<allowed.length;i++){
    const s=freshSave();s.troops=100
    for(const food of FOODS)s[food.id]=100
    const dish=DISHES.find(dish=>dish.id===allowed[i]),cooked=autoCookMeal(s,()=>i/allowed.length+.001)
    assert.deepEqual(cooked,{[dish.id]:Math.ceil(10/dish.output)*dish.output})
    for(const [id,count] of Object.entries(dish.input))assert.equal(s[id],100-count*Math.ceil(10/dish.output))
    assert(rationStock(s)>=10&&rationStock(s)<=12);assert.equal(s.foodConsumed,0)
  }
  const s=freshSave();s.rice=2;s.pork=100
  const result=advanceLogistics(s,300)
  assert.equal(result.consumed,2);assert.equal(result.shortage,10);assert.equal(s.pork,100);assert.equal(s.rice,0)
  const empty=freshSave();advanceLogistics(empty,900);assert.equal(empty.dishesCooked,0);assert.equal(empty.hungerDebt,3)
})

test('自动开关保存，关闭后仍可手工做饭，无兵力不消耗原料',()=>{
  const s=freshSave();assert.equal(normalizeSave({}).autoCooking,true)
  s.autoCooking=false;s.rice=50;const loaded=normalizeSave(s)
  advanceLogistics(loaded,300);assert.equal(loaded.rice,50);assert.equal(loaded.dishesCooked,0)
  assert(cookDish(loaded,'cookedRice',12).ok)
  const empty=freshSave();empty.troops=0;empty.rice=50;advanceLogistics(empty,600);assert.equal(empty.rice,50)
})

test('只剩肉蛋和调料时自动供餐跳过，整步与分步一致，不消耗荤菜原料',()=>{
  const a=freshSave();a.hungerDebt=3;a.oil=20;a.salt=20;a.pork=20;a.eggs=20;a.troops=100
  const b=structuredClone(a);advanceEconomy(a,600);for(let i=0;i<600;i++)advanceEconomy(b,1)
  assert.deepEqual(a,b);assert.equal(a.dishesCooked,0);assert.equal(a.foodConsumed,0)
  for(const id of ['pork','eggs','salt','oil'])assert.equal(a[id],20)
  assert.equal(a.cookedPork,0);assert.equal(a.cookedEgg,0)
})

test('荷包蛋和熟猪肉保留手动制作，已有成品仍可正常供餐',()=>{
  const s=freshSave();s.oil=10;s.salt=10;s.pork=10;s.eggs=10
  assert.deepEqual(autoCookMeal(s),{})
  assert(cookDish(s,'cookedPork',1).ok);assert(cookDish(s,'cookedEgg',1).ok)
  assert.equal(s.cookedPork,3);assert.equal(s.cookedEgg,3)
  const meal=advanceLogistics(s,300);assert.equal(meal.consumed,6);assert.equal(meal.shortage,6)
  assert.equal(s.oil,8);assert.equal(s.salt,8);assert.equal(s.pork,9);assert.equal(s.eggs,9)
})

function battalion(){
  const s=freshSave();s.troops=500;s.weaponCounts.rifle=400;s.weaponCounts.machinegun=100
  assert(setFormation(s,'battalion',500,null,{rifle:400,machinegun:100}).ok)
  const b=new CampaignBattle(1,campaignDeployment(s,[1]).units);b.pending=0;b.selectUnit(1)
  return {s,b}
}
const total=b=>b.units.reduce((sum,u)=>sum+Math.ceil(u.hp),0)
const guns=b=>b.units.reduce((sum,u)=>sum+u.groups.reduce((sum,g)=>sum+g.troops,0),0)
function arrive(b,unit){b.recallUnit(unit.id);const parent=b.units.find(p=>p.id===unit.parentActorId);unit.x=parent.x+10;unit.y=parent.y;b.update(.01)}

test('营可以直接分遣班或排或连，主营身份不降级，兵力与混合武器不复制',()=>{
  const {s,b}=battalion(),before=JSON.stringify(s)
  assert.deepEqual(b.splitOptions().map(k=>k.id),['squad','platoon','company'])
  const first=b.splitSelected('platoon',30);assert(first.ok)
  assert.equal(b.units[0].name,'1营');assert.equal(b.units[0].type,'battalion');assert.equal(b.units[0].hp,470)
  assert.equal(first.unit.type,'platoon');assert.equal(first.unit.groups.find(g=>g.weapon.id==='rifle').troops,24)
  b.selectUnit(1);assert(b.splitSelected('squad',7).ok)
  assert.equal(total(b),500);assert.equal(guns(b),500);assert.equal(JSON.stringify(s),before)
  for(const [type,n] of [['battalion',400],['platoon',24],['squad',13],['company',500],['squad',7.5]]){
    b.selectUnit(1);const snapshot=JSON.stringify(b.units);assert.equal(b.splitSelected(type,n).ok,false);assert.equal(JSON.stringify(b.units),snapshot)
  }
})

test('分遣独立移动，接触其他营不合并，点击原部队或召回接触后归队',()=>{
  const {b}=battalion();const parent=b.units[0],child=b.splitSelected('company',100).unit
  assert(b.moveSelected(1000,500));const original={...parent.target};b.update(.1)
  assert(child.x>parent.x);assert.deepEqual(parent.target,original);assert.equal(b.units.length,2)
  assert(b.command(parent.x,parent.y));assert.equal(child.returningTo,parent.id)
  arrive(b,child);assert.equal(b.units.length,1);assert.equal(parent.name,'1营');assert.equal(parent.hp,500);assert.equal(guns(b),500)
  b.selectUnit(1);const again=b.splitSelected('platoon',25).unit
  again.x=parent.x;again.y=parent.y;again.returningTo=null;b.update(.01);assert.equal(b.units.length,1)
})

test('分遣接触其他编制不会归入别的部队，边缘分遣不与主力重叠',()=>{
  const {s}=battalion(),roster=campaignDeployment(s,[1]).units
  const b=new CampaignBattle(1,[...roster,{...roster[0],id:2,name:'2营'}]);b.pending=0;b.selectUnit(1)
  const child=b.splitSelected('squad',7).unit,other=b.units.find(unit=>unit.id===2)
  child.x=other.x;child.y=other.y;child.target={x:other.x,y:other.y};b.update(.01)
  assert.equal(b.units.length,3);assert.equal(other.hp,500)
  b.selectUnit(1);b.units[0].x=1310;b.units[0].y=600;b.units[0].target={x:1310,y:600}
  const edge=b.splitSelected('squad',7).unit;b.update(.01)
  assert(b.units.includes(edge));assert(Math.hypot(edge.x-b.units[0].x,edge.y-b.units[0].y)>28)
})

test('带伤分遣及归队保留实际余员，阵亡兵力和武器只扣一次',()=>{
  const {s,b}=battalion();b.units[0].hp=490.2
  const child=b.splitSelected('platoon',30).unit
  assert.equal(applyBattleLosses(s,b),9);assert.equal(s.troops,491)
  child.hp=20.2;arrive(b,child)
  assert.equal(total(b),482);assert.equal(guns(b),482);assert.equal(b.units[0].type,'battalion')
  const result=settle(s,b);assert.equal(result.lostTroops,18);assert.equal(s.troops,482)
  assert.equal(Object.values(s.weaponCounts).reduce((a,b)=>a+b,0),482)
  assert.equal(s.formations[0].troops,482);assert.equal(s.formations[0].type,'battalion')
  assert.equal(settle(s,b),null);assert.deepEqual(normalizeSave(s),s)
})

test('主力阵亡但分遣生还时保留原营，分遣回来可重建主演员，全部阵亡只算一营',()=>{
  for(const returns of [false,true]){
    const {s,b}=battalion(),parent=b.units[0],child=b.splitSelected('company',100).unit
    parent.hp=0;assert.equal(applyBattleLosses(s,b),400);assert.equal(s.troops,100)
    assert.equal(s.formations[0].type,'battalion');assert.equal(b.lostUnits,0)
    if(returns){arrive(b,child);assert.equal(parent.hp,100);assert.equal(b.units.length,1);assert.equal(parent.name,'1营')}
    else {child.hp=0;assert.equal(applyBattleLosses(s,b),100);assert.equal(s.formations.length,0);assert.equal(b.lostUnits,1)}
    settle(s,b);assert.equal(s.troops,returns?100:0);assert.deepEqual(normalizeSave(s),s)
  }
})

test('分遣阵亡后继续多次分遣归队不补兵，不复活阵亡武器',()=>{
  const {s,b}=battalion();const child=b.splitSelected('company',100).unit;child.hp=0
  assert.equal(applyBattleLosses(s,b),100);assert.equal(s.weaponCounts.rifle,320);assert.equal(s.weaponCounts.machinegun,80)
  for(let i=0;i<5;i++){b.selectUnit(1);const child=b.splitSelected('platoon',25).unit;arrive(b,child)}
  assert.equal(total(b),400);settle(s,b);assert.equal(s.troops,400);assert.equal(s.formations[0].type,'battalion')
  assert.equal(s.weaponCounts.rifle,320);assert.equal(s.weaponCounts.machinegun,80)
})

test('多层分遣上级先归队时，下属召回关系转交原主力，分遣伤亡结算到合编原树',()=>{
  const s=freshSave();for(let i=0;i<9;i++)setFormation(s,'squad',10)
  const ids=[];for(let i=0;i<3;i++)ids.push(mergeFormations(s,[i*3+1,i*3+2,i*3+3]).unit.id)
  const root=mergeFormations(s,ids).unit,b=new CampaignBattle(1,campaignDeployment(s,[root.id]).units);b.pending=0;b.selectUnit(root.id)
  const platoon=b.splitSelected('platoon',25).unit,squad=b.splitSelected('squad',7).unit
  arrive(b,platoon);assert.equal(squad.parentActorId,root.id)
  squad.hp=0;applyBattleLosses(s,b);const result=settle(s,b)
  assert.equal(result.lostTroops,7);assert.equal(s.troops,113);assert.equal(s.formations.find(u=>u.id===root.id).troops,83)
  assert.deepEqual(normalizeSave(s),s)
})

test('极度饥饿伤害减半、射击间隔1.5倍、移动70%，仍能开火，炮火支援已撤除',()=>{
  const normal=battalion(),hungry=battalion();hungry.s.hungerDebt=3
  const make=({s,b})=>{
    const g=Object.create(Game.prototype);g.save=s;g.battle=b;g.syncBattleReadiness()
    const unit=b.units[0];unit.target={x:900,y:unit.y};unit.groups.forEach(g=>g.cool=0)
    b.enemies=[{weapon:'rifle',hp:10000,maxHp:10000,troops:10000,x:unit.x+150,y:unit.y,cool:100}]
    const x=unit.x;b.update(.1);return {damage:10000-b.enemies[0].hp,moved:unit.x-x,cool:unit.groups[0].cool}
  }
  const a=make(normal),b=make(hungry)
  assert(Math.abs(b.damage/a.damage-.5)<1e-8);assert(Math.abs(b.moved/a.moved-.7)<1e-8);assert.equal(b.cool/a.cool,1.5)
  assert.equal(hungry.b.strike(),false);assert.equal(hungry.b.artillery,0)
})

test('战场分遣界面可选下级、调人数、确认和召回，灶房自动开关可保存',()=>{
  const {s,b}=battalion(),g=Object.create(Game.prototype);let saved=0;g.save=s;g.battle=b;g.scene='battle';g.modal=null;g.notify=()=>{};g.persist=()=>{saved++};g.buttons=[]
  g.ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  const draw=()=>{g.buttons=[];g.drawModal();for(const item of g.buttons)assert(item.x>=270&&item.x+item.w<=1170&&item.y>=130&&item.y+item.h<=680,item.id)}
  const click=id=>{const item=g.buttons.find(item=>item.id===id);assert(item,id);item.fn()}
  g.drawCampaignRoster();click('battle-split');draw();click('split-type-platoon');draw();click('split-plus');click('split-confirm')
  assert.equal(b.units.length,2);assert.equal(b.selectedUnit.type,'platoon');assert.equal(b.selectedUnit.hp,26);assert.equal(g.modal,null)
  g.buttons=[];g.drawCampaignRoster();click('battle-recall');assert.equal(b.selectedUnit.returningTo,1)
  g.open('kitchen');draw();click('kitchen-auto');assert.equal(s.autoCooking,false);assert.equal(saved,1)
  assert.equal(normalizeSave(s).autoCooking,false)
})
