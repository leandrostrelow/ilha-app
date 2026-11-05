import {EDGES,NODES,BUILDINGS,TREES,WORLD_SIZE,COURTS,SAND_COURTS,PICKLEBALL,ABANDONED_COURT,hash,waterAt,terrainAt} from './scenery-data.js';
import {clubCured} from './halloween-state.js';
import {drawHalloweenSprite} from './halloween-sprites.js';
const rect=(c,color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));};
function oval(c,color,x,y,rx,ry){for(let j=-Math.ceil(ry);j<=ry;j++){const r=Math.floor(rx*Math.sqrt(Math.max(0,1-j*j/(ry*ry))));rect(c,color,x-r,y+j,r*2+1,1);}}
export function pumpkin(c,x,y,size=1,t=0,variant='pumpkin'){if(drawHalloweenSprite(c,variant,x,y,size))return;c.save();c.translate(Math.round(x),Math.round(y));c.scale(size,size);oval(c,'#060d1880',2,1,13,4);oval(c,'#703921',0,-9,12,11);oval(c,'#bc5c29',0,-10,11,10);oval(c,'#ee8c32',-2,-11,9,9);oval(c,'#ffc459',-5,-13,3,6);rect(c,'#b45825',0,-19,2,17);rect(c,'#71905b',-2,-25,4,7);rect(c,'#b8b568',-1,-25,3,2);rect(c,'#c5ff91',-7,-14,4,4);rect(c,'#c5ff91',4,-14,4,4);rect(c,'#693124',-6,-6,13,4);rect(c,'#c5ff91',-4,-5,9,2);rect(c,'#c5ff91',-6,-7,2,3);rect(c,'#c5ff91',7,-7,2,3);c.restore();}
function candle(c,x,y,t,size=1,variant='candle'){if(drawHalloweenSprite(c,variant,x,y,size))return;rect(c,'#272137',x-5,y-2,11,3);rect(c,'#e6d5b0',x-3,y-13,6,12);rect(c,'#ac9c92',x+1,y-12,2,9);rect(c,'#9eed65',x-3,y-21+Math.sin(t*6+x),6,8);rect(c,'#e6ffbe',x-1,y-20,2,6);}
function web(c,x,y,size=35,flip=1){
 c.save();c.translate(Math.round(x),Math.round(y));c.scale(flip,1);
 const spokes=7,point=(i,r)=>{const angle=i*Math.PI/(2*(spokes-1));return [Math.cos(angle)*r,Math.sin(angle)*r];};
 // Concave silk rings, irregular gaps and small dew glints; no opaque white net.
 for(const [color,width]of [['#1b173b66',1.5],['#cbbfdb80',.65]]){
  c.strokeStyle=color;c.lineWidth=width;
  for(let i=0;i<spokes;i++){const [px,py]=point(i,size-(i%3)*2);c.beginPath();c.moveTo(0,0);c.lineTo(px,py);c.stroke();}
  for(let r=8;r<size;r+=7){c.beginPath();const start=point(0,r);c.moveTo(...start);for(let i=1;i<spokes;i++){const a=point(i-1,r),b=point(i,r);c.quadraticCurveTo((a[0]+b[0])*.455,(a[1]+b[1])*.455,...b);}c.stroke();}
 }
 for(let i=1;i<spokes-1;i+=2){const [px,py]=point(i,size*.72);rect(c,'#e5d4f1b3',px,py,1,1);}
 // One tiny hanging spider near the outer edge of larger roof webs.
 if(size>40){const [px,py]=point(4,size*.7);c.strokeStyle='#b0a4c066';c.lineWidth=.6;c.beginPath();c.moveTo(px,py);c.lineTo(px,py+10);c.stroke();oval(c,'#242034',px,py+12,2,3);rect(c,'#795684',px-1,py+11,1,1);}
 c.restore();
}
function grave(c,x,y,variant){if(drawHalloweenSprite(c,'grave',x,y,.88+(variant%3)*.08,{flip:Boolean(variant%2)}))return;oval(c,'#0c152766',x+2,y+2,15,5);rect(c,'#293445',x-10,y-21,21,22);rect(c,'#727b83',x-9,y-26,18,26);rect(c,'#a6acac',x-7,y-28,14,5);rect(c,'#909ba2',x-7,y-22,14,18);rect(c,'#414957',x-1,y-21,2,13);rect(c,'#414957',x-5,y-17,10,2);rect(c,'#72885e',x-13,y-1,26,3);rect(c,'#b5b187',x+5,y-5,2,5);if(variant%2)web(c,x-7,y-22,17);}
function ghost(c,x,y,t){const bob=Math.sin(t*1.6+x)*2;if(drawHalloweenSprite(c,'ghost',x,y-5+bob,1,{alpha:.82,flip:Boolean(Math.round(x)%2)}))return;c.save();c.translate(x,y+bob);rect(c,'#161f3944',-11,0,22,3);rect(c,'#b8c6d0',-10,-28,20,22);rect(c,'#e3e4d9',-7,-33,14,6);rect(c,'#d6dbe0',-12,-25,23,13);for(let i=-10;i<12;i+=7)rect(c,'#c5d4dc',i,-7,4,6);rect(c,'#283040',-6,-23,4,6);rect(c,'#283040',3,-23,4,6);rect(c,'#4b4a60',-2,-12,4,4);c.restore();}
function bat(c,x,y,t,scale=1){const up=Math.sin(t*9+x)>0;if(scale>.6&&drawHalloweenSprite(c,up?'bat-up':'bat-down',x,y+8,scale))return;c.save();c.translate(x,y);c.scale(scale,scale);const lift=up?-4:1;rect(c,'#111426',-2,-3,5,7);for(const d of [-1,1]){rect(c,'#171a30',d>0?3:-12,-4+lift,9,4);rect(c,'#363147',d>0?5:-9,-1+lift,5,3);rect(c,'#111426',d>0?9:-13,-7+lift,3,5);}rect(c,'#d79876',-1,-2,1,1);rect(c,'#d79876',2,-2,1,1);c.restore();}
export const DECORATIONS=[];
for(const [edgeIndex,[a,b,width]] of EDGES.entries()){
 const A=NODES[a],B=NODES[b],len=Math.hypot(B[0]-A[0],B[1]-A[1]);if(len<58)continue;
 for(let d=25;d<len;d+=90){const sign=(Math.floor(d/90)+edgeIndex)%2?1:-1,nx=-(B[1]-A[1])/len,ny=(B[0]-A[0])/len,x=A[0]+(B[0]-A[0])*d/len+nx*(width+3)*sign,y=A[1]+(B[1]-A[1])*d/len+ny*(width+3)*sign;
  const seed=hash(Math.round(x),Math.round(y));
  DECORATIONS.push({type:'decor',propType:edgeIndex%4===0?(seed%2?'lantern':'candle'):seed%4===0?'gourd':'pumpkin',x,y,scale:.7+(edgeIndex%3)*.15});
 }
}
for(const [x,y] of [[63,744],[170,722],[278,755],[36,850],[319,832],[92,944],[310,943],[1117,881],[1240,885],[1068,971],[991,1287],[449,1290],[476,360],[244,368]])DECORATIONS.push({type:'decor',propType:'grave',x,y});
for(const [x,y] of [[478,509],[758,349],[982,458],[410,1110],[1104,723],[1100,1112],[332,478],[290,360],[476,540],[710,450],[866,695],[345,810],[335,955],[550,1005],[990,1160],[530,1310],[1110,910],[1210,715]])DECORATIONS.push({type:'decor',propType:'ghost',x,y});
// Small focal arrangements on grass beside the bar and the old cabin.
for(const [propType,x,y,scale]of [['pumpkin',257,698,.9],['lantern',443,704,.85],['pumpkin',1220,914,.9],['lantern',1134,910,.85]])DECORATIONS.unshift({type:'decor',propType,x,y,scale});
export function decorationTouchesCourt(o){
 const {x,y,w,h}=ABANDONED_COURT;
 const areas=[...COURTS.map(c=>({x:c.x-15,y:c.y-25,w:c.width+30,h:c.height+50})),...SAND_COURTS,{...PICKLEBALL},{x:x+28,y:y+28,w:w-56,h:h-56}];
 return areas.some(r=>o.x+15>r.x&&o.x-15<r.x+r.w&&o.y+3>r.y&&o.y-42<r.y+r.h);
}
// Stable, conservative visual envelopes: do not depend on image loading order.
export function decorationObscured(o){
 const overlaps=(x,y,w,h)=>o.x+18>x&&o.x-18<x+w&&o.y+5>y&&o.y-42<y+h;
 return BUILDINGS.some(b=>overlaps(b.x-8,b.y-8,b.w+16,b.h+16))||TREES.some(t=>{
  const s=t.scale||1,h=(t.kind==='palm'?150:132)*s;
  return overlaps(t.x-43*s,t.y-h,86*s,h+8);
 });
}
export function decorationsTooClose(a,b){
 const distance=Math.hypot(a.x-b.x,(a.y-b.y)*.85);
 return distance<(a.propType==='grave'&&b.propType==='grave'?94:62);
}
// Spread crowded candidates into nearby open grass, never the main walkways.
// If no clear spot exists, omit the extra rather than stack silhouettes.
const placed=[];
for(const o of [...DECORATIONS].sort((a,b)=>Number(['grave','ghost'].includes(b.propType))-Number(['grave','ghost'].includes(a.propType)))){
 const offsets=[[0,0],...[48,80,112].flatMap(r=>Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4)*r,Math.sin(i*Math.PI/4)*r]))];
 for(const [dx,dy]of offsets){
  const candidate={...o,x:Math.round(o.x+dx),y:Math.round(o.y+dy)};
  if((dx||dy)&&!['grass','lawn'].includes(terrainAt(candidate.x,candidate.y)))continue;
  if(decorationTouchesCourt(candidate)||decorationObscured(candidate)||waterAt(candidate.x,candidate.y)||candidate.x<20||candidate.x>WORLD_SIZE-20||candidate.y<80||candidate.y>WORLD_SIZE-20)continue;
  if(placed.some(p=>decorationsTooClose(candidate,p)))continue;
  placed.push(candidate);break;
 }
}
DECORATIONS.splice(0,DECORATIONS.length,...placed);
// Small webs hang from supported facade corners, never float above a roof.
export const WEB_ANCHORS=BUILDINGS.flatMap(b=>{
 const offset={barwing:73,woodcabin:48,entryhouse:b.h-39}[b.kind];
 if(offset===undefined)return [];
 return [{x:b.x+12,y:b.y+offset,size:25,flip:1},{x:b.x+b.w-12,y:b.y+offset,size:22,flip:-1}];
});
export const HALLOWEEN_LIGHTS=DECORATIONS.filter(d=>['pumpkin','gourd','candle','lantern'].includes(d.propType)).map(d=>({kind:'halloween',x:d.x,y:d.y-12,rx:54,ry:46,power:.72,warm:.16,color:['pumpkin','gourd'].includes(d.propType)?'255,170,79':'169,238,141'}));
export const GARLANDS=[[240,550,478,550],[550,462,720,462],[804,479,976,479],[576,709,975,709],[570,1133,799,1133],[1086,860,1240,860],[904,1287,1011,1264],[965,376,1014,376]];
function garland(c,g,t){
 const [x1,y1,x2,y2]=g,at=f=>[x1+(x2-x1)*f,y1+(y2-y1)*f+4*f*(1-f)*7];
 c.strokeStyle='#171a29';c.lineWidth=2;c.beginPath();c.moveTo(x1,y1);c.quadraticCurveTo((x1+x2)/2,(y1+y2)/2+14,x2,y2);c.stroke();
 c.strokeStyle='#93817c77';c.lineWidth=.6;c.stroke();
 const count=Math.ceil(Math.hypot(x2-x1,y2-y1)/19);
 for(let i=0;i<=count;i++){const [x,y]=at(i/count),color=['#e5b779','#b995da','#b9d78b'][i%3];rect(c,'#32352e',x-1,y,2,4);halo(c,x,y+6,14,color+'40');oval(c,color,x,y+6,2,3);rect(c,'#f4efd0',x-1,y+4,1,2);if(i%4===2){rect(c,'#48404b',x-1,y+9,1,5);bat(c,x,y+18,0,.45);}}
}
function decoration(c,o,t){
 const s=o.scale||1;oval(c,'#130f2460',o.x+3,o.y+1,13*s,4*s);
 if(['pumpkin','gourd'].includes(o.propType)){for(const [dx,dy]of [[-11,0],[9,2]]){rect(c,'#40513d',o.x+dx,o.y+dy,5,2);rect(c,'#687450',o.x+dx+1,o.y+dy,2,1);}pumpkin(c,o.x,o.y,s,t,o.propType);}
 else if(['candle','lantern'].includes(o.propType))candle(c,o.x,o.y,t,s,o.propType);
 else if(o.propType==='grave')grave(c,o.x,o.y,Math.round(o.x));else ghost(c,o.x,o.y,t);
}

