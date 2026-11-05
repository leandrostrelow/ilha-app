import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {PREMIUM_AVATAR_URL,VICTORY_AVATAR_URL,premiumAvatarFrame,premiumVictoryFrame} from '../games/premium-avatars.js';
import {heroFrame} from '../games/sprite-frames.js';
import {AMBIENT_NPCS} from '../games/ambient-npcs.js';
import {EXTRA_MATCH_ATLAS_URL,extraMatchFrame,extraMatchGrip} from '../games/match-sprites.js';
import {SCENE_PALETTE,paintCourtMaterial,drawDayAtmosphere} from '../games/visual-style.js';
import {COURTS} from '../games/scenery-data.js';
import {darknessAt} from '../games/scenery-lighting.js';

test('premium avatars cover distinct front, back, profile, both footsteps and ready poses',()=>{
 const frames=new Set();
 for(const id of ['player-m','player-f'])for(const facing of ['down','up','right']){
  const idle=premiumAvatarFrame(id,facing),walk1=premiumAvatarFrame(id,facing,.25),walk2=premiumAvatarFrame(id,facing,1.25),ready=premiumAvatarFrame(id,facing,0,true);
  for(const pose of [idle,walk1,walk2,ready]){frames.add(pose.index);assert.equal(pose.reference,idle.index);assert.ok(pose.grip[1]<0);}
  assert.equal(premiumAvatarFrame(id,facing,.75).index,idle.index);
  assert.equal(premiumAvatarFrame(id,facing,1.75).index,idle.index);
  assert.equal(premiumAvatarFrame(id,'left').index,premiumAvatarFrame(id,'right').index);
  assert.equal(premiumAvatarFrame(id,'left').flip,true);
 }
 assert.equal(frames.size,24);assert.equal(Math.max(...frames),23);
 for(const id of ['malu','betinho','scarlt','gael','unknown'])assert.equal(premiumAvatarFrame(id),null);
});

test('new assets are versioned RGBA PNGs; original art remains available',()=>{
 for(const asset of [PREMIUM_AVATAR_URL.replace('.webp','.png'),VICTORY_AVATAR_URL.replace('.webp','.png'),'/games/assets/ilha-bar-premium-v1.png','/games/assets/tropical-foliage-premium-v1.png']){
  const png=readFileSync(new URL(`..${asset}`,import.meta.url));
  assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png[25],6,'preserve native alpha');
  assert.ok(png.readUInt32BE(16)>1000);assert.ok(png.readUInt32BE(20)>700);
  const webp=readFileSync(new URL(`..${asset.replace('.png','.webp')}`,import.meta.url));
  assert.equal(webp.subarray(8,12).toString(),'WEBP');assert.ok(webp.length<png.length);
 }
 for(const name of ['ilha-legado-players-v1.png','ilha-bar-32bit-v1.png','tropical-foliage-32bit-v1.png'])assert.ok(readFileSync(new URL(`../games/assets/${name}`,import.meta.url)).length>0);
});

