import test from 'node:test'
import assert from 'node:assert/strict'
import { GOODS,FORMATION_TYPES,freshSave,normalizeSave,formation,formationName,formationRoots,formationParent,lineageRows,splitGarrisonUnit,previewFormationMerge,mergeFormations,unmergeFormation,formationResources,autoFormationWeapons,setFormation,removeFormation,purchase,purchaseWeapon,equipWeapon,claim,settle } from '../js/state.js'
import { WEAPONS } from '../js/weapons.js'
import {stationTroops} from '../js/villages.js'
import { Game } from '../js/game.js'
import { Battle } from '../js/battle.js'
test('shop cannot spend below zero; food inventory persists without buying manpower',()=>{
  const s=freshSave();assert(purchase(s,'millet'));assert.equal(s.troops,120);assert.equal(s.millet,10);assert.equal(s.coins,588)
  s.coins=0;assert.equal(purchase(s,'shells'),false);assert.equal(s.shells,2)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})
test('task rewards and battle settlement cannot be claimed twice',()=>{
  const s=freshSave(),b=new Battle('campaign',1,120);b.won=true;b.kills=12
  assert(settle(s,b));assert.equal(s.stage,2);assert.equal(settle(s,b),null)
  assert(claim(s,'first'));const coins=s.coins;assert.equal(claim(s,'first'),false);assert.equal(s.coins,coins)
})
test('invalid saves recover usable defaults',()=>{
  const s=normalizeSave({troops:-100,stage:999,coins:NaN,claimed:['fake'],name:'',settings:{effects:false}})
  assert.equal(s.troops,120);assert.equal(s.stage,12);assert.equal(s.coins,600);assert.equal(s.settings.effects,false);assert.deepEqual(s.claimed,[])
})
test('first campaign can complete through actual simulation',()=>{
  const b=new Battle('campaign',1,120)
  for(let i=0;i<60*180&&!b.done;i++)b.update(1/60)
  assert(b.done);assert(b.won);assert(b.kills>0)
})
test('removed battlefield skills have no effect and movement stays in bounds',()=>{
  const b=new Battle('defense',1,120);assert.equal(b.heal(),false);b.hp=40;assert.equal(b.heal(),false);assert.equal(b.hp,40)
  assert.equal(b.strike(),false);b.enemies.push({x:900,y:400,hp:130,maxHp:130,cool:10});assert.equal(b.strike(),false);assert.equal(b.enemies[0].hp,130)
  b.command(-999,9999);assert.deepEqual(b.target,{x:75,y:625})
})
test('旧存档获得初始步枪，枪械可重复购买并保留数量',()=>{
  const s=normalizeSave({name:'老指挥官',coins:1200,stage:5}),price=WEAPONS.find(w=>w.id==='machinegun').price
  assert.deepEqual(s.weaponCounts,{rifle:120,pistol:0,machinegun:0,sniper:0,mortar:0});assert.equal(s.equippedWeapon,'rifle');assert.equal(s.stage,5)
  assert.equal(equipWeapon(s,'mortar'),false);assert.equal(purchaseWeapon(s,'unknown'),false)
  assert(purchaseWeapon(s,'machinegun'));assert.equal(s.coins,1200-price);assert(purchaseWeapon(s,'machinegun'));assert.equal(s.coins,1200-price*2);assert.equal(s.weaponCounts.machinegun,2)
  assert.equal(purchaseWeapon(s,'machinegun'),false);assert.equal(s.weaponCounts.machinegun,2);assert.equal(s.coins,1200-price*2)
  assert.equal(purchaseWeapon(s,'mortar'),false);assert(equipWeapon(s,'machinegun'))
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const invalid=normalizeSave({weapons:['fake','sniper','sniper'],equippedWeapon:'mortar'})
  assert.equal(invalid.weaponCounts.rifle,120);assert.equal(invalid.weaponCounts.sniper,1);assert.equal(invalid.equippedWeapon,'rifle')
  assert.deepEqual(normalizeSave(invalid),invalid)
  const counts=normalizeSave({weaponCounts:{rifle:0,pistol:5.9,machinegun:-2,sniper:NaN,mortar:1e20},weapons:['sniper'],equippedWeapon:'sniper'})
  assert.deepEqual(counts.weaponCounts,{rifle:0,pistol:5,machinegun:0,sniper:0,mortar:10000000});assert.equal(counts.equippedWeapon,'pistol')
})
test('weapon range, damage, fire cadence and mortar splash affect combat',()=>{
  const make=(id,distance)=>{const b=new Battle('campaign',1,120,id);b.pending=0;b.cool=0;b.enemies=[{x:b.x+distance,y:b.y,hp:1000,maxHp:1000,cool:100}];return b}
  const rifle=make('rifle',600);rifle.update(.01);assert.equal(rifle.enemies[0].hp,1000)
  const sniper=make('sniper',600);sniper.update(.01);assert.equal(sniper.enemies[0].hp,960);sniper.update(.1);assert.equal(sniper.enemies[0].hp,960)
  const mg=make('machinegun',400);mg.update(.01);assert.equal(mg.enemies[0].hp,992);mg.update(.14);assert.equal(mg.enemies[0].hp,984)
  const mortar=make('mortar',400);mortar.enemies.push({x:mortar.x+450,y:mortar.y,hp:1000,maxHp:1000,cool:100},{x:mortar.x+650,y:mortar.y,hp:1000,maxHp:1000,cool:100})
  mortar.update(.01);assert.deepEqual(mortar.enemies.map(e=>e.hp),[970,970,1000]);assert.equal(mortar.hp,120)
})
test('背景音乐设置默认开启，可持久化且拒绝非法值',()=>{
  const s=freshSave();assert.equal(s.settings.music,true)
  s.settings.music=false
  assert.equal(normalizeSave(JSON.parse(JSON.stringify(s))).settings.music,false)
  assert.equal(normalizeSave({settings:{music:'yes'}}).settings.music,true)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})
