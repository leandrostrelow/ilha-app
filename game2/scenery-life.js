import {LANDMARK_TREES,COURTS,SAND_COURTS,PICKLEBALL,inRect,waterAt} from './scenery-data.js';
import {drawSceneLighting} from './scenery-lighting.js';

export const DAY_PHASE_SECONDS=180;
const smooth=t=>t*t*(3-2*t);
export function nightAmount(time){const phase=((time%360)+360)%360;return phase<168?0:phase<180?smooth((phase-168)/12):phase<348?1:1-smooth((phase-348)/12);}
let elapsed=0,last=null;
export const currentSceneTime=()=>elapsed;
export function sceneClock(now){if(last!==null&&now>=last&&now-last<500)elapsed+=(now-last)/1000;last=now;return elapsed;}
const visible=(camera,x,y,pad=80)=>x+pad>camera.x&&x-pad<camera.x+camera.w&&y+pad>camera.y&&y-pad<camera.y+camera.h;
const pixel=(c,color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);};
export function boatPosition(time){const t=(time%95)/32;if(t>1)return null;return {x:650+t*830,y:1510-t*122};}
export function fishPosition(time,index=0){const phase=(time+index*11)%29;if(phase>1.8)return null;return {x:1060+index*132+phase*20,y:1457-index*27-Math.sin(phase/1.8*Math.PI)*29,phase};}
const monkeys=LANDMARK_TREES.filter(t=>['entry-shade','bar-shade','pickle-west-shade'].includes(t.id));
export function ambientCue(time,camera){
 if(time%19<.15&&monkeys.some(t=>visible(camera,t.x,t.y-76,20)))return {kind:'monkey',key:`monkey-${Math.floor(time/19)}`};
 if(time%24>6&&time%24<6.15&&visible(camera,738,440,100))return {kind:'bird',key:`bird-${Math.floor(time/24)}`};
 for(let i=0;i<3;i++){const fish=fishPosition(time,i);if(fish&&fish.phase<.15&&visible(camera,fish.x,fish.y,20))return {kind:'splash',key:`fish-${i}-${Math.floor((time+i*11)/29)}`};}
 if(time%38>9&&time%38<9.3)return {kind:'wind',key:`wind-${Math.floor(time/38)}`};
 if(time%17>11&&time%17<11.25&&nightAmount(time)<.5)return {kind:'bird',key:`club-bird-${Math.floor(time/17)}`};
 return null;
}
export function drawWildlife(c,camera,time){
 for(let i=0;i<monkeys.length;i++){
  const tree=monkeys[i],swing=Math.sin(time*1.6+i)*5,x=tree.x+15+swing,y=tree.y-76+Math.cos(time*1.6+i)*3;
  if(!visible(camera,x,y,35))continue;
  c.strokeStyle='#5e3b22';c.lineWidth=3;c.beginPath();c.moveTo(x+3,y+7);c.quadraticCurveTo(x+22,y+17,x+16,y-3);c.stroke();
  pixel(c,'#493024',x-5,y,11,13);pixel(c,'#9c6437',x-4,y-8,10,10);pixel(c,'#704426',x-7,y-5,4,5);pixel(c,'#704426',x+5,y-5,4,5);pixel(c,'#e4ba7a',x-2,y-4,7,6);pixel(c,'#201f1b',x-1,y-3,2,2);pixel(c,'#201f1b',x+3,y-3,2,2);
  pixel(c,'#9c6437',x-9,y+2,5,3);pixel(c,'#9c6437',x+5,y-3-swing*.4,3,10);pixel(c,'#c79b58',x-5,y+11,4,3);pixel(c,'#c79b58',x+3,y+10,4,3);
  if(Math.sin(time+i)>0)pixel(c,'#c2c45b',x+9,y+5,2,3);
 }
 const birdPhase=time%24;
 if(birdPhase<13)for(let i=0;i<4;i++){
  const x=-60+birdPhase*133-i*25,y=440+Math.sin(time*.3)*110+i*14;if(!visible(camera,x,y,30))continue;
  const wing=Math.sin(time*12+i)>0?-4:3;pixel(c,'#142c36',x,y,5,3);pixel(c,'#e6dfb8',x+1,y,3,1);pixel(c,'#23434b',x-4,y+wing,5,2);pixel(c,'#23434b',x+5,y+wing,5,2);
 }
 const boat=boatPosition(time);
 if(boat&&visible(camera,boat.x,boat.y)&&waterAt(boat.x,boat.y)){
  const {x,y}=boat;pixel(c,'#b9e6e4aa',x-29,y+9,33,2);pixel(c,'#b9e6e455',x-40,y+13,24,1);
  pixel(c,'#312f29',x-19,y+2,45,7);pixel(c,'#a97945',x-15,y-2,36,7);pixel(c,'#e7c88b',x-14,y-3,32,2);pixel(c,'#31566c',x-7,y-8,16,7);pixel(c,'#cbe8df',x-5,y-7,12,4);pixel(c,'#ecd5a3',x+15,y-4,4,4);
 }
 for(let i=0;i<3;i++){
  const fish=fishPosition(time,i);if(!fish||!visible(camera,fish.x,fish.y,30)||!waterAt(fish.x,fish.y))continue;
  const {x,y,phase}=fish;pixel(c,'#cadacc',x-4,y,9,4);pixel(c,'#51899c',x-6,y+1,3,3);pixel(c,'#183f54',x+3,y,1,1);
  if(phase<.3||phase>1.5)for(let j=0;j<5;j++)pixel(c,'#d5f5ee',x-12+j*6,y+7+Math.sin(time*9+j)*3,2,2);
 }
}
const sportsAreas=[...COURTS.map(c=>c.grounds),...SAND_COURTS,PICKLEBALL];
// Shared, deterministic weather: a short breeze followed by a calm interval.
export function windStrength(time){
 const phase=((time%38)+38)%38;
 return phase<5||phase>19?0:Math.sin((phase-5)/14*Math.PI)**2;
}
export function treeSway(time,tree){
 const gust=windStrength(time),phase=tree.x*.011+tree.y*.007;
 return gust*(.55+Math.sin(time*1.7+phase)*.45)*(tree.kind==='palm'?.035:.019);
}
export function cloudPosition(time,index){
 return {x:((time*7+index*573)%2100+2100)%2100-280,y:260+index*370+Math.sin(time*.025+index)*55};
}
export function clayDust(time){
 const strength=Math.max(0,(windStrength(time)-.55)/.45);if(!strength)return [];
 const particles=[];
 for(const court of COURTS)for(let i=0;i<24;i++){
  const phase=((time*.38+i*.173)%1+1)%1,g=court.grounds;
  particles.push({x:g.x+8+phase*(g.w-16),y:(i%2?g.y+g.h-13:g.y+12)+Math.sin(time*2+i)*5,
   alpha:strength*Math.sin(phase*Math.PI)*.20,width:3+i%4});
 }
 return particles;
}
export function drawWeather(c,camera,time,{match=false}={}){
 const daylight=1-nightAmount(time)*.8;c.save();
 // Large translucent shapes suggest clouds seen from above, with drifting shade.
 // Four clouds only; no filters, textures or per-frame offscreen canvases.
 for(let i=0;i<4;i++){
  const {x,y}=cloudPosition(time,i);if(!visible(camera,x,y,300))continue;
  for(const [offset,color,alpha] of [[32,'#20383c',.055],[0,'#eef8ec',.065]]){
   c.fillStyle=color;c.globalAlpha=alpha*daylight*(match?.45:1);
   c.beginPath();
   c.moveTo(x-155,y+offset);c.bezierCurveTo(x-170,y-47+offset,x-81,y-61+offset,x-58,y-34+offset);
   c.bezierCurveTo(x-38,y-98+offset,x+69,y-81+offset,x+79,y-34+offset);
   c.bezierCurveTo(x+161,y-61+offset,x+215,y+34+offset,x+107,y+47+offset);
   c.bezierCurveTo(x+35,y+84+offset,x-148,y+57+offset,x-155,y+offset);c.fill();
  }
 }
 const wind=windStrength(time);
 // Low, elongated terracotta wisps stay on the aprons, off the playing lines.
 for(const p of clayDust(time)){
  if(!visible(camera,p.x,p.y,15))continue;
  c.globalAlpha=p.alpha*(match?.55:1);pixel(c,'#ca8750',p.x,p.y,p.width*3,2);
  c.globalAlpha=p.alpha*.65;pixel(c,'#edb17c',p.x-5,p.y-3,p.width,1);
 }
 // A few tumbling leaves accompany strong gusts without covering the courts.
 if(wind>.55)for(let i=0;i<10;i++){
  const x=((time*48+i*197)%1700)-80,y=380+i*91+Math.sin(time*3+i)*9;
  if(!visible(camera,x,y,10)||sportsAreas.some(a=>inRect(x,y,[a.x,a.y,a.w,a.h],24)))continue;
  c.globalAlpha=(wind-.55)*.45;pixel(c,i%2?'#b8a564':'#819757',x,y,Math.sin(time*5+i)>0?4:2,2);
 }
 if(wind>.03)for(let i=0;i<8;i++){
  const phase=(time*.34+i*.137)%1,x=((time*41+i*233)%1750)-100,y=180+i*164+Math.sin(time*.7+i)*14;
  if(!visible(camera,x,y,90)||sportsAreas.some(a=>inRect(x,y,[a.x,a.y,a.w,a.h],80)))continue;
  c.globalAlpha=wind*Math.sin(phase*Math.PI)*.24*daylight;c.strokeStyle='#eef5d9';c.lineWidth=1.4;
  c.beginPath();c.moveTo(x-40,y+4);c.quadraticCurveTo(x-10,y-8,x+23,y);c.quadraticCurveTo(x+40,y+4,x+47,y-5);c.stroke();
 }
 c.restore();
}
export function fireflyPosition(time,index){
 const x=310+(index*83)%710+Math.sin(time+index)*7,y=670+(index*71)%600+Math.cos(time*.7+index)*8;
 // Decorative yellow pixels must never be mistaken for the match ball.
 if(sportsAreas.some(a=>inRect(x,y,[a.x,a.y,a.w,a.h],14)))return null;
 return {x,y};
}
export function drawNight(c,camera,time){
 const night=nightAmount(time);if(night<=0)return;
 drawSceneLighting(c,camera,night,time);c.save();
 for(let i=0;i<16;i++){const point=fireflyPosition(time,i);if(!point||!visible(camera,point.x,point.y,5))continue;c.globalAlpha=night*(.3+.5*Math.max(0,Math.sin(time*2+i)));pixel(c,'#d9ee84',point.x,point.y,2,2);}
 c.restore();
}
