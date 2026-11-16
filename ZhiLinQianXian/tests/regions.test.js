import test from 'node:test'
import assert from 'node:assert/strict'
import {MAP_BASE,MAP_SITES,ALL_VILLAGES,REGION_VILLAGES,MAP_FIELDS,MAP_REGIONS,MAP_CITIES,MAP_REGION_ROADS,MAP_BOUNDS,MAP_SIZE,mapLocation,fitCamera,focusCamera,mapToScreen,REGION_KINDS,MAP_TERRAIN_STYLES,MAP_FLAG_COLORS} from '../js/world-map.js'
import {freshSave,normalizeSave,setFormation,mergeFormations,removeFormation} from '../js/state.js'
import {occupyRegion,recallRegion,regionOwner,regionUnits,regionDispatch,regionRecord,regionEnemyTroops} from '../js/regions.js'
import {stationTroops,placeVillageFacility,controlledVillages} from '../js/villages.js'
import {populationRule,villagePopulation} from '../js/population.js'
import {startTrainingTask} from '../js/training.js'
import {formationActivity,startFarming} from '../js/base.js'
import {Game} from '../js/game.js'
import {controlRegionGeometry,regionContains} from '../js/control-regions.js'

const neutral=MAP_REGIONS.find(v=>!v.enemyTroops),enemy=MAP_REGIONS.find(v=>v.enemyTroops&&v.enemyTroops<=24)
function setup(){const s=freshSave();for(let i=0;i<6;i++)assert(setFormation(s,'squad',10).ok);s.cookedRice=100;return s}
function game(s=setup()){
  const g=Object.create(Game.prototype);Object.assign(g,{save:s,scene:'world-map',scale:1,ox:0,oy:0,buttons:[],modal:null,persist(){this.saved=structuredClone(this.save)},notify(message){this.message=message}})
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  return g
}
const click=(g,id)=>{const button=g.buttons.find(b=>b.id===id);assert(button,id);button.fn()}
const drawModal=g=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}
const inputPoint=(g,x,y)=>({clientX:g.ox+x*g.scale,clientY:g.oy+y*g.scale})
const tap=(g,x,y)=>{const p=inputPoint(g,x,y);g.touch({touches:[p]});g.touchEnd({touches:[],changedTouches:[p]})}
const tapButton=(g,id)=>{const b=g.buttons.find(b=>b.id===id);assert(b,id);tap(g,b.x+b.w/2,b.y+b.h/2)}

test('地图扩展至8000×4750，80个外围点位：四种地形各19个、城池4个',()=>{
  assert.deepEqual(MAP_SIZE,{w:8000,h:4750});assert.equal(MAP_BOUNDS.x,-2400);assert.equal(MAP_BOUNDS.y,-1425)
  assert.equal(MAP_BASE.x,1600);assert.equal(MAP_BASE.y,950);assert.equal(MAP_SITES.length,6)
  assert.equal(MAP_REGIONS.length,80);assert.equal(new Set(MAP_REGIONS.map(v=>v.id)).size,80)
  for(const kind of Object.keys(REGION_KINDS))assert.equal(MAP_REGIONS.filter(v=>v.type===kind).length,kind==='city'?4:19)
  const right=MAP_BOUNDS.x+MAP_SIZE.w,bottom=MAP_BOUNDS.y+MAP_SIZE.h
  for(const v of MAP_REGIONS){assert(v.x-150>=MAP_BOUNDS.x&&v.x+150<=right&&v.y-150>=MAP_BOUNDS.y&&v.y+150<=bottom,v.name);assert.equal(mapLocation(v.id),v);assert(MAP_REGION_ROADS.some(r=>r.from===v.id||r.to===v.id))}
  for(let i=0;i<MAP_REGIONS.length;i++)for(let j=i+1;j<MAP_REGIONS.length;j++){const a=MAP_REGIONS[i],b=MAP_REGIONS[j];assert(Math.hypot(a.x-b.x,a.y-b.y)>=360,a.name+'/'+b.name)}
  for(const road of MAP_REGION_ROADS){assert(mapLocation(road.from).id===road.from);assert(mapLocation(road.to).id===road.to)}
  for(const v of MAP_REGIONS.filter(v=>v.id.startsWith('region-far-')))assert(v.enemyTroops<=144)
})