test('总指挥资料显示昵称、兵力、胜场和修改名称入口',()=>{
  const g=Object.create(Game.prototype),labels=[]
  g.ctx=new Proxy({fillText:value=>labels.push(value)},{get:(o,key)=>o[key]??(()=>{}),set:(o,key,value)=>(o[key]=value,true)})
  g.save=normalizeSave({name:'前线指挥官',troops:120,wins:3,xp:30000});g.buttons=[];g.modal='army'
  g.drawModal()
  assert(labels.includes('总指挥'));assert(labels.includes('前线指挥官'))
  assert(labels.includes('部队兵力 120    /    累计胜利 3'))
  assert(!labels.some(label=>/军功|职务|晋升/.test(label)))
  assert(g.buttons.some(b=>b.id==='rename'))
})

test('旧存档和战报移除军功，战斗仍发金币并且只结算一次',()=>{
  const s=normalizeSave({name:'老指挥官',xp:90,troops:120,coins:900,wins:1,reserveTrainingXp:120,
    raidReports:[{id:1,siteId:1,force:12,outcome:'won',xp:90,coins:140,expiresAt:Date.now()+10000}]})
  assert(!Object.hasOwn(freshSave(),'xp'));assert(!Object.hasOwn(s,'xp'))
  assert.equal(s.troops,120);assert.equal(s.coins,900);assert.equal(s.wins,1);assert.equal(s.reserveTrainingXp,120)
  assert.equal(s.raidReports[0].coins,140);assert(!Object.hasOwn(s.raidReports[0],'xp'))
  const b=new Battle('campaign',1,120);b.kills=4
  const reward=settle(s,b)
  assert(!Object.hasOwn(reward,'xp'));assert(!Object.hasOwn(s,'xp'))
  assert.equal(reward.coins,16);assert.equal(s.kills,4)
  assert.equal(settle(s,b),null);assert.equal(s.coins,916)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)))
  assert.deepEqual(restored,s)
})

test('商城各类物资按份数入库，余额不足不扣款，刷新后保留',()=>{
  const s=freshSave();s.coins=5000
  for(const item of GOODS){
    const before=s[item.id],coins=s.coins
    assert(purchase(s,item.id));assert.equal(s[item.id],before+item.amount);assert.equal(s.coins,coins-item.price)
  }
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  s.coins=0;const before=JSON.stringify(s)
  for(const item of GOODS)assert.equal(purchase(s,item.id),false)
  assert.equal(purchase(s,'unknown'),false);assert.equal(JSON.stringify(s),before)
  const old=normalizeSave({coins:333,medkits:7,shells:4,stage:9,weapons:['rifle','sniper'],equippedWeapon:'sniper'})
  assert.equal(old.medkits,7);assert.equal(old.shells,4);assert.equal(old.stage,9);assert.equal(old.equippedWeapon,'sniper')
  for(const id of ['bullets','mortarAmmo','grenades','bandages'])assert.equal(old[id],0)
  const invalid=normalizeSave({rifleAmmo:-3,pistolAmmo:NaN,grenades:Infinity,bandages:2.9,mortarAmmo:1e20})
  assert.equal(invalid.bullets,0);assert.equal(invalid.grenades,0);assert.equal(invalid.bandages,2);assert.equal(invalid.mortarAmmo,10000000)
})

test('手枪可以购买、装备与持久化，使用独立射程和伤害',()=>{
  const s=freshSave(),price=WEAPONS.find(w=>w.id==='pistol').price
  assert(purchaseWeapon(s,'pistol'));assert(equipWeapon(s,'pistol'))
  assert(purchaseWeapon(s,'pistol'));assert.equal(s.weaponCounts.pistol,2);assert.equal(s.coins,600-price*2)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const b=new Battle('campaign',1,s.troops,s.equippedWeapon);b.cool=0;b.pending=0
  b.enemies=[{x:b.x+350,y:b.y,hp:100,maxHp:100,cool:100}];b.update(.01);assert.equal(b.enemies[0].hp,100)
  b.enemies[0].x=b.x+200;b.update(.01);assert.equal(b.enemies[0].hp,93.5)
})

