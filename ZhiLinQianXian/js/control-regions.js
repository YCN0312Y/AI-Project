import {MAP_BASE,MAP_SITES,MAP_ROADS,MAP_FIELDS,MAP_REGIONS,MAP_REGION_ROADS} from './world-map.js'

const cross=(a,b)=>a.x*b.y-a.y*b.x
const minus=(a,b)=>({x:a.x-b.x,y:a.y-b.y})
const at=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})
const EPS=1e-8
const ROAD_HALF_WIDTH=150

const polygonArea=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y},0)/2
const pointKey=p=>`${p.x.toFixed(6)},${p.y.toFixed(6)}`
const positivePolygon=points=>polygonArea(points)<0?points.reverse():points

function surroundingHull(points){
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y)
  const half=ordered=>{
    const result=[]
    for(const p of ordered){
      while(result.length>1&&cross(minus(result[result.length-1],result[result.length-2]),minus(p,result[result.length-1]))<=0)result.pop()
      result.push(p)
    }
    return result.slice(0,-1)
  }
  return [...half(sorted),...half([...sorted].reverse())]
}

export function regionContains(polygon,p){
  let inside=false
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j]
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside
  }
  return inside
}

function roadPoints(road,locations){
  const a=locations.get(road.from),b=locations.get(road.to)
  if(!a||!b)return []
  const [x1,y1,x2,y2]=road.controls
  return Array.from({length:33},(_,i)=>{
    const t=i/32,u=1-t
    return {x:u*u*u*a.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*b.y}
  })
}

function distanceToSegment(p,a,b){
  const d=minus(b,a),length=d.x*d.x+d.y*d.y
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*d.x+(p.y-a.y)*d.y)/length)):0
  const q=at(a,b,t)
  return Math.hypot(p.x-q.x,p.y-q.y)
}

function roadRibbon(points){
  const left=[],right=[]
  points.forEach((p,i)=>{
    const prev=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)]
    const dx=next.x-prev.x,dy=next.y-prev.y,length=Math.hypot(dx,dy)||1
    const nx=-dy/length*ROAD_HALF_WIDTH,ny=dx/length*ROAD_HALF_WIDTH
    left.push({x:p.x+nx,y:p.y+ny});right.push({x:p.x-nx,y:p.y-ny})
  })
  return positivePolygon([...left,...right.reverse()])
}

// 分割相交边后，只留下并集内外之间的边，消除村庄与道路区域的内部接缝。
export function regionBoundary(polygons){
  const edges=polygons.flatMap(points=>points.map((a,i)=>({a,b:points[(i+1)%points.length],cuts:[0,1]})))
  const add=(edge,t)=>{if(t>=-EPS&&t<=1+EPS)edge.cuts.push(Math.max(0,Math.min(1,t)))}
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const a=edges[i],b=edges[j],r=minus(a.b,a.a),s=minus(b.b,b.a),q=minus(b.a,a.a),den=cross(r,s)
    if(Math.abs(den)>EPS){
      const t=cross(q,s)/den,u=cross(q,r)/den
      if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS){add(a,t);add(b,u)}
    }else if(Math.abs(cross(q,r))<EPS){
      const rr=r.x*r.x+r.y*r.y,ss=s.x*s.x+s.y*s.y
      if(rr)for(const p of [b.a,b.b])add(a,((p.x-a.a.x)*r.x+(p.y-a.a.y)*r.y)/rr)
      if(ss)for(const p of [a.a,a.b])add(b,((p.x-b.a.x)*s.x+(p.y-b.a.y)*s.y)/ss)
    }
  }
  const result=[],seen=new Set(),contains=p=>polygons.some(poly=>regionContains(poly,p))
  for(const edge of edges){
    const cuts=edge.cuts.sort((a,b)=>a-b).filter((t,i,all)=>!i||t-all[i-1]>EPS)
    for(let i=1;i<cuts.length;i++){
      const a=at(edge.a,edge.b,cuts[i-1]),b=at(edge.a,edge.b,cuts[i]),p=at(a,b,.5)
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)
      if(length<EPS)continue
      const nx=-dy/length*.001,ny=dx/length*.001
      if(contains({x:p.x+nx,y:p.y+ny})===contains({x:p.x-nx,y:p.y-ny}))continue
      const ends=[pointKey(a),pointKey(b)].sort(),key=ends.join('|')
      if(!seen.has(key)){seen.add(key);result.push([a,b])}
    }
  }
  return result
}

function enclosedPockets(boundary){
  const starts=new Map(),used=new Set(),pockets=[]
  boundary.forEach(([a],i)=>{const key=pointKey(a);if(!starts.has(key))starts.set(key,[]);starts.get(key).push(i)})
  for(let i=0;i<boundary.length;i++){
    if(used.has(i))continue
    const points=[],first=pointKey(boundary[i][0]);let edge=i,closed=false
    while(edge!==undefined&&!used.has(edge)){
      used.add(edge);const [a,b]=boundary[edge];points.push(a)
      const end=pointKey(b)
      if(end===first){closed=true;break}
      edge=starts.get(end)?.find(index=>!used.has(index))
    }
    if(closed&&polygonArea(points)<0)pockets.push(points)
  }
  return pockets
}

export function controlRegionGeometry(sites,roads=[...MAP_ROADS,...MAP_REGION_ROADS],landmarks=[MAP_BASE,...MAP_SITES,...MAP_REGIONS,...MAP_FIELDS]){
  const outline=[[-330,-160],[-80,-280],[270,-190],[430,50],[270,250],[-40,300],[-380,160],[-440,-30]]
  const controlled=new Set(sites.map(site=>site.id)),locations=new Map([...landmarks,...sites].map(site=>[site.id,site]))
  const blockers=landmarks.filter(site=>(site.type==='village'||site.type==='base'||site.strategic)&&!controlled.has(site.id))
  const polygons=sites.map(site=>{
    const points=outline.map(([dx,dy])=>({x:site.x+dx*(site.type==='base'?1:.65),y:site.y+dy*(site.type==='base'?1:.65)}))
    const fields=site.type==='village'?landmarks.filter(p=>p.villageId===(site.villageId??site.id)&&p.w>0&&p.h>0):[]
    // 连同所属田块四周的余量一起围住，田地与村庄之间不留孤立色块。
    for(const field of fields)for(const dx of [-1,1])for(const dy of [-1,1])points.push({x:field.x+dx*(field.w/2+50),y:field.y+dy*(field.h/2+50)})
    return positivePolygon(fields.length?surroundingHull(points):points)
  })
  const links=[]
  for(const road of roads){
    // 只连接两端都属于我方的道路，不跨越未驻军（或非我方）的中间建筑。
    if(!controlled.has(road.from)||!controlled.has(road.to))continue
    const points=roadPoints(road,locations)
    if(points.length<2||blockers.some(site=>points.slice(1).some((p,i)=>distanceToSegment(site,points[i],p)<ROAD_HALF_WIDTH+90)))continue
    polygons.push(roadRibbon(points));links.push({from:road.from,to:road.to})
  }
  let boundary=regionBoundary(polygons)
  // 多条友方道路围住的空地并入同一地区；里面有未驻军建筑则保留空缺。
  const pockets=enclosedPockets(boundary).filter(points=>!blockers.some(site=>regionContains(points,site)))
  if(pockets.length){polygons.push(...pockets.map(positivePolygon));boundary=regionBoundary(polygons)}
  return {polygons,boundary,links}
}