test('空地区可派多支无枪部队占领，驻防不复制兵力武器且与其他任务互斥',()=>{
  const s=setup();s.formations[0].weapons.rifle=0;const before=structuredClone(s)
  assert(occupyRegion(s,neutral.id,[1,2]).ok);assert.equal(regionOwner(s,neutral.id),'player');assert.equal(regionUnits(s,neutral.id).length,2)
  assert.equal(s.troops,before.troops);assert.deepEqual(s.weaponCounts,before.weaponCounts)
  assert.equal(formationActivity(s,1),'region');assert.equal(regionDispatch(s,enemy.id,[1]).ok,false)
  assert.equal(stationTroops(s,1,[1]).ok,false);assert.equal(startFarming(s,'help',0,'millet',[1]).ok,false);assert.equal(removeFormation(s,1),false)
  assert.equal(occupyRegion(s,neutral.id,[3,3]).ok,false)
  assert(recallRegion(s,neutral.id,1).ok);assert.equal(regionOwner(s,neutral.id),'player')
  assert(recallRegion(s,neutral.id,2).ok);assert.equal(regionOwner(s,neutral.id),'neutral');assert.equal(formationActivity(s,1),null)
})

test('合编部队及全部下属一起占领且不能重复派遣，存档刷新保留真实驻军与守敌',()=>{
  const s=setup(),parent=mergeFormations(s,[1,2,3]).unit
  assert(occupyRegion(s,neutral.id,[parent.id]).ok)
  for(const id of [parent.id,1,2,3])assert.equal(formationActivity(s,id),'region')
  assert.equal(regionDispatch(s,enemy.id,[1]).ok,false)
  const loaded=normalizeSave(structuredClone(s));assert.deepEqual(loaded,s)
  assert.equal(regionOwner(loaded,enemy.id),'enemy');assert.equal(regionEnemyTroops(loaded,enemy.id),enemy.enemyTroops)
  assert(recallRegion(loaded,neutral.id,parent.id).ok);assert.equal(formationActivity(loaded,1),null)
})

test('旧存档只初始化一次敌军，清空守军不因刷新复活，非法重复和跨任务驻军被清理',()=>{
  const raw=setup();delete raw.mapRegions
  const s=normalizeSave(raw);assert.equal(regionEnemyTroops(s,enemy.id),enemy.enemyTroops)
  regionRecord(s,enemy.id).enemies=[];assert.equal(regionEnemyTroops(normalizeSave(s),enemy.id),0)
  stationTroops(s,1,[1]);regionRecord(s,neutral.id).garrisonIds=[1,2,2,999]
  const other=MAP_REGIONS.find(v=>v.id!==neutral.id&&!v.enemyTroops);regionRecord(s,other.id).garrisonIds=[2,3]
  const restored=normalizeSave(s);assert.deepEqual(regionRecord(restored,neutral.id).garrisonIds,[2]);assert.deepEqual(regionRecord(restored,other.id).garrisonIds,[3])
})

