import test from 'node:test'
import assert from 'node:assert/strict'
import {MAP_BASE,MAP_SITES,MAP_LOCAL_VILLAGES,ALL_VILLAGES,REGION_VILLAGES,MAP_FIELDS,MAP_REGIONS,MAP_CITIES,MAP_ROADS,MAP_REGION_ROADS,MAP_BOUNDS,MAP_SIZE,mapLocation,fitCamera,focusCamera,mapToScreen,REGION_KINDS,MAP_TERRAIN_STYLES,MAP_FLAG_COLORS} from '../js/world-map.js'
import {LAYOUT_FIELDS,LAYOUT_REGIONS} from '../js/map-layout.js'
import {freshSave,normalizeSave,setFormation,mergeFormations,removeFormation,splitGarrisonUnit,formation,formationName,rejoinFormation,formationOccupancy,reinforcementCapacity,reinforceFormation} from '../js/state.js'
import {occupyRegion,recallRegion,regionOwner,regionUnits,regionLocalUnits,regionDispatch,regionRecord,regionEnemyTroops} from '../js/regions.js'
import {stationTroops,recallGarrison,placeVillageFacility,controlledVillages,villageUnits} from '../js/villages.js'
import {startMarch,advanceMarches,marchOrigin,marchPosition,marchRoute} from '../js/marching.js'
import {populationRule,villagePopulation} from '../js/population.js'
import {startTrainingTask,cancelTrainingTask} from '../js/training.js'
import {farmTaskAt,formationActivity,startFarming} from '../js/base.js'
import {Game} from '../js/game.js'
import {startGathering,stopGathering} from '../js/gathering.js'
import {controlRegionGeometry,regionContains} from '../js/control-regions.js'
import {RAID_INTERVAL,RAID_RESPONSE_WINDOW,RAID_TRAVEL_SECONDS,advanceRaids,raidOrigin,raidMarch,raidDeployment,makeRaidBattle,resolveRaidAutomatically,autoDefendRaid} from '../js/raids.js'
import {startProduction} from '../js/facilities.js'

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

test('村庄与地区驻军可点转移驻地后在大地图选择，确认才出发，取消返回原驻地',()=>{
  const g=game(),s=g.save,destination=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  const drawMap=()=>{g.buttons=[];g.drawWorldMap()}
  assert(stationTroops(s,1,[1,2]).ok);g.openVillage(1);drawModal(g)
  tapButton(g,'village-transfer-1');assert.equal(g.modal,null);assert.deepEqual(s.garrisons[1],[1,2])
  drawMap();tapButton(g,'map-location-action');assert.equal(g.modal,'village');assert.equal(g.villageId,1)
  drawModal(g);tapButton(g,'village-transfer-1')
  focusCamera(g.mapCamera,destination);drawMap();tapButton(g,'map-region-'+destination.id)
  assert.equal(g.modal,'garrison-transfer');assert.deepEqual(s.garrisons[1],[1,2]);drawModal(g)
  tapButton(g,'transfer-reselect');assert.equal(g.modal,null)
  drawMap();tapButton(g,'map-region-'+destination.id);drawModal(g);tapButton(g,'transfer-confirm')
  assert.equal(g.modal,null);assert.deepEqual(s.garrisons[1],[2]);assert.equal(s.marchingOrders[0].targetId,destination.id)
  g.updateMapMarches(10000);assert.equal(regionOwner(s,destination.id),'player')
  g.openRegion(destination.id);drawModal(g);tapButton(g,'region-transfer-1')
  assert.equal(g.garrisonTransfer.originId,destination.id)
  focusCamera(g.mapCamera,MAP_SITES[1]);drawMap();tapButton(g,'map-site-2');drawModal(g);tapButton(g,'transfer-confirm')
  g.updateMapMarches(10000);assert.deepEqual(s.garrisons[2],[1])
})

test('调整中心地区后，三倍地图边界和144个外围据点保留，全图道路连通',()=>{
  assert.deepEqual(MAP_SIZE,{w:13856,h:8228});assert.equal(MAP_BOUNDS.x,-5328);assert.equal(MAP_BOUNDS.y,-3164)
  assert.equal(MAP_BASE.x,1600);assert.equal(MAP_BASE.y,950);assert.equal(MAP_SITES.length,6)
  const outer=MAP_REGIONS.filter(v=>v.id.startsWith('region-outer-'))
  assert.equal(MAP_REGIONS.length,224);assert.equal(new Set(MAP_REGIONS.map(v=>v.id)).size,224)
  assert.equal(new Set(MAP_REGIONS.map(v=>v.name)).size,224)
  const newCounts={village:36,mountain:36,forest:34,river:32,city:6}
  for(const kind of Object.keys(REGION_KINDS))assert.equal(outer.filter(v=>v.type===kind).length,newCounts[kind])
  for(const v of outer)assert(v.x<-2400||v.x>5600||v.y<-1425||v.y>3325,v.name)
  for(const [key,name,x,y] of LAYOUT_REGIONS){
    const original=mapLocation('region-'+key)
    assert.deepEqual([original.name,original.x,original.y],[name,x,y])
  }
  assert.deepEqual(MAP_FIELDS.slice(0,LAYOUT_FIELDS.length).map(({x,y})=>[x,y]),LAYOUT_FIELDS)
  const right=MAP_BOUNDS.x+MAP_SIZE.w,bottom=MAP_BOUNDS.y+MAP_SIZE.h,roads=[...MAP_ROADS,...MAP_REGION_ROADS]
  for(const v of MAP_REGIONS){assert(v.x-150>=MAP_BOUNDS.x&&v.x+150<=right&&v.y-150>=MAP_BOUNDS.y&&v.y+150<=bottom,v.name);assert.equal(mapLocation(v.id),v);assert(roads.some(r=>r.from===v.id||r.to===v.id))}
  for(let i=0;i<MAP_REGIONS.length;i++)for(let j=i+1;j<MAP_REGIONS.length;j++){const a=MAP_REGIONS[i],b=MAP_REGIONS[j];assert(Math.hypot(a.x-b.x,a.y-b.y)>=360,a.name+'/'+b.name)}
  for(const road of MAP_REGION_ROADS){assert(mapLocation(road.from).id===road.from);assert(mapLocation(road.to).id===road.to)}
  const connected=new Set([MAP_BASE.roadId])
  for(const from of connected)for(const road of roads){
    if(road.from===from)connected.add(road.to)
    if(road.to===from)connected.add(road.from)
  }
  assert.equal(connected.size,MAP_REGIONS.length+MAP_LOCAL_VILLAGES.length)
  for(const site of outer)assert(marchRoute(site).length>2,site.name)
  for(const v of MAP_REGIONS.filter(v=>v.id.startsWith('region-far-')))assert(v.enemyTroops<=144)
})