const visible=(o,v,pad=75)=>o.x>v.x-pad&&o.x<v.x+v.w+pad&&o.y>v.y-pad&&o.y<v.y+v.h+pad;
export const halloweenProps=camera=>DECORATIONS.filter(o=>visible(o,camera)).map(o=>({...o,halloweenDecor:true}));
export const drawHalloweenProp=(c,o,t)=>decoration(c,o,t);
const halos=new Map();
function halo(c,x,y,r,color){
 // A handful of cached light textures, not a new gradient for every bulb/frame.
 if(typeof document!=='undefined'){
  if(!halos.has(color)){const cv=document.createElement('canvas');cv.width=cv.height=64;const ctx=cv.getContext('2d'),g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,color);g.addColorStop(.4,color.slice(0,7)+'12');g.addColorStop(1,color.slice(0,7)+'00');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);halos.set(color,cv);}
  c.drawImage(halos.get(color),x-r,y-r,r*2,r*2);return;
 }
 const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'#130d2100');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);
}
export function halloweenBatPosition(time,i){return {x:260+i*193+Math.sin(time*.55+i)*48,y:369+i*145+Math.cos(time+i)*13};}
export function drawHalloweenAtmosphere(c,camera,time,match=false){
 c.save();c.fillStyle=clubCured()?'#32104603':'#32104e08';c.fillRect(camera.x,camera.y,camera.w,camera.h);
 for(const g of GARLANDS)if(visible({x:(g[0]+g[2])/2,y:(g[1]+g[3])/2},camera,Math.abs(g[2]-g[0])/2+30))garland(c,g,time);
 for(const anchor of WEB_ANCHORS)if(visible(anchor,camera))web(c,anchor.x,anchor.y,anchor.size,anchor.flip);
 for(const d of DECORATIONS.filter(o=>visible(o,camera)&&['pumpkin','gourd','candle','lantern'].includes(o.propType))){
  const color=d.propType==='pumpkin'?'#efae6033':d.propType==='gourd'?'#b983e32e':'#aeed7836';
  c.save();c.globalAlpha=.91+Math.sin(time*2.5+d.x)*.06;halo(c,d.x,d.y-16*(d.scale||1),34,color);c.restore();
 }
 if(!match)for(let i=0;i<7;i++){const x=230+i*185+Math.sin(time*.35+i)*34,y=380+i*126+Math.cos(time*.25+i)*16;if(visible({x,y},camera,140))halo(c,x,y,95,i%2?'#a370d516':'#80d58014');}
 if(!match)for(let i=0;i<6;i++){const {x,y}=halloweenBatPosition(time,i);if(visible({x,y},camera))bat(c,x,y,time,.8);}
 // Abandoned racket, balls and untouched food are story dressing, not pickups.
 c.strokeStyle='#c6b1dc';c.lineWidth=2;c.beginPath();c.ellipse(937,403,6,9,.8,0,7);c.stroke();rect(c,'#7d9d67',926,411,8,3);
 for(const [x,y]of [[942,417],[954,405],[817,415]]){rect(c,'#bce77a',x,y,4,4);rect(c,'#ebedc6',x,y,2,1);}
 rect(c,'#46322f',832,405,24,15);rect(c,'#ccbcaf',836,407,16,7);rect(c,'#9b54c9',839,409,10,3);
 c.restore();
}
export function drawClue(c,item,t=0){
 const {x,y}=item;c.save();c.translate(x,y);const bob=Math.sin(t*2.5)*2;
 halo(c,0,-12,27,'#a86beb4d');oval(c,'#25163577',0,-1,10,3);c.save();c.translate(0,bob);
 if(item.id==='prop-leg'){rect(c,'#86758e',-4,-25,10,18);rect(c,'#b6a6bb',-3,-24,5,17);rect(c,'#51425b',-5,-10,10,9);rect(c,'#453747',-5,-4,18,5);rect(c,'#d5caad',5,-1,8,2);rect(c,'#c1f09b',-7,-27,15,3);}
 else if(item.id==='lost-whistle'){rect(c,'#e5cb82',-8,-17,12,11);rect(c,'#b69a4f',3,-15,9,4);rect(c,'#524564',-5,-15,5,3);c.strokeStyle='#967fba';c.lineWidth=2;c.beginPath();c.arc(-6,-5,7,0,Math.PI);c.stroke();}
 else if(item.id.startsWith('ball-')){oval(c,'#9761c0',0,-12,8,8);oval(c,'#c996e6',-2,-14,5,5);c.strokeStyle='#eff6b1';c.lineWidth=1.5;c.beginPath();c.arc(-5,-13,7,-1.2,1.2);c.stroke();}
 else if(item.id==='locker-key'){c.strokeStyle='#f2dd87';c.lineWidth=3;c.beginPath();c.arc(-4,-17,5,0,Math.PI*2);c.stroke();rect(c,'#f2dd87',0,-15,3,15);rect(c,'#f2dd87',1,-6,7,3);pumpkin(c,12,-16,.35,t);}
 else if(item.id.startsWith('lantern-')){rect(c,'#393149',-9,-23,18,4);rect(c,'#393149',-9,-3,18,4);rect(c,'#abed80',-7,-19,14,16);rect(c,'#dfb7ff',-2,-16,4,10);rect(c,'#54465c',-9,-19,2,16);rect(c,'#54465c',7,-19,2,16);}
 else if(item.id==='green-leaf'){c.strokeStyle='#b8e597';c.lineWidth=2;c.beginPath();c.moveTo(-6,-1);c.lineTo(7,-23);c.stroke();oval(c,'#82c966',0,-15,7,10);rect(c,'#d4ed9b',-1,-20,2,13);}
 else if(['old-ledger','doubles-book'].includes(item.id)){rect(c,'#382a45',-10,-24,20,25);rect(c,'#b69d83',-7,-23,16,22);rect(c,item.id==='doubles-book'?'#547b67':'#73573f',-5,-21,16,20);rect(c,'#ddc996',-1,-18,9,2);rect(c,'#cab28b',-1,-13,7,2);}
 else if(item.id==='silver-bell'){oval(c,'#a6b2ce',0,-11,9,10);rect(c,'#d8dfeb',-9,-7,18,5);rect(c,'#f2edca',-2,-22,4,5);rect(c,'#adbdd9',-2,-3,4,4);rect(c,'#f4f3dc',-5,-15,3,7);}
 else{rect(c,'#b7d788',-6,-19,12,16);rect(c,item.id==='clean-water'?'#71ccd2':'#5d3b7c',-4,-17,8,10);rect(c,'#d9b5ff',-3,-24,6,6);rect(c,'#ecffd0',-2,-22,2,5);}
 c.restore();
 c.font='bold 13px monospace';c.textAlign='center';c.fillStyle='#e5ffc3';c.fillText('!',0,-33+bob);c.restore();
}
