import {drawHauntedTree} from './haunted-trees.js';
import {halloweenProps,drawHalloweenProp,drawHalloweenAtmosphere} from './halloween-art.js';
import {halloweenSpritesReady} from './halloween-sprites.js';
import {WORLD_SIZE,COURTS,SAND_COURTS,TREES,DECOR,PICKLEBALL,TERRACE,BAR_STAIRS,GATE,PARKING,GRAVEL,CARS,hash,terrainAt,waterAt,shoreX,pathDistance} from './scenery-data.js';
import {courtPoint} from './club-scene.js';
import {plantsReady,drawPlant,drawUnderstory,plantBounds} from './scenery-plants.js';
import {buildingsReady,drawBar} from './scenery-buildings.js';
import {drawGameLogo,paintGameLogos} from './game-brand.js';
import {drawWildlife,drawNight,sceneClock,treeSway,drawWeather} from './scenery-life.js';
import {PRACTICAL_LIGHTS,drawLightFixture} from './scenery-lighting.js';
import {drawAbandonedCourt,drawAbandonedNet} from './abandoned-court.js';
import {ABANDONED_COURT} from './scenery-data.js';
import {drawOldCabin} from './old-cabin.js';
import {SCENE_PALETTE,paintCourtMaterial,paintGroundFinish,drawDayAtmosphere} from './visual-style.js';
import {nightAmount} from './scenery-life.js';

