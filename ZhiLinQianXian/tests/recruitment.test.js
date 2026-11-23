import test from 'node:test'
import assert from 'node:assert/strict'
import { MODES,GOODS,MISSIONS,freshSave,normalizeSave,purchase,formation,setFormation,reinforceFormation,mergeFormations,missionProgress,claim } from '../js/state.js'
import { FOODS,DISHES,RECRUITMENT,RATIONS,foodStock,rationStock,mealCost,recruitmentInterval,validateDonation,donateFood,donationTaste,validateCooking,cookDish,mobilizationStatus,advanceLogistics,mobilizationRecord } from '../js/logistics.js'
import { Game } from '../js/game.js'
import { stationTroops } from '../js/villages.js'
const garrisonAll=s=>{for(let i=1;i<=6;i++){assert(setFormation(s,'squad',7).ok);assert(stationTroops(s,i,[s.formations.at(-1).id]).ok)}}

function game(){
  const g=Object.create(Game.prototype)
  g.save=freshSave();g.scene='lobby';g.modal=null;g.buttons=[];g.notify=()=>{};g.persist=()=>{}
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(object,key)=>object[key]??(()=>{}),set:(object,key,value)=>(object[key]=value,true)})
  return g
}
function draw(g){g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
function click(g,id){const button=g.buttons.find(button=>button.id===id);assert(button,id);button.fn()}

test('发动群众和旧入口进入食品动员，商城不能直接购买士兵',()=>{
  assert(MODES.some(mode=>mode.id==='recruitment'&&mode.name==='发动群众'))
  const g=game();assert(setFormation(g.save,'squad',7).ok);assert(stationTroops(g.save,1,[1]).ok)
  g.drawLobby();click(g,'map-site-1');draw(g);click(g,'village-recruitment');assert.equal(g.modal,'recruitment');assert.equal(g.recruitQuantity,20)
  g.start('defense');assert.equal(g.modal,'recruitment');assert.equal(g.scene,'world-map');assert.equal(g.battle,undefined)
  assert.equal(GOODS.some(item=>item.id==='troops'),false)
  const before=JSON.stringify(g.save);assert.equal(purchase(g.save,'troops'),false);assert.equal(JSON.stringify(g.save),before)
})

test('后勤七种食品可重复购买，仓库仅展示已有食品，所有按钮在面板内',()=>{
  assert.deepEqual(FOODS.map(food=>food.name),['谷子','大米','苞谷','猪肉','食盐','油','鸡蛋'])
  const g=game();g.openFoodShop();draw(g);assert(g.buttons.some(button=>button.id==='tab-logistics'))
  for(const food of FOODS){click(g,'buy-'+food.id);draw(g);click(g,'buy-'+food.id);assert.equal(g.save[food.id],['salt','oil'].includes(food.id)?10:20)}
  assert.equal(foodStock(g.save),120)
  g.open('warehouse');g.inventoryTab='logistics';draw(g);assert.equal(g.buttons.some(b=>b.id.startsWith('buy-')),false)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(g.save))),g.save)
  g.save.millet=9999999;const coins=g.save.coins;assert.equal(purchase(g.save,'millet'),false);assert.equal(g.save.coins,coins)
})

test('赠送食品独立转入动员储备，立即不增加兵力也不扣金币',()=>{
  const s=freshSave();s.rice=30;const coins=s.coins,troops=s.troops
  assert(donateFood(s,'rice',20).ok);assert.equal(s.rice,10);assert.equal(s.mobilizationFood,20);assert.equal(s.mobilizationActive,true)
  assert.equal(s.coins,coins);assert.equal(s.troops,troops);assert.equal(s.recruitedTroops,0)
  for(const id of ['troops','unknown'])assert.equal(validateDonation(s,id,10).ok,false)
  for(const count of [0,-1,1.2,10001,NaN,Infinity,'10']){const before=JSON.stringify(s);assert.equal(donateFood(s,'rice',count).ok,false);assert.equal(JSON.stringify(s),before)}
  const before=JSON.stringify(s);assert.equal(donateFood(s,'rice',11).ok,false);assert.equal(JSON.stringify(s),before)
})