test('商城提供购买入口，仓库展示库存，按钮位于面板内',()=>{
  const g=Object.create(Game.prototype)
  g.ctx=new Proxy({}, {get:(o,key)=>o[key]??(()=>{}),set:(o,key,value)=>(o[key]=value,true)})
  g.save=freshSave();g.persist=()=>{};g.notify=()=>{}
  const draw=()=>{g.buttons=[];g.drawModal();for(const b of g.buttons){assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}}
  g.open('shop');draw()
  for(const tab of ['weapons','ammo','medical'])assert(g.buttons.some(b=>b.id==='tab-'+tab))
  for(const w of WEAPONS)assert(g.buttons.some(b=>b.id==='buy-weapon-'+w.id))
  g.buttons.find(b=>b.id==='buy-weapon-pistol').fn();draw();g.buttons.find(b=>b.id==='buy-weapon-pistol').fn()
  assert.equal(g.save.weaponCounts.pistol,2);assert.equal(g.save.equippedWeapon,'rifle')
  g.open('warehouse');draw();assert.equal(g.buttons.some(b=>b.id.startsWith('equip-')||b.id.startsWith('buy-weapon-')),false)
  assert.equal(g.save.weaponCounts.pistol,2);g.open('shop')
  for(const category of ['ammo','medical']){
    g.inventoryTab=category;draw()
    for(const item of GOODS.filter(v=>v.category===category))assert(g.buttons.some(b=>b.id==='buy-'+item.id))
  }
  g.inventoryTab='ammo';draw();g.buttons.find(b=>b.id==='buy-bullets').fn();assert.equal(g.save.bullets,30)
  g.open('warehouse');g.inventoryTab='ammo';draw();assert.equal(g.buttons.some(b=>b.id.startsWith('buy-')),false)
  g.open('formation');draw();assert(g.buttons.some(b=>b.id==='formation-shop'))
  g.buttons.find(b=>b.id==='formation-shop').fn();assert.equal(g.modal,'shop')
})

test('枪械采用最新价格表，余额不足时拒绝购买且不扣款',()=>{
  assert.deepEqual(WEAPONS.map(w=>[w.name,w.price]),[['步枪',40],['手枪',30],['轻机枪',500],['狙击枪',700],['迫击炮',1000]])
  const s=freshSave();s.coins=1000
  assert(purchaseWeapon(s,'sniper'));assert.equal(s.coins,300)
  const before=JSON.stringify(s);assert.equal(purchaseWeapon(s,'sniper'),false);assert.equal(JSON.stringify(s),before)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('初始步枪赠送 120 把，追加购买扣款；全部枪械均可按数量补购',()=>{
  const s=freshSave();s.coins=10000
  for(const w of WEAPONS){
    const n=s.weaponCounts[w.id],coins=s.coins
    assert(w.price>0);assert(purchaseWeapon(s,w.id));assert.equal(purchaseWeapon(s,w.id),w.id!=='sniper')
    const count=w.id==='sniper'?1:2
    assert.equal(s.weaponCounts[w.id],n+count);assert.equal(s.coins,coins-w.price*count)
  }
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  s.weaponCounts.mortar=10000000;const coins=s.coins
  assert.equal(purchaseWeapon(s,'mortar'),false);assert.equal(s.coins,coins)
})

test('初始步枪补齐到 120 把，旧存档购买数量保留且重复加载不重复赠送',()=>{
  assert.equal(freshSave().weaponCounts.rifle,120)
  const old=normalizeSave({troops:140,coins:432,weaponCounts:{rifle:4,pistol:3},rifleAmmo:70})
  assert.equal(old.weaponCounts.rifle,123);assert.equal(old.weaponCounts.pistol,3)
  assert.equal(old.troops,140);assert.equal(old.coins,432);assert.equal(old.bullets,70)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(old))),old)
  assert.equal(normalizeSave({weaponStockVersion:2,weaponCounts:{rifle:2}}).weaponCounts.rifle,2)
})

test('手动编制严格采用八种人数区间，两端可创建，越界和非整数不改变存档',()=>{
  assert.deepEqual(FORMATION_TYPES.map(k=>[k.name,k.min,k.max]),[['班',7,12],['排',25,40],['连',100,150],['营',400,1000],['团',1000,3000],['旅',3000,6000],['师',8000,15000],['军',30000,80000]])
  for(const kind of FORMATION_TYPES){
    const s=freshSave();s.troops=500000;s.weaponCounts.rifle=500000
    assert(setFormation(s,kind.id,kind.min).ok);assert(setFormation(s,kind.id,kind.max).ok)
    for(const bad of [kind.min-1,kind.max+1,kind.min+.5,NaN,Infinity,String(kind.min)]){
      const before=JSON.stringify(s);assert.equal(setFormation(s,kind.id,bad).ok,false);assert.equal(JSON.stringify(s),before)
    }
    assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  }
  assert.deepEqual(freshSave().formations,[])
})