test('敌占点不能直接占领，缺枪不能进攻，战斗只有情报所示守军且胜利后真实占领缴获',()=>{
  const g=game(),s=g.save;assert.equal(occupyRegion(s,enemy.id,[1]).ok,false)
  const missing=s.formations[0];missing.weapons.rifle=0;assert.equal(regionDispatch(s,enemy.id,[1]).ok,false);missing.weapons.rifle=10
  const before=s.weaponCounts.rifle,stage=s.stage;g.dispatchRegion(enemy.id,[1,2,3]);const b=g.battle
  assert.equal(g.scene,'battle');assert.equal(b.goal,1);assert.equal(formationActivity(s,1),'battle')
  for(let i=0;i<100&&!b.done;i++){for(const e of b.enemies)e.hp=0;b.update(.5)}
  assert(b.done&&b.won);assert.equal(b.kills,enemy.enemyTroops);assert.equal(b.pending,0);assert.equal(b.regionEnemyQueue.length,0)
  g.finish();assert.equal(regionOwner(s,enemy.id),'player');assert.equal(regionUnits(s,enemy.id).length,3)
  assert.equal(s.stage,stage);assert.equal(s.weaponCounts.rifle,before+enemy.enemyTroops);assert.equal(g.result.region.occupied,true)
  const snapshot=structuredClone(s);g.finish();assert.deepEqual(s,snapshot);assert.deepEqual(normalizeSave(s),s)
})

test('进攻失败保留剩余敌军，不获得占领；全灭扣兵扣枪且无轻重伤',()=>{
  const g=game();g.dispatchRegion(enemy.id,[1]);const b=g.battle;b.update(1.1)
  assert.equal(b.enemies.length,1);const injured=b.enemies[0];injured.hp-=3
  b.units[0].hp=0;b.done=true;b.won=false;g.finish()
  assert.equal(regionOwner(g.save,enemy.id),'enemy');assert.equal(regionEnemyTroops(g.save,enemy.id),enemy.enemyTroops-3)
  assert.equal(regionUnits(g.save,enemy.id).length,0);assert.equal(g.save.troops,110);assert.equal(g.save.weaponCounts.rifle,110)
  assert.equal(g.result.woundedLight,0);assert.equal(g.result.woundedHeavy,0);assert.equal(g.result.directDeaths,10)
})

test('获胜驻防只保留真实余员和武器，不自动补满战损编制',()=>{
  const g=game();g.dispatchRegion(enemy.id,[1]);const b=g.battle
  for(let i=0;i<100&&!b.done;i++){for(const e of b.enemies)e.hp=0;b.update(.5)}
  assert(b.won);b.units[0].hp=4;g.finish()
  const unit=regionUnits(g.save,enemy.id)[0];assert.equal(unit.troops,4);assert.equal(unit.weapons.rifle,4);assert.equal(g.save.troops,114)
  assert.equal(g.save.weaponCounts.rifle,120-6+enemy.enemyTroops)
  assert.deepEqual(normalizeSave(g.save),g.save)
})

test('全图可准确点击全部新点位，选择派遣数量、占领、撤军以及返回原村庄路径可用',()=>{
  const g=game();g.openWorldMap();fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap()
  const buttons=g.buttons.filter(b=>b.id.startsWith('map-region-'));assert.equal(buttons.length,MAP_REGIONS.length)
  const points=g.buttons.filter(b=>/^map-(region|site|field)-/.test(b.id))
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const a=points[i],b=points[j];assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,a.id+'/'+b.id)}
  for(const site of MAP_REGIONS){const p=mapToScreen(g.mapCamera,site),b=buttons.find(b=>b.id==='map-region-'+site.id);assert(p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h);b.fn();assert.equal(g.regionId,site.id);assert.equal(g.modal,'campaign-deploy');drawModal(g);click(g,'close')}
  g.openRegion(neutral.id);drawModal(g);click(g,'region-dispatch');assert.equal(g.deploymentRegionId,neutral.id);drawModal(g)
  click(g,'deployment-unit-1');drawModal(g);click(g,'deployment-confirm');assert.equal(regionOwner(g.save,neutral.id),'player');assert.equal(g.modal,'region')
  drawModal(g);click(g,'region-recall-1');assert.equal(regionOwner(g.save,neutral.id),'neutral')
  g.openRegionDeployment(enemy.id);drawModal(g);click(g,'close');assert.equal(g.modal,'region');assert.equal(g.regionId,enemy.id)
  g.openCampaignDeployment(1);assert.equal(g.deploymentRegionId,null)
})