test('有粮每10秒批次报名5人，食品只扣一次，原部队、配发和训练记录保留',()=>{
  const s=freshSave();assert(setFormation(s,'squad',9).ok);s.formations[0].trainingXp=5400;s.reserveTrainingXp=600;s.millet=20
  const units=JSON.stringify(s.formations),weapons=JSON.stringify(s.weaponCounts),coins=s.coins
  assert(donateFood(s,'millet',20).ok);assert.equal(advanceLogistics(s,9.9).recruited,0);assert.equal(s.troops,120)
  assert.equal(advanceLogistics(s,.1).recruited,5);assert.equal(s.troops,125);assert.equal(s.mobilizationFood,15)
  assert.equal(advanceLogistics(s,30).recruited,15);assert.equal(s.troops,140);assert.equal(s.mobilizationFood,0)
  assert.equal(formation(s).unassignedTroops,131);assert.equal(s.recruitedTroops,20);assert.equal(s.recruitmentCount,4)
  assert.equal(s.coins,coins);assert.equal(s.reserveTrainingXp,600)
  assert.equal(JSON.stringify(s.formations),units);assert.equal(JSON.stringify(s.weaponCounts),weapons)
  assert.equal(mobilizationStatus(s),'缺粮报名中')
})

test('群众食物耗尽后改为20秒报名5人，不再消耗食品，补粮恢复10秒且进度接续',()=>{
  const s=freshSave();s.millet=5;assert(donateFood(s,'millet',5).ok)
  assert.equal(advanceLogistics(s,9.9).recruited,0)
  assert.equal(advanceLogistics(s,.1).recruited,5);assert.equal(s.mobilizationFood,0)
  assert.equal(recruitmentInterval(s),RECRUITMENT.starvedInterval);assert.equal(mobilizationStatus(s),'缺粮报名中')
  assert.equal(advanceLogistics(s,19.9).recruited,0)
  assert.equal(advanceLogistics(s,.1).recruited,5);assert.equal(s.troops,130);assert.equal(s.mobilizationFood,0)
  assert.equal(s.recruitedTroops,10)
  // 断粮计时走到一半时补粮，按已完成比例换算回 10 秒制，不白等也不重复计时。
  const t=freshSave();t.millet=5;t.rice=10;assert(donateFood(t,'millet',5).ok)
  advanceLogistics(t,10);advanceLogistics(t,10);assert.equal(t.recruitElapsed,10)
  assert(donateFood(t,'rice',5).ok);assert.equal(t.recruitElapsed,5);assert.equal(recruitmentInterval(t),10)
  assert.equal(advanceLogistics(t,4.9).recruited,0)
  assert.equal(advanceLogistics(t,.1).recruited,5);assert.equal(t.mobilizationFood,0);assert.equal(t.troops,130)
})

test('同一种食品最多连续送2次，换样后重置，被拦截时不改存档',()=>{
  const s=freshSave();s.millet=50;s.rice=50;s.corn=50
  assert(donateFood(s,'millet',5).ok);assert.equal(s.donationStreak,1)
  assert(donateFood(s,'millet',5).ok);assert.equal(s.donationStreak,2)
  const before=JSON.stringify(s),third=donateFood(s,'millet',5)
  assert.equal(third.ok,false);assert.match(third.message,/换一样食品/);assert.equal(JSON.stringify(s),before)
  assert.equal(donationTaste(s).blocked,true);assert.equal(donationTaste(s).name,'谷子')
  assert(donateFood(s,'rice',5).ok);assert.equal(s.donationStreak,1);assert.equal(s.lastDonationFood,'rice')
  assert(donateFood(s,'rice',5).ok);assert(donateFood(s,'corn',5).ok)
  assert.equal(donationTaste(s).name,'苞谷');assert.equal(donationTaste(s).streak,1)
})

test('动员暂停与重新投放保留进度，零兵力可恢复，达到上限停止',()=>{
  const s=freshSave();s.troops=0;s.eggs=10;assert(donateFood(s,'eggs',5).ok)
  advanceLogistics(s,4);s.mobilizationActive=false;advanceLogistics(s,20);assert.equal(s.recruitElapsed,4);assert.equal(s.troops,0)
  s.mobilizationActive=true;assert.equal(advanceLogistics(s,6).recruited,5);assert.equal(s.troops,5)
  advanceLogistics(s,3);assert(donateFood(s,'eggs',5).ok);advanceLogistics(s,10);assert.equal(s.troops,10)
  s.mobilizationFood=20;s.troops=RECRUITMENT.troopLimit-5;advanceLogistics(s,10);assert.equal(s.troops,RECRUITMENT.troopLimit)
  const food=s.mobilizationFood;advanceLogistics(s,20);assert.equal(s.mobilizationFood,food);assert.equal(mobilizationStatus(s),'兵力已达上限')
})