test('编制不能超额占用兵力或武器，修改不重复占用，解散释放名额',()=>{
  const s=freshSave();assert(setFormation(s,'company',100).ok)
  assert.equal(setFormation(s,'platoon',25).ok,false);assert.equal(s.formations.length,1)
  const id=s.formations[0].id;assert(setFormation(s,'company',120,id).ok)
  assert.equal(formation(s).assignedTroops,120);assert.equal(formation(s).availableSlots,0)
  assert.equal(setFormation(s,'company',121,id).ok,false);assert.equal(s.formations[0].troops,120)
  assert(removeFormation(s,id));assert.equal(removeFormation(s,id),false);assert.equal(formation(s).availableSlots,120)
  s.weaponCounts.rifle=10;assert(setFormation(s,'squad',7).ok)
  assert(setFormation(s,'squad',7).ok);assert.equal(s.formations[1].weapons.rifle,3);assert.equal(formation(s).availableSlots,106)
  assert.equal(setFormation(s,'army',80000).ok,false);assert.equal(setFormation(s,'unknown',7).ok,false)
  assert.equal(setFormation(s,'squad',7,999).ok,false)
})

test('仅手动编制的兵力参与出战，多余武器和未编人员不会自动参战',()=>{
  const s=freshSave(),g=Object.create(Game.prototype);g.save=s;g.scene='lobby';g.battle=null;g.notify=()=>{}
  g.start('campaign',1,[]);assert.equal(g.scene,'lobby');assert.equal(g.battle,null)
  assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'platoon',30).ok)
  assert.equal(formation(s).armedTroops,40);assert.equal(formation(s).unassignedTroops,80)
  g.start('campaign',1,s.formations.map(unit=>unit.id));assert.equal(g.battle.maxHp,40);assert.equal(s.troops,120);assert.equal(s.weaponCounts.rifle,120)
  s.weaponCounts.rifle=200;assert.equal(formation(s).armedTroops,40);assert.equal(formation(s).spareWeapons,160)
})

test('载入存档拒绝非法编制和重复编号，旧存档不自动创建固定编制',()=>{
  const s=freshSave();assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'company',100).ok)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  const invalid=normalizeSave({...s,formations:[null,{id:1,type:'fake',troops:10},{id:1,type:'squad',troops:6},{id:1,type:'squad',troops:10},{id:1,type:'squad',troops:12},{id:2,type:'company',troops:120},{id:3,type:'platoon',troops:30}]})
  assert.deepEqual(invalid.formations.map(({id,type,troops})=>({id,type,troops})),[{id:1,type:'squad',troops:10},{id:3,type:'platoon',troops:30}])
  assert.deepEqual(normalizeSave({troops:120}).formations,[])
})

test('混合配发按武器种类预留库存，修改换装和解散正确释放，配发总数必须等于人数',()=>{
  const s=freshSave();s.weaponCounts.machinegun=2
  assert(setFormation(s,'squad',10,null,{rifle:8,machinegun:2}).ok)
  const id=s.formations[0].id
  assert.equal(formationResources(s).weapons.rifle,112);assert.equal(formationResources(s).weapons.machinegun,0)
  assert.equal(formationResources(s,id).weapons.machinegun,2);assert.equal(s.weaponCounts.machinegun,2)
  for(const bad of [{rifle:5,machinegun:2},{rifle:9,machinegun:2},{rifle:9,pistol:1},{rifle:8,machinegun:1.5},{rifle:10,unknown:1}]){
    const before=JSON.stringify(s);assert.equal(setFormation(s,'squad',10,null,bad).ok,false);assert.equal(JSON.stringify(s),before)
  }
  assert(setFormation(s,'squad',10,id,{rifle:10}).ok);assert.equal(formationResources(s).weapons.machinegun,2)
  assert(setFormation(s,'squad',7,null,{rifle:5,machinegun:2}).ok)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s)
  assert(removeFormation(s,s.formations[1].id));assert.equal(formationResources(s).weapons.machinegun,2)
})

test('旧编制载入时补上可用武器，显式超配的存档不会重复占用同种武器',()=>{
  const s=freshSave();s.weaponCounts={rifle:12,pistol:7,machinegun:0,sniper:0,mortar:0}
  const old=normalizeSave({...s,formations:[{id:1,type:'squad',troops:12},{id:2,type:'squad',troops:7}]})
  assert.equal(old.formations[0].weapons.rifle,12);assert.equal(old.formations[1].weapons.pistol,7)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(old))),old)
  const invalid=normalizeSave({...s,formations:[{id:1,type:'squad',troops:10,weapons:{rifle:10}},{id:2,type:'squad',troops:7,weapons:{rifle:7}}]})
  assert.equal(invalid.formations.length,1)
})