const source=readFileSync(new URL('../games/characters.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export const heroesReady=Promise.all\(.*$/m,'const heroesReady=Promise.resolve();').replaceAll('export ','');
function drawing(){
 const calls=[],ctx=new Proxy({},{get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
 const code=runInNewContext(source+';({drawHero,atlases})',{AMBIENT_NPCS,heroFrame,extraMatchFrame,extraMatchGrip,EXTRA_MATCH_ATLAS_URL,PREMIUM_AVATAR_URL,VICTORY_AVATAR_URL,premiumAvatarFrame,premiumVictoryFrame});
 for(const name of ['premium','victory','players','walk','npcs','backs','extras-match'])code.atlases[name]={image:{name},frames:Array.from({length:24},(_,i)=>({x:i*20,y:0,w:20,h:i>=18?36:40}))};
 return {calls,ctx,...code};
}
test('each avatar has exactly one hand-attached racket in both sports, all directions and ready stance',()=>{
 const {calls,ctx,drawHero}=drawing();
 for(const id of ['player-m','player-f'])for(const facing of ['down','up','left','right'])for(const equipment of ['tennis','pickleball',null])for(const ready of [true,false]){
  calls.length=0;drawHero(ctx,30,50,{id},{height:40,facing,equipment,ready,shadow:false});
  assert.equal(calls.filter(c=>c[0]==='clip').length,1);
  const draw=calls.find(c=>c[0]==='drawImage');assert.equal(draw[1].name,'premium');
  assert.equal(draw[7]+draw[9],0,'feet stay on the ground even in the shorter crouching frame');
 }
});
test('failed optional avatar art falls back to old, equipped sprites without changing NPC poses',()=>{
 const {calls,ctx,drawHero,atlases}=drawing();delete atlases.premium;
 for(const id of ['player-m','player-f'])for(const facing of ['up','down','left']){
  calls.length=0;drawHero(ctx,0,0,{id},{facing,equipment:'tennis'});
  assert.equal(calls.find(c=>c[0]==='drawImage')[1].name,heroFrame(id,facing).atlas);
  assert.equal(calls.filter(c=>c[0]==='clip').length,0,'legacy sprites already contain a racket');
 }
 calls.length=0;drawHero(ctx,0,0,{id:'betinho'},{facing:'up',equipment:'pickleball'});
 assert.equal(calls.find(c=>c[0]==='drawImage')[1].name,'extras-match');
});
test('clay finish is deterministic, bounded to its apron and never modifies court geometry',()=>{
 const before=JSON.stringify(COURTS),calls=[];
 const ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]||((...args)=>calls.push([k,...args])),set:()=>true});
 for(const court of COURTS){
  calls.length=0;paintCourtMaterial(ctx,court);const first=JSON.stringify(calls);calls.length=0;paintCourtMaterial(ctx,court);assert.equal(JSON.stringify(calls),first);
  const g=court.grounds;for(const call of calls.filter(c=>c[0]==='fillRect')){const [,x,y,w,h]=call;assert.ok(x>=g.x-3&&y>=g.y-3&&x+w<=g.x+g.w+3&&y+h<=g.y+g.h+3);}
 }
 assert.equal(JSON.stringify(COURTS),before);assert.equal(SCENE_PALETTE.grass.length,4);
});
test('day lighting is culled at night, uses a single cached texture and emits no match particles',()=>{
 const previous=globalThis.document,calls=[];let allocations=0;
 const ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]||((...args)=>calls.push([k,...args])),set:()=>true});
 globalThis.document={createElement(){allocations++;return {getContext:()=>ctx};}};
 try{
  const camera={x:220,y:475,w:330,h:325};
  drawDayAtmosphere(ctx,camera,{night:1});drawDayAtmosphere(ctx,{x:1100,y:1200,w:100,h:100});assert.equal(allocations,0);
  drawDayAtmosphere(ctx,camera,{animate:false});assert.equal(allocations,1);
  calls.length=0;drawDayAtmosphere(ctx,camera,{match:true});assert.equal(allocations,1);assert.equal(calls.filter(c=>c[0]==='fillRect').length,0);
  calls.length=0;drawDayAtmosphere(ctx,camera,{time:8});assert.ok(calls.filter(c=>c[0]==='fillRect').length<=9);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('warm bar spill keeps the terrace conversation readable without illuminating its roof',()=>{
 assert.ok(darknessAt(398,665)<.35);
 assert.ok(darknessAt(398,693)<.40);
 assert.equal(darknessAt(398,523),.64);
});
test('victory has its own two-arm pose, no racket, and no artificial arms drawn over it',()=>{
 const {calls,ctx,drawHero,atlases}=drawing();
 for(const id of ['player-m','player-f']){
  calls.length=0;drawHero(ctx,0,0,{id},{celebrating:true});
  assert.equal(calls.find(c=>c[0]==='drawImage')[1].name,'victory');
  assert.equal(calls.filter(c=>c[0]==='clip').length,0);
 }
 delete atlases.victory;calls.length=0;drawHero(ctx,0,0,{id:'player-m'},{celebrating:true});assert.equal(calls.find(c=>c[0]==='drawImage')[1].name,'premium');
 const film=readFileSync(new URL('../games/ending-film.js',import.meta.url),'utf8');
 assert.match(film,/celebrating:n.isHero&&celebrating&&!focus/);assert.doesNotMatch(film,/n\.x\+side\*10-1/);
});