test('灶房配方按批消耗生食产出熟食，非法批数与原料不足均不改存档',()=>{
  assert.deepEqual(DISHES.map(dish=>dish.name),['饼','炒米','玉米','熟猪肉','荷包蛋','熟鱼'])
  const s=freshSave();s.millet=3;s.rice=2;s.corn=1;s.oil=3;s.salt=4;s.pork=1;s.eggs=1;s.fish=2
  assert(cookDish(s,'cookedMillet',3).ok);assert.equal(s.cookedMillet,3);assert.equal(s.millet,0)
  assert(cookDish(s,'cookedRice',2).ok);assert.equal(s.cookedRice,2);assert.equal(s.rice,0)
  assert(cookDish(s,'cookedCorn',1).ok);assert.equal(s.cookedCorn,1);assert.equal(s.corn,0)
  assert(cookDish(s,'cookedPork',1).ok);assert.equal(s.cookedPork,3);assert.equal(s.oil,2);assert.equal(s.salt,3);assert.equal(s.pork,0)
  assert(cookDish(s,'cookedEgg',1).ok);assert.equal(s.cookedEgg,3);assert.equal(s.oil,1);assert.equal(s.salt,2);assert.equal(s.eggs,0)
  assert(cookDish(s,'cookedFish',2).ok);assert.equal(s.cookedFish,2);assert.equal(s.fish,0)
  assert.equal(rationStock(s),14);assert.equal(s.dishesCooked,10)
  const before=JSON.stringify(s)
  for(const bad of [0,-1,1.5,10001,NaN,Infinity,'2'])assert.equal(cookDish(s,'cookedMillet',bad).ok,false)
  assert.equal(cookDish(s,'cookedMillet',1).ok,false)
  assert.equal(cookDish(s,'cookedPork',1).ok,false)
  assert.equal(cookDish(s,'unknown',1).ok,false)
  assert.equal(validateCooking(s,'cookedRice',1).ok,false)
  assert.equal(JSON.stringify(s),before)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('部队只吃熟食，分钟口粮跨成品扣除，生食与已赠食品都不作军粮',()=>{
  const s=freshSave();s.autoCooking=false;for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok);assert(mergeFormations(s,[1,2,3]).ok)
  s.millet=5;s.rice=10;s.pork=7;const units=JSON.stringify(s.formations)
  assert.equal(mealCost(s),12);assert.equal(rationStock(s),0)
  advanceLogistics(s,RATIONS.interval);assert.equal(foodStock(s),22);assert.equal(s.lastMealShortage,12);assert.equal(s.foodConsumed,0)
  assert(cookDish(s,'cookedMillet',5).ok);assert(cookDish(s,'cookedRice',10).ok);assert.equal(rationStock(s),15)
  const meal=advanceLogistics(s,RATIONS.interval);assert.equal(meal.meals,1);assert.equal(meal.consumed,12);assert.equal(meal.shortage,0)
  assert.equal(s.cookedMillet,0);assert.equal(s.cookedRice,3);assert.equal(rationStock(s),3);assert.equal(s.foodConsumed,12)
  assert.equal(s.pork,7)
  const hungry=advanceLogistics(s,RATIONS.interval);assert.equal(hungry.consumed,3);assert.equal(hungry.shortage,9);assert.equal(s.lastMealShortage,9)
  assert.equal(s.troops,120);assert.equal(JSON.stringify(s.formations),units);assert.equal(rationStock(s),0)
  s.rice=20;assert(cookDish(s,'cookedRice',20).ok);assert.equal(s.lastMealShortage,0);assert.equal(s.cookedRice,11)
  s.rice=1;assert(cookDish(s,'cookedRice',1).ok);advanceLogistics(s,RATIONS.interval);assert.equal(s.lastMealShortage,0);assert.equal(s.cookedRice,0)
})

test('已赠乡亲的食品不被部队吃掉，不足10人向上取整，零兵力不消耗',()=>{
  const s=freshSave();s.millet=20;assert(donateFood(s,'millet',10).ok);s.mobilizationActive=false
  assert(cookDish(s,'cookedMillet',10).ok)
  advanceLogistics(s,RATIONS.interval);assert.equal(s.mobilizationFood,10);assert.equal(s.cookedMillet,0);assert.equal(s.lastMealShortage,2)
  s.troops=11;assert.equal(mealCost(s),2);s.troops=1;assert.equal(mealCost(s),1)
  s.troops=0;s.millet=10;assert(cookDish(s,'cookedMillet',10).ok)
  advanceLogistics(s,RATIONS.interval);assert.equal(s.cookedMillet,10);assert.equal(s.lastMealShortage,0)
})

test('大步与逐秒推进结果相同，同一时刻先按原兵力开饭再报名',()=>{
  const a=freshSave();a.millet=50;a.rice=200;a.cookedRice=200;donateFood(a,'millet',50)
  const b=structuredClone(a);advanceLogistics(a,180);for(let i=0;i<180;i++)advanceLogistics(b,1)
  assert.deepEqual(a,b);assert.equal(a.troops,190);assert.equal(a.cookedRice,200-a.foodConsumed)
  const t=freshSave();t.troops=100;t.mealElapsed=RATIONS.interval-60;t.cookedRice=100;t.millet=60;donateFood(t,'millet',60)
  const result=advanceLogistics(t,60)
  assert.equal(result.recruited,30);assert.equal(t.troops,130);assert.equal(result.consumed,13)
  for(const seconds of [-1,NaN,Infinity,0]){const before=JSON.stringify(a);advanceLogistics(a,seconds);assert.equal(JSON.stringify(a),before)}
})

test('刷新保留熟食、口味与断粮秒数，无离线增长；旧存档和非法数据迁移不丢进度',()=>{
  const s=freshSave();s.millet=20;donateFood(s,'millet',10);assert(cookDish(s,'cookedMillet',10).ok);advanceLogistics(s,7.5)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s);assert.equal(restored.troops,120)
  advanceLogistics(restored,2.5);assert.equal(restored.troops,125);assert.equal(restored.mobilizationFood,5)
  assert.equal(restored.lastDonationFood,'millet');assert.equal(restored.donationStreak,1)
  const old=normalizeSave({coins:900,troops:16,recruitedTroops:10,recruitmentCount:1,shells:9});assert.equal(old.coins,900);assert.equal(old.troops,16);assert.equal(old.shells,9)
  assert.equal(old.recruitedTroops,10);assert.equal(rationStock(old),0);assert.equal(old.mobilizationActive,false)
  const invalid=normalizeSave({millet:-1,rice:Infinity,oil:2.9,mobilizationFood:NaN,recruitElapsed:25,mealElapsed:60,mobilizationActive:'true',cookedPork:-3,cookedEgg:2.9,donationStreak:99,lastDonationFood:'fake'})
  assert.equal(invalid.millet,0);assert.equal(invalid.rice,0);assert.equal(invalid.oil,2);assert.equal(invalid.mobilizationFood,0)
  assert.equal(invalid.recruitElapsed,0);assert.equal(invalid.mealElapsed,0);assert.equal(invalid.mobilizationActive,false)
  assert.equal(invalid.cookedPork,0);assert.equal(invalid.cookedEgg,2);assert.equal(invalid.donationStreak,0);assert.equal(invalid.lastDonationFood,null)
  const starved=normalizeSave({mobilizationFood:0,recruitElapsed:15});assert.equal(starved.recruitElapsed,15)
  const fed=normalizeSave({mobilizationFood:10,recruitElapsed:15});assert.equal(fed.recruitElapsed,0)
})