test('人数超过未编人员时编辑页即时提示，分类总览不展示武器明细和人数区间',()=>{
  const g=Object.create(Game.prototype),texts=[]
  g.ctx=new Proxy({fillText:value=>texts.push(String(value))},{get:(o,key)=>o[key]??(()=>{}),set:(o,key,value)=>(o[key]=value,true)})
  g.save=freshSave();g.persist=()=>{};g.notify=()=>{}
  assert(setFormation(g.save,'company',115).ok)
  g.open('formation');g.buttons=[];g.drawModal()
  assert.equal(texts.some(v=>v.includes('区间')||v.includes('步枪×')),false)
  g.editFormation();texts.length=0;g.buttons=[];g.drawModal()
  assert(texts.some(v=>v.includes('未编人员不足')&&v.includes('5 人')))
  g.buttons.find(b=>b.id==='formation-save').fn();assert.equal(g.save.formations.length,1)
  g.editFormation(g.save.formations[0]);assert.equal(formationResources(g.save,g.formationDraft.id).troops,120)
})

test('混编部队按实际配枪人数射击，步枪与轻机枪从同一库存扣弹',()=>{
  const s=freshSave();s.weaponCounts.machinegun=2;s.bullets=10
  assert(setFormation(s,'squad',10,null,{rifle:8,machinegun:2}).ok)
  const g=Object.create(Game.prototype);g.save=s;g.start('campaign',1,[1])
  const b=g.battle,unit=b.units[0];assert.deepEqual(unit.groups.map(group=>[group.weapon.id,group.troops]),[['rifle',8],['machinegun',2]])
  b.pending=0;b.enemies=[{x:unit.x+200,y:unit.y,hp:1000,maxHp:1000,cool:100}]
  b.update(.21);assert.equal(b.enemies[0].hp,991)
  assert.equal(s.bullets,0);assert.equal(b.ammoSpent,10)
  assert.equal(s.weaponCounts.rifle,120);assert.equal(s.weaponCounts.machinegun,2)
})

test('三支同级部队合编保留原部队和混合武器，统计、出战、解除均不重复计算',()=>{
  const s=freshSave();s.weaponCounts.machinegun=6
  for(let i=0;i<3;i++)assert(setFormation(s,'squad',10,null,{rifle:8,machinegun:2}).ok)
  const originals=JSON.stringify(s.formations),before=formation(s),inventory=JSON.stringify(s.weaponCounts)
  assert.equal(previewFormationMerge(s,[1,2,3]).kind.id,'platoon')
  const result=mergeFormations(s,[1,2,3]);assert(result.ok)
  assert.equal(result.unit.troops,30);assert.equal(result.unit.weapons.rifle,24);assert.equal(result.unit.weapons.machinegun,6)
  assert.equal(formationRoots(s).length,1);assert.equal(formationParent(s,1).id,result.unit.id)
  assert.deepEqual(formation(s),before);assert.equal(JSON.stringify(s.weaponCounts),inventory)
  const g=Object.create(Game.prototype);g.save=s;g.start('campaign',1,[result.unit.id])
  assert.equal(g.battle.maxHp,30);assert.equal(g.battle.units.length,1);assert.deepEqual(g.battle.units[0].groups.map(v=>[v.weapon.id,v.troops]),[['rifle',24],['machinegun',6]])
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  assert.equal(removeFormation(s,result.unit.id),false)
  assert.equal(unmergeFormation(s,result.unit.id).ok,false);g.home()
  assert(unmergeFormation(s,result.unit.id).ok);assert.equal(JSON.stringify(s.formations),originals);assert.deepEqual(formation(s),before)
})

test('合编拒绝数量错误、重复选择、不同级别、已有上级及超过上限，失败不修改存档',()=>{
  const s=freshSave();for(let i=0;i<3;i++)assert(setFormation(s,'squad',7).ok)
  assert(setFormation(s,'platoon',25).ok)
  for(const ids of [[1,2],[1,1,2],[1,2,999],[1,2,4]]){
    const before=JSON.stringify(s);assert.equal(mergeFormations(s,ids).ok,false);assert.equal(JSON.stringify(s),before)
  }
  for(let id=1;id<=3;id++)assert(setFormation(s,'squad',10,id).ok)
  assert(mergeFormations(s,[1,2,3]).ok);const before=JSON.stringify(s)
  assert.equal(mergeFormations(s,[1,2,3]).ok,false);assert.equal(JSON.stringify(s),before)
  const big=freshSave();big.troops=500000;big.weaponCounts.rifle=500000
  for(let i=0;i<3;i++)assert(setFormation(big,'regiment',3000).ok)
  assert.equal(mergeFormations(big,[1,2,3]).ok,false)
  const top=freshSave();top.troops=500000;top.weaponCounts.rifle=500000
  for(let i=0;i<3;i++)assert(setFormation(top,'army',30000).ok)
  assert.equal(mergeFormations(top,[1,2,3]).ok,false)
})

test('班到军的七条合编路径不受上级人数下限限制，仍按相邻级别校验',()=>{
  for(let i=0;i<FORMATION_TYPES.length-1;i++){
    const s=freshSave();s.troops=500000;s.weaponCounts.rifle=500000
    const lower=FORMATION_TYPES[i],upper=FORMATION_TYPES[i+1],n=lower.min
    for(let j=0;j<3;j++)assert(setFormation(s,lower.id,n).ok)
    const result=mergeFormations(s,[1,2,3]);assert(result.ok);assert.equal(result.unit.type,upper.id)
    assert.equal(result.unit.troops,n*3);assert.equal(formation(s).assignedTroops,n*3)
  }
})

