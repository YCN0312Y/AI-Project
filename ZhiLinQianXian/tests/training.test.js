import test from 'node:test'
import assert from 'node:assert/strict'
import { freshSave,normalizeSave,setFormation,removeFormation,mergeFormations,unmergeFormation,MODES } from '../js/state.js'
import { trainingStatus,createTraining,advanceTraining,completeTraining,trainedCombatGroups,trainingDuration,startTrainingTask,cancelTrainingTask } from '../js/training.js'
import {advanceEconomy} from '../js/economy.js'
import {formationActivity,startFarming} from '../js/base.js'
import {startProduction,startTreatment} from '../js/facilities.js'
import {campaignDeployment} from '../js/campaign.js'
import { Game } from '../js/game.js'
import { Battle } from '../js/battle.js'

const train = (save,id) => {const session=createTraining(save,id);assert(session);advanceTraining(session,session.duration);return completeTraining(save,session)}

test('只有独立编制可参训，达到规定时长才结算，每轮只发放一次经验',()=>{
  const s=freshSave();assert.equal(createTraining(s,1),null)
  assert(setFormation(s,'squad',10).ok)
  const session=createTraining(s,1);assert(session)
  advanceTraining(session,-3);advanceTraining(session,NaN);assert.equal(session.elapsed,0)
  assert.equal(session.duration,10)
  advanceTraining(session,9);assert.equal(completeTraining(s,session),null);assert.equal(s.formations[0].trainingXp,0)
  advanceTraining(session,1);const result=completeTraining(s,session)
  assert.equal(result.gained,300);assert.equal(trainingStatus(s,1).average,30);assert.equal(s.trainingSessions,1)
  assert.equal(completeTraining(s,session),null);assert.equal(s.formations[0].trainingXp,300)
})

