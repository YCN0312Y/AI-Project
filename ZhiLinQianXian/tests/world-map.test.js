import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {Game} from '../js/game.js'
import {controlRegionGeometry,regionBoundary,regionContains} from '../js/control-regions.js'
import {stationTroops,recallGarrison,villageLocalUnits,villageControlled} from '../js/villages.js'
import {freshSave,normalizeSave,chooseStartingBase,relocateBase,setFormation,baseForces,formation,splitGarrisonUnit} from '../js/state.js'
import {startMarch,advanceMarches,marchPosition} from '../js/marching.js'
import {farmTaskAt,startFarming,formationActivity} from '../js/base.js'
import {campaignDeployment} from '../js/campaign.js'
import {regionEnemyTroops} from '../js/regions.js'
import {MAP_VIEW,MAP_SIZE,MAP_CORE,MAP_BOUNDS,MAP_BASE,MAP_SITES,ALL_VILLAGES,REGION_VILLAGES,MAP_FIELDS,MAP_ROADS,REGION_ZOOM,MIN_ZOOM,MAX_ZOOM,mapBase,mapRegion,createCamera,mapToScreen,screenToMap,zoomCamera,panCamera,fitCamera,focusCamera} from '../js/world-map.js'

const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`)
function game(scale=1){
  const g=Object.create(Game.prototype)
  Object.assign(g,{save:freshSave(),scene:'lobby',modal:null,buttons:[],scale,ox:12,oy:7,persist(){},notify(message){this.message=message}})
  g.ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})
  return g
}
const draw=g=>{g.buttons=[];g.drawWorldMap()}
const click=(g,id)=>{const b=g.buttons.find(b=>b.id===id);assert(b,id);b.fn();g.dirty=true}
const point=(g,x,y)=>({clientX:g.ox+x*g.scale,clientY:g.oy+y*g.scale})
const touch=(g,...points)=>({touches:points.map(([x,y])=>point(g,x,y))})
const lift=(g,x,y)=>({touches:[],changedTouches:[point(g,x,y)]})

test('柳树村设为根据地后，枣林村与白杨村的驻军范围沿实际乡道相连',()=>{
  const home=mapBase({baseVillageId:1}),controlled=[home,MAP_SITES[4],MAP_SITES[5]],geometry=controlRegionGeometry(controlled)
  const contains=p=>geometry.polygons.some(poly=>regionContains(poly,p))
  assert.equal(geometry.links.length,2)
  for(const link of geometry.links){
    const road=MAP_ROADS.find(r=>r.from===link.from&&r.to===link.to),a=controlled.find(s=>(s.roadId??s.id)===road.from),b=controlled.find(s=>(s.roadId??s.id)===road.to)
    const [x1,y1,x2,y2]=road.controls
    for(let i=0;i<=100;i++){
      const t=i/100,u=1-t
      assert(contains({x:u*u*u*a.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*b.y}),'道路红色区域不能断开')
    }
  }
  for(const site of MAP_SITES.filter(s=>![1,5,6].includes(s.id)))assert.equal(contains(site),false,site.name)
  assert.equal(contains(MAP_BASE),false)
  assert.equal(controlRegionGeometry([home]).links.length,0)
})

test('每个驻军村庄的所属田块完整纳入红色范围，田块与村庄连成一片',()=>{
  for(const village of MAP_SITES){
    const geometry=controlRegionGeometry([MAP_BASE,village]),contains=p=>geometry.polygons.some(poly=>regionContains(poly,p))
    for(const field of MAP_FIELDS.filter(f=>f.villageId===village.id)){
      for(const dx of [-1,1])for(const dy of [-1,1])assert(contains({x:field.x+dx*(field.w/2+25),y:field.y+dy*(field.h/2+25)}),village.name+'田块及周围应在界内')
      for(let i=0;i<=20;i++)assert(contains({x:village.x+(field.x-village.x)*i/20,y:village.y+(field.y-village.y)*i/20}),'村庄至田块不能断开')
    }
    for(const neutral of MAP_SITES.filter(s=>s.id!==village.id))assert.equal(contains(neutral),false,neutral.name+'未驻军，不应被周边田块区域覆盖')
  }
  const homeOnly=controlRegionGeometry([MAP_BASE])
  for(const field of MAP_FIELDS)assert.equal(homeOnly.polygons.some(poly=>regionContains(poly,field)),field.villageId===MAP_BASE.villageId)
})

test('中间未驻军或非我方建筑会阻断红色连通，驻军后才能接通',()=>{
  const base={id:'base',type:'base',x:0,y:0},middle={id:1,type:'village',x:700,y:0},end={id:2,type:'village',x:1400,y:0}
  const roads=[{from:'base',to:2,controls:[450,0,950,0]}],landmarks=[base,middle,end]
  const blocked=controlRegionGeometry([base,end],roads,landmarks)
  assert.equal(blocked.links.length,0);assert.equal(blocked.polygons.some(poly=>regionContains(poly,middle)),false)
  assert.equal(controlRegionGeometry([base,middle,end],roads,landmarks).links.length,1)
  const chain=[{from:'base',to:1,controls:[200,0,500,0]},{from:1,to:2,controls:[900,0,1200,0]}]
  assert.equal(controlRegionGeometry([base,end],chain,landmarks).links.length,0)
  assert.equal(controlRegionGeometry([base,middle,end],chain,landmarks).links.length,2)
})

test('只合并被包围的安全空地，包围圈中的未驻军村庄保持独立',()=>{
  const sites=[{id:'base',type:'base',x:0,y:0},{id:1,type:'village',x:3000,y:0},{id:2,type:'village',x:3000,y:3000},{id:3,type:'village',x:0,y:3000}]
  const middle={id:4,type:'village',x:1500,y:1500}
  const roads=sites.map((a,i)=>{const b=sites[(i+1)%sites.length];return {from:a.id,to:b.id,controls:[a.x+(b.x-a.x)/3,a.y+(b.y-a.y)/3,a.x+(b.x-a.x)*2/3,a.y+(b.y-a.y)*2/3]}})
  const safe=controlRegionGeometry(sites,roads,sites),blocked=controlRegionGeometry(sites,roads,[...sites,middle])
  assert.equal(safe.links.length,4);assert.equal(blocked.links.length,4)
  assert(safe.polygons.some(poly=>regionContains(poly,middle)))
  assert.equal(blocked.polygons.some(poly=>regionContains(poly,middle)),false)
})

test('区域并集只画外轮廓，重叠、相接、包含和重复多边形没有内缝',()=>{
  const square=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]
  const a=square(0,0,10,10),length=polys=>regionBoundary(polys).reduce((n,[p,q])=>n+Math.hypot(q.x-p.x,q.y-p.y),0)
  near(length([a,square(5,0,10,10)]),50)
  near(length([a,square(10,0,10,10)]),60)
  near(length([a,square(2,2,3,3)]),40)
  near(length([a,a]),40)
  const full=controlRegionGeometry([MAP_BASE,...MAP_SITES]),contains=p=>full.polygons.some(poly=>regionContains(poly,p))
  for(const [p,q] of full.boundary){
    const x=(p.x+q.x)/2,y=(p.y+q.y)/2,d=Math.hypot(q.x-p.x,q.y-p.y),nx=-(q.y-p.y)/d*.001,ny=(q.x-p.x)/d*.001
    assert.notEqual(contains({x:x+nx,y:y+ny}),contains({x:x-nx,y:y-ny}))
  }
})

test('驻军变化更新合并区域，单次透明填充保持在田地、道路和图标下方',()=>{
  const g=game(),events=[];let path=[]
  g.ctx.beginPath=()=>{path=[]};g.ctx.moveTo=(x,y)=>path.push([x,y]);g.ctx.lineTo=(x,y)=>path.push([x,y])
  g.ctx.fill=()=>events.push(['fill',g.ctx.fillStyle,path.length]);g.ctx.stroke=()=>events.push(['stroke',g.ctx.strokeStyle]);g.ctx.fillText=value=>events.push(['text',value])
  setFormation(g.save,'squad',10);setFormation(g.save,'squad',10)
  assert(stationTroops(g.save,1,[1,2]).ok)
  const snapshot=structuredClone(g.save);draw(g);assert.deepEqual(g.save,snapshot)
  const red=events.findIndex(([kind,value])=>kind==='fill'&&value==='rgba(151,48,40,.34)')
  const originalSize=events[red][2],redSize=()=>events.findLast(([kind,value])=>kind==='fill'&&value==='rgba(151,48,40,.34)')[2]
  assert.equal(events.filter(([kind,value])=>kind==='fill'&&value==='rgba(151,48,40,.34)').length,1)
  for(const [kind,value] of [['fill','#465431'],['stroke','#18261c'],['text','柳树村']])assert(events.findIndex(e=>e[0]===kind&&e[1]===value)>red)
  assert(recallGarrison(g.save,1,1).ok);draw(g);assert.equal(redSize(),originalSize)
  assert(recallGarrison(g.save,1,2).ok);g.save=normalizeSave(structuredClone(g.save));draw(g);assert.equal(redSize(),8)
  assert.equal(Object.keys(g.save.garrisons).length,0)
})

test('地图坐标可逆，鼠标位置为缩放锚点，放大后也能返回同一位置',()=>{
  const camera=createCamera({x:1600,y:950}),p={x:840,y:390},world=screenToMap(camera,p)
  const original=mapToScreen(camera,world);near(original.x,p.x);near(original.y,p.y)
  zoomCamera(camera,1.5,p);const after=mapToScreen(camera,world);near(after.x,p.x);near(after.y,p.y)
  zoomCamera(camera,1/1.5,p);near(camera.x,1600);near(camera.y,950);near(camera.zoom,REGION_ZOOM)
})

test('缩放和拖动有地图边界，全图可见全部据点且定位恢复局部视野',()=>{
  const camera=createCamera();zoomCamera(camera,1e9);assert.equal(camera.zoom,MAX_ZOOM)
  panCamera(camera,1e7,-1e7)
  near(camera.x,MAP_BOUNDS.x+MAP_VIEW.w/camera.zoom/2);near(camera.y,MAP_BOUNDS.y+MAP_SIZE.h-MAP_VIEW.h/camera.zoom/2)
  assert(screenToMap(camera,{x:MAP_VIEW.x,y:MAP_VIEW.y+MAP_VIEW.h}).x<MAP_CORE.x)
  assert(screenToMap(camera,{x:MAP_VIEW.x,y:MAP_VIEW.y+MAP_VIEW.h}).y>MAP_CORE.y+MAP_CORE.h)
  panCamera(camera,-1e7,1e7)
  near(camera.x,MAP_BOUNDS.x+MAP_SIZE.w-MAP_VIEW.w/camera.zoom/2);near(camera.y,MAP_BOUNDS.y+MAP_VIEW.h/camera.zoom/2)
  zoomCamera(camera,1e-9);assert.equal(camera.zoom,MIN_ZOOM)
  fitCamera(camera)
  for(const site of MAP_SITES){const p=mapToScreen(camera,site);assert(p.x>0&&p.x<1440&&p.y>106&&p.y<692)}
  const first=screenToMap(camera,{x:720,y:399});panCamera(camera,999,999);assert.deepEqual(screenToMap(camera,{x:720,y:399}),first)
  focusCamera(camera,MAP_SITES[1]);assert.equal(camera.zoom,.65);near(camera.x,MAP_SITES[1].x);near(camera.y,MAP_SITES[1].y)
})

test('地图独占场景，进出不修改存档，所有控件处于游戏视野内',()=>{
  const g=game(),before=structuredClone(g.save)
  g.open('campaign');assert.equal(g.scene,'world-map');assert.equal(g.modal,null)
  fitCamera(g.mapCamera);draw(g)
  assert.equal(g.buttons.filter(b=>b.id.startsWith('map-site-')).length,7)
  assert.equal(g.buttons.some(b=>b.id.startsWith('level-')),false)
  for(const b of g.buttons)assert(b.x>=0&&b.y>=0&&b.x+b.w<=1440&&b.y+b.h<=810,b.id)
  zoomCamera(g.mapCamera,2);const camera={...g.mapCamera};g.home();assert.equal(g.scene,'world-map')
  g.open('campaign');assert.deepEqual(g.mapCamera,camera);assert.deepEqual(g.save,before)
})

test('新档在地图上确认无敌军的外围村庄后，从该村发兵，刷新和撤回仍使用该根据地',()=>{
  const oldWx=globalThis.wx,oldFrame=globalThis.requestAnimationFrame
  let stored,writes=0
  const context=game().ctx
  globalThis.wx={createCanvas:()=>({getContext:()=>context}),getStorageSync:()=>structuredClone(stored),
    setStorageSync(_key,save){stored=structuredClone(save);writes++},
    getWindowInfo:()=>({windowWidth:1440,windowHeight:810,pixelRatio:1}),onTouchStart(){},onTouchMove(){},onTouchEnd(){}}
  globalThis.requestAnimationFrame=()=>{}
  try{
    const initial=new Game(),startingMap=structuredClone(initial.save.mapRegions),startingPopulation=structuredClone(initial.save.villagePopulation)
    assert(initial.choosingBase);assert.equal(writes,1);assert.equal(stored.baseVillageId,null)
    const g=new Game(),enemy=REGION_VILLAGES.find(v=>regionEnemyTroops(g.save,v.regionId)>0)
    const candidate=REGION_VILLAGES.find(v=>v.regionId.startsWith('region-outer-')&&!regionEnemyTroops(g.save,v.regionId))
    assert(g.choosingBase);assert.equal(writes,1)
    assert.deepEqual(g.save.mapRegions,startingMap);assert.deepEqual(g.save.villagePopulation,startingPopulation)
    g.tick(1000);g.tick(62000);assert.equal(g.save.mealElapsed,0)
    assert(!g.buttons.some(b=>['map-site-base','warehouse','map-base-confirm','map-region-'+enemy.regionId].includes(b.id)))
    assert.equal(chooseStartingBase(g.save,enemy.id),false)
    focusCamera(g.mapCamera,candidate);g.dirty=true;g.render()
    const p=mapToScreen(g.mapCamera,candidate)
    g.touch(touch(g,[p.x,p.y]));g.touchEnd(lift(g,p.x,p.y));g.render()
    assert.equal(g.mapSelected,candidate.id);assert.equal(g.save.baseVillageId,null);assert.equal(writes,1)
    const confirm=g.buttons.find(b=>b.id==='map-base-confirm');assert(confirm)
    g.touch(touch(g,[confirm.x+confirm.w/2,confirm.y+confirm.h/2]))
    g.render();assert(!g.choosingBase);assert.equal(stored.baseVillageId,candidate.id)
    assert(villageControlled(g.save,candidate.id));assert(!villageControlled(g.save,MAP_BASE.villageId))
    assert.equal(chooseStartingBase(g.save,MAP_SITES[0].id),false)
    assert(g.buttons.some(b=>b.id==='map-site-base'))
    const reloaded=new Game();assert(!reloaded.choosingBase);assert.equal(mapBase(reloaded.save).roadId,candidate.regionId)
    assert.deepEqual(reloaded.save.mapRegions,startingMap);assert.deepEqual(reloaded.save.villagePopulation,startingPopulation)
    assert(setFormation(reloaded.save,'squad',10).ok)
    const arrival=MAP_SITES.find(site=>!regionEnemyTroops(reloaded.save,site.id))
    const dispatch=startMarch(reloaded.save,'village',arrival.id,[1]);assert(dispatch.ok)
    assert.deepEqual(dispatch.order.route[0],{x:candidate.x,y:candidate.y});assert(dispatch.order.route.length>2)
    advanceMarches(reloaded.save,10000)
    assert.match(recallGarrison(reloaded.save,arrival.id,1).message,new RegExp(candidate.name))
    assert.equal(baseForces(reloaded.save).units[0].id,1)
    stored=undefined
    const restarted=new Game();assert(restarted.choosingBase)
    assert.notDeepEqual(restarted.save.mapRegions,startingMap)
    assert.notDeepEqual(restarted.save.villagePopulation,startingPopulation)
  }finally{if(oldWx===undefined)delete globalThis.wx;else globalThis.wx=oldWx;if(oldFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=oldFrame}
})

test('游玩中通过地图或驻村管理迁移根据地，刷新后从新址派兵，原驻防和行军保留',()=>{
  const g=game(),s=g.save,old=MAP_SITES[0],destination=REGION_VILLAGES.find(v=>!mapRegion(v.regionId).enemyTroops)
  const enemy=REGION_VILLAGES.find(v=>mapRegion(v.regionId).enemyTroops)
  const modal=()=>{g.buttons=[];g.drawModal()}
  g.persist=()=>{g.saved=structuredClone(s)}
  assert(chooseStartingBase(s,old.id))
  for(let i=0;i<3;i++)assert(setFormation(s,'squad',10).ok)
  assert(stationTroops(s,old.id,[1]).ok);assert(stationTroops(s,2,[2]).ok)
  const marching=startMarch(s,'village',3,[3]);assert(marching.ok)
  const before=structuredClone(s)
  g.openVillage(2);modal();click(g,'village-relocate-base');draw(g)
  assert.equal(g.mapSelected,2);assert(g.buttons.some(button=>button.id==='map-base-confirm'))
  click(g,'map-base-cancel');assert.equal(g.modal,'base');assert.deepEqual(s,before);assert.equal(g.saved,undefined)
  modal();click(g,'base-relocate');fitCamera(g.mapCamera);draw(g)
  assert(!g.buttons.some(button=>button.id==='map-region-'+enemy.regionId))
  click(g,'map-region-'+destination.regionId);draw(g);click(g,'map-base-confirm')
  assert.equal(g.relocatingBase,false);assert.equal(g.mapSelected,'base');assert.equal(mapBase(s).villageId,destination.id)
  assert(villageControlled(s,old.id)&&villageControlled(s,destination.id))
  assert.deepEqual(s,{...before,baseVillageId:destination.id});assert.deepEqual(normalizeSave(g.saved),s)
  draw(g);assert(g.buttons.some(button=>button.id==='map-site-base'))
  const restored=normalizeSave(g.saved)
  assert.deepEqual(marchPosition(restored.marchingOrders[0]),{x:old.x,y:old.y})
  assert(recallGarrison(restored,2,2).ok)
  const next=startMarch(restored,'village',2,[2]);assert(next.ok)
  assert.deepEqual(marchPosition(next.order),{x:destination.x,y:destination.y})
})

test('迁移禁止敌占和正在遇袭的村庄，旧根据地的代耕进度跨存档保留',()=>{
  const g=game(),s=g.save,old=MAP_SITES[0],newBase=MAP_SITES[1]
  const field=MAP_FIELDS.find(item=>item.villageId===old.id)
  const enemy=REGION_VILLAGES.find(v=>mapRegion(v.regionId).enemyTroops)
  assert(chooseStartingBase(s,old.id));assert(startFarming(s,'help',30,field.crop,null,field.id).ok)
  g.updateLogistics(12,()=>0)
  const working=structuredClone(farmTaskAt(s,field.id))
  assert.equal(working.phase,'working')
  assert.match(relocateBase(s,enemy.id).message,/敌军占领/)
  s.raidAlerts=[{siteId:newBase.id}]
  assert.match(relocateBase(s,newBase.id).message,/正在遭袭/);assert.equal(s.baseVillageId,old.id)
  s.raidAlerts=[]
  assert(relocateBase(s,newBase.id).ok);assert(!villageControlled(s,old.id))
  g.save=normalizeSave(s);assert.deepEqual(farmTaskAt(g.save,field.id),working)
  g.openMapField(field.id);assert.equal(g.modal,'farm')
  g.updateLogistics(70,()=>0);assert.equal(farmTaskAt(g.save,field.id),null)
  assert.equal(g.save.farmHarvested,9)
})

test('旧址生成的禾川村保持可定位，村庄分散后全图可见且点位不相互遮挡',()=>{
  for(const stage of [1,6,12]){
    const g=game();g.save.stage=stage;g.open('campaign');draw(g)
    assert.equal(g.mapSelected,MAP_BASE.id)
    const center=mapToScreen(g.mapCamera,MAP_BASE);near(center.x,720);near(center.y,399)
    for(const fit of [false,true]){
      if(fit){fitCamera(g.mapCamera);draw(g)}
      const points=g.buttons.filter(b=>b.id.startsWith('map-site-'));if(fit)assert.equal(points.length,7);else assert(points.length>0)
      for(const b of points)assert(b.y>=MAP_VIEW.y&&b.y+b.h<=MAP_VIEW.y+MAP_VIEW.h,b.id)
      for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
        const a=points[i],b=points[j];assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,a.id+' overlaps '+b.id)
      }
    }
  }
})

test('点击村庄未驻军先调入驻军，驻军后打开管理而非战斗，关闭回地图，原战斗部署仍可返回地图',()=>{
  const g=game();setFormation(g.save,'squad',10);g.open('campaign');fitCamera(g.mapCamera);draw(g)
  click(g,'map-site-2');assert.equal(g.modal,'village-station');modal(g);click(g,'close');assert.equal(g.modal,null)
  assert(stationTroops(g.save,2,[1]).ok);draw(g);click(g,'map-site-2');assert.equal(g.modal,'village');assert.equal(g.battle,undefined);modal(g);click(g,'close')
  assert(recallGarrison(g.save,2,1).ok)
  draw(g);click(g,'map-site-base');draw(g);click(g,'map-location-action');assert.equal(g.modal,'base')
  g.open('campaign');const camera={...g.mapCamera};g.start('campaign',1)
  assert.equal(g.modal,'campaign-deploy');g.buttons=[];g.drawModal();click(g,'deployment-back')
  assert.equal(g.scene,'world-map');assert.equal(g.modal,null);assert.deepEqual(g.mapCamera,camera)
  g.start('campaign',1);g.toggleDeployment(1);g.start('campaign',1,[...g.deploymentIds])
  assert.equal(g.scene,'battle');assert.equal(g.battle.level,1);assert.equal(g.battle.units.length,1)
})

test('桌面和缩小的手机画布中，轻点选择而拖动不会误选据点',()=>{
  for(const scale of [1,.5]){
    const g=game(scale);g.open('campaign');fitCamera(g.mapCamera);draw(g)
    const p=mapToScreen(g.mapCamera,MAP_SITES[2])
    g.touch(touch(g,[p.x,p.y]));assert.equal(g.mapSelected,'base')
    g.touchEnd(lift(g,p.x,p.y));assert.equal(g.mapSelected,3)
    g.openWorldMap()
    g.mapSelected='base';zoomCamera(g.mapCamera,2);draw(g)
    const before={...g.mapCamera}
    g.touch(touch(g,[600,390]));g.touchMove(touch(g,[700,440]));g.touchEnd(lift(g,700,440))
    assert.equal(g.mapSelected,'base');assert.notDeepEqual(g.mapCamera,before)
    assert.equal(g.modal,null);assert.equal(g.mapGesture,null)
  }
})

test('双指扩张以中心缩放，松开一指可继续平移，抬手不会选择据点',()=>{
  const g=game(.6);g.open('campaign');g.mapCamera=createCamera({x:1600,y:950});draw(g)
  const anchor=screenToMap(g.mapCamera,{x:720,y:399}),zoom=g.mapCamera.zoom
  g.touch(touch(g,[670,399]));g.touch(touch(g,[670,399],[770,399]))
  g.touchMove(touch(g,[620,399],[820,399]));near(g.mapCamera.zoom,zoom*2)
  const p=mapToScreen(g.mapCamera,anchor);near(p.x,720);near(p.y,399)
  g.touchEnd({touches:[point(g,620,399)],changedTouches:[point(g,820,399)]})
  assert.equal(g.mapGesture.moved,true);g.touchMove(touch(g,[650,420]));g.touchEnd(lift(g,650,420))
  assert.equal(g.mapSelected,'base');assert.equal(g.mapGesture,null)
  g.touch(touch(g,[720,399]));g.cancelTouch();g.touchEnd(lift(g,720,399));assert.equal(g.mapSelected,'base')
})

test('滚轮只在地图区域生效，弹窗隔离缩放，触控缩放按钮与全图定位可用',()=>{
  const g=game(.75),wheel={...point(g,720,399),deltaY:-120,deltaMode:0}
  assert.equal(g.mouseWheel(wheel),false);g.open('campaign');const z=g.mapCamera.zoom
  assert.equal(g.mouseWheel({...wheel,...point(g,720,55)}),false)
  assert.equal(g.mouseWheel(wheel),true);assert(g.mapCamera.zoom>z)
  g.open('army');const camera={...g.mapCamera};assert.equal(g.mouseWheel(wheel),false);assert.deepEqual(g.mapCamera,camera)
  g.open('campaign');draw(g);click(g,'map-zoom-in');assert(g.mapCamera.zoom>camera.zoom)
  click(g,'map-zoom-out');near(g.mapCamera.zoom,camera.zoom)
  click(g,'map-fit');assert.equal(g.mapCamera.zoom,MIN_ZOOM)
  click(g,'map-focus');assert.equal(g.mapCamera.zoom,.65)
})

test('绘制全屏地图与部署遮罩不触发战斗渲染，推进后勤也不切换场景',()=>{
  const g=game();setFormation(g.save,'squad',10)
  Object.assign(g,{canvas:{width:1440,height:810},dpr:1,toast:null,drawBattle(){assert.fail('地图不能绘制战斗')}})
  g.open('campaign');g.render();g.updateLogistics(10)
  assert.equal(g.scene,'world-map');assert.equal(g.modal,null)
  g.start('campaign',1);g.render();assert.equal(g.modal,'campaign-deploy')
})

test('浏览器适配层同时保留双指，抬手和取消分开派发，滚轮仅在被处理时拦截',()=>{
  const events={},documentEvents={},windowEvents={},probe={style:{}}
  const canvas={addEventListener:(k,fn)=>events[k]=fn,setPointerCapture(){},getBoundingClientRect:()=>({width:896,height:300})}
  const sandbox={devicePixelRatio:2,getComputedStyle:()=>({paddingLeft:'44px',paddingRight:'32px',paddingTop:'0px',paddingBottom:'12px'}),
    window:{addEventListener:(k,fn)=>windowEvents[k]=fn},
    document:{createElement:tag=>tag==='canvas'?canvas:probe,body:{prepend(){},append(){}},addEventListener:(k,fn)=>documentEvents[k]=fn}}
  vm.runInNewContext(readFileSync(new URL('../preview/wx-shim.js',import.meta.url),'utf8'),sandbox)
  const wx=sandbox.window.wx,seen=[];wx.createCanvas()
  const {windowWidth,windowHeight,safeArea}=wx.getWindowInfo()
  assert.deepEqual([windowWidth,windowHeight,safeArea.left,safeArea.top,safeArea.right,safeArea.bottom],[896,300,44,0,864,288])
  for(const [method,name] of [['onTouchStart','start'],['onTouchMove','move'],['onTouchEnd','end'],['onTouchCancel','cancel']])wx[method](e=>seen.push({name,count:e.touches.length,changed:e.changedTouches[0]?.identifier}))
  const p=id=>({pointerId:id,pointerType:'touch',clientX:id*10,clientY:300})
  events.pointerdown(p(1));events.pointerdown(p(2));events.pointermove(p(2));events.pointerup(p(2));events.lostpointercapture(p(2))
  assert.deepEqual(seen,[{name:'start',count:1,changed:1},{name:'start',count:2,changed:2},{name:'move',count:2,changed:2},{name:'end',count:1,changed:2}])
  events.pointercancel(p(1));assert.deepEqual(seen.at(-1),{name:'cancel',count:0,changed:1})
  let prevented=0,handled=false;wx.onMouseWheel(()=>handled)
  const wheel={clientX:100,clientY:300,deltaY:-100,deltaMode:0,preventDefault(){prevented++}}
  events.wheel(wheel);assert.equal(prevented,0);handled=true;events.wheel(wheel);assert.equal(prevented,1)
  events.pointerdown(p(3));documentEvents.visibilitychange(); // foreground does not cancel
  assert.equal(seen.at(-1).name,'start');sandbox.document.hidden=true;documentEvents.visibilitychange();assert.equal(seen.at(-1).name,'cancel')
  events.pointerdown(p(4));assert.equal(seen.at(-1).count,1);windowEvents.pagehide();assert.equal(seen.at(-1).count,0)
})

const modal=g=>{g.buttons=[];g.drawModal();for(const b of g.buttons)assert(b.x>=270&&b.y>=130&&b.x+b.w<=1170&&b.y+b.h<=680,b.id)}

test('每个村庄一块田地，初始及全图均可点击，田地与村庄的点击区域不重叠',()=>{
  const g=game();g.open('campaign');draw(g)
  for(const village of ALL_VILLAGES)assert.equal(MAP_FIELDS.filter(f=>f.villageId===village.id).length,1)
  for(const fit of [false,true]){
    if(fit){fitCamera(g.mapCamera);draw(g)}
    const points=g.buttons.filter(b=>b.id.startsWith('map-field-')||b.id.startsWith('map-site-'))
    if(fit)assert.equal(points.length,ALL_VILLAGES.length+7)
    else assert(points.length>0)
    for(const b of points)assert(b.y>=MAP_VIEW.y&&b.y+b.h<=MAP_VIEW.y+MAP_VIEW.h,b.id)
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
      const a=points[i],b=points[j];assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,a.id+' overlaps '+b.id)
    }
  }
})

test('重新布置据点后仍可浏览三倍面积，全图缩小后田地和村庄仍能准确点击',()=>{
  assert(Math.abs(MAP_SIZE.w*MAP_SIZE.h/(8000*4750)-3)<.001)
  assert.equal(MAP_BASE.x,1600);assert.equal(MAP_BASE.y,950)
  const g=game(.6);setFormation(g.save,'squad',7);setFormation(g.save,'squad',7);stationTroops(g.save,MAP_FIELDS[3].villageId,[1]);stationTroops(g.save,MAP_SITES[2].id,[2]);const before=structuredClone(g.save);g.openWorldMap();fitCamera(g.mapCamera);draw(g)
  const base=mapToScreen(g.mapCamera,MAP_BASE);near(base.x,720);near(base.y,399)
  const field=MAP_FIELDS[3],p=mapToScreen(g.mapCamera,field)
  g.touch(touch(g,[p.x,p.y]));g.touchEnd(lift(g,p.x,p.y));assert.equal(g.farmFieldId,field.id);assert.equal(g.modal,'farm')
  g.openWorldMap();draw(g);const village=mapToScreen(g.mapCamera,MAP_SITES[2])
  g.touch(touch(g,[village.x,village.y]));g.touchEnd(lift(g,village.x,village.y));assert.equal(g.villageId,MAP_SITES[2].id);assert.equal(g.modal,'village')
  assert.deepEqual(g.save,before)
})

test('缩小地图时根据地、村庄标识和点击范围同步等比例缩小，不再相对变大',()=>{
  const g=game();g.openWorldMap();g.mapCamera={x:1600,y:250,zoom:.26};draw(g)
  const ids=['map-site-base','map-site-2','map-field-field-3'],initial=ids.map(id=>g.buttons.find(b=>b.id===id))
  zoomCamera(g.mapCamera,.7);draw(g)
  ids.forEach((id,i)=>{const b=g.buttons.find(b=>b.id===id);near(b.w/initial[i].w,.7);near(b.h/initial[i].h,.7)})
  zoomCamera(g.mapCamera,1/.7);draw(g)
  ids.forEach((id,i)=>{const b=g.buttons.find(b=>b.id===id);near(b.w,initial[i].w);near(b.h,initial[i].h)})
})

test('点击田地派编制代耕，保存田块归属，完工后按出工人数获得粮食',()=>{
  const g=game();setFormation(g.save,'squad',10);setFormation(g.save,'squad',7);stationTroops(g.save,MAP_FIELDS[0].villageId,[1]);const original=structuredClone(g.save),field=MAP_FIELDS[0]
  g.open('campaign');fitCamera(g.mapCamera);draw(g);const p=mapToScreen(g.mapCamera,field)
  g.touch(touch(g,[p.x,p.y]));g.touchEnd(lift(g,p.x,p.y))
  assert.equal(g.modal,'farm');assert.equal(g.farmFieldId,field.id)
  modal(g);assert.equal(g.buttons.some(b=>b.id==='farm-self'||b.id==='farm-source-reserve'||b.id==='farm-unit-2'||b.id.startsWith('farm-crop-')),false)
  click(g,'farm-unit-1');modal(g);click(g,'farm-start')
  assert.equal(farmTaskAt(g.save,field.id).type,'help');assert.equal(farmTaskAt(g.save,field.id).fieldId,field.id);assert.deepEqual(farmTaskAt(g.save,field.id).unitIds,[1])
  assert.equal(campaignDeployment(g.save,[1]).ok,false)
  const restored=normalizeSave(structuredClone(g.save));assert.deepEqual(restored,g.save);assert.equal(formationActivity(restored,1),'farm')
  modal(g);click(g,'farm-back');assert.equal(g.scene,'world-map');assert.equal(g.modal,null)
  g.updateLogistics(4,()=>0);const labels=[];g.ctx.fillText=value=>labels.push(String(value));draw(g);assert(labels.includes('代耕中'));assert(labels.includes('10人耕作'))
  g.updateLogistics(70,()=>0);assert.equal(farmTaskAt(g.save,field.id),null);assert.equal(formationActivity(g.save,1),'garrison')
  assert.equal(g.save.mobilizationDiscounts,10);assert.equal(g.save.troops,original.troops+1)
  for(const id of ['millet','rice','corn','pork','eggs'])assert.equal(g.save[id],original[id]+(id==='millet'?3:0))
  g.updateLogistics(1,()=>0);assert.equal(g.save.troops,original.troops+1)
})

test('新开局可从枣林村根据地派未编人员代耕，刷新和返程期间保留占用',()=>{
  const g=game(),field=MAP_FIELDS.find(field=>field.villageId===5)
  assert(chooseStartingBase(g.save,5));g.openWorldMap();draw(g)
  click(g,'map-field-'+field.id);modal(g)
  const oldWx=globalThis.wx
  globalThis.wx={showModal(options){assert.equal(options.content,'30');options.success({confirm:true,content:'30'})}}
  try{click(g,'farm-source-reserve')}finally{if(oldWx===undefined)delete globalThis.wx;else globalThis.wx=oldWx}
  assert.equal(farmTaskAt(g.save,field.id).phase,'outbound')
  assert.equal(baseForces(g.save).unassigned,90)
  assert.equal(setFormation(g.save,'company',100).ok,false)
  g.save=normalizeSave(g.save);modal(g)
  assert.equal(farmTaskAt(g.save,field.id).workers,30)
  g.openWorldMap();draw(g)
  g.updateLogistics(64,()=>0)
  assert.equal(farmTaskAt(g.save,field.id)?.phase,'returning')
  assert.equal(g.save.farmHarvested,9)
  assert.equal(formation(g.save).unassignedTroops,g.save.troops-30)
  g.updateLogistics(10,()=>0)
  assert.equal(farmTaskAt(g.save,field.id),null)
  assert.equal(formation(g.save).unassignedTroops,g.save.troops)

  assert(setFormation(g.save,'squad',10).ok)
  g.updateLogistics(300,()=>0);g.openMapField(field.id);modal(g)
  click(g,'farm-unit-1');modal(g);click(g,'farm-start')
  const loaded=normalizeSave(g.save)
  assert.deepEqual(farmTaskAt(loaded,field.id).unitIds,[1])
  assert.equal(formationActivity(loaded,1),'farm')
})

test('不同村的田地可同时派兵，召回只影响当前田地，拖动不会打开窗口',()=>{
  const g=game(.5);setFormation(g.save,'squad',10);setFormation(g.save,'squad',7);setFormation(g.save,'squad',7);stationTroops(g.save,MAP_FIELDS[0].villageId,[2]);stationTroops(g.save,MAP_FIELDS[1].villageId,[3]);g.open('campaign');draw(g)
  const [first,second]=MAP_FIELDS,p=mapToScreen(g.mapCamera,first)
  g.touch(touch(g,[p.x,p.y]));g.touchMove(touch(g,[p.x+40,p.y+30]));g.touchEnd(lift(g,p.x+40,p.y+30))
  assert.equal(g.modal,null)
  g.openMapField(first.id);modal(g);click(g,'farm-unit-2');modal(g);click(g,'farm-start')
  const task=structuredClone(farmTaskAt(g.save,first.id));g.openWorldMap();g.openMapField(second.id)
  assert.equal(g.farmFieldId,second.id);modal(g);assert(!g.buttons.some(b=>b.id==='farm-unit-2'))
  click(g,'farm-unit-3');modal(g);click(g,'farm-start')
  assert.deepEqual(farmTaskAt(g.save,first.id),task);assert.equal(formationActivity(g.save,3),'farm')
  g.save=normalizeSave(g.save);g.updateLogistics(4,()=>0)
  const secondTask=farmTaskAt(g.save,second.id),elapsed=secondTask.elapsed
  g.openMapField(first.id);modal(g);click(g,'farm-cancel');g.updateLogistics(5,()=>0)
  assert.equal(farmTaskAt(g.save,first.id),null);assert.equal(formationActivity(g.save,2),'garrison')
  assert.equal(farmTaskAt(g.save,second.id),secondTask);assert(secondTask.elapsed>elapsed)
  g.updateLogistics(70,()=>0);assert.equal(farmTaskAt(g.save,second.id),null);assert.equal(formationActivity(g.save,3),'garrison')
  assert.equal(g.save.mobilizationDiscounts,7);assert.equal(g.save.farmHarvested,2)
})

test('田地绑定校验作物及代耕方式，旧任务可完成但界面不能新建自耕',()=>{
  const s=freshSave(),field=MAP_FIELDS[0]
  for(const [type,crop,id] of [['self',field.crop,field.id],['help','rice',field.id],['help','millet','missing']]){
    const before=structuredClone(s);assert.equal(startFarming(s,type,3,crop,null,id).ok,false);assert.deepEqual(s,before)
  }
  const malformed=normalizeSave({...s,farmTask:{type:'help',workers:3,crop:'rice',elapsed:1,fieldId:field.id}})
  assert.equal(malformed.farmTask.fieldId,undefined);assert.equal(malformed.farmTask.workers,3)
  const repeat=game();repeat.save.cookedRice=100;setFormation(repeat.save,'squad',7);stationTroops(repeat.save,MAP_FIELDS[3].villageId,[1]);repeat.openMapField(MAP_FIELDS[3].id);modal(repeat);click(repeat,'farm-unit-1');modal(repeat);click(repeat,'farm-start')
  repeat.openWorldMap();repeat.openMapField(MAP_FIELDS[3].id);repeat.updateLogistics(370);modal(repeat)
  click(repeat,'farm-unit-1');modal(repeat);click(repeat,'farm-start');assert.equal(farmTaskAt(repeat.save,MAP_FIELDS[3].id).crop,'rice')
  assert(startFarming(s,'self',3,'rice').ok);const g=game();g.save=normalizeSave(structuredClone(s));g.open('farm');modal(g)
  assert.equal(g.buttons.some(b=>b.id==='farm-self'||b.id==='farm-start'),false)
  g.updateLogistics(60);assert.equal(g.save.rice,9);assert.equal(g.save.farmTask,null)
  modal(g);assert.equal(g.buttons.some(b=>b.id==='farm-self'||b.id==='farm-start'),false)
})

test('根据地中心显示未派出兵力，派出、驻村分兵与撤回时同步增减',()=>{
  const g=game();setFormation(g.save,'company',100);g.save.cookedRice=100
  assert.equal(baseForces(g.save).troops,120);assert.equal(baseForces(g.save).unassigned,20);assert.equal(baseForces(g.save).units.length,1)
  const labels=[];g.ctx.fillText=value=>labels.push(String(value));g.openWorldMap();draw(g)
  assert(labels.includes('根据地中心 · 兵力 120人'));assert(labels.includes('1连 100人、未编 20人'))
  assert(labels.includes('根据地中心 · 兵力 120 人'));assert(labels.includes('未派出兵力留守：1 支编制 · 未编 20 人'))
  labels.length=0;g.open('base');modal(g);assert(labels.includes('根据地指挥中心 · 留守兵力 120 人'))
  assert(startMarch(g.save,'village',1,[1]).ok)
  assert.equal(baseForces(g.save).troops,20);assert.equal(baseForces(g.save).units.length,0)
  advanceMarches(g.save,100);assert.equal(baseForces(g.save).troops,20)
  const split=splitGarrisonUnit(g.save,1,'platoon',30).unit
  assert.equal(baseForces(g.save).troops,20)
  assert(stationTroops(g.save,2,[split.id]).ok);assert.equal(split.splitOrigin,undefined)
  const recall=recallGarrison(g.save,2,split.id);assert(recall.ok);assert.equal(recall.destination,1)
  assert.equal(baseForces(g.save).troops,20);assert.deepEqual(villageLocalUnits(g.save,1).map(unit=>unit.id),[1,split.id])
  assert(recallGarrison(g.save,1,1).ok);assert(stationTroops(g.save,2,[split.id]).ok)
  assert.equal(recallGarrison(g.save,2,split.id).destination,'base')
  labels.length=0;g.openWorldMap();draw(g);assert(labels.includes('根据地中心 · 兵力 120人'))
})

test('设置中点击暂停游戏后停止时间、音乐并锁定一切操作，只能点击继续游戏恢复',()=>{
  const oldFrame=globalThis.requestAnimationFrame,oldWx=globalThis.wx
  let plays=0,pauses=0
  globalThis.requestAnimationFrame=()=>{}
  globalThis.wx={...oldWx,createInnerAudioContext:()=>({play(){plays++},pause(){pauses++}})}
  try{
    const g=game();setFormation(g.save,'squad',10)
    g.logisticsActive=true;g.last=1000;g.canvas={width:1440,height:810};g.dpr=1
    g.openWorldMap();draw(g);assert.equal(g.buttons.some(b=>b.id==='map-pause'),false)
    const playsBefore=plays
    g.open('settings');modal(g);click(g,'settings-pause')
    assert.equal(g.paused,true);assert.equal(g.modal,null);assert.equal(pauses,1)
    g.render();assert.deepEqual(g.buttons.map(b=>b.id),['game-resume'])
    const before=structuredClone(g.save),camBefore={...g.mapCamera}
    g.touch(touch(g,[200,300]));g.touchMove(touch(g,[400,400]));g.touchEnd(lift(g,400,400))
    g.mouseWheel({clientX:720,clientY:400,deltaY:-120,deltaMode:0})
    assert.deepEqual(g.mapCamera,camBefore);assert.equal(g.modal,null)
    g.tick(6000);assert.deepEqual(g.save,before);assert.equal(plays,playsBefore)
    const resume=g.buttons[0]
    g.touch(touch(g,[resume.x+resume.w/2,resume.y+resume.h/2]))
    assert.equal(g.paused,false);assert(plays>playsBefore)
    g.tick(17000);assert(g.save.mealElapsed>before.mealElapsed)
  }finally{
    if(oldFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=oldFrame
    if(oldWx===undefined)delete globalThis.wx;else globalThis.wx=oldWx
  }
})