test('多级合编保存层级，修改下属同步更新所有祖先，不能破坏上级人数或成员关系',()=>{
  const s=freshSave();for(let i=0;i<9;i++)assert(setFormation(s,'squad',12).ok)
  const platoons=[]
  for(let i=0;i<3;i++){const result=mergeFormations(s,[i*3+1,i*3+2,i*3+3]);assert(result.ok);platoons.push(result.unit.id)}
  const company=mergeFormations(s,platoons);assert(company.ok)
  assert.equal(formation(s).assignedTroops,108);assert.equal(formationRoots(s).length,1)
  assert(setFormation(s,'squad',7,1).ok);assert.equal(company.unit.troops,103)
  assert.equal(s.formations.find(u=>u.id===platoons[0]).troops,31);assert.equal(company.unit.weapons.rifle,103)
  assert(setFormation(s,'squad',7,4).ok);assert.equal(company.unit.troops,98)
  assert.equal(setFormation(s,'platoon',25,1).ok,false);assert.equal(removeFormation(s,1),false)
  assert.equal(setFormation(s,'company',110,company.unit.id).ok,false)
  assert.equal(unmergeFormation(s,platoons[0]).ok,false)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  assert(unmergeFormation(s,company.unit.id).ok);assert(unmergeFormation(s,platoons[0]).ok)
  assert.equal(formation(s).assignedTroops,98);assert.equal(formationRoots(s).length,5)
})

test('载入合编存档重建汇总，拒绝共享下属、自引用和循环，非法上级不吞掉原部队',()=>{
  const s=freshSave();for(let i=0;i<4;i++)assert(setFormation(s,'squad',10).ok)
  const raw=[...s.formations,{id:5,type:'platoon',troops:999,weapons:{rifle:999},children:[1,2,3]},
    {id:6,type:'platoon',children:[1,2,4]},{id:7,type:'platoon',children:[7,1,2]},
    {id:8,type:'company',children:[9,9,9]},{id:9,type:'platoon',children:[8,8,8]}]
  const restored=normalizeSave({...s,formations:raw.reverse()})
  assert.equal(restored.formations.length,5);assert.equal(restored.formations.find(u=>u.id===5).troops,30)
  assert.equal(restored.formations.find(u=>u.id===5).weapons.rifle,30)
  assert.equal(formation(restored).assignedTroops,40);assert.equal(formationRoots(restored).length,2)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
})

test('合编界面支持跨页选择、预览、查看下属和解除，操作按钮均位于面板内',()=>{
  const g=Object.create(Game.prototype)
  g.ctx=new Proxy({}, {get:(o,key)=>o[key]??(()=>{}),set:(o,key,value)=>(o[key]=value,true)})
  g.save=freshSave();g.persist=()=>{};g.notify=()=>{}
  for(let i=0;i<5;i++)assert(setFormation(g.save,'squad',10).ok)
  const draw=()=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
  g.open('formation');draw();g.buttons.find(b=>b.id==='formation-merge').fn();draw()
  g.buttons.find(b=>b.id==='merge-select-1').fn();draw();g.buttons.find(b=>b.id==='merge-select-2').fn();draw()
  g.buttons.find(b=>b.id==='merge-next').fn();draw();g.buttons.find(b=>b.id==='merge-select-5').fn();draw()
  g.buttons.find(b=>b.id==='merge-confirm').fn();assert.equal(g.modal,'formation-detail');draw()
  assert.equal(formationRoots(g.save).length,3);assert.equal(g.buttons.filter(b=>b.id.startsWith('child-view-')).length,3)
  g.buttons.find(b=>b.id==='children-release').fn();assert.equal(g.modal,'formation');assert.equal(formationRoots(g.save).length,5)
  assert.equal(formation(g.save).assignedTroops,50)
})

test('每种编制独立从 1 编号，合编名称不沿用班的编号，原部队编号保留',()=>{
  const s=freshSave();for(let i=0;i<6;i++)assert(setFormation(s,'squad',10).ok)
  assert.deepEqual(s.formations.map(formationName),['1班','2班','3班','4班','5班','6班'])
  const first=mergeFormations(s,[1,2,3]),second=mergeFormations(s,[4,5,6])
  assert(first.ok&&second.ok);assert.equal(formationName(first.unit),'1排');assert.equal(formationName(second.unit),'2排')
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
  assert(unmergeFormation(s,first.unit.id).ok);assert.equal(formationName(second.unit),'2排')
  assert.equal(formationName(mergeFormations(s,[1,2,3]).unit),'1排')
})

