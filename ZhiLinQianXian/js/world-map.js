import {FORMER_BASE_VILLAGE_ID,LAYOUT_VILLAGES,LAYOUT_FIELDS,LAYOUT_REGIONS,LAYOUT_CORE_ROADS,LAYOUT_TRAILS,LAYOUT_REGION_ROADS} from './map-layout.js'
import {OUTER_REGIONS,OUTER_CITIES,OUTER_FIELDS,OUTER_ROADS} from './map-expansion.js'
export {FORMER_BASE_VILLAGE_ID}

// 地图坐标独立于屏幕坐标；缩放时以指针/双指中心下的地图位置为锚点。
export const MAP_CORE={x:0,y:0,w:3200,h:1900}
export const MAP_EXPANSION=2.5*Math.sqrt(3)
const mapExtent=length=>2*Math.round(length*MAP_EXPANSION/2)
export const MAP_SIZE={w:mapExtent(MAP_CORE.w),h:mapExtent(MAP_CORE.h)}
export const MAP_BOUNDS={x:(MAP_CORE.w-MAP_SIZE.w)/2,y:(MAP_CORE.h-MAP_SIZE.h)/2,...MAP_SIZE}
export const MAP_VIEW={x:0,y:106,w:1440,h:586}
const formerBaseVillage={id:FORMER_BASE_VILLAGE_ID,name:'禾川村',x:1600,y:950,type:'village',size:'medium',direction:'中部'}
const baseMarker=village=>({...village,id:'base',villageId:village.id,roadId:village.regionId??village.id,type:'base',direction:'根据地中心'})
export const MAP_BASE=baseMarker(formerBaseVillage)
export const mapDirection=(x,y)=>{const a=Math.atan2(y-950,x-1600)*180/Math.PI;return ['东','东南','南','西南','西','西北','北','东北'][Math.round(((a+360)%360)/45)%8]}
export const MAP_SITES=[
  ['柳树村','small'],['石桥村','medium'],['青山村','large'],['河湾村','medium'],['枣林村','small'],['白杨村','large']
].map(([name,size],i)=>({id:i+1,name,x:LAYOUT_VILLAGES[i][0],y:LAYOUT_VILLAGES[i][1],direction:mapDirection(...LAYOUT_VILLAGES[i]),type:'village',size}))
export const REGION_ZOOM=.55
export const REGION_KINDS={village:'村庄',mountain:'山地',forest:'树林',river:'河流',city:'城池'}
export const MAP_TERRAIN_STYLES={
  village:{color:'#e4bd53',fill:'#302c1e'},forest:{color:'#6fb65a',fill:'#203322'},
  mountain:{color:'#a5aaa4',fill:'#2b302e'},river:{color:'#64afe2',fill:'#1d303d'},city:{color:'#d6b780',fill:'#322b20'}
}
export const MAP_FLAG_COLORS={player:'#e65545',enemy:'#4c94e8'}
const originalCities=[
  ['nw','北关城',-1150,-560,'regiment',1200],['ne','东宁城',4320,-380,'regiment',1800],
  ['sw','西陵城',-880,2470,'brigade',3600],['se','南川城',4120,2600,'division',9000]
].map(([key,name,x,y,enemyType,enemyTroops])=>({id:'region-city-'+key,name,x,y,type:'city',enemyType,enemyTroops,strategic:true,direction:({nw:'西北',ne:'东北',sw:'西南',se:'东南'})[key]}))
const outerCities=OUTER_CITIES.map(([key,name,x,y,enemyType,enemyTroops])=>({id:'region-'+key,name,x,y,type:'city',enemyType,enemyTroops,strategic:true,direction:mapDirection(x,y)}))
export const MAP_CITIES=[...originalCities,...outerCities]
const makeRegion=([key,name,x,y,type,enemyTroops])=>({id:'region-'+key,name,x,y,type,enemyTroops,strategic:true,direction:mapDirection(x,y)})
export const MAP_REGIONS=[...LAYOUT_REGIONS.map(makeRegion),...originalCities,...OUTER_REGIONS.map(makeRegion),...outerCities]
export const MAP_LOCAL_VILLAGES=[...MAP_SITES,formerBaseVillage]
export const OCCUPIABLE_SITES=[...MAP_REGIONS,...MAP_LOCAL_VILLAGES.map(site=>({...site,villageId:site.id,enemyTroops:0}))]
const regionsById=new Map(OCCUPIABLE_SITES.map(site=>[site.id,site]))
export const mapRegion=id=>regionsById.get(id)
// 外围村庄同样是完整村庄：拥有数字村ID、规模、人口与一块田地；占领后可用村庄管理。
export const REGION_VILLAGES=MAP_REGIONS.filter(site=>site.type==='village').map((site,i)=>{
  const village={id:MAP_SITES.length+1+i,name:site.name,x:site.x,y:site.y,direction:site.direction,type:'village',size:['small','medium','small','large','medium','small','large','medium'][i%8],regionId:site.id}
  site.villageId=village.id;return village
})
export const ALL_VILLAGES=[...MAP_LOCAL_VILLAGES,...REGION_VILLAGES]
const villagesById=new Map(ALL_VILLAGES.map(village=>[village.id,village]))
const locationsById=new Map([...MAP_REGIONS,...ALL_VILLAGES].map(site=>[site.id,site]))
const basesByVillage=new Map(ALL_VILLAGES.map(village=>[village.id,baseMarker(village)]))
export const mapVillage=id=>villagesById.get(id)
export const mapBase=s=>basesByVillage.get(s?.baseVillageId)||MAP_BASE
export const mapLocation=(id,s)=>locationsById.get(id)||mapBase(s)
// 每个村庄只有一块田地；原六村沿用field-1/3/5/7/9/11的ID，外围村庄接续编号。
const FIELD_CROPS=['millet','rice','corn']
const fieldPositions=[...LAYOUT_FIELDS,...OUTER_FIELDS,[1340,1240]]
export const MAP_FIELDS=[
  [1,'millet','field-1'],[2,'millet','field-3'],[3,'corn','field-5'],[4,'rice','field-7'],[5,'millet','field-9'],[6,'corn','field-11'],
  ...REGION_VILLAGES.map((v,i)=>[v.id,FIELD_CROPS[i%3],'field-'+(13+i)]),
  [FORMER_BASE_VILLAGE_ID,'rice','field-hechuan']
].map(([villageId,crop,id],i)=>{
  const [x,y]=fieldPositions[i]
  return {id,villageId,x,y,crop,w:190,h:108,name:mapLocation(villageId).name+'田地'}
})
export const mapField=id=>MAP_FIELDS.find(field=>field.id===id)
// 两端引用点位ID，控制点决定乡道的弯曲走向；布局由map-layout.js的噪波式随机生成。
export const MAP_TRAILS=LAYOUT_TRAILS
function curvedRoad([from,to],i){
  const a=mapLocation(from),b=mapLocation(to),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,bend=Math.min(length*.23,60+(i*53)%140)*(i%2?1:-1)
  return {from,to,controls:[a.x+dx*.32-dy/length*bend,a.y+dy*.32+dx/length*bend,a.x+dx*.7-dy/length*bend*.8,a.y+dy*.7+dx/length*bend*.8]}
}
export const MAP_ROADS=LAYOUT_CORE_ROADS.map(curvedRoad)
const roadKey=(from,to)=>[from,to].sort().join('|')
const coreRoadKeys=new Set(MAP_ROADS.map(road=>roadKey(road.from,road.to)))
export const MAP_REGION_ROADS=[...LAYOUT_REGION_ROADS,...OUTER_ROADS].map(curvedRoad).filter(road=>!coreRoadKeys.has(roadKey(road.from,road.to)))
// 图标与地形保持相同比例，缩小时不再维持固定屏幕尺寸。
export const mapMarkerScale=camera=>camera.zoom/REGION_ZOOM
export const MIN_ZOOM=Math.min(MAP_VIEW.w/MAP_SIZE.w,MAP_VIEW.h/MAP_SIZE.h)
export const MAX_ZOOM=2
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n))
const cameraView=camera=>camera.view||MAP_VIEW
const fitZoom=view=>Math.min(view.w/MAP_SIZE.w,view.h/MAP_SIZE.h)
function viewCenter(camera){
  const view=cameraView(camera)
  return {x:view.x+view.w/2,y:view.y+view.h/2}
}
export function constrainCamera(camera){
  const view=cameraView(camera)
  camera.zoom=clamp(camera.zoom,fitZoom(view),MAX_ZOOM)
  for(const [axis,dimension] of [['x','w'],['y','h']]){
    const half=view[dimension]/camera.zoom/2,size=MAP_SIZE[dimension],start=MAP_BOUNDS[axis]
    camera[axis]=half>=size/2?start+size/2:clamp(camera[axis],start+half,start+size-half)
  }
  return camera
}
export function createCamera(site=MAP_BASE){return constrainCamera({x:site.x,y:site.y,zoom:REGION_ZOOM})}
export function mapToScreen(camera,p){const center=viewCenter(camera);return {x:center.x+(p.x-camera.x)*camera.zoom,y:center.y+(p.y-camera.y)*camera.zoom}}
export function screenToMap(camera,p){const center=viewCenter(camera);return {x:camera.x+(p.x-center.x)/camera.zoom,y:camera.y+(p.y-center.y)/camera.zoom}}
export function anchorCamera(camera,zoom,world,screen){
  const center=viewCenter(camera)
  camera.zoom=clamp(zoom,fitZoom(cameraView(camera)),MAX_ZOOM)
  camera.x=world.x-(screen.x-center.x)/camera.zoom
  camera.y=world.y-(screen.y-center.y)/camera.zoom
  return constrainCamera(camera)
}
export function zoomCamera(camera,factor,screen=viewCenter(camera)){return anchorCamera(camera,camera.zoom*factor,screenToMap(camera,screen),screen)}
export function panCamera(camera,dx,dy){camera.x-=dx/camera.zoom;camera.y-=dy/camera.zoom;return constrainCamera(camera)}
export function fitCamera(camera){return Object.assign(camera,{x:MAP_BOUNDS.x+MAP_SIZE.w/2,y:MAP_BOUNDS.y+MAP_SIZE.h/2,zoom:fitZoom(cameraView(camera))})}
export function focusCamera(camera,site){return constrainCamera(Object.assign(camera,{x:site.x,y:site.y,zoom:Math.max(.65,camera.zoom)}))}
