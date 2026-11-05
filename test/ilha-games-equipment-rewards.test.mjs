import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {matchRacketGrip} from '../games/characters.js';
import {AMBIENT_NPCS} from '../games/ambient-npcs.js';
import {heroFrame} from '../games/sprite-frames.js';
import {EXTRA_MATCH_IDS,EXTRA_MATCH_ATLAS_URL,extraMatchFrame,extraMatchGrip} from '../games/match-sprites.js';
import {QUICK_CHARACTERS} from '../games/quick-play.js';
import {readAdventure,advanceAdventure,NPCS,EXPLORE,RIVALS} from '../games/adventure.js';

const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
test('every unarmed NPC gets a hand-anchored racket in both match roles, never a duplicate',()=>{
 const main=['romulo','beto','felipe','leandro'],extras=EXTRA_MATCH_IDS;
 for(const id of [...main,...extras])for(const facing of ['down','left','right','up']){
  const grip=matchRacketGrip(id,facing);
  if(main.includes(id)&&facing==='up')assert.equal(grip,null,'back atlas already holds a racket');
  else {assert.equal(grip.length,2);assert.ok(grip[1]<-.25&&grip[1]>-.5);}
 }
 for(const p of QUICK_CHARACTERS.filter(p=>![...main,...extras].includes(p.id)))assert.equal(matchRacketGrip(p.id),null,p.id);
});
test('equipment draws on the athlete transform only during matches in either sport',()=>{
 const source=readFileSync(new URL('../games/characters.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export const heroesReady=Promise.all\(.*$/m,'const heroesReady=Promise.resolve();').replaceAll('export ','');
 const calls=[],ctx=new Proxy({},{get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
 const result=runInNewContext(source+';({drawHero,atlases})',{AMBIENT_NPCS,heroFrame,extraMatchFrame,extraMatchGrip,EXTRA_MATCH_ATLAS_URL});
 for(const name of ['players','npcs','backs','walk','extras-match',...AMBIENT_NPCS.map(n=>`ambient:${n.id}`)])result.atlases[name]={image:{name},frames:Array.from({length:18},(_,i)=>({x:i*20,y:0,w:20,h:40}))};
 for(const id of [...EXTRA_MATCH_IDS,'beto','romulo'])for(const sport of ['tennis','pickleball'])for(const facing of ['down','left','right','up']){
  calls.length=0;result.drawHero(ctx,10,20,{id},{height:40,shadow:false,facing,swing:4,equipment:sport});
  assert.equal(calls.filter(c=>c[0]==='clip').length,matchRacketGrip(id,facing)?1:0);
  if(matchRacketGrip(id,facing))assert.ok(calls.findIndex(c=>c[0]==='rotate')<calls.findIndex(c=>c[0]==='clip'),'equipment follows swing transform');
  if(EXTRA_MATCH_IDS.includes(id)){
   const draw=calls.find(c=>c[0]==='drawImage');assert.equal(draw[1].name,'extras-match');assert.equal(draw[2],extraMatchFrame(id,facing).index*20);
  }
 }
 calls.length=0;result.drawHero(ctx,0,0,{id:'malu'},{shadow:false});assert.equal(calls.some(c=>c[0]==='clip'),false);
 assert.equal(calls.find(c=>c[0]==='drawImage')[1].name,'ambient:malu','conversation art is unchanged');
});
test('all nine extra NPCs have separate front/back gameplay frames and no unknown identity falls through to Gael',()=>{
 assert.deepEqual(new Set(EXTRA_MATCH_IDS),new Set(AMBIENT_NPCS.map(n=>n.id)));
 const frames=new Set();for(const id of EXTRA_MATCH_IDS){
  const front=extraMatchFrame(id,'down'),back=extraMatchFrame(id,'up');frames.add(front.index);frames.add(back.index);
  assert.notEqual(front.index,back.index);assert.equal(extraMatchFrame(id,'left').flip,true);assert.equal(extraMatchFrame(id,'right').flip,false);
  assert.equal(extraMatchFrame(id,'left').index,front.index);assert.ok(extraMatchGrip(id,'up'));
 }
 assert.equal(frames.size,18);assert.equal(Math.max(...frames),17);assert.equal(extraMatchFrame('gael'),null);assert.equal(extraMatchFrame('unknown'),null);
 const png=readFileSync(new URL(`..${EXTRA_MATCH_ATLAS_URL}`,import.meta.url));assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.readUInt32BE(16)>=600);assert.ok(png.readUInt32BE(20)>=300);
});
test('victory actions promote next mission or matchup selection; losses keep retry; focus follows order',()=>{
 const nodes=new Map(),order=[];const $=id=>{if(!nodes.has(id))nodes.set(id,{id,dataset:{},className:'',before:n=>order.push(n.id),focus(){this.focused=true;}});return nodes.get(id);};
 const configure=runInNewContext(app.slice(app.indexOf('function setResultActions('),app.indexOf('let dragPointer=null;'))+';setResultActions',{$});
 for(const [won,kind,primary] of [[true,'duel','returnToClub'],[true,'quick','quickRematchSetup'],[false,'duel','playAgain'],[true,undefined,'returnToClub'],[false,'quick','playAgain']]){
  configure(won,kind);assert.equal($(primary).className,'primary');assert.equal($(primary).focused,true);
  if(won){assert.equal($('playAgain').className,'text-button');assert.equal(order.at(-1),primary);}
  assert.equal($('returnToClub').dataset.nextMission,String(won&&kind==='duel'));
 }
});
test('Beto first medal plays reward music once and still routes to André',()=>{
 let panel,target;const tracks=[];
 const scope={campaign:readAdventure({version:6,welcomed:true,met:true,trained:true,history:true,barVisited:true,cup:true,places:EXPLORE,wins:RIVALS.slice(0,4),requests:RIVALS.slice(0,5)}),npc:id=>NPCS.find(n=>n.id===id),story:p=>panel=p,audio:{setScene:(...args)=>tracks.push(args)},openMedals(){},goTo:n=>target=n.id,world:{places:[]}};
 scope.progress=e=>{scope.campaign=advanceAdventure(scope.campaign,e);};
 const action=runInNewContext(app.slice(app.indexOf('function runStoryAction('),app.indexOf('function startParty('))+';runStoryAction',scope);
 action({event:{type:'beto-story-heard'},route:'andre'},scope.npc('beto'));
 assert.equal(panel.music,'medal');assert.equal(panel.actions[0].primary,true);assert.equal(scope.campaign.betoStory,true);panel.actions[0].run();assert.equal(target,'andre');
 action({event:{type:'beto-story-heard'},route:'andre'},scope.npc('beto'));assert.equal(tracks.length,1);
});
