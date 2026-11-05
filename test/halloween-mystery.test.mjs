import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CASES,chooseCase,evidenceFor,finalRule} from '../game2/mystery.js';
import {CHILDREN,childFrame} from '../game2/children.js';
import {RIVALS,readAdventure,advanceAdventure,stageOf,objective,NPCS} from '../game2/adventure.js';
import {conversation} from '../game2/campaign-story.js';
import {syncHalloween,isZombie} from '../game2/halloween-state.js';
import {quickConfig,quickCharacter} from '../game2/quick-play.js';
import {createRacketMatch,canPrepare} from '../game2/racket-match.js';
import {createChallenge,evaluateChallenge,stepChallenge,challengeStatus} from '../game2/halloween-challenges.js';
import {exportSave,parseSave} from '../game2/campaign-save.js';
const act=(s,type,extra={})=>advanceAdventure(s,{type,...extra});
const complete=caseId=>readAdventure({edition:'misterio-ilha',version:9,caseId,name:'Detetive',begun:true,welcomed:true,felipeIntro:true,history:true,met:true,trained:true,barVisited:true,cup:true,clues:['purple-vial','old-ledger','silver-bell'],wins:RIVALS,requests:RIVALS,dosed:RIVALS,deliveries:RIVALS});

test('Three possible adults; case persists through reload, profile edits, export and import',()=>{
 assert.deepEqual([chooseCase(()=>0),chooseCase(()=>.5),chooseCase(()=>.999)],Object.keys(CASES));
 for(const id of Object.keys(CASES)){
  let s=complete(id);assert.equal(s.caseId,id);
  assert.equal(readAdventure(JSON.parse(JSON.stringify(s))).caseId,id);
  assert.equal(act(s,'profile',{name:'Novo apelido',avatar:'player-f'}).caseId,id);
  assert.equal(parseSave(exportSave(s)).campaign.caseId,id);
  const clues=evidenceFor(s);assert.equal(clues.length,6);assert.ok(clues.some(c=>c.text.includes(CASES[id].object)));assert.ok(clues.some(c=>c.text.includes(CASES[id].container)));
  assert.equal(evidenceFor({...s,wins:[]}).length,0);assert.equal(evidenceFor({...s,wins:['gabriel']}).length,1);
 }
});

test('Investigation gates accusation, actual final challenge, gratitude and celebration',()=>{
 for(const id of Object.keys(CASES)){
  let s=complete(id);assert.equal(stageOf(s),'final-guide');assert.equal(act(s,'final-briefing').finalBriefing,false);
  assert.equal(act(s,'final-won',{id,success:true}).finalWon,false);
  assert.equal(act({...s,deliveries:RIVALS.slice(0,5)},'accuse',{id}).accused,null);
  for(const other of Object.keys(CASES).filter(x=>x!==id))assert.equal(act(s,'accuse',{id:other}).accused,null);
  assert.equal(conversation(s,'leandro').actions.filter(a=>a.accuse).length,3);
  s=act(s,'accuse',{id});assert.equal(objective(s).target,id);assert.ok(conversation(s,id).actions.some(a=>a.final));
  assert.equal(act(s,'final-won',{id,success:false}).finalWon,false);assert.equal(act(s,'final-won',{id:'gabriel',success:true}).finalWon,false);
  s=act(s,'final-won',{id,success:true});syncHalloween(s);assert.equal(isZombie({id}),false);assert.equal(stageOf(s),'final-thanks');assert.equal(objective(s).target,'leandro');
  assert.equal(act(s,'crowned').champion,false);s=act(s,'final-briefing');assert.equal(objective(s).target,'bar');s=act(s,'crowned');assert.equal(stageOf(s),'champion');
 }
 syncHalloween(readAdventure(null));
});

test('All final challenge variants can succeed and use final-specific feedback',()=>{
 for(const id of Object.keys(CASES)){
  const rule=finalRule(complete(id)),game=createRacketMatch({assisted:true}),c=createChallenge(id,game,rule);
  assert.ok(c.final);assert.ok(challengeStatus(c,game).includes('Última'));
  if(c.kind==='rally'){
   for(let f=0;f<6000&&!game.done;f++)stepChallenge(c,game,{serve:game.awaitingServe,serveGesture:{aim:0,power:.45},...(canPrepare(game)?{stroke:{shot:'normal',aim:0,power:.4}}:{})});
  }else for(let p=0;p<c.target;p++){const before={playerPoints:game.playerPoints,cpuPoints:game.cpuPoints,elapsed:game.elapsed};game.playerPoints++;evaluateChallenge(c,game,before);}
  assert.equal(c.succeeded,true,id);assert.match(c.reason,/Última sessão/);assert.doesNotMatch(c.reason,/Higor|Michele|Scarlt/);
 }
});

test('Four real children replace placeholders and all have walk/front/back/side/tennis frames',()=>{
 assert.deepEqual(CHILDREN.map(p=>p.id),['carolina','bernado','benicio','maisa']);
 for(const id of ['neco','lia','nilo'])assert.ok(!NPCS.some(n=>n.id===id));
 syncHalloween(readAdventure(null));
 for(const child of CHILDREN){
  assert.equal(isZombie(child),false);assert.equal(quickCharacter(child.id).id,child.id);
  for(const role of ['player','opponent'])assert.equal(quickConfig({[role]:child.id})[role],child.id);
  for(const [direction,offset]of [['down',0],['up',3],['right',6]]){
   assert.equal(childFrame(child.id,direction,0).index,offset);
   assert.deepEqual([0,.1,1].map(t=>childFrame(child.id,direction,t).index),[offset,offset+1,offset+2]);
   assert.equal(childFrame(child.id,direction,0,true).index,9+offset/3);
  }
  assert.equal(childFrame(child.id,'left').flip,true);
 }
 for(const id of ['gael','lourenco','betinho','malu'])assert.equal(isZombie({id}),false);
});

test('v8 saves preserve treatment milestones and completed endings with stable migration',()=>{
 const old={...complete('beto'),version:8,caseId:undefined,wins:['gabriel','vanessa','higor','michele','betinho'],dosed:['gabriel','vanessa','higor','michele','betinho'],deliveries:['gabriel','vanessa','higor','michele']};
 const s=readAdventure(old);assert.deepEqual(s.wins,RIVALS.slice(0,5));assert.equal(s.deliveries.length,4);assert.equal(s.caseId,readAdventure(old).caseId);
 const finished=readAdventure({...old,wins:[...old.wins,'scarlt'],deliveries:[...old.wins,'scarlt'],finalBriefing:true,champion:true,creditsSeen:true});
 assert.ok(finished.champion&&finished.finalWon&&finished.creditsSeen);assert.equal(finished.accused,finished.caseId);
});

test('CG and branding refer only to final continuity art and the requested title',async()=>{
 const intro=await readFile(new URL('../game2/halloween-intro.js',import.meta.url),'utf8');
 for(const shot of ['party','ingredient','green'])assert.ok(intro.includes(`intro-${shot}-v2.webp`));
 const html=await readFile(new URL('../game2/index.html',import.meta.url),'utf8');assert.ok(html.includes('Ilha Tênis — O Mistério'));assert.doesNotMatch(html,/provisórios|24 PERSONAGENS/);
 const brand=await readFile(new URL('../game2/game-brand.js',import.meta.url),'utf8');assert.match(brand,/O MISTÉRIO/);assert.match(brand,/ESPECIAL HALLOWEEN/);
});