// No photograph or flattened background: terrain tiles, props, depth and water
// are composed by the game. Static terrain/prop caches keep mobile frames cheap.
const P=SCENE_PALETTE;
const rect=(c,color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));};
function surface(w,h){const a=document.createElement('canvas');a.width=w;a.height=h;return a;}
function oval(c,color,x,y,rx,ry){for(let j=-Math.ceil(ry);j<=ry;j++){const r=Math.floor(rx*Math.sqrt(Math.max(0,1-j*j/(ry*ry))));rect(c,color,x-r,y+j,r*2+1,1);}}
function line(c,color,x1,y1,x2,y2,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();}
let ground,minimap;
const props=new Map();
export const sceneryReady=Promise.all([plantsReady,buildingsReady,halloweenSpritesReady]).then(results=>{
 const loaded=results.some(Boolean);
 // Previews may already have used the lightweight fallback before decoding.
 if(loaded){ground=null;minimap=null;if(typeof document!=='undefined')paintScenePreviews();}
 return loaded;
});
function terrain(){
 if(ground)return ground;
 ground=surface(WORLD_SIZE/2,WORLD_SIZE/2);const c=ground.getContext('2d');
 for(let y=0;y<WORLD_SIZE;y+=4)for(let x=0;x<WORLD_SIZE;x+=4){
  const tile=terrainAt(x+2,y+2),h=hash(x>>2,y>>2,4),palette=P[tile];
  const patch=Math.floor((Math.sin(x/61)+Math.cos(y/77)+2)*.74);
  rect(c,tile==='water'?P.water[Math.floor((Math.sin(x/180)+Math.cos(y/118)+2)*.74)]:tile==='grass'||tile==='lawn'?palette[patch]:palette[h%4],x/2,y/2,2,2);
  if(tile==='grass'||tile==='lawn'){
   if(h%31===0){rect(c,tile==='lawn'?'#9bb978':'#688752',x/2,y/2,1,2);rect(c,'#254f2944',x/2+1,y/2+1,1,1);}
   if(tile==='lawn'&&h%197===0){rect(c,'#fff2c2',x/2,y/2,2,1);rect(c,'#f4bb3c',x/2+1,y/2-1,1,1);}
  }else if(tile==='path'&&h%19===0)rect(c,h%2?'#b99c70':'#f4dfa7',x/2,y/2,2,1);
  else if(tile==='gravel'){if(h%3===0)rect(c,'#c1c9b9',x/2+(h%2),y/2,1,1);if(h%7===0)rect(c,'#85968c',x/2,y/2+1,2,1);}
  else if(tile==='water'&&h%61===0)rect(c,'#bcdbda',x/2,y/2,5+h%12,1);
 }
 c.save();c.scale(.5,.5);
 stonePaths(c);
 // Gravel is a real walkable surface with a tidy stone edge, not a pasted photo.
 for(let i=0;i<GRAVEL.length;i++){const a=GRAVEL[i],b=GRAVEL[(i+1)%GRAVEL.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let d=0;d<length;d+=7){const t=d/length,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;rect(c,'#627c70',x-2,y-2,6,5);rect(c,'#d0d3bc',x-2,y-2,5,2);}}
 // Small shaded parking court in the northwest, with individual worn bays.
 const [px,py,pw,ph]=PARKING;rect(c,'#798c63',px-2,py-2,pw+4,ph+4);rect(c,'#919a75',px,py,pw,ph);
 for(let n=0;n<900;n++){const x=px+hash(n,24)%pw,y=py+hash(n,25)%ph;rect(c,['#b3ae87','#859067','#c5bd96'][n%3],x,y,2,1);}
 for(const [x,y]of CARS.filter(([x])=>x<600)){rect(c,'#c4bea04d',x-23,y-35,46,71);rect(c,'#d8cfaa',x-24,y-32,2,63);rect(c,'#d8cfaa',x+23,y-32,2,63);}
 // Worn street pavers, followed by the dirt lane visible beside the fences.
 for(let y=72;y<478;y+=8)for(let x=1036;x<1146;x+=14){const xx=x+(y%16?7:0);if(terrainAt(xx+6,y+3)==='cobbles'){rect(c,'#777d6680',xx,y,12,7);rect(c,P.cobbles[hash(xx,y)%4],xx+1,y,10,6);rect(c,'#d2c8a355',xx+2,y,8,1);}}
 // Riverbank reeds and stones follow the same shore used by collision.
 for(let y=100;y<1536;y+=8){const x=shoreX(y)-17,h=hash(0,y);rect(c,'#415d34',x,y-2,3,14);rect(c,'#9fa564',x-4,y-9,2,17);rect(c,'#788c48',x-7,y-5,2,12);if(h%3===0)rock(c,x+10,y+10,8+h%7);if(h%5===0&&pathDistance(x-24,y)>15)drawUnderstory(c,x-20,y+12,0,.55);}
 // Dappled ground shadows belong beneath actors; trunks retain their collisions.
 for(const tree of TREES){
  const s=tree.scale||1;
  oval(c,'#102e2b24',tree.x+26*s,tree.y+12*s,37*s,16*s);
  oval(c,'#12362b36',tree.x+16*s,tree.y+6*s,29*s,11*s);
  oval(c,'#102c263d',tree.x+7,tree.y+1,16*s,6*s);
  // Broken foliage shadows, cached beneath all moving characters.
  for(let i=0;i<8;i++){const h=hash(tree.x,i,tree.y);oval(c,'#16382c1c',tree.x+12+(h%47)*s,tree.y+5+(h%21)*s,(5+h%8)*s,3*s);}
 }
 paintGroundFinish(c);landscaping(c);
 // Planked terrace beside the clay courts, with concrete circulation strip.
 const [tx,ty,tw,th]=TERRACE;
 rect(c,'#4e4433',tx-2,ty-2,tw+4,th+4);
 for(let y=ty;y<ty+th;y+=7){
  rect(c,['#94724e','#a18156','#9c7952'][hash(y,4)%3],tx,y,tw,6);rect(c,'#c6a577',tx,y,tw,1);rect(c,'#594936',tx,y+6,tw,1);
  for(let x=tx+4;x<tx+tw;x+=25){rect(c,'#56483a',x,y+2,1,2);rect(c,'#b7956380',x+3,y+2,12,1);rect(c,'#66513766',x+7,y+4,14,1);}
 }
 rect(c,'#b4b4a0',tx+tw-14,ty,14,th);for(let y=ty;y<ty+th;y+=29)rect(c,'#959b8b',tx+tw-14,y,14,1);
 // A continuous stairway links the upper promenade to the lower social deck.
 const {x:stx,y:sty,w:stw,h:sth}=BAR_STAIRS;
 rect(c,'#514c38',stx-3,sty-2,stw+6,sth+2);
 for(let yy=sty;yy<sty+sth;yy+=12){
  const hh=Math.min(12,sty+sth-yy);
  rect(c,'#ab936a',stx,yy,stw,hh);rect(c,'#cbb48a',stx,yy,stw,2);
  rect(c,'#7e6d4f',stx,yy+hh-3,stw,3);rect(c,'#93815c',stx+3,yy+hh-4,stw-6,1);
 }
 rect(c,'#d0bd94',stx-3,sty,3,sth);rect(c,'#746c51',stx+stw,sty,3,sth);
 for(const court of COURTS)drawCourtGround(c,court);
 for(const court of SAND_COURTS)drawSandGround(c,court);
 drawPickleball(c);
 // Clear, continuous promenade around the blue court, not narrow dead ends.
 for(const [x1,y1,x2,y2]of [[526,1140,526,1326],[526,1326,854,1306],[854,1306,946,1267],[946,1267,946,1140]]){
  line(c,'#ccd0bd',x1,y1,x2,y2,16);
  const length=Math.hypot(x2-x1,y2-y1);for(let d=0;d<length;d+=12){const t=d/length;rect(c,'#9ba99b',x1+(x2-x1)*t-5,y1+(y2-y1)*t,10,1);}
 }
 // Small thresholds at the outside sidelines, level with each net.
 for(const court of COURTS){const g=court.grounds,xx=court.id===1?g.x-18:g.x+g.w-2,yy=courtPoint(240,249,court.id).y;
  rect(c,'#b7b59b',xx,yy-20,20,40);for(let y=yy-18;y<yy+20;y+=8)rect(c,'#ded3b1',xx+1,y,18,6);
 }
 drawAbandonedCourt(c);neighborhood(c);c.restore();return ground;
}
function stonePaths(c){
 // Staggered, gently weathered pavers follow the existing paths exactly.
 // Check each footprint so the texture cannot spill onto grass or into water.
 for(let y=354;y<1380;y+=8)for(let x=252+(y%16?5:0);x<1138;x+=11){
  if(![[0,0],[9,0],[0,6],[9,6]].every(([dx,dy])=>terrainAt(x+dx,y+dy)==='path'))continue;
  const h=hash(x,y,62);
  rect(c,'#8f84654a',x,y,10,7);
  rect(c,['#cbbb96','#d1bf99','#d7c39f','#c5b18b'][h%4],x+1,y,9,6);
  rect(c,'#eaddba70',x+2,y,7,1);rect(c,'#a68c6850',x+1,y+5,8,1);
  if(h%4===0)rect(c,'#f3e2b661',x+3,y+2,2,1);
  if(h%7===0)rect(c,'#89765955',x+6,y+3,2,1);
 }
}
function rock(c,x,y,size){
 oval(c,'#39473544',x+4,y+3,size+3,size*.4);oval(c,'#635d48',x,y,size,size*.66);
 oval(c,'#8b8163',x-2,y-2,size-2,size*.45);rect(c,'#bdb08b',x-size*.6,y-size*.35,size*.7,2);rect(c,'#6e684d',x+1,y,size*.7,2);
}
function landscaping(c){
 // Decorative clumps are outside the clear walkway; they add detail, not walls.
 for(let y=390;y<1510;y+=26)for(let x=220;x<1510;x+=28){
  const tile=terrainAt(x,y),h=hash(x,y,41),distance=pathDistance(x,y);
  if(!['grass','lawn'].includes(tile)||distance<8||distance>30||h%3)continue;
  for(let n=0;n<5;n++){const xx=x-5+n*3,yy=y+(h>>>n)%5;rect(c,'#326327',xx,yy-5-n%3,2,7+n%3);rect(c,'#acd345',xx-1,yy-6-n%3,2,3);}
  if(h%7===0){for(let n=0;n<3;n++){const xx=x+n*5;rect(c,'#ffedb6',xx,y-9,3,2);rect(c,'#f3b448',xx+1,y-10,1,4);}}
 }
 // Reeds and fan palms break up the solid forest edges.
 for(const tree of TREES){const h=hash(tree.x,tree.y);if(h%4===0&&pathDistance(tree.x+17,tree.y+7)>18)drawUnderstory(c,tree.x+17,tree.y+7,h%2,.48+(h%3)*.1);}
 for(const [x,y]of [[475,847],[475,1002],[326,1107],[987,1170],[455,646],[960,351]]){
  oval(c,'#4a6c2933',x+3,y+5,17,6);rect(c,'#bf7740',x-7,y-5,14,10);rect(c,'#e6a264',x-9,y-7,18,4);drawUnderstory(c,x,y-6,1,.5);
 }
}
function neighborhood(c){
 // Inland edge: street and distant city roofline, not sky painted over the map.
 rect(c,'#626f6b',0,12,1450,34);rect(c,'#c9c8b3',0,47,1435,5);
 for(let x=0;x<1430;x+=34)rect(c,'#d9d7b9',x,28,15,2);
 for(let x=35;x<1020;x+=105){const h=hash(x,41);cityHouse(c,x,56,32+h%35,40+h%30,h);}
 // Far channel bridge, a contextual landmark beyond the explorable riverbank.
 for(let x=1438;x<1536;x+=32){rect(c,'#807861',x,175,7,27);rect(c,'#d1c7a8',x,172,3,23);}
 rect(c,'#56655f',1405,156,131,16);rect(c,'#d3ccaf',1405,154,131,3);rect(c,'#adae96',1405,172,131,3);
 for(let x=1410;x<1536;x+=25){rect(c,'#48594e',x,144,2,11);rect(c,'#e9dfb7',x-1,143,4,2);}
}
function drawSandGround(c,{id,x,y,w,h}){
 rect(c,'#777966',x-3,y-3,w+6,h+6);rect(c,'#d3bd91',x,y,w,h);
 for(let i=0;i<950;i++){const xx=x+hash(i,16)%(w-2),yy=y+hash(i,23)%(h-2);rect(c,['#e8d4a7','#c6b181','#dfc99c','#d6bf92'][i%4],xx,yy,2+i%3,1);}
 c.strokeStyle=id==='beach'?'#eee0b6':'#688594';c.lineWidth=1.5;c.strokeRect(x+19,y+18,w-38,h-36);
 rect(c,'#85806b55',x,y,w,5);rect(c,'#85806b44',x,y,5,h);
}
function cityHouse(c,x,y,w,h,seed){
 rect(c,'#3d665a',x+5,y+6,w,h);rect(c,['#f1f0dc','#fff5dc','#d8e6e4','#efc99a'][seed%4],x,y,w,h);
 rect(c,seed%2?'#db6935':'#c7d3cc',x-2,y-4,w+4,6);rect(c,'#a6b6af',x+w-5,y+2,5,h-2);
 for(let yy=y+10;yy<y+h-6;yy+=12)for(let xx=x+5;xx<x+w-6;xx+=9){rect(c,'#458193',xx,yy,4,6);rect(c,'#94c7cf',xx,yy,3,2);rect(c,'#fcf4de',xx-1,yy+6,6,1);}
}
function drawCourtGround(c,court){
 const {x:left,y:top,w:gw,h:gh}=court.grounds;
 paintCourtMaterial(c,court);
 // Fine grain and directional clay highlights are cached by paintCourtMaterial.
 // Subtle raked rows and scuffed baselines, all aligned to gameplay geometry.
 // Keep line geometry identical to the physical court.
 const {x,y,width:w,height:h}=court,net=courtPoint(240,249,court.id).y;
 rect(c,'#f9e8bc',x,y,w,2);rect(c,'#f9e8bc',x,y+h,w,2);rect(c,'#f9e8bc',x,y,2,h);rect(c,'#f9e8bc',x+w-2,y,2,h);
 for(const side of [x+17,x+w-19])rect(c,'#f4dfb0',side,y,2,h);
 for(const sy of [net-h*.22,net+h*.22])rect(c,'#f4dfb0',x+18,sy,w-36,2);
 rect(c,'#f4dfb0',x+w/2-1,net-h*.22,2,h*.44);
 rect(c,'#f9e8bc',x+w/2-1,y+h-4,2,4);rect(c,'#f9e8bc',x+w/2-1,y+2,2,4);
 // Worn baseline arcs, watering marks and realistic fence shadows.
 for(let i=0;i<36;i++){const xx=x+25+hash(i,5)%90,yy=y+h+7+hash(i,7)%15;rect(c,'#ed9c5455',xx,yy,4+hash(i,8)%9,1);}
 rect(c,'#503d2722',left+4,top+6,gw-8,8);rect(c,'#503d2722',left+5,top+6,7,gh-12);
 for(let xx=left+4;xx<left+gw;xx+=40)line(c,'#383e3336',xx,top+3,xx+18,top+29,2);
 for(let yy=top+18;yy<top+gh-30;yy+=26)line(c,'#383e3326',left+2,yy,left+16,yy+14,2);
 // Nets and front fences are separate depth-sorted props, not baked scenery.
}
function drawPickleball(c){
 const {x,y,w,h}=PICKLEBALL;
 rect(c,'#577a72',x-3,y-3,w+6,h+6);rect(c,'#79c5c5',x,y,w,h);
 rect(c,'#477da2',x+22,y+23,w-44,h-46);rect(c,'#6cafbf',x+w/2-37,y+23,74,h-46);
 c.strokeStyle='#fbf0d0';c.lineWidth=2;c.strokeRect(x+22,y+23,w-44,h-46);
 for(const xx of [x+w/2-37,x+w/2+37])rect(c,'#f7edce',xx,y+23,2,h-46);
 for(const [xx,ww]of [[x+22,w/2-59],[x+w/2+37,w/2-59]])rect(c,'#f7edce',xx,y+h/2,ww,2);
 for(let i=0;i<500;i++)rect(c,'#d6edda12',x+3+hash(i,19)%(w-6),y+3+hash(i,20)%(h-6),2,1);
}
function treeSprite(kind,variant){
 const key=kind+variant;if(props.has(key))return props.get(key);
 const a=surface(72,78),c=a.getContext('2d');c.imageSmoothingEnabled=false;
 oval(c,'#193f3244',39,71,27,5);
 if(kind==='palm'){
  for(let y=32;y<70;y++){const x=35+Math.floor((70-y)*.085);rect(c,'#755c37',x,y,5,1);rect(c,y%4?'#be9656':'#8e7242',x,y,2,1);}
  const arms=[[-27,-11],[-25,8],[-15,-24],[6,-27],[25,-18],[29,1],[17,20],[-4,19]];
  for(let k=0;k<arms.length;k++){const [dx,dy]=arms[k];for(let t=0;t<=1;t+=.035){const x=38+dx*t,y=32+dy*t+t*t*8,width=Math.ceil(Math.sin(t*Math.PI)*4)+1;rect(c,'#1a4b37',x-width,y,width*2,3);rect(c,k%2?'#3f8445':'#55964c',x-width,y,width,2);if(k%2===0)rect(c,'#8cb456',x,y,1,2);}}
  oval(c,'#b99552',37,34,3,3);
 }else{
  rect(c,'#3a3f2d',32,42,10,29);rect(c,'#795b39',34,46,6,24);rect(c,'#ab8650',35,48,2,22);rect(c,'#4b5130',28,68,17,3);
  const palette=variant%3===0?['#163f36','#235b3e','#377747','#52934b','#7dac52']:variant%3===1?['#194938','#2b6540','#448449','#689e4e','#94b45b']:['#18453a','#256043','#3a7c4a','#589b53','#8ab55b'];
  const clusters=[[34,29,23,25],[19,32,15,17],[50,32,15,19],[32,15,16,13],[22,17,12,12],[44,18,13,14],[30,44,19,13]];
  clusters.forEach(([x,y,rx,ry],i)=>{oval(c,palette[0],x,y,rx,ry);oval(c,palette[1],x-1,y-2,rx-2,ry-2);oval(c,palette[2],x-3,y-5,rx-4,ry-5);oval(c,palette[3],x-5,y-7,Math.max(3,rx-9),Math.max(3,ry-9));for(let n=0;n<30;n++){const h=hash(n,i,variant),px=x-rx+3+h%(rx*2-6),py=y-ry+3+(h>>>8)%(ry*2-6);if((px-x)**2/(rx*rx)+(py-y)**2/(ry*ry)<.7)rect(c,palette[2+(h%3)],px,py,2+h%2,1+h%2);}});
 }
 props.set(key,a);return a;
}
function roof(c,x,y,w,h){
 rect(c,'#193d2d45',x+12,y+19,w,h+12);rect(c,'#683c29',x-4,y-4,w+8,h+8);
 rect(c,'#e58141',x,y,w,h/2);rect(c,'#bc582b',x,y+h/2,w,h/2);
 for(let row=0;row<h;row+=7)for(let col=-8;col<w;col+=10){
  const px=x+col+(row/7%2)*5,ww=Math.min(9,x+w-px);if(px<x||ww<1)continue;
  const lit=row<h/2,hue=hash(col,row,12)%3;
  rect(c,lit?['#e38b48','#ea934e','#de8140'][hue]:['#c26631','#c66a34','#bd5c2c'][hue],px,y+row,ww,5);
  rect(c,lit?'#ffb568':'#e39549',px,y+row,ww-1,1);rect(c,lit?'#bc5d2c':'#934623',px+ww-1,y+row+1,1,5);
 }
 // Hip-roof seams give the native pixel roof volume without changing its footprint.
 line(c,'#f8b46b',x,y+h/2,x+22,y,2);line(c,'#ad4e29',x,y+h/2,x+22,y+h,2);
 line(c,'#f8b46b',x+w,y+h/2,x+w-22,y,2);line(c,'#9f4727',x+w,y+h/2,x+w-22,y+h,2);
 rect(c,'#ffbf75',x+1,y+h/2-3,w-2,3);rect(c,'#b8582d',x+1,y+h/2,w-2,2);
 for(let xx=x+1;xx<x+w;xx+=8)rect(c,'#d97d3d',xx,y+h/2-3,1,3);
 rect(c,'#f4b36a',x-2,y-2,w+4,2);rect(c,'#633e2b',x-3,y+h,w+6,3);
}
function building(c,b){
 const {x,y,w,h}=b;
 if(b.rotation){
  c.save();c.translate(x+w/2,y+h/2);c.rotate(b.rotation);
  building(c,{...b,x:-w/2,y:-h/2,rotation:0});c.restore();return;
 }
 if(b.kind==='clubhouse'&&drawBar(c,b))return;
 if(b.kind==='barwing'&&drawBar(c,b))return;
 if(b.kind==='woodcabin'){
  drawOldCabin(c,b);
  return;
 }
 if(b.kind==='longbar'){
  rect(c,'#1d332955',x+9,y+8,w+6,h+4);rect(c,'#1b2422',x,y,w,h);
  // Long black metal roof, parallel to the deck and west fence of Court 1.
  for(let xx=x;xx<x+w-28;xx+=6){rect(c,'#363c37',xx,y,5,h);rect(c,'#50544a',xx,y,1,h);rect(c,'#121e1a',xx+4,y,1,h);}
  for(let yy=y+7;yy<y+h;yy+=46)rect(c,'#667061',x+2,yy,w-30,2);
  rect(c,'#65735b',x+1,y,2,h);rect(c,'#17271f',x+w-28,y,28,h);
  rect(c,'#ad7741',x+w-17,y+22,13,h-43);rect(c,'#d2a36a',x+w-17,y+22,3,h-43);
  for(let yy=y+38;yy<y+h-30;yy+=54){rect(c,'#bfc4a6',x+w-28,yy,3,17);oval(c,'#d7bc76',x+w-24,yy+6,5,7);oval(c,'#343f32',x+w-24,yy+6,3,5);rect(c,'#7b552e',x+w-24,yy+13,2,8);}
  // Keep the metal roof clean: the real upper bar already carries its sign.
  rect(c,'#132a30',x+w-27,y+h-35,22,30);rect(c,'#267a9b',x+w-24,y+h-33,15,26);for(let yy=y+h-29;yy<y+h-6;yy+=7)rect(c,'#90d1d5',x+w-22,yy,11,2);
  return;
 }
 if(['entryhouse','entrycabin','workshop'].includes(b.kind)){
  const workshop=b.kind==='workshop',cabin=b.kind==='entrycabin',front=cabin?18:43;
  rect(c,'#25403055',x+8,y+8,w,h);rect(c,workshop?'#c0b592':'#d2c8a9',x,y,w,h);
  rect(c,cabin?'#ece5ce':'#b76e58',x+w*.65,y+h-front,w*.35,front);
  for(let xx=x+10;xx<x+w-16;xx+=35){rect(c,'#3f4740',xx,y+h-front+6,22,front-13);for(let dx=3;dx<22;dx+=5)rect(c,'#8f9c88',xx+dx,y+h-front+7,1,front-16);}
  if(!workshop){rect(c,'#444d3f',x+w-30,y+h-front+3,22,front-3);rect(c,'#8b6247',x+w-28,y+h-front+5,18,front-5);}
  for(let yy=y;yy<y+h-front;yy+=5){rect(c,yy%10?'#71796b':'#858b79',x-5,yy,w+10,4);rect(c,'#a5aa92',x-5,yy,w+10,1);}
  rect(c,'#4c574a',x-5,y+h-front,w+10,4);
  for(let n=0;n<35;n++){const xx=x+hash(n,3)%w,yy=y+h-2-hash(n,8)%10;rect(c,'#68725b44',xx,yy,3,2);}
  if(b.kind==='entryhouse'){rect(c,'#294c70',x+w-52,y-12,39,20);oval(c,'#174164',x+w-32,y-13,20,6);oval(c,'#3d719b',x+w-32,y-16,20,6);rect(c,'#87a4b0',x+w-48,y-17,28,2);}
  return;
 }
 if(b.kind==='gazebo'){
  rect(c,'#554c32',x,y+h-32,w,37);rect(c,'#ba9260',x+4,y+h-30,w-8,28);
  for(const xx of [x+8,x+w-15]){rect(c,'#533f2f',xx,y+20,7,h-14);rect(c,'#ad8050',xx,y+20,3,h-18);}
  roof(c,x-2,y,w+4,h-24);return;
 }
 rect(c,'#24442c55',x+12,y+17,w,h+8);rect(c,'#b8c3b0',x,y,w,h);rect(c,'#fff2d6',x,y+h-38,w-8,38);rect(c,'#327aa0',x,y+h-7,w,7);
 for(let xx=x+14;xx<x+w-23;xx+=48){rect(c,'#38595b',xx,y+h-33,26,22);rect(c,'#8db7b3',xx+2,y+h-31,21,13);rect(c,'#d6e4c7',xx+12,y+h-32,2,20);rect(c,'#567979',xx,y+h-16,26,3);}
 rect(c,'#324638',x+w/2-14,y+h-37,28,37);rect(c,'#846743',x+w/2-10,y+h-34,20,34);rect(c,'#d7c388',x+w/2+5,y+h-18,2,2);
 roof(c,x-8,y-8,w+16,h-40);
 if(b.kind==='clubhouse'){
  rect(c,'#274d42',x+w/2-56,y+h-43,112,15);rect(c,'#ddce91',x+w/2-56,y+h-43,112,2);
  c.fillStyle='#f5ebc3';c.font='bold 9px monospace';c.textAlign='center';c.fillText('BAR DO ILHA',x+w/2,y+h-32);
  for(let xx=x;xx<x+w;xx+=24){rect(c,'#fff0c9',xx,y+h-4,24,11);rect(c,'#397c8e',xx,y+h-4,12,11);rect(c,'#28564666',xx,y+h+7,24,2);}
  for(const xx of [x+8,x+w-18]){rect(c,'#a4663b',xx,y+h+1,11,10);rect(c,'#d89854',xx-1,y+h,13,3);drawUnderstory(c,xx+5,y+h,1,.35);}
 }
 rect(c,'#b9c3b9',x+w-54,y+10,29,16);rect(c,'#e9e7cf',x+w-52,y+8,29,14);rect(c,'#618080',x+w-49,y+9,22,9);
}
function fence(c,x,y,w,h=17,gate=false){
 rect(c,'#263f3544',x+3,y+2,w,4);
 for(let xx=x;xx<x+w;xx+=4){if(gate&&Math.abs(xx-x-w/2)<20)continue;line(c,'#62766988',xx,y-h,Math.min(x+w,xx+12),y,1);line(c,'#62766988',xx,y,Math.min(x+w,xx+12),y-h,1);}
 for(let xx=x;xx<=x+w;xx+=40){rect(c,'#283d35',xx-1,y-h-3,3,h+6);rect(c,'#a1ad88',xx-1,y-h-3,1,h+2);}
 for(const dy of [-h,0]){if(gate){rect(c,'#3d5745',x,y+dy,w/2-20,2);rect(c,'#3d5745',x+w/2+20,y+dy,w/2-20,2);}else rect(c,'#3d5745',x,y+dy,w,2);}
}
function net(c,court){const y=courtPoint(240,249,court.id).y,x=court.x-20,w=court.width+40;
 rect(c,'#483c3155',x+3,y+2,w,6);rect(c,'#23382edd',x,y-11,w,12);
 for(let xx=x;xx<x+w;xx+=4)rect(c,'#7b85716b',xx,y-10,1,11);
 for(let yy=y-9;yy<y;yy+=3)rect(c,'#87937a66',x,yy,w,1);
 rect(c,'#f1e0b1',x,y-12,w,2);rect(c,'#566351',x-3,y-16,4,21);rect(c,'#abc09c',x-3,y-16,2,18);rect(c,'#566351',x+w,y-16,4,21);rect(c,'#abc09c',x+w,y-16,2,18);
}
function decor(c,o,actors=[],activeCourt=null,windTime=null){
 const {x,y}=o;
 if(o.kind==='abandonednet'){drawAbandonedNet(c);return;}
 if(o.kind==='lightFixture'){drawLightFixture(c,o.light);return;}
 if(o.kind==='tree'||o.kind==='palm'){
  const s=o.scale||1;
  // Conversations stay readable when a canopy overlaps any character.
  const bounds=plantBounds(o);
  const obscures=actors.some(a=>a.y<y&&a.y>bounds.y&&a.x>bounds.x-8&&a.x<bounds.x+bounds.w+8);
  const court=activeCourt==='old'?{...ABANDONED_COURT,width:ABANDONED_COURT.w,height:ABANDONED_COURT.h}:activeCourt==='pickleball'?{x:PICKLEBALL.x,y:PICKLEBALL.y,width:PICKLEBALL.w,height:PICKLEBALL.h}:COURTS.find(court=>court.id===activeCourt);
  const coversCourt=court&&bounds.x<court.x+court.width+16&&bounds.x+bounds.w>court.x-16&&bounds.y<court.y+court.height+20&&bounds.y+bounds.h>court.y-20;
  c.save();if(coversCourt)c.globalAlpha=.16;else if(obscures)c.globalAlpha=.28;
  if(windTime!==null){const sway=treeSway(windTime,o);c.translate(x,y);c.transform(1,0,-sway,1,0,0);c.translate(-x,-y);}
  if(!drawHauntedTree(c,o)&&!drawPlant(c,o))c.drawImage(treeSprite(o.kind,o.variant),Math.round(x-36*s),Math.round(y-71*s),72*s,78*s);
  c.restore();return;
 }
 if(['clubhouse','house','gazebo','longbar','barwing','entryhouse','entrycabin','workshop','woodcabin'].includes(o.kind)){building(c,o);return;}
 if(o.kind==='wall'){
  rect(c,'#6e76604d',x+3,y+5,o.w+5,o.h+6);rect(c,'#a5a18a',x,y,o.w,o.h);rect(c,'#c6c2a8',x,y,Math.min(3,o.w),o.h);
  if(o.w>o.h){rect(c,'#dad1b0',x,y,o.w,2);for(let xx=x;xx<x+o.w;xx+=19)rect(c,'#7d837077',xx,y,1,o.h);}
  else for(let yy=y;yy<y+o.h;yy+=16){rect(c,'#6e776d',x,yy,o.w,1);rect(c,'#485f47',x+o.w/2,yy-10,2,22);}
  return;
 }
 if(o.kind==='utility'){
  line(c,'#283d2d33',x,y,x+34,y+32,4);rect(c,'#9f9c83',x,y-90,5,91);rect(c,'#d4cbb0',x,y-90,2,90);rect(c,'#716955',x-12,y-77,29,3);rect(c,'#ded5b2',x-8,y-86,5,8);rect(c,'#ded5b2',x+9,y-86,5,8);line(c,'#424d3944',x,y-86,x-15,y+140,1);return;
 }
 if(o.kind==='sandnet'){
  rect(c,'#74807544',x+2,y+3,o.w,5);rect(c,'#737c6266',x,y-15,o.w,15);
  for(let xx=x;xx<x+o.w;xx+=6)rect(c,'#596f5b77',xx,y-14,1,14);
  for(let yy=y-12;yy<y;yy+=4)rect(c,'#53665388',x,yy,o.w,1);
  rect(c,'#345c98',x,y-17,o.w,3);for(const xx of [x-2,x+o.w])rect(c,'#828574',xx,y-29,3,36);return;
 }
 if(o.kind==='fence'){
  fence(c,x,y,o.w,o.h,o.gate);
  if(o.courtLabel){
   const sx=Math.round(x+o.w*.76-27),sy=y-20;
   rect(c,'#172d2580',sx+1,sy+2,54,14);rect(c,'#6c7e61',sx,sy,54,13);rect(c,'#294638',sx+1,sy+1,52,11);
   rect(c,'#b7bba0',sx+3,sy+5,1,1);rect(c,'#b7bba0',sx+50,sy+5,1,1);
   c.save();c.font='bold 7px monospace';c.textAlign='center';c.fillStyle='#e5dfb7';c.fillText(`QUADRA ${o.courtLabel}`,sx+27,sy+9);c.restore();
  }
  return;
 }
 if(o.kind==='net'){net(c,o.court);return;}
 if(o.kind==='picklenet'){
  const {h}=PICKLEBALL;rect(c,'#294b50',x,y,5,h-12);
  for(let yy=y;yy<y+h-12;yy+=4){rect(c,'#a5c8c0',x,yy,5,1);rect(c,'#f2e8c9',x+1,yy,1,4);}
  for(const yy of [y,y+h-12]){rect(c,'#253f45',x-3,yy-8,10,3);rect(c,'#d6dfd1',x,yy-15,3,16);}return;
 }
 if(o.kind==='stand'){
  const vertical=o.axis==='vertical';rect(c,'#424941',x+4,y+5,o.w,o.h);
  for(let i=0;i<5;i++){
   const step=vertical?o.w/5:5,xx=x+(vertical?i*step:0),yy=y+(vertical?0:i*step),ww=vertical?step-1:o.w,hh=vertical?o.h:4;
   rect(c,i%2?'#a7a58d':'#b7b198',xx,yy,ww,hh);rect(c,'#ddd2b2',xx,yy,ww,1);
   for(let n=10;n<(vertical?o.h:o.w);n+=28)rect(c,'#777c6c',xx+(vertical?0:n),yy+(vertical?n:0),vertical?ww:1,vertical?1:hh);
  }return;
 }
 if(o.kind==='table'){
  oval(c,'#30443040',x+5,y+3,25,10);
  for(const xx of [x-21,x+15])for(const yy of [y-16,y+9]){rect(c,'#e8e5cd',xx,yy,9,8);rect(c,'#747f6b',xx+1,yy+8,2,6);rect(c,'#fff7dc',xx,yy-3,9,3);}
  rect(c,'#614d35',x-13,y-13,27,25);rect(c,'#b39a66',x-13,y-13,27,20);rect(c,'#dcc699',x-13,y-13,27,2);
  for(const xx of [x-5,x+7]){rect(c,'#dfebe0',xx,y-11,3,6);rect(c,'#559295',xx,y-9,3,2);}return;
 }
 if(o.kind==='lamp'){
  line(c,'#273f3344',x,y,x+42,y+40,4);rect(c,'#283c35',x,y-89,4,93);rect(c,'#b1ba9b',x,y-88,1,88);
  rect(c,'#3b4941',x-17,y-91,38,3);for(let i=0;i<4;i++){rect(c,'#34473f',x-17+i*10,y-97,9,7);rect(c,'#e5e6cd',x-16+i*10,y-96,6,4);rect(c,'#a2b6ac',x-15+i*10,y-92,5,1);}return;
 }
 if(o.kind==='bench'){for(const xx of [x-16,x+13])rect(c,'#344e36',xx,y-8,4,16);rect(c,'#724e35',x-21,y-15,44,5);rect(c,'#b2864e',x-21,y-14,44,2);rect(c,'#d1aa64',x-21,y-6,44,4);rect(c,'#805d3a',x-21,y,44,3);return;}
 if(o.kind==='umbrella'){
  oval(c,'#163e3044',x+7,y,23,6);rect(c,'#b28a53',x-1,y-34,3,35);oval(c,'#e9cf95',x,y-7,16,5);oval(c,'#206493',x,y-32,28,13);
  for(let j=-11;j<6;j++){const w=Math.floor(27*Math.sqrt(Math.max(0,1-j*j/169)));rect(c,j<0?'#40a1c1':'#70c6da',x-w,y-36+j,w,1);}rect(c,'#e8deb6',x-1,y-49,3,4);return;
 }
 if(o.kind==='car'){
  const colors=['#e4e5d0','#394853','#3d6d91','#b64139'],base=colors[o.variant%4];
  rect(c,'#26372b66',x-16,y-30,40,70);rect(c,'#263b33',x-20,y-28,39,63);rect(c,base,x-17,y-31,33,64);rect(c,'#273e45',x-13,y-15,25,13);rect(c,'#90b2ad',x-11,y-14,20,7);rect(c,'#273e45',x-13,y+16,25,9);rect(c,'#e9dfb4',x-14,y-30,7,4);rect(c,'#e9dfb4',x+6,y-30,7,4);rect(c,'#d96640',x-14,y+29,6,3);rect(c,'#d96640',x+7,y+29,6,3);
 }
}
const FIXED=[...TREES,...DECOR,...PRACTICAL_LIGHTS.map(light=>({kind:'lightFixture',light,x:light.x,y:light.y,depth:light.y+1})),
 {kind:'abandonednet',x:ABANDONED_COURT.x+ABANDONED_COURT.w/2,y:ABANDONED_COURT.y+25,depth:ABANDONED_COURT.y+ABANDONED_COURT.h-25},
 ...SAND_COURTS.flatMap(c=>[{kind:'fence',x:c.x,y:c.y,w:c.w,h:24,depth:c.y},{kind:'sandnet',x:c.x+10,y:c.y+c.h/2,w:c.w-20,depth:c.y+c.h/2},{kind:'fence',x:c.x,y:c.y+c.h,w:c.w,h:21,depth:c.y+c.h}]),
 ...COURTS.flatMap(c=>[{kind:'fence',courtLabel:c.id,x:c.grounds.x,y:c.grounds.y,w:c.grounds.w,h:26,depth:c.grounds.y},{kind:'net',court:c,x:c.x-20,y:courtPoint(240,249,c.id).y,w:c.width+40,depth:courtPoint(240,249,c.id).y},{kind:'fence',x:c.grounds.x,y:c.grounds.y+c.grounds.h,w:c.grounds.w,h:26,depth:c.grounds.y+c.grounds.h}]),
 {kind:'picklenet',x:PICKLEBALL.x+PICKLEBALL.w/2,y:PICKLEBALL.y+6,depth:PICKLEBALL.y+PICKLEBALL.h},
 {kind:'fence',x:PICKLEBALL.x,y:PICKLEBALL.y+PICKLEBALL.h,w:PICKLEBALL.w,h:23,depth:PICKLEBALL.y+PICKLEBALL.h},
].sort((a,b)=>a.depth-b.depth);
function courtSideFences(c){
 for(const area of [...COURTS.map(c=>c.grounds),...SAND_COURTS,PICKLEBALL])for(const x of [area.x,area.x+area.w]){
  const court=COURTS.find(item=>item.grounds===area),gate=court&&(court.id===1?x===area.x:x===area.x+area.w)?courtPoint(240,249,court.id).y:null;
  const spans=gate===null?[[area.y,area.h]]:[[area.y,gate-22-area.y],[gate+22,area.y+area.h-gate-22]];
  for(const [start,height]of spans){rect(c,'#334b3f',x,start,2,height);rect(c,'#9caa8d',x,start,1,height);}
  for(let y=area.y+6;y<area.y+area.h;y+=25){if(gate!==null&&y>gate-22&&y-19<gate+22)continue;rect(c,'#2c3f37',x-1,y-19,4,23);rect(c,'#abb5a0',x-1,y-19,1,19);}
  if(gate!==null){for(const y of [gate-22,gate+22]){rect(c,'#294939',x-2,y-5,5,10);rect(c,'#c1c6a3',x-2,y-5,2,10);}line(c,'#54745b',x,gate-22,x+(court.id===1?-15:15),gate-34,2);}
 }
 // Windscreens and little courtside chairs match the ground-level photographs.
 for(const court of COURTS){const g=court.grounds;for(let x=g.x+8;x<g.x+g.w-20;x+=50){rect(c,'#293d38',x,g.y+g.h-18,44,14);rect(c,'#d5cd9f',x+6,g.y+g.h-14,31,2);rect(c,'#a5b48e',x+13,g.y+g.h-10,17,1);}}
}
function water(c,camera,time){
 const tick=Math.floor(time*3);for(let y=Math.max(192,Math.floor(camera.y/24)*24);y<Math.min(1536,camera.y+camera.h);y+=24)for(let x=Math.max(0,Math.floor(camera.x/56)*56);x<Math.min(1536,camera.x+camera.w);x+=56){const h=hash(x,y,3),xx=x+(h+tick*2)%40;if(waterAt(xx,y)&&waterAt(xx+24,y)){rect(c,'#d9f2e666',xx,y,14+h%16,1);rect(c,'#2d638b44',xx-3,y+3,13,1);if(h%3===0)rect(c,'#b5dde866',xx+4,y+5,7,1);}}
}
export function sceneObjectsIn(camera){return FIXED.filter(o=>o.x+Math.max(140,o.w||0)>camera.x&&o.x-140<camera.x+camera.w&&o.depth+24>camera.y&&o.depth-Math.max(270,o.h||0)<camera.y+camera.h);}
export function renderClub(ctx,camera,{time=0,actors=[],drawActor=()=>{},drawSurface=()=>{},animate=true,gateOpen=true,activeCourt=null,atmosphereTime=null,hiddenProps=[]}={}){
 const sx=ctx.canvas.width/camera.w,sy=ctx.canvas.height/camera.h;
 const lifeTime=210; // Halloween is always night, including previews and matches.
 ctx.save();ctx.imageSmoothingEnabled=false;ctx.scale(sx,sy);ctx.translate(-Math.round(camera.x),-Math.round(camera.y));
 ctx.drawImage(terrain(),0,0,WORLD_SIZE,WORLD_SIZE);if(animate)water(ctx,camera,time);drawSurface(ctx);courtSideFences(ctx);
 // Actors participate in the same stable depth order as trees, roofs and nets.
 const queue=[...sceneObjectsIn(camera).filter(o=>!hiddenProps.includes(o.id)),...halloweenProps(camera).map(a=>({...a,kind:'halloween',depth:a.y})),...actors.map(a=>({...a,kind:'actor',depth:a.y}))].sort((a,b)=>a.depth-b.depth);
 for(const o of queue){if(o.kind==='halloween')drawHalloweenProp(ctx,o,time);else if(o.kind==='actor')drawActor(ctx,o);else decor(ctx,o,actors,activeCourt,animate?lifeTime:null);}
 // The street continues south; the actual club entrance is a westward turn.
 const {x:gx,y:gy}=GATE;
 for(const yy of [gy-36,gy+36]){rect(ctx,'#6e7561',gx-5,yy-8,9,17);rect(ctx,'#d0c9a9',gx-7,yy-11,13,5);}
 rect(ctx,'#4d5748',gx+6,gy+22,49,62);rect(ctx,'#102f31',gx+8,gy+23,45,59);
 drawGameLogo(ctx,gx+10,gy+27,41,35);
 ctx.font='bold 7px monospace';ctx.textAlign='center';ctx.fillStyle='#e8edba';ctx.fillText('← ENTRADA',gx+30,gy+75);
 if(!gateOpen){rect(ctx,'#3b5144',gx-2,gy-28,4,56);for(let yy=gy-27;yy<gy+28;yy+=7)rect(ctx,'#a4b497',gx-3,yy,6,2);}
 
 
 drawDayAtmosphere(ctx,camera,{time:lifeTime,night:nightAmount(lifeTime),match:activeCourt!==null,animate});
 drawNight(ctx,camera,lifeTime);
 drawHalloweenAtmosphere(ctx,camera,time,activeCourt!==null);
 ctx.restore();
}
export function renderMiniMap(canvas,camera=null,player=null){
 if(!minimap){minimap=surface(256,256);renderClub(minimap.getContext('2d'),{x:0,y:0,w:WORLD_SIZE,h:WORLD_SIZE},{animate:false});}
 const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(minimap,0,0,canvas.width,canvas.height);
 const s=canvas.width/WORLD_SIZE;
 if(camera){c.strokeStyle='#fff3bd';c.lineWidth=1;c.strokeRect(camera.x*s,camera.y*s,camera.w*s,camera.h*s);}
 if(player){rect(c,'#243d33',player.x*s-3,player.y*s-3,7,7);rect(c,'#fff2a2',player.x*s-2,player.y*s-2,5,5);}
}
export function paintScenePreviews(){
 paintGameLogos();
 for(const canvas of document.querySelectorAll('[data-club-preview]')){
  canvas.width=canvas.dataset.clubPreview==='cover'?768:512;canvas.height=canvas.width;
  renderClub(canvas.getContext('2d'),{x:0,y:0,w:WORLD_SIZE,h:WORLD_SIZE},{animate:false});
 }
}
