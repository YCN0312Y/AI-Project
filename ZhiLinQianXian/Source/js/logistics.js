// 生食按补给「份」计量：商城采购 → 赠送乡亲，或送入灶房做成饭。
// 熟食是另一套库存：部队只吃灶房做好的饭，不能直接吃生食。
import {ALL_VILLAGES} from './world-map.js'
import {villagePopulation,advancePopulation,takeVillageRecruits} from './population.js'
import {villageControlled,garrisonedVillages,villageUnits} from './villages.js'
export const FOODS = [
  {id:'millet',name:'谷子',price:12,icon:'grain'},
  {id:'rice',name:'大米',price:16,icon:'grain'},
  {id:'corn',name:'苞谷',price:12,icon:'corn'},
  {id:'pork',name:'猪肉',price:30,icon:'meat'},
  {id:'salt',name:'食盐',price:10,icon:'salt'},
  {id:'oil',name:'油',price:24,icon:'oil'},
  {id:'eggs',name:'鸡蛋',price:20,icon:'egg'},
].map(food=>({...food,category:'logistics',amount:10,unit:'份',desc:'送给乡亲 / 灶房食材 · 每份计 1 份补给'}))
export const FISH={id:'fish',name:'鲜鱼',category:'logistics',icon:'fish',unit:'份'}
const RAW_FOODS=[...FOODS,FISH]
// 每「批」按 input 消耗生食，产出 output 份熟食；组合菜不损耗份数。
export const DISHES = [
  {id:'cookedMillet',name:'饼',icon:'grain',input:{millet:1},output:1,recipe:'谷子 1 份',autoCook:true},
  {id:'cookedRice',name:'炒米',icon:'meal',input:{rice:1},output:1,recipe:'大米 1 份',autoCook:true},
  {id:'cookedCorn',name:'玉米',icon:'corn',input:{corn:1},output:1,recipe:'苞谷 1 份',autoCook:true},
  {id:'cookedPork',name:'熟猪肉',icon:'meat',input:{oil:1,salt:1,pork:1},output:3,recipe:'油 1 + 食盐 1 + 猪肉 1',autoCook:false},
  {id:'cookedEgg',name:'荷包蛋',icon:'egg',input:{oil:1,eggs:1,salt:1},output:3,recipe:'油 1 + 鸡蛋 1 + 食盐 1',autoCook:false},
  {id:'cookedFish',name:'熟鱼',icon:'fish',input:{fish:1},output:1,recipe:'鲜鱼 1 份',autoCook:false},
].map(dish=>({...dish,desc:`${dish.recipe} → ${dish.name} ${dish.output} 份`}))
export const RECRUITMENT={interval:10,starvedInterval:20,batch:5,foodPerBatch:5,min:1,max:10000,maxBatches:10000,maxStreak:2,troopLimit:10000000}
export const RATIONS={interval:300,soldiersPerPortion:10,version:2}
export const VILLAGE_SUPPLY_IDS=['millet','rice','corn','eggs','pork']
export function grantVillageSupplies(s,count){
  // 乡亲赠送物资暂停；保留旧接口及历史存档字段，既有库存不回收。
  return {}
}
export const villageSupplyText=supplies=>Object.entries(supplies||{}).filter(([id,n])=>VILLAGE_SUPPLY_IDS.includes(id)&&n>0).map(([id,n])=>FOODS.find(food=>food.id===id).name+' +'+n).join('、')||'尚无回赠'
export const HUNGER={severeAt:2,disabledAt:3,recoveryPerMeal:1}
export function hungerStatus(s){
  const debt=Number.isFinite(s.hungerDebt)?Math.max(0,Math.min(HUNGER.disabledAt,s.hungerDebt)):0
  const disabled=debt>=HUNGER.disabledAt-1e-8
  return {debt,disabled,damageMultiplier:disabled ? .5 : 1,intervalMultiplier:disabled?1.5:1,speedMultiplier:disabled ? .7 : 1,label:disabled?'极度饥饿':debt>=HUNGER.severeAt?'严重饥饿':debt>0?'饥饿':'补给正常'}
}
export const freshLogistics=()=>({
  ...Object.fromEntries(RAW_FOODS.map(food=>[food.id,0])),
  ...Object.fromEntries(DISHES.map(dish=>[dish.id,0])),
  mobilizationFood:0,mobilizationCoins:0,mobilizationActive:false,recruitElapsed:0,mealElapsed:0,rationClockVersion:RATIONS.version,autoCooking:true,
  villageMobilization:{},villageMobilizationVersion:1,
  mobilizationScope:'village',allVillagesMobilizing:false,
  villageSupplyCursor:0,villageSuppliesReceived:0,lastVillageSupplies:{},
  lastMealShortage:0,lastMealServed:0,foodConsumed:0,dishesCooked:0,lastDonationFood:null,donationStreak:0,hungerDebt:0,
})
export const foodStock=s=>RAW_FOODS.reduce((sum,food)=>sum+(s[food.id]||0),0)
export const rationStock=s=>DISHES.reduce((sum,dish)=>sum+(s[dish.id]||0),0)
export const totalPersonnel=s=>s.troops
export const mealCost=s=>Math.ceil(totalPersonnel(s)/RATIONS.soldiersPerPortion)
function takeRations(s,needed){
  let used=0
  for(const dish of DISHES){const take=Math.min(s[dish.id]||0,needed-used);s[dish.id]-=take;used+=take}
  s.foodConsumed=Math.min(10000000,s.foodConsumed+used)
  return used
}
// 严重饥饿先吃现有熟食，按实际份量恢复；有吃到才重启正常开饭计时。
export function feedHungryTroops(s){
  const result={meals:0,consumed:0,shortage:0},demand=mealCost(s)
  const debt=hungerStatus(s).debt,partial=s.lastMealServed>0&&s.lastMealShortage>0
  if(!demand||!rationStock(s)||!(debt>=HUNGER.severeAt||partial&&debt>0))return result
  const served=partial?Math.min(demand,s.lastMealServed):0,used=takeRations(s,demand-served)
  s.lastMealServed=served+used;s.lastMealShortage=demand-s.lastMealServed
  s.hungerDebt=s.lastMealShortage?Math.max(0,debt-used/demand*HUNGER.recoveryPerMeal):0
  if(used){s.mealElapsed=0;result.meals=1;result.consumed=used}
  return result
}
export const recruitmentFoodCost=s=>(s.mobilizationDiscounts||0)>0?3:RECRUITMENT.foodPerBatch
export const freshMobilization=()=>({mobilizationFood:0,mobilizationCoins:0,mobilizationActive:false,recruitElapsed:0,lastDonationFood:null,donationStreak:0,recruitedTroops:0,recruitmentCount:0})
export function mobilizationRecord(s,villageId=null,create=false){
  if(villageId===null)return s
  if(!ALL_VILLAGES.some(v=>v.id===villageId))return null
  if(create){s.villageMobilization||={};return s.villageMobilization[villageId]||=freshMobilization()}
  return s.villageMobilization?.[villageId]||freshMobilization()
}
export const recruitmentContexts=s=>s.mobilizationScope==='all'?garrisonedVillages(s).map(v=>v.id):[null,...ALL_VILLAGES.filter(v=>s.villageMobilization?.[v.id]).map(v=>v.id)]
export const recruitmentSupport=(s,villageId=null)=>{const m=mobilizationRecord(s,villageId);return (m?.mobilizationFood||0)+(m?.mobilizationCoins||0)+(s.mobilizationScope==='all'&&villageId!==null?s.mobilizationFood+s.mobilizationCoins:0)}
// 有粮 10 秒一批，断粮 20 秒一批；断粮批次仍报名，只是不再消耗食品。
export const recruitmentInterval=(s,villageId=null)=>recruitmentSupport(s,villageId)>=recruitmentFoodCost(s)?RECRUITMENT.interval:RECRUITMENT.starvedInterval
export function donationTaste(s,villageId=null){
  const m=mobilizationRecord(s,villageId),food=FOODS.find(item=>item.id===m?.lastDonationFood),streak=m?.donationStreak||0
  return {name:food?.name||null,streak,remaining:Math.max(0,RECRUITMENT.maxStreak-streak),blocked:!!food&&streak>=RECRUITMENT.maxStreak}
}
export function validateCooking(s,id,batches){
  const dish=DISHES.find(dish=>dish.id===id)
  if(!dish)return {ok:false,message:'请选择要做的饭'}
  if(!Number.isInteger(batches)||batches<1||batches>RECRUITMENT.maxBatches)return {ok:false,message:`每次做饭须为 1—${RECRUITMENT.maxBatches} 批`}
  for(const [raw,count] of Object.entries(dish.input)){
    const need=count*batches,name=RAW_FOODS.find(food=>food.id===raw)?.name||raw
    if((s[raw]||0)<need)return {ok:false,message:`${name}不足，需要 ${need} 份，仓库仅有 ${s[raw]||0} 份`}
  }
  if((s[dish.id]||0)+dish.output*batches>10000000)return {ok:false,message:'熟食库存已达上限'}
  return {ok:true,dish,batches}
}
export function cookDish(s,id,batches,{serve=true}={}){
  const result=validateCooking(s,id,batches)
  if(!result.ok)return result
  for(const [raw,count] of Object.entries(result.dish.input))s[raw]-=count*batches
  s[result.dish.id]+=result.dish.output*batches
  s.dishesCooked=Math.min(10000000,(s.dishesCooked||0)+batches)
  result.feeding=serve?feedHungryTroops(s):{meals:0,consumed:0,shortage:0}
  return result
}
// 只补本餐熟食缺口，随机制作原料够用的主食。
export function autoCookMeal(s,random=Math.random,{force=false,target=mealCost(s)}={}){
  const cooked={}
  if(s.autoCooking===false&&!force)return cooked
  let needed=target-rationStock(s)
  while(needed>0){
    const choices=DISHES.filter(dish=>dish.autoCook&&Object.entries(dish.input).every(([id,n])=>(s[id]||0)>=n))
    if(!choices.length)break
    const dish=choices[Math.min(choices.length-1,Math.max(0,Math.floor(random()*choices.length)))]
    const batches=Math.min(RECRUITMENT.maxBatches,Math.ceil(needed/dish.output),...Object.entries(dish.input).map(([id,n])=>Math.floor(s[id]/n)))
    const result=cookDish(s,dish.id,batches,{serve:false})
    if(!result.ok)break
    const amount=batches*dish.output;cooked[dish.id]=(cooked[dish.id]||0)+amount;needed-=amount
  }
  return cooked
}
export function serveMealNow(s,random=Math.random){
  const demand=mealCost(s),debt=hungerStatus(s).debt
  if(!demand)return {ok:false,message:'暂无需要供餐的士兵'}
  if(!debt&&!s.lastMealShortage&&s.lastMealServed>=demand)return {ok:false,message:'本餐已经吃饱，无需重复开饭'}
  const served=s.lastMealShortage>0||!debt?Math.min(demand,s.lastMealServed||0):0,needed=demand-served
  const cooked=autoCookMeal(s,random,{force:true,target:needed}),consumed=takeRations(s,needed)
  if(!consumed)return {ok:false,message:'没有熟食或可用主食原料，请先补充粮食'}
  s.lastMealServed=served+consumed;s.lastMealShortage=demand-s.lastMealServed
  s.hungerDebt=s.lastMealShortage?Math.max(0,debt-consumed/demand):0;s.mealElapsed=0
  return {ok:true,consumed,cooked,shortage:s.lastMealShortage}
}
export function validateDonation(s,id,count,villageId=null){
  const m=mobilizationRecord(s,villageId);if(!m)return {ok:false,message:'请选择有效的动员村庄'}
  if(id==='coins'){
    if(!Number.isInteger(count)||count<RECRUITMENT.min||count>RECRUITMENT.max)return {ok:false,message:'每次赠送须为1—10000枚金币的整数'}
    if(s.coins<count)return {ok:false,message:'金币不足'}
    if((m.mobilizationCoins||0)+count>10000000)return {ok:false,message:'动员金币储备已达到上限'}
    return {ok:true,food:{id:'coins',name:'金币',unit:'枚'},count}
  }
  const food=FOODS.find(food=>food.id===id)
  if(!food)return {ok:false,message:'请选择要送给乡亲的食品'}
  if(!Number.isInteger(count)||count<RECRUITMENT.min||count>RECRUITMENT.max)return {ok:false,message:`每次投放须为 1—${RECRUITMENT.max} 份之间的整数`}
  if(m.lastDonationFood===id&&(m.donationStreak||0)>=RECRUITMENT.maxStreak)return {ok:false,message:`乡亲们连着吃了 ${m.donationStreak} 次${food.name}，换一样食品再送吧`}
  if((s[id]||0)<count)return {ok:false,message:`${food.name}不足，仓库仅有 ${s[id]||0} 份，请先去商城采购`}
  if(m.mobilizationFood+count>10000000)return {ok:false,message:'动员储备已达到上限'}
  return {ok:true,food,count}
}
export function donateFood(s,id,count,villageId=null){
  const result=validateDonation(s,id,count,villageId)
  if(!result.ok)return result
  const before=recruitmentInterval(s,villageId),m=mobilizationRecord(s,villageId,true)
  s[id]-=count
  if(id==='coins')m.mobilizationCoins=(m.mobilizationCoins||0)+count
  else m.mobilizationFood+=count
  m.mobilizationActive=true
  // 补粮后计时速率可能改变，按已完成比例缩放，不白等也不重复计时。
  const after=recruitmentInterval(s,villageId)
  if(before!==after)m.recruitElapsed=m.recruitElapsed*after/before
  if(id!=='coins'){m.donationStreak=m.lastDonationFood===id?(m.donationStreak||0)+1:1;m.lastDonationFood=id}
  return result
}
export function mobilizationStatus(s,villageId=null){
  if(s.mobilizationScope==='all'&&villageId!==null&&(!villageControlled(s,villageId)||!villageUnits(s,villageId).length))return '未驻军'
  if(!(s.mobilizationScope==='all'&&villageId!==null?s.allVillagesMobilizing:mobilizationRecord(s,villageId)?.mobilizationActive))return '动员已暂停'
  if(totalPersonnel(s)+(villageId===null?RECRUITMENT.batch:1)>RECRUITMENT.troopLimit)return '兵力已达上限'
  if(villageId!==null&&villagePopulation(s,villageId)<=0)return '村民不足'
  if(recruitmentSupport(s,villageId)>=recruitmentFoodCost(s))return '乡亲报名中'
  return '缺粮报名中'
}
export function setMobilizationActive(s,active,villageId=null){if(s.mobilizationScope==='all')return setAllVillagesMobilizing(s,active);const m=mobilizationRecord(s,villageId,true);if(!m)return false;m.mobilizationActive=!!active;return true}
export function enableAllVillageMobilization(s){
  if(s.mobilizationScope==='all')return false
  const rates=ALL_VILLAGES.map(v=>[v.id,recruitmentInterval(s,v.id)])
  const active=s.mobilizationActive||Object.values(s.villageMobilization||{}).some(m=>m.mobilizationActive)
  s.mobilizationScope='all';s.allVillagesMobilizing=!!active;s.mobilizationActive=false
  for(const v of ALL_VILLAGES)mobilizationRecord(s,v.id,true).mobilizationActive=!!active
  for(const [id,rate] of rates){const next=recruitmentInterval(s,id);if(rate!==next)mobilizationRecord(s,id).recruitElapsed*=next/rate}
  return true
}
export function setAllVillagesMobilizing(s,active){
  enableAllVillageMobilization(s);s.allVillagesMobilizing=!!active;s.mobilizationActive=false
  for(const v of ALL_VILLAGES)mobilizationRecord(s,v.id,true).mobilizationActive=!!active
  return true
}
export function donateAllVillages(s,id,count){
  if(!garrisonedVillages(s).length)return {ok:false,message:'请先派部队驻防至少一个村庄，才能发动群众'}
  const quote=validateDonation(s,id,count);if(!quote.ok)return quote
  enableAllVillageMobilization(s)
  const before=ALL_VILLAGES.map(v=>[v.id,recruitmentInterval(s,v.id)])
  const result=donateFood(s,id,count)
  setAllVillagesMobilizing(s,true);s.recruitElapsed=0
  for(const [key,rate] of before){const next=recruitmentInterval(s,key);if(next!==rate)mobilizationRecord(s,key).recruitElapsed*=next/rate}
  return result
}
export function normalizeVillageMobilization(s,raw){
  s.mobilizationScope=raw?.mobilizationScope==='all'?'all':'village';s.allVillagesMobilizing=raw?.allVillagesMobilizing===true
  s.villageMobilization={}
  for(const village of ALL_VILLAGES){
    const value=raw?.villageMobilization?.[village.id];if(!value||typeof value!=='object'||Array.isArray(value))continue
    const m=freshMobilization()
    for(const key of ['mobilizationFood','mobilizationCoins','recruitedTroops','recruitmentCount'])if(Number.isFinite(value[key]))m[key]=Math.max(0,Math.min(10000000,Math.floor(value[key])))
    m.mobilizationActive=s.mobilizationScope==='all'?s.allVillagesMobilizing:value.mobilizationActive===true
    if(FOODS.some(food=>food.id===value.lastDonationFood)){m.lastDonationFood=value.lastDonationFood;m.donationStreak=Math.max(0,Math.min(2,Math.floor(value.donationStreak)||0))}
    s.villageMobilization[village.id]=m
    if(Number.isFinite(value.recruitElapsed)&&value.recruitElapsed>=0&&value.recruitElapsed<=recruitmentInterval(s,village.id))m.recruitElapsed=value.recruitElapsed
  }
  if(s.mobilizationScope==='all'){for(const v of ALL_VILLAGES)mobilizationRecord(s,v.id,true).mobilizationActive=s.allVillagesMobilizing;s.mobilizationActive=false}
  const legacy=s.mobilizationFood||s.mobilizationCoins||s.mobilizationActive||s.recruitElapsed||s.lastDonationFood
  s.villageMobilizationVersion=s.mobilizationScope==='all'||raw?.villageMobilizationVersion===1||!legacy?1:0
}
export function migrateVillageMobilization(s){
  if(s.villageMobilizationVersion===1)return false
  const id=ALL_VILLAGES[0].id,m=mobilizationRecord(s,id,true),oldRate=recruitmentInterval(s,id)
  const elapsed=m.mobilizationActive?m.recruitElapsed:s.recruitElapsed
  const rate=m.mobilizationActive?oldRate:recruitmentInterval(s)
  m.mobilizationFood=Math.min(10000000,m.mobilizationFood+s.mobilizationFood)
  m.mobilizationCoins=Math.min(10000000,m.mobilizationCoins+s.mobilizationCoins)
  m.mobilizationActive=m.mobilizationActive||s.mobilizationActive
  m.recruitElapsed=elapsed*recruitmentInterval(s,id)/rate
  if(!m.lastDonationFood){m.lastDonationFood=s.lastDonationFood;m.donationStreak=s.donationStreak}
  Object.assign(s,{mobilizationFood:0,mobilizationCoins:0,mobilizationActive:false,recruitElapsed:0,lastDonationFood:null,donationStreak:0,villageMobilizationVersion:1})
  return true
}
// 只由前台帧时钟驱动，不读取墙钟；刷新保留余下秒数，离线不结算。
export function advanceLogistics(s,seconds,random=Math.random){
  const result={recruited:0,meals:0,consumed:0,shortage:0,supplies:{},populationGrown:0}
  if(!Number.isFinite(seconds)||seconds<0)return result
  Object.assign(result,feedHungryTroops(s))
  result.populationGrown=advancePopulation(s,0,random)
  const contexts=recruitmentContexts(s),rates=new Map(contexts.map(id=>[id,recruitmentInterval(s,id)]))
  let remaining=seconds
  while(remaining>1e-8){
    const recruiting=[]
    for(const id of contexts){
      const m=mobilizationRecord(s,id),rate=recruitmentInterval(s,id),previous=rates.get(id),status=mobilizationStatus(s,id)
      if(rate!==previous)m.recruitElapsed=m.recruitElapsed*rate/previous
      rates.set(id,rate);m.recruitElapsed=Math.min(rate,m.recruitElapsed)
      if(status==='乡亲报名中'||status==='缺粮报名中')recruiting.push(id)
    }
    const nextRecruit=Math.min(...recruiting.map(id=>Math.max(0,rates.get(id)-mobilizationRecord(s,id).recruitElapsed)),Infinity)
    const nextMeal=Math.max(0,RATIONS.interval-s.mealElapsed)
    const step=Math.min(remaining,nextRecruit,nextMeal,60-(s.populationClock||0))
    s.mealElapsed+=step;for(const id of recruiting)mobilizationRecord(s,id).recruitElapsed+=step
    result.populationGrown+=advancePopulation(s,step,random)
    remaining-=step
    // 同时到时先按原人数开饭，新报名的人员参加下一餐，编制父子不重复计数。
    if(s.mealElapsed>=RATIONS.interval-1e-8){
      autoCookMeal(s)
      s.mealElapsed=0;const demand=mealCost(s),used=takeRations(s,demand),needed=demand-used
      // 部队只吃灶房出锅的熟食；生食与已赠乡亲的动员储备都不作军粮。
      s.lastMealShortage=needed;s.lastMealServed=used
      // 吃够本餐即恢复正常；未吃够才按实际缺口累计饥饿。
      s.hungerDebt=!demand||!needed?0:Math.min(HUNGER.disabledAt,hungerStatus(s).debt+needed/demand)
      result.meals++;result.consumed+=used;result.shortage+=needed
      const extra=feedHungryTroops(s)
      result.meals+=extra.meals;result.consumed+=extra.consumed
    }
    for(const id of recruiting){
      const m=mobilizationRecord(s,id)
      const room=RECRUITMENT.troopLimit-totalPersonnel(s)
      if(m.recruitElapsed<rates.get(id)-1e-8||room<(id===null?RECRUITMENT.batch:1))continue
      const count=id===null?RECRUITMENT.batch:takeVillageRecruits(s,id,room,random)
      if(!count)continue
      m.recruitElapsed=0
      const cost=recruitmentFoodCost(s)
      if(recruitmentSupport(s,id)>=cost){
        let remainingCost=cost
        for(const pool of s.mobilizationScope==='all'&&id!==null?[m,s]:[m])for(const key of ['mobilizationFood','mobilizationCoins']){const take=Math.min(pool[key]||0,remainingCost);pool[key]-=take;remainingCost-=take}
        if((s.mobilizationDiscounts||0)>0)s.mobilizationDiscounts--
      }
      s.troops+=count
      s.recruitedTroops=Math.min(RECRUITMENT.troopLimit,(s.recruitedTroops||0)+count)
      s.recruitmentCount=Math.min(RECRUITMENT.troopLimit,(s.recruitmentCount||0)+1)
      if(id!==null){m.recruitedTroops=Math.min(RECRUITMENT.troopLimit,m.recruitedTroops+count);m.recruitmentCount=Math.min(RECRUITMENT.troopLimit,m.recruitmentCount+1)}
      result.recruited+=count
    }
    // 统一储备耗尽时，其余村庄的进度立即按新周期换算，跨帧不丢比例。
    for(const id of contexts){const rate=rates.get(id),next=recruitmentInterval(s,id);if(rate!==next){mobilizationRecord(s,id).recruitElapsed*=next/rate;rates.set(id,next)}}
  }
  return result
}
