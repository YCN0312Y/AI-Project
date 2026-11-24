import {controlRegionGeometry} from './control-regions.js'

export const C={paper:'#101813',panel:'#1a251e',raised:'#253228',ink:'#e4e8d7',muted:'#9ca995',line:'#42513d',olive:'#b0c881',gold:'#d9ac5a',red:'#df8060',blue:'#87bac0'}
export function brackets(c,x,y,w,h,color=C.olive){
  for(const [px,py,sx,sy] of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]]){
    line(c,px,py,px+sx*15,py,color,2);line(c,px,py,px,py+sy*15,color,2)
  }
}
export function box(c,x,y,w,h,fill,r=0,stroke){
  c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
  if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke()}
}
export function text(c,value,x,y,size=16,color=C.ink,weight=400,align='left'){
  c.font=`${weight} ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.fillText(String(value),x,y)
}
export function line(c,x,y,x2,y2,color=C.line,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke()}
export function circle(c,x,y,r,color){c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill()}
export function poly(c,points,color){c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill()}
export function commandMap(c,x,y,w,h,labels=true){
  box(c,x,y,w,h,'#1c2d25',2,C.line)
  c.save();c.beginPath();c.rect(x,y,w,h);c.clip()
  const p=(u,v)=>[x+w*u,y+h*v]
  for(const [points,color] of [
    [[[0,0],[.34,0],[.42,.22],[.30,.48],[.11,.55],[0,.33]],'#283a2b'],
    [[[.22,.40],[.44,.21],[.66,.31],[.73,.59],[.59,.91],[.33,1],[.17,.76]],'#24392d'],
    [[[.70,0],[1,0],[1,.72],[.87,.66],[.79,.37]],'#3b3429'],
    [[[0,.75],[.20,.68],[.30,1],[0,1]],'#303e2d']
  ])poly(c,points.map(([u,v])=>p(u,v)),color)
  for(let gx=x;gx<x+w;gx+=48)line(c,gx,y,gx,y+h,'#304136')
  for(let gy=y;gy<y+h;gy+=48)line(c,x,gy,x+w,gy,'#304136')
  c.globalAlpha=.55
  for(const [u,v,scale] of [[.12,.18,1],[.50,.18,1.2],[.82,.83,1.1]]){
    for(let ring=0;ring<6;ring++){
      c.beginPath()
      for(let i=0;i<=40;i++){
        const a=i/40*Math.PI*2,r=(28+ring*14)*scale*(1+.12*Math.sin(a*3+ring*.3)),px=x+w*u+Math.cos(a)*r*1.5,py=y+h*v+Math.sin(a)*r*.55
        if(i)c.lineTo(px,py);else c.moveTo(px,py)
      }
      c.strokeStyle='#697354';c.lineWidth=1;c.stroke()
    }
  }
  c.globalAlpha=1
  const river=()=>{c.beginPath();c.moveTo(x+w*.39,y-20);c.bezierCurveTo(x+w*.29,y+h*.24,x+w*.66,y+h*.50,x+w*.53,y+h+.2*h)}
  river();c.strokeStyle='#284747';c.lineWidth=18;c.stroke()
  river();c.strokeStyle='#52716b';c.lineWidth=3;c.stroke()
  c.setLineDash([7,7]);c.beginPath();c.moveTo(x+w*.87,y+h*.12);c.lineTo(x+w*.83,y+h*.36);c.lineTo(x+w*.90,y+h*.65);c.lineTo(x+w*.86,y+h*.9);c.strokeStyle='#96705a';c.lineWidth=2;c.stroke();c.setLineDash([])
  if(labels){
    text(c,'驻地区',x+w*.15,y+h*.17,15,'#809175',600)
    text(c,'河谷地带',x+w*.48,y+h*.40,13,'#91aaa0')
    text(c,'前线区域',x+w*.89,y+h*.92,13,'#b59073',600)
  }
  c.restore();brackets(c,x,y,w,h,C.olive)
}
export function baseRegionMap(c,w,h,bounds={x:0,y:0,w,h},landmarks=[],territories=landmarks.filter(p=>p.type==='base'),view=bounds){
  const right=bounds.x+bounds.w,bottom=bounds.y+bounds.h
  const viewLeft=Math.max(bounds.x,view.x-280),viewTop=Math.max(bounds.y,view.y-280)
  const viewRight=Math.min(right,view.x+view.w+280),viewBottom=Math.min(bottom,view.y+view.h+280)
  box(c,bounds.x,bounds.y,bounds.w,bounds.h,'#24352a',0,C.line)
  poly(c,[[bounds.x,bounds.y],[1000,bounds.y],[830,80],[250,180],[bounds.x,0]],'#2c402f')
  poly(c,[[2400,bounds.y],[right,bounds.y],[right,700],[3280,480],[3000,100]],'#2d4030')
  poly(c,[[bounds.x,1200],[100,1450],[500,1900],[900,bottom],[bounds.x,bottom]],'#30412d')
  poly(c,[[2750,1800],[3400,1550],[right,1680],[right,bottom],[2500,bottom]],'#3a4430')
  // 用林地与田地块面铺出根据地周边。
  poly(c,[[0,0],[1200,0],[1060,360],[480,530],[0,390]],'#2c3e2d')
  poly(c,[[2140,0],[w,0],[w,780],[2700,680],[2420,380]],'#2d402f')
  poly(c,[[0,1450],[650,1330],[1210,1560],[1340,h],[0,h]],'#2c3d2c')
  poly(c,[[2230,1520],[2710,1350],[w,1460],[w,h],[2100,h]],'#2b3c2e')
  for(let x=Math.ceil(viewLeft/100)*100;x<=viewRight;x+=100)line(c,x,viewTop,x,viewBottom,'#304236')
  for(let y=Math.ceil(viewTop/100)*100;y<=viewBottom;y+=100)line(c,viewLeft,y,viewRight,y,'#304236')
  // 控制区在地面层绘制，随后再绘制植被、山脉、田地、道路和点位。
  controlRegions(c,territories,landmarks)
  for(const [x,y] of [[380,300],[480,360],[630,250],[2570,310],[2680,400],[2810,330],[450,1580],[590,1650],[2660,1600],[2820,1550],[-250,250],[-120,330],[-210,1190],[-90,1340],[620,-100],[820,-140],[2680,-80],[2950,-120],[3350,330],[3440,440],[3410,1830],[3260,1930],[670,1980],[820,2040]]){
    poly(c,[[x,y-35],[x-24,y+13],[x+24,y+13]],'#536248');line(c,x,y+9,x,y+28,'#748060',5)
  }
  // 固定地形网格的起点，让扩图和拖动画面不会移动原有景物。
  const terrainX=-2300,terrainY=-1285
  const firstRow=Math.ceil((Math.max(viewTop,bounds.y+140)-terrainY)/280)
  const firstCol=Math.ceil((Math.max(viewLeft,bounds.x+100)-terrainX)/320)
  for(let row=firstRow,y=terrainY+row*280;y<Math.min(bottom-60,viewBottom);row++,y+=280)for(let col=firstCol,x=terrainX+col*320;x<Math.min(right-50,viewRight);col++,x+=320){
    const px=x+Math.sin(row*7+col*3)*60,py=y+Math.cos(col*5+row*2)*45
    if(landmarks.some(p=>Math.hypot(p.x-px,p.y-py)<190))continue
    const kind=((row*11+col*7)%5+5)%5
    if(kind===0){
      for(let peak=0;peak<2;peak++){const mx=px+peak*49,my=py+peak*13;poly(c,[[mx-43,my+29],[mx,my-48],[mx+50,my+29]],'#818780');poly(c,[[mx,my-48],[mx+12,my+29],[mx+50,my+29]],'#555d59');line(c,mx-10,my-29,mx,my-48,'#bcc1b9',2)}
    }else if(kind<=2){
      for(let tree=0;tree<5;tree++){const tx=px+(tree%3)*27-27,ty=py+Math.floor(tree/3)*32;line(c,tx,ty,tx,ty+23,'#687650',4);poly(c,[[tx,ty-35],[tx-19,ty+7],[tx+19,ty+7]],'#42643e');poly(c,[[tx,ty-18],[tx-23,ty+15],[tx+23,ty+15]],'#4d7247')}
    }else if(kind===3){
      for(let bush=0;bush<4;bush++){const bx=px+bush*19-28,by=py+(bush%2)*8;circle(c,bx,by,13,'#4b6940');circle(c,bx+6,by-5,9,'#5c7849')}
    }else for(let stem=0;stem<7;stem++){const gx=px+stem*10-30,gy=py+(stem%3)*6;line(c,gx,gy,gx-4,gy-13,'#71845a',2);line(c,gx,gy,gx+5,gy-10,'#5e794f',2)}
  }
  for(const site of landmarks.filter(p=>p.strategic&&p.x>=viewLeft&&p.x<=viewRight&&p.y>=viewTop&&p.y<=viewBottom)){
    if(site.type==='mountain')for(const [dx,dy,size] of [[-75,25,85],[20,-15,115],[100,35,65]]){
      const x=site.x+dx,y=site.y+dy;poly(c,[[x-size*.6,y+size*.4],[x,y-size],[x+size*.65,y+size*.4]],'#818780');poly(c,[[x,y-size],[x+size*.15,y+size*.4],[x+size*.65,y+size*.4]],'#555d59')
    }else if(site.type==='forest')for(const [dx,dy] of [[-110,-50],[-40,-95],[50,-70],[110,-10],[-85,65],[30,85]])tree(c,site.x+dx,site.y+dy,45,'#4d7247')
    else if(site.type==='river'){
      const river=()=>{c.beginPath();c.moveTo(site.x-200,site.y-100);c.bezierCurveTo(site.x+100,site.y-180,site.x-110,site.y+170,site.x+210,site.y+90)}
      river();c.strokeStyle='#234e70';c.lineWidth=50;c.stroke();river();c.strokeStyle='#68a8d1';c.lineWidth=7;c.stroke()
    }
  }
  text(c,'北部林地',1600,220,27,'#71836a',500,'center')
  text(c,'南部农田',1600,1640,27,'#71836a',500,'center')
  text(c,'西岭林地',-170,850,24,'#71836a',500,'center')
  text(c,'北山林场',1600,-150,26,'#71836a',500,'center')
  text(c,'东部荒野',3400,1000,24,'#8b916f',500,'center')
  text(c,'南部旷野',1600,2010,26,'#8b916f',500,'center')
  if(bounds.x<-2000){
    text(c,'北方雪原',1250,-1250,30,'#8b916f',500,'center')
    text(c,'南方水乡',2600,3110,30,'#8b916f',500,'center')
    text(c,'西部高原',-1480,960,28,'#8b916f',500,'center')
    text(c,'东部海岸',4620,1480,28,'#8b916f',500,'center')
  }
}
let controlGeometryKey='',controlGeometry
export function controlRegions(c,sites,landmarks){
  const key=JSON.stringify([sites,landmarks])
  if(key!==controlGeometryKey){controlGeometry=controlRegionGeometry(sites,undefined,landmarks);controlGeometryKey=key}
  // 同向复合路径只填一次：连接处不会颜色叠深，也不会出现内部边界。
  c.save();c.beginPath()
  for(const points of controlGeometry.polygons){
    points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath()
  }
  c.fillStyle='rgba(151,48,40,.34)';c.fill()
  c.beginPath()
  for(const [a,b] of controlGeometry.boundary){c.moveTo(a.x,a.y);c.lineTo(b.x,b.y)}
  c.strokeStyle='#b76457';c.lineWidth=3;c.lineCap='round';c.stroke();c.restore()
  const base=sites.find(site=>site.type==='base')
  if(base)text(c,'根据地区域',base.x,base.y+235,23,'#d88a78',600,'center')
}
export function villageFields(c,fields,activeFields){
  for(const field of fields){
    const x=field.x-field.w/2,y=field.y-field.h/2,working=activeFields.has(field.id)
    box(c,x,y,field.w,field.h,working?'#5b6534':'#465431',3,working?C.gold:'#7d8c50')
    for(let row=12;row<field.h-5;row+=18){
      line(c,x+8,y+row,x+field.w-8,y+row,working?'#9b9d57':'#7c8d4e',3)
      for(let stem=15;stem<field.w-8;stem+=23)line(c,x+stem,y+row,x+stem+5,y+row-6,'#93a464',2)
    }
  }
}
export function regionRoads(c,roads,location,view){
  const visible=roads.flatMap(road=>{
    const from=location(road.from),to=road.end||location(road.to)
    if(view){
      const [x1,y1,x2,y2]=road.controls,margin=10
      if(Math.max(from.x,to.x,x1,x2)<view.x-margin||Math.min(from.x,to.x,x1,x2)>view.x+view.w+margin||
         Math.max(from.y,to.y,y1,y2)<view.y-margin||Math.min(from.y,to.y,y1,y2)>view.y+view.h+margin)return []
    }
    return [{road,from,to}]
  })
  c.save();c.lineCap='round';c.lineJoin='round'
  // 分层绘制全部道路，让乡道交汇处保持连续。
  for(const [color,width] of [['#18261c',19],['#766d4f',9],['#a0966c',2]]){
    c.strokeStyle=color;c.lineWidth=width
    for(const {road,from,to} of visible){
      c.lineWidth=road.outskirts?width*.7:width
      c.beginPath();c.moveTo(from.x,from.y)
      c.bezierCurveTo(...road.controls,to.x,to.y);c.stroke()
    }
  }
  c.restore()
}
export function mapFlag(c,x,y,color,height=44){
  const poleX=x-17,top=y-height
  line(c,poleX,top,poleX,y,'#c9c5af',3)
  poly(c,[[poleX,top],[poleX+34,top+4],[poleX+29,top+24],[poleX,top+21]],color)
}
export function icon(c,type,x,y,size=28,color=C.ink){
  c.save();c.translate(x,y);c.scale(size/28,size/28);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=1.8;c.lineJoin='round';c.lineCap='round';
  const path=points=>{c.beginPath();points.forEach(([a,b],i)=>i?c.lineTo(a,b):c.moveTo(a,b));c.stroke()}
  if(type==='warehouse'){path([[-11,-4],[0,-12],[11,-4],[11,11],[-11,11],[-11,-4]]);path([[-6,11],[-6,1],[6,1],[6,11]]);path([[-6,5],[6,5]])}
  else if(type==='shop'){path([[-10,-5],[-8,-11],[8,-11],[11,-5],[-10,-5],[-10,11],[10,11],[10,-5]]);path([[-3,11],[-3,3],[4,3],[4,11]]);path([[-11,-1],[11,-1]])}
  else if(type==='formation'){box(c,-5,-12,10,7,null,1,color);path([[0,-5],[0,0],[-9,0],[-9,5]]);path([[0,0],[9,0],[9,5]]);box(c,-14,5,10,7,null,1,color);box(c,4,5,10,7,null,1,color)}
  else if(type==='army'){c.beginPath();c.arc(0,-5,7,Math.PI,Math.PI*2);c.stroke();path([[-9,-4],[9,-4]]);path([[-5,-2],[-4,4],[0,7],[4,4],[5,-2]]);path([[-11,13],[-10,8],[-5,6],[0,11],[5,6],[10,8],[11,13]])}
  else if(type==='tasks'){path([[-8,-11],[8,-11],[8,12],[-8,12],[-8,-11]]);path([[-4,-4],[-1,-1],[5,-7]]);path([[-4,5],[4,5]])}
  else if(type==='settings'){for(let i=0;i<8;i++){const a=i*Math.PI/4;line(c,Math.cos(a)*8,Math.sin(a)*8,Math.cos(a)*12,Math.sin(a)*12,color,3)}c.beginPath();c.arc(0,0,8,0,Math.PI*2);c.stroke();circle(c,0,0,3,color)}
  else if(type==='ammo'){for(const dx of [-7,0,7]){path([[dx-2,10],[dx-2,-5],[dx,-11],[dx+2,-5],[dx+2,10],[dx-2,10]]);line(c,dx-2,5,dx+2,5,color)}}
  else if(type==='shell'){path([[-6,11],[-6,-4],[0,-13],[6,-4],[6,11],[-6,11]]);line(c,-9,11,9,11,color,3);line(c,-6,4,6,4,color,2)}
  else if(type==='grenade'){box(c,-8,-3,16,17,null,5,color);box(c,-4,-9,8,6,null,1,color);path([[0,-10],[8,-10],[10,-5]]);line(c,-7,3,7,3,color);line(c,0,-2,0,12,color)}
  else if(type==='bandage'){c.rotate(-.55);box(c,-13,-6,26,12,null,4,color);box(c,-5,-5,10,10,null,1,color);circle(c,-9,0,1,color);circle(c,9,0,1,color)}
  else if(type==='medical'){box(c,-11,-8,22,19,null,2,color);path([[-5,-8],[-5,-12],[5,-12],[5,-8]]);line(c,-5,1,5,1,color,3);line(c,0,-4,0,6,color,3)}
  else if(type==='target'){c.beginPath();c.arc(0,0,9,0,Math.PI*2);c.stroke();line(c,-14,0,14,0,color);line(c,0,-14,0,14,color);circle(c,0,0,3,color)}
  else if(type==='lock'){box(c,-8,-1,16,13,null,2,color);c.beginPath();c.arc(0,-1,5,Math.PI,Math.PI*2);c.stroke();circle(c,0,5,1.5,color)}
  else if(type==='flag'){path([[-8,13],[-8,-12],[10,-12],[5,-5],[10,1],[-8,1]])}
  else if(type==='village'){path([[-12,0],[-4,-7],[4,0],[4,11],[-12,11],[-12,0]]);path([[1,-4],[6,-10],[13,-3],[13,8],[7,8]]);path([[-7,11],[-7,4],[-2,4],[-2,11]])}
  else if(type==='city'){path([[-13,12],[-13,-11],[-8,-11],[-8,-5],[-3,-5],[-3,-11],[3,-11],[3,-5],[8,-5],[8,-11],[13,-11],[13,12],[-13,12]]);path([[-4,12],[-4,4],[0,1],[4,4],[4,12]]);path([[-8,-1],[-8,3]]);path([[8,-1],[8,3]])}
  else if(type==='mountain'){path([[-13,10],[-3,-12],[7,10],[-13,10]]);path([[2,-1],[8,-8],[14,10],[7,10]]);path([[-7,-3],[-3,-1],[0,-4]])}
  else if(type==='forest'){for(const dx of [-7,6]){path([[dx,12],[dx,5]]);path([[dx,-12],[dx-6,0],[dx-3,0],[dx-8,7],[dx+8,7],[dx+3,0],[dx+6,0],[dx,-12]])}}
  else if(type==='river'){for(const dy of [-8,0,8]){c.beginPath();c.moveTo(-13,dy);c.bezierCurveTo(-5,dy-7,5,dy+7,13,dy);c.stroke()}}
  else if(type==='fish'){
    c.beginPath();c.moveTo(-8,0);c.bezierCurveTo(-2,-9,8,-9,13,0);c.bezierCurveTo(8,9,-2,9,-8,0);c.stroke()
    path([[-8,0],[-14,-6],[-14,6],[-8,0]]);circle(c,8,-2,1.3,color)
  }
  else if(type==='coin'){c.beginPath();c.arc(0,0,11,0,Math.PI*2);c.stroke();text(c,'G',0,1,14,color,700,'center')}
  else if(type==='grain'){path([[-8,12],[-9,-3],[-5,-7],[5,-7],[9,-3],[8,12],[-8,12]]);path([[-6,-7],[-8,-12],[7,-12],[5,-7]]);path([[0,7],[0,-3]]);path([[0,2],[-4,-1]]);path([[0,5],[4,1]])}
  else if(type==='corn'){c.beginPath();c.ellipse(0,-1,6,12,.3,0,Math.PI*2);c.stroke();path([[-9,4],[0,12],[10,1]]);for(const y of [-7,-2,3])line(c,-3,y,4,y,color)}
  else if(type==='meat'){c.beginPath();c.ellipse(0,0,12,8,-.4,0,Math.PI*2);c.stroke();circle(c,4,-1,3,color);path([[-8,2],[-2,-3],[2,5]])}
  else if(type==='salt'){box(c,-8,-8,16,20,null,2,color);box(c,-6,-12,12,4,null,1,color);text(c,'盐',0,2,11,color,600,'center')}
  else if(type==='oil'){path([[-4,-12],[4,-12],[4,-6],[9,-3],[9,12],[-9,12],[-9,-3],[-4,-6],[-4,-12]]);path([[-5,1],[5,1]]);path([[0,2],[-3,7],[0,10],[3,7],[0,2]])}
  else if(type==='egg'){c.beginPath();c.ellipse(-4,2,6,10,-.25,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(6,-1,6,10,.25,0,Math.PI*2);c.stroke()}
  else if(type==='arrow'){path([[-10,0],[10,0],[4,-6]]);path([[10,0],[4,6]])}
  else if(type==='close'){path([[-7,-7],[7,7]]);path([[7,-7],[-7,7]])}
  else if(type==='kitchen'){path([[-13,-3],[13,-3],[10,10],[-10,10],[-13,-3]]);line(c,13,0,19,0,color,2);path([[-8,-3],[-8,-8],[8,-8],[8,-3]]);path([[-6,13],[-3,17],[0,13],[3,17],[6,13]])}
  else if(type==='meal'){path([[-12,1],[12,1],[8,13],[-8,13],[-12,1]]);line(c,-14,1,14,1,color,2);path([[-5,-3],[-8,-8],[-4,-12]]);path([[1,-3],[-1,-8],[3,-12]])}
  else if(type==='shield'){path([[-10,-9],[0,-13],[10,-9],[9,3],[0,13],[-9,3],[-10,-9]]);path([[-4,0],[0,5],[5,-5]])}
  c.restore()
}
function tree(c,x,y,s,color){line(c,x,y,x,y+s*0.6,'#697262',2);poly(c,[[x,y-s],[x-s*.46,y],[x+s*.46,y]],color);poly(c,[[x,y-s*.6],[x-s*.6,y+s*.3],[x+s*.6,y+s*.3]],color)}
export function tank(c,x,y,s,color,angle=0){
  c.save();c.translate(x,y);c.rotate(angle);c.scale(s,s);box(c,-22,-15,44,30,'#263a31',5);box(c,-19,-18,38,7,'#1f302a',2);box(c,-19,11,38,7,'#1f302a',2);box(c,-19,-11,38,22,color,3);box(c,-9,-9,21,18,'#94a071',4);box(c,3,-3,33,6,'#b1b593',1);line(c,-16,-7,-9,-7,'#c0c4a0');c.restore()
}
export function weaponArt(c,id,x,y,scale=1,color=C.olive){
  c.save();c.translate(x,y);c.scale(scale,scale)
  if(id==='rifle'){
    // 三八式长步枪侧影：通长木护木、直枪托、枪机盖和细长外露枪管。
    // 独立绘制，避免沿用现代步枪的手枪握把与外露弹匣轮廓。
    poly(c,[[-67,-1],[-42,-3],[-30,2],[-18,0],[44,0],[46,6],[-19,8],[-31,9],[-43,18],[-66,19]],'#925f36')
    poly(c,[[-64,1],[-43,0],[-31,5],[-20,3],[42,2],[43,4],[-24,6],[-34,7],[-46,14],[-64,15]],'#bc8951')
    line(c,-59,10,-44,7,'#d5a46c',1)
    line(c,-60,15,-47,12,'#714a2b',1)
    // 金属机匣与防尘盖。
    box(c,-24,-6,32,7,'#65736e',1)
    box(c,-20,-8,22,3,'#95a29a',1)
    line(c,-17,-6,-17,-2,'#b8bdb0',1)
    line(c,-23,-3,-29,3,'#b1b7a9',2)
    circle(c,-30,4,2.5,'#9da99d')
    // 护木、箍环、准星和枪口。
    box(c,8,-3,38,4,'#a67a45',1)
    box(c,45,-3,30,3,'#a1aea4',0)
    box(c,72,-5,4,6,'#6f8075',0)
    box(c,69,-8,3,5,'#bcc3b4',0)
    box(c,14,-5,3,12,'#6d796e',0)
    box(c,42,-4,4,11,'#7e8b7c',0)
    box(c,6,-7,8,3,'#a7b1a3',0)
    line(c,19,8,68,8,'#8e9a8b',1)
    // 扳机护圈和枪托底板。
    c.strokeStyle='#a5af9d';c.lineWidth=1.5;c.beginPath();c.ellipse(-17,10,7,4,0,0,Math.PI);c.stroke()
    line(c,-18,8,-16,11,'#c4c8b8',1)
    line(c,-67,-1,-66,19,'#8d9b8b',2)
  }else if(id==='pistol'){
    box(c,-32,-14,66,15,color,2);box(c,27,-12,10,10,'#9da88c',1)
    poly(c,[[-23,0],[-2,0],[-9,32],[-31,29]],'#788663')
    c.strokeStyle=color;c.lineWidth=3;c.strokeRect(-2,1,18,13)
    line(c,-24,-9,27,-9,'#d4ddc5',2);box(c,-24,-19,6,5,color,1)
  }else if(id==='mortar'){
    box(c,-32,22,66,7,'#67765b',2);line(c,-9,24,7,-20,color,12);line(c,4,-18,15,-34,color,13)
    line(c,8,-4,29,24,'#a3ac8a',4);line(c,8,-4,-20,24,'#a3ac8a',4);box(c,8,-38,15,7,'#c3cbaa',1)
  }else{
    const sniper=id==='sniper',mg=id==='machinegun'
    poly(c,[[-57,-7],[-34,-7],[-27,0],[-38,9],[-57,14]],'#71805c')
    box(c,-34,-9,57,17,color,2);box(c,21,-5,sniper?47:34,7,'#9da88c',1);box(c,sniper?65:53,-7,8,11,'#6a785d',1)
    poly(c,[[-20,6],[-8,6],[-13,24],[-24,22]],'#788663')
    if(mg){box(c,-2,7,24,25,'#a29261',2);line(c,30,1,22,25,'#95a580',3);line(c,30,1,42,25,'#95a580',3)}
    else poly(c,[[0,6],[13,6],[10,24],[0,21]],'#98a584')
    if(sniper){box(c,-21,-23,37,9,'#aab69b',2);line(c,-12,-14,-12,-8,'#8d9a80',3);line(c,9,-14,9,-8,'#8d9a80',3)}
    else{box(c,-18,-14,14,5,'#a5af91',1);box(c,28,-11,4,8,'#9eaa90',1)}
    line(c,-26,-3,10,-3,'#e1e5bc',1)
  }
  c.restore()
}
function bunker(c,x,y,s,color){
  c.save();c.translate(x,y);c.scale(s,s);poly(c,[[-42,-10],[10,-30],[49,-8],[-3,13]],'#c0c2a6');poly(c,[[-42,-10],[-3,13],[-3,39],[-42,16]],color);poly(c,[[-3,13],[49,-8],[49,18],[-3,39]],'#53614d');box(c,9,13,22,7,'#273b32');line(c,-32,6,-15,16,'#354535',5);c.restore()
}
export function cardArt(c,mode,x,y,w,h){
  c.save();c.translate(x,y);c.beginPath();c.rect(0,0,w,h);c.clip();c.scale(w/400,h/300)
  const pal=mode==='campaign'?['#344631','#425735','#243c2c']:mode==='recruitment'?['#4a4933','#696141','#393e2b']:['#253e42','#385758','#243e47']
  box(c,0,0,400,300,pal[0]);
  for(let j=0;j<5;j++){c.strokeStyle='rgba(255,255,240,.24)';c.lineWidth=1;c.beginPath();for(let i=0;i<440;i+=8){const py=50+j*48+Math.sin(i/68+j)*24;i?c.lineTo(i,py):c.moveTo(i,py)}c.stroke()}
  poly(c,[[0,150],[100,85],[220,150],[310,100],[400,140],[400,300],[0,300]],pal[1]);
  poly(c,[[0,260],[120,200],[210,240],[330,170],[400,220],[400,300],[0,300]],pal[2]);
  if(mode==='campaign'){
    commandMap(c,0,0,400,300,false)
    const sites=[[49,213],[128,156],[205,204],[282,104],[349,141]]
    c.save();c.setLineDash([5,5]);c.strokeStyle='#c1b080';c.lineWidth=3;c.beginPath();sites.forEach(([px,py],i)=>i?c.lineTo(px,py):c.moveTo(px,py));c.stroke();c.restore()
    sites.forEach(([px,py],i)=>{
      circle(c,px,py,13,'#102219');c.beginPath();c.arc(px,py,13,0,Math.PI*2);c.strokeStyle=i===sites.length-1?C.gold:C.olive;c.lineWidth=2;c.stroke()
      circle(c,px,py,4,i===sites.length-1?C.gold:C.olive)
    })
    line(c,365,42,365,75,C.olive,2);poly(c,[[365,31],[359,45],[371,45]],C.olive);text(c,'N',365,19,12,C.olive,700,'center')
  }else if(mode==='recruitment'){
    poly(c,[[0,251],[150,179],[400,210],[400,258],[155,224],[25,300]],'#8e8056')
    box(c,21,110,102,75,'#7f805c',2);poly(c,[[9,112],[71,66],[135,112]],'#b8b18a')
    box(c,60,137,24,48,'#3e4a36',1);box(c,29,125,20,20,'#b0b78c',1)
    line(c,172,46,172,192,'#c1c39b',4);poly(c,[[174,48],[223,61],[174,83]],'#d6b365')
    line(c,235,118,235,216,'#9b9f79',5);line(c,354,118,354,216,'#9b9f79',5)
    box(c,222,84,143,75,'#c4be97',3,'#d8d2aa');box(c,229,91,129,61,'#3e5037',1)
    text(c,'报名处',294,120,30,'#e4dfba',700,'center')
    box(c,220,193,151,12,'#c0ad7e',2);box(c,230,204,10,39,'#7f805c',1);box(c,351,204,10,39,'#7f805c',1)
    box(c,263,184,32,9,'#ddd4af',1);line(c,271,188,287,188,'#8c946d')
    for(let i=0;i<5;i++){
      const x=54+i*35,y=238-i*10
      box(c,x-10,y-4,21,29,i%2?'#9ba77b':'#7d9466',4)
      circle(c,x,y-16,10,'#c5b38d');line(c,x-5,y+24,x-7,y+37,'#43553b',5);line(c,x+5,y+24,x+8,y+37,'#43553b',5)
    }
    icon(c,'army',321,177,39,'#9fb982')
  }else if(mode==='base'){
    // 根据地插画包含操场、农田与营房。
    poly(c,[[0,190],[400,145],[400,300],[0,300]],'#526641')
    for(let i=0;i<6;i++)line(c,8+i*27,300,130+i*27,191,'#a7a46a',5)
    box(c,220,109,140,89,'#8b9470',2);poly(c,[[207,111],[289,63],[374,111]],'#bcc29b')
    box(c,272,146,30,52,'#354b39',1);box(c,234,132,24,22,'#b9c7a3',1);box(c,316,132,24,22,'#b9c7a3',1)
    line(c,190,62,190,204,'#b6c49b',4);poly(c,[[192,63],[238,77],[192,95]],'#b95e43')
    for(let i=0;i<3;i++)icon(c,'army',244+i*45,243,31,'#c5d2a9')
  }else{
    box(c,0,117,400,183,'#486352');poly(c,[[0,143],[400,107],[400,137],[0,174]],'#82987a')
    for(let i=0;i<3;i++){
      const x=190+i*77,y=102+i*13
      line(c,x,y+35,x,y+105,'#b1b996',5);box(c,x-20,y-20,40,66,'#c8c9aa',6)
      circle(c,x,y+12,15,'#4c6454');circle(c,x,y+12,8,'#b4c4ae');circle(c,x,y+12,3,'#4c6454')
      text(c,`${i+1}00 M`,x,y+128,10,'#b9c8b3',600,'center')
    }
    for(let i=0;i<6;i++){const x=40+(i%3)*37,y=205+Math.floor(i/3)*42;circle(c,x,y+6,12,'#263e30');circle(c,x,y,10,'#93ac78');line(c,x+3,y,x+24,y-3,'#c1cbb0',4)}
    c.setLineDash([4,6]);line(c,8,178,390,146,'#b8c4a0',2);c.setLineDash([])
  }
  // 侦察屏的暗角、扫描纹理和目标标记。
  const shade=c.createLinearGradient(0,0,0,300);shade.addColorStop(0,'rgba(6,17,11,.12)');shade.addColorStop(.6,'rgba(6,17,11,.08)');shade.addColorStop(1,'rgba(6,17,11,.72)');box(c,0,0,400,300,shade)
  for(let py=0;py<300;py+=4)line(c,0,py,400,py,'rgba(4,15,9,.11)')
  for(let px=0;px<400;px+=50)line(c,px,0,px,300,'rgba(190,215,165,.07)')
  if(mode!=='recruitment'&&mode!=='campaign'){brackets(c,232,90,70,69,'#cbd5a5');circle(c,267,124,2,'#e0bb6a')}
  for(let i=0;i<9;i++)line(c,12+i*45,289,12+i*45,294,'#96aa7f',1)
  text(c,mode==='campaign'?'N 35° 42′ / E 108° 56′':mode==='recruitment'?'VILLAGE / VOLUNTEER ENLISTMENT':'BASE AREA / COMMAND CENTER',66,282,9,'#c6d1b9',600)
  c.restore()
}
export function background(c){
  box(c,0,0,1440,810,C.paper)
  // 固定迷彩块与战术坐标网格，不增加持续动画开销。
  for(let i=0;i<16;i++){const x=(i*263)%1440,y=(i*197)%810;poly(c,[[x,y],[x+110,y-25],[x+205,y+65],[x+150,y+122],[x+15,y+90]],i%2?'#152019':'#182119')}
  for(let x=0;x<1440;x+=40)line(c,x,106,x,810,'rgba(142,165,119,.06)')
  for(let y=106;y<810;y+=40)line(c,0,y,1440,y,'rgba(142,165,119,.06)')
  c.save();c.globalAlpha=.25
  for(let i=0;i<6;i++){c.strokeStyle='#799264';c.lineWidth=1;c.beginPath();c.arc(1250,179,35+i*27,0,Math.PI*2);c.stroke()}
  line(c,1040,179,1440,179,'#799264');line(c,1250,106,1250,360,'#799264')
  c.restore();box(c,0,0,1440,106,'#111a15');line(c,0,106,1440,106,C.line)
  box(c,0,104,410,2,C.olive)
  for(let x=48;x<1392;x+=12)line(c,x,793,x+5,788,'#526148',2)
}