test('旧编号迁移按类型分配，重复或非法显示编号得到修复，内部隶属关系保持不变',()=>{
  const s=freshSave();for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  const parent=mergeFormations(s,[1,2,3]).unit
  const legacy=JSON.parse(JSON.stringify(s));legacy.formations.forEach(u=>delete u.number)
  const restored=normalizeSave(legacy)
  assert.deepEqual(restored.formations.map(formationName),['1班','2班','3班','1排'])
  assert.deepEqual(restored.formations.find(u=>u.id===parent.id).children,[1,2,3])
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
  legacy.formations[0].number=1;legacy.formations[1].number=1;legacy.formations[2].number=-7
  assert.deepEqual(normalizeSave(legacy).formations.map(formationName),['1班','2班','3班','1排'])
})

test('各排分出的班各自从1编号，独立班另算，交替分兵和刷新都保持顺序',()=>{
  let s=freshSave()
  assert(setFormation(s,'platoon',30).ok);assert(setFormation(s,'platoon',30).ok);assert(setFormation(s,'squad',10).ok)
  assert(stationTroops(s,1,[1,2]).ok)
  for(const id of [1,2])assert(splitGarrisonUnit(s,id,'squad',7).ok)
  s=normalizeSave(s)
  for(const id of [1,2])assert(splitGarrisonUnit(s,id,'squad',7).ok)
  assert(setFormation(s,'squad',10).ok)
  const names=['1排','2排','1班','1排-1班','2排-1班','1排-2班','2排-2班','2班']
  assert.deepEqual(s.formations.map(formationName),names)
  assert.deepEqual(normalizeSave(s),s)
  const old=structuredClone(s);delete old.formationNumberVersion
  old.formations.filter(unit=>unit.splitParent!==undefined).forEach((unit,index)=>{unit.number=index+3})
  assert.deepEqual(normalizeSave(old),s)
  assert(removeFormation(s,4));const replacement=splitGarrisonUnit(s,1,'squad',7).unit
  assert.equal(formationName(replacement),'1排-1班')
  const children=lineageRows(s.formations).filter(row=>row.unit.splitParent===1)
  assert.deepEqual(children.map(({unit})=>formationName(unit)),['1排-1班','1排-2班'])
})

test('旧存档重新编号时同步更新多级分队的上级称呼',()=>{
  const s=freshSave()
  assert(setFormation(s,'company',100).ok);assert(stationTroops(s,1,[1]).ok)
  const platoon=splitGarrisonUnit(s,1,'platoon',32).unit
  assert(stationTroops(s,2,[platoon.id]).ok);assert(splitGarrisonUnit(s,platoon.id,'squad',7).ok)
  const old=structuredClone(s);delete old.formationNumberVersion
  old.formations[1].number=4;old.formations[2].number=8;old.formations[2].splitPrefix='1连-4排'
  assert.deepEqual(normalizeSave(old),s)
  assert.equal(formationName(normalizeSave(old).formations[2]),'1连-1排-1班')
})

test('旧存档已有分队合编时保留实际下属与兵力，不允许新建同样的合编',()=>{
  const s=freshSave()
  assert(setFormation(s,'platoon',30).ok);assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'squad',10).ok)
  assert(stationTroops(s,1,[1]).ok)
  const branch=splitGarrisonUnit(s,1,'squad',7).unit
  const children=[2,3,branch.id]
  assert.equal(mergeFormations(s,children).ok,false)
  s.formations.push({id:5,number:2,type:'platoon',children,troops:27,weapons:{...branch.weapons,rifle:27}})
  const restored=normalizeSave(s)
  assert.deepEqual(formationParent(restored,branch.id).children,children)
  assert.equal(formation(restored).assignedTroops,50)
})