test('两轮训练达到合格等级，不消耗物资、不增加金币军功和兵力，存档可以恢复',()=>{
  const s=freshSave();assert(setFormation(s,'squad',10).ok)
  const before={coins:s.coins,xp:s.xp,troops:s.troops,medkits:s.medkits,shells:s.shells,wins:s.wins,kills:s.kills,rifleAmmo:s.rifleAmmo,weapons:JSON.stringify(s.weaponCounts)}
  train(s,1);train(s,1)
  assert.equal(trainingStatus(s,1).name,'合格');assert.equal(trainingStatus(s,1).bonus,.03)
  assert.equal(s.trainingSessions,2)
  assert.deepEqual({coins:s.coins,xp:s.xp,troops:s.troops,medkits:s.medkits,shells:s.shells,wins:s.wins,kills:s.kills,rifleAmmo:s.rifleAmmo,weapons:JSON.stringify(s.weaponCounts)},before)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('合编训练向每个下属发放经验，合并、拆分、调整人数和解散不会复制或丢失总经验',()=>{
  const s=freshSave();for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  const parent=mergeFormations(s,[1,2,3]).unit
  assert.equal(createTraining(s,1),null);const result=train(s,parent.id)
  assert.equal(result.gained,900);assert.equal(trainingStatus(s,parent.id).average,30)
  assert.equal(trainingStatus(s).xp,900);assert(unmergeFormation(s,parent.id).ok)
  assert(setFormation(s,'squad',12,1).ok);assert.equal(trainingStatus(s,1).average,25)
  assert(setFormation(s,'squad',7,1).ok);assert.equal(trainingStatus(s).xp,900)
  assert(removeFormation(s,1));assert.equal(trainingStatus(s).xp,900)
  assert(setFormation(s,'platoon',30).ok);assert.equal(trainingStatus(s).xp,900)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('主动召回或参训名单变化不发放经验，离开训练页面不再取消',()=>{
  const s=freshSave();assert(setFormation(s,'squad',10).ok)
  const g=Object.create(Game.prototype);g.save=s;g.trainingSelectedId=1;g.persist=()=>{};g.notify=()=>{};g.startTraining()
  const cancelled=s.trainingTask;advanceTraining(cancelled,5);g.home();assert.equal(s.trainingTask,cancelled)
  g.recallTraining();advanceTraining(cancelled,30)
  assert.equal(completeTraining(s,cancelled),null);assert.equal(s.trainingSessions,0)
  const stale=createTraining(s,1);assert(setFormation(s,'squad',11,1).ok)
  advanceTraining(stale,30);assert.equal(completeTraining(s,stale),null);assert.equal(s.formations[0].trainingXp,0)
})

test('训练经验封顶且拒绝异常存档数值，旧存档初始化为新兵',()=>{
  const s=freshSave();assert(setFormation(s,'squad',10).ok);s.formations[0].trainingXp=5990
  assert.equal(train(s,1).gained,10);assert.equal(trainingStatus(s,1).name,'老兵');assert.equal(createTraining(s,1),null)
  const raw=JSON.parse(JSON.stringify(s));raw.formations[0].trainingXp=1e99;raw.reserveTrainingXp=1e99
  const restored=normalizeSave(raw);assert.equal(restored.formations[0].trainingXp,6000);assert.equal(restored.reserveTrainingXp,110*600)
  raw.formations[0].trainingXp=-100;assert.equal(normalizeSave(raw).formations[0].trainingXp,0)
  delete raw.formations[0].trainingXp;delete raw.trainingSessions;delete raw.reserveTrainingXp
  const old=normalizeSave(raw);assert.equal(trainingStatus(old,1).name,'新兵');assert.equal(old.trainingSessions,0)
})

test('训练加成按实际配发人数加权并作用于战斗伤害',()=>{
  const s=freshSave();assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'squad',10).ok)
  train(s,1);train(s,1)
  const groups=trainedCombatGroups(s);assert.equal(groups[0].troops,20);assert.equal(groups[0].trainingBonus,.015)
  const b=new Battle('campaign',1,20,'rifle',groups);b.pending=0;b.enemies=[{x:b.x+200,y:b.y,hp:100,maxHp:100,cool:100}]
  b.update(.21);assert(Math.abs(b.enemies[0].hp-(100-7.5*1.015))<1e-9)
})

test('训练选择、翻页、退出和结算流程可用，训练场替换冒险入口',()=>{
  assert(MODES.some(v=>v.id==='base'&&v.name==='根据地'));assert.equal(MODES.some(v=>v.id==='training'||v.id==='adventure'),false)
  const g=Object.create(Game.prototype)
  g.ctx=new Proxy({}, {get:(o,key)=>o[key]??(()=>{}),set:(o,key,value)=>(o[key]=value,true)})
  g.save=freshSave();g.persist=()=>{};g.notify=()=>{}
  const draw=()=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
  g.scene='lobby';g.open('training');draw();g.buttons.find(b=>b.id==='training-start').fn();assert.equal(g.scene,'lobby')
  for(let i=0;i<5;i++)assert(setFormation(g.save,'squad',10).ok)
  g.open('training');draw();g.buttons.find(b=>b.id==='training-next').fn();draw();g.buttons.find(b=>b.id==='training-select-5').fn()
  draw();g.buttons.find(b=>b.id==='training-start').fn();assert.equal(g.scene,'world-map');assert.equal(g.save.trainingTask.unitId,5)
  draw();g.buttons.find(b=>b.id==='training-home').fn();assert.equal(g.scene,'world-map');assert.equal(g.save.trainingSessions,0)
  g.updateLogistics(5);assert.equal(g.save.trainingTask.elapsed,5)
  g.open('training');draw();g.buttons.find(b=>b.id==='training-recall').fn();assert.equal(g.save.trainingTask,null)
  g.startTraining();g.updateLogistics(10);assert.equal(g.modal,'training');draw()
  assert.equal(g.save.trainingSessions,1);assert.equal(g.save.trainingTask,null)
})

test('训练人数决定时长，1人1秒，班排连营军均使用真实参训人数',()=>{
  for(const [kind,troops] of [['squad',1],['squad',7],['squad',12],['platoon',25],['company',100],['battalion',1000],['army',80000]]){
    const s=freshSave();s.troops=troops;assert(setFormation(s,kind,troops).ok)
    assert.equal(trainingDuration(troops),troops);assert.equal(createTraining(s,1).duration,troops)
  }
})

test('离开训练场后另一支部队可以出战，训练按时完成不打断战斗或当前弹窗',()=>{
  const s=freshSave();setFormation(s,'squad',10);setFormation(s,'squad',10)
  const g=Object.create(Game.prototype);g.save=s;g.trainingSelectedId=1;g.persist=()=>{};g.notify=()=>{}
  g.startTraining();const session=s.trainingTask;g.home();assert.equal(s.trainingTask,session)
  g.start('campaign',1,[2]);const battle=g.battle;g.open('pause');g.updateLogistics(9.9)
  assert.equal(s.trainingSessions,0);assert.equal(formationActivity(s,1),'training')
  g.updateLogistics(.1);assert.equal(s.trainingSessions,1);assert.equal(s.formations[0].trainingXp,300)
  assert.equal(s.trainingTask,null);assert.equal(g.scene,'battle');assert.equal(g.modal,'pause');assert.equal(g.battle,battle)
  assert.equal(formationActivity(s,2),'battle');assert.equal(formationActivity(s,1),null)
  g.updateLogistics(30);assert.equal(s.trainingSessions,1);assert.equal(s.formations[0].trainingXp,300)
})

test('训练进度保存后恢复，合编下属保持占用，完成才发经验并释放全部家族',()=>{
  const s=freshSave();for(let i=0;i<4;i++)setFormation(s,'squad',10)
  const root=mergeFormations(s,[1,2,3]).unit;assert(startTrainingTask(s,root.id).ok)
  advanceEconomy(s,9);const loaded=normalizeSave(JSON.parse(JSON.stringify(s)))
  assert.deepEqual(loaded,s);assert.equal(loaded.trainingTask.elapsed,9);assert.equal(loaded.trainingTask.duration,30)
  assert.equal(formationActivity(loaded,1),'training');assert.equal(formationActivity(loaded,root.id),'training')
  assert.equal(campaignDeployment(loaded,[root.id]).ok,false)
  assert.equal(startFarming(loaded,'self',0,'rice',[root.id]).ok,false)
  assert.equal(startProduction(loaded,[root.id],'rifle').ok,false);assert.equal(startTreatment(loaded,'light',[root.id]).ok,false)
  assert.equal(setFormation(loaded,'squad',11,1).ok,false);assert.equal(unmergeFormation(loaded,root.id).ok,false)
  assert.equal(startTrainingTask(loaded,4).ok,false)
  advanceEconomy(loaded,20.9);assert.equal(trainingStatus(loaded,root.id).xp,0)
  const result=advanceEconomy(loaded,.1);assert.equal(result.training.gained,900);assert.equal(loaded.trainingTask,null)
  assert.equal(formationActivity(loaded,1),null);assert(unmergeFormation(loaded,root.id).ok)
  const restored=normalizeSave(JSON.parse(JSON.stringify(loaded)));advanceEconomy(restored,30);assert.equal(restored.trainingSessions,1)
})

test('主动召回保留已有经验，取消本轮计时，旧任务引用不能重复领奖',()=>{
  const s=freshSave();setFormation(s,'squad',10);s.formations[0].trainingXp=300
  assert(startTrainingTask(s,1).ok);advanceEconomy(s,5);const cancelled=s.trainingTask
  assert(cancelTrainingTask(s));assert.equal(s.trainingTask,null);assert.equal(s.formations[0].trainingXp,300)
  advanceTraining(cancelled,100);assert.equal(completeTraining(s,cancelled),null);assert.equal(s.trainingSessions,0)
  assert(startTrainingTask(s,1).ok);assert.equal(s.trainingTask.elapsed,0);advanceEconomy(s,10)
  assert.equal(s.formations[0].trainingXp,600);assert.equal(s.trainingSessions,1)
})

test('极度饥饿暂停训练，供餐后从原进度继续，不能在饥饿中开始新任务',()=>{
  const s=freshSave();setFormation(s,'squad',10);s.hungerDebt=3;assert.equal(startTrainingTask(s,1).ok,false)
  s.hungerDebt=0;assert(startTrainingTask(s,1).ok);advanceEconomy(s,3)
  s.hungerDebt=3;advanceEconomy(s,20);assert.equal(s.trainingTask.elapsed,3)
  s.cookedRice=12;advanceEconomy(s,6.9);assert(Math.abs(s.trainingTask.elapsed-9.9)<1e-8)
  assert.equal(s.trainingSessions,0);advanceEconomy(s,.1);assert.equal(s.trainingTask,null);assert.equal(s.trainingSessions,1)
})

test('训练与耕作、军械生产共用事件时钟，整段与逐秒推进结果一致',()=>{
  const a=freshSave();a.cookedRice=100;a.materials.ore=10;a.materials.wood=4;for(let i=0;i<3;i++)setFormation(a,'squad',10)
  startTrainingTask(a,1);startFarming(a,'self',0,'rice',[2]);startProduction(a,[3],'pistol')
  const b=structuredClone(a);advanceEconomy(a,300);for(let i=0;i<300;i++)advanceEconomy(b,1)
  assert.deepEqual(a,b);assert.equal(a.trainingSessions,1);assert.equal(a.productionTotals.pistol,2)
  assert.equal(a.rice,30);assert.equal(a.formations[0].trainingXp,300)
})

test('训练存档拒绝缩短时长、假人数、重复名单、过期任务及其他任务占用，旧存档不自动训练',()=>{
  const s=freshSave();setFormation(s,'squad',10);startTrainingTask(s,1);advanceEconomy(s,4)
  for(const change of [{duration:1},{troops:9},{elapsed:-1},{elapsed:11},{settled:true},{unitId:999},{soldiers:[{id:1,troops:9}]}]){
    const raw=structuredClone(s);Object.assign(raw.trainingTask,change);assert.equal(normalizeSave(raw).trainingTask,null)
  }
  const raw=structuredClone(s);raw.farmTask={type:'self',crop:'rice',workers:10,elapsed:3,unitIds:[1]}
  const conflict=normalizeSave(raw);assert(conflict.farmTask);assert.equal(conflict.trainingTask,null)
  const old=structuredClone(s);delete old.trainingTask;assert.equal(normalizeSave(old).trainingTask,null)
})

test('保存时刚好训练完成的任务在首次前台更新补结算一次，刷新不能再领取',()=>{
  const s=freshSave();setFormation(s,'squad',10);startTrainingTask(s,1);s.trainingTask.elapsed=10
  const loaded=normalizeSave(JSON.parse(JSON.stringify(s)));assert(loaded.trainingTask)
  assert.equal(advanceEconomy(loaded,0).training.gained,300);assert.equal(loaded.trainingTask,null)
  assert.equal(advanceEconomy(loaded,0).training,null)
  const again=normalizeSave(loaded);advanceEconomy(again,10);assert.equal(again.trainingSessions,1);assert.equal(again.formations[0].trainingXp,300)
})