test('新驻防点位纳入红色地区，敌占和未驻防地形会阻止跨点合并',()=>{
  const g=game();occupyRegion(g.save,neutral.id,[1]);g.openWorldMap();fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap()
  const geometry=controlRegionGeometry([MAP_BASE,neutral]);assert(geometry.polygons.some(p=>regionContains(p,neutral)))
  assert.equal(geometry.polygons.some(p=>regionContains(p,enemy)),false)
  assert(recallRegion(g.save,neutral.id,1).ok);g.buttons=[];g.drawWorldMap()
  assert.equal(regionOwner(g.save,neutral.id),'neutral')
})

test('所有新点位经真实按下/松开路径弹出派遣窗口，地图拖动不会误触',()=>{
  for(const scale of [.5,1,1.4]){
    const g=game();g.scale=scale;g.ox=12;g.oy=7;g.openWorldMap();fitCamera(g.mapCamera)
    for(const site of MAP_REGIONS){
      g.openWorldMap();g.buttons=[];g.drawWorldMap();const p=mapToScreen(g.mapCamera,site)
      tap(g,p.x,p.y);assert.equal(g.modal,'campaign-deploy',site.name);assert.equal(g.deploymentRegionId,site.id)
      drawModal(g);assert(g.buttons.some(b=>b.id==='deployment-confirm'))
    }
    g.openWorldMap();focusCamera(g.mapCamera,enemy);g.buttons=[];g.drawWorldMap();const p=mapToScreen(g.mapCamera,enemy)
    g.touch({touches:[inputPoint(g,p.x,p.y)]});g.touchMove({touches:[inputPoint(g,p.x+40,p.y+30)]});g.touchEnd({touches:[],changedTouches:[inputPoint(g,p.x+40,p.y+30)]})
    assert.equal(g.modal,null)
  }
})

test('原生点击可连续选人数、确认占领、管理驻军；敌占点确认进入战斗',()=>{
  const g=game();g.openWorldMap();fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap();let p=mapToScreen(g.mapCamera,neutral)
  tap(g,p.x,p.y);drawModal(g);tapButton(g,'deployment-unit-1');tapButton(g,'deployment-unit-2');drawModal(g)
  assert.equal(g.deploymentIds.length,2);tapButton(g,'deployment-confirm');assert.equal(regionUnits(g.save,neutral.id).reduce((sum,u)=>sum+u.troops,0),20)
  g.openWorldMap();g.buttons=[];g.drawWorldMap();p=mapToScreen(g.mapCamera,neutral);tap(g,p.x,p.y);assert.equal(g.modal,'region')
  drawModal(g);tapButton(g,'region-recall-1');drawModal(g);tapButton(g,'region-recall-2')
  g.openWorldMap();g.buttons=[];g.drawWorldMap();p=mapToScreen(g.mapCamera,enemy);tap(g,p.x,p.y);drawModal(g);tapButton(g,'deployment-unit-1');drawModal(g);tapButton(g,'deployment-confirm')
  assert.equal(g.scene,'battle');assert.equal(g.battle.regionId,enemy.id);assert.equal(g.modal,null)
})

test('四座城池相距至少2950单位，守军为团级以上真实编制，战损和旧档迁移保留',()=>{
  const s=setup();assert.equal(MAP_CITIES.length,4)
  for(let i=0;i<MAP_CITIES.length;i++)for(let j=i+1;j<MAP_CITIES.length;j++)assert(Math.hypot(MAP_CITIES[i].x-MAP_CITIES[j].x,MAP_CITIES[i].y-MAP_CITIES[j].y)>=2950)
  for(const city of MAP_CITIES){
    const record=regionRecord(s,city.id);assert.equal(regionOwner(s,city.id),'enemy');assert.equal(regionEnemyTroops(s,city.id),city.enemyTroops)
    assert(city.enemyTroops>=1000);for(const unit of record.enemies)assert(['regiment','brigade','division','army'].includes(unit.type))
  }
  const old=structuredClone(s);for(const city of MAP_CITIES)delete old.mapRegions[city.id]
  const restored=normalizeSave(old);for(const city of MAP_CITIES)assert.equal(regionEnemyTroops(restored,city.id),city.enemyTroops)
  const g=game(restored),city=MAP_CITIES[0];g.dispatchRegion(city.id,[1]);g.battle.update(1.1)
  assert.equal(g.battle.enemies[0].type,'regiment');assert.equal(g.battle.enemies[0].maxHp,1200)
  g.battle.enemies[0].hp=600;g.battle.done=true;g.battle.won=false;g.finish()
  const loaded=normalizeSave(g.save);assert.equal(regionEnemyTroops(loaded,city.id),600);assert.equal(regionRecord(loaded,city.id).enemies[0].type,'regiment')
  regionRecord(loaded,city.id).enemies=[];assert.equal(regionEnemyTroops(normalizeSave(loaded),city.id),0)
})