test('编制总览按类型进入，列表仅显示概要，逐层查看和路径返回不改变编制数据',()=>{
  const g=Object.create(Game.prototype),texts=[]
  g.ctx=new Proxy({fillText:value=>texts.push(String(value))},{get:(o,key)=>o[key]??(()=>{}),set:(o,key,value)=>(o[key]=value,true)})
  g.save=freshSave();g.persist=()=>{};g.notify=()=>{}
  for(let i=0;i<9;i++)assert(setFormation(g.save,'squad',12).ok)
  const platoons=[];for(let i=0;i<3;i++)platoons.push(mergeFormations(g.save,[i*3+1,i*3+2,i*3+3]).unit.id)
  const company=mergeFormations(g.save,platoons).unit,before=JSON.stringify(g.save)
  const draw=()=>{texts.length=0;g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
  g.open('formation');draw();assert.equal(g.buttons.filter(b=>b.id.startsWith('formation-category-')).length,8)
  g.buttons.find(b=>b.id==='formation-category-company').fn();draw();assert.equal(g.modal,'formation-list')
  assert.equal(g.buttons.filter(b=>b.id.startsWith('formation-view-')).length,1);assert.equal(texts.includes('武器配置'),false)
  assert.equal(g.buttons.some(b=>b.id.startsWith('formation-remove-')),false)
  g.buttons.find(b=>b.id==='formation-view-'+company.id).fn();draw();assert(texts.includes('武器配置'))
  g.buttons.find(b=>b.id==='child-view-'+platoons[0]).fn();draw();g.buttons.find(b=>b.id==='child-view-1').fn();draw()
  assert(texts.includes('1连')&&texts.includes('1排')&&texts.includes('1班'))
  assert(g.buttons.some(b=>b.id==='formation-detail-edit'));assert.equal(g.buttons.some(b=>b.id==='formation-detail-remove'),false)
  g.buttons.find(b=>b.id==='formation-detail-edit').fn();draw();g.buttons.find(b=>b.id==='formation-cancel').fn();draw();assert.equal(g.formationDetailId,1)
  g.buttons.find(b=>b.id==='formation-path-0').fn();draw();assert.equal(g.modal,'formation')
  g.buttons.find(b=>b.id==='formation-category-squad').fn();draw();assert(texts.includes('暂无此类独立部队'))
  assert.equal(JSON.stringify(g.save),before)
})


test('三班21人合排、三排63人合连，刷新和解除保留全部下属且不伪装成战损',()=>{
  const s=freshSave();for(let i=0;i<9;i++)assert(setFormation(s,'squad',7).ok)
  const ids=[];for(let i=0;i<3;i++)ids.push(mergeFormations(s,[i*3+1,i*3+2,i*3+3]).unit.id)
  const company=mergeFormations(s,ids).unit;assert.equal(company.troops,63);assert.equal(company.battleDamaged,undefined)
  assert.equal(formation(s).assignedTroops,63);assert.equal(company.weapons.rifle,63)
  const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s)
  assert(unmergeFormation(restored,company.id).ok);assert(unmergeFormation(restored,ids[0]).ok)
  assert.equal(formation(restored).assignedTroops,63);assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
  const direct=freshSave();assert.equal(setFormation(direct,'platoon',21).ok,false);assert.equal(setFormation(direct,'company',63).ok,false)
})

test('总兵力1至6人允许新建班，招募后刷新和补员仍保留；零人、仅未编不足7人不放宽',()=>{
  for(let troops=1;troops<=6;troops++){
    const s=freshSave();s.troops=troops;assert(setFormation(s,'squad',troops).ok);assert.equal(s.formations[0].lowStrength,true)
    assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
    s.troops=20;const restored=normalizeSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s)
    assert(setFormation(restored,'squad',7,1).ok);assert.equal(restored.formations[0].troops,7)
    assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(restored))),restored)
  }
  const zero=freshSave();zero.troops=0;assert.equal(setFormation(zero,'squad',0).ok,false);assert.equal(setFormation(zero,'squad',1).ok,false)
  const normal=freshSave();assert(setFormation(normal,'company',114).ok);assert.equal(setFormation(normal,'squad',6).ok,false)
  const seven=freshSave();seven.troops=7;assert.equal(setFormation(seven,'squad',6).ok,false)
  const armed=freshSave();armed.troops=6;armed.weaponCounts.rifle=3;assert(setFormation(armed,'squad',6).ok);assert.equal(armed.formations[0].weapons.rifle,3)
  assert.equal(normalizeSave({...freshSave(),formations:[{id:1,type:'platoon',troops:6,lowStrength:true}]}).formations.length,0)
})

test('低兵力班可分配部分人员，旧规则恢复后不能继续新建小班，既有小班不会丢失',()=>{
  const s=freshSave();s.troops=6;assert(setFormation(s,'squad',2).ok);assert(setFormation(s,'squad',4).ok)
  assert.equal(formation(s).unassignedTroops,0);s.troops=7;assert.equal(setFormation(s,'squad',1).ok,false)
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(s))),s)
})

test('低兵力创建界面默认现有兵力，输入允许1人，类别切换不恢复7人，合编提示无下限',()=>{
  const g=Object.create(Game.prototype),labels=[]
  g.ctx=new Proxy({fillText:value=>labels.push(String(value))},{get:(o,key)=>o[key]??(()=>{}),set:(o,key,value)=>(o[key]=value,true)})
  g.save=freshSave();g.save.troops=3;g.notify=()=>{};g.persist=()=>{}
  const draw=()=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
  g.editFormation();assert.equal(g.formationDraft.troops,3);assert.equal(g.formationDraft.weapons.rifle,3);draw()
  g.buttons.find(b=>b.id==='formation-type-platoon').fn();draw();g.buttons.find(b=>b.id==='formation-type-squad').fn();assert.equal(g.formationDraft.troops,3)
  const previous=globalThis.wx;let modal;globalThis.wx={showModal:value=>{modal=value}}
  try{g.inputFormationTroops();assert.equal(modal.minValue,1);assert.equal(modal.maxAvailable,3)}finally{if(previous===undefined)delete globalThis.wx;else globalThis.wx=previous}
  draw();g.buttons.find(b=>b.id==='formation-auto').fn();draw();g.buttons.find(b=>b.id==='formation-save').fn()
  assert.equal(g.save.formations[0].troops,3);assert.equal(g.save.formations[0].lowStrength,true)
  g.open('formation');draw();g.buttons.find(b=>b.id==='formation-merge').fn();draw()
  assert(labels.some(label=>label.includes('合编无人数下限')))
})