test('报名士兵进入未编人员，可按现有规则给战损班补员',()=>{
  const s=freshSave();setFormation(s,'squad',9);s.millet=5;donateFood(s,'millet',5);advanceLogistics(s,10)
  assert(reinforceFormation(s,1,3).ok);assert.equal(s.formations[0].troops,12);assert.equal(s.formations[0].weapons.rifle,12);assert.equal(s.troops,125)
})

test('报名任务累计50人可领取一次，旧坚守奖励与已领奖记录仍保留',()=>{
  const mission=MISSIONS.find(mission=>mission.id==='hold'),s=freshSave();s.millet=50;donateFood(s,'millet',50)
  advanceLogistics(s,90);assert.equal(missionProgress(s,mission),45);assert.equal(claim(s,'hold'),false)
  advanceLogistics(s,10);assert.equal(missionProgress(s,mission),50);assert(claim(s,'hold'));assert.equal(s.coins,900);assert.equal(claim(s,'hold'),false)
  const old=normalizeSave({bestWave:5,coins:99,claimed:[]});assert.equal(missionProgress(old,mission),50);assert(claim(old,'hold'));assert.equal(old.coins,399)
  const claimed=normalizeSave({bestWave:8,coins:99,claimed:['hold']});assert.equal(claim(claimed,'hold'),false);assert.equal(claimed.coins,99)
})