test('地形颜色固定，原六村和外围村庄全黄；归属只用红蓝旗区分且随占领撤军更新',()=>{
  const g=game(),labels=new Map(),fills=[]
  g.ctx.fillText=value=>labels.set(String(value),g.ctx.fillStyle);g.ctx.fill=()=>fills.push(g.ctx.fillStyle)
  const render=()=>{labels.clear();fills.length=0;g.buttons=[];g.drawWorldMap()}
  g.openWorldMap();fitCamera(g.mapCamera);render()
  for(const site of [...MAP_SITES,...MAP_REGIONS])assert.equal(labels.get(site.name),MAP_TERRAIN_STYLES[site.type].color,site.name)
  const count=color=>fills.filter(value=>value===color).length,enemyCount=MAP_REGIONS.filter(site=>site.enemyTroops>0).length
  assert.equal(count(MAP_FLAG_COLORS.player),1);assert.equal(count(MAP_FLAG_COLORS.enemy),enemyCount)
  assert(stationTroops(g.save,1,[1]).ok);assert(occupyRegion(g.save,neutral.id,[2]).ok);render();assert.equal(count(MAP_FLAG_COLORS.player),3)
  assert.equal(labels.get(neutral.name),MAP_TERRAIN_STYLES[neutral.type].color)
  regionRecord(g.save,enemy.id).enemies=[];assert(occupyRegion(g.save,enemy.id,[3]).ok);render()
  assert.equal(count(MAP_FLAG_COLORS.enemy),enemyCount-1);assert.equal(count(MAP_FLAG_COLORS.player),4);assert.equal(labels.get(enemy.name),MAP_TERRAIN_STYLES[enemy.type].color)
  assert(recallRegion(g.save,enemy.id,3).ok);render();assert.equal(count(MAP_FLAG_COLORS.player),3)
  assert.deepEqual(normalizeSave(g.save),g.save)
})

test('所有村庄各有1块田地及规模/人数，占领外围村庄后可进入完整村庄管理、种田、设厂与训练',()=>{
  const g=game(),s=g.save
  assert.equal(ALL_VILLAGES.length,MAP_SITES.length+REGION_VILLAGES.length)
  for(const v of ALL_VILLAGES){
    assert.equal(MAP_FIELDS.filter(f=>f.villageId===v.id).length,1,v.name)
    assert(populationRule(v.id),v.name);assert(villagePopulation(s,v.id)>0,v.name)
  }
  const rv=REGION_VILLAGES.find(v=>!mapLocation(v.regionId).enemyTroops),rf=MAP_FIELDS.find(f=>f.villageId===rv.id)
  assert.equal(controlledVillages(s).some(v=>v.id===rv.id),false)
  g.openMapField(rf.id);assert.equal(g.modal,null);assert(g.message.includes('需要先占领'))
  g.openWorldMap();fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap()
  const p=mapToScreen(g.mapCamera,rv);tap(g,p.x,p.y);assert.equal(g.modal,'campaign-deploy')
  drawModal(g);tapButton(g,'deployment-unit-1');drawModal(g);tapButton(g,'deployment-confirm')
  assert.equal(regionOwner(s,rv.regionId),'player');assert.equal(g.modal,'village');assert.equal(g.villageId,rv.id)
  assert(controlledVillages(s).some(v=>v.id===rv.id))
  drawModal(g);g.openMapField(rf.id);assert.equal(g.modal,'farm');assert.equal(g.farmFieldId,rf.id)
  assert(startFarming(s,'help',10,rf.crop,[1],rf.id).ok)
  assert(placeVillageFacility(s,'armory',rv.id).ok);assert.equal(s.facilityVillages.armory,rv.id)
  assert(occupyRegion(s,rv.regionId,[2]).ok);assert(startTrainingTask(s,2,rv.id).ok)
  assert.deepEqual(normalizeSave(structuredClone(s)),s)
})