test('旧地图存档保留驻军、占领记录和村民人数，新增据点加载固定初始状态',()=>{
  const s=setup(),village=REGION_VILLAGES.find(v=>!v.regionId.startsWith('region-outer-'))
  regionRecord(s,village.regionId).enemies=[]
  assert(occupyRegion(s,village.regionId,[1]).ok)
  assert(occupyRegion(s,neutral.id,[2]).ok)
  s.villagePopulation[village.id]=125
  for(const site of MAP_REGIONS.filter(v=>v.id.startsWith('region-outer-')))delete s.mapRegions[site.id]
  for(const site of REGION_VILLAGES.filter(v=>v.regionId.startsWith('region-outer-')))delete s.villagePopulation[site.id]

  const loaded=normalizeSave(s)
  assert.equal(regionEnemyTroops(loaded,village.regionId),0)
  assert.deepEqual(villageUnits(loaded,village.id).map(unit=>unit.id),[1])
  assert.deepEqual(regionUnits(loaded,neutral.id).map(unit=>unit.id),[2])
  assert.equal(villagePopulation(loaded,village.id),125)
  for(const site of MAP_REGIONS.filter(v=>v.id.startsWith('region-outer-'))){
    assert.equal(regionEnemyTroops(loaded,site.id),site.enemyTroops)
    if(site.villageId)assert.equal(villagePopulation(loaded,site.villageId),populationRule(site.villageId).cap)
  }
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

test('敌占点需要进攻，无枪编制可出战，胜利后占领并缴获实际守军武器',()=>{
  const g=game(),s=g.save;assert.equal(occupyRegion(s,enemy.id,[1]).ok,false)
  s.formations[0].weapons.rifle=0
  assert.deepEqual(regionDispatch(s,enemy.id,[1]).units[0].groups,[{weapon:null,troops:10,trainingBonus:0}])
  const before=s.weaponCounts.rifle,stage=s.stage;g.beginRegionBattle(enemy.id,[1,2,3]);const b=g.battle
  assert.equal(g.scene,'battle');assert.equal(b.goal,1);assert.equal(formationActivity(s,1),'battle')
  for(let i=0;i<100&&!b.done;i++){for(const e of b.enemies)e.hp=0;b.update(.5)}
  assert(b.done&&b.won);assert.equal(b.kills,enemy.enemyTroops);assert.equal(b.pending,0);assert.equal(b.regionEnemyQueue.length,0)
  g.finish();assert.equal(regionOwner(s,enemy.id),'player');assert.equal(regionUnits(s,enemy.id).length,3)
  assert.equal(s.stage,stage);assert.equal(s.weaponCounts.rifle,before+enemy.enemyTroops);assert.equal(g.result.region.occupied,true)
  const snapshot=structuredClone(s);g.finish();assert.deepEqual(s,snapshot);assert.deepEqual(normalizeSave(s),s)
})

test('进攻失败保留剩余敌军，不获得占领；全灭扣兵扣枪且无轻重伤',()=>{
  const g=game();g.beginRegionBattle(enemy.id,[1]);const b=g.battle;b.update(1.1)
  assert.equal(b.enemies.length,1);const injured=b.enemies[0];injured.hp-=3
  b.units[0].hp=0;b.done=true;b.won=false;g.finish()
  assert.equal(regionOwner(g.save,enemy.id),'enemy');assert.equal(regionEnemyTroops(g.save,enemy.id),enemy.enemyTroops-3)
  assert.equal(regionUnits(g.save,enemy.id).length,0);assert.equal(g.save.troops,110);assert.equal(g.save.weaponCounts.rifle,110)
  assert.equal(g.result.lostTroops,10)
})

test('获胜驻防只保留真实余员和武器，不自动补满战损编制',()=>{
  const g=game();g.beginRegionBattle(enemy.id,[1]);const b=g.battle
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
  click(g,'deployment-unit-1');drawModal(g);click(g,'deployment-confirm');assert.equal(regionOwner(g.save,neutral.id),'neutral');g.updateMapMarches(10000);g.openRegion(neutral.id);assert.equal(regionOwner(g.save,neutral.id),'player');assert.equal(g.modal,'region')
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
    g.buttons=[];g.drawWorldMap();tapButton(g,'raid-alert-toggle')
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
  assert.equal(g.deploymentIds.length,2);tapButton(g,'deployment-confirm');assert.equal(g.save.marchingOrders.length,1);g.updateMapMarches(10000);assert.equal(regionUnits(g.save,neutral.id).reduce((sum,u)=>sum+u.troops,0),20)
  g.openWorldMap();g.buttons=[];g.drawWorldMap();p=mapToScreen(g.mapCamera,neutral);tap(g,p.x,p.y);assert.equal(g.modal,'region')
  drawModal(g);tapButton(g,'region-recall-1');drawModal(g);tapButton(g,'region-recall-2')
  g.openWorldMap();g.buttons=[];g.drawWorldMap();p=mapToScreen(g.mapCamera,enemy);tap(g,p.x,p.y);drawModal(g);tapButton(g,'deployment-unit-1');drawModal(g);tapButton(g,'deployment-confirm');g.updateMapMarches(10000)
  assert.equal(g.scene,'battle');assert.equal(g.battle.regionId,enemy.id);assert.equal(g.modal,null)
})

test('十座城池相距至少2950单位，守军为团级以上真实编制，战损和旧档迁移保留',()=>{
  const s=setup();assert.equal(MAP_CITIES.length,10)
  for(let i=0;i<MAP_CITIES.length;i++)for(let j=i+1;j<MAP_CITIES.length;j++)assert(Math.hypot(MAP_CITIES[i].x-MAP_CITIES[j].x,MAP_CITIES[i].y-MAP_CITIES[j].y)>=2950)
  for(const city of MAP_CITIES){
    const record=regionRecord(s,city.id);assert.equal(regionOwner(s,city.id),'enemy');assert.equal(regionEnemyTroops(s,city.id),city.enemyTroops)
    assert(city.enemyTroops>=1000);for(const unit of record.enemies)assert(['regiment','brigade','division','army'].includes(unit.type))
  }
  const old=structuredClone(s);for(const city of MAP_CITIES)delete old.mapRegions[city.id]
  const restored=normalizeSave(old);for(const city of MAP_CITIES)assert.equal(regionEnemyTroops(restored,city.id),city.enemyTroops)
  const g=game(restored),city=MAP_CITIES[0];g.beginRegionBattle(city.id,[1]);g.battle.update(1.1)
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
  assert.equal(ALL_VILLAGES.length,MAP_LOCAL_VILLAGES.length+REGION_VILLAGES.length)
  for(const v of ALL_VILLAGES){
    assert.equal(MAP_FIELDS.filter(f=>f.villageId===v.id).length,1,v.name)
    assert(populationRule(v.id),v.name);assert(villagePopulation(s,v.id)>0,v.name)
  }
  const rv=REGION_VILLAGES.find(v=>v.regionId.startsWith('region-outer-')&&!mapLocation(v.regionId).enemyTroops),rf=MAP_FIELDS.find(f=>f.villageId===rv.id)
  assert.equal(controlledVillages(s).some(v=>v.id===rv.id),false)
  g.openMapField(rf.id);assert.equal(g.modal,null);assert(g.message.includes('需要先占领'))
  g.openWorldMap();fitCamera(g.mapCamera);g.buttons=[];g.drawWorldMap();tapButton(g,'raid-alert-toggle');g.buttons=[];g.drawWorldMap()
  const p=mapToScreen(g.mapCamera,rv);tap(g,p.x,p.y);assert.equal(g.modal,'campaign-deploy')
  drawModal(g);tapButton(g,'deployment-unit-1');drawModal(g);tapButton(g,'deployment-confirm')
  g.updateMapMarches(10000);g.openRegion(rv.regionId);assert.equal(regionOwner(s,rv.regionId),'player');assert.equal(g.modal,'village');assert.equal(g.villageId,rv.id)
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

test('在派遣名单分出新部队后回到原名单，在上级下面自动选中新部队',()=>{
  const s=freshSave();s.troops=100;s.weaponCounts.rifle=100;s.cookedRice=100
  assert(setFormation(s,'company',100).ok);assert(stationTroops(s,1,[1]).ok)
  const g=game(s)
  g.openRegionDeployment(enemy.id);drawModal(g);click(g,'deployment-unit-1');click(g,'deployment-split-1');assert.equal(g.modal,'garrison-split')
  drawModal(g);click(g,'gsplit-type-platoon');drawModal(g);click(g,'gsplit-preset-32');drawModal(g);click(g,'gsplit-confirm')
  assert.equal(g.modal,'campaign-deploy');assert.equal(g.deploymentIds.length,1)
  drawModal(g);assert(g.buttons.some(b=>b.id==='deployment-unit-'+g.deploymentIds[0]));click(g,'deployment-confirm');g.updateMapMarches(10000);assert.equal(g.scene,'battle');assert.equal(g.battle.units[0].hp,32)
})

test('攻打敌占据点时可选驻村整团，从原驻地出发行军并带上合编下属',()=>{
  const s=freshSave(),g=game(s),origin=MAP_SITES[0]
  s.troops=1210;s.weaponCounts.rifle=1210
  for(let i=0;i<3;i++)assert(setFormation(s,'battalion',400).ok)
  const regiment=mergeFormations(s,[1,2,3]).unit
  assert(setFormation(s,'squad',10).ok)
  const guard=s.formations.find(unit=>unit.type==='squad')
  assert(stationTroops(s,origin.id,[regiment.id,guard.id]).ok)
  g.openRegionDeployment(enemy.id);drawModal(g);click(g,'deployment-tier-regiment');drawModal(g)
  assert(g.buttons.some(button=>button.id==='deployment-split-'+regiment.id))
  click(g,'deployment-unit-'+regiment.id);drawModal(g)
  assert.deepEqual(g.deploymentIds,[regiment.id]);assert.equal(s.marchingOrders.length,0)
  click(g,'deployment-confirm')
  assert.deepEqual(s.garrisons[origin.id],[guard.id]);assert.equal(s.troops,1210)
  assert.equal(regionOwner(s,enemy.id),'enemy');assert.equal(g.scene,'world-map')
  assert.deepEqual(marchPosition(s.marchingOrders[0]),{x:origin.x,y:origin.y})
  assert.deepEqual(s.marchingOrders[0].unitIds,[regiment.id]);assert.deepEqual(normalizeSave(s),s)
  for(const id of regiment.children)assert.equal(formationActivity(s,id),'march')
  g.updateMapMarches(10000);assert.equal(g.scene,'battle')
  assert.equal(g.battle.units.length,1);assert.equal(g.battle.units[0].hp,1200)
  for(const id of regiment.children)assert.equal(formationActivity(s,id),'battle')
})

test('调入与出战把分出部队缩进排在上级下，显示不可派的原因并在滚动时保留选择',()=>{
  const s=freshSave(),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  const forest=MAP_REGIONS.find(site=>site.type==='forest'&&!site.enemyTroops)
  assert(setFormation(s,'platoon',25).ok);assert(stationTroops(s,1,[1]).ok)
  assert(setFormation(s,'squad',10).ok);assert(occupyRegion(s,mountain.id,[2]).ok);assert(startGathering(s,mountain.id,[2],'ore').ok)
  for(let i=0;i<4;i++)assert(setFormation(s,'squad',10).ok)
  assert(setFormation(s,'squad',10,null,{}).ok)
  assert(splitGarrisonUnit(s,1,'squad',7).ok)
  assert(occupyRegion(s,forest.id,[8]).ok);assert(startGathering(s,forest.id,[8],'grass').ok)
  const g=game(s),labels=[]
  g.ctx.fillText=(value,x,y)=>labels.push({value:String(value),x,y})
  const ids=()=>g.buttons.map(b=>b.id)
  for(const prefix of ['deployment','station']){
    if(prefix==='deployment')g.openRegionDeployment(enemy.id);else g.openVillageStation(2,true)
    labels.length=0;drawModal(g)
    const parent=labels.find(label=>label.value==='1排'),child=labels.find(label=>label.value==='1排-1班')
    assert(parent&&child);assert(child.x>parent.x);assert.equal(child.y-parent.y,53)
    assert(!ids().some(id=>id.startsWith(prefix+'-tab-')));assert(ids().includes(`${prefix}-split-1`))
    assert(labels.some(label=>label.value===`${mountain.name} · 采集矿石`));assert(!ids().includes(`${prefix}-unit-2`))
    assert(labels.some(label=>label.y===child.y&&label.value===`${forest.name} · 采集干草`));assert(!ids().includes(`${prefix}-unit-8`))
    click(g,`${prefix}-unit-3`);g.scrollRoster(g.rosterScroll.max);labels.length=0;drawModal(g)
    assert.equal(labels.some(label=>label.value==='待命 · 仅近战'),prefix==='deployment')
    assert(ids().includes(`${prefix}-unit-7`))
    assert(labels.some(label=>label.value==='已选 1 支 · 10 人'))
    assert.deepEqual(prefix==='deployment'?g.deploymentIds:g.stationSelected,[3])
  }
  g.scrollRoster(0);drawModal(g);click(g,'station-split-1');drawModal(g);click(g,'gsplit-confirm');drawModal(g)
  assert.equal(g.stationScroll,0);assert.deepEqual(g.stationSelected,[3,9]);assert(ids().includes('station-unit-9'))
})

test('派遣列表能逐级折叠、滚轮和拖动滚动，并保留隐藏部队的勾选',()=>{
  const s=freshSave(),g=game(s)
  s.troops=450;s.weaponCounts.rifle=450
  assert(setFormation(s,'battalion',400).ok);assert(stationTroops(s,1,[1]).ok)
  const company=splitGarrisonUnit(s,1,'company',110).unit
  assert(stationTroops(s,1,[company.id]).ok)
  const platoon=splitGarrisonUnit(s,company.id,'platoon',30).unit
  for(let i=0;i<6;i++)assert(setFormation(s,'squad',7).ok)

  const companyToggle='deployment-collapse-'+company.id,platoonRow='deployment-unit-'+platoon.id
  const button=id=>g.buttons.find(b=>b.id===id)
  g.openRegionDeployment(enemy.id);drawModal(g)
  tap(g,button(platoonRow).x+23,button(platoonRow).y+21);drawModal(g)
  tapButton(g,companyToggle);drawModal(g)
  assert(!button(platoonRow));assert.deepEqual(g.deploymentIds,[platoon.id])
  tapButton(g,'deployment-collapse-1');drawModal(g);assert(!button(companyToggle))
  tapButton(g,'deployment-collapse-1');drawModal(g);assert(button(companyToggle));assert(!button(platoonRow))
  tapButton(g,companyToggle);drawModal(g);assert(button(platoonRow))

  const wheel=inputPoint(g,800,445)
  assert(g.mouseWheel({...wheel,deltaY:200,deltaMode:0}));drawModal(g)
  assert(g.deploymentScroll>0);assert(!button('deployment-collapse-1'))
  assert(g.mouseWheel({...wheel,deltaY:-1000,deltaMode:0}));drawModal(g)
  assert.equal(g.deploymentScroll,0)
  const row=button(platoonRow),start=inputPoint(g,row.x+23,row.y+21),end=inputPoint(g,row.x+23,row.y-104)
  g.touch({touches:[start]});g.touchMove({touches:[end]});g.touchEnd({touches:[],changedTouches:[end]})
  assert(g.deploymentScroll>0);assert.deepEqual(g.deploymentIds,[platoon.id])
})

test('调军筛选按上级级别保留分队层级，换级别不清空选择',()=>{
  const s=freshSave(),g=game(s),labels=[]
  g.ctx.fillText=(value,x,y)=>labels.push({value:String(value),x,y})
  const draw=()=>{labels.length=0;drawModal(g)}
  assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'platoon',30).ok);assert(setFormation(s,'squad',8).ok)
  assert(stationTroops(s,1,[2]).ok)
  const branch=splitGarrisonUnit(s,2,'squad',7).unit
  for(const prefix of ['deployment','station']){
    if(prefix==='deployment')g.openRegionDeployment(enemy.id);else g.openVillageStation(2,true)
    draw();click(g,prefix+'-tier-squad');draw()
    assert(labels.some(label=>label.value==='1班'));assert(!labels.some(label=>label.value==='1排-1班'))
    click(g,prefix+'-unit-1');click(g,prefix+'-tier-platoon');draw()
    const parent=labels.find(label=>label.value==='1排'),child=labels.find(label=>label.value==='1排-1班')
    assert(parent&&child&&child.x>parent.x&&child.y>parent.y)
    assert(!g.buttons.some(button=>button.id===prefix+'-unit-3'))
    if(prefix==='deployment')click(g,'deployment-all')
    else click(g,'station-unit-'+branch.id)
    click(g,prefix+'-tier-division');draw();assert(labels.some(label=>label.value==='暂无此级别的部队'))
    if(prefix==='deployment'){
      assert(labels.some(label=>label.value==='已选 3 支 · 40 人'))
      assert.deepEqual(g.deploymentIds,[1,2,branch.id])
    }else{
      assert(labels.some(label=>label.value==='已选 2 支 · 17 人'))
      assert.deepEqual(g.stationSelected,[1,branch.id])
    }
  }
  click(g,'station-confirm')
  assert.deepEqual(s.marchingOrders.flatMap(order=>order.unitIds),[1,branch.id])
})

test('分类部队按编制级别对齐，可滚动浏览，折叠上级只隐藏其直属或间接下属',()=>{
  const s=freshSave(),g=game(s);s.troops=1600
  assert(setFormation(s,'battalion',400).ok);assert(stationTroops(s,1,[1]).ok)
  const company=splitGarrisonUnit(s,1,'company',110).unit
  assert(stationTroops(s,1,[company.id]).ok)
  const platoon=splitGarrisonUnit(s,company.id,'platoon',30).unit
  const directPlatoon=splitGarrisonUnit(s,1,'platoon',30).unit
  for(let i=0;i<3;i++)assert(setFormation(s,'battalion',400).ok)
  const last=s.formations.find(unit=>unit.type==='battalion'&&unit.number===4)
  const button=id=>g.buttons.find(b=>b.id===id)
  const childRow='formation-view-'+platoon.id,childToggle='formation-collapse-'+company.id
  const directRow='formation-view-'+directPlatoon.id,lastRow='formation-view-'+last.id
  const left=new Map()
  g.ctx.fillText=(label,x)=>left.set(String(label),x)

  g.openFormationList('battalion');drawModal(g)
  assert(button(childRow)&&button(directRow));assert(!button(lastRow));assert(!button('formation-next'))
  assert.equal(left.get('1营-1排'),left.get('1营-1连-1排'))
  assert(left.get('1营-1排')>left.get('1营-1连'))
  tapButton(g,childToggle);drawModal(g);assert(!button(childRow)&&button(directRow))
  tapButton(g,'formation-collapse-1');drawModal(g);assert(!button(childToggle)&&!button(directRow));assert(button(lastRow))
  tapButton(g,lastRow);assert.equal(g.formationDetailId,last.id);drawModal(g)
  tapButton(g,'children-back');drawModal(g)
  assert(button(lastRow)&&!button(childToggle))
  tapButton(g,'formation-collapse-1');drawModal(g);assert(button(childToggle)&&!button(childRow))
  tapButton(g,childToggle);drawModal(g);assert(button(childRow))

  const wheel=inputPoint(g,800,445)
  assert(g.mouseWheel({...wheel,deltaY:200,deltaMode:0}));drawModal(g)
  assert.equal(g.formationListScroll,g.rosterScroll.max);assert(button(lastRow))
  assert(g.mouseWheel({...wheel,deltaY:-200,deltaMode:0}));drawModal(g)
  assert.equal(g.formationListScroll,0)
  const swipe=(x,y,delta)=>{
    const start=inputPoint(g,x,y),end=inputPoint(g,x,y+delta)
    g.touch({touches:[start]});g.touchMove({touches:[end]});g.touchEnd({touches:[],changedTouches:[end]})
  }
  const first=button('formation-view-1')
  swipe(first.x+30,first.y+10,-120);drawModal(g)
  assert.equal(g.modal,'formation-list');assert(button(lastRow))
  g.scrollRoster(0);drawModal(g)
  const {view,thumbHeight}=g.rosterScroll
  swipe(view.x+view.w-3,view.y+20,view.h-thumbHeight+1);drawModal(g)
  assert(button(lastRow));assert.equal(g.formationListScroll,g.rosterScroll.max)
})

test('地区驻防及各任务名单统一显示分出关系，不因分页或正在采集而打散',()=>{
  const s=freshSave(),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops),g=game(s),labels=[]
  g.ctx.fillText=(value,x,y)=>labels.push({value:String(value),x,y})
  const draw=()=>{labels.length=0;drawModal(g)}
  const parentLabel=()=>labels.find(label=>/^(☐ |☑ )?1排$/.test(label.value))
  const childLabel=()=>labels.find(label=>/^(☐ |☑ )?1排-1班$/.test(label.value))
  const assertHierarchy=()=>{
    const parent=parentLabel(),child=childLabel()
    assert(parent&&child,g.modal);assert(child.x>parent.x&&child.y>parent.y,g.modal)
    return child
  }
  for(let i=0;i<2;i++)assert(setFormation(s,'squad',10).ok)
  assert(setFormation(s,'platoon',25).ok);assert(occupyRegion(s,mountain.id,[1,2,3]).ok)
  const child=splitGarrisonUnit(s,3,'squad',7).unit
  assert(occupyRegion(s,mountain.id,[child.id]).ok)
  g.openRegion(mountain.id);draw();assert(!parentLabel()&&!childLabel())
  click(g,'region-next');draw();assertHierarchy()
  click(g,'region-gather');draw();click(g,'facility-next');draw();assertHierarchy()
  assert(startGathering(s,mountain.id,[child.id],'ore').ok)
  g.openRegion(mountain.id);draw();click(g,'region-next');draw()
  assert(labels.some(label=>label.value==='采集矿石中'&&label.y===assertHierarchy().y))
  assert(recallRegion(s,mountain.id,3).ok);g.openRegion(mountain.id);draw()
  assert(!parentLabel());assert.equal(childLabel()?.x,327)
  assert(stopGathering(s,mountain.id,'ore'));assert(recallRegion(s,mountain.id,child.id).ok)
  assert(stationTroops(s,1,[child.id,3]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  g.openVillage(1);draw();assertHierarchy()
  click(g,'village-training');draw();assertHierarchy()
  g.openVillage(1);draw();click(g,'village-armory');draw();assertHierarchy()
  click(g,'facility-detach');draw();assertHierarchy()
  g.openMapField(MAP_FIELDS.find(field=>field.villageId===1).id);draw();assertHierarchy()
})

test('独立分队从地区或村庄撤回到上级的当前地点待命，刷新保留且各自独立',()=>{
  const s=freshSave(),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops),g=game(s),labels=[]
  g.ctx.fillText=(value,x,y)=>labels.push({value:String(value),x,y})
  assert(setFormation(s,'platoon',30).ok);assert(stationTroops(s,1,[1]).ok)
  const branch=splitGarrisonUnit(s,1,'squad',7).unit;assert(occupyRegion(s,mountain.id,[branch.id]).ok)
  g.openRegion(mountain.id);drawModal(g);click(g,'region-recall-'+branch.id)
  assert(g.message.includes('柳树村'));assert.equal(regionOwner(s,mountain.id),'neutral')
  assert.equal(marchOrigin(s,branch.id),1);assert.deepEqual(villageUnits(s,1).map(unit=>unit.id),[1])
  const state=structuredClone(s.formations)
  g.openVillage(1);labels.length=0;drawModal(g)
  const assertRows=()=>{
    const parent=labels.find(label=>label.value==='1排'),child=labels.find(label=>label.value==='1排-1班')
    assert(parent&&child&&child.x>parent.x&&child.y>parent.y)
    assert(labels.some(label=>label.y===child.y&&label.value.startsWith('待命中')))
  }
  assertRows()
  assert(stationTroops(s,2,[branch.id]).ok);assert(recallGarrison(s,1,1).ok)
  assert(startMarch(s,'region',mountain.id,[1]).ok)
  g.openVillage(2);drawModal(g);click(g,'village-recall-'+branch.id)
  assert(g.message.includes('等待上级'));assert.equal(s.garrisons[2],undefined);assert.equal(marchOrigin(s,branch.id),2)
  assert.equal(marchOrigin(normalizeSave(s),branch.id),2)
  advanceMarches(s,1000);assert.equal(marchOrigin(s,branch.id),mountain.id)
  assert.deepEqual(s.formations,state.map(unit=>unit.id===branch.id?{...unit,splitOrigin:mountain.id}:unit))
  const restored=normalizeSave(s);assert.deepEqual(restored,s);g.save=restored
  assert.equal(formationActivity(restored,branch.id),null)
  assert.deepEqual(regionUnits(restored,mountain.id).map(unit=>unit.id),[1])
  assert.deepEqual(regionLocalUnits(restored,mountain.id).map(unit=>unit.id),[1,branch.id])
  g.openRegion(mountain.id);labels.length=0;drawModal(g);assertRows()
})

test('我的部队只在原上级下显示分队，分队不占班级编制池且不能参与合编',()=>{
  const s=freshSave(),g=game(s),labels=[]
  g.ctx.fillText=(value,x,y)=>labels.push({value:String(value),x,y})
  const draw=()=>{labels.length=0;drawModal(g)}
  assert(setFormation(s,'platoon',30).ok)
  assert(setFormation(s,'squad',10).ok);assert(setFormation(s,'squad',10).ok)
  assert(stationTroops(s,1,[1]).ok)
  const first=splitGarrisonUnit(s,1,'squad',7).unit,second=splitGarrisonUnit(s,1,'squad',7).unit
  const mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert(occupyRegion(s,mountain.id,[second.id]).ok);assert(startGathering(s,mountain.id,[second.id],'ore').ok)
  assert.equal(formation(s).assignedTroops,50)
  assert.match(mergeFormations(s,[2,3,first.id]).message,/分队归属原上级/)
  g.open('formation');draw()
  assert(labels.some(label=>label.x===483&&label.y===373&&label.value==='2 支'))
  click(g,'formation-category-squad');draw()
  assert.deepEqual(g.buttons.filter(button=>button.id.startsWith('formation-view-')).map(button=>button.id),['formation-view-2','formation-view-3'])
  g.openFormationList('platoon');draw()
  const parent=labels.find(label=>label.value==='1排'),child=labels.find(label=>label.value==='1排-2班')
  assert(parent&&child&&child.x>parent.x&&child.y>parent.y)
  assert(labels.some(label=>label.y===child.y&&label.value==='分队 · 采集中'))
  click(g,'formation-view-1');draw();click(g,'child-view-'+first.id);draw();click(g,'children-back');assert.equal(g.formationDetailId,1)
  g.openFormationMerge();draw();assert.deepEqual(g.buttons.filter(button=>button.id.startsWith('merge-select-')).map(button=>button.id),['merge-select-2','merge-select-3'])
  assert(recallGarrison(s,1,1).ok);assert(removeFormation(s,1))
  g.open('formation');draw();click(g,'formation-orphan-roster');draw()
  assert(g.buttons.some(button=>button.id==='formation-view-'+first.id))
  assert.equal(formation(normalizeSave(s)).assignedTroops,34)
})

test('分队回到原上级处才可合回，结束任务后可在村庄名单合回，兵力装备经验守恒',()=>{
  const s=freshSave(),g=game(s),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert(setFormation(s,'platoon',30).ok);s.formations[0].trainingXp=2345
  const before=structuredClone(s.formations[0]),stock=structuredClone(s.weaponCounts)
  assert(stationTroops(s,1,[1]).ok)
  const branch=splitGarrisonUnit(s,1,'squad',7).unit
  assert(occupyRegion(s,mountain.id,[branch.id]).ok)
  const away=structuredClone(s);assert.match(rejoinFormation(s,branch.id).message,/同一地点/);assert.deepEqual(s,away)
  assert(recallRegion(s,mountain.id,branch.id).ok)
  assert(startTrainingTask(s,1,1).ok);assert.match(rejoinFormation(s,branch.id).message,/先结束/)
  assert(cancelTrainingTask(s,1))
  g.openVillage(1);drawModal(g);click(g,'village-rejoin-'+branch.id)
  assert.equal(g.modal,'village');assert.match(g.message,/已合回1排/)
  assert.deepEqual(s.formations,[{...before,battleDamaged:true}]);assert.deepEqual(s.weaponCounts,stock)
  assert.equal(s.troops,120);assert.deepEqual(s.garrisons[1],[1]);assert.deepEqual(normalizeSave(s),s)
})

test('分队合回合编部队时可补足下属空位，已编人数不重复且刷新保留',()=>{
  const s=freshSave()
  for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  s.formations[0].trainingXp=1010
  const parent=mergeFormations(s,[1,2,3]).unit
  assert(stationTroops(s,1,[parent.id]).ok)
  const branch=splitGarrisonUnit(s,parent.id,'squad',10).unit
  assert.equal(parent.children.length,2)
  assert(rejoinFormation(s,branch.id).ok)
  assert.equal(parent.troops,30);assert.equal(parent.weapons.rifle,30);assert.equal(parent.children.length,3)
  assert.equal(s.formations.reduce((sum,unit)=>sum+(unit.trainingXp||0),0),1010)
  assert.equal(formation(s).assignedTroops,30)
  assert.deepEqual(normalizeSave(s),s)
})

test('本村分队训练时不跟随上级，完成后自动到上级的新驻地待命',()=>{
  const s=freshSave(),g=game(s)
  assert(setFormation(s,'platoon',30).ok);assert(stationTroops(s,1,[1]).ok)
  const branch=splitGarrisonUnit(s,1,'squad',7).unit
  assert(startTrainingTask(s,branch.id,1).ok)
  assert(recallGarrison(s,1,1).ok);assert(startMarch(s,'village',2,[1]).ok)
  advanceMarches(s,1000)
  assert.equal(marchOrigin(s,branch.id),1);assert.equal(formationActivity(s,branch.id),'training')
  g.updateLogistics(7,()=>1)
  assert.equal(formationActivity(s,branch.id),null);assert.equal(marchOrigin(s,branch.id),2)
  assert.deepEqual(s.garrisons[2],[1]);assert.equal(s.formations.length,2);assert.equal(branch.troops,7)
  assert.equal(marchOrigin(normalizeSave(s),branch.id),2)
})

test('10人排加三个10人分队占满40人，双方不能补兵，仍可换装和合回',()=>{
  const s=freshSave(),g=game(s),labels=[]
  g.ctx.fillText=value=>labels.push(String(value))
  assert(setFormation(s,'platoon',39).ok);assert(stationTroops(s,1,[1]).ok)
  const branches=Array.from({length:3},()=>splitGarrisonUnit(s,1,'squad',10).unit)
  assert(reinforceFormation(s,1,1).ok)
  assert.equal(s.formations[0].troops,10);assert.equal(formationOccupancy(s,1),40)
  for(const unit of s.formations){
    assert.equal(reinforcementCapacity(s,unit.id).capacity,0)
    assert.match(reinforceFormation(s,unit.id,1).message,/40 \/ 40/)
  }
  assert.equal(setFormation(s,'platoon',11,1).ok,false)
  g.editFormation(s.formations[0]);drawModal(g)
  assert(labels.some(value=>value.includes('本队 10 人 + 分队 30 人')&&value.includes('40 / 40')))
  click(g,'formation-plus');assert.match(g.formationError,/最多可补 0 人/)
  assert(reinforceFormation(s,1,0,{},10,true).ok)
  assert(rejoinFormation(s,branches[0].id).ok)
  assert.equal(s.formations[0].troops,20);assert.equal(formationOccupancy(s,1),40)
  assert.deepEqual(normalizeSave(s),s)
})

test('地区驻防的战损排可以从部队详情就地补员，采集期间仍受任务占用校验',()=>{
  const s=freshSave(),g=game(s),labels=[]
  const mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  g.ctx.fillText=value=>labels.push(String(value))
  assert(setFormation(s,'platoon',30).ok)
  const unit=s.formations[0]
  unit.troops=7;unit.weapons.rifle=7;unit.battleDamaged=true;unit.trainingXp=630
  assert(occupyRegion(s,mountain.id,[unit.id]).ok)
  assert.equal(formationActivity(s,unit.id),'region')
  assert.match(setFormation(s,'platoon',6,unit.id,{}).message,/撤回后才能改编或减员/)
  assert.match(setFormation(s,'squad',7,unit.id,{}).message,/撤回后才能改编或减员/)
  const before=formation(s).unassignedTroops
  g.openFormationChildren(unit);drawModal(g)
  assert(labels.some(label=>label.includes('地区驻防中：可就地补员')))
  tapButton(g,'formation-detail-edit');assert.equal(g.modal,'formation-edit');drawModal(g)
  g.setFormationReinforcements(34);assert.match(g.formationError,/最多可补 33 人/)
  g.setFormationReinforcements(3);drawModal(g);tapButton(g,'formation-save')
  assert.equal(g.modal,'formation-detail');assert.equal(unit.troops,10);assert.equal(unit.trainingXp,630)
  assert.equal(formation(s).unassignedTroops,before-3);assert.equal(s.troops,120)
  assert.deepEqual(regionRecord(s,mountain.id).garrisonIds,[unit.id])
  const restored=normalizeSave(g.saved)
  assert.equal(regionUnits(restored,mountain.id)[0].troops,10)
  assert(startGathering(s,mountain.id,[unit.id],'ore').ok)
  assert.equal(reinforceFormation(s,unit.id,1).ok,false)
})

test('多级分队算入各自上级上限，分队解散后释放相同名额',()=>{
  const s=freshSave();s.troops=200;s.weaponCounts.rifle=200
  assert(setFormation(s,'company',149).ok);assert(stationTroops(s,1,[1]).ok)
  const platoon=splitGarrisonUnit(s,1,'platoon',30).unit;assert(stationTroops(s,1,[platoon.id]).ok)
  const squad=splitGarrisonUnit(s,platoon.id,'squad',10).unit
  assert(reinforceFormation(s,squad.id,1).ok)
  assert.equal(formationOccupancy(s,platoon.id),31);assert.equal(formationOccupancy(s,1),150)
  for(const unit of [s.formations[0],platoon,squad])assert.equal(reinforcementCapacity(s,unit.id).capacity,0)
  assert(removeFormation(s,squad.id))
  assert.equal(formationOccupancy(s,1),139);assert.equal(reinforcementCapacity(s,1).capacity,11)
  assert(reinforceFormation(s,1,11).ok);assert.equal(formationOccupancy(s,1),150)
})

test('三合一组建上级时同时检查继承的分队人数',()=>{
  const s=freshSave();s.troops=8000;s.weaponCounts.rifle=8000
  for(let i=0;i<3;i++)assert(setFormation(s,'regiment',2100).ok)
  assert(stationTroops(s,1,[1]).ok);assert(splitGarrisonUnit(s,1,'battalion',400).ok);assert(recallGarrison(s,1,1).ok)
  assert.equal(s.formations.slice(0,3).reduce((sum,unit)=>sum+unit.troops,0),5900)
  assert.match(mergeFormations(s,[1,2,3]).message,/6300 人，超过旅的 6000 人上限/)
})

test('敌袭只选有驻军的驻地，每处一条，上限三条，刷新保留警报',()=>{
  const s=setup(),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert.equal(advanceRaids(s,RAID_INTERVAL,()=>0).alert,null)
  assert(stationTroops(s,1,[1]).ok);assert(stationTroops(s,2,[2]).ok);assert(stationTroops(s,3,[3]).ok)
  assert(occupyRegion(s,mountain.id,[4]).ok)
  assert.equal(advanceRaids(s,170,()=>0).alert,null)
  assert.equal(advanceRaids(s,1,()=>0).alert.siteId,1)
  assert.equal(advanceRaids(s,RAID_INTERVAL,()=>.99).alert.siteId,mountain.id)
  assert.equal(advanceRaids(s,RAID_INTERVAL,()=>0).alert.siteId,2)
  assert.equal(advanceRaids(s,RAID_INTERVAL,()=>0).alert,null)
  assert.deepEqual(normalizeSave(s).raidAlerts,s.raidAlerts)
  assert(recallGarrison(s,1,1).ok)
  assert.equal(advanceRaids(s,1,()=>0).changed,true)
  assert.deepEqual(s.raidAlerts.map(alert=>alert.siteId),[mountain.id,2])
})

test('一处、五处及十七处驻地分别每五分钟、两分半和一分钟遇袭',()=>{
  const baseline=freshSave()
  const sites=ALL_VILLAGES.filter(village=>regionEnemyTroops(baseline,village.regionId??village.id)===0).slice(0,17)
  for(const [count,interval] of [[1,300],[5,150],[17,60]]){
    const s=freshSave()
    for(const [index,site] of sites.slice(0,count).entries()){
      assert(setFormation(s,'squad',7).ok)
      assert(stationTroops(s,site.id,[index+1]).ok)
    }
    assert.equal(advanceRaids(s,interval-1,()=>0).alert,null)
    const alert=advanceRaids(s,1,()=>0).alert
    assert.equal(alert.siteId,sites[0].id)
  }
})

test('大型驻地按驻守人数匹配来袭，完整保存兵力而不被120人上限截断',()=>{
  const s=freshSave();s.troops=500;s.weaponCounts.rifle=500
  assert(setFormation(s,'battalion',500).ok);assert(stationTroops(s,1,[1]).ok)
  for(const [random,force] of [[0,450],[.5,500],[.99,549]]){
    const next=structuredClone(s),alert=advanceRaids(next,RAID_INTERVAL,()=>random).alert
    assert.equal(alert.force,force)
    const loaded=normalizeSave(next)
    assert.equal(loaded.raidAlerts[0].force,force)
    const battle=makeRaidBattle(raidDeployment(loaded,alert.id),loaded)
    assert(battle.regionEnemyQueue.length<=8)
    assert.equal(battle.regionEnemyQueue.reduce((count,unit)=>count+unit.troops,0),force)
  }
})

test('敌袭从敌占据点沿道路行军，显示来源和兵力，抵达后在目标显示交战标记',()=>{
  const g=game(),s=g.save,labels=[]
  g.ctx.fillText=value=>labels.push(value)
  const drawMap=()=>{labels.length=0;g.buttons=[];g.drawWorldMap()}
  assert(stationTroops(s,1,[1,2]).ok)
  g.updateLogistics(RAID_INTERVAL,()=>0)
  const alert=s.raidAlerts[0],origin=raidOrigin(alert),destination=mapLocation(alert.siteId),start=raidMarch(alert)
  assert(regionEnemyTroops(s,origin.id)>0)
  assert.deepEqual(start.position,{x:origin.x,y:origin.y});assert.deepEqual(start.route.at(-1),{x:destination.x,y:destination.y})
  assert(start.route.length>2)
  assert(g.message.includes(origin.name)&&g.message.includes(`${alert.force} 人`))

  g.openWorldMap();g.openRaid(alert.id);drawModal(g);tapButton(g,'raid-route')
  assert.equal(g.modal,null)
  drawMap();assert(labels.includes(`敌军 ${alert.force} 人`)&&labels.includes(`来自${origin.name}`))
  const markerId='map-raid-'+alert.id,first=g.buttons.find(button=>button.id===markerId)
  assert(first)
  g.updateLogistics(RAID_TRAVEL_SECONDS/2,()=>0);drawMap()
  const middle=raidMarch(alert),moved=g.buttons.find(button=>button.id===markerId)
  assert.notDeepEqual(middle.position,start.position)
  assert(moved&&(moved.x!==first.x||moved.y!==first.y))
  assert.deepEqual(raidMarch(normalizeSave(s).raidAlerts[0]).position,middle.position)
  g.updateLogistics(RAID_TRAVEL_SECONDS/2,()=>0);drawMap()
  assert.equal(raidMarch(alert),null)
  assert(!labels.includes(`敌军 ${alert.force} 人`));assert(labels.includes('交战中'))
  const last=g.buttons.find(button=>button.id===markerId),targetScreen=mapToScreen(g.mapCamera,destination)
  assert.equal(last.y,targetScreen.y-35)
  tapButton(g,markerId);assert.equal(g.modal,'raid');drawModal(g)
  assert(!g.buttons.some(button=>button.id==='raid-route'))
  g.updateLogistics(RAID_RESPONSE_WINDOW-RAID_TRAVEL_SECONDS,()=>0);g.openWorldMap();drawMap()
  assert(!g.buttons.some(button=>button.id===markerId));assert.equal(s.raidReports[0].originId,origin.id)
})

test('地图上没有敌占据点时不生成来袭，旧警报会补充现存的敌军来源',()=>{
  const s=setup()
  assert(stationTroops(s,1,[1]).ok)
  s.raidAlerts=[{id:1,siteId:1,force:10,responseSeconds:18}]
  const loaded=normalizeSave(s),origin=raidOrigin(loaded.raidAlerts[0])
  assert(regionEnemyTroops(loaded,origin.id)>0)
  loaded.mapRegions[origin.id].enemies=[]
  assert.equal(normalizeSave(loaded).raidAlerts[0].originId,origin.id)
  s.raidAlerts=[]
  for(const record of Object.values(s.mapRegions))record.enemies=[]
  assert.equal(advanceRaids(s,RAID_INTERVAL,()=>0).alert,null)
})

test('左侧警报可接管本村全员防守，未配枪士兵和参训部队都能出战',()=>{
  const g=game(),s=g.save
  assert(stationTroops(s,1,[1,2,3]).ok);assert(stationTroops(s,2,[4]).ok)
  s.formations[1].weapons.rifle=0
  assert(startTrainingTask(s,3,1).ok)
  s.villageTrainingTasks[1].elapsed=2
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  assert.deepEqual(raidDeployment(s,alert.id).units.map(unit=>unit.id),[1,2,3])
  g.openWorldMap();g.drawWorldMap()
  tapButton(g,'raid-alert-'+alert.id)
  assert.equal(g.modal,'raid');drawModal(g);tapButton(g,'raid-manual')
  const b=g.battle
  assert.equal(g.scene,'battle');assert.equal(b.raidId,alert.id)
  assert.deepEqual(b.units.map(unit=>unit.id),[1,2,3])
  assert.equal(b.maxHp,30);assert.equal(b.armedTroops,20)
  assert.equal(formationActivity(s,1),'battle')
  assert.equal(formationActivity(s,2),'battle');assert.equal(formationActivity(s,3),'battle');assert.equal(formationActivity(s,4),'garrison')
  g.updateLogistics(RAID_RESPONSE_WINDOW+1,()=>0)
  assert.equal(s.villageTrainingTasks[1].elapsed,2)
  assert.equal(s.raidAlerts[0].responseSeconds,RAID_RESPONSE_WINDOW);assert.deepEqual(s.raidReports,[])
  assert.equal(g.battle,b);assert.equal(g.modal,null)
  b.units[0].hp=7;b.units[1].hp=6;b.done=true;b.won=true;g.finish()
  assert.equal(g.result.lostTroops,7);assert.equal(s.formations[0].weapons.rifle,7)
  assert.equal(s.formations[1].troops,6);assert.equal(s.weaponCounts.rifle,117)
  assert.equal(s.stage,1);assert.deepEqual(s.raidAlerts,[]);assert.deepEqual(s.garrisons[1],[1,2,3])
  assert.equal(formationActivity(s,1),'garrison')
  const settled=structuredClone(s);g.finish();assert.deepEqual(s,settled)
  g.updateLogistics(1,()=>0);assert.equal(s.villageTrainingTasks[1].elapsed,3)
  drawModal(g);tapButton(g,'next');assert.equal(g.modal,'village');assert.equal(g.villageId,1)
})

test('警报列表右侧按钮可收起并拉出，收起后原区域恢复地图点击',()=>{
  const g=game(),s=g.save
  assert(stationTroops(s,1,[1]).ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  const alertId='raid-alert-'+alert.id,toggleId='raid-alert-toggle'
  let mapClicks=0
  const draw=()=>{
    g.buttons=[{id:'map-region-under-alerts',x:90,y:286,w:40,h:25,fn:()=>mapClicks++}]
    g.drawWorldMap()
  }
  g.openWorldMap();draw()
  assert(g.buttons.find(button=>button.id===toggleId).x>g.raidPanelBounds.x+g.raidPanelBounds.w)
  tap(g,110,297);assert.equal(mapClicks,0)
  tapButton(g,toggleId);draw()
  assert.equal(g.raidPanelBounds,null)
  assert(!g.buttons.some(button=>button.id===alertId))
  tap(g,110,297);assert.equal(mapClicks,1)
  tapButton(g,toggleId);draw()
  tapButton(g,alertId);assert.equal(g.modal,'raid');assert.deepEqual(s.raidAlerts,[alert])
})

test('敌袭默认倒计时并自动结算，手枪驻军可应敌，战报可回看且不会切换场景',()=>{
  const g=game(),s=g.save,mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  s.formations[0].weapons.rifle=0;s.formations[0].weapons.pistol=10;s.weaponCounts.pistol=10
  s.bullets=500
  assert(occupyRegion(s,mountain.id,[1]).ok)
  g.updateLogistics(RAID_INTERVAL,()=>0)
  assert.match(g.message,RegExp(mountain.name+'遭到敌袭'))
  const alert=s.raidAlerts[0];assert.deepEqual(g.saved.raidAlerts,[alert])
  const simulated=makeRaidBattle(raidDeployment(s,alert.id),structuredClone(s));resolveRaidAutomatically(simulated)
  assert(simulated.units[0].x>340);assert(simulated.time<180)
  g.updateLogistics(RAID_RESPONSE_WINDOW-1,()=>0)
  assert.equal(alert.responseSeconds,1);assert.deepEqual(s.raidReports,[])
  assert.equal(normalizeSave(s).raidAlerts[0].responseSeconds,1)
  const legacy=structuredClone(s);delete legacy.raidAlerts[0].responseSeconds
  assert.equal(normalizeSave(legacy).raidAlerts[0].responseSeconds,RAID_RESPONSE_WINDOW)
  g.updateLogistics(1,()=>0)
  assert(!g.battle);assert.equal(g.scene,'world-map');assert.equal(g.modal,null)
  assert.deepEqual(s.raidAlerts,[]);assert.equal(s.stage,1)
  assert.equal(s.raidReports[0].id,alert.id);assert.notEqual(s.raidReports[0].outcome,'undefended')
  assert(!Object.hasOwn(s.raidReports[0],'xp'))
  assert(s.bullets<500);assert.equal(g.saved.bullets,s.bullets)
  assert.deepEqual(normalizeSave(s).raidReports,s.raidReports)
  const after=structuredClone(s);g.updateLogistics(1,()=>0)
  for(const key of ['troops','weaponCounts','raidReports','coins'])assert.deepEqual(s[key],after[key])
  g.openWorldMap();g.drawWorldMap();tapButton(g,'raid-alert-'+alert.id)
  assert.equal(g.modal,'raid');drawModal(g)
  assert(!g.buttons.some(button=>button.id==='raid-manual'));tapButton(g,'raid-back');assert.equal(g.modal,null)
})

test('驻地无弹和无枪都能自动近战，伤亡比有弹防守更大',t=>{
  t.mock.method(Math,'random',()=>.5)
  const g=game(),s=g.save,mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  s.bullets=2000;assert(occupyRegion(s,mountain.id,[1]).ok)
  g.updateLogistics(RAID_INTERVAL,()=>0)
  const alert=s.raidAlerts[0],dry=structuredClone(s),unarmed=structuredClone(s)
  dry.bullets=0;unarmed.formations[0].weapons.rifle=0
  const supplied=autoDefendRaid(s,alert.id),noAmmo=autoDefendRaid(dry,alert.id),noGuns=autoDefendRaid(unarmed,alert.id)
  assert.equal(supplied.outcome,'won');assert(s.bullets<2000)
  assert.equal(noAmmo.deployedTroops,10);assert.equal(noGuns.deployedTroops,10)
  assert.notEqual(noAmmo.outcome,'undefended');assert.notEqual(noGuns.outcome,'undefended')
  assert(noAmmo.lostTroops>supplied.lostTroops);assert.equal(noGuns.lostTroops,noAmmo.lostTroops)
  assert.equal(dry.bullets,0);assert.equal(unarmed.bullets,2000)
})

test('两支有弹的10人班挡住18名来敌时，接近的兵力带来明显战损',t=>{
  t.mock.method(Math,'random',()=>.5)
  const s=setup();s.bullets=2000
  assert(stationTroops(s,1,[1,2]).ok)
  s.raidAlerts=[{id:1,siteId:1,force:18,responseSeconds:0}]
  const report=autoDefendRaid(s,1)
  assert.equal(report.outcome,'won')
  assert.equal(report.deployedTroops,20)
  assert.equal(report.kills,18)
  assert(report.lostTroops>=6)
  assert.equal(s.bullets,1982)
  assert(!Object.hasOwn(report,'woundedLight'))
})

test('山地遇袭时30人驻防和150人采集一起应敌，守住后幸存人员继续原进度',t=>{
  t.mock.method(Math,'random',()=>.5)
  const s=freshSave(),g=game(s),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  s.troops=180;s.weaponCounts.rifle=180;s.bullets=2000;s.cookedRice=100
  assert(setFormation(s,'platoon',30).ok);assert(setFormation(s,'company',150).ok)
  assert(occupyRegion(s,mountain.id,[1,2]).ok)
  assert(startGathering(s,mountain.id,[2],'ore').ok)
  const task=s.gatheringTasks[mountain.id].ore
  task.elapsed=20
  const alert=advanceRaids(s,RAID_INTERVAL,()=>.5).alert
  assert.equal(alert.force,180)
  assert.deepEqual(raidDeployment(s,alert.id).units.map(unit=>[unit.id,unit.troops]),[[1,30],[2,150]])
  const automatic=structuredClone(s)
  const report=autoDefendRaid(automatic,alert.id)
  assert.equal(report.deployedTroops,180)
  assert.equal(report.outcome,'won')
  assert.equal(automatic.gatheringTasks[mountain.id].ore.elapsed,20)
  g.beginRaid(alert.id);assert.equal(g.battle.maxHp,180)
  assert.equal(formationActivity(s,2),'battle')
  g.updateLogistics(50,()=>0);assert.equal(task.elapsed,20);assert.equal(s.materials.ore,0)
  g.battle.units[1].hp=120;g.battle.done=true;g.battle.won=true;g.finish()
  assert.equal(formationActivity(s,2),'gathering');assert.equal(task.workers,120)
  assert.deepEqual(normalizeSave(s).gatheringTasks,s.gatheringTasks)
  g.updateLogistics(40,()=>0);assert.equal(s.materials.ore,120);assert.equal(task.elapsed,0)
})

test('驻防主队阵亡时，守住据点的采集分队继续采集并保留我方控制',()=>{
  const s=freshSave(),g=game(s),mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert(setFormation(s,'platoon',40).ok);assert(occupyRegion(s,mountain.id,[1]).ok)
  const branch=splitGarrisonUnit(s,1,'squad',10).unit
  assert(startGathering(s,mountain.id,[branch.id],'ore').ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>.5).alert
  g.beginRaid(alert.id);assert.equal(g.battle.maxHp,40)
  g.battle.units[0].hp=0;g.battle.done=true;g.battle.won=true;g.finish()
  assert.equal(regionOwner(s,mountain.id),'player')
  assert.deepEqual(regionUnits(s,mountain.id).map(unit=>unit.id),[branch.id])
  assert.equal(s.gatheringTasks[mountain.id].ore.workers,10)
  assert.deepEqual(normalizeSave(s),s)
})

test('自动应敌可在玩家指挥另一场战斗时结算，保留原战斗状态与未结伤亡',()=>{
  const g=game(),s=g.save
  assert(stationTroops(s,1,[1]).ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  g.beginRegionBattle(enemy.id,[2,3]);const battle=g.battle
  battle.units[0].hp=0;g.updateBattle(.05)
  const losses=battle.lostTroops;assert.equal(losses,10)
  g.updateLogistics(RAID_RESPONSE_WINDOW,()=>0)
  assert.equal(g.battle,battle);assert.equal(g.scene,'battle');assert.equal(g.modal,null)
  assert.equal(battle.lostTroops,losses)
  assert.equal(formationActivity(s,3),'battle');assert.equal(s.raidReports[0].id,alert.id)
})

test('结算后的战报统一在10秒后移出左侧列表，刷新不延长并清理旧的失败战报',t=>{
  let now=Date.now()
  t.mock.method(Date,'now',()=>now);t.mock.method(Math,'random',()=>.5)
  const s=freshSave(),g=game(s)
  s.troops=150;s.weaponCounts.rifle=150;s.bullets=20000;s.cookedRice=100
  assert(setFormation(s,'company',150).ok);assert(stationTroops(s,1,[1]).ok)
  g.updateLogistics(RAID_INTERVAL,()=>0);g.updateLogistics(RAID_RESPONSE_WINDOW,()=>0)
  const won=s.raidReports[0]
  assert.equal(won.outcome,'won');assert.equal(won.expiresAt,now+10000)
  const lost={...won,id:2,outcome:'lost'},legacy={...lost,id:3};delete legacy.expiresAt
  s.raidReports.push(lost)
  assert.deepEqual(normalizeSave({...s,raidReports:[legacy,won,lost]}).raidReports,[won,lost])
  g.openWorldMap();g.openRaid(lost.id);drawModal(g)
  now+=9999;g.updateLogistics(.1,()=>0)
  assert.deepEqual(s.raidReports.map(report=>report.id),[won.id,lost.id])
  assert.equal(normalizeSave(s).raidReports[0].expiresAt,won.expiresAt)
  now+=1;g.updateLogistics(.1,()=>0)
  assert.deepEqual(s.raidReports,[]);assert.deepEqual(g.saved.raidReports,[])
  assert.deepEqual(normalizeSave({...s,raidReports:[won,lost]}).raidReports,[])
  drawModal(g);tapButton(g,'raid-back')
  g.buttons=[];g.drawWorldMap()
  assert(!g.buttons.some(button=>button.id==='raid-alert-'+won.id))
  assert(!g.buttons.some(button=>button.id==='raid-alert-'+lost.id))
})

test('驻军全员在兵工厂工作时村庄失守，人员撤离停工，设施建筑可在夺回后使用',()=>{
  const g=game(),s=g.save
  assert(stationTroops(s,1,[1]).ok)
  assert(placeVillageFacility(s,'armory',1).ok);assert(startProduction(s,[1],'rifle',1).ok)
  g.updateLogistics(RAID_INTERVAL,()=>0);g.updateLogistics(RAID_RESPONSE_WINDOW,()=>0)
  assert.deepEqual(s.raidAlerts,[]);assert.equal(s.raidReports[0].outcome,'undefended')
  assert.equal(s.raidReports[0].deployedTroops,0);assert(s.raidReports[0].occupied)
  assert(s.raidReports[0].expiresAt>Date.now())
  assert.deepEqual(s.armoryTasks,{});assert.equal(s.facilityVillages.armory,1)
  assert.equal(formationActivity(s,1),null);assert.equal(regionOwner(s,1),'enemy')
  assert.equal(regionEnemyTroops(s,1),s.raidReports[0].force)
  assert.equal(s.troops,120);assert.equal(s.weaponCounts.rifle,120)
  assert.deepEqual(normalizeSave(s),s)
})

test('村庄自动应敌同时调动排和缺枪的连，只排除兵工厂的实际在岗人数',t=>{
  t.mock.method(Math,'random',()=>.5)
  const s=freshSave(),g=game(s)
  s.troops=150;s.bullets=20000;s.cookedRice=100
  assert(setFormation(s,'platoon',30).ok)
  assert(setFormation(s,'company',100,null,{rifle:20}).ok)
  assert(stationTroops(s,1,[1,2]).ok);assert(placeVillageFacility(s,'armory',1).ok)
  const allocation=[{unitId:2,troops:10,type:'group'}]
  const task=startProduction(s,[2],'rifle',1,allocation)
  assert(task.ok,task.message)
  g.updateLogistics(RAID_INTERVAL,()=>0)
  const alert=s.raidAlerts[0],deployment=raidDeployment(s,alert.id)
  assert.deepEqual(deployment.units.map(unit=>[unit.id,unit.troops]),[[1,30],[2,90]])
  assert.equal(deployment.unarmedTroops,70)
  g.updateLogistics(RAID_RESPONSE_WINDOW,()=>0)
  assert.equal(s.raidReports[0].deployedTroops,120)
  assert.equal(s.raidReports[0].unarmedTroops,70)
  assert.equal(s.formations.find(unit=>unit.id===2).troops>=10,true)
  const staffed=s.armoryTasks.rifle
  if(s.raidReports[0].occupied)assert(!staffed)
  else assert.equal(staffed.workers,10)
  assert.deepEqual(normalizeSave(s).raidReports,s.raidReports)
})

test('本村待命分队与上级一起防守，外出代耕人员避开战损并在失守后撤回',()=>{
  const s=freshSave(),g=game(s)
  assert(setFormation(s,'platoon',40).ok);assert(stationTroops(s,1,[1]).ok)
  assert(placeVillageFacility(s,'armory',1).ok)
  const branch=splitGarrisonUnit(s,1,'squad',10).unit
  const field=MAP_FIELDS.find(field=>field.villageId===1)
  assert(startFarming(s,'help',7,field.crop,[1],field.id,[{unitId:1,troops:7,type:'group'}]).ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  g.beginRaid(alert.id);const b=g.battle
  assert.deepEqual(b.units.map(unit=>[unit.id,unit.maxHp]),[[1,23],[branch.id,10]])
  assert.equal(farmTaskAt(s,field.id).workers,7)
  const second=startProduction(s,[1],'rifle',1,[{unitId:1,troops:7,type:'group'}])
  assert.match(second.message,/可派人数不足/)
  for(const unit of b.units)unit.hp=0
  b.done=true;b.won=false;g.finish()
  assert.equal(g.result.lostTroops,33);assert.equal(s.weaponCounts.rifle,87)
  assert.equal(s.formations.find(unit=>unit.id===1).troops,7);assert.equal(farmTaskAt(s,field.id),null)
  assert.equal(formationActivity(s,1),null);assert.equal(regionOwner(s,1),'enemy')
})

test('驻军全灭扣兵扣枪且不产生伤员，清除据点驻防',()=>{
  const g=game(),s=g.save,mountain=MAP_REGIONS.find(site=>site.type==='mountain'&&!site.enemyTroops)
  assert(occupyRegion(s,mountain.id,[1]).ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  g.beginRaid(alert.id)
  const b=g.battle;b.units[0].hp=0;b.done=true;b.won=false;g.finish()
  assert.equal(g.result.lostTroops,10)
  assert.equal(s.troops,110);assert.equal(s.weaponCounts.rifle,110)
  assert.deepEqual(s.raidAlerts,[]);assert.deepEqual(regionRecord(s,mountain.id).garrisonIds,[])
  assert.equal(regionOwner(s,mountain.id),'enemy');assert.equal(regionEnemyTroops(s,mountain.id),alert.force)
})

test('原排与一个分队同时阵亡时，仍在别村生产的2班继承1排，保留任务和实际兵力',()=>{
  const s=freshSave(),g=game(s),labels=[]
  assert(setFormation(s,'platoon',40).ok);assert(stationTroops(s,1,[1]).ok)
  const fallen=splitGarrisonUnit(s,1,'squad',10).unit,survivor=splitGarrisonUnit(s,1,'squad',10).unit
  assert.equal(formationName(survivor),'1排-2班');survivor.trainingXp=460
  assert(stationTroops(s,1,[fallen.id]).ok);assert(stationTroops(s,2,[survivor.id]).ok)
  assert(placeVillageFacility(s,'armory',2).ok);assert(startProduction(s,[survivor.id],'rifle',2).ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  g.beginRaid(alert.id);const battle=g.battle
  assert.deepEqual(battle.units.map(unit=>unit.id),[1,fallen.id])
  for(const actor of battle.units)actor.hp=0
  g.updateBattle(.05)
  assert.equal(g.result.lostTroops,30);assert.equal(s.troops,90);assert.equal(s.weaponCounts.rifle,90)
  assert.deepEqual(s.formations.map(unit=>unit.id),[survivor.id]);assert.equal(formationName(survivor),'1排')
  assert.equal(survivor.type,'platoon');assert.equal(survivor.troops,10);assert.equal(survivor.weapons.rifle,10);assert.equal(survivor.trainingXp,460)
  assert.equal(survivor.splitParent,undefined);assert.deepEqual(s.garrisons[2],[survivor.id]);assert.deepEqual(s.armoryTasks.rifle.unitIds,[survivor.id])
  g.save=normalizeSave(s);assert.deepEqual(g.save,s)
  g.home();g.openFormationList('platoon');g.ctx.fillText=value=>labels.push(String(value));drawModal(g)
  assert(labels.includes('1排'));assert(!labels.includes('1排-2班'))
})

test('原编制阵亡而多个分队存活时，只继承一个番号，其余分队归到新上级',()=>{
  const s=freshSave(),g=game(s)
  assert(setFormation(s,'platoon',30).ok);assert(stationTroops(s,1,[1]).ok)
  const first=splitGarrisonUnit(s,1,'squad',7).unit,second=splitGarrisonUnit(s,1,'squad',8).unit
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  g.beginRaid(alert.id);const battle=g.battle
  battle.units[0].hp=0;g.updateBattle(.05)
  assert.equal(battle.done,false);assert.equal(formationName(first),'1排');assert.equal(first.troops,7)
  assert.equal(battle.units.find(unit=>unit.id===first.id).name,'1排')
  assert.equal(second.splitParent,first.id);assert.equal(formationName(second),'1排-2班');assert.equal(formationOccupancy(s,first.id),15)
})

test('内圈村庄手动防守失败由剩余敌军占领，蓝旗可见，刷新后仍可按原流程夺回',()=>{
  const g=game(),s=g.save,village=MAP_SITES[0],painted=[]
  g.ctx.fill=()=>painted.push(g.ctx.fillStyle)
  assert(stationTroops(s,village.id,[1]).ok)
  assert(startMarch(s,'village',village.id,[3]).ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  g.beginRaid(alert.id);const b=g.battle
  b.update(1.1);b.enemies[0].hp=3.2;b.units[0].hp=6
  g.open('retreat');drawModal(g);tapButton(g,'confirm-retreat')
  assert.equal(g.result.raid.occupied,true);assert.equal(regionEnemyTroops(s,village.id),4)
  assert.equal(formationActivity(s,1),null);assert.equal(formationActivity(s,3),null)
  assert.equal(s.formations[0].troops,6);assert.equal(s.garrisons[village.id],undefined)
  assert.equal(stationTroops(s,village.id,[2]).ok,false)
  g.save=normalizeSave(g.saved);assert.equal(regionOwner(g.save,village.id),'enemy')
  g.home();focusCamera(g.mapCamera,village);g.buttons=[];g.drawWorldMap()
  assert(painted.includes(MAP_FLAG_COLORS.enemy));assert(g.buttons.find(button=>button.id==='map-site-'+village.id).flagHit)
  tapButton(g,'map-site-'+village.id);assert.equal(g.modal,'region');drawModal(g)
  tapButton(g,'region-dispatch');assert.equal(g.modal,'campaign-deploy');drawModal(g)
  tapButton(g,'deployment-unit-2');drawModal(g);tapButton(g,'deployment-confirm')
  g.updateMapMarches(1000);assert.equal(g.battle.regionId,village.id);assert.equal(g.battle.pending,1)
  for(let i=0;i<20&&!g.battle.done;i++){for(const unit of g.battle.enemies)unit.hp=0;g.battle.update(.5)}
  assert(g.battle.won);g.finish()
  assert.equal(regionOwner(g.save,village.id),'player');assert.deepEqual(g.save.garrisons[village.id],[2])
  assert.equal(regionOwner(normalizeSave(g.save),village.id),'player')
})

test('自动防守战败后，来袭部队占领原据点并保存实际剩余守军',()=>{
  const g=game(),s=g.save
  assert(stationTroops(s,1,[1]).ok);s.formations[0].weapons.rifle=0
  g.updateLogistics(RAID_INTERVAL,()=>0);g.updateLogistics(RAID_RESPONSE_WINDOW,()=>0)
  const report=s.raidReports[0]
  assert.equal(report.outcome,'lost');assert.equal(report.occupied,true)
  assert(report.expiresAt>Date.now())
  assert.equal(report.enemyTroops,report.force);assert.equal(regionOwner(s,1),'enemy')
  assert.equal(g.scene,'world-map');assert.match(g.message,/敌军占领/)
  assert.deepEqual(normalizeSave(s),s)
})

test('城池失守时保存敌军守备编制与实际存活人数',()=>{
  const g=game(),s=g.save,city=MAP_CITIES[0]
  regionRecord(s,city.id).enemies=[]
  assert(occupyRegion(s,city.id,[1]).ok)
  const alert=advanceRaids(s,RAID_INTERVAL,()=>0).alert
  g.beginRaid(alert.id);g.battle.units[0].hp=0;g.battle.done=true;g.finish()
  const loaded=normalizeSave(s)
  assert.equal(regionOwner(loaded,city.id),'enemy')
  assert.equal(regionRecord(loaded,city.id).enemies[0].type,'regiment')
  assert.equal(regionEnemyTroops(loaded,city.id),alert.force)
})
