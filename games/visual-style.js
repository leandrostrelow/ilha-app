import {WORLD_SIZE,COURTS,BUILDINGS,terrainAt,waterAt,shoreX,hash} from './scenery-data.js';

// Rendering only. No collisions, progression, clocks or match state live here.
export const SCENE_PALETTE=Object.freeze({
 grass:['#35584a','#3b604e','#42674f','#486d53'],lawn:['#71945b','#789c61','#80a268','#73965e'],
 path:['#c9b18a','#d0b991','#d6c09a','#d9c69f'],gravel:['#9caca5','#a8b6aa','#b7c1b1','#94a39d'],
 cobbles:['#a2a48c','#b1b199','#969d89','#bcbba2'],earth:['#baa77e','#c5b38b','#b4a37a','#cdbb92'],
 bank:['#6a7e60','#89936a','#ada57c','#82916d'],water:['#317481','#397e89','#428b95','#4c97a0'],
 city:['#9aa697','#a7af9c','#a9b1a0','#a0ab99'],deck:['#967451','#a78359','#b38e62','#997852'],
});
export const isPlayingSurface=(x,y)=>COURTS.some(c=>x>=c.x&&x<=c.x+c.width&&y>=c.y&&y<=c.y+c.height);
const pixel=(c,color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);};

// The existing renderer paints the exact playing lines and nets on top.
// Texturing is cached in the world terrain, not regenerated during a rally.
export function paintCourtMaterial(c,court){
 const g=court.grounds;
 pixel(c,'#324b43',g.x-3,g.y-3,g.w+6,g.h+6);
 pixel(c,'#765040',g.x,g.y,g.w,g.h);
 const wash=c.createLinearGradient(g.x,g.y,g.x+g.w,g.y+g.h);
 wash.addColorStop(0,'#d18d62');wash.addColorStop(.48,'#bd7451');wash.addColorStop(1,'#ac654b');
 c.fillStyle=wash;c.fillRect(g.x+3,g.y+3,g.w-6,g.h-6);
 pixel(c,'#f1c99148',g.x+4,g.y+4,g.w-8,2);
 pixel(c,'#693f3938',g.x+g.w-5,g.y+4,2,g.h-8);
 for(let i=0;i<1600;i++){
  const x=g.x+5+hash(i,court.id)%(g.w-10),y=g.y+5+hash(i,42)%(g.h-10);
  pixel(c,i%3?'#e2a77516':'#6c453518',x,y,1+i%3,1);
 }
 for(let y=g.y+9;y<g.y+g.h-7;y+=5)pixel(c,'#f3cc9420',g.x+6,y,g.w-12,1);
 // Brushed, low-contrast baseline wear adds material, not false ball markers.
 c.save();c.strokeStyle='#f6be7b38';c.lineWidth=2;
 for(const y of [court.y-7,court.y+court.height+10])for(let i=0;i<5;i++){
  const x=court.x+27+i*22;c.beginPath();c.ellipse(x,y,13,2.5,.1,0,Math.PI*.9);c.stroke();
 }
 c.restore();
}

// More volume at feet of buildings and shoreline, baked beneath all actors.
export function paintGroundFinish(c){
 for(const b of BUILDINGS){
  pixel(c,'#173e3940',b.x+5,b.y+b.h,b.w,3);
  pixel(c,'#254d3f20',b.x+9,b.y+b.h+3,b.w-8,5);
 }
 for(let y=160;y<WORLD_SIZE;y+=6){
  const x=shoreX(y),h=hash(y,19);
  if(waterAt(x+6,y))pixel(c,'#7abab044',x+2,y,8+h%10,2);
 }
 for(let y=385;y<1360;y+=17)for(let x=236;x<1080;x+=19){
  const t=terrainAt(x,y),h=hash(x,y,92);
  if(!['grass','lawn'].includes(t)||h%5)continue;
  // Clustered grass in three tones replaces isolated bright square noise.
  pixel(c,'#244b3e38',x,y+3,8,2);pixel(c,t==='lawn'?'#9bb975':'#5f825b',x,y,2,4);
  pixel(c,t==='lawn'?'#88aa66':'#527c53',x+3,y-2,2,6);pixel(c,'#b5c68a55',x+3,y-2,1,2);
 }
}

let sunbeams;
function beamTexture(){
 if(sunbeams)return sunbeams;
 sunbeams=document.createElement('canvas');sunbeams.width=260;sunbeams.height=290;
 const c=sunbeams.getContext('2d');
 const wash=c.createLinearGradient(0,0,185,290);wash.addColorStop(0,'#ffe3a900');wash.addColorStop(.28,'#ffe3a91c');wash.addColorStop(.7,'#ffe3a915');wash.addColorStop(1,'#ffe3a900');
 c.fillStyle=wash;
 for(const [x,w]of [[-35,26],[40,15],[109,30]]){c.beginPath();c.moveTo(x,0);c.lineTo(x+w,0);c.lineTo(x+w+123,290);c.lineTo(x+103,290);c.closePath();c.fill();}
 return sunbeams;
}
export function drawDayAtmosphere(c,camera,{time=0,night=0,match=false,animate=true}={}){
 if(night>=.98)return;
 // Only the social grove: no shafts, sparkles or haze over a live ball/court.
 if(camera.x>550||camera.x+camera.w<220||camera.y>800||camera.y+camera.h<475)return;
 c.save();c.globalAlpha=(1-night)*(match?.25:1);c.drawImage(beamTexture(),260,455,260,290);
 if(animate&&!match){
  for(let i=0;i<9;i++){
   const x=292+i*21+Math.sin(time*.35+i)*5,y=586+(i*29+time*3)%116;
   if(x<camera.x||x>camera.x+camera.w||y<camera.y||y>camera.y+camera.h)continue;
   c.globalAlpha=(1-night)*(.09+.12*Math.max(0,Math.sin(time+i)));
   pixel(c,'#f5dba4',x,y,1,1);
  }
 }
 c.restore();
}