test('只有被驻军村庄的田地显示点击派兵，未占领或未驻军村庄田地不显示点击派兵',()=>{
  const g=game(),labels=[]
  g.ctx.fillText=value=>labels.push(String(value))
  g.openWorldMap();fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap()
  assert.equal(labels.includes('点击派兵'),false)
  assert(stationTroops(g.save,1,[1]).ok)
  labels.length=0;g.buttons=[];g.drawWorldMap()
  assert.equal(labels.filter(v=>v==='点击派兵').length,1)
})

test('驻军可分出低于当前编制的独立部队去执行其他任务，且地图驻军介绍显示当前人数',()=>{
  const s=freshSave();s.troops=100;s.weaponCounts.rifle=100;s.cookedRice=100
  assert(setFormation(s,'company',100).ok)
  assert(stationTroops(s,1,[1]).ok)
  const g=game(s),labels=[]
  g.ctx.fillText=value=>labels.push(String(value))
  g.openWorldMap();g.buttons=[];g.drawWorldMap()
  assert(labels.includes('1连 100人'))
  g.openVillage(1);drawModal(g);click(g,'village-split-1');assert.equal(g.modal,'garrison-split')
  drawModal(g);click(g,'gsplit-type-platoon');drawModal(g);click(g,'gsplit-preset-32');drawModal(g);click(g,'gsplit-confirm')
  assert.equal(g.modal,'village');assert.equal(s.formations.find(u=>u.id===1).troops,68)
  const split=s.formations.find(u=>u.id!==1);assert.equal(split.type,'platoon');assert.equal(split.troops,32);assert.equal(split.weapons.rifle,32)
  const nonVillageNeutral=MAP_REGIONS.find(v=>!v.enemyTroops&&v.type!=='village')
  assert.equal(formationActivity(s,split.id),null);assert(occupyRegion(s,nonVillageNeutral.id,[split.id]).ok)
  g.openRegion(nonVillageNeutral.id);drawModal(g);click(g,'region-split-'+split.id);assert.equal(g.modal,'garrison-split')
  drawModal(g);click(g,'gsplit-type-squad');drawModal(g);click(g,'gsplit-confirm')
  assert.equal(s.formations.find(u=>u.id===split.id).troops,25)
  assert.deepEqual(normalizeSave(structuredClone(s)),s)
})

test('选择派遣部队和调入驻军界面可直接点击分出部分并自动选中出战或驻防',()=>{
  const s=freshSave();s.troops=100;s.weaponCounts.rifle=100;s.cookedRice=100
  assert(setFormation(s,'company',100).ok);assert(stationTroops(s,1,[1]).ok)
  const g=game(s)
  g.openRegionDeployment(enemy.id);drawModal(g);click(g,'deployment-split-1');assert.equal(g.modal,'garrison-split')
  drawModal(g);click(g,'gsplit-type-platoon');drawModal(g);click(g,'gsplit-preset-32');drawModal(g);click(g,'gsplit-confirm')
  assert.equal(g.modal,'campaign-deploy');assert.equal(g.deploymentIds.length,1)
  drawModal(g);click(g,'deployment-confirm');assert.equal(g.scene,'battle');assert.equal(g.battle.units[0].hp,32)
})
