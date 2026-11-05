import {WORLD_SIZE,COURTS,SAND_COURTS,PICKLEBALL,DECOR,BUILDINGS,waterAt,hash} from './scenery-data.js';
import {HALLOWEEN_LIGHTS,GARLANDS} from './halloween-art.js';

// World-space light maps are built once at terrain resolution (not per frame).
// Removing darkness reveals the material beneath; additive fog would wash it out.
export const LIGHTMAP_SIZE=WORLD_SIZE/2;
export const NIGHT_DARKNESS=.48;
export const FLOODLIGHTS=DECOR.filter(o=>o.kind==='lamp');
export const PRACTICAL_LIGHTS=[
 // Follow the bar's proportional, bottom-anchored facade rather than its old
 // stretched rectangle: bulbs stay below the roof and glow on the counter.
 ...[302,350,398,446,478].map(x=>({kind:'bar',x,y:578,rx:48,ry:62,power:.64,warm:.34})),
 {kind:'counter',x:412,y:622,rx:93,ry:49,power:.76,warm:.28},
 ...[[543,676],[490,739],[490,842],[490,948],[490,1053]].map(([x,y])=>({kind:'step',x,y,rx:62,ry:77,power:.78,warm:.46})),
 ...[[512,1125],[520,1286],[875,1290],[969,1174],[1046,444],[1048,876]].map(([x,y])=>({kind:'path',x,y,rx:78,ry:68,power:.61,warm:.23})),
];
export const LIGHT_POOLS=[
 ...HALLOWEEN_LIGHTS,
 ...GARLANDS.flatMap(([x1,y1,x2,y2])=>Array.from({length:5},(_,i)=>({x:x1+(x2-x1)*i/4,y:y1+(y2-y1)*i/4+14,rx:62,ry:55,power:.38,warm:.12,color:i%2?'193,155,246':'255,204,137'}))),
 ...COURTS.map(c=>({x:c.x+c.width/2,y:c.y+c.height/2,rx:205,ry:285,power:.86,warm:.10,color:'177,207,255'})),
 ...SAND_COURTS.map(c=>({x:c.x+c.w/2,y:c.y+c.h/2,rx:154,ry:152,power:.76,warm:.11,color:'255,218,165'})),
 {x:PICKLEBALL.x+PICKLEBALL.w/2,y:PICKLEBALL.y+PICKLEBALL.h/2,rx:235,ry:150,power:.86,warm:.10,color:'177,207,255'},
 ...FLOODLIGHTS.map(o=>({x:o.x+5,y:o.y-18,rx:150,ry:140,power:.77,warm:.15,color:'196,218,255'})),
 ...PRACTICAL_LIGHTS.map(o=>({...o,color:o.kind==='bar'||o.kind==='counter'?'255,190,107':'235,215,172',y:o.y+(o.kind==='bar'?27:8)})),
 // Counter light spills through the open front onto faces on the terrace.
 {x:398,y:665,rx:145,ry:86,power:.65,warm:.17},
 // A soft approach light keeps the guide and entrance readable at night.
 {x:945,y:411,rx:158,ry:105,power:.50,warm:.09},
 {x:545,y:644,rx:121,ry:79,power:.52,warm:.18},
];
const ROOFS=BUILDINGS.map(b=>({x:b.x-3,y:b.y-3,w:b.w+6,h:b.kind==='longbar'?b.h:b.kind==='barwing'?31:b.kind==='woodcabin'?43:Math.max(24,b.h-43)}));
const smooth=t=>t*t*(3-2*t);
export function lightFalloff(light,x,y){
 const d=Math.hypot((x-light.x)/light.rx,(y-light.y)/light.ry);
 if(d>=1)return 0;
 return d<=.15?1:1-smooth((d-.15)/.85);
}
export function darknessAt(x,y){
 let shade=NIGHT_DARKNESS;
 for(const light of LIGHT_POOLS)shade*=1-light.power*lightFalloff(light,x,y);
 // Do not illuminate roofs through their walls, but keep a cool moonlit silhouette.
 if(ROOFS.some(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h))shade=.40;
 return shade;
}
const visible=(v,x,y,r=32)=>x+r>v.x&&x-r<v.x+v.w&&y+r>v.y&&y-r<v.y+v.h;
const pixel=(c,color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);};
let maps=null,halo=null;
function canvas(size){const c=document.createElement('canvas');c.width=size;c.height=size;return c;}
function pool(c,light,color,strength){
 c.save();c.translate(light.x,light.y);c.scale(light.rx,light.ry);
 const g=c.createRadialGradient(0,0,0,0,0,1);
 for(const t of [0,.15,.3,.5,.7,.85,1])g.addColorStop(t,`rgba(${color},${strength*(t<=.15?1:1-smooth((t-.15)/.85))})`);
 c.fillStyle=g;c.fillRect(-1,-1,2,2);c.restore();
}
function lightMaps(){
 if(maps)return maps;
 const shade=canvas(LIGHTMAP_SIZE),bounce=canvas(LIGHTMAP_SIZE),s=shade.getContext('2d'),b=bounce.getContext('2d');
 s.scale(.5,.5);b.scale(.5,.5);
 s.fillStyle=`rgba(15,20,43,${NIGHT_DARKNESS})`;s.fillRect(0,0,WORLD_SIZE,WORLD_SIZE);
 s.globalCompositeOperation='destination-out';
 for(const light of LIGHT_POOLS){pool(s,light,'0,0,0',light.power);pool(b,light,light.color||'185,196,236',light.warm);}
 // Replace (rather than stack) ambient darkness on opaque roof footprints.
 s.globalCompositeOperation='source-over';
 for(const r of ROOFS){s.clearRect(r.x,r.y,r.w,r.h);s.fillStyle='rgba(15,20,43,.40)';s.fillRect(r.x,r.y,r.w,r.h);b.clearRect(r.x,r.y,r.w,r.h);}
 maps={shade,bounce};return maps;
}
function haloSprite(){
 if(halo)return halo;
 halo=canvas(48);const c=halo.getContext('2d'),g=c.createRadialGradient(24,24,0,24,24,24);
 g.addColorStop(0,'#fff2c3d9');g.addColorStop(.12,'#ffd58fb3');g.addColorStop(.35,'#eab0672e');g.addColorStop(1,'#ed861900');
 c.fillStyle=g;c.fillRect(0,0,48,48);return halo;
}
export function drawLightFixture(c,o){
 if(o.kind==='counter')return;
 const w=o.kind==='bar'?4:8,h=o.kind==='path'?9:5;
 pixel(c,'#142c2a99',o.x-2,o.y+2,w+3,3);
 pixel(c,'#324038',o.x-w/2-1,o.y-h/2-1,w+2,h+2);
 pixel(c,'#a58a52',o.x-w/2,o.y-h/2,w,h);
 pixel(c,'#e1cca0',o.x-w/2+1,o.y-h/2+1,w-2,h-2);
 if(o.kind==='path')pixel(c,'#2c3b32',o.x-1,o.y+5,3,7);
}
export function drawSceneLighting(c,camera,night,time){
 if(night<=0)return;
 const {shade,bounce}=lightMaps();
 c.save();c.imageSmoothingEnabled=true;c.globalAlpha=night;c.drawImage(shade,0,0,WORLD_SIZE,WORLD_SIZE);
 c.globalCompositeOperation='soft-light';c.drawImage(bounce,0,0,WORLD_SIZE,WORLD_SIZE);
 c.globalCompositeOperation='screen';c.imageSmoothingEnabled=false;
 // Small halos stay at the actual luminous faces, not midway down the posts.
 const glow=haloSprite();
 for(const lamp of FLOODLIGHTS){
  const y=lamp.y-94;if(!visible(camera,lamp.x,y,38))continue;
  c.globalAlpha=night*.92;c.drawImage(glow,lamp.x-38,y-26,76,52);
  c.globalAlpha=night;
  for(let i=0;i<4;i++){const x=lamp.x-16+i*10;pixel(c,'#96e97a',x-1,y-3,8,7);pixel(c,'#fff4c5',x,y-2,6,4);pixel(c,'#ffffec',x+1,y-2,4,3);}
 }
 for(const o of PRACTICAL_LIGHTS){
  if(!visible(camera,o.x,o.y,44))continue;
  c.globalAlpha=night*(o.kind==='counter'?.6:.9);c.drawImage(glow,o.x-25,o.y-22,50,44);
  c.globalAlpha=night;
  if(o.kind==='counter'){pixel(c,'#f8b948',o.x-25,o.y-3,50,1);continue;}
  const w=o.kind==='bar'?3:6;pixel(c,'#9365cc',o.x-w/2-1,o.y-3,w+2,6);pixel(c,'#fff3ba',o.x-w/2,o.y-2,w,4);pixel(c,'#fffbe2',o.x-w/2+1,o.y-2,w-2,2);
 }
 c.globalCompositeOperation='source-over';
 // Moonlight is broken into pixel ripples, never a flat stripe across the bank.
 for(let y=Math.max(1240,Math.floor(camera.y/12)*12);y<Math.min(WORLD_SIZE,camera.y+camera.h);y+=12){
  const x=1240+Math.sin(y*.024)*36+Math.sin(time*.35+y)*5,width=15+hash(y,8)%49;
  if(!visible(camera,x,y,60)||!waterAt(x-width/2,y)||!waterAt(x+width/2,y))continue;
  c.globalAlpha=night*(.10+(hash(y,4)%5)*.025);pixel(c,'#abc9d9',x-width/2,y,width,1);pixel(c,'#829cb5',x-width/2+9,y+3,width*.6,1);
 }
 c.restore();
}