test('动员面板支持食品选择、数量输入、实际赠送、暂停和管理入口，前台时钟保存人数',()=>{
  const g=game();garrisonAll(g.save);let saved;g.persist=()=>{saved=structuredClone(g.save)};g.save.rice=30
  g.open('recruitment');draw(g);click(g,'recruit-food-rice');click(g,'recruit-preset-20');draw(g);click(g,'recruit-confirm')
  assert.equal(saved.mobilizationFood,20);assert.equal(saved.rice,10);assert.equal(saved.troops,120);assert.equal(saved.coins,600)
  g.updateLogistics(10,()=>0);assert.equal(saved.troops,138);assert.equal(saved.recruitedTroops,18)
  draw(g);click(g,'recruit-toggle');g.updateLogistics(10,()=>0);assert.equal(g.save.troops,138)
  draw(g);click(g,'recruit-preset-50');click(g,'recruit-confirm');assert.equal(g.save.rice,10)
  const originalWx=globalThis.wx;let modal;globalThis.wx={showModal:options=>{modal=options}}
  try{g.inputRecruitQuantity();assert.equal(modal.inputLabel,'食品份数');assert.equal(modal.maxValue,10000);modal.success({confirm:true,content:'0'});assert.equal(g.recruitQuantity,50);modal.success({confirm:true,content:'7'});assert.equal(g.recruitQuantity,7)}finally{if(originalWx===undefined)delete globalThis.wx;else globalThis.wx=originalWx}
  draw(g);click(g,'recruit-shop');assert.equal(g.modal,'shop');assert.equal(g.inventoryTab,'logistics');draw(g)
  g.open('recruitment');draw(g);click(g,'recruit-formation');assert.equal(g.modal,null);assert.equal(g.scene,'world-map')
})

test('动员面板显示换口味提示，第3次连续投放同种食品被拦截，换样后可继续',()=>{
  const g=game();garrisonAll(g.save);g.save.millet=100;g.save.rice=100
  g.open('recruitment');draw(g);click(g,'recruit-food-millet');click(g,'recruit-preset-10');draw(g)
  click(g,'recruit-confirm');draw(g);click(g,'recruit-confirm');assert.equal(g.save.donationStreak,2)
  const before=JSON.stringify(g.save);draw(g);click(g,'recruit-confirm');assert.equal(JSON.stringify(g.save),before)
  draw(g);click(g,'recruit-food-rice');click(g,'recruit-confirm')
  assert.equal(g.save.lastDonationFood,'rice');assert.equal(g.save.donationStreak,1);assert.equal(g.save.rice,90);assert.equal(g.save.mobilizationFood,30)
})

test('大厅新增灶房按钮，灶房面板可批量做饭并跳转商城、熟食仓库和发动群众',()=>{
  const g=game(),s=g.save;s.millet=30;s.rice=30;s.oil=10;s.salt=10;s.pork=10;s.eggs=10
  g.drawLobby();assert(g.buttons.some(b=>b.id==='kitchen'));click(g,'kitchen')
  assert.equal(g.modal,'kitchen');assert.equal(g.kitchenBatch,10)
  draw(g);for(const dish of DISHES)assert(g.buttons.some(b=>b.id==='cook-'+dish.id),dish.id)
  click(g,'kitchen-preset-5');click(g,'cook-cookedMillet');assert.equal(s.cookedMillet,5);assert.equal(s.millet,25)
  click(g,'cook-cookedPork');assert.equal(s.cookedPork,15);assert.equal(s.oil,5);assert.equal(s.salt,5);assert.equal(s.pork,5)
  const originalWx=globalThis.wx;let modal;globalThis.wx={showModal:options=>{modal=options}}
  try{g.inputKitchenBatch();assert.equal(modal.inputLabel,'做饭批数');assert.equal(modal.maxValue,10000);modal.success({confirm:true,content:'0'});assert.equal(g.kitchenBatch,5);modal.success({confirm:true,content:'7'});assert.equal(g.kitchenBatch,7)}finally{if(originalWx===undefined)delete globalThis.wx;else globalThis.wx=originalWx}
  draw(g);click(g,'kitchen-shop');assert.equal(g.modal,'shop');assert.equal(g.inventoryTab,'logistics')
  g.open('kitchen');draw(g);click(g,'kitchen-warehouse');assert.equal(g.modal,'warehouse');assert.equal(g.inventoryTab,'dishes')
  draw(g);assert(g.buttons.some(b=>b.id==='tab-dishes'));assert(g.buttons.some(b=>b.id==='dishes-kitchen'))
  click(g,'dishes-kitchen');assert.equal(g.modal,'kitchen')
  g.open('kitchen');draw(g);click(g,'kitchen-recruit');assert.equal(g.modal,'recruitment')
  g.open('formation');draw(g);click(g,'formation-food');assert.equal(g.modal,'kitchen')
})
